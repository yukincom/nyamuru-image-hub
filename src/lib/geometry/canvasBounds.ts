import type { BBox, Panel } from '../../types';

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

export const PANEL_VERTEX_JUNCTION_ALONG_GAP_MM = PANEL_EDGE_LINK_DISTANCE_MM + PANEL_SNAP_THRESHOLD_MM;

export const PANEL_VERTEX_JUNCTION_CORNER_MM = 13;

export const PANEL_VERTEX_WALL_OFFSET_TOLERANCE_MM = PANEL_SNAP_THRESHOLD_MM;

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
