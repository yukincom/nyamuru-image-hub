import type { VectorPath } from '../types.ts';
import { paperPath } from './vectorGeometry.ts';

function trace(ctx:CanvasRenderingContext2D,path:VectorPath){
  const n=path.nodes;if(!n.length)return;ctx.moveTo(n[0].x,n[0].y);
  const edge=(i:number,j:number)=>{const a=n[i],b=n[j];ctx.bezierCurveTo(a.x+(a.handleOut?.x??0),a.y+(a.handleOut?.y??0),b.x+(b.handleIn?.x??0),b.y+(b.handleIn?.y??0),b.x,b.y);};
  for(let i=1;i<n.length;i++)edge(i-1,i);
  if(path.closed){edge(n.length-1,0);ctx.closePath();}
}
function hashString32(str:string){
  let h=2166136261;
  for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}
  return h>>>0;
}
function hashIntNoise(i:number,seed:number){
  let h=(Math.imul(i|0,374761393)^(seed>>>0))>>>0;
  h=Math.imul(h^(h>>>13),1274126177)>>>0;
  return ((h^(h>>>16))>>>0)/4294967295*2-1;
}
function smoothNoise1D(x:number,seed:number,period=0){
  const i0=Math.floor(x),f=x-i0,u=f*f*(3-2*f);
  let a=i0,b=i0+1;
  if(period>0){a=((a%period)+period)%period;b=((b%period)+period)%period;}
  return hashIntNoise(a,seed)*(1-u)+hashIntNoise(b,seed)*u;
}

function drawVariableWidthPath(ctx:CanvasRenderingContext2D,path:VectorPath,minRadius=0){
  const nodes=path.nodes,s=path.style,n=nodes.length;
  if(!n||!s.stroke)return;
  const minR=Math.max(.1,minRadius);
  const wobbleAmt=s.wobble&&s.wobble.amount>0?Math.max(0,Math.min(1,s.wobble.amount)):0;
  const wobbleScale=wobbleAmt>0?Math.max(2,s.wobble!.scale):14;
  const wobbleSeed=wobbleAmt>0?(s.wobble!.seed??hashString32(path.id)):0;
  ctx.fillStyle=s.stroke;
  if(n===1){
    const r=Math.max(minR,s.width*(nodes[0].width??1)/2);
    ctx.beginPath();ctx.arc(nodes[0].x,nodes[0].y,r,0,Math.PI*2);ctx.fill();return;
  }
  const count=path.closed?n:n-1;
  let totalApprox=0;
  if(wobbleAmt>0&&path.closed){
    for(let i=0;i<count;i++){
      const a=nodes[i],b=nodes[(i+1)%n];
      totalApprox+=Math.hypot(b.x-a.x,b.y-a.y);
    }
  }
  const periodPos=wobbleAmt>0&&path.closed?Math.max(4,Math.round(totalApprox/wobbleScale)):0;
  const periodFine=periodPos*2;
  const sampleWobble=(dist:number,baseR:number)=>{
    const u=dist/wobbleScale;
    const nPos=.7*smoothNoise1D(u,wobbleSeed,periodPos)+.3*smoothNoise1D(u*2,wobbleSeed^0x9e3779b9,periodFine);
    const nRad=smoothNoise1D(u*1.5,wobbleSeed^0x85ebca6b,periodPos?Math.max(4,Math.round(periodPos*1.5)):0);
    return {
      posOff:nPos*wobbleAmt*Math.max(.6,baseR*.85),
      rMult:Math.max(.35,1+nRad*wobbleAmt*.38),
    };
  };

  ctx.beginPath();
  let cumDist=0;
  for(let i=0;i<count;i++){
    const a=nodes[i],b=nodes[(i+1)%n];
    const p0x=a.x,p0y=a.y,p1x=a.x+(a.handleOut?.x??0),p1y=a.y+(a.handleOut?.y??0);
    const p2x=b.x+(b.handleIn?.x??0),p2y=b.y+(b.handleIn?.y??0),p3x=b.x,p3y=b.y;
    const r0=Math.max(minR,s.width*(a.width??1)/2),r1=Math.max(minR,s.width*(b.width??1)/2);
    const approxLen=Math.hypot(p1x-p0x,p1y-p0y)+Math.hypot(p2x-p1x,p2y-p1y)+Math.hypot(p3x-p2x,p3y-p2y);
    const maxStep=wobbleAmt>0?Math.max(1.2,Math.min(2.5,wobbleScale*.22)):Math.max(1.5,Math.min(r0,r1)*.8);
    const steps=Math.min(wobbleAmt>0?128:64,Math.max(1,Math.ceil(approxLen/maxStep)));
    let prevBx=p0x,prevBy=p0y;
    let prevX=p0x,prevY=p0y,prevR=r0;
    if(wobbleAmt>0){
      const tx0=Math.abs(p1x-p0x)+Math.abs(p1y-p0y)>1e-4?(p1x-p0x):(p3x-p0x);
      const ty0=Math.abs(p1x-p0x)+Math.abs(p1y-p0y)>1e-4?(p1y-p0y):(p3y-p0y);
      const tl0=Math.hypot(tx0,ty0);
      const w0=sampleWobble(cumDist,r0);
      if(tl0>1e-4){prevX=p0x+(-ty0/tl0)*w0.posOff;prevY=p0y+(tx0/tl0)*w0.posOff;}
      prevR=Math.max(minR,r0*w0.rMult);
    }
    if(i===0&&!path.closed&&s.cap==='round'){ctx.moveTo(prevX+prevR,prevY);ctx.arc(prevX,prevY,prevR,0,Math.PI*2);}
    for(let step=1;step<=steps;step++){
      const t=step/steps,mt=1-t;
      const bx=mt*mt*mt*p0x+3*mt*mt*t*p1x+3*mt*t*t*p2x+t*t*t*p3x;
      const by=mt*mt*mt*p0y+3*mt*mt*t*p1y+3*mt*t*t*p2y+t*t*t*p3y;
      const baseR=r0+(r1-r0)*t;
      const bdx=bx-prevBx,bdy=by-prevBy,blen=Math.hypot(bdx,bdy);
      cumDist+=blen;
      let x=bx,y=by,r=baseR;
      if(wobbleAmt>0&&blen>1e-4){
        const w=sampleWobble(cumDist,baseR);
        const nx=-bdy/blen,ny=bdx/blen;
        x=bx+nx*w.posOff;y=by+ny*w.posOff;
        r=Math.max(minR,baseR*w.rMult);
      }
      const dx=x-prevX,dy=y-prevY,len=Math.hypot(dx,dy);
      if(len>1e-4){
        const nx=-dy/len,ny=dx/len;
        ctx.moveTo(prevX-nx*prevR,prevY-ny*prevR);
        ctx.lineTo(x-nx*r,y-ny*r);
        ctx.lineTo(x+nx*r,y+ny*r);
        ctx.lineTo(prevX+nx*prevR,prevY+ny*prevR);
        ctx.closePath();
      }
      const isCornerJoin=step===steps&&b.corner&&(path.closed||i+1<count);
      if(isCornerJoin&&len>1e-4){
        const cNode=nodes[(i+2)%n];
        const hoLen=b.handleOut?Math.hypot(b.handleOut.x,b.handleOut.y):0;
        const otx=hoLen>1e-3?b.handleOut!.x:cNode.x-b.x;
        const oty=hoLen>1e-3?b.handleOut!.y:cNode.y-b.y;
        const otLen=Math.hypot(otx,oty);
        if(otLen>1e-4){
          const ix=dx/len,iy=dy/len,ox=otx/otLen,oy=oty/otLen;
          const cross=ix*oy-iy*ox;
          if(Math.abs(cross)>1e-3){
            const side=cross>0?-1:1;
            const ax=x+side*r*(-iy),ay=y+side*r*ix;
            const bxEdge=x+side*r*(-oy),byEdge=y+side*r*ox;
            const tMiter=((bxEdge-ax)*oy-(byEdge-ay)*ox)/cross;
            if(tMiter>0){
              let mx=ax+ix*tMiter,my=ay+iy*tMiter;
              const md=Math.hypot(mx-x,my-y),maxMiter=Math.min(s.miterLimit,3.0)*r;
              if(md>maxMiter&&md>1e-4){const sc=maxMiter/md;mx=x+(mx-x)*sc;my=y+(my-y)*sc;}
              ctx.moveTo(x,y);
              if(side<0){ctx.lineTo(ax,ay);ctx.lineTo(mx,my);ctx.lineTo(bxEdge,byEdge);}
              else{ctx.lineTo(bxEdge,byEdge);ctx.lineTo(mx,my);ctx.lineTo(ax,ay);}
              ctx.closePath();
            }
          }else{ctx.moveTo(x+r,y);ctx.arc(x,y,r,0,Math.PI*2);}
        }
      }else if(s.join==='round'||(step===steps&&s.cap==='round'&&!(b.corner&&(path.closed||i+1<count)))){
        ctx.moveTo(x+r,y);ctx.arc(x,y,r,0,Math.PI*2);
      }
      prevBx=bx;prevBy=by;prevX=x;prevY=y;prevR=r;
    }
  }
  ctx.fill();
}
export function drawVectorPath(ctx:CanvasRenderingContext2D,path:VectorPath,minRadius=0){
  const {style:s}=path;if(!path.nodes.length)return;
  const strokeWidth=minRadius>0?Math.max(s.width,minRadius*2):s.width;
  ctx.save();ctx.strokeStyle=s.stroke??'transparent';ctx.fillStyle=s.fill??s.stroke??'transparent';ctx.lineWidth=strokeWidth;ctx.lineCap=s.cap;ctx.lineJoin=s.join;ctx.miterLimit=s.miterLimit;ctx.setLineDash(s.dash);ctx.lineDashOffset=s.dashOffset;
  if(s.fill){ctx.beginPath();trace(ctx,path);ctx.fill();}
  if(s.stroke===null){ctx.restore();return;}
  if(path.closed&&s.alignment!=='center'){
    ctx.beginPath();if(s.alignment==='outside')ctx.rect(-1e9,-1e9,2e9,2e9);trace(ctx,path);ctx.clip(s.alignment==='outside'?'evenodd':'nonzero');ctx.lineWidth=strokeWidth*2;
  }
  if((s.profile==='variable'||(s.profile==='uniform'&&(s.wobble?.amount??0)>0))&&!s.dash.length){drawVariableWidthPath(ctx,path,minRadius);}
  else if(s.profile==='uniform'||path.closed){ctx.beginPath();trace(ctx,path);if(path.nodes.length===1){const n=path.nodes[0];ctx.arc(n.x,n.y,strokeWidth/2,0,Math.PI*2);ctx.fillStyle=s.stroke;ctx.fill();}else ctx.stroke();}
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
