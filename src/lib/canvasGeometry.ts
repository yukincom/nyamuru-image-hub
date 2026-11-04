export {
  DEFAULT_CANVAS,
  innerFrameBounds,
  MIN_SIZE_MM,
  INNER_FRAME_BOUNDS,
  PANEL_SNAP_THRESHOLD_MM,
  PANEL_EDGE_LINK_DISTANCE_MM,
  PANEL_EDGE_ALIGNMENT_TOLERANCE_MM,
  DEFAULT_PANEL_GUTTERS,
  clamp,
  roundMm,
  constrainDragDeltaToAxis,
  resolveShiftAxisDrag,
  createShiftAxisSession,
  resolveShiftAxisSession,
  panelBounds,
  panelShapePoints,
} from './geometry/canvasBounds.ts';
export type {
  CanvasSize,
  ResizeHandle,
  InteractionGeometry,
  PanelGutterSettings,
  PanelEdgeReference,
  DragAxis,
  ShiftAxisDragState,
  ShiftAxisSessionState,
} from './geometry/canvasBounds.ts';
export { inferPanelGutters, findLinkedPanelEdges } from './geometry/panelBoundaries.ts';
export { snapPanelEdgeDeltaToGutter, snapPanelVertexPointToGutter, snapPanelEdgeDeltaToNeighbor } from './geometry/panelSnapping.ts';
export {
  anchorPoint,
  ANCHORS,
  nearestAnchor,
  fallbackBox,
  pointInPanel,
  panelFigureAt,
  panelHasElementAt,
  resolveOverlapClick,
} from './geometry/panelHitTesting.ts';
export {
  resizedBox,
  clampedPanelDelta,
  snapPanelDeltaToInnerFrame,
  snapPanelResizeToInnerFrame,
  snapPointToInnerFrame,
  resolveVertexDragStartZone,
  snapEdgeDeltaToInnerFrame,
} from './geometry/frameSnapping.ts';
export { movePanelEdge } from './geometry/edgeMovement.ts';
export { movePanelVertexWithSnap } from './geometry/vertexMovement.ts';
export { translatePanel, resizePanelToBounds, syncPanelBleedAtTrim, convertPanelShape } from './geometry/panelTransforms.ts';
