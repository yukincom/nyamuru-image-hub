import type { PaintLayerDropTarget } from './layerTree.ts';
import type { PaintStackPosition, Panel, PlacedImage, MangaPage } from '../../types.ts';

export interface PaintAddPosition { target?:PaintLayerDropTarget; stack?:PaintStackPosition; aboveNative?:boolean }

export const paintStackKey=(stack?:PaintStackPosition):string=>stack?('below' in stack?`below:${stack.below}`:`panel:${stack.beforePanel}`):'';

export const directPaintOwnerKey=(scope:'panel'|'page',stack?:PaintStackPosition):string=>stack?`${scope}:${paintStackKey(stack)}`:scope;

/** Native keys are UI positions; saved sibling positions refer to persistent identities. */
export function paintAnchorIds(panel:Pick<Panel,'figures'|'bubbles'|'screen_text'|'images'>,panels?:Panel[]):Record<string,string> {
  const ids:Record<string,string>={background:'background'};
  for(const [kind,items] of [['figure',panel.figures],['bubble',panel.bubbles],['screen-text',panel.screen_text]] as const)
    items?.forEach((item,index)=>{ids[`${kind}-${index}`]=item.layerId??'';});
  panel.images?.filter(image=>image.bubbleOriginal).forEach(image=>{ids[`original-${image.id}`]=image.id;});
  panels?.forEach(panel=>{ids[`panel-${panel.id}`]=panel.layerId??'';});
  return ids;
}

export function paintStackTarget(stack:PaintStackPosition|undefined,ids:Record<string,string>={}):string|undefined {
  if(!stack)return;
  const value='below' in stack?stack.below:stack.beforePanel;
  if(value.startsWith('layer:'))return Object.keys(ids).find(key=>ids[key]===value.slice(6)&&('below' in stack?!key.startsWith('panel-'):key.startsWith('panel-')));
  return value in ids?value:undefined;
}

export function paintStackMatches(stack:PaintStackPosition|undefined,target:PaintStackPosition|undefined,ids:Record<string,string>={}):boolean {
  const key=paintStackTarget(stack,ids),wanted=target?paintStackTarget(target,ids):undefined;
  return target?key!==undefined&&key===wanted:key===undefined;
}

/** Match the scene's bottom-to-top root order, including artwork whose anchor was removed. */
export function directPaintImages(images:PlacedImage[]|undefined,scope:'panel'|'page',stack:PaintStackPosition|undefined,ids:Record<string,string>={}):PlacedImage[] {
  return (images??[]).filter(image=>image.paintScope===scope&&paintStackMatches(image.paintStack,stack,ids))
    .sort((a,b)=>Number(!a.paintStack)-Number(!b.paintStack));
}

export function applyPaintAnchorIds(page:MangaPage,panelIndex:number,overlay:boolean,ids:Record<string,string>|undefined):void {
  const source=overlay?page.page_overlay:page.panels[panelIndex];
  for(const [key,id] of Object.entries(ids??{})){
    if(!id)continue;
    const match=/^(figure|bubble|screen-text|panel)-(\d+)$/.exec(key);if(!match)continue;
    const index=Number(match[2]);
    const item=match[1]==='panel'?page.panels.find(panel=>panel.id===index):match[1]==='figure'?source?.figures?.[index]:match[1]==='bubble'?source?.bubbles?.[index]:source?.screen_text?.[index];
    if(item)item.layerId=id;
  }
}
