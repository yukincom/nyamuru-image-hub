import type { PaintLayer, PaintPoint, PaintStroke } from '../types.ts';
import type { PaintScene } from './paintDocument.ts';
import type { PaintSmoother } from './paintStroke.ts';

export interface PendingPaintStroke {
  ownerKey: string;
  layerId: string;
  stroke: PaintStroke;
  target?: 'mask'|'generationMask';
  /** Insert with the first stroke, so a quick mark on cropped art is one undo step. */
  addedLayer?: PaintLayer;
}

/** Append to the latest scene, never to the scene captured by pointerdown/render. */
export function commitPaintStroke(scene: PaintScene, pending: PendingPaintStroke): PaintScene {
  const owner=scene.owners.find(o=>o.key===pending.ownerKey);
  if(!owner)return scene;
  const layers=[...owner.paint.layers];
  let index=layers.findIndex(layer=>layer.id===pending.layerId);
  if(index<0){
    if(!pending.addedLayer||layers.length>=64)return scene;
    index=layers.length;layers.push(pending.addedLayer);
  }
  const layer=layers[index];
  if(layer.locked||!layer.visible)return scene;
  if(pending.target==='generationMask'){
    if(!layer.generationMask?.enabled)return scene;
    layers[index]={...layer,generationMask:{...layer.generationMask,strokes:[...layer.generationMask.strokes,structuredClone(pending.stroke)]}};
  }else if(pending.target==='mask'){
    if(!layer.mask?.enabled)return scene;
    layers[index]={...layer,mask:{...layer.mask,strokes:[...layer.mask.strokes,structuredClone(pending.stroke)]}};
  }else layers[index]={...layer,strokes:[...layer.strokes,structuredClone(pending.stroke)]};
  return {...scene,owners:scene.owners.map(o=>o===owner?{...owner,paint:{...owner.paint,layers}}:o)};
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
