import type { PaintLayer, PaintTone } from '../types';
import { defaultPaintTone } from '../lib/paintTone';
import { paintColorModes } from '../lib/paintColor';
import { useId, useState } from 'preact/hooks';

interface Props {
  layer?:PaintLayer; disabled:boolean; generationMask?:boolean;
  update:(patch:Partial<PaintLayer>)=>void;
}
function TonePreset({label,value,values,unit,change}:{label:string;value:number;values:number[];unit:string;change:(value:number)=>void}){
  return <label>{label}<select aria-label={`トーンの${label}`} value={value} onChange={e=>change(Number(e.currentTarget.value))}>
    {!values.includes(value)&&<option value={value}>{value}{unit}</option>}
    {values.map(option=><option value={option}>{option}{unit}</option>)}
  </select></label>;
}
export default function PaintLayerEffects({layer,disabled,update,generationMask=false}:Props){
  const [tab,setTab]=useState<'tone'|'color'>('tone'),id=useId();
  const tone=layer?.tone??defaultPaintTone();
  const setTone=(patch:Partial<PaintTone>)=>{if(layer)update({tone:{...tone,...patch}});};
  return <section class="paint-layer-effects paint-tone-panel" aria-label="トーン設定">
    <div class="vector-detail-tabs paint-effects-tabs" role="tablist" aria-label="トーンとカラーモード" onKeyDown={e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
      const next=e.key==='Home'?'tone':e.key==='End'?'color':tab==='tone'?'color':'tone';setTab(next);
      e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    }}>{([['tone','トーン'],['color','カラーモード']] as const).map(([key,label])=><button type="button" role="tab" id={`${id}-${key}`} data-tab={key} aria-controls={`${id}-panel`} aria-selected={tab===key} tabIndex={tab===key?0:-1} onClick={()=>setTab(key)}>{label}</button>)}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
    {tab==='color'?<fieldset disabled={disabled||!layer||layer.locked||generationMask}>
      <label>カラーモード<select aria-label="レイヤーのカラーモード" value={!layer?'':generationMask?'color':layer.colorMode??'color'} onChange={e=>{if(layer)update({colorMode:e.currentTarget.value as PaintLayer['colorMode']});}}>
        {!layer&&<option value="" disabled>レイヤーを選択</option>}
        {paintColorModes.map(mode=><option value={mode.value}>{mode.label}</option>)}
      </select></label>
    </fieldset>:<fieldset disabled={disabled||!layer||layer.locked||generationMask}>
      {!tone.fill&&<label><input type="checkbox" disabled={disabled||!layer||layer.locked||generationMask} checked={Boolean(layer?.tone?.enabled)} onChange={e=>setTone({enabled:e.currentTarget.checked})}/>画像を網点化（丸）</label>}
      {layer?.tone?.enabled&&<>
        <label>線数<select aria-label="トーンの線数" value={tone.lpi} onChange={e=>setTone({lpi:Number(e.currentTarget.value)})}>
          <optgroup label="よく使う線数"><option value={30}>30線</option><option value={60}>60線</option></optgroup>
          <optgroup label="ほかの線数">{(![27.5,30,32.5,42.5,50,55,60,65,70,85].includes(tone.lpi)?[tone.lpi,27.5,32.5,42.5,50,55,65,70,85]:[27.5,32.5,42.5,50,55,65,70,85]).map(value=><option value={value}>{value}線</option>)}</optgroup>
        </select></label>
        {!tone.fill&&<label>濃度<select aria-label="トーンの濃度方式" value={tone.mode} onChange={e=>setTone({mode:e.currentTarget.value as PaintTone['mode']})}><option value="image">画像の色を使用</option><option value="fixed">一定の濃度</option></select></label>}
        {tone.mode==='fixed'&&<TonePreset label="濃度" value={tone.density} values={Array.from({length:21},(_,i)=>i*5)} unit="%" change={density=>setTone({density})}/>}
        <TonePreset label="角度" value={tone.angle??45} values={Array.from({length:25},(_,i)=>i*15)} unit="°" change={angle=>setTone({angle})}/>
      </>}
    </fieldset>}
    </div>
  </section>;
}
