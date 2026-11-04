import type { Panel } from '../../types';
import { type PanelGutterSettings, PANEL_SNAP_THRESHOLD_MM, type PanelEdgeReference, roundMm, clamp, panelShapePoints, PANEL_EDGE_ALIGNMENT_TOLERANCE_MM, type DragAxis, PANEL_EDGE_LINK_DISTANCE_MM } from './canvasBounds.ts';
import { edgePoints, findLinkedPanelEdges } from './panelBoundaries.ts';
import { pointInPanel } from './panelHitTesting.ts';

/** 対向する平行辺との距離が作品の縦横コマ間隔へ近づいたとき、選択辺を正確な間隔へ吸着する。 */
export function snapPanelEdgeDeltaToGutter(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  deltaX: number,
  deltaY: number,
  gutters: PanelGutterSettings,
  threshold = PANEL_SNAP_THRESHOLD_MM,
  axis?: 'x' | 'y',
): { x: number; y: number; snapped: boolean; target?: PanelEdgeReference } {
  const selectedPanel = panels[panelIndex];
  const selectedEdge = selectedPanel && edgePoints(selectedPanel, edgeIndex);
  if (!selectedEdge) return { x: roundMm(deltaX), y: roundMm(deltaY), snapped: false };
  const [start, end] = selectedEdge;
  const vectorX = end[0] - start[0], vectorY = end[1] - start[1];
  const length = Math.hypot(vectorX, vectorY);
  if (!length) return { x: roundMm(deltaX), y: roundMm(deltaY), snapped: false };
  const unitX = vectorX / length, unitY = vectorY / length;
  const normalX = -unitY, normalY = unitX;
  const targetGap = Math.abs(vectorX) >= Math.abs(vectorY)
    ? clamp(gutters.rowGapMm, 0, 20)
    : clamp(gutters.columnGapMm, 0, 20);
  const movedStart: [number, number] = [start[0] + deltaX, start[1] + deltaY];
  const candidates: Array<{ error: number; correctionX: number; correctionY: number; target: PanelEdgeReference }> = [];

  panels.forEach((panel, candidatePanelIndex) => {
    if (candidatePanelIndex === panelIndex) return;
    const points = panelShapePoints(panel);
    points.forEach((candidateStart, candidateEdgeIndex) => {
      const candidateEnd = points[(candidateEdgeIndex + 1) % points.length];
      const candidateVectorX = candidateEnd[0] - candidateStart[0], candidateVectorY = candidateEnd[1] - candidateStart[1];
      const candidateLength = Math.hypot(candidateVectorX, candidateVectorY);
      if (!candidateLength) return;
      const parallelError = Math.abs(vectorX * candidateVectorY - vectorY * candidateVectorX) / (length * candidateLength);
      if (parallelError > 0.08) return;
      const projectionA = (candidateStart[0] - movedStart[0]) * unitX + (candidateStart[1] - movedStart[1]) * unitY;
      const projectionB = (candidateEnd[0] - movedStart[0]) * unitX + (candidateEnd[1] - movedStart[1]) * unitY;
      const overlap = Math.max(0, Math.min(length, Math.max(projectionA, projectionB)) - Math.max(0, Math.min(projectionA, projectionB)));
      if (overlap < Math.min(8, Math.min(length, candidateLength) * 0.25)) return;
      const signedDistance = (
        (candidateStart[0] - movedStart[0]) * normalX + (candidateStart[1] - movedStart[1]) * normalY
          + (candidateEnd[0] - movedStart[0]) * normalX + (candidateEnd[1] - movedStart[1]) * normalY
      ) / 2;
      if (targetGap > 0 && Math.abs(signedDistance) <= PANEL_EDGE_ALIGNMENT_TOLERANCE_MM) return;
      const error = Math.abs(Math.abs(signedDistance) - targetGap);
      if (error > threshold) return;
      const desiredDistance = (signedDistance < 0 ? -1 : 1) * targetGap;
      const normalCorrection = signedDistance - desiredDistance;
      let correctionX = normalX * normalCorrection, correctionY = normalY * normalCorrection;
      if (axis === 'x') {
        if (Math.abs(normalX) <= 1e-6) return;
        correctionX = normalCorrection / normalX;
        correctionY = 0;
      } else if (axis === 'y') {
        if (Math.abs(normalY) <= 1e-6) return;
        correctionX = 0;
        correctionY = normalCorrection / normalY;
      }
      candidates.push({ error, correctionX, correctionY, target: { panelIndex: candidatePanelIndex, edgeIndex: candidateEdgeIndex } });
    });
  });

  const best = candidates.sort((left, right) => left.error - right.error || Math.hypot(left.correctionX, left.correctionY) - Math.hypot(right.correctionX, right.correctionY))[0];
  if (!best) return { x: roundMm(deltaX), y: roundMm(deltaY), snapped: false };
  return {
    x: roundMm(deltaX + best.correctionX),
    y: roundMm(deltaY + best.correctionY),
    snapped: true,
    target: best.target,
  };
}

/**
 * 頂点を、別コマの辺から作品設定の上下・左右間隔だけ離れた位置へ吸着する。
 * Shift固定中は許可された1軸だけを補正する。
 */
export function snapPanelVertexPointToGutter(
  panels: Panel[],
  panelIndex: number,
  vertexIndex: number,
  x: number,
  y: number,
  gutters: PanelGutterSettings,
  threshold = PANEL_SNAP_THRESHOLD_MM,
  axis?: DragAxis,
): { x: number; y: number; snapped: boolean } {
  const selectedPanel = panels[panelIndex];
  const selectedPoints = selectedPanel && panelShapePoints(selectedPanel);
  if (!selectedPoints || vertexIndex < 0 || vertexIndex >= selectedPoints.length) {
    return { x: roundMm(x), y: roundMm(y), snapped: false };
  }
  const xCandidates: Array<{ value: number; error: number }> = [];
  const yCandidates: Array<{ value: number; error: number }> = [];
  const rowGap = clamp(gutters.rowGapMm, 0, 20);
  const columnGap = clamp(gutters.columnGapMm, 0, 20);

  panels.forEach((panel, candidatePanelIndex) => {
    if (candidatePanelIndex === panelIndex) return;
    const points = panelShapePoints(panel);
    points.forEach((start, edgeIndex) => {
      const end = points[(edgeIndex + 1) % points.length];
      const dx = end[0] - start[0], dy = end[1] - start[1];
      const length = Math.hypot(dx, dy);
      if (!length) return;
      const parameterSlack = threshold / length;

      if (axis !== 'y' && Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) > 1e-6) {
        const parameter = (y - start[1]) / dy;
        if (parameter >= -parameterSlack && parameter <= 1 + parameterSlack) {
          const lineX = start[0] + dx * parameter;
          for (const direction of [-1, 1]) {
            const targetX = lineX + direction * columnGap;
            const error = Math.abs(targetX - x);
            if (error <= threshold && (columnGap === 0 || !pointInPanel(panel, targetX, y))) {
              xCandidates.push({ value: targetX, error });
            }
          }
        }
      }

      if (axis !== 'x' && Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 1e-6) {
        const parameter = (x - start[0]) / dx;
        if (parameter >= -parameterSlack && parameter <= 1 + parameterSlack) {
          const lineY = start[1] + dy * parameter;
          for (const direction of [-1, 1]) {
            const targetY = lineY + direction * rowGap;
            const error = Math.abs(targetY - y);
            if (error <= threshold && (rowGap === 0 || !pointInPanel(panel, x, targetY))) {
              yCandidates.push({ value: targetY, error });
            }
          }
        }
      }
    });
  });

  const snappedX = xCandidates.sort((left, right) => left.error - right.error)[0];
  const snappedY = yCandidates.sort((left, right) => left.error - right.error)[0];
  return {
    x: roundMm(snappedX?.value ?? x),
    y: roundMm(snappedY?.value ?? y),
    snapped: Boolean(snappedX || snappedY),
  };
}

/**
 * 平行な延長辺が少しズレているとき、隣辺を固定したまま選択辺を同一直線へ吸着する。
 * すでに同じ境界グループへ入っている辺と、投影が重なる対向辺（コマ間の空き）は対象外。
 */
export function snapPanelEdgeDeltaToNeighbor(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  deltaX: number,
  deltaY: number,
  threshold = PANEL_SNAP_THRESHOLD_MM,
  maxAlongGap = PANEL_EDGE_LINK_DISTANCE_MM,
): { x: number; y: number; snapped: boolean; target?: PanelEdgeReference } {
  const selectedPanel = panels[panelIndex];
  const selectedEdge = selectedPanel && edgePoints(selectedPanel, edgeIndex);
  if (!selectedEdge) return { x: roundMm(deltaX), y: roundMm(deltaY), snapped: false };
  const [start, end] = selectedEdge;
  const vectorX = end[0] - start[0], vectorY = end[1] - start[1];
  const length = Math.hypot(vectorX, vectorY);
  if (!length) return { x: roundMm(deltaX), y: roundMm(deltaY), snapped: false };
  const unitX = vectorX / length, unitY = vectorY / length;
  const normalX = -unitY, normalY = unitX;
  const movedStart: [number, number] = [start[0] + deltaX, start[1] + deltaY];
  const linked = new Set(findLinkedPanelEdges(panels, panelIndex, edgeIndex).map((reference) => `${reference.panelIndex}:${reference.edgeIndex}`));
  const candidates: { correction: number; target: PanelEdgeReference }[] = [];

  panels.forEach((panel, candidatePanelIndex) => {
    if (candidatePanelIndex === panelIndex) return;
    const points = panelShapePoints(panel);
    points.forEach((candidateStart, candidateEdgeIndex) => {
      if (linked.has(`${candidatePanelIndex}:${candidateEdgeIndex}`)) return;
      const candidateEnd = points[(candidateEdgeIndex + 1) % points.length];
      const candidateVectorX = candidateEnd[0] - candidateStart[0], candidateVectorY = candidateEnd[1] - candidateStart[1];
      const candidateLength = Math.hypot(candidateVectorX, candidateVectorY);
      if (!candidateLength) return;
      const parallelError = Math.abs(vectorX * candidateVectorY - vectorY * candidateVectorX) / (length * candidateLength);
      if (parallelError > 0.08) return;
      const projectionA = (candidateStart[0] - movedStart[0]) * unitX + (candidateStart[1] - movedStart[1]) * unitY;
      const projectionB = (candidateEnd[0] - movedStart[0]) * unitX + (candidateEnd[1] - movedStart[1]) * unitY;
      const projectionMin = Math.min(projectionA, projectionB);
      const projectionMax = Math.max(projectionA, projectionB);
      const overlap = Math.max(0, Math.min(length, projectionMax) - Math.max(0, projectionMin));
      const alongGap = projectionMax < 0
        ? -projectionMax
        : projectionMin > length
          ? projectionMin - length
          : 0;
      if (alongGap > maxAlongGap || overlap > Math.min(2, Math.min(length, candidateLength) * 0.08)) return;
      const signedDistance = (
        (candidateStart[0] - movedStart[0]) * normalX + (candidateStart[1] - movedStart[1]) * normalY
          + (candidateEnd[0] - movedStart[0]) * normalX + (candidateEnd[1] - movedStart[1]) * normalY
      ) / 2;
      if (Math.abs(signedDistance) > threshold) return;
      candidates.push({ correction: signedDistance, target: { panelIndex: candidatePanelIndex, edgeIndex: candidateEdgeIndex } });
    });
  });

  const best = candidates.sort((left, right) => Math.abs(left.correction) - Math.abs(right.correction))[0];
  if (!best) return { x: roundMm(deltaX), y: roundMm(deltaY), snapped: false };
  return {
    x: roundMm(deltaX + normalX * best.correction),
    y: roundMm(deltaY + normalY * best.correction),
    snapped: true,
    target: best.target,
  };
}
