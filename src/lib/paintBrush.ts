import type { PaintPoint, PaintStroke } from '../types.ts';
import { pressureRadius } from './paintStroke.ts';

type Point = {x:number;y:number};

/** Local randomness: rendering, translation and JSON round trips never change a brush mark. */
function randomFor(seed:number,index:number) {
  let state=(seed+Math.imul(index+1,0x9e3779b9))>>>0;
  return ()=>{
    state=(state+0x6d2b79f5)>>>0;
    let n=Math.imul(state^(state>>>15),1|state);
    n^=n+Math.imul(n^(n>>>7),61|n);
    return ((n^(n>>>14))>>>0)/4294967296;
  };
}

/** A stamp is a loose bundle of tapered vertical scratches, all inside the existing brush bounds. */
function hatchStamp(point:PaintPoint,size:number,seed:number,index:number,visit:(outline:Point[])=>void) {
  const random=randomFor(seed,index),diameter=pressureRadius(size,point.pressure)*2;
  const lean=(random()-.5)*.13;
  for(let line=0;line<11;line++){
    const x=(line-5)*.075+(random()-.5)*.022;
    const top=-.47+random()*.075,bottom=.47-random()*.09;
    const tilt=lean+(random()-.5)*.055,width=.018+random()*.006;
    const left:Point[]=[],right:Point[]=[];
    for(let step=0;step<=18;step++){
      const t=step/18,y=top+(bottom-top)*t;
      const cx=x+y*tilt+(random()-.5)*.007;
      const taper=step===0||step===18?.12:Math.min(1,Math.sin(Math.PI*t)*3.5);
      // Keep an opaque core; roughness belongs to the edge, including in binary ink.
      const half=width*taper*(.8+random()*.45)/2;
      left.push({x:point.x+(cx-half)*diameter,y:point.y+y*diameter});
      right.push({x:point.x+(cx+half)*diameter,y:point.y+y*diameter});
    }
    visit([...left,...right.reverse()]);
  }
}

/** Distance spacing avoids dark event-rate-dependent blobs and keeps the live prefix stable. */
export function forEachRoughHatch(stroke:PaintStroke,visit:(outline:Point[])=>void):void {
  const first=stroke.points[0];if(!first||!stroke.brush)return;
  let index=0;
  const stamp=(point:PaintPoint)=>hatchStamp(point,stroke.size,stroke.brush!.seed,index++,visit);
  const spacing=(pressure:number)=>Math.max(.5,pressureRadius(stroke.size,pressure)*2*.84);
  stamp(first);
  let remaining=spacing(first.pressure);
  for(let i=1;i<stroke.points.length;i++){
    const a=stroke.points[i-1],b=stroke.points[i],distance=Math.hypot(b.x-a.x,b.y-a.y);
    if(!distance)continue;
    let consumed=0;
    while(distance-consumed>=remaining){
      consumed+=remaining;
      const t=consumed/distance,point={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,pressure:a.pressure+(b.pressure-a.pressure)*t,time:0};
      stamp(point);remaining=spacing(point.pressure);
    }
    remaining-=distance-consumed;
  }
}

export function drawRoughHatching(ctx:CanvasRenderingContext2D,stroke:PaintStroke):void {
  ctx.beginPath();
  forEachRoughHatch(stroke,outline=>{
    ctx.moveTo(outline[0].x,outline[0].y);
    for(let i=1;i<outline.length;i++)ctx.lineTo(outline[i].x,outline[i].y);
    ctx.closePath();
  });
  ctx.fill();
}
