import { drawVectorPath, applyInkAntialias } from './vectorRenderer.ts';
import type { ImageAsset, PaintDocument, PaintLayer, PaintStroke } from '../types.ts';
import { loadFigureCropAsset } from './figureCropStore.ts';
import { paintAssetIds } from './paintDocument.ts';
import { applyPaintTone } from './paintTone.ts';
import { maskStroke } from './paintMask.ts';
import type { PendingPaintStroke } from './paintGesture.ts';
import { pressureRadius } from './paintStroke.ts';
import { applyPaintColor, paintColorInk } from './paintColor.ts';

export type PaintImages = Map<string, HTMLImageElement>;
export async function decodePaintImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}
export async function loadPaintImages(documents: PaintDocument[], assets: ImageAsset[], pending:ReadonlyMap<string,Blob>=new Map()): Promise<PaintImages> {
  const images: PaintImages = new Map();
  try {
    for (const id of new Set(documents.flatMap(paintAssetIds))) {
      const asset = assets.find(asset=>asset.id===id), blob = pending.get(id) ?? (asset && await loadFigureCropAsset(asset.storageId));
      if (!blob) throw new Error('元画像を読み込めません。作品フォルダから開き直してください');
      images.set(id,await decodePaintImage(blob));
    }
    return images;
  } catch (error) { images.forEach(image=>{image.src='';}); throw error; }
}
export function drawPaintStroke(ctx: CanvasRenderingContext2D, stroke: PaintStroke): void {
  const points = stroke.points;
  if (!points.length) return;
  ctx.save();
  ctx.globalCompositeOperation = (stroke.tool === 'eraser'||stroke.tool==='clear') ? 'destination-out' : 'source-over';
  ctx.fillStyle = stroke.tool==='eraser'?'#000000':stroke.color??'transparent'; ctx.strokeStyle = stroke.color??'transparent';
  if(stroke.tool==='fill'||stroke.tool==='clear'){
    // These rectangles are the fill itself. Clipping to them as well would
    // multiply antialias coverage and fade thin regions in reduced previews.
    ctx.fillStyle=stroke.color??'#000000';ctx.beginPath();for(const b of stroke.selection??[])ctx.rect(b.x,b.y,b.w,b.h);ctx.fill();ctx.restore();return;
  }
  if(stroke.selection){ctx.beginPath();for(const b of stroke.selection)ctx.rect(b.x,b.y,b.w,b.h);ctx.clip();}
  ctx.lineWidth = stroke.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const a = points[0], b = points[points.length-1];
  if (stroke.tool === 'line' || stroke.tool === 'rectangle' || stroke.tool === 'ellipse') {
    ctx.beginPath();
    if (stroke.tool === 'line') { ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); }
    else if (stroke.tool === 'rectangle') ctx.rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));
    else ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.max(.01,Math.abs(b.x-a.x)/2),Math.max(.01,Math.abs(b.y-a.y)/2),0,0,2*Math.PI);
    if(stroke.tool!=='line'&&stroke.fill){ctx.fillStyle=stroke.fill;ctx.fill();}
    if(stroke.color)ctx.stroke();
  } else {
    // Opaque ink varies width with pressure. Each stroke is one filled path,
    // so overlapping dabs don't repeatedly darken antialiased edges.
    ctx.beginPath();
    const dab = (x: number,y: number,p: number) => { const r=pressureRadius(stroke.size,p);ctx.moveTo(x+r,y);ctx.arc(x,y,r,0,Math.PI*2); };
    dab(a.x,a.y,a.pressure);
    for (let i=1;i<points.length;i++) {
      const p=points[i-1],q=points[i],distance=Math.hypot(q.x-p.x,q.y-p.y);
      const steps=Math.max(1,Math.ceil(distance/Math.max(.25,stroke.size*.12)));
      for(let j=1;j<=steps;j++){const t=j/steps;dab(p.x+(q.x-p.x)*t,p.y+(q.y-p.y)*t,p.pressure+(q.pressure-p.pressure)*t);}
    }
    ctx.fill();
  }
  ctx.restore();
}
function context(canvas: HTMLCanvasElement,readPixels=false): CanvasRenderingContext2D {
  const ctx=canvas.getContext('2d',{willReadFrequently:readPixels});
  if(!ctx)throw new Error('ペイントの描画領域を作れませんでした');
  return ctx;
}
function monochromeStroke(stroke:PaintStroke):PaintStroke {
  return {...stroke,color:paintColorInk(stroke.color,'monochrome'),...(stroke.fill!==undefined?{fill:paintColorInk(stroke.fill,'monochrome')}:{})};
}
function drawLayer(ctx: CanvasRenderingContext2D, layer: PaintLayer, images: PaintImages, paint:PaintDocument) {
  ctx.save();
  if(layer.clip){const b=layer.clip;ctx.beginPath();ctx.rect(b.x,b.y,b.w,b.h);ctx.clip();}
  if(layer.tone?.fill){ctx.fillStyle='#000000';ctx.fillRect(0,0,paint.width,paint.height);}
  if(layer.image){const image=images.get(layer.image.assetId);if(!image)throw new Error('レイヤーの元画像が不足しています');
    const c=layer.image.crop,b=layer.image.bbox;ctx.drawImage(image,c.x,c.y,c.w,c.h,b.x,b.y,b.w,b.h);}
  const mono=layer.colorMode==='monochrome'&&!layer.tone?.enabled;
  for(const stroke of layer.strokes)drawPaintStroke(ctx,mono?monochromeStroke(stroke):stroke);
  for(const path of layer.paths??[])drawVectorPath(ctx,mono?{...path,style:{...path.style,stroke:paintColorInk(path.style.stroke,'monochrome'),fill:paintColorInk(path.style.fill,'monochrome')}}:path);
  ctx.restore();
}

type LiveStroke=Pick<PendingPaintStroke,'layerId'|'stroke'|'target'>;
function applyMaskAntialias(canvas:HTMLCanvasElement,paint:PaintDocument,layer:PaintLayer){
  // Quantize coverage at document resolution. A reduced preview still needs
  // fractional coverage to represent edges smaller than a display pixel.
  applyInkAntialias(context(canvas),canvas.width,canvas.height,
    canvas.width>=paint.width&&canvas.height>=paint.height?(layer.colorMode==='monochrome'?0:layer.antialias):3);
}
export function drawPaintMask(canvas:HTMLCanvasElement,paint:PaintDocument,layer:PaintLayer,live?:LiveStroke){
  // Reading coverage must not switch rasterizers between the live stroke and
  // the committed mask, which can move thresholded boundary pixels.
  const ctx=context(canvas,true);ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  if(layer.mask?.reveal){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);}
  ctx.scale(canvas.width/paint.width,canvas.height/paint.height);
  for(const stroke of layer.mask?.strokes??[])drawPaintStroke(ctx,maskStroke(stroke));
  if(live?.target==='mask')drawPaintStroke(ctx,maskStroke(live.stroke));
  applyMaskAntialias(canvas,paint,layer);
}
function drawGenerationMask(canvas:HTMLCanvasElement,paint:PaintDocument,layer:PaintLayer,live?:LiveStroke){
  const ctx=context(canvas,true);ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();ctx.scale(canvas.width/paint.width,canvas.height/paint.height);
  if(layer.clip){const b=layer.clip;ctx.beginPath();ctx.rect(b.x,b.y,b.w,b.h);ctx.clip();}
  for(const stroke of layer.generationMask?.strokes??[])drawPaintStroke(ctx,stroke);
  if(live?.target==='generationMask')drawPaintStroke(ctx,live.stroke);
  ctx.restore();applyMaskAntialias(canvas,paint,layer);
}
function renderLayer(canvas:HTMLCanvasElement,paint:PaintDocument,layer:PaintLayer,images:PaintImages,mask:HTMLCanvasElement,live?:LiveStroke,includeGeneration=false,preview=false){
  const convert=layer.colorMode!==undefined&&layer.colorMode!=='color';
  const ctx=context(canvas,true);ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  // Threshold imported pixels before resampling; thresholding a reduced image
  // would erase thin black lines blended with opaque white surroundings.
  if(layer.colorMode==='monochrome'&&layer.image&&!layer.tone?.enabled&&(canvas.width<paint.width||canvas.height<paint.height)){
    const native=document.createElement('canvas'),nativeMask=document.createElement('canvas');native.width=paint.width;native.height=paint.height;
    try{renderLayer(native,paint,layer,images,nativeMask,live,includeGeneration,false);
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(native,0,0,canvas.width,canvas.height);
    }finally{native.width=native.height=nativeMask.width=nativeMask.height=1;}
    return;
  }
  ctx.save();ctx.scale(canvas.width/paint.width,canvas.height/paint.height);
  drawLayer(ctx,live&&!live.target?{...layer,strokes:[...layer.strokes,live.stroke]}:layer,images,paint);ctx.restore();
  if(!layer.image&&layer.colorMode!=='monochrome')applyInkAntialias(ctx,canvas.width,canvas.height,layer.antialias);
  if(layer.tone?.enabled){const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);applyPaintTone(pixels,layer.tone,paint.dpi,paint.width,paint.height,preview);ctx.putImageData(pixels,0,0);}
  if(layer.mask?.enabled){
    mask.width=canvas.width;mask.height=canvas.height;drawPaintMask(mask,paint,layer,live);
    ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0);ctx.globalCompositeOperation='source-over';
  }
  if(convert){const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    applyPaintColor(pixels.data,layer.colorMode,canvas.width>=paint.width&&canvas.height>=paint.height);ctx.putImageData(pixels,0,0);}
  if(includeGeneration&&layer.generationMask?.enabled){
    mask.width=canvas.width;mask.height=canvas.height;drawGenerationMask(mask,paint,layer,live);
    ctx.drawImage(mask,0,0);
  }
}

/** Cache final layers. Live mask edits always render from the retained artwork. */
export function paintPreviewRenderer() {
  const cache=new Map<string,{layer:PaintLayer;canvas:HTMLCanvasElement}>(); let dimensions='';
  // Keep at most 64 MiB of layer pixels per owner. Large native-resolution
  // layers render through a temporary canvas instead of accumulating per layer.
  const maxCachePixels=16*1024*1024;
  let cachePixels=0;
  const release=(id:string)=>{const entry=cache.get(id);if(!entry)return;
    cachePixels-=entry.canvas.width*entry.canvas.height;entry.canvas.width=entry.canvas.height=1;cache.delete(id);};
  const clear=()=>{for(const id of cache.keys())release(id);};
  const scratch=document.createElement('canvas'),mask=document.createElement('canvas');
  // A live stroke can move between color modes; keep its rasterizer stable.
  context(scratch,true);
  return {
    draw(canvas:HTMLCanvasElement, paint:PaintDocument, images:PaintImages, live?:LiveStroke, maskPreviewId?:string,includeGeneration=true) {
      const nextDimensions=[canvas.width,canvas.height,paint.width,paint.height,paint.dpi,includeGeneration].join(':');
      if(dimensions!==nextDimensions){clear();dimensions=nextDimensions;}
      for(const id of cache.keys())if(!paint.layers.some(layer=>layer.id===id&&layer.visible))release(id);
      const out=context(canvas);out.clearRect(0,0,canvas.width,canvas.height);
      for(const layer of paint.layers){
        if(!layer.visible)continue;
        // Show coverage instead of dots while editing an independent tone.
        if(layer.id===maskPreviewId&&layer.tone?.fill&&layer.mask?.enabled)continue;
        if(cache.get(layer.id)?.layer.colorMode!==layer.colorMode)release(layer.id);
        const cached=cache.get(layer.id);
        let source=cached?.canvas ?? document.createElement('canvas');
        if(cached?.layer!==layer){source.width=canvas.width;source.height=canvas.height;
          renderLayer(source,paint,layer,images,mask,undefined,includeGeneration,true);
          const pixels=canvas.width*canvas.height;
          if(pixels<=maxCachePixels){
            if(!cached){while(cachePixels+pixels>maxCachePixels)release(cache.keys().next().value!);cachePixels+=pixels;}
            cache.set(layer.id,{layer,canvas:source});
          }
        }
        const rendered=source;
        if(live?.layerId===layer.id){scratch.width=canvas.width;scratch.height=canvas.height;
          const reducedMono=layer.colorMode==='monochrome'&&(canvas.width<paint.width||canvas.height<paint.height);
          if(layer.mask?.enabled||layer.tone?.enabled||layer.generationMask?.enabled||layer.colorMode&&layer.colorMode!=='color'&&!reducedMono)renderLayer(scratch,paint,layer,images,mask,live,includeGeneration,true);
          else {const ctx=context(scratch);ctx.drawImage(source,0,0);ctx.scale(canvas.width/paint.width,canvas.height/paint.height);
            if(layer.clip){const b=layer.clip;ctx.beginPath();ctx.rect(b.x,b.y,b.w,b.h);ctx.clip();}
            // Keep the converted image cached while the pointer moves. Native
            // pixels are rebuilt on commit; reduced live ink keeps coverage.
            drawPaintStroke(ctx,reducedMono?monochromeStroke(live.stroke):live.stroke);if(!layer.image&&!reducedMono)applyInkAntialias(ctx,scratch.width,scratch.height,layer.antialias);}
          source=scratch;}
        out.globalAlpha=layer.opacity;out.globalCompositeOperation=layer.blend==='multiply'?'multiply':'source-over';out.drawImage(source,0,0);
        if(!cache.has(layer.id))rendered.width=rendered.height=1;
      }
      out.globalAlpha=1;out.globalCompositeOperation='source-over';
      const coverage=paint.layers.find(layer=>layer.id===maskPreviewId&&layer.visible&&layer.mask?.enabled);
      if(coverage){
        mask.width=canvas.width;mask.height=canvas.height;
        drawPaintMask(mask,paint,coverage,live?.layerId===coverage.id?live:undefined);
        const ctx=context(mask);ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle='#ff0000';ctx.fillRect(0,0,mask.width,mask.height);ctx.globalCompositeOperation='source-over';
        out.save();out.globalAlpha=.58;
        if(coverage.clip){const b=coverage.clip,sx=canvas.width/paint.width,sy=canvas.height/paint.height;out.beginPath();out.rect(b.x*sx,b.y*sy,b.w*sx,b.h*sy);out.clip();}
        out.drawImage(mask,0,0);out.restore();
      }
    },
    dispose(){clear();scratch.width=mask.width=1;scratch.height=mask.height=1;},
  };
}

/** Export at document resolution; working canvases are shared by all layers. */
export async function renderPaintPng(paint:PaintDocument,images:PaintImages,includeGeneration=false):Promise<Blob>{
  const canvas=document.createElement('canvas'),scratch=document.createElement('canvas'),mask=document.createElement('canvas');
  context(scratch,true);
  canvas.width=scratch.width=paint.width;canvas.height=scratch.height=paint.height;
  try{
    const out=context(canvas);
    for(const layer of paint.layers){if(!layer.visible)continue;renderLayer(scratch,paint,layer,images,mask,undefined,includeGeneration);
      out.globalAlpha=layer.opacity;out.globalCompositeOperation=layer.blend==='multiply'?'multiply':'source-over';out.drawImage(scratch,0,0);}
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('画像の書き出しに失敗しました')),'image/png'));
  }finally{canvas.width=scratch.width=mask.width=1;canvas.height=scratch.height=mask.height=1;}
}

/** Read actual document pixels, independent of page zoom and layer opacity. */
export function readPaintPixels(paint:PaintDocument,layer:PaintLayer,images:PaintImages):ImageData {
  const canvas=document.createElement('canvas'),mask=document.createElement('canvas');canvas.width=paint.width;canvas.height=paint.height;
  try{renderLayer(canvas,paint,layer,images,mask);return context(canvas).getImageData(0,0,canvas.width,canvas.height);}finally{canvas.width=mask.width=canvas.height=mask.height=1;}
}
export function readPaintMaskPixels(paint:PaintDocument,layer:PaintLayer):ImageData {
  const canvas=document.createElement('canvas');canvas.width=paint.width;canvas.height=paint.height;
  try{drawPaintMask(canvas,paint,layer);return context(canvas).getImageData(0,0,canvas.width,canvas.height);}finally{canvas.width=canvas.height=1;}
}

export function readGenerationMaskPixels(paint:PaintDocument,layer:PaintLayer):ImageData {
  const canvas=document.createElement('canvas');canvas.width=paint.width;canvas.height=paint.height;
  try{drawGenerationMask(canvas,paint,layer);return context(canvas).getImageData(0,0,canvas.width,canvas.height);}finally{canvas.width=canvas.height=1;}
}
