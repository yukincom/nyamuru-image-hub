import type { VectorPath, VectorPoint, VectorStyle } from '../types.ts';
import { cornerVectorNode, eraseVectors, hitVector, insertVectorAnchor, moveVectorNode, nearestVector, reverseVector, transformVector, vectorBounds, vectorNode, vectorShape, type VectorEraseMode } from './vectorGeometry.ts';

export type VectorPenTool='vector-pen'|'vector-add'|'vector-delete'|'vector-anchor';
export type VectorTool=VectorPenTool|'vector-select'|'vector-node'|'line'|'rectangle'|'ellipse'|'eraser';
export interface VectorInput extends VectorPoint {shift?:boolean;alt?:boolean;meta?:boolean}
export interface VectorNodeSelection {pathId:string;node:number}
export interface VectorState {paths:VectorPath[];selected:string[];activePath?:string;selectedNode?:VectorNodeSelection;selectedNodes?:VectorNodeSelection[]}
export interface VectorDrag {
  before:VectorState;state:VectorState;start:VectorInput;tool:VectorTool;
  kind:'shape'|'move'|'node'|'handle'|'new-anchor'|'erase'|'marquee'|'none';
  pathId?:string;node?:number;handle?:'handleIn'|'handleOut';samples:VectorPoint[];
  style:VectorStyle;tolerance:number;eraseMode:VectorEraseMode;radius:number;
}
export function vectorAnchorAt(paths:VectorPath[],ids:string[],point:VectorPoint,tolerance:number,handles=true){
  for(const path of [...paths].reverse())if(ids.includes(path.id)){
    if(handles)for(let i=0;i<path.nodes.length;i++){const n=path.nodes[i];for(const handle of ['handleOut','handleIn'] as const){const h=n[handle];if(h&&Math.hypot(n.x+h.x-point.x,n.y+h.y-point.y)<tolerance)return {pathId:path.id,node:i,handle};}}
    for(let i=0;i<path.nodes.length;i++)if(Math.hypot(path.nodes[i].x-point.x,path.nodes[i].y-point.y)<tolerance)return {pathId:path.id,node:i};
  }
}
/** Use the same endpoint hit test for the pen cursor and the following press. */
export function vectorPenEndpoint(state:VectorState,point:VectorInput,tolerance:number){
  if(point.alt||point.meta)return;
  const anchor=vectorAnchorAt(state.paths,state.paths.map(p=>p.id),point,tolerance,false);
  if(!anchor)return;
  const path=state.paths.find(p=>p.id===anchor.pathId)!;
  if(path.closed||(anchor.node!==0&&anchor.node!==path.nodes.length-1))return;
  const active=state.paths.find(p=>p.id===state.activePath&&!p.closed);
  if(!active)return {...anchor,action:'resume' as const};
  if(active.id!==path.id)return {...anchor,action:'join' as const};
  if(anchor.node===0&&path.nodes.length>1)return {...anchor,action:'close' as const};
}
function insertSelectedAnchor(before:VectorState,path:VectorPath,point:VectorPoint):VectorState {
  const next=insertVectorAnchor(path,point);
  const node=next.nodes.reduce((best,n,i)=>Math.hypot(n.x-point.x,n.y-point.y)<Math.hypot(next.nodes[best].x-point.x,next.nodes[best].y-point.y)?i:best,0);
  return {...before,paths:before.paths.map(p=>p.id===path.id?next:p),selected:[path.id],activePath:undefined,selectedNode:{pathId:path.id,node}};
}
export function beginVectorDrag(before:VectorState,tool:VectorTool,point:VectorInput,style:VectorStyle,tolerance:number,eraseMode:VectorEraseMode='intersection',radius=5):VectorDrag {
  // Command temporarily selects; clicking empty space ends the open path.
  if(tool==='vector-pen'&&point.meta)return beginVectorDrag(before,'vector-select',point,style,tolerance,eraseMode,radius);
  // Dedicated anchor tools have been selected explicitly, unlike Option + pen.
  if((tool==='vector-add'||tool==='vector-delete'||tool==='vector-anchor')&&before.activePath)before={...before,activePath:undefined};
  if(tool!=='vector-node'&&before.selectedNodes)before={...before,selectedNodes:undefined};
  const d:VectorDrag={before,state:before,start:point,tool,kind:'none',samples:[point],style,tolerance,eraseMode,radius};
  if(tool==='line'||tool==='rectangle'||tool==='ellipse'){d.kind='shape';d.pathId=crypto.randomUUID();return updateVectorDrag(d,point);}
  if(tool==='eraser'){d.kind='erase';return updateVectorDrag(d,point);}
  if(tool==='vector-add'||tool==='vector-delete'||tool==='vector-anchor'){
    const ids=before.paths.map(p=>p.id);
    const node=vectorAnchorAt(before.paths,ids,point,tolerance,false);
    const anchor=node??(tool==='vector-anchor'?vectorAnchorAt(before.paths,ids,point,tolerance):undefined);
    if(tool==='vector-add'){
      if(node)return d;
      // Filled interiors are not a segment: only add directly on an existing line.
      const path=[...before.paths].reverse().find(p=>{const hit=nearestVector(p,point);return hit&&hit.distance<=tolerance+p.style.width/2;});
      if(path)d.state=insertSelectedAnchor(before,path,point);
    }else if(anchor){
      const path=before.paths.find(p=>p.id===anchor.pathId)!;
      if(tool==='vector-delete'){
        const nodes=path.nodes.filter((_,i)=>i!==anchor.node);
        d.state={paths:before.paths.flatMap(p=>p.id!==path.id?[p]:nodes.length?[{...p,nodes}]:[]),selected:nodes.length?[path.id]:[],...(before.activePath&&!(before.activePath===path.id&&!nodes.length)?{activePath:before.activePath}:{})};
      }else{
        d.pathId=path.id;d.node=anchor.node;d.handle=anchor.handle;d.kind=anchor.handle?'handle':'new-anchor';
        d.state={...before,paths:before.paths.map(p=>p.id===path.id&&!anchor.handle?cornerVectorNode(p,anchor.node):p),selected:[path.id],selectedNode:{pathId:path.id,node:anchor.node}};
      }
    }
    return d;
  }
  const hit=hitVector(before.paths,point,tolerance);
  if(tool==='vector-select'){
    if(hit){const selected=point.shift?before.selected.includes(hit)?before.selected.filter(id=>id!==hit):[...before.selected,hit]:before.selected.includes(hit)?before.selected:[hit];d.state={...before,selected,activePath:undefined,selectedNode:undefined,selectedNodes:undefined};d.kind=selected.includes(hit)?'move':'none';}
    else {d.kind='marquee';d.state={...before,selected:point.shift?before.selected:[],activePath:undefined,selectedNode:undefined};}
    return d;
  }
  // A short handle can overlap its anchor. Pen presses target the anchor first;
  // only selected paths expose handles on the canvas.
  const anchor=tool==='vector-pen'
    ? vectorAnchorAt(before.paths,before.paths.map(p=>p.id),point,tolerance,false)??vectorAnchorAt(before.paths,before.selected,point,tolerance)
    : vectorAnchorAt(before.paths,before.selected,point,tolerance);
  if(tool==='vector-node'){
    const anchor=vectorAnchorAt(before.paths,before.paths.map(p=>p.id),point,tolerance,false)??vectorAnchorAt(before.paths,before.selected,point,tolerance);
    const existing=selectedVectorNodes(before);
    if(anchor){
      const chosen={pathId:anchor.pathId,node:anchor.node},has=existing.some(n=>n.pathId===chosen.pathId&&n.node===chosen.node);
      const nodes=anchor.handle?existing:point.shift?(has?existing.filter(n=>n.pathId!==chosen.pathId||n.node!==chosen.node):[...existing,chosen]):has?existing:[chosen];
      d.pathId=anchor.pathId;d.node=anchor.node;d.handle=anchor.handle;d.kind=anchor.handle?'handle':nodes.some(n=>n.pathId===chosen.pathId&&n.node===chosen.node)?'node':'none';
      d.state={...before,selected:[...new Set(nodes.map(n=>n.pathId))],selectedNodes:nodes,activePath:undefined,selectedNode:d.kind==='none'?undefined:chosen};
      if(point.alt&&!anchor.handle){d.state={...d.state,paths:before.paths.map(p=>p.id===anchor.pathId?cornerVectorNode(p,anchor.node):p)};d.kind='new-anchor';}
    }else if(hit){
      const selected=point.shift?(before.selected.includes(hit)?before.selected.filter(id=>id!==hit):[...before.selected,hit]):[hit];
      const nodes=point.shift?[...existing.filter(n=>n.pathId!==hit),...(selected.includes(hit)?before.paths.find(p=>p.id===hit)!.nodes.map((_,node)=>({pathId:hit,node})):[])]:before.paths.find(p=>p.id===hit)!.nodes.map((_,node)=>({pathId:hit,node}));
      d.state={...before,selected,selectedNodes:nodes,activePath:undefined,selectedNode:undefined};
    }else {d.kind='marquee';d.state={...before,selected:point.shift?before.selected:[],selectedNodes:point.shift?existing:[],activePath:undefined,selectedNode:undefined};}
    return d;
  }
  let active=before.paths.find(p=>p.id===before.activePath&&!p.closed);
  if(anchor){
    const path=before.paths.find(p=>p.id===anchor.pathId)!;
    d.pathId=path.id;d.node=anchor.node;d.handle=anchor.handle;d.kind=anchor.handle?'handle':'new-anchor';
    d.state={...before,selected:[path.id],selectedNode:{pathId:path.id,node:anchor.node},activePath:active?.id===path.id?path.id:undefined};
    if(anchor.handle)return d;
    if(point.alt){d.state={...d.state,paths:before.paths.map(p=>p.id===path.id?cornerVectorNode(p,anchor.node):p)};return d;}
    const endpoint=vectorPenEndpoint(before,point,tolerance);
    if(endpoint?.action==='join'&&active){
      const tail=anchor.node===0?path:reverseVector(path),last=active.nodes.at(-1)!,first=tail.nodes[0];
      const shared=Math.hypot(last.x-first.x,last.y-first.y)<1e-6;
      const nodes=shared?[...active.nodes.slice(0,-1),{...last,handleOut:first.handleOut},...tail.nodes.slice(1)]:[...active.nodes,...tail.nodes];
      const joined={...active,nodes};
      d.pathId=joined.id;d.node=active.nodes.length-(shared?1:0);
      d.state={paths:before.paths.flatMap(p=>p.id===active!.id?[joined]:p.id===path.id?[]:[p]),selected:[joined.id],activePath:joined.id,selectedNode:{pathId:joined.id,node:d.node}};
    }else if(endpoint?.action==='close'){
      // Keep this gesture draggable: pressing closes; dragging also pulls handles.
      d.state={...d.state,paths:before.paths.map(p=>p.id===path.id?{...p,closed:true}:p),activePath:undefined};
    }else if(!path.closed&&(anchor.node===0||anchor.node===path.nodes.length-1)){
      let resumed=anchor.node===0&&path.nodes.length>1?reverseVector(path):path;
      if(active?.id===path.id&&anchor.node===path.nodes.length-1){
        // Retract only the outgoing handle: the curve already drawn stays intact.
        resumed={...resumed,nodes:resumed.nodes.map((n,i)=>{if(i!==anchor.node)return n;const {handleOut,...corner}=n;return corner;})};
      }
      d.node=resumed.nodes.length-1;
      d.state={...d.state,paths:before.paths.map(p=>p.id===path.id?resumed:p),activePath:path.id,selectedNode:{pathId:path.id,node:d.node}};
    }
    // Existing interior anchors pull handles in place; never append a duplicate.
    return d;
  }
  // A temporary conversion on empty space must not create a new point or path.
  if(point.alt)return d;
  if(hit&&!active){const path=before.paths.find(p=>p.id===hit)!;d.state=insertSelectedAnchor(before,path,point);return d;}
  let next:VectorPath;
  if(active){let p=point;if(point.shift){const last=active.nodes.at(-1)!;const angle=Math.round(Math.atan2(point.y-last.y,point.x-last.x)/(Math.PI/4))*Math.PI/4,dist=Math.hypot(point.x-last.x,point.y-last.y);p={...point,x:last.x+Math.cos(angle)*dist,y:last.y+Math.sin(angle)*dist};}next={...active,nodes:[...active.nodes,vectorNode(p)]};}
  else next={id:crypto.randomUUID(),nodes:[vectorNode(point)],closed:false,style:structuredClone(style)};
  d.kind='new-anchor';d.pathId=next.id;d.node=next.nodes.length-1;d.state={paths:active?before.paths.map(p=>p.id===next.id?next:p):[...before.paths,next],selected:[next.id],activePath:next.id,selectedNode:{pathId:next.id,node:d.node}};return d;
}
export function updateVectorDrag(d:VectorDrag,point:VectorInput):VectorDrag {
  if(d.kind==='shape'){
    let end=point;const dx=point.x-d.start.x,dy=point.y-d.start.y;
    if(point.shift){if(d.tool==='line')end=Math.abs(dx)>=Math.abs(dy)?{...point,y:d.start.y}:{...point,x:d.start.x};else{const side=Math.max(Math.abs(dx),Math.abs(dy));end={...point,x:d.start.x+(dx<0?-side:side),y:d.start.y+(dy<0?-side:side)};}}
    const path=vectorShape(d.tool as 'line'|'rectangle'|'ellipse',d.start,end,d.style);path.id=d.pathId!;d.state={paths:[...d.before.paths,path],selected:[path.id]};
  }else if(d.kind==='move'){
    let dx=point.x-d.start.x,dy=point.y-d.start.y;if(point.shift){if(Math.abs(dx)>Math.abs(dy))dy=0;else dx=0;}
    d.state={...d.state,paths:d.before.paths.map(p=>d.state.selected.includes(p.id)?transformVector(p,dx,dy):p)};
  }else if(d.kind==='node'||d.kind==='handle'){
    if(d.kind==='node'&&d.tool==='vector-node'){
      const dx=point.x-d.start.x,dy=point.y-d.start.y,nodes=d.state.selectedNodes??[];
      d.state={...d.state,paths:d.before.paths.map(p=>({...p,nodes:p.nodes.map((n,i)=>nodes.some(s=>s.pathId===p.id&&s.node===i)?{...n,x:n.x+dx,y:n.y+dy}:n)}))};
    }else d.state={...d.state,paths:d.before.paths.map(p=>p.id===d.pathId?moveVectorNode(p,d.node!,point,d.handle,d.tool==='vector-anchor'||point.alt):p)};
  }else if(d.kind==='new-anchor'){
    // New or existing point stays anchored; dragging pulls tangent handles.
    const base=d.state.paths.find(p=>p.id===d.pathId);if(base){const n=base.nodes[d.node!];let target=point;
      if(point.shift){const angle=Math.round(Math.atan2(point.y-n.y,point.x-n.x)/(Math.PI/4))*Math.PI/4,dist=Math.hypot(point.x-n.x,point.y-n.y);target={...point,x:n.x+Math.cos(angle)*dist,y:n.y+Math.sin(angle)*dist};}
      // Option held before pressing an existing point temporarily converts it:
      // dragging creates both handles. Pressing Option during a new-point drag
      // instead breaks the outgoing handle away from the incoming one.
      const next=moveVectorNode(base,d.node!,target,'handleOut',point.alt&&!d.start.alt);d.state={...d.state,paths:d.state.paths.map(p=>p.id===next.id?next:p)};
    }
  }else if(d.kind==='erase'){
    if(point.x!==d.samples.at(-1)!.x||point.y!==d.samples.at(-1)!.y)d.samples.push(point);
    d.state={paths:eraseVectors(d.before.paths,d.samples,d.radius,d.eraseMode),selected:[]};
  }else if(d.kind==='marquee'){
    const x=Math.min(d.start.x,point.x),y=Math.min(d.start.y,point.y),right=Math.max(d.start.x,point.x),bottom=Math.max(d.start.y,point.y);
    if(d.tool==='vector-node'){
      const inside=d.before.paths.flatMap(p=>p.nodes.flatMap((n,node)=>n.x>=x&&n.x<=right&&n.y>=y&&n.y<=bottom?[{pathId:p.id,node}]:[]));
      const nodes=[...new Map([...(d.start.shift?selectedVectorNodes(d.before):[]),...inside].map(n=>[`${n.pathId}:${n.node}`,n])).values()];
      d.state={...d.state,selected:[...new Set(nodes.map(n=>n.pathId))],selectedNodes:nodes};
    }else{
      const selected=d.before.paths.filter(p=>{const b=vectorBounds(p);return b.x>=x&&b.y>=y&&b.x+b.w<=right&&b.y+b.h<=bottom;}).map(p=>p.id);
      d.state={...d.state,selected:d.start.shift?[...new Set([...d.before.selected,...selected])]:selected,selectedNodes:undefined};
    }
  }
  return d;
}

export function selectedVectorNodes(state:VectorState):VectorNodeSelection[]{
  return state.selectedNodes??(state.selectedNode?[state.selectedNode]:state.paths.filter(p=>state.selected.includes(p.id)).flatMap(p=>p.nodes.map((_,node)=>({pathId:p.id,node}))));
}
export function deleteSelectedVectorNodes(paths:VectorPath[],nodes:VectorNodeSelection[]):VectorPath[]{
  return paths.flatMap(p=>{const selected=nodes.filter(n=>n.pathId===p.id).map(n=>n.node);if(!selected.length)return [p];const kept=p.nodes.filter((_,i)=>!selected.includes(i));return kept.length?[{...p,nodes:kept}]:[];});
}
