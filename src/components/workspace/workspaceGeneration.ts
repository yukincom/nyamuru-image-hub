import type { WorkspaceState } from './useWorkspaceState';
import type { MangaDocument, ImageAsset, Bubble, BBox } from '../../types';
import type { PaintOwner, PaintScene } from '../../lib/paintDocument';
import { type PaintImages, generationMaskBounds } from '../../lib/paintRenderer';
import { type QwenAgentRequest, buildQwenGenerationPlan, qwenLayerCandidates } from '../../lib/qwenGeneration';
import { type CanvasTextTarget, ensureCanvasTextOwner } from '../../lib/canvasText';
import { isBalloonText } from '../../lib/bubblePresentation';
import { isPropPlacement } from '../../lib/catalogModel';
import { parseOmayYaml, cloneDocument } from '../../lib/manga';
import standardArtworkSource from '../../content/standard-settings.yaml?raw';
import { qwenInputImage, qwenLayerImage, type GenerationPoseEditorContext } from '../QwenGenerationDialog';
import { getOutputSettings } from '../../lib/finishLayout.ts';
import { type QwenCompositionScope, buildQwenCompositionPlan, captureQwenComposition } from '../../lib/qwenComposition';

interface Context {
  setDocument: (next: MangaDocument, record?: boolean) => void;
  artworkGuideVisible: (key: string, panelIndex?: number, pageIndex?: number, overlay?: boolean, source?: MangaDocument) => boolean;
  makePaintScene: (current: MangaDocument, panelIndex: number, pageIndex: number, overlay: boolean) => PaintScene & { generatedImageSequence: number };
  selectedPaintOwner: () => string;
  endTextEdit: () => void;
  screenTextPosition: (target: CanvasTextTarget) => Bubble['text_position'];
}

export function createWorkspaceGeneration({
  paintController, documentRef, setVoiceOpen, qwenGenerationRef, paintSessionRef, setPaintSession,
  lastHistoryPush, setQwenGeneration, selectedElement, activePanel, activePage, qwenPreparing,
  imageImportBusy, projectOperation, setAgentWorkTarget, setToast,
}: WorkspaceState, {
  setDocument, artworkGuideVisible, makePaintScene, selectedPaintOwner, endTextEdit, screenTextPosition,
}: Context) {
  const prepareQwen = async(current:MangaDocument,pageIndex:number,panelIndex:number,overlay:boolean,owner:PaintOwner,images?:PaintImages,pendingAssets:ImageAsset[]=[],agentRequest?:QwenAgentRequest,textSource?:{target:CanvasTextTarget;position?:Bubble['text_position'];document:MangaDocument}) => {
    const captured=structuredClone(owner),assets=[...pendingAssets,...(current.manga.image_assets??[])];
    if (captured.figure) {
      const sourcePage=current.manga.pages[pageIndex];
      const figure=(overlay?sourcePage.page_overlay:sourcePage.panels[panelIndex])?.figures?.[captured.index];
      if (figure) { captured.figure.human_pose=figure.human_pose; captured.figure.size=figure.size; }
    }
    const needsMask=(captured.kind==='bubble'&&captured.bubble&&!isBalloonText(captured.bubble))
      || (captured.figure&&!isPropPlacement(captured.figure));
    const area=needsMask?generationMaskBounds(captured.paint):undefined;
    const plan=buildQwenGenerationPlan(textSource?.document.manga??current.manga,pageIndex,panelIndex,overlay,captured,parseOmayYaml(standardArtworkSource),area,Boolean(captured.figure&&!isPropPlacement(captured.figure)));
    const selected=paintController.current?.snapshot();
    if(selected?.ownerKey===captured.key){
      plan.folderId=captured.paint.layers.find(layer=>layer.id===selected.layerId)?.folderId
        ??captured.paint.folders?.find(folder=>folder.id===selected.layerId)?.id;
    }
    const loadLayer=async(id:string,correction:boolean,crop?:BBox,native=false)=>{
      if(documentRef.current!==current)throw new Error('作品が変更されました。生成対象を選び直してください');
      const result=await qwenInputImage(await qwenLayerImage(captured,id,assets,images,correction),crop,native);
      if(documentRef.current!==current)throw new Error('作品が変更されました。生成対象を選び直してください');
      return result.image;
    };
    setVoiceOpen(true);
    const panel=current.manga.pages[pageIndex]?.panels[panelIndex];
    const poseEditorContext:GenerationPoseEditorContext|undefined=captured.figure?{
      onConfirmed:(selection, framing)=>{
        const opened=qwenGenerationRef.current;
        if (!opened || opened.document!==current || documentRef.current!==current) throw new Error('作品が変更されました。生成対象を選び直してください');
        const updated=cloneDocument(current), page=updated.manga.pages[pageIndex];
        const figure=(overlay?page.page_overlay:page.panels[panelIndex])?.figures?.[captured.index];
        if (!figure) throw new Error('対象の人物が見つかりません');
        figure.human_pose=selection;
        figure.size=framing;
        const session=paintSessionRef.current;
        if (session?.document===current) {
          const refreshed={...session,document:updated};
          paintSessionRef.current=refreshed;setPaintSession(refreshed);
        }
        current=updated;
        lastHistoryPush.current=0;
        setDocument(updated);
        const generation={...opened,document:updated};
        qwenGenerationRef.current=generation;setQwenGeneration(generation);
      },
      stages:current.manga.background_stages,
      ...(!overlay&&panel?{panelContext:{panel,selectedIndex:captured.index,assets,dpi:getOutputSettings(current.manga).dpi,
        guides:Object.fromEntries((panel.figures??[]).map((_,i)=>[`figure-${i}`,artworkGuideVisible(`figure-${i}`,panelIndex,pageIndex,false,current)]))},
        backgroundCaptures:(panel.background_images??[]).flatMap((item,i)=>item.paint?.background3d?[{label:`このコマの背景 ${i+1}`,capture:item.paint.background3d}]:[])}:{}),
    }:undefined;
    const next={id:crypto.randomUUID(),plan,poseEditorContext,layers:qwenLayerCandidates(captured),loadLayer,document:current,pageIndex,panelIndex,overlay,owner,agentRequest,...(textSource?{textSource:{target:textSource.target,position:textSource.position}}:{})};
    qwenGenerationRef.current=next;setQwenGeneration(next);
  };
  const requestOwnerGeneration = async(key?:string,overlay=selectedElement?.scope==='page_overlay',panelIndex=activePanel,pageIndex=activePage,agentRequest?:QwenAgentRequest) => {
    if(qwenGenerationRef.current||qwenPreparing.current||imageImportBusy||projectOperation.current)return;
    const session=paintSessionRef.current;
    if(session){
      if(session.pageIndex===pageIndex&&session.panelIndex===panelIndex&&session.overlay===Boolean(overlay)){await paintController.current?.generate(key);return;}
      try{await paintController.current?.close();}catch{return;}
    }
    qwenPreparing.current=true;
    const current=documentRef.current;
    try {
      const scene=makePaintScene(current,panelIndex,pageIndex,overlay),owner=scene.owners.find(o=>o.key===(key??selectedPaintOwner()));
      if(!owner)throw new Error('生成対象のフォルダが見つかりません');
      if(agentRequest&&(owner.kind==='figure'||owner.kind==='bubble'))setAgentWorkTarget({pageIndex,panelIndex,selection:{type:owner.kind,index:owner.index,scope:overlay?'page_overlay':'panel'}});
      await prepareQwen(current,pageIndex,panelIndex,overlay,owner,undefined,[],agentRequest);
      return true;
    }catch(error){setToast(error instanceof Error?error.message:'生成の準備ができませんでした');return false;}finally{qwenPreparing.current=false;}
  };
  async function requestTextGeneration(kind:'bubble'|'screen_text',index:number,overlay:boolean,panelIndex:number,pageIndex=activePage){
    endTextEdit();
    if(kind==='bubble')return requestOwnerGeneration(`bubble-${index}`,overlay,panelIndex,pageIndex);
    if(qwenGenerationRef.current||qwenPreparing.current||imageImportBusy||projectOperation.current)return;
    qwenPreparing.current=true;
    try{
      if(paintSessionRef.current)await paintController.current?.close();
      const current=documentRef.current,target:CanvasTextTarget={pageIndex,panelIndex,index,overlay,kind},position=screenTextPosition(target),preview=cloneDocument(current);
      const converted=ensureCanvasTextOwner(preview,target,position);
      if(!converted)throw new Error('生成する写植文字が見つかりません');
      const owner=makePaintScene(preview,panelIndex,pageIndex,overlay).owners.find(item=>item.key===`bubble-${converted.index}`);
      if(!owner)throw new Error('生成する文字のフォルダが見つかりません');
      await prepareQwen(current,pageIndex,panelIndex,overlay,owner,undefined,[],undefined,{target,position,document:preview});
    }catch(error){setToast(error instanceof Error?error.message:'文字の生成を準備できませんでした');}
    finally{qwenPreparing.current=false;}
  }
  const requestCompositionGeneration = async(scope:QwenCompositionScope,panelIndex:number,pageIndex:number) => {
    if(qwenGenerationRef.current||qwenPreparing.current||imageImportBusy||projectOperation.current)return;
    qwenPreparing.current=true;
    try {
      if(paintSessionRef.current)await paintController.current?.close();
      const current=documentRef.current;
      const guides:Record<string,boolean>={};
      current.manga.pages[pageIndex].panels.forEach((panel,index)=>['background',...(panel.figures??[]).map((_,i)=>`figure-${i}`),...panel.bubbles.map((_,i)=>`bubble-${i}`)].forEach(key=>{guides[`${index}:${key}`]=artworkGuideVisible(key,index,pageIndex,false,current);}));
      const overlay=current.manga.pages[pageIndex].page_overlay;
      [...(overlay?.figures??[]).map((_,i)=>`figure-${i}`),...(overlay?.bubbles??[]).map((_,i)=>`bubble-${i}`)].forEach(key=>{guides[`overlay:${key}`]=artworkGuideVisible(key,0,pageIndex,true,current);});
      const plan=buildQwenCompositionPlan(current.manga,pageIndex,panelIndex,scope,guides);
      setToast('生成用の紙面を準備しています…');
      plan.compositionImage=await captureQwenComposition(current.manga,pageIndex,panelIndex,scope,guides);
      if(documentRef.current!==current)throw new Error('作品が変更されました。生成する範囲を選び直してください');
      const next={id:crypto.randomUUID(),plan,layers:[],loadLayer:async()=>{throw new Error('全体生成では紙面を参照します');},document:current,pageIndex,panelIndex,overlay:false};
      qwenGenerationRef.current=next;setQwenGeneration(next);setVoiceOpen(true);setToast('');
    }catch(error){setToast(error instanceof Error?error.message:'全体生成を準備できませんでした');}
    finally{qwenPreparing.current=false;}
  };

  return { requestOwnerGeneration, prepareQwen, requestCompositionGeneration, requestTextGeneration };
}
