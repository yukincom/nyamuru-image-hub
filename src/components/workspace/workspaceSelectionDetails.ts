import { useCallback, useEffect } from 'preact/hooks';
import { toSeparatedMangaYaml } from '../../lib/manga';
import { type CanvasTextTarget, canvasTextAt, canvasBubbleLineWidthEditable } from '../../lib/canvasText';
import type { Bubble } from '../../types';
import { bubbleStrokeWidthMm } from '../../lib/bubblePresentation';
import { getPrintSetup } from '../../lib/printSettings';
import { spreadPartnerIndex as findSpreadPartnerIndex } from '../../lib/pageSpread';
import type { WorkspaceState } from './useWorkspaceState';

interface Actions {
  changeSelectedBubbleLineWidth: (width: number) => void;
}

export function useSelectionDetails({
  documentRef, boundEpisodeWorkspace, document, boundSourceSnapshot, activePage, activePanel,
  materialLinkTarget, paintSession, textTool, zoomTool, selectedElement, layerSwitchBusy, spreadView,
  setBoundEpisodeWorkspace, setBoundSourceSnapshot, setSourceCoverageDecisions,
}: WorkspaceState, {
  changeSelectedBubbleLineWidth,
}: Actions) {
  const getOmnySnapshot = useCallback(() => toSeparatedMangaYaml(documentRef.current), []);
  const coverageWorkspace = boundEpisodeWorkspace?.episodeId === document.manga.meta.episode_id
    && boundSourceSnapshot?.episodeId === document.manga.meta.episode_id
    && boundSourceSnapshot.workspaceDirectory === boundEpisodeWorkspace.directory
    ? boundEpisodeWorkspace
    : null;
  const page = document.manga.pages[activePage];
  const panel = page?.panels[activePanel];
  const materialLinkPanel = materialLinkTarget
    ? document.manga.pages[materialLinkTarget.pageIndex]?.panels[materialLinkTarget.panelIndex]
    : undefined;
  const panelFrameLineWidthMm = document.manga.meta.panel_frame_width_mm;
  const bubbleLineWidthMm = document.manga.meta.bubble_line_width_mm;
  const selectedBubbleTarget:CanvasTextTarget|undefined=!paintSession&&!textTool&&!zoomTool&&selectedElement?.type==='bubble'
    ?{pageIndex:activePage,panelIndex:activePanel,index:selectedElement.index,overlay:selectedElement.scope==='page_overlay',kind:'bubble'}:undefined;
  const selectedBubble=selectedBubbleTarget?canvasTextAt(document,selectedBubbleTarget) as Bubble|undefined:undefined;
  const selectedBubbleStroke=selectedBubble&&selectedBubbleTarget?{
    width:bubbleStrokeWidthMm(selectedBubble,bubbleLineWidthMm)*getPrintSetup(document.manga).dpi/25.4,
    disabled:layerSwitchBusy||!canvasBubbleLineWidthEditable(document,selectedBubbleTarget),onChange:(width:number)=>changeSelectedBubbleLineWidth(width),
  }:undefined;
  const panelGutters = {
    rowGapMm: document.manga.meta.panel_gutter_row_mm,
    columnGapMm: document.manga.meta.panel_gutter_column_mm,
  };
  // 見開きは選択状態で組み替えず、右綴じの固定ペア（1+2、3+4…）を保つ。
  const spreadPartnerIndex = findSpreadPartnerIndex(activePage, document.manga.pages.length, spreadView);

  useEffect(() => {
    if (boundEpisodeWorkspace && boundEpisodeWorkspace.episodeId !== document.manga.meta.episode_id) {
      setBoundEpisodeWorkspace(null);
    }
  }, [document.manga.meta.episode_id, boundEpisodeWorkspace]);

  useEffect(() => {
    if (boundSourceSnapshot && boundSourceSnapshot.episodeId !== document.manga.meta.episode_id) {
      setBoundSourceSnapshot(null);
      setSourceCoverageDecisions([]);
    }
  }, [document.manga.meta.episode_id, boundSourceSnapshot]);
  return { page, panel, panelGutters, coverageWorkspace, selectedBubbleTarget, selectedBubbleStroke, bubbleLineWidthMm, spreadPartnerIndex, panelFrameLineWidthMm, getOmnySnapshot, materialLinkPanel };
}
