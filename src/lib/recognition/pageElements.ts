import type { MangaPage, AnalogFigureImport, BBox, Panel, AnalogTextImport, Bubble } from '../../types';
import {
  groupRecognizedTextLines,
  recognizedTextOwnerKey,
  type DetectedFigureRegion,
  type RecognizedTextLine,
} from './layoutResult.ts';
import { sourceFrameBoxToCanvas, nearestPanel, overlapArea } from './panelGeometry.ts';
import { panelBounds, roundMm, clamp, nearestAnchor } from '../canvasGeometry.ts';
import { DETECTED_FIGURE_NAME } from '../bubbleRelations.ts';

function ensurePageOverlay(page: MangaPage) {
  return page.page_overlay ??= { frame: false, layer: 'above_panel_frames' };
}

/** 人物検出領域を紙面座標へ変換し、所属コマまたはページ前景へ編集可能な人物あたりとして追加する。 */
export function attachDetectedFiguresToPage(
  page: MangaPage,
  regions: readonly DetectedFigureRegion[],
  analogImports?: ReadonlyMap<string, AnalogFigureImport>,
  sourceFrame: BBox | null = null,
  ownerPanels?: ReadonlyMap<string, Panel>,
): { added: number } {
  let added = 0;
  for (const region of regions) {
    if (!page.panels.length) continue;
    const sourceBox = sourceFrameBoxToCanvas(region.bbox, sourceFrame, page.canvas.w, page.canvas.h);
    const centerX = sourceBox.x + sourceBox.w / 2;
    const centerY = sourceBox.y + sourceBox.h / 2;
    const panel = !region.pageOverlay && region.sourcePanelId && ownerPanels
      ? ownerPanels.get(region.sourcePanelId) ?? nearestPanel(page.panels, centerX, centerY)
      : region.pageOverlay ? undefined : nearestPanel(page.panels, centerX, centerY);
    if (!panel && !region.pageOverlay) continue;
    const bounds = panel ? panelBounds(panel) : { x: 0, y: 0, w: page.canvas.w, h: page.canvas.h };
    const width = Math.min(page.canvas.w, Math.max(6, sourceBox.w));
    const height = Math.min(page.canvas.h, Math.max(6, sourceBox.h));
    const bbox: BBox = {
      x: roundMm(clamp(sourceBox.x, 0, page.canvas.w - width)),
      y: roundMm(clamp(sourceBox.y, 0, page.canvas.h - height)),
      w: roundMm(width),
      h: roundMm(height),
    };
    const targetFigures = region.pageOverlay ? (ensurePageOverlay(page).figures ??= []) : (panel!.figures ??= []);
    const duplicate = targetFigures.some((figure) => {
      if (!figure.bbox) return false;
      const intersection = overlapArea(bbox, figure.bbox);
      const smaller = Math.min(bbox.w * bbox.h, figure.bbox.w * figure.bbox.h);
      return smaller > 0 && intersection / smaller >= 0.78;
    });
    if (duplicate) continue;
    const analogImport = analogImports?.get(region.id);
    targetFigures.push({
      name: DETECTED_FIGURE_NAME,
      bbox,
      role: 'main',
      ...(panel ? { anchor: nearestAnchor(bounds, bbox) } : {}),
      size: region.source === 'face' ? 'face' : 'bust-up',
      ...(analogImport ? { analogImport: structuredClone(analogImport) } : {}),
    });
    if (panel) delete panel.no_figures;
    added += 1;
  }
  return { added };
}

/** OCR領域を紙面座標へ変換し、所属コマまたはページ前景へ編集可能なフキダシとして追加する。 */
export function attachRecognizedTextToPage(
  page: MangaPage,
  lines: readonly RecognizedTextLine[],
  analogImports?: ReadonlyMap<string, AnalogTextImport>,
  sourceFrame: BBox | null = null,
  ownerPanels?: ReadonlyMap<string, Panel>,
): { added: number; needsReview: number } {
  let added = 0;
  let needsReview = 0;
  for (const line of groupRecognizedTextLines(lines)) {
    if ((!line.text.trim() && !line.unreadable) || !page.panels.length) continue;
    const sourceBox = sourceFrameBoxToCanvas(line.bbox, sourceFrame, page.canvas.w, page.canvas.h);
    const centerX = sourceBox.x + sourceBox.w / 2;
    const centerY = sourceBox.y + sourceBox.h / 2;
    const panel = !line.pageOverlay && line.sourcePanelId && ownerPanels
      ? ownerPanels.get(line.sourcePanelId) ?? nearestPanel(page.panels, centerX, centerY)
      : line.pageOverlay ? undefined : nearestPanel(page.panels, centerX, centerY);
    if (!panel && !line.pageOverlay) continue;
    const width = Math.min(page.canvas.w, Math.max(6, sourceBox.w));
    const height = Math.min(page.canvas.h, Math.max(6, sourceBox.h));
    const bbox: BBox = {
      x: roundMm(clamp(sourceBox.x, 0, page.canvas.w - width)),
      y: roundMm(clamp(sourceBox.y, 0, page.canvas.h - height)),
      w: roundMm(width),
      h: roundMm(height),
    };
    const analogImport = analogImports?.get(recognizedTextOwnerKey(line));
    const targetBubbles = line.pageOverlay ? (ensurePageOverlay(page).bubbles ??= []) : panel!.bubbles;
    const bubble: Bubble = {
      text: line.text.trim(),
      shape: 'normal',
      bbox,
      ...(analogImport ? { analogTextImport: structuredClone(analogImport) } : {}),
    };
    targetBubbles.push(bubble);
    added += 1;
    if (line.needsReview) needsReview += 1;
  }
  return { added, needsReview };
}
