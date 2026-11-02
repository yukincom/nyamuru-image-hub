import { validPaintInk } from './paintInk.ts';
import { mapBackgroundCapture, validateBackgroundCapture } from './background3d.ts';
import { bubbleArtIndices, panelArtKeys } from './panelLayers.ts';
import { letteringFigureIndex } from './bubbleRelations.ts';
import { transformVector } from './vectorGeometry.ts';
import type { BBox, Bubble, CanvasElementSelection, Figure, ImageAsset, MangaPage, PageOverlay, PaintColorMode, PaintDocument, PaintFolder, PaintLayer, PaintStroke, PaintStackPosition, Panel, PlacedImage } from '../types.ts';
import { fallbackBox, panelBounds } from './canvasGeometry.ts';
import { artworkPixelSize } from './artworkClipboard.ts';
import { paintFolderChain, paintLayerHasContent, paintLayerVisible, paintLayerEditable, paintOwnerLocked } from './paintLock.ts';
import { figureDisplayLabel, textDisplayLabel } from './displayLabels.ts';
import {paintStrokeContentBounds} from './paintStroke.ts';

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

export function newPaintLayer(name = 'レイヤー',kind:PaintLayer['kind']='raster',colorMode:PaintColorMode='color'): PaintLayer {
  return { id: crypto.randomUUID(), name, visible: true, locked: false, opacity: 1, blend: 'normal', strokes: [],kind,colorMode,antialias:3,...(kind==='vector'?{paths:[]}: {}) };
}
/** The page sequence belongs to the edit, never to the editable display name. */
export function newNumberedPaintLayer(sequence:number,kind:PaintLayer['kind']='raster',colorMode:PaintColorMode='color'):PaintLayer {
  return newPaintLayer(`レイヤー ${sequence+1}`,kind,colorMode);
}
export interface PaintAddPosition { target?:PaintLayerDropTarget; stack?:PaintStackPosition; aboveNative?:boolean }
export const paintStackKey=(stack?:PaintStackPosition):string=>stack?('below' in stack?`below:${stack.below}`:`panel:${stack.beforePanel}`):'';
export const directPaintOwnerKey=(scope:'panel'|'page',stack?:PaintStackPosition):string=>stack?`${scope}:${paintStackKey(stack)}`:scope;
/** Native keys are UI positions; saved sibling positions refer to persistent identities. */
export function paintAnchorIds(panel:Pick<Panel,'figures'|'bubbles'|'screen_text'|'images'>,panels?:Panel[]):Record<string,string> {
  const ids:Record<string,string>={background:'background'};
  for(const [kind,items] of [['figure',panel.figures],['bubble',panel.bubbles],['screen-text',panel.screen_text]] as const)
    items?.forEach((item,index)=>{ids[`${kind}-${index}`]=item.layerId??'';});
  panel.images?.filter(image=>image.bubbleOriginal).forEach(image=>{ids[`original-${image.id}`]=image.id;});
  panels?.forEach(panel=>{ids[`panel-${panel.id}`]=panel.layerId??'';});
  return ids;
}
export function paintStackTarget(stack:PaintStackPosition|undefined,ids:Record<string,string>={}):string|undefined {
  if(!stack)return;
  const value='below' in stack?stack.below:stack.beforePanel;
  if(value.startsWith('layer:'))return Object.keys(ids).find(key=>ids[key]===value.slice(6)&&('below' in stack?!key.startsWith('panel-'):key.startsWith('panel-')));
  return value in ids?value:undefined;
}
export function paintStackMatches(stack:PaintStackPosition|undefined,target:PaintStackPosition|undefined,ids:Record<string,string>={}):boolean {
  const key=paintStackTarget(stack,ids),wanted=target?paintStackTarget(target,ids):undefined;
  return target?key!==undefined&&key===wanted:key===undefined;
}
/** Match the scene's bottom-to-top root order, including artwork whose anchor was removed. */
export function directPaintImages(images:PlacedImage[]|undefined,scope:'panel'|'page',stack:PaintStackPosition|undefined,ids:Record<string,string>={}):PlacedImage[] {
  return (images??[]).filter(image=>image.paintScope===scope&&paintStackMatches(image.paintStack,stack,ids))
    .sort((a,b)=>Number(!a.paintStack)-Number(!b.paintStack));
}
export function applyPaintAnchorIds(page:MangaPage,panelIndex:number,overlay:boolean,ids:Record<string,string>|undefined):void {
  const source=overlay?page.page_overlay:page.panels[panelIndex];
  for(const [key,id] of Object.entries(ids??{})){
    if(!id)continue;
    const match=/^(figure|bubble|screen-text|panel)-(\d+)$/.exec(key);if(!match)continue;
    const index=Number(match[2]);
    const item=match[1]==='panel'?page.panels.find(panel=>panel.id===index):match[1]==='figure'?source?.figures?.[index]:match[1]==='bubble'?source?.bubbles?.[index]:source?.screen_text?.[index];
    if(item)item.layerId=id;
  }
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
function withPaintLayerTree(paint:PaintDocument,entries:PaintLayerTreeEntry[]):PaintDocument {
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
function locate(entries:PaintLayerTreeEntry[],kind:'layer'|'folder',id:string):TreeLocation|undefined {
  for(const [index,entry] of entries.entries()){
    if(entry.kind===kind&&(entry.kind==='layer'?entry.layer.id:entry.folder.id)===id)return {siblings:entries,index,entry};
    if(entry.kind==='folder'){
      const child=locate(entry.children,kind,id);
      if(child)return child;
    }
  }
}

/** Resolve the destination after detaching the branch. Its descendants are no longer valid targets. */
function insertEntry(tree:PaintLayerTreeEntry[],entry:PaintLayerTreeEntry,target:PaintLayerDropTarget):TreeLocation|undefined {
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

function moveLocalEntry(paint:PaintDocument,kind:'layer'|'folder',id:string,target:PaintLayerDropTarget):PaintDocument {
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

export function mapPaintStroke(stroke:PaintStroke,dx:number,dy:number,sx=1,sy=sx):PaintStroke {
  return {...stroke,size:stroke.size*Math.sqrt(sx*sy),
    ...(stroke.selection?{selection:stroke.selection.map(b=>({x:dx+b.x*sx,y:dy+b.y*sy,w:b.w*sx,h:b.h*sy}))}:{}),
    points:stroke.points.map(p=>({...p,x:dx+p.x*sx,y:dy+p.y*sy}))};
}
/** Map every editable part together; image crops remain in their original asset coordinates. */
export function mapPaintLayer(layer:PaintLayer,dx:number,dy:number,sx=1,sy=sx):PaintLayer {
  const box=(b:BBox):BBox=>({x:dx+b.x*sx,y:dy+b.y*sy,w:b.w*sx,h:b.h*sy});
  const stroke=(s:PaintStroke)=>mapPaintStroke(s,dx,dy,sx,sy);
  return {...layer,strokes:layer.strokes.map(stroke),
    ...(layer.image?{image:{...layer.image,bbox:box(layer.image.bbox)}}:{}),
    ...(layer.clip?{clip:box(layer.clip)}:{}),
    ...(layer.paths?{paths:layer.paths.map(path=>transformVector(path,dx,dy,sx,sy))}:{}),
    ...(layer.mask?{mask:{...layer.mask,strokes:layer.mask.strokes.map(stroke)}}:{}),
    ...(layer.tone?{tone:{...layer.tone,origin:{x:dx+(layer.tone.origin?.x??0)*sx,y:dy+(layer.tone.origin?.y??0)*sy}}}:{})};
}

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
export function paintAssetIds(paint?: PaintDocument): string[] {
  return paint?.layers.flatMap(layer => layer.image ? [layer.image.assetId] : []) ?? [];
}
export function validatePaintDocument(value: PaintDocument, assets: readonly ImageAsset[],allowEmptyScene=false): void {
  const fail = () => { throw new Error('ペイントのレイヤーまたは参照画像が不正です'); };
  const box = (b?: BBox) => b && [b.x,b.y,b.w,b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;
  if (!value || value.version !== 1 || ![value.width,value.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 16384)
      || value.width * value.height > 100_000_000 || !Number.isFinite(value.dpi) || value.dpi <= 0
      || !Array.isArray(value.layers) || (!allowEmptyScene&&!value.guideInitialized&&!value.layers.length&&!value.folders?.length) || value.layers.length > 64
      || (value.folders!==undefined&&(!Array.isArray(value.folders)||value.folders.length>64))
      || (value.referenceFrame !== undefined && !box(value.referenceFrame))) fail();
  if(value.guideInitialized!==undefined&&typeof value.guideInitialized!=='boolean')fail();
  if(value.background3d!==undefined)validateBackgroundCapture(value.background3d);
  const folderIds=new Set<string>();
  for(const folder of value.folders??[]){
    if(!folder||typeof folder.id!=='string'||!folder.id||folderIds.has(folder.id)||typeof folder.name!=='string'||!folder.name||!Number.isSafeInteger(folder.position)||folder.position<0||folder.position>value.layers.length)fail();
    if(folder.visible!==undefined&&typeof folder.visible!=='boolean'||folder.locked!==undefined&&typeof folder.locked!=='boolean'||folder.aboveNative!==undefined&&typeof folder.aboveNative!=='boolean')fail();
    folderIds.add(folder.id);
  }
  const parents=new Map(value.folders?.map(folder=>[folder.id,folder.parentFolderId]));
  for(const folder of value.folders??[]){
    const seen=new Set([folder.id]);
    let parent=folder.parentFolderId;
    while(parent!==undefined){
      if(!folderIds.has(parent)||seen.has(parent))fail();
      seen.add(parent);
      parent=parents.get(parent);
    }
  }
  const ids = new Set<string>(); let points = 0;
  const validateStrokes=(strokes:PaintStroke[])=>{
    for(const stroke of strokes){
      if (!stroke || !['pen','eraser','line','rectangle','ellipse','fill','clear'].includes(stroke.tool) || (stroke.color!==null&&(typeof stroke.color!=='string'||!/^#[0-9a-f]{6}$/i.test(stroke.color)))
        || !Number.isFinite(stroke.size) || stroke.size <= 0 || !Array.isArray(stroke.points) || !stroke.points.length) fail();
      if(stroke.fill!==undefined&&!validPaintInk(stroke.fill))fail();
      if(stroke.selection!==undefined&&(!Array.isArray(stroke.selection)||stroke.selection.some(b=>!box(b))))fail();
      if((stroke.tool==='fill'||stroke.tool==='clear')&&!stroke.selection)fail();
      points += stroke.points.length+(stroke.selection?.length??0);
      if (points > 2_000_000) fail();
      for (const p of stroke.points) if (!p || ![p.x,p.y,p.pressure,p.time].every(Number.isFinite) || p.pressure < 0 || p.pressure > 1) fail();
    }
  };
  for (const layer of value.layers) {
    if (!layer || typeof layer.id !== 'string' || !layer.id || ids.has(layer.id) || typeof layer.name !== 'string'
      || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1
      || !['normal','multiply'].includes(layer.blend) || !Array.isArray(layer.strokes) || (layer.clip && !box(layer.clip))) fail();
    if(layer.guide!==undefined&&typeof layer.guide!=='boolean')fail();
    if(layer.generationMask!==undefined&&(typeof layer.generationMask!=='boolean'||layer.generationMask&&(layer.kind==='vector'||layer.image||layer.mask||layer.tone)))fail();
    if(layer.aboveNative!==undefined&&typeof layer.aboveNative!=='boolean')fail();
    if(layer.kind!==undefined&&!['raster','vector'].includes(layer.kind))fail();
    if(layer.antialias!==undefined&&![0,1,2,3].includes(layer.antialias))fail();
    if(layer.colorMode!==undefined&&!['color','grayscale','monochrome'].includes(layer.colorMode))fail();
    if(layer.folderId!==undefined&&(typeof layer.folderId!=='string'||!folderIds.has(layer.folderId)))fail();
    if(layer.paths!==undefined&&(!Array.isArray(layer.paths)||layer.kind!=='vector'))fail();
    const pathIds=new Set<string>();
    for(const path of layer.paths??[]){
      const style=path?.style,point=(p:unknown)=>!!p&&typeof p==='object'&&Number.isFinite((p as {x:number}).x)&&Number.isFinite((p as {y:number}).y);
      if(!path||typeof path.id!=='string'||!path.id||pathIds.has(path.id)||typeof path.closed!=='boolean'||!Array.isArray(path.nodes)||!path.nodes.length||!style)fail();
      pathIds.add(path.id);points+=path.nodes.length;if(points>2_000_000)fail();
      if(!validPaintInk(style.stroke)||!validPaintInk(style.fill)||!Number.isFinite(style.width)||style.width<=0||style.width>10000
        ||!['butt','round','square'].includes(style.cap)||!['miter','round','bevel'].includes(style.join)||!Number.isFinite(style.miterLimit)||style.miterLimit<1||style.miterLimit>1000
        ||!Array.isArray(style.dash)||style.dash.length>6||style.dash.some(n=>!Number.isFinite(n)||n<=0)||!Number.isFinite(style.dashOffset)
        ||!['center','inside','outside'].includes(style.alignment)||![style.arrowStart,style.arrowEnd].every(a=>['none','triangle','open','circle'].includes(a))||!['uniform','taper','spindle'].includes(style.profile))fail();
      for(const node of path.nodes)if(!point(node)||(node.handleIn!==undefined&&!point(node.handleIn))||(node.handleOut!==undefined&&!point(node.handleOut)))fail();
    }
    ids.add(layer.id);
    if (layer.image) {
      const asset = assets.find(asset => asset.id === layer.image!.assetId), crop = layer.image.crop;
      if (!asset || !box(layer.image.bbox) || !box(crop) || crop.x < 0 || crop.y < 0 || crop.x + crop.w > asset.widthPx || crop.y + crop.h > asset.heightPx) fail();
    }
    if(layer.mask && (typeof layer.mask.enabled!=='boolean'||typeof layer.mask.reveal!=='boolean'||!Array.isArray(layer.mask.strokes)))fail();
    if(layer.tone){const tone=layer.tone;
      if(typeof tone.enabled!=='boolean'||!Number.isFinite(tone.lpi)||tone.lpi<=0||tone.lpi>1000||!['image','fixed'].includes(tone.mode)||!Number.isFinite(tone.density)||tone.density<0||tone.density>100
        ||(tone.fill!==undefined&&(typeof tone.fill!=='boolean'||tone.fill&&tone.mode!=='fixed'))
        ||(tone.angle!==undefined&&(!Number.isFinite(tone.angle)||tone.angle<0||tone.angle>360))
        ||(tone.origin!==undefined&&(!tone.origin||!Number.isFinite(tone.origin.x)||!Number.isFinite(tone.origin.y))))fail();
    }
    validateStrokes([...layer.strokes,...(layer.mask?.strokes??[])]);
  }
}

/** Convert existing art to editable layers, including clipped pieces after panel split/merge. */
export function paintForFrame(frame: BBox, dpi: number, images: PlacedImage[], assets: ImageAsset[],colorMode:PaintColorMode='color',addBlank=true): PaintDocument {
  if (images.length === 1 && images[0].paint) {
    const image = images[0], paint = image.paint!;
    validatePaintDocument(paint, assets);
    if (image.bbox.x === frame.x && image.bbox.y === frame.y && image.bbox.w === frame.w && image.bbox.h === frame.h
      && image.crop.x === 0 && image.crop.y === 0 && image.crop.w === paint.width && image.crop.h === paint.height
      && image.opacity === 1 && !image.hidden
      // Allow one pixel of accumulated rounding per axis (including a prior
      // canvas expansion), but reframe actual aspect-ratio edits with contain fit.
      && Math.abs(paint.width*frame.h-paint.height*frame.w) <= frame.w+frame.h + 1e-7) return structuredClone(paint);
  }
  const {width,height} = artworkPixelSize(frame,dpi);
  const doc: PaintDocument = {version:1,width,height,dpi,layers:[]};
  const px = width / frame.w, py = height / frame.h;
  for (const image of images) {
    const asset = assets.find(asset => asset.id === image.assetId);
    if (!asset) throw new Error('ペイントに必要な原本がありません');
    const target = {x:(image.bbox.x-frame.x)*px,y:(image.bbox.y-frame.y)*py,w:image.bbox.w*px,h:image.bbox.h*py};
    const scale = Math.min(target.w / image.crop.w,target.h / image.crop.h);
    const fit = {x:target.x+(target.w-image.crop.w*scale)/2,y:target.y+(target.h-image.crop.h*scale)/2,w:image.crop.w*scale,h:image.crop.h*scale};
    const offset = {x:fit.x-image.crop.x*scale,y:fit.y-image.crop.y*scale};
    const mapBox = (box: BBox): BBox => ({x:offset.x+box.x*scale,y:offset.y+box.y*scale,w:box.w*scale,h:box.h*scale});
    if (image.paint) {
      validatePaintDocument(image.paint,assets);
      if(image.paint.guideInitialized)doc.guideInitialized=true;
      if(image.paint.background3d&&images.length===1)doc.background3d=mapBackgroundCapture(image.paint.background3d,mapBox,scale);
      if (images.length === 1) doc.referenceFrame = mapBox(image.paint.referenceFrame ?? {x:0,y:0,w:image.paint.width,h:image.paint.height});
      const folderStart=doc.layers.length,folderIds=new Map((image.paint.folders??[]).map(folder=>[folder.id,crypto.randomUUID()]));
      const boundaries=[folderStart];
      for (const source of image.paint.layers) {
        const layer = structuredClone(source);
        layer.id = crypto.randomUUID();
        if(layer.folderId){const mapped=folderIds.get(layer.folderId);if(mapped)layer.folderId=mapped;else delete layer.folderId;}
        if(doc.background3d)doc.background3d.layerIds=doc.background3d.layerIds.map(id=>id===source.id?layer.id:id);
        layer.opacity *= image.opacity; layer.visible &&= !image.hidden;
        const previous = source.clip ? mapBox(source.clip) : fit;
        const x = Math.max(previous.x,fit.x), y = Math.max(previous.y,fit.y);
        const right = Math.min(previous.x+previous.w,fit.x+fit.w), bottom = Math.min(previous.y+previous.h,fit.y+fit.h);
        if (right <= x || bottom <= y){boundaries.push(doc.layers.length);continue;}
        layer.clip = {x,y,w:right-x,h:bottom-y};
        Object.assign(layer,mapPaintLayer({...layer,clip:source.clip},offset.x,offset.y,scale),{clip:layer.clip});
        doc.layers.push(layer);
        boundaries.push(doc.layers.length);
      }
      if(folderIds.size){
        doc.folders??=[];
        for(const folder of image.paint.folders??[]){
          doc.folders.push({...folder,id:folderIds.get(folder.id)!,position:boundaries[folder.position],
            parentFolderId:folder.parentFolderId?folderIds.get(folder.parentFolderId):undefined});
        }
      }
    } else {
      doc.layers.push({...newPaintLayer(asset.originalName),visible:!image.hidden,opacity:image.opacity,locked:true,
        image:{assetId:asset.id,crop:{...image.crop},bbox:fit}});
    }
  }
  if (addBlank&&doc.layers.length < 64) doc.layers.push(newPaintLayer('レイヤー','raster',colorMode));
  // Empty scene owners are a drawing destination, not an empty saved artwork asset.
  validatePaintDocument(doc,assets,!addBlank);
  return doc;
}


export interface PaintOwner {
  key: string;
  kind: 'background' | 'figure' | 'bubble' | 'panel' | 'page' | 'original';
  index: number;
  label: string;
  frame: BBox;
  paint: PaintDocument;
  figure?: Figure;
  bubble?: Bubble;
  original?: PlacedImage;
  /** Derived from the bubble's originalImageId; never another persisted folder. */
  parentKey?: string;
  stack?: PaintStackPosition;
  description?: string;
  backgroundLevel?: Panel['bg'];
  /** This folder's own lock; its right-side lock remains available for unlocking. */
  locked?: boolean;
  /** An enclosing panel folder owns the lock; descendant locks are display-only. */
  inheritedLocked?: boolean;
}
export interface PaintScene { frame: BBox; owners: PaintOwner[]; colorMode?:PaintColorMode; anchorIds?:Record<string,string>; /** Page-wide last allocated work-layer number. */ layerSequence?:number }

/** Bottom to top, with each direct sibling immediately behind its native anchor. */
export function orderedPaintOwners(owners:PaintOwner[],anchorIds:Record<string,string>={}):PaintOwner[] {
  const result=owners.filter(owner=>!owner.stack),outside:PaintOwner[]=[];
  const relations={figures:owners.filter(o=>o.kind==='figure').sort((a,b)=>a.index-b.index).map(o=>o.figure!),bubbles:owners.filter(o=>o.kind==='bubble').sort((a,b)=>a.index-b.index).map(o=>o.bubble!)};
  const rank=(owner:PaintOwner)=>{const target=paintStackTarget(owner.stack,anchorIds);return target?.startsWith('screen-text-')?Number(target.slice(12)):-1;};
  for(let owner of owners.filter(owner=>owner.stack).sort((a,b)=>rank(a)-rank(b))){
    const target=paintStackTarget(owner.stack,anchorIds);
    if(target?.startsWith('panel-')){outside.push(owner);continue;}
    let at=target?result.findIndex(item=>item.key===target):-1;
    const parent=at>=0?result[at]:undefined;
    if(parent?.parentKey)owner={...owner,parentKey:parent.parentKey,inheritedLocked:parent.inheritedLocked};
    if(at<0&&target?.startsWith('screen-text-'))at=result.findIndex(item=>item.bubble&&letteringFigureIndex(relations,item.bubble)===null);
    if(at<0)at=result.findIndex(item=>item.kind==='panel'||item.kind==='page');
    result.splice(at<0?result.length:at,0,owner);
  }
  const panelKeys=Object.keys(anchorIds).filter(key=>key.startsWith('panel-'));
  outside.sort((a,b)=>panelKeys.indexOf(paintStackTarget(a.stack,anchorIds)!)-panelKeys.indexOf(paintStackTarget(b.stack,anchorIds)!));
  return [...outside,...result];
}

/** A character hit is one ordinary raster layer. Older guide documents stay readable but no extra blank layer is invented. */
function figurePaintForFrame(figure:Figure,frame:BBox,dpi:number,assets:ImageAsset[],colorMode:PaintColorMode):PaintDocument {
  if(!figure.artwork){
    const {width,height}=artworkPixelSize(frame,dpi);
    return {version:1,width,height,dpi,guideInitialized:true,layers:[{...newPaintLayer('キャラクターあたり'),guide:true}]};
  }
  const paint=paintForFrame(frame,dpi,[{...figure.artwork,id:'source',bbox:frame}],assets,colorMode,false);
  let layers=figure.artwork.paint
    ?paint.layers.map(layer=>layer.guide?{...layer,name:'キャラクターあたり'}:layer)
    :paint.layers.filter(layer=>layer.image).map(layer=>({...layer,name:'キャラクターあたり',locked:figure.artwork!.locked===true,guide:undefined}));
  if(figure.artwork.locked&&!layers.some(layer=>layer.locked&&paintLayerHasContent(layer))){
    const target=layers.findIndex(layer=>layer.guide||layer.image||paintLayerHasContent(layer));
    if(target>=0)layers=layers.map((layer,index)=>index===target?{...layer,locked:true}:layer);
  }
  return {...paint,guideInitialized:true,layers};
}

/** OCR pixels are an independent raster layer, never the native text's display mode. */
function bubblePaintForFrame(bubble:Bubble,frame:BBox,dpi:number,assets:ImageAsset[],colorMode:PaintColorMode):PaintDocument {
  const paint=paintForFrame(frame,dpi,bubble.paint_overlay?[{...bubble.paint_overlay,id:'source',bbox:frame}]:[],assets,colorMode,false);
  if(bubble.analogTextImport?.rasterLayerSeparated&&!bubble.paint_overlay)return {...paint,guideInitialized:true,layers:[]};
  const initialized=paint.guideInitialized||paint.layers.some(layer=>layer.guide)||bubble.analogTextImport?.rasterLayerInitialized;
  // Keep existing eyes, locks and edits. Once pixels exist, no source-regeneration link remains.
  paint.layers=paint.layers.map(layer=>layer.guide&&layer.image?{...layer,guide:undefined}:layer);
  if(bubble.analogTextImport?.rasterLayerInitialized&&!bubble.paint_overlay)return {...paint,guideInitialized:true,layers:[]};
  if(initialized)return {...paint,guideInitialized:true};
  if(!bubble.analogTextImport||paint.layers.length>=64)return paint;
  // Pending source decoding uses the existing guide loader once. OCR text is shown immediately.
  const original={...newPaintLayer('テキスト原画'),guide:true,visible:false};
  return {...paint,guideInitialized:true,layers:[original,...(bubble.paint_overlay?paint.layers:[])]};
}

/** Persist only a folder lock. Existing artwork bytes and child layer locks stay unchanged. */
export function applyPaintOwnerLock(target:Panel|PageOverlay|MangaPage,owner:PaintOwner):void {
  const locked=owner.locked===true;
  if(owner.kind==='original'){
    const image=(target as Panel|MangaPage).images?.find(image=>image.id===owner.original?.id);
    if(image)image.locked=locked;
    return;
  }
  if(owner.kind==='page'){
    const page=target as MangaPage;
    page.layer=locked?{...page.layer,directLocked:true}:page.layer?{...page.layer,directLocked:undefined}:undefined;
    if(page.layer&&!Object.values(page.layer).some(Boolean))delete page.layer;
    return;
  }
  if(owner.kind==='background'||owner.kind==='panel'){
    const panel=target as Panel;panel.layer??={};
    if(owner.kind==='background')panel.layer.backgroundLocked=locked||undefined;
    else panel.layer.directLocked=locked||undefined;
    if(owner.kind==='background')for(const image of panel.background_images??[])image.locked=false;
    return;
  }
  const collection=target as Panel|PageOverlay;
  const item=owner.kind==='figure'?collection.figures?.[owner.index]:collection.bubbles?.[owner.index];
  if(!item)return;
  item.locked=locked||undefined;
  if(owner.kind==='bubble')(item as Bubble).nativeLocked=owner.bubble?.nativeLocked||undefined;
  if(owner.kind==='figure'&&(item as Figure).artwork)(item as Figure).artwork!.locked=false;
  if(owner.kind==='bubble'&&(item as Bubble).paint_overlay)(item as Bubble).paint_overlay!.locked=false;
}

/** Match the page: native guide replacement is only used before guide layers are initialized. */
export function paintGuideView(owner: PaintOwner, guide?: boolean, integratedGuide = Boolean(owner.figure?.artwork?.paint?.guideInitialized || owner.bubble?.paint_overlay?.paint?.guideInitialized)): PaintDocument {
  const paint = structuredClone(owner.paint);
  if (owner.kind === 'bubble') return paint;
  if (!integratedGuide && guide === true) {
    const layer = paint.layers.find(layer => layer.guide) ?? { ...newPaintLayer(owner.label), guide: true };
    paint.layers = [{ ...layer, visible: true }];
  } else if (!integratedGuide && guide === false) paint.layers = paint.layers.filter(layer => !layer.guide);
  return paint;
}

/** A saved hidden paint folder must not reappear when its 3D reference is rendered. */
export function figurePaintVisible(figure: Figure | undefined, guide?: boolean): boolean {
  if (!figure) return false;
  const artwork = figure.artwork, paint = artwork?.paint;
  if (!paint?.guideInitialized && guide === true) return true;
  if (!artwork) return guide !== false;
  if (artwork.hidden || artwork.opacity <= 0) return false;
  return !paint || paint.layers.some(layer => paintLayerVisible(paint,layer) && layer.opacity > 0 && paintLayerHasContent(layer));
}

/** Each object is a separate group; source data is referenced, never replaced by strokes. */
export function paintScene(panel: Panel, dpi: number, assets: ImageAsset[],colorMode:PaintColorMode='color',directScope?:'panel'|'page',panels?:Panel[]): PaintScene {
  const anchorIds=paintAnchorIds(panel,panels);
  const frame = panelBounds(panel);
  const backgrounds=panel.background_images ?? [];
  const boxes=[frame,...backgrounds.map(image=>image.bbox)];
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  const backgroundFrame=backgrounds.length===1 ? backgrounds[0].bbox : {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};
  const inheritedLocked=directScope==='panel'&&panel.layer?.locked===true;
  const owners: PaintOwner[] = [{key:'background',kind:'background',index:0,label:'背景あたり',frame:backgroundFrame,backgroundLevel:panel.bg,description:panel.background_description || panel.action || '',locked:panel.layer?.backgroundLocked===true||backgrounds.some(image=>image.locked),inheritedLocked,
    paint:paintForFrame(backgroundFrame,dpi,backgrounds,assets,colorMode,false)}];
  (panel.figures ?? []).forEach((figure,index)=>{
    const box = figure.bbox ?? fallbackBox(panel,'figure',index);
    owners.push({key:`figure-${index}`,kind:'figure',index,label:figureDisplayLabel(figure,index),frame:box,figure,locked:figure.locked===true,inheritedLocked,
      paint:figurePaintForFrame(figure,box,dpi,assets,colorMode)});
  });
  panel.bubbles.forEach((bubble,index)=>{
    const box = bubble.bbox ?? fallbackBox(panel,'bubble',index);
    owners.push({key:`bubble-${index}`,kind:'bubble',index,label:textDisplayLabel(index),frame:box,bubble,locked:bubble.locked===true||bubble.paint_overlay?.locked===true,inheritedLocked,
      paint:bubblePaintForFrame(bubble,box,dpi,assets,colorMode)});
  });
  if(directScope){
    const direct=(panel.images??[]).filter(image=>image.paintScope===directScope);
    const positions=[undefined,...direct.flatMap(image=>image.paintStack?[image.paintStack]:[])];
    for(const [index,stack] of positions.entries()){
      const key=directPaintOwnerKey(directScope,stack);if(owners.some(owner=>owner.key===key))continue;
      const images=direct.filter(image=>paintStackKey(image.paintStack)===paintStackKey(stack));
      const directFrame=images.length===1?images[0].bbox:frame;
      const paint=paintForFrame(directFrame,dpi,images,assets,colorMode,false);
      paint.guideInitialized=true;
      owners.push({key,kind:directScope,index,label:directScope==='page'?'コマ外':'コマ内',frame:directFrame,paint,stack,locked:panel.layer?.directLocked===true,inheritedLocked});
    }
  }
  for(const owner of owners){
    if(owner.kind!=='background'||owner.paint.guideInitialized||owner.paint.layers.length>=64)continue;
    const existing=backgrounds.length>0;
    const guide={...newPaintLayer('あたり · 背景'),guide:true,visible:!existing};
    // Preserve guide colors; a work layer is created with the first actual mark.
    owner.paint={...owner.paint,guideInitialized:true,layers:[guide,...owner.paint.layers]};
  }
  (panel.images??[]).forEach((image,index)=>{
    if(!image.bubbleOriginal)return;
    const paint=paintForFrame(image.bbox,dpi,[image],assets,colorMode,false);
    const parent=panel.bubbles.findIndex(bubble=>bubble.analogTextImport?.originalImageId===image.id);
    owners.push({key:`original-${image.id}`,kind:'original',index,label:image.bubbleOriginal.name,...(parent>=0?{parentKey:`bubble-${parent}`} : {}),
      frame:{...image.bbox},original:image,locked:image.locked,inheritedLocked:inheritedLocked||(parent>=0&&panel.bubbles[parent].locked===true),paint:{...paint,guideInitialized:true}});
  });
  const artKeys=panelArtKeys(panel);
  const baseKeys=artKeys;
  const bubbles=bubbleArtIndices(panel).map(index=>owners.find(owner=>owner.key===`bubble-${index}`)!);
  const keys=[...baseKeys,...bubbles.flatMap(o=>[o.key,...owners.filter(child=>child.parentKey===o.key).map(child=>child.key)])];
  for(const figure of owners.filter(owner=>owner.kind==='figure')){
    const related=bubbles.filter(owner=>letteringFigureIndex(panel,owner.bubble!)===figure.index);
    const group=(behind:boolean)=>related.filter(owner=>(owner.bubble!.lettering_depth==='behind')===behind).flatMap(owner=>[owner.key,...owners.filter(child=>child.parentKey===owner.key).map(child=>child.key)]);
    const back=group(true),front=group(false);
    for(const key of [...back,...front])keys.splice(keys.indexOf(key),1);
    keys.splice(keys.indexOf(figure.key),1,...back,figure.key,...front);
  }
  // Work layers are in front of the native content; panel work remains below its frame.
  if(directScope)keys.push(directScope);
  keys.push(...owners.filter(o=>o.kind==='original'&&!o.parentKey).map(o=>o.key));
  return {frame,owners:orderedPaintOwners([...keys.map(key=>owners.find(o=>o.key===key)!),...owners.filter(owner=>owner.stack)],anchorIds),colorMode,anchorIds};
}

export function paintReferenceBox(paint: PaintDocument | undefined, frame: BBox, crop?: BBox): BBox {
  if (!paint) return frame;
  const b=paint.referenceFrame??{x:0,y:0,w:paint.width,h:paint.height};
  const c=crop??{x:0,y:0,w:paint.width,h:paint.height};
  const scale=Math.min(frame.w/c.w,frame.h/c.h);
  return {x:frame.x+(frame.w-c.w*scale)/2+(b.x-c.x)*scale,y:frame.y+(frame.h-c.h*scale)/2+(b.y-c.y)*scale,w:b.w*scale,h:b.h*scale};
}

export function restoreFigureGuide(figure: Figure): Figure {
  const next=structuredClone(figure);
  if(next.bbox&&next.artwork?.paint)next.bbox=paintReferenceBox(next.artwork.paint,next.bbox,next.artwork.crop);
  delete next.artwork;
  return next;
}

/** Resize the placement around its center without resampling the document. */
export function scalePaintOwner(owner: PaintOwner, factor: number): PaintOwner {
  if (!Number.isFinite(factor) || factor<=0 || factor>10) throw new Error('拡大率を確認してください');
  const b=owner.frame,w=b.w*factor,h=b.h*factor;
  return {...owner,frame:{x:b.x+(b.w-w)/2,y:b.y+(b.h-h)/2,w,h}};
}

/** Add integer pixels around the canvas while retaining ink and guide positions on the page. */
export function expandPaintOwner(owner: PaintOwner, padding: {left:number;right:number;top:number;bottom:number}): PaintOwner {
  const {left,right,top,bottom}=padding,old=owner.paint,b=owner.frame;
  if (!Object.values(padding).every(n=>Number.isSafeInteger(n)&&n>=0)) throw new Error('余白は0以上の整数pxで指定してください');
  const width=old.width+left+right,height=old.height+top+bottom;
  if(width>16384||height>16384||width*height>100_000_000)throw new Error('描画範囲は各辺16384px・合計1億px以内です');
  const frame={x:b.x-left*b.w/old.width,y:b.y-top*b.h/old.height,w:width*b.w/old.width,h:height*b.h/old.height};
  const referenceFrame=old.referenceFrame??{x:0,y:0,w:old.width,h:old.height};
  // Right/bottom growth changes the canvas size, not a single ink coordinate.
  if(!left&&!top)return {...owner,frame,paint:{...old,width,height,referenceFrame}};
  const shift=(box:BBox):BBox=>({...box,x:box.x+left,y:box.y+top});
  const shiftStroke=(stroke:PaintLayer['strokes'][number])=>({...stroke,...(stroke.selection?{selection:stroke.selection.map(shift)}:{}),points:stroke.points.map(p=>({...p,x:p.x+left,y:p.y+top}))});
  return {...owner,frame,
    paint:{...old,width,height,...(old.background3d?{background3d:mapBackgroundCapture(old.background3d,shift)}:{}),referenceFrame:shift(referenceFrame),layers:old.layers.map(layer=>({...layer,
      ...(layer.clip?{clip:shift(layer.clip)}:{}),...(layer.image?{image:{...layer.image,bbox:shift(layer.image.bbox)}}:{}),
      ...(layer.paths?{paths:layer.paths.map(path=>transformVector(path,left,top))}:{}),
      ...(layer.mask?{mask:{...layer.mask,strokes:layer.mask.strokes.map(shiftStroke)}}:{}),
      ...(layer.tone?{tone:{...layer.tone,origin:{x:(layer.tone.origin?.x??0)+left,y:(layer.tone.origin?.y??0)+top}}}:{}),
      strokes:layer.strokes.map(shiftStroke)}))}};
}

/** Reuse already measured ink bounds; no traversal of layers or points. */
export function expandPaintOwnerToBounds(owner:PaintOwner,bounds:BBox|undefined):PaintOwner {
  if(!bounds)return owner;
  if(![bounds.x,bounds.y,bounds.w,bounds.h].every(Number.isFinite))throw new Error('描画座標は有限の数値で指定してください');
  const grow=(amount:number)=>Math.max(0,Math.ceil(amount-1e-7));
  const padding={left:grow(-bounds.x),top:grow(-bounds.y),right:grow(bounds.x+bounds.w-owner.paint.width),bottom:grow(bounds.y+bounds.h-owner.paint.height)};
  return Object.values(padding).some(Boolean)?expandPaintOwner(owner,padding):owner;
}

/** Add generated pixels at the top of the target folder; retain the source, edits and their locks. */
export function insertGeneratedPaintImage(owner:PaintOwner,asset:ImageAsset,name:string,frame: BBox=owner.frame):{owner:PaintOwner;layer:PaintLayer} {
  if(owner.paint.layers.length>=64)throw new Error('1つのグループには64レイヤーまで追加できます');
  const px=owner.paint.width/owner.frame.w,py=owner.paint.height/owner.frame.h;
  const box={x:(frame.x-owner.frame.x)*px,y:(frame.y-owner.frame.y)*py,w:frame.w*px,h:frame.h*py};
  const expanded=expandPaintOwnerToBounds(owner,box),paint=expanded.paint;
  const target={x:(frame.x-expanded.frame.x)*px,y:(frame.y-expanded.frame.y)*py,w:box.w,h:box.h};
  // Fit in manuscript coordinates; the layer can have a different pixel density on each axis.
  const scale=Math.min(frame.w/asset.widthPx,frame.h/asset.heightPx),w=asset.widthPx*scale*px,h=asset.heightPx*scale*py;
  const layer:PaintLayer={...newPaintLayer(name),...(owner.kind==='bubble'?{aboveNative:true}:{}),image:{assetId:asset.id,crop:{x:0,y:0,w:asset.widthPx,h:asset.heightPx},bbox:{x:target.x+(target.w-w)/2,y:target.y+(target.h-h)/2,w,h}}};
  return {owner:{...expanded,paint:{...paint,layers:[...paint.layers,layer]}},layer};
}

/** Grow the backing raster only when editable content reaches beyond it.
 * The original frame is a reference, never an editing boundary. Integer padding
 * reuses the same world-position-preserving transform as manual canvas growth.
 */
export function expandPaintOwnerToContent(owner:PaintOwner,contents=owner.paint.layers):PaintOwner {
  let left=0,top=0,right=owner.paint.width,bottom=owner.paint.height;
  const include=(x:number,y:number,w=0,h=0,margin=0)=>{
    left=Math.min(left,x-margin);top=Math.min(top,y-margin);right=Math.max(right,x+w+margin);bottom=Math.max(bottom,y+h+margin);
  };
  for(const layer of contents){
    // Explicit source crops stay attached to their source layer.
    if(layer.clip){include(layer.clip.x,layer.clip.y,layer.clip.w,layer.clip.h);continue;}
    if(layer.image)include(layer.image.bbox.x,layer.image.bbox.y,layer.image.bbox.w,layer.image.bbox.h);
    for(const path of layer.paths??[]){
      const style=path.style,half=style.width*(path.closed&&style.alignment!=='center'?1:.5);
      const margin=style.stroke?Math.max(half*(style.join==='miter'?style.miterLimit:1),!path.closed&&(style.arrowStart!=='none'||style.arrowEnd!=='none')?Math.max(5,style.width*3):0)+2:0;
      for(const node of path.nodes){include(node.x,node.y,0,0,margin);for(const key of ['handleIn','handleOut'] as const){const handle=node[key];if(handle)include(node.x+handle.x,node.y+handle.y,0,0,margin);}}
    }
    for(const stroke of layer.strokes){
      const bounds=paintStrokeContentBounds(stroke);
      if(bounds)include(bounds.x,bounds.y,bounds.w,bounds.h);
    }
  }
  return expandPaintOwnerToBounds(owner,{x:left,y:top,w:right-left,h:bottom-top});
}

/** Ensure a minimum margin; reopening never adds the same margin twice. */
export function withPaintBleed(owner: PaintOwner, pixels: number): PaintOwner {
  if (!Number.isSafeInteger(pixels) || pixels < 0) throw new Error('ぬりたしを確認してください');
  // Figure canvases grow from actual marks, without allocating an empty margin.
  if(owner.kind==='figure')return owner;
  if (owner.inheritedLocked||owner.locked||owner.figure?.artwork?.locked || owner.bubble?.paint_overlay?.locked) return owner;
  const paint = owner.paint;
  const reference = paint.referenceFrame ?? {x:0,y:0,w:paint.width,h:paint.height};
  // Reframing can move an integer-pixel margin by less than half a pixel.
  // Treat that as the same margin so reopening is idempotent.
  const missingPadding=(margin:number)=>pixels-margin>.5?Math.ceil(pixels-margin):0;
  const padding = {
    left: missingPadding(reference.x),
    right: missingPadding(paint.width-reference.x-reference.w),
    top: missingPadding(reference.y),
    bottom: missingPadding(paint.height-reference.y-reference.h),
  };
  return Object.values(padding).some(Boolean) ? expandPaintOwner(owner,padding) : owner;
}

export function paintInputBox(owner: PaintOwner, marginMm: number): BBox {
  const b=owner.frame;
  return {x:b.x-marginMm,y:b.y-marginMm,w:b.w+2*marginMm,h:b.h+2*marginMm};
}

export function paintInputPoint(owner: PaintOwner, marginMm: number, x: number, y: number): {x:number;y:number} {
  const input=paintInputBox(owner,marginMm);
  return {x:(x*input.w-marginMm)*owner.paint.width/owner.frame.w,y:(y*input.h-marginMm)*owner.paint.height/owner.frame.h};
}

/** Apply only the changed owner's drawing. Source IDs/actions/shape/text stay intact. */
export function applyOwnerPaint(panel: {figures?:Figure[];bubbles?:Bubble[];background_images?:PlacedImage[];images?:PlacedImage[]}, owner: PaintOwner, image: PlacedImage): void {
  const {id: _id,bbox,...content}=image;
  if(owner.kind==='original'){
    const previous=panel.images?.find(item=>item.id===owner.original?.id);
    if(!previous)throw new Error('原本画像の配置先が見つかりません');
    Object.assign(previous,content,{bbox:{...bbox},locked:owner.locked===true});
  }
  else if(owner.kind==='background') panel.background_images=[image];
  else if(owner.kind==='panel'||owner.kind==='page')panel.images=[...(panel.images??[]).filter(item=>item.paintScope!==owner.kind||paintStackKey(item.paintStack)!==paintStackKey(owner.stack)),{...image,paintScope:owner.kind,...(owner.stack?{paintStack:owner.stack}:{})}];
  else if(owner.kind==='figure') {
    const figure=panel.figures?.[owner.index];
    if(!figure)throw new Error('人物の配置先が見つかりません');
    figure.artwork=content; figure.bbox={...bbox};
    if(figure.analogImport&&owner.figure?.analogImport?.userEdited)figure.analogImport={...figure.analogImport,userEdited:true};
  } else if(owner.kind==='bubble') {
    const bubble=panel.bubbles?.[owner.index];
    if(!bubble)throw new Error('テキストの配置先が見つかりません');
    bubble.paint_overlay=content; bubble.bbox={...bbox};
    if(bubble.analogTextImport&&owner.paint.guideInitialized)bubble.analogTextImport.rasterLayerInitialized=true;
  } else throw new Error('描画先が見つかりません');
}

/** Removing the final editable layer restores the native owner instead of saving a blank PNG. */
export function clearOwnerPaint(panel: {figures?:Figure[];bubbles?:Bubble[];background_images?:PlacedImage[];images?:PlacedImage[];page_overlay?:PageOverlay}, owner: PaintOwner): void {
  if(owner.kind==='original'){
    panel.images=panel.images?.filter(image=>image.id!==owner.original?.id);
    for(const bubble of panel.bubbles??panel.page_overlay?.bubbles??[])if(bubble.analogTextImport?.originalImageId===owner.original?.id)bubble.analogTextImport!.originalImageId=null;
    return;
  }
  if(owner.kind==='background'){panel.background_images=[];return;}
  if(owner.kind==='panel'||owner.kind==='page'){panel.images=(panel.images??[]).filter(item=>item.paintScope!==owner.kind||paintStackKey(item.paintStack)!==paintStackKey(owner.stack));return;}
  if(owner.kind==='figure'){
    const figure=panel.figures?.[owner.index];
    if(!figure)throw new Error('人物の配置先が見つかりません');
    panel.figures![owner.index]=restoreFigureGuide(figure);return;
  }
  if(owner.kind!=='bubble')throw new Error('描画先が見つかりません');
  const bubble=panel.bubbles?.[owner.index];
  if(!bubble)throw new Error('テキストの配置先が見つかりません');
  delete bubble.paint_overlay;
  if(bubble.analogTextImport)bubble.analogTextImport.rasterLayerInitialized=true;
}
