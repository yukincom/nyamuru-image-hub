import type { BBox, Bubble, VectorNode, VectorPath, VectorPoint } from '../types.ts';
import { defaultVectorStyle, insertVectorAnchor, moveVectorNode, paperPath, transformVector, vectorPathData, vectorShape } from './vectorGeometry.ts';

export type BubbleBezier = NonNullable<Bubble['bezier']>;
export const BUBBLE_BEZIER_PRESETS = [
  ['ellipse', '楕円'], ['rounded', '角丸'], ['cloud', '雲'], ['burst', 'トゲ'],
] as const;
export type BubbleBezierPreset = typeof BUBBLE_BEZIER_PRESETS[number][0];
export const MAX_BUBBLE_NODES = 128;

export function isBubbleBezier(value: unknown): value is BubbleBezier {
  if (!value || typeof value !== 'object' || !('nodes' in value) || !Array.isArray(value.nodes)) return false;
  const point = (p: unknown): p is VectorPoint => !!p && typeof p === 'object'
    && 'x' in p && 'y' in p && typeof p.x === 'number' && typeof p.y === 'number'
    && Number.isFinite(p.x) && Number.isFinite(p.y);
  return value.nodes.length >= 3 && value.nodes.length <= MAX_BUBBLE_NODES && value.nodes.every(n =>
    point(n)
    && (['handleIn', 'handleOut'] as const).every(key => {
      if (!(key in n)) return true;
      const handle = (n as VectorNode)[key];
      return handle === undefined || point(handle)&&Number.isFinite(n.x+handle.x)&&Number.isFinite(n.y+handle.y);
    }));
}

export function moveBubbleBezierNode(outline: BubbleBezier, index: number, point: VectorPoint, handle?: 'handleIn' | 'handleOut', independent = false): BubbleBezier {
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return outline;
  return { nodes: moveVectorNode(bubbleBezierPath(outline), index, point, handle, independent).nodes };
}

/** Share the existing vector path format and editing operations; only nodes are persisted. */
export function bubbleBezierPath(outline: BubbleBezier): VectorPath {
  return { id: 'bubble-outline', closed: true, nodes: outline.nodes, style: { ...defaultVectorStyle(), fill: '#ffffff', width: 1 } };
}

export function bubbleBezierData(outline: unknown): string | undefined {
  return isBubbleBezier(outline) ? vectorPathData(bubbleBezierPath(outline)) : undefined;
}

export function createBubbleBezier(preset: BubbleBezierPreset): BubbleBezier {
  if (preset === 'ellipse') return { nodes: vectorShape('ellipse', { x: 0, y: 0 }, { x: 100, y: 100 }, defaultVectorStyle()).nodes };
  if (preset === 'rounded') {
    const r = 18, k = r * 0.5522847498;
    return { nodes: [
      { x: r, y: 0, handleIn: { x: -k, y: 0 } }, { x: 100-r, y: 0, handleOut: { x: k, y: 0 } },
      { x: 100, y: r, handleIn: { x: 0, y: -k } }, { x: 100, y: 100-r, handleOut: { x: 0, y: k } },
      { x: 100-r, y: 100, handleIn: { x: k, y: 0 } }, { x: r, y: 100, handleOut: { x: -k, y: 0 } },
      { x: 0, y: 100-r, handleIn: { x: 0, y: k } }, { x: 0, y: r, handleOut: { x: 0, y: -k } },
    ] };
  }
  const count = preset === 'cloud' ? 12 : 24;
  const nodes: VectorNode[] = Array.from({ length: count }, (_, i) => {
    const a = i * Math.PI * 2 / count - Math.PI / 2;
    const radius = preset === 'cloud' ? 43 : i % 2 ? 38 : 50;
    return { x: 50 + radius * Math.cos(a), y: 50 + radius * Math.sin(a) };
  });
  if (preset === 'cloud') nodes.forEach((node, i) => {
    const next = nodes[(i + 1) % count], dx = next.x - node.x, dy = next.y - node.y;
    // Each lobe is a cubic segment with a shallow inward cusp at either end.
    node.handleOut = { x: dx / 3 + dy * .43, y: dy / 3 - dx * .43 };
    next.handleIn = { x: -dx / 3 + dy * .43, y: -dy / 3 - dx * .43 };
  });
  return { nodes };
}

export function addBubbleBezierNode(outline: BubbleBezier, index: number): BubbleBezier {
  if (outline.nodes.length >= MAX_BUBBLE_NODES) return outline;
  const path = bubbleBezierPath(outline), curve = paperPath(path);
  try {
    const point = curve.curves[index]?.getPointAtTime(.5);
    return point ? { nodes: insertVectorAnchor(path, { x: point.x, y: point.y }).nodes } : outline;
  } finally { curve.remove(); }
}

/** Intersect the actual cubic outline, including non-square resizing, with a centre ray. */
export function bubbleBezierBoundaryDistance(box: BBox, target: VectorPoint, outline: unknown): number | undefined {
  if (!isBubbleBezier(outline) || box.w <= 0 || box.h <= 0) return undefined;
  const center = bubbleBezierCenter(box, outline)!;
  const dx = target.x - center.x, dy = target.y - center.y, distance = Math.hypot(dx, dy);
  if (!distance) return undefined;
  const curve = paperPath(transformVector(bubbleBezierPath(outline), box.x, box.y, box.w / 100, box.h / 100));
  const length = Math.max(1,Math.hypot(curve.bounds.width,curve.bounds.height)*2,distance*2);
  const ray = paperPath({ ...bubbleBezierPath(outline), closed: false, nodes: [center, { x: center.x + dx / distance * length, y: center.y + dy / distance * length }] });
  try {
    const hits = curve.getIntersections(ray).map(hit => Math.hypot(hit.point.x-center.x, hit.point.y-center.y));
    // The outermost crossing avoids attaching a connector to an inward lobe.
    return hits.length ? Math.max(...hits) : undefined;
  } finally { curve.remove(); ray.remove(); }
}

export function bubbleBezierCenter(box: BBox, outline: unknown): VectorPoint | undefined {
  if (!isBubbleBezier(outline)) return undefined;
  const curve = paperPath(bubbleBezierPath(outline));
  try { return { x: box.x + curve.bounds.center.x * box.w/100, y: box.y + curve.bounds.center.y * box.h/100 }; }
  finally { curve.remove(); }
}
