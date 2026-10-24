import type {TextStyle} from '../types';
import type {TextSelection,TextStylePatch} from '../lib/textStyle';
import {BUBBLE_FONT_PRESETS} from '../lib/bubbleFonts';
export default function CanvasTextToolbar({style,defaultFont,selection,selectionWeight,disabled,onChange,onMaterials}:{
  style:TextStyle;defaultFont:string;selection?:TextSelection;selectionWeight?:number|null;disabled:boolean;onChange:(patch:TextStylePatch)=>void;onMaterials?:()=>void;
}){
  return <div class="canvas-text-toolbar" aria-label="選択した文字の設定" onPointerDown={e=>e.stopPropagation()}>
    <label>書体<select aria-label="文字の書体" disabled={disabled} value={style.font??defaultFont} onChange={e=>onChange({font:e.currentTarget.value})}>
      {[...new Set([...BUBBLE_FONT_PRESETS,defaultFont,...(style.font?[style.font]:[])])].map(font=><option value={font}>{font}</option>)}
    </select></label>
    <label>サイズ<input aria-label="文字サイズ pt" type="number" min="4" max="144" step="0.5" placeholder="標準" value={style.fontSize??''} disabled={disabled}
      onChange={e=>{if(e.currentTarget.value===''||e.currentTarget.validity.valid)onChange({fontSize:e.currentTarget.value===''?null:Number(e.currentTarget.value)});}}/>pt</label>
    <label>{selection&&selection.end>selection.start?'選択文字の太さ':'太さ'}<select aria-label="文字の太さ" disabled={disabled} value={selection&&selection.end>selection.start?(selectionWeight??''):style.fontWeight??600} onChange={e=>onChange({fontWeight:Number(e.currentTarget.value)})}>
      {selectionWeight===null&&<option value="" disabled>混在</option>}<option value="300">細め</option><option value="400">標準</option><option value="500">中</option><option value="600">やや太め</option><option value="700">太め</option><option value="800">極太</option><option value="900">特太</option>
    </select></label>
    <label>方向<select aria-label="文字の方向" disabled={disabled} value={style.orientation??'vertical'} onChange={e=>onChange({orientation:e.currentTarget.value as 'vertical'|'horizontal'})}><option value="vertical">縦</option><option value="horizontal">横</option></select></label>
    {onMaterials&&<button type="button" disabled={disabled} onClick={onMaterials}>吹き出し素材</button>}
  </div>;
}
