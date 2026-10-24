import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { VectorPath } from '../types';
import { vectorPathData } from '../lib/vectorGeometry';
export interface VectorOverlayState {paths:VectorPath[];selected:string[];selectedNodes?:Array<{pathId:string;node:number}>;width:number;height:number;handles:boolean}
export default function VectorOverlay({state}:{state:VectorOverlayState}){
  const svg=useRef<SVGSVGElement>(null),[unit,setUnit]=useState(1);
  useLayoutEffect(()=>{if(!svg.current)return;const update=()=>{const width=svg.current?.getBoundingClientRect().width;if(width)setUnit(state.width/width);};update();const observer=new ResizeObserver(update);observer.observe(svg.current);return()=>observer.disconnect();},[state.width]);
  return <svg ref={svg} class="vector-edit-overlay" viewBox={`0 0 ${state.width} ${state.height}`} preserveAspectRatio="none" aria-hidden="true">{state.paths.filter(p=>state.selected.includes(p.id)).map(p=><g key={p.id}>
    <path d={vectorPathData(p)} fill="none" class="vector-selection-path"/>
    {state.handles&&p.nodes.map((n,i)=><g key={i}>{(['handleIn','handleOut'] as const).map(key=>n[key]&&<g><line x1={n.x} y1={n.y} x2={n.x+n[key]!.x} y2={n.y+n[key]!.y}/><circle cx={n.x+n[key]!.x} cy={n.y+n[key]!.y} r={3*unit}/></g>)}<rect class={state.selectedNodes?.some(s=>s.pathId===p.id&&s.node===i)?'is-selected-anchor':undefined} x={n.x-3*unit} y={n.y-3*unit} width={6*unit} height={6*unit}/></g>)}
  </g>)}</svg>;
}
