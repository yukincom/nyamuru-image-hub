"""Local ONNX inference for RT-DETRv4-X Manga109-s v2.

The model weights are downloaded separately by ``npm run setup:vision`` and
are never committed to this repository.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


CLASS_NAMES = {0: "body", 1: "text", 2: "frame", 3: "face"}
BUCKET_NAMES = {
    "body": "bodies",
    "text": "texts",
    "frame": "frames",
    "face": "faces",
}
ID_PREFIXES = {"body": "b", "text": "t", "frame": "f", "face": "face"}
INPUT_SIZE = 1280
SCHEMA_VERSION = 1

_session_cache: dict[str, Any] = {}


def _get_session(model_path: Path):
    import onnxruntime as ort

    key = str(model_path.resolve())
    if key not in _session_cache:
        if not model_path.is_file():
            raise FileNotFoundError(
                f"ONNX model not found: {model_path}. "
                "Run `npm run setup:vision` first."
            )
        _session_cache[key] = ort.InferenceSession(
            key,
            providers=["CPUExecutionProvider"],
        )
    return _session_cache[key]


def detection_buckets(labels, boxes, scores, conf_threshold: float) -> dict[str, list[dict[str, Any]]]:
    """Convert raw ONNX outputs to the bridge's stable detection buckets."""

    buckets: dict[str, list[dict[str, Any]]] = {
        "bodies": [],
        "texts": [],
        "frames": [],
        "faces": [],
    }
    counters = {name: 0 for name in BUCKET_NAMES}
    for class_id, box, score in zip(labels, boxes, scores):
        if float(score) < conf_threshold:
            continue
        name = CLASS_NAMES.get(int(class_id))
        if name is None:
            continue
        index = counters[name]
        counters[name] += 1
        x1, y1, x2, y2 = (float(value) for value in box)
        buckets[BUCKET_NAMES[name]].append(
            {
                "id": f"{ID_PREFIXES[name]}{index}",
                "bbox": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
                "score": round(float(score), 4),
            }
        )
    return buckets


def detect_page(
    image_path: str | Path,
    *,
    model_path: str | Path,
    conf_threshold: float = 0.5,
) -> dict[str, Any]:
    import numpy as np
    from PIL import Image

    image_path = Path(image_path)
    model_path = Path(model_path)
    session = _get_session(model_path)

    with Image.open(image_path) as source:
        image = source.convert("RGB")
        width, height = image.size
        resized = image.resize((INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR)
    image_array = np.asarray(resized, dtype=np.float32) / 255.0
    image_array = image_array.transpose(2, 0, 1)[None]
    original_size = np.array([[width, height]], dtype=np.int64)

    labels, boxes, scores = session.run(
        None,
        {"images": image_array, "orig_target_sizes": original_size},
    )
    buckets = detection_buckets(labels[0], boxes[0], scores[0], conf_threshold)
    return {
        "schema_version": SCHEMA_VERSION,
        "page": {
            "image_path": str(image_path),
            "width": width,
            "height": height,
        },
        "detections": buckets,
        "model": {
            "name": "rtdetrv4-x-manga109s_v2",
            "path": str(model_path),
            "conf_threshold": conf_threshold,
        },
    }
