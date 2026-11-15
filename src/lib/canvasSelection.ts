import type { BBox, CanvasElementSelection, Figure, MangaPage } from '../types.ts';
import { fallbackBox } from './canvasGeometry.ts';
import { isPropPlacement } from './catalogModel.ts';
import { overlayFallbackBox, overlayTextFallbackBox } from './pageCanvas.ts';
import { artworkLocked } from './paintLock.ts';
import { bubbleVisible, panelLocked, panelVisible } from './panelLayers.ts';

export interface LassoPoint {
  x: number;
  y: number;
}

export interface MultiFigureTarget {
  panelIndex: number;
  figureIndex: number;
  overlay: boolean;
  figure: Figure;
  ownerKey: string;
}

function effectivePanelIndex(selection: CanvasElementSelection, activePanel: number): number | undefined {
  if (selection.scope === 'page_overlay' || selection.scope === 'page') return undefined;
  return selection.panelIndex ?? activePanel;
}

export function normalizeCanvasSelection(selection: CanvasElementSelection, activePanel: number): CanvasElementSelection {
  if (selection.scope === 'page_overlay' || selection.scope === 'page') return { ...selection };
  return { ...selection, scope: selection.scope ?? 'panel', panelIndex: selection.panelIndex ?? activePanel };
}

export function sameCanvasSelection(left: CanvasElementSelection, right: CanvasElementSelection, activePanel: number): boolean {
  if (left.type !== right.type || left.index !== right.index) return false;
  const leftOverlay = left.scope === 'page_overlay';
  const rightOverlay = right.scope === 'page_overlay';
  if (leftOverlay !== rightOverlay) return false;
  const leftPage = left.scope === 'page';
  const rightPage = right.scope === 'page';
  if (leftPage !== rightPage) return false;
  if (leftOverlay || leftPage) return true;
  return effectivePanelIndex(left, activePanel) === effectivePanelIndex(right, activePanel);
}

export function toggleCanvasSelection(
  current: readonly CanvasElementSelection[],
  item: CanvasElementSelection,
  activePanel: number,
): CanvasElementSelection[] {
  const normalized = normalizeCanvasSelection(item, activePanel);
  const exists = current.some((entry) => sameCanvasSelection(entry, normalized, activePanel));
  if (exists) return current.filter((entry) => !sameCanvasSelection(entry, normalized, activePanel));
  return [...current, normalized];
}

function pointInPolygon(point: LassoPoint, polygon: readonly LassoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = (yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a: LassoPoint, b: LassoPoint, c: LassoPoint, d: LassoPoint): boolean {
  const cross = (p: LassoPoint, q: LassoPoint, r: LassoPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

export function boxIntersectsLasso(box: BBox, polygon: readonly LassoPoint[]): boolean {
  if (polygon.length < 3) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (box.x + box.w < minX || box.x > maxX || box.y + box.h < minY || box.y > maxY) return false;

  const corners: LassoPoint[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
    { x: box.x + box.w / 2, y: box.y + box.h / 2 },
  ];
  if (corners.some((corner) => pointInPolygon(corner, polygon))) return true;
  if (polygon.some((p) => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h)) return true;
  const boxEdges: [LassoPoint, LassoPoint][] = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    if (boxEdges.some(([e1, e2]) => segmentsIntersect(p1, p2, e1, e2))) return true;
  }
  return false;
}

export function selectionsInLasso(page: MangaPage, polygon: readonly LassoPoint[]): CanvasElementSelection[] {
  if (polygon.length < 3) return [];
  const hits: CanvasElementSelection[] = [];

  page.panels.forEach((panel, panelIndex) => {
    if (!panelVisible(panel) || panelLocked(panel)) return;
    (panel.figures ?? []).forEach((figure, index) => {
      if (artworkLocked(figure.artwork)) return;
      const box = figure.bbox ?? fallbackBox(panel, 'figure', index);
      if (boxIntersectsLasso(box, polygon)) hits.push({ type: 'figure', index, scope: 'panel', panelIndex });
    });
    panel.bubbles.forEach((bubble, index) => {
      if (!bubbleVisible(bubble) || artworkLocked(bubble.paint_overlay)) return;
      const box = bubble.bbox ?? fallbackBox(panel, 'bubble', index);
      if (boxIntersectsLasso(box, polygon)) hits.push({ type: 'bubble', index, scope: 'panel', panelIndex });
    });
    (panel.screen_text ?? []).forEach((text, index) => {
      if (text.hidden) return;
      const box = text.bbox ?? fallbackBox(panel, 'screen_text', index);
      if (boxIntersectsLasso(box, polygon)) hits.push({ type: 'screen_text', index, scope: 'panel', panelIndex });
    });
    (panel.images ?? []).forEach((image, index) => {
      if (image.hidden || image.locked) return;
      if (boxIntersectsLasso(image.bbox, polygon)) hits.push({ type: 'image', index, scope: 'panel', panelIndex });
    });
  });

  const overlay = page.page_overlay;
  if (overlay) {
    (overlay.figures ?? []).forEach((figure, index) => {
      if (artworkLocked(figure.artwork)) return;
      const box = figure.bbox ?? overlayFallbackBox(page.canvas, 'figure', index);
      if (boxIntersectsLasso(box, polygon)) hits.push({ type: 'figure', index, scope: 'page_overlay' });
    });
    (overlay.bubbles ?? []).forEach((bubble, index) => {
      if (!bubbleVisible(bubble) || artworkLocked(bubble.paint_overlay)) return;
      const box = bubble.bbox ?? overlayFallbackBox(page.canvas, 'bubble', index);
      if (boxIntersectsLasso(box, polygon)) hits.push({ type: 'bubble', index, scope: 'page_overlay' });
    });
    (overlay.screen_text ?? []).forEach((text, index) => {
      if (text.hidden) return;
      const box = text.bbox ?? overlayTextFallbackBox(page.canvas, index);
      if (boxIntersectsLasso(box, polygon)) hits.push({ type: 'screen_text', index, scope: 'page_overlay' });
    });
  }

  return hits;
}

/**
 * 複数選択された要素から「人物」のみを抽出する。
 * 吹き出し・描き文字・画像・小道具・ロック済み人物など人物以外は自動で除外し、エラーにしない。
 */
export function extractFigureTargets(
  selections: readonly CanvasElementSelection[],
  page: MangaPage,
  activePanel: number,
): MultiFigureTarget[] {
  const seen = new Set<string>();
  const targets: MultiFigureTarget[] = [];

  for (const selection of selections) {
    if (selection.type !== 'figure' || selection.scope === 'page') continue;
    const overlay = selection.scope === 'page_overlay';
    const panelIndex = overlay ? 0 : (selection.panelIndex ?? activePanel);
    const key = `${overlay ? 'overlay' : `panel-${panelIndex}`}:figure-${selection.index}`;
    if (seen.has(key)) continue;

    if (overlay) {
      const figure = page.page_overlay?.figures?.[selection.index];
      if (!figure || isPropPlacement(figure) || artworkLocked(figure.artwork)) continue;
      seen.add(key);
      targets.push({ panelIndex: 0, figureIndex: selection.index, overlay: true, figure, ownerKey: `figure-${selection.index}` });
    } else {
      const panel = page.panels[panelIndex];
      if (!panel || !panelVisible(panel) || panelLocked(panel)) continue;
      const figure = panel.figures?.[selection.index];
      if (!figure || isPropPlacement(figure) || artworkLocked(figure.artwork)) continue;
      seen.add(key);
      targets.push({ panelIndex, figureIndex: selection.index, overlay: false, figure, ownerKey: `figure-${selection.index}` });
    }
  }

  return targets;
}
