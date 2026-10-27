import type { Bubble, PaintFolder, ImageContent, PaintDocument, PaintLayer, PlacedImage } from '../types.ts';
import type { PaintOwner } from './paintDocument.ts';

/** Folder state is inherited; each child's own eye and lock remain saved separately. */
export function paintLayerFolder(paint:PaintDocument,layer:PaintLayer):PaintFolder|undefined {
  return layer.folderId?paint.folders?.find(folder=>folder.id===layer.folderId):undefined;
}
export function paintLayerVisible(paint:PaintDocument,layer:PaintLayer):boolean {
  return layer.visible&&paintLayerFolder(paint,layer)?.visible!==false;
}
export function paintLayerInheritedLocked(owner:PaintOwner,layer:PaintLayer):boolean {
  return paintOwnerLocked(owner)||paintLayerFolder(owner.paint,layer)?.locked===true;
}
/** A source image's layer lock is independent of its placement/owner lock. */
export function paintOwnerLocked(owner:PaintOwner):boolean {
  return Boolean(owner.inheritedLocked||owner.locked||owner.bubble?.nativeLocked||(owner.kind!=='figure'&&owner.bubble?.paint_overlay?.locked));
}
export function paintLayerEditable(owner:PaintOwner,layer:PaintLayer):boolean {
  return !paintLayerInheritedLocked(owner,layer)&&!layer.locked;
}
/** Visibility and unlocking remain available from the layer list. */
export function paintLayerPatchAllowed(owner:PaintOwner,layer:PaintLayer,patch:Partial<PaintLayer>):boolean {
  const keys=Object.keys(patch);
  if(!keys.length)return false;
  if(keys.every(key=>key==='visible'))return true;
  if(paintLayerInheritedLocked(owner,layer))return false;
  return !layer.locked||keys.every(key=>key==='locked'||key==='visible');
}
export function paintLayerHasContent(layer:PaintLayer):boolean {
  return Boolean(layer.image||layer.strokes.length||layer.paths?.length||layer.tone?.fill||layer.guide);
}
/** Blank editable children don't make locked visible artwork movable. */
export function paintContentsLocked(paint:PaintDocument|undefined):boolean {
  const content=paint?.layers.filter(layer=>paintLayerVisible(paint!,layer)&&layer.opacity>0&&paintLayerHasContent(layer))??[];
  return content.length>0&&content.every(layer=>layer.locked||paintLayerFolder(paint!,layer)?.locked);
}
export function artworkLocked(image:(Pick<ImageContent,'locked'|'paint'>&Partial<Pick<PlacedImage,'id'|'bubbleOriginal'>>)|undefined,bubbles:readonly Bubble[]=[]):boolean {
  return Boolean(image?.locked)||paintContentsLocked(image?.paint)||Boolean(image?.bubbleOriginal&&bubbles.some(bubble=>bubble.locked&&bubble.analogTextImport?.originalImageId===image.id));
}
export function paintOwnerPlacementLocked(owner:PaintOwner):boolean {
  return paintOwnerLocked(owner)||paintContentsLocked(owner.paint);
}
