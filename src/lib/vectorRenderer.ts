import type { VectorPath } from '../types.ts';
import { paperPath } from './vectorGeometry.ts';

function trace(ctx:CanvasRenderingContext2D,path:VectorPath){
  const n=path.nodes;if(!n.length)return;ctx.moveTo(n[0].x,n[0].y);
  const edge=(i:number,j:number)=>{const a=n[i],b=n[j];ctx.bezierCurveTo(a.x+(a.handleOut?.x??0),a.y+(a.handleOut?.y??0),b.x+(b.handleIn?.x??0),b.y+(b.handleIn?.y??0),b.x,b.y);};
  for(let i=1;i<n.length;i++)edge(i-1,i);
  if(path.closed){edge(n.length-1,0);ctx.closePath();}
}
function drawVariableWidthPath(ctx:CanvasRenderingContext2D,path:VectorPath){
  const nodes=path.nodes,s=path.style,n=nodes.length;
  if(!n||!s.stroke)return;
  ctx.fillStyle=s.stroke;
  if(n===1){
    const r=Math.max(.1,s.width*(nodes[0].width??1)/2);
    ctx.beginPath();ctx.arc(nodes[0].x,nodes[0].y,r,0,Math.PI*2);ctx.fill();return;
  }
  const count=path.closed?n:n-1;
  ctx.beginPath();
  for(let i=0;i<count;i++){
    const a=nodes[i],b=nodes[(i+1)%n];
    const p0x=a.x,p0y=a.y,p1x=a.x+(a.handleOut?.x??0),p1y=a.y+(a.handleOut?.y??0);
    const p2x=b.x+(b.handleIn?.x??0),p2y=b.y+(b.handleIn?.y??0),p3x=b.x,p3y=b.y;
    const r0=Math.max(.1,s.width*(a.width??1)/2),r1=Math.max(.1,s.width*(b.width??1)/2);
    const approxLen=Math.hypot(p1x-p0x,p1y-p0y)+Math.hypot(p2x-p1x,p2y-p1y)+Math.hypot(p3x-p2x,p3y-p2y);
    const steps=Math.min(64,Math.max(1,Math.ceil(approxLen/Math.max(1.5,Math.min(r0,r1)*.8))));
    let prevX=p0x,prevY=p0y,prevR=r0;
    if(i===0&&!path.closed&&s.cap==='round'){ctx.moveTo(p0x+r0,p0y);ctx.arc(p0x,p0y,r0,0,Math.PI*2);}
    for(let step=1;step<=steps;step++){
      const t=step/steps,mt=1-t;
      const x=mt*mt*mt*p0x+3*mt*mt*t*p1x+3*mt*t*t*p2x+t*t*t*p3x;
      const y=mt*mt*mt*p0y+3*mt*mt*t*p1y+3*mt*t*t*p2y+t*t*t*p3y;
      const r=r0+(r1-r0)*t;
      const dx=x-prevX,dy=y-prevY,len=Math.hypot(dx,dy);
      if(len>1e-4){
        const nx=-dy/len,ny=dx/len;
        ctx.moveTo(prevX-nx*prevR,prevY-ny*prevR);
        ctx.lineTo(x-nx*r,y-ny*r);
        ctx.lineTo(x+nx*r,y+ny*r);
        ctx.lineTo(prevX+nx*prevR,prevY+ny*prevR);
        ctx.closePath();
      }
      if(s.join==='round'||step===steps&&s.cap==='round'){ctx.moveTo(x+r,y);ctx.arc(x,y,r,0,Math.PI*2);}
      prevX=x;prevY=y;prevR=r;
    }
  }
  ctx.fill();
}
export function drawVectorPath(ctx:CanvasRenderingContext2D,path:VectorPath){
  const {style:s}=path;if(!path.nodes.length)return;
  ctx.save();ctx.strokeStyle=s.stroke??'transparent';ctx.fillStyle=s.fill??s.stroke??'transparent';ctx.lineWidth=s.width;ctx.lineCap=s.cap;ctx.lineJoin=s.join;ctx.miterLimit=s.miterLimit;ctx.setLineDash(s.dash);ctx.lineDashOffset=s.dashOffset;
  if(s.fill){ctx.beginPath();trace(ctx,path);ctx.fill();}
  if(s.stroke===null){ctx.restore();return;}
  if(path.closed&&s.alignment!=='center'){
    ctx.beginPath();if(s.alignment==='outside')ctx.rect(-1e9,-1e9,2e9,2e9);trace(ctx,path);ctx.clip(s.alignment==='outside'?'evenodd':'nonzero');ctx.lineWidth=s.width*2;
  }
  if(s.profile==='variable'&&!s.dash.length){drawVariableWidthPath(ctx,path);}
  else if(s.profile==='uniform'||path.closed){ctx.beginPath();trace(ctx,path);if(path.nodes.length===1){const n=path.nodes[0];ctx.arc(n.x,n.y,s.width/2,0,Math.PI*2);ctx.fillStyle=s.stroke;ctx.fill();}else ctx.stroke();}
  else{
    const p=paperPath(path),length=p.length;
    for(const [from,to] of vectorDashRanges(length,s.dash,s.dashOffset)){
      const steps=Math.min(8192,Math.max(2,Math.ceil((to-from)/2))),left:number[][]=[],right:number[][]=[];
      for(let i=0;i<=steps;i++){
        const distance=from+(to-from)*i/steps,point=p.getPointAt(distance),normal=p.getNormalAt(distance);if(!point||!normal)continue;
        const t=length?distance/length:0,weight=s.profile==='taper'?1-t:Math.sin(Math.PI*t),width=s.width*weight/2;
        const extension=s.cap==='square'?(i===0?-width:i===steps?width:0):0,tangent=p.getTangentAt(distance);
        const x=point.x+(tangent?.x??0)*extension,y=point.y+(tangent?.y??0)*extension;
        left.push([x+normal.x*width,y+normal.y*width]);right.push([x-normal.x*width,y-normal.y*width]);
      }
      const outline=[...left,...right.reverse()];ctx.beginPath();outline.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=s.stroke;ctx.fill();
      if(s.cap==='round')for(const distance of [from,to]){const point=p.getPointAt(distance),t=length?distance/length:0,width=s.width*(s.profile==='taper'?1-t:Math.sin(Math.PI*t))/2;if(point&&width>0){ctx.beginPath();ctx.arc(point.x,point.y,width,0,Math.PI*2);ctx.fill();}}
    }
    p.remove();
  }
  ctx.restore();
  if(!path.closed&&(s.arrowStart!=='none'||s.arrowEnd!=='none')){
    const p=paperPath(path);
    for(const end of [false,true]){const type=end?s.arrowEnd:s.arrowStart;if(type==='none')continue;const point=p.getPointAt(end?p.length:0),tangent=p.getTangentAt(end?p.length:0);if(!point||!tangent)continue;const angle=Math.atan2(tangent.y,tangent.x)+(end?0:Math.PI),size=Math.max(5,s.width*3);
      ctx.save();ctx.translate(point.x,point.y);ctx.rotate(angle);ctx.fillStyle=s.stroke;ctx.strokeStyle=s.stroke;ctx.lineWidth=Math.max(1,s.width*.5);ctx.lineJoin='round';ctx.beginPath();
      if(type==='circle'){ctx.arc(-size/3,0,size/3,0,Math.PI*2);ctx.fill();}else{ctx.moveTo(-size,-size*.45);ctx.lineTo(0,0);ctx.lineTo(-size,size*.45);if(type==='triangle'){ctx.closePath();ctx.fill();}else ctx.stroke();}ctx.restore();
    }p.remove();
  }
}
/** Quantize edge coverage only; no blur or color conversion of image layers. */
export function applyInkAntialias(ctx:CanvasRenderingContext2D,width:number,height:number,level=3){
  if(level===3)return;
  const data=ctx.getImageData(0,0,width,height),steps=level===0?1:level===1?4:16;
  for(let i=3;i<data.data.length;i+=4)data.data[i]=Math.round(data.data[i]/255*steps)/steps*255;
  ctx.putImageData(data,0,0);
}

/** The same arc-length dash pattern for uniform and variable-width strokes. */
export function vectorDashRanges(length:number,dash:number[],offset=0):Array<[number,number]>{
  if(!dash.length)return [[0,length]];
  const pattern=dash.length%2?[...dash,...dash]:dash,total=pattern.reduce((a,b)=>a+b,0);
  let phase=((offset%total)+total)%total,index=0;
  while(phase>=pattern[index]){phase-=pattern[index];index=(index+1)%pattern.length;}
  const ranges:Array<[number,number]>=[];
  for(let start=-phase;start<length;index=(index+1)%pattern.length){const end=start+pattern[index];if(index%2===0&&end>0)ranges.push([Math.max(0,start),Math.min(length,end)]);start=end;}
  return ranges;
}
