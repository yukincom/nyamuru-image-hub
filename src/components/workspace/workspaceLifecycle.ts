import { pruneFigureCropAssets, collectFigureCropAssetIds, onFigureCropAssetsChanged } from '../../lib/figureCropStore';
import type { WorkspaceSnapshot } from './workspaceTypes';
import { browserCatalogImageIds } from '../../lib/browserCatalog';
import { paintAssetIds } from '../../lib/paintDocument';
import { useEffect } from 'preact/hooks';
import { getPendingScannerSession, discardSeriesCatalogDraftOnPageExit } from '../../lib/localBridge';
import { stopNewCreationBridgeSessionOnPageExit } from '../../lib/localBridgeLifecycle.ts';
import { nextLayoutIndexFromArrow } from '../../lib/newLayoutPreview';
import type { WorkspaceState } from './useWorkspaceState';

interface Actions {
  chooseZoomTool: () => void;
  chooseTextTool: () => void;
  closeNewDialog: () => Promise<void>;
  deleteBubbleAt: (panelIndex: number, bubbleIndex: number, overlay?: boolean) => void;
  deletePanelAt: (index: number) => void;
  addDirectFolder: (index: number, overlay?: boolean, position?: import('../../lib/paintDocument').PaintAddPosition) => void;
  mergeSelectedPanelGroup: () => void;
  redo: () => void;
  undo: () => void;
}

export function useWorkspaceLifecycle({
  workspaceSnapshot, timeline, newCharacterDocumentRef, pendingPaintAssets, document, past, future,
  newCharacterDocument, paintSession, seriesCatalogSaving, pendingCanvasElementSelection,
  setSelectedElement, activePage, activePanel, newLayoutItemsRef, newLayoutItems, showNewDialog,
  scannerSessionRef, pendingScannerSession, setPendingScannerSession, newLayoutOperationGeneration,
  characterTextSyncTimer, newCharacterDraftSession, newCreationBridgeToken, characterEditorBridgeToken,
  toast, setToast, qwenGeneration, environmentOpen, imageExportDialog, saveProjectAction, hasDocument, tab,
  selectedElement, newLayoutTask, newLayoutActiveIndex, setNewLayoutActiveIndex, selectedPanels,
}: WorkspaceState, {
  chooseZoomTool, chooseTextTool, closeNewDialog, deleteBubbleAt, deletePanelAt, addDirectFolder,
  mergeSelectedPanelGroup, redo, undo,
}: Actions) {
  const prunePaintAssets = () => {
    void pruneFigureCropAssets([],() => {
      const snapshots:WorkspaceSnapshot[]=[workspaceSnapshot(),...timeline.current.past,...timeline.current.future];
      if(newCharacterDocumentRef.current)snapshots.push({document:newCharacterDocumentRef.current});
      return [...pendingPaintAssets.current,...browserCatalogImageIds(),...snapshots.flatMap(snapshot=>[
        ...collectFigureCropAssetIds(snapshot.document,snapshot.paint?.state.scene.owners.flatMap(owner=>paintAssetIds(owner.paint))),
        ...(snapshot.paint?.state.imports.map(item=>item.asset.storageId)??[]),
        ...(snapshot.paint?.state.stageImports.map(item=>item.stage.storageId)??[]),
      ])];
    }).catch(() => undefined);
  };

  useEffect(() => onFigureCropAssetsChanged(prunePaintAssets), []);
  useEffect(() => {
    prunePaintAssets();
  }, [document, past, future, newCharacterDocument, paintSession, seriesCatalogSaving]);


  useEffect(() => {
    const pending = pendingCanvasElementSelection.current;
    pendingCanvasElementSelection.current = null;
    setSelectedElement(pending);
  }, [activePage, activePanel]);

  useEffect(() => { newLayoutItemsRef.current = newLayoutItems; }, [newLayoutItems]);

  useEffect(() => {
    if (!showNewDialog || scannerSessionRef.current || pendingScannerSession) return;
    let ignored = false;
    void getPendingScannerSession()
      .then((pending) => { if (!ignored) setPendingScannerSession(pending); })
      .catch(() => undefined);
    return () => { ignored = true; };
  }, [showNewDialog, pendingScannerSession]);

  useEffect(() => () => {
    newLayoutOperationGeneration.current += 1;
    window.clearTimeout(characterTextSyncTimer.current);
    const draftSession = newCharacterDraftSession.current;
    newCharacterDraftSession.current = null;
    if (draftSession) discardSeriesCatalogDraftOnPageExit(draftSession.token);
    const token = newCreationBridgeToken.current;
    newCreationBridgeToken.current = null;
    if (token) stopNewCreationBridgeSessionOnPageExit(token);
    const characterToken = characterEditorBridgeToken.current;
    characterEditorBridgeToken.current = null;
    if (characterToken) stopNewCreationBridgeSessionOnPageExit(characterToken);
    // 強制終了・再読み込みではbridge側の復旧記録と元スキャンを残す。
    // 起動管理用の利用権だけを返し、元画像は明示的に閉じた場合だけ削除する。
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if(event.isComposing)return;
      if (qwenGeneration || environmentOpen || imageExportDialog) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 's') {
        event.preventDefault();
        void saveProjectAction.current();
        return;
      }
      if(hasDocument&&tab==='storyboard'&&!showNewDialog&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&(key==='t'||key==='z')&&!(event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable="true"]'))){event.preventDefault();if(key==='z')chooseZoomTool();else chooseTextTool();return;}
      if (paintSession) return;
      if (key === 'escape' && showNewDialog) { closeNewDialog(); return; }
      const target = event.target as HTMLElement | null;
      if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) return;
      if(tab==='storyboard'&&!showNewDialog&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&(key==='delete'||key==='backspace')){
        if(selectedElement?.type==='bubble'){
          event.preventDefault();
          deleteBubbleAt(activePanel,selectedElement.index,selectedElement.scope==='page_overlay');
        }else if(!selectedElement&&document.manga.pages[activePage]?.panels[activePanel]){
          event.preventDefault();
          deletePanelAt(activePanel);
        }
        return;
      }
      if(tab==='storyboard'&&!showNewDialog&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&key==='f'){
        event.preventDefault();addDirectFolder(activePanel,selectedElement?.scope==='page_overlay');return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'm' && tab === 'storyboard' && !showNewDialog) {
        event.preventDefault();
        mergeSelectedPanelGroup();
        return;
      }
      if (showNewDialog && newLayoutTask === 'idle' && newLayoutItems.length > 1 && event.key.startsWith('Arrow')) {
        const nextIndex = nextLayoutIndexFromArrow(newLayoutActiveIndex, event.key, newLayoutItems.length);
        if (nextIndex !== newLayoutActiveIndex) setNewLayoutActiveIndex(nextIndex);
        event.preventDefault();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if ((event.metaKey || event.ctrlKey) && key === 'y') { event.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [document, past, future, paintSession, qwenGeneration, showNewDialog, pendingScannerSession, newLayoutItems.length, newLayoutActiveIndex, newLayoutTask, selectedPanels, selectedElement, activePage, activePanel, tab, environmentOpen, imageExportDialog]);
}
