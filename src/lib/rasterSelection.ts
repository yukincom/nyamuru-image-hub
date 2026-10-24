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
export function combineSelection(old:BBox[]|null,next:BBox[],mode:SelectionMode,width:number,height:number):BBox[]{
  if(mode==='replace')return next;
  const a=boxesMask(old??[],width,height),b=boxesMask(next,width,height);
  for(let i=0;i<a.length;i++)a[i]=mode==='add'?(a[i]|b[i]):a[i]&&!b[i]?1:0;
  return maskBoxes(a,width,height);
}
export function lassoSelection(points:VectorPoint[],width:number,height:number):BBox[]{
  if(points.length<3)return [];
  const rows:BBox[]=[];
  let minY=height,maxY=0;for(const p of points){minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
  const top=Math.max(0,Math.floor(minY)),bottom=Math.min(height,Math.ceil(maxY));
  for(let y=top;y<bottom;y++){const line=y+.5,xs:number[]=[];
    for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[j],b=points[i];if((a.y>line)!==(b.y>line))xs.push(a.x+(line-a.y)*(b.x-a.x)/(b.y-a.y));}
    xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2){const x=Math.max(0,Math.ceil(xs[i]-.5)),right=Math.min(width,Math.ceil(xs[i+1]-.5));if(right>x)rows.push({x,y,w:right-x,h:1});}
  }return maskBoxes(boxesMask(rows,width,height),width,height);
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
