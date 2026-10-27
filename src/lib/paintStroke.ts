// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Hakoniwa
// Adapted from Efude efude-stroke/src/builder.rs, ca3e3a414d603663723bed8c6ef8db6f89deab1f.
// Time sanitisation and weighted stabilisation only; see THIRD_PARTY_NOTICES.txt.
import type { BBox, PaintPoint, PaintStroke } from '../types.ts';

/** Raw sample bounds stay unclipped so incremental strokes retain earlier endpoints. */
export function paintStrokeBounds(stroke:PaintStroke,previous?:BBox,from=0):BBox|undefined {
  if(stroke.tool==='eraser'||stroke.tool==='clear')return;
  let left=previous?.x??Infinity,top=previous?.y??Infinity,right=previous?previous.x+previous.w:-Infinity,bottom=previous?previous.y+previous.h:-Infinity;
  const include=(x:number,y:number,w=0,h=0,margin=0)=>{left=Math.min(left,x-margin);top=Math.min(top,y-margin);right=Math.max(right,x+w+margin);bottom=Math.max(bottom,y+h+margin);};
  if(stroke.tool==='fill'){for(const box of stroke.selection??[])include(box.x,box.y,box.w,box.h);}
  else for(let i=from;i<stroke.points.length;i++){const p=stroke.points[i];include(p.x,p.y,0,0,stroke.size/2+2);}
  return left===Infinity?undefined:{x:left,y:top,w:right-left,h:bottom-top};
}

/** Only selected ink needs backing pixels; keep the authored selection unchanged. */
export function paintStrokeContentBounds(stroke:PaintStroke,raw=paintStrokeBounds(stroke)):BBox|undefined {
  if(!raw||!stroke.selection||stroke.tool==='fill')return raw;
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const box of stroke.selection){
    const x=Math.max(raw.x,box.x),y=Math.max(raw.y,box.y),r=Math.min(raw.x+raw.w,box.x+box.w),b=Math.min(raw.y+raw.h,box.y+box.h);
    if(r>x&&b>y){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,r);bottom=Math.max(bottom,b);}
  }
  return left===Infinity?undefined:{x:left,y:top,w:right-left,h:bottom-top};
}

/** A bounded, time-based window; zero leaves the artist's irregular line intact. */
export class PaintSmoother {
  private samples: PaintPoint[] = [];
  private lastTime?: number;
  private clock = 0;
  private level: number;
  constructor(level: number) { this.level=level; }
  push(point: PaintPoint): PaintPoint {
    const gap = this.lastTime === undefined ? 0 : point.time - this.lastTime;
    this.clock += this.lastTime === undefined ? 0 : gap > 0 && gap <= 250 ? gap : gap > 250 && gap < 10000 ? 250 : 4;
    this.lastTime = point.time;
    const latest = { ...point, time: this.clock };
    this.samples.push(latest);
    if (this.samples.length > 96) this.samples.shift();
    const window = Math.max(0, Math.min(15, this.level)) * 8;
    if (!window) return latest;
    let x = 0, y = 0, pressure = 0, weight = 0;
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const sample = this.samples[i], age = latest.time - sample.time;
      if (age > window) break;
      const w = 1 - age / (window + 1);
      x += sample.x * w; y += sample.y * w; pressure += sample.pressure * w; weight += w;
    }
    return { x: x / weight, y: y / weight, pressure: pressure / weight, time: latest.time };
  }
}

export function pressureRadius(size: number, pressure: number): number {
  return size * (0.15 + 0.85 * Math.max(0, Math.min(1, pressure))) / 2;
}
