import type { BBox, PaintColorMode, PaintLayer, PaintPoint, PaintStroke, VectorPath } from '../types.ts';
import {expandPaintOwnerToBounds,expandPaintOwnerToContent,newPaintLayer,type PaintOwner,type PaintScene} from './paintDocument.ts';
import {paintOwnerLocked} from './paintLock.ts';
import {paintStrokeBounds,paintStrokeContentBounds,type PaintSmoother} from './paintStroke.ts';
export {paintStrokeBounds} from './paintStroke.ts';

export interface PendingPaintStroke {
  ownerKey: string;
  layerId: string;
  stroke: PaintStroke;
  target?: 'mask'|'generationMask';
  /** Insert with the first stroke, so a quick mark on cropped art is one undo step. */
  addedLayer?: PaintLayer;
  /** Pointerdown coordinates; another completed mark may have grown the owner. */
  space?: {frame:BBox;width:number;height:number};
  /** Gesture-only ink extent, updated from new samples; never persisted. */
  bounds?: BBox;
}

function strokeTransform(pending:PendingPaintStroke,owner:PaintOwner){
  if(!pending.space)return;
  const {frame,width,height}=pending.space;
  const rawX=frame.w/width*owner.paint.width/owner.frame.w,rawY=frame.h/height*owner.paint.height/owner.frame.h;
  const sx=Math.abs(rawX-1)<1e-10?1:rawX,sy=Math.abs(rawY-1)<1e-10?1:rawY;
  const dx=(frame.x-owner.frame.x)*owner.paint.width/owner.frame.w,dy=(frame.y-owner.frame.y)*owner.paint.height/owner.frame.h;
  return Math.abs(sx-1)>1e-10||Math.abs(sy-1)>1e-10||Math.abs(dx)>1e-10||Math.abs(dy)>1e-10?{sx,sy,dx,dy}:undefined;
}
function strokeInOwner(pending:PendingPaintStroke,owner:PaintOwner):PaintStroke {
  const t=strokeTransform(pending,owner);if(!t)return pending.stroke;
  const {sx,sy,dx,dy}=t,stroke=pending.stroke;
  return {...stroke,size:stroke.size*Math.sqrt(sx*sy),points:stroke.points.map(p=>({...p,x:p.x*sx+dx,y:p.y*sy+dy})),
    ...(stroke.selection?{selection:stroke.selection.map(b=>({x:b.x*sx+dx,y:b.y*sy+dy,w:b.w*sx,h:b.h*sy}))}:{})};
}
function strokeBoundsInOwner(pending:PendingPaintStroke,owner:PaintOwner):BBox|undefined {
  const b=paintStrokeContentBounds(pending.stroke,pending.bounds??paintStrokeBounds(pending.stroke));if(!b)return;
  const t=strokeTransform(pending,owner);return t?{x:b.x*t.sx+t.dx,y:b.y*t.sy+t.dy,w:b.w*t.sx,h:b.h*t.sy}:b;
}

export interface PaintStrokePreview {source:PaintScene;owner:PaintOwner;scene:PaintScene;live:PendingPaintStroke;}
/** Keep retained ink separate from the live mark so the renderer cache stays valid. */
export function previewPaintStroke(source:PaintScene,pending:PendingPaintStroke,previous?:PaintStrokePreview):PaintStrokePreview|undefined {
  const original=source.owners.find(owner=>owner.key===pending.ownerKey);if(!original)return;
  const owner=previous?.source===source&&previous.owner.key===original.key?previous.owner:original;
  const expanded=expandPaintOwnerToBounds(owner,strokeBoundsInOwner(pending,owner));
  const scene=expanded===original?source:previous?.owner===expanded?previous.scene:{...source,owners:source.owners.map(item=>item===original?expanded:item)};
  return {source,owner:expanded,scene,live:{...pending,stroke:strokeInOwner(pending,expanded)}};
}

/** Guides/source locks are preserved; actual marks may go in a new sibling layer. */
export function paintMarkNeedsLayer(layer:PaintLayer|undefined,kind:PaintLayer['kind']):boolean {
  return !layer||Boolean(layer.guide)||Boolean(layer.locked&&layer.image)||layer.kind!==kind||Boolean(layer.clip);
}
export function canStartPaintMark(owner:PaintOwner,layer:PaintLayer|undefined,kind:PaintLayer['kind']):boolean {
  return !paintOwnerLocked(owner)&&owner.bubble?.hidden!==true
    &&(!layer||Boolean(layer.guide)||layer.visible&&(!layer.locked||Boolean(layer.image)))
    &&(!paintMarkNeedsLayer(layer,kind)||owner.paint.layers.length<64);
}
export function preparePaintMarkLayer(owner:PaintOwner,layer:PaintLayer|undefined,kind:PaintLayer['kind'],colorMode:PaintColorMode='color'):PaintLayer|undefined {
  if(!canStartPaintMark(owner,layer,kind))return;
  return paintMarkNeedsLayer(layer,kind)?newPaintLayer(kind==='vector'?`ベクター ${owner.paint.layers.length+1}`:'レイヤー',kind,colorMode):layer;
}

/** Preview and commit use the same paths; a draft layer is not saved until it has a path. */
export function commitVectorPaths(scene:PaintScene,pending:{ownerKey:string;layerId:string;paths:VectorPath[];addedLayer?:PaintLayer}):PaintScene {
  const owner=scene.owners.find(o=>o.key===pending.ownerKey);
  if(!owner||paintOwnerLocked(owner))return scene;
  const layers=[...owner.paint.layers];let index=layers.findIndex(layer=>layer.id===pending.layerId);
  if(index<0){if(!pending.addedLayer||!pending.paths.length||layers.length>=64)return scene;index=layers.length;layers.push(pending.addedLayer);}
  const layer=layers[index];if(layer.locked||!layer.visible||layer.kind!=='vector')return scene;
  if(index<owner.paint.layers.length&&pending.paths.length===(layer.paths?.length??0)&&pending.paths.every((path,i)=>path===layer.paths![i]))return scene;
  // A source composition crop is not an editing frame. Keep authored crops;
  // new marks on cropped content already use an unrestricted sibling layer.
  const previous=new Map((layer.paths??[]).map(path=>[path.id,path]));
  const changed:VectorPath[]=[];
  const paths=pending.paths.map(path=>{if(previous.get(path.id)===path)return path;const next=structuredClone(path);changed.push(next);return next;});
  layers[index]={...layer,paths};
  return {...scene,owners:scene.owners.map(o=>o===owner?expandPaintOwnerToContent({...o,paint:{...o.paint,layers}},[{...layer,image:undefined,strokes:[],paths:changed}]):o)};
}

/** Append to the latest scene, never to the scene captured by pointerdown/render. */
export function commitPaintStroke(scene: PaintScene, pending: PendingPaintStroke): PaintScene {
  const owner=scene.owners.find(o=>o.key===pending.ownerKey);
  if(!owner||paintOwnerLocked(owner))return scene;
  const layers=[...owner.paint.layers];
  let index=layers.findIndex(layer=>layer.id===pending.layerId);
  if(index<0){
    if(!pending.addedLayer||pending.target||['eraser','clear'].includes(pending.stroke.tool)||layers.length>=64)return scene;
    index=layers.length;layers.push(pending.addedLayer);
  }
  const layer=layers[index];
  if(layer.locked||!layer.visible)return scene;
  const transformed=strokeInOwner(pending,owner),stroke=transformed===pending.stroke?structuredClone(transformed):transformed;
  if(pending.target==='generationMask'){
    if(!layer.generationMask?.enabled)return scene;
    layers[index]={...layer,generationMask:{...layer.generationMask,strokes:[...layer.generationMask.strokes,stroke]}};
  }else if(pending.target==='mask'){
    if(!layer.mask?.enabled)return scene;
    layers[index]={...layer,mask:{...layer.mask,strokes:[...layer.mask.strokes,stroke]}};
  }else layers[index]={...layer,strokes:[...layer.strokes,stroke]};
  // Existing content is already inside the backing canvas; inspect only this mark.
  return {...scene,owners:scene.owners.map(o=>o===owner?expandPaintOwnerToBounds({...owner,paint:{...owner.paint,layers}},strokeBoundsInOwner(pending,owner)):o)};
}

export interface PaintSampleEvent {
  type: string;
  pointerType: string;
  pressure: number;
  shiftKey?: boolean;
  clientX: number;
  clientY: number;
  timeStamp: number;
  getCoalescedEvents?: () => PaintSampleEvent[];
}

/** Preserve the release position even when the device supplies no final move. */
export function appendPaintSamples(stroke: PaintStroke, smoother: PaintSmoother, event: PaintSampleEvent, point: (sample: PaintSampleEvent)=>PaintPoint): void {
  const samples=event.getCoalescedEvents?.()??[];
  const last=samples.at(-1);
  if(!last||last.clientX!==event.clientX||last.clientY!==event.clientY||last.timeStamp!==event.timeStamp||event.type==='pointerup')samples.push(event);
  for(const sample of samples){
    const raw=point(sample);
    if(sample.type==='pointerup'&&sample.pointerType==='pen'&&sample.pressure===0)raw.pressure=stroke.points.at(-1)?.pressure??raw.pressure;
    const p=smoother.push(raw);
    if(stroke.tool==='pen'||stroke.tool==='eraser')stroke.points.push(p);
    else stroke.points=[stroke.points[0],constrainPaintPoint(stroke.tool,stroke.points[0],p,event.shiftKey??false)];
  }
}

export function constrainPaintPoint(tool:PaintStroke['tool'],start:PaintPoint,end:PaintPoint,shift:boolean):PaintPoint {
  if(!shift)return end;
  const dx=end.x-start.x,dy=end.y-start.y;
  if(tool==='line')return Math.abs(dx)>=Math.abs(dy)?{...end,y:start.y}:{...end,x:start.x};
  if(tool==='rectangle'||tool==='ellipse'){
    const size=Math.max(Math.abs(dx),Math.abs(dy));
    return {...end,x:start.x+(dx<0?-size:size),y:start.y+(dy<0?-size:size)};
  }
  return end;
}
