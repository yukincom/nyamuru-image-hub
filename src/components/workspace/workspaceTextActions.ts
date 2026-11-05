import { queryPcFontFamilies, classifyPcFontFamilies, availableFontWeights, type PcFontFamily } from '../../lib/bubbleFonts';
import { rememberPcFontCatalog } from '../../lib/workspacePreferences';
import { useEffect, type Dispatch, type StateUpdater } from 'preact/hooks';
import {
  canvasTextAt, removeCanvasText, type CanvasTextTarget, canvasTextEditable, editCanvasText,
  editCanvasTextStyle, editCanvasBubbleLineWidth, editCanvasBubbleMaterial, addCanvasTextAt,
  type TextCategory, canvasTextCategory, changeCanvasTextCategory, convertScreenTextToBubble,
  screenTextCoveredByBubble,
} from '../../lib/canvasText';
import { cloneDocument } from '../../lib/manga';
import type { BubbleTextTarget } from '../../lib/panelLayers';
import { type TextSelection, typingTextStyle, type TextStylePatch, updateTextStyle, textStyleOf } from '../../lib/textStyle';
import { getPrintSetup } from '../../lib/printSettings';
import { paintGenerationOwner, paintOwnerCanvasSelection } from '../../lib/paintDocument';
import type { BubblePathToolMode, PaintLayoutTarget } from '../../lib/paintWorkspace';
import type { Bubble, CanvasElementSelection, MangaDocument, TextStyle } from '../../types';
import type { MutableRef, WorkspacePaintSession, WorkspaceGeneration } from './workspaceTypes';
import type { PaintController } from '../../lib/paintSession';
import type { TextPaletteTab } from '../PaintTextTools';

interface Context {
  localFontQuery: MutableRef<Promise<void> | null>;
  localFontSynced: MutableRef<boolean>;
  localFontCatalog: MutableRef<PcFontFamily[]>;
  setLocalFontFamilies: Dispatch<StateUpdater<PcFontFamily[]>>;
  createdText: MutableRef<CanvasTextTarget | null>;
  documentRef: MutableRef<MangaDocument>;
  setDocument: (next: MangaDocument, record?: boolean) => void;
  selectedElement: CanvasElementSelection | null;
  setSelectedElement: Dispatch<StateUpdater<CanvasElementSelection | null>>;
  setEditingText: Dispatch<StateUpdater<CanvasTextTarget | null>>;
  imageGestureBoundary: (phase: 'start' | 'end', source?: 'text-size') => void;
  autoPaintResume: MutableRef<{ pageIndex: number; panelIndex: number; overlay: boolean; ownerKey: string; } | null>;
  layerTransition: (action: () => void | Promise<void>) => Promise<void>;
  paintSessionRef: MutableRef<WorkspacePaintSession | null>;
  paintController: MutableRef<PaintController | null>;
  setTextTool: Dispatch<StateUpdater<boolean>>;
  setZoomTool: Dispatch<StateUpdater<boolean>>;
  setBubblePathTool: Dispatch<StateUpdater<BubblePathToolMode>>;
  selectCanvasElement: (selection: CanvasElementSelection | null, panelIndex?: number, pageIndex?: number, revealDetails?: boolean) => void;
  setTextPaletteRequest: Dispatch<StateUpdater<{ id: number; tab: TextPaletteTab; }>>;
  editingText: CanvasTextTarget | null;
  setPaintToolsCollapsed: Dispatch<StateUpdater<boolean>>;
  setSelectedPanels: Dispatch<StateUpdater<number[]>>;
  textToolStyle: TextStyle;
  imageGesture: MutableRef<{ active: boolean; pushed: boolean; source?: 'text-size'; }>;
  lastHistoryPush: MutableRef<number>;
  setTextToolStyle: Dispatch<StateUpdater<TextStyle>>;
  projectOperation: MutableRef<boolean>;
  qwenGeneration: WorkspaceGeneration | null;
  setToast: Dispatch<StateUpdater<string | null>>;
  selectedBubbleTarget: CanvasTextTarget | undefined;
  textTool: boolean;
  zoomTool: boolean;
  layerSwitch: MutableRef<boolean>;
  undo: () => void;
  redo: () => void;
  setActivePage: Dispatch<StateUpdater<number>>;
  setActivePanel: Dispatch<StateUpdater<number>>;
  setBubbleMaterialsOpen: Dispatch<StateUpdater<boolean>>;
  activePage: number;
  activePanel: number;
  selectCanvasPanel: (index: number, additive?: boolean) => void;
}

export function useWorkspaceTextActions({
  localFontQuery, localFontSynced, localFontCatalog, setLocalFontFamilies, createdText, documentRef,
  setDocument, selectedElement, setSelectedElement, setEditingText, imageGestureBoundary,
  autoPaintResume, layerTransition, paintSessionRef, paintController, setTextTool, setZoomTool,
  setBubblePathTool, selectCanvasElement, setTextPaletteRequest, editingText, setPaintToolsCollapsed,
  setSelectedPanels, textToolStyle, imageGesture, lastHistoryPush, setTextToolStyle, projectOperation,
  qwenGeneration, setToast, selectedBubbleTarget, textTool, zoomTool, layerSwitch, undo, redo,
  setActivePage, setActivePanel, setBubbleMaterialsOpen, activePage, activePanel, selectCanvasPanel,
}: Context) {
  function requestPcFonts(){
    if(localFontQuery.current)return localFontQuery.current;
    if(localFontSynced.current)return Promise.resolve();
    const request=queryPcFontFamilies()
      .then(names=>{
        if(names.length!==localFontCatalog.current.length||names.some((name,index)=>{
          const old=localFontCatalog.current[index],weights=name.weights??[],oldWeights=old.weights??[];
          return name.family!==old.family||(name.displayName??name.family)!==(old.displayName??old.family)||weights.length!==oldWeights.length||weights.some((option,i)=>option.value!==oldWeights[i].value||option.label!==oldWeights[i].label);
        })){
          const families=classifyPcFontFamilies(names);
          localFontCatalog.current=families;
          setLocalFontFamilies(families);
          rememberPcFontCatalog(families);
        }
        localFontSynced.current=true;
      })
      .catch(()=>{/* Startup may lack permission; opening the selected-text picker retries inside a user gesture. */})
      .finally(()=>{localFontQuery.current=null;});
    localFontQuery.current=request;
    return request;
  }
  useEffect(()=>{void requestPcFonts();},[]);
  function endTextEdit(){
    const created=createdText.current;
    createdText.current=null;
    if(created){
      const item=canvasTextAt(documentRef.current,created);
      if(item&&!item.text.trim()){
        const next=cloneDocument(documentRef.current);
        if(removeCanvasText(next,created)){
          setDocument(next);
          const selected=selectedElement;
          if(selected?.type===created.kind&&selected.index===created.index&&(selected.scope==='page_overlay')===created.overlay)setSelectedElement(null);
        }
      }
    }
    setEditingText(null);imageGestureBoundary('end');
  }
  function startBubbleEdit(target:BubbleTextTarget){startTextEdit({...target,index:target.bubbleIndex,kind:'bubble'});}
  function startTextEdit(target:CanvasTextTarget){
    autoPaintResume.current=null;
    if(canvasTextAt(documentRef.current,target)?.hidden){
      void layerTransition(async()=>{
        if(paintSessionRef.current)await paintController.current?.close();
        endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(false);
        selectCanvasElement({type:target.kind,index:target.index,...(target.overlay?{scope:'page_overlay' as const}:{})},target.panelIndex,target.pageIndex,false);
      });return;
    }
    setTextPaletteRequest(value=>({id:value.id+1,tab:'text'}));
    if(editingText&&editingText.pageIndex===target.pageIndex&&editingText.panelIndex===target.panelIndex&&editingText.index===target.index&&editingText.kind===target.kind&&editingText.overlay===target.overlay)return;
    void requestPcFonts();
    void layerTransition(async()=>{
      if(paintSessionRef.current)await paintController.current?.close();
      const current=documentRef.current;
      if(!canvasTextEditable(current,target))return;
      endTextEdit();setTextTool(true);setZoomTool(false);setBubblePathTool(false);setPaintToolsCollapsed(false);setSelectedPanels([target.panelIndex]);
      selectCanvasElement({type:target.kind,index:target.index,...(target.overlay?{scope:'page_overlay' as const}:{})},target.panelIndex,target.pageIndex,false);
      imageGestureBoundary('start');setEditingText(target);
    });
  }
  function changeCanvasText(target:CanvasTextTarget,text:string,edit?:TextSelection){
    const next=cloneDocument(documentRef.current);
    if(editCanvasText(next,target,text,edit,'manual',typingTextStyle(textToolStyle))){imageGesture.current.pushed=false;lastHistoryPush.current=0;setDocument(next);}
  }
  function changeTextToolStyle(patch:TextStylePatch){
    setTextToolStyle(current=>{
      const item={text:'',orientation:current.orientation??'vertical',text_style:{...current}};
      return updateTextStyle(item,'screen_text',patch,undefined,patch.font?availableFontWeights(patch.font,localFontCatalog.current):undefined)?textStyleOf(item,'screen_text'):current;
    });
  }
  function changeCanvasTextStyle(target:CanvasTextTarget,patch:TextStylePatch,selection?:TextSelection){
    if(paintSessionRef.current||projectOperation.current||qwenGeneration)return;
    try{const next=editCanvasTextStyle(documentRef.current,target,patch,selection,patch.font?availableFontWeights(patch.font,localFontCatalog.current):undefined);if(next!==documentRef.current){changeTextToolStyle(patch);if(imageGesture.current.source!=='text-size'){imageGesture.current.pushed=false;lastHistoryPush.current=0;}setDocument(next);}}
    catch(error){setToast(error instanceof Error?error.message:'文字設定を変更できません');}
  }
  function changeSelectedBubbleLineWidth(width:number){
    if(!selectedBubbleTarget||textTool||zoomTool||paintSessionRef.current||projectOperation.current||layerSwitch.current||qwenGeneration)return;
    const current=documentRef.current,next=editCanvasBubbleLineWidth(current,selectedBubbleTarget,width*25.4/getPrintSetup(current.manga).dpi);
    if(next===current)return;
    imageGestureBoundary('end');lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
  }
  function canvasTextHistory(direction:'undo'|'redo'){
    const target=editingText;
    (direction==='undo'?undo:redo)();
    if(target&&canvasTextEditable(documentRef.current,target)&&canvasTextAt(documentRef.current,target)?.text_style?.fontSize!==undefined){
      imageGestureBoundary('start');setEditingText(target);
      setSelectedElement({type:target.kind,index:target.index,...(target.overlay?{scope:'page_overlay' as const}:{})});
    }
  }
  function applyBubbleMaterial(target:CanvasTextTarget,id:string){
    void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    try{
      const next=cloneDocument(documentRef.current);
      if(!editCanvasBubbleMaterial(next,target,id))return;
      endTextEdit();lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
      setActivePage(target.pageIndex);setActivePanel(target.panelIndex);setSelectedElement({type:'bubble',index:target.index,...(target.overlay?{scope:'page_overlay' as const}:{})});
      setTextTool(false);setZoomTool(false);setBubblePathTool(false);
      setToast('文字・大きさ・位置を保って、吹き出しの輪郭を入れ替えました');
    }catch(error){setToast(error instanceof Error?error.message:'素材を適用できません');}
    });
  }
  function openBubbleMaterials(){endTextEdit();setBubbleMaterialsOpen(true);setTextTool(true);setZoomTool(false);setBubblePathTool(false);setPaintToolsCollapsed(false);setTextPaletteRequest(value=>({id:value.id+1,tab:'bubble'}));}
  function chooseTextTool(){void requestPcFonts();void layerTransition(async()=>{
    setTextPaletteRequest(value=>({id:value.id+1,tab:'text'}));
    autoPaintResume.current=null;
    const session=paintSessionRef.current;
    if(session){
      const snapshot=paintController.current?.snapshot(),scene=snapshot?.scene??session.scene;
      const key=snapshot?.ownerKey??session.initialOwner;
      const owner=key?paintGenerationOwner(scene,key):undefined;
      let selection=owner?.kind==='bubble'?paintOwnerCanvasSelection(documentRef.current.manga.pages[session.pageIndex],session.panelIndex,owner.key,session.overlay):undefined;
      // Point text has no paint owner; preserve its existing P -> T editing route.
      if(!selection&&selectedElement?.type==='screen_text'&&session.pageIndex===activePage&&session.panelIndex===activePanel&&(selectedElement.scope==='page_overlay')===session.overlay
        &&canvasTextAt(documentRef.current,{pageIndex:session.pageIndex,panelIndex:session.panelIndex,index:selectedElement.index,kind:'screen_text',overlay:session.overlay}))selection=selectedElement;
      if(selection){
        await paintController.current?.close();
        selectCanvasElement(selection,session.panelIndex,session.pageIndex,false);
      }else{
        await paintController.current?.pause();
        setSelectedElement(null);
      }
    }
    setTextTool(true);setZoomTool(false);setBubblePathTool(false);setPaintToolsCollapsed(false);
  });}
  function closeTextTool(){
    endTextEdit();setTextTool(false);
  }
  function chooseBubblePathTool(mode:Exclude<BubblePathToolMode,false>){void layerTransition(async()=>{
    autoPaintResume.current=null;
    if(paintSessionRef.current)await paintController.current?.close();
    endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(mode);setPaintToolsCollapsed(false);
  });}
  function chooseLayoutTool(target?:PaintLayoutTarget){
    const session=paintSessionRef.current;
    const select=()=>{
      autoPaintResume.current=null;endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(target?.direct?'node':false);
      if(!target){setSelectedElement(null);return;}
      const pageIndex=session?.pageIndex??activePage,panelIndex=target.panelIndex??session?.panelIndex??activePanel;
      const selection=target.key?paintOwnerCanvasSelection(documentRef.current.manga.pages[pageIndex],panelIndex,target.key,session?.overlay):target.selection;
      if(selection)selectCanvasElement(selection,panelIndex,pageIndex);
      else {selectCanvasPanel(panelIndex,target.additive);setSelectedElement(null);}
    };
    if(target&&session)void layerTransition(async()=>{await paintController.current?.close();select();});
    else select();
  }
  function chooseZoomTool(){void layerTransition(async()=>{
    autoPaintResume.current=null;
    if(paintSessionRef.current)await paintController.current?.pause();
    endTextEdit();setTextTool(false);setZoomTool(true);setBubblePathTool(false);setPaintToolsCollapsed(false);
  });}
  function createScreenTextAt(pageIndex:number,panelIndex:number|null,point:{x:number;y:number}){
    void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    endTextEdit();
    const next=cloneDocument(documentRef.current),target=addCanvasTextAt(next,pageIndex,panelIndex,point,textToolStyle);
    if(!target)return;
    imageGestureBoundary('start');lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
    createdText.current=target;
    setTextTool(true);setZoomTool(false);setBubblePathTool(false);setPaintToolsCollapsed(false);
    setSelectedPanels([target.panelIndex]);
    selectCanvasElement({type:'screen_text',index:target.index,...(target.overlay?{scope:'page_overlay' as const}:{})},target.panelIndex,pageIndex,false);
    setEditingText(target);
    });
  }
  function changeSelectedTextBody(text:string){
    if(selectedElement?.type!=='bubble'&&selectedElement?.type!=='screen_text')return;
    changeCanvasText({pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,overlay:selectedElement.scope==='page_overlay',kind:selectedElement.type},text);
  }
  function screenTextPosition(target:CanvasTextTarget):Bubble['text_position']{
    if(target.kind!=='screen_text')return;
    const element=window.document.querySelector<HTMLElement>(`[data-content-kind="screen_text"][data-content-index="${target.index}"].is-element-selected${target.overlay?'[data-content-overlay]':`[data-content-panel="${target.panelIndex}"]`}`);
    const frame=element?.getBoundingClientRect(),body=element?.querySelector('.screen-text-body');
    if(frame?.width&&frame.height&&body){
      // Match BubbleText's content-block range, including glyph overhang beyond its line box.
      const range=window.document.createRange();range.selectNode(body);
      const content=range.getBoundingClientRect();
      return {x:(content.x+content.width/2-frame.x)/frame.width,y:(content.y+content.height/2-frame.y)/frame.height};
    }
  }
  function changeSelectedTextCategory(category:TextCategory){
    if(selectedElement?.type!=='bubble'&&selectedElement?.type!=='screen_text')return;
    const target:CanvasTextTarget={pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,overlay:selectedElement.scope==='page_overlay',kind:selectedElement.type};
    const item=canvasTextAt(documentRef.current,target);
    if(!item||!canvasTextEditable(documentRef.current,target)||canvasTextCategory(item,target.kind)===category)return;
    // Point text starts at an edge; native balloon text is centered on text_position.
    // Keep the visible text center even when its authored box has spare space.
    const screenPosition=screenTextPosition(target);
    void layerTransition(async()=>{
      if(paintSessionRef.current)await paintController.current?.close();
      const next=cloneDocument(documentRef.current),converted=changeCanvasTextCategory(next,target,category,screenPosition);
      if(!converted)return;
      createdText.current=null;setEditingText(null);imageGestureBoundary('end');
      lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
      setSelectedElement({type:converted.kind,index:converted.index,...(converted.overlay?{scope:'page_overlay' as const}:{})});
      setTextPaletteRequest(value=>({id:value.id+1,tab:'info'}));
    });
  }
  function wrapScreenText(target:CanvasTextTarget,materialId:string){
    void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    createdText.current=null;setEditingText(null);imageGestureBoundary('end');
    const next=cloneDocument(documentRef.current);
    const converted=convertScreenTextToBubble(next,{screenText:target,materialId});
    if(!converted)return;
    lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
    setActivePage(converted.pageIndex);setActivePanel(converted.panelIndex);setSelectedPanels([converted.panelIndex]);
    setSelectedElement({type:'bubble',index:converted.index,...(converted.overlay?{scope:'page_overlay' as const}:{})});
    setTextTool(false);setZoomTool(false);setBubblePathTool(false);
    setToast('写植文字を吹き出しの中央へ入れ、文字量に合わせて一度だけサイズを調整しました');
    });
  }
  function finishElementMove(pageIndex:number,selection:CanvasElementSelection,panelIndex:number|null){
    if(selection.type!=='bubble')return;
    const bubbleTarget:CanvasTextTarget={pageIndex,panelIndex:panelIndex??0,index:selection.index,overlay:selection.scope==='page_overlay',kind:'bubble'};
    const covered=screenTextCoveredByBubble(documentRef.current,bubbleTarget);
    if(!covered)return;
    createdText.current=null;setEditingText(null);imageGestureBoundary('end');
    const next=cloneDocument(documentRef.current),converted=convertScreenTextToBubble(next,{screenText:covered,bubble:bubbleTarget});
    if(!converted)return;
    lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
    setSelectedElement({type:'bubble',index:converted.index,...(converted.overlay?{scope:'page_overlay' as const}:{})});
    setTextTool(false);setZoomTool(false);setBubblePathTool(false);
    setToast('文字を吹き出しの中央へ入れ、文字量に合わせて一度だけサイズを調整しました');
  }

  return { endTextEdit, changeSelectedBubbleLineWidth, chooseZoomTool, chooseTextTool, screenTextPosition, openBubbleMaterials, requestPcFonts, chooseBubblePathTool, closeTextTool, chooseLayoutTool, startBubbleEdit, applyBubbleMaterial, changeTextToolStyle, changeCanvasTextStyle, startTextEdit, createScreenTextAt, wrapScreenText, finishElementMove, changeCanvasText, canvasTextHistory, changeSelectedTextCategory, changeSelectedTextBody };
}
