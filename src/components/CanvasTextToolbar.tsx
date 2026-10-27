import type {TextStyle} from '../types';
import type {TextSelection,TextStylePatch} from '../lib/textStyle';
import {availableFontWeights,matchingFontWeight,type PcFontFamily} from '../lib/bubbleFonts';
import FontFamilyPicker from './FontFamilyPicker';
import {useEffect,useRef,useState} from 'preact/hooks';
export default function CanvasTextToolbar({style,defaultFont,fontFamilies=[],selection,selectionWeight,disabled,onChange,onSizeGesture,onHistory,onRequestFonts,creating=false}:{
  style:TextStyle;defaultFont:string;fontFamilies?:readonly PcFontFamily[];selection?:TextSelection;selectionWeight?:number|null;disabled:boolean;onChange:(patch:TextStylePatch)=>void;onSizeGesture?:(phase:'start'|'end')=>void;onHistory?:(direction:'undo'|'redo')=>void;onRequestFonts?:()=>void;creating?:boolean;
}){
  const size=style.fontSize??12;
  const weights=availableFontWeights(style.font??defaultFont,fontFamilies);
  const selectedRange=Boolean(selection&&selection.end>selection.start),mixed=selectedRange&&selectionWeight===null;
  const weightValue=mixed?'':matchingFontWeight(selectedRange?(selectionWeight??style.fontWeight??600):style.fontWeight??600,weights)??'';
  const [sizeDraft,setSizeDraft]=useState(String(size));
  const composing=useRef(false),sizeActive=useRef(false),sizeGesture=useRef(onSizeGesture);sizeGesture.current=onSizeGesture;
  const finishSize=()=>{if(sizeActive.current){sizeActive.current=false;sizeGesture.current?.('end');}};
  useEffect(()=>{
    window.addEventListener('pointerup',finishSize);window.addEventListener('pointercancel',finishSize);window.addEventListener('blur',finishSize);
    return()=>{window.removeEventListener('pointerup',finishSize);window.removeEventListener('pointercancel',finishSize);window.removeEventListener('blur',finishSize);finishSize();};
  },[]);
  useEffect(()=>setSizeDraft(String(size)),[size]);
  const applySize=(value:string)=>{
    setSizeDraft(value);
    if(composing.current||!/^\d+(?:\.\d+)?$/.test(value))return;
    const number=Number(value);
    if(Number.isFinite(number)&&number>=4&&number<=144){sizeActive.current=true;sizeGesture.current?.('start');onChange({fontSize:Math.round(number*10)/10});}
  };
  const changeStyle=(patch:TextStylePatch)=>{finishSize();onChange(patch);};
  return <div class="canvas-text-toolbar" aria-label={creating?'新規文字の設定':'選択した文字の設定'} onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{
    if(e.isComposing||composing.current)return;
    if((e.metaKey||e.ctrlKey)&&['z','y'].includes(e.key.toLowerCase())&&onHistory){e.preventDefault();e.stopPropagation();finishSize();onHistory(e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo');}
  }}>
    <fieldset class="canvas-text-font-settings">
      <legend>フォント</legend>
      <div class="canvas-text-font"><span>書体</span><FontFamilyPicker value={style.font??defaultFont} families={fontFamilies} label="文字の書体" disabled={disabled} onOpen={onRequestFonts} onChange={font=>changeStyle({font})}/></div>
      <label class="canvas-text-weight">{selectedRange?'選択文字の太さ':'太さ'}<select aria-label="文字の太さ" disabled={disabled||weights.length<2} value={weightValue} onChange={e=>{const value=Number(e.currentTarget.value);if(!disabled&&weights.length>1&&weights.some(option=>option.value===value))changeStyle({fontWeight:value});}}>
        {mixed&&<option value="" disabled>混在</option>}{!mixed&&!weights.length&&<option value="">変更不可</option>}{weights.map(option=><option value={option.value}>{option.label}</option>)}
      </select></label>
    </fieldset>
    <div class="canvas-text-size"><label>サイズ<input aria-label="文字サイズ pt" type="text" inputMode="decimal" value={sizeDraft} disabled={disabled}
      onInput={e=>applySize(e.currentTarget.value)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={e=>{composing.current=false;applySize(e.currentTarget.value);}}
      onBlur={()=>{composing.current=false;finishSize();setSizeDraft(String(size));}} onKeyDown={e=>{if(e.isComposing||composing.current)return;if(e.key==='Enter'){e.preventDefault();e.stopPropagation();applySize(e.currentTarget.value);finishSize();}else if(e.key==='Escape'){e.stopPropagation();finishSize();setSizeDraft(String(size));}}}/>pt</label>
      <input aria-label="文字サイズ スライダー" type="range" min="4" max="144" step="1" value={size} disabled={disabled} onInput={e=>applySize(e.currentTarget.value)} onKeyUp={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))finishSize();}} onBlur={finishSize}/>
    </div>
    <label>方向<select aria-label="文字の方向" disabled={disabled} value={style.orientation??'vertical'} onChange={e=>changeStyle({orientation:e.currentTarget.value as 'vertical'|'horizontal'})}><option value="vertical">縦</option><option value="horizontal">横</option></select></label>
  </div>;
}
