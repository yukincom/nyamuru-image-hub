export {
  canvasPaintOwnerKey,
  paintOwnerCanvasSelection,
  ensureDirectPaintOwner,
  paintAddPosition,
  addPaintLayer,
} from './paint/ownerSelection.ts';
export {
  newPaintLayer,
  newNumberedPaintLayer,
  paintLayerTree,
  paintNativeBand,
  paintLayerAboveNative,
  addPaintFolder,
  withPaintLayerTree,
  movePaintLayer,
  movePaintFolder,
  removePaintFolder,
  removePaintLayer,
} from './paint/layerTree.ts';
export type { PaintLayerTreeEntry, PaintLayerDropTarget, PaintLayerDestination } from './paint/layerTree.ts';
export {
  paintStackKey,
  directPaintOwnerKey,
  paintAnchorIds,
  paintStackTarget,
  paintStackMatches,
  directPaintImages,
  applyPaintAnchorIds,
} from './paint/ownerKeys.ts';
export type { PaintAddPosition } from './paint/ownerKeys.ts';
export { mapPaintStroke, mapPaintLayer } from './paint/layerMapping.ts';
export { paintGenerationOwner, movePaintEntry, paintOwnerShouldClear } from './paint/layerTransfer.ts';
export { paintAssetIds, validatePaintDocument } from './paint/documentValidation.ts';
export {
  paintForFrame,
  orderedPaintOwners,
  applyPaintOwnerLock,
  paintGuideView,
  figurePaintVisible,
  paintScene,
} from './paint/scene.ts';
export type { PaintOwner, PaintScene } from './paint/scene.ts';
export {
  paintReferenceBox,
  restoreFigureGuide,
  scalePaintOwner,
  expandPaintOwner,
  expandPaintOwnerToBounds,
  generatedPaintName,
  hasAdoptedPaintImages,
  insertGeneratedPaintImage,
  expandPaintOwnerToContent,
  withPaintBleed,
  paintInputBox,
  paintInputPoint,
  applyOwnerPaint,
  clearOwnerPaint,
} from './paint/ownerEdits.ts';
