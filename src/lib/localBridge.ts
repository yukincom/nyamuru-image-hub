import { clamp, INNER_FRAME_BOUNDS, nearestAnchor, panelBounds, pointInPanel, roundMm } from './canvasGeometry.ts';
import type { BBox, MangaPage, Panel, PanelShape } from '../types';

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';
const REQUEST_TIMEOUT_MS = 180_000;

export interface LayoutRecognitionResult {
  detectedPanels: PanelShape[];
  detectedFigures: DetectedFigureRegion[];
  reason: string;
  detectedPanelCount: number;
  structureEngine: string;
  excludedNonPanelCount: number;
  detectedTextRegionCount: number;
  detectedFaceRegionCount: number;
  detectedBodyRegionCount: number;
  ocrEngine: string;
  ocrLines: RecognizedTextLine[];
}

export interface RecognizedTextLine {
  id: string;
  text: string;
  bbox: BBox;
  confidence: number;
  vertical: boolean;
  source: string;
  needsReview: boolean;
  groupId?: string;
}

export interface DetectedFigureRegion {
  bbox: BBox;
  source: 'body' | 'face';
}

export const DETECTED_FIGURE_NAME = '人物あたり';

interface BridgeLayoutResponse {
  panel_boxes?: unknown;
  reason?: unknown;
  structure?: unknown;
  people?: unknown;
  ocr?: unknown;
}

export interface ScannerSession {
  id: string;
  startedAt: string;
  expiresInSeconds: number;
  maxFiles: number;
  directory: string;
}

export interface ScannedImage {
  id: string;
  file: File;
  modifiedAt: string;
}

export interface ScannerCollection {
  files: ScannedImage[];
  complete: boolean;
  remainingSeconds: number;
  total: number;
}

export interface PendingScannerSession {
  startedAt: string;
  directory: string;
  count: number;
}

export interface ResumedScannerSession {
  session: ScannerSession;
  files: ScannedImage[];
}

function bridgeUrl(path: string): string {
  const configured = import.meta.env.PUBLIC_NYAMURU_BRIDGE_URL?.trim();
  return `${configured || DEFAULT_BRIDGE_URL}${path}`;
}

function shapeBounds(shape: PanelShape): BBox {
  return panelBounds({ id: 0, shape, bg: 0, bubbles: [], action: null });
}

function overlapArea(left: BBox, right: BBox): number {
  return Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x))
    * Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y));
}

function nearestShapeIndex(shapes: readonly PanelShape[], x: number, y: number): number {
  const ranked = shapes.map((shape, index) => {
    const bounds = shapeBounds(shape);
    const contains = x >= bounds.x && x <= bounds.x + bounds.w && y >= bounds.y && y <= bounds.y + bounds.h;
    const nearestX = clamp(x, bounds.x, bounds.x + bounds.w);
    const nearestY = clamp(y, bounds.y, bounds.y + bounds.h);
    return {
      index,
      contains,
      area: bounds.w * bounds.h,
      distance: (x - nearestX) ** 2 + (y - nearestY) ** 2,
    };
  });
  const containing = ranked.filter((item) => item.contains).sort((left, right) => left.area - right.area);
  return containing[0]?.index ?? ranked.sort((left, right) => left.distance - right.distance || left.area - right.area)[0]?.index ?? -1;
}

function deduplicateDetectedPanels(shapes: readonly PanelShape[]): PanelShape[] {
  const bounds = shapes.map(shapeBounds);
  const bySmallestArea = bounds.map((box, index) => ({ index, area: box.w * box.h })).sort((left, right) => left.area - right.area);
  const kept = new Set<number>();
  for (const candidate of bySmallestArea) {
    const candidateBox = bounds[candidate.index];
    const duplicate = [...kept].some((keptIndex) => {
      const keptBox = bounds[keptIndex];
      const intersection = overlapArea(candidateBox, keptBox);
      const candidateArea = candidateBox.w * candidateBox.h;
      const keptArea = keptBox.w * keptBox.h;
      const smaller = Math.min(candidateArea, keptArea);
      const larger = Math.max(candidateArea, keptArea);
      const union = candidateArea + keptArea - intersection;
      return smaller > 0 && larger > 0
        && smaller / larger >= 0.68
        && (intersection / smaller >= 0.9 || (union > 0 && intersection / union >= 0.72));
    });
    if (!duplicate) kept.add(candidate.index);
  }
  return shapes.filter((_, index) => kept.has(index)).map((shape) => structuredClone(shape));
}

type MutableRectEdges = { left: number; right: number; top: number; bottom: number };

function constrainDetectedPanelsToInnerFrame(shapes: readonly PanelShape[]): PanelShape[] {
  const innerRight = INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w;
  const innerBottom = INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h;
  return shapes.map((shape) => {
    if (shape.type === 'polygon') return {
      type: 'polygon',
      points: shape.points.map(([x, y]) => [
        roundMm(clamp(x, INNER_FRAME_BOUNDS.x, innerRight)),
        roundMm(clamp(y, INNER_FRAME_BOUNDS.y, innerBottom)),
      ]),
    };
    const left = clamp(shape.x, INNER_FRAME_BOUNDS.x, innerRight - 8);
    const top = clamp(shape.y, INNER_FRAME_BOUNDS.y, innerBottom - 8);
    const right = clamp(shape.x + shape.w, left + 8, innerRight);
    const bottom = clamp(shape.y + shape.h, top + 8, innerBottom);
    return {
      type: 'rect',
      x: roundMm(left),
      y: roundMm(top),
      w: roundMm(right - left),
      h: roundMm(bottom - top),
    };
  });
}

function alignNearRectEdges(shapes: readonly PanelShape[], threshold = 4): PanelShape[] {
  const next = shapes.map((shape) => structuredClone(shape));
  const rects = next.flatMap((shape, index): Array<{ index: number; edges: MutableRectEdges }> => shape.type === 'rect' ? [{
    index,
    edges: { left: shape.x, right: shape.x + shape.w, top: shape.y, bottom: shape.y + shape.h },
  }] : []);
  const alignAxis = (
    start: 'left' | 'top',
    end: 'right' | 'bottom',
    minimum: number,
    maximum: number,
  ) => {
    const references = rects.flatMap((rect) => ([
      { rect, edge: start, value: rect.edges[start] },
      { rect, edge: end, value: rect.edges[end] },
    ]));
    const sorted = references.sort((left, right) => left.value - right.value);
    for (let cursor = 0; cursor < sorted.length;) {
      let endCursor = cursor + 1;
      while (endCursor < sorted.length && sorted[endCursor].value - sorted[cursor].value <= threshold) endCursor += 1;
      const cluster = sorted.slice(cursor, endCursor);
      const boundaryTarget = cluster.some((reference) => Math.abs(reference.value - minimum) <= threshold) ? minimum
        : cluster.some((reference) => Math.abs(reference.value - maximum) <= threshold) ? maximum
          : null;
      if (boundaryTarget !== null || new Set(cluster.map((reference) => reference.rect.index)).size >= 2) {
        const target = boundaryTarget ?? roundMm(cluster.reduce((sum, reference) => sum + reference.value, 0) / cluster.length);
        cluster.forEach((reference) => { reference.rect.edges[reference.edge] = target; });
      }
      cursor = endCursor;
    }
  };
  alignAxis('left', 'right', INNER_FRAME_BOUNDS.x, INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w);
  alignAxis('top', 'bottom', INNER_FRAME_BOUNDS.y, INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h);
  rects.forEach(({ index, edges }) => {
    const shape = next[index];
    if (shape.type !== 'rect') return;
    shape.x = roundMm(edges.left);
    shape.y = roundMm(edges.top);
    shape.w = roundMm(Math.max(8, edges.right - edges.left));
    shape.h = roundMm(Math.max(8, edges.bottom - edges.top));
  });
  return next;
}

/** Adjacent detected rectangles are separated by a 5mm gutter without moving their outer edges. */
export function ensureDetectedPanelGutters(shapes: readonly PanelShape[], gutter = 5): PanelShape[] {
  const next = shapes.map((shape) => structuredClone(shape));
  for (let leftIndex = 0; leftIndex < next.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < next.length; rightIndex += 1) {
      const first = next[leftIndex];
      const second = next[rightIndex];
      if (first.type !== 'rect' || second.type !== 'rect') continue;
      const horizontalOverlap = Math.max(0, Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x));
      const verticalOverlap = Math.max(0, Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y));
      const normalizedHorizontalDistance = Math.abs((first.x + first.w / 2) - (second.x + second.w / 2)) / Math.max(1, (first.w + second.w) / 2);
      const normalizedVerticalDistance = Math.abs((first.y + first.h / 2) - (second.y + second.h / 2)) / Math.max(1, (first.h + second.h) / 2);

      if (normalizedVerticalDistance >= normalizedHorizontalDistance && horizontalOverlap >= Math.min(first.w, second.w) * 0.25) {
        const [upper, lower] = first.y + first.h / 2 <= second.y + second.h / 2 ? [first, second] : [second, first];
        const currentGap = lower.y - (upper.y + upper.h);
        if (currentGap >= gutter) continue;
        const boundary = ((upper.y + upper.h) + lower.y) / 2;
        const upperBottom = boundary - gutter / 2;
        const lowerTop = boundary + gutter / 2;
        if (upperBottom - upper.y >= 8 && lower.y + lower.h - lowerTop >= 8) {
          upper.h = roundMm(upperBottom - upper.y);
          const lowerBottom = lower.y + lower.h;
          lower.y = roundMm(lowerTop);
          lower.h = roundMm(lowerBottom - lower.y);
        }
      } else if (verticalOverlap >= Math.min(first.h, second.h) * 0.25) {
        const [left, right] = first.x + first.w / 2 <= second.x + second.w / 2 ? [first, second] : [second, first];
        const currentGap = right.x - (left.x + left.w);
        if (currentGap >= gutter) continue;
        const boundary = ((left.x + left.w) + right.x) / 2;
        const leftEdge = boundary - gutter / 2;
        const rightEdge = boundary + gutter / 2;
        if (leftEdge - left.x >= 8 && right.x + right.w - rightEdge >= 8) {
          left.w = roundMm(leftEdge - left.x);
          const rightBoundary = right.x + right.w;
          right.x = roundMm(rightEdge);
          right.w = roundMm(rightBoundary - right.x);
        }
      }
    }
  }
  return next;
}

/** Prefer the smallest text-bearing frame and discard enclosing/empty detector artifacts. */
export function refineDetectedPanels(
  shapes: readonly PanelShape[],
  lines: readonly RecognizedTextLine[],
): PanelShape[] {
  const deduplicated = deduplicateDetectedPanels(shapes);
  if (!deduplicated.length) return [];
  const normalizeGeometry = (targets: readonly PanelShape[]) => ensureDetectedPanelGutters(
    alignNearRectEdges(constrainDetectedPanelsToInnerFrame(targets)),
  );
  if (!lines.length) return normalizeGeometry(deduplicated);
  const supported = new Set<number>();
  for (const line of lines) {
    const centerX = (line.bbox.x + line.bbox.w / 2) * 210;
    const centerY = (line.bbox.y + line.bbox.h / 2) * 297;
    const index = nearestShapeIndex(deduplicated, centerX, centerY);
    if (index >= 0) supported.add(index);
  }
  const textBearing = deduplicated.filter((_, index) => supported.has(index));
  return normalizeGeometry(textBearing.length ? textBearing : deduplicated);
}

export function groupRecognizedTextLines(lines: readonly RecognizedTextLine[]): RecognizedTextLine[] {
  const groups: { key: string; lines: RecognizedTextLine[] }[] = [];
  const byKey = new Map<string, { key: string; lines: RecognizedTextLine[] }>();
  lines.forEach((line, index) => {
    const key = line.groupId ? `group:${line.groupId}` : `line:${index}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, lines: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.lines.push(line);
  });
  return groups.map((group) => {
    if (group.lines.length === 1) return group.lines[0];
    const vertical = group.lines.filter((line) => line.vertical).length * 2 >= group.lines.length;
    const ordered = [...group.lines].sort((left, right) => vertical
      ? (right.bbox.x + right.bbox.w / 2) - (left.bbox.x + left.bbox.w / 2) || left.bbox.y - right.bbox.y
      : (left.bbox.y + left.bbox.h / 2) - (right.bbox.y + right.bbox.h / 2) || left.bbox.x - right.bbox.x);
    const left = Math.min(...ordered.map((line) => line.bbox.x));
    const top = Math.min(...ordered.map((line) => line.bbox.y));
    const right = Math.max(...ordered.map((line) => line.bbox.x + line.bbox.w));
    const bottom = Math.max(...ordered.map((line) => line.bbox.y + line.bbox.h));
    return {
      ...ordered[0],
      text: ordered.map((line) => line.text.trim()).filter(Boolean).join('\n'),
      bbox: { x: left, y: top, w: right - left, h: bottom - top },
      confidence: ordered.reduce((sum, line) => sum + line.confidence, 0) / ordered.length,
      vertical,
      source: [...new Set(ordered.map((line) => line.source))].join('+'),
      needsReview: ordered.some((line) => line.needsReview),
      groupId: ordered[0].groupId,
    };
  });
}

export function normalizeLayoutRecognition(
  payload: BridgeLayoutResponse,
): LayoutRecognitionResult {
  const rawDetectedPanels = (Array.isArray(payload.panel_boxes) ? payload.panel_boxes : []).flatMap((entry): PanelShape[] => {
    const rawBox = Array.isArray(entry) ? entry.map(Number) : [];
    if (rawBox.length !== 4 || rawBox.some((value) => !Number.isFinite(value))) return [];
    const [rawX, rawY, rawWidth, rawHeight] = rawBox;
    const left = clamp(rawX, 0, 1);
    const top = clamp(rawY, 0, 1);
    const right = clamp(rawX + rawWidth, 0, 1);
    const bottom = clamp(rawY + rawHeight, 0, 1);
    if (right - left < 0.005 || bottom - top < 0.005) return [];
    return [{
      type: 'rect',
      x: roundMm(left * 210),
      y: roundMm(top * 297),
      w: roundMm((right - left) * 210),
      h: roundMm((bottom - top) * 297),
    }];
  });
  const structure = payload.structure && typeof payload.structure === 'object'
    ? payload.structure as Record<string, unknown>
    : {};
  const ocr = payload.ocr && typeof payload.ocr === 'object'
    ? payload.ocr as Record<string, unknown>
    : {};
  const people = payload.people && typeof payload.people === 'object'
    ? payload.people as Record<string, unknown>
    : {};
  const ocrLines = (Array.isArray(ocr.lines) ? ocr.lines : []).flatMap((entry, index): RecognizedTextLine[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const rawBox = Array.isArray(item.bbox) ? item.bbox.map(Number) : [];
    if (rawBox.length !== 4 || rawBox.some((value) => !Number.isFinite(value))) return [];
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) return [];
    const [x, y, w, h] = rawBox;
    const rawLineConfidence = Number(item.confidence);
    return [{
      id: typeof item.id === 'string' && item.id ? item.id : `ocr-${index}`,
      text,
      bbox: {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
        w: Math.min(1, Math.max(0, w)),
        h: Math.min(1, Math.max(0, h)),
      },
      confidence: Number.isFinite(rawLineConfidence) ? Math.min(1, Math.max(0, rawLineConfidence)) : 0,
      vertical: item.vertical === true,
      source: typeof item.source === 'string' ? item.source : 'ndlocr',
      needsReview: item.needs_review !== false,
      ...(typeof item.group_id === 'string' && item.group_id.trim() ? { groupId: item.group_id.trim() } : {}),
    }];
  });
  const normalizedFigureRegions = (Array.isArray(people.regions) ? people.regions : []).flatMap((entry): DetectedFigureRegion[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const source = item.source === 'face' ? 'face' : item.source === 'body' ? 'body' : null;
    const rawBox = Array.isArray(item.bbox) ? item.bbox.map(Number) : [];
    if (!source || rawBox.length !== 4 || rawBox.some((value) => !Number.isFinite(value))) return [];
    const [rawX, rawY, rawWidth, rawHeight] = rawBox;
    const left = clamp(rawX, 0, 1);
    const top = clamp(rawY, 0, 1);
    const right = clamp(rawX + rawWidth, 0, 1);
    const bottom = clamp(rawY + rawHeight, 0, 1);
    if (right - left < 0.005 || bottom - top < 0.005) return [];
    return [{
      source,
      bbox: {
        x: Number(left.toFixed(6)),
        y: Number(top.toFixed(6)),
        w: Number((right - left).toFixed(6)),
        h: Number((bottom - top).toFixed(6)),
      },
    }];
  }).sort((left, right) => Number(left.source === 'face') - Number(right.source === 'face'));
  const detectedFigures = normalizedFigureRegions.filter((candidate, index) => !normalizedFigureRegions.slice(0, index).some((kept) => {
    const intersection = overlapArea(candidate.bbox, kept.bbox);
    const candidateArea = candidate.bbox.w * candidate.bbox.h;
    const keptArea = kept.bbox.w * kept.bbox.h;
    const union = candidateArea + keptArea - intersection;
    const smaller = Math.min(candidateArea, keptArea);
    return smaller > 0 && (intersection / smaller >= 0.88 || (union > 0 && intersection / union >= 0.58));
  }));
  const detectedPanels = refineDetectedPanels(rawDetectedPanels, ocrLines);
  const removedPanelCount = rawDetectedPanels.length - detectedPanels.length;
  const baseReason = removedPanelCount > 0
    ? `重複または文字に対応しない候補を${removedPanelCount}個除外し、${detectedPanels.length}個のコマ領域を編集開始位置として使用します。`
    : typeof payload.reason === 'string' && payload.reason.trim()
      ? payload.reason.trim()
      : detectedPanels.length ? '検出したコマ領域を編集開始位置として使用できます。' : '読み取れるコマ領域を特定できませんでした。';
  const reason = detectedPanels.length
    ? `${baseReason} 内枠内へ収め、4mm以内の辺を整列し、コマ間は5mm空けています。`
    : baseReason;
  const detectedPanelCount = detectedPanels.length;
  return {
    detectedPanels,
    detectedFigures,
    reason,
    detectedPanelCount,
    structureEngine: typeof structure.engine === 'string' ? structure.engine : '',
    excludedNonPanelCount: Math.max(0, Math.round(
      (Number(structure.excluded_as_text_count) || 0)
      + (Number(structure.excluded_as_face_count) || 0)
      + (Number(structure.excluded_as_body_count) || 0),
    )) + Math.max(0, removedPanelCount),
    detectedTextRegionCount: Math.max(0, Math.round(Number(structure.text_region_count) || 0)),
    detectedFaceRegionCount: Math.max(0, Math.round(Number(structure.face_region_count) || 0)),
    detectedBodyRegionCount: Math.max(0, Math.round(Number(structure.body_region_count) || 0)),
    ocrEngine: typeof ocr.engine === 'string' ? ocr.engine : '',
    ocrLines,
  };
}

function nearestPanel(panels: Panel[], x: number, y: number): Panel | undefined {
  const containing = panels.filter((panel) => pointInPanel(panel, x, y)).sort((left, right) => {
    const leftBounds = panelBounds(left);
    const rightBounds = panelBounds(right);
    return leftBounds.w * leftBounds.h - rightBounds.w * rightBounds.h;
  });
  return containing[0] ?? [...panels].sort((left, right) => {
    const distance = (panel: Panel) => {
      const bounds = panelBounds(panel);
      const nearestX = clamp(x, bounds.x, bounds.x + bounds.w);
      const nearestY = clamp(y, bounds.y, bounds.y + bounds.h);
      return (x - nearestX) ** 2 + (y - nearestY) ** 2;
    };
    return distance(left) - distance(right);
  })[0];
}

/** 人物検出領域を紙面座標へ変換し、所属コマへ編集可能な人物あたりとして追加する。 */
export function attachDetectedFiguresToPage(
  page: MangaPage,
  regions: readonly DetectedFigureRegion[],
): { added: number } {
  let added = 0;
  for (const region of regions) {
    if (!page.panels.length) continue;
    const sourceBox = {
      x: region.bbox.x * page.canvas.w,
      y: region.bbox.y * page.canvas.h,
      w: region.bbox.w * page.canvas.w,
      h: region.bbox.h * page.canvas.h,
    };
    const centerX = sourceBox.x + sourceBox.w / 2;
    const centerY = sourceBox.y + sourceBox.h / 2;
    const panel = nearestPanel(page.panels, centerX, centerY);
    if (!panel) continue;
    const bounds = panelBounds(panel);
    const width = Math.min(bounds.w, Math.max(6, sourceBox.w));
    const height = Math.min(bounds.h, Math.max(6, sourceBox.h));
    const bbox: BBox = {
      x: roundMm(clamp(sourceBox.x, bounds.x, bounds.x + bounds.w - width)),
      y: roundMm(clamp(sourceBox.y, bounds.y, bounds.y + bounds.h - height)),
      w: roundMm(width),
      h: roundMm(height),
    };
    const duplicate = (panel.figures ?? []).some((figure) => {
      if (!figure.bbox) return false;
      const intersection = overlapArea(bbox, figure.bbox);
      const smaller = Math.min(bbox.w * bbox.h, figure.bbox.w * figure.bbox.h);
      return smaller > 0 && intersection / smaller >= 0.78;
    });
    if (duplicate) continue;
    (panel.figures ??= []).push({
      name: DETECTED_FIGURE_NAME,
      bbox,
      anchor: nearestAnchor(bounds, bbox),
      ...(region.source === 'face' ? { size: 'face' as const } : {}),
    });
    delete panel.no_figures;
    added += 1;
  }
  return { added };
}

/** OCR領域を紙面座標へ変換し、中心が入る（または最も近い）コマへ編集可能なフキダシとして追加する。 */
export function attachRecognizedTextToPage(
  page: MangaPage,
  lines: readonly RecognizedTextLine[],
): { added: number; needsReview: number } {
  let added = 0;
  let needsReview = 0;
  for (const line of groupRecognizedTextLines(lines)) {
    if (!line.text.trim() || !page.panels.length) continue;
    const sourceBox = {
      x: line.bbox.x * page.canvas.w,
      y: line.bbox.y * page.canvas.h,
      w: line.bbox.w * page.canvas.w,
      h: line.bbox.h * page.canvas.h,
    };
    const centerX = sourceBox.x + sourceBox.w / 2;
    const centerY = sourceBox.y + sourceBox.h / 2;
    const panel = nearestPanel(page.panels, centerX, centerY);
    if (!panel) continue;
    const bounds = panelBounds(panel);
    const width = Math.min(bounds.w, Math.max(6, sourceBox.w));
    const height = Math.min(bounds.h, Math.max(6, sourceBox.h));
    const bbox: BBox = {
      x: roundMm(clamp(sourceBox.x, bounds.x, bounds.x + bounds.w - width)),
      y: roundMm(clamp(sourceBox.y, bounds.y, bounds.y + bounds.h - height)),
      w: roundMm(width),
      h: roundMm(height),
    };
    panel.bubbles.push({
      text: line.text.trim(),
      shape: 'normal',
      bbox,
      anchor: nearestAnchor(bounds, bbox),
    });
    added += 1;
    if (line.needsReview) needsReview += 1;
  }
  return { added, needsReview };
}

async function imageDataUrl(file: File): Promise<string> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      const longest = Math.max(bitmap.width, bitmap.height);
      const scale = Math.min(1, 1800 / Math.max(longest, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('画像変換用キャンバスを作成できませんでした');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return canvas.toDataURL('image/jpeg', 0.94);
    } catch {
      // HEICなどブラウザで展開できない形式は、元データをbridgeへ渡してPillow側で試す。
    }
  }

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('画像を読み込めませんでした'));
    reader.onerror = () => reject(new Error('画像を読み込めませんでした'));
    reader.readAsDataURL(file);
  });
}

async function postJson(path: string, body: object, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(bridgeUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as { error?: unknown };
    if (!response.ok) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `ローカル連携に失敗しました（HTTP ${response.status}）`);
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('ローカル画像解析の応答が時間内に返りませんでした');
    }
    if (error instanceof TypeError) {
      throw new Error('ローカル連携が起動していません。ターミナルで npm run bridge を実行してください。');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function recognizePanelLayout(
  file: File,
  rotationOverride: 0 | 90 | 180 | 270,
): Promise<LayoutRecognitionResult> {
  const payload = await postJson('/api/layout/analyze', {
    filename: file.name,
    image: await imageDataUrl(file),
    rotation_override_degrees: rotationOverride,
  }) as BridgeLayoutResponse;
  return normalizeLayoutRecognition(payload);
}

function dataUrlFile(dataUrl: unknown, filename: unknown): File {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || !dataUrl.includes(',')) {
    throw new Error('スキャン画像の形式が正しくありません');
  }
  const [header, encoded] = dataUrl.split(',', 2);
  const mimeType = header.slice(5).split(';', 1)[0] || 'image/jpeg';
  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const safeName = typeof filename === 'string' && filename.trim() ? filename.trim() : 'scan.jpg';
  return new File([bytes], safeName, { type: mimeType });
}

function scannerSessionFromPayload(payload: Record<string, unknown>): ScannerSession {
  if (typeof payload.session_id !== 'string' || typeof payload.started_at !== 'string') {
    throw new Error('スキャン待機を開始できませんでした');
  }
  return {
    id: payload.session_id,
    startedAt: payload.started_at,
    expiresInSeconds: Math.max(1, Number(payload.expires_in_seconds) || 300),
    maxFiles: Math.min(10, Math.max(1, Number(payload.max_files) || 10)),
    directory: typeof payload.directory === 'string' ? payload.directory : '',
  };
}

function scannerFilesFromPayload(payload: Record<string, unknown>): ScannedImage[] {
  const rawFiles = Array.isArray(payload.files) ? payload.files.slice(0, 10) : [];
  return rawFiles.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string') return [];
    try {
      return [{
        id: item.id,
        file: dataUrlFile(item.image, item.filename),
        modifiedAt: typeof item.modified_at === 'string' ? item.modified_at : '',
      }];
    } catch {
      return [];
    }
  });
}

export async function openMacScanner(): Promise<ScannerSession> {
  const payload = await postJson('/api/scanner/open', {}, 10_000) as Record<string, unknown>;
  return scannerSessionFromPayload(payload);
}

export async function collectScannerImages(sessionId: string): Promise<ScannerCollection> {
  const payload = await postJson('/api/scanner/collect', { session_id: sessionId }, 15_000) as Record<string, unknown>;
  const files = scannerFilesFromPayload(payload);
  return {
    files,
    complete: payload.complete === true,
    remainingSeconds: Math.max(0, Number(payload.remaining_seconds) || 0),
    total: Math.min(10, Math.max(files.length, Number(payload.total) || 0)),
  };
}

export async function commitScannerSession(sessionId: string): Promise<void> {
  const payload = await postJson('/api/scanner/commit', { session_id: sessionId }, 15_000) as { errors?: unknown };
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`スキャン元を削除できませんでした: ${payload.errors.join(', ')}`);
  }
}

export async function finishScannerSession(sessionId: string): Promise<void> {
  await postJson('/api/scanner/finish', { session_id: sessionId }, 10_000);
}

export async function cancelScannerSession(sessionId: string): Promise<void> {
  const payload = await postJson('/api/scanner/cancel', { session_id: sessionId }, 15_000) as { errors?: unknown };
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`スキャン元を削除できませんでした: ${payload.errors.join(', ')}`);
  }
}

export async function getPendingScannerSession(): Promise<PendingScannerSession | null> {
  const payload = await postJson('/api/scanner/pending', {}, 10_000) as Record<string, unknown>;
  if (payload.pending !== true) return null;
  return {
    startedAt: typeof payload.started_at === 'string' ? payload.started_at : '',
    directory: typeof payload.directory === 'string' ? payload.directory : '',
    count: Math.min(10, Math.max(1, Number(payload.count) || 1)),
  };
}

export async function resumePendingScannerSession(): Promise<ResumedScannerSession> {
  const payload = await postJson('/api/scanner/resume', {}, 30_000) as Record<string, unknown>;
  return { session: scannerSessionFromPayload(payload), files: scannerFilesFromPayload(payload) };
}

export async function discardPendingScannerSession(): Promise<void> {
  const payload = await postJson('/api/scanner/discard-pending', {}, 15_000) as { errors?: unknown };
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`残っているスキャン元を削除できませんでした: ${payload.errors.join(', ')}`);
  }
}
