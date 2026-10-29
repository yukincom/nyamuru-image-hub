import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Square, Circle, Minus, ChevronDown } from 'lucide-preact';
import { PaintToolButton } from './PaintToolHelp';
import { isShapeTool, type ShapeTool } from '../lib/paintToolMode';
const choices=[['rectangle','四角','M',Square,'Shift：正方形'],['ellipse','楕円','L',Circle,'Shift：正円'],['line','直線','',Minus,'Shift：水平・垂直']] as const;
export default function PaintShapeTools({tool,select,disabled}:{tool:string;select:(tool:ShapeTool)=>void;disabled:boolean}){
  const [last,setLast]=useState<ShapeTool>('rectangle'),[open,setOpen]=useState(false),[position,setPosition]=useState({left:0,top:0});
  const root=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null);
  const active=isShapeTool(tool),current=choices.find(c=>c[0]===(active?tool:last))!,Icon=current[3];
  useEffect(()=>{if(isShapeTool(tool))setLast(tool);setOpen(false);},[tool]);
  useLayoutEffect(()=>{if(!open||!root.current||!popup.current)return;const a=root.current.getBoundingClientRect(),b=popup.current.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(a.right+8,innerWidth-b.width-8)),top:Math.max(8,Math.min(a.top,innerHeight-b.height-8))});},[open]);
  useEffect(()=>{if(!open)return;const dismiss=(e:PointerEvent)=>{if(e.target instanceof Node&&!root.current?.contains(e.target)&&!popup.current?.contains(e.target))setOpen(false);};const close=()=>setOpen(false);const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){close();e.preventDefault();e.stopPropagation();}};document.addEventListener('pointerdown',dismiss,true);window.addEventListener('keydown',key,true);window.addEventListener('resize',close);return()=>{document.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('keydown',key,true);window.removeEventListener('resize',close);};},[open]);
  return <div ref={root} class="paint-pen-family" onContextMenu={event=>{event.preventDefault();if(!disabled)setOpen(!open);}}>
    <PaintToolButton class={`paint-tool-icon tool-${current[0]}`} label={current[1]} shortcut={[current[2],current[4]].filter(Boolean)} disabled={disabled} aria-pressed={active} onClick={()=>{setOpen(false);select(current[0]);}}><Icon size={23}/></PaintToolButton>
    <PaintToolButton class="pen-family-toggle" label="図形のツール一覧"  disabled={disabled} aria-expanded={open} onClick={()=>setOpen(!open)}><ChevronDown size={12}/></PaintToolButton>
    {open&&createPortal(<div ref={popup} class="paint-dock pen-family-menu" role="group" aria-label="図形のツール" style={position}>{choices.map(([value,label,key,Shape,shortcut])=><PaintToolButton class={`tool-${value}`} label={label} shortcut={[key,shortcut].filter(Boolean)} disabled={disabled} aria-pressed={tool===value} onClick={()=>{setOpen(false);select(value);}}><Shape size={23}/><span>{label}</span>{key&&<kbd>{key}</kbd>}</PaintToolButton>)}</div>,document.body)}
  </div>;
}
