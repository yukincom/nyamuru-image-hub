"""Coordinate-only lightweight relation scorer (panel reading order, speaker linking, page overlay)."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from nyamuru_detector_regions import PanelBox, box_area, box_intersection_area

_session_cache: dict[str, Any] = {}
DEFAULT_SPEAKER_THRESHOLD = 0.45
DEFAULT_OVERLAY_THRESHOLD = 0.55


def _load_onnx_scorer(model_path: Path | None):
    if model_path is None or not model_path.is_file():
        return None
    import onnxruntime as ort

    key = str(model_path.resolve())
    if key not in _session_cache:
        _session_cache[key] = ort.InferenceSession(key, providers=["CPUExecutionProvider"])
    return _session_cache[key]


def _box_center(box: PanelBox) -> tuple[float, float]:
    return (box[0] + box[2] / 2.0, box[1] + box[3] / 2.0)


def _panel_containing(box: PanelBox, panel_boxes: list[PanelBox]) -> tuple[int, float]:
    area = box_area(box)
    if area <= 0:
        return -1, 0.0
    best_index = -1
    best_ratio = 0.0
    for idx, panel in enumerate(panel_boxes):
        ratio = box_intersection_area(box, panel) / area
        if ratio > best_ratio:
            best_ratio = ratio
            best_index = idx
    return best_index, best_ratio


def _point_to_box_distance(point: tuple[float, float], box: PanelBox) -> float:
    px, py = point
    cx, cy = _box_center(box)
    return math.hypot(px - cx, py - cy)


def score_panel_reading_order(
    panel_boxes: list[PanelBox],
    *,
    model_path: Path | None = None,
) -> dict[str, Any]:
    """Order right-to-left manga panels from coordinate geometry or an optional ONNX scorer."""
    if not panel_boxes:
        return {"order": [], "model_used": False}
    session = _load_onnx_scorer(model_path)
    if session is not None and len(panel_boxes) > 1:
        import numpy as np

        features = np.array(
            [[x, y, w, h, x + w / 2.0, y + h / 2.0, w * h] for x, y, w, h in panel_boxes],
            dtype=np.float32,
        )[None]
        input_name = session.get_inputs()[0].name
        scores = session.run(None, {input_name: features})[0][0]
        if len(scores) == len(panel_boxes):
            order = sorted(range(len(panel_boxes)), key=lambda idx: float(scores[idx]), reverse=True)
            return {"order": order, "model_used": True}

    # Right-to-left, top-to-bottom strip-aware geometric score.
    row_band = 0.14
    scored = []
    for idx, (x, y, w, h) in enumerate(panel_boxes):
        cy = y + h / 2.0
        right_edge = x + w
        row_bucket = round(cy / row_band)
        scored.append((row_bucket, -right_edge, y, idx))
    scored.sort()
    return {"order": [entry[3] for entry in scored], "model_used": False}


def _tail_targets(
    tails: list[dict[str, Any]] | None,
) -> list[tuple[PanelBox, tuple[float, float]]]:
    parsed: list[tuple[PanelBox, tuple[float, float]]] = []
    for tail in tails or []:
        bbox = tail.get("bbox")
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            continue
        box = tuple(float(v) for v in bbox)
        parsed.append((box, _box_center(box)))
    return parsed


def link_bubble_speakers(
    text_lines: list[dict[str, Any]],
    person_regions: list[dict[str, Any]],
    *,
    panel_boxes: list[PanelBox] | None = None,
    tails: list[dict[str, Any]] | None = None,
    min_confidence: float = DEFAULT_SPEAKER_THRESHOLD,
    model_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Assign speaker_figure_id & speaker_confidence using BBox proximity and optional tail cues."""
    if not text_lines or not person_regions:
        return text_lines
    _ = _load_onnx_scorer(model_path)
    panels = panel_boxes or []
    tail_list = _tail_targets(tails)
    linked: list[dict[str, Any]] = []

    for line in text_lines:
        raw_bbox = line.get("bbox")
        if not isinstance(raw_bbox, (list, tuple)) or len(raw_bbox) != 4:
            linked.append(line)
            continue
        tb = tuple(float(v) for v in raw_bbox)
        tc = _box_center(tb)
        t_panel, _ = _panel_containing(tb, panels) if panels else (-1, 0.0)
        nearby_tails = [
            tail_center
            for tail_box, tail_center in tail_list
            if _point_to_box_distance(tail_center, tb) <= max(tb[2], tb[3], 0.12) * 1.6
            or box_intersection_area(tail_box, tb) > 0
        ]

        scored_candidates: list[tuple[float, str]] = []
        for person in person_regions:
            p_bbox = person.get("bbox")
            p_id = str(person.get("id") or "").strip()
            if not p_id or not isinstance(p_bbox, (list, tuple)) or len(p_bbox) != 4:
                continue
            pb = tuple(float(v) for v in p_bbox)
            p_panel, _ = _panel_containing(pb, panels) if panels else (-1, 0.0)
            if panels and t_panel >= 0 and p_panel >= 0 and t_panel != p_panel:
                continue
            dist = _point_to_box_distance(tc, pb)
            score = max(0.0, 1.0 - dist / 0.85)
            if panels and t_panel >= 0 and t_panel == p_panel:
                score += 0.25
            for tail_pt in nearby_tails:
                tail_dist = _point_to_box_distance(tail_pt, pb)
                if tail_dist < dist:
                    score += max(0.0, 0.25 - tail_dist * 0.5)
            scored_candidates.append((min(1.0, score), p_id))

        updated = dict(line)
        if scored_candidates:
            scored_candidates.sort(reverse=True)
            best_score, best_id = scored_candidates[0]
            second_score = scored_candidates[1][0] if len(scored_candidates) > 1 else 0.0
            margin = best_score - second_score
            # Require clear confidence and margin when multiple candidates compete.
            if best_score >= min_confidence and (len(scored_candidates) == 1 or margin >= 0.05):
                updated["speaker_figure_id"] = best_id
                updated["speaker_confidence"] = round(best_score, 4)
        linked.append(updated)
    return linked


def classify_page_overlay_candidates(
    elements: list[dict[str, Any]],
    panel_boxes: list[PanelBox],
    *,
    min_score: float = DEFAULT_OVERLAY_THRESHOLD,
    model_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Score whether each element spans outside panel boundaries (page_overlay candidate)."""
    _ = _load_onnx_scorer(model_path)
    results: list[dict[str, Any]] = []
    for element in elements:
        raw_bbox = element.get("bbox")
        if not isinstance(raw_bbox, (list, tuple)) or len(raw_bbox) != 4:
            results.append(element)
            continue
        box = tuple(float(v) for v in raw_bbox)
        area = box_area(box)
        if area <= 0 or not panel_boxes:
            results.append({**element, "page_overlay_score": 0.0, "page_overlay_recommended": False})
            continue
        ratios = [box_intersection_area(box, panel) / area for panel in panel_boxes]
        max_inside = max(ratios)
        crossed_panels = sum(1 for r in ratios if r >= 0.12)
        outside_ratio = max(0.0, 1.0 - max_inside)
        score = min(1.0, outside_ratio * 0.85 + (0.35 if crossed_panels >= 2 else 0.0))
        results.append({
            **element,
            "page_overlay_score": round(score, 4),
            "page_overlay_recommended": score >= min_score,
        })
    return results
