import { createDraftActions } from './newProjectDraft';
import { useSelectionDetails } from './workspaceSelectionDetails';
import { createHistoryActions } from './workspaceHistoryActions';
import { createPanelSelection } from './workspacePanelSelection';
import { useWorkspaceLifecycle } from './workspaceLifecycle';
import { useWorkspaceNavigation } from './workspaceNavigation';
import { useCharacterSync } from './workspaceCharacterSync';
import { useWorkspacePaintGuard } from './workspacePaintGuard';
import { useWorkspaceState } from './useWorkspaceState';
import { useEffect, useRef } from 'preact/hooks';
import { type WorkspaceStartupState } from '../../lib/workspaceStartup.ts';
import { createNewProjectAction } from './newProjectCreation';
import { createProjectFileActions } from './workspaceProjectFiles';
import { createImageExportActions } from './workspaceImageExport';
import { createNewProjectSessions } from './newProjectSessions';
import { createSeriesSelection } from './newSeriesSelection';
import { createSeriesReferenceActions } from './newSeriesReferences';
import { createWorkspaceSourceActions } from './episodeWorkspaceSources';
import { createSeriesPreparation } from './newSeriesPreparation';
import { createSeriesCatalogActions } from './seriesCatalogActions';
import { createEpisodeSettingActions } from './newEpisodeSettings';
import { createWorkspaceCatalogActions } from './workspaceCatalog';
import { createNewLayoutImportActions } from './newLayoutImportActions';
import { createPageEditActions } from './pageEditActions';
import { createWorkspacePaintSession } from './workspacePaintSession';
import { useWorkspaceTextActions } from './workspaceTextActions';
import { createLayerPaletteActions } from './layerPaletteActions';
import { createWorkspaceGeneration } from './workspaceGeneration';
import { createWorkspacePaintResults } from './workspacePaintResults';
import { createImagePlacementActions } from './workspaceImagePlacement';
import { createWorkspaceCanvasActions } from './workspaceCanvasActions';
import { createWorkspaceVoiceActions } from './workspaceVoiceActions';
import { initialTab } from './workspaceTabs';

export function useWorkspaceModel(startupWorkspace: WorkspaceStartupState) {
  const workspace = useWorkspaceState(startupWorkspace, initialTab, () => endTextEdit());
  const {
    documentRef, activePage, activePanel, qwenGeneration, selectedPanels, selectedElement,
    paintController, imageGesture, tab, materialLinkTarget, setMaterialLinkTarget, textTool, zoomTool,
    editingText, showGuides, innerFrameSnap, panelGapSnap, panelSync, spreadView, canvasZoomPercent,
    showNewDialog, newSeriesPreparing, newLayoutItems, newLayoutActiveIndex, newSeriesDirectorySelecting,
    newSeriesReferences, newSeriesReferenceCandidates, newSelectedSeriesReferencePaths,
    newSeriesReferenceSelecting, projectBusy, newWorkspaceSelecting, past, future,
  } = workspace;

  useEffect(() => {
    if (!materialLinkTarget) return;
    const expectedTab = materialLinkTarget.materialType === 'background' ? 'setting' : 'props';
    if (tab !== expectedTab) setMaterialLinkTarget(null);
  }, [tab, materialLinkTarget?.materialType]);

  const {
    updateNewLayoutTask, setNewCharacterDocument, clearNewSeriesReference, clearNewReferenceText,
  } = createDraftActions(workspace);

  const {
    page, panel, panelGutters, coverageWorkspace, selectedBubbleTarget, selectedBubbleStroke,
    bubbleLineWidthMm, spreadPartnerIndex, panelFrameLineWidthMm, getOmnySnapshot, materialLinkPanel,
  } = useSelectionDetails(workspace, {
    changeSelectedBubbleLineWidth: (...args) => changeSelectedBubbleLineWidth(...args),
  });

  const {
    setDocument, redo, undo, patchLatestDocument, replaceDocument, historyAvailable,
    finalizeDeletedSeriesMaterial,
  } = createHistoryActions(workspace, {
    imageGestureBoundary: (...args) => imageGestureBoundary(...args),
    endTextEdit: (...args) => endTextEdit(...args),
    selectCanvasElement: (...args) => selectCanvasElement(...args),
  });

  const {
    closeNewDialog, discardNewCharacterDraft, commitNewCharacterDraft, discardScannerSources,
    discardNewLayoutItems, finishScannerWatching, detachActiveScannerSession,
    discardPendingScannerRecovery, commitActiveScannerSession, endNewCreationBridgeSession,
    openNewDialog,
  } = createNewProjectSessions(workspace, {
    updateNewLayoutTask, setNewCharacterDocument, endTextEdit: () => endTextEdit(),
    clearNewSeriesReference,
  });

  const {
    selectCanvasElement, mergeSelectedPanelGroup, selectCanvasPanel, splitActivePanel,
  } = createPanelSelection(workspace, {
    endTextEdit: (...args) => endTextEdit(...args), layerTransition: (...args) => layerTransition(...args),
    page, setDocument, panel, panelGutters,
  });

  useWorkspaceLifecycle(workspace, {
    chooseZoomTool: (...args) => chooseZoomTool(...args),
    chooseTextTool: (...args) => chooseTextTool(...args), closeNewDialog,
    deleteBubbleAt: (...args) => deleteBubbleAt(...args),
    deletePanelAt: (...args) => deletePanelAt(...args),
    addDirectFolder: (...args) => addDirectFolder(...args), mergeSelectedPanelGroup, redo, undo,
  });

  const {
    mutate, changeTab, chooseScenarioBubble, openMaterialsForPanel, toggleMaterialForPanel,
    returnFromMaterials,
  } = useWorkspaceNavigation(workspace, {
    setDocument, page, panel,
  });

  const {
    workspaceRootKey, createNewCharacterDraft, mergeSavedSeriesCatalog, selectExistingSeries,
  } = createSeriesSelection(workspace, {
    clearNewReferenceText,
  });

  const {
    chooseLocalText, chooseNewSeriesDirectory, chooseNewSeriesReferenceTextFile,
    removeSelectedNewSeriesReferences, applySelectedNewSeriesReferences, chooseNewEpisodeWorkspace,
  } = createSeriesReferenceActions(workspace, {
    workspaceRootKey, clearNewReferenceText,
  });

  const {
    choosePanelDraftWorkspace, setCoverageSource, chooseCoverageWorkspaceSource, chooseCoverageWorkspace,
    saveCoverageReport, chooseNewReferenceTextFile, chooseNewCharacterImageFiles,
    chooseNewLayoutImageFiles,
  } = createWorkspaceSourceActions(workspace, {
    coverageWorkspace, readNewReferenceFile: selection => readNewReferenceFile(selection),
    chooseNewLayoutImages: files => chooseNewLayoutImages(files),
  });

  const {
    patchNewCharacterDocument, returnToSeriesSelection, continueFromSeriesSelection,
  } = createSeriesPreparation(workspace, {
    createNewCharacterDraft, setNewCharacterDocument, mergeSavedSeriesCatalog, discardNewCharacterDraft,
  });

  const {
    syncCharacterText, persistNewCharacterCatalog, persistSeriesCatalog, linkCharacterText,
    deleteSeriesCharacter, restoreDeletedCharacter,
  } = createSeriesCatalogActions(workspace, {
    setNewCharacterDocument, chooseLocalText,
  });

  useCharacterSync(workspace, {
    syncCharacterText,
  });

  const {
    readNewReferenceFile, continueFromNewCharacters, applySuggestedReferenceTexts, saveNewCharacters,
    continueFromNewSetting, updateNewSeriesSetting, updateNewWorkSetting,
  } = createEpisodeSettingActions(workspace, {
    persistNewCharacterCatalog, syncCharacterText, commitNewCharacterDraft, setNewCharacterDocument,
    patchNewCharacterDocument,
  });

  const {
    applyPreparedSeriesIdentifiers, importBackgroundModel, saveBackgroundsFromEditor,
    saveCharactersFromEditor,
  } = createWorkspaceCatalogActions(workspace, {
    setDocument, endTextEdit: () => endTextEdit(), persistSeriesCatalog, syncCharacterText,
    patchLatestDocument,
  });

  const { saveProject, exportOmny, openProject } = createProjectFileActions(workspace, {
    endTextEdit: () => endTextEdit(), persistSeriesCatalog, applyPreparedSeriesIdentifiers,
    replaceDocument, setDocument,
  });

  const {
    chooseNewLayoutImages, requestScannerFinish, launchScanner, updateNewLayoutGutter,
    updateNewLayoutFrameLineWidth, resumeScanner, discardRecoveredScans, rotateActiveLayoutImage,
    analyzeNewLayouts,
  } = createNewLayoutImportActions(workspace, {
    updateNewLayoutTask, discardScannerSources, discardNewLayoutItems,
    createNewDocument: (...args) => createNewDocument(...args), finishScannerWatching,
    detachActiveScannerSession, discardPendingScannerRecovery,
  });

  const { createNewDocument } = createNewProjectAction(workspace, {
    updateNewLayoutTask, commitActiveScannerSession, discardScannerSources, mergeSavedSeriesCatalog,
    syncCharacterText, commitNewCharacterDraft, endNewCreationBridgeSession, replaceDocument,
    setNewCharacterDocument, discardNewLayoutItems,
  });

  const {
    deleteBubbleAt, deletePanelAt, addPanel, addPage, duplicatePage, deletePage, reorderPage,
    deleteScreenTextAt, deletePanel,
  } = createPageEditActions(workspace, {
    endTextEdit: () => endTextEdit(), mutate, page, layerTransition: action => layerTransition(action),
    setDocument,
  });
  const {
    layerTransition, makePaintScene, openPaint, artworkGuideVisible, selectedPaintOwner,
    toggleArtworkGuide,
  } = createWorkspacePaintSession(workspace, {
    endTextEdit: () => endTextEdit(),
  });
  const {
    endTextEdit, changeSelectedBubbleLineWidth, chooseZoomTool, chooseTextTool, screenTextPosition,
    openBubbleMaterials, requestPcFonts, chooseBubblePathTool, closeTextTool, chooseLayoutTool,
    startBubbleEdit, applyBubbleMaterial, changeTextToolStyle, changeCanvasTextStyle, startTextEdit,
    createScreenTextAt, wrapScreenText, finishElementMove, changeCanvasText, canvasTextHistory,
    changeSelectedTextCategory, changeSelectedTextBody,
  } = useWorkspaceTextActions(workspace, {
    setDocument, imageGestureBoundary: (...args) => imageGestureBoundary(...args), layerTransition,
    selectCanvasElement, selectedBubbleTarget, undo, redo, selectCanvasPanel,
  });
  const {
    addDirectFolder, actOnLayer, toggleTextLayer, selectLayerOwner, reorderOwnerLayers, selectLayerPanel,
    togglePanelLayer, togglePanelLock, openPanelBackground3d,
  } = createLayerPaletteActions(workspace, {
    layerTransition, endTextEdit, selectCanvasElement, setDocument, makePaintScene, openPaint,
    persistPaintResults: (...args) => persistPaintResults(...args),
  });
  const {
    requestOwnerGeneration, prepareQwen, requestCompositionGeneration, requestTextGeneration,
  } = createWorkspaceGeneration(workspace, {
    setDocument, artworkGuideVisible, makePaintScene, selectedPaintOwner, endTextEdit, screenTextPosition,
  });
  const {
    openImageExportDialog, chooseImageExportFolder, exportPageRange,
  } = createImageExportActions(workspace, {
    endTextEdit,
  });
  const { persistPaintResults, applyPaint } = createWorkspacePaintResults(workspace, {
    setDocument,
  });
  const {
    choosePlacedImage, importPlacedImage, chooseOwnerImage, insertQwenImage,
  } = createImagePlacementActions(workspace, {
    selectedPaintOwner, setDocument,
  });
  const {
    imageGestureBoundary, togglePanelSync, toggleInnerFrameSnap, togglePanelGapSnap, changeShowGuides,
    changeSpreadView, selectPage, changePanelStyleNumber, changeElementBBox, changeBubbleTail, movePanel,
    resizePanel, movePanelVertex, movePanelEdge, movePageImageToPanel, changePersistAnalogAssets,
  } = createWorkspaceCanvasActions(workspace, {
    panel, page, mutate, setDocument, layerTransition, endTextEdit,
  });
  const voiceRevision=(withHistory=true)=>JSON.stringify({document:documentRef.current,activePage,activePanel,selectedElement,selectedPanels,tab,
    innerFrameSnap,panelGapSnap,panelSync,showGuides,spreadView,showNewDialog,projectBusy,qwenGeneration:Boolean(qwenGeneration),textTool,zoomTool,editingText,canvasZoomPercent,
    paint:paintController.current?.snapshot(),paintInteraction:paintController.current?.interactionRevision?.(),dragging:imageGesture.current.active,
    past:withHistory?past.length:undefined,future:withHistory?future.length:undefined});
  const latestVoiceRevision=useRef(voiceRevision);latestVoiceRevision.current=voiceRevision;
  const { applyVoiceCommand, inspectAgent, applyAgentBubbleEdit } = createWorkspaceVoiceActions(workspace, {
    historyAvailable, voiceRevision, setDocument, openBubbleMaterials, saveProject, undo, redo,
    togglePanelSync, toggleInnerFrameSnap, togglePanelGapSnap, changeShowGuides, changeSpreadView,
    latestVoiceRevision, requestOwnerGeneration, selectPage, mutate,
  });
  const activeLayoutItem = newLayoutItems[newLayoutActiveIndex] ?? null;
  const newSeriesReferenceRows = newSeriesReferenceCandidates.length ? newSeriesReferenceCandidates : newSeriesReferences;
  const selectedNewSeriesReferenceRows = newSeriesReferenceRows.filter(reference => newSelectedSeriesReferencePaths.includes(reference.relativePath));
  const newSeriesReferenceBusy = newSeriesReferenceSelecting || newSeriesDirectorySelecting || newSeriesPreparing || newWorkspaceSelecting;
  const hasScannedLayoutItems = newLayoutItems.some((item) => item.source === 'scanner');

  const { autoPaintBoundary, guardDuringPaint } = useWorkspacePaintGuard(workspace, {
    openPaint,
  });

  return {
    workspace,
    setDocument, exportOmny, changeShowGuides, changeSpreadView, changePanelStyleNumber, requestPcFonts,
    saveProject, actOnLayer, makePaintScene, selectedBubbleStroke, undo, redo, chooseBubblePathTool,
    chooseTextTool, closeTextTool, openBubbleMaterials, bubbleLineWidthMm, panel, addPanel,
    toggleInnerFrameSnap, togglePanelGapSnap, togglePanelSync, mergeSelectedPanelGroup, splitActivePanel,
    endTextEdit, openPaint, chooseLayoutTool, toggleTextLayer, selectLayerOwner, selectCanvasElement,
    reorderOwnerLayers, startBubbleEdit, artworkGuideVisible, toggleArtworkGuide, prepareQwen,
    applyPaint, autoPaintBoundary, guardDuringPaint, layerTransition, choosePlacedImage,
    openImageExportDialog, openNewDialog, openProject, importPlacedImage, chooseImageExportFolder,
    exportPageRange, voiceRevision, applyVoiceCommand, inspectAgent, applyAgentBubbleEdit,
    applyBubbleMaterial, changeTab, selectPage, addPage, duplicatePage, deletePage, reorderPage, page,
    spreadPartnerIndex, changeTextToolStyle, changeCanvasTextStyle, startTextEdit, createScreenTextAt,
    wrapScreenText, finishElementMove, changeCanvasText, canvasTextHistory, requestCompositionGeneration,
    requestOwnerGeneration, chooseOwnerImage, imageGestureBoundary, panelFrameLineWidthMm, panelGutters,
    selectCanvasPanel, changeElementBBox, changeBubbleTail, movePanel, resizePanel, movePanelVertex,
    movePanelEdge, deleteScreenTextAt, deleteBubbleAt, selectLayerPanel, togglePanelLayer,
    togglePanelLock, deletePanelAt, addDirectFolder, mutate, movePageImageToPanel,
    changeSelectedTextCategory, changeSelectedTextBody, requestTextGeneration, chooseScenarioBubble,
    openPanelBackground3d, getOmnySnapshot, choosePanelDraftWorkspace, openMaterialsForPanel,
    deletePanel, importBackgroundModel, saveBackgroundsFromEditor, materialLinkPanel,
    toggleMaterialForPanel, returnFromMaterials, saveCharactersFromEditor, patchLatestDocument,
    persistSeriesCatalog, finalizeDeletedSeriesMaterial, linkCharacterText, deleteSeriesCharacter,
    restoreDeletedCharacter, coverageWorkspace, setCoverageSource, chooseCoverageWorkspaceSource,
    chooseCoverageWorkspace, saveCoverageReport, closeNewDialog, returnToSeriesSelection,
    continueFromNewCharacters, continueFromSeriesSelection, clearNewReferenceText,
    clearNewSeriesReference, selectExistingSeries, chooseNewSeriesDirectory, newSeriesReferenceRows,
    newSeriesReferenceBusy, chooseNewSeriesReferenceTextFile, selectedNewSeriesReferenceRows,
    removeSelectedNewSeriesReferences, applySelectedNewSeriesReferences, chooseNewEpisodeWorkspace,
    chooseNewReferenceTextFile, applySuggestedReferenceTexts, setNewCharacterDocument, saveNewCharacters,
    patchNewCharacterDocument, persistNewCharacterCatalog, chooseNewCharacterImageFiles,
    continueFromNewSetting, updateNewSeriesSetting, updateNewWorkSetting, createNewDocument,
    chooseNewLayoutImageFiles, requestScannerFinish, launchScanner, changePersistAnalogAssets,
    updateNewLayoutGutter, updateNewLayoutFrameLineWidth, resumeScanner, discardRecoveredScans,
    chooseNewLayoutImages, activeLayoutItem, rotateActiveLayoutImage, analyzeNewLayouts,
    hasScannedLayoutItems, insertQwenImage,
  };
}
