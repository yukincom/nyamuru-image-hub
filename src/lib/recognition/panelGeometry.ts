import type { PanelShape, BBox, Panel } from '../../types';
import { panelBounds, INNER_FRAME_BOUNDS, roundMm, clamp, pointInPanel } from '../canvasGeometry.ts';

export function shapeBounds(shape: PanelShape): BBox {
  return panelBounds({ id: 0, shape, bg: 0, bubbles: [], action: null });
}

export function detectedSourceFrame(shapes: readonly PanelShape[]): BBox | null {
  if (!shapes.length) return null;
  const bounds = shapes.map(shapeBounds);
  const left = Math.min(...bounds.map((box) => box.x));
  const top = Math.min(...bounds.map((box) => box.y));
  const right = Math.max(...bounds.map((box) => box.x + box.w));
  const bottom = Math.max(...bounds.map((box) => box.y + box.h));
  const normalized = {
    x: Number((left / 210).toFixed(6)),
    y: Number((top / 297).toFixed(6)),
    w: Number(((right - left) / 210).toFixed(6)),
    h: Number(((bottom - top) / 297).toFixed(6)),
  };
  // 一部のコマしか検出できなかった場合、それをページ全体まで拡大しない。
  return normalized.w >= 0.72 && normalized.h >= 0.72 ? normalized : null;
}

export function sourceFrameBoxToCanvas(box: BBox, sourceFrame: BBox | null, canvasWidth: number, canvasHeight: number): BBox {
  if (!sourceFrame) return {
    x: box.x * canvasWidth,
    y: box.y * canvasHeight,
    w: box.w * canvasWidth,
    h: box.h * canvasHeight,
  };
  const scaleX = INNER_FRAME_BOUNDS.w / sourceFrame.w;
  const scaleY = INNER_FRAME_BOUNDS.h / sourceFrame.h;
  return {
    x: INNER_FRAME_BOUNDS.x + (box.x - sourceFrame.x) * scaleX,
    y: INNER_FRAME_BOUNDS.y + (box.y - sourceFrame.y) * scaleY,
    w: box.w * scaleX,
    h: box.h * scaleY,
  };
}

export function sourceFrameShapeToInnerFrame(shape: PanelShape, sourceFrame: BBox): PanelShape {
  const transformPoint = ([x, y]: [number, number]): [number, number] => [
    roundMm(INNER_FRAME_BOUNDS.x + ((x / 210) - sourceFrame.x) * (INNER_FRAME_BOUNDS.w / sourceFrame.w)),
    roundMm(INNER_FRAME_BOUNDS.y + ((y / 297) - sourceFrame.y) * (INNER_FRAME_BOUNDS.h / sourceFrame.h)),
  ];
  if (shape.type === 'polygon') return { type: 'polygon', points: shape.points.map(transformPoint) };
  const [left, top] = transformPoint([shape.x, shape.y]);
  const [right, bottom] = transformPoint([shape.x + shape.w, shape.y + shape.h]);
  return { type: 'rect', x: left, y: top, w: roundMm(right - left), h: roundMm(bottom - top) };
}

export function normalizedPanelBox(entry: unknown, minimumSize = 0.005): BBox | null {
  const values = Array.isArray(entry) ? entry.map(Number) : [];
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [rawX, rawY, rawWidth, rawHeight] = values;
  const left = clamp(rawX, 0, 1);
  const top = clamp(rawY, 0, 1);
  const right = clamp(rawX + rawWidth, 0, 1);
  const bottom = clamp(rawY + rawHeight, 0, 1);
  if (right <= left || bottom <= top || right - left < minimumSize || bottom - top < minimumSize) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function normalizedBoxToPanelShape(box: BBox): PanelShape {
  return {
    type: 'rect',
    x: roundMm(box.x * 210),
    y: roundMm(box.y * 297),
    w: roundMm(box.w * 210),
    h: roundMm(box.h * 297),
  };
}

export function boxIntersectionOverUnion(left: BBox, right: BBox): number {
  const intersection = overlapArea(left, right);
  const union = left.w * left.h + right.w * right.h - intersection;
  return union > 0 ? intersection / union : 0;
}

export type QuadPoints = [[number, number], [number, number], [number, number], [number, number]];

export function canonicalQuadPoints(shape: PanelShape): QuadPoints | null {
  if (shape.type === 'rect') return [
    [shape.x, shape.y],
    [shape.x + shape.w, shape.y],
    [shape.x + shape.w, shape.y + shape.h],
    [shape.x, shape.y + shape.h],
  ];
  if (shape.points.length !== 4) return null;
  const orderedByY = [...shape.points].sort((left, right) => left[1] - right[1] || left[0] - right[0]);
  const top = orderedByY.slice(0, 2).sort((left, right) => left[0] - right[0]);
  const bottom = orderedByY.slice(2).sort((left, right) => right[0] - left[0]);
  return [top[0], top[1], bottom[0], bottom[1]].map(([x, y]) => [x, y]) as QuadPoints;
}

/** 5°以内のスキャン由来の傾きは手振れとして扱い、編集しやすい矩形へ戻す。 */
export function straightenNearRectShape(shape: PanelShape, thresholdDegrees = 5): PanelShape {
  if (shape.type === 'rect') return structuredClone(shape);
  const points = canonicalQuadPoints(shape);
  if (!points) return structuredClone(shape);
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  const horizontalDeviation = (start: [number, number], end: [number, number]) => (
    Math.atan2(Math.abs(end[1] - start[1]), Math.abs(end[0] - start[0])) * 180 / Math.PI
  );
  const verticalDeviation = (start: [number, number], end: [number, number]) => (
    Math.atan2(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1])) * 180 / Math.PI
  );
  const nearRect = horizontalDeviation(topLeft, topRight) <= thresholdDegrees
    && horizontalDeviation(bottomLeft, bottomRight) <= thresholdDegrees
    && verticalDeviation(topLeft, bottomLeft) <= thresholdDegrees
    && verticalDeviation(topRight, bottomRight) <= thresholdDegrees;
  if (!nearRect) return { type: 'polygon', points };
  const left = Math.min(...points.map((point) => point[0]));
  const right = Math.max(...points.map((point) => point[0]));
  const top = Math.min(...points.map((point) => point[1]));
  const bottom = Math.max(...points.map((point) => point[1]));
  return { type: 'rect', x: roundMm(left), y: roundMm(top), w: roundMm(right - left), h: roundMm(bottom - top) };
}

export function overlapArea(left: BBox, right: BBox): number {
  return Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x))
    * Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y));
}

/**
 * 1つの検出領域が複数コマの絵として使われているかを、検出時点のコマ形状で判定する。
 * 形状整形後の溝やスナップ位置は所属判定へ混ぜない。
 */
export function belongsToPageOverlay(
  panels: readonly Panel[],
  box: BBox,
  confidence: number,
  allowOutsidePanels: boolean,
  preferredPanel?: Panel,
): boolean {
  const area = box.w * box.h;
  if (!panels.length || area <= 0) return false;
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  // 斜め小コマの外接矩形は上下のコマと重なる。人物領域が最小の
  // 内包コマへほぼ完全に収まるなら、矩形同士の重なりだけで
  // 「複数コマをまたぐ人物」へ昇格させない。
  if (preferredPanel && pointInPanel(preferredPanel, centerX, centerY)
    && overlapArea(box, panelBounds(preferredPanel)) / area >= 0.90) return false;
  const coverage = panels
    .map((panel) => overlapArea(box, panelBounds(panel)) / area)
    .sort((left, right) => right - left);
  const materialOverlaps = coverage.filter((ratio) => ratio >= 0.12);
  if (materialOverlaps.length >= 2 && materialOverlaps[0] + materialOverlaps[1] >= 0.55) return true;

  // コマ外へ置かれた大きな人物も救う。小さな誤検出やOCR領域には適用しない。
  if (!allowOutsidePanels || confidence < 0.35 || area < 210 * 297 * 0.025) return false;
  return !panels.some((panel) => pointInPanel(panel, centerX, centerY)) && (coverage[0] ?? 0) < 0.45;
}

export function detectedPanelIndexesToKeep(shapes: readonly PanelShape[]): number[] {
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
    if (duplicate) continue;
    const containedParts = [...kept].flatMap((keptIndex) => {
      const keptBox = bounds[keptIndex];
      const keptArea = keptBox.w * keptBox.h;
      const intersection = overlapArea(candidateBox, keptBox);
      const centerX = keptBox.x + keptBox.w / 2;
      const centerY = keptBox.y + keptBox.h / 2;
      const centerInside = centerX >= candidateBox.x && centerX <= candidateBox.x + candidateBox.w
        && centerY >= candidateBox.y && centerY <= candidateBox.y + candidateBox.h;
      return keptArea > 0 && centerInside && intersection / keptArea >= 0.8 ? [{ intersection }] : [];
    });
    const candidateArea = candidateBox.w * candidateBox.h;
    const splitArtifact = shapes[candidate.index].type === 'rect'
      && containedParts.length >= 2
      && containedParts.reduce((sum, part) => sum + part.intersection, 0) / candidateArea >= 0.72;
    if (!splitArtifact) kept.add(candidate.index);
  }
  return shapes.flatMap((_, index) => kept.has(index) ? [index] : []);
}

type MutableRectEdges = { left: number; right: number; top: number; bottom: number };

export function constrainDetectedPanelsToInnerFrame(shapes: readonly PanelShape[]): PanelShape[] {
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

export function alignNearRectEdges(shapes: readonly PanelShape[], threshold = 4): PanelShape[] {
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

export function nearestPanel(panels: Panel[], x: number, y: number): Panel | undefined {
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
