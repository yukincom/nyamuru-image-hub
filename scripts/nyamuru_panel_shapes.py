"""Detect and order panel shapes from contours, detector boxes and traced edges."""

from __future__ import annotations

from typing import Any

from nyamuru_detector_regions import MAX_PANEL_AREA_RATIO, LineSegment, PanelBox, box_overlap_ratios
from nyamuru_panel_rows import _edge_coverage


def detect_panel_boxes(image_bytes: bytes) -> list[tuple[float, float, float, float]]:
    import cv2
    import numpy as np

    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError("画像を展開できませんでした")
    original_height, original_width = image.shape
    scale = min(1.0, 1600 / max(original_width, original_height))
    if scale < 1.0:
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    height, width = image.shape
    edges = cv2.Canny(image, 50, 150)
    kernel_size = max(3, round(min(width, height) * 0.004))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    page_area = width * height
    raw: list[tuple[int, int, int, int, float]] = []
    for contour in contours:
        x, y, box_width, box_height = cv2.boundingRect(contour)
        contour_area = cv2.contourArea(contour)
        box_area = box_width * box_height
        if box_area <= 0:
            continue
        extent = contour_area / box_area
        area_ratio = contour_area / page_area
        if (
            area_ratio >= 0.012
            and extent >= 0.72
            and box_width / width >= 0.14
            and box_height / height >= 0.05
            and box_area / page_area <= MAX_PANEL_AREA_RATIO
        ):
            raw.append((x, y, box_width, box_height, contour_area))

    # 大きなパネル枠から採用し、その内部にあるフキダシや画面内オブジェクトの輪郭を除く。
    selected: list[tuple[int, int, int, int, float]] = []
    for candidate in sorted(raw, key=lambda item: item[4], reverse=True):
        x, y, box_width, box_height, _ = candidate
        candidate_area = box_width * box_height
        contained = False
        for outer_x, outer_y, outer_w, outer_h, _ in selected:
            intersect_w = max(0, min(x + box_width, outer_x + outer_w) - max(x, outer_x))
            intersect_h = max(0, min(y + box_height, outer_y + outer_h) - max(y, outer_y))
            if intersect_w * intersect_h / candidate_area >= 0.82:
                contained = True
                break
        if not contained:
            selected.append(candidate)
        if len(selected) >= 8:
            break
    return [(x / width, y / height, box_width / width, box_height / height) for x, y, box_width, box_height, _ in selected]


def deduplicate_panel_boxes(
    boxes: list[tuple[float, float, float, float]],
    *, segments: list[LineSegment] | None = None,
) -> list[tuple[float, float, float, float]]:
    """Drop duplicate frames and a large frame that merely encloses split panels."""

    def area(box: tuple[float, float, float, float]) -> float:
        return max(0.0, box[2]) * max(0.0, box[3])

    def intersection(
        left: tuple[float, float, float, float],
        right: tuple[float, float, float, float],
    ) -> float:
        return max(0.0, min(left[0] + left[2], right[0] + right[2]) - max(left[0], right[0])) * max(
            0.0,
            min(left[1] + left[3], right[1] + right[3]) - max(left[1], right[1]),
        )

    kept: set[int] = set()
    duplicates: dict[int, list[PanelBox]] = {}
    for candidate_index in sorted(range(len(boxes)), key=lambda index: area(boxes[index])):
        candidate = boxes[candidate_index]
        candidate_area = area(candidate)
        duplicate = False
        for kept_index in kept:
            kept_box = boxes[kept_index]
            kept_area = area(kept_box)
            overlap = intersection(candidate, kept_box)
            smaller, larger = min(candidate_area, kept_area), max(candidate_area, kept_area)
            union = candidate_area + kept_area - overlap
            if (
                smaller > 0
                and larger > 0
                and smaller / larger >= 0.68
                and (overlap / smaller >= 0.9 or (union > 0 and overlap / union >= 0.72))
            ):
                if segments:
                    duplicates.setdefault(kept_index, []).append(candidate)
                duplicate = True
                break
        if duplicate:
            continue

        contained_parts: list[float] = []
        for kept_index in kept:
            kept_box = boxes[kept_index]
            kept_area = area(kept_box)
            center_x = kept_box[0] + kept_box[2] / 2
            center_y = kept_box[1] + kept_box[3] / 2
            center_inside = (
                candidate[0] <= center_x <= candidate[0] + candidate[2]
                and candidate[1] <= center_y <= candidate[1] + candidate[3]
            )
            overlap = intersection(candidate, kept_box)
            if kept_area > 0 and center_inside and overlap / kept_area >= 0.8:
                contained_parts.append(overlap)
        split_artifact = (
            candidate_area > 0
            and len(contained_parts) >= 2
            and sum(contained_parts) / candidate_area >= 0.72
        )
        if not split_artifact:
            kept.add(candidate_index)
    selected = [box for index, box in enumerate(boxes) if index in kept]
    if not duplicates or not segments:
        return selected
    horizontal = [(y1, x1, y2, x2) for x1, y1, x2, y2 in segments]
    replacements = {}
    for index, alternatives in duplicates.items():
        narrow = boxes[index]
        traced = [box for box in alternatives if _traced_row_extension(narrow, box, selected, segments, horizontal)]
        if len(traced) == 1:
            replacements[narrow] = traced[0]
    return [replacements.get(box, box) for box in selected]


def _shape_bounds(shape: dict[str, Any]) -> tuple[float, float, float, float]:
    points = shape.get("points") if isinstance(shape.get("points"), list) else []
    xs = [float(point[0]) for point in points if isinstance(point, list) and len(point) == 2]
    ys = [float(point[1]) for point in points if isinstance(point, list) and len(point) == 2]
    if not xs or not ys:
        return (0.0, 0.0, 0.0, 0.0)
    left, right = min(xs), max(xs)
    top, bottom = min(ys), max(ys)
    return (left, top, right - left, bottom - top)


def _box_iou(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> float:
    intersection = max(0.0, min(left[0] + left[2], right[0] + right[2]) - max(left[0], right[0])) * max(
        0.0,
        min(left[1] + left[3], right[1] + right[3]) - max(left[1], right[1]),
    )
    union = left[2] * left[3] + right[2] * right[3] - intersection
    return intersection / union if union > 0 else 0.0


def _order_shapes_by_detector_boxes(
    boxes: list[tuple[float, float, float, float]],
    shapes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Bind independently grouped shapes back to canonical detector reading order."""
    if len(shapes) != len(boxes):
        return []
    remaining = list(shapes)
    ordered: list[dict[str, Any]] = []
    for box in sort_panel_boxes_reading_order(boxes):
        box_center = (box[0] + box[2] / 2, box[1] + box[3] / 2)
        best_index = max(
            range(len(remaining)),
            key=lambda index: (
                _box_iou(box, _shape_bounds(remaining[index])),
                -(
                    (_shape_bounds(remaining[index])[0] + _shape_bounds(remaining[index])[2] / 2 - box_center[0]) ** 2
                    + (_shape_bounds(remaining[index])[1] + _shape_bounds(remaining[index])[3] / 2 - box_center[1]) ** 2
                ),
            ),
        )
        ordered.append(remaining.pop(best_index))
    return ordered


def _canonical_quad(points: list[list[float]]) -> list[list[float]]:
    if len(points) != 4:
        return points
    ordered_by_y = sorted(points, key=lambda point: (point[1], point[0]))
    top = sorted(ordered_by_y[:2], key=lambda point: point[0])
    bottom = sorted(ordered_by_y[2:], key=lambda point: point[0], reverse=True)
    return [*top, *bottom]


def _transpose_shape(shape: dict[str, Any]) -> dict[str, Any]:
    points = shape.get("points") if isinstance(shape.get("points"), list) else []
    transposed = [[round(float(point[1]), 6), round(float(point[0]), 6)] for point in points]
    return {"type": "polygon", "points": _canonical_quad(transposed)}


def _shape_diagonal_deviation(shape: dict[str, Any]) -> float:
    points = _canonical_quad(shape.get("points") if isinstance(shape.get("points"), list) else [])
    if len(points) != 4:
        return 0.0
    top_left, top_right, bottom_right, bottom_left = points
    return max(
        abs(top_left[1] - top_right[1]),
        abs(bottom_left[1] - bottom_right[1]),
        abs(top_left[0] - bottom_left[0]),
        abs(top_right[0] - bottom_right[0]),
    )


def detect_panel_segments(image_bytes: bytes) -> list[LineSegment]:
    import cv2
    import numpy as np

    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError("画像を展開できませんでした")
    height, width = image.shape
    detector = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    detected = detector.detect(image)[0]
    return [] if detected is None else [
        (float(x1) / width, float(y1) / height, float(x2) / width, float(y2) / height)
        for [[x1, y1, x2, y2]] in detected
    ]


def _traced_row_extension(
    narrow: PanelBox, wide: PanelBox, selected: list[PanelBox],
    vertical: list[LineSegment], horizontal: list[LineSegment],
) -> bool:
    """Prefer a wider duplicate only when the drawing supports its extra strip."""
    x, y, w, h = narrow
    left, top, width, height = wide
    right, bottom = left + width, top + height
    band = 0.008
    if max(abs(top - y), abs(bottom - y - h)) > band:
        return False
    if abs(left - x) <= band and right - (x + w) >= 0.04:
        inner, outer = x + w, right
    elif abs(right - x - w) <= band and x - left >= 0.04:
        inner, outer = x, left
    else:
        return False
    start, end = sorted((inner, outer))
    extension = (start, top, end - start, height)
    # A wide enclosing box must not absorb a separate panel in the same row.
    if any(other != narrow and box_overlap_ratios(extension, other)[1] > 0.15 for other in selected):
        return False
    return (
        _edge_coverage(vertical, inner, y, y + h, band) < 0.25
        and _edge_coverage(vertical, outer, top, bottom, band) >= 0.60
        and any(_edge_coverage(horizontal, edge, start, end, band) >= 0.70 for edge in (top, bottom))
    )


def sort_panel_boxes_reading_order(
    boxes: list[tuple[float, float, float, float]],
) -> list[tuple[float, float, float, float]]:
    """上段から下段、同じ上段では右から左の順にコマを並べる。"""
    rows: list[dict[str, Any]] = []
    for box in sorted(boxes, key=lambda item: (item[1], -(item[0] + item[2] / 2))):
        _, top, _, height = box
        matching_rows = [
            row for row in rows
            if abs(top - row["top"]) <= max(0.035, min(height, row["min_height"]) * 0.35)
        ]
        if matching_rows:
            row = min(matching_rows, key=lambda item: abs(top - item["top"]))
            row["boxes"].append(box)
            row["top"] = min(row["top"], top)
            row["min_height"] = min(row["min_height"], height)
        else:
            rows.append({"top": top, "min_height": height, "boxes": [box]})

    ordered: list[tuple[float, float, float, float]] = []
    for row in sorted(rows, key=lambda item: item["top"]):
        ordered.extend(sorted(row["boxes"], key=lambda item: -(item[0] + item[2] / 2)))
    return ordered
