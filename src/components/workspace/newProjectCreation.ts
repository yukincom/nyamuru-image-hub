import type { WorkspaceState } from './useWorkspaceState';
import { buildNewProjectPages } from './newProjectPages';
import type { PanelTemplate } from '../../lib/panelTemplates';
import type { DetectedPageLayout, NewLayoutTask } from '../../lib/newLayoutPreview';
import { beginFigureCropImport, deleteFigureCropAssets, saveFigureCropAssets } from '../../lib/figureCropStore';
import { isLanClient } from '../../lib/clientRuntime';
import { browserWorkspaces } from '../../lib/browserWorkspace';
import { prepareEpisodeWorkspace, persistAnalogAsset, analyzeFigureCharacterMatchWithLocalVlm, saveSourceCoverageReport, type SeriesCharacterTextLink } from '../../lib/localBridge';
import type { AnalogFigureImport, AnalogTextImport, MangaDocument, MangaSeriesSetting } from '../../types';
import { detectedFigureImport, detectedFigureCrops } from '../../lib/analogFigureCrops';
import { prepareDetectedTextCrops } from '../../lib/analogTextCrops';
import { toSeparatedMangaYaml } from '../../lib/manga';
import { withPrintSetup } from '../../lib/printSettings';
import {
  collectUnmatchedCharacterTargets, buildCharacterMatchCandidates, type CharacterReadOutcome,
  applyCharacterReadOutcomes,
} from '../../lib/characterMatching';
import { initializePanelBackgrounds } from '../../lib/panelContext.ts';
import { applyScenarioToNewDocument } from '../../lib/scenario.ts';
import { initializeImportedBubbleLineBreaks } from '../../lib/initialBubbleLineBreaks.ts';
import { separateBubbleOriginals } from '../../lib/bubbleOriginals';
import { buildSourceCoverageReport } from '../../lib/sourceCoverage.ts';

interface Context {
  updateNewLayoutTask: (task: NewLayoutTask) => void;
  commitActiveScannerSession: () => Promise<void>;
  discardScannerSources: () => Promise<void>;
  mergeSavedSeriesCatalog: (source: MangaDocument) => Promise<{ document: MangaDocument; added: number; warning: string; seriesSetting: MangaSeriesSetting; }>;
  syncCharacterText: (source: MangaDocument, archive?: { characterCatalogId: string; characterName: string; omnyYaml: string; }) => Promise<SeriesCharacterTextLink | null>;
  commitNewCharacterDraft: () => Promise<void>;
  endNewCreationBridgeSession: () => Promise<void>;
  replaceDocument: (next: MangaDocument) => void;
  setNewCharacterDocument: (next: MangaDocument | null) => void;
  discardNewLayoutItems: () => void;
}

export function createNewProjectAction({
  newLayoutTaskRef, newLayoutOperationGeneration, newPrintConfirmed, editingNewPrintSetup,
  newEpisodeWorkspace, setNewLayoutMessage, newLayoutItemsRef, newCharacterDocumentRef,
  persistAnalogAssets, newWorkTitle, newPrintSetup, newLayoutRowGapMm, newLayoutColumnGapMm, newSeriesName,
  newSeriesId, newEpisodeNumber, newLayoutFrameLineWidthMm, newWorkSetting, setNewCharacterReadProgress,
  newSourceSnapshot, newCharacterTextLink, setNewCharacterTextLink, lastHistoryPush,
  setBoundEpisodeWorkspace, setBoundSourceSnapshot, setSourceCoverageDecisions, setCharacterTextLink,
  setActivePage, setActivePanel, setSelectedPanels, setSelectedElement, setTab, setMobileStoryboardPane,
  setShowNewDialog, setToast,
}: WorkspaceState, {
  updateNewLayoutTask, commitActiveScannerSession, discardScannerSources, mergeSavedSeriesCatalog,
  syncCharacterText, commitNewCharacterDraft, endNewCreationBridgeSession, replaceDocument,
  setNewCharacterDocument, discardNewLayoutItems,
}: Context) {
  const createNewDocument = async (
    layout?: PanelTemplate | DetectedPageLayout[],
    confirmScannedLayouts = false,
    analysisGeneration?: number,
  ) => {
    const continuingAnalysis = analysisGeneration !== undefined;
    if (newLayoutTaskRef.current !== (continuingAnalysis ? 'analyzing' : 'idle')
      || (continuingAnalysis && analysisGeneration !== newLayoutOperationGeneration.current)
      || !newPrintConfirmed || editingNewPrintSetup) return;
    const finishImageImport=beginFigureCropImport();
    try {
    const generation = analysisGeneration ?? ++newLayoutOperationGeneration.current;
    const isCurrentOperation = () => generation === newLayoutOperationGeneration.current;
    updateNewLayoutTask('creating');
    if (!newEpisodeWorkspace) {
      setNewLayoutMessage('エピソードの保存先をもう一度選んでください。');
      updateNewLayoutTask('idle');
      return;
    }
    setNewLayoutMessage(isLanClient ? '作品を準備しています…' : '制作フォルダを準備しています…');
    try {
      if (isLanClient) await browserWorkspaces.prepare(newEpisodeWorkspace.token);
      else await prepareEpisodeWorkspace(newEpisodeWorkspace.token);
    } catch (error) {
      if (!isCurrentOperation()) return;
      setNewLayoutMessage(error instanceof Error ? error.message : '制作フォルダを準備できませんでした');
      updateNewLayoutTask('idle');
      return;
    }
    if (!isCurrentOperation()) return;
    const analyzedItems = [...newLayoutItemsRef.current];
    const detectedLayouts = Array.isArray(layout) ? layout : [];
    const template = layout && !Array.isArray(layout) ? layout : undefined;
    const characterDraft = newCharacterDocumentRef.current;
    const freshEpisodeId = characterDraft?.manga.meta.episode_id || crypto.randomUUID();
    const usedSourceItemIds = new Set(detectedLayouts.map((item) => item.sourceItemId));
    if (!detectedLayouts.length && template && analyzedItems[0]?.analysis) usedSourceItemIds.add(analyzedItems[0].id);
    const figureImportsByItem = new Map<string, Map<string, AnalogFigureImport>>();
    const textImportsByItem = new Map<string, Map<string, AnalogTextImport>>();
    const savedAssetIds: string[] = [];
    const discardStaleAssets = async () => {
      await deleteFigureCropAssets(savedAssetIds).catch(() => undefined);
    };
    try {
      for (const item of analyzedItems) {
        if (!usedSourceItemIds.has(item.id) || !item.analysis) continue;
        if (item.analysis.detectedFigures.length) {
          figureImportsByItem.set(item.id, new Map(item.analysis.detectedFigures.map(
            region => [region.id, detectedFigureImport(item.id, region)],
          )));
        }
        if (item.analysis.ocrLines.length) {
          setNewLayoutMessage(`${item.file.name} から手書き文字の参照画像を作っています…`);
          const prepared = await prepareDetectedTextCrops(item.file, item.rotationOverride, item.id, item.analysis.ocrLines);
          if (!isCurrentOperation()) { await discardStaleAssets(); return; }
          await saveFigureCropAssets(prepared.map((crop) => crop.asset));
          savedAssetIds.push(...prepared.map((crop) => crop.asset.id));
          if (!isLanClient && persistAnalogAssets) {
            for (const crop of prepared) {
              crop.metadata.persistentAsset = await persistAnalogAsset(
                crop.asset.blob,
                freshEpisodeId,
                newWorkTitle.trim(),
                'texts',
                crop.asset.id,
              );
            }
          }
          if (!isCurrentOperation()) { await discardStaleAssets(); return; }
          textImportsByItem.set(item.id, new Map(prepared.map((crop) => [crop.lineId, crop.metadata])));
        }
      }
    } catch (error) {
      await deleteFigureCropAssets(savedAssetIds).catch(() => undefined);
      if (!isCurrentOperation()) return;
      updateNewLayoutTask('idle');
      setNewLayoutMessage(`原画参照を保存できなかったため、原画は破棄していません。${error instanceof Error ? error.message : ''}`.trim());
      return;
    }
    const finishScannerImport = async () => {
      try {
        if (!isCurrentOperation()) { await discardStaleAssets(); return false; }
        if (confirmScannedLayouts) await commitActiveScannerSession();
        else await discardScannerSources();
        if (!isCurrentOperation()) { await discardStaleAssets(); return false; }
        return true;
      } catch (error) {
        await discardStaleAssets();
        if (isCurrentOperation()) {
          updateNewLayoutTask('idle');
          setNewLayoutMessage(error instanceof Error ? error.message : 'スキャン処理を完了できませんでした');
        }
        return false;
      }
    };
    if (!figureImportsByItem.size && !(await finishScannerImport())) return;
    const pageBuild = buildNewProjectPages({
      detectedLayouts, analyzedItems, template, figureImportsByItem, textImportsByItem,
      newPrintSetup, newLayoutRowGapMm, newLayoutColumnGapMm, newLayoutFrameLineWidthMm,
      newWorkTitle, newSeriesName, newSeriesId, newEpisodeNumber, freshEpisodeId, characterDraft, newWorkSetting,
    });
    const { fresh, importedFigureCount, importedTextCount } = pageBuild;
    let { reviewTextCount } = pageBuild;
    const seriesMerge = await mergeSavedSeriesCatalog(withPrintSetup(fresh, newPrintSetup));
    if (!isCurrentOperation()) { await discardStaleAssets(); return; }
    const characterReadTargets = collectUnmatchedCharacterTargets(seriesMerge.document);
    initializePanelBackgrounds(seriesMerge.document);
    const characterCandidates = buildCharacterMatchCandidates(seriesMerge.document.manga.characters);
    const characterReadOutcomes = new Map<string, CharacterReadOutcome>();
    const readTargetsByRegion = new Map(characterReadTargets.map(target => [target.sourceRegionId, target]));
    const persistedFigures = new Map<string, NonNullable<AnalogFigureImport['persistentAsset']>>();
    try {
      for (const item of analyzedItems) {
        const imports = figureImportsByItem.get(item.id);
        if (!imports || !item.analysis) continue;
        for await (const crop of detectedFigureCrops(item.file, item.rotationOverride, item.analysis.detectedFigures)) {
          const metadata = imports.get(crop.regionId)!;
          const target = readTargetsByRegion.get(metadata.sourceRegionId);
          if (target) {
            setNewLayoutMessage('人物と演技を読み取っています…');
            setNewCharacterReadProgress({ completed: characterReadOutcomes.size, total: characterReadTargets.length, startedAt: Date.now() });
            try {
              const suggestion = await analyzeFigureCharacterMatchWithLocalVlm(
                await crop.original(), characterCandidates, target.currentSize, await crop.face(),
              );
              const { candidateId, confidence, action, suggestedSize, reason, expressionReading } = suggestion;
              characterReadOutcomes.set(target.sourceRegionId, { ok: true, candidateId, confidence, action, suggestedSize, reason, expressionReading });
            } catch (error) {
              characterReadOutcomes.set(target.sourceRegionId, {
                ok: false,
                error: error instanceof Error ? error.message : '人物と演技を読み取れませんでした',
              });
            }
          }
          if (!isCurrentOperation()) { await discardStaleAssets(); return; }
          const blob = await crop.forStorage();
          if (!isCurrentOperation()) { await discardStaleAssets(); return; }
          await saveFigureCropAssets([{ id: metadata.assetId, blob }]);
          savedAssetIds.push(metadata.assetId);
          if (!isLanClient && persistAnalogAssets) {
            persistedFigures.set(metadata.assetId, await persistAnalogAsset(blob, freshEpisodeId, newWorkTitle.trim(), 'figures', metadata.assetId));
          }
          if (!isCurrentOperation()) { await discardStaleAssets(); return; }
        }
      }
    } catch (error) {
      await discardStaleAssets();
      if (!isCurrentOperation()) return;
      updateNewLayoutTask('idle');
      setNewLayoutMessage(`原画参照を保存できなかったため、原画は破棄していません。${error instanceof Error ? error.message : ''}`.trim());
      return;
    }
    if (figureImportsByItem.size && !(await finishScannerImport())) return;
    if (persistedFigures.size) {
      for (const page of seriesMerge.document.manga.pages) {
        for (const owner of [...page.panels, page.page_overlay]) {
          for (const figure of owner?.figures ?? []) {
            const metadata = figure.analogImport;
            const ref = metadata && persistedFigures.get(metadata.assetId);
            if (metadata && ref) metadata.persistentAsset = ref;
          }
        }
      }
    }
    setNewCharacterReadProgress(characterReadTargets.length ? { completed: characterReadTargets.length, total: characterReadTargets.length, startedAt: Date.now() } : null);
    const characterRead = applyCharacterReadOutcomes(seriesMerge.document, characterReadOutcomes);
    const scenarioResult = newSourceSnapshot
      && (isLanClient || newSourceSnapshot.workspaceDirectory === newEpisodeWorkspace?.directory)
      ? applyScenarioToNewDocument(seriesMerge.document, {
        version: 1, fileName: newSourceSnapshot.source.fileName, text: newSourceSnapshot.source.text,
      }) : null;
    if (seriesMerge.document.manga.scenario) reviewTextCount = scenarioResult?.review ?? 0;
    initializeImportedBubbleLineBreaks(seriesMerge.document);
    setNewLayoutMessage('原本ラスターとベクターの吹き出しを分離しています…');
    try {
      seriesMerge.document=await separateBubbleOriginals(seriesMerge.document);
      if(!isCurrentOperation()){await discardStaleAssets();return;}
    }catch(error){
      updateNewLayoutTask('idle');
      setNewLayoutMessage(error instanceof Error?error.message:'原本レイヤーを作成できませんでした');
      return;
    }
    setNewLayoutMessage('人物データの保存を確定しています…');
    try {
      if (newCharacterTextLink?.linked && characterDraft) {
        const synced = await syncCharacterText(characterDraft);
        if (synced) setNewCharacterTextLink(synced);
      }
      await commitNewCharacterDraft();
    } catch (error) {
      await discardStaleAssets();
      updateNewLayoutTask('idle');
      setNewLayoutMessage(`人物データの保存を確定できませんでした。${error instanceof Error ? error.message : ''}`.trim());
      return;
    }
    let coverageSaveWarning = '';
    if (!isLanClient && newEpisodeWorkspace && newSourceSnapshot && !seriesMerge.document.manga.scenario) {
      try {
        if (newSourceSnapshot.workspaceDirectory !== newEpisodeWorkspace.directory) {
          throw new Error('原文を選んだ保存先と現在のエピソード保存先が一致しません');
        }
        const initialCoverage = await buildSourceCoverageReport(
          newSourceSnapshot.source,
          seriesMerge.document,
          { omnyYaml: toSeparatedMangaYaml(seriesMerge.document) },
        );
        await saveSourceCoverageReport(
          newEpisodeWorkspace.token,
          seriesMerge.document.manga.meta.episode_id,
          initialCoverage,
        );
      } catch (error) {
        coverageSaveWarning = `原文確認reportは自動保存できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`;
      }
    }
    let bridgeStopWarning = '';
    setNewLayoutMessage('ローカル連携を終了しています…');
    try {
      await endNewCreationBridgeSession();
    } catch (error) {
      bridgeStopWarning = `ローカル連携を終了できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`;
    }
    lastHistoryPush.current = 0;
    replaceDocument(seriesMerge.document);
    setBoundEpisodeWorkspace({ ...newEpisodeWorkspace, episodeId: seriesMerge.document.manga.meta.episode_id });
    setBoundSourceSnapshot(newSourceSnapshot ? {
      ...newSourceSnapshot,
      episodeId: seriesMerge.document.manga.meta.episode_id,
      workspaceDirectory: newEpisodeWorkspace?.directory ?? '',
    } : null);
    setSourceCoverageDecisions([]);
    setCharacterTextLink(newCharacterTextLink);
    setActivePage(0); setActivePanel(0); setSelectedPanels([0]); setSelectedElement(null); setTab('storyboard'); setMobileStoryboardPane('editor'); setShowNewDialog(false);
    setNewCharacterDocument(null);
    discardNewLayoutItems();
    updateNewLayoutTask('idle');
    const creationMessage = detectedLayouts.length
      ? `検出したコマ領域から${detectedLayouts.length}ページを新規作成しました`
      : template ? `パターン${template.id}で新規作成しました` : 'まっさらな漫画を作成しました';
    const importedDetails = [
      importedFigureCount ? `人物あたり${importedFigureCount}件` : '',
      importedTextCount ? `文字候補${importedTextCount}件` : '',
      characterReadTargets.length ? `人物・演技${characterReadTargets.length}件` : '',
      seriesMerge.added ? `シリーズ共通人物・資料${seriesMerge.added}件` : '',
      scenarioResult?.matched ? `シナリオのセリフ${scenarioResult.matched}件` : '',
      scenarioResult?.actions ? `ト書き${scenarioResult.actions}コマ` : '',
    ].filter(Boolean).join('、');
    const completedMessage = importedDetails
      ? `${creationMessage}。${importedDetails}を配置しました${reviewTextCount || characterRead.needsReview ? `（${[reviewTextCount ? `OCR仮入力${reviewTextCount}件` : '', characterRead.needsReview ? `人物要確認${characterRead.needsReview}件` : ''].filter(Boolean).join('、')}）` : ''}${seriesMerge.warning ? `。${seriesMerge.warning}` : ''}`
      : `${creationMessage}${seriesMerge.warning ? `。${seriesMerge.warning}` : ''}`;
    const completionWarnings = [coverageSaveWarning, bridgeStopWarning].filter(Boolean).join('。');
    setToast(completionWarnings ? `${completedMessage}。${completionWarnings}` : completedMessage);
    } finally { finishImageImport(); }
  };

  return { createNewDocument };
}
