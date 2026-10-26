import type { Anchor, BBox, BleedEdge, CanvasElementType, Panel, PanelShape } from '../types';

export interface CanvasSize { w: number; h: number }
export const DEFAULT_CANVAS: Readonly<CanvasSize> = { w: 210, h: 297 };

interface InnerFrameStandard {
  finish: readonly [width: number, height: number];
  frame: readonly [width: number, height: number];
}

/**
 * Standard basic-frame dimensions keyed by the finished page size. ComicStudio
 * names templates by their larger manuscript sheet, so this deliberately maps
 * each template's `finish size` to its `basic frame`, not sheet size to frame.
 * B5 follows Futaba Kikaku's A4 manuscript guide (182 x 257 mm finish,
 * 150 x 220 mm basic frame). A nearby printer-specific half-millimetre override
 * still uses the same frame.
 */
const INNER_FRAME_STANDARDS: readonly InnerFrameStandard[] = [
  { finish: [257, 364], frame: [212, 300] }, // B4
  { finish: [210, 297], frame: [180, 268] }, // A4
  { finish: [182, 257], frame: [150, 220] }, // B5
  { finish: [148, 210], frame: [125, 180] }, // A5
  { finish: [128, 182], frame: [105, 150] }, // B6
  { finish: [105, 148], frame: [90, 125] },  // A6
  { finish: [226, 312], frame: [180, 270] }, // standard B4 manuscript trim
];

const B5_INNER_FRAME_RATIO = { x: 150 / 182, y: 220 / 257 } as const;

/** Editing inner frame, independent of print safety/bleed margins. */
export function innerFrameBounds(canvas: CanvasSize = DEFAULT_CANVAS): BBox {
  const landscape = canvas.w > canvas.h;
  const portraitWidth = landscape ? canvas.h : canvas.w;
  const portraitHeight = landscape ? canvas.w : canvas.h;
  const standard = INNER_FRAME_STANDARDS.find(({ finish }) => (
    Math.abs(finish[0] - portraitWidth) <= 0.75 && Math.abs(finish[1] - portraitHeight) <= 0.75
  ));
  const portraitFrameWidth = standard?.frame[0] ?? portraitWidth * B5_INNER_FRAME_RATIO.x;
  const portraitFrameHeight = standard?.frame[1] ?? portraitHeight * B5_INNER_FRAME_RATIO.y;
  const width = landscape ? portraitFrameHeight : portraitFrameWidth;
  const height = landscape ? portraitFrameWidth : portraitFrameHeight;
  return {
    x: roundMm((canvas.w - width) / 2),
    y: roundMm((canvas.h - height) / 2),
    w: roundMm(width),
    h: roundMm(height),
  };
}

export type ResizeHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export interface InteractionGeometry {
  mode: ResizeHandle;
  unbounded?: boolean;
  canvas?: CanvasSize;
  startClientX: number;
  startClientY: number;
  startBox: BBox;
  bounds: BBox;
  paperRect: { width: number; height: number };
}

export const MIN_SIZE_MM = 6;
export const INNER_FRAME_BOUNDS: Readonly<BBox> = innerFrameBounds(DEFAULT_CANVAS);
export const PANEL_SNAP_THRESHOLD_MM = 4;
export const PANEL_EDGE_LINK_DISTANCE_MM = 8;
export const PANEL_EDGE_ALIGNMENT_TOLERANCE_MM = 0.15;
const PANEL_VERTEX_JUNCTION_ALONG_GAP_MM = PANEL_EDGE_LINK_DISTANCE_MM + PANEL_SNAP_THRESHOLD_MM;
const PANEL_VERTEX_JUNCTION_CORNER_MM = 13;
const PANEL_VERTEX_WALL_OFFSET_TOLERANCE_MM = PANEL_SNAP_THRESHOLD_MM;

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
}

export interface ShiftAxisSessionState {
  shiftActive: boolean;
  anchorRawX: number;
  anchorRawY: number;
  anchorAppliedX: number;
  anchorAppliedY: number;
  constraint: ShiftAxisDragState;
}

const SHIFT_AXIS_LOCK_MM = 2.5;

/**
 * Shiftドラッグは2.5mmの初動後、最初に優勢だった水平・垂直軸へ固定する。
 * 同じShift押下中はポインタが別方向へ動いても軸を切り替えない。
 */
export function resolveShiftAxisDrag(
  deltaX: number,
  deltaY: number,
  state: ShiftAxisDragState,
): { x: number; y: number; state: ShiftAxisDragState } {
  let axis = state.axis;

  if (!axis) {
    if (Math.hypot(deltaX, deltaY) < SHIFT_AXIS_LOCK_MM) {
      return { x: 0, y: 0, state: {} };
    }
    const initial = constrainDragDeltaToAxis(deltaX, deltaY);
    axis = initial.y === 0 ? 'x' : 'y';
  }

  return {
    x: axis === 'x' ? deltaX : 0,
    y: axis === 'y' ? deltaY : 0,
    state: { axis },
  };
}

export function createShiftAxisSession(shiftActive: boolean): ShiftAxisSessionState {
  return {
    shiftActive,
    anchorRawX: 0,
    anchorRawY: 0,
    anchorAppliedX: 0,
    anchorAppliedY: 0,
    constraint: {},
  };
}

/**
 * Shiftの押下状態が変わった地点を新しい基準にする。
 * 押し直し・解除の瞬間は直前の表示位置を保ち、次の移動から新しい軸を選ぶ。
 */
export function resolveShiftAxisSession(
  rawX: number,
  rawY: number,
  shiftActive: boolean,
  state: ShiftAxisSessionState,
  lastAppliedX: number,
  lastAppliedY: number,
): { x: number; y: number; axis?: DragAxis; state: ShiftAxisSessionState } {
  let nextState = state;
  if (shiftActive !== state.shiftActive) {
    nextState = {
      shiftActive,
      anchorRawX: rawX,
      anchorRawY: rawY,
      anchorAppliedX: lastAppliedX,
      anchorAppliedY: lastAppliedY,
      constraint: {},
    };
  }

  const localX = rawX - nextState.anchorRawX;
  const localY = rawY - nextState.anchorRawY;
  if (!shiftActive) {
    return {
      x: nextState.anchorAppliedX + localX,
      y: nextState.anchorAppliedY + localY,
      state: nextState,
    };
  }

  const constrained = resolveShiftAxisDrag(localX, localY, nextState.constraint);
  const constrainedState = { ...nextState, constraint: constrained.state };
  return {
    x: constrainedState.anchorAppliedX + constrained.x,
    y: constrainedState.anchorAppliedY + constrained.y,
    axis: constrained.state.axis,
    state: constrainedState,
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

interface PointLegalBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 既に内枠外にある点は現位置まで許容するが、それ以上外側へは動かさない。 */
function pointLegalBounds(panel: Panel, original: [number, number], canvas: CanvasSize = DEFAULT_CANVAS): PointLegalBounds {
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

function pointWithinLegalBounds(point: [number, number], bounds: PointLegalBounds, tolerance = 1e-6): boolean {
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

function constrainedJunctionPoint(
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

function edgeIsLockedBoundary(panel: Panel, edgeIndex: number, canvas: CanvasSize = DEFAULT_CANVAS): boolean {
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

/** Context menus must also hit figures inside passive panels, whose guides ignore pointer events. */
export function panelFigureAt(panel: Panel, x: number, y: number, showGuides = true): number | undefined {
  if (!pointInPanel(panel, x, y)) return undefined;
  for (let index = (panel.figures?.length ?? 0) - 1; index >= 0; index--) {
    const figure = panel.figures![index];
    if (figure.artwork?.hidden || (!showGuides && !figure.artwork)) continue;
    const box = figure.bbox ?? fallbackBox(panel, 'figure', index);
    if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return index;
  }
  return undefined;
}

export function panelHasElementAt(panel: Panel, x: number, y: number): boolean {
  const boxes: BBox[] = [
    ...(panel.images ?? []).filter(image => !image.hidden).map(image => image.bbox),
    ...(panel.figures ?? []).flatMap((figure, index) => figure.artwork?.hidden ? [] : [figure.bbox ?? fallbackBox(panel, 'figure', index)]),
    ...panel.bubbles.flatMap((bubble, index) => bubble.hidden===true?[]:[bubble.bbox ?? fallbackBox(panel, 'bubble', index)]),
    ...(panel.screen_text ?? []).map((screenText, index) => screenText.bbox ?? fallbackBox(panel, 'screen_text', index)),
  ];
  return boxes.some((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
}

// パネルが重なった位置のクリック先を決める。重ね順は配列順で固定（先頭のパネル1が最奥）。
// 最前面のパネルのクリック位置にエレメント（人物・フキダシ・画面内文字）があればそのパネルを選び、
// なければクリックは空白部分を貫通する:
// - 選択中のパネルが重なりに含まれるときは一段ずつ奥へ送る（最奥まで行ったら最前面へ戻る）
// - 含まれないときはエレメントがある最前面のパネル、どこにもなければ最奥のパネルを選ぶ
export function resolveOverlapClick(panels: Panel[], clickedIndex: number, activeIndex: number, x: number, y: number, hasElement=(panel:Panel,_index:number)=>panelHasElementAt(panel,x,y)): number {
  const stack = panels.map((_, index) => index).filter((index) => pointInPanel(panels[index], x, y)).reverse();
  if (stack.length < 2 || !stack.includes(clickedIndex)) return clickedIndex;
  if (hasElement(panels[stack[0]],stack[0])) return stack[0];
  const activePosition = stack.indexOf(activeIndex);
  if (activePosition !== -1) return stack[(activePosition + 1) % stack.length];
  return stack.find((index) => hasElement(panels[index],index)) ?? stack[stack.length - 1];
}

export function resizedBox(interaction: InteractionGeometry, clientX: number, clientY: number, minSize = MIN_SIZE_MM): BBox {
  const { startBox, bounds, paperRect, mode, canvas = DEFAULT_CANVAS } = interaction;
  const dx = (clientX - interaction.startClientX) * (canvas.w / paperRect.width);
  const dy = (clientY - interaction.startClientY) * (canvas.h / paperRect.height);
  if (dx === 0 && dy === 0) return { ...startBox };
  minSize = Math.min(minSize, bounds.w, bounds.h, canvas.w / 4, canvas.h / 4);
  const minWidth = Math.min(minSize, startBox.w), minHeight = Math.min(minSize, startBox.h);
  const right = startBox.x + startBox.w;
  const bottom = startBox.y + startBox.h;
  let x = startBox.x, y = startBox.y, w = startBox.w, h = startBox.h;

  if(interaction.unbounded){
    if(mode==='move'){x+=dx;y+=dy;}
    else{
      if(mode.includes('w')){x=Math.min(x+dx,right-minWidth);w=right-x;}
      if(mode.includes('e'))w=Math.max(minWidth,w+dx);
      if(mode.includes('n')){y=Math.min(y+dy,bottom-minHeight);h=bottom-y;}
      if(mode.includes('s'))h=Math.max(minHeight,h+dy);
    }
    return {x:roundMm(x),y:roundMm(y),w:roundMm(w),h:roundMm(h)};
  }

  if (mode === 'move') {
    x = clamp(startBox.x + dx, bounds.x, bounds.x + bounds.w - startBox.w);
    y = clamp(startBox.y + dy, bounds.y, bounds.y + bounds.h - startBox.h);
  } else {
    if (mode.includes('w')) { x = clamp(startBox.x + dx, bounds.x, right - minWidth); w = right - x; }
    if (mode.includes('e')) { w = clamp(startBox.w + dx, minWidth, bounds.x + bounds.w - startBox.x); }
    if (mode.includes('n')) { y = clamp(startBox.y + dy, bounds.y, bottom - minHeight); h = bottom - y; }
    if (mode.includes('s')) { h = clamp(startBox.h + dy, minHeight, bounds.y + bounds.h - startBox.y); }
  }
  return { x: roundMm(x), y: roundMm(y), w: roundMm(w), h: roundMm(h) };
}

export function clampedPanelDelta(bounds: BBox, deltaX: number, deltaY: number, canvas: CanvasSize = DEFAULT_CANVAS, outerMargin = 0): { x: number; y: number } {
  const margin = Math.max(0, outerMargin);
  return {
    x: roundMm(clamp(deltaX, -margin - bounds.x, canvas.w + margin - (bounds.x + bounds.w))),
    y: roundMm(clamp(deltaY, -margin - bounds.y, canvas.h + margin - (bounds.y + bounds.h))),
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
  canvas: CanvasSize = DEFAULT_CANVAS,
  outerMargin = 0,
): { x: number; y: number } {
  const inner = innerFrameBounds(canvas);
  const clamped = clampedPanelDelta(bounds, deltaX, deltaY, canvas, outerMargin);
  let nextX = bounds.x + clamped.x;
  let nextY = bounds.y + clamped.y;
  const innerRight = inner.x + inner.w;
  const innerBottom = inner.y + inner.h;

  const leftSnap = inner.x - nextX;
  const rightSnap = innerRight - (nextX + bounds.w);
  if (Math.min(Math.abs(leftSnap), Math.abs(rightSnap)) <= threshold) {
    nextX += Math.abs(leftSnap) <= Math.abs(rightSnap) ? leftSnap : rightSnap;
  }

  const topSnap = inner.y - nextY;
  const bottomSnap = innerBottom - (nextY + bounds.h);
  if (Math.min(Math.abs(topSnap), Math.abs(bottomSnap)) <= threshold) {
    nextY += Math.abs(topSnap) <= Math.abs(bottomSnap) ? topSnap : bottomSnap;
  }

  return clampedPanelDelta(bounds, nextX - bounds.x, nextY - bounds.y, canvas, outerMargin);
}

/** リサイズ中に動かしている辺だけを内枠へ吸着させる。 */
export function snapPanelResizeToInnerFrame(
  bounds: BBox,
  handle: Exclude<ResizeHandle, 'move'>,
  minSize = 20,
  threshold = PANEL_SNAP_THRESHOLD_MM,
  canvas: CanvasSize = DEFAULT_CANVAS,
): BBox {
  const inner = innerFrameBounds(canvas);
  let { x, y, w, h } = bounds;
  const right = x + w;
  const bottom = y + h;
  const innerRight = inner.x + inner.w;
  const innerBottom = inner.y + inner.h;

  if (handle.includes('w')) {
    const snappedX = snapCoordinate(x, [inner.x], threshold);
    if (right - snappedX >= minSize) { x = snappedX; w = right - snappedX; }
  }
  if (handle.includes('e')) {
    const snappedRight = snapCoordinate(right, [innerRight], threshold);
    if (snappedRight - x >= minSize) w = snappedRight - x;
  }
  if (handle.includes('n')) {
    const snappedY = snapCoordinate(y, [inner.y], threshold);
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
  canvas: CanvasSize = DEFAULT_CANVAS,
): { x: number; y: number } {
  const inner = innerFrameBounds(canvas);
  return {
    x: roundMm(snapCoordinate(x, [inner.x, inner.x + inner.w], threshold)),
    y: roundMm(snapCoordinate(y, [inner.y, inner.y + inner.h], threshold)),
  };
}

/**
 * ドラッグ開始直後は既存のコマ間隔スナップを抑え、元位置へ戻った時は厳密に復元する。
 * これにより、開始点のすぐ横にある別の吸着候補へ逆向きに飛ばない。
 * コマスナップOFFでは0.1mm単位の微調整を許し、丸め後の完全な開始位置だけ復元する。
 */
export function resolveVertexDragStartZone(
  x: number,
  y: number,
  startX: number,
  startY: number,
  enabled = true,
  restoreThreshold = 0.5,
  suppressSnapThreshold = PANEL_SNAP_THRESHOLD_MM,
): { x: number; y: number; suppressOtherSnaps: boolean; restored: boolean } {
  const distance = Math.hypot(x - startX, y - startY);
  const effectiveRestoreThreshold = enabled ? restoreThreshold : 0.05;
  if (distance <= effectiveRestoreThreshold) {
    return { x: startX, y: startY, suppressOtherSnaps: true, restored: true };
  }
  if (!enabled) return { x, y, suppressOtherSnaps: false, restored: false };
  return {
    x,
    y,
    suppressOtherSnaps: distance <= suppressSnapThreshold,
    restored: false,
  };
}

/** 辺の2端点へ同じ移動量を適用したまま、最も近い内枠線へ吸着させる。 */
export function snapEdgeDeltaToInnerFrame(
  start: [number, number],
  end: [number, number],
  deltaX: number,
  deltaY: number,
  threshold = PANEL_SNAP_THRESHOLD_MM,
  canvas: CanvasSize = DEFAULT_CANVAS,
): { x: number; y: number } {
  const inner = innerFrameBounds(canvas);
  const innerRight = inner.x + inner.w;
  const innerBottom = inner.y + inner.h;
  const movedX = [start[0] + deltaX, end[0] + deltaX];
  const movedY = [start[1] + deltaY, end[1] + deltaY];
  const xCorrections = movedX.flatMap((value) => [inner.x - value, innerRight - value]);
  const yCorrections = movedY.flatMap((value) => [inner.y - value, innerBottom - value]);
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

function clampedEdgeDelta(
  panels: Panel[],
  references: PanelEdgeReference[],
  deltaX: number,
  deltaY: number,
  minSize = 20,
  canvas: CanvasSize = DEFAULT_CANVAS,
  outerMargin = 0,
): { x: number; y: number } {
  const margin = Math.max(0, outerMargin);
  let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
  references.forEach(({ panelIndex, edgeIndex }) => {
    const panel = panels[panelIndex];
    const edge = panel && edgePoints(panel, edgeIndex);
    if (!panel || !edge) return;
    const [start, end] = edge;
    minX = Math.max(minX, -margin - Math.min(start[0], end[0]));
    maxX = Math.min(maxX, canvas.w + margin - Math.max(start[0], end[0]));
    minY = Math.max(minY, -margin - Math.min(start[1], end[1]));
    maxY = Math.min(maxY, canvas.h + margin - Math.max(start[1], end[1]));
    if (panel.shape.type !== 'rect') return;
    const { x, y, w, h } = panel.shape;
    const minWidth = Math.min(minSize, w), minHeight = Math.min(minSize, h);
    if (edgeIndex === 0) maxY = Math.min(maxY, h - minHeight);
    if (edgeIndex === 1) minX = Math.max(minX, minWidth - w);
    if (edgeIndex === 2) minY = Math.max(minY, minHeight - h);
    if (edgeIndex === 3) maxX = Math.min(maxX, w - minWidth);
    // 紙面側の制限は端点制限と同値だが、数値誤差を避けるため明示する。
    if (edgeIndex === 0) minY = Math.max(minY, -margin - y);
    if (edgeIndex === 1) maxX = Math.min(maxX, canvas.w + margin - (x + w));
    if (edgeIndex === 2) maxY = Math.min(maxY, canvas.h + margin - (y + h));
    if (edgeIndex === 3) minX = Math.max(minX, -margin - x);
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
  canvas: CanvasSize = DEFAULT_CANVAS,
  outerMargin = 0,
): { x: number; y: number; linkedEdges: number } {
  const selected = panels[panelIndex] && edgePoints(panels[panelIndex], edgeIndex);
  if (!selected) return { x: 0, y: 0, linkedEdges: 0 };
  const references = edgeReferences(panels, panelIndex, edgeIndex, linkPanels, excludedEdge);
  const delta = clampedEdgeDelta(panels, references, deltaX, deltaY, Math.min(20, canvas.w / 4, canvas.h / 4), canvas, outerMargin);
  if (delta.x === 0 && delta.y === 0) return { ...delta, linkedEdges: Math.max(0, references.length - 1) };
  references.forEach((reference) => {
    const panel = panels[reference.panelIndex];
    if (panel) applyEdgeDelta(panel, reference.edgeIndex, delta.x, delta.y);
  });
  return { ...delta, linkedEdges: Math.max(0, references.length - 1) };
}

interface VertexEdgeCandidate extends PanelEdgeReference {
  signedNormalDistance: number;
  projectionMin: number;
  projectionMax: number;
  sharesProjection: boolean;
  originGap: number;
  nearestVertexIndex: number;
  nearestDistance: number;
}

interface VertexSplitDeformation {
  selectedEdgeIndex: number;
  panelIndex: number;
  edgeIndex: number;
}

interface VertexJunctionReference {
  panelIndex: number;
  vertexIndex: number;
  distance: number;
}

interface LineConstraint {
  point: [number, number];
  vector: [number, number];
  preferred?: [number, number];
}

/** 直線を合法矩形で切り、preferredに最も近い直線上の点を返す。 */
function pointOnLineWithinBounds(
  line: LineConstraint,
  preferred: [number, number],
  bounds: PointLegalBounds,
): [number, number] | null {
  let minimumParameter = -Infinity;
  let maximumParameter = Infinity;
  const restrict = (origin: number, direction: number, minimum: number, maximum: number): boolean => {
    if (Math.abs(direction) <= 1e-6) return origin >= minimum - 1e-6 && origin <= maximum + 1e-6;
    const first = (minimum - origin) / direction;
    const second = (maximum - origin) / direction;
    minimumParameter = Math.max(minimumParameter, Math.min(first, second));
    maximumParameter = Math.min(maximumParameter, Math.max(first, second));
    return minimumParameter <= maximumParameter + 1e-6;
  };
  if (!restrict(line.point[0], line.vector[0], bounds.minX, bounds.maxX)
    || !restrict(line.point[1], line.vector[1], bounds.minY, bounds.maxY)) return null;
  const lengthSquared = line.vector[0] ** 2 + line.vector[1] ** 2;
  if (lengthSquared <= 1e-12) return null;
  const preferredParameter = ((preferred[0] - line.point[0]) * line.vector[0]
    + (preferred[1] - line.point[1]) * line.vector[1]) / lengthSquared;
  const parameter = clamp(preferredParameter, minimumParameter, maximumParameter);
  return [
    roundMm(line.point[0] + line.vector[0] * parameter),
    roundMm(line.point[1] + line.vector[1] * parameter),
  ];
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

function intervalGap(firstMin: number, firstMax: number, secondMin: number, secondMax: number): number {
  if (firstMax < secondMin) return secondMin - firstMax;
  if (secondMax < firstMin) return firstMin - secondMax;
  return 0;
}

function intervalOverlap(firstMin: number, firstMax: number, secondMin: number, secondMax: number): number {
  return Math.max(0, Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin));
}

function sameNormalSide(first: number, second: number): boolean {
  const firstOnLine = Math.abs(first) <= PANEL_EDGE_ALIGNMENT_TOLERANCE_MM;
  const secondOnLine = Math.abs(second) <= PANEL_EDGE_ALIGNMENT_TOLERANCE_MM;
  return (firstOnLine && secondOnLine)
    || (!firstOnLine && !secondOnLine && Math.sign(first) === Math.sign(second));
}

/** 選択頂点から伸びる1本の入射辺に、直接向かい合う辺だけを分類する。 */
function vertexEdgeCandidates(
  panels: Panel[],
  selectedPanelIndex: number,
  selectedPoint: [number, number],
  fixedPoint: [number, number],
  canvas: CanvasSize = DEFAULT_CANVAS,
): VertexEdgeCandidate[] {
  const vectorX = fixedPoint[0] - selectedPoint[0], vectorY = fixedPoint[1] - selectedPoint[1];
  const length = Math.hypot(vectorX, vectorY);
  if (!length) return [];
  const unitX = vectorX / length, unitY = vectorY / length;
  const normalX = -unitY, normalY = unitX;
  const candidates: VertexEdgeCandidate[] = [];

  panels.forEach((panel, panelIndex) => {
    if (panelIndex === selectedPanelIndex) return;
    const points = panelShapePoints(panel);
    points.forEach((candidateStart, edgeIndex) => {
      if (edgeIsLockedBoundary(panel, edgeIndex, canvas)) return;
      const endIndex = (edgeIndex + 1) % points.length;
      const candidateEnd = points[endIndex];
      const candidateVectorX = candidateEnd[0] - candidateStart[0];
      const candidateVectorY = candidateEnd[1] - candidateStart[1];
      const candidateLength = Math.hypot(candidateVectorX, candidateVectorY);
      if (!candidateLength) return;
      const parallelError = Math.abs(vectorX * candidateVectorY - vectorY * candidateVectorX) / (length * candidateLength);
      if (parallelError > 0.08) return;

      const signedDistanceStart = (candidateStart[0] - selectedPoint[0]) * normalX
        + (candidateStart[1] - selectedPoint[1]) * normalY;
      const signedDistanceEnd = (candidateEnd[0] - selectedPoint[0]) * normalX
        + (candidateEnd[1] - selectedPoint[1]) * normalY;
      const normalDistance = (Math.abs(signedDistanceStart) + Math.abs(signedDistanceEnd)) / 2;
      if (normalDistance > PANEL_EDGE_LINK_DISTANCE_MM) return;

      const projectionA = (candidateStart[0] - selectedPoint[0]) * unitX
        + (candidateStart[1] - selectedPoint[1]) * unitY;
      const projectionB = (candidateEnd[0] - selectedPoint[0]) * unitX
        + (candidateEnd[1] - selectedPoint[1]) * unitY;
      const projectionMin = Math.min(projectionA, projectionB);
      const projectionMax = Math.max(projectionA, projectionB);
      const projectionOverlap = Math.max(0, Math.min(length, projectionMax) - Math.max(0, projectionMin));
      const sharesProjection = projectionOverlap >= Math.min(8, Math.min(length, candidateLength) * 0.25);
      const originGap = projectionMin <= 0 && projectionMax >= 0
        ? 0
        : Math.min(Math.abs(projectionMin), Math.abs(projectionMax));
      const startDistance = Math.hypot(candidateStart[0] - selectedPoint[0], candidateStart[1] - selectedPoint[1]);
      const endDistance = Math.hypot(candidateEnd[0] - selectedPoint[0], candidateEnd[1] - selectedPoint[1]);
      const nearestIsStart = startDistance <= endDistance;
      candidates.push({
        panelIndex,
        edgeIndex,
        signedNormalDistance: (signedDistanceStart + signedDistanceEnd) / 2,
        projectionMin,
        projectionMax,
        sharesProjection,
        originGap,
        nearestVertexIndex: nearestIsStart ? edgeIndex : endIndex,
        nearestDistance: nearestIsStart ? startDistance : endDistance,
      });
    });
  });
  return candidates;
}

/** 同じ対向壁を分割している辺を、選択入射辺から直接見える範囲だけでまとめる。 */
function splitWallGroups(candidates: VertexEdgeCandidate[]): VertexEdgeCandidate[][] {
  const projected = candidates.filter((candidate) => candidate.sharesProjection);
  const visited = new Set<number>();
  const groups: VertexEdgeCandidate[][] = [];
  projected.forEach((candidate, startIndex) => {
    if (visited.has(startIndex)) return;
    visited.add(startIndex);
    const group: VertexEdgeCandidate[] = [candidate];
    const queue = [startIndex];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = projected[queue[cursor]];
      projected.forEach((other, otherIndex) => {
        if (visited.has(otherIndex)) return;
        if (!sameNormalSide(current.signedNormalDistance, other.signedNormalDistance)) return;
        if (Math.abs(current.signedNormalDistance - other.signedNormalDistance) > PANEL_VERTEX_WALL_OFFSET_TOLERANCE_MM) return;
        const gap = intervalGap(current.projectionMin, current.projectionMax, other.projectionMin, other.projectionMax);
        const overlap = intervalOverlap(current.projectionMin, current.projectionMax, other.projectionMin, other.projectionMax);
        if (gap > PANEL_VERTEX_JUNCTION_ALONG_GAP_MM || overlap > PANEL_VERTEX_WALL_OFFSET_TOLERANCE_MM) return;
        visited.add(otherIndex);
        queue.push(otherIndex);
        group.push(other);
      });
    }
    if (group.length >= 2) groups.push(group);
  });
  return groups;
}

/** 選択点へ届く対向壁が重なる場合、同じ法線側で最も近い壁層だけを可視とする。 */
function nearestOriginWallLayer(candidates: VertexEdgeCandidate[]): VertexEdgeCandidate[] {
  return candidates.filter((candidate) => {
    const sameSide = candidates.filter((other) => sameNormalSide(
      candidate.signedNormalDistance,
      other.signedNormalDistance,
    ));
    const nearestDistance = Math.min(...sameSide.map((other) => Math.abs(other.signedNormalDistance)));
    return Math.abs(candidate.signedNormalDistance) - nearestDistance <= PANEL_VERTEX_WALL_OFFSET_TOLERANCE_MM;
  });
}

/** 選択点は自分自身の内枠・タチキリ線だけを守り、追従点の都合では止めない。 */
function constrainedSelectedPoint(panel: Panel, original: [number, number], x: number, y: number, canvas: CanvasSize = DEFAULT_CANVAS): [number, number] {
  const inner = innerFrameBounds(canvas);
  const locks = pointBoundaryLocks(panel, original, undefined, canvas);
  let nextX = roundMm(clamp(x, 0, canvas.w));
  let nextY = roundMm(clamp(y, 0, canvas.h));
  if (locks.x !== undefined) {
    nextX = locks.x;
    if (locks.x === inner.x || locks.x === inner.x + inner.w) {
      nextY = roundMm(clamp(nextY, inner.y, inner.y + inner.h));
    }
  }
  if (locks.y !== undefined) {
    nextY = locks.y;
    if (locks.y === inner.y || locks.y === inner.y + inner.h) {
      nextX = roundMm(clamp(nextX, inner.x, inner.x + inner.w));
    }
  }
  return [nextX, nextY];
}

/**
 * 多角形の1頂点を動かす。linkPanels=true のA+連動は開始配置から直接見える
 * 接合点と、複数辺に分割された対向壁だけへ限定し、次の溝へは伝播しない。
 */
export function movePanelVertexWithSnap(
  panels: Panel[],
  panelIndex: number,
  vertexIndex: number,
  x: number,
  y: number,
  linkPanels = false,
  canvas: CanvasSize = DEFAULT_CANVAS,
): void {
  const selectedPanel = panels[panelIndex];
  if (!selectedPanel) return;
  const selectedPoints = panelShapePoints(selectedPanel);
  const selectedPoint = selectedPoints[vertexIndex];
  if (!selectedPoint) return;
  const selectedTarget = constrainedSelectedPoint(selectedPanel, selectedPoint, x, y, canvas);
  const deltaX = roundMm(selectedTarget[0] - selectedPoint[0]);
  const deltaY = roundMm(selectedTarget[1] - selectedPoint[1]);
  const junctions = new Map<string, VertexJunctionReference>();
  const splitDeformations: VertexSplitDeformation[] = [];
  const splitKeys = new Set<string>();
  const addJunction = (candidate: VertexEdgeCandidate) => {
    const key = `${candidate.panelIndex}:${candidate.nearestVertexIndex}`;
    const current = junctions.get(key);
    if (!current || candidate.nearestDistance < current.distance) {
      junctions.set(key, {
        panelIndex: candidate.panelIndex,
        vertexIndex: candidate.nearestVertexIndex,
        distance: candidate.nearestDistance,
      });
    }
  };

  if (linkPanels) {
    const count = selectedPoints.length;
    const incidentEdges = [vertexIndex, (vertexIndex - 1 + count) % count];
    incidentEdges.forEach((selectedEdgeIndex) => {
      const selectedEdge = edgePoints(selectedPanel, selectedEdgeIndex);
      if (!selectedEdge) return;
      const fixedPoint = selectedEdgeIndex === vertexIndex ? selectedEdge[1] : selectedEdge[0];
      const candidates = vertexEdgeCandidates(panels, panelIndex, selectedPoint, fixedPoint, canvas);
      const originWallCandidates = candidates.filter((candidate) => (
        // 選択点をまたぐ辺は、投影の重なりが8mm未満でも局所接合の対向壁になり得る。
        candidate.projectionMin <= PANEL_EDGE_ALIGNMENT_TOLERANCE_MM
        && candidate.projectionMax >= -PANEL_EDGE_ALIGNMENT_TOLERANCE_MM
        && candidate.nearestDistance <= PANEL_VERTEX_JUNCTION_CORNER_MM
      ));
      const visibleOriginWalls = nearestOriginWallLayer(originWallCandidates);
      const splitOriginWallCandidates = candidates.filter((candidate) => candidate.sharesProjection
        // 分割壁は選択点を横切らなくても、近端が局所接合の範囲内なら同じ壁層として扱う。
        && candidate.originGap <= PANEL_VERTEX_JUNCTION_ALONG_GAP_MM
        && candidate.nearestDistance <= PANEL_VERTEX_JUNCTION_CORNER_MM);
      const visibleSplitOriginWalls = nearestOriginWallLayer(splitOriginWallCandidates);
      const groups = splitWallGroups(candidates)
        // 分割壁も選択点から見える最前面レイヤーだけ。狭いコマの反対壁へ渡らない。
        .filter((group) => group.some((candidate) => visibleSplitOriginWalls.includes(candidate)));
      const groupedEdges = new Set<string>();
      groups.forEach((group) => group.forEach((candidate) => {
        const key = `${candidate.panelIndex}:${candidate.edgeIndex}`;
        groupedEdges.add(key);
        const deformationKey = `${selectedEdgeIndex}>${key}`;
        if (splitKeys.has(deformationKey)) return;
        splitKeys.add(deformationKey);
        splitDeformations.push({ selectedEdgeIndex, panelIndex: candidate.panelIndex, edgeIndex: candidate.edgeIndex });
      }));

      const nearbyExtensions = candidates.filter((candidate) => !candidate.sharesProjection
        && candidate.originGap <= PANEL_VERTEX_JUNCTION_ALONG_GAP_MM
        && candidate.nearestDistance <= PANEL_VERTEX_JUNCTION_CORNER_MM);
      const continuations = nearbyExtensions.filter((candidate) => (
        // 局所接合は選択点側へ続く辺だけ。固定端の先にある無関係な短辺は拾わない。
        candidate.projectionMax <= PANEL_EDGE_ALIGNMENT_TOLERANCE_MM
      ));
      continuations.forEach(addJunction);

      // 単独の対向壁は辺全体を平行化せず、開始点側の近端だけを接合として動かす。
      const singletonOpposingJunctions = visibleOriginWalls
        .filter((candidate) => !groupedEdges.has(`${candidate.panelIndex}:${candidate.edgeIndex}`))
        .filter((candidate) => {
          const sameWallContinuation = continuations.some((continuation) => sameNormalSide(
            continuation.signedNormalDistance,
            candidate.signedNormalDistance,
          ) && Math.abs(continuation.signedNormalDistance - candidate.signedNormalDistance)
            <= PANEL_VERTEX_WALL_OFFSET_TOLERANCE_MM);
          return !sameWallContinuation;
        });
      singletonOpposingJunctions.forEach(addJunction);
    });
  }

  const originalPanelPoints = panels.map(panelShapePoints);
  const nextPanelPoints = originalPanelPoints.map((points) => points.map((point): [number, number] => [
    roundMm(point[0]),
    roundMm(point[1]),
  ]));
  nextPanelPoints[panelIndex][vertexIndex] = selectedTarget;

  junctions.forEach((reference) => {
    const original = originalPanelPoints[reference.panelIndex]?.[reference.vertexIndex];
    const panel = panels[reference.panelIndex];
    if (!original || !panel) return;
    nextPanelPoints[reference.panelIndex][reference.vertexIndex] = constrainedJunctionPoint(
      panel,
      original,
      original[0] + deltaX,
      original[1] + deltaY,
      canvas,
    );
  });

  const constraints = new Map<string, LineConstraint[]>();
  splitDeformations.forEach((deformation) => {
    const selectedStartIndex = deformation.selectedEdgeIndex;
    const selectedEndIndex = (selectedStartIndex + 1) % selectedPoints.length;
    const oldStart = originalPanelPoints[panelIndex][selectedStartIndex];
    const oldEnd = originalPanelPoints[panelIndex][selectedEndIndex];
    const newStart = nextPanelPoints[panelIndex][selectedStartIndex];
    const newEnd = nextPanelPoints[panelIndex][selectedEndIndex];
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
    const linePoint: [number, number] = [
      newStart[0] + newNormal[0] * distance,
      newStart[1] + newNormal[1] * distance,
    ];
    const oldLengthSquared = oldVectorX * oldVectorX + oldVectorY * oldVectorY;
    const directionChange = Math.abs(oldVectorX * newVectorY - oldVectorY * newVectorX) / (oldLength * newLength);
    candidateIndices.forEach((candidateIndex) => {
      const key = `${deformation.panelIndex}:${candidateIndex}`;
      if (junctions.has(key)) return;
      const candidate = candidatePoints[candidateIndex];
      const parameter = ((candidate[0] - oldStart[0]) * oldVectorX
        + (candidate[1] - oldStart[1]) * oldVectorY) / oldLengthSquared;
      const line: LineConstraint = {
        point: linePoint,
        vector: [newVectorX, newVectorY],
        preferred: directionChange > 0.01 ? [
          linePoint[0] + newVectorX * parameter,
          linePoint[1] + newVectorY * parameter,
        ] : undefined,
      };
      constraints.set(key, [...(constraints.get(key) ?? []), line]);
    });
  });

  constraints.forEach((lines, key) => {
    const [pi, vi] = key.split(':').map(Number);
    const original = originalPanelPoints[pi]?.[vi];
    const panel = panels[pi];
    if (!original || !panel || !lines.length) return;
    const locks = pointBoundaryLocks(panel, original, undefined, canvas);
    const bounds = pointLegalBounds(panel, original, canvas);
    if (locks.x !== undefined && locks.y !== undefined) {
      nextPanelPoints[pi][vi] = [locks.x, locks.y];
      return;
    }
    if (locks.x !== undefined || locks.y !== undefined) {
      const boundary: LineConstraint = locks.x !== undefined
        ? { point: [locks.x, 0], vector: [0, 1] }
        : { point: [0, locks.y!], vector: [1, 0] };
      const target = lines.map((line) => lineIntersection(line, boundary))
        .filter((point): point is [number, number] => point !== null)
        .filter((point) => pointWithinLegalBounds(point, bounds))
        .sort((left, right) => Math.hypot(left[0] - original[0], left[1] - original[1])
          - Math.hypot(right[0] - original[0], right[1] - original[1]))[0] ?? original;
      nextPanelPoints[pi][vi] = [roundMm(target[0]), roundMm(target[1])];
      return;
    }

    const intersections: [number, number][] = [];
    let hasNonParallelPair = false;
    for (let first = 0; first < lines.length; first += 1) {
      for (let second = first + 1; second < lines.length; second += 1) {
        const intersection = lineIntersection(lines[first], lines[second]);
        if (!intersection) continue;
        hasNonParallelPair = true;
        if (pointWithinLegalBounds(intersection, bounds)) intersections.push(intersection);
      }
    }
    if (intersections.length) {
      const target = intersections.sort((left, right) => Math.hypot(left[0] - original[0], left[1] - original[1])
        - Math.hypot(right[0] - original[0], right[1] - original[1]))[0];
      nextPanelPoints[pi][vi] = [roundMm(target[0]), roundMm(target[1])];
      return;
    }
    if (hasNonParallelPair) {
      // 2本の拘束を同時に満たす合法点がない時は、成分別に歪めず開始時の合法点へ残す。
      nextPanelPoints[pi][vi] = [roundMm(original[0]), roundMm(original[1])];
      return;
    }
    const preferred = lines[0].preferred ?? constrainedPointOnLine(original, lines[0]);
    nextPanelPoints[pi][vi] = pointOnLineWithinBounds(lines[0], preferred, bounds)
      ?? [roundMm(original[0]), roundMm(original[1])];
  });

  const affectedPanels = new Set<number>([panelIndex]);
  junctions.forEach((reference) => affectedPanels.add(reference.panelIndex));
  splitDeformations.forEach((deformation) => affectedPanels.add(deformation.panelIndex));
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
  [...(panel.images ?? []), ...(panel.background_images ?? [])].forEach(image => { image.bbox.x += deltaX; image.bbox.y += deltaY; });
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
  // Map the centre into the resized panel, but preserve artwork proportions.
  const transformArtwork = (box: BBox) => {
    const cx = next.x + (box.x + box.w / 2 - original.x) * scaleX;
    const cy = next.y + (box.y + box.h / 2 - original.y) * scaleY;
    const scale = Math.min(scaleX, scaleY);
    box.w *= scale; box.h *= scale;
    box.x = cx - box.w / 2; box.y = cy - box.h / 2;
  };
  [...(panel.images ?? []), ...(panel.background_images ?? [])].forEach(image => transformArtwork(image.bbox));
  panel.figures?.forEach((figure) => { if (figure.bbox) (figure.artwork ? transformArtwork : transformBox)(figure.bbox); });
  panel.bubbles.forEach((bubble) => { if (bubble.bbox) transformBox(bubble.bbox); });
  panel.screen_text?.forEach((screenText) => { if (screenText.bbox) transformBox(screenText.bbox); });
}

/**
 * The editable page coordinates end at the trim line. A rectangular panel dragged
 * beyond that line is stored on the page edge and records the crossed sides in
 * OMNY `bleed`; dragging the edge back inside clears that side again.
 */
export function syncPanelBleedAtTrim(panel: Panel, canvas: CanvasSize, bleedMm: number): boolean {
  if (panel.shape.type !== 'rect' || !Number.isFinite(bleedMm) || bleedMm <= 0) return false;
  const original = panelBounds(panel);
  const existing = new Set(panel.bleed ?? []);
  const epsilon = 0.02;
  const right = original.x + original.w;
  const bottom = original.y + original.h;
  const crossed: Record<BleedEdge, boolean> = {
    left: original.x < -epsilon || (existing.has('left') && original.x <= epsilon),
    right: right > canvas.w + epsilon || (existing.has('right') && right >= canvas.w - epsilon),
    top: original.y < -epsilon || (existing.has('top') && original.y <= epsilon),
    bottom: bottom > canvas.h + epsilon || (existing.has('bottom') && bottom >= canvas.h - epsilon),
  };
  const left = crossed.left ? 0 : clamp(original.x, 0, canvas.w - 1);
  const top = crossed.top ? 0 : clamp(original.y, 0, canvas.h - 1);
  const normalizedRight = crossed.right ? canvas.w : clamp(right, left + 1, canvas.w);
  const normalizedBottom = crossed.bottom ? canvas.h : clamp(bottom, top + 1, canvas.h);
  const normalized = { x: left, y: top, w: normalizedRight - left, h: normalizedBottom - top };
  const edges = (['left', 'right', 'top', 'bottom'] as const).filter((edge) => crossed[edge]);
  const geometryChanged = Math.abs(normalized.x - original.x) > epsilon
    || Math.abs(normalized.y - original.y) > epsilon
    || Math.abs(normalized.w - original.w) > epsilon
    || Math.abs(normalized.h - original.h) > epsilon;
  if (geometryChanged) resizePanelToBounds(panel, normalized);
  const previous = panel.bleed ?? [];
  const bleedChanged = previous.length !== edges.length || previous.some((edge, index) => edge !== edges[index]);
  if (edges.length) panel.bleed = [...edges];
  else delete panel.bleed;
  return geometryChanged || bleedChanged;
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
