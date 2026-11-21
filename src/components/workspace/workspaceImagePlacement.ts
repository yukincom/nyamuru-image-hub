import type { WorkspaceState } from './useWorkspaceState';
import { panelLocked, ownerItemLocked } from '../../lib/panelLayers';
import type { BBox, ImageAsset, CanvasElementSelection, MangaDocument } from '../../types';
import { panelBounds, fallbackBox } from '../../lib/canvasGeometry';
import { artworkLocked } from '../../lib/paintLock';
import { overlayFallbackBox } from '../../lib/pageCanvas';
import type { PaintScene } from '../../lib/paintDocument';
import { hasAdoptedPaintImages, insertGeneratedPaintImage, generatedPaintName } from '../../lib/paintDocument';
import { beginFigureCropImport, loadFigureCropAsset, saveFigureCropAssets, deleteFigureCropAssets } from '../../lib/figureCropStore';
import { prepareImageAsset, createImagePlacement, createFrameArtwork, setFigureArtwork } from '../../lib/imagePlacement';
import { cloneDocument } from '../../lib/manga';
import { ensureCanvasTextOwner } from '../../lib/canvasText';
import { humanPoseOwnerImage } from '../../lib/humanPoseComposition';
import type { QwenGenerationPlan, QwenAdoption } from '../../lib/qwenGeneration';
import { currentGenerationPreferences } from '../../lib/generationPreferences';
import { currentLocalModelPreferences } from '../../lib/localModelPreferences';
import { resolveGenerationRoute } from '../../lib/modelRouting';
import { buildCloudGenerationSpec } from '../../lib/generationHandoff';
import { generateCloudPageWithGemini, generateCloudSingleWithGemini } from '../../lib/localBridge';
import { compileArtworkRules, getArtworkSettings, getWorkNegativePrompt } from '../../lib/artworkRules';
import type { CloudSingleGenerationStart } from '../generation/createGenerationActions';
import { splitPageBackgroundsForDocument, splitPageImageForDocument } from '../../lib/cloudPageSplit';

interface Context {
  selectedPaintOwner: () => string;
  setDocument: (next: MangaDocument, record?: boolean) => void;
  openPaint?: (initialOwner?: string, panelIndex?: number, pageIndex?: number, overlay?: boolean) => boolean;
  makePaintScene?: (current: MangaDocument, panelIndex: number, pageIndex: number, overlay: boolean) => PaintScene & { generatedImageSequence: number };
}

export interface SplitPanelCharacterPlacement {
  pageIndex: number;
  panelIndex: number;
  targetKind?: 'figure' | 'background';
  figureIndex?: number;
  file: File;
  frameMm?: BBox;
}

export function createImagePlacementActions({
  activePanel, activePage, documentRef, imageImportBusy, imageImportTarget, setActivePage, setActivePanel,
  setSelectedPanels, placedImageInput, selectedElement, projectOperation, qwenGeneration, paintSessionRef,
  paintController, setImageImportBusy, lastHistoryPush, activePageRef, activePanelRef, setSelectedElement,
  setToast, setQwenGeneration, pendingLayerAction, setBubblePathTool, setTextTool, setZoomTool, boundEpisodeWorkspace,
}: WorkspaceState, {
  selectedPaintOwner, setDocument, openPaint, makePaintScene,
}: Context) {
  const registerAsset = async (next: MangaDocument, newStorageIds: string[], prepared: ImageAsset, blob: Blob) => {
    const existing = next.manga.image_assets?.find(asset => asset.sha256 === prepared.sha256);
    const cached = existing ? await loadFigureCropAsset(existing.storageId) : null;
    // A fresh cache ID also reloads already-mounted missing-image views.
    const asset = existing && cached ? existing : existing ? { ...existing, storageId: prepared.storageId } : prepared;
    if (!cached) {
      newStorageIds.push(asset.storageId);
      await saveFigureCropAssets([{ id: asset.storageId, blob: blob.slice(0, blob.size, asset.mediaType) }]);
    }
    if (!existing) (next.manga.image_assets ??= []).push(asset);
    else next.manga.image_assets = next.manga.image_assets?.map(item => item.id === asset.id ? asset : item);
    return asset;
  };
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
      const register = async (prepared: ImageAsset, blob: Blob) => {
        const existing = next.manga.image_assets?.find(asset => asset.sha256 === prepared.sha256);
        const cached = existing ? await loadFigureCropAsset(existing.storageId) : null;
        // A fresh cache ID also reloads already-mounted missing-image views.
        const asset = existing && cached ? existing : existing ? { ...existing, storageId: prepared.storageId } : prepared;
        if (!cached) {
          newStorageIds.push(asset.storageId);
          await saveFigureCropAssets([{ id: asset.storageId, blob: blob.slice(0, blob.size, asset.mediaType) }]);
        }
        if (!existing) (next.manga.image_assets ??= []).push(asset);
        else next.manga.image_assets = next.manga.image_assets?.map(item => item.id === asset.id ? asset : item);
        return asset;
      };
      const asset=await register(prepared,file);
      const targetPage = next.manga.pages[target.pageIndex];
      let placement = target.scope === 'page' && !target.generationScope ? createImagePlacement(asset, target.box) : createFrameArtwork(asset, target.box);
      let insertedGeneratedLayerId: string | undefined;
      if(target.generatedOwner){
        const adoption=target.generatedAdoption;
        if(target.generatedOwner.paint.layers.length+files.length>64)throw new Error('1つのグループには64レイヤーまで追加できます');
        let generated=target.generatedOwner,sequence=next.manga.generated_image_sequence??0;
        for(const [index,source] of files.entries()){
          const image=index===0?asset:await register(await prepareImageAsset(source),source);
          const inserted=insertGeneratedPaintImage(generated,image,generatedPaintName(sequence++),target.box,
            {folderId:target.generatedFolderId,...(adoption?{generation:{jobId:adoption.jobId,candidateIndex:adoption.indices[index]}}:{})});
          generated=inserted.owner;
          insertedGeneratedLayerId=inserted.layer.id;
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
      return insertedGeneratedLayerId;
    } catch (error) {
      if (newStorageIds.length) void deleteFigureCropAssets(newStorageIds).catch(() => undefined);
      setToast(error instanceof Error ? error.message : '画像を取り込めませんでした');
      if(explicitTarget)throw error;
    } finally { setImageImportBusy(false); finishImageImport(); }
  };
  const openInsertedGeneratedLayer = (
    ownerKey: string,
    insertedLayerId: string | undefined,
    panelIndex: number,
    pageIndex: number,
    overlay: boolean,
  ) => {
    if (!insertedLayerId || typeof openPaint !== 'function') return;
    pendingLayerAction.current = { type: 'select', key: ownerKey, id: insertedLayerId, directSelection: true };
    if (!openPaint(ownerKey, panelIndex, pageIndex, overlay)) pendingLayerAction.current = null;
  };
  const insertQwenImage = async(file:File|File[],generationPlan?:QwenGenerationPlan,adoption?:QwenAdoption) => {
    const target=qwenGeneration;
    if(!target||documentRef.current!==target.document||projectOperation.current||imageImportBusy)throw new Error('作品が変更されました。差し込み先を選び直してください');
    const {pageIndex,panelIndex,overlay,owner}=target,plan=generationPlan??target.plan,session=paintSessionRef.current;
    if(plan.scope){
      await importPlacedImage(file,{document:target.document,pageIndex,panelIndex,scope:plan.scope,generationScope:plan.scope,box:plan.outputFrame!});
      if(typeof setTextTool==='function')setTextTool(false);
      if(typeof setZoomTool==='function')setZoomTool(false);
      if(typeof setBubblePathTool==='function')setBubblePathTool('node');
      setQwenGeneration(null);setToast(`${plan.label}の生成画像を配置しました`);return;
    }
    if(!owner)throw new Error('生成対象がありません');
    const placement=plan.outputFrame&&plan.referenceFrame?{frame:plan.outputFrame,referenceFrame:plan.referenceFrame,...(plan.folderId?{folderId:plan.folderId}:{})}:plan.folderId?{frame:owner.frame,referenceFrame:owner.frame,folderId:plan.folderId}:undefined;
    if(session){
      if(session.pageIndex!==pageIndex||session.panelIndex!==panelIndex||session.overlay!==overlay||!paintController.current)throw new Error('描画先が変更されています。差し込み先を選び直してください');
      await paintController.current.insertImage(file,owner.key,placement,adoption);
    }else{
      const insertedLayerId=await importPlacedImage(file,{document:target.document,pageIndex,panelIndex,scope:overlay?'page_overlay':'panel',
        figureIndex:owner.kind==='figure'?owner.index:undefined,bubbleIndex:owner.kind==='bubble'?owner.index:undefined,box:{...(placement?.frame??owner.frame)},generatedOwner:owner,generatedAdoption:adoption,generatedFolderId:plan.folderId,...(target.textSource?{textSource:target.textSource}:{})});
      if(typeof openInsertedGeneratedLayer==='function')openInsertedGeneratedLayer(owner.key,insertedLayerId,panelIndex,pageIndex,overlay);
    }
    if(!adoption)setQwenGeneration(null);
    setToast(`${Array.isArray(file)?file.length+'枚の生成画像':file.name} を${owner.label}のあたりの上に新規レイヤーとして追加しました`);
  };

  const importSplitPanelCharacters = async (items: SplitPanelCharacterPlacement[]) => {
    if (!items.length || projectOperation.current || imageImportBusy || !makePaintScene) return { placed: 0, skippedLocked: 0 };
    const initialDocument = documentRef.current;
    setImageImportBusy(true);
    const newStorageIds: string[] = [];
    const finishImageImport = beginFigureCropImport();
    try {
      const next = cloneDocument(initialDocument);
      let sequence = next.manga.generated_image_sequence ?? 0;
      let placed = 0;
      let skippedLocked = 0;
      for (const item of items) {
        const targetPage = next.manga.pages[item.pageIndex];
        const targetPanel = targetPage?.panels[item.panelIndex];
        if (!targetPage || !targetPanel) continue;
        if (item.targetKind === 'background') {
          if (panelLocked(targetPanel) || targetPanel.layer?.backgroundLocked === true || targetPanel.background_images?.some(image => image.locked)) {
            skippedLocked += 1;
            continue;
          }
          const scene = makePaintScene(next, item.panelIndex, item.pageIndex, false);
          const owner = scene.owners.find(entry => entry.kind === 'background');
          if (!owner) continue;
          if (owner.paint.layers.length + 1 > 64) throw new Error('1つのグループには64レイヤーまで追加できます');
          const prepared = await prepareImageAsset(item.file);
          const asset = await registerAsset(next, newStorageIds, prepared, item.file);
          const inserted = insertGeneratedPaintImage(owner, asset, generatedPaintName(sequence++), item.frameMm ?? owner.frame);
          const hiddenGuideOwner = {
            ...inserted.owner,
            paint: {
              ...inserted.owner.paint,
              layers: inserted.owner.paint.layers.map(layer =>
                layer.id !== inserted.layer.id && (layer.guide || layer.name === 'あたり · 背景')
                  ? { ...layer, visible: false }
                  : layer,
              ),
            },
          };
          const composite = await humanPoseOwnerImage(hiddenGuideOwner, next.manga.image_assets ?? []);
          const flatFile = new File([composite], `${item.file.name}-layers.png`, { type: 'image/png' });
          const flat = await registerAsset(next, newStorageIds, await prepareImageAsset(flatFile), composite);
          const placement = { ...createFrameArtwork(flat, hiddenGuideOwner.frame), paint: hiddenGuideOwner.paint };
          targetPanel.background_images = [placement];
          placed += 1;
          continue;
        }
        const figure = item.figureIndex !== undefined ? targetPanel.figures?.[item.figureIndex] : undefined;
        if (!figure) continue;
        if (panelLocked(targetPanel) || figure.locked || artworkLocked(figure.artwork)) {
          skippedLocked += 1;
          continue;
        }
        const scene = makePaintScene(next, item.panelIndex, item.pageIndex, false);
        const owner = scene.owners.find(entry => entry.kind === 'figure' && entry.index === item.figureIndex);
        if (!owner) continue;
        if (owner.paint.layers.length + 1 > 64) throw new Error('1つのグループには64レイヤーまで追加できます');
        const prepared = await prepareImageAsset(item.file);
        const asset = await registerAsset(next, newStorageIds, prepared, item.file);
        const inserted = insertGeneratedPaintImage(owner, asset, generatedPaintName(sequence++), item.frameMm ?? owner.frame);
        const hiddenGuideOwner = {
          ...inserted.owner,
          paint: {
            ...inserted.owner.paint,
            layers: inserted.owner.paint.layers.map(layer =>
              layer.id !== inserted.layer.id && (layer.guide || layer.name === 'キャラクターあたり')
                ? { ...layer, visible: false }
                : layer,
            ),
          },
        };
        const composite = await humanPoseOwnerImage(hiddenGuideOwner, next.manga.image_assets ?? []);
        const flatFile = new File([composite], `${item.file.name}-layers.png`, { type: 'image/png' });
        const flat = await registerAsset(next, newStorageIds, await prepareImageAsset(flatFile), composite);
        const placement = { ...createFrameArtwork(flat, hiddenGuideOwner.frame), paint: hiddenGuideOwner.paint };
        setFigureArtwork(figure, placement);
        placed += 1;
      }
      if (documentRef.current !== initialDocument) throw new Error('取り込み中に作品が変更されたため、やり直してください');
      next.manga.generated_image_sequence = sequence;
      if (placed > 0) {
        lastHistoryPush.current = 0;
        setDocument(next);
        newStorageIds.length = 0;
        lastHistoryPush.current = 0;
      }
      setToast(
        placed > 0
          ? skippedLocked > 0
            ? `${placed}人のキャラクターを配置しました（ロック中${skippedLocked}件をスキップ）`
            : `${placed}人のキャラクターを配置しました`
          : skippedLocked > 0
            ? `配置先がロックされているため配置できませんでした（${skippedLocked}件）`
            : '配置できるキャラクターが見つかりませんでした',
      );
      return { placed, skippedLocked };
    } catch (error) {
      if (newStorageIds.length) void deleteFigureCropAssets(newStorageIds).catch(() => undefined);
      setToast(error instanceof Error ? error.message : '分割画像を取り込めませんでした');
      throw error;
    } finally {
      setImageImportBusy(false);
      finishImageImport();
    }
  };

  const generatePageWithCloudApi = async (pageIndex = activePage, isCurrent?: () => boolean) => {
    const currentDoc = documentRef.current;
    const page = currentDoc.manga.pages[pageIndex];
    if (!page) throw new Error('対象のページが見つかりません');
    const prefs = currentGenerationPreferences();
    const route = resolveGenerationRoute(prefs, currentLocalModelPreferences(), Boolean(currentDoc.manga.series_setting?.adult_content));
    if (route.kind === 'unavailable') throw new Error(route.message);
    if (route.kind !== 'cloud-api') throw new Error('環境設定の画像生成先を「クラウドAPI」に設定してください');
    setToast(`${page.page}ページ目をクラウドAPIで生成中…`);
    const cloudSpec = buildCloudGenerationSpec(currentDoc);
    const workspaceToken = boundEpisodeWorkspace?.episodeId === currentDoc.manga.meta.episode_id ? boundEpisodeWorkspace.token : undefined;
    const { file } = await generateCloudPageWithGemini({
      workspaceToken,
      seriesId: currentDoc.manga.meta.series_id,
      pageNumber: page.page,
      model: route.model,
      cloudSpec,
    });
    if (isCurrent && !isCurrent()) throw new Error('操作が中断されました');
    const placements: SplitPanelCharacterPlacement[] = [];
    const splitChars = await splitPageImageForDocument(file, page, true);
    for (const item of splitChars) {
      placements.push({
        pageIndex,
        panelIndex: item.panelIndex,
        targetKind: 'figure',
        figureIndex: item.figureIndex,
        file: item.file,
        frameMm: item.frameMm,
      });
    }
    if (prefs.cloud.includeBackground) {
      const splitBgs = await splitPageBackgroundsForDocument(file, page);
      for (const item of splitBgs) {
        if ((page.panels[item.panelIndex]?.figures?.length ?? 0) === 0) {
          placements.push({
            pageIndex,
            panelIndex: item.panelIndex,
            targetKind: 'background',
            file: item.file,
            frameMm: item.frameMm,
          });
        }
      }
    }
    if (!placements.length) throw new Error('配置できるキャラクターまたはコマが見つかりませんでした');
    const result = await importSplitPanelCharacters(placements);
    return { pageNumber: page.page, ...result };
  };

  const startCloudSingleGeneration = async (params: CloudSingleGenerationStart) => {
    const target = qwenGeneration;
    if (!target) throw new Error('生成対象が見つかりません');
    const { pageIndex, panelIndex, overlay, owner, textSource } = target;
    const sourceManga = target.document.manga;
    const episodeId = sourceManga.meta.episode_id;
    const plan = params.plan;
    const targetKind = plan.scope === 'page'
      ? 'page'
      : plan.scope === 'panel'
        ? 'panel'
        : plan.contentKind
          ? plan.contentKind
          : owner?.kind === 'background'
            ? 'background'
            : owner?.figure && !plan.characterKeys.length
              ? 'prop'
              : 'figure';
    const artwork = compileArtworkRules(getArtworkSettings(sourceManga), plan.contentKind ? 'handwritten' : 'character');
    const negativePrompt = getWorkNegativePrompt(sourceManga);
    const panel = sourceManga.pages[pageIndex]?.panels[panelIndex];
    const backgroundDescription = owner?.kind === 'background'
      ? (owner.description || panel?.background_description || sourceManga.setting.location || '')
      : '';
    const cutoutWhiteBackground = targetKind === 'figure' || targetKind === 'prop' || targetKind === 'handwritten' || targetKind === 'typeset';
    const ownerKey = owner?.key ?? plan.ownerKey;
    const placementFrame = plan.outputFrame ?? owner?.frame;
    const referenceFrame = plan.referenceFrame ?? owner?.frame;

    setToast(`「${plan.label}」をクラウドAPIへ送信しました。完了後に自動配置します…`);

    void (async () => {
      try {
        const { file } = await generateCloudSingleWithGemini({
          model: params.model,
          targetKind,
          label: plan.label,
          characterName: owner?.figure?.name || plan.label,
          action: plan.figureAction,
          backgroundDescription,
          literalText: plan.literalText,
          outputFormat: sourceManga.meta.format,
          styleNotes: artwork.style_notes,
          negativePrompt,
          width: plan.width,
          height: plan.height,
          cutoutWhiteBackground,
          characterReferences: params.references.map(ref => ({ label: ref.label, image: ref.image })),
          referenceImage: params.reference?.image,
          poseImage: params.poseImage,
          correctionImage: params.correction?.image,
          compositionImage: plan.compositionImage,
        });
        const liveDoc = documentRef.current;
        if (liveDoc.manga.meta.episode_id !== episodeId) {
          setToast(`別の作品に切り替わったため、「${plan.label}」の自動配置を中止しました`);
          return;
        }
        if (plan.scope) {
          await importPlacedImage(file, {
            document: liveDoc,
            pageIndex,
            panelIndex,
            scope: plan.scope,
            generationScope: plan.scope,
            box: plan.outputFrame!,
          });
          setToast(`「${plan.label}」の生成画像を配置しました`);
          return;
        }
        if (!owner || !placementFrame || !referenceFrame) return;
        const session = paintSessionRef.current;
        if (session && session.pageIndex === pageIndex && session.panelIndex === panelIndex && session.overlay === overlay && paintController.current) {
          await paintController.current.insertImage(file, ownerKey, {
            frame: placementFrame,
            referenceFrame,
            ...(plan.folderId ? { folderId: plan.folderId } : {}),
            hideGuides: true,
          });
          setToast(`「${plan.label}」の生成画像を配置し、あたりを非表示にしました`);
          return;
        }
        if (!makePaintScene) return;
        const newStorageIds: string[] = [];
        const finishImageImport = beginFigureCropImport();
        setImageImportBusy(true);
        try {
          const next = cloneDocument(liveDoc);
          if (textSource) {
            ensureCanvasTextOwner(next, textSource.target, textSource.position);
          }
          const scene = makePaintScene(next, panelIndex, pageIndex, overlay);
          const liveOwner = scene.owners.find(entry => entry.key === ownerKey);
          if (!liveOwner) throw new Error('差し込み先のあたりが見つかりません');
          if (liveOwner.paint.layers.length + 1 > 64) throw new Error('1つのグループには64レイヤーまで追加できます');
          const prepared = await prepareImageAsset(file);
          const asset = await registerAsset(next, newStorageIds, prepared, file);
          let sequence = next.manga.generated_image_sequence ?? 0;
          const inserted = insertGeneratedPaintImage(liveOwner, asset, generatedPaintName(sequence++), placementFrame, {
            ...(plan.folderId ? { folderId: plan.folderId } : {}),
          });
          const hiddenGuideOwner = {
            ...inserted.owner,
            paint: {
              ...inserted.owner.paint,
              layers: inserted.owner.paint.layers.map(layer =>
                layer.id !== inserted.layer.id && (layer.guide || layer.name === 'キャラクターあたり' || layer.name === 'あたり · 背景')
                  ? { ...layer, visible: false }
                  : layer,
              ),
            },
          };
          next.manga.generated_image_sequence = sequence;
          const composite = await humanPoseOwnerImage(hiddenGuideOwner, next.manga.image_assets ?? []);
          const flatFile = new File([composite], `${file.name}-layers.png`, { type: 'image/png' });
          const flat = await registerAsset(next, newStorageIds, await prepareImageAsset(flatFile), composite);
          const placement = { ...createFrameArtwork(flat, hiddenGuideOwner.frame), paint: hiddenGuideOwner.paint };
          const targetPage = next.manga.pages[pageIndex];
          if (liveOwner.kind === 'figure') {
            const container = overlay ? targetPage.page_overlay : targetPage.panels[panelIndex];
            const figure = container?.figures?.[liveOwner.index];
            if (!figure) throw new Error('差し替えるあたりが見つかりません');
            placement.locked = figure.artwork?.locked === true;
            setFigureArtwork(figure, placement);
          } else if (liveOwner.kind === 'bubble') {
            const container = overlay ? targetPage.page_overlay : targetPage.panels[panelIndex];
            const bubble = container?.bubbles?.[liveOwner.index];
            if (!bubble) throw new Error('読み込み先のあたりが見つかりません');
            placement.locked = bubble.paint_overlay?.locked === true;
            const { id: _id, bbox, ...artworkPart } = placement;
            bubble.bbox = bbox;
            bubble.paint_overlay = artworkPart;
          } else {
            placement.locked = liveOwner.locked === true;
            targetPage.panels[panelIndex].background_images = [placement];
          }
          if (documentRef.current.manga.meta.episode_id !== episodeId) return;
          lastHistoryPush.current = 0;
          setDocument(next);
          newStorageIds.length = 0;
          lastHistoryPush.current = 0;
          setToast(`「${plan.label}」の生成画像を配置し、あたりを非表示にしました`);
        } catch (placementError) {
          if (newStorageIds.length) void deleteFigureCropAssets(newStorageIds).catch(() => undefined);
          throw placementError;
        } finally {
          setImageImportBusy(false);
          finishImageImport();
        }
      } catch (error) {
        setToast(`クラウドAPI生成に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  };

  return { choosePlacedImage, importPlacedImage, importSplitPanelCharacters, generatePageWithCloudApi, startCloudSingleGeneration, chooseOwnerImage, insertQwenImage, openInsertedGeneratedLayer };
}
