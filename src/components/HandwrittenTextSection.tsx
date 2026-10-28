import { textDisplayLabel } from '../lib/displayLabels';
import { Plus, WandSparkles } from 'lucide-preact';
import type { Bubble } from '../types';
import { isHandwrittenText, letteringGuideVisible } from '../lib/bubblePresentation';
import { ownerItemLocked } from '../lib/panelLayers';
import { Field, SectionTitle } from './Fields';

/** Both inspectors edit the same document items through their existing mutator. */
export default function HandwrittenTextSection({bubbles,selectedIndex,disabled=false,busy=false,onHistoryBoundary,onAdd,onSelect,onText,onUpdate,onRemove,onGenerate}:{
  bubbles:readonly Bubble[];selectedIndex?:number;disabled?:boolean;busy?:boolean;
  onAdd:()=>void;onSelect:(index:number)=>void;onUpdate:(index:number,recipe:(bubble:Bubble)=>void)=>void;
  onText:(index:number,text:string)=>void;
  onRemove:(index:number)=>void;onGenerate:(index:number)=>void;
  onHistoryBoundary:()=>void;
}) {
  const discrete=(action:()=>void)=>{onHistoryBoundary();action();onHistoryBoundary();};
  return <section class="editor-section inspector-category-section handwritten-text-section">
    <SectionTitle title="描き文字" action={<button class="inline-add" disabled={disabled||busy} onClick={()=>discrete(onAdd)}><Plus size={14}/>追加</button>}/>
    <div class="nested-list">{bubbles.map((bubble,index)=>({bubble,index})).filter(({bubble})=>isHandwrittenText(bubble)).map(({bubble,index})=>{
      const locked=disabled||ownerItemLocked(bubble);
      return <div class={`nested-card selectable-card ${selectedIndex===index?'is-selected':''}`} key={index} onClick={()=>onSelect(index)}>
        <div class="nested-card-head"><strong>{textDisplayLabel(index)}{selectedIndex===index?' · 選択中':''}</strong><button aria-label={`${textDisplayLabel(index)}を削除`} disabled={locked||busy} onClick={event=>{event.stopPropagation();discrete(()=>onRemove(index));}}>×</button></div>
        <Field label="文字" wide><textarea rows={2} value={bubble.text} disabled={locked||busy} placeholder="例：ドン！" onFocus={onHistoryBoundary} onBlur={onHistoryBoundary} onInput={event=>onText(index,event.currentTarget.value)}/></Field>
        <Field label="描き方" wide><textarea rows={3} value={bubble.lettering_description??''} disabled={locked||busy} placeholder="例：太く角張った線で、右上へ勢いよく広がる" onFocus={onHistoryBoundary} onBlur={onHistoryBoundary} onInput={event=>{const value=event.currentTarget.value;onUpdate(index,item=>{if(value)item.lettering_description=value;else delete item.lettering_description;});}}/></Field>
        <label class="check-row"><input type="checkbox" checked={letteringGuideVisible(bubble)} disabled={locked||busy} onChange={event=>{const visible=event.currentTarget.checked;discrete(()=>onUpdate(index,item=>{if(visible)delete item.lettering_guide_hidden;else item.lettering_guide_hidden=true;}));}}/><span>文字あたりを表示</span></label>
        <button class="inline-add" disabled={busy||!bubble.text.trim()||bubble.text.length>500||bubble.hidden===true} onClick={event=>{event.stopPropagation();onGenerate(index);}}><WandSparkles size={14}/>描き文字を生成</button>
      </div>;
    })}</div>
  </section>;
}
