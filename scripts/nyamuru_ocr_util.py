"""Image decode, rotation, and OCR line filtering helpers for the local vision bridge."""

from __future__ import annotations

import base64
import io
from typing import Any


def decode_image_data(value: object) -> bytes:
    if not isinstance(value, str) or not value.startswith("data:image/") or "," not in value:
        raise ValueError("画像データの形式が正しくありません")
    encoded = value.split(",", 1)[1]
    try:
        return base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValueError("画像データをデコードできませんでした") from exc


def normalized_rotation_override(value: object) -> int | None:
    if value is None:
        return None
    try:
        rotation = int(value)
    except (TypeError, ValueError):
        raise ValueError("手動の向き指定は0・90・180・270度のいずれかです") from None
    if rotation not in {0, 90, 180, 270}:
        raise ValueError("手動の向き指定は0・90・180・270度のいずれかです")
    return rotation


def ocr_text_quality(text: str) -> float:
    compact = "".join(text.split())
    if not compact:
        return 0.0
    japanese = sum("\u3040" <= char <= "\u30ff" or "\u3400" <= char <= "\u9fff" for char in compact)
    latin = sum(char.isascii() and char.isalpha() for char in compact)
    repeated = max((compact.count(char) for char in set(compact)), default=0)
    return japanese * 2.0 + min(len(compact), 24) * 0.08 - latin * 0.6 - max(0, repeated - 5)


def usable_ocr_lines(payload: dict[str, Any]) -> list[dict[str, Any]]:
    width = float(payload.get("width", 0) or 0)
    height = float(payload.get("height", 0) or 0)
    if width <= 0 or height <= 0:
        return []
    raw = []
    if isinstance(payload.get("region_lines"), list):
        raw.extend(payload["region_lines"])
    if isinstance(payload.get("detected_lines"), list):
        raw.extend(payload["detected_lines"])
    selected: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        bbox = item.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            continue
        try:
            x, y, box_width, box_height = (float(value) for value in bbox)
        except (TypeError, ValueError):
            continue
        text = str(item.get("text", "")).strip()
        quality = ocr_text_quality(text)
        area_ratio = max(0.0, box_width) * max(0.0, box_height) / (width * height)
        unreadable = bool(item.get("unreadable", False)) and not text
        if area_ratio > 0.18 or (not unreadable and (not text or quality < -1.0)):
            continue
        normalized = {
            "id": str(item.get("id", f"ocr-{len(selected)}")),
            "text": text[:500],
            "bbox": [x / width, y / height, box_width / width, box_height / height],
            "confidence": max(0.0, min(1.0, float(item.get("confidence", 0) or 0))),
            "vertical": bool(item.get("vertical", False)),
            "source": str(item.get("detection_source", "rtdetr-text")),
            "quality": round(quality, 3),
            "needs_review": (
                bool(item["needs_review"])
                if isinstance(item.get("needs_review"), bool)
                else unreadable or quality < 2.0 or float(item.get("confidence", 0) or 0) < 0.45
            ),
            "unreadable": unreadable,
        }
        if item.get("group_id"):
            normalized["group_id"] = str(item["group_id"])
        duplicate = False
        for previous in selected:
            px, py, pw, ph = previous["bbox"]
            cx, cy, cw, ch = normalized["bbox"]
            overlap_w = max(0.0, min(px + pw, cx + cw) - max(px, cx))
            overlap_h = max(0.0, min(py + ph, cy + ch) - max(py, cy))
            overlap = overlap_w * overlap_h
            smaller = min(pw * ph, cw * ch)
            if smaller > 0 and overlap / smaller > 0.72:
                duplicate = True
                if normalized["quality"] > previous["quality"]:
                    previous.update(normalized)
                break
        if not duplicate:
            selected.append(normalized)
    return sorted(selected, key=lambda item: (round((item["bbox"][1] + item["bbox"][3] / 2) / 0.12), -(item["bbox"][0] + item["bbox"][2] / 2)))[:32]


def rotated_image_bytes(image_bytes: bytes, degrees_clockwise: int) -> bytes:
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(image_bytes)) as source:
        if not degrees_clockwise and source.getexif().get(274, 1) == 1:
            return image_bytes
        image = ImageOps.exif_transpose(source).convert("RGB")
        if degrees_clockwise:
            image = image.rotate(-degrees_clockwise, expand=True, fillcolor="white")
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=94)
    return output.getvalue()
