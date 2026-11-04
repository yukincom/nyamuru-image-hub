import type { Panel, BBox, BleedEdge } from '../../types';
import { roundMm, panelBounds, type CanvasSize, clamp } from './canvasBounds.ts';

export function translatePanel(panel: Panel, deltaX: number, deltaY: number): void {
  [...(panel.images ?? []), ...(panel.background_images ?? [])].forEach(image => { image.bbox.x += deltaX; image.bbox.y += deltaY; });
  if (panel.shape.type === 'rect') {
    panel.shape.x = roundMm(panel.shape.x + deltaX);
    panel.shape.y = roundMm(panel.shape.y + deltaY);
  } else {
    panel.shape.points = panel.shape.points.map(([x, y]) => [roundMm(x + deltaX), roundMm(y + deltaY)]);
  }
  panel.figures?.forEach((figure) => {
    if (!figure.bbox) return;
    figure.bbox.x = roundMm(figure.bbox.x + deltaX);
    figure.bbox.y = roundMm(figure.bbox.y + deltaY);
  });
  panel.bubbles.forEach((bubble) => {
    if (!bubble.bbox) return;
    bubble.bbox.x = roundMm(bubble.bbox.x + deltaX);
    bubble.bbox.y = roundMm(bubble.bbox.y + deltaY);
  });
  panel.screen_text?.forEach((screenText) => {
    if (!screenText.bbox) return;
    screenText.bbox.x = roundMm(screenText.bbox.x + deltaX);
    screenText.bbox.y = roundMm(screenText.bbox.y + deltaY);
  });
}

export function resizePanelToBounds(panel: Panel, requestedBounds: BBox): void {
  const original = panelBounds(panel);
  const next = {
    x: roundMm(requestedBounds.x),
    y: roundMm(requestedBounds.y),
    w: Math.max(1, roundMm(requestedBounds.w)),
    h: Math.max(1, roundMm(requestedBounds.h)),
  };
  const scaleX = original.w ? next.w / original.w : 1;
  const scaleY = original.h ? next.h / original.h : 1;
  const transformBox = (box: BBox) => {
    box.x = roundMm(next.x + (box.x - original.x) * scaleX);
    box.y = roundMm(next.y + (box.y - original.y) * scaleY);
    box.w = roundMm(box.w * scaleX);
    box.h = roundMm(box.h * scaleY);
  };

  if (panel.shape.type === 'rect') {
    panel.shape = { type: 'rect', ...next };
  } else {
    panel.shape.points = panel.shape.points.map(([x, y]) => [
      roundMm(next.x + (x - original.x) * scaleX),
      roundMm(next.y + (y - original.y) * scaleY),
    ]);
  }
  // Map the centre into the resized panel, but preserve artwork proportions.
  const transformArtwork = (box: BBox) => {
    const cx = next.x + (box.x + box.w / 2 - original.x) * scaleX;
    const cy = next.y + (box.y + box.h / 2 - original.y) * scaleY;
    const scale = Math.min(scaleX, scaleY);
    box.w *= scale; box.h *= scale;
    box.x = cx - box.w / 2; box.y = cy - box.h / 2;
  };
  [...(panel.images ?? []), ...(panel.background_images ?? [])].forEach(image => transformArtwork(image.bbox));
  panel.figures?.forEach((figure) => { if (figure.bbox) (figure.artwork ? transformArtwork : transformBox)(figure.bbox); });
  panel.bubbles.forEach((bubble) => { if (bubble.bbox) transformBox(bubble.bbox); });
  panel.screen_text?.forEach((screenText) => { if (screenText.bbox) transformBox(screenText.bbox); });
}

/**
 * The editable page coordinates end at the trim line. A rectangular panel dragged
 * beyond that line is stored on the page edge and records the crossed sides in
 * OMNY `bleed`; dragging the edge back inside clears that side again.
 */
export function syncPanelBleedAtTrim(panel: Panel, canvas: CanvasSize, bleedMm: number): boolean {
  if (panel.shape.type !== 'rect' || !Number.isFinite(bleedMm) || bleedMm <= 0) return false;
  const original = panelBounds(panel);
  const existing = new Set(panel.bleed ?? []);
  const epsilon = 0.02;
  const right = original.x + original.w;
  const bottom = original.y + original.h;
  const crossed: Record<BleedEdge, boolean> = {
    left: original.x < -epsilon || (existing.has('left') && original.x <= epsilon),
    right: right > canvas.w + epsilon || (existing.has('right') && right >= canvas.w - epsilon),
    top: original.y < -epsilon || (existing.has('top') && original.y <= epsilon),
    bottom: bottom > canvas.h + epsilon || (existing.has('bottom') && bottom >= canvas.h - epsilon),
  };
  const left = crossed.left ? 0 : clamp(original.x, 0, canvas.w - 1);
  const top = crossed.top ? 0 : clamp(original.y, 0, canvas.h - 1);
  const normalizedRight = crossed.right ? canvas.w : clamp(right, left + 1, canvas.w);
  const normalizedBottom = crossed.bottom ? canvas.h : clamp(bottom, top + 1, canvas.h);
  const normalized = { x: left, y: top, w: normalizedRight - left, h: normalizedBottom - top };
  const edges = (['left', 'right', 'top', 'bottom'] as const).filter((edge) => crossed[edge]);
  const geometryChanged = Math.abs(normalized.x - original.x) > epsilon
    || Math.abs(normalized.y - original.y) > epsilon
    || Math.abs(normalized.w - original.w) > epsilon
    || Math.abs(normalized.h - original.h) > epsilon;
  if (geometryChanged) resizePanelToBounds(panel, normalized);
  const previous = panel.bleed ?? [];
  const bleedChanged = previous.length !== edges.length || previous.some((edge, index) => edge !== edges[index]);
  if (edges.length) panel.bleed = [...edges];
  else delete panel.bleed;
  return geometryChanged || bleedChanged;
}

export function convertPanelShape(panel: Panel, type: 'rect' | 'polygon'): void {
  if (panel.shape.type === type) return;
  const bounds = panelBounds(panel);
  panel.shape = type === 'rect'
    ? { type: 'rect', ...bounds }
    : { type: 'polygon', points: [
      [bounds.x, bounds.y],
      [bounds.x + bounds.w, bounds.y],
      [bounds.x + bounds.w, bounds.y + bounds.h],
      [bounds.x, bounds.y + bounds.h],
    ] };
}
