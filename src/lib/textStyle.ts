import type { Bubble, ScreenText, TextStyle, TextWeightRange } from '../types.ts';
import { bubbleCssFontFamily } from './bubbleFonts.ts';

export type TextStylePatch = Omit<TextStyle, 'fontSize'> & {fontSize?: number | null};
export interface TextSelection {start:number;end:number}
type TextItem = Pick<Bubble,'text'|'text_style'|'text_weights'>;
export function validTextWeight(value:unknown):value is number {return typeof value==='number'&&Number.isInteger(value)&&value>=100&&value<=900;}
export function validTextStyle(value:unknown):value is TextStyle {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const s=value as TextStyle;
  return Object.keys(s).every(k=>['orientation','font','fontSize','fontWeight'].includes(k))
    &&(s.orientation===undefined||['vertical','horizontal'].includes(s.orientation))
    &&(s.font===undefined||typeof s.font==='string'&&s.font.trim().length>0&&s.font.length<=120&&!/[\x00-\x1f]/.test(s.font))
    &&(s.fontSize===undefined||Number.isFinite(s.fontSize)&&s.fontSize>=4&&s.fontSize<=144)
    &&(s.fontWeight===undefined||validTextWeight(s.fontWeight));
}
function boundary(text:string,index:number){return Number.isSafeInteger(index)&&index>=0&&index<=text.length&&!(index>0&&index<text.length&&/[\uD800-\uDBFF]/.test(text[index-1])&&/[\uDC00-\uDFFF]/.test(text[index]));}
export function validTextWeights(value:unknown,text:string):value is TextWeightRange[]{
  if(!Array.isArray(value)||value.length>4096)return false;
  let end=0;
  return value.every(r=>{
    if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['start','end','fontWeight'].includes(k))||!boundary(text,r.start)||!boundary(text,r.end)||r.start<end||r.end<=r.start||!validTextWeight(r.fontWeight))return false;
    end=r.end;return true;
  });
}
export function textStyleOf(item:Bubble|ScreenText,kind:'bubble'|'screen_text'):TextStyle {
  const authored=item.text_style;
  return {...authored,
    orientation:kind==='screen_text'?(item as ScreenText).orientation??authored?.orientation??'horizontal':authored?.orientation??'vertical',
    fontSize:authored?.fontSize??(kind==='screen_text'?12:15)};
}
export function selectedTextWeight(item:TextItem,selection:TextSelection,baseWeight=600):number|null {
  const base=item.text_style?.fontWeight??baseWeight,values=new Set<number>();let at=selection.start;
  for(const r of item.text_weights??[]){
    if(r.end<=selection.start||r.start>=selection.end)continue;
    if(r.start>at)values.add(base);
    values.add(r.fontWeight);at=Math.max(at,Math.min(r.end,selection.end));
  }
  if(at<selection.end||selection.start===selection.end)values.add(base);
  return values.size===1?[...values][0]:null;
}
export function updateTextStyle(item:Bubble|ScreenText,kind:'bubble'|'screen_text',patch:TextStylePatch,selection?:TextSelection){
  const next={...item.text_style,...patch};
  if(next.fontSize===null)delete next.fontSize;
  if(!validTextStyle(next))throw Error('文字設定を確認してください（4〜144 pt、太さ100〜900）');
  if(selection&&selection.end>selection.start&&patch.fontWeight!==undefined){
    applyTextWeight(item,selection,patch.fontWeight);
    if(item.text_style?.fontWeight===undefined)delete next.fontWeight;else next.fontWeight=item.text_style.fontWeight;
  }else if(patch.fontWeight!==undefined)delete item.text_weights;
  if(kind==='screen_text'&&patch.orientation)(item as ScreenText).orientation=patch.orientation;
  item.text_style=next as TextStyle;
}
export function applyTextWeight(item:TextItem,selection:TextSelection,fontWeight:number){
  const {start,end}=selection;
  if(!boundary(item.text,start)||!boundary(item.text,end)||end<=start||!validTextWeight(fontWeight))throw Error('太さを変える文字の範囲を選択してください');
  const ranges:TextWeightRange[]=[];
  for(const r of item.text_weights??[]){
    if(r.end<=start||r.start>=end)ranges.push({...r});
    else {if(r.start<start)ranges.push({...r,end:start});if(r.end>end)ranges.push({...r,start:end});}
  }
  ranges.push({start,end,fontWeight});ranges.sort((a,b)=>a.start-b.start);
  const merged:TextWeightRange[]=[];
  for(const r of ranges){const last=merged.at(-1);if(last&&last.end===r.start&&last.fontWeight===r.fontWeight)last.end=r.end;else merged.push(r);}
  item.text_weights=merged;
}
/** Preserve styles outside an actual edit, without moving emphasis onto replacement text. */
export function rebaseTextWeights(item:TextItem,nextText:string,edit?:TextSelection){
  const old=item.text;
  if(old===nextText||!item.text_weights)return;
  let a=0,b=old.length,c=nextText.length;
  const inserted=edit?nextText.length-old.length+edit.end-edit.start:-1;
  if(edit&&inserted>=0&&boundary(old,edit.start)&&boundary(old,edit.end)&&edit.end>=edit.start
    &&old.slice(0,edit.start)===nextText.slice(0,edit.start)&&old.slice(edit.end)===nextText.slice(edit.start+inserted)){
    a=edit.start;b=edit.end;c=edit.start+inserted;
  }else{
    while(a<Math.min(b,c)&&old[a]===nextText[a])a++;
    while(a>0&&(!boundary(old,a)||!boundary(nextText,a)))a--;
    while(b>a&&c>a&&old[b-1]===nextText[c-1]){b--;c--;}
    while(b<old.length&&(!boundary(old,b)||!boundary(nextText,c))){b++;c++;}
  }
  const delta=c-b,ranges:TextWeightRange[]=[];
  for(const r of item.text_weights){
    if(r.start<a)ranges.push({...r,end:Math.min(r.end,a)});
    if(r.end>b)ranges.push({...r,start:Math.max(r.start,b)+delta,end:r.end+delta});
  }
  item.text_weights=ranges.filter(r=>r.end>r.start);
  if(!item.text_weights.length)delete item.text_weights;
}
export function textWeightSegments(item:TextItem):Array<{text:string;fontWeight?:number}>{
  const result:Array<{text:string;fontWeight?:number}>=[];let at=0;
  for(const r of item.text_weights??[]){if(r.start>at)result.push({text:item.text.slice(at,r.start)});result.push({text:item.text.slice(r.start,r.end),fontWeight:r.fontWeight});at=r.end;}
  if(at<item.text.length||!result.length)result.push({text:item.text.slice(at)});
  return result;
}
/** The canvas formatting is authoritative; OMNY emphasis mirrors visibly heavier ranges. */
export function syncBubbleEmphasisFromWeights(bubble:Bubble):void{
  const base=bubble.text_style?.fontWeight??600;
  const phrases=[...new Set((bubble.text_weights??[])
    .filter(range=>range.fontWeight>base)
    .map(range=>bubble.text.slice(range.start,range.end).trim())
    .filter(Boolean))];
  if(phrases.length)bubble.emphasis=phrases.join(', ');else delete bubble.emphasis;
}
/** The unzoomed layout host supplies its px width; works without container-query units. */
export function canvasLengthCss(lengthMm:number,paperWidthMm:number):string {
  return `calc(var(--canvas-layout-width, ${paperWidthMm*96/25.4}px) * ${lengthMm/paperWidthMm})`;
}
export function textToolCursor(style:TextStyle):'text'|'vertical-text' {
  return style.orientation==='horizontal'?'text':'vertical-text';
}
export function textStyleCss(style:TextStyle,paperWidthMm:number,defaultFont?:string):Record<string,string>{
  const font=style.font??defaultFont;
  return {...(font?{fontFamily:bubbleCssFontFamily(font)}:{}),writingMode:style.orientation==='horizontal'?'horizontal-tb':'vertical-rl','--text-tool-cursor':textToolCursor(style),
    ...(style.fontSize?{fontSize:canvasLengthCss(style.fontSize*25.4/72,paperWidthMm)}:{}),
    ...(style.fontWeight?{fontWeight:String(style.fontWeight)}:{})};
}
