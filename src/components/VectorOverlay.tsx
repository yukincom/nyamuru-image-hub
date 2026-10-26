import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { VectorPath } from '../types';
import { vectorPathData } from '../lib/vectorGeometry';
import {vectorSelectionBounds,type VectorResizeHandle} from '../lib/vectorGesture';
export interface VectorOverlayState {paths:VectorPath[];selected:string[];selectedNodes?:Array<{pathId:string;node:number}>;width:number;height:number;handles:boolean;selectionBox?:boolean}
export default function VectorOverlay({state}:{state:VectorOverlayState}){
  const svg=useRef<SVGSVGElement>(null),[unit,setUnit]=useState(1);
  useLayoutEffect(()=>{if(!svg.current)return;const update=()=>{const width=svg.current?.getBoundingClientRect().width;if(width)setUnit(state.width/width);};update();const observer=new ResizeObserver(update);observer.observe(svg.current);return()=>observer.disconnect();},[state.width]);
  const bounds=state.selectionBox?vectorSelectionBounds(state.paths,state.selected):undefined;
  const resizeHandles:Array<[VectorResizeHandle,number,number]>=bounds?[
    ['nw',bounds.x,bounds.y],['n',bounds.x+bounds.w/2,bounds.y],['ne',bounds.x+bounds.w,bounds.y],['e',bounds.x+bounds.w,bounds.y+bounds.h/2],
    ['se',bounds.x+bounds.w,bounds.y+bounds.h],['s',bounds.x+bounds.w/2,bounds.y+bounds.h],['sw',bounds.x,bounds.y+bounds.h],['w',bounds.x,bounds.y+bounds.h/2],
  ]:[];
  return <svg ref={svg} class="vector-edit-overlay" viewBox={`0 0 ${state.width} ${state.height}`} preserveAspectRatio="none" aria-hidden="true">{state.paths.filter(p=>state.selected.includes(p.id)).map(p=><g key={p.id}>
    <path d={vectorPathData(p)} fill="none" class="vector-selection-path"/>
    {state.handles&&p.nodes.map((n,i)=><g key={i}>{(['handleIn','handleOut'] as const).map(key=>n[key]&&<g><line x1={n.x} y1={n.y} x2={n.x+n[key]!.x} y2={n.y+n[key]!.y}/><circle cx={n.x+n[key]!.x} cy={n.y+n[key]!.y} r={3*unit}/></g>)}<rect class={state.selectedNodes?.some(s=>s.pathId===p.id&&s.node===i)?'is-selected-anchor':undefined} x={n.x-3*unit} y={n.y-3*unit} width={6*unit} height={6*unit}/></g>)}
  </g>)}{bounds&&<g class="vector-selection-box"><rect x={bounds.x} y={bounds.y} width={Math.max(bounds.w,.01)} height={Math.max(bounds.h,.01)}/>{resizeHandles.map(([handle,x,y])=><rect key={handle} data-vector-resize={handle} class={`vector-resize-handle is-${handle}`} x={x-4*unit} y={y-4*unit} width={8*unit} height={8*unit}/>)}</g>}</svg>;
}
