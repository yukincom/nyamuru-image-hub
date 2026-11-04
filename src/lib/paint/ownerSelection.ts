import type { MangaPage, CanvasElementSelection, PaintStackPosition, PaintLayer } from '../../types.ts';
import { type PaintScene, orderedPaintOwners, type PaintOwner } from './scene.ts';
import { paintStackTarget, directPaintOwnerKey, type PaintAddPosition } from './ownerKeys.ts';
import { paintFolderChain } from '../paintLock.ts';
import { paintLayerAboveNative, newNumberedPaintLayer, movePaintLayer } from './layerTree.ts';

/** Layout selection is not a paint selection; callers choose any drawing fallback explicitly. */
export function canvasPaintOwnerKey(page:MangaPage|undefined,panelIndex:number,selection:CanvasElementSelection|null|undefined):string|undefined {
  if(!page||!selection)return;
  if(selection.type==='image'){
    if(selection.scope==='page_overlay')return;
    const image=(selection.scope==='page'?page.images:page.panels[panelIndex]?.images)?.[selection.index];
    return image?.bubbleOriginal?`original-${image.id}`:undefined;
  }
  if(selection.scope==='page')return;
  const target=selection.scope==='page_overlay'?page.page_overlay:page.panels[panelIndex];
  if(selection.type==='figure'&&target?.figures?.[selection.index])return `figure-${selection.index}`;
  if(selection.type==='bubble'&&target?.bubbles?.[selection.index])return `bubble-${selection.index}`;
}

/** Owner headings select layout elements; child layers and backgrounds stay in paint. */
export function paintOwnerCanvasSelection(page:MangaPage|undefined,panelIndex:number,key:string,overlay=false):CanvasElementSelection|undefined {
  if(!page)return;
  const match=/^(figure|bubble)-(\d+)$/.exec(key);
  const selection:CanvasElementSelection|undefined=match
    ?{type:match[1] as 'figure'|'bubble',index:Number(match[2]),...(overlay?{scope:'page_overlay' as const}:{})}
    :key.startsWith('original-')
      ?{type:'image',index:(overlay?page.images:page.panels[panelIndex]?.images)?.findIndex(image=>image.id===key.slice(9))??-1,...(overlay?{scope:'page' as const}:{})}
      :undefined;
  return canvasPaintOwnerKey(page,panelIndex,selection)===key?selection:undefined;
}

/** Direct artwork keeps the existing owner/write path, with a distinct sibling position. */
export function ensureDirectPaintOwner(scene:PaintScene,stack?:PaintStackPosition):{scene:PaintScene;key:string}|undefined {
  const root=scene.owners.find(item=>(item.kind==='panel'||item.kind==='page')&&!item.stack);
  if(!root)return;
  if(stack){
    const target=paintStackTarget(stack,scene.anchorIds);if(!target)return;
    const anchorIds={...scene.anchorIds},id=anchorIds[target]||crypto.randomUUID();anchorIds[target]=id;
    stack='below' in stack?{below:`layer:${id}`}:{beforePanel:`layer:${id}`};
    scene={...scene,anchorIds};
  }
  const key=directPaintOwnerKey(root.kind as 'panel'|'page',stack);
  if(scene.owners.some(item=>item.key===key))return {scene,key};
  const paint={...root.paint,layers:[],folders:[]};
  const owner={...root,key,stack,paint};
  return {scene:{...scene,owners:orderedPaintOwners([...scene.owners,owner],scene.anchorIds)},key};
}

/** Resolve selection once; insertion itself uses the existing tree mover. */
export function paintAddPosition(owner:PaintOwner,id:string|undefined,folded:(id:string)=>boolean):PaintAddPosition {
  const folder=owner.paint.folders?.find(item=>item.id===id),layer=owner.paint.layers.find(item=>item.id===id);
  const parent=folder??owner.paint.folders?.find(item=>item.id===layer?.folderId);
  const outerBarrier=paintFolderChain(owner.paint,parent?.id).reverse().find(item=>item.locked||folded(item.id));
  if(outerBarrier)return {target:{kind:'folder',id:outerBarrier.id,placement:'below'},aboveNative:outerBarrier.aboveNative};
  if(folder)return {target:{kind:'folder',id:folder.id,placement:'inside'},aboveNative:folder.aboveNative};
  if(layer)return {target:{kind:'layer',id:layer.id,after:true},aboveNative:paintLayerAboveNative(owner.paint,layer)};
  return {aboveNative:owner.kind==='bubble'};
}

export function addPaintLayer(scene:PaintScene,key:string,kind:'raster'|'vector',position:PaintAddPosition={}):{scene:PaintScene;layer:PaintLayer;key:string}|undefined {
  if(position.stack){const direct=ensureDirectPaintOwner(scene,position.stack);if(!direct)return;scene=direct.scene;key=direct.key;}
  const owner=scene.owners.find(item=>item.key===key);
  if(!owner||owner.locked||owner.inheritedLocked||owner.paint.layers.length>=64)return;
  const sequence=scene.layerSequence??0,layer={...newNumberedPaintLayer(sequence,kind,scene.colorMode),...(position.aboveNative?{aboveNative:true}:{})};
  const appended={...owner.paint,layers:[...owner.paint.layers,layer]};
  const paint=position.target?movePaintLayer(appended,layer.id,position.target):appended;
  return {key,layer:paint.layers.find(item=>item.id===layer.id)!,scene:{...scene,layerSequence:sequence+1,owners:scene.owners.map(item=>item===owner?{...item,paint}:item)}};
}
