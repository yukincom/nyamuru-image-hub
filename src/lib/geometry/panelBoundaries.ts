import type { PanelShape, BBox, Panel } from '../../types';
import { type PanelGutterSettings, DEFAULT_PANEL_GUTTERS, roundMm, clamp, panelShapePoints, PANEL_EDGE_ALIGNMENT_TOLERANCE_MM, type CanvasSize, DEFAULT_CANVAS, innerFrameBounds, type PanelEdgeReference, PANEL_EDGE_LINK_DISTANCE_MM } from './canvasBounds.ts';

/** テンプレートや既存ページの実座標から、近接する縦横の代表間隔（中央値）を求める。 */
export function inferPanelGutters(
  shapes: readonly PanelShape[],
  fallback: PanelGutterSettings = DEFAULT_PANEL_GUTTERS,
): PanelGutterSettings {
  const bounds = shapes.map((shape): BBox => {
    if (shape.type === 'rect') return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    const xs = shape.points.map(([x]) => x), ys = shape.points.map(([, y]) => y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  });
  const rowGaps: number[] = [], columnGaps: number[] = [];
  for (let firstIndex = 0; firstIndex < bounds.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < bounds.length; secondIndex += 1) {
      const first = bounds[firstIndex], second = bounds[secondIndex];
      const horizontalOverlap = Math.max(0, Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x));
      const verticalOverlap = Math.max(0, Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y));
      const normalizedHorizontalDistance = Math.abs((first.x + first.w / 2) - (second.x + second.w / 2)) / Math.max(1, (first.w + second.w) / 2);
      const normalizedVerticalDistance = Math.abs((first.y + first.h / 2) - (second.y + second.h / 2)) / Math.max(1, (first.h + second.h) / 2);
      if (normalizedVerticalDistance >= normalizedHorizontalDistance && horizontalOverlap >= Math.min(first.w, second.w) * 0.25) {
        const [upper, lower] = first.y + first.h / 2 <= second.y + second.h / 2 ? [first, second] : [second, first];
        const gap = lower.y - (upper.y + upper.h);
        if (gap > 0 && gap <= 12) rowGaps.push(gap);
      } else if (verticalOverlap >= Math.min(first.h, second.h) * 0.25) {
        const [left, right] = first.x + first.w / 2 <= second.x + second.w / 2 ? [first, second] : [second, first];
        const gap = right.x - (left.x + left.w);
        if (gap > 0 && gap <= 12) columnGaps.push(gap);
      }
    }
  }
  const median = (values: number[], fallbackValue: number) => {
    if (!values.length) return roundMm(clamp(fallbackValue, 0, 20));
    const sorted = values.sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return roundMm(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
  };
  return {
    rowGapMm: median(rowGaps, fallback.rowGapMm),
    columnGapMm: median(columnGaps, fallback.columnGapMm),
  };
}

export function edgePoints(panel: Panel, edgeIndex: number): [[number, number], [number, number]] | null {
  const points = panelShapePoints(panel);
  if (edgeIndex < 0 || edgeIndex >= points.length) return null;
  return [points[edgeIndex], points[(edgeIndex + 1) % points.length]];
}

function pointLineDistance(point: [number, number], start: [number, number], end: [number, number]): number {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  return Math.abs(dx * (start[1] - point[1]) - (start[0] - point[0]) * dy) / length;
}

interface PointBoundaryLocks {
  x?: number;
  y?: number;
}

/** 内枠または宣言済みタチキリの線上にある頂点を、その線へ拘束する。 */
export function pointBoundaryLocks(
  panel: Panel,
  point: [number, number],
  tolerance = PANEL_EDGE_ALIGNMENT_TOLERANCE_MM,
  canvas: CanvasSize = DEFAULT_CANVAS,
): PointBoundaryLocks {
  const inner = innerFrameBounds(canvas);
  const near = (value: number, target: number) => Math.abs(value - target) <= tolerance;
  const locks: PointBoundaryLocks = {};
  if (near(point[0], inner.x)) locks.x = inner.x;
  else if (near(point[0], inner.x + inner.w)) locks.x = inner.x + inner.w;
  else if (panel.bleed?.includes('left') && near(point[0], 0)) locks.x = 0;
  else if (panel.bleed?.includes('right') && near(point[0], canvas.w)) locks.x = canvas.w;
  if (near(point[1], inner.y)) locks.y = inner.y;
  else if (near(point[1], inner.y + inner.h)) locks.y = inner.y + inner.h;
  else if (panel.bleed?.includes('top') && near(point[1], 0)) locks.y = 0;
  else if (panel.bleed?.includes('bottom') && near(point[1], canvas.h)) locks.y = canvas.h;
  return locks;
}

export interface PointLegalBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 既に内枠外にある点は現位置まで許容するが、それ以上外側へは動かさない。 */
export function pointLegalBounds(panel: Panel, original: [number, number], canvas: CanvasSize = DEFAULT_CANVAS): PointLegalBounds {
  const inner = innerFrameBounds(canvas);
  const minX = panel.bleed?.includes('left') ? 0 : inner.x;
  const maxX = panel.bleed?.includes('right') ? canvas.w : inner.x + inner.w;
  const minY = panel.bleed?.includes('top') ? 0 : inner.y;
  const maxY = panel.bleed?.includes('bottom') ? canvas.h : inner.y + inner.h;
  return {
    minX: Math.min(original[0], minX),
    maxX: Math.max(original[0], maxX),
    minY: Math.min(original[1], minY),
    maxY: Math.max(original[1], maxY),
  };
}

export function pointWithinLegalBounds(point: [number, number], bounds: PointLegalBounds, tolerance = 1e-6): boolean {
  return point[0] >= bounds.minX - tolerance && point[0] <= bounds.maxX + tolerance
    && point[1] >= bounds.minY - tolerance && point[1] <= bounds.maxY + tolerance;
}

/** 斜め移動が境界へ達した時、成分別clampではなく移動線分上の最後の合法点で止める。 */
function lastLegalPointOnSegment(
  original: [number, number],
  target: [number, number],
  bounds: PointLegalBounds,
): [number, number] {
  const deltaX = target[0] - original[0], deltaY = target[1] - original[1];
  let ratio = 1;
  if (deltaX > 0) ratio = Math.min(ratio, (bounds.maxX - original[0]) / deltaX);
  else if (deltaX < 0) ratio = Math.min(ratio, (bounds.minX - original[0]) / deltaX);
  if (deltaY > 0) ratio = Math.min(ratio, (bounds.maxY - original[1]) / deltaY);
  else if (deltaY < 0) ratio = Math.min(ratio, (bounds.minY - original[1]) / deltaY);
  ratio = clamp(ratio, 0, 1);
  return [
    roundMm(original[0] + deltaX * ratio),
    roundMm(original[1] + deltaY * ratio),
  ];
}

export function constrainedJunctionPoint(
  panel: Panel,
  original: [number, number],
  x: number,
  y: number,
  canvas: CanvasSize = DEFAULT_CANVAS,
): [number, number] {
  const locks = pointBoundaryLocks(panel, original, undefined, canvas);
  const bounds = pointLegalBounds(panel, original, canvas);
  if (locks.x !== undefined && locks.y !== undefined) return [locks.x, locks.y];
  if (locks.x !== undefined) {
    return [locks.x, roundMm(clamp(y, bounds.minY, bounds.maxY))];
  }
  if (locks.y !== undefined) {
    return [roundMm(clamp(x, bounds.minX, bounds.maxX)), locks.y];
  }
  return lastLegalPointOnSegment(original, [x, y], bounds);
}

export function edgeIsLockedBoundary(panel: Panel, edgeIndex: number, canvas: CanvasSize = DEFAULT_CANVAS): boolean {
  const edge = edgePoints(panel, edgeIndex);
  if (!edge) return false;
  const first = pointBoundaryLocks(panel, edge[0], undefined, canvas), second = pointBoundaryLocks(panel, edge[1], undefined, canvas);
  return (first.x !== undefined && first.x === second.x)
    || (first.y !== undefined && first.y === second.y);
}

/**
 * 選択辺と同じ境界グループに属する平行辺を探す。
 * 投影が重なる隣接辺だけでなく、同一直線上で横に分割された辺も連結する。
 */
function findRelatedPanelEdges(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  maxDistance: number,
  continuationOffsetTolerance: number,
): PanelEdgeReference[] {
  const selectedPanel = panels[panelIndex];
  const selectedEdge = selectedPanel && edgePoints(selectedPanel, edgeIndex);
  if (!selectedEdge) return [];
  const [start, end] = selectedEdge;
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!length) return [];
  const unitX = dx / length, unitY = dy / length;
  const linked: Array<PanelEdgeReference & { distance: number }> = [];

  panels.forEach((panel, candidatePanelIndex) => {
    if (candidatePanelIndex === panelIndex) return;
    const points = panelShapePoints(panel);
    points.forEach((candidateStart, candidateEdgeIndex) => {
      const candidateEnd = points[(candidateEdgeIndex + 1) % points.length];
      const cdx = candidateEnd[0] - candidateStart[0], cdy = candidateEnd[1] - candidateStart[1];
      const candidateLength = Math.hypot(cdx, cdy);
      if (!candidateLength) return;
      const parallelError = Math.abs(dx * cdy - dy * cdx) / (length * candidateLength);
      if (parallelError > 0.08) return;
      const distance = (pointLineDistance(candidateStart, start, end) + pointLineDistance(candidateEnd, start, end)) / 2;
      if (distance > maxDistance) return;
      const projectionA = (candidateStart[0] - start[0]) * unitX + (candidateStart[1] - start[1]) * unitY;
      const projectionB = (candidateEnd[0] - start[0]) * unitX + (candidateEnd[1] - start[1]) * unitY;
      const projectionMin = Math.min(projectionA, projectionB);
      const projectionMax = Math.max(projectionA, projectionB);
      const overlap = Math.max(0, Math.min(length, projectionMax) - Math.max(0, projectionMin));
      const projectionGap = projectionMax < 0
        ? -projectionMax
        : projectionMin > length
          ? projectionMin - length
          : 0;
      const sharesProjection = overlap >= Math.min(8, Math.min(length, candidateLength) * 0.25);
      const continuesBoundary = projectionGap <= maxDistance && distance <= continuationOffsetTolerance;
      if (!sharesProjection && !continuesBoundary) return;
      linked.push({ panelIndex: candidatePanelIndex, edgeIndex: candidateEdgeIndex, distance });
    });
  });
  return linked.sort((left, right) => left.distance - right.distance).map(({ panelIndex: pi, edgeIndex: ei }) => ({ panelIndex: pi, edgeIndex: ei }));
}

export function findLinkedPanelEdges(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  maxDistance = PANEL_EDGE_LINK_DISTANCE_MM,
): PanelEdgeReference[] {
  return findRelatedPanelEdges(
    panels,
    panelIndex,
    edgeIndex,
    maxDistance,
    PANEL_EDGE_ALIGNMENT_TOLERANCE_MM,
  );
}
