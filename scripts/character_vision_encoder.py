"""Shared lightweight character encoder for cross-domain matching (M1) and view/size prediction (M2)."""

from __future__ import annotations

from collections import OrderedDict
import hashlib
import io
import json
import math
from pathlib import Path
from typing import Any

from nyamuru_bridge_constants import CHARACTER_REFERENCE_VIEWS, FIGURE_PERFORMANCE_SIZES

ENCODER_INPUT_SIZE = 224
DEFAULT_MATCH_MIN_SCORE = 0.68
DEFAULT_MATCH_MIN_MARGIN = 0.035
VIEW_PREDICTION_CLASSES = ("front", "three-quarter", "side", "back")
_EMBEDDING_CACHE_LIMIT = 256

_session_cache: dict[str, Any] = {}
_metadata_cache: dict[str, dict[str, Any]] = {}
_embedding_cache: OrderedDict[tuple[str, str], tuple[list[float], int, int]] = OrderedDict()


def _get_session(model_path: Path | None):
    if model_path is None or not model_path.is_file():
        return None
    import onnxruntime as ort

    key = str(model_path.resolve())
    if key not in _session_cache:
        _session_cache[key] = ort.InferenceSession(key, providers=["CPUExecutionProvider"])
    return _session_cache[key]


def _load_encoder_metadata(model_path: Path) -> dict[str, Any]:
    key = str(model_path.resolve())
    if key not in _metadata_cache:
        provenance_path = model_path.parent / "provenance.json"
        meta: dict[str, Any] = {}
        try:
            if provenance_path.is_file():
                loaded = json.loads(provenance_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    meta = loaded
        except Exception:
            meta = {}
        _metadata_cache[key] = meta
    return _metadata_cache[key]


def _resolve_input_size(session: Any, meta: dict[str, Any]) -> int:
    try:
        shape = session.get_inputs()[0].shape
    except Exception:
        shape = None
    if not (isinstance(shape, (list, tuple)) and len(shape) == 4):
        shape = (meta.get("input_spec") or {}).get("shape") if isinstance(meta.get("input_spec"), dict) else None
    if (
        isinstance(shape, (list, tuple))
        and len(shape) == 4
        and isinstance(shape[2], int)
        and shape[2] > 0
        and (not isinstance(shape[3], int) or shape[3] == shape[2])
    ):
        return int(shape[2])
    return ENCODER_INPUT_SIZE


def _l2_normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector))
    if norm <= 1e-12:
        return [0.0 for _ in vector]
    return [v / norm for v in vector]


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    if len(vec_a) != len(vec_b) or not vec_a:
        return 0.0
    return sum(a * b for a, b in zip(vec_a, vec_b))


def _load_rgb_array(image_bytes: bytes, size: int = 64):
    import numpy as np
    from PIL import Image, ImageOps

    if not image_bytes:
        raise ValueError("解析対象の画像データが空です")
    with Image.open(io.BytesIO(image_bytes)) as source:
        image = ImageOps.exif_transpose(source)
        if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
            rgba = image.convert("RGBA")
            canvas = Image.new("RGB", rgba.size, (255, 255, 255))
            canvas.paste(rgba, mask=rgba.split()[-1])
            image = canvas
        else:
            image = image.convert("RGB")
        width, height = image.size
        resized = image.resize((size, size), Image.Resampling.BILINEAR)
    return np.asarray(resized, dtype=np.float32) / 255.0, width, height


def _preprocess_for_onnx(image_bytes: bytes, session: Any, meta: dict[str, Any]):
    import numpy as np

    input_size = _resolve_input_size(session, meta)
    arr, width, height = _load_rgb_array(image_bytes, size=input_size)
    preprocess = meta.get("preprocess") if isinstance(meta.get("preprocess"), dict) else {}
    mean = preprocess.get("mean")
    std = preprocess.get("std")
    try:
        input_name = session.get_inputs()[0].name
    except Exception:
        input_name = ""
    if (mean is None or std is None) and input_name == "pixel_values":
        mean = [0.5, 0.5, 0.5]
        std = [0.5, 0.5, 0.5]
    if (
        isinstance(mean, (list, tuple))
        and isinstance(std, (list, tuple))
        and len(mean) == 3
        and len(std) == 3
    ):
        mean_arr = np.asarray(mean, dtype=np.float32).reshape(1, 1, 3)
        std_arr = np.asarray(std, dtype=np.float32).reshape(1, 1, 3)
        arr = (arr - mean_arr) / std_arr
    tensor = np.ascontiguousarray(arr.transpose(2, 0, 1)[None], dtype=np.float32)
    return tensor, width, height


def _extract_embedding_vector(session: Any, outputs: list[Any], meta: dict[str, Any]) -> list[float]:
    import numpy as np

    try:
        output_names = [o.name for o in session.get_outputs()]
    except Exception:
        output_names = []
    preferred = meta.get("output_name")
    search_order = [preferred] if isinstance(preferred, str) and preferred else []
    search_order.extend(["pooler_output", "image_embeds", "embedding"])

    chosen = None
    for name in search_order:
        if name in output_names:
            idx = output_names.index(name)
            if idx < len(outputs):
                chosen = outputs[idx]
                break
    if chosen is None:
        for out in outputs:
            arr_candidate = np.asarray(out)
            if arr_candidate.ndim == 2:
                chosen = out
                break
    if chosen is None:
        chosen = outputs[0]

    arr = np.asarray(chosen, dtype=np.float32)
    if arr.ndim == 3:
        vec = arr[0].mean(axis=0)
    elif arr.ndim == 2:
        vec = arr[0]
    else:
        vec = arr.reshape(-1)
    return [float(v) for v in vec.tolist()]


def _fallback_descriptor(image_bytes: bytes) -> tuple[list[float], int, int, float, float]:
    """Extract a deterministic spatial-intensity + edge-symmetry descriptor when ONNX is absent."""
    import numpy as np

    arr, width, height = _load_rgb_array(image_bytes, size=32)
    gray = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    # 8x8 spatial intensity grid (64) + horizontal/vertical edge histograms (32) = 96 dims.
    pooled = gray.reshape(8, 4, 8, 4).mean(axis=(1, 3)).flatten()
    dx = np.abs(np.diff(gray, axis=1, prepend=gray[:, :1]))
    dy = np.abs(np.diff(gray, axis=0, prepend=gray[:1, :]))
    edge_h = dx.reshape(4, 8, 4, 8).mean(axis=(1, 3)).flatten()
    edge_v = dy.reshape(4, 8, 4, 8).mean(axis=(1, 3)).flatten()
    ink = 1.0 - gray
    left_ink = float(ink[:, :16].sum())
    right_ink = float(ink[:, 16:].sum())
    symmetry = 1.0 - abs(left_ink - right_ink) / max(left_ink + right_ink, 1e-6)
    aspect = height / max(width, 1)
    vector = _l2_normalize([float(x) for x in pooled] + [float(x) for x in edge_h] + [float(x) for x in edge_v])
    return vector, width, height, symmetry, aspect


def embed_character_image(
    image_bytes: bytes,
    *,
    model_path: Path | None = None,
) -> dict[str, Any]:
    """Compute an L2-normalized character embedding using shared ONNX encoder or lightweight fallback."""
    session = _get_session(model_path)
    if session is not None and model_path is not None:
        resolved_key = str(model_path.resolve())
        digest = hashlib.sha256(image_bytes).hexdigest()
        cache_key = (resolved_key, digest)
        cached = _embedding_cache.get(cache_key)
        if cached is not None:
            _embedding_cache.move_to_end(cache_key)
            embedding, width, height = cached
            return {
                "embedding": embedding,
                "runtime": "onnx-character-encoder",
                "model": model_path.parent.name or "onnx",
                "width": width,
                "height": height,
            }
        meta = _load_encoder_metadata(model_path)
        tensor, width, height = _preprocess_for_onnx(image_bytes, session, meta)
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: tensor})
        embedding = _l2_normalize(_extract_embedding_vector(session, outputs, meta))
        _embedding_cache[cache_key] = (embedding, width, height)
        if len(_embedding_cache) > _EMBEDDING_CACHE_LIMIT:
            _embedding_cache.popitem(last=False)
        return {
            "embedding": embedding,
            "runtime": "onnx-character-encoder",
            "model": model_path.parent.name or "onnx",
            "width": width,
            "height": height,
        }
    vector, width, height, _symmetry, _aspect = _fallback_descriptor(image_bytes)
    return {
        "embedding": vector,
        "runtime": "lightweight-descriptor-fallback",
        "model": "descriptor-fallback-v1",
        "width": width,
        "height": height,
    }


def match_character_embeddings(
    query_embedding: list[float],
    reference_embeddings: list[dict[str, Any]],
    *,
    min_score: float = DEFAULT_MATCH_MIN_SCORE,
    min_margin: float = DEFAULT_MATCH_MIN_MARGIN,
) -> dict[str, Any]:
    """Rank candidate character reference embeddings and abstain on low score or margin."""
    by_character: dict[str, list[float]] = {}
    for entry in reference_embeddings:
        cid = str(entry.get("id") or "").strip()
        emb = entry.get("embedding")
        if not cid or not isinstance(emb, list) or not emb:
            continue
        score = _cosine_similarity(query_embedding, [float(v) for v in emb])
        by_character.setdefault(cid, []).append(score)

    rankings = sorted(
        ({"id": cid, "score": round(max(scores), 4)} for cid, scores in by_character.items()),
        key=lambda item: item["score"],
        reverse=True,
    )
    if not rankings:
        return {"candidate_id": "", "confidence": "none", "score": 0.0, "margin": 0.0, "rankings": []}

    top = rankings[0]
    second_score = rankings[1]["score"] if len(rankings) > 1 else 0.0
    margin = round(top["score"] - second_score, 4) if len(rankings) > 1 else round(top["score"], 4)

    if top["score"] < min_score or (len(rankings) > 1 and margin < min_margin):
        confidence = "none"
        matched_id = ""
    else:
        matched_id = top["id"]
        if top["score"] >= 0.85 and (len(rankings) == 1 or margin >= 0.08):
            confidence = "high"
        elif top["score"] >= 0.75:
            confidence = "medium"
        else:
            confidence = "low"

    return {
        "candidate_id": matched_id,
        "confidence": confidence,
        "score": top["score"],
        "margin": margin,
        "rankings": rankings[:10],
    }


def predict_figure_view_and_size(
    image_bytes: bytes,
    *,
    current_size: str = "bust-up",
    model_path: Path | None = None,
) -> dict[str, Any]:
    """Predict view angle (front/three-quarter/side/back) and framing size from a figure crop."""
    safe_size = current_size if current_size in FIGURE_PERFORMANCE_SIZES else "bust-up"
    session = _get_session(model_path)
    if session is not None and len(session.get_outputs()) >= 3:
        arr, _w, _h = _load_rgb_array(image_bytes, size=ENCODER_INPUT_SIZE)
        tensor = arr.transpose(2, 0, 1)[None]
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: tensor})
        view_logits = [float(v) for v in outputs[1][0]]
        size_logits = [float(v) for v in outputs[2][0]]
        view_idx = max(range(min(len(view_logits), len(VIEW_PREDICTION_CLASSES))), key=view_logits.__getitem__)
        size_list = sorted(FIGURE_PERFORMANCE_SIZES)
        size_idx = max(range(min(len(size_logits), len(size_list))), key=size_logits.__getitem__)
        return {
            "recommended_view": VIEW_PREDICTION_CLASSES[view_idx],
            "facing": "front" if VIEW_PREDICTION_CLASSES[view_idx] == "front" else "unknown",
            "suggested_size": size_list[size_idx],
            "confidence": 0.9,
            "runtime": "onnx-character-encoder",
        }

    _vec, width, height, symmetry, aspect = _fallback_descriptor(image_bytes)
    if symmetry >= 0.82:
        recommended_view, facing = "front", "front"
    elif symmetry >= 0.62:
        recommended_view, facing = "three-quarter", "unknown"
    else:
        recommended_view, facing = "side", "unknown"

    if aspect >= 2.2:
        suggested_size = "full"
    elif aspect >= 1.5:
        suggested_size = "waist-up"
    elif aspect <= 1.05 and max(width, height) <= 320:
        suggested_size = "face"
    else:
        suggested_size = safe_size

    return {
        "recommended_view": recommended_view if recommended_view in CHARACTER_REFERENCE_VIEWS else "other",
        "facing": facing,
        "suggested_size": suggested_size if suggested_size in FIGURE_PERFORMANCE_SIZES else safe_size,
        "confidence": round(0.55 + 0.35 * symmetry, 4),
        "runtime": "lightweight-descriptor-fallback",
    }


def recommend_reference_view(
    figure_image_bytes: bytes,
    available_assets: list[dict[str, Any]],
    *,
    current_size: str = "bust-up",
    model_path: Path | None = None,
) -> dict[str, Any]:
    """Select the best matching reference sheet asset for the predicted figure view."""
    prediction = predict_figure_view_and_size(
        figure_image_bytes, current_size=current_size, model_path=model_path,
    )
    target_view = prediction["recommended_view"]
    valid_assets = [
        asset for asset in available_assets
        if isinstance(asset, dict) and isinstance(asset.get("asset_id"), str) and asset["asset_id"].strip()
    ]
    if not valid_assets:
        return {**prediction, "asset_id": "", "matched_view": "other"}

    priority = [target_view, "three-quarter", "front", "turnaround", "side", "back", "other"]
    selected = None
    for view_name in priority:
        selected = next((a for a in valid_assets if a.get("view") == view_name), None)
        if selected is not None:
            break
    if selected is None:
        selected = valid_assets[0]
    return {
        **prediction,
        "asset_id": selected["asset_id"].strip(),
        "matched_view": selected.get("view") if selected.get("view") in CHARACTER_REFERENCE_VIEWS else "other",
    }
