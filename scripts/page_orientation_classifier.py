"""Lightweight 4-way page orientation classifier (0/90/180/270 clockwise degrees)."""

from __future__ import annotations

import io
import math
from pathlib import Path
from typing import Any

ORIENTATION_CLASSES = (0, 90, 180, 270)
INPUT_SIZE = 224
DEFAULT_MIN_CONFIDENCE = 0.80

_session_cache: dict[str, Any] = {}


def _get_session(model_path: Path):
    import onnxruntime as ort

    key = str(model_path.resolve())
    if key not in _session_cache:
        _session_cache[key] = ort.InferenceSession(key, providers=["CPUExecutionProvider"])
    return _session_cache[key]


def _softmax(logits: list[float]) -> list[float]:
    if not logits:
        return []
    peak = max(logits)
    exps = [math.exp(value - peak) for value in logits]
    total = sum(exps) or 1.0
    return [value / total for value in exps]


def prepare_orientation_tensor(image_bytes: bytes):
    import numpy as np
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(image_bytes)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        resized = image.resize((INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    return array.transpose(2, 0, 1)[None]


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


def estimate_page_orientation(
    image_bytes: bytes,
    *,
    model_path: Path | None = None,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
) -> dict[str, Any]:
    """Predict clockwise rotation needed to make a page upright; stay at 0 when unavailable or uncertain."""
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
    tensor = prepare_orientation_tensor(image_bytes)
    session = _get_session(model_path)
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: tensor})
    raw_logits = [float(value) for value in outputs[0][0]]
    # Accept either logits or already-normalized probabilities.
    if all(0.0 <= v <= 1.0 for v in raw_logits) and abs(sum(raw_logits) - 1.0) <= 1e-3:
        probs = raw_logits
    else:
        probs = _softmax(raw_logits)
    return interpret_orientation_probabilities(
        probs,
        min_confidence=min_confidence,
        model_name=model_path.parent.name or model_path.name,
    )
