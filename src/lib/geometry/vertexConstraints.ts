import { type PanelEdgeReference, clamp, roundMm, PANEL_EDGE_ALIGNMENT_TOLERANCE_MM, type CanvasSize, DEFAULT_CANVAS, panelShapePoints, PANEL_EDGE_LINK_DISTANCE_MM, PANEL_VERTEX_WALL_OFFSET_TOLERANCE_MM, PANEL_VERTEX_JUNCTION_ALONG_GAP_MM, innerFrameBounds } from './canvasBounds.ts';
import { type PointLegalBounds, edgeIsLockedBoundary, pointBoundaryLocks } from './panelBoundaries.ts';
import type { Panel } from '../../types';

export interface VertexEdgeCandidate extends PanelEdgeReference {
  signedNormalDistance: number;
  projectionMin: number;
  projectionMax: number;
  sharesProjection: boolean;
  originGap: number;
  nearestVertexIndex: number;
  nearestDistance: number;
}

export interface VertexSplitDeformation {
  selectedEdgeIndex: number;
  panelIndex: number;
  edgeIndex: number;
}

export interface VertexJunctionReference {
  panelIndex: number;
  vertexIndex: number;
  distance: number;
}

export interface LineConstraint {
  point: [number, number];
  vector: [number, number];
  preferred?: [number, number];
}

/** 直線を合法矩形で切り、preferredに最も近い直線上の点を返す。 */
export function pointOnLineWithinBounds(
  line: LineConstraint,
  preferred: [number, number],
  bounds: PointLegalBounds,
): [number, number] | null {
  let minimumParameter = -Infinity;
  let maximumParameter = Infinity;
  const restrict = (origin: number, direction: number, minimum: number, maximum: number): boolean => {
    if (Math.abs(direction) <= 1e-6) return origin >= minimum - 1e-6 && origin <= maximum + 1e-6;
    const first = (minimum - origin) / direction;
    const second = (maximum - origin) / direction;
    minimumParameter = Math.max(minimumParameter, Math.min(first, second));
    maximumParameter = Math.min(maximumParameter, Math.max(first, second));
    return minimumParameter <= maximumParameter + 1e-6;
  };
  if (!restrict(line.point[0], line.vector[0], bounds.minX, bounds.maxX)
    || !restrict(line.point[1], line.vector[1], bounds.minY, bounds.maxY)) return null;
  const lengthSquared = line.vector[0] ** 2 + line.vector[1] ** 2;
  if (lengthSquared <= 1e-12) return null;
  const preferredParameter = ((preferred[0] - line.point[0]) * line.vector[0]
    + (preferred[1] - line.point[1]) * line.vector[1]) / lengthSquared;
  const parameter = clamp(preferredParameter, minimumParameter, maximumParameter);
  return [
    roundMm(line.point[0] + line.vector[0] * parameter),
    roundMm(line.point[1] + line.vector[1] * parameter),
  ];
}

export function constrainedPointOnLine(provisional: [number, number], line: LineConstraint): [number, number] {
  const [dx, dy] = line.vector;
  if (Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) > 1e-6) {
    const t = (provisional[1] - line.point[1]) / dy;
    return [line.point[0] + dx * t, provisional[1]];
  }
  if (Math.abs(dx) > 1e-6) {
    const t = (provisional[0] - line.point[0]) / dx;
    return [provisional[0], line.point[1] + dy * t];
  }
  return provisional;
}

export function lineIntersection(first: LineConstraint, second: LineConstraint): [number, number] | null {
  const denominator = first.vector[0] * second.vector[1] - first.vector[1] * second.vector[0];
  if (Math.abs(denominator) <= 1e-6) return null;
  const offsetX = second.point[0] - first.point[0], offsetY = second.point[1] - first.point[1];
  const t = (offsetX * second.vector[1] - offsetY * second.vector[0]) / denominator;
  return [first.point[0] + first.vector[0] * t, first.point[1] + first.vector[1] * t];
}

function intervalGap(firstMin: number, firstMax: number, secondMin: number, secondMax: number): number {
  if (firstMax < secondMin) return secondMin - firstMax;
  if (secondMax < firstMin) return firstMin - secondMax;
  return 0;
}

function intervalOverlap(firstMin: number, firstMax: number, secondMin: number, secondMax: number): number {
  return Math.max(0, Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin));
}

export function sameNormalSide(first: number, second: number): boolean {
  const firstOnLine = Math.abs(first) <= PANEL_EDGE_ALIGNMENT_TOLERANCE_MM;
  const secondOnLine = Math.abs(second) <= PANEL_EDGE_ALIGNMENT_TOLERANCE_MM;
  return (firstOnLine && secondOnLine)
    || (!firstOnLine && !secondOnLine && Math.sign(first) === Math.sign(second));
}

/** 選択頂点から伸びる1本の入射辺に、直接向かい合う辺だけを分類する。 */
export function vertexEdgeCandidates(
  panels: Panel[],
  selectedPanelIndex: number,
  selectedPoint: [number, number],
  fixedPoint: [number, number],
  canvas: CanvasSize = DEFAULT_CANVAS,
): VertexEdgeCandidate[] {
  const vectorX = fixedPoint[0] - selectedPoint[0], vectorY = fixedPoint[1] - selectedPoint[1];
  const length = Math.hypot(vectorX, vectorY);
  if (!length) return [];
  const unitX = vectorX / length, unitY = vectorY / length;
  const normalX = -unitY, normalY = unitX;
  const candidates: VertexEdgeCandidate[] = [];

  panels.forEach((panel, panelIndex) => {
    if (panelIndex === selectedPanelIndex) return;
    const points = panelShapePoints(panel);
    points.forEach((candidateStart, edgeIndex) => {
      if (edgeIsLockedBoundary(panel, edgeIndex, canvas)) return;
      const endIndex = (edgeIndex + 1) % points.length;
      const candidateEnd = points[endIndex];
      const candidateVectorX = candidateEnd[0] - candidateStart[0];
      const candidateVectorY = candidateEnd[1] - candidateStart[1];
      const candidateLength = Math.hypot(candidateVectorX, candidateVectorY);
      if (!candidateLength) return;
      const parallelError = Math.abs(vectorX * candidateVectorY - vectorY * candidateVectorX) / (length * candidateLength);
      if (parallelError > 0.08) return;

      const signedDistanceStart = (candidateStart[0] - selectedPoint[0]) * normalX
        + (candidateStart[1] - selectedPoint[1]) * normalY;
      const signedDistanceEnd = (candidateEnd[0] - selectedPoint[0]) * normalX
        + (candidateEnd[1] - selectedPoint[1]) * normalY;
      const normalDistance = (Math.abs(signedDistanceStart) + Math.abs(signedDistanceEnd)) / 2;
      if (normalDistance > PANEL_EDGE_LINK_DISTANCE_MM) return;

      const projectionA = (candidateStart[0] - selectedPoint[0]) * unitX
        + (candidateStart[1] - selectedPoint[1]) * unitY;
      const projectionB = (candidateEnd[0] - selectedPoint[0]) * unitX
        + (candidateEnd[1] - selectedPoint[1]) * unitY;
      const projectionMin = Math.min(projectionA, projectionB);
      const projectionMax = Math.max(projectionA, projectionB);
      const projectionOverlap = Math.max(0, Math.min(length, projectionMax) - Math.max(0, projectionMin));
      const sharesProjection = projectionOverlap >= Math.min(8, Math.min(length, candidateLength) * 0.25);
      const originGap = projectionMin <= 0 && projectionMax >= 0
        ? 0
        : Math.min(Math.abs(projectionMin), Math.abs(projectionMax));
      const startDistance = Math.hypot(candidateStart[0] - selectedPoint[0], candidateStart[1] - selectedPoint[1]);
      const endDistance = Math.hypot(candidateEnd[0] - selectedPoint[0], candidateEnd[1] - selectedPoint[1]);
      const nearestIsStart = startDistance <= endDistance;
      candidates.push({
        panelIndex,
        edgeIndex,
        signedNormalDistance: (signedDistanceStart + signedDistanceEnd) / 2,
        projectionMin,
        projectionMax,
        sharesProjection,
        originGap,
        nearestVertexIndex: nearestIsStart ? edgeIndex : endIndex,
        nearestDistance: nearestIsStart ? startDistance : endDistance,
      });
    });
  });
  return candidates;
}

/** 同じ対向壁を分割している辺を、選択入射辺から直接見える範囲だけでまとめる。 */
export function splitWallGroups(candidates: VertexEdgeCandidate[]): VertexEdgeCandidate[][] {
  const projected = candidates.filter((candidate) => candidate.sharesProjection);
  const visited = new Set<number>();
  const groups: VertexEdgeCandidate[][] = [];
  projected.forEach((candidate, startIndex) => {
    if (visited.has(startIndex)) return;
    visited.add(startIndex);
    const group: VertexEdgeCandidate[] = [candidate];
    const queue = [startIndex];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = projected[queue[cursor]];
      projected.forEach((other, otherIndex) => {
        if (visited.has(otherIndex)) return;
        if (!sameNormalSide(current.signedNormalDistance, other.signedNormalDistance)) return;
        if (Math.abs(current.signedNormalDistance - other.signedNormalDistance) > PANEL_VERTEX_WALL_OFFSET_TOLERANCE_MM) return;
        const gap = intervalGap(current.projectionMin, current.projectionMax, other.projectionMin, other.projectionMax);
        const overlap = intervalOverlap(current.projectionMin, current.projectionMax, other.projectionMin, other.projectionMax);
        if (gap > PANEL_VERTEX_JUNCTION_ALONG_GAP_MM || overlap > PANEL_VERTEX_WALL_OFFSET_TOLERANCE_MM) return;
        visited.add(otherIndex);
        queue.push(otherIndex);
        group.push(other);
      });
    }
    if (group.length >= 2) groups.push(group);
  });
  return groups;
}

/** 選択点へ届く対向壁が重なる場合、同じ法線側で最も近い壁層だけを可視とする。 */
export function nearestOriginWallLayer(candidates: VertexEdgeCandidate[]): VertexEdgeCandidate[] {
  return candidates.filter((candidate) => {
    const sameSide = candidates.filter((other) => sameNormalSide(
      candidate.signedNormalDistance,
      other.signedNormalDistance,
    ));
    const nearestDistance = Math.min(...sameSide.map((other) => Math.abs(other.signedNormalDistance)));
    return Math.abs(candidate.signedNormalDistance) - nearestDistance <= PANEL_VERTEX_WALL_OFFSET_TOLERANCE_MM;
  });
}

/** 選択点は自分自身の内枠・タチキリ線だけを守り、追従点の都合では止めない。 */
export function constrainedSelectedPoint(panel: Panel, original: [number, number], x: number, y: number, canvas: CanvasSize = DEFAULT_CANVAS): [number, number] {
  const inner = innerFrameBounds(canvas);
  const locks = pointBoundaryLocks(panel, original, undefined, canvas);
  let nextX = roundMm(clamp(x, 0, canvas.w));
  let nextY = roundMm(clamp(y, 0, canvas.h));
  if (locks.x !== undefined) {
    nextX = locks.x;
    if (locks.x === inner.x || locks.x === inner.x + inner.w) {
      nextY = roundMm(clamp(nextY, inner.y, inner.y + inner.h));
    }
  }
  if (locks.y !== undefined) {
    nextY = locks.y;
    if (locks.y === inner.y || locks.y === inner.y + inner.h) {
      nextX = roundMm(clamp(nextX, inner.x, inner.x + inner.w));
    }
  }
  return [nextX, nextY];
}
