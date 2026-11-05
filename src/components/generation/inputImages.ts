import type { BBox, ImageAsset, PaintDocument } from '../../types.ts';
import { blobDataUrl } from '../../lib/localBridge.ts';
import { type PaintOwner, validatePaintDocument } from '../../lib/paintDocument.ts';
import { type PaintImages, decodePaintImage, loadPaintImages, renderPaintPng } from '../../lib/paintRenderer.ts';
import { qwenLayerPaint } from '../../lib/qwenGeneration.ts';
import { prepareGuideLayer } from '../../lib/paintGuide.ts';

/** Crop only an explicitly selected area; references retain their native pixel grid. */
export async function qwenInputImage(blob:Blob,crop?:BBox,native=false):Promise<{image:string;width:number;height:number}> {
  if(!blob.type.startsWith('image/')||blob.size>40*1024*1024)throw new Error('40MiB以内の画像を選んでください');
  const bitmap=await createImageBitmap(blob);
  try{
    const source=crop??{x:0,y:0,w:bitmap.width,h:bitmap.height};
    if(![source.x,source.y,source.w,source.h].every(Number.isFinite)||source.x<0||source.y<0||source.w<=0||source.h<=0||source.x+source.w>bitmap.width||source.y+source.h>bitmap.height)throw new Error('参照画像の切り出し範囲が不正です');
    const scale=native?1:Math.min(1,2048/Math.max(source.w,source.h));
    if(!crop && scale===1 && blob.type==='image/png')return {image:await blobDataUrl(blob),width:bitmap.width,height:bitmap.height};
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(source.w*scale));canvas.height=Math.max(1,Math.round(source.h*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('参照画像を用意できません');
    context.drawImage(bitmap,source.x,source.y,source.w,source.h,0,0,canvas.width,canvas.height);
    return {image:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
  }finally{bitmap.close();}
}

/** Export a single captured owner layer using the editor's existing renderer. */
export async function qwenLayerImage(owner:PaintOwner,id:string,assets:ImageAsset[],liveImages?:PaintImages,includeGeneration=false):Promise<Blob> {
  let paint:PaintDocument=qwenLayerPaint(owner,id,includeGeneration);
  const owned:HTMLImageElement[]=[];
  let images=liveImages;
  try {
    for(const layer of paint.layers.filter(layer=>layer.guide&&!layer.image)){
      const prepared=await prepareGuideLayer(owner,layer);
      paint={...paint,layers:paint.layers.map(item=>item===layer?prepared.layer:item)};assets=[...assets,prepared.asset];
      images=new Map(images);
      const image=await decodePaintImage(prepared.blob);owned.push(image);images.set(prepared.asset.id,image);
    }
    validatePaintDocument(paint,assets);
    const retained=images??new Map(),loaded=await loadPaintImages([paint],assets,new Map(),retained);
    loaded.forEach((image,id)=>{if(image!==retained.get(id))owned.push(image);});images=loaded;
    return await renderPaintPng(paint,images,includeGeneration);
  } finally { owned.forEach(image=>{image.src='';}); }
}
