import type { MangaDocument, CanvasElementSelection } from '../../types';
import { synchronizeCatalogReferences } from '../../lib/catalogModel';
import { reconcileSplitOverlapFlags } from '../../lib/panelTemplates';
import { cloneDocument } from '../../lib/manga';
import { removeMaterialsFromSeriesCatalog } from '../../lib/seriesCatalog';
import type { WorkspaceSnapshot, WorkspacePaintSession } from './workspaceTypes';
import { canvasTextAt } from '../../lib/canvasText';
import type { WorkspaceState } from './useWorkspaceState';

interface Actions {
  imageGestureBoundary: (phase: 'start' | 'end', source?: 'text-size') => void;
  endTextEdit: () => void;
  selectCanvasElement: (selection: CanvasElementSelection | null, panelIndex?: number, pageIndex?: number, revealDetails?: boolean) => void;
}

export function createHistoryActions({
  imageGesture, lastHistoryPush, timeline, workspaceSnapshot, changedHistory, documentRef,
  setDocumentState, setHasDocument, createdText, pendingCanvasElementSelection, setEditingText,
  paintController, paintSessionRef, setPaintSession, activePage, setActivePage, activePanel,
  setActivePanel, setSelectedPanels, setSelectedElement, pendingLayerAction, setTab, setTextTool,
  setZoomTool, projectOperation, layerSwitch, imageImportBusy, qwenGeneration, setToast,
}: WorkspaceState, {
  imageGestureBoundary, endTextEdit, selectCanvasElement,
}: Actions) {
  const setDocument = (next: MangaDocument, record=true) => {
    next.manga.meta.page_count = next.manga.pages.length;
    synchronizeCatalogReferences(next);
    reconcileSplitOverlapFlags(next);
    const now = Date.now();
    if (record && (imageGesture.current.active ? !imageGesture.current.pushed : now - lastHistoryPush.current > 800)) {
      timeline.current.record(workspaceSnapshot());changedHistory();
      lastHistoryPush.current = now;
      if (imageGesture.current.active) imageGesture.current.pushed = true;
    }
    if(record&&timeline.current.future.length){timeline.current.record(workspaceSnapshot());changedHistory();}
    documentRef.current = next;
    setDocumentState(next);
    setHasDocument(true);
  };

  const replaceDocument = (next: MangaDocument) => {
    // The old indices must never clean up or edit objects in the incoming document.
    createdText.current=null;pendingCanvasElementSelection.current=null;setEditingText(null);imageGestureBoundary('end');
    next.manga.meta.page_count = next.manga.pages.length;
    synchronizeCatalogReferences(next);
    reconcileSplitOverlapFlags(next);
    timeline.current.clear();changedHistory();
    paintController.current=null;paintSessionRef.current=null;setPaintSession(null);
    lastHistoryPush.current = 0;
    documentRef.current = next;
    setDocumentState(next);
    setHasDocument(true);
  };

  const restoreDocument = (target: MangaDocument) => {
    endTextEdit();
    synchronizeCatalogReferences(target);
    reconcileSplitOverlapFlags(target);
    documentRef.current = target;
    setDocumentState(target);
    const pageIndex = Math.min(activePage, target.manga.pages.length - 1);
    setActivePage(pageIndex);
    const panelIndex = Math.min(activePanel, Math.max(0, (target.manga.pages[pageIndex]?.panels.length ?? 1) - 1));
    setActivePanel(panelIndex);
    setSelectedPanels([panelIndex]);
    setSelectedElement(null);
    lastHistoryPush.current = 0;
  };

  const patchLatestDocument = (recipe: (draft: MangaDocument) => boolean | void): MangaDocument => {
    const next = cloneDocument(documentRef.current);
    if (recipe(next) === false) return documentRef.current;
    setDocument(next);
    return next;
  };

  const finalizeDeletedSeriesMaterial = (catalogId: string, seriesId: string) => {
    const belongsToOperation = (source: MangaDocument) => source.manga.meta.series_id === seriesId;
    const withoutDeletedMaterial = (source: MangaDocument) => (
      belongsToOperation(source) ? removeMaterialsFromSeriesCatalog(source, [catalogId]) : source
    );
    const latest = documentRef.current;
    if (belongsToOperation(latest)) {
      const next = withoutDeletedMaterial(latest);
      documentRef.current = next;
      setDocumentState(next);
    }
    timeline.current.map(snapshot=>({...snapshot,document:withoutDeletedMaterial(snapshot.document)}));changedHistory();
  };

  const restoreWorkspace = (snapshot:WorkspaceSnapshot) => {
    restoreDocument(snapshot.document);
    const paint=snapshot.paint;
    paintController.current=null;pendingLayerAction.current=null;
    if(paint){
      const session:WorkspacePaintSession={document:snapshot.document,pageIndex:paint.pageIndex,panelIndex:paint.panelIndex,overlay:paint.overlay,title:paint.title,scene:{...paint.state.scene},resume:paint.state};
      paintSessionRef.current=session;setPaintSession(session);
      setActivePage(paint.pageIndex);setActivePanel(paint.panelIndex);setSelectedPanels([paint.panelIndex]);setTab('storyboard');setTextTool(false);setZoomTool(false);
    }else{
      paintSessionRef.current=null;setPaintSession(null);
      const text=snapshot.textSelection;
      if(text&&canvasTextAt(snapshot.document,text)){
        selectCanvasElement({type:text.kind,index:text.index,...(text.overlay?{scope:'page_overlay' as const}:{})},text.panelIndex,text.pageIndex,false);
        setSelectedPanels([text.panelIndex]);
      }
    }
    changedHistory();
  };
  const historyAvailable=()=>!projectOperation.current&&!layerSwitch.current&&!imageImportBusy&&!qwenGeneration&&(!paintSessionRef.current||paintController.current?.canRestore()!==false);
  const undo = () => {
    if(!historyAvailable())return;
    const target=timeline.current.undo(workspaceSnapshot());if(!target)return;
    restoreWorkspace(target);setToast('作業を元に戻しました');
  };
  const redo = () => {
    if(!historyAvailable())return;
    const target=timeline.current.redo(workspaceSnapshot());if(!target)return;
    restoreWorkspace(target);setToast('作業をやり直しました');
  };
  return { setDocument, redo, undo, patchLatestDocument, replaceDocument, historyAvailable, finalizeDeletedSeriesMaterial };
}
