import type { BBox, VectorPoint } from '../types.ts';
export type SelectionMode='replace'|'add'|'subtract';
export interface PixelSource {width:number;height:number;data:Uint8ClampedArray}
/** Row runs compressed vertically; coordinates stay in document pixels. */
export function maskBoxes(bits:Uint8Array,width:number,height:number):BBox[]{
  const out:BBox[]=[],previous=new Map<string,BBox>();
  for(let y=0;y<height;y++){
    const next=new Map<string,BBox>();
    for(let x=0;x<width;){if(!bits[y*width+x]){x++;continue;}const start=x;while(x<width&&bits[y*width+x])x++;
      const key=`${start}:${x}`,old=previous.get(key);if(old){old.h++;next.set(key,old);}else{const b={x:start,y,w:x-start,h:1};out.push(b);next.set(key,b);}}
    previous.clear();for(const [k,b] of next)previous.set(k,b);
  }return out;
}
export function boxesMask(boxes:BBox[],width:number,height:number):Uint8Array{
  const bits=new Uint8Array(width*height);
  for(const b of boxes){const x=Math.max(0,Math.ceil(b.x-.5)),right=Math.min(width,Math.ceil(b.x+b.w-.5));if(right<=x)continue;
    for(let y=Math.max(0,Math.ceil(b.y-.5));y<Math.min(height,Math.ceil(b.y+b.h-.5));y++)bits.fill(1,y*width+x,y*width+right);}
  return bits;
}
function appendRuns(out:BBox[],previous:Map<string,BBox>,runs:Array<[number,number]>,y:number,h:number):Map<string,BBox>{
  const next=new Map<string,BBox>();
  for(const [x,right] of runs){const key=`${x}:${right}`,old=previous.get(key);
    if(old&&old.y+old.h===y){old.h+=h;next.set(key,old);}else{const box={x,y,w:right-x,h};out.push(box);next.set(key,box);}}
  return next;
}
/** Boolean operations on pixel runs, independent of the backing canvas extent. */
export function combineSelection(old:BBox[]|null,next:BBox[],mode:SelectionMode):BBox[]{
  if(mode==='replace')return next;
  type Run={x:number;right:number;source:number};
  const events=new Map<number,Array<{run:Run;add:boolean}>>();
  for(const [source,boxes] of [old??[],next].entries())for(const box of boxes){
    const x=Math.ceil(box.x-.5),right=Math.ceil(box.x+box.w-.5),y=Math.ceil(box.y-.5),bottom=Math.ceil(box.y+box.h-.5);
    if(![x,right,y,bottom].every(Number.isSafeInteger))throw Error('選択座標は有限のpixel位置で指定してください');
    if(right<=x||bottom<=y)continue;const run={x,right,source};
    for(const [line,add] of [[y,true],[bottom,false]] as const){const list=events.get(line)??[];list.push({run,add});events.set(line,list);}
  }
  const lines=[...events.keys()].sort((a,b)=>a-b),active=new Set<Run>(),out:BBox[]=[];let previous=new Map<string,BBox>();
  for(let i=0;i<lines.length-1;i++){
    const y=lines[i];for(const {run,add} of events.get(y)!){if(add)active.add(run);else active.delete(run);}
    const edges=new Map<number,[number,number]>();
    for(const run of active)for(const [x,sign] of [[run.x,1],[run.right,-1]]){const counts=edges.get(x)??[0,0];counts[run.source]+=sign;edges.set(x,counts);}
    const xs=[...edges.keys()].sort((a,b)=>a-b),counts=[0,0],runs:Array<[number,number]>=[];
    for(let j=0;j<xs.length-1;j++){const x=xs[j],delta=edges.get(x)!;counts[0]+=delta[0];counts[1]+=delta[1];
      if(mode==='add'?counts[0]||counts[1]:counts[0]&&!counts[1]){const last=runs.at(-1);if(last?.[1]===x)last[1]=xs[j+1];else runs.push([x,xs[j+1]]);}}
    previous=appendRuns(out,previous,runs,y,lines[i+1]-y);
  }
  return out;
}
export function lassoSelection(points:VectorPoint[]):BBox[]{
  if(points.length<3)return [];
  const rows:BBox[]=[];let previous=new Map<string,BBox>();
  let minY=Infinity,maxY=-Infinity;for(const p of points){
    if(![p.x,p.y].every(n=>Number.isFinite(n)&&Math.abs(n)<Number.MAX_SAFE_INTEGER))throw Error('選択座標は有限のpixel位置で指定してください');
    minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
  const top=Math.floor(minY),bottom=Math.ceil(maxY);
  if(bottom-top>16384||(bottom-top)*points.length>16*1024*1024)throw Error('選択範囲が大きすぎます。範囲や輪郭を小さくしてください');
  for(let y=top;y<bottom;y++){const line=y+.5,xs:number[]=[];
    for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[j],b=points[i];if((a.y>line)!==(b.y>line))xs.push(a.x+(line-a.y)*(b.x-a.x)/(b.y-a.y));}
    const runs:Array<[number,number]>=[];xs.sort((a,b)=>a-b);
    for(let i=0;i+1<xs.length;i+=2){const x=Math.ceil(xs[i]-.5),right=Math.ceil(xs[i+1]-.5);if(right>x){const last=runs.at(-1);if(last?.[1]===x)last[1]=right;else runs.push([x,right]);}}
    previous=appendRuns(rows,previous,runs,y,1);
  }return rows;
}
/** Four-connected scanline flood fill. Transparent RGB is ignored. */
export function floodSelection(source:PixelSource,x:number,y:number,tolerance=24,limit?:BBox[]|null):BBox[]{
  const {width:w,height:h,data}=source;x=Math.floor(x);y=Math.floor(y);
  if(x<0||x>=w||y<0||y>=h)return [];
  const allowed=limit?boxesMask(limit,w,h):null,start=(y*w+x)*4,target=Array.from(data.slice(start,start+4));
  const seen=new Uint8Array(w*h),bits=new Uint8Array(w*h),stack=[y*w+x];
  const matches=(i:number)=>{if(seen[i]||allowed&&!allowed[i])return false;const a=data[i*4+3];if(Math.abs(a-target[3])>tolerance)return false;
    return target[3]===0||[0,1,2].every(c=>Math.abs(data[i*4+c]*a/255-target[c]*target[3]/255)<=tolerance);};
  while(stack.length){const seed=stack.pop()!;if(!matches(seed))continue;const row=Math.floor(seed/w);let left=seed%w,right=left;
    while(left>0&&matches(row*w+left-1))left--;while(right+1<w&&matches(row*w+right+1))right++;
    for(let col=left;col<=right;col++){const i=row*w+col;seen[i]=bits[i]=1;}
    for(const adjacent of [row-1,row+1])if(adjacent>=0&&adjacent<h){let run=false;for(let col=left;col<=right;col++){const i=adjacent*w+col,m=matches(i);if(m&&!run)stack.push(i);run=m;}}
  }return maskBoxes(bits,w,h);
}
export function alphaSelection(source:PixelSource):BBox[]{const b=new Uint8Array(source.width*source.height);for(let i=0;i<b.length;i++)b[i]=source.data[i*4+3]>0?1:0;return maskBoxes(b,source.width,source.height);}
export function selectionPath(boxes:BBox[]):string{
  // Cancel shared rectangle edges, leaving only the perimeter (no scanline stripes).
  const horizontal=new Map<number,Map<number,number>>(),vertical=new Map<number,Map<number,number>>();
  const edge=(map:Map<number,Map<number,number>>,line:number,a:number,b:number,sign:number)=>{let m=map.get(line);if(!m){m=new Map();map.set(line,m);}m.set(a,(m.get(a)??0)+sign);m.set(b,(m.get(b)??0)-sign);};
  for(const b of boxes){edge(horizontal,b.y,b.x,b.x+b.w,1);edge(horizontal,b.y+b.h,b.x,b.x+b.w,-1);edge(vertical,b.x,b.y,b.y+b.h,1);edge(vertical,b.x+b.w,b.y,b.y+b.h,-1);}
  const parts:string[]=[];for(const [map,h] of [[horizontal,true],[vertical,false]] as const)for(const [line,events] of map){const entries=[...events].sort((a,b)=>a[0]-b[0]);let count=0;for(let i=0;i<entries.length-1;i++){count+=entries[i][1];if(count)parts.push(h?`M${entries[i][0]},${line}H${entries[i+1][0]}`:`M${line},${entries[i][0]}V${entries[i+1][0]}`);}}
  return parts.join('');
}
