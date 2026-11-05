import type { WorkspaceState } from './useWorkspaceState';
import { getPrintSetup } from '../../lib/printSettings';
import { newPage, MAX_PANELS_PER_PAGE, newPanel, cloneDocument } from '../../lib/manga';
import { panelLocked, ownerItemLocked } from '../../lib/panelLayers';
import { panelDisplayLabel, textDisplayLabel } from '../../lib/displayLabels';
import { type CanvasTextTarget, canvasTextEditable, removeCanvasText, canvasTextAt } from '../../lib/canvasText';
import { artworkLocked } from '../../lib/paintLock';
import type { MangaDocument, MangaPage } from '../../types';

interface Context {
  endTextEdit: () => void;
  mutate: (recipe: (draft: MangaDocument) => void) => void;
  page: MangaPage;
  layerTransition: (action: () => void | Promise<void>) => Promise<void>;
  setDocument: (next: MangaDocument, record?: boolean) => void;
}

export function createPageEditActions({
  setActivePage, setActivePanel, setSelectedPanels, setTab, setMobileStoryboardPane, activePage,
  activePanel, document, setToast, autoPaintResume, setSelectedElement, documentRef, paintSessionRef,
  paintController, createdText, lastHistoryPush,
}: WorkspaceState, {
  endTextEdit, mutate, page, layerTransition, setDocument,
}: Context) {
  const addPage = () => {endTextEdit();mutate((draft) => { const index = draft.manga.pages.length; const setup = getPrintSetup(draft.manga); draft.manga.pages.push(newPage(index + 1, { w: setup.width_mm, h: setup.height_mm })); setActivePage(index); setActivePanel(0); setSelectedPanels([0]); setTab('storyboard'); setMobileStoryboardPane('editor'); });};
  const duplicatePage = () => {
    if (!page) return;
    endTextEdit();
    mutate((draft) => { const copy = structuredClone(draft.manga.pages[activePage]); draft.manga.pages.splice(activePage + 1, 0, copy); draft.manga.pages.forEach((item, index) => { item.page = index + 1; }); setActivePage(activePage + 1); setSelectedPanels([activePanel]); });
  };
  const deletePage = () => {
    if (document.manga.pages.length <= 1 || !confirm(`ページ ${activePage + 1} を削除しますか？`)) return;
    endTextEdit();
    mutate((draft) => { draft.manga.pages.splice(activePage, 1); draft.manga.pages.forEach((item, index) => { item.page = index + 1; }); setActivePage(Math.max(0, activePage - 1)); setActivePanel(0); setSelectedPanels([0]); });
  };
  const reorderPage = (from: number, to: number) => {
    if (from === to) return;
    endTextEdit();
    mutate((draft) => {
      const pages = draft.manga.pages;
      const [moved] = pages.splice(from, 1);
      pages.splice(to, 0, moved);
      pages.forEach((item, index) => { item.page = index + 1; });
    });
    // 表示中のページが移動後どこへ行ったかを追従する
    const next = activePage === from ? to
      : activePage > from && activePage <= to ? activePage - 1
      : activePage < from && activePage >= to ? activePage + 1
      : activePage;
    setActivePage(next);
    setActivePanel(0);
    setSelectedPanels([0]);
    setToast(`ページ ${from + 1} を ${to + 1} 番目へ移動しました`);
  };
  const addPanel = () => {
    if (!page || page.panels.length >= MAX_PANELS_PER_PAGE) { setToast(`1ページに追加できるのは${MAX_PANELS_PER_PAGE}コマまでです`); return; }
    endTextEdit();
    mutate((draft) => { const page = draft.manga.pages[activePage]; const panels = page.panels; panels.push(newPanel(panels.length + 1, panels.length * 45, page.canvas)); setActivePanel(panels.length - 1); setSelectedPanels([panels.length - 1]); });
  };
  const deletePanelAt = (index:number) => {
    const target=document.manga.pages[activePage]?.panels[index];
    if (!target || panelLocked(target) || !confirm(`${panelDisplayLabel(target.id)} を削除しますか？`)) return;
    endTextEdit();
    autoPaintResume.current=null;
    mutate((draft) => { const panels = draft.manga.pages[activePage].panels; panels.splice(index, 1); panels.forEach((item, panelIndex) => { item.id = panelIndex + 1; }); const nextIndex = Math.max(0, Math.min(index - 1, panels.length - 1)); setActivePanel(nextIndex); setSelectedPanels(panels.length?[nextIndex]:[]);setSelectedElement(null); });
  };
  const deletePanel = () => deletePanelAt(activePanel);
  const deleteScreenTextAt=(panelIndex:number,index:number,overlay:boolean)=>{
    const target:CanvasTextTarget={pageIndex:activePage,panelIndex,index,overlay,kind:'screen_text'};
    if(!canvasTextEditable(documentRef.current,target))return;
    void layerTransition(async()=>{
      autoPaintResume.current=null;
      if(paintSessionRef.current)await paintController.current?.close();
      createdText.current=null;endTextEdit();
      const next=cloneDocument(documentRef.current);
      if(!removeCanvasText(next,target))return;
      lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;setSelectedElement(null);
    });
  };
  const deleteBubbleAt=(panelIndex:number,bubbleIndex:number,overlay=false)=>{
    const target:CanvasTextTarget={pageIndex:activePage,panelIndex,index:bubbleIndex,overlay,kind:'bubble'};
    const bubble=canvasTextAt(documentRef.current,target);
    const targetPanel=!overlay?documentRef.current.manga.pages[activePage]?.panels[panelIndex]:undefined;
    if(!bubble||ownerItemLocked(bubble)||('paint_overlay' in bubble&&artworkLocked(bubble.paint_overlay))||targetPanel&&panelLocked(targetPanel)||!confirm(`${overlay?'ページ前景':'コマ'}の${textDisplayLabel(bubbleIndex)}を削除しますか？`))return;
    void layerTransition(async()=>{
      autoPaintResume.current=null;
      if(paintSessionRef.current)await paintController.current?.close();
      endTextEdit();
      const next=cloneDocument(documentRef.current);
      if(!removeCanvasText(next,target))return;
      lastHistoryPush.current=0;setDocument(next);lastHistoryPush.current=0;
      setSelectedElement(null);
    });
  };

  return { deleteBubbleAt, deletePanelAt, addPanel, addPage, duplicatePage, deletePage, reorderPage, deleteScreenTextAt, deletePanel };
}
