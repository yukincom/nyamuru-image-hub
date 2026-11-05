import type { WorkspaceState } from './useWorkspaceState';
import { panelLocked, ownerItemLocked, panelGeometryLocked } from '../../lib/panelLayers';
import type { CanvasElementSelection, BBox, BubbleTailTarget, Panel, MangaPage, MangaDocument } from '../../types';
import { artworkLocked } from '../../lib/paintLock';
import { validImageBox } from '../../lib/imagePlacement';
import {
  INNER_FRAME_SNAP_KEY, PANEL_GAP_SNAP_KEY, PANEL_SYNC_KEY, SHOW_GUIDES_KEY, SPREAD_VIEW_KEY,
  PERSIST_ANALOG_ASSETS_KEY,
} from '../../lib/workspacePreferences';
import {
  clamp, translatePanel, syncPanelBleedAtTrim, resizePanelToBounds, movePanelVertexWithSnap,
  type PanelEdgeReference, movePanelEdge as movePanelEdgeGeometry,
} from '../../lib/canvasGeometry';
import { cloneDocument } from '../../lib/manga';
import { changeCanvasDefaultBubbleLineWidth } from '../../lib/canvasText';
import { getPrintSetup } from '../../lib/printSettings';

interface Context {
  panel: Panel;
  page: MangaPage;
  mutate: (recipe: (draft: MangaDocument) => void) => void;
  setDocument: (next: MangaDocument, record?: boolean) => void;
  layerTransition: (action: () => void | Promise<void>) => Promise<void>;
  endTextEdit: () => void;
}

export function createWorkspaceCanvasActions({
  imageGesture, lastHistoryPush, activePage, activePanel, setSelectedElement, innerFrameSnap,
  setInnerFrameSnap, panelGapSnap, setPanelGapSnap, panelSync, setPanelSync, setShowGuides, setSpreadView,
  setPersistAnalogAssets, documentRef, paintSessionRef, paintController, setTab, setMobileStoryboardPane,
  autoPaintResume, setActivePage, setActivePanel, setSelectedPanels,
}: WorkspaceState, {
  panel, page, mutate, setDocument, layerTransition, endTextEdit,
}: Context) {
  const imageGestureBoundary = (phase: 'start' | 'end', source?:'text-size') => {
    if(source&&(phase==='start'?imageGesture.current.source===source:imageGesture.current.source!==source))return;
    imageGesture.current = { active: phase === 'start', pushed: false, ...(phase==='start'&&source?{source}:{}) };
    lastHistoryPush.current = 0;
  };
  const movePageImageToPanel = (index: number) => {
    if (!panel || panelLocked(panel) || page?.images?.[index]?.locked) return;
    lastHistoryPush.current = 0;
    mutate(draft => {
      const targetPage = draft.manga.pages[activePage];
      const image = targetPage.images?.splice(index, 1)[0];
      if (!image) return;
      const images = targetPage.panels[activePanel].images ??= [];
      if (images.some(item => item.id === image.id)) image.id = crypto.randomUUID();
      images.push(image);
      setSelectedElement({ type: 'image', scope: 'panel', index: images.length - 1 });
    });
    lastHistoryPush.current = 0;
  };
  const changeElementBBox = (selection: CanvasElementSelection, bbox: BBox) => {
    if(selection.type==='panel_frame')return;
    mutate((draft) => {
      const targetPage = draft.manga.pages[activePage];
      if (selection.type === 'image') {
        const image = (selection.scope === 'page' ? targetPage?.images : targetPage?.panels[activePanel]?.images)?.[selection.index];
        if (image && !artworkLocked(image,(selection.scope==='page'?targetPage.page_overlay:targetPage.panels[activePanel])?.bubbles) && validImageBox(bbox)) image.bbox = bbox;
        return;
      }
      if (selection.scope === 'page_overlay') {
        const overlay = targetPage?.page_overlay;
        if (!overlay) return;
        if (selection.type === 'figure') {
          const figure = overlay.figures?.[selection.index];
          if (figure && !figure.locked&&!artworkLocked(figure.artwork)) {
            figure.bbox = bbox;
            if (figure.analogImport) figure.analogImport.userEdited = true;
          }
        } else if (selection.type === 'bubble') {
          const bubble = overlay.bubbles?.[selection.index];
          if (bubble&&!ownerItemLocked(bubble)&&!artworkLocked(bubble.paint_overlay)) bubble.bbox = bbox;
        } else if (selection.type === 'screen_text') {
          const screenText=overlay.screen_text?.[selection.index];
          if(screenText)screenText.bbox=bbox;
        }
        return;
      }
      const targetPanel = targetPage?.panels[activePanel];
      if (!targetPanel||panelLocked(targetPanel)) return;
      if (selection.type === 'figure') {
        const figure = targetPanel.figures?.[selection.index];
        if (figure && !figure.locked&&!artworkLocked(figure.artwork)) {
          figure.bbox = bbox;
          if (figure.analogImport) figure.analogImport.userEdited = true;
        }
      } else if (selection.type === 'screen_text') {
        const screenText = targetPanel.screen_text?.[selection.index];
        if (screenText) screenText.bbox = bbox;
      } else {
        const bubble = targetPanel.bubbles[selection.index];
        if (bubble&&!ownerItemLocked(bubble)&&!artworkLocked(bubble.paint_overlay)) bubble.bbox = bbox;
      }
    });
  };
  const toggleInnerFrameSnap = () => {
    const next = !innerFrameSnap;
    setInnerFrameSnap(next);
    try { localStorage.setItem(INNER_FRAME_SNAP_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const togglePanelGapSnap = () => {
    const next = !panelGapSnap;
    setPanelGapSnap(next);
    try { localStorage.setItem(PANEL_GAP_SNAP_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const togglePanelSync = () => {
    const next = !panelSync;
    setPanelSync(next);
    try { localStorage.setItem(PANEL_SYNC_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const changeShowGuides = (next: boolean) => {
    setShowGuides(next);
    try { localStorage.setItem(SHOW_GUIDES_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const changeSpreadView = (next: boolean) => {
    setSpreadView(next);
    try { localStorage.setItem(SPREAD_VIEW_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const changePersistAnalogAssets = (next: boolean) => {
    setPersistAnalogAssets(next);
    try { localStorage.setItem(PERSIST_ANALOG_ASSETS_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  const changePanelStyleNumber = (
    key: 'bubble_line_width_mm' | 'panel_frame_width_mm' | 'panel_gutter_row_mm' | 'panel_gutter_column_mm',
    value: number,
  ) => {
    if (!Number.isFinite(value)) return;
    const maximum = key === 'bubble_line_width_mm' ? 2 : key === 'panel_frame_width_mm' ? 5 : 20;
    const minimum = key === 'bubble_line_width_mm' || key === 'panel_frame_width_mm' ? 0.1 : 0;
    const normalized = Math.round(clamp(value, minimum, maximum) * 10) / 10;
    if (documentRef.current.manga.meta[key] === normalized) return;
    const apply=()=>{
      const next = cloneDocument(documentRef.current);
      if(key==='bubble_line_width_mm'){
        if(!changeCanvasDefaultBubbleLineWidth(next,normalized))return;
      }else next.manga.meta[key] = normalized;
      setDocument(next);
    };
    if(paintSessionRef.current){void layerTransition(async()=>{await paintController.current?.close();apply();});}
    else apply();
  };
  const changeBubbleTail = (selection: CanvasElementSelection, tail?: BubbleTailTarget, patch?:{bezier?:NonNullable<import('../../types').Bubble['bezier']>;tailRoot?:import('../../types').BubbleTailRoot;textPosition?:import('../../types').BubbleTextPosition}) => {
    if (selection.type !== 'bubble') return;
    const textOnly=!!patch?.textPosition&&!tail&&!patch.bezier&&!patch.tailRoot;
    mutate((draft) => {
      const draftPage = draft.manga.pages[activePage];
      const bubble = selection.scope === 'page_overlay'
        ? draftPage?.page_overlay?.bubbles?.[selection.index]
        : draftPage?.panels[activePanel]?.bubbles[selection.index];
      const enclosingPanel=selection.scope==='page_overlay'?undefined:draftPage?.panels[activePanel];
      const contentLocked=textOnly?bubble?.paint_overlay?.locked===true:artworkLocked(bubble?.paint_overlay);
      if (bubble&&!ownerItemLocked(bubble)&&!(enclosingPanel&&panelLocked(enclosingPanel))&&!contentLocked) {
        if(tail)bubble.tail=tail;
        if(patch?.bezier)bubble.bezier=structuredClone(patch.bezier);
        if(patch?.tailRoot)bubble.tail_root={...patch.tailRoot};
        if(patch?.textPosition)bubble.text_position={...patch.textPosition};
      }
    });
  };
  const movePanel = (panelIndex: number, deltaX: number, deltaY: number) => {
    mutate((draft) => {
      const targetPage = draft.manga.pages[activePage];
      const targetPanel = targetPage?.panels[panelIndex];
      if (!targetPanel || panelGeometryLocked(targetPanel)) return;
      translatePanel(targetPanel, deltaX, deltaY);
      syncPanelBleedAtTrim(targetPanel, targetPage.canvas, getPrintSetup(draft.manga).bleed_mm);
    });
  };
  const resizePanel = (panelIndex: number, bounds: BBox) => {
    mutate((draft) => {
      const targetPage = draft.manga.pages[activePage];
      const targetPanel = targetPage?.panels[panelIndex];
      if (targetPanel && !panelGeometryLocked(targetPanel)) {
        resizePanelToBounds(targetPanel, bounds);
        syncPanelBleedAtTrim(targetPanel, targetPage.canvas, getPrintSetup(draft.manga).bleed_mm);
      }
    });
  };
  const movePanelVertex = (panelIndex: number, vertexIndex: number, x: number, y: number, linkPanels = false) => {
    mutate((draft) => {
      const panels = draft.manga.pages[activePage]?.panels;
      const targetPage = draft.manga.pages[activePage];
      if (panels && !panelGeometryLocked(panels[panelIndex])) {
        movePanelVertexWithSnap(panels, panelIndex, vertexIndex, x, y, linkPanels, targetPage.canvas);
        panels.forEach(panel=>syncPanelBleedAtTrim(panel,targetPage.canvas,getPrintSetup(draft.manga).bleed_mm));
      }
    });
  };
  const movePanelEdge = (panelIndex: number, edgeIndex: number, deltaX: number, deltaY: number, linkPanels = false, excludedEdge?: PanelEdgeReference) => {
    mutate((draft) => {
      const targetPage = draft.manga.pages[activePage];
      const panels = targetPage?.panels;
      if (panels && !panelGeometryLocked(panels[panelIndex])) {
        const bleedMm=getPrintSetup(draft.manga).bleed_mm;
        movePanelEdgeGeometry(panels, panelIndex, edgeIndex, deltaX, deltaY, linkPanels, excludedEdge, targetPage.canvas, bleedMm);
        panels.forEach(panel=>syncPanelBleedAtTrim(panel,targetPage.canvas,bleedMm));
      }
    });
  };
  const selectPage=(index:number,panelIndex=0)=>layerTransition(async()=>{
    if(index===activePage){setTab('storyboard');setMobileStoryboardPane('editor');return;}
    if(paintSessionRef.current)await paintController.current?.close();
    endTextEdit();autoPaintResume.current=null;setActivePage(index);setActivePanel(panelIndex);setSelectedPanels([panelIndex]);setSelectedElement(null);setTab('storyboard');setMobileStoryboardPane('editor');
  });

  return { imageGestureBoundary, togglePanelSync, toggleInnerFrameSnap, togglePanelGapSnap, changeShowGuides, changeSpreadView, selectPage, changePanelStyleNumber, changeElementBBox, changeBubbleTail, movePanel, resizePanel, movePanelVertex, movePanelEdge, movePageImageToPanel, changePersistAnalogAssets };
}
