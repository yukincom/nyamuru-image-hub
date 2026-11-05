import type { WorkspaceState } from './useWorkspaceState';
import { panelLocked, ownerItemLocked } from '../../lib/panelLayers';
import type { BBox, ImageAsset, CanvasElementSelection, MangaDocument } from '../../types';
import { panelBounds, fallbackBox } from '../../lib/canvasGeometry';
import { artworkLocked } from '../../lib/paintLock';
import { overlayFallbackBox } from '../../lib/pageCanvas';
import { hasAdoptedPaintImages, insertGeneratedPaintImage, generatedPaintName } from '../../lib/paintDocument';
import { beginFigureCropImport, loadFigureCropAsset, saveFigureCropAssets, deleteFigureCropAssets } from '../../lib/figureCropStore';
import { prepareImageAsset, createImagePlacement, createFrameArtwork, setFigureArtwork } from '../../lib/imagePlacement';
import { cloneDocument } from '../../lib/manga';
import { ensureCanvasTextOwner } from '../../lib/canvasText';
import { humanPoseOwnerImage } from '../../lib/humanPoseComposition';
import type { QwenGenerationPlan, QwenAdoption } from '../../lib/qwenGeneration';

interface Context {
  selectedPaintOwner: () => string;
  setDocument: (next: MangaDocument, record?: boolean) => void;
}

export function createImagePlacementActions({
  activePanel, activePage, documentRef, imageImportBusy, imageImportTarget, setActivePage, setActivePanel,
  setSelectedPanels, placedImageInput, selectedElement, projectOperation, qwenGeneration, paintSessionRef,
  paintController, setImageImportBusy, lastHistoryPush, activePageRef, activePanelRef, setSelectedElement,
  setToast, setQwenGeneration,
}: WorkspaceState, {
  selectedPaintOwner, setDocument,
}: Context) {
  const choosePlacedImage = (scope: 'page' | 'panel' | 'page_overlay', figureIndex?: number, panelIndex = activePanel, pageIndex = activePage, bubbleIndex?: number) => {
    const page = documentRef.current.manga.pages[pageIndex];
    const panel = page?.panels[panelIndex];
    if (!page || imageImportBusy || (scope === 'panel' && (!panel||panelLocked(panel)))) return;
    let box: BBox = scope === 'panel' ? panelBounds(panel!) : { x: 0, y: 0, w: page.canvas.w, h: page.canvas.h };
    if (figureIndex !== undefined) {
      const figure = scope === 'page_overlay' ? page.page_overlay?.figures?.[figureIndex] : panel?.figures?.[figureIndex];
      if (!figure || figure.locked||artworkLocked(figure.artwork)) return;
      box = figure.bbox ?? (scope === 'page_overlay' ? overlayFallbackBox(page.canvas, 'figure', figureIndex) : fallbackBox(panel!, 'figure', figureIndex));
    } else if (bubbleIndex !== undefined) {
      const bubble = scope === 'page_overlay' ? page.page_overlay?.bubbles?.[bubbleIndex] : panel?.bubbles[bubbleIndex];
      if (!bubble || ownerItemLocked(bubble)) return;
      box = bubble.bbox ?? (scope === 'page_overlay' ? overlayFallbackBox(page.canvas, 'bubble', bubbleIndex) : fallbackBox(panel!, 'bubble', bubbleIndex));
    } else if (scope === 'page_overlay') return;
    imageImportTarget.current = { document: documentRef.current, pageIndex, panelIndex, scope, figureIndex, bubbleIndex, box: { ...box } };
    setActivePage(pageIndex);
    setActivePanel(panelIndex);
    setSelectedPanels([panelIndex]);
    placedImageInput.current?.click();
  };
  const chooseOwnerImage = (key=selectedPaintOwner(),panelIndex=activePanel,pageIndex=activePage,overlay=selectedElement?.scope==='page_overlay'||selectedElement?.scope==='page') => {
    if(imageImportBusy||projectOperation.current||qwenGeneration)return;
    const session=paintSessionRef.current;
    if(session){
      if(session.pageIndex===pageIndex&&session.panelIndex===panelIndex&&session.overlay===Boolean(overlay)){paintController.current?.chooseImage(key);return;}
      void paintController.current?.close().then(()=>chooseOwnerImage(key,panelIndex,pageIndex,overlay)).catch(()=>{});return;
    }
    choosePlacedImage(overlay?'page_overlay':'panel',key.startsWith('figure-')?Number(key.slice(7)):undefined,panelIndex,pageIndex,key.startsWith('bubble-')?Number(key.slice(7)):undefined);
  };
  const importPlacedImage = async (inputFile?: File|File[], explicitTarget?:NonNullable<typeof imageImportTarget.current>) => {
    if (placedImageInput.current) placedImageInput.current.value = '';
    const files=inputFile?(Array.isArray(inputFile)?inputFile:[inputFile]):[],file=files[0];
    const target = explicitTarget??imageImportTarget.current;
    imageImportTarget.current = null;
    if (!file || !target) return;
    if(target.generatedOwner&&target.generatedAdoption&&hasAdoptedPaintImages(target.generatedOwner,target.generatedAdoption.jobId,target.generatedAdoption.indices))return;
    setImageImportBusy(true);
    const newStorageIds:string[]=[];
    const finishImageImport=beginFigureCropImport();
    try {
      const prepared = await prepareImageAsset(file);
      if (documentRef.current !== target.document) throw new Error('取り込み中に作品が変更されたため、配置先を選んでやり直してください');
      const next = cloneDocument(documentRef.current);
      if(target.textSource){
        const converted=ensureCanvasTextOwner(next,target.textSource.target,target.textSource.position);
        if(!converted||converted.index!==target.bubbleIndex)throw new Error('生成する写植文字の差し込み先が変わりました');
      }
      const register=async(prepared:ImageAsset,blob:Blob)=>{
        const existing=next.manga.image_assets?.find(asset=>asset.sha256===prepared.sha256);
        const cached=existing?await loadFigureCropAsset(existing.storageId):null;
        // A fresh cache ID also reloads already-mounted missing-image views.
        const asset=existing&&cached?existing:existing?{...existing,storageId:prepared.storageId}:prepared;
        if(!cached){newStorageIds.push(asset.storageId);await saveFigureCropAssets([{id:asset.storageId,blob:blob.slice(0,blob.size,asset.mediaType)}]);}
        if(!existing)(next.manga.image_assets??=[]).push(asset);
        else next.manga.image_assets=next.manga.image_assets?.map(item=>item.id===asset.id?asset:item);
        return asset;
      };
      const asset=await register(prepared,file);
      const targetPage = next.manga.pages[target.pageIndex];
      let placement = target.scope === 'page' && !target.generationScope ? createImagePlacement(asset, target.box) : createFrameArtwork(asset, target.box);
      if(target.generatedOwner){
        const adoption=target.generatedAdoption;
        if(target.generatedOwner.paint.layers.length+files.length>64)throw new Error('1つのグループには64レイヤーまで追加できます');
        let generated=target.generatedOwner,sequence=next.manga.generated_image_sequence??0;
        for(const [index,source] of files.entries()){
          const image=index===0?asset:await register(await prepareImageAsset(source),source);
          generated=insertGeneratedPaintImage(generated,image,generatedPaintName(sequence++),target.box,
            {folderId:target.generatedFolderId,...(adoption?{generation:{jobId:adoption.jobId,candidateIndex:adoption.indices[index]}}:{})}).owner;
        }
        next.manga.generated_image_sequence=sequence;
        const composite=await humanPoseOwnerImage(generated,next.manga.image_assets??[]);
        const flat=await register(await prepareImageAsset(new File([composite],`${file.name}-layers.png`,{type:'image/png'})),composite);
        placement={...createFrameArtwork(flat,generated.frame),paint:generated.paint};
      }
      if (documentRef.current !== target.document) throw new Error('取り込み中に作品が変更されたため、配置先を選んでやり直してください');
      if(target.generationScope)placement.generationScope=target.generationScope;
      let selection: CanvasElementSelection | null;
      if(target.generationScope){
        const images=target.generationScope==='page'?(targetPage.images??=[]):(targetPage.panels[target.panelIndex].images??=[]);
        images.push(placement);selection={type:'image',index:images.length-1,scope:target.generationScope};
      } else if (target.figureIndex !== undefined) {
        const owner = target.scope === 'page_overlay' ? targetPage.page_overlay : targetPage.panels[target.panelIndex];
        const figure = owner?.figures?.[target.figureIndex];
        if (!figure) throw new Error('差し替えるあたりが見つかりません');
        if(target.generatedOwner)placement.locked=figure.artwork?.locked===true;
        setFigureArtwork(figure, placement);
        selection = { type: 'figure', index: target.figureIndex, scope: target.scope };
      } else if (target.bubbleIndex !== undefined) {
        const owner = target.scope === 'page_overlay' ? targetPage.page_overlay : targetPage.panels[target.panelIndex];
        const bubble = owner?.bubbles?.[target.bubbleIndex];
        if (!bubble) throw new Error('読み込み先のあたりが見つかりません');
        if(target.generatedOwner)placement.locked=bubble.paint_overlay?.locked===true;
        const { id, bbox, ...artwork } = placement;
        bubble.bbox = bbox; bubble.paint_overlay = artwork;
        selection = { type: 'bubble', index: target.bubbleIndex, scope: target.scope };
      } else if (target.scope === 'panel') {
        if(target.generatedOwner)placement.locked=target.generatedOwner.locked===true;
        targetPage.panels[target.panelIndex].background_images = [placement];
        selection = null;
      } else {
        const owner = targetPage;
        const images = owner.images ??= [];
        images.push(placement);
        selection = { type: 'image', index: images.length - 1, scope: target.scope };
      }
      lastHistoryPush.current = 0;
      setDocument(next);
      newStorageIds.length=0;
      lastHistoryPush.current = 0;
      if (activePageRef.current === target.pageIndex && (target.scope !== 'panel' || activePanelRef.current === target.panelIndex)) setSelectedElement(selection);
      setToast(`${file.name} を読み込みました`);
    } catch (error) {
      if (newStorageIds.length) void deleteFigureCropAssets(newStorageIds).catch(() => undefined);
      setToast(error instanceof Error ? error.message : '画像を取り込めませんでした');
      if(explicitTarget)throw error;
    } finally { setImageImportBusy(false); finishImageImport(); }
  };
  const insertQwenImage = async(file:File|File[],generationPlan?:QwenGenerationPlan,adoption?:QwenAdoption) => {
    const target=qwenGeneration;
    if(!target||documentRef.current!==target.document||projectOperation.current||imageImportBusy)throw new Error('作品が変更されました。差し込み先を選び直してください');
    const {pageIndex,panelIndex,overlay,owner}=target,plan=generationPlan??target.plan,session=paintSessionRef.current;
    if(plan.scope){
      await importPlacedImage(file,{document:target.document,pageIndex,panelIndex,scope:plan.scope,generationScope:plan.scope,box:plan.outputFrame!});
      setQwenGeneration(null);setToast(`${plan.label}の生成画像を配置しました`);return;
    }
    if(!owner)throw new Error('生成対象がありません');
    const placement=plan.outputFrame&&plan.referenceFrame?{frame:plan.outputFrame,referenceFrame:plan.referenceFrame,...(plan.folderId?{folderId:plan.folderId}:{})}:plan.folderId?{frame:owner.frame,referenceFrame:owner.frame,folderId:plan.folderId}:undefined;
    if(session){
      if(session.pageIndex!==pageIndex||session.panelIndex!==panelIndex||session.overlay!==overlay||!paintController.current)throw new Error('描画先が変更されています。差し込み先を選び直してください');
      await paintController.current.insertImage(file,owner.key,placement,adoption);
    }else{
      await importPlacedImage(file,{document:target.document,pageIndex,panelIndex,scope:overlay?'page_overlay':'panel',
        figureIndex:owner.kind==='figure'?owner.index:undefined,bubbleIndex:owner.kind==='bubble'?owner.index:undefined,box:{...(placement?.frame??owner.frame)},generatedOwner:owner,generatedAdoption:adoption,generatedFolderId:plan.folderId,...(target.textSource?{textSource:target.textSource}:{})});
    }
    if(!adoption)setQwenGeneration(null);
    setToast(`${Array.isArray(file)?file.length+'枚の生成画像':file.name} を${owner.label}のあたりの上に新規レイヤーとして追加しました`);
  };

  return { choosePlacedImage, importPlacedImage, chooseOwnerImage, insertQwenImage };
}
