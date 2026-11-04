"""Trace panel-row edges, split their shapes and recover supported missing rows."""

from __future__ import annotations

import math
from typing import Any

from nyamuru_detector_regions import LineSegment, PanelBox, box_intersection_area, detector_boxes


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
