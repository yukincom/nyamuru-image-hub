"""Panel layout geometry helpers for the local vision bridge.

OpenCV / NumPy are imported lazily inside functions that need them.
"""

from __future__ import annotations

import math
from typing import Any

MAX_PANEL_AREA_RATIO = 0.82


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


def _group_panel_rows(
    boxes: list[tuple[float, float, float, float]],
) -> list[dict[str, Any]]:
    """Group only detector rectangles whose top and bottom edges describe one row.

    A tall panel beside two stacked panels overlaps both of them vertically, but it
    must not bridge those two panels into a single row.  RT-DETR already gives us
    the page topology, so row grouping may refine a shared divider but must never
    replace that topology based on overlap alone.
    """
    rows: list[dict[str, Any]] = []
    for box in sorted(boxes, key=lambda item: (item[1], item[0])):
        x, y, width, height = box
        center_y = y + height / 2
        best: dict[str, Any] | None = None
        best_distance = float("inf")
        for row in rows:
            aligned_boxes = []
            for existing in row["boxes"]:
                _, existing_y, _, existing_height = existing
                tolerance = max(0.035, min(height, existing_height) * 0.18)
                if (
                    abs(y - existing_y) <= tolerance
                    and abs((y + height) - (existing_y + existing_height)) <= tolerance
                ):
                    aligned_boxes.append(existing)
            if not aligned_boxes:
                continue
            center_distance = abs(center_y - row["center_y"])
            if center_distance < best_distance:
                best = row
                best_distance = center_distance
        if best is None:
            rows.append({
                "boxes": [box],
                "left": x,
                "right": x + width,
                "top": y,
                "bottom": y + height,
                "center_y": center_y,
                "min_height": height,
            })
            continue
        best["boxes"].append(box)
        best["left"] = min(best["left"], x)
        best["right"] = max(best["right"], x + width)
        best["top"] = min(best["top"], y)
        best["bottom"] = max(best["bottom"], y + height)
        best["min_height"] = min(best["min_height"], height)
        best["center_y"] = sum(item[1] + item[3] / 2 for item in best["boxes"]) / len(best["boxes"])
    return sorted(rows, key=lambda row: row["top"])


def _line_fit(points: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Fit x = slope * y + intercept and return its RMS x residual."""
    mean_y = sum(y for _, y in points) / len(points)
    mean_x = sum(x for x, _ in points) / len(points)
    denominator = sum((y - mean_y) ** 2 for _, y in points)
    slope = sum((y - mean_y) * (x - mean_x) for x, y in points) / max(denominator, 1e-9)
    intercept = mean_x - slope * mean_y
    residual = math.sqrt(sum((x - (slope * y + intercept)) ** 2 for x, y in points) / len(points))
    return slope, intercept, residual


def _covered_length(intervals: list[tuple[float, float]]) -> float:
    merged: list[list[float]] = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return sum(end - start for start, end in merged)


def _maximum_uncovered_gap(
    intervals: list[tuple[float, float]],
    start: float,
    end: float,
) -> float:
    merged: list[list[float]] = []
    for interval_start, interval_end in sorted(intervals):
        interval_start = max(start, interval_start)
        interval_end = min(end, interval_end)
        if interval_end <= interval_start:
            continue
        if not merged or interval_start > merged[-1][1]:
            merged.append([interval_start, interval_end])
        else:
            merged[-1][1] = max(merged[-1][1], interval_end)
    if not merged:
        return end - start
    gaps = [merged[0][0] - start, end - merged[-1][1]]
    gaps.extend(merged[index + 1][0] - merged[index][1] for index in range(len(merged) - 1))
    return max(gaps)


def _row_dividers(
    row: dict[str, Any],
    segments: list[tuple[float, float, float, float]],
) -> list[tuple[float, float, float]]:
    left, right, top, bottom = row["left"], row["right"], row["top"], row["bottom"]
    row_width, row_height = right - left, bottom - top
    middle_y = (top + bottom) / 2
    candidates: list[dict[str, Any]] = []
    for x1, y1, x2, y2 in segments:
        delta_x, delta_y = x2 - x1, y2 - y1
        length = math.hypot(delta_x, delta_y)
        if length < max(0.012, min(row_width, row_height) * 0.055):
            continue
        if abs(delta_y) < max(0.008, length * 0.36):
            continue
        segment_mid_y = (y1 + y2) / 2
        if segment_mid_y < top - row_height * 0.06 or segment_mid_y > bottom + row_height * 0.06:
            continue
        slope = delta_x / delta_y
        if abs(slope) > 1.9:
            continue
        intercept = x1 - slope * y1
        x_at_middle = slope * middle_y + intercept
        if not left + row_width * 0.055 <= x_at_middle <= right - row_width * 0.055:
            continue
        matching = None
        for cluster in candidates:
            if (
                abs(slope - cluster["slope"]) <= 0.38
                and abs(x_at_middle - cluster["x_at_middle"]) <= max(0.025, row_width * 0.045)
            ):
                matching = cluster
                break
        if matching is None:
            candidates.append({
                "segments": [(x1, y1, x2, y2)],
                "slope": slope,
                "x_at_middle": x_at_middle,
            })
            continue
        matching["segments"].append((x1, y1, x2, y2))
        points = [(x, y) for segment in matching["segments"] for x, y in ((segment[0], segment[1]), (segment[2], segment[3]))]
        fitted_slope, fitted_intercept, _ = _line_fit(points)
        matching["slope"] = fitted_slope
        matching["x_at_middle"] = fitted_slope * middle_y + fitted_intercept

    dividers: list[tuple[float, float, float]] = []
    for cluster in candidates:
        points = [(x, y) for segment in cluster["segments"] for x, y in ((segment[0], segment[1]), (segment[2], segment[3]))]
        clipped_intervals = [
            (max(top, min(y1, y2)), min(bottom, max(y1, y2)))
            for _, y1, _, y2 in cluster["segments"]
        ]
        minimum_y = max(top, min(y for _, y in points))
        maximum_y = min(bottom, max(y for _, y in points))
        span = maximum_y - minimum_y
        coverage = _covered_length(clipped_intervals)
        maximum_gap = _maximum_uncovered_gap(clipped_intervals, top, bottom)
        slope, intercept, residual = _line_fit(points)
        if span < row_height * 0.58 or coverage < row_height * 0.14:
            continue
        if maximum_gap > row_height * 0.38:
            continue
        if minimum_y > top + row_height * 0.32 or maximum_y < bottom - row_height * 0.32:
            continue
        if residual > max(0.014, row_width * 0.025):
            continue
        x_top = slope * top + intercept
        x_bottom = slope * bottom + intercept
        if not (
            left + row_width * 0.045 <= x_top <= right - row_width * 0.045
            and left + row_width * 0.045 <= x_bottom <= right - row_width * 0.045
        ):
            continue
        score = span / row_height + coverage / row_height - residual / max(row_width, 1e-9)
        dividers.append((x_top, x_bottom, score))

    deduplicated: list[tuple[float, float, float]] = []
    for divider in sorted(dividers, key=lambda item: item[2], reverse=True):
        divider_middle = (divider[0] + divider[1]) / 2
        if any(abs(divider_middle - (kept[0] + kept[1]) / 2) < row_width * 0.08 for kept in deduplicated):
            continue
        deduplicated.append(divider)
    return deduplicated


def _infer_row_panel_shapes_from_segments(
    boxes: list[tuple[float, float, float, float]],
    segments: list[tuple[float, float, float, float]],
) -> list[dict[str, Any]]:
    """Recover vertical-ish dividers inside rows of detector rectangles."""
    shapes: list[dict[str, Any]] = []
    for row in _group_panel_rows(boxes):
        left, right, top, bottom = row["left"], row["right"], row["top"], row["bottom"]
        row_width = right - left
        dividers = _row_dividers(row, segments)
        expected_dividers = max(0, len(row["boxes"]) - 1)
        if expected_dividers:
            boxes_left_to_right = sorted(row["boxes"], key=lambda item: item[0] + item[2] / 2)
            expected_positions = [
                (
                    boxes_left_to_right[index][0] + boxes_left_to_right[index][2]
                    + boxes_left_to_right[index + 1][0]
                ) / 2
                for index in range(len(boxes_left_to_right) - 1)
            ]
            selected: list[tuple[float, float, float]] = []
            unused = list(dividers)
            for divider_index, expected in enumerate(expected_positions):
                left_box = boxes_left_to_right[divider_index]
                right_box = boxes_left_to_right[divider_index + 1]
                # RT-DETRの外接矩形が重なる場合、斜め境界の両端は通常
                # right側コマの左端とleft側コマの右端に近い。中央位置だけで
                # 候補を選ぶと、人物やフキダシの線へ途中から逸れた線でも
                # 採用できてしまうため、両端の一致も必須にする。
                direct_endpoints = (right_box[0], left_box[0] + left_box[2])
                reverse_endpoints = (direct_endpoints[1], direct_endpoints[0])

                def endpoint_mismatch(item: tuple[float, float, float]) -> float:
                    direct_error = max(
                        abs(item[0] - direct_endpoints[0]),
                        abs(item[1] - direct_endpoints[1]),
                    )
                    reverse_error = max(
                        abs(item[0] - reverse_endpoints[0]),
                        abs(item[1] - reverse_endpoints[1]),
                    )
                    return min(direct_error, reverse_error)

                chosen = min(
                    unused,
                    key=lambda item: (
                        endpoint_mismatch(item),
                        abs((item[0] + item[1]) / 2 - expected),
                    ),
                ) if unused else None
                endpoint_tolerance = max(0.025, row_width * 0.07)
                if chosen is not None and endpoint_mismatch(chosen) <= endpoint_tolerance:
                    unused.remove(chosen)
                    selected.append(chosen)
                    continue

                # 枠線追跡が人物線などへ逸れたときは、誤った線を返すより
                # RT-DETR矩形の重なりから復元する。候補の傾き方向だけは使い、
                # 端点は検出矩形へ戻す。
                if chosen is not None and chosen[1] < chosen[0]:
                    selected.append((*reverse_endpoints, 0.0))
                    continue
                overlap = left_box[0] + left_box[2] - right_box[0]
                if overlap > row_width * 0.05:
                    selected.append((*direct_endpoints, 0.0))
                else:
                    boundary = (left_box[0] + left_box[2] + right_box[0]) / 2
                    selected.append((boundary, boundary, 0.0))
            dividers = selected
        else:
            # A lone RT-DETR frame stays one panel. Rough character silhouettes,
            # limbs, and balloon edges can all look like long diagonal dividers.
            # Only recover a divider when RT-DETR independently found panels on
            # both sides of it.
            dividers = []

        ordered_dividers = sorted(dividers, key=lambda item: (item[0] + item[1]) / 2)
        boundaries = [(left, left), *[(item[0], item[1]) for item in ordered_dividers], (right, right)]
        row_shapes: list[dict[str, Any]] = []
        # A narrow inset panel can occupy only a small part of the row/column span.
        # Scale the minimum thickness to the smallest detector box as well as the
        # whole group, otherwise a real short panel (金城05の中段) disappears.
        minimum_panel_span = min(
            row_width * 0.075,
            min((box[2] for box in row["boxes"]), default=row_width) * 0.08,
        )
        for boundary_index in range(len(boundaries) - 1):
            left_top, left_bottom = boundaries[boundary_index]
            right_top, right_bottom = boundaries[boundary_index + 1]
            if min(right_top - left_top, right_bottom - left_bottom) < minimum_panel_span:
                continue
            row_shapes.append({
                "type": "polygon",
                "points": [
                    [round(left_top, 6), round(top, 6)],
                    [round(right_top, 6), round(top, 6)],
                    [round(right_bottom, 6), round(bottom, 6)],
                    [round(left_bottom, 6), round(bottom, 6)],
                ],
            })
        shapes.extend(reversed(row_shapes))
    return shapes


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


def infer_panel_shapes_from_segments(
    boxes: list[tuple[float, float, float, float]],
    segments: list[tuple[float, float, float, float]],
) -> list[dict[str, Any]]:
    """Recover vertical and horizontal diagonal dividers in detector reading order."""
    if not boxes:
        return []
    fallback = [
        {
            "type": "polygon",
            "points": [[x, y], [x + width, y], [x + width, y + height], [x, y + height]],
        }
        for x, y, width, height in sort_panel_boxes_reading_order(boxes)
    ]
    row_shapes = _order_shapes_by_detector_boxes(
        boxes,
        _infer_row_panel_shapes_from_segments(boxes, segments),
    ) or fallback

    transposed_boxes = [(y, x, height, width) for x, y, width, height in boxes]
    transposed_segments = [(y1, x1, y2, x2) for x1, y1, x2, y2 in segments]
    column_shapes = _order_shapes_by_detector_boxes(
        boxes,
        [
            _transpose_shape(shape)
            for shape in _infer_row_panel_shapes_from_segments(transposed_boxes, transposed_segments)
        ],
    ) or fallback

    # A horizontal-divider candidate owns top/bottom slopes, NOT the shared
    # column envelope. Keep each detector's own left/right extent (scan01).
    # Do not import the other candidate's vertical divider either: on separated
    # comic strips it may trace artwork in the gutter instead of a frame edge.
    result: list[dict[str, Any]] = []
    for row_shape, column_shape, original in zip(row_shapes, column_shapes, fallback):
        if _shape_diagonal_deviation(column_shape) <= _shape_diagonal_deviation(row_shape) + 1e-6:
            result.append(row_shape)
            continue
        column = column_shape["points"]
        left, right = original["points"][0][0], original["points"][1][0]

        def point_on_edge(a: list[float], b: list[float], x: float) -> list[float] | None:
            if abs(b[0] - a[0]) < 1e-9:
                return None
            y = a[1] + (x - a[0]) * (b[1] - a[1]) / (b[0] - a[0])
            return [round(x, 6), round(y, 6)]

        points = [
            point_on_edge(column[0], column[1], left),
            point_on_edge(column[0], column[1], right),
            point_on_edge(column[3], column[2], right),
            point_on_edge(column[3], column[2], left),
        ]
        if any(point is None or any(not math.isfinite(v) or v < 0 or v > 1 for v in point) for point in points):
            result.append(original)
            continue
        # Reject an inverted/degenerate intersection, rather than fabricating a
        # panel by clamping crossed edges. Detector bounds remain the fallback.
        turns = [
            (points[(i + 1) % 4][0] - points[i][0]) * (points[(i + 2) % 4][1] - points[(i + 1) % 4][1])
            - (points[(i + 1) % 4][1] - points[i][1]) * (points[(i + 2) % 4][0] - points[(i + 1) % 4][0])
            for i in range(4)
        ]
        result.append({"type": "polygon", "points": points} if min(turns) > 1e-9 else original)
    return result


PanelBox = tuple[float, float, float, float]
LineSegment = tuple[float, float, float, float]


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


def detect_panel_shapes(image_bytes: bytes, boxes: list[PanelBox]) -> list[dict[str, Any]]:
    return infer_panel_shapes_from_segments(boxes, detect_panel_segments(image_bytes)) if boxes else []


def _edge_coverage(segments: list[LineSegment], position: float, start: float, end: float, band: float) -> float:
    """Fraction of a vertical edge traced by near-parallel ink, without counting a stroke twice."""
    intervals = []
    for x1, y1, x2, y2 in segments:
        if max(abs(x1 - position), abs(x2 - position)) > band:
            continue
        span = abs(y2 - y1)
        if span >= max(0.012, (end - start) * 0.04) and abs(x2 - x1) <= span * 0.22:
            intervals.append((max(start, min(y1, y2)), min(end, max(y1, y2))))
    return _covered_length(intervals) / (end - start)


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


def recover_missing_panel_rows(
    boxes: list[PanelBox], segments: list[LineSegment], detection: dict[str, Any],
) -> list[PanelBox]:
    """Bridge a gap only when two separate traced borders enclose a populated, otherwise unclaimed row."""
    rows = _group_panel_rows(boxes)
    if len(rows) < 2:
        return boxes
    added = []
    transposed = [(y1, x1, y2, x2) for x1, y1, x2, y2 in segments]
    people = detector_boxes(detection, "faces") + detector_boxes(detection, "bodies")
    for upper, lower in zip(rows, rows[1:]):
        if len(upper["boxes"]) != 1 or len(lower["boxes"]) != 1:
            continue
        left, right = max(upper["left"], lower["left"]), min(upper["right"], lower["right"])
        width = right - left
        top_end, bottom_start = upper["bottom"], lower["top"]
        if (width <= 0 or bottom_start - top_end < 0.07
                or max(abs(upper[k] - lower[k]) for k in ("left", "right")) > width * 0.06):
            continue
        gap = (left, top_end, width, bottom_start - top_end)
        if any(box_intersection_area(box, gap) > 0 for box in boxes
               if box not in (upper["boxes"][0], lower["boxes"][0])):
            continue
        if not any(left < x + w / 2 < right and top_end < y + h / 2 < bottom_start for x, y, w, h in people):
            continue
        column = {"top": left, "bottom": right, "left": upper["top"], "right": lower["bottom"]}
        dividers = _row_dividers(column, transposed)
        # Each adjoining detector rectangle ends at the *outermost* point of its sloping edge.
        upper_lines = [(a, b) for a, b, score in dividers if score >= 1.45 and abs(max(a, b) - top_end) <= 0.03]
        lower_lines = [(a, b) for a, b, score in dividers if score >= 1.45 and abs(min(a, b) - bottom_start) <= 0.03]
        if len(upper_lines) != 1 or len(lower_lines) != 1:
            continue
        top, bottom = upper_lines[0], lower_lines[0]
        if min(bottom[i] - top[i] for i in (0, 1)) < 0.07:
            continue
        if min(_edge_coverage(segments, x, top[i], bottom[i], 0.015) for i, x in enumerate((left, right))) < 0.65:
            continue
        added.append((left, min(top), width, max(bottom) - min(top)))
    return boxes + added


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


def _is_framed_row_part(box: PanelBox, kept: list[PanelBox], segments: list[LineSegment]) -> bool:
    """Treat a frame/body conflict as a panel only when it completes a split row and has its own outline."""
    x, y, w, h = box
    for parent in kept:
        _, py, pw, ph = parent
        if not (0.2 * pw < w < 0.8 * pw and box_intersection_area(box, parent) >= 0.90 * w * h):
            continue
        for sibling in kept:
            sx, sy, sw, sh = sibling
            if sibling == parent or box_intersection_area(sibling, parent) < 0.90 * sw * sh:
                continue
            if max(abs(y - py), abs(y + h - py - ph), abs(sy - py), abs(sy + sh - py - ph)) > 0.12 * ph:
                continue
            overlap = box_intersection_area(box, sibling)
            if overlap > 0.16 * min(w * h, sw * sh):
                continue
            covered = box_intersection_area(box, parent) + box_intersection_area(sibling, parent) - overlap
            if covered < 0.85 * pw * ph:
                continue
            transposed = [(y1, x1, y2, x2) for x1, y1, x2, y2 in segments]
            # Four visible sides distinguish the framed close-up from a figure or balloon on top of it.
            return all(
                _edge_coverage(lines, edge, start, end, min(0.03, 0.075 * across)) >= 0.70
                for lines, start, end, across, edges in (
                    (segments, y, y + h, w, (x, x + w)),
                    (transposed, x, x + w, h, (y, y + h)),
                )
                for edge in edges
            )
    return False


def exclude_non_panel_regions(
    boxes: list[PanelBox],
    detection: dict[str, Any],
    *,
    segments: list[LineSegment] | None = None,
) -> tuple[list[tuple[float, float, float, float]], dict[str, int]]:
    """Reject weak panel candidates that substantially duplicate another class.

    Panels normally contain these objects, so ordinary containment must remain
    valid. RT-DETR can also emit the same large region as both a frame and a
    text/body/face. In that ambiguous case a high-confidence frame must survive;
    otherwise a real panel disappears together with the ownership target for
    its bubbles and figures.

    OpenCV fallback boxes have no class confidence, so they retain the original
    overlap-only rejection. For RT-DETR a stronger competing class can exclude a weak
    frame, but a traced panel that completes a row survives a body conflict.
    """
    frame_regions = detector_regions(detection, "frames")
    exclusions = {
        "texts": (detector_regions(detection, "texts", max_area_ratio=0.45), 0.38),
        "faces": (detector_regions(detection, "faces", max_area_ratio=0.45), 0.58),
        "bodies": (detector_regions(detection, "bodies", max_area_ratio=0.82), 0.78),
    }

    def matching_frame_confidence(box: tuple[float, float, float, float]) -> float | None:
        # detector_boxes() is derived from detector_regions(), so RT-DETR boxes
        # match exactly. Do not transfer confidence to a merely nearby OpenCV box.
        for region in frame_regions:
            region_box = tuple(region["bbox"])
            if all(abs(left - right) <= 1e-9 for left, right in zip(box, region_box)):
                return float(region["confidence"])
        return None

    kept: list[PanelBox] = []
    body_conflicts: list[PanelBox] = []
    excluded = {"texts": 0, "faces": 0, "bodies": 0}
    for box in boxes:
        frame_confidence = matching_frame_confidence(box)
        rejected_by: str | None = None
        for key, (regions, minimum_iou) in exclusions.items():
            for region in regions:
                iou, smaller_coverage = box_overlap_ratios(box, tuple(region["bbox"]))
                if iou < minimum_iou or smaller_coverage < 0.82:
                    continue
                competing_confidence = float(region["confidence"])
                decisive_rtdetr_conflict = (
                    frame_confidence is not None
                    and frame_confidence < 0.70
                    and competing_confidence >= 0.70
                    and competing_confidence - frame_confidence >= 0.15
                )
                if frame_confidence is None or decisive_rtdetr_conflict:
                    rejected_by = key
                    break
            if rejected_by:
                break
        if rejected_by:
            excluded[rejected_by] += 1
            if rejected_by == "bodies" and frame_confidence is not None:
                body_conflicts.append(box)
        else:
            kept.append(box)
    if body_conflicts and segments:
        recovered = [box for box in body_conflicts if _is_framed_row_part(box, kept, segments)]
        kept.extend(recovered)
        excluded["bodies"] -= len(recovered)
    return kept, excluded


def exclude_paired_title_header_boxes(
    boxes: list[tuple[float, float, float, float]],
) -> tuple[list[PanelBox], list[PanelBox]]:
    """Remove a paired row of thin title boxes above comic-strip columns.

    A thin horizontal comic panel is valid on its own, so geometry alone must
    not remove it. Treat boxes as title headers only when at least two share the
    same upper row and each is immediately followed by a substantially taller,
    horizontally aligned panel. This covers side-by-side four-panel strips such
    as one03 without depending on a particular title or panel number.
    """

    def horizontal_coverage(
        left: tuple[float, float, float, float],
        right: tuple[float, float, float, float],
    ) -> float:
        overlap = max(0.0, min(left[0] + left[2], right[0] + right[2]) - max(left[0], right[0]))
        smaller_width = min(left[2], right[2])
        return overlap / smaller_width if smaller_width > 0 else 0.0

    candidates: list[tuple[float, float, float, float]] = []
    for box in boxes:
        _, y, width, height = box
        if height <= 0 or y > 0.18 or height > 0.055 or width < 0.15 or width / height < 4.0:
            continue
        bottom = y + height
        has_aligned_panel_below = any(
            other != box
            and other[1] >= bottom - 0.005
            and other[1] - bottom <= 0.04
            and other[3] >= height * 2.2
            and horizontal_coverage(box, other) >= 0.78
            for other in boxes
        )
        if has_aligned_panel_below:
            candidates.append(box)

    paired: set[tuple[float, float, float, float]] = set()
    for box in candidates:
        same_row_peers = [
            other for other in candidates
            if other != box
            and abs(other[1] - box[1]) <= 0.015
            and abs(other[3] - box[3]) <= 0.015
            and horizontal_coverage(box, other) < 0.25
        ]
        if same_row_peers:
            paired.add(box)
            paired.update(same_row_peers)

    return [box for box in boxes if box not in paired], sorted(paired, reverse=True)


def strip_reading_order(boxes: list[PanelBox], headers: list[PanelBox]) -> list[int]:
    """Reorder two titled four-panel strips; keep the given order on ambiguous pages."""
    return _four_panel_strip_order(boxes, headers) or list(range(len(boxes)))


def _four_panel_strip_order(boxes: list[PanelBox], headers: list[PanelBox]) -> list[int] | None:
    if len(headers) != 2 or len(boxes) != 8:
        return None

    strips: list[list[int]] = []
    for x, y, width, height in sorted(headers, reverse=True):  # right-hand title first
        # Both sides of each panel should track its own title, so a spanning
        # panel or a split within a strip cannot silently change reading order.
        column = sorted((i for i, (bx, _, bw, _) in enumerate(boxes)
                         if abs(bx - x) <= width * 0.2 and abs(bx + bw - x - width) <= width * 0.2),
                        key=lambda i: boxes[i][1])
        if len(column) != 4 or not -0.005 <= boxes[column[0]][1] - (y + height) <= 0.04:
            return None
        for upper, lower in zip(column, column[1:]):
            gap = boxes[lower][1] - (boxes[upper][1] + boxes[upper][3])
            if not -0.01 <= gap <= 0.5 * min(boxes[upper][3], boxes[lower][3]):
                return None
        strips.append(column)
    right, left = strips
    if max(boxes[i][0] + boxes[i][2] for i in left) > min(boxes[i][0] for i in right):
        return None
    return right + left


def text_in_header(text: PanelBox, header: PanelBox) -> bool:
    area = box_area(text)
    return area > 0 and box_intersection_area(text, header) >= 0.90 * area


def printed_four_panel_strips(
    boxes: list[PanelBox], detection: dict[str, Any], segments: list[LineSegment],
) -> tuple[list[PanelBox], list[PanelBox]] | None:
    """Recover taller titles only when the lettering and both printed strips corroborate them."""
    if len(boxes) != 10 or not segments:
        return None
    top_first = sorted(boxes, key=lambda b: b[1])
    headers = sorted(top_first[:2], reverse=True)
    body = top_first[2:]
    order = _four_panel_strip_order(body, headers)
    if order is None or abs(headers[0][1] - headers[1][1]) > 0.015:
        return None
    ordered = [body[i] for i in order]
    texts = detector_boxes(detection, "texts", max_area_ratio=0.45)
    people = detector_boxes(detection, "faces") + detector_boxes(detection, "bodies")
    for header, column in zip(headers, (ordered[:4], ordered[4:])):
        if header[3] > 0.5 * min(b[3] for b in column):
            return None
        if not any(t[2] >= 0.45 * header[2] and t[2] > t[3] and text_in_header(t, header) for t in texts):
            return None
        # A short panel containing a character can be the first story beat.
        if any(box_intersection_area(p, header) >= 0.5 * box_area(p) for p in people):
            return None
    # A detected box is a trustworthy rectangle here only if ink traces all
    # four sides. Interior diagonal strokes are not dividers between strips.
    transposed = [(y1, x1, y2, x2) for x1, y1, x2, y2 in segments]
    for x, y, w, h in boxes:
        if min(_edge_coverage(segments, x, y, y + h, 0.006),
               _edge_coverage(segments, x + w, y, y + h, 0.006),
               _edge_coverage(transposed, y, x, x + w, 0.006),
               _edge_coverage(transposed, y + h, x, x + w, 0.006)) < 0.80:
            return None
    return ordered, headers
