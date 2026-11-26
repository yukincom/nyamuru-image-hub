"""Lightweight 4-way page orientation classifier (0/90/180/270 clockwise degrees)."""

from __future__ import annotations

import io
import math
from pathlib import Path
from typing import Any

ORIENTATION_CLASSES = (0, 90, 180, 270)
INPUT_SIZE = 384
DEFAULT_MIN_CONFIDENCE = 0.80

_session_cache: dict[str, Any] = {}


def _get_session(model_path: Path):
    import onnxruntime as ort

    key = str(model_path.resolve())
    if key not in _session_cache:
        _session_cache[key] = ort.InferenceSession(key, providers=["CPUExecutionProvider"])
    return _session_cache[key]


def _resolve_model_input_size(session: Any) -> int:
    try:
        shape = session.get_inputs()[0].shape
    except Exception:
        return INPUT_SIZE
    if (
        isinstance(shape, (list, tuple))
        and len(shape) == 4
        and isinstance(shape[2], int)
        and shape[2] > 0
        and (not isinstance(shape[3], int) or shape[3] == shape[2])
    ):
        return int(shape[2])
    return INPUT_SIZE


def _softmax(logits: list[float]) -> list[float]:
    if not logits:
        return []
    peak = max(logits)
    exps = [math.exp(value - peak) for value in logits]
    total = sum(exps) or 1.0
    return [value / total for value in exps]


def _row_to_probabilities(raw_values: list[float]) -> list[float]:
    if all(0.0 <= v <= 1.0 for v in raw_values) and abs(sum(raw_values) - 1.0) <= 1e-3:
        return raw_values
    return _softmax(raw_values)


def prepare_orientation_tensor(image_bytes: bytes, input_size: int = INPUT_SIZE):
    import numpy as np
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(image_bytes)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        resized = image.resize((input_size, input_size), Image.Resampling.BILINEAR)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    return array.transpose(2, 0, 1)[None]


def prepare_orientation_candidates(image_bytes: bytes, input_size: int = INPUT_SIZE):
    """Build a 4-view batch rotated by clockwise 0/90/180/270 degrees."""
    import numpy as np
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(image_bytes)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        resized = image.resize((input_size, input_size), Image.Resampling.BILINEAR)
    arr = np.asarray(resized, dtype=np.float32) / 255.0
    candidates = np.stack(
        [
            arr,
            np.rot90(arr, k=-1),
            np.rot90(arr, k=2),
            np.rot90(arr, k=1),
        ],
        axis=0,
    ).transpose(0, 3, 1, 2)
    return np.ascontiguousarray(candidates)


def interpret_orientation_probabilities(
    probabilities: list[float],
    *,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
    model_name: str = "page-orientation-onnx",
) -> dict[str, Any]:
    if len(probabilities) != len(ORIENTATION_CLASSES) or any(
        not isinstance(p, (int, float)) or not math.isfinite(p) or p < 0 for p in probabilities
    ):
        raise ValueError("原稿向きモデルの出力確率形式が正しくありません")
    total = sum(probabilities)
    normalized = [float(p) / total for p in probabilities] if total > 0 else [0.25, 0.25, 0.25, 0.25]
    best_index = max(range(len(normalized)), key=normalized.__getitem__)
    best_degrees = ORIENTATION_CLASSES[best_index]
    best_confidence = round(normalized[best_index], 4)
    confident = best_confidence >= min_confidence
    return {
        "recommended_degrees": best_degrees if confident else 0,
        "raw_degrees": best_degrees,
        "confidence": best_confidence,
        "applied": bool(confident and best_degrees != 0),
        "probabilities": {str(deg): round(prob, 4) for deg, prob in zip(ORIENTATION_CLASSES, normalized)},
        "model": model_name,
        **({} if confident else {"fallback_reason": "low_confidence"}),
    }


def interpret_upright_scan_probabilities(
    upright_probabilities: list[float],
    *,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
    model_name: str = "page-orientation-onnx",
) -> dict[str, Any]:
    """Select the single clockwise rotation with highest upright (0-deg) probability and stop."""
    if len(upright_probabilities) != len(ORIENTATION_CLASSES) or any(
        not isinstance(p, (int, float)) or not math.isfinite(p) or p < 0 for p in upright_probabilities
    ):
        raise ValueError("原稿向きモデルの出力確率形式が正しくありません")
    floats = [float(p) for p in upright_probabilities]
    total = sum(floats)
    normalized = [p / total for p in floats] if total > 0 else [0.25, 0.25, 0.25, 0.25]
    best_index = max(range(len(floats)), key=floats.__getitem__)
    best_degrees = ORIENTATION_CLASSES[best_index]
    best_confidence = round(min(floats[best_index], normalized[best_index]), 4)
    confident = best_confidence >= min_confidence
    return {
        "recommended_degrees": best_degrees if confident else 0,
        "raw_degrees": best_degrees,
        "confidence": best_confidence,
        "applied": bool(confident and best_degrees != 0),
        "probabilities": {str(deg): round(prob, 4) for deg, prob in zip(ORIENTATION_CLASSES, normalized)},
        "upright_probabilities": {str(deg): round(prob, 4) for deg, prob in zip(ORIENTATION_CLASSES, floats)},
        "strategy": "upright_scan",
        "model": model_name,
        **({} if confident else {"fallback_reason": "low_confidence"}),
    }


def estimate_page_orientation(
    image_bytes: bytes,
    *,
    model_path: Path | None = None,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
) -> dict[str, Any]:
    """Predict clockwise rotation yielding the highest upright probability; stay at 0 when uncertain."""
    if not image_bytes:
        raise ValueError("判定対象の画像データが空です")
    if model_path is None or not model_path.is_file():
        return {
            "recommended_degrees": 0,
            "raw_degrees": 0,
            "confidence": 0.0,
            "applied": False,
            "probabilities": {str(deg): 0.0 for deg in ORIENTATION_CLASSES},
            "model": "none",
            "fallback_reason": "model_unavailable",
        }
    session = _get_session(model_path)
    input_size = _resolve_model_input_size(session)
    batch = prepare_orientation_candidates(image_bytes, input_size=input_size)
    input_name = session.get_inputs()[0].name
    try:
        rows = session.run(None, {input_name: batch})[0]
        if len(rows) != len(ORIENTATION_CLASSES):
            raise ValueError("unexpected batch output length")
    except Exception:
        rows = [
            session.run(None, {input_name: batch[i : i + 1]})[0][0]
            for i in range(len(ORIENTATION_CLASSES))
        ]
    upright_probs = [_row_to_probabilities([float(value) for value in row])[0] for row in rows]
    return interpret_upright_scan_probabilities(
        upright_probs,
        min_confidence=min_confidence,
        model_name=model_path.parent.name or model_path.name,
    )
