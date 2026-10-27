import {createPortal} from 'preact/compat';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'preact/hooks';
import {ChevronDown,X} from 'lucide-preact';
import {bubbleCssFontFamily,FONT_MENU_SAMPLE,mergeFontFamilyCatalog,type PcFontFamily} from '../lib/bubbleFonts';

type FontCategory='japanese'|'all'|'unreadable';
type FontDisplay='name'|'sample';

export default function FontFamilyPicker({value,families=[],disabled=false,label='書体',onOpen,onChange}:{
  value:string;families?:readonly PcFontFamily[];disabled?:boolean;label?:string;onOpen?:()=>void;onChange:(family:string)=>void;
}){
  const [open,setOpen]=useState(false),[category,setCategory]=useState<FontCategory>('japanese'),[display,setDisplay]=useState<FontDisplay>('name');
  const [position,setPosition]=useState({left:8,top:8});
  const anchor=useRef<HTMLButtonElement>(null),popup=useRef<HTMLElement>(null);
  const options=useMemo(()=>mergeFontFamilyCatalog(families,[value]),[families,value]);
  const counts=useMemo(()=>({all:options.length,japanese:options.filter(font=>font.support==='japanese').length,unreadable:options.filter(font=>font.support==='unreadable').length}),[options]);
  const visible=category==='all'?options:options.filter(font=>font.support===category);
  const selectedName=options.find(font=>font.family===value)?.displayName??value;
  useLayoutEffect(()=>{
    if(!open||!anchor.current||!popup.current)return;
    const a=anchor.current.getBoundingClientRect(),p=popup.current.getBoundingClientRect();
    const left=Math.max(8,Math.min(a.left,innerWidth-p.width-8));
    const below=a.bottom+6,top=below+p.height<=innerHeight-8?below:Math.max(8,a.top-p.height-6);
    setPosition({left,top});
  },[open,category,display,options.length]);
  useEffect(()=>{
    if(!open)return;
    const dismiss=(event:PointerEvent)=>{if(event.target instanceof Node&&!anchor.current?.contains(event.target)&&!popup.current?.contains(event.target))setOpen(false);};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);event.preventDefault();event.stopPropagation();}};
    const resize=()=>setOpen(false);
    document.addEventListener('pointerdown',dismiss,true);window.addEventListener('keydown',key,true);window.addEventListener('resize',resize);
    return()=>{document.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('keydown',key,true);window.removeEventListener('resize',resize);};
  },[open]);
  const toggle=()=>{if(!open)onOpen?.();setOpen(!open);};
  return <div class="font-family-picker">
    <button ref={anchor} type="button" class="font-family-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={toggle} title={selectedName} style={{fontFamily:bubbleCssFontFamily(value)}}><span>{selectedName}</span><ChevronDown size={13}/></button>
    {open&&createPortal(<section ref={popup} class="font-family-popover" role="dialog" aria-label={`${label}を選択`} style={position} onPointerDown={event=>event.stopPropagation()}>
      <header><strong>{label}</strong><button type="button" aria-label="フォント一覧を閉じる" onClick={()=>setOpen(false)}><X size={16}/></button></header>
      <div class="font-family-controls">
        <label>分類<select aria-label="フォントの分類" value={category} onChange={event=>setCategory(event.currentTarget.value as FontCategory)}>
          <option value="japanese">日本語対応（{counts.japanese}）</option><option value="all">すべて（{counts.all}）</option><option value="unreadable">読めないフォント（{counts.unreadable}）</option>
        </select></label>
        <div class="font-family-display" role="group" aria-label="フォント一覧の表示">
          <button type="button" aria-label="フォント名で表示" aria-pressed={display==='name'} onClick={()=>setDisplay('name')}><span class="font-name-icon">n</span></button>
          <button type="button" aria-label="サンプル文字で表示" aria-pressed={display==='sample'} onClick={()=>setDisplay('sample')}><span class="font-sample-icon">ABC</span></button>
        </div>
      </div>
      <div class="font-family-grid" role="listbox" aria-label={`${category==='japanese'?'日本語対応':category==='unreadable'?'読めない':'すべての'}フォント`} onWheel={event=>event.stopPropagation()}>
        {visible.map(font=><button type="button" role="option" aria-selected={font.family===value} class={font.family===value?'is-selected':''} title={font.displayName??font.family} style={{fontFamily:bubbleCssFontFamily(font.family)}} onClick={()=>{onChange(font.family);setOpen(false);}}>
          <span>{display==='sample'?FONT_MENU_SAMPLE:(font.displayName??font.family)}</span>{display==='sample'&&<small>{font.displayName??font.family}</small>}
        </button>)}
        {!visible.length&&<p class="font-family-empty">この分類に表示できるフォントはありません。</p>}
      </div>
    </section>,document.body)}
  </div>;
}
