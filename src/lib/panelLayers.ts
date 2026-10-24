import type { Bubble, MangaDocument, Panel } from '../types.ts';
import { useScenarioBubbleText } from './scenario.ts';
import { rebaseTextWeights } from './textStyle.ts';

export interface BubbleTextTarget { pageIndex:number; panelIndex:number; bubbleIndex:number; overlay:boolean }
export const panelVisible = (panel:Panel) => panel.layer?.hidden !== true;
export const panelFrameVisible = (panel:Panel) => panelVisible(panel) && panel.layer?.frameHidden !== true;
export const bubbleVisible = (bubble:Bubble) => bubble.hidden !== true;
export function toggleBubbleVisibility(document:MangaDocument,target:BubbleTextTarget):boolean {
  const bubble=bubbleAt(document,target);if(!bubble)return false;
  bubble.hidden=bubbleVisible(bubble);return true;
}

export function normalizePanelLayer(value:unknown):Panel['layer'] {
  if(!value || typeof value!=='object')return undefined;
  const source=value as Record<string,unknown>;
  return {...(source.hidden===true?{hidden:true}:{}),...(source.frameHidden===true?{frameHidden:true}:{}),...(Array.isArray(source.artOrder)?{artOrder:[...new Set(source.artOrder.filter((v):v is string=>typeof v==='string'&&v.length<128))]}:{})};
}
export function bubbleAt(document:MangaDocument,target:BubbleTextTarget) {
  const page=document.manga.pages[target.pageIndex];
  return (target.overlay?page?.page_overlay:page?.panels[target.panelIndex])?.bubbles?.[target.bubbleIndex];
}
/** Change only the addressed text; retain speaker, OCR source and reading order. */
export function editBubbleText(document:MangaDocument,target:BubbleTextTarget,text:string,edit?:import('./textStyle.ts').TextSelection):boolean {
  const bubble=bubbleAt(document,target);
  if(!bubble || !bubbleVisible(bubble) || (!target.overlay && !panelVisible(document.manga.pages[target.pageIndex].panels[target.panelIndex])))return false;
  if(bubble.text===text)return false;
  rebaseTextWeights(bubble,text,edit);
  if(document.manga.scenario)useScenarioBubbleText(bubble,text);else bubble.text=text;
  if(bubble.analogTextImport)bubble.analogTextImport.referenceHidden=true;
  return true;
}

/** Bottom to top. Reading order and character/bubble indices never change. */
export function panelArtKeys(panel:Panel):string[] {
  const entries=[{key:'background',id:'background'},...(panel.figures??[]).map((f,i)=>({key:`figure-${i}`,id:f.layerId?`figure:${f.layerId}`:`figure-${i}`}))];
  const stored=panel.layer?.artOrder??[];
  return [...entries].sort((a,b)=>{
    const ai=stored.indexOf(a.id),bi=stored.indexOf(b.id);
    return (ai<0?stored.length+entries.indexOf(a):ai)-(bi<0?stored.length+entries.indexOf(b):bi);
  }).map(e=>e.key);
}
export function reorderPanelArt(panel:Panel,key:string,target:string,after:boolean):boolean {
  const order=panelArtKeys(panel),from=order.indexOf(key);
  if(from<0||!order.includes(target)||key===target)return false;
  order.splice(from,1);order.splice(order.indexOf(target)+(after?0:1),0,key);
  const id=(value:string)=>{if(value==='background')return value;const figure=panel.figures![Number(value.slice(7))];figure.layerId??=crypto.randomUUID();return `figure:${figure.layerId}`;};
  panel.layer={...panel.layer,artOrder:order.map(id)};return true;
}
