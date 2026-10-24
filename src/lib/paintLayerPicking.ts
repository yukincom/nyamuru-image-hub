import type { BBox, PaintLayer, PaintStroke, VectorPoint } from '../types.ts';
import type { PaintOwner, PaintScene } from './paintDocument.ts';
import { paintLayerEditable } from './paintLock.ts';
import { hitVector, transformVector } from './vectorGeometry.ts';
import { readPaintPixels, type PaintImages } from './paintRenderer.ts';

export interface PaintLayerHit {owner:PaintOwner;layer:PaintLayer;point:VectorPoint;pathId?:string}
export type PaintLayerCoverage=(owner:PaintOwner,layer:PaintLayer,point:VectorPoint,tolerance:number)=>boolean;
const inside=(point:VectorPoint,box:BBox)=>point.x>=box.x&&point.y>=box.y&&point.x<box.x+box.w&&point.y<box.y+box.h;
export function paintOwnerPoint(owner:PaintOwner,point:VectorPoint):VectorPoint {
  return {x:(point.x-owner.frame.x)*owner.paint.width/owner.frame.w,y:(point.y-owner.frame.y)*owner.paint.height/owner.frame.h};
}
/** Scene owners and their layers are stored back-to-front. Tolerance is in paper units. */
export function pickPaintLayer(scene:PaintScene,point:VectorPoint,tolerance:number,coverage:PaintLayerCoverage):PaintLayerHit|undefined {
  for(const owner of [...scene.owners].reverse()){
    if(owner.bubble?.hidden||!inside(point,owner.frame))continue;
    const local=paintOwnerPoint(owner,point),radius=tolerance*Math.max(owner.paint.width/owner.frame.w,owner.paint.height/owner.frame.h);
    for(const layer of [...owner.paint.layers].reverse()){
      if(!layer.visible||layer.opacity<=0||!paintLayerEditable(owner,layer)||layer.clip&&!inside(local,layer.clip))continue;
      const paths=layer.paths?.filter(path=>path.style.stroke!==null||path.style.fill!==null)??[];
      const pathId=hitVector(paths,local,radius);
      if(layer.kind==='vector'&&!pathId&&!layer.image&&!layer.strokes.length&&!layer.tone?.fill)continue;
      if(coverage(owner,layer,local,pathId?radius:0))return {owner,layer,point:local,...(pathId?{pathId}:{})};
    }
  }
}

/** Native alpha, including masks, erasure, dashed lines and tone gaps. Bounded cache. */
export function paintLayerCoverage(images:PaintImages):PaintLayerCoverage {
  const cache=new Map<PaintLayer,{width:number;height:number;alpha:Uint8Array}>();let bytes=0;
  return (owner,layer,point,tolerance)=>{
    let pixels=cache.get(layer);
    if(!pixels||pixels.width!==owner.paint.width||pixels.height!==owner.paint.height){
      if(pixels){bytes-=pixels.alpha.byteLength;cache.delete(layer);}
      const rgba=readPaintPixels(owner.paint,layer,images),alpha=new Uint8Array(rgba.width*rgba.height);
      for(let i=0;i<alpha.length;i++)alpha[i]=rgba.data[i*4+3];
      pixels={width:rgba.width,height:rgba.height,alpha};
      const maxBytes=64*1024*1024;
      if(alpha.byteLength<=maxBytes){
        while(cache.size&&bytes+alpha.byteLength>maxBytes){const first=cache.keys().next().value!;bytes-=cache.get(first)!.alpha.byteLength;cache.delete(first);}
        cache.set(layer,pixels);bytes+=alpha.byteLength;
      }
    }
    const x=Math.floor(point.x),y=Math.floor(point.y),r=Math.ceil(tolerance);
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      if(dx*dx+dy*dy>tolerance*tolerance&&r>0)continue;
      const px=x+dx,py=y+dy;
      if(px>=0&&py>=0&&px<pixels.width&&py<pixels.height&&pixels.alpha[py*pixels.width+px]>0)return true;
    }
    return false;
  };
}

/** Move one editable layer; siblings, document grid and source pixels stay intact. */
export function translatePaintLayer(layer:PaintLayer,dx:number,dy:number):PaintLayer {
  if(layer.locked||(!dx&&!dy))return layer;
  const box=(b:BBox)=>({...b,x:b.x+dx,y:b.y+dy});
  const stroke=(s:PaintStroke)=>({...s,points:s.points.map(p=>({...p,x:p.x+dx,y:p.y+dy})),...(s.selection?{selection:s.selection.map(box)}:{})});
  return {...layer,...(layer.image?{image:{...layer.image,bbox:box(layer.image.bbox)}}:{}),...(layer.clip?{clip:box(layer.clip)}:{}),
    strokes:layer.strokes.map(stroke),...(layer.paths?{paths:layer.paths.map(p=>transformVector(p,dx,dy))}:{}),
    ...(layer.mask?{mask:{...layer.mask,strokes:layer.mask.strokes.map(stroke)}}:{}),
    ...(layer.generationMask?{generationMask:{...layer.generationMask,strokes:layer.generationMask.strokes.map(stroke)}}:{}),
    ...(layer.tone?{tone:{...layer.tone,origin:{x:(layer.tone.origin?.x??0)+dx,y:(layer.tone.origin?.y??0)+dy}}}:{})};
}
