import {useEffect,useLayoutEffect,useRef,useState} from 'preact/hooks';
import {createPortal} from 'preact/compat';
import {PaintToolButton} from './PaintToolHelp';
import type {PaintRulerMode} from '../lib/paintRuler';

/** The outer triangle has sides 11 : 11√3 : 22 (30–60–90 degrees). */
function RulerIcon(){return <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-linejoin="round" aria-hidden="true"><path d="M6 21H17V1.947Z M11 17H14V11.804Z"/><path d="M8 21v-2m3 2v-2m3 2v-2"/></svg>;}
const choices=[['radial','集中線'],['parallel','平行線']] as const;
export default function PaintRulerTools({mode,active,select,disabled}:{mode:PaintRulerMode|null;active:boolean;select:(mode:PaintRulerMode|null)=>void;disabled:boolean}){
  const [open,setOpen]=useState(false),[position,setPosition]=useState({left:0,top:0});
  const root=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{if(!open||!root.current||!popup.current)return;const a=root.current.getBoundingClientRect(),b=popup.current.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(a.right+8,innerWidth-b.width-8)),top:Math.max(8,Math.min(a.top,innerHeight-b.height-8))});popup.current.querySelector<HTMLButtonElement>('[aria-checked="true"],button')?.focus();},[open]);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  useEffect(()=>{
    if(!open)return;
    const dismiss=(e:PointerEvent)=>{if(e.target instanceof Node&&!root.current?.contains(e.target)&&!popup.current?.contains(e.target))setOpen(false);};
    const close=()=>setOpen(false);
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();root.current?.querySelector('button')?.focus();}};
    document.addEventListener('pointerdown',dismiss,true);window.addEventListener('keydown',key,true);window.addEventListener('resize',close);
    return()=>{document.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('keydown',key,true);window.removeEventListener('resize',close);};
  },[open]);
  const choose=(next:PaintRulerMode|null)=>{select(next);setOpen(false);root.current?.querySelector('button')?.focus();};
  return <div ref={root} class="paint-pen-family"><PaintToolButton class="paint-tool-icon" label="定規" shortcut="クリック：基準点を設置／⌘ドラッグ：基準点移動／⌘＋Shift：45°刻みの回転" disabled={disabled} aria-pressed={active} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><RulerIcon/></PaintToolButton>
    {open&&createPortal(<div ref={popup} class="paint-dock pen-family-menu" role="menu" aria-label="定規の種類" style={position} onKeyDown={event=>{
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();
    }}>
      {choices.map(([value,label])=><PaintToolButton role="menuitemradio" aria-checked={mode===value} label={label} onClick={()=>choose(value)}><span aria-hidden="true">{mode===value?'●':'○'}</span><span>{label}</span></PaintToolButton>)}
      <PaintToolButton role="menuitem" label="定規を解除" disabled={!mode} onClick={()=>choose(null)}>定規を解除</PaintToolButton>
      <small style={{maxWidth:'220px',padding:'4px 8px'}}>クリック：基準点を設置<br/>⌘＋○クリック：スナップ切替<br/>⌘ドラッグ：移動・回転<br/>平行線は⌘＋Shiftで45°刻み</small>
    </div>,document.body)}
  </div>;
}
