import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { PenTool, Plus, Minus, ChevronLeft, ChevronDown } from 'lucide-preact';
import { PaintToolButton } from './PaintToolHelp';
import type { VectorPenTool } from '../lib/vectorGesture';

const choices:[VectorPenTool,string,string][]=[
  ['vector-pen','ベジェペン','P'],
  ['vector-add','アンカーポイント追加','＋'],
  ['vector-delete','アンカーポイント削除','−'],
  ['vector-anchor','アンカーポイント','Shift+C'],
];
function Icon({tool}:{tool:VectorPenTool}){return tool==='vector-anchor'?<ChevronLeft size={23}/>:<span class="pen-family-symbol"><PenTool size={23}/>{tool==='vector-add'?<Plus size={12}/>:tool==='vector-delete'?<Minus size={12}/>:null}</span>;}
export default function PaintPenTools({tool,select,disabled,open,setOpen}:{tool:string;select:(tool:VectorPenTool)=>void;disabled:boolean;open:boolean;setOpen:(open:boolean)=>void}){
  const root=useRef<HTMLDivElement>(null);
  const popup=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState({left:0,top:0});
  const [last,setLast]=useState<VectorPenTool>('vector-pen');
  const active=choices.find(c=>c[0]===tool);
  const current=active??choices.find(c=>c[0]===last)!;
  useEffect(()=>{if(active)setLast(active[0]);},[tool]);
  useLayoutEffect(()=>{if(!open||!root.current||!popup.current)return;const a=root.current.getBoundingClientRect(),b=popup.current.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(a.right+8,window.innerWidth-b.width-8)),top:Math.max(8,Math.min(a.top,window.innerHeight-b.height-8))});},[open]);
  useEffect(()=>{if(!open)return;const dismiss=(e:PointerEvent)=>{if(e.target instanceof Node&&!root.current?.contains(e.target)&&!popup.current?.contains(e.target))setOpen(false);};const reposition=()=>setOpen(false);document.addEventListener('pointerdown',dismiss,true);window.addEventListener('resize',reposition);return()=>{document.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('resize',reposition);};},[open]);
  return <div ref={root} class="paint-pen-family" onContextMenu={e=>{e.preventDefault();if(!disabled)setOpen(!open);}}>
    <PaintToolButton class="paint-tool-icon" label={current[1]} shortcut={current[2]} aria-keyshortcuts={current[2].replace('＋','+').replace('−','-')} aria-pressed={!!active} disabled={disabled} onClick={()=>select(current[0])}><Icon tool={current[0]}/></PaintToolButton>
    <PaintToolButton class="pen-family-toggle" label="ベジェペンのツール一覧"  aria-expanded={open} disabled={disabled} onClick={()=>setOpen(!open)}><ChevronDown size={12}/></PaintToolButton>
    {open&&createPortal(<div ref={popup} class="paint-dock pen-family-menu" role="group" aria-label="ベジェペンのツール" style={position}>{choices.map(([value,label,key])=><PaintToolButton label={label} shortcut={key} aria-pressed={tool===value} disabled={disabled} onClick={()=>select(value)}><Icon tool={value}/><span>{label}</span><kbd>{key}</kbd></PaintToolButton>)}</div>,document.body)}
  </div>;
}
