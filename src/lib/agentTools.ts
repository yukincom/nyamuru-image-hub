import type {BBox, Bubble, BubbleShape, CanvasElementSelection, MangaDocument,VectorNode} from '../types.ts';
import {canvasTextAt,canvasTextEditable,type CanvasTextTarget} from './canvasText.ts';
import {panelVisible} from './panelLayers.ts';
import {fallbackBox} from './canvasGeometry.ts';
import {overlayFallbackBox} from './pageCanvas.ts';
import {BUBBLE_BEZIER_PRESETS,createBubbleBezier,isBubbleBezier} from './bubbleBezier.ts';
import {BUBBLE_MATERIALS,materialBubbleBezier,setBubbleShape} from './bubblePresetData.ts';
import {resolveBubbleSpeakerFigureIndex} from './bubbleRelations.ts';
import {paintReferenceBox} from './paintDocument.ts';
import {bubbleTailDisabled,bubbleTailTargetPoint,normalizedBubbleTailTarget} from './bubbleTail.ts';
import {isPropPlacement} from './catalogModel.ts';
import {BUBBLE_SHAPES} from './manga.ts';

export const AGENT_BUBBLE_SHAPES:readonly BubbleShape[]=BUBBLE_SHAPES;
export type AgentBubbleTarget=CanvasTextTarget & {kind:'bubble'};
export interface AgentBubbleEdit {revision:string;target:AgentBubbleTarget;changes:{preset?:typeof BUBBLE_BEZIER_PRESETS[number][0];shape?:BubbleShape;bezier?:NonNullable<Bubble['bezier']>;node_updates?:(Partial<VectorNode>&{index:number})[];bbox?:BBox;tail_mode?:'auto'|'none';tail_point?:{x:number;y:number}}}

const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('編集の指定はオブジェクトにしてください');
  return value as Record<string,unknown>;
};
function keys(value:Record<string,unknown>,allowed:string[]){if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error('未対応の編集項目があります');}
function point(value:unknown){const p=object(value);keys(p,['x','y']);if(!['x','y'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])))throw Error('座標は有限の数値で指定してください');}
export function parseAgentBubbleEdit(value:unknown):AgentBubbleEdit{
  const v=object(value);keys(v,['revision','target','changes']);
  if(typeof v.revision!=='string'||!/^r\d+$/.test(v.revision))throw Error('JSONの最上位に revision, target, changes を並べてください。revisionとtargetはchangesの中に入れず、editor_inspectの値をそのまま指定してください');
  const t=object(v.target);keys(t,['pageIndex','panelIndex','index','overlay','kind']);
  if(!['pageIndex','panelIndex','index'].every(k=>Number.isSafeInteger(t[k])&&(t[k] as number)>=0)||t.kind!=='bubble'||typeof t.overlay!=='boolean')throw Error('選択中のフキダシのtargetを指定してください');
  const c=object(v.changes);keys(c,['preset','shape','bezier','node_updates','bbox','tail_mode','tail_point']);
  if(!Object.keys(c).length)throw Error('変更する項目を指定してください');
  if(['preset','bezier','node_updates'].filter(k=>k in c).length>1)throw Error('輪郭はpreset・bezier・node_updatesのいずれか一つで指定してください');
  if('preset' in c&&!BUBBLE_BEZIER_PRESETS.some(([preset])=>preset===c.preset))throw Error('輪郭のプリセットがありません');
  if('shape' in c&&!AGENT_BUBBLE_SHAPES.includes(c.shape as BubbleShape))throw Error('未対応の吹き出し種類です');
  if('bezier' in c){
    const b=object(c.bezier);keys(b,['nodes']);
    if(!isBubbleBezier(b))throw Error('ベジェは3〜128点、点と制御点は有限の座標で指定してください');
    for(const node of b.nodes){keys(object(node),['x','y','handleIn','handleOut']);for(const h of ['handleIn','handleOut'] as const)if(node[h])point(node[h]);}
  }
  if('node_updates' in c){
    if(!Array.isArray(c.node_updates)||!c.node_updates.length||c.node_updates.length>64)throw Error('node_updatesは変更する点の配列で指定してください');
    const indices=new Set<number>();
    for(const raw of c.node_updates){
      const n=object(raw);keys(n,['index','x','y','handleIn','handleOut']);
      if(!Number.isSafeInteger(n.index)||(n.index as number)<0||(n.index as number)>63||indices.has(n.index as number)||Object.keys(n).length<2)throw Error('変更する点のindexを重複なく指定してください');
      indices.add(n.index as number);
      for(const k of ['x','y'])if(k in n&&(typeof n[k]!=='number'||!Number.isFinite(n[k])))throw Error('点の座標は有限の数値で指定してください');
      for(const h of ['handleIn','handleOut'])if(h in n)point(n[h]);
    }
  }
  if('bbox' in c){const b=object(c.bbox);keys(b,['x','y','w','h']);if(!['x','y','w','h'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k]))||(b.w as number)<=0||(b.h as number)<=0)throw Error('bboxは正の幅・高さを持つ紙面mm座標で指定してください');}
  if('tail_mode' in c&&!['auto','none'].includes(c.tail_mode as string))throw Error('tail_modeはautoまたはnoneを指定してください');
  if('tail_point' in c)point(c.tail_point);
  if('tail_mode' in c&&'tail_point' in c)throw Error('tail_modeとtail_pointは同時に指定できません');
  return structuredClone(v) as unknown as AgentBubbleEdit;
}

export function selectedAgentBubble(pageIndex:number,panelIndex:number,selection:CanvasElementSelection|null):AgentBubbleTarget|null{
  return selection?.type==='bubble'?{pageIndex,panelIndex:selection.scope==='page_overlay'?0:panelIndex,index:selection.index,kind:'bubble',overlay:selection.scope==='page_overlay'}:null;
}
function bubbleContext(document:MangaDocument,target:AgentBubbleTarget){
  const page=document.manga.pages[target.pageIndex];
  const owner=target.overlay?page?.page_overlay:page?.panels[target.panelIndex];
  const bubble=canvasTextAt(document,target) as Bubble|undefined;
  if(!page||!owner||!bubble)throw Error('選択中のフキダシが見つかりません');
  const bbox=bubble.bbox??(target.overlay?overlayFallbackBox(page.canvas,'bubble',target.index):fallbackBox(page.panels[target.panelIndex],'bubble',target.index));
  const figureIndex=resolveBubbleSpeakerFigureIndex(owner,bubble),figure=figureIndex===null?undefined:owner.figures?.[figureIndex];
  const figureBox=figure?(figure.bbox??(target.overlay?overlayFallbackBox(page.canvas,'figure',figureIndex!):fallbackBox(page.panels[target.panelIndex],'figure',figureIndex!))):null;
  const speakerBox=figure&&figureBox?paintReferenceBox(figure.artwork?.paint,figureBox,figure.artwork?.crop):null;
  const editable=canvasTextEditable(document,target,'agent');
  return {page,owner,bubble,bbox,speakerBox,editable};
}

/** Only native editable state, no raster data, project paths or unrelated pages. */
export function agentEditorSnapshot(document:MangaDocument|null,revision:string,activePage:number,target:AgentBubbleTarget|null,blocked:string|null=null,
  context?:{panelIndex:number;selection:CanvasElementSelection|null}){
  const page=document?.manga.pages[activePage];
  let selected=null;
  if(document&&target){
    try{
      const c=bubbleContext(document,target),b=c.bubble;
      selected={target,editable:c.editable&&!blocked,text:b.text,speaker:b.speaker??null,shape:b.shape??'normal',
        monologue:b.monologue??false,offscreen:b.offscreen??false,bbox:c.bbox,bezier:b.bezier??materialBubbleBezier(b.shape)??null,
        tail:b.tail??null,tail_tip:c.speakerBox&&!bubbleTailDisabled(b)?bubbleTailTargetPoint(c.speakerBox,b.tail):null,
        speaker_box:c.speakerBox,clip_to_panel:b.clip_to_panel??false,join_to:b.join_to??null};
    }catch{/* Removed selection is represented as absent, never a guessed target. */}
  }
  const selection=context?.selection;
  const overlay=selection?.scope==='page_overlay',panelIndex=overlay?0:context?.panelIndex??0;
  const owner=overlay?page?.page_overlay:page?.panels[panelIndex];
  const figure=selection?.type==='figure'&&selection.scope!=='page'?owner?.figures?.[selection.index]:undefined;
  const character=figure&&!isPropPlacement(figure)&&figure.refId?document?.manga.characters.find(c=>c.localId===figure.refId):undefined;
  const selectedFigure=figure?{
    target:{pageIndex:activePage,panelIndex,index:selection!.index,kind:'figure' as const,overlay},
    name:figure.name,kind:isPropPlacement(figure)?'prop':'person',action:figure.action??null,size:figure.size??null,
    character:character?{name:character.name,aliases:character.aliases??[],role:character.role,visual_prompt:character.visual_prompt??null}:null,
    generation_available:!blocked&&(overlay||panelVisible(page!.panels[panelIndex]))&&!figure.artwork?.hidden
      &&(isPropPlacement(figure)||Boolean(character)),
  }:null;
  const figureNames=(figures:NonNullable<typeof owner>['figures'])=>(figures??[]).map((figure,index)=>({index,name:figure.name,kind:isPropPlacement(figure)?'prop':'person'}));
  return {revision,page_number:page?.page??null,page_size:page?.canvas??null,
    active_panel_number:page?.panels[context?.panelIndex??-1]?context!.panelIndex+1:null,
    selected_element:selection?{type:selection.type,index:selection.index,scope:selection.scope??'panel'}:target?{type:'bubble',index:target.index,scope:target.overlay?'page_overlay':'panel'}:null,
    selected_figure:selectedFigure,selected_bubble:selected,
    page_panels:page?.panels.map((panel,index)=>({number:index+1,id:panel.id,figures:figureNames(panel.figures)}))??[],
    overlay_figures:figureNames(page?.page_overlay?.figures),blocked,
    coordinate_units:{bbox:'paper_mm',tail:'paper_mm',bezier:'0..100 reference frame, coordinates may extend outside; handles relative to each anchor'},
    materials:BUBBLE_MATERIALS.map(({id,layer,label})=>({id,layer,label}))};
}
export type AgentEditorSnapshot=ReturnType<typeof agentEditorSnapshot>;

/** Prepare on a copy so any validation error leaves the original and Undo untouched. */
export function prepareAgentBubbleEdit(document:MangaDocument,selected:AgentBubbleTarget|null,currentRevision:string,raw:unknown):MangaDocument{
  const edit=parseAgentBubbleEdit(raw);
  if(edit.revision!==currentRevision)throw Error('原稿や選択が変わりました。現在の状態を読み直してください');
  if(!selected||Object.keys(selected).some(k=>selected[k as keyof AgentBubbleTarget]!==edit.target[k as keyof AgentBubbleTarget]))throw Error('現在選択しているフキダシだけを編集できます');
  const source=bubbleContext(document,selected);
  if(!source.editable)throw Error('対象のフキダシが非表示です');
  const next=structuredClone(document),c=bubbleContext(next,selected),bubble=c.bubble,changes=edit.changes;
  if(changes.shape!==undefined)setBubbleShape(bubble,changes.shape);
  if(changes.preset!==undefined)bubble.bezier=createBubbleBezier(changes.preset);
  if(changes.bezier!==undefined)bubble.bezier=structuredClone(changes.bezier);
  if(changes.node_updates!==undefined){
    const outline=structuredClone(bubble.bezier??materialBubbleBezier(bubble.shape));
    if(!outline)throw Error('部分調整するベジェ輪郭がありません。現在の輪郭を確認してください');
    for(const {index,...patch} of changes.node_updates){
      if(!outline.nodes[index])throw Error('変更するベジェ点のindexがありません');
      Object.assign(outline.nodes[index],patch);
    }
    if(!isBubbleBezier(outline))throw Error('変更後の点と制御点は有限の座標で指定してください');
    bubble.bezier=outline;
  }
  if(changes.bbox!==undefined){
    const b=changes.bbox,p=c.page.canvas;
    if(b.w>p.w*2||b.h>p.h*2||b.x+b.w<=0||b.y+b.h<=0||b.x>=p.w||b.y>=p.h)throw Error('フキダシが紙面内に見える位置と大きさを指定してください');
    bubble.bbox=structuredClone(b);
  }
  if(changes.tail_mode!==undefined||changes.tail_point!==undefined){
    if(changes.tail_mode==='none')bubble.tail=false;
    else if(changes.tail_mode==='auto')delete bubble.tail;
    else{
      const p=changes.tail_point!;
      if(!c.speakerBox||c.speakerBox.w<=0||c.speakerBox.h<=0||bubble.offscreen)throw Error('しっぽには同じコマ内の一意な話者の人物配置が必要です');
      if(p.x<0||p.y<0||p.x>c.page.canvas.w||p.y>c.page.canvas.h)throw Error('しっぽ先端を紙面内のmm座標で指定してください');
      bubble.tail=normalizedBubbleTailTarget(c.speakerBox,p);
      if(bubbleTailDisabled(bubble))throw Error('この吹き出しの種類ではしっぽを表示できません');
    }
  }
  return next;
}

/** A compact public revision while the complete editor guard stays local. */
export function createAgentRevision(){let key:string|undefined,version=0;return (current:string)=>{if(current!==key){key=current;version++;}return `r${version}`;};}
