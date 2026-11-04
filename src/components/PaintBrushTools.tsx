import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Pencil, ChevronDown } from 'lucide-preact';
import { PaintToolButton } from './PaintToolHelp';
import type { PaintBrush } from '../types';

const choices:ReadonlyArray<readonly [PaintBrush,string]>=[['round','ペン'],['rough-hatching','ラフ・ハッチング']];
function BrushIcon({brush}:{brush:PaintBrush}){
  return brush==='round'?<Pencil size={23}/>:<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><path d="M4 5 3 19M7 3 6 20M10 4 10 18M13 3 12 21M16 5 16 19M19 4 20 20"/></svg>;
}

export default function PaintBrushTools({brush,active,select,disabled}:{brush:PaintBrush;active:boolean;select:(brush:PaintBrush)=>void;disabled:boolean}){
  const [open,setOpen]=useState(false),[position,setPosition]=useState({left:0,top:0});
  const root=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null);
  const label=choices.find(choice=>choice[0]===brush)![1];
  useEffect(()=>{setOpen(false);},[active,disabled]);
  useLayoutEffect(()=>{if(!open||!root.current||!popup.current)return;const a=root.current.getBoundingClientRect(),b=popup.current.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(a.right+8,innerWidth-b.width-8)),top:Math.max(8,Math.min(a.top,innerHeight-b.height-8))});},[open]);
  useEffect(()=>{
    if(!open)return;
    const dismiss=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target)&&!popup.current?.contains(event.target))setOpen(false);};
    const close=()=>setOpen(false);
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){close();event.preventDefault();event.stopPropagation();}};
    document.addEventListener('pointerdown',dismiss,true);window.addEventListener('keydown',key,true);window.addEventListener('resize',close);
    return()=>{document.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('keydown',key,true);window.removeEventListener('resize',close);};
  },[open]);
  return <div ref={root} class="paint-pen-family" onContextMenu={event=>{event.preventDefault();if(!disabled)setOpen(value=>!value);}}>
    <PaintToolButton class="paint-tool-icon" label={label} shortcut="[ / ]：太さ" disabled={disabled} aria-pressed={active} onClick={()=>{setOpen(false);select(brush);}}><BrushIcon brush={brush}/></PaintToolButton>
    <PaintToolButton class="pen-family-toggle" label="ラスターペンのブラシ一覧" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><ChevronDown size={12}/></PaintToolButton>
    {open&&createPortal(<div ref={popup} class="paint-dock pen-family-menu" role="menu" aria-label="ラスターペンのブラシ" style={position}>{choices.map(([value,name])=><PaintToolButton key={value} role="menuitemradio" label={name} aria-checked={brush===value} aria-pressed={brush===value} disabled={disabled} onClick={()=>{setOpen(false);select(value);}}><BrushIcon brush={value}/><span>{name}</span></PaintToolButton>)}</div>,document.body)}
  </div>;
}
