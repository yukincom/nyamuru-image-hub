import type { Anchor, BBox, CanvasElementType, Panel, PanelShape } from '../types';

export type ResizeHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export interface InteractionGeometry {
  mode: ResizeHandle;
  startClientX: number;
  startClientY: number;
  startBox: BBox;
  bounds: BBox;
  paperRect: { width: number; height: number };
}

export const MIN_SIZE_MM = 6;
export const INNER_FRAME_BOUNDS: Readonly<BBox> = { x: 10, y: 10, w: 190, h: 277 };
export const PANEL_SNAP_THRESHOLD_MM = 4;
export const PANEL_EDGE_LINK_DISTANCE_MM = 8;
export const PANEL_EDGE_ALIGNMENT_TOLERANCE_MM = 0.15;
const PANEL_VERTEX_CONTINUATION_OFFSET_MM = PANEL_SNAP_THRESHOLD_MM;
export const PANEL_CORNER_LINK_DISTANCE_MM = 9;

export interface PanelGutterSettings {
  /** 上下に並ぶコマ同士の間隔。 */
  rowGapMm: number;
  /** 左右に並ぶコマ同士の間隔。 */
  columnGapMm: number;
}

export const DEFAULT_PANEL_GUTTERS: Readonly<PanelGutterSettings> = {
  rowGapMm: 5,
  columnGapMm: 3,
};

export interface PanelEdgeReference {
  panelIndex: number;
  edgeIndex: number;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function roundMm(value: number) {
  return Math.round(value * 10) / 10;
}

/** ドラッグ開始点から変化量の大きい軸だけを残し、水平または垂直移動へ制限する。 */
export function constrainDragDeltaToAxis(deltaX: number, deltaY: number): { x: number; y: number } {
  return Math.abs(deltaX) >= Math.abs(deltaY)
    ? { x: deltaX, y: 0 }
    : { x: 0, y: deltaY };
}

export type DragAxis = 'x' | 'y';

export interface ShiftAxisDragState {
  axis?: DragAxis;
  /** 一度ドラッグ原点へ戻り、別軸へ出直せる状態。 */
  switchArmed?: boolean;
}

const SHIFT_AXIS_FREE_RETURN_MM = 1;
const SHIFT_AXIS_SWITCH_MM = 6;
const SHIFT_AXIS_DOMINANCE_MM = 1;

/**
 * Shiftドラッグの軸を開始地点基準で固定する。
 * 途中で大小関係が変わっただけでは軸を切り替えず、一度原点へ戻ってから
 * 別軸へ明確に引いた場合だけ切り替える。
 */
export function resolveShiftAxisDrag(
  deltaX: number,
  deltaY: number,
  state: ShiftAxisDragState,
  snapToOrigin: boolean,
): { x: number; y: number; state: ShiftAxisDragState; snappedToOrigin: boolean } {
  const originThreshold = snapToOrigin ? PANEL_SNAP_THRESHOLD_MM : SHIFT_AXIS_FREE_RETURN_MM;
  const distance = Math.hypot(deltaX, deltaY);
  let axis = state.axis;
  let switchArmed = state.switchArmed === true;

  if (!axis) {
    if (snapToOrigin && distance <= originThreshold) {
      return { x: 0, y: 0, state: {}, snappedToOrigin: true };
    }
    if (distance <= 0.1) return { x: 0, y: 0, state: {}, snappedToOrigin: false };
    const initial = constrainDragDeltaToAxis(deltaX, deltaY);
    axis = initial.y === 0 ? 'x' : 'y';
  }

  if (distance <= originThreshold) {
    return {
      x: snapToOrigin ? 0 : axis === 'x' ? deltaX : 0,
      y: snapToOrigin ? 0 : axis === 'y' ? deltaY : 0,
      state: { axis, switchArmed: true },
      snappedToOrigin: snapToOrigin,
    };
  }

  if (switchArmed) {
    const currentMagnitude = axis === 'x' ? Math.abs(deltaX) : Math.abs(deltaY);
    const otherMagnitude = axis === 'x' ? Math.abs(deltaY) : Math.abs(deltaX);
    if (otherMagnitude > currentMagnitude + SHIFT_AXIS_DOMINANCE_MM) {
      if (otherMagnitude < SHIFT_AXIS_SWITCH_MM) {
        return { x: 0, y: 0, state: { axis, switchArmed: true }, snappedToOrigin: snapToOrigin };
      }
      axis = axis === 'x' ? 'y' : 'x';
    }
    switchArmed = false;
  }

  return {
    x: axis === 'x' ? deltaX : 0,
    y: axis === 'y' ? deltaY : 0,
    state: { axis, switchArmed },
    snappedToOrigin: false,
  };
}

export function panelBounds(panel: Panel): BBox {
  if (panel.shape.type === 'rect') return panel.shape;
  const xs = panel.shape.points.map(([x]) => x);
  const ys = panel.shape.points.map(([, y]) => y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** 紙面座標の頂点列。矩形も左上から時計回りの4頂点として扱う。 */
export function panelShapePoints(panel: Panel): [number, number][] {
  if (panel.shape.type === 'polygon') return panel.shape.points.map(([x, y]) => [x, y]);
  const { x, y, w, h } = panel.shape;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

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

function edgePoints(panel: Panel, edgeIndex: number): [[number, number], [number, number]] | null {
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
function pointBoundaryLocks(
  panel: Panel,
  point: [number, number],
  tolerance = PANEL_EDGE_ALIGNMENT_TOLERANCE_MM,
): PointBoundaryLocks {
  const near = (value: number, target: number) => Math.abs(value - target) <= tolerance;
  const locks: PointBoundaryLocks = {};
  if (near(point[0], INNER_FRAME_BOUNDS.x)) locks.x = INNER_FRAME_BOUNDS.x;
  else if (near(point[0], INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w)) locks.x = INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w;
  else if (panel.bleed?.includes('left') && near(point[0], 0)) locks.x = 0;
  else if (panel.bleed?.includes('right') && near(point[0], 210)) locks.x = 210;
  if (near(point[1], INNER_FRAME_BOUNDS.y)) locks.y = INNER_FRAME_BOUNDS.y;
  else if (near(point[1], INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h)) locks.y = INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h;
  else if (panel.bleed?.includes('top') && near(point[1], 0)) locks.y = 0;
  else if (panel.bleed?.includes('bottom') && near(point[1], 297)) locks.y = 297;
  return locks;
}

function edgeIsLockedBoundary(panel: Panel, edgeIndex: number): boolean {
  const edge = edgePoints(panel, edgeIndex);
  if (!edge) return false;
  const first = pointBoundaryLocks(panel, edge[0]), second = pointBoundaryLocks(panel, edge[1]);
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

/**
 * 頂点変形では、交差する溝をまたいだ延長辺に数mmのズレがあっても同じ境界として扱う。
 * 辺ドラッグの「一度吸着してから連動する」判定とは分け、既存の吸着操作を維持する。
 */
function findVertexLinkedPanelEdges(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
): PanelEdgeReference[] {
  return findRelatedPanelEdges(
    panels,
    panelIndex,
    edgeIndex,
    PANEL_EDGE_LINK_DISTANCE_MM,
    PANEL_VERTEX_CONTINUATION_OFFSET_MM,
  );
}

interface PanelVertexReference {
  panelIndex: number;
  vertexIndex: number;
  edgeDistance: number;
  cornerDistance: number;
}

/** 選択頂点の近くで角だけが接する、平行な隣辺の頂点を探す。 */
function findCornerLinkedPanelVertices(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  selectedPoint: [number, number],
  maxEdgeDistance = PANEL_EDGE_LINK_DISTANCE_MM,
  maxCornerDistance = PANEL_CORNER_LINK_DISTANCE_MM,
): PanelVertexReference[] {
  const selectedPanel = panels[panelIndex];
  const selectedEdge = selectedPanel && edgePoints(selectedPanel, edgeIndex);
  if (!selectedEdge) return [];
  const [start, end] = selectedEdge;
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!length) return [];
  const references: PanelVertexReference[] = [];

  panels.forEach((panel, candidatePanelIndex) => {
    if (candidatePanelIndex === panelIndex) return;
    const points = panelShapePoints(panel);
    points.forEach((candidateStart, candidateEdgeIndex) => {
      const candidateEndIndex = (candidateEdgeIndex + 1) % points.length;
      const candidateEnd = points[candidateEndIndex];
      const cdx = candidateEnd[0] - candidateStart[0], cdy = candidateEnd[1] - candidateStart[1];
      const candidateLength = Math.hypot(cdx, cdy);
      if (!candidateLength) return;
      const parallelError = Math.abs(dx * cdy - dy * cdx) / (length * candidateLength);
      if (parallelError > 0.08) return;
      const edgeDistance = (pointLineDistance(candidateStart, start, end) + pointLineDistance(candidateEnd, start, end)) / 2;
      if (edgeDistance > maxEdgeDistance) return;
      const candidates = [
        { vertexIndex: candidateEdgeIndex, distance: Math.hypot(candidateStart[0] - selectedPoint[0], candidateStart[1] - selectedPoint[1]) },
        { vertexIndex: candidateEndIndex, distance: Math.hypot(candidateEnd[0] - selectedPoint[0], candidateEnd[1] - selectedPoint[1]) },
      ];
      const nearest = candidates.sort((left, right) => left.distance - right.distance)[0];
      if (nearest.distance <= maxCornerDistance) references.push({
        panelIndex: candidatePanelIndex,
        vertexIndex: nearest.vertexIndex,
        edgeDistance,
        cornerDistance: nearest.distance,
      });
    });
  });
  const unique = new Map<string, PanelVertexReference>();
  references.forEach((reference) => {
    const key = `${reference.panelIndex}:${reference.vertexIndex}`;
    const current = unique.get(key);
    if (!current
      || reference.edgeDistance < current.edgeDistance
      || (reference.edgeDistance === current.edgeDistance && reference.cornerDistance < current.cornerDistance)) {
      unique.set(key, reference);
    }
  });
  return [...unique.values()]
    .sort((left, right) => left.edgeDistance - right.edgeDistance || left.cornerDistance - right.cornerDistance);
}

/** 対向する平行辺との距離が作品の縦横コマ間隔へ近づいたとき、選択辺を正確な間隔へ吸着する。 */
export function snapPanelEdgeDeltaToGutter(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  deltaX: number,
  deltaY: number,
  gutters: PanelGutterSettings,
  threshold = PANEL_SNAP_THRESHOLD_MM,
  axis?: 'x' | 'y',
): { x: number; y: number; snapped: boolean; target?: PanelEdgeReference } {
  const selectedPanel = panels[panelIndex];
  const selectedEdge = selectedPanel && edgePoints(selectedPanel, edgeIndex);
  if (!selectedEdge) return { x: roundMm(deltaX), y: roundMm(deltaY), snapped: false };
  const [start, end] = selectedEdge;
  const vectorX = end[0] - start[0], vectorY = end[1] - start[1];
  const length = Math.hypot(vectorX, vectorY);
  if (!length) return { x: roundMm(deltaX), y: roundMm(deltaY), snapped: false };
  const unitX = vectorX / length, unitY = vectorY / length;
  const normalX = -unitY, normalY = unitX;
  const targetGap = Math.abs(vectorX) >= Math.abs(vectorY)
    ? clamp(gutters.rowGapMm, 0, 20)
    : clamp(gutters.columnGapMm, 0, 20);
  const movedStart: [number, number] = [start[0] + deltaX, start[1] + deltaY];
  const candidates: Array<{ error: number; correctionX: number; correctionY: number; target: PanelEdgeReference }> = [];

  panels.forEach((panel, candidatePanelIndex) => {
    if (candidatePanelIndex === panelIndex) return;
    const points = panelShapePoints(panel);
    points.forEach((candidateStart, candidateEdgeIndex) => {
      const candidateEnd = points[(candidateEdgeIndex + 1) % points.length];
      const candidateVectorX = candidateEnd[0] - candidateStart[0], candidateVectorY = candidateEnd[1] - candidateStart[1];
      const candidateLength = Math.hypot(candidateVectorX, candidateVectorY);
      if (!candidateLength) return;
      const parallelError = Math.abs(vectorX * candidateVectorY - vectorY * candidateVectorX) / (length * candidateLength);
      if (parallelError > 0.08) return;
      const projectionA = (candidateStart[0] - movedStart[0]) * unitX + (candidateStart[1] - movedStart[1]) * unitY;
      const projectionB = (candidateEnd[0] - movedStart[0]) * unitX + (candidateEnd[1] - movedStart[1]) * unitY;
      const overlap = Math.max(0, Math.min(length, Math.max(projectionA, projectionB)) - Math.max(0, Math.min(projectionA, projectionB)));
      if (overlap < Math.min(8, Math.min(length, candidateLength) * 0.25)) return;
      const signedDistance = (
        (candidateStart[0] - movedStart[0]) * normalX + (candidateStart[1] - movedStart[1]) * normalY
          + (candidateEnd[0] - movedStart[0]) * normalX + (candidateEnd[1] - movedStart[1]) * normalY
      ) / 2;
      if (targetGap > 0 && Math.abs(signedDistance) <= PANEL_EDGE_ALIGNMENT_TOLERANCE_MM) return;
      const error = Math.abs(Math.abs(signedDistance) - targetGap);
      if (error > threshold) return;
      const desiredDistance = (signedDistance < 0 ? -1 : 1) * targetGap;
      const normalCorrection = signedDistance - desiredDistance;
      let correctionX = normalX * normalCorrection, correctionY = normalY * normalCorrection;
      if (axis === 'x') {
        if (Math.abs(normalX) <= 1e-6) return;
        correctionX = normalCorrection / normalX;
        correctionY = 0;
      } else if (axis === 'y') {
        if (Math.abs(normalY) <= 1e-6) return;
        correctionX = 0;
        correctionY = normalCorrection / normalY;
      }
      candidates.push({ error, correctionX, correctionY, target: { panelIndex: candidatePanelIndex, edgeIndex: candidateEdgeIndex } });
    });
  });

  const best = candidates.sort((left, right) => left.error - right.error || Math.hypot(left.correctionX, left.correctionY) - Math.hypot(right.correctionX, right.correctionY))[0];
  if (!best) return { x: roundMm(deltaX), y: roundMm(deltaY), snapped: false };
  return {
    x: roundMm(deltaX + best.correctionX),
    y: roundMm(deltaY + best.correctionY),
    snapped: true,
    target: best.target,
  };
}

/**
 * 頂点を、別コマの辺から作品設定の上下・左右間隔だけ離れた位置へ吸着する。
 * Shift固定中は許可された1軸だけを補正する。
 */
export function snapPanelVertexPointToGutter(
  panels: Panel[],
  panelIndex: number,
  vertexIndex: number,
  x: number,
  y: number,
  gutters: PanelGutterSettings,
  threshold = PANEL_SNAP_THRESHOLD_MM,
  axis?: DragAxis,
): { x: number; y: number; snapped: boolean } {
  const selectedPanel = panels[panelIndex];
  const selectedPoints = selectedPanel && panelShapePoints(selectedPanel);
  if (!selectedPoints || vertexIndex < 0 || vertexIndex >= selectedPoints.length) {
    return { x: roundMm(x), y: roundMm(y), snapped: false };
  }
  const xCandidates: Array<{ value: number; error: number }> = [];
  const yCandidates: Array<{ value: number; error: number }> = [];
  const rowGap = clamp(gutters.rowGapMm, 0, 20);
  const columnGap = clamp(gutters.columnGapMm, 0, 20);

  panels.forEach((panel, candidatePanelIndex) => {
    if (candidatePanelIndex === panelIndex) return;
    const points = panelShapePoints(panel);
    points.forEach((start, edgeIndex) => {
      const end = points[(edgeIndex + 1) % points.length];
      const dx = end[0] - start[0], dy = end[1] - start[1];
      const length = Math.hypot(dx, dy);
      if (!length) return;
      const parameterSlack = threshold / length;

      if (axis !== 'y' && Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) > 1e-6) {
        const parameter = (y - start[1]) / dy;
        if (parameter >= -parameterSlack && parameter <= 1 + parameterSlack) {
          const lineX = start[0] + dx * parameter;
          for (const direction of [-1, 1]) {
            const targetX = lineX + direction * columnGap;
            const error = Math.abs(targetX - x);
            if (error <= threshold && (columnGap === 0 || !pointInPanel(panel, targetX, y))) {
              xCandidates.push({ value: targetX, error });
            }
          }
        }
      }

      if (axis !== 'x' && Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 1e-6) {
        const parameter = (x - start[0]) / dx;
        if (parameter >= -parameterSlack && parameter <= 1 + parameterSlack) {
          const lineY = start[1] + dy * parameter;
          for (const direction of [-1, 1]) {
            const targetY = lineY + direction * rowGap;
            const error = Math.abs(targetY - y);
            if (error <= threshold && (rowGap === 0 || !pointInPanel(panel, x, targetY))) {
              yCandidates.push({ value: targetY, error });
            }
          }
        }
      }
    });
  });

  const snappedX = xCandidates.sort((left, right) => left.error - right.error)[0];
  const snappedY = yCandidates.sort((left, right) => left.error - right.error)[0];
  return {
    x: roundMm(snappedX?.value ?? x),
    y: roundMm(snappedY?.value ?? y),
    snapped: Boolean(snappedX || snappedY),
  };
}

/**
 * 平行な延長辺が少しズレているとき、隣辺を固定したまま選択辺を同一直線へ吸着する。
 * すでに同じ境界グループへ入っている辺と、投影が重なる対向辺（コマ間の空き）は対象外。
 */
export function snapPanelEdgeDeltaToNeighbor(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  deltaX: number,
  deltaY: number,
  threshold = PANEL_SNAP_THRESHOLD_MM,
  maxAlongGap = PANEL_EDGE_LINK_DISTANCE_MM,
): { x: number; y: number; snapped: boolean; target?: PanelEdgeReference } {
  const selectedPanel = panels[panelIndex];
  const selectedEdge = selectedPanel && edgePoints(selectedPanel, edgeIndex);
  if (!selectedEdge) return { x: roundMm(deltaX), y: roundMm(deltaY), snapped: false };
  const [start, end] = selectedEdge;
  const vectorX = end[0] - start[0], vectorY = end[1] - start[1];
  const length = Math.hypot(vectorX, vectorY);
  if (!length) return { x: roundMm(deltaX), y: roundMm(deltaY), snapped: false };
  const unitX = vectorX / length, unitY = vectorY / length;
  const normalX = -unitY, normalY = unitX;
  const movedStart: [number, number] = [start[0] + deltaX, start[1] + deltaY];
  const linked = new Set(findLinkedPanelEdges(panels, panelIndex, edgeIndex).map((reference) => `${reference.panelIndex}:${reference.edgeIndex}`));
  const candidates: { correction: number; target: PanelEdgeReference }[] = [];

  panels.forEach((panel, candidatePanelIndex) => {
    if (candidatePanelIndex === panelIndex) return;
    const points = panelShapePoints(panel);
    points.forEach((candidateStart, candidateEdgeIndex) => {
      if (linked.has(`${candidatePanelIndex}:${candidateEdgeIndex}`)) return;
      const candidateEnd = points[(candidateEdgeIndex + 1) % points.length];
      const candidateVectorX = candidateEnd[0] - candidateStart[0], candidateVectorY = candidateEnd[1] - candidateStart[1];
      const candidateLength = Math.hypot(candidateVectorX, candidateVectorY);
      if (!candidateLength) return;
      const parallelError = Math.abs(vectorX * candidateVectorY - vectorY * candidateVectorX) / (length * candidateLength);
      if (parallelError > 0.08) return;
      const projectionA = (candidateStart[0] - movedStart[0]) * unitX + (candidateStart[1] - movedStart[1]) * unitY;
      const projectionB = (candidateEnd[0] - movedStart[0]) * unitX + (candidateEnd[1] - movedStart[1]) * unitY;
      const projectionMin = Math.min(projectionA, projectionB);
      const projectionMax = Math.max(projectionA, projectionB);
      const overlap = Math.max(0, Math.min(length, projectionMax) - Math.max(0, projectionMin));
      const alongGap = projectionMax < 0
        ? -projectionMax
        : projectionMin > length
          ? projectionMin - length
          : 0;
      if (alongGap > maxAlongGap || overlap > Math.min(2, Math.min(length, candidateLength) * 0.08)) return;
      const signedDistance = (
        (candidateStart[0] - movedStart[0]) * normalX + (candidateStart[1] - movedStart[1]) * normalY
          + (candidateEnd[0] - movedStart[0]) * normalX + (candidateEnd[1] - movedStart[1]) * normalY
      ) / 2;
      if (Math.abs(signedDistance) > threshold) return;
      candidates.push({ correction: signedDistance, target: { panelIndex: candidatePanelIndex, edgeIndex: candidateEdgeIndex } });
    });
  });

  const best = candidates.sort((left, right) => Math.abs(left.correction) - Math.abs(right.correction))[0];
  if (!best) return { x: roundMm(deltaX), y: roundMm(deltaY), snapped: false };
  return {
    x: roundMm(deltaX + normalX * best.correction),
    y: roundMm(deltaY + normalY * best.correction),
    snapped: true,
    target: best.target,
  };
}

// アンカー種別が指すコマ内の位置（mm）。端寄せは枠から少し内側に取る
export function anchorPoint(bounds: BBox, anchor: Anchor): { x: number; y: number } {
  const insetX = Math.min(6, bounds.w * .15);
  const insetY = Math.min(6, bounds.h * .15);
  const x = anchor.includes('left') ? bounds.x + insetX : anchor.includes('right') ? bounds.x + bounds.w - insetX : bounds.x + bounds.w / 2;
  const y = anchor.startsWith('top') ? bounds.y + insetY : anchor.startsWith('bottom') ? bounds.y + bounds.h - insetY : bounds.y + bounds.h / 2;
  return { x, y };
}

export const ANCHORS: Anchor[] = ['center', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

export function nearestAnchor(bounds: BBox, box: BBox): Anchor {
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  let best: Anchor = 'center';
  let bestDistance = Infinity;
  for (const anchor of ANCHORS) {
    const point = anchorPoint(bounds, anchor);
    const distance = (point.x - centerX) ** 2 + (point.y - centerY) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = anchor; }
  }
  return best;
}

export function fallbackBox(panel: Panel, type: CanvasElementType, index: number): BBox {
  const bounds = panelBounds(panel);
  // 画面内文字（screen_text）は横組みが既定なので横長bboxを既定にする
  if (type === 'screen_text') {
    const width = Math.min(46, Math.max(MIN_SIZE_MM, bounds.w * .4));
    const height = Math.min(18, Math.max(MIN_SIZE_MM, bounds.h * .2));
    return {
      x: clamp(bounds.x + (bounds.w - width) / 2, bounds.x, bounds.x + bounds.w - width),
      y: clamp(bounds.y + bounds.h / 2 - height / 2 + index * 4, bounds.y, bounds.y + bounds.h - height),
      w: roundMm(width),
      h: roundMm(height),
    };
  }
  let width = Math.min(type === 'figure' ? 42 : 40, Math.max(MIN_SIZE_MM, bounds.w * .35));
  const height = Math.min(type === 'figure' ? 55 : 50, Math.max(MIN_SIZE_MM, bounds.h * .45));
  // 縦書きフキダシは縦長bbox（通常サイズの目安 w40×h50）を保つ
  if (type === 'bubble') width = Math.max(MIN_SIZE_MM, Math.min(width, height * .8));
  const inset = 4 + index * 3;
  return {
    x: clamp(bounds.x + (type === 'bubble' ? bounds.w - width - inset : inset), bounds.x, bounds.x + bounds.w - width),
    y: clamp(bounds.y + inset, bounds.y, bounds.y + bounds.h - height),
    w: width,
    h: height,
  };
}

export function pointInPanel(panel: Panel, x: number, y: number): boolean {
  if (panel.shape.type === 'rect') {
    const { shape } = panel;
    return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
  }
  // レイキャスティング法による多角形の内外判定
  const { points } = panel.shape;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function panelHasElementAt(panel: Panel, x: number, y: number): boolean {
  const boxes: BBox[] = [
    ...(panel.figures ?? []).map((figure, index) => figure.bbox ?? fallbackBox(panel, 'figure', index)),
    ...panel.bubbles.map((bubble, index) => bubble.bbox ?? fallbackBox(panel, 'bubble', index)),
    ...(panel.screen_text ?? []).map((screenText, index) => screenText.bbox ?? fallbackBox(panel, 'screen_text', index)),
  ];
  return boxes.some((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
}

// パネルが重なった位置のクリック先を決める。重ね順は配列順で固定（先頭のパネル1が最奥）。
// 最前面のパネルのクリック位置にエレメント（人物・フキダシ・画面内文字）があればそのパネルを選び、
// なければクリックは空白部分を貫通する:
// - 選択中のパネルが重なりに含まれるときは一段ずつ奥へ送る（最奥まで行ったら最前面へ戻る）
// - 含まれないときはエレメントがある最前面のパネル、どこにもなければ最奥のパネルを選ぶ
export function resolveOverlapClick(panels: Panel[], clickedIndex: number, activeIndex: number, x: number, y: number): number {
  const stack = panels.map((_, index) => index).filter((index) => pointInPanel(panels[index], x, y)).reverse();
  if (stack.length < 2 || !stack.includes(clickedIndex)) return clickedIndex;
  if (panelHasElementAt(panels[stack[0]], x, y)) return stack[0];
  const activePosition = stack.indexOf(activeIndex);
  if (activePosition !== -1) return stack[(activePosition + 1) % stack.length];
  return stack.find((index) => panelHasElementAt(panels[index], x, y)) ?? stack[stack.length - 1];
}

export function resizedBox(interaction: InteractionGeometry, clientX: number, clientY: number, minSize = MIN_SIZE_MM): BBox {
  const { startBox, bounds, paperRect, mode } = interaction;
  const dx = (clientX - interaction.startClientX) * (210 / paperRect.width);
  const dy = (clientY - interaction.startClientY) * (297 / paperRect.height);
  const right = startBox.x + startBox.w;
  const bottom = startBox.y + startBox.h;
  let x = startBox.x, y = startBox.y, w = startBox.w, h = startBox.h;

  if (mode === 'move') {
    x = clamp(startBox.x + dx, bounds.x, bounds.x + bounds.w - startBox.w);
    y = clamp(startBox.y + dy, bounds.y, bounds.y + bounds.h - startBox.h);
  } else {
    if (mode.includes('w')) { x = clamp(startBox.x + dx, bounds.x, right - minSize); w = right - x; }
    if (mode.includes('e')) { w = clamp(startBox.w + dx, minSize, bounds.x + bounds.w - startBox.x); }
    if (mode.includes('n')) { y = clamp(startBox.y + dy, bounds.y, bottom - minSize); h = bottom - y; }
    if (mode.includes('s')) { h = clamp(startBox.h + dy, minSize, bounds.y + bounds.h - startBox.y); }
  }
  return { x: roundMm(x), y: roundMm(y), w: roundMm(w), h: roundMm(h) };
}

export function clampedPanelDelta(bounds: BBox, deltaX: number, deltaY: number): { x: number; y: number } {
  return {
    x: roundMm(clamp(deltaX, -bounds.x, 210 - (bounds.x + bounds.w))),
    y: roundMm(clamp(deltaY, -bounds.y, 297 - (bounds.y + bounds.h))),
  };
}

function snapCoordinate(value: number, targets: number[], threshold = PANEL_SNAP_THRESHOLD_MM): number {
  const nearest = targets.reduce((best, target) => (
    Math.abs(target - value) < Math.abs(best - value) ? target : best
  ), targets[0]);
  return Math.abs(nearest - value) <= threshold ? nearest : value;
}

/** コマ移動量を紙面内へ収め、外接矩形の四辺を内枠へ吸着させる。 */
export function snapPanelDeltaToInnerFrame(
  bounds: BBox,
  deltaX: number,
  deltaY: number,
  threshold = PANEL_SNAP_THRESHOLD_MM,
): { x: number; y: number } {
  const clamped = clampedPanelDelta(bounds, deltaX, deltaY);
  let nextX = bounds.x + clamped.x;
  let nextY = bounds.y + clamped.y;
  const innerRight = INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w;
  const innerBottom = INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h;

  const leftSnap = INNER_FRAME_BOUNDS.x - nextX;
  const rightSnap = innerRight - (nextX + bounds.w);
  if (Math.min(Math.abs(leftSnap), Math.abs(rightSnap)) <= threshold) {
    nextX += Math.abs(leftSnap) <= Math.abs(rightSnap) ? leftSnap : rightSnap;
  }

  const topSnap = INNER_FRAME_BOUNDS.y - nextY;
  const bottomSnap = innerBottom - (nextY + bounds.h);
  if (Math.min(Math.abs(topSnap), Math.abs(bottomSnap)) <= threshold) {
    nextY += Math.abs(topSnap) <= Math.abs(bottomSnap) ? topSnap : bottomSnap;
  }

  return clampedPanelDelta(bounds, nextX - bounds.x, nextY - bounds.y);
}

/** リサイズ中に動かしている辺だけを内枠へ吸着させる。 */
export function snapPanelResizeToInnerFrame(
  bounds: BBox,
  handle: Exclude<ResizeHandle, 'move'>,
  minSize = 20,
  threshold = PANEL_SNAP_THRESHOLD_MM,
): BBox {
  let { x, y, w, h } = bounds;
  const right = x + w;
  const bottom = y + h;
  const innerRight = INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w;
  const innerBottom = INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h;

  if (handle.includes('w')) {
    const snappedX = snapCoordinate(x, [INNER_FRAME_BOUNDS.x], threshold);
    if (right - snappedX >= minSize) { x = snappedX; w = right - snappedX; }
  }
  if (handle.includes('e')) {
    const snappedRight = snapCoordinate(right, [innerRight], threshold);
    if (snappedRight - x >= minSize) w = snappedRight - x;
  }
  if (handle.includes('n')) {
    const snappedY = snapCoordinate(y, [INNER_FRAME_BOUNDS.y], threshold);
    if (bottom - snappedY >= minSize) { y = snappedY; h = bottom - snappedY; }
  }
  if (handle.includes('s')) {
    const snappedBottom = snapCoordinate(bottom, [innerBottom], threshold);
    if (snappedBottom - y >= minSize) h = snappedBottom - y;
  }
  return { x: roundMm(x), y: roundMm(y), w: roundMm(w), h: roundMm(h) };
}

/** 多角形コマの頂点を、近い場合だけ内枠の縦横線へ吸着させる。 */
export function snapPointToInnerFrame(
  x: number,
  y: number,
  threshold = PANEL_SNAP_THRESHOLD_MM,
): { x: number; y: number } {
  return {
    x: roundMm(snapCoordinate(x, [INNER_FRAME_BOUNDS.x, INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w], threshold)),
    y: roundMm(snapCoordinate(y, [INNER_FRAME_BOUNDS.y, INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h], threshold)),
  };
}

/** 辺の2端点へ同じ移動量を適用したまま、最も近い内枠線へ吸着させる。 */
export function snapEdgeDeltaToInnerFrame(
  start: [number, number],
  end: [number, number],
  deltaX: number,
  deltaY: number,
  threshold = PANEL_SNAP_THRESHOLD_MM,
): { x: number; y: number } {
  const innerRight = INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w;
  const innerBottom = INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h;
  const movedX = [start[0] + deltaX, end[0] + deltaX];
  const movedY = [start[1] + deltaY, end[1] + deltaY];
  const xCorrections = movedX.flatMap((value) => [INNER_FRAME_BOUNDS.x - value, innerRight - value]);
  const yCorrections = movedY.flatMap((value) => [INNER_FRAME_BOUNDS.y - value, innerBottom - value]);
  const closestX = xCorrections.reduce((best, value) => Math.abs(value) < Math.abs(best) ? value : best);
  const closestY = yCorrections.reduce((best, value) => Math.abs(value) < Math.abs(best) ? value : best);
  return {
    x: roundMm(deltaX + (Math.abs(closestX) <= threshold ? closestX : 0)),
    y: roundMm(deltaY + (Math.abs(closestY) <= threshold ? closestY : 0)),
  };
}

function edgeReferences(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  linkPanels: boolean,
  excludedEdge?: PanelEdgeReference,
): PanelEdgeReference[] {
  const first = { panelIndex, edgeIndex };
  if (!linkPanels) return [first];
  const references: PanelEdgeReference[] = [first];
  const visited = new Set([`${panelIndex}:${edgeIndex}`]);
  if (excludedEdge) visited.add(`${excludedEdge.panelIndex}:${excludedEdge.edgeIndex}`);
  for (let cursor = 0; cursor < references.length; cursor += 1) {
    const reference = references[cursor];
    findLinkedPanelEdges(panels, reference.panelIndex, reference.edgeIndex).forEach((linked) => {
      const key = `${linked.panelIndex}:${linked.edgeIndex}`;
      if (visited.has(key)) return;
      visited.add(key);
      references.push(linked);
    });
  }
  return references;
}

/** 頂点から伸びる境界線を、向かい合う辺・延長辺の連結成分として最後までたどる。 */
function vertexEdgeReferences(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  selectedPoint: [number, number],
  fixedPoint: [number, number],
): PanelEdgeReference[] {
  const references: PanelEdgeReference[] = [{ panelIndex, edgeIndex }];
  const queue: PanelEdgeReference[] = [{ panelIndex, edgeIndex }];
  const visited = new Set([`${panelIndex}:${edgeIndex}`]);
  const vectorX = fixedPoint[0] - selectedPoint[0], vectorY = fixedPoint[1] - selectedPoint[1];
  const lengthSquared = vectorX * vectorX + vectorY * vectorY;
  if (!lengthSquared) return references;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const reference = queue[cursor];
    findVertexLinkedPanelEdges(panels, reference.panelIndex, reference.edgeIndex).forEach((linked) => {
      const key = `${linked.panelIndex}:${linked.edgeIndex}`;
      if (visited.has(key)) return;
      visited.add(key);
      // 内枠・タチキリそのものは変形させず、境界の反対側へも伝播させない。
      if (edgeIsLockedBoundary(panels[linked.panelIndex], linked.edgeIndex)) return;
      references.push(linked);
      const candidatePoints = panelShapePoints(panels[linked.panelIndex]);
      const candidateIndices = [linked.edgeIndex, (linked.edgeIndex + 1) % candidatePoints.length];
      // 片端だけが動く辺は角の局所変形で止める。両端が動く辺だけを次の境界へ渡す。
      const propagates = candidateIndices.every((candidateIndex) => {
        const point = candidatePoints[candidateIndex];
        const t = ((point[0] - selectedPoint[0]) * vectorX + (point[1] - selectedPoint[1]) * vectorY) / lengthSquared;
        return clamp(1 - t, 0, 1) > 1e-6;
      });
      if (propagates) queue.push(linked);
    });
  }
  return references;
}

function clampedEdgeDelta(
  panels: Panel[],
  references: PanelEdgeReference[],
  deltaX: number,
  deltaY: number,
  minSize = 20,
): { x: number; y: number } {
  let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
  references.forEach(({ panelIndex, edgeIndex }) => {
    const panel = panels[panelIndex];
    const edge = panel && edgePoints(panel, edgeIndex);
    if (!panel || !edge) return;
    const [start, end] = edge;
    minX = Math.max(minX, -Math.min(start[0], end[0]));
    maxX = Math.min(maxX, 210 - Math.max(start[0], end[0]));
    minY = Math.max(minY, -Math.min(start[1], end[1]));
    maxY = Math.min(maxY, 297 - Math.max(start[1], end[1]));
    if (panel.shape.type !== 'rect') return;
    const { x, y, w, h } = panel.shape;
    if (edgeIndex === 0) maxY = Math.min(maxY, h - minSize);
    if (edgeIndex === 1) minX = Math.max(minX, minSize - w);
    if (edgeIndex === 2) minY = Math.max(minY, minSize - h);
    if (edgeIndex === 3) maxX = Math.min(maxX, w - minSize);
    // 紙面側の制限は端点制限と同値だが、数値誤差を避けるため明示する。
    if (edgeIndex === 0) minY = Math.max(minY, -y);
    if (edgeIndex === 1) maxX = Math.min(maxX, 210 - (x + w));
    if (edgeIndex === 2) maxY = Math.min(maxY, 297 - (y + h));
    if (edgeIndex === 3) minX = Math.max(minX, -x);
  });
  return {
    x: roundMm(clamp(deltaX, minX, maxX)),
    y: roundMm(clamp(deltaY, minY, maxY)),
  };
}

function applyEdgeDelta(panel: Panel, edgeIndex: number, deltaX: number, deltaY: number): void {
  if (panel.shape.type === 'polygon') {
    const count = panel.shape.points.length;
    if (!count || edgeIndex < 0 || edgeIndex >= count) return;
    const nextIndex = (edgeIndex + 1) % count;
    panel.shape.points[edgeIndex] = [
      roundMm(panel.shape.points[edgeIndex][0] + deltaX),
      roundMm(panel.shape.points[edgeIndex][1] + deltaY),
    ];
    panel.shape.points[nextIndex] = [
      roundMm(panel.shape.points[nextIndex][0] + deltaX),
      roundMm(panel.shape.points[nextIndex][1] + deltaY),
    ];
    return;
  }
  const next = { ...panel.shape };
  if (edgeIndex === 0) { next.y += deltaY; next.h -= deltaY; }
  if (edgeIndex === 1) next.w += deltaX;
  if (edgeIndex === 2) next.h += deltaY;
  if (edgeIndex === 3) { next.x += deltaX; next.w -= deltaX; }
  resizePanelToBounds(panel, next);
}

/**
 * 選択辺を平行移動する。linkPanels=true の場合は近接する平行辺も同じ量だけ動かし、
 * 水平・垂直・斜めのコマ間隔を維持する。
 */
export function movePanelEdge(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  deltaX: number,
  deltaY: number,
  linkPanels = false,
  excludedEdge?: PanelEdgeReference,
): { x: number; y: number; linkedEdges: number } {
  const selected = panels[panelIndex] && edgePoints(panels[panelIndex], edgeIndex);
  if (!selected) return { x: 0, y: 0, linkedEdges: 0 };
  const references = edgeReferences(panels, panelIndex, edgeIndex, linkPanels, excludedEdge);
  const delta = clampedEdgeDelta(panels, references, deltaX, deltaY);
  references.forEach((reference) => {
    const panel = panels[reference.panelIndex];
    if (panel) applyEdgeDelta(panel, reference.edgeIndex, delta.x, delta.y);
  });
  return { ...delta, linkedEdges: Math.max(0, references.length - 1) };
}

interface VertexMove {
  weightX: number;
  weightY: number;
}

interface EdgeDeformation {
  selectedEdgeIndex: number;
  panelIndex: number;
  edgeIndex: number;
}

interface CornerProjection {
  normalX: number;
  normalY: number;
  edgeDistance: number;
  cornerDistance: number;
}

interface LineConstraint {
  point: [number, number];
  vector: [number, number];
}

function constrainedPointOnLine(provisional: [number, number], line: LineConstraint): [number, number] {
  const [dx, dy] = line.vector;
  if (Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) > 1e-6) {
    const t = (provisional[1] - line.point[1]) / dy;
    return [line.point[0] + dx * t, provisional[1]];
  }
  if (Math.abs(dx) > 1e-6) {
    const t = (provisional[0] - line.point[0]) / dx;
    return [provisional[0], line.point[1] + dy * t];
  }
  return provisional;
}

function lineIntersection(first: LineConstraint, second: LineConstraint): [number, number] | null {
  const denominator = first.vector[0] * second.vector[1] - first.vector[1] * second.vector[0];
  if (Math.abs(denominator) <= 1e-6) return null;
  const offsetX = second.point[0] - first.point[0], offsetY = second.point[1] - first.point[1];
  const t = (offsetX * second.vector[1] - offsetY * second.vector[0]) / denominator;
  return [first.point[0] + first.vector[0] * t, first.point[1] + first.vector[1] * t];
}

/**
 * 多角形の1頂点を動かす。linkPanels=true では、向かい合う辺へ間隔を保った
 * 変形を渡し、同じ境界線上の隣辺へ傾きをつなぐ。角だけが近い場合はその頂点
 * だけを追従させる。内枠・タチキリ上の頂点は線上に拘束し、外側へ動かさない。
 */
export function movePanelVertexWithSnap(
  panels: Panel[],
  panelIndex: number,
  vertexIndex: number,
  x: number,
  y: number,
  linkPanels = false,
): void {
  const selectedPanel = panels[panelIndex];
  if (!selectedPanel) return;
  const selectedPoints = panelShapePoints(selectedPanel);
  const selectedPoint = selectedPoints[vertexIndex];
  if (!selectedPoint) return;
  const selectedLocks = pointBoundaryLocks(selectedPanel, selectedPoint);
  const targetX = selectedLocks.x ?? roundMm(clamp(x, 0, 210));
  const targetY = selectedLocks.y ?? roundMm(clamp(y, 0, 297));
  const deltaX = targetX - selectedPoint[0], deltaY = targetY - selectedPoint[1];
  const moves = new Map<string, VertexMove>();
  const clampInfluences = new Map<string, VertexMove>();
  const cornerProjections = new Map<string, CornerProjection>();
  const edgeDeformations: EdgeDeformation[] = [];
  const deformationKeys = new Set<string>();
  const mark = (target: Map<string, VertexMove>, pi: number, vi: number, weightX: number, weightY: number) => {
    if (weightX <= 0 && weightY <= 0) return;
    const key = `${pi}:${vi}`;
    const current = target.get(key) ?? { weightX: 0, weightY: 0 };
    current.weightX = Math.max(current.weightX, clamp(weightX, 0, 1));
    current.weightY = Math.max(current.weightY, clamp(weightY, 0, 1));
    target.set(key, current);
  };
  mark(moves, panelIndex, vertexIndex, 1, 1);
  mark(clampInfluences, panelIndex, vertexIndex, 1, 1);

  if (linkPanels) {
    const count = selectedPoints.length;
    const incidentEdges = [vertexIndex, (vertexIndex - 1 + count) % count];
    incidentEdges.forEach((selectedEdgeIndex) => {
      const selectedEdge = edgePoints(selectedPanel, selectedEdgeIndex);
      if (!selectedEdge) return;
      const fixedPoint = selectedEdgeIndex === vertexIndex ? selectedEdge[1] : selectedEdge[0];
      const vectorX = fixedPoint[0] - selectedPoint[0], vectorY = fixedPoint[1] - selectedPoint[1];
      const lengthSquared = vectorX * vectorX + vectorY * vectorY;
      if (!lengthSquared) return;
      vertexEdgeReferences(panels, panelIndex, selectedEdgeIndex, selectedPoint, fixedPoint).slice(1).forEach((reference) => {
        if (edgeIsLockedBoundary(panels[reference.panelIndex], reference.edgeIndex)) return;
        const deformationKey = `${selectedEdgeIndex}>${reference.panelIndex}:${reference.edgeIndex}`;
        if (!deformationKeys.has(deformationKey)) {
          deformationKeys.add(deformationKey);
          edgeDeformations.push({ selectedEdgeIndex, ...reference });
        }
        const candidatePoints = panelShapePoints(panels[reference.panelIndex]);
        const candidateVertexIndices = [reference.edgeIndex, (reference.edgeIndex + 1) % candidatePoints.length];
        candidateVertexIndices.forEach((candidateVertexIndex) => {
          const point = candidatePoints[candidateVertexIndex];
          const t = ((point[0] - selectedPoint[0]) * vectorX + (point[1] - selectedPoint[1]) * vectorY) / lengthSquared;
          const weight = clamp(1 - t, 0, 1);
          mark(clampInfluences, reference.panelIndex, candidateVertexIndex, weight, weight);
        });
      });
      findCornerLinkedPanelVertices(panels, panelIndex, selectedEdgeIndex, selectedPoint).forEach((reference) => {
        const length = Math.sqrt(lengthSquared);
        const candidate: CornerProjection = {
          normalX: -vectorY / length,
          normalY: vectorX / length,
          edgeDistance: reference.edgeDistance,
          cornerDistance: reference.cornerDistance,
        };
        const key = `${reference.panelIndex}:${reference.vertexIndex}`;
        const current = cornerProjections.get(key);
        if (!current
          || candidate.edgeDistance < current.edgeDistance
          || (candidate.edgeDistance === current.edgeDistance && candidate.cornerDistance < current.cornerDistance)) {
          cornerProjections.set(key, candidate);
        }
        mark(clampInfluences, reference.panelIndex, reference.vertexIndex, 1, 1);
      });
    });
  }

  // 追従頂点のどれかが紙端へ先に達した場合は、全頂点を同じ比率の移動量で止める。
  // 個別に clamp すると斜め辺の角度や揃っていたX/Yが崩れるため、移動量を一括制限する。
  let minDeltaX = -Infinity, maxDeltaX = Infinity, minDeltaY = -Infinity, maxDeltaY = Infinity;
  clampInfluences.forEach((move, key) => {
    const [pi, vi] = key.split(':').map(Number);
    const point = panels[pi] && panelShapePoints(panels[pi])[vi];
    if (!point) return;
    const locks = pointBoundaryLocks(panels[pi], point);
    if (move.weightX > 0 && locks.x === undefined) {
      minDeltaX = Math.max(minDeltaX, -point[0] / move.weightX);
      maxDeltaX = Math.min(maxDeltaX, (210 - point[0]) / move.weightX);
    }
    if (move.weightY > 0 && locks.y === undefined) {
      minDeltaY = Math.max(minDeltaY, -point[1] / move.weightY);
      maxDeltaY = Math.min(maxDeltaY, (297 - point[1]) / move.weightY);
    }
  });
  const linkedDeltaX = roundMm(clamp(deltaX, minDeltaX, maxDeltaX));
  const linkedDeltaY = roundMm(clamp(deltaY, minDeltaY, maxDeltaY));

  const originalPanelPoints = panels.map(panelShapePoints);
  const nextPanelPoints = originalPanelPoints.map((points, pi) => points.map((point, vi): [number, number] => {
    const move = moves.get(`${pi}:${vi}`) ?? { weightX: 0, weightY: 0 };
    const projection = cornerProjections.get(`${pi}:${vi}`);
    const normalDelta = projection ? linkedDeltaX * projection.normalX + linkedDeltaY * projection.normalY : 0;
    const locks = pointBoundaryLocks(panels[pi], point);
    return [
      locks.x ?? roundMm(point[0] + linkedDeltaX * move.weightX + (projection?.normalX ?? 0) * normalDelta),
      locks.y ?? roundMm(point[1] + linkedDeltaY * move.weightY + (projection?.normalY ?? 0) * normalDelta),
    ];
  }));
  const constraints = new Map<string, LineConstraint[]>();
  edgeDeformations.forEach((deformation) => {
    const selectedPoints = originalPanelPoints[panelIndex];
    const selectedNextPoints = nextPanelPoints[panelIndex];
    const selectedStartIndex = deformation.selectedEdgeIndex;
    const selectedEndIndex = (selectedStartIndex + 1) % selectedPoints.length;
    const oldStart = selectedPoints[selectedStartIndex], oldEnd = selectedPoints[selectedEndIndex];
    const newStart = selectedNextPoints[selectedStartIndex], newEnd = selectedNextPoints[selectedEndIndex];
    const oldVectorX = oldEnd[0] - oldStart[0], oldVectorY = oldEnd[1] - oldStart[1];
    const newVectorX = newEnd[0] - newStart[0], newVectorY = newEnd[1] - newStart[1];
    const oldLength = Math.hypot(oldVectorX, oldVectorY), newLength = Math.hypot(newVectorX, newVectorY);
    if (!oldLength || !newLength) return;
    const oldNormal: [number, number] = [-oldVectorY / oldLength, oldVectorX / oldLength];
    const newNormal: [number, number] = [-newVectorY / newLength, newVectorX / newLength];
    const candidatePoints = originalPanelPoints[deformation.panelIndex];
    const candidateIndices = [deformation.edgeIndex, (deformation.edgeIndex + 1) % candidatePoints.length];
    const distance = candidateIndices.reduce((sum, candidateIndex) => {
      const point = candidatePoints[candidateIndex];
      return sum + (point[0] - oldStart[0]) * oldNormal[0] + (point[1] - oldStart[1]) * oldNormal[1];
    }, 0) / candidateIndices.length;
    const line: LineConstraint = {
      point: [newStart[0] + newNormal[0] * distance, newStart[1] + newNormal[1] * distance],
      vector: [newVectorX, newVectorY],
    };
    candidateIndices.forEach((candidateIndex) => {
      const key = `${deformation.panelIndex}:${candidateIndex}`;
      constraints.set(key, [...(constraints.get(key) ?? []), line]);
    });
  });

  constraints.forEach((lines, key) => {
    const [pi, vi] = key.split(':').map(Number);
    const provisional = nextPanelPoints[pi]?.[vi];
    if (!provisional || !lines.length) return;
    const original = originalPanelPoints[pi][vi];
    const locks = pointBoundaryLocks(panels[pi], original);
    if (locks.x !== undefined && locks.y !== undefined) {
      nextPanelPoints[pi][vi] = [locks.x, locks.y];
      return;
    }
    let target: [number, number] | null = null;
    if (locks.x !== undefined || locks.y !== undefined) {
      const boundary: LineConstraint = locks.x !== undefined
        ? { point: [locks.x, 0], vector: [0, 1] }
        : { point: [0, locks.y!], vector: [1, 0] };
      const intersections = lines
        .map((line) => lineIntersection(line, boundary))
        .filter((point): point is [number, number] => point !== null)
        .sort((left, right) => Math.hypot(left[0] - provisional[0], left[1] - provisional[1])
          - Math.hypot(right[0] - provisional[0], right[1] - provisional[1]));
      target = intersections[0] ?? provisional;
    } else {
      for (let first = 0; first < lines.length && !target; first += 1) {
        for (let second = first + 1; second < lines.length && !target; second += 1) {
          target = lineIntersection(lines[first], lines[second]);
        }
      }
      target ??= constrainedPointOnLine(provisional, lines[0]);
    }
    nextPanelPoints[pi][vi] = [
      locks.x ?? roundMm(clamp(target[0], 0, 210)),
      locks.y ?? roundMm(clamp(target[1], 0, 297)),
    ];
  });

  const affectedPanels = new Set<number>();
  moves.forEach((_, key) => affectedPanels.add(Number(key.split(':')[0])));
  cornerProjections.forEach((_, key) => affectedPanels.add(Number(key.split(':')[0])));
  constraints.forEach((_, key) => affectedPanels.add(Number(key.split(':')[0])));
  panels.forEach((panel, pi) => {
    if (!affectedPanels.has(pi)) return;
    const nextPoints = nextPanelPoints[pi];
    if (panel.shape.type === 'polygon') {
      panel.shape.points = nextPoints;
      return;
    }
    const remainsRect = Math.abs(nextPoints[0][1] - nextPoints[1][1]) <= 0.05
      && Math.abs(nextPoints[1][0] - nextPoints[2][0]) <= 0.05
      && Math.abs(nextPoints[2][1] - nextPoints[3][1]) <= 0.05
      && Math.abs(nextPoints[3][0] - nextPoints[0][0]) <= 0.05
      && nextPoints[1][0] - nextPoints[0][0] >= MIN_SIZE_MM
      && nextPoints[3][1] - nextPoints[0][1] >= MIN_SIZE_MM;
    if (remainsRect) {
      resizePanelToBounds(panel, {
        x: nextPoints[0][0],
        y: nextPoints[0][1],
        w: nextPoints[1][0] - nextPoints[0][0],
        h: nextPoints[3][1] - nextPoints[0][1],
      });
    } else {
      panel.shape = { type: 'polygon', points: nextPoints };
    }
  });
}

export function translatePanel(panel: Panel, deltaX: number, deltaY: number): void {
  if (panel.shape.type === 'rect') {
    panel.shape.x = roundMm(panel.shape.x + deltaX);
    panel.shape.y = roundMm(panel.shape.y + deltaY);
  } else {
    panel.shape.points = panel.shape.points.map(([x, y]) => [roundMm(x + deltaX), roundMm(y + deltaY)]);
  }
  panel.figures?.forEach((figure) => {
    if (!figure.bbox) return;
    figure.bbox.x = roundMm(figure.bbox.x + deltaX);
    figure.bbox.y = roundMm(figure.bbox.y + deltaY);
  });
  panel.bubbles.forEach((bubble) => {
    if (!bubble.bbox) return;
    bubble.bbox.x = roundMm(bubble.bbox.x + deltaX);
    bubble.bbox.y = roundMm(bubble.bbox.y + deltaY);
  });
  panel.screen_text?.forEach((screenText) => {
    if (!screenText.bbox) return;
    screenText.bbox.x = roundMm(screenText.bbox.x + deltaX);
    screenText.bbox.y = roundMm(screenText.bbox.y + deltaY);
  });
}

export function resizePanelToBounds(panel: Panel, requestedBounds: BBox): void {
  const original = panelBounds(panel);
  const next = {
    x: roundMm(requestedBounds.x),
    y: roundMm(requestedBounds.y),
    w: Math.max(1, roundMm(requestedBounds.w)),
    h: Math.max(1, roundMm(requestedBounds.h)),
  };
  const scaleX = original.w ? next.w / original.w : 1;
  const scaleY = original.h ? next.h / original.h : 1;
  const transformBox = (box: BBox) => {
    box.x = roundMm(next.x + (box.x - original.x) * scaleX);
    box.y = roundMm(next.y + (box.y - original.y) * scaleY);
    box.w = roundMm(box.w * scaleX);
    box.h = roundMm(box.h * scaleY);
  };

  if (panel.shape.type === 'rect') {
    panel.shape = { type: 'rect', ...next };
  } else {
    panel.shape.points = panel.shape.points.map(([x, y]) => [
      roundMm(next.x + (x - original.x) * scaleX),
      roundMm(next.y + (y - original.y) * scaleY),
    ]);
  }
  panel.figures?.forEach((figure) => { if (figure.bbox) transformBox(figure.bbox); });
  panel.bubbles.forEach((bubble) => { if (bubble.bbox) transformBox(bubble.bbox); });
  panel.screen_text?.forEach((screenText) => { if (screenText.bbox) transformBox(screenText.bbox); });
}

export function convertPanelShape(panel: Panel, type: 'rect' | 'polygon'): void {
  if (panel.shape.type === type) return;
  const bounds = panelBounds(panel);
  panel.shape = type === 'rect'
    ? { type: 'rect', ...bounds }
    : { type: 'polygon', points: [
      [bounds.x, bounds.y],
      [bounds.x + bounds.w, bounds.y],
      [bounds.x + bounds.w, bounds.y + bounds.h],
      [bounds.x, bounds.y + bounds.h],
    ] };
}
