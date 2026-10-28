import type { Bubble, ScreenText } from '../types';
import { canvasTextCategory, type CanvasTextKind, type TextCategory } from '../lib/canvasText';
import { Field, SectionTitle } from './Fields';
import { textDisplayLabel } from '../lib/displayLabels';

/** One selection and the existing text mutator serve all three categories. */
export default function SelectedTextInfo({item,index,kind,disabled,onCategory,onText,onHistoryBoundary}:{
  item:Bubble|ScreenText;index:number;kind:CanvasTextKind;disabled:boolean;
  onCategory:(category:TextCategory)=>void;onText:(text:string)=>void;onHistoryBoundary:()=>void;
}) {
  return <section class="editor-section selected-text-info is-selected">
    <SectionTitle title={textDisplayLabel(index)} action={item.splitOverlap?<em class="split-overlap-badge">分割重複</em>:undefined}/>
    <Field label="種類"><select aria-label="文字の種類" value={canvasTextCategory(item,kind)} disabled={disabled} onChange={event=>onCategory(event.currentTarget.value as TextCategory)}>
      <option value="bubble">フキダシ</option><option value="handwritten">描き文字</option><option value="typeset">写植文字</option>
    </select></Field>
    <Field label="本文" wide><textarea aria-label="選択中の文字の本文" rows={3} value={item.text} disabled={disabled} onFocus={onHistoryBoundary} onBlur={onHistoryBoundary} onInput={event=>onText(event.currentTarget.value)}/></Field>
  </section>;
}
