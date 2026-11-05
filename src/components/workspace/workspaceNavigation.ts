import type { WorkspaceTab, MangaDocument, MangaPage, Panel } from '../../types';
import { cloneDocument } from '../../lib/manga';
import { useEffect } from 'preact/hooks';
import { restoreProvisionalScenarioText, detachResolvedScenarioLinks, type ScenarioBubbleLocation, confirmScenarioCorrespondence, rejectScenarioCorrespondence } from '../../lib/scenario.ts';
import { ownerItemLocked, panelLocked } from '../../lib/panelLayers';
import { type PanelMaterialLinkTarget, setPanelMaterialLink } from '../../lib/panelMaterialLinks';
import type { WorkspaceState } from './useWorkspaceState';

interface Actions {
  setDocument: (next: MangaDocument, record?: boolean) => void;
  page: MangaPage;
  panel: Panel;
}

export function useWorkspaceNavigation({
  materialLinkTarget, setMaterialLinkTarget, setTab, setSidebarCollapsed, paintSession, paintController,
  setToast, document, documentRef, activePage, activePanel, setSelectedElement, setActivePage,
  setActivePanel, setSelectedPanels, setMobileStoryboardPane,
}: WorkspaceState, {
  setDocument, page, panel,
}: Actions) {
  const changeTab = (next: WorkspaceTab) => {
    const change=()=>{
      if (materialLinkTarget) {
        const expectedTab = materialLinkTarget.materialType === 'background' ? 'setting' : 'props';
        if (next !== expectedTab) setMaterialLinkTarget(null);
      }
      setTab(next);
      if (next !== 'storyboard' && window.innerWidth < 800) setSidebarCollapsed(true);
    };
    if(paintSession){void paintController.current?.close().then(change).catch(error=>setToast(error instanceof Error?error.message:'画面を切り替えられませんでした'));return;}
    change();
  };
  const mutate = (recipe: (draft: MangaDocument) => void) => { const next = cloneDocument(document); recipe(next); setDocument(next); };

  // Also repair a project already open while the development UI is hot-reloaded.
  useEffect(() => {
    const next = cloneDocument(document);
    const restored = restoreProvisionalScenarioText(next);
    const detached = detachResolvedScenarioLinks(next);
    if (restored || detached) setDocument(next);
  }, []);

  const chooseScenarioBubble = (location: ScenarioBubbleLocation, sourceIds: readonly string[] | null) => {
    const currentPage=documentRef.current.manga.pages[location.pageIndex],currentPanel=location.overlay?undefined:currentPage?.panels[location.panelIndex];
    const currentBubble=location.overlay?currentPage?.page_overlay?.bubbles?.[location.bubbleIndex]:currentPanel?.bubbles[location.bubbleIndex];
    if(!currentBubble||ownerItemLocked(currentBubble)||(currentPanel&&panelLocked(currentPanel)))return;
    mutate((draft) => {
      if (sourceIds) confirmScenarioCorrespondence(draft, location, sourceIds);
      else {
        const page = draft.manga.pages[location.pageIndex];
        const bubble = location.overlay ? page?.page_overlay?.bubbles?.[location.bubbleIndex] : page?.panels[location.panelIndex]?.bubbles[location.bubbleIndex];
        if (bubble) rejectScenarioCorrespondence(bubble);
      }
    });
  };

  const openMaterialsForPanel = (materialType: PanelMaterialLinkTarget['materialType']) => {
    if (!page || !panel || panelLocked(panel)) return;
    setMaterialLinkTarget({ pageIndex: activePage, panelIndex: activePanel, materialType });
    setSelectedElement(null);
    setTab(materialType === 'background' ? 'setting' : 'props');
    if (window.innerWidth < 800) setSidebarCollapsed(true);
  };

  const toggleMaterialForPanel = (materialKey: string, linked: boolean) => {
    if (!materialLinkTarget) return;
    mutate((draft) => {
      const target=draft.manga.pages[materialLinkTarget.pageIndex]?.panels[materialLinkTarget.panelIndex];
      if(!target||panelLocked(target))return;
      setPanelMaterialLink(draft, materialLinkTarget, materialKey, linked);
    });
  };

  const returnFromMaterials = () => {
    const target = materialLinkTarget;
    setMaterialLinkTarget(null);
    if (target) {
      const targetPage = document.manga.pages[target.pageIndex];
      if (targetPage) {
        const targetPanelIndex = Math.min(target.panelIndex, Math.max(0, targetPage.panels.length - 1));
        setActivePage(target.pageIndex);
        setActivePanel(targetPanelIndex);
        setSelectedPanels([targetPanelIndex]);
      }
    }
    setSelectedElement(null);
    setTab('storyboard');
    setMobileStoryboardPane('panel');
  };
  return { mutate, changeTab, chooseScenarioBubble, openMaterialsForPanel, toggleMaterialForPanel, returnFromMaterials };
}
