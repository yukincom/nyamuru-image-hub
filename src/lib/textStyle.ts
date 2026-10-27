import type { Bubble, ScreenText, TextStyle, TextInlineStyle, TextStyleRange } from '../types.ts';
import { bubbleCssFontFamily, matchingFontWeight, type FontWeightOption } from './bubbleFonts.ts';

export type TextStylePatch = Omit<TextStyle, 'fontSize'> & {fontSize?: number | null};
export type TextStyleScope = 'element' | 'selection-or-typing';
export interface TextSelection {start:number;end:number}
type TextItem = Pick<Bubble,'text'|'text_style'|'text_runs'>;
const INLINE_KEYS = ['fontWeight','italic','underline','strikethrough'] as const;
const STYLE_KEYS = ['orientation','font','fontSize','textAlign',...INLINE_KEYS] as const;
export type SelectedTextInlineStyle = {[K in keyof Required<TextInlineStyle>]:Required<TextInlineStyle>[K]|null};

export function validTextWeight(value:unknown):value is number {return typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=1000;}
export function validTextStyle(value:unknown):value is TextStyle {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const s=value as TextStyle;
  return Object.keys(s).every(k=>(STYLE_KEYS as readonly string[]).includes(k))
    &&(s.orientation===undefined||['vertical','horizontal'].includes(s.orientation))
    &&(s.textAlign===undefined||['left','center','right'].includes(s.textAlign))
    &&(s.font===undefined||typeof s.font==='string'&&s.font.trim().length>0&&s.font.length<=120&&!/[\x00-\x1f]/.test(s.font))
    &&(s.fontSize===undefined||Number.isFinite(s.fontSize)&&s.fontSize>=4&&s.fontSize<=144)
    &&(s.fontWeight===undefined||validTextWeight(s.fontWeight))
    &&(['italic','underline','strikethrough'] as const).every(key=>s[key]===undefined||typeof s[key]==='boolean');
}
function boundary(text:string,index:number){return Number.isSafeInteger(index)&&index>=0&&index<=text.length&&!(index>0&&index<text.length&&/[\uD800-\uDBFF]/.test(text[index-1])&&/[\uDC00-\uDFFF]/.test(text[index]));}
function inlineStyle(style:TextInlineStyle):TextInlineStyle {
  return Object.fromEntries(INLINE_KEYS.filter(key=>style[key]!==undefined).map(key=>[key,style[key]]));
}
/** Explicit off values prevent an inherited decoration from leaking into newly typed text. */
export function typingTextStyle(style:TextInlineStyle):TextInlineStyle {
  return {italic:false,underline:false,strikethrough:false,...inlineStyle(style)};
}
export function validTextRuns(value:unknown,text:string):value is TextStyleRange[]{
  if(!Array.isArray(value)||value.length>4096)return false;
  let end=0;
  return value.every(r=>{
    if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['start','end',...INLINE_KEYS].includes(k))||!boundary(text,r.start)||!boundary(text,r.end)||r.start<end||r.end<=r.start)return false;
    const style=Object.fromEntries(Object.entries(r).filter(([key])=>key!=='start'&&key!=='end'));
    if(!Object.keys(style).length||!validTextStyle(style))return false;
    end=r.end;return true;
  });
}
export function textStyleOf(item:Bubble|ScreenText,kind:'bubble'|'screen_text'):TextStyle {
  const authored=item.text_style;
  return {...authored,
    orientation:kind==='screen_text'?(item as ScreenText).orientation??authored?.orientation??'horizontal':authored?.orientation??'vertical',
    fontSize:authored?.fontSize??(kind==='screen_text'?12:15)};
}
export function selectedTextInlineStyle(item:TextItem,selection:TextSelection,baseWeight=600):SelectedTextInlineStyle {
  const base={fontWeight:baseWeight,...typingTextStyle(item.text_style??{})};
  const spans:TextInlineStyle[]=[];let at=selection.start;
  for(const range of item.text_runs??[]){
    if(range.end<=selection.start||range.start>=selection.end)continue;
    if(range.start>at)spans.push(base);
    spans.push({...base,...inlineStyle(range)});at=Math.max(at,Math.min(range.end,selection.end));
  }
  if(at<selection.end||!spans.length)spans.push(base);
  return Object.fromEntries(INLINE_KEYS.map(key=>{const values=new Set(spans.map(span=>span[key]));return [key,values.size===1?[...values][0]:null];})) as SelectedTextInlineStyle;
}
export function selectedTextWeight(item:TextItem,selection:TextSelection,baseWeight=600):number|null {
  return selectedTextInlineStyle(item,selection,baseWeight).fontWeight;
}
function sameInlineStyle(a:TextInlineStyle,b:TextInlineStyle){return INLINE_KEYS.every(key=>a[key]===b[key]);}
function replaceRuns(item:TextItem,ranges:TextStyleRange[]):boolean {
  const merged:TextStyleRange[]=[];
  for(const range of ranges){
    if(range.end<=range.start||!INLINE_KEYS.some(key=>range[key]!==undefined))continue;
    const previous=merged.at(-1);
    if(previous&&previous.end===range.start&&sameInlineStyle(previous,range))previous.end=range.end;
    else merged.push({...range});
  }
  if(merged.length>4096)throw Error('文字の書式範囲が多すぎます');
  const old=item.text_runs??[];
  if(old.length===merged.length&&merged.every((range,i)=>range.start===old[i].start&&range.end===old[i].end&&sameInlineStyle(range,old[i])))return false;
  if(merged.length)item.text_runs=merged;else delete item.text_runs;
  return true;
}
/** Patch just the requested properties, keeping overlapping formatting intact. */
export function applyTextStyleRange(item:TextItem,selection:TextSelection,patch:TextInlineStyle):boolean {
  const {start,end}=selection;
  if(!boundary(item.text,start)||!boundary(item.text,end)||end<=start||!validTextStyle(patch))throw Error('スタイルを変える文字の範囲を選択してください');
  const change=inlineStyle(patch);if(!Object.keys(change).length)return false;
  const existing=item.text_runs??[],points=[...new Set([start,end,...existing.flatMap(range=>[range.start,range.end])])].sort((a,b)=>a-b);
  const result:TextStyleRange[]=[];let index=0;
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1];
    while(index<existing.length&&existing[index].end<=a)index++;
    const previous=existing[index]?.start<=a?existing[index]:undefined,selected=a>=start&&b<=end;
    if(previous||selected)result.push({start:a,end:b,...(previous?inlineStyle(previous):{}),...(selected?change:{})});
  }
  return replaceRuns(item,result);
}
export function updateTextStyle(item:Bubble|ScreenText,kind:'bubble'|'screen_text',patch:TextStylePatch,selection?:TextSelection,fontWeights?:readonly FontWeightOption[]){
  const next={...item.text_style,...patch};
  if(next.fontSize===null)delete next.fontSize;
  const selectingFont=patch.font!==undefined&&Boolean(fontWeights?.length);
  if(selectingFont){const weight=matchingFontWeight(next.fontWeight??600,fontWeights!)!;if(weight!==(next.fontWeight??600))next.fontWeight=weight;}
  if(!validTextStyle(next))throw Error('文字設定を確認してください（4〜144 pt、太さ1〜1000）');
  let changed=false;
  if(selectingFont&&item.text_runs){
    const ranges=item.text_runs.map(range=>range.fontWeight===undefined?{...range}:{...range,fontWeight:matchingFontWeight(range.fontWeight,fontWeights!)!});
    if(ranges.some((range,index)=>range.fontWeight!==item.text_runs![index].fontWeight))changed=replaceRuns(item,ranges);
  }
  const inlinePatch=inlineStyle(patch),keys=INLINE_KEYS.filter(key=>patch[key]!==undefined);
  if(selection&&selection.end>selection.start&&keys.length){
    changed=applyTextStyleRange(item,selection,inlinePatch)||changed;
    for(const key of keys){if(item.text_style?.[key]===undefined)delete next[key];else Object.assign(next,{[key]:item.text_style[key]});}
  }else if(keys.length&&item.text_runs){
    changed=replaceRuns(item,item.text_runs.map(range=>{const copy={...range};for(const key of keys)delete copy[key];return copy;}))||changed;
  }
  if(kind==='screen_text'&&patch.orientation&&(item as ScreenText).orientation!==patch.orientation){(item as ScreenText).orientation=patch.orientation;changed=true;}
  if(STYLE_KEYS.some(key=>item.text_style?.[key]!==next[key])){item.text_style=next as TextStyle;changed=true;}
  return changed;
}
/** Rebase existing ranges and style only the actual inserted/replaced characters. */
export function rebaseTextRuns(item:TextItem,nextText:string,edit?:TextSelection,insertionStyle?:TextInlineStyle){
  const old=item.text;
  if(old===nextText||!item.text_runs&&!insertionStyle)return;
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
  const delta=c-b,ranges:TextStyleRange[]=[];
  for(const range of item.text_runs??[]){
    if(range.start<a)ranges.push({...range,end:Math.min(range.end,a)});
    if(range.end>b)ranges.push({...range,start:Math.max(range.start,b)+delta,end:range.end+delta});
  }
  if(insertionStyle&&c>a)ranges.push({start:a,end:c,...inlineStyle(insertionStyle)});
  replaceRuns(item,ranges.sort((left,right)=>left.start-right.start));
}
export function textStyleSegments(item:TextItem):Array<{text:string}&TextInlineStyle>{
  const base=inlineStyle(item.text_style??{}),result:Array<{text:string}&TextInlineStyle>=[];let at=0;
  for(const range of item.text_runs??[]){
    if(range.start>at)result.push({text:item.text.slice(at,range.start),...base});
    result.push({text:item.text.slice(range.start,range.end),...base,...inlineStyle(range)});at=range.end;
  }
  if(at<item.text.length||!result.length)result.push({text:item.text.slice(at),...base});
  return result;
}
/** The canvas formatting is authoritative; OMNY emphasis mirrors visibly heavier ranges. */
export function syncBubbleEmphasisFromStyles(bubble:Bubble):void{
  const base=bubble.text_style?.fontWeight??600;
  const phrases=[...new Set((bubble.text_runs??[])
    .filter(range=>(range.fontWeight??base)>base)
    .map(range=>bubble.text.slice(range.start,range.end).trim())
    .filter(Boolean))];
  if(phrases.length)bubble.emphasis=phrases.join(', ');else delete bubble.emphasis;
}
/** Apply decorations on leaf spans so an explicit off range can cancel its base style. */
export function textInlineStyleCss(style:TextInlineStyle):Record<string,string>{
  return {...(style.fontWeight!==undefined?{fontWeight:String(style.fontWeight)}:{}),fontStyle:style.italic?'italic':'normal',
    textDecorationLine:[style.underline?'underline':'',style.strikethrough?'line-through':''].filter(Boolean).join(' ')||'none',textUnderlinePosition:'under right'};
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
  return {...(font?{fontFamily:bubbleCssFontFamily(font)}:{}),writingMode:style.orientation==='horizontal'?'horizontal-tb':'vertical-rl',textAlign:style.textAlign==='center'?'center':style.textAlign==='right'?'end':'start','--text-tool-cursor':textToolCursor(style),
    ...(style.fontSize?{fontSize:canvasLengthCss(style.fontSize*25.4/72,paperWidthMm)}:{}),
    ...(style.fontWeight?{fontWeight:String(style.fontWeight)}:{}),...(style.italic!==undefined?{fontStyle:style.italic?'italic':'normal'}:{})};
}
