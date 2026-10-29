import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Lasso, WandSparkles, ChevronDown } from 'lucide-preact';
import { PaintToolButton } from './PaintToolHelp';
type SelectionTool='lasso'|'wand';
const isSelectionTool=(tool:string):tool is SelectionTool=>tool==='lasso'||tool==='wand';
const choices=[['lasso','投げ縄','',Lasso],['wand','自動選択','',WandSparkles]] as const;
export default function PaintSelectionTools({tool,select,disabled}:{tool:string;select:(tool:SelectionTool)=>void;disabled:boolean}){
  const [last,setLast]=useState<SelectionTool>('lasso'),[open,setOpen]=useState(false),[position,setPosition]=useState({left:0,top:0});
  const root=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null);
  const active=isSelectionTool(tool),current=choices.find(c=>c[0]===(active?tool:last))!,Icon=current[3];
  useEffect(()=>{if(isSelectionTool(tool))setLast(tool);setOpen(false);},[tool]);
  useLayoutEffect(()=>{if(!open||!root.current||!popup.current)return;const a=root.current.getBoundingClientRect(),b=popup.current.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(a.right+8,innerWidth-b.width-8)),top:Math.max(8,Math.min(a.top,innerHeight-b.height-8))});},[open]);
  useEffect(()=>{if(!open)return;const dismiss=(e:PointerEvent)=>{if(e.target instanceof Node&&!root.current?.contains(e.target)&&!popup.current?.contains(e.target))setOpen(false);};const close=()=>setOpen(false);const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){close();e.preventDefault();e.stopPropagation();}};document.addEventListener('pointerdown',dismiss,true);window.addEventListener('keydown',key,true);window.addEventListener('resize',close);return()=>{document.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('keydown',key,true);window.removeEventListener('resize',close);};},[open]);
  return <div ref={root} class="paint-pen-family" onContextMenu={event=>{event.preventDefault();if(!disabled)setOpen(!open);}}>
    <PaintToolButton class={`paint-tool-icon tool-${current[0]}`} label={current[1]} shortcut="Shift：追加 / Option・Alt：除外" disabled={disabled} aria-pressed={active} onClick={()=>{setOpen(false);select(current[0]);}}><Icon size={23}/></PaintToolButton>
    <PaintToolButton class="pen-family-toggle" label="選択のツール一覧"  disabled={disabled} aria-expanded={open} onClick={()=>setOpen(!open)}><ChevronDown size={12}/></PaintToolButton>
    {open&&createPortal(<div ref={popup} class="paint-dock pen-family-menu" role="group" aria-label="選択のツール" style={position}>{choices.map(([value,label,key,Shape])=><PaintToolButton class={`tool-${value}`} label={label} shortcut="Shift：追加 / Option・Alt：除外" disabled={disabled} aria-pressed={tool===value} onClick={()=>{setOpen(false);select(value);}}><Shape size={23}/><span>{label}</span>{key&&<kbd>{key}</kbd>}</PaintToolButton>)}</div>,document.body)}
  </div>;
}
