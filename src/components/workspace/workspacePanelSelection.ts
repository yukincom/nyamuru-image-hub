import type { CanvasElementSelection, MangaPage, MangaDocument, Panel } from '../../types';
import { panelGeometryLocked } from '../../lib/panelLayers';
import { cloneDocument } from '../../lib/manga';
import { mergeSelectedPanels, splitPanel } from '../../lib/panelTemplates';
import type { WorkspaceState } from './useWorkspaceState';

interface Actions {
  endTextEdit: () => void;
  layerTransition: (action: () => void | Promise<void>) => Promise<void>;
  page: MangaPage;
  setDocument: (next: MangaDocument, record?: boolean) => void;
  panel: Panel;
  panelGutters: { rowGapMm: number; columnGapMm: number; };
}

export function createPanelSelection({
  setActivePanel, setSelectedPanels, activePanel, setSelectedElement, selectedPanels, activePage,
  paintSessionRef, paintController, setCanvasSelectionScrollRequest, documentRef, setInspectorCollapsed,
  setMobileStoryboardPane, pendingCanvasElementSelection, setActivePage, setToast, panelSplitDirection,
}: WorkspaceState, {
  endTextEdit, layerTransition, page, setDocument, panel, panelGutters,
}: Actions) {
  const selectCanvasPanel = (index: number, additive = false) => {
    endTextEdit();
    if (!additive) {
      setActivePanel(index);
      setSelectedPanels([index]);
      if (index === activePanel) setSelectedElement(null);
      return;
    }
    const next = selectedPanels.includes(index)
      ? selectedPanels.length > 1 ? selectedPanels.filter((item) => item !== index) : selectedPanels
      : [...selectedPanels, index].sort((left, right) => left - right);
    setSelectedPanels(next);
    setActivePanel(next.includes(index) ? index : next.includes(activePanel) ? activePanel : next[next.length - 1]);
    setSelectedElement(null);
  };

  const selectCanvasElement = (selection: CanvasElementSelection | null, panelIndex?: number, pageIndex = activePage, revealDetails = true) => {
    if(paintSessionRef.current&&pageIndex!==paintSessionRef.current.pageIndex){
      void layerTransition(async()=>{
        await paintController.current?.close();
        if(!paintSessionRef.current)selectCanvasElement(selection,panelIndex,pageIndex,revealDetails);
      });
      return;
    }
    if (selection) {
      setCanvasSelectionScrollRequest((current) => current + 1);
      const selectedBubble=selection.type==='bubble'?(selection.scope==='page_overlay'?documentRef.current.manga.pages[pageIndex]?.page_overlay:documentRef.current.manga.pages[pageIndex]?.panels[panelIndex??activePanel])?.bubbles?.[selection.index]:undefined;
      if ((selection.type === 'figure'||selectedBubble?.shape==='handwritten') && revealDetails) {
        setInspectorCollapsed(false);
        if (!paintSessionRef.current && window.matchMedia('(max-width: 800px)').matches) setMobileStoryboardPane('panel');
      }
    }
    if (pageIndex !== activePage || (panelIndex !== undefined && panelIndex !== activePanel)) {
      pendingCanvasElementSelection.current = selection;
      setActivePage(pageIndex);
      setActivePanel(panelIndex ?? 0);
      setSelectedPanels([panelIndex ?? 0]);
    }
    setSelectedElement(selection);
  };

  const mergeSelectedPanelGroup = () => {
    if (selectedPanels.length < 2) {
      setToast('Shift+クリックで合体するコマを2つ以上選択してください');
      return;
    }
    if(selectedPanels.some(index=>page?.panels[index]&&panelGeometryLocked(page.panels[index]))){
      setToast('固定中のコマは合体できません');
      return;
    }
    endTextEdit();
    const next = cloneDocument(documentRef.current);
    const mergedIndex = mergeSelectedPanels(next.manga.pages[activePage], selectedPanels);
    if (mergedIndex === null) return;
    setDocument(next);
    setActivePanel(mergedIndex);
    setSelectedPanels([mergedIndex]);
    setSelectedElement(null);
    setToast(`${selectedPanels.length}コマを吹き出しごと合体しました`);
  };

  const splitActivePanel = () => {
    if (!page || !panel) return;
    if(panelGeometryLocked(panel)){setToast('固定中のコマは分割できません');return;}
    endTextEdit();
    const next = cloneDocument(documentRef.current);
    const splitIndices = splitPanel(next.manga.pages[activePage], activePanel, panelSplitDirection, panelGutters);
    if (!splitIndices) {
      setToast('このコマは現在の間隔幅では小さすぎるため分割できません');
      return;
    }
    setDocument(next);
    setActivePanel(splitIndices[0]);
    setSelectedPanels(splitIndices);
    setSelectedElement(null);
    setToast(panelSplitDirection === 'vertical' ? 'コマをタテに分割しました' : 'コマをヨコに分割しました');
  };
  return { selectCanvasElement, mergeSelectedPanelGroup, selectCanvasPanel, splitActivePanel };
}
