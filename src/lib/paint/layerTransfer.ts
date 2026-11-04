import type { PaintScene, PaintOwner } from './scene.ts';
import { type PaintLayerDropTarget, paintLayerTree, locate, moveLocalEntry, type PaintLayerTreeEntry, insertEntry, withPaintLayerTree } from './layerTree.ts';
import { paintOwnerLocked, paintFolderChain, paintLayerEditable } from '../paintLock.ts';
import type { PaintLayer } from '../../types.ts';
import { mapPaintLayer } from './layerMapping.ts';
import { expandPaintOwnerToContent } from './ownerEdits.ts';

/** Originals belong to their enclosing generation target, never to a separate generation group. */
export function paintGenerationOwner(scene:PaintScene,key:string):PaintOwner|undefined {
  const selected=scene.owners.find(owner=>owner.key===key),owner=selected?.parentKey?scene.owners.find(owner=>owner.key===selected.parentKey):selected;
  return owner&&['figure','background','bubble'].includes(owner.kind)?owner:undefined;
}

/** Use the same tree move for local and cross-owner drops; retain layer/folder identities. */
export function movePaintEntry(source:PaintOwner,destination:PaintOwner,kind:'layer'|'folder',id:string,target:PaintLayerDropTarget):{source:PaintOwner;destination:PaintOwner}|undefined {
  if(paintOwnerLocked(source)||paintOwnerLocked(destination))return;
  const tree=paintLayerTree(source.paint),branch=locate(tree,kind,id);
  if(!branch)return;
  const entry=branch.entry;
  const within=(folderId?:string)=>paintFolderChain(source.paint,folderId).some(folder=>folder.id===id);
  const folders=kind==='folder'?(source.paint.folders??[]).filter(folder=>within(folder.id)):[];
  const layers=kind==='folder'?source.paint.layers.filter(layer=>within(layer.folderId)):source.paint.layers.filter(layer=>layer.id===id);
  if(folders.some(folder=>folder.locked)||entry.kind==='folder'&&paintFolderChain(source.paint,entry.folder.parentFolderId).some(folder=>folder.locked)
    ||layers.some(layer=>!paintLayerEditable(source,layer)))return;
  const anchorFolder=target.kind==='folder'?destination.paint.folders?.find(folder=>folder.id===target.id):undefined;
  const anchorLayer=target.kind==='layer'?destination.paint.layers.find(layer=>layer.id===target.id):undefined;
  if(target.kind==='layer'&&!anchorLayer||target.kind==='folder'&&!anchorFolder)return;
  const parent=target.kind==='folder'&&target.placement==='inside'?anchorFolder?.id:anchorLayer?.folderId??anchorFolder?.parentFolderId;
  if(paintFolderChain(destination.paint,parent).some(folder=>folder.locked))return;
  if(source===destination){
    const paint=moveLocalEntry(source.paint,kind,id,target);
    if(paint===source.paint)return;
    const updated={...source,paint};
    return {source:updated,destination:updated};
  }
  if(destination.paint.layers.length+layers.length>64||(destination.paint.folders?.length??0)+folders.length>64)return;
  if(layers.some(layer=>destination.paint.layers.some(item=>item.id===layer.id))
    ||folders.some(folder=>destination.paint.folders?.some(item=>item.id===folder.id)))return;
  const px=destination.paint.width/destination.frame.w,py=destination.paint.height/destination.frame.h;
  const sx=source.frame.w/source.paint.width*px,sy=source.frame.h/source.paint.height*py;
  const dx=(source.frame.x-destination.frame.x)*px,dy=(source.frame.y-destination.frame.y)*py;
  const movedLayers:PaintLayer[]=[];
  function mapEntry(item:PaintLayerTreeEntry):PaintLayerTreeEntry {
    if(item.kind==='folder')return {...item,children:item.children.map(mapEntry)};
    const {layer}=item;
    const moved=mapPaintLayer({...layer,guide:undefined,
      ...((layer.tone?.fill||layer.strokes.some(stroke=>(stroke.tool==='fill'||stroke.tool==='clear')&&!stroke.selection))&&!layer.clip?{clip:{x:0,y:0,w:source.paint.width,h:source.paint.height}}:{})},dx,dy,sx,sy);
    if(moved.tone){
      const lpi=moved.tone.lpi*destination.paint.dpi/source.paint.dpi/Math.sqrt(sx*sy);
      if(lpi>1000)throw new Error('移動先の描画解像度ではトーンの線数を保持できません');
      moved.tone={...moved.tone,lpi};
    }
    movedLayers.push(moved);
    return {kind:'layer',layer:moved};
  }
  const destinationTree=paintLayerTree(destination.paint);
  if(!insertEntry(destinationTree,mapEntry(entry),target))return;
  branch.siblings.splice(branch.index,1);
  const paint=withPaintLayerTree(destination.paint,destinationTree);
  return {source:{...source,paint:{...withPaintLayerTree(source.paint,tree),guideInitialized:true}},
    destination:expandPaintOwnerToContent({...destination,paint},movedLayers)};
}

/** Empty initialized artwork retains the absence of its guide across later edits. */
export function paintOwnerShouldClear(owner:PaintOwner):boolean {
  return !owner.paint.layers.length&&!owner.paint.folders?.length&&(!owner.paint.guideInitialized||owner.kind==='page'||owner.kind==='panel'||owner.kind==='original');
}
