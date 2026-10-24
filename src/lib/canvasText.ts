import type { MangaDocument } from '../types.ts';
import { fallbackBox } from './canvasGeometry.ts';
import { editBubbleText, panelVisible } from './panelLayers.ts';
import { artworkLocked } from './paintLock.ts';
import { replaceBubbleMaterial } from './bubblePresetData.ts';
import { rebaseTextWeights, updateTextStyle, type TextSelection, type TextStylePatch } from './textStyle.ts';
export type CanvasTextKind='bubble'|'screen_text';
export interface CanvasTextTarget {pageIndex:number;panelIndex:number;index:number;overlay:boolean;kind:CanvasTextKind}
export function canvasTextAt(document:MangaDocument,t:CanvasTextTarget){
  const page=document.manga.pages[t.pageIndex];
  if(t.kind==='screen_text')return t.overlay?undefined:page?.panels[t.panelIndex]?.screen_text?.[t.index];
  return (t.overlay?page?.page_overlay:page?.panels[t.panelIndex])?.bubbles?.[t.index];
}
export function editCanvasText(document:MangaDocument,t:CanvasTextTarget,text:string,edit?:TextSelection){
  if(!canvasTextEditable(document,t))return false;
  if(t.kind==='bubble')return editBubbleText(document,{...t,bubbleIndex:t.index},text,edit);
  const panel=document.manga.pages[t.pageIndex]?.panels[t.panelIndex],item=canvasTextAt(document,t);
  if(!panel||!panelVisible(panel)||!item||item.text===text)return false;
  rebaseTextWeights(item,text,edit);item.text=text;return true;
}
export function canvasTextEditable(document:MangaDocument,t:CanvasTextTarget){
  const item=canvasTextAt(document,t);
  if(!item||(!t.overlay&&!panelVisible(document.manga.pages[t.pageIndex].panels[t.panelIndex])))return false;
  return t.kind!=='bubble'||!('hidden' in item&&item.hidden===true)&&!artworkLocked('paint_overlay' in item?item.paint_overlay:undefined);
}
export function editCanvasTextStyle(document:MangaDocument,t:CanvasTextTarget,patch:TextStylePatch,selection?:TextSelection){
  if(!canvasTextEditable(document,t))return false;
  const item=canvasTextAt(document,t)!;updateTextStyle(item,t.kind,patch,selection);return true;
}
export function editCanvasBubbleMaterial(document:MangaDocument,t:CanvasTextTarget,id:string){
  if(t.kind!=='bubble'||!canvasTextEditable(document,t))return false;
  replaceBubbleMaterial(canvasTextAt(document,t)!,id);return true;
}
/** Use the same native objects as imported/generated panels, never a paint bitmap. */
export function addCanvasText(document:MangaDocument,pageIndex:number,panelIndex:number,kind:CanvasTextKind):CanvasTextTarget|null{
  const panel=document.manga.pages[pageIndex]?.panels[panelIndex];
  if(!panel||!panelVisible(panel))return null;
  const index=kind==='bubble'?panel.bubbles.length:(panel.screen_text?.length??0);
  if(kind==='bubble')panel.bubbles.push({text:'',shape:'normal',bbox:fallbackBox(panel,'bubble',index)});
  else (panel.screen_text??=[]).push({text:'',orientation:'horizontal',bbox:fallbackBox(panel,'screen_text',index)});
  return {pageIndex,panelIndex,index,overlay:false,kind};
}
