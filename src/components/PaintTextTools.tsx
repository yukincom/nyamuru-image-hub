import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Type, ChevronDown, MessageCircleMore, Info, X } from 'lucide-preact';
import { PaintToolButton } from './PaintToolHelp';
import { scrollInspectorSelection } from './useInspectorSelectionScroll';
export type TextPaletteTab='text'|'bubble'|'info';
export interface TextPaletteRequest {id:number;tab:TextPaletteTab}
export default function PaintTextTools({active,openRequest,disabled,select,onMaterials,bubbleLineWidthMm,onChangeBubbleLineWidth}:{active:boolean;openRequest:TextPaletteRequest;disabled:boolean;select:()=>void;onMaterials?:()=>void;bubbleLineWidthMm:number;onChangeBubbleLineWidth:(value:number)=>void}){
  const [open,setOpen]=useState(false),[tab,setTab]=useState<TextPaletteTab>('text'),[position,setPosition]=useState({left:0,top:0});
  const [lineDraft,setLineDraft]=useState(String(bubbleLineWidthMm));
  useEffect(()=>setLineDraft(String(bubbleLineWidthMm)),[bubbleLineWidthMm]);
  const root=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null);
  const manuallyPositioned=useRef(false);
  const clampPosition=(left:number,top:number)=>{const rect=popup.current?.getBoundingClientRect(),width=rect?.width??236,height=rect?.height??360;return {left:Math.max(8,Math.min(left,innerWidth-width-8)),top:Math.max(8,Math.min(top,innerHeight-height-8))};};
  // Only an explicit open request opens the window; selection never closes it.
  useEffect(()=>{if(!openRequest.id)return;if(!open||openRequest.tab==='info')setTab(openRequest.tab);setOpen(true);},[openRequest.id]);
  useLayoutEffect(()=>{if(!open||!root.current||!popup.current||manuallyPositioned.current)return;const a=root.current.getBoundingClientRect(),b=popup.current.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(a.right+8,innerWidth-b.width-8)),top:Math.max(8,Math.min(a.top,innerHeight-b.height-8))});},[open]);
  useEffect(()=>{if(!open)return;const reposition=()=>setPosition(current=>clampPosition(current.left,current.top));window.addEventListener('resize',reposition);return()=>window.removeEventListener('resize',reposition);},[open]);
  useLayoutEffect(()=>{if(!open)return;setPosition(current=>clampPosition(current.left,current.top));if(tab==='info')return scrollInspectorSelection(popup.current?.querySelector('.bubble-info-content')??null,'.text-settings-window-body','.text-settings-tabs');},[open,tab]);
  const beginDrag=(event:PointerEvent)=>{
    if(event.button!==0||event.target instanceof Element&&event.target.closest('button,input,select,label'))return;
    event.preventDefault();event.stopPropagation();manuallyPositioned.current=true;
    const start={x:event.clientX,y:event.clientY,...position};
    const move=(next:PointerEvent)=>{next.preventDefault();setPosition(clampPosition(start.left+next.clientX-start.x,start.top+next.clientY-start.y));};
    const finish=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);};
    window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);
  };
  return <div class="paint-pen-family" ref={root} onContextMenu={event=>{event.preventDefault();if(!disabled)setOpen(true);}}>
    <PaintToolButton class="paint-tool-icon" label="写植文字" shortcut="T" aria-keyshortcuts="T" aria-pressed={active} disabled={disabled} onClick={()=>{if(!open)setTab('text');setOpen(true);select();}}><Type size={23}/></PaintToolButton>
    <PaintToolButton class="pen-family-toggle" label="文字のツール一覧"  aria-expanded={open} disabled={disabled} onClick={()=>setOpen(true)}><ChevronDown size={12}/></PaintToolButton>
    {typeof document!=='undefined'&&createPortal(<section class={`paint-dock text-settings-window ${tab==='info'?'is-bubble-info':''}`} ref={popup} style={position} role="dialog" aria-label="文字ツールの設定" data-text-tool-active={String(active)} hidden={!open} onPointerDown={event=>event.stopPropagation()}>
      <header class="text-settings-window-header" onPointerDown={beginDrag}><strong>文字ツール</strong><button type="button" aria-label="文字ツールの設定を閉じる" onPointerDown={event=>event.stopPropagation()} onClick={()=>setOpen(false)}><X size={16}/></button></header>
      <div class="text-settings-window-grab" aria-hidden="true" onPointerDown={beginDrag}/>
      <div class="text-settings-window-body">
        <div class="text-settings-tabs" role="tablist" aria-label="文字ツールの種類">
          <PaintToolButton class="text-settings-tab" role="tab" label="文字"  aria-selected={tab==='text'} aria-controls="text-settings-text-panel" onClick={()=>{setTab('text');if(!active)select();}}><Type size={19}/></PaintToolButton>
          <PaintToolButton class="text-settings-tab" role="tab" label="ふきだし"  aria-selected={tab==='bubble'} aria-controls="text-settings-bubble-panel" onClick={()=>{setTab('bubble');onMaterials?.();}}><MessageCircleMore size={19}/></PaintToolButton>
          <PaintToolButton class="text-settings-tab" role="tab" label="情報"  aria-selected={tab==='info'} aria-controls="text-settings-info-panel" onClick={()=>setTab('info')}><Info size={19}/></PaintToolButton>
        </div>
        <div id="text-settings-text-panel" class="text-settings-panel" role="tabpanel" aria-label="文字" hidden={tab!=='text'}>
          <div id="paint-text-settings-slot" class="paint-text-settings-slot"/>
        </div>
        <div id="text-settings-bubble-panel" class="text-settings-panel" role="tabpanel" aria-label="ふきだし" hidden={tab!=='bubble'}>
          <div class="paint-text-work-settings" role="group" aria-label="吹き出し設定">
            <label><span>線幅</span><input aria-label="吹き出し線幅 mm" type="text" inputMode="decimal" value={lineDraft} disabled={disabled} onInput={event=>{const value=event.currentTarget.value;setLineDraft(value);if(/^\d+(?:\.\d+)?$/.test(value)&&Number(value)>=.1&&Number(value)<=2)onChangeBubbleLineWidth(Number(value));}} onBlur={()=>setLineDraft(String(bubbleLineWidthMm))}/><span>mm</span></label>
            <input aria-label="吹き出し線幅 スライダー" type="range" min="0.1" max="2" step="0.1" value={bubbleLineWidthMm} disabled={disabled} onInput={event=>onChangeBubbleLineWidth(Number(event.currentTarget.value))}/>
            <span class="bubble-line-width-scope">新しく作る吹き出しのデフォルト</span>
          </div>
          <div id="paint-bubble-materials-slot" class="paint-bubble-materials-slot"/>
        </div>
        <div id="text-settings-info-panel" class="text-settings-panel" role="tabpanel" aria-label="情報" hidden={tab!=='info'}>
          <div id="paint-bubble-info-slot"/>
          <p class="bubble-info-empty">紙面またはレイヤー一覧で文字を選択してください。</p>
        </div>
      </div>
    </section>,document.body)}
  </div>;
}
