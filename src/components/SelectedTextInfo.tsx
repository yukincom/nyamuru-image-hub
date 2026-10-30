import type { Bubble, Character, ScreenText } from '../types';
import { canvasTextCategory, type CanvasTextKind, type TextCategory } from '../lib/canvasText';
import { Field, SectionTitle } from './Fields';
import { textDisplayLabel } from '../lib/displayLabels';
import { LETTERING_PENS, LETTERING_EXPRESSIONS, handwrittenStyleExpressions, type HandwrittenStylePatch } from '../lib/handwrittenStyle';

/** One selection and the existing text mutator serve all three categories. */
export default function SelectedTextInfo({item,index,kind,disabled,characters,onCharacter,onDepth,onCategory,onText,onHistoryBoundary,onHandwrittenStyle}:{
  item:Bubble|ScreenText;index:number;kind:CanvasTextKind;disabled:boolean;
  characters:readonly Character[];onCharacter:(id:string)=>void;
  onDepth:(depth:NonNullable<Bubble['lettering_depth']>)=>void;
  onCategory:(category:TextCategory)=>void;onText:(text:string)=>void;onHistoryBoundary:()=>void;
  onHandwrittenStyle:(patch:HandwrittenStylePatch)=>void;
}) {
  const lettering=kind==='bubble'&&(item as Bubble).shape==='handwritten'?item as Bubble:undefined;
  const changeStyle=(patch:HandwrittenStylePatch)=>{
    if(disabled)return;
    onHistoryBoundary();onHandwrittenStyle(patch);onHistoryBoundary();
  };
  return <section class="editor-section selected-text-info is-selected">
    <SectionTitle title={textDisplayLabel(index)} action={item.splitOverlap?<em class="split-overlap-badge">分割重複</em>:undefined}/>
    <Field label="種類"><select aria-label="文字の種類" value={canvasTextCategory(item,kind)} disabled={disabled} onChange={event=>onCategory(event.currentTarget.value as TextCategory)}>
      <option value="bubble">フキダシ</option><option value="handwritten">描き文字</option><option value="typeset">写植文字</option>
    </select></Field>
    <Field label="本文" wide><textarea aria-label="選択中の文字の本文" rows={3} value={item.text} disabled={disabled} onFocus={onHistoryBoundary} onBlur={onHistoryBoundary} onInput={event=>onText(event.currentTarget.value)}/></Field>
    {kind==='bubble'&&canvasTextCategory(item,kind)!=='typeset'&&<Field label="対応キャラクター"><select value={(item as Bubble).speakerId??''} disabled={disabled} onChange={event=>{const id=event.currentTarget.value;onHistoryBoundary();onCharacter(id);onHistoryBoundary();}}>
      <option value="">なし</option>{characters.map(character=><option value={character.localId}>{character.name}</option>)}
    </select></Field>}
    {lettering&&<div class="handwritten-style-fields">
      <Field label="ペン"><select aria-label="描き文字のペン" value={lettering.lettering_pen??''} disabled={disabled} onChange={event=>{
        const id=event.currentTarget.value;
        if(id===(lettering.lettering_pen??''))return;
        changeStyle({lettering_pen:id||undefined});
      }}><option value="">未指定</option>{LETTERING_PENS.map(option=><option key={option.id} value={option.id}>{option.ja}</option>)}</select></Field>
      <fieldset class="handwritten-expression-options" disabled={disabled}><legend>表現</legend>{LETTERING_EXPRESSIONS.map(option=><label class="check-row" key={option.id}>
        <input type="checkbox" checked={lettering.lettering_expressions?.includes(option.id)??false} onChange={event=>{
          const ids=lettering.lettering_expressions??[],checked=event.currentTarget.checked;
          if(checked===ids.includes(option.id))return;
          const next=handwrittenStyleExpressions(checked?[...ids,option.id]:ids.filter(id=>id!==option.id));
          changeStyle({lettering_expressions:next.length?next:undefined});
        }}/><span>{option.ja}</span>
      </label>)}</fieldset>
    </div>}
    {kind==='bubble'&&(item as Bubble).shape==='handwritten'&&((item as Bubble).speakerId||(item as Bubble).speaker)&&<Field label="重なり"><select value={(item as Bubble).lettering_depth??'front'} disabled={disabled} onChange={event=>{const depth=event.currentTarget.value as NonNullable<Bubble['lettering_depth']>;onHistoryBoundary();onDepth(depth);onHistoryBoundary();}}>
      <option value="front">手前</option><option value="behind">後ろ</option>
    </select></Field>}
  </section>;
}
