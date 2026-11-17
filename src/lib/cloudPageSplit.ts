import { panelBounds } from './canvasGeometry.ts';
import type { BBox, Figure, MangaPage, Panel } from '../types.ts';

export interface PageFileMatch {
  file: File;
  pageIndex: number | null;
}

export interface PixelCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SplitCharacterResult {
  panelIndex: number;
  figureIndex: number;
  file: File;
  frameMm?: BBox;
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'ja', { numeric: true, sensitivity: 'base' });

export function extractPageNumberFromFileName(fileName: string): number | null {
  const base = fileName.replace(/\.[^.]+$/, '');
  const match = base.match(/(?:^|[^0-9])0*([1-9][0-9]{0,3})(?:$|[^0-9])/);
  return match ? Number(match[1]) : null;
}

export function matchFilesToPages(files: File[], pageCount: number): PageFileMatch[] {
  const sorted = [...files].sort((a, b) => naturalCompare(a.name, b.name));
  const used = new Set<number>();
  return sorted.map((file, index) => {
    const parsed = extractPageNumberFromFileName(file.name);
    if (parsed !== null && parsed >= 1 && parsed <= pageCount && !used.has(parsed - 1)) {
      used.add(parsed - 1);
      return { file, pageIndex: parsed - 1 };
    }
    if (index < pageCount && !used.has(index)) {
      used.add(index);
      return { file, pageIndex: index };
    }
    return { file, pageIndex: null };
  });
}

function isCutlinePixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 128) return false;
  return b - r >= 12 && b >= 165 && g >= 150 && r <= 230;
}

function isNearWhite(r: number, g: number, b: number, a: number): boolean {
  return a < 16 || (r >= 235 && g >= 235 && b >= 235);
}

/**
 * Locate panel crop rectangles on an image using detected light-blue cut lines
 * snapped against the page's proportional panel layout.
 */
export function detectCutlinePanelCrops(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  panels: Panel[],
  canvasMm: { w: number; h: number },
): PixelCrop[] {
  const rects = panels.map(panel => panelBounds(panel));
  if (!rects.length) return [];

  const rowCounts = new Int32Array(height);
  const colCounts = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (isCutlinePixel(rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3])) {
        rowSum++;
        colCounts[x]++;
      }
    }
    rowCounts[y] = rowSum;
  }

  const rowThreshold = Math.max(8, Math.floor(width * 0.25));
  const colThreshold = Math.max(8, Math.floor(height * 0.25));
  const hLines: number[] = [];
  const vLines: number[] = [];
  for (let y = 0; y < height; y++) if (rowCounts[y] >= rowThreshold) hLines.push(y);
  for (let x = 0; x < width; x++) if (colCounts[x] >= colThreshold) vLines.push(x);

  const minMmX = Math.min(...rects.map(r => r.x));
  const minMmY = Math.min(...rects.map(r => r.y));
  const maxMmX = Math.max(...rects.map(r => r.x + r.w));
  const maxMmY = Math.max(...rects.map(r => r.y + r.h));
  const mmW = Math.max(1, maxMmX - minMmX);
  const mmH = Math.max(1, maxMmY - minMmY);

  // Use detected outer cut lines if they span a plausible frame; otherwise map full image or canvas ratio.
  const hasOuterBox = hLines.length >= 2 && vLines.length >= 2
    && (hLines[hLines.length - 1] - hLines[0]) > height * 0.5
    && (vLines[vLines.length - 1] - vLines[0]) > width * 0.5;
  const frameX0 = hasOuterBox ? vLines[0] : (minMmX / Math.max(1, canvasMm.w)) * width;
  const frameY0 = hasOuterBox ? hLines[0] : (minMmY / Math.max(1, canvasMm.h)) * height;
  const frameW = hasOuterBox ? (vLines[vLines.length - 1] - vLines[0]) : (mmW / Math.max(1, canvasMm.w)) * width;
  const frameH = hasOuterBox ? (hLines[hLines.length - 1] - hLines[0]) : (mmH / Math.max(1, canvasMm.h)) * height;

  const snap = (target: number, candidates: number[], tolerance: number) => {
    let best = target;
    let bestDist = tolerance;
    for (const c of candidates) {
      const dist = Math.abs(c - target);
      if (dist <= bestDist) {
        best = c;
        bestDist = dist;
      }
    }
    return best;
  };

  const tolX = Math.max(8, Math.round(width * 0.12));
  const tolY = Math.max(8, Math.round(height * 0.12));

  const findLocalHorizontalEdge = (targetY: number, xStart: number, xEnd: number): number | null => {
    const yMin = Math.max(0, Math.round(targetY - tolY));
    const yMax = Math.min(height - 1, Math.round(targetY + tolY));
    const spanW = Math.max(1, xEnd - xStart);
    const minHits = Math.max(8, Math.floor(spanW * 0.35));
    let bestY: number | null = null;
    let bestScore = -1;
    for (let y = yMin; y <= yMax; y++) {
      let hits = 0;
      for (let x = xStart; x < xEnd; x++) {
        const idx = (y * width + x) * 4;
        if (isCutlinePixel(rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3])) hits++;
      }
      if (hits >= minHits) {
        const dist = Math.abs(y - targetY);
        const score = hits - dist * 0.5;
        if (score > bestScore) {
          bestScore = score;
          bestY = y;
        }
      }
    }
    return bestY;
  };

  const findLocalVerticalEdge = (targetX: number, yStart: number, yEnd: number): number | null => {
    const xMin = Math.max(0, Math.round(targetX - tolX));
    const xMax = Math.min(width - 1, Math.round(targetX + tolX));
    const spanH = Math.max(1, yEnd - yStart);
    const minHits = Math.max(8, Math.floor(spanH * 0.35));
    let bestX: number | null = null;
    let bestScore = -1;
    for (let x = xMin; x <= xMax; x++) {
      let hits = 0;
      for (let y = yStart; y < yEnd; y++) {
        const idx = (y * width + x) * 4;
        if (isCutlinePixel(rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3])) hits++;
      }
      if (hits >= minHits) {
        const dist = Math.abs(x - targetX);
        const score = hits - dist * 0.5;
        if (score > bestScore) {
          bestScore = score;
          bestX = x;
        }
      }
    }
    return bestX;
  };

  return rects.map(rect => {
    const rawX0 = frameX0 + ((rect.x - minMmX) / mmW) * frameW;
    const rawY0 = frameY0 + ((rect.y - minMmY) / mmH) * frameH;
    const rawX1 = frameX0 + ((rect.x + rect.w - minMmX) / mmW) * frameW;
    const rawY1 = frameY0 + ((rect.y + rect.h - minMmY) / mmH) * frameH;
    const spanX0 = Math.max(0, Math.round(rawX0));
    const spanX1 = Math.min(width, Math.round(rawX1));
    const spanY0 = Math.max(0, Math.round(rawY0));
    const spanY1 = Math.min(height, Math.round(rawY1));
    const x0 = Math.max(0, Math.round(findLocalVerticalEdge(rawX0, spanY0, spanY1) ?? snap(rawX0, vLines, tolX)));
    const y0 = Math.max(0, Math.round(findLocalHorizontalEdge(rawY0, spanX0, spanX1) ?? snap(rawY0, hLines, tolY)));
    const x1 = Math.min(width, Math.round(findLocalVerticalEdge(rawX1, spanY0, spanY1) ?? snap(rawX1, vLines, tolX)));
    const y1 = Math.min(height, Math.round(findLocalHorizontalEdge(rawY1, spanX0, spanX1) ?? snap(rawY1, hLines, tolY)));
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  });
}

function stripCutlinesAndFloodWhite(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  transparentWhite: boolean,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  const edgeMargin = 4;
  for (let y = 0; y < height; y++) {
    const nearYEdge = y < edgeMargin || y >= height - edgeMargin;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const nearEdge = nearYEdge || x < edgeMargin || x >= width - edgeMargin;
      const r = out[i];
      const g = out[i + 1];
      const b = out[i + 2];
      const isEdgeResidue = nearEdge && (b - r >= 6 || (r >= 185 && g >= 185 && b >= 185));
      if (isCutlinePixel(r, g, b, out[i + 3]) || isEdgeResidue) {
        out[i] = 255;
        out[i + 1] = 255;
        out[i + 2] = 255;
      }
    }
  }
  if (!transparentWhite) return out;

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const enqueue = (x: number, y: number) => {
    const pos = y * width + x;
    if (visited[pos]) return;
    const idx = pos * 4;
    if (!isNearWhite(out[idx], out[idx + 1], out[idx + 2], out[idx + 3])) return;
    visited[pos] = 1;
    queue[tail++] = pos;
  };
  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  while (head < tail) {
    const pos = queue[head++];
    out[pos * 4 + 3] = 0;
    const x = pos % width;
    const y = (pos - x) / width;
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < height) enqueue(x, y + 1);
  }
  return out;
}

function trimNonTransparent(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  x1: number,
  transparentWhite: boolean,
): { crop: PixelCrop; data: Uint8ClampedArray } | null {
  let minX = x1;
  let minY = height;
  let maxX = x0 - 1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      const isForeground = transparentWhite
        ? rgba[idx + 3] > 0 && !isNearWhite(rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3])
        : !isNearWhite(rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3]);
      if (isForeground) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const pad = 2;
  const cx0 = Math.max(x0, minX - pad);
  const cy0 = Math.max(0, minY - pad);
  const cx1 = Math.min(x1, maxX + 1 + pad);
  const cy1 = Math.min(height, maxY + 1 + pad);
  const cw = cx1 - cx0;
  const ch = cy1 - cy0;
  const sliced = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcStart = ((cy0 + y) * width + cx0) * 4;
    sliced.set(rgba.subarray(srcStart, srcStart + cw * 4), y * cw * 4);
  }
  return { crop: { x: cx0, y: cy0, w: cw, h: ch }, data: sliced };
}

/**
 * Split a panel's RGBA pixels into per-figure RGBA crops ordered left-to-right
 * matching `figures[].bbox.x`, finding the deepest whitespace valley between adjacent characters.
 */
export function splitPanelCharacters(
  panelRgba: Uint8ClampedArray,
  width: number,
  height: number,
  figures: Figure[],
  transparentWhite: boolean,
): Array<{ figureIndex: number; width: number; height: number; crop: PixelCrop; rgba: Uint8ClampedArray }> {
  if (!figures.length || width < 1 || height < 1) return [];
  const cleaned = stripCutlinesAndFloodWhite(panelRgba, width, height, transparentWhite);
  const indexed = figures
    .map((figure, figureIndex) => ({ figureIndex, x: figure.bbox?.x ?? figureIndex }))
    .sort((a, b) => a.x - b.x);

  const colInk = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      if (cleaned[idx + 3] > 0 && !isNearWhite(cleaned[idx], cleaned[idx + 1], cleaned[idx + 2], cleaned[idx + 3])) {
        count++;
      }
    }
    colInk[x] = count;
  }

  const cuts: number[] = [0];
  for (let i = 1; i < indexed.length; i++) {
    const expected = Math.round((i / indexed.length) * width);
    const searchStart = Math.max(cuts[i - 1] + 1, Math.round(expected - width * 0.2));
    const searchEnd = Math.min(width - 1, Math.round(expected + width * 0.2));
    let bestX = expected;
    let bestVal = Number.POSITIVE_INFINITY;
    for (let x = searchStart; x <= searchEnd; x++) {
      if (colInk[x] < bestVal) {
        bestVal = colInk[x];
        bestX = x;
      }
    }
    cuts.push(bestX);
  }
  cuts.push(width);

  const results: Array<{ figureIndex: number; width: number; height: number; crop: PixelCrop; rgba: Uint8ClampedArray }> = [];
  for (let i = 0; i < indexed.length; i++) {
    const trimmed = trimNonTransparent(cleaned, width, height, cuts[i], cuts[i + 1], transparentWhite);
    if (!trimmed) continue;
    results.push({
      figureIndex: indexed[i].figureIndex,
      width: trimmed.crop.w,
      height: trimmed.crop.h,
      crop: trimmed.crop,
      rgba: trimmed.data,
    });
  }
  return results;
}

async function rgbaToPngFile(rgba: Uint8ClampedArray, width: number, height: number, fileName: string): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像切り出し用のキャンバスを作成できませんでした');
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNG変換に失敗しました')), 'image/png');
  });
  return new File([blob], fileName, { type: 'image/png' });
}

export async function splitPageImageForDocument(
  file: File,
  page: MangaPage,
  transparentWhite: boolean,
): Promise<SplitCharacterResult[]> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('画像読み込み用のキャンバスを作成できませんでした');
    ctx.drawImage(bitmap, 0, 0);
    const full = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const crops = detectCutlinePanelCrops(full.data, bitmap.width, bitmap.height, page.panels, page.canvas);
    const results: SplitCharacterResult[] = [];
    for (let panelIndex = 0; panelIndex < page.panels.length; panelIndex++) {
      const panel = page.panels[panelIndex];
      const crop = crops[panelIndex];
      const figures = panel.figures ?? [];
      if (!crop || !figures.length) continue;
      const panelData = ctx.getImageData(crop.x, crop.y, crop.w, crop.h);
      const panelBox = panelBounds(panel);
      const splitChars = splitPanelCharacters(panelData.data, crop.w, crop.h, figures, transparentWhite);
      for (const item of splitChars) {
        const pngFile = await rgbaToPngFile(
          item.rgba,
          item.width,
          item.height,
          `p${String(page.page).padStart(2, '0')}_panel${panel.id}_fig${item.figureIndex + 1}.png`,
        );
        const frameMm: BBox = {
          x: panelBox.x + (item.crop.x / crop.w) * panelBox.w,
          y: panelBox.y + (item.crop.y / crop.h) * panelBox.h,
          w: (item.crop.w / crop.w) * panelBox.w,
          h: (item.crop.h / crop.h) * panelBox.h,
        };
        results.push({ panelIndex, figureIndex: item.figureIndex, file: pngFile, frameMm });
      }
    }
    return results;
  } finally {
    bitmap.close();
  }
}
