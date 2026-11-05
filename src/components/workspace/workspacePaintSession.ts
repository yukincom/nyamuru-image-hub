import type { MangaDocument, CanvasElementSelection } from '../../types';
import { validateImagePlacements } from '../../lib/imagePlacement';
import { overlayFallbackBox } from '../../lib/pageCanvas';
import { getPrintSetup } from '../../lib/printSettings';
import { paintScene, figurePaintVisible, canvasPaintOwnerKey, type PaintScene, withPaintBleed } from '../../lib/paintDocument';
import { paintColorMode } from '../../lib/paintColor';
import { panelVisible } from '../../lib/panelLayers';
import { panelDisplayLabel } from '../../lib/displayLabels';
import type { MutableRef, WorkspacePaintSession, MobileStoryboardPane, WorkspaceGeneration } from './workspaceTypes';
import type { PaintController, PaintLayerAction } from '../../lib/paintSession';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { BubblePathToolMode } from '../../lib/paintWorkspace';

interface Context {
  activePanel: number;
  activePage: number;
  document: MangaDocument;
  paintSessionRef: MutableRef<WorkspacePaintSession | null>;
  paintController: MutableRef<PaintController | null>;
  documentRef: MutableRef<MangaDocument>;
  pendingLayerAction: MutableRef<PaintLayerAction | null>;
  selectedElement: CanvasElementSelection | null;
  imageImportBusy: boolean;
  qwenPreparing: MutableRef<boolean>;
  endTextEdit: () => void;
  setTextTool: Dispatch<StateUpdater<boolean>>;
  setZoomTool: Dispatch<StateUpdater<boolean>>;
  setBubblePathTool: Dispatch<StateUpdater<BubblePathToolMode>>;
  paintBleedPx: number;
  setMobileStoryboardPane: (value: MobileStoryboardPane) => void;
  setPaintToolsCollapsed: Dispatch<StateUpdater<boolean>>;
  setPaintLayersCollapsed: Dispatch<StateUpdater<boolean>>;
  autoPaintResume: MutableRef<{ pageIndex: number; panelIndex: number; overlay: boolean; ownerKey: string; } | null>;
  setPaintSession: Dispatch<StateUpdater<WorkspacePaintSession | null>>;
  setToast: Dispatch<StateUpdater<string | null>>;
  layerSwitch: MutableRef<boolean>;
  projectOperation: MutableRef<boolean>;
  qwenGeneration: WorkspaceGeneration | null;
  setLayerSwitchBusy: Dispatch<StateUpdater<boolean>>;
}

export function createWorkspacePaintSession({
  activePanel, activePage, document, paintSessionRef, paintController, documentRef,
  pendingLayerAction, selectedElement, imageImportBusy, qwenPreparing, endTextEdit, setTextTool,
  setZoomTool, setBubblePathTool, paintBleedPx, setMobileStoryboardPane, setPaintToolsCollapsed,
  setPaintLayersCollapsed, autoPaintResume, setPaintSession, setToast, layerSwitch, projectOperation,
  qwenGeneration, setLayerSwitchBusy,
}: Context) {
  const makePaintScene = (current:MangaDocument,panelIndex:number,pageIndex:number,overlay:boolean) => {
    const targetPage=current.manga.pages[pageIndex],targetPanel=targetPage?.panels[panelIndex];
    if(!targetPage||(!overlay&&!targetPanel))throw new Error('対象のあたりが見つかりません');
    validateImagePlacements(current);
    const source=overlay?{id:0,shape:{type:'rect' as const,x:0,y:0,...targetPage.canvas},bg:0 as const,action:null,
      layer:targetPage.layer,screen_text:targetPage.page_overlay?.screen_text,
      images:targetPage.images?.filter(image=>image.paintScope==='page'||image.bubbleOriginal),
      figures:targetPage.page_overlay?.figures?.map((figure,index)=>({...figure,bbox:figure.bbox??overlayFallbackBox(targetPage.canvas,'figure',index)})),
      bubbles:(targetPage.page_overlay?.bubbles??[]).map((bubble,index)=>({...bubble,bbox:bubble.bbox??overlayFallbackBox(targetPage.canvas,'bubble',index)}))}:targetPanel;
    const setup=getPrintSetup(current.manga);
    const scene=paintScene(source,setup.dpi,current.manga.image_assets??[],paintColorMode(setup.format),overlay?'page':'panel',overlay?targetPage.panels:undefined);
    if(overlay)scene.owners=scene.owners.filter(owner=>owner.kind!=='background');
    if(!scene.owners.length)throw new Error('描画先を選んでください');
    return {...scene,generatedImageSequence:current.manga.generated_image_sequence??0};
  };
  const artworkGuideVisible=(key:string,panelIndex=activePanel,pageIndex=activePage,overlay=false,source=document):boolean=>{
    if(key.startsWith('bubble-'))return false;
    const page=source.manga.pages[pageIndex],target=overlay?page?.page_overlay:page?.panels[panelIndex];
    const index=Number(key.split('-')[1]);
    const figure=key.startsWith('figure-')?target?.figures?.[index]:undefined,bubble=key.startsWith('bubble-')?target?.bubbles?.[index]:undefined;
    const paint=key==='background'?page?.panels[panelIndex]?.background_images?.[0]?.paint:figure?.artwork?.paint??bubble?.paint_overlay?.paint;
    if(paint?.guideInitialized){
      if(figure)return figurePaintVisible(figure);
      return paint.layers.some(layer=>layer.guide&&layer.visible&&layer.opacity>0);
    }
    if(key==='background')return !page?.panels[panelIndex]?.background_images?.length;
    return key.startsWith('figure-')?!target?.figures?.[index]?.artwork:!target?.bubbles?.[index]?.paint_overlay;
  };
  const toggleArtworkGuide=(key:string,panelIndex=activePanel,pageIndex=activePage,overlay=false)=>{
    if(key.startsWith('bubble-'))return;
    const session=paintSessionRef.current;
    if(!key.startsWith('bubble-')&&session?.pageIndex===pageIndex&&session.panelIndex===panelIndex&&session.overlay===overlay){paintController.current?.layerAction({type:'guide',key});return;}
    if(!key.startsWith('bubble-')){void layerTransition(async()=>{
      if(paintSessionRef.current)await paintController.current?.close();
      const source=makePaintScene(documentRef.current,panelIndex,pageIndex,overlay),owner=source.owners.find(o=>o.key===key);
      if(!owner?.paint.guideInitialized)return;
      pendingLayerAction.current={type:'guide',key};
      if(!openPaint(key,panelIndex,pageIndex,overlay,source))pendingLayerAction.current=null;
    });return;}
  };
  const selectedPaintOwner = () => canvasPaintOwnerKey(documentRef.current.manga.pages[activePage],activePanel,selectedElement)??'background';
  const openPaint = (initialOwner?:string,panelIndex=activePanel,pageIndex=activePage,overlay=selectedElement?.scope==='page_overlay'||selectedElement?.scope==='page', preview?:PaintScene) => {
    if(imageImportBusy||paintSessionRef.current||qwenPreparing.current)return false;
    endTextEdit();
    const current=documentRef.current;
    try {
      if(!overlay&&!panelVisible(current.manga.pages[pageIndex].panels[panelIndex]))throw new Error('レイヤーの目を押してコマを表示してください');
      setTextTool(false);setZoomTool(false);setBubblePathTool(false);
      const scene={...(preview??makePaintScene(current,panelIndex,pageIndex,overlay)),layerSequence:current.manga.pages[pageIndex].paint_layer_sequence??0,generatedImageSequence:preview?.generatedImageSequence??current.manga.generated_image_sequence??0};
      scene.owners=scene.owners.map(owner=>withPaintBleed(owner,paintBleedPx));
      setMobileStoryboardPane('editor');setPaintToolsCollapsed(false);setPaintLayersCollapsed(false);
      const ownerKey=initialOwner??selectedPaintOwner();
      const session={document:current,pageIndex,panelIndex,overlay,scene,initialOwner:ownerKey,title:overlay?'ページ前景':panelDisplayLabel(current.manga.pages[pageIndex].panels[panelIndex].id)};
      autoPaintResume.current=null;paintSessionRef.current=session;setPaintSession(session);return true;
    }catch(error){setToast(error instanceof Error?error.message:'ペイントを開けませんでした');return false;}
  };
  async function layerTransition(action:()=>void|Promise<void>){
    if(layerSwitch.current||projectOperation.current||imageImportBusy||qwenGeneration)return;
    layerSwitch.current=true;setLayerSwitchBusy(true);
    try{await action();}catch(error){setToast(error instanceof Error?error.message:'レイヤーを切り替えられません');}
    finally{layerSwitch.current=false;setLayerSwitchBusy(false);}
  }

  return { layerTransition, makePaintScene, openPaint, artworkGuideVisible, selectedPaintOwner, toggleArtworkGuide };
}
