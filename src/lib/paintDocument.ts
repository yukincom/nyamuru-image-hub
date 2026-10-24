import { validPaintInk } from './paintInk.ts';
import { mapBackgroundCapture, validateBackgroundCapture } from './background3d.ts';
import { panelArtKeys } from './panelLayers.ts';
import { transformVector } from './vectorGeometry.ts';
import type { BBox, Bubble, Figure, ImageAsset, PaintColorMode, PaintDocument, PaintLayer, Panel, PlacedImage } from '../types.ts';
import { fallbackBox, panelBounds } from './canvasGeometry.ts';
import { artworkPixelSize } from './artworkClipboard.ts';

export function newPaintLayer(name = 'レイヤー',kind:PaintLayer['kind']='raster',colorMode:PaintColorMode='color'): PaintLayer {
  return { id: crypto.randomUUID(), name, visible: true, locked: false, opacity: 1, blend: 'normal', strokes: [],kind,colorMode,antialias:3,...(kind==='vector'?{paths:[]}: {}) };
}
export function paintAssetIds(paint?: PaintDocument): string[] {
  return paint?.layers.flatMap(layer => layer.image ? [layer.image.assetId] : []) ?? [];
}
export function validatePaintDocument(value: PaintDocument, assets: readonly ImageAsset[]): void {
  const fail = () => { throw new Error('ペイントのレイヤーまたは参照画像が不正です'); };
  const box = (b?: BBox) => b && [b.x,b.y,b.w,b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;
  if (!value || value.version !== 1 || ![value.width,value.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 16384)
      || value.width * value.height > 100_000_000 || !Number.isFinite(value.dpi) || value.dpi <= 0
      || !Array.isArray(value.layers) || !value.layers.length || value.layers.length > 64
      || (value.referenceFrame !== undefined && !box(value.referenceFrame))) fail();
  if(value.guideInitialized!==undefined&&typeof value.guideInitialized!=='boolean')fail();
  if(value.background3d!==undefined)validateBackgroundCapture(value.background3d);
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
export function paintForFrame(frame: BBox, dpi: number, images: PlacedImage[], assets: ImageAsset[],colorMode:PaintColorMode='color'): PaintDocument {
  if (images.length === 1 && images[0].paint) {
    const image = images[0], paint = image.paint!;
    validatePaintDocument(paint, assets);
    if (image.bbox.x === frame.x && image.bbox.y === frame.y && image.bbox.w === frame.w && image.bbox.h === frame.h
      && image.crop.x === 0 && image.crop.y === 0 && image.crop.w === paint.width && image.crop.h === paint.height
      && image.opacity === 1 && !image.hidden
      // Allow pixel rounding, but reframe actual aspect-ratio edits with contain fit.
      && Math.abs(paint.width*frame.h-paint.height*frame.w) <= (frame.w+frame.h)/2 + 1e-7) return structuredClone(paint);
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
      for (const source of image.paint.layers) {
        const layer = structuredClone(source);
        layer.id = crypto.randomUUID();
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
    } else {
      doc.layers.push({...newPaintLayer(asset.originalName),visible:!image.hidden,opacity:image.opacity,locked:true,
        image:{assetId:asset.id,crop:{...image.crop},bbox:fit}});
    }
  }
  if (doc.layers.length < 64) doc.layers.push(newPaintLayer('レイヤー','raster',colorMode));
  validatePaintDocument(doc,assets);
  return doc;
}


export interface PaintOwner {
  key: string;
  kind: 'background' | 'figure' | 'bubble';
  index: number;
  label: string;
  frame: BBox;
  paint: PaintDocument;
  figure?: Figure;
  bubble?: Bubble;
  description?: string;
  backgroundLevel?: Panel['bg'];
}
export interface PaintScene { frame: BBox; owners: PaintOwner[]; colorMode?:PaintColorMode }

/** Each object is a separate group; source data is referenced, never replaced by strokes. */
export function paintScene(panel: Panel, dpi: number, assets: ImageAsset[],colorMode:PaintColorMode='color'): PaintScene {
  const frame = panelBounds(panel);
  const backgrounds=panel.background_images ?? [];
  const boxes=[frame,...backgrounds.map(image=>image.bbox)];
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  const backgroundFrame=backgrounds.length===1 ? backgrounds[0].bbox : {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};
  const owners: PaintOwner[] = [{key:'background',kind:'background',index:0,label:'背景あたり',frame:backgroundFrame,backgroundLevel:panel.bg,description:panel.background_description || panel.action || '',
    paint:paintForFrame(backgroundFrame,dpi,backgrounds,assets,colorMode)}];
  (panel.figures ?? []).forEach((figure,index)=>{
    const box = figure.bbox ?? fallbackBox(panel,'figure',index);
    owners.push({key:`figure-${index}`,kind:'figure',index,label:figure.name || `人物 ${index+1}`,frame:box,figure,
      paint:paintForFrame(box,dpi,figure.artwork ? [{...figure.artwork,id:'source',bbox:box}] : [],assets,colorMode)});
  });
  panel.bubbles.forEach((bubble,index)=>{
    const box = bubble.bbox ?? fallbackBox(panel,'bubble',index);
    owners.push({key:`bubble-${index}`,kind:'bubble',index,label:`吹き出し ${index+1}`,frame:box,bubble,
      paint:paintForFrame(box,dpi,bubble.paint_overlay ? [{...bubble.paint_overlay,id:'source',bbox:box}] : [],assets,colorMode)});
  });
  for(const owner of owners){
    if(owner.kind==='bubble'||owner.paint.guideInitialized||owner.paint.layers.length>=64)continue;
    const existing=owner.kind==='background'?backgrounds.length>0:!!owner.figure?.artwork;
    const guide={...newPaintLayer(`あたり · ${owner.kind==='background'?'背景':owner.label}`),guide:true,visible:!existing};
    // Preserve the guide's original colors. The separate blank layer above it
    // carries the work's default expression for subsequent drawing.
    owner.paint={...owner.paint,guideInitialized:true,layers:[guide,...owner.paint.layers]};
  }
  const keys=[...panelArtKeys(panel),...owners.filter(o=>o.kind==='bubble').map(o=>o.key)];
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
  const shift=(box:BBox):BBox=>({...box,x:box.x+left,y:box.y+top});
  const shiftStroke=(stroke:PaintLayer['strokes'][number])=>({...stroke,...(stroke.selection?{selection:stroke.selection.map(shift)}:{}),points:stroke.points.map(p=>({...p,x:p.x+left,y:p.y+top}))});
  return {...owner,frame:{x:b.x-left*b.w/old.width,y:b.y-top*b.h/old.height,w:width*b.w/old.width,h:height*b.h/old.height},
    paint:{...old,width,height,...(old.background3d?{background3d:mapBackgroundCapture(old.background3d,shift)}:{}),referenceFrame:shift(old.referenceFrame??{x:0,y:0,w:old.width,h:old.height}),layers:old.layers.map(layer=>({...layer,
      ...(layer.clip?{clip:shift(layer.clip)}:{}),...(layer.image?{image:{...layer.image,bbox:shift(layer.image.bbox)}}:{}),
      ...(layer.paths?{paths:layer.paths.map(path=>transformVector(path,left,top))}:{}),
      ...(layer.mask?{mask:{...layer.mask,strokes:layer.mask.strokes.map(shiftStroke)}}:{}),
      ...(layer.generationMask?{generationMask:{...layer.generationMask,strokes:layer.generationMask.strokes.map(shiftStroke)}}:{}),
      ...(layer.tone?{tone:{...layer.tone,origin:{x:(layer.tone.origin?.x??0)+left,y:(layer.tone.origin?.y??0)+top}}}:{}),
      strokes:layer.strokes.map(shiftStroke)}))}};
}

/** Ensure a minimum margin; reopening never adds the same margin twice. */
export function withPaintBleed(owner: PaintOwner, pixels: number): PaintOwner {
  if (!Number.isSafeInteger(pixels) || pixels < 0) throw new Error('ぬりたしを確認してください');
  if (owner.figure?.artwork?.locked || owner.bubble?.paint_overlay?.locked) return owner;
  const paint = owner.paint;
  const reference = paint.referenceFrame ?? {x:0,y:0,w:paint.width,h:paint.height};
  const padding = {
    left: Math.max(0, Math.ceil(pixels-reference.x)),
    right: Math.max(0, Math.ceil(pixels-(paint.width-reference.x-reference.w))),
    top: Math.max(0, Math.ceil(pixels-reference.y)),
    bottom: Math.max(0, Math.ceil(pixels-(paint.height-reference.y-reference.h))),
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
export function applyOwnerPaint(panel: {figures?:Figure[];bubbles?:Bubble[];background_images?:PlacedImage[]}, owner: PaintOwner, image: PlacedImage): void {
  const {id: _id,bbox,...content}=image;
  if(owner.kind==='background') panel.background_images=[image];
  else if(owner.kind==='figure') {
    const figure=panel.figures?.[owner.index];
    if(!figure)throw new Error('人物の配置先が見つかりません');
    figure.artwork=content; figure.bbox={...bbox};
    if(figure.analogImport&&owner.figure?.analogImport?.userEdited)figure.analogImport={...figure.analogImport,userEdited:true};
  } else {
    const bubble=panel.bubbles?.[owner.index];
    if(!bubble)throw new Error('吹き出しの配置先が見つかりません');
    bubble.paint_overlay=content; bubble.bbox={...bbox};
  }
}
