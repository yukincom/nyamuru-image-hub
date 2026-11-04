import type { Panel } from '../../types';
import { type PanelEdgeReference, type CanvasSize, DEFAULT_CANVAS, roundMm, clamp } from './canvasBounds.ts';
import { findLinkedPanelEdges, edgePoints } from './panelBoundaries.ts';
import { resizePanelToBounds } from './panelTransforms.ts';

function edgeReferences(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  linkPanels: boolean,
  excludedEdge?: PanelEdgeReference,
): PanelEdgeReference[] {
  const first = { panelIndex, edgeIndex };
  if (!linkPanels) return [first];
  const references: PanelEdgeReference[] = [first];
  const visited = new Set([`${panelIndex}:${edgeIndex}`]);
  if (excludedEdge) visited.add(`${excludedEdge.panelIndex}:${excludedEdge.edgeIndex}`);
  for (let cursor = 0; cursor < references.length; cursor += 1) {
    const reference = references[cursor];
    findLinkedPanelEdges(panels, reference.panelIndex, reference.edgeIndex).forEach((linked) => {
      const key = `${linked.panelIndex}:${linked.edgeIndex}`;
      if (visited.has(key)) return;
      visited.add(key);
      references.push(linked);
    });
  }
  return references;
}

function clampedEdgeDelta(
  panels: Panel[],
  references: PanelEdgeReference[],
  deltaX: number,
  deltaY: number,
  minSize = 20,
  canvas: CanvasSize = DEFAULT_CANVAS,
  outerMargin = 0,
): { x: number; y: number } {
  const margin = Math.max(0, outerMargin);
  let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
  references.forEach(({ panelIndex, edgeIndex }) => {
    const panel = panels[panelIndex];
    const edge = panel && edgePoints(panel, edgeIndex);
    if (!panel || !edge) return;
    const [start, end] = edge;
    minX = Math.max(minX, -margin - Math.min(start[0], end[0]));
    maxX = Math.min(maxX, canvas.w + margin - Math.max(start[0], end[0]));
    minY = Math.max(minY, -margin - Math.min(start[1], end[1]));
    maxY = Math.min(maxY, canvas.h + margin - Math.max(start[1], end[1]));
    if (panel.shape.type !== 'rect') return;
    const { x, y, w, h } = panel.shape;
    const minWidth = Math.min(minSize, w), minHeight = Math.min(minSize, h);
    if (edgeIndex === 0) maxY = Math.min(maxY, h - minHeight);
    if (edgeIndex === 1) minX = Math.max(minX, minWidth - w);
    if (edgeIndex === 2) minY = Math.max(minY, minHeight - h);
    if (edgeIndex === 3) maxX = Math.min(maxX, w - minWidth);
    // 紙面側の制限は端点制限と同値だが、数値誤差を避けるため明示する。
    if (edgeIndex === 0) minY = Math.max(minY, -margin - y);
    if (edgeIndex === 1) maxX = Math.min(maxX, canvas.w + margin - (x + w));
    if (edgeIndex === 2) maxY = Math.min(maxY, canvas.h + margin - (y + h));
    if (edgeIndex === 3) minX = Math.max(minX, -margin - x);
  });
  return {
    x: roundMm(clamp(deltaX, minX, maxX)),
    y: roundMm(clamp(deltaY, minY, maxY)),
  };
}

function applyEdgeDelta(panel: Panel, edgeIndex: number, deltaX: number, deltaY: number): void {
  if (panel.shape.type === 'polygon') {
    const count = panel.shape.points.length;
    if (!count || edgeIndex < 0 || edgeIndex >= count) return;
    const nextIndex = (edgeIndex + 1) % count;
    panel.shape.points[edgeIndex] = [
      roundMm(panel.shape.points[edgeIndex][0] + deltaX),
      roundMm(panel.shape.points[edgeIndex][1] + deltaY),
    ];
    panel.shape.points[nextIndex] = [
      roundMm(panel.shape.points[nextIndex][0] + deltaX),
      roundMm(panel.shape.points[nextIndex][1] + deltaY),
    ];
    return;
  }
  const next = { ...panel.shape };
  if (edgeIndex === 0) { next.y += deltaY; next.h -= deltaY; }
  if (edgeIndex === 1) next.w += deltaX;
  if (edgeIndex === 2) next.h += deltaY;
  if (edgeIndex === 3) { next.x += deltaX; next.w -= deltaX; }
  resizePanelToBounds(panel, next);
}

/**
 * 選択辺を平行移動する。linkPanels=true の場合は近接する平行辺も同じ量だけ動かし、
 * 水平・垂直・斜めのコマ間隔を維持する。
 */
export function movePanelEdge(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  deltaX: number,
  deltaY: number,
  linkPanels = false,
  excludedEdge?: PanelEdgeReference,
  canvas: CanvasSize = DEFAULT_CANVAS,
  outerMargin = 0,
): { x: number; y: number; linkedEdges: number } {
  const selected = panels[panelIndex] && edgePoints(panels[panelIndex], edgeIndex);
  if (!selected) return { x: 0, y: 0, linkedEdges: 0 };
  const references = edgeReferences(panels, panelIndex, edgeIndex, linkPanels, excludedEdge);
  const delta = clampedEdgeDelta(panels, references, deltaX, deltaY, Math.min(20, canvas.w / 4, canvas.h / 4), canvas, outerMargin);
  if (delta.x === 0 && delta.y === 0) return { ...delta, linkedEdges: Math.max(0, references.length - 1) };
  references.forEach((reference) => {
    const panel = panels[reference.panelIndex];
    if (panel) applyEdgeDelta(panel, reference.edgeIndex, delta.x, delta.y);
  });
  return { ...delta, linkedEdges: Math.max(0, references.length - 1) };
}
