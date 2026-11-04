import type { BBox, PlacedImage, ImageAsset, PaintColorMode, PaintDocument, Figure, Bubble, PaintStackPosition, Panel, PageOverlay, MangaPage } from '../../types.ts';
import { validatePaintDocument } from './documentValidation.ts';
import { artworkPixelSize } from '../artworkClipboard.ts';
import { mapBackgroundCapture } from '../background3d.ts';
import { mapPaintLayer } from './layerMapping.ts';
import { newPaintLayer } from './layerTree.ts';
import { paintStackTarget, paintAnchorIds, directPaintOwnerKey, paintStackKey } from './ownerKeys.ts';
import { letteringFigureIndex } from '../bubbleRelations.ts';
import { paintLayerHasContent, paintLayerVisible } from '../paintLock.ts';
import { panelBounds, fallbackBox } from '../canvasGeometry.ts';
import { figureDisplayLabel, textDisplayLabel } from '../displayLabels.ts';
import { panelArtKeys, bubbleArtIndices } from '../panelLayers.ts';

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

export interface PaintScene { frame: BBox; owners: PaintOwner[]; colorMode?:PaintColorMode; anchorIds?:Record<string,string>; /** Page-wide last allocated work-layer number. */ layerSequence?:number; generatedImageSequence?:number }

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
