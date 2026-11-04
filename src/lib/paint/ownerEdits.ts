import type { PaintDocument, BBox, Figure, PaintLayer, ImageAsset, Bubble, PlacedImage, PageOverlay } from '../../types.ts';
import type { PaintOwner } from './scene.ts';
import { mapBackgroundCapture } from '../background3d.ts';
import { transformVector } from '../vectorGeometry.ts';
import { newPaintLayer, movePaintLayer } from './layerTree.ts';
import { paintStrokeContentBounds } from '../paintStroke.ts';
import { paintStackKey } from './ownerKeys.ts';

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
export function generatedPaintName(sequence:number):string { return `生成 ${String(sequence+1).padStart(2,'0')}`; }

export function hasAdoptedPaintImages(owner:PaintOwner,jobId:string,indices:number[]):boolean {
  return indices.every(index=>owner.paint.layers.some(layer=>layer.generation?.jobId===jobId&&layer.generation.candidateIndex===index));
}

export function insertGeneratedPaintImage(owner:PaintOwner,asset:ImageAsset,name:string,frame: BBox=owner.frame,options:{folderId?:string;generation?:PaintLayer['generation']}={}):{owner:PaintOwner;layer:PaintLayer} {
  if(owner.paint.layers.length>=64)throw new Error('1つのグループには64レイヤーまで追加できます');
  if(options.folderId&&!owner.paint.folders?.some(folder=>folder.id===options.folderId))throw new Error('追加先のフォルダーが見つかりません');
  const px=owner.paint.width/owner.frame.w,py=owner.paint.height/owner.frame.h;
  const box={x:(frame.x-owner.frame.x)*px,y:(frame.y-owner.frame.y)*py,w:frame.w*px,h:frame.h*py};
  const expanded=expandPaintOwnerToBounds(owner,box),paint=expanded.paint;
  const target={x:(frame.x-expanded.frame.x)*px,y:(frame.y-expanded.frame.y)*py,w:box.w,h:box.h};
  // Fit in manuscript coordinates; the layer can have a different pixel density on each axis.
  const scale=Math.min(frame.w/asset.widthPx,frame.h/asset.heightPx),w=asset.widthPx*scale*px,h=asset.heightPx*scale*py;
  const layer:PaintLayer={...newPaintLayer(name),...(options.generation?{generation:options.generation}:{}),...(owner.kind==='bubble'?{aboveNative:true}:{}),image:{assetId:asset.id,crop:{x:0,y:0,w:asset.widthPx,h:asset.heightPx},bbox:{x:target.x+(target.w-w)/2,y:target.y+(target.h-h)/2,w,h}}};
  const appended={...paint,layers:[...paint.layers,layer]};
  const placed=options.folderId?movePaintLayer(appended,layer.id,{kind:'folder',id:options.folderId,placement:'inside'}):appended;
  return {owner:{...expanded,paint:placed},layer:placed.layers.find(item=>item.id===layer.id)!};
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
