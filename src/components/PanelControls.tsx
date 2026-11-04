import {useEffect,useLayoutEffect,useRef,useState} from 'preact/hooks';
import {createPortal} from 'preact/compat';
import {Combine,Plus,Scissors,X} from 'lucide-preact';
import {PaintToolButton} from './PaintToolHelp';
interface Props {
  painting:boolean; disabled:boolean; hasPanel:boolean; onAdd:()=>void;
  innerFrameSnap:boolean; panelGapSnap:boolean; panelSync:boolean;
  onToggleInnerFrameSnap:()=>void; onTogglePanelGapSnap:()=>void; onTogglePanelSync:()=>void;
  selectedCount:number; onMerge:()=>void; splitDirection:'vertical'|'horizontal';
  onSplitDirection:(value:'vertical'|'horizontal')=>void; onSplit:()=>void;
}
function ComicPanelsIcon(){
  return <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-linejoin="round" aria-hidden="true">
    <path d="M2 2h7v7l-7 2Z M12 2h10v7H12Z M2 14l12-2v10H2Z M17 12h5v10h-5Z"/>
  </svg>;
}
export default function PanelControls(p:Props){
  const [open,setOpen]=useState(false),[position,setPosition]=useState({left:0,top:0});
  const root=useRef<HTMLDivElement>(null),popup=useRef<HTMLElement>(null);
  const close=()=>{setOpen(false);root.current?.querySelector('button')?.focus();};
  useLayoutEffect(()=>{
    if(!open||!root.current||!popup.current)return;
    const place=()=>{const a=root.current!.getBoundingClientRect(),b=popup.current!.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(a.right+8,innerWidth-b.width-8)),top:Math.max(8,Math.min(a.top,innerHeight-b.height-8))});};
    place();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}};
    window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
  },[open]);
  return <div ref={root} class="paint-pen-family">
    <PaintToolButton class="paint-tool-icon" label="コマ コントロール" disabled={p.disabled} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><ComicPanelsIcon/></PaintToolButton>
    {open&&createPortal(<section ref={popup} class="paint-dock panel-controls" role="dialog" aria-label="コマ コントロール" style={position} onPointerDown={event=>event.stopPropagation()}>
      <header class="panel-controls-header"><strong>コマ コントロール</strong><button type="button" aria-label="コマ コントロールを閉じる" onClick={close}><X size={16}/></button></header>
      <div class="panel-controls-body">
        <label class="panel-snap-setting"><input type="checkbox" disabled={p.disabled} checked={p.innerFrameSnap} onChange={p.onToggleInnerFrameSnap}/>内枠スナップ</label>
        <label class="panel-snap-setting"><input type="checkbox" disabled={p.disabled} checked={p.panelGapSnap} onChange={p.onTogglePanelGapSnap}/>コマスナップ</label>
        <label class="panel-snap-setting"><input type="checkbox" disabled={p.disabled} checked={p.panelSync} onChange={p.onTogglePanelSync}/>コマシンクロ</label>
        <div class="panel-control-actions">
          <button type="button" onClick={p.onAdd} disabled={p.disabled||p.painting}><Plus size={16}/>新しいコマを作成</button>
          <button type="button" onClick={p.onMerge} disabled={p.disabled||p.painting||p.selectedCount<2}><Combine size={16}/>合体</button>
          <div class="panel-control-split"><select disabled={p.disabled||p.painting||!p.hasPanel} aria-label="コマ分割" value={p.splitDirection} onChange={e=>p.onSplitDirection(e.currentTarget.value as Props['splitDirection'])}><option value="vertical">タテ分割</option><option value="horizontal">ヨコ分割</option></select>
            <button type="button" disabled={p.disabled||p.painting||!p.hasPanel} onClick={p.onSplit} aria-label="コマ分割を適用"><Scissors size={16}/>分割</button></div>
        </div>
      </div>
    </section>,document.body)}
  </div>;
}
