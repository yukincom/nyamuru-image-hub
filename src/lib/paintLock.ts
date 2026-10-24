import type { ImageContent, PaintDocument, PaintLayer } from '../types.ts';
import type { PaintOwner } from './paintDocument.ts';

/** A source image's layer lock is independent of its placement/owner lock. */
export function paintOwnerLocked(owner:PaintOwner):boolean {
  return Boolean(owner.figure?.artwork?.locked||owner.bubble?.paint_overlay?.locked);
}
export function paintLayerEditable(owner:PaintOwner,layer:PaintLayer):boolean {
  return !paintOwnerLocked(owner)&&!layer.locked;
}
/** Visibility and unlocking remain available from the layer list. */
export function paintLayerPatchAllowed(owner:PaintOwner,layer:PaintLayer,patch:Partial<PaintLayer>):boolean {
  const keys=Object.keys(patch);
  if(!keys.length)return false;
  if(keys.every(key=>key==='visible'))return true;
  if(paintOwnerLocked(owner))return false;
  return !layer.locked||keys.every(key=>key==='locked'||key==='visible');
}
export function paintLayerHasContent(layer:PaintLayer):boolean {
  return Boolean(layer.image||layer.strokes.length||layer.paths?.length||layer.tone?.fill||layer.guide);
}
/** Blank editable children don't make locked visible artwork movable. */
export function paintContentsLocked(paint:PaintDocument|undefined):boolean {
  const content=paint?.layers.filter(layer=>layer.visible&&layer.opacity>0&&paintLayerHasContent(layer))??[];
  return content.length>0&&content.every(layer=>layer.locked);
}
export function artworkLocked(image:Pick<ImageContent,'locked'|'paint'>|undefined):boolean {
  return Boolean(image?.locked)||paintContentsLocked(image?.paint);
}
export function paintOwnerPlacementLocked(owner:PaintOwner):boolean {
  return paintOwnerLocked(owner)||paintContentsLocked(owner.paint);
}
