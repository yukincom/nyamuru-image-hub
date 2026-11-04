"""Detection boxes, face/body associations and whole-page roles."""

from __future__ import annotations

import math
from typing import Any

MAX_PANEL_AREA_RATIO = 0.82
PanelBox = tuple[float, float, float, float]
LineSegment = tuple[float, float, float, float]


def detector_regions(
    detection: dict[str, Any],
    key: str,
    *,
    min_score: float = 0.2,
    max_area_ratio: float = MAX_PANEL_AREA_RATIO,
) -> list[dict[str, Any]]:
    page = detection.get("page") if isinstance(detection.get("page"), dict) else {}
    width = float(page.get("width", 0) or 0)
    height = float(page.get("height", 0) or 0)
    buckets = detection.get("detections") if isinstance(detection.get("detections"), dict) else {}
    items = buckets.get(key) if isinstance(buckets.get(key), list) else []
    if width <= 0 or height <= 0:
        return []
    regions: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or float(item.get("score", 0) or 0) < min_score:
            continue
        bbox = item.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            continue
        try:
            x1, y1, x2, y2 = (float(value) for value in bbox)
        except (TypeError, ValueError):
            continue
        box_width, box_height = max(0.0, x2 - x1), max(0.0, y2 - y1)
        area_ratio = box_width * box_height / (width * height)
        if box_width <= 0 or box_height <= 0 or area_ratio > max_area_ratio:
            continue
        regions.append({
            "id": str(item.get("id") or f"{key}-{index}"),
            "confidence": max(0.0, min(1.0, float(item.get("score", 0) or 0))),
            "bbox": (x1 / width, y1 / height, box_width / width, box_height / height),
        })
    return regions


def detector_boxes(
    detection: dict[str, Any],
    key: str,
    *,
    min_score: float = 0.2,
    max_area_ratio: float = MAX_PANEL_AREA_RATIO,
) -> list[tuple[float, float, float, float]]:
    return [tuple(region["bbox"]) for region in detector_regions(
        detection,
        key,
        min_score=min_score,
        max_area_ratio=max_area_ratio,
    )]


def single_page_role(detection: dict[str, Any], frames: list[PanelBox], image_bytes: bytes) -> str | None:
    """Resolve a lone page-sized frame before the ordinary panel area filter."""
    if len(frames) != 1 or box_area(frames[0]) < 0.70:
        return None
    texts = detector_boxes(detection, "texts", max_area_ratio=0.45)
    bodies = detector_boxes(detection, "bodies", max_area_ratio=1.0)
    faces = detector_boxes(detection, "faces", max_area_ratio=0.45)
    if bodies or faces:
        if box_area(frames[0]) <= MAX_PANEL_AREA_RATIO:
            return None
        # Separate text across the scene is stronger evidence than a single
        # centered heading. Ignore small marginal labels and duplicate crops.
        dialogue = [(x + w / 2, y + h / 2) for x, y, w, h in texts
                    if 0.06 < y + h / 2 < 0.94 and max(w, h) >= 0.05]
        if any(math.hypot(x - xx, y - yy) > 0.35 for x, y in dialogue for xx, yy in dialogue):
            return "borderless"
        if not texts and faces:
            prominent = detector_boxes(detection, "bodies", min_score=0.55, max_area_ratio=1.0)
            if any(h >= 0.55 and w * h >= 0.16 for _, _, w, h in prominent):
                return "borderless"
        return None
    if not texts or not all(
        w > h and 0.2 <= x + w / 2 <= 0.8 and 0.25 <= y + h / 2 <= 0.70 for x, y, w, h in texts
    ) or not any(w >= 0.25 for _, _, w, _ in texts):
        return None

    # A centered caption can occur in a landscape too. Check for ink away from
    # the title block and inside the printer's border before suppressing the frame.
    import io
    from PIL import Image

    x, y, w, h = frames[0]
    with Image.open(io.BytesIO(image_bytes)) as image:
        for top, bottom in ((0.07, 0.23), (0.79, 0.93)):
            strip = image.crop((int((x + 0.08 * w) * image.width), int((y + top * h) * image.height),
                                int((x + 0.92 * w) * image.width), int((y + bottom * h) * image.height)))
            ink = sum(strip.convert("L").histogram()[:160])
            if not strip.width or not strip.height or ink > 0.003 * strip.width * strip.height:
                return None
    return "title"


def detected_person_regions(detection: dict[str, Any]) -> list[dict[str, Any]]:
    """Fuse body detections with unmatched faces into editable person regions."""
    bodies = detector_regions(detection, "bodies", max_area_ratio=0.82)
    faces = detector_regions(detection, "faces", max_area_ratio=0.45)
    bodies = exclude_composite_body_regions(bodies, faces)
    regions: list[dict[str, Any]] = []
    kept_bodies: list[tuple[float, float, float, float]] = []
    for body_region in bodies:
        body = tuple(body_region["bbox"])
        if any(
            box_overlap_ratios(body, kept)[0] >= 0.58
            or box_overlap_ratios(body, kept)[1] >= 0.88
            for kept in kept_bodies
        ):
            continue
        kept_bodies.append(body)
        regions.append({
            "id": body_region["id"],
            "source": "body",
            "confidence": body_region["confidence"],
            "bbox": [round(value, 6) for value in body],
        })

    matched_faces = [[] for _ in kept_bodies]
    kept_faces: list[tuple[float, float, float, float]] = []
    for face_region in faces:
        face = tuple(face_region["bbox"])
        face_x, face_y, face_w, face_h = face
        face_center = (face_x + face_w / 2, face_y + face_h / 2)
        face_area = box_area(face)
        owners = [
            index for index, body in enumerate(kept_bodies)
            if (body[0] <= face_center[0] <= body[0] + body[2]
                and body[1] <= face_center[1] <= body[1] + body[3])
            # Browser JPEG detection sometimes shifts the body edge past the face centre.
            or (0 < face_area <= box_area(body) * 0.40
                and box_intersection_area(face, body) / face_area >= 0.30)
        ]
        if owners:
            for index in owners:
                matched_faces[index].append(face if len(owners) == 1 else None)
            continue
        if any(
            box_overlap_ratios(face, kept)[0] >= 0.58
            or box_overlap_ratios(face, kept)[1] >= 0.88
            for kept in kept_faces
        ):
            continue
        kept_faces.append(face)
        regions.append({
            "id": face_region["id"],
            "source": "face",
            "confidence": face_region["confidence"],
            "bbox": [round(value, 6) for value in face],
        })
    # Only an unambiguous one-to-one association supplies a face crop.
    for index, matches in enumerate(matched_faces):
        if len(matches) == 1 and matches[0] is not None:
            regions[index]["face_bbox"] = [round(value, 6) for value in matches[0]]
    return regions


def box_area(box: tuple[float, float, float, float]) -> float:
    return max(0.0, box[2]) * max(0.0, box[3])


def box_intersection_area(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> float:
    return max(
        0.0,
        min(left[0] + left[2], right[0] + right[2]) - max(left[0], right[0]),
    ) * max(
        0.0,
        min(left[1] + left[3], right[1] + right[3]) - max(left[1], right[1]),
    )


def face_ids_inside(
    box: tuple[float, float, float, float],
    faces: list[dict[str, Any]],
) -> set[str]:
    x, y, width, height = box
    matched: set[str] = set()
    for index, face_region in enumerate(faces):
        face_x, face_y, face_width, face_height = tuple(face_region["bbox"])
        center_x = face_x + face_width / 2
        center_y = face_y + face_height / 2
        if x <= center_x <= x + width and y <= center_y <= y + height:
            matched.add(str(face_region.get("id") or f"face-{index}"))
    return matched


def exclude_composite_body_regions(
    bodies: list[dict[str, Any]],
    faces: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Drop a giant body proposal when it demonstrably combines distinct people.

    Manga roughs often produce one coarse body box over a foreground character and
    a panel-local character, alongside smaller proposals for each person. Ordinary
    NMS keeps the coarse box first and erases both useful proposals. A coarse box is
    treated as composite only when two substantial contained body proposals explain
    most of it and each proposal owns a distinct detected face. The face requirement
    prevents upper/lower fragments of one person from being split into two figures.
    """
    kept: list[dict[str, Any]] = []
    for candidate in bodies:
        candidate_box = tuple(candidate["bbox"])
        candidate_area = box_area(candidate_box)
        candidate_confidence = float(candidate.get("confidence", 0) or 0)
        if candidate_area <= 0:
            continue
        contained: list[tuple[dict[str, Any], tuple[float, float, float, float], float, set[str]]] = []
        for other in bodies:
            if other is candidate:
                continue
            other_box = tuple(other["bbox"])
            other_area = box_area(other_box)
            if not candidate_area * 0.20 <= other_area <= candidate_area * 0.82:
                continue
            if float(other.get("confidence", 0) or 0) < candidate_confidence * 0.65:
                continue
            if box_overlap_ratios(candidate_box, other_box)[1] < 0.88:
                continue
            matched_faces = face_ids_inside(other_box, faces)
            if matched_faces:
                contained.append((other, other_box, other_area, matched_faces))

        composite = False
        for left_index, (_, left_box, left_area, left_faces) in enumerate(contained):
            for _, right_box, right_area, right_faces in contained[left_index + 1:]:
                iou, smaller_coverage = box_overlap_ratios(left_box, right_box)
                if iou > 0.45 or smaller_coverage > 0.72:
                    continue
                if not (left_faces - right_faces and right_faces - left_faces):
                    continue
                explained_area = left_area + right_area - box_intersection_area(left_box, right_box)
                if explained_area / candidate_area >= 0.55:
                    composite = True
                    break
            if composite:
                break
        if not composite:
            kept.append(candidate)
    return kept


def box_overlap_ratios(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> tuple[float, float]:
    """Return intersection-over-union and smaller-region coverage."""
    left_x, left_y, left_width, left_height = left
    right_x, right_y, right_width, right_height = right
    overlap_width = max(
        0.0,
        min(left_x + left_width, right_x + right_width) - max(left_x, right_x),
    )
    overlap_height = max(
        0.0,
        min(left_y + left_height, right_y + right_height) - max(left_y, right_y),
    )
    intersection = overlap_width * overlap_height
    left_area = left_width * left_height
    right_area = right_width * right_height
    union = left_area + right_area - intersection
    smaller = min(left_area, right_area)
    return (
        intersection / union if union > 0 else 0.0,
        intersection / smaller if smaller > 0 else 0.0,
    )
