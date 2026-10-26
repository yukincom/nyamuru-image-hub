import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { VectorPoint } from '../types';
import { bubbleBezierData, moveBubbleBezierNode, type BubbleBezier } from '../lib/bubbleBezier.ts';
import '../styles/bubbleBezier.css';
type Handle = 'handleIn' | 'handleOut';
type Drag = { pointerId: number; index: number; handle?: Handle; offset?:VectorPoint; before: BubbleBezier; current: BubbleBezier };

interface HandlesProps {
  outline: BubbleBezier;
  onChange: (outline: BubbleBezier) => void;
  selected?: number;
  onSelect?: (index: number) => void;
  overlay?: boolean;
  label?: string;
}

/** The inspector and the paper canvas share exactly the same node/handle gesture. */
export function BubbleBezierHandles({ outline, onChange, selected, onSelect, overlay = false, label = 'ベジェ輪郭の編集' }: HandlesProps) {
  const svg = useRef<SVGSVGElement>(null), drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<BubbleBezier | null>(null);
  const [localSelected, setLocalSelected] = useState(0);
  const [unit,setUnit]=useState({x:1,y:1});
  useLayoutEffect(()=>{
    const element=svg.current;if(!element)return;
    const update=()=>{const matrix=element.getScreenCTM();if(!matrix)return;
      const x=1/Math.hypot(matrix.a,matrix.b),y=1/Math.hypot(matrix.c,matrix.d);
      if(Number.isFinite(x)&&Number.isFinite(y))setUnit(previous=>Math.abs(previous.x-x)<1e-6&&Math.abs(previous.y-y)<1e-6?previous:{x,y});};
    update();const observer=new ResizeObserver(update);observer.observe(element);return()=>observer.disconnect();
  },[]);
  const activeOutline = draft ?? outline;
  const activeIndex = Math.min(selected ?? localSelected, activeOutline.nodes.length - 1);
  const node = activeOutline.nodes[activeIndex];
  const overlayBounds=(()=>{
    const points=activeOutline.nodes.flatMap(n=>[
      {x:n.x,y:n.y},
      ...(n.handleIn?[{x:n.x+n.handleIn.x,y:n.y+n.handleIn.y}]:[]),
      ...(n.handleOut?[{x:n.x+n.handleOut.x,y:n.y+n.handleOut.y}]:[]),
    ]);
    const padding=8,minX=Math.min(0,...points.map(point=>point.x))-padding,minY=Math.min(0,...points.map(point=>point.y))-padding;
    const maxX=Math.max(100,...points.map(point=>point.x))+padding,maxY=Math.max(100,...points.map(point=>point.y))+padding;
    return {minX,minY,width:maxX-minX,height:maxY-minY};
  })();
  const select = (index: number) => { setLocalSelected(index); onSelect?.(index); };
  const position = (event: PointerEvent): VectorPoint | null => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  };
  const start = (event: PointerEvent, at: number, handle?: Handle,offset?:VectorPoint) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault(); event.stopPropagation(); select(at);
    drag.current = { pointerId: event.pointerId, index: at, handle, offset, before: activeOutline, current: activeOutline };
    svg.current?.setPointerCapture(event.pointerId);
  };
  const startOutline=(event:PointerEvent)=>{
    const point=position(event);if(!point)return;
    let at=0,distance=Infinity;
    activeOutline.nodes.forEach((candidate,index)=>{const next=((candidate.x-point.x)/unit.x)**2+((candidate.y-point.y)/unit.y)**2;if(next<distance){distance=next;at=index;}});
    const anchor=activeOutline.nodes[at];
    start(event,at,undefined,{x:anchor.x-point.x,y:anchor.y-point.y});
  };
  const move = (event: PointerEvent) => {
    const action = drag.current, p = position(event);
    if (!action || action.pointerId !== event.pointerId || !p) return;
    event.preventDefault(); event.stopPropagation();
    const point = { x:p.x+(action.offset?.x??0), y:p.y+(action.offset?.y??0) };
    action.current = moveBubbleBezierNode(action.before, action.index, point, action.handle, event.altKey);
    setDraft(action.current);
  };
  const finish = (event: PointerEvent, cancel = false) => {
    const action = drag.current;
    if (!action || action.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); drag.current = null;
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
    setDraft(null);
    if (!cancel && JSON.stringify(action.before) !== JSON.stringify(action.current)) onChange(action.current);
  };
  return <svg ref={svg} class={`bubble-bezier-canvas ${overlay ? 'is-paper-overlay' : ''}`}
    viewBox={overlay?`${overlayBounds.minX} ${overlayBounds.minY} ${overlayBounds.width} ${overlayBounds.height}`:'-20 -20 140 140'}
    style={overlay?{left:`${overlayBounds.minX}%`,top:`${overlayBounds.minY}%`,width:`${overlayBounds.width}%`,height:`${overlayBounds.height}%`}:undefined}
    preserveAspectRatio={overlay?'none':'xMidYMid meet'} aria-label={label}
    onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
    onKeyDown={event => { if (event.key === 'Escape' && drag.current) { drag.current = null; setDraft(null); event.stopPropagation(); } }}>
    <rect class="bubble-bezier-box" x="0" y="0" width="100" height="100" />
    <path class="bubble-bezier-outline-hit" d={bubbleBezierData(activeOutline)} onPointerDown={startOutline} />
    <path class="bubble-bezier-outline" d={bubbleBezierData(activeOutline)} />
    {(['handleIn', 'handleOut'] as const).map(handle => {
      const h = node?.[handle];
      return h && <g key={handle}>
        <line class="bubble-bezier-handle-line" x1={node.x} y1={node.y} x2={node.x+h.x} y2={node.y+h.y} />
        <ellipse class="bubble-bezier-handle-hit" cx={node.x+h.x} cy={node.y+h.y} rx={7*unit.x} ry={7*unit.y} onPointerDown={event => start(event, activeIndex, handle)} />
        <ellipse class="bubble-bezier-handle" cx={node.x+h.x} cy={node.y+h.y} rx={3*unit.x} ry={3*unit.y} />
      </g>;
    })}
    {activeOutline.nodes.map((n, i) => <g key={i}>
      <rect class="bubble-bezier-node-hit" x={n.x-7*unit.x} y={n.y-7*unit.y} width={14*unit.x} height={14*unit.y} onPointerDown={event => start(event, i)} />
      <rect class={`bubble-bezier-node ${i === activeIndex ? 'is-selected' : ''}`} x={n.x-3.5*unit.x} y={n.y-3.5*unit.y} width={7*unit.x} height={7*unit.y} />
    </g>)}
  </svg>;
}

/** V selection shows the complete native outline without exposing path nodes. */
export function BubbleBezierSelection({outline,label='フキダシ全体を選択'}:{outline:BubbleBezier;label?:string}){
  return <svg class="bubble-bezier-canvas is-paper-overlay is-selection-overlay" viewBox="-20 -20 140 140" preserveAspectRatio="none" aria-label={label}>
    <rect class="bubble-bezier-box" x="0" y="0" width="100" height="100"/>
    <path class="bubble-bezier-outline" d={bubbleBezierData(outline)}/>
  </svg>;
}
