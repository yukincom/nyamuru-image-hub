"""Slot schema, BIO decoding, and fail-closed validation for voice/text command parsing (M5)."""

from __future__ import annotations

import math
from typing import Any

SLOT_TYPES = (
    "PAGE_NUM",
    "PANEL_NUM",
    "TARGET_DIRECTION",
    "CHAR_NAME",
    "SETTING_KEY",
    "SETTING_VALUE",
    "BUBBLE_SHAPE",
    "PAINT_TOOL",
    "ARTWORK_MODE",
    "BUBBLE_TEXT",
    "TARGET_KIND",
)

SLOT_LABELS = ("O", *(f"{prefix}-{slot}" for slot in SLOT_TYPES for prefix in ("B", "I")))


def validate_slot_spans(text: str, slots: object) -> list[dict[str, Any]]:
    """Verify every extracted slot aligns to `text[start:end]` with finite score in [0, 1]."""
    if slots is None:
        return []
    if not isinstance(slots, list) or len(slots) > 32:
        raise ValueError("スロット抽出の配列形式が不正です")
    validated: list[dict[str, Any]] = []
    for item in slots:
        if not isinstance(item, dict):
            raise ValueError("スロット項目の形式が不正です")
        slot_type = item.get("type")
        slot_text = item.get("text")
        start = item.get("start")
        end = item.get("end")
        score = item.get("score")
        if (
            slot_type not in SLOT_TYPES
            or not isinstance(slot_text, str)
            or not slot_text
            or type(start) is not int
            or type(end) is not int
            or not (0 <= start < end <= len(text))
            or text[start:end] != slot_text
            or type(score) not in (int, float)
            or not math.isfinite(score)
            or not (0.0 <= float(score) <= 1.0)
        ):
            raise ValueError("スロット抽出の整合性検証に失敗しました")
        validated.append({
            "type": slot_type,
            "text": slot_text,
            "start": start,
            "end": end,
            "score": float(score),
        })
    return validated


def extract_command_slots_from_bio(
    text: str,
    offsets: list[tuple[int, int]],
    tag_ids: list[int],
    scores: list[float],
    id2slot: dict[int, str],
) -> list[dict[str, Any]]:
    """Decode BIO token tags and character offsets into validated character-span slots."""
    if not (len(offsets) == len(tag_ids) == len(scores)):
        raise ValueError("スロットトークン長が一致しません")
    spans: list[dict[str, Any]] = []
    active: dict[str, Any] | None = None

    def flush() -> None:
        nonlocal active
        if active is None:
            return
        start, end = active["start"], active["end"]
        if 0 <= start < end <= len(text):
            avg_score = sum(active["scores"]) / len(active["scores"])
            spans.append({
                "type": active["type"],
                "text": text[start:end],
                "start": start,
                "end": end,
                "score": round(float(avg_score), 6),
            })
        active = None

    for (start, end), tag_id, score in zip(offsets, tag_ids, scores):
        # Skip special tokens such as [CLS], [SEP], or padding (0, 0).
        if end <= start:
            flush()
            continue
        label = id2slot.get(int(tag_id), "O")
        if label == "O" or "-" not in label:
            flush()
            continue
        prefix, slot_type = label.split("-", 1)
        if slot_type not in SLOT_TYPES:
            flush()
            continue
        if prefix == "B" or active is None or active["type"] != slot_type:
            flush()
            active = {"type": slot_type, "start": int(start), "end": int(end), "scores": [float(score)]}
        elif prefix == "I":
            active["end"] = int(end)
            active["scores"].append(float(score))
        else:
            flush()
    flush()
    return validate_slot_spans(text, spans)
