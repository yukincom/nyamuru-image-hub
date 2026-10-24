import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Type, ChevronDown, MessageCircleMore, MonitorSpeaker } from 'lucide-preact';
import { PaintToolButton } from './PaintToolHelp';
import type { CanvasTextKind } from '../lib/canvasText';
export default function PaintTextTools({active,disabled,select,add,onMaterials}:{active:boolean;disabled:boolean;select:()=>void;add:(kind:CanvasTextKind)=>void;onMaterials?:()=>void}){
  const [open,setOpen]=useState(false),[position,setPosition]=useState({left:0,top:0});
  const root=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{if(!open||!root.current||!popup.current)return;const a=root.current.getBoundingClientRect(),b=popup.current.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(a.right+8,innerWidth-b.width-8)),top:Math.max(8,Math.min(a.top,innerHeight-b.height-8))});},[open]);
  useEffect(()=>{if(!open)return;const dismiss=(e:PointerEvent)=>{if(e.target instanceof Node&&!root.current?.contains(e.target)&&!popup.current?.contains(e.target))setOpen(false);};const reposition=()=>setOpen(false);const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);e.preventDefault();e.stopPropagation();}};document.addEventListener('pointerdown',dismiss,true);window.addEventListener('keydown',key,true);window.addEventListener('resize',reposition);return()=>{document.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('keydown',key,true);window.removeEventListener('resize',reposition);};},[open]);
  return <div class="paint-pen-family" ref={root} onContextMenu={event=>{event.preventDefault();if(!disabled)setOpen(!open);}}>
    <PaintToolButton class="paint-tool-icon" label="文字" help="Tで選択。紙面の吹き出しや画面内文字をクリックして編集します。右下の三角から追加できます。" aria-keyshortcuts="T" aria-pressed={active} disabled={disabled} onClick={()=>{setOpen(false);select();}}><Type size={23}/></PaintToolButton>
    <PaintToolButton class="pen-family-toggle" label="文字のツール一覧" help="吹き出し・画面内文字を追加します。" aria-expanded={open} disabled={disabled} onClick={()=>setOpen(!open)}><ChevronDown size={12}/></PaintToolButton>
    {open&&createPortal(<div class="paint-dock pen-family-menu" ref={popup} style={position} role="menu" aria-label="文字のツール">
      {onMaterials&&<button role="menuitem" class="paint-help-button" onClick={()=>{setOpen(false);onMaterials();}}><MessageCircleMore size={23}/>吹き出し素材</button>}
      <button role="menuitem" class="paint-help-button" onClick={()=>{setOpen(false);add('bubble');}}><MessageCircleMore size={23}/>吹き出しを追加</button>
      <button role="menuitem" class="paint-help-button" onClick={()=>{setOpen(false);add('screen_text');}}><MonitorSpeaker size={23}/>画面内文字を追加</button>
    </div>,document.body)}
  </div>;
}
