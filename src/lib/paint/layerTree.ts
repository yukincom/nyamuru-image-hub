import type { PaintLayer, PaintColorMode, PaintFolder, PaintStackPosition, PaintDocument } from '../../types.ts';
import type { PaintScene } from './scene.ts';

export function newPaintLayer(name = 'レイヤー',kind:PaintLayer['kind']='raster',colorMode:PaintColorMode='color'): PaintLayer {
  return { id: crypto.randomUUID(), name, visible: true, locked: false, opacity: 1, blend: 'normal', strokes: [],kind,colorMode,antialias:3,...(kind==='vector'?{paths:[]}: {}) };
}

/** The page sequence belongs to the edit, never to the editable display name. */
export function newNumberedPaintLayer(sequence:number,kind:PaintLayer['kind']='raster',colorMode:PaintColorMode='color'):PaintLayer {
  return newPaintLayer(`レイヤー ${sequence+1}`,kind,colorMode);
}

export type PaintLayerTreeEntry={kind:'layer';layer:PaintLayer}|{kind:'folder';folder:PaintFolder;children:PaintLayerTreeEntry[]};

export type PaintLayerDropTarget=
  | {kind:'layer';id:string;after:boolean}
  | {kind:'folder';id:string;placement:'above'|'inside'|'below'}
  | {kind:'root';edge:'top'|'bottom';aboveNative?:boolean};

/** A destination in the existing page palette, independent of where a layer was created. */
export interface PaintLayerDestination { panelIndex:number; overlay:boolean; key:string; stack?:PaintStackPosition; scene?:PaintScene }

/** Build the palette tree without changing the canonical bottom-to-top render order. */
export function paintLayerTree(paint:PaintDocument):PaintLayerTreeEntry[]{
  const folders=paint.folders??[];
  const layerIndex=new Map(paint.layers.map((layer,index)=>[layer.id,index]));
  function siblings(parentId?:string):{entries:PaintLayerTreeEntry[];firstLeaf:number} {
    const items:{entry:PaintLayerTreeEntry;position:number}[]=[];
    let firstLeaf=Infinity;
    for(const folder of folders){
      if(folder.parentFolderId!==parentId)continue;
      const branch=siblings(folder.id);
      firstLeaf=Math.min(firstLeaf,branch.firstLeaf);
      items.push({entry:{kind:'folder',folder,children:branch.entries},
        position:Number.isFinite(branch.firstLeaf)?branch.firstLeaf:folder.position});
    }
    for(const layer of paint.layers){
      if(layer.folderId!==parentId)continue;
      const index=layerIndex.get(layer.id)!;
      firstLeaf=Math.min(firstLeaf,index);
      items.push({entry:{kind:'layer',layer},position:index});
    }
    // Stable ties keep empty folders in saved order, before the leaf at that boundary.
    return {entries:items.sort((a,b)=>a.position-b.position).map(item=>item.entry),firstLeaf};
  }
  return siblings().entries;
}

export function paintNativeBand(paint:PaintDocument,above:boolean):PaintDocument {
  const folders=paint.folders?.filter(folder=>Boolean(folder.aboveNative)===above);
  return {...paint,folders,layers:paint.layers.filter(layer=>paintLayerAboveNative(paint,layer)===above)};
}

export function paintLayerAboveNative(paint:PaintDocument,layer:PaintLayer):boolean {
  const folder=paint.folders?.find(folder=>folder.id===layer.folderId);
  return Boolean(folder?folder.aboveNative:layer.aboveNative);
}

export function addPaintFolder(paint:PaintDocument):{paint:PaintDocument;folder:PaintFolder}{
  const folders=paint.folders??[],folder={id:crypto.randomUUID(),name:`フォルダー ${folders.length+1}`,position:paint.layers.length};
  return {folder,paint:{...paint,folders:[...folders,folder]}};
}

/** Encode the visible sibling order once; empty folders keep their own place. */
export function withPaintLayerTree(paint:PaintDocument,entries:PaintLayerTreeEntry[]):PaintDocument {
  const layers:PaintLayer[]=[],folders:PaintFolder[]=[];
  function write(items:PaintLayerTreeEntry[],parent?:PaintFolder){
    for(const entry of items){
      if(entry.kind==='layer'){
        const layer=entry.layer;
        const above=parent?parent.aboveNative:layer.aboveNative;
        layers.push(layer.folderId===parent?.id&&Boolean(layer.aboveNative)===Boolean(above)?layer:
          {...layer,folderId:parent?.id,aboveNative:above});
      }else{
        const folder=entry.folder,above=parent?parent.aboveNative:folder.aboveNative;
        const saved=folder.position===layers.length&&folder.parentFolderId===parent?.id&&Boolean(folder.aboveNative)===Boolean(above)?folder:
          {...folder,position:layers.length,parentFolderId:parent?.id,aboveNative:above};
        folders.push(saved);
        write(entry.children,saved);
      }
    }
  }
  write(entries);
  if(layers.length===paint.layers.length&&layers.every((item,i)=>paint.layers[i]===item)
    &&folders.length===(paint.folders?.length??0)&&folders.every((item,i)=>paint.folders?.[i]===item))return paint;
  return {...paint,layers,folders};
}

interface TreeLocation {siblings:PaintLayerTreeEntry[];index:number;entry:PaintLayerTreeEntry}

export function locate(entries:PaintLayerTreeEntry[],kind:'layer'|'folder',id:string):TreeLocation|undefined {
  for(const [index,entry] of entries.entries()){
    if(entry.kind===kind&&(entry.kind==='layer'?entry.layer.id:entry.folder.id)===id)return {siblings:entries,index,entry};
    if(entry.kind==='folder'){
      const child=locate(entry.children,kind,id);
      if(child)return child;
    }
  }
}

/** Resolve the destination after detaching the branch. Its descendants are no longer valid targets. */
export function insertEntry(tree:PaintLayerTreeEntry[],entry:PaintLayerTreeEntry,target:PaintLayerDropTarget):TreeLocation|undefined {
  let siblings=tree,index:number,above:boolean|undefined;
  if(target.kind==='root'){
    index=target.edge==='top'?tree.length:0;
    above=target.aboveNative;
  }else{
    const anchor=locate(tree,target.kind,target.id);
    if(!anchor)return;
    above=anchor.entry.kind==='folder'?anchor.entry.folder.aboveNative:anchor.entry.layer.aboveNative;
    if(target.kind==='folder'&&target.placement==='inside'&&anchor.entry.kind==='folder'){
      siblings=anchor.entry.children;
      index=siblings.length;
    }else{
      siblings=anchor.siblings;
      const higher=target.kind==='folder'?target.placement==='above':!target.after;
      index=anchor.index+Number(higher);
    }
  }
  if(above!==undefined||target.kind!=='root'){
    if(entry.kind==='layer'&&Boolean(entry.layer.aboveNative)!==Boolean(above))entry={...entry,layer:{...entry.layer,aboveNative:above||undefined}};
    if(entry.kind==='folder'&&Boolean(entry.folder.aboveNative)!==Boolean(above))entry={...entry,folder:{...entry.folder,aboveNative:above||undefined}};
  }
  siblings.splice(index,0,entry);
  return {siblings,index,entry};
}

export function moveLocalEntry(paint:PaintDocument,kind:'layer'|'folder',id:string,target:PaintLayerDropTarget):PaintDocument {
  const tree=paintLayerTree(paint),source=locate(tree,kind,id);
  if(!source)return paint;
  source.siblings.splice(source.index,1);
  const destination=insertEntry(tree,source.entry,target);
  if(!destination||source.siblings===destination.siblings&&source.index===destination.index&&source.entry===destination.entry)return paint;
  return withPaintLayerTree(paint,tree);
}

export function movePaintLayer(paint:PaintDocument,id:string,target:PaintLayerDropTarget):PaintDocument {
  return moveLocalEntry(paint,'layer',id,target);
}

export function movePaintFolder(paint:PaintDocument,id:string,target:PaintLayerDropTarget):PaintDocument {
  return moveLocalEntry(paint,'folder',id,target);
}

export function removePaintFolder(paint:PaintDocument,id:string):PaintDocument {
  const tree=paintLayerTree(paint),source=locate(tree,'folder',id);
  if(!source||source.entry.kind!=='folder')return paint;
  source.siblings.splice(source.index,1,...source.entry.children);
  return withPaintLayerTree(paint,tree);
}

export function removePaintLayer(paint:PaintDocument,id:string):PaintDocument {
  const tree=paintLayerTree(paint),source=locate(tree,'layer',id);
  if(!source)return paint;
  source.siblings.splice(source.index,1);
  return withPaintLayerTree(paint,tree);
}
