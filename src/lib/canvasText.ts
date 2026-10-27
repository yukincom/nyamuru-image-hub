import type { BBox, Bubble, MangaDocument, ScreenText, TextStyle } from '../types.ts';
import { clamp, fallbackBox, panelBounds } from './canvasGeometry.ts';
import { ownerItemLocked, editBubbleText, panelLocked, panelVisible } from './panelLayers.ts';
import { BUBBLE_MATERIALS, replaceBubbleMaterial } from './bubblePresetData.ts';
import { removeBubbleAt } from './bubbleConnections.ts';
import { overlayFallbackBox, overlayTextFallbackBox } from './pageCanvas.ts';
import { rebaseTextWeights, syncBubbleEmphasisFromWeights, textStyleOf, updateTextStyle, type TextSelection, type TextStylePatch } from './textStyle.ts';
import { cloneDocument } from './manga.ts';
export type CanvasTextKind='bubble'|'screen_text';
export interface CanvasTextTarget {pageIndex:number;panelIndex:number;index:number;overlay:boolean;kind:CanvasTextKind}
const pointMm=(pt:number)=>pt*25.4/72;
const textUnits=(value:string)=>[...value].reduce((sum,character)=>sum+(/[\u0000-\u00ff]/u.test(character)?.62:1),0);

/**
 * Change the default used by newly-created/inherited text without restyling
 * text that is already on a page. Existing inherited items first receive the
 * previous default explicitly, so this operation never changes a whole spread.
 */
export function changeCanvasDefaultFont(document:MangaDocument,font:string):boolean {
  const next=font.trim();
  if(!next)throw new Error('基本書体を指定してください');
  const previous=document.manga.meta.font?.trim()||'アンチック体';
  if(next===previous)return false;
  for(const page of document.manga.pages){
    const owners=[...page.panels,...(page.page_overlay?[page.page_overlay]:[])];
    for(const owner of owners){
      for(const item of [...(owner.bubbles??[]),...(owner.screen_text??[])]){
        if(!item.text_style?.font)item.text_style={...item.text_style,font:previous};
      }
    }
  }
  document.manga.meta.font=next;
  return true;
}
export function canvasTextAt(document:MangaDocument,t:CanvasTextTarget){
  const page=document.manga.pages[t.pageIndex];
  if(t.kind==='screen_text')return (t.overlay?page?.page_overlay:page?.panels[t.panelIndex])?.screen_text?.[t.index];
  return (t.overlay?page?.page_overlay:page?.panels[t.panelIndex])?.bubbles?.[t.index];
}
export function editCanvasText(document:MangaDocument,t:CanvasTextTarget,text:string,edit?:TextSelection,origin:'manual'|'agent'='manual'){
  if(!canvasTextEditable(document,t,origin))return false;
  if(t.kind==='bubble'){
    const changed=editBubbleText(document,{...t,bubbleIndex:t.index},text,edit,origin);
    if(changed)fitCanvasBubbleToText(document,t,origin);
    return changed;
  }
  const panel=document.manga.pages[t.pageIndex]?.panels[t.panelIndex],item=canvasTextAt(document,t) as ScreenText|undefined;
  if((!t.overlay&&(!panel||!panelVisible(panel)))||!item||item.text===text)return false;
  const start=screenTextStart(item);
  rebaseTextWeights(item,text,edit);item.text=text;fitCanvasScreenTextToText(document,t,start,origin);return true;
}
export function canvasTextEditable(document:MangaDocument,t:CanvasTextTarget,origin:'manual'|'agent'='manual'){
  const item=canvasTextAt(document,t);
  const panel=!t.overlay?document.manga.pages[t.pageIndex]?.panels[t.panelIndex]:undefined;
  if(!item||item.hidden===true||(!t.overlay&&(!panel||!panelVisible(panel)||origin==='manual'&&panelLocked(panel))))return false;
  return t.kind!=='bubble'||origin==='agent'||!ownerItemLocked(item as Bubble);
}
/** Visibility is a saved document edit; it never changes folder expansion or text geometry. */
export function toggleCanvasTextVisibility(document:MangaDocument,t:CanvasTextTarget):boolean {
  const item=canvasTextAt(document,t);if(!item)return false;
  item.hidden=item.hidden!==true;return true;
}
/** Return the same document on a no-op; clone the work only after a real edit. */
export function editCanvasTextStyle(document:MangaDocument,t:CanvasTextTarget,patch:TextStylePatch,selection?:TextSelection):MangaDocument{
  if(!canvasTextEditable(document,t))return document;
  const updated={...canvasTextAt(document,t)!};
  if(!updateTextStyle(updated,t.kind,patch,selection))return document;
  const next=cloneDocument(document),item=canvasTextAt(next,t)!;
  const origin=t.kind==='screen_text'?screenTextStart(item as ScreenText):undefined;
  item.text_style=updated.text_style;
  if(updated.text_weights)item.text_weights=updated.text_weights;else delete item.text_weights;
  if(t.kind==='screen_text')(item as ScreenText).orientation=(updated as ScreenText).orientation;
  if(t.kind==='bubble'&&patch.fontWeight!==undefined)syncBubbleEmphasisFromWeights(item as Bubble);
  // A font, weight, size or orientation change is a text-only operation.
  // In particular, never recenter/expand the surrounding bubble as a side
  // effect: its authored bbox and text_position must remain byte-for-byte.
  if(t.kind==='screen_text')fitCanvasScreenTextToText(next,t,origin);
  return next;
}
export function editCanvasBubbleMaterial(document:MangaDocument,t:CanvasTextTarget,id:string){
  if(t.kind!=='bubble'||!canvasTextEditable(document,t))return false;
  replaceBubbleMaterial(canvasTextAt(document,t)!,id);fitCanvasBubbleToText(document,t);return true;
}
/** Use the same native objects as imported/generated panels, never a paint bitmap. */
export function addCanvasText(document:MangaDocument,pageIndex:number,panelIndex:number,kind:CanvasTextKind,style?:TextStyle):CanvasTextTarget|null{
  const panel=document.manga.pages[pageIndex]?.panels[panelIndex];
  if(!panel||!panelVisible(panel)||panelLocked(panel))return null;
  const index=kind==='bubble'?panel.bubbles.length:(panel.screen_text?.length??0);
  if(kind==='bubble')panel.bubbles.push({text:'',shape:'normal',bbox:fallbackBox(panel,'bubble',index)});
  else (panel.screen_text??=[]).push({text:'',orientation:style?.orientation??'vertical',text_style:{fontSize:12,...style},bbox:fallbackBox(panel,'screen_text',index)});
  return {pageIndex,panelIndex,index,overlay:false,kind};
}

function centeredBox(bounds:BBox,point:{x:number;y:number},size:{w:number;h:number}):BBox {
  const w=Math.min(size.w,bounds.w),h=Math.min(size.h,bounds.h);
  return {x:clamp(point.x-w/2,bounds.x,bounds.x+bounds.w-w),y:clamp(point.y-h/2,bounds.y,bounds.y+bounds.h-h),w,h};
}

function screenTextStart(item:ScreenText,box=item.bbox):{x:number;y:number}|undefined {
  if(!box)return;
  const vertical=textStyleOf(item,'screen_text').orientation==='vertical';
  return {x:vertical?box.x+box.w:box.x,y:box.y};
}

/** A point-text box starts at the click: vertical columns grow left, horizontal lines grow down. */
function pointTextBox(bounds:BBox,point:{x:number;y:number},size:{w:number;h:number},vertical:boolean):BBox {
  const edge=.01,right=bounds.x+bounds.w,bottom=bounds.y+bounds.h;
  const start={x:clamp(point.x,bounds.x+Math.min(edge,bounds.w),right-Math.min(edge,bounds.w)),y:clamp(point.y,bounds.y,bottom-Math.min(edge,bounds.h))};
  if(vertical){
    const w=Math.min(size.w,start.x-bounds.x),h=Math.min(size.h,bottom-start.y);
    return {x:start.x-w,y:start.y,w:Math.max(edge,w),h:Math.max(edge,h)};
  }
  const w=Math.min(size.w,right-start.x),h=Math.min(size.h,bottom-start.y);
  return {x:start.x,y:start.y,w:Math.max(edge,w),h:Math.max(edge,h)};
}

export function screenTextMinimumSize(item:Pick<ScreenText,'text'|'text_style'|'orientation'>):{w:number;h:number} {
  const style=textStyleOf(item as ScreenText,'screen_text'),fontMm=pointMm(style.fontSize??12),lines=(item.text||' ').split('\n');
  const lineCount=Math.max(1,lines.length),longest=Math.max(1,...lines.map(textUnits)),lineAdvance=fontMm*1.15,safety=Math.max(.4,fontMm*.08);
  return style.orientation==='vertical'
    ? {w:lineCount*lineAdvance+safety,h:longest*fontMm+safety}
    : {w:longest*fontMm+safety,h:lineCount*lineAdvance+safety};
}

export function fitCanvasScreenTextToText(document:MangaDocument,target:CanvasTextTarget,origin?:{x:number;y:number},operation:'manual'|'agent'='manual'):boolean {
  if(target.kind!=='screen_text')return false;
  const page=document.manga.pages[target.pageIndex],item=canvasTextAt(document,target) as ScreenText|undefined;
  const panel=!target.overlay?page?.panels[target.panelIndex]:undefined;
  if(!page||!item||item.hidden===true||(!target.overlay&&(!panel||!panelVisible(panel)||operation==='manual'&&panelLocked(panel))))return false;
  const source=item.bbox??(target.overlay?overlayTextFallbackBox(page.canvas,target.index):fallbackBox(panel!,'screen_text',target.index));
  const start=origin??screenTextStart(item,source)!;
  const bounds=target.overlay?{x:0,y:0,w:page.canvas.w,h:page.canvas.h}:panelBounds(panel!);
  const fitted=pointTextBox(bounds,start,screenTextMinimumSize(item),textStyleOf(item,'screen_text').orientation==='vertical');
  if(['x','y','w','h'].every(key=>Math.abs(fitted[key as keyof BBox]-source[key as keyof BBox])<1e-6))return false;
  item.bbox=fitted;return true;
}

/** Tツールのクリック位置へ、保存可能な通常文字を置く。 */
export function addCanvasTextAt(document:MangaDocument,pageIndex:number,panelIndex:number|null,point:{x:number;y:number},style?:TextStyle):CanvasTextTarget|null {
  const page=document.manga.pages[pageIndex];
  if(!page)return null;
  if(panelIndex===null){
    const overlay=page.page_overlay??={frame:false,layer:'above_panel_frames'};
    const index=overlay.screen_text?.length??0;
    const item:ScreenText={text:'',orientation:style?.orientation??'vertical',text_style:{fontSize:12,...style}};
    item.bbox=pointTextBox({x:0,y:0,w:page.canvas.w,h:page.canvas.h},point,screenTextMinimumSize(item),item.orientation==='vertical');
    (overlay.screen_text??=[]).push(item);
    return {pageIndex,panelIndex:0,index,overlay:true,kind:'screen_text'};
  }
  const panel=page.panels[panelIndex];
  if(!panel||!panelVisible(panel)||panelLocked(panel))return null;
  const index=panel.screen_text?.length??0;
  const item:ScreenText={text:'',orientation:style?.orientation??'vertical',text_style:{fontSize:12,...style}};
  item.bbox=pointTextBox(panelBounds(panel),point,screenTextMinimumSize(item),item.orientation==='vertical');
  (panel.screen_text??=[]).push(item);
  return {pageIndex,panelIndex,index,overlay:false,kind:'screen_text'};
}

export function removeCanvasText(document:MangaDocument,target:CanvasTextTarget):boolean {
  const page=document.manga.pages[target.pageIndex];
  if(target.kind==='bubble'?!canvasTextEditable(document,target):!target.overlay&&(!page?.panels[target.panelIndex]||!panelVisible(page.panels[target.panelIndex])||panelLocked(page.panels[target.panelIndex])))return false;
  const owner=target.overlay?page?.page_overlay:page?.panels[target.panelIndex];
  const items=target.kind==='bubble'?owner?.bubbles:owner?.screen_text;
  if(!items||target.index<0||target.index>=items.length)return false;
  if(target.kind==='bubble')removeBubbleAt(items as Bubble[],target.index);
  else items.splice(target.index,1);
  if(target.kind==='screen_text'&&!owner?.screen_text?.length)delete owner!.screen_text;
  if(target.overlay&&page.page_overlay&&!page.page_overlay.figures?.length&&!page.page_overlay.bubbles?.length&&!page.page_overlay.screen_text?.length)delete page.page_overlay;
  return true;
}

const bubbleTextFractions=(shape:Bubble['shape']):{w:number;h:number}=>{
  if(shape==='thought')return {w:.66,h:.69};
  if(shape==='square'||shape==='caption')return {w:.78,h:.82};
  if(shape==='flash'||shape==='uniflash')return {w:.56,h:.56};
  if(shape==='wobbly')return {w:.70,h:.76};
  if(shape==='whisper')return {w:.68,h:.73};
  if(shape==='handwritten')return {w:.60,h:.60};
  return {w:.72,h:.75};
};
/** Point-text geometry: only authored newlines make a new row or column. */
export function bubbleTextMinimumSize(bubble:Pick<Bubble,'text'|'text_style'|'shape'>):{w:number;h:number} {
  const fontMm=pointMm(bubble.text_style?.fontSize??15),lines=(bubble.text||' ').split('\n');
  const columns=Math.max(1,lines.length),longest=Math.max(1,...lines.map(textUnits));
  const vertical=(bubble.text_style?.orientation??'vertical')!=='horizontal';
  const textW=vertical?columns*fontMm*1.12:longest*fontMm;
  const textH=vertical?longest*fontMm:columns*fontMm*1.12;
  const inner=bubbleTextFractions(bubble.shape),safety=Math.max(1.2,fontMm*.35);
  return {w:textW/inner.w+safety,h:textH/inner.h+safety};
}
function fittedBubbleBox(bubble:Pick<Bubble,'text'|'text_style'|'shape'>,source:BBox,bounds:BBox,expandOnly:boolean):BBox {
  const minimum=bubbleTextMinimumSize(bubble);
  return centeredBox(bounds,{x:source.x+source.w/2,y:source.y+source.h/2},{
    w:expandOnly?Math.max(source.w,minimum.w):minimum.w,
    h:expandOnly?Math.max(source.h,minimum.h):minimum.h,
  });
}
function bubbleFitBounds(document:MangaDocument,target:CanvasTextTarget):BBox|null {
  const page=document.manga.pages[target.pageIndex];if(!page)return null;
  if(target.overlay)return {x:0,y:0,w:page.canvas.w,h:page.canvas.h};
  const panel=page.panels[target.panelIndex];if(!panel)return null;
  return panelBounds(panel);
}
export function fitCanvasBubbleToText(document:MangaDocument,target:CanvasTextTarget,origin:'manual'|'agent'='manual'):boolean {
  if(target.kind!=='bubble')return false;
  if(!canvasTextEditable(document,target,origin))return false;
  const page=document.manga.pages[target.pageIndex],bubble=canvasTextAt(document,target) as Bubble|undefined;
  const bounds=bubble&&bubbleFitBounds(document,target);
  if(!page||!bubble||!bounds||!bubble.text.trim()||bubble.hidden===true||bubble.paint_overlay)return false;
  const panel=page.panels[target.panelIndex];
  const source=bubble.bbox??(target.overlay?overlayFallbackBox(page.canvas,'bubble',target.index):fallbackBox(panel,'bubble',target.index));
  const fitted=fittedBubbleBox(bubble,source,bounds,true);
  if(['x','y','w','h'].every(key=>Math.abs(fitted[key as keyof BBox]-source[key as keyof BBox])<1e-6))return false;
  bubble.bbox=fitted;return true;
}
export interface ScreenTextBubbleConversion {
  screenText:CanvasTextTarget;
  bubble?:CanvasTextTarget;
  materialId?:string;
}

/** 通常文字を白いネイティブ吹き出しへ一度だけ取り込み、その瞬間だけ寸法を合わせる。 */
export function convertScreenTextToBubble(document:MangaDocument,request:ScreenTextBubbleConversion):CanvasTextTarget|null {
  const source=request.screenText;
  if(source.kind!=='screen_text'||!canvasTextEditable(document,source))return null;
  const page=document.manga.pages[source.pageIndex],sourceOwner=source.overlay?page?.page_overlay:page?.panels[source.panelIndex];
  const screen=sourceOwner?.screen_text?.[source.index];
  if(!page||!sourceOwner||!screen)return null;
  const targetOwner=request.bubble?.overlay?page.page_overlay:request.bubble?page.panels[request.bubble.panelIndex]:sourceOwner;
  if(!targetOwner)return null;
  if(request.bubble&&!canvasTextEditable(document,request.bubble))return null;
  const preset=request.materialId?BUBBLE_MATERIALS.find(item=>item.id===request.materialId):undefined;
  if(request.materialId&&!preset)return null;
  let bubble:Bubble|undefined,bubbleIndex=-1;
  if(request.bubble){
    bubble=targetOwner.bubbles?.[request.bubble.index];bubbleIndex=request.bubble.index;
    if(!bubble||bubble.text.trim()||bubble.analogTextImport||bubble.paint_overlay)return null;
  }else{
    bubble={text:'',shape:preset?.shape??'normal'};
    (targetOwner.bubbles??=[]).push(bubble);bubbleIndex=targetOwner.bubbles.length-1;
  }
  const bounds=request.bubble?.overlay||(!request.bubble&&source.overlay)?{x:0,y:0,w:page.canvas.w,h:page.canvas.h}:panelBounds(page.panels[request.bubble?.panelIndex??source.panelIndex]);
  bubble.text=screen.text;
  bubble.text_style={...screen.text_style,orientation:screen.text_style?.orientation??screen.orientation??'horizontal',fontSize:screen.text_style?.fontSize??15};
  if(screen.text_weights?.length)bubble.text_weights=structuredClone(screen.text_weights);else delete bubble.text_weights;
  syncBubbleEmphasisFromWeights(bubble);
  const sourceBox=screen.bbox??{x:bounds.x+bounds.w/2,y:bounds.y+bounds.h/2,w:0,h:0};
  bubble.bbox=fittedBubbleBox(bubble,sourceBox,bounds,false);
  if(request.materialId&&preset){bubble.shape=preset.shape;replaceBubbleMaterial(bubble,request.materialId);}
  sourceOwner.screen_text!.splice(source.index,1);if(!sourceOwner.screen_text!.length)delete sourceOwner.screen_text;
  return {pageIndex:source.pageIndex,panelIndex:request.bubble?.panelIndex??source.panelIndex,index:bubbleIndex,overlay:request.bubble?.overlay??source.overlay,kind:'bubble'};
}

export function screenTextCoveredByBubble(document:MangaDocument,bubbleTarget:CanvasTextTarget):CanvasTextTarget|null {
  if(bubbleTarget.kind!=='bubble')return null;
  const page=document.manga.pages[bubbleTarget.pageIndex],owner=bubbleTarget.overlay?page?.page_overlay:page?.panels[bubbleTarget.panelIndex];
  const bubble=owner?.bubbles?.[bubbleTarget.index],box=bubble?.bbox;
  if(!page||!owner||!bubble||!box||bubble.text.trim()||bubble.analogTextImport||bubble.paint_overlay)return null;
  let best:{index:number;area:number}|undefined;
  for(const [index,text] of (owner.screen_text??[]).entries()){
    if(text.hidden===true)continue;
    const b=text.bbox;if(!b)continue;const cx=b.x+b.w/2,cy=b.y+b.h/2;
    if(cx<box.x||cx>box.x+box.w||cy<box.y||cy>box.y+box.h)continue;
    const area=Math.max(0,Math.min(box.x+box.w,b.x+b.w)-Math.max(box.x,b.x))*Math.max(0,Math.min(box.y+box.h,b.y+b.h)-Math.max(box.y,b.y));
    if(!best||area>best.area)best={index,area};
  }
  return best?{pageIndex:bubbleTarget.pageIndex,panelIndex:bubbleTarget.panelIndex,index:best.index,overlay:bubbleTarget.overlay,kind:'screen_text'}:null;
}
