"""Panel layout geometry for the local vision bridge, including frame filters and strip order."""

from __future__ import annotations

import math
from typing import Any

from nyamuru_detector_regions import (
    MAX_PANEL_AREA_RATIO,
    LineSegment,
    PanelBox,
    box_area,
    box_intersection_area,
    box_overlap_ratios,
    detected_person_regions,
    detector_boxes,
    detector_regions,
    exclude_composite_body_regions,
    face_ids_inside,
    single_page_role,
)
from nyamuru_panel_rows import (
    _covered_length,
    _edge_coverage,
    _group_panel_rows,
    _infer_row_panel_shapes_from_segments,
    _line_fit,
    _maximum_uncovered_gap,
    _row_dividers,
    recover_missing_panel_rows,
)
from nyamuru_panel_shapes import (
    _box_iou,
    _canonical_quad,
    _order_shapes_by_detector_boxes,
    _shape_bounds,
    _shape_diagonal_deviation,
    _traced_row_extension,
    _transpose_shape,
    deduplicate_panel_boxes,
    detect_panel_boxes,
    detect_panel_segments,
    sort_panel_boxes_reading_order,
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


def detect_panel_shapes(image_bytes: bytes, boxes: list[PanelBox]) -> list[dict[str, Any]]:
    return infer_panel_shapes_from_segments(boxes, detect_panel_segments(image_bytes)) if boxes else []


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
