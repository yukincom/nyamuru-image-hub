import { validPaintInk } from './paintInk.ts';
import { mapBackgroundCapture, validateBackgroundCapture } from './background3d.ts';
import { panelArtKeys } from './panelLayers.ts';
import { transformVector } from './vectorGeometry.ts';
import type { BBox, Bubble, CanvasElementSelection, Figure, ImageAsset, MangaPage, PageOverlay, PaintColorMode, PaintDocument, PaintFolder, PaintLayer, Panel, PlacedImage } from '../types.ts';
import { fallbackBox, panelBounds } from './canvasGeometry.ts';
import { artworkPixelSize } from './artworkClipboard.ts';
import { paintLayerHasContent } from './paintLock.ts';
import { figureDisplayLabel } from './displayLabels.ts';

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
export type PaintLayerTreeEntry={kind:'layer';layer:PaintLayer}|{kind:'folder';folder:PaintFolder;layers:PaintLayer[]};
export type PaintLayerDropTarget=
  | {kind:'layer';id:string;after:boolean}
  | {kind:'folder';id:string;placement:'above'|'inside'|'below'}
  | {kind:'root';edge:'top'|'bottom'};

/** Build the palette tree without changing the canonical bottom-to-top render order. */
export function paintLayerTree(paint:PaintDocument):PaintLayerTreeEntry[]{
  const folders=paint.folders??[],assigned=new Set<string>();
  const entries:Array<{position:number;tie:number;entry:PaintLayerTreeEntry}>=[];
  folders.forEach((folder,tie)=>{
    const layers=paint.layers.filter(layer=>layer.folderId===folder.id);
    layers.forEach(layer=>assigned.add(layer.id));
    const indices=layers.map(layer=>paint.layers.indexOf(layer));
    entries.push({position:indices.length?Math.min(...indices):Math.max(0,Math.min(paint.layers.length,folder.position)),tie,entry:{kind:'folder',folder,layers}});
  });
  paint.layers.forEach((layer,index)=>{
    if(!assigned.has(layer.id))entries.push({position:index,tie:folders.length+index,entry:{kind:'layer',layer}});
  });
  return entries.sort((a,b)=>a.position-b.position||a.tie-b.tie).map(item=>item.entry);
}

export function addPaintFolder(paint:PaintDocument):{paint:PaintDocument;folder:PaintFolder}{
  const folders=paint.folders??[],folder={id:crypto.randomUUID(),name:`フォルダー ${folders.length+1}`,position:paint.layers.length};
  return {folder,paint:{...paint,folders:[...folders,folder]}};
}

/** Move one layer to the exact visible drop target, including into or out of a user folder. */
export function movePaintLayer(paint:PaintDocument,id:string,target:PaintLayerDropTarget):PaintDocument{
  const source=paint.layers.find(layer=>layer.id===id);if(!source)return paint;
  const before=paint.layers,from=before.indexOf(source),layers=before.filter(layer=>layer.id!==id),folders=(paint.folders??[]).map(folder=>({...folder}));
  const sourceFolder=source.folderId?folders.find(folder=>folder.id===source.folderId):undefined;
  let folderId:string|undefined,index:number;
  if(target.kind==='root')index=target.edge==='top'?layers.length:0;
  else if(target.kind==='layer'){
    const at=layers.findIndex(layer=>layer.id===target.id);if(at<0||target.id===id)return paint;
    folderId=layers[at].folderId;index=at+(target.after?0:1);
  }else{
    const folder=folders.find(item=>item.id===target.id);if(!folder)return paint;
    const children=layers.map((layer,at)=>layer.folderId===folder.id?at:-1).filter(at=>at>=0);
    const low=children.length?Math.min(...children):Math.max(0,Math.min(layers.length,folder.position));
    const high=children.length?Math.max(...children)+1:low;
    if(target.placement==='inside'){folderId=folder.id;index=high;}
    else {folderId=undefined;index=target.placement==='above'?high:low;}
  }
  const moved={...source,...(folderId?{folderId}:{folderId:undefined})};layers.splice(index,0,moved);
  for(const folder of folders){
    const positions=layers.map((layer,at)=>layer.folderId===folder.id?at:-1).filter(at=>at>=0);
    if(positions.length)folder.position=Math.min(...positions);
    else if(folder===sourceFolder)folder.position=Math.max(0,Math.min(layers.length,from));
    else folder.position=Math.max(0,Math.min(layers.length,folder.position));
  }
  return {...paint,layers,folders};
}

export function removePaintFolder(paint:PaintDocument,id:string):PaintDocument{
  if(!(paint.folders??[]).some(folder=>folder.id===id))return paint;
  return {...paint,folders:paint.folders!.filter(folder=>folder.id!==id),layers:paint.layers.map(layer=>layer.folderId===id?{...layer,folderId:undefined}:layer)};
}
export function paintAssetIds(paint?: PaintDocument): string[] {
  return paint?.layers.flatMap(layer => layer.image ? [layer.image.assetId] : []) ?? [];
}
export function validatePaintDocument(value: PaintDocument, assets: readonly ImageAsset[],allowEmptyScene=false): void {
  const fail = () => { throw new Error('ペイントのレイヤーまたは参照画像が不正です'); };
  const box = (b?: BBox) => b && [b.x,b.y,b.w,b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;
  if (!value || value.version !== 1 || ![value.width,value.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 16384)
      || value.width * value.height > 100_000_000 || !Number.isFinite(value.dpi) || value.dpi <= 0
      || !Array.isArray(value.layers) || (!allowEmptyScene&&!value.layers.length&&!value.folders?.length) || value.layers.length > 64
      || (value.folders!==undefined&&(!Array.isArray(value.folders)||value.folders.length>64))
      || (value.referenceFrame !== undefined && !box(value.referenceFrame))) fail();
  if(value.guideInitialized!==undefined&&typeof value.guideInitialized!=='boolean')fail();
  if(value.background3d!==undefined)validateBackgroundCapture(value.background3d);
  const folderIds=new Set<string>();
  for(const folder of value.folders??[]){
    if(!folder||typeof folder.id!=='string'||!folder.id||folderIds.has(folder.id)||typeof folder.name!=='string'||!folder.name||!Number.isSafeInteger(folder.position)||folder.position<0||folder.position>value.layers.length)fail();
    folderIds.add(folder.id);
  }
  const ids = new Set<string>(); let points = 0;
  for (const layer of value.layers) {
    if (!layer || typeof layer.id !== 'string' || !layer.id || ids.has(layer.id) || typeof layer.name !== 'string'
      || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1
      || !['normal','multiply'].includes(layer.blend) || !Array.isArray(layer.strokes) || (layer.clip && !box(layer.clip))) fail();
    if(layer.guide!==undefined&&typeof layer.guide!=='boolean')fail();
    if(layer.generationMask&&(typeof layer.generationMask.enabled!=='boolean'||!Array.isArray(layer.generationMask.strokes)))fail();
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
    for (const stroke of [...layer.strokes,...(layer.mask?.strokes??[]),...(layer.generationMask?.strokes??[])]) {
      if (!stroke || !['pen','eraser','line','rectangle','ellipse','fill','clear'].includes(stroke.tool) || (stroke.color!==null&&(typeof stroke.color!=='string'||!/^#[0-9a-f]{6}$/i.test(stroke.color)))
        || !Number.isFinite(stroke.size) || stroke.size <= 0 || !Array.isArray(stroke.points) || !stroke.points.length) fail();
      if(stroke.fill!==undefined&&!validPaintInk(stroke.fill))fail();
      if(stroke.selection!==undefined&&(!Array.isArray(stroke.selection)||stroke.selection.some(b=>!box(b))))fail();
      if((stroke.tool==='fill'||stroke.tool==='clear')&&!stroke.selection)fail();
      points += stroke.points.length+(stroke.selection?.length??0);
      if (points > 2_000_000) fail();
      for (const p of stroke.points) if (!p || ![p.x,p.y,p.pressure,p.time].every(Number.isFinite) || p.pressure < 0 || p.pressure > 1) fail();
    }
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
      for (const source of image.paint.layers) {
        const layer = structuredClone(source);
        layer.id = crypto.randomUUID();
        if(layer.folderId){const mapped=folderIds.get(layer.folderId);if(mapped)layer.folderId=mapped;else delete layer.folderId;}
        if(doc.background3d)doc.background3d.layerIds=doc.background3d.layerIds.map(id=>id===source.id?layer.id:id);
        layer.opacity *= image.opacity; layer.visible &&= !image.hidden;
        const previous = source.clip ? mapBox(source.clip) : fit;
        const x = Math.max(previous.x,fit.x), y = Math.max(previous.y,fit.y);
        const right = Math.min(previous.x+previous.w,fit.x+fit.w), bottom = Math.min(previous.y+previous.h,fit.y+fit.h);
        if (right <= x || bottom <= y) continue;
        layer.clip = {x,y,w:right-x,h:bottom-y};
        if (layer.image) layer.image.bbox = mapBox(layer.image.bbox);
        const mapStroke=(stroke:PaintLayer['strokes'][number])=>({...stroke,size:stroke.size*scale,...(stroke.selection?{selection:stroke.selection.map(mapBox)}:{}),points:stroke.points.map(p=>({...p,x:offset.x+p.x*scale,y:offset.y+p.y*scale}))});
        layer.strokes=layer.strokes.map(mapStroke);
        if(layer.mask)layer.mask={...layer.mask,strokes:layer.mask.strokes.map(mapStroke)};
        if(layer.generationMask)layer.generationMask={...layer.generationMask,strokes:layer.generationMask.strokes.map(mapStroke)};
        if(layer.tone){const origin=layer.tone.origin??{x:0,y:0};layer.tone={...layer.tone,origin:{x:offset.x+origin.x*scale,y:offset.y+origin.y*scale}};}
        if(layer.paths)layer.paths=layer.paths.map(path=>transformVector(path,offset.x,offset.y,scale));
        doc.layers.push(layer);
      }
      if(folderIds.size){
        doc.folders??=[];const added=doc.layers.length-folderStart;
        for(const folder of image.paint.folders??[]){const id=folderIds.get(folder.id)!;const children=doc.layers.map((layer,index)=>layer.folderId===id?index:-1).filter(index=>index>=0);
          doc.folders.push({...folder,id,position:children.length?Math.min(...children):folderStart+Math.max(0,Math.min(added,folder.position))});}
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
  description?: string;
  backgroundLevel?: Panel['bg'];
  /** This folder's own lock; its right-side lock remains available for unlocking. */
  locked?: boolean;
  /** An enclosing panel folder owns the lock; descendant locks are display-only. */
  inheritedLocked?: boolean;
}
export interface PaintScene { frame: BBox; owners: PaintOwner[]; colorMode?:PaintColorMode }

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
  const original={...newPaintLayer('吹き出し原画'),guide:true,visible:false};
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
  return !paint || paint.layers.some(layer => layer.visible && layer.opacity > 0 && paintLayerHasContent(layer));
}

/** Each object is a separate group; source data is referenced, never replaced by strokes. */
export function paintScene(panel: Panel, dpi: number, assets: ImageAsset[],colorMode:PaintColorMode='color',directScope?:'panel'|'page'): PaintScene {
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
    owners.push({key:`bubble-${index}`,kind:'bubble',index,label:`吹き出し ${index+1}`,frame:box,bubble,locked:bubble.locked===true||bubble.paint_overlay?.locked===true,inheritedLocked,
      paint:bubblePaintForFrame(bubble,box,dpi,assets,colorMode)});
  });
  if(directScope){
    const direct=(panel.images??[]).filter(image=>image.paintScope===directScope);
    const directFrame=direct.length===1?direct[0].bbox:frame;
    const paint=paintForFrame(directFrame,dpi,direct,assets,colorMode,false);
    paint.guideInitialized=true;
    owners.push({key:directScope,kind:directScope,index:0,label:directScope==='page'?'コマ外':'コマ内',frame:directFrame,paint,locked:panel.layer?.directLocked===true,inheritedLocked});
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
    owners.push({key:`original-${image.id}`,kind:'original',index,label:image.bubbleOriginal.name,
      frame:{...image.bbox},original:image,locked:image.locked,inheritedLocked,paint:{...paint,guideInitialized:true}});
  });
  const artKeys=panelArtKeys(panel);
  // Page foreground sits over page-direct paint; panel-direct paint sits over panel artwork.
  const baseKeys=directScope==='page'?['background','page',...artKeys.filter(key=>key!=='background')]:[...artKeys,...(directScope?[directScope]:[])];
  const keys=[...baseKeys,...owners.filter(o=>o.kind==='bubble'||o.kind==='original').map(o=>o.key)];
  return {frame,owners:keys.map(key=>owners.find(o=>o.key===key)!),colorMode};
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
      ...(layer.generationMask?{generationMask:{...layer.generationMask,strokes:layer.generationMask.strokes.map(shiftStroke)}}:{}),
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
      if(stroke.tool==='eraser'||stroke.tool==='clear')continue;
      if(stroke.selection){for(const box of stroke.selection)include(box.x,box.y,box.w,box.h);continue;}
      for(const point of stroke.points)include(point.x,point.y,0,0,stroke.size/2+2);
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
  else if(owner.kind==='panel'||owner.kind==='page')panel.images=[...(panel.images??[]).filter(item=>item.paintScope!==owner.kind),{...image,paintScope:owner.kind}];
  else if(owner.kind==='figure') {
    const figure=panel.figures?.[owner.index];
    if(!figure)throw new Error('人物の配置先が見つかりません');
    figure.artwork=content; figure.bbox={...bbox};
    if(figure.analogImport&&owner.figure?.analogImport?.userEdited)figure.analogImport={...figure.analogImport,userEdited:true};
  } else if(owner.kind==='bubble') {
    const bubble=panel.bubbles?.[owner.index];
    if(!bubble)throw new Error('吹き出しの配置先が見つかりません');
    bubble.paint_overlay=content; bubble.bbox={...bbox};
    if(bubble.analogTextImport&&owner.paint.guideInitialized)bubble.analogTextImport.rasterLayerInitialized=true;
  } else throw new Error('描画先が見つかりません');
}

/** Removing the final editable layer restores the native owner instead of saving a blank PNG. */
export function clearOwnerPaint(panel: {figures?:Figure[];bubbles?:Bubble[];background_images?:PlacedImage[];images?:PlacedImage[]}, owner: PaintOwner): void {
  if(owner.kind==='original'){panel.images=panel.images?.filter(image=>image.id!==owner.original?.id);return;}
  if(owner.kind==='background'){panel.background_images=[];return;}
  if(owner.kind==='panel'||owner.kind==='page'){panel.images=(panel.images??[]).filter(item=>item.paintScope!==owner.kind);return;}
  if(owner.kind==='figure'){
    const figure=panel.figures?.[owner.index];
    if(!figure)throw new Error('人物の配置先が見つかりません');
    panel.figures![owner.index]=restoreFigureGuide(figure);return;
  }
  if(owner.kind!=='bubble')throw new Error('描画先が見つかりません');
  const bubble=panel.bubbles?.[owner.index];
  if(!bubble)throw new Error('吹き出しの配置先が見つかりません');
  delete bubble.paint_overlay;
  if(bubble.analogTextImport)bubble.analogTextImport.rasterLayerInitialized=true;
}
