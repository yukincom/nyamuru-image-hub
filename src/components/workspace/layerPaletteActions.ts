import {
  paintOwnerCanvasSelection, type PaintScene, ensureDirectPaintOwner, movePaintEntry, type PaintOwner,
  withPaintBleed, paintOwnerShouldClear, validatePaintDocument,
} from '../../lib/paintDocument';
import {
  bubbleVisible, toggleBubbleVisibility, panelLocked, unlockPanelDescendants, panelVisible,
  reorderPanelArt,
} from '../../lib/panelLayers';
import { type CanvasTextTarget, toggleCanvasTextVisibility } from '../../lib/canvasText';
import { cloneDocument } from '../../lib/manga';
import { paintOwnerPlacementLocked, paintFolderChain } from '../../lib/paintLock';
import type { PaintLayerAction, PaintController, PaintSessionSnapshot } from '../../lib/paintSession';
import type { PaintResult } from '../PaintEditor';
import { prepareGuideLayer } from '../../lib/paintGuide';
import { loadPaintImages, renderPaintPng } from '../../lib/paintRenderer';
import { panelDisplayLabel } from '../../lib/displayLabels';
import type { MutableRef, WorkspacePaintSession, WorkspaceSnapshot, EditorTimeline } from './workspaceTypes';
import type { MangaDocument, CanvasElementSelection } from '../../types';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { BubblePathToolMode } from '../../lib/paintWorkspace';

interface Context {
  activePage: number;
  layerTransition: (action: () => void | Promise<void>) => Promise<void>;
  paintSessionRef: MutableRef<WorkspacePaintSession | null>;
  paintController: MutableRef<PaintController | null>;
  documentRef: MutableRef<MangaDocument>;
  autoPaintResume: MutableRef<{ pageIndex: number; panelIndex: number; overlay: boolean; ownerKey: string; } | null>;
  endTextEdit: () => void;
  setTextTool: Dispatch<StateUpdater<boolean>>;
  setZoomTool: Dispatch<StateUpdater<boolean>>;
  setBubblePathTool: Dispatch<StateUpdater<BubblePathToolMode>>;
  selectCanvasElement: (selection: CanvasElementSelection | null, panelIndex?: number, pageIndex?: number, revealDetails?: boolean) => void;
  lastHistoryPush: MutableRef<number>;
  setDocument: (next: MangaDocument, record?: boolean) => void;
  setSelectedPanels: Dispatch<StateUpdater<number[]>>;
  workspaceSnapshot: (state?: PaintSessionSnapshot) => WorkspaceSnapshot;
  makePaintScene: (current: MangaDocument, panelIndex: number, pageIndex: number, overlay: boolean) => PaintScene & { generatedImageSequence: number };
  timeline: MutableRef<EditorTimeline>;
  changedHistory: () => void;
  setPaintSession: Dispatch<StateUpdater<WorkspacePaintSession | null>>;
  setActivePanel: Dispatch<StateUpdater<number>>;
  setSelectedElement: Dispatch<StateUpdater<CanvasElementSelection | null>>;
  pendingLayerAction: MutableRef<PaintLayerAction | null>;
  openPaint: (initialOwner?: string, panelIndex?: number, pageIndex?: number, overlay?: boolean, preview?: PaintScene) => boolean;
  paintBleedPx: number;
  persistPaintResults: (current: MangaDocument, batches: Array<{ pageIndex: number; panelIndex: number; overlay: boolean; title: string; result: PaintResult; }>, publish: (next: MangaDocument) => void) => Promise<void>;
  setToast: Dispatch<StateUpdater<string | null>>;
}

export function createLayerPaletteActions({
  activePage, layerTransition, paintSessionRef, paintController, documentRef, autoPaintResume,
  endTextEdit, setTextTool, setZoomTool, setBubblePathTool, selectCanvasElement, lastHistoryPush,
  setDocument, setSelectedPanels, workspaceSnapshot, makePaintScene, timeline, changedHistory,
  setPaintSession, setActivePanel, setSelectedElement, pendingLayerAction, openPaint, paintBleedPx,
  persistPaintResults, setToast,
}: Context) {
  function selectLayerOwner(key:string,panelIndex:number,pageIndex=activePage,overlay=false,native=false){void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    const page=documentRef.current.manga.pages[pageIndex],selection=paintOwnerCanvasSelection(page,panelIndex,key,overlay);
    if(!selection)return;
    if(selection.type==='bubble'&&!bubbleVisible((overlay?page.page_overlay:page.panels[panelIndex])!.bubbles![selection.index]))return;
    autoPaintResume.current=null;endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(false);
    selectCanvasElement(native?{...selection,part:'native'}:selection,panelIndex,pageIndex);
  });}
  function toggleTextLayer(target:CanvasTextTarget,group=false){void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    endTextEdit();const next=cloneDocument(documentRef.current);if(!(target.kind==='bubble'?toggleBubbleVisibility(next,{...target,bubbleIndex:target.index},group):toggleCanvasTextVisibility(next,target)))return;
    lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
  });}
  function selectLayerPanel(index:number,frame=false){void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    autoPaintResume.current=null;endTextEdit();setTextTool(false);setZoomTool(false);setBubblePathTool(false);
    setSelectedPanels([index]);selectCanvasElement(frame?{type:'panel_frame',index}:null,index);
  });}
  function togglePanelLayer(index:number,frame:boolean){void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    endTextEdit();const next=cloneDocument(documentRef.current),panel=next.manga.pages[activePage]?.panels[index];if(!panel)return;
    panel.layer??={};if(frame)panel.layer.frameHidden=!panel.layer.frameHidden;else panel.layer.hidden=!panel.layer.hidden;
    lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
  });}
  function togglePanelLock(index:number,frame=false){void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.close();
    endTextEdit();const next=cloneDocument(documentRef.current),panel=next.manga.pages[activePage]?.panels[index];if(!panel)return;
    panel.layer??={};if(frame)panel.layer.frameLocked=!panel.layer.frameLocked;else if(panelLocked(panel))unlockPanelDescendants(panel);else panel.layer.locked=true;
    lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
  });}
  function reorderOwnerLayers(index:number,key:string,target:string,after:boolean,overlay=false){void layerTransition(async()=>{
    if(paintSessionRef.current)await paintController.current?.pause();
    const session=paintSessionRef.current,controller=paintController.current,before=workspaceSnapshot();
    const validate=()=>{
      const next=cloneDocument(documentRef.current),page=next.manga.pages[activePage],panel=page?.panels[index],owner=overlay?page?.page_overlay:panel;
      if(!owner||(!overlay&&(!panelVisible(panel)||panelLocked(panel))))return;
      const moved=makePaintScene(next,index,activePage,overlay).owners.find(item=>item.key===key);
      if(!moved||paintOwnerPlacementLocked(moved)||!reorderPanelArt(owner,key,target,after,overlay?(page.layer??={}):undefined))return;
      return next;
    };
    if(!validate())return;
    if(session)await controller?.flush();
    const next=validate();if(!next)return;
    setDocument(next,false);timeline.current.record(before);lastHistoryPush.current=0;changedHistory();
    if(session){
      const live=controller?.snapshot(),active=session.pageIndex===activePage&&session.overlay===overlay&&(overlay||session.panelIndex===index);
      if(live&&active){
        const layout=makePaintScene(next,index,activePage,overlay);
        const scene={...live.scene,anchorIds:layout.anchorIds,owners:layout.owners.map(owner=>{
          const original=live.scene.owners.find(item=>item.key===owner.key);
          return original?{...original,bubble:owner.bubble,figure:owner.figure}:owner;
        })};
        const updated={...session,document:next,scene,resume:{...live,scene,saved:scene},images:new Map(controller?.images())};
        paintSessionRef.current=updated;setPaintSession(updated);
      }else{const updated={...session,document:next};paintSessionRef.current=updated;setPaintSession(updated);}
    }
  });}
  function actOnLayer(index:number,action:PaintLayerAction,preview:PaintScene,overlay=false){
    if(action.type==='select'&&!action.mask&&!action.id&&paintOwnerCanvasSelection(documentRef.current.manga.pages[activePage],index,action.key,overlay)){selectLayerOwner(action.key,index,activePage,overlay,action.native);return;}
    void layerTransition(async()=>{
    const session=paintSessionRef.current;
    if((action.type==='move-layer'||action.type==='move-folder')&&action.destination){
      const destination=action.destination;
      if(session?.pageIndex===activePage&&session.overlay===overlay&&(overlay||session.panelIndex===index)
        &&destination.overlay===overlay&&(overlay||destination.panelIndex===index)){
        paintController.current?.layerAction(action);return;
      }
      await movePaletteEntry(index,overlay,preview,action);return;
    }
    if(session?.pageIndex===activePage&&session.panelIndex===index&&session.overlay===overlay){paintController.current?.layerAction(action);return;}
    if(session)await paintController.current?.close();
    setActivePanel(index);setSelectedPanels([index]);
    // Locking uses paint persistence, but its native owner remains the information target after close.
    setSelectedElement(action.type==='owner-lock'?paintOwnerCanvasSelection(documentRef.current.manga.pages[activePage],index,action.key,overlay)??null:null);
    pendingLayerAction.current=action;
    // Use the preview's layer IDs; untouched empty layers do not exist in the document yet.
    if(!openPaint(action.key,index,activePage,overlay,preview))pendingLayerAction.current=null;
  });}
  async function movePaletteEntry(index:number,overlay:boolean,preview:PaintScene,action:Extract<PaintLayerAction,{type:'move-layer'|'move-folder'}>){
    const destination=action.destination;if(!destination)return;
    const pageIndex=activePage;
    if(paintSessionRef.current)await paintController.current?.pause();
    const session=paintSessionRef.current,controller=paintController.current;
    const liveSnapshot=controller?.snapshot(),live=liveSnapshot?.scene;
    const sourceLive=session?.pageIndex===pageIndex&&session.overlay===overlay&&(overlay||session.panelIndex===index);
    const targetLive=session?.pageIndex===pageIndex&&session.overlay===destination.overlay&&(destination.overlay||session.panelIndex===destination.panelIndex);
    const sameScope=overlay===destination.overlay&&(overlay||index===destination.panelIndex);
    let sourceScene=sourceLive&&live?live:preview;
    let targetScene=sameScope?sourceScene:targetLive&&live?live:destination.scene??makePaintScene(documentRef.current,destination.panelIndex,pageIndex,destination.overlay);
    let targetKey=destination.key;
    if(destination.stack){const direct=ensureDirectPaintOwner(targetScene,destination.stack);if(!direct)return;targetScene=direct.scene;targetKey=direct.key;if(sameScope)sourceScene=targetScene;}
    let source=sourceScene.owners.find(owner=>owner.key===action.key),target=targetScene.owners.find(owner=>owner.key===targetKey);
    if(!source||!target)return;
    const kind=action.type==='move-folder'?'folder':'layer';
    if(!movePaintEntry(source,target,kind,action.id,action.target))return;
    const before=workspaceSnapshot();
    if(session)await controller?.flush();
    const current=documentRef.current,imports:PaintResult['imports']=[...(liveSnapshot?.imports??[])];
    const borrowed=controller?.images()??new Map();
    const prepare=async(owner:PaintOwner)=>{
      let paint=owner.paint;
      for(const layer of paint.layers)if(layer.guide&&!layer.image){
        const prepared=await prepareGuideLayer(owner,layer);imports.push(prepared);
        paint={...paint,layers:paint.layers.map(item=>item.id===layer.id?{...prepared.layer,locked:layer.locked}:item)};
      }
      return paint===owner.paint?owner:{...owner,paint};
    };
    const sameOwner=source===target;
    source=await prepare(source);target=sameOwner?source:await prepare(target);
    const moved=movePaintEntry(source,target,kind,action.id,action.target);if(!moved)return;
    const owners=sameOwner?[moved.destination]:[moved.source,moved.destination];
    const replace=(scene:PaintScene,changed:PaintOwner[])=>({...scene,layerSequence:current.manga.pages[pageIndex].paint_layer_sequence??0,generatedImageSequence:liveSnapshot?.scene.generatedImageSequence??current.manga.generated_image_sequence??0,owners:scene.owners.map(owner=>changed.find(item=>item.key===owner.key)??owner)});
    const sourceAfter=replace(sourceScene,sameScope?owners:[moved.source]),targetAfter=sameScope?sourceAfter:replace(targetScene,[moved.destination]);
    const selectedMoves=sourceLive&&liveSnapshot?.ownerKey===action.key&&(liveSnapshot?.layerId===action.id||kind==='folder'&&paintFolderChain(source.paint,source.paint.layers.find(layer=>layer.id===liveSnapshot.layerId)?.folderId??liveSnapshot.layerId).some(folder=>folder.id===action.id));
    let resumeScene=selectedMoves?targetAfter:sourceLive?sourceAfter:targetLive?targetAfter:liveSnapshot?.scene;
    if(resumeScene){
      const prepared:PaintOwner[]=[];for(const owner of resumeScene.owners)prepared.push(await prepare(withPaintBleed(owner,paintBleedPx)));
      resumeScene={...resumeScene,owners:prepared};
    }
    const assets=[...(current.manga.image_assets??[]),...imports.map(item=>item.asset)];
    const images=await loadPaintImages([...owners,...(resumeScene?.owners??[])].map(owner=>owner.paint),assets,new Map(imports.map(item=>[item.asset.id,item.blob])),borrowed);
    let handedOff=false;
    try{
      const resultFor=async(scene:PaintScene,changed:PaintOwner[]):Promise<PaintResult>=>{
        const result:PaintResult={scene,owners:[],imports,stageImports:liveSnapshot?.stageImports};
        for(const owner of changed){
          if(paintOwnerShouldClear(owner))result.owners.push({owner,blob:new Blob(),remove:true});
          else {validatePaintDocument(owner.paint,assets);result.owners.push({owner,blob:await renderPaintPng(owner.paint,images)});}
        }
        return result;
      };
      const batches=sameScope
        ?[{pageIndex,panelIndex:index,overlay,title:current.manga.meta.title,result:await resultFor(targetScene,owners)}]
        :[{pageIndex,panelIndex:index,overlay,title:current.manga.meta.title,result:await resultFor(sourceScene,[moved.source])},
          {pageIndex,panelIndex:destination.panelIndex,overlay:destination.overlay,title:current.manga.meta.title,result:await resultFor(targetScene,[moved.destination])}];
      await persistPaintResults(current,batches,next=>{
        setDocument(next,false);timeline.current.record(before);lastHistoryPush.current=0;changedHistory();
        if(session&&liveSnapshot&&resumeScene){
          const scene=resumeScene;
          const panelIndex=selectedMoves?destination.panelIndex:session.panelIndex,overlay=selectedMoves?destination.overlay:session.overlay;
          const maskTarget=selectedMoves&&liveSnapshot.maskTarget?{...liveSnapshot.maskTarget,key:targetKey}:liveSnapshot.maskTarget;
          const resume={...liveSnapshot,scene,saved:scene,imports,stageImports:[],maskTarget,...(selectedMoves?{ownerKey:targetKey}:{})};
          const updated={...session,document:next,panelIndex,overlay,scene,resume,images:new Map([...borrowed,...images]),title:overlay?'ページ前景':panelDisplayLabel(next.manga.pages[pageIndex].panels[panelIndex].id)};
          paintSessionRef.current=updated;setPaintSession(updated);handedOff=true;
          if(selectedMoves){setActivePanel(panelIndex);setSelectedPanels([panelIndex]);}
        }
      });
    }finally{if(!handedOff)images.forEach((image,id)=>{if(image!==borrowed.get(id))image.src='';});}
  }
  function addDirectFolder(index:number,overlay=false,position?:import('../../lib/paintDocument').PaintAddPosition){
    try{const scene=makePaintScene(documentRef.current,index,activePage,overlay);actOnLayer(index,{type:'add-folder',key:overlay?'page':'panel',position:position??{}},scene,overlay);}
    catch(error){setToast(error instanceof Error?error.message:'フォルダーを追加できませんでした');}
  }
  function openPanelBackground3d(index:number){
    const target=documentRef.current.manga.pages[activePage]?.panels[index];
    if(!target||panelLocked(target)){setToast('コマフォルダが固定されています');return;}
    try{actOnLayer(index,{type:'background3d',key:'background'},makePaintScene(documentRef.current,index,activePage,false));}
    catch(error){setToast(error instanceof Error?error.message:'背景の3D編集を開けません');}
  }

  return { addDirectFolder, actOnLayer, toggleTextLayer, selectLayerOwner, reorderOwnerLayers, selectLayerPanel, togglePanelLayer, togglePanelLock, openPanelBackground3d };
}
