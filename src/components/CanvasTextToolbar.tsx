import type {TextStyle} from '../types';
import type {TextSelection,TextStylePatch} from '../lib/textStyle';
import type {PcFontFamily} from '../lib/bubbleFonts';
import FontFamilyPicker from './FontFamilyPicker';
import {useEffect,useState} from 'preact/hooks';
export default function CanvasTextToolbar({style,defaultFont,fontFamilies=[],selection,selectionWeight,disabled,onChange,onRequestFonts,creating=false}:{
  style:TextStyle;defaultFont:string;fontFamilies?:readonly PcFontFamily[];selection?:TextSelection;selectionWeight?:number|null;disabled:boolean;onChange:(patch:TextStylePatch)=>void;onRequestFonts?:()=>void;creating?:boolean;
}){
  const size=style.fontSize??12;
  const [sizeDraft,setSizeDraft]=useState(String(size));
  useEffect(()=>setSizeDraft(String(size)),[size]);
  const applySize=(value:string)=>{
    setSizeDraft(value);
    if(!/^\d+(?:\.\d+)?$/.test(value))return;
    const number=Number(value);
    if(Number.isFinite(number)&&number>=4&&number<=144)onChange({fontSize:Math.round(number*10)/10});
  };
  return <div class="canvas-text-toolbar" aria-label={creating?'新規文字の設定':'選択した文字の設定'} onPointerDown={e=>e.stopPropagation()}>
    <fieldset class="canvas-text-font-settings">
      <legend>フォント</legend>
      <div class="canvas-text-font"><span>書体</span><FontFamilyPicker value={style.font??defaultFont} families={fontFamilies} label="文字の書体" disabled={disabled} onOpen={onRequestFonts} onChange={font=>onChange({font})}/></div>
      <label class="canvas-text-weight">{selection&&selection.end>selection.start?'選択文字の太さ':'太さ'}<select aria-label="文字の太さ" disabled={disabled} value={selection&&selection.end>selection.start?(selectionWeight??''):style.fontWeight??600} onChange={e=>onChange({fontWeight:Number(e.currentTarget.value)})}>
        {selectionWeight===null&&<option value="" disabled>混在</option>}<option value="300">細め</option><option value="400">標準</option><option value="500">中</option><option value="600">やや太め</option><option value="700">太め</option><option value="800">極太</option><option value="900">特太</option>
      </select></label>
    </fieldset>
    <div class="canvas-text-size"><label>サイズ<input aria-label="文字サイズ pt" type="text" inputMode="decimal" value={sizeDraft} disabled={disabled}
      onInput={e=>applySize(e.currentTarget.value)} onBlur={()=>setSizeDraft(String(size))} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();applySize(e.currentTarget.value);}else if(e.key==='Escape'){e.stopPropagation();setSizeDraft(String(size));}}}/>pt</label>
      <input aria-label="文字サイズ スライダー" type="range" min="4" max="144" step="1" value={size} disabled={disabled} onInput={e=>{const fontSize=Number(e.currentTarget.value);setSizeDraft(String(fontSize));onChange({fontSize});}}/>
    </div>
    <label>方向<select aria-label="文字の方向" disabled={disabled} value={style.orientation??'vertical'} onChange={e=>onChange({orientation:e.currentTarget.value as 'vertical'|'horizontal'})}><option value="vertical">縦</option><option value="horizontal">横</option></select></label>
  </div>;
}
