import { useId } from 'preact/hooks';
import { AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignStartVertical, AlignCenterVertical, AlignEndVertical, ChevronDown } from 'lucide-preact';
import type { VectorStyle } from '../types';
import type { VectorAlign, VectorReference, VectorEraseMode } from '../lib/vectorGeometry';
import { PaintToolButton } from './PaintToolHelp';
import VectorOptionIcon from './VectorOptionIcon';
interface Props {
  tab:VectorDetailTab; setTab:(tab:VectorDetailTab)=>void;
  style:VectorStyle; change:(patch:Partial<VectorStyle>)=>void; selectedCount:number; reference:VectorReference; setReference:(r:VectorReference)=>void;
  gap:number; setGap:(n:number)=>void; align:(mode:VectorAlign)=>void; distribute:(axis:'x'|'y',mode:'start'|'center'|'end'|'gap',fixed?:boolean)=>void;
  eraseMode:VectorEraseMode; setEraseMode:(m:VectorEraseMode)=>void; erasing:boolean; disabled?:boolean;
}
type Choice=[value:string,label:string];
export type VectorDetailTab='line'|'dash'|'arrows'|'align'|'distribute'|'erase';
export default function VectorControls(p:Props){
  const {tab,setTab}=p;
  const id=useId();
  const tabs: [VectorDetailTab,string][]=[['line','線'],['dash','破線'],['arrows','矢印'],['align','整列'],['distribute','分布']];
  if(p.erasing)tabs.push(['erase','消去']);
  const active=tab==='erase'&&!p.erasing?'line':tab;
  const tabKey=(event:KeyboardEvent)=>{
    const index=tabs.findIndex(([key])=>key===active);
    const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;
    if(next<0)return;event.preventDefault();event.stopPropagation();setTab(tabs[next][0]);
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
  };
  const choices=(label:string,value:string,prefix:string,options:Choice[],change:(value:string)=>void,flip=false)=><div class={`vector-choice-row vector-choice-${prefix}`}><span>{label}</span><div class="vector-choice-icons" role="group" aria-label={label}>{options.map(([v,title])=><PaintToolButton label={`${label}：${title}`}  disabled={p.disabled} aria-pressed={value===v} onClick={()=>change(v)}><VectorOptionIcon kind={`${prefix}-${v}`} flip={flip}/></PaintToolButton>)}</div></div>;


  const arrows:Choice[]=[['none','なし'],['triangle','矢印'],['open','開いた矢印'],['circle','丸']];
  return <div class="vector-controls">
    <div class="vector-detail-tabs" role="tablist" aria-label="線と配置の設定" onKeyDown={tabKey}>{tabs.map(([key,label])=><button type="button" role="tab" id={`${id}-${key}`} aria-controls={`${id}-panel`} aria-selected={active===key} tabIndex={active===key?0:-1} onClick={()=>setTab(key)}>{label}</button>)}</div>
    <div class={`vector-tab-panel ${active==='align'||active==='distribute'?'is-alignment':''} ${active==='distribute'?'is-distribution':''}`} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${active}`} tabIndex={0}>
    {active==='line'&&<div class="vector-properties">
      {choices('線端',p.style.cap,'cap',[
        ['butt','平型'],['round','丸型'],['square','突出'],
      ],v=>p.change({cap:v as VectorStyle['cap']}))}
      {choices('角の形状',p.style.join,'join',[
        ['miter','角'],['round','丸'],['bevel','面取り'],
      ],v=>p.change({join:v as VectorStyle['join']}))}
      {p.style.join==='miter'&&<label>角の比率<input type="number" aria-label="角の比率"  min="1" max="1000" value={p.style.miterLimit} onChange={e=>p.change({miterLimit:Math.max(1,Math.min(1000,e.currentTarget.valueAsNumber||10))})}/></label>}
      {choices('線の位置',p.style.alignment,'position',[
        ['center','中央'],['inside','内側'],['outside','外側'],
      ],v=>p.change({alignment:v as VectorStyle['alignment']}))}
    </div>}
    {active==='dash'&&<div class="vector-properties">
      {choices('線種',p.style.dash.length?'on':'off','dash',[
        ['off','実線'],['on','破線'],
      ],v=>p.change({dash:v==='on'?[10,10]:[]}))}
      {!!p.style.dash.length&&<div class="vector-dashes">{Array.from({length:6},(_,i)=><label>{i%2?'間隔':'線分'}<input type="number" min="0" max="10000" step="1" aria-label={`${i%2?'間隔':'線分'} ${Math.floor(i/2)+1}`}  value={p.style.dash[i]??0} onChange={e=>{const dash=Array.from({length:6},(_,j)=>j===i?Math.max(0,e.currentTarget.valueAsNumber||0):p.style.dash[j]??0);while(dash.at(-1)===0)dash.pop();p.change({dash:dash.map(n=>Math.max(.1,n))});}}/></label>)}</div>}
    </div>}
    {active==='arrows'&&<div class="vector-properties">
      {choices('始点',p.style.arrowStart,'arrow',arrows,v=>p.change({arrowStart:v as VectorStyle['arrowStart']}),true)}
      {choices('終点',p.style.arrowEnd,'arrow',arrows,v=>p.change({arrowEnd:v as VectorStyle['arrowEnd']}))}
    </div>}
    {active==='erase'&&<div class="vector-properties">{choices('ベクター消去',p.eraseMode,'erase',[
        ['touch','触れた部分'],['intersection','交点まで'],['whole','線全体'],
      ],v=>p.setEraseMode(v as VectorEraseMode))}
    </div>}
    {(active==='align'||active==='distribute')&&<div class="vector-properties">
      {active==='align'&&<div class="vector-action-grid">{([
        ['left','左揃え',AlignStartVertical],['hcenter','水平中央揃え',AlignCenterVertical],['right','右揃え',AlignEndVertical],
        ['top','上揃え',AlignStartHorizontal],['vcenter','垂直中央揃え',AlignCenterHorizontal],['bottom','下揃え',AlignEndHorizontal],
      ] as const).map(([mode,label,Icon])=><PaintToolButton label={label}  disabled={p.disabled||!p.selectedCount} onClick={()=>p.align(mode)}><Icon size={17}/></PaintToolButton>)}</div>}
      {active==='distribute'&&<>
      {(['y','x'] as const).map(axis=><div class="vector-action-grid">{(['start','center','end'] as const).map((mode,i)=>{
        const direction=axis==='y'?'垂直':'水平',edge=(axis==='y'?['上端','中心','下端']:['左端','中心','右端'])[i];
        return <PaintToolButton label={`${direction}方向・${edge}を分布`}  disabled={p.disabled||p.selectedCount<2} onClick={()=>p.distribute(axis,mode)}><VectorOptionIcon kind={`distribute-${axis}-${mode}`}/></PaintToolButton>;
      })}</div>)}
      </>}
    </div>}
    {(active==='align'||active==='distribute')&&<div class={active==='distribute'?'vector-distribution-footer':'vector-reference-footer'}>
    {active==='distribute'&&<div class="vector-spacing-controls">
      <span>等間隔に分布：</span>
      <div class="vector-spacing-row">{(['y','x'] as const).map(axis=><PaintToolButton label={`${axis==='y'?'垂直':'水平'}に等間隔`}  disabled={p.disabled||p.selectedCount<2} onClick={()=>p.distribute(axis,'gap',true)}><VectorOptionIcon kind={`distribute-${axis}-gap`}/></PaintToolButton>)}
        <label><input aria-label="分布の間隔"  type="number" min="0" max="10000" value={p.gap} onChange={e=>p.setGap(Math.max(0,e.currentTarget.valueAsNumber||0))}/><span>px</span></label>
      </div>
    </div>}
    <div class="alignment-reference"><span>整列：</span><label class="alignment-reference-picker" data-disabled={p.disabled||undefined}>
      <VectorOptionIcon kind={`reference-${p.reference}`}/><ChevronDown size={9}/>
      <select aria-label="整列の基準" data-tool-label="整列の基準"  disabled={p.disabled} value={p.reference} onChange={e=>p.setReference(e.currentTarget.value as VectorReference)}>
        <option value="selection">選択範囲に整列</option><option value="key">最初の選択に整列</option><option value="canvas">描画範囲に整列</option>
      </select>
    </label></div>
    </div>}
    </div>
  </div>;
}
