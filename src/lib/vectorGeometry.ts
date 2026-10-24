import paper from 'paper';
import type { BBox, PaintStroke, VectorNode, VectorPath, VectorPoint, VectorStyle } from '../types.ts';

const scope=new paper.PaperScope();
scope.setup(new scope.Size(1,1));
export const defaultVectorStyle=():VectorStyle=>({stroke:'#000000',fill:null,width:8,cap:'round',join:'round',miterLimit:10,dash:[],dashOffset:0,alignment:'center',arrowStart:'none',arrowEnd:'none',profile:'uniform'});
export const vectorNode=(p:VectorPoint):VectorNode=>({x:p.x,y:p.y});
export function paperPath(path:VectorPath):paper.Path {
  return new scope.Path({insert:false,closed:path.closed,segments:path.nodes.map(n=>new scope.Segment(new scope.Point(n.x,n.y),new scope.Point(n.handleIn?.x??0,n.handleIn?.y??0),new scope.Point(n.handleOut?.x??0,n.handleOut?.y??0)))});
}
function fromPaper(path:paper.Path,source:VectorPath,id=source.id):VectorPath {
  return {...source,id,closed:path.closed,nodes:path.segments.map(s=>({x:s.point.x,y:s.point.y,...(s.handleIn.isZero()?{}:{handleIn:{x:s.handleIn.x,y:s.handleIn.y}}),...(s.handleOut.isZero()?{}:{handleOut:{x:s.handleOut.x,y:s.handleOut.y}})}))};
}
export function vectorShape(tool:'line'|'rectangle'|'ellipse',a:VectorPoint,b:VectorPoint,style:VectorStyle):VectorPath {
  const base={id:crypto.randomUUID(),closed:tool!=='line',nodes:[],style:structuredClone(style)} as VectorPath;
  const path=tool==='line'?new scope.Path.Line({from:[a.x,a.y],to:[b.x,b.y],insert:false}):tool==='rectangle'?new scope.Path.Rectangle({from:[Math.min(a.x,b.x),Math.min(a.y,b.y)],to:[Math.max(a.x,b.x),Math.max(a.y,b.y)],insert:false}):new scope.Path.Ellipse({rectangle:new scope.Rectangle(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(.01,Math.abs(b.x-a.x)),Math.max(.01,Math.abs(b.y-a.y))),insert:false});
  const result=fromPaper(path,base);path.remove();return result;
}
export function vectorFromStroke(stroke:PaintStroke,style:VectorStyle):VectorPath {
  const source:VectorPath={id:crypto.randomUUID(),closed:false,nodes:stroke.points.map(vectorNode),style:{...structuredClone(style),stroke:stroke.color,width:stroke.size}};
  if(source.nodes.length>2){const path=paperPath(source);path.simplify(.7);const result=fromPaper(path,source);path.remove();return result;}
  return source;
}
export function vectorBounds(path:VectorPath):BBox {const p=paperPath(path),b=p.bounds;const box={x:b.x,y:b.y,w:b.width,h:b.height};p.remove();return box;}
export function transformVector(path:VectorPath,dx:number,dy:number,sx=1,sy=sx):VectorPath {
  return {...path,nodes:path.nodes.map(n=>({...n,x:dx+n.x*sx,y:dy+n.y*sy,...(n.handleIn?{handleIn:{x:n.handleIn.x*sx,y:n.handleIn.y*sy}}:{}),...(n.handleOut?{handleOut:{x:n.handleOut.x*sx,y:n.handleOut.y*sy}}:{})})),style:{...path.style,width:path.style.width*Math.sqrt(Math.abs(sx*sy)),dash:path.style.dash.map(n=>n*Math.sqrt(Math.abs(sx*sy))),dashOffset:path.style.dashOffset*Math.sqrt(Math.abs(sx*sy))}};
}
export function vectorPathData(path:VectorPath):string {
  if(!path.nodes.length)return '';
  const n=path.nodes,command=(a:VectorNode,b:VectorNode)=>`C ${a.x+(a.handleOut?.x??0)} ${a.y+(a.handleOut?.y??0)} ${b.x+(b.handleIn?.x??0)} ${b.y+(b.handleIn?.y??0)} ${b.x} ${b.y}`;
  return `M ${n[0].x} ${n[0].y} `+n.slice(1).map((b,i)=>command(n[i],b)).join(' ')+(path.closed?` ${command(n[n.length-1],n[0])} Z`:'');
}
export function nearestVector(path:VectorPath,point:VectorPoint){const p=paperPath(path),loc=p.getNearestLocation(new scope.Point(point.x,point.y));const result=loc?{offset:loc.offset,distance:loc.point.getDistance(new scope.Point(point.x,point.y)),curve:loc.index,time:loc.time}:null;p.remove();return result;}
export function hitVector(paths:VectorPath[],point:VectorPoint,tolerance:number):string|undefined {
  for(const path of [...paths].reverse()){const p=paperPath(path),q=new scope.Point(point.x,point.y),loc=p.getNearestLocation(q);const hit=(path.nodes.length===1&&Math.hypot(path.nodes[0].x-point.x,path.nodes[0].y-point.y)<=tolerance+(path.style.stroke?path.style.width/2:0))||(loc&&loc.point.getDistance(q)<=tolerance+(path.style.stroke?path.style.width/2:0))||(path.style.fill&&p.contains(q));p.remove();if(hit)return path.id;}
}
export function insertVectorAnchor(path:VectorPath,point:VectorPoint):VectorPath {
  const p=paperPath(path),loc=p.getNearestLocation(new scope.Point(point.x,point.y));if(loc)p.divideAt(loc);const result=fromPaper(p,path);p.remove();return result;
}
export function moveVectorNode(path:VectorPath,index:number,point:VectorPoint,handle?:'handleIn'|'handleOut',independent=false):VectorPath {
  return {...path,nodes:path.nodes.map((n,i)=>{if(i!==index)return n;if(!handle)return {...n,x:point.x,y:point.y};const vector={x:point.x-n.x,y:point.y-n.y};return {...n,[handle]:vector,...(!independent?{[handle==='handleIn'?'handleOut':'handleIn']:{x:-vector.x||0,y:-vector.y||0}}:{})};})};
}
export function cornerVectorNode(path:VectorPath,index:number):VectorPath {return {...path,nodes:path.nodes.map((n,i)=>i===index?{x:n.x,y:n.y}:n)};}
/** Convert only the chosen anchor, or the selected path when no point is chosen. */
export function convertVectorNodes(path:VectorPath,smooth:boolean,index?:number):VectorPath {
  let nodes:VectorNode[];
  if(smooth&&path.nodes.length>1){const curve=paperPath(path);curve.smooth({type:'continuous'});nodes=fromPaper(curve,path).nodes;curve.remove();}
  else nodes=path.nodes.map(n=>({x:n.x,y:n.y}));
  return {...path,nodes:path.nodes.map((n,i)=>index===undefined||i===index?nodes[i]:n)};
}
export function reverseVector(path:VectorPath):VectorPath {return {...path,nodes:[...path.nodes].reverse().map(n=>({...n,handleIn:n.handleOut,handleOut:n.handleIn}))};}
export type VectorAlign='left'|'hcenter'|'right'|'top'|'vcenter'|'bottom';
export type VectorReference='selection'|'key'|'canvas';
const union=(boxes:BBox[]):BBox=>{const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};};
export function alignVectors(paths:VectorPath[],ids:string[],mode:VectorAlign,reference:VectorReference,canvas:BBox,keyId?:string):VectorPath[]{
  const selected=paths.filter(p=>ids.includes(p.id));if(!selected.length)return paths;
  const target=reference==='canvas'?canvas:reference==='key'?vectorBounds(selected.find(p=>p.id===keyId)??selected[0]):union(selected.map(vectorBounds));
  return paths.map(path=>{if(!ids.includes(path.id)||(reference==='key'&&path.id===(keyId??selected[0].id)))return path;const b=vectorBounds(path);let dx=0,dy=0;
    if(mode==='left')dx=target.x-b.x;if(mode==='hcenter')dx=target.x+target.w/2-b.x-b.w/2;if(mode==='right')dx=target.x+target.w-b.x-b.w;
    if(mode==='top')dy=target.y-b.y;if(mode==='vcenter')dy=target.y+target.h/2-b.y-b.h/2;if(mode==='bottom')dy=target.y+target.h-b.y-b.h;
    return transformVector(path,dx,dy);
  });
}
/** Distribute bounds/centres, or equal edge-to-edge gaps. A key object stays fixed. */
export function distributeVectors(paths:VectorPath[],ids:string[],axis:'x'|'y',mode:'start'|'center'|'end'|'gap',reference:VectorReference,canvas:BBox,keyId?:string,gap?:number):VectorPath[]{
  const size=axis==='x'?'w':'h',items=paths.filter(p=>ids.includes(p.id)).map(p=>({p,b:vectorBounds(p)})).sort((a,b)=>a.b[axis]-b.b[axis]);
  if(items.length<2)return paths;
  const anchor=items.find(i=>i.p.id===keyId)??items[0],index=items.indexOf(anchor),range=reference==='canvas'?canvas:union(items.map(i=>i.b));
  const positions=new Map<string,number>();
  if(mode==='gap'){
    const spacing=gap??(range[size]-items.reduce((s,i)=>s+i.b[size],0))/(items.length-1);
    let pos=reference==='canvas'?range[axis]:items[0].b[axis];
    for(const item of items){positions.set(item.p.id,pos);pos+=item.b[size]+spacing;}
  }else{
    const factor=mode==='start'?0:mode==='end'?1:.5;
    const start=reference==='canvas'?range[axis]+items[0].b[size]*factor:items[0].b[axis]+items[0].b[size]*factor;
    const last=items.at(-1)!;
    const end=reference==='canvas'?range[axis]+range[size]-last.b[size]*(1-factor):last.b[axis]+last.b[size]*factor;
    items.forEach((item,i)=>positions.set(item.p.id,start+(end-start)*i/(items.length-1)-item.b[size]*factor));
  }
  const correction=reference==='key'?items[index].b[axis]-positions.get(anchor.p.id)!:0;
  return paths.map(p=>{const pos=positions.get(p.id);if(pos===undefined)return p;const delta=pos+correction-vectorBounds(p)[axis];return transformVector(p,axis==='x'?delta:0,axis==='y'?delta:0);});
}
export type VectorEraseMode='touch'|'intersection'|'whole';
function extractRange(path:paper.Path,from:number,to:number,source:VectorPath):VectorPath|null {
  if(to-from<.01)return null;
  let part=path.clone({insert:false}) as paper.Path;
  if(part.closed)part.splitAt(0);
  if(to<part.length-1e-6){const tail=part.splitAt(to);tail?.remove();}
  if(from>1e-6){const tail=part.splitAt(from);part.remove();if(!tail)return null;part=tail;}
  const result=fromPaper(part,source,crypto.randomUUID());result.closed=false;part.remove();return result;
}
export function eraseVectors(paths:VectorPath[],samples:VectorPoint[],radius:number,mode:VectorEraseMode):VectorPath[]{
  if(!samples.length)return paths;
  const brushes:VectorPoint[]=[samples[0]];
  for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i],count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/Math.max(1,radius*.5)));for(let j=1;j<=count;j++)brushes.push({x:a.x+(b.x-a.x)*j/count,y:a.y+(b.y-a.y)*j/count});}
  const curves=paths.map(paperPath),out:VectorPath[]=[];
  try{paths.forEach((source,i)=>{
    if(source.style.stroke===null){out.push(source);return;}
    if(source.nodes.length===1){if(!brushes.some(p=>Math.hypot(p.x-source.nodes[0].x,p.y-source.nodes[0].y)<=radius+source.style.width/2))out.push(source);return;}
    const path=curves[i],length=path.length,offsets=brushes.flatMap(p=>{const loc=path.getNearestLocation(new scope.Point(p.x,p.y));return loc&&loc.point.getDistance(new scope.Point(p.x,p.y))<=radius+source.style.width/2?[loc.offset]:[];});
    if(!offsets.length){out.push(source);return;}if(mode==='whole')return;
    let intervals:Array<[number,number]>=[];
    if(mode==='intersection'){
      const cuts=[0,length,...path.getIntersections(path).map(l=>l.offset),...curves.flatMap((other,j)=>j===i||paths[j].style.stroke===null?[]:path.getIntersections(other).map(l=>l.offset))].sort((a,b)=>a-b).filter((x,k,a)=>!k||x-a[k-1]>.001);
      for(const offset of offsets){const right=cuts.findIndex(c=>c>offset+.001);intervals.push([cuts[Math.max(0,(right<0?cuts.length-1:right)-1)],right<0?length:cuts[right]]);}
      // An uncut seam of a closed curve belongs to one continuous segment.
      if(source.closed&&cuts.length>2){if(intervals.some(([a])=>a===0))intervals.push([cuts.at(-2)!,length]);if(intervals.some(([,b])=>b===length))intervals.push([0,cuts[1]]);}
    }else{
      // Bound the erased section along each curve by brush-circle intersections.
      for(const p of brushes){const circle=new scope.Path.Circle({center:[p.x,p.y],radius:radius+source.style.width/2,insert:false});const cuts=[0,length,...path.getIntersections(circle).map(l=>l.offset)].sort((a,b)=>a-b);for(let j=1;j<cuts.length;j++){const mid=path.getPointAt((cuts[j-1]+cuts[j])/2);if(mid&&mid.getDistance(new scope.Point(p.x,p.y))<=radius+source.style.width/2)intervals.push([cuts[j-1],cuts[j]]);}circle.remove();}
    }
    intervals.sort((a,b)=>a[0]-b[0]);let cursor=0;
    for(const [a,b] of intervals){if(a>cursor+.01){const kept=extractRange(path,cursor,a,source);if(kept)out.push(kept);}cursor=Math.max(cursor,b);}
    if(cursor<length-.01){const kept=extractRange(path,cursor,length,source);if(kept)out.push(kept);}
  });}finally{curves.forEach(p=>p.remove());}
  return out;
}
