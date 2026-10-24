import type { BBox, MangaPage } from '../types.ts';
import { fallbackBox } from './canvasGeometry.ts';

/** Change the paper without stretching artwork or changing source image pixels. */
export function resizePageCanvas(page: MangaPage, size: { w: number; h: number }): void {
  if (page.canvas.w === size.w && page.canvas.h === size.h) return;
  const scale = Math.min(size.w / page.canvas.w, size.h / page.canvas.h);
  const offsetX = (size.w - page.canvas.w * scale) / 2;
  const offsetY = (size.h - page.canvas.h * scale) / 2;
  const transform = (box: BBox) => {
    box.x = offsetX + box.x * scale;
    box.y = offsetY + box.y * scale;
    box.w *= scale;
    box.h *= scale;
  };
  for (const panel of page.panels) {
    // Materialize implicit positions before the panel frame changes.
    panel.figures?.forEach((item, i) => { item.bbox ??= fallbackBox(panel, 'figure', i); transform(item.bbox); });
    panel.bubbles.forEach((item, i) => { item.bbox ??= fallbackBox(panel, 'bubble', i); transform(item.bbox); });
    panel.screen_text?.forEach((item, i) => { item.bbox ??= fallbackBox(panel, 'screen_text', i); transform(item.bbox); });
    [...(panel.images ?? []), ...(panel.background_images ?? [])].forEach(image => transform(image.bbox));
    if (panel.shape.type === 'polygon') {
      panel.shape.points = panel.shape.points.map(([x, y]) => [offsetX + x * scale, offsetY + y * scale]);
    } else {
      transform(panel.shape);
      // A full-bleed frame still reaches the paper edge; its contents keep their ratio.
      if (panel.bleed?.includes('left')) { panel.shape.w += panel.shape.x; panel.shape.x = 0; }
      if (panel.bleed?.includes('top')) { panel.shape.h += panel.shape.y; panel.shape.y = 0; }
      if (panel.bleed?.includes('right')) panel.shape.w = size.w - panel.shape.x;
      if (panel.bleed?.includes('bottom')) panel.shape.h = size.h - panel.shape.y;
    }
  }
  page.page_overlay?.figures?.forEach((item, i) => {
    item.bbox ??= overlayFallbackBox(page.canvas, 'figure', i);
    transform(item.bbox);
  });
  page.page_overlay?.bubbles?.forEach((item, i) => {
    item.bbox ??= overlayFallbackBox(page.canvas, 'bubble', i);
    transform(item.bbox);
  });
  page.images?.forEach((image) => transform(image.bbox));
  page.canvas = { ...size, unit: 'mm' };
}

export function overlayFallbackBox(canvas: { w: number; h: number }, type: 'figure' | 'bubble', index: number): BBox {
  const box = type === 'figure'
    ? { x: 55 + index * 4, y: 45 + index * 4, w: 100, h: 175 }
    : { x: 150 - index * 4, y: 20 + index * 5, w: 38, h: 55 };
  const scale = Math.min(canvas.w / 210, canvas.h / 297);
  return { x: box.x * scale + (canvas.w - 210 * scale) / 2, y: box.y * scale + (canvas.h - 297 * scale) / 2, w: box.w * scale, h: box.h * scale };
}
