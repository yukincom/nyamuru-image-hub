import type { BBox, Bubble, Figure, ImageContent, MangaDocument, Panel } from '../types.ts';
import { useScenarioBubbleText } from './scenario.ts';
import { rebaseTextRuns, syncBubbleEmphasisFromStyles } from './textStyle.ts';

export interface BubbleTextTarget { pageIndex:number; panelIndex:number; bubbleIndex:number; overlay:boolean }
export const panelVisible = (panel:Panel) => panel.layer?.hidden !== true;
export const panelFrameVisible = (panel:Panel) => panelVisible(panel) && panel.layer?.frameHidden !== true;
export const panelLocked = (panel:Panel) => panel.layer?.locked === true;
export const panelFrameLocked = (panel:Panel) => panel.layer?.frameLocked === true;
export const panelGeometryLocked = (panel:Panel) => panelLocked(panel) || panelFrameLocked(panel);
export const bubbleVisible = (bubble:Bubble) => bubble.hidden !== true;

function unlockPaintChildren(artwork:ImageContent|undefined):void {
  if(!artwork)return;
  artwork.locked=false;
  for(const layer of artwork.paint?.layers??[])layer.locked=false;
  for(const folder of artwork.paint?.folders??[])folder.locked=false;
}

/** Unlocking the panel folder also unlocks every descendant; child locks never affect the parent. */
export function unlockPanelDescendants(panel:Panel):void {
  if(panel.layer){
    panel.layer.locked=undefined;
    panel.layer.frameLocked=undefined;
    panel.layer.backgroundLocked=undefined;
    panel.layer.directLocked=undefined;
  }
  for(const image of [...(panel.background_images??[]),...(panel.images??[])])unlockPaintChildren(image);
  for(const figure of panel.figures??[]){figure.locked=undefined;unlockPaintChildren(figure.artwork);}
  for(const bubble of panel.bubbles??[]){bubble.locked=undefined;bubble.nativeLocked=undefined;unlockPaintChildren(bubble.paint_overlay);}
}

/** The placement lock also honors owner locks saved by older artwork documents. */
export function ownerItemLocked(item:Figure|Bubble):boolean {
  if(item.locked===true)return true;
  return 'name' in item?false:((item as Bubble).nativeLocked===true||(item as Bubble).paint_overlay?.locked===true);
}

/** Inspector drafts may reorder siblings, but must retain every individually locked item byte-for-byte. */
export function preservesLockedItems<T extends Figure|Bubble>(before:readonly T[]|undefined,after:readonly T[]|undefined):boolean {
  const available=(after??[]).map(item=>JSON.stringify(item));
  for(const item of before??[]){
    if(!ownerItemLocked(item))continue;
    const encoded=JSON.stringify(item),index=available.indexOf(encoded);
    if(index<0)return false;
    available.splice(index,1);
  }
  return true;
}

export interface PanelFrameSegment { x1:number; y1:number; x2:number; y2:number }

export function panelFrameSegments(panel:Panel):PanelFrameSegment[] {
  if(panel.shape.type==='polygon')return panel.shape.points.flatMap(([x1,y1],index,points)=>{
    const next=points[(index+1)%points.length];
    return next?[{x1,y1,x2:next[0],y2:next[1]}]:[];
  });
  const {x,y,w,h}=panel.shape,bleed=panel.bleed??[];
  return [
    !bleed.includes('top')&&{x1:x,y1:y,x2:x+w,y2:y},
    !bleed.includes('right')&&{x1:x+w,y1:y,x2:x+w,y2:y+h},
    !bleed.includes('bottom')&&{x1:x+w,y1:y+h,x2:x,y2:y+h},
    !bleed.includes('left')&&{x1:x,y1:y+h,x2:x,y2:y},
  ].filter((segment):segment is PanelFrameSegment=>Boolean(segment));
}

/** Return only the visible frame portions that coincide with the dashed inner-frame guide. */
export function panelFrameSegmentsOnInnerFrame(panel:Panel,inner:BBox,epsilon=.02):PanelFrameSegment[] {
  const near=(a:number,b:number)=>Math.abs(a-b)<=epsilon;
  const horizontal=(segment:PanelFrameSegment,y:number):PanelFrameSegment|undefined=>{
    if(!near(segment.y1,y)||!near(segment.y2,y))return;
    const x1=Math.max(inner.x,Math.min(segment.x1,segment.x2)),x2=Math.min(inner.x+inner.w,Math.max(segment.x1,segment.x2));
    return x2-x1>epsilon?{x1,y1:(segment.y1+segment.y2)/2,x2,y2:(segment.y1+segment.y2)/2}:undefined;
  };
  const vertical=(segment:PanelFrameSegment,x:number):PanelFrameSegment|undefined=>{
    if(!near(segment.x1,x)||!near(segment.x2,x))return;
    const y1=Math.max(inner.y,Math.min(segment.y1,segment.y2)),y2=Math.min(inner.y+inner.h,Math.max(segment.y1,segment.y2));
    return y2-y1>epsilon?{x1:(segment.x1+segment.x2)/2,y1,x2:(segment.x1+segment.x2)/2,y2}:undefined;
  };
  return panelFrameSegments(panel).flatMap(segment=>[
    horizontal(segment,inner.y),horizontal(segment,inner.y+inner.h),
    vertical(segment,inner.x),vertical(segment,inner.x+inner.w),
  ].filter((entry):entry is PanelFrameSegment=>Boolean(entry)));
}

export function toggleBubbleVisibility(document:MangaDocument,target:BubbleTextTarget,group=false):boolean {
  const bubble=bubbleAt(document,target);if(!bubble)return false;
  const page=document.manga.pages[target.pageIndex],images=target.overlay?page.images:page.panels[target.panelIndex]?.images;
  const original=images?.find(image=>image.id===bubble.analogTextImport?.originalImageId);
  const visible=group?(bubbleVisible(bubble)||Boolean(original&&!original.hidden&&(!original.paint||original.paint.layers.some(layer=>layer.visible)))):bubbleVisible(bubble);
  bubble.hidden=visible;
  if(group){
    if(bubble.paint_overlay){bubble.paint_overlay.hidden=false;for(const layer of bubble.paint_overlay.paint?.layers??[])layer.visible=!visible;}
    if(original){original.hidden=original.paint?false:visible;for(const layer of original.paint?.layers??[])layer.visible=!visible;}
  }
  return true;
}

export function normalizePanelLayer(value:unknown):Panel['layer'] {
  if(!value || typeof value!=='object')return undefined;
  const source=value as Record<string,unknown>;
  return {...(source.hidden===true?{hidden:true}:{}),...(source.frameHidden===true?{frameHidden:true}:{}),...(source.locked===true?{locked:true}:{}),...(source.frameLocked===true?{frameLocked:true}:{}),...(source.backgroundLocked===true?{backgroundLocked:true}:{}),...(source.directLocked===true?{directLocked:true}:{}),...(Array.isArray(source.artOrder)?{artOrder:[...new Set(source.artOrder.filter((v):v is string=>typeof v==='string'&&v.length<128))]}:{})};
}
export function bubbleAt(document:MangaDocument,target:BubbleTextTarget) {
  const page=document.manga.pages[target.pageIndex];
  return (target.overlay?page?.page_overlay:page?.panels[target.panelIndex])?.bubbles?.[target.bubbleIndex];
}
/** Change only the addressed text; retain speaker, OCR source and reading order. */
export function editBubbleText(document:MangaDocument,target:BubbleTextTarget,text:string,edit?:import('./textStyle.ts').TextSelection,origin:'manual'|'agent'='manual',insertionStyle?:import('../types.ts').TextInlineStyle):boolean {
  const bubble=bubbleAt(document,target);
  const panel=!target.overlay?document.manga.pages[target.pageIndex].panels[target.panelIndex]:undefined;
  if(!bubble || origin==='manual'&&ownerItemLocked(bubble) || !bubbleVisible(bubble) || (!target.overlay && (!panel||!panelVisible(panel)||origin==='manual'&&panelLocked(panel))))return false;
  if(bubble.text===text)return false;
  rebaseTextRuns(bubble,text,edit,insertionStyle);
  if(document.manga.scenario)useScenarioBubbleText(bubble,text);else bubble.text=text;
  syncBubbleEmphasisFromStyles(bubble);
  if(bubble.analogTextImport)bubble.analogTextImport.needsReview=false;
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
