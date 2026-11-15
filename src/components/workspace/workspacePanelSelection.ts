import type { CanvasElementSelection, MangaPage, MangaDocument, Panel } from '../../types';
import { panelGeometryLocked } from '../../lib/panelLayers';
import { cloneDocument } from '../../lib/manga';
import { normalizeCanvasSelection, sameCanvasSelection, toggleCanvasSelection } from '../../lib/canvasSelection';
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
  setActivePanel, setSelectedPanels, activePanel, selectedElement, setSelectedElement, selectedElements, setSelectedElements, selectedPanels, activePage,
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

  const selectCanvasElement = (selection: CanvasElementSelection | null, panelIndex?: number, pageIndex = activePage, revealDetails = true, additive = false) => {
    if(paintSessionRef.current&&pageIndex!==paintSessionRef.current.pageIndex){
      void layerTransition(async()=>{
        await paintController.current?.close();
        if(!paintSessionRef.current)selectCanvasElement(selection,panelIndex,pageIndex,revealDetails,additive);
      });
      return;
    }
    if (additive && selection && pageIndex === activePage) {
      const baseList = selectedElements.length
        ? selectedElements
        : selectedElement
          ? [normalizeCanvasSelection(selectedElement, activePanel)]
          : [];
      const targetPanel = selection.scope === 'page_overlay' || selection.scope === 'page' ? activePanel : (panelIndex ?? activePanel);
      const item = normalizeCanvasSelection({ ...selection, ...(panelIndex !== undefined && selection.scope !== 'page_overlay' && selection.scope !== 'page' ? { panelIndex } : {}) }, targetPanel);
      const nextList = toggleCanvasSelection(baseList, item, activePanel);
      setSelectedElements(nextList);
      const last = nextList[nextList.length - 1] ?? null;
      if (last && last.scope !== 'page_overlay' && last.scope !== 'page' && last.panelIndex !== undefined && last.panelIndex !== activePanel) {
        setActivePanel(last.panelIndex);
        setSelectedPanels([last.panelIndex]);
      }
      setSelectedElement(last, false);
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
    if (selection) {
      const normalized = normalizeCanvasSelection({ ...selection, ...(panelIndex !== undefined && selection.scope !== 'page_overlay' && selection.scope !== 'page' ? { panelIndex } : {}) }, panelIndex ?? activePanel);
      setSelectedElements([normalized]);
      setSelectedElement(selection, false);
    } else {
      setSelectedElement(null);
    }
  };

  const selectCanvasElements = (selections: readonly CanvasElementSelection[], additive = false) => {
    const baseList = additive
      ? (selectedElements.length ? selectedElements : selectedElement ? [normalizeCanvasSelection(selectedElement, activePanel)] : [])
      : [];
    const merged = [...baseList];
    for (const entry of selections) {
      const normalized = normalizeCanvasSelection(entry, activePanel);
      if (!merged.some((item) => sameCanvasSelection(item, normalized, activePanel))) merged.push(normalized);
    }
    setSelectedElements(merged);
    const last = merged[merged.length - 1] ?? null;
    if (last && last.scope !== 'page_overlay' && last.scope !== 'page' && last.panelIndex !== undefined && last.panelIndex !== activePanel) {
      setActivePanel(last.panelIndex);
      setSelectedPanels([last.panelIndex]);
    }
    setSelectedElement(last, false);
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
  return { selectCanvasElement, selectCanvasElements, mergeSelectedPanelGroup, selectCanvasPanel, splitActivePanel };
}
