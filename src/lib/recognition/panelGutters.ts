import type { PanelShape, BBox } from '../../types';
import {
  DEFAULT_PANEL_GUTTERS,
  roundMm,
  clamp,
  INNER_FRAME_BOUNDS,
  type PanelGutterSettings,
} from '../canvasGeometry.ts';
import {
  canonicalQuadPoints,
  shapeBounds,
  straightenNearRectShape,
  constrainDetectedPanelsToInnerFrame,
  alignNearRectEdges,
  type QuadPoints,
} from './panelGeometry.ts';

/** 隣接する検出矩形の外端を保ったまま、上下・左右それぞれのコマ間隔へ整える。 */
export function ensureDetectedPanelGutters(
  shapes: readonly PanelShape[],
  settings: PanelGutterSettings = DEFAULT_PANEL_GUTTERS,
): PanelShape[] {
  const source = shapes.map((shape) => structuredClone(shape));
  const next = shapes.map((shape) => structuredClone(shape));
  const rowGap = roundMm(clamp(settings.rowGapMm, 0, 20));
  const columnGap = roundMm(clamp(settings.columnGapMm, 0, 20));
  const hasInterveningPanel = (firstIndex: number, secondIndex: number, axis: 'row' | 'column') => {
    const first = source[firstIndex], second = source[secondIndex];
    if (first.type !== 'rect' || second.type !== 'rect') return false;
    const firstCenter = axis === 'row' ? first.y + first.h / 2 : first.x + first.w / 2;
    const secondCenter = axis === 'row' ? second.y + second.h / 2 : second.x + second.w / 2;
    const minimum = Math.min(firstCenter, secondCenter), maximum = Math.max(firstCenter, secondCenter);
    return source.some((candidate, candidateIndex) => {
      if (candidateIndex === firstIndex || candidateIndex === secondIndex || candidate.type !== 'rect') return false;
      const center = axis === 'row' ? candidate.y + candidate.h / 2 : candidate.x + candidate.w / 2;
      if (center <= minimum || center >= maximum) return false;
      if (axis === 'row') {
        const overlapFirst = Math.max(0, Math.min(first.x + first.w, candidate.x + candidate.w) - Math.max(first.x, candidate.x));
        const overlapSecond = Math.max(0, Math.min(second.x + second.w, candidate.x + candidate.w) - Math.max(second.x, candidate.x));
        return overlapFirst >= Math.min(first.w, candidate.w) * 0.2
          && overlapSecond >= Math.min(second.w, candidate.w) * 0.2;
      }
      const overlapFirst = Math.max(0, Math.min(first.y + first.h, candidate.y + candidate.h) - Math.max(first.y, candidate.y));
      const overlapSecond = Math.max(0, Math.min(second.y + second.h, candidate.y + candidate.h) - Math.max(second.y, candidate.y));
      return overlapFirst >= Math.min(first.h, candidate.h) * 0.2
        && overlapSecond >= Math.min(second.h, candidate.h) * 0.2;
    });
  };

  type GutterPair = { beforeIndex: number; afterIndex: number; boundary: number };
  const rowPairs: GutterPair[] = [];
  const columnPairs: GutterPair[] = [];
  for (let leftIndex = 0; leftIndex < source.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < source.length; rightIndex += 1) {
      const first = source[leftIndex];
      const second = source[rightIndex];
      if (first.type !== 'rect' || second.type !== 'rect') continue;
      const horizontalOverlap = Math.max(0, Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x));
      const verticalOverlap = Math.max(0, Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y));
      const normalizedHorizontalDistance = Math.abs((first.x + first.w / 2) - (second.x + second.w / 2)) / Math.max(1, (first.w + second.w) / 2);
      const normalizedVerticalDistance = Math.abs((first.y + first.h / 2) - (second.y + second.h / 2)) / Math.max(1, (first.h + second.h) / 2);

      if (normalizedVerticalDistance >= normalizedHorizontalDistance && horizontalOverlap >= Math.min(first.w, second.w) * 0.25) {
        const [upperIndex, lowerIndex] = first.y + first.h / 2 <= second.y + second.h / 2
          ? [leftIndex, rightIndex]
          : [rightIndex, leftIndex];
        if (hasInterveningPanel(leftIndex, rightIndex, 'row')) continue;
        const upper = source[upperIndex], lower = source[lowerIndex];
        if (upper.type !== 'rect' || lower.type !== 'rect') continue;
        const currentGap = lower.y - (upper.y + upper.h);
        if (currentGap > Math.max(12, rowGap + 4)) continue;
        rowPairs.push({ beforeIndex: upperIndex, afterIndex: lowerIndex, boundary: ((upper.y + upper.h) + lower.y) / 2 });
      } else if (verticalOverlap >= Math.min(first.h, second.h) * 0.25) {
        const [leftPanelIndex, rightPanelIndex] = first.x + first.w / 2 <= second.x + second.w / 2
          ? [leftIndex, rightIndex]
          : [rightIndex, leftIndex];
        if (hasInterveningPanel(leftIndex, rightIndex, 'column')) continue;
        const left = source[leftPanelIndex], right = source[rightPanelIndex];
        if (left.type !== 'rect' || right.type !== 'rect') continue;
        const currentGap = right.x - (left.x + left.w);
        if (currentGap > Math.max(12, columnGap + 4)) continue;
        columnPairs.push({ beforeIndex: leftPanelIndex, afterIndex: rightPanelIndex, boundary: ((left.x + left.w) + right.x) / 2 });
      }
    }
  }

  type EdgeTargets = { left: number[]; right: number[]; top: number[]; bottom: number[] };
  const targets = new Map<number, EdgeTargets>();
  const addTarget = (index: number, edge: keyof EdgeTargets, value: number) => {
    const existing = targets.get(index) ?? { left: [], right: [], top: [], bottom: [] };
    existing[edge].push(value);
    targets.set(index, existing);
  };
  const applyPairGroups = (pairs: GutterPair[], axis: 'row' | 'column', gap: number) => {
    const remaining = new Set(pairs.map((_, index) => index));
    while (remaining.size) {
      const seed = remaining.values().next().value;
      if (seed === undefined) break;
      remaining.delete(seed);
      const group = [pairs[seed]];
      for (let cursor = 0; cursor < group.length; cursor += 1) {
        const current = group[cursor];
        for (const candidateIndex of [...remaining]) {
          const candidate = pairs[candidateIndex];
          const sharesSameEdge = current.beforeIndex === candidate.beforeIndex
            || current.afterIndex === candidate.afterIndex;
          if (!sharesSameEdge && Math.abs(current.boundary - candidate.boundary) > 4) continue;
          remaining.delete(candidateIndex);
          group.push(candidate);
        }
      }
      const boundary = roundMm(group.reduce((sum, pair) => sum + pair.boundary, 0) / group.length);
      for (const pair of group) {
        if (axis === 'row') {
          addTarget(pair.beforeIndex, 'bottom', boundary - gap / 2);
          addTarget(pair.afterIndex, 'top', boundary + gap / 2);
        } else {
          addTarget(pair.beforeIndex, 'right', boundary - gap / 2);
          addTarget(pair.afterIndex, 'left', boundary + gap / 2);
        }
      }
    }
  };
  applyPairGroups(rowPairs, 'row', rowGap);
  applyPairGroups(columnPairs, 'column', columnGap);

  targets.forEach((edges, index) => {
    const original = source[index], shape = next[index];
    if (original.type !== 'rect' || shape.type !== 'rect') return;
    const average = (values: number[], fallback: number) => values.length
      ? roundMm(values.reduce((sum, value) => sum + value, 0) / values.length)
      : fallback;
    const left = average(edges.left, original.x);
    const right = average(edges.right, original.x + original.w);
    const top = average(edges.top, original.y);
    const bottom = average(edges.bottom, original.y + original.h);
    if (right - left >= 8) {
      shape.x = left;
      shape.w = roundMm(right - left);
    }
    if (bottom - top >= 8) {
      shape.y = top;
      shape.h = roundMm(bottom - top);
    }
  });
  return next;
}

function ensureDetectedPolygonGridGutters(
  shapes: readonly PanelShape[],
  settings: PanelGutterSettings,
): PanelShape[] {
  type QuadEntry = { index: number; points: QuadPoints; bounds: BBox };
  type GutterPair = {
    beforeIndex: number;
    afterIndex: number;
    boundary: number;
    spanStart: number;
    spanEnd: number;
  };
  const entries = shapes.flatMap((shape, index): QuadEntry[] => {
    const points = canonicalQuadPoints(shape);
    return points ? [{ index, points, bounds: shapeBounds({ type: 'polygon', points }) }] : [];
  });
  if (entries.length !== shapes.length) return shapes.map((shape) => structuredClone(shape));
  const rowGap = roundMm(clamp(settings.rowGapMm, 0, 20));
  const columnGap = roundMm(clamp(settings.columnGapMm, 0, 20));
  const sourceByIndex = new Map(entries.map((entry) => [entry.index, entry]));
  const mutableByIndex = new Map(entries.map((entry) => [entry.index, structuredClone(entry.points)]));
  const hasInterveningPanel = (first: QuadEntry, second: QuadEntry, axis: 'row' | 'column') => {
    const firstCenter = axis === 'row'
      ? first.bounds.y + first.bounds.h / 2
      : first.bounds.x + first.bounds.w / 2;
    const secondCenter = axis === 'row'
      ? second.bounds.y + second.bounds.h / 2
      : second.bounds.x + second.bounds.w / 2;
    const minimum = Math.min(firstCenter, secondCenter);
    const maximum = Math.max(firstCenter, secondCenter);
    return entries.some((candidate) => {
      if (candidate.index === first.index || candidate.index === second.index) return false;
      const center = axis === 'row'
        ? candidate.bounds.y + candidate.bounds.h / 2
        : candidate.bounds.x + candidate.bounds.w / 2;
      if (center <= minimum || center >= maximum) return false;
      if (axis === 'row') {
        const firstOverlap = Math.max(0, Math.min(first.bounds.x + first.bounds.w, candidate.bounds.x + candidate.bounds.w) - Math.max(first.bounds.x, candidate.bounds.x));
        const secondOverlap = Math.max(0, Math.min(second.bounds.x + second.bounds.w, candidate.bounds.x + candidate.bounds.w) - Math.max(second.bounds.x, candidate.bounds.x));
        return firstOverlap >= Math.min(first.bounds.w, candidate.bounds.w) * 0.2
          && secondOverlap >= Math.min(second.bounds.w, candidate.bounds.w) * 0.2;
      }
      const firstOverlap = Math.max(0, Math.min(first.bounds.y + first.bounds.h, candidate.bounds.y + candidate.bounds.h) - Math.max(first.bounds.y, candidate.bounds.y));
      const secondOverlap = Math.max(0, Math.min(second.bounds.y + second.bounds.h, candidate.bounds.y + candidate.bounds.h) - Math.max(second.bounds.y, candidate.bounds.y));
      return firstOverlap >= Math.min(first.bounds.h, candidate.bounds.h) * 0.2
        && secondOverlap >= Math.min(second.bounds.h, candidate.bounds.h) * 0.2;
    });
  };

  const rowPairs: GutterPair[] = [];
  const columnPairs: GutterPair[] = [];
  for (let firstIndex = 0; firstIndex < entries.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < entries.length; secondIndex += 1) {
      const first = entries[firstIndex], second = entries[secondIndex];
      const firstBounds = first.bounds, secondBounds = second.bounds;
      const horizontalOverlap = Math.max(0, Math.min(firstBounds.x + firstBounds.w, secondBounds.x + secondBounds.w) - Math.max(firstBounds.x, secondBounds.x));
      const verticalOverlap = Math.max(0, Math.min(firstBounds.y + firstBounds.h, secondBounds.y + secondBounds.h) - Math.max(firstBounds.y, secondBounds.y));
      const normalizedHorizontalDistance = Math.abs((firstBounds.x + firstBounds.w / 2) - (secondBounds.x + secondBounds.w / 2)) / Math.max(1, (firstBounds.w + secondBounds.w) / 2);
      const normalizedVerticalDistance = Math.abs((firstBounds.y + firstBounds.h / 2) - (secondBounds.y + secondBounds.h / 2)) / Math.max(1, (firstBounds.h + secondBounds.h) / 2);

      if (normalizedVerticalDistance >= normalizedHorizontalDistance && horizontalOverlap >= Math.min(firstBounds.w, secondBounds.w) * 0.25) {
        const [upper, lower] = firstBounds.y + firstBounds.h / 2 <= secondBounds.y + secondBounds.h / 2
          ? [first, second]
          : [second, first];
        if (hasInterveningPanel(first, second, 'row')) continue;
        const currentGap = lower.bounds.y - (upper.bounds.y + upper.bounds.h);
        if (currentGap > Math.max(12, rowGap + 4)) continue;
        rowPairs.push({
          beforeIndex: upper.index,
          afterIndex: lower.index,
          boundary: ((upper.bounds.y + upper.bounds.h) + lower.bounds.y) / 2,
          spanStart: Math.max(upper.bounds.x, lower.bounds.x),
          spanEnd: Math.min(upper.bounds.x + upper.bounds.w, lower.bounds.x + lower.bounds.w),
        });
      } else if (verticalOverlap >= Math.min(firstBounds.h, secondBounds.h) * 0.25) {
        const [left, right] = firstBounds.x + firstBounds.w / 2 <= secondBounds.x + secondBounds.w / 2
          ? [first, second]
          : [second, first];
        if (hasInterveningPanel(first, second, 'column')) continue;
        const currentGap = right.bounds.x - (left.bounds.x + left.bounds.w);
        if (currentGap > Math.max(12, columnGap + 4)) continue;
        columnPairs.push({
          beforeIndex: left.index,
          afterIndex: right.index,
          boundary: ((left.bounds.x + left.bounds.w) + right.bounds.x) / 2,
          spanStart: Math.max(left.bounds.y, right.bounds.y),
          spanEnd: Math.min(left.bounds.y + left.bounds.h, right.bounds.y + right.bounds.h),
        });
      }
    }
  }

  const groupedPairs = (pairs: readonly GutterPair[]) => {
    const remaining = new Set(pairs.map((_, index) => index));
    const groups: GutterPair[][] = [];
    while (remaining.size) {
      const seedIndex = remaining.values().next().value;
      if (seedIndex === undefined) break;
      remaining.delete(seedIndex);
      const group = [pairs[seedIndex]];
      for (let cursor = 0; cursor < group.length; cursor += 1) {
        const current = group[cursor];
        for (const candidateIndex of [...remaining]) {
          const candidate = pairs[candidateIndex];
          const sharesPanelEdge = current.beforeIndex === candidate.beforeIndex
            || current.afterIndex === candidate.afterIndex;
          const spansTouch = Math.min(current.spanEnd, candidate.spanEnd) >= Math.max(current.spanStart, candidate.spanStart) - 4;
          if (!sharesPanelEdge && !(spansTouch && Math.abs(current.boundary - candidate.boundary) <= 4)) continue;
          remaining.delete(candidateIndex);
          group.push(candidate);
        }
      }
      groups.push(group);
    }
    return groups;
  };
  const fit = (points: readonly [number, number][], dependentAxis: 0 | 1) => {
    const independentAxis = dependentAxis === 0 ? 1 : 0;
    const independentMean = points.reduce((sum, point) => sum + point[independentAxis], 0) / points.length;
    const dependentMean = points.reduce((sum, point) => sum + point[dependentAxis], 0) / points.length;
    const denominator = points.reduce((sum, point) => sum + (point[independentAxis] - independentMean) ** 2, 0);
    const slope = denominator < 1e-9 ? 0 : points.reduce((sum, point) => (
      sum + (point[independentAxis] - independentMean) * (point[dependentAxis] - dependentMean)
    ), 0) / denominator;
    return { slope, intercept: dependentMean - slope * independentMean };
  };

  for (const group of groupedPairs(rowPairs)) {
    const points = group.flatMap((pair): [number, number][] => {
      const upper = sourceByIndex.get(pair.beforeIndex)!.points;
      const lower = sourceByIndex.get(pair.afterIndex)!.points;
      return [upper[2], upper[3], lower[0], lower[1]];
    });
    const line = fit(points, 1);
    for (const index of new Set(group.map((pair) => pair.beforeIndex))) {
      const mutable = mutableByIndex.get(index)!;
      mutable[2][1] = line.slope * mutable[2][0] + line.intercept - rowGap / 2;
      mutable[3][1] = line.slope * mutable[3][0] + line.intercept - rowGap / 2;
    }
    for (const index of new Set(group.map((pair) => pair.afterIndex))) {
      const mutable = mutableByIndex.get(index)!;
      mutable[0][1] = line.slope * mutable[0][0] + line.intercept + rowGap / 2;
      mutable[1][1] = line.slope * mutable[1][0] + line.intercept + rowGap / 2;
    }
  }
  for (const group of groupedPairs(columnPairs)) {
    const points = group.flatMap((pair): [number, number][] => {
      const left = sourceByIndex.get(pair.beforeIndex)!.points;
      const right = sourceByIndex.get(pair.afterIndex)!.points;
      return [left[1], left[2], right[0], right[3]];
    });
    const line = fit(points, 0);
    for (const index of new Set(group.map((pair) => pair.beforeIndex))) {
      const mutable = mutableByIndex.get(index)!;
      mutable[1][0] = line.slope * mutable[1][1] + line.intercept - columnGap / 2;
      mutable[2][0] = line.slope * mutable[2][1] + line.intercept - columnGap / 2;
    }
    for (const index of new Set(group.map((pair) => pair.afterIndex))) {
      const mutable = mutableByIndex.get(index)!;
      mutable[0][0] = line.slope * mutable[0][1] + line.intercept + columnGap / 2;
      mutable[3][0] = line.slope * mutable[3][1] + line.intercept + columnGap / 2;
    }
  }

  return entries.map((entry) => straightenNearRectShape({
    type: 'polygon',
    points: mutableByIndex.get(entry.index)!.map(([x, y]) => [
      roundMm(clamp(x, INNER_FRAME_BOUNDS.x, INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w)),
      roundMm(clamp(y, INNER_FRAME_BOUNDS.y, INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h)),
    ]),
  }));
}

/** コマ形状はOCR結果から独立して整形する。文字のないコマも実在するため削除しない。 */
export function normalizeDetectedPanelGeometry(
  shapes: readonly PanelShape[],
  gutterSettings: PanelGutterSettings,
): PanelShape[] {
  const constrained = constrainDetectedPanelsToInnerFrame(shapes);
  return constrained.some((shape) => shape.type === 'polygon')
    ? ensureDetectedPolygonGridGutters(constrained, gutterSettings)
    : ensureDetectedPanelGutters(alignNearRectEdges(constrained), gutterSettings);
}
