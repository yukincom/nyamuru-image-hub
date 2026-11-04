import type { Panel } from '../../types';
import { type CanvasSize, DEFAULT_CANVAS, panelShapePoints, roundMm, PANEL_EDGE_ALIGNMENT_TOLERANCE_MM, PANEL_VERTEX_JUNCTION_CORNER_MM, PANEL_VERTEX_JUNCTION_ALONG_GAP_MM, PANEL_VERTEX_WALL_OFFSET_TOLERANCE_MM, MIN_SIZE_MM } from './canvasBounds.ts';
import { constrainedSelectedPoint, type VertexJunctionReference, type VertexSplitDeformation, type VertexEdgeCandidate, vertexEdgeCandidates, nearestOriginWallLayer, splitWallGroups, sameNormalSide, type LineConstraint, lineIntersection, constrainedPointOnLine, pointOnLineWithinBounds } from './vertexConstraints.ts';
import { edgePoints, constrainedJunctionPoint, pointBoundaryLocks, pointLegalBounds, pointWithinLegalBounds } from './panelBoundaries.ts';
import { resizePanelToBounds } from './panelTransforms.ts';

/**
 * 多角形の1頂点を動かす。linkPanels=true のA+連動は開始配置から直接見える
 * 接合点と、複数辺に分割された対向壁だけへ限定し、次の溝へは伝播しない。
 */
export function movePanelVertexWithSnap(
  panels: Panel[],
  panelIndex: number,
  vertexIndex: number,
  x: number,
  y: number,
  linkPanels = false,
  canvas: CanvasSize = DEFAULT_CANVAS,
): void {
  const selectedPanel = panels[panelIndex];
  if (!selectedPanel) return;
  const selectedPoints = panelShapePoints(selectedPanel);
  const selectedPoint = selectedPoints[vertexIndex];
  if (!selectedPoint) return;
  const selectedTarget = constrainedSelectedPoint(selectedPanel, selectedPoint, x, y, canvas);
  const deltaX = roundMm(selectedTarget[0] - selectedPoint[0]);
  const deltaY = roundMm(selectedTarget[1] - selectedPoint[1]);
  const junctions = new Map<string, VertexJunctionReference>();
  const splitDeformations: VertexSplitDeformation[] = [];
  const splitKeys = new Set<string>();
  const addJunction = (candidate: VertexEdgeCandidate) => {
    const key = `${candidate.panelIndex}:${candidate.nearestVertexIndex}`;
    const current = junctions.get(key);
    if (!current || candidate.nearestDistance < current.distance) {
      junctions.set(key, {
        panelIndex: candidate.panelIndex,
        vertexIndex: candidate.nearestVertexIndex,
        distance: candidate.nearestDistance,
      });
    }
  };

  if (linkPanels) {
    const count = selectedPoints.length;
    const incidentEdges = [vertexIndex, (vertexIndex - 1 + count) % count];
    incidentEdges.forEach((selectedEdgeIndex) => {
      const selectedEdge = edgePoints(selectedPanel, selectedEdgeIndex);
      if (!selectedEdge) return;
      const fixedPoint = selectedEdgeIndex === vertexIndex ? selectedEdge[1] : selectedEdge[0];
      const candidates = vertexEdgeCandidates(panels, panelIndex, selectedPoint, fixedPoint, canvas);
      const originWallCandidates = candidates.filter((candidate) => (
        // 選択点をまたぐ辺は、投影の重なりが8mm未満でも局所接合の対向壁になり得る。
        candidate.projectionMin <= PANEL_EDGE_ALIGNMENT_TOLERANCE_MM
        && candidate.projectionMax >= -PANEL_EDGE_ALIGNMENT_TOLERANCE_MM
        && candidate.nearestDistance <= PANEL_VERTEX_JUNCTION_CORNER_MM
      ));
      const visibleOriginWalls = nearestOriginWallLayer(originWallCandidates);
      const splitOriginWallCandidates = candidates.filter((candidate) => candidate.sharesProjection
        // 分割壁は選択点を横切らなくても、近端が局所接合の範囲内なら同じ壁層として扱う。
        && candidate.originGap <= PANEL_VERTEX_JUNCTION_ALONG_GAP_MM
        && candidate.nearestDistance <= PANEL_VERTEX_JUNCTION_CORNER_MM);
      const visibleSplitOriginWalls = nearestOriginWallLayer(splitOriginWallCandidates);
      const groups = splitWallGroups(candidates)
        // 分割壁も選択点から見える最前面レイヤーだけ。狭いコマの反対壁へ渡らない。
        .filter((group) => group.some((candidate) => visibleSplitOriginWalls.includes(candidate)));
      const groupedEdges = new Set<string>();
      groups.forEach((group) => group.forEach((candidate) => {
        const key = `${candidate.panelIndex}:${candidate.edgeIndex}`;
        groupedEdges.add(key);
        const deformationKey = `${selectedEdgeIndex}>${key}`;
        if (splitKeys.has(deformationKey)) return;
        splitKeys.add(deformationKey);
        splitDeformations.push({ selectedEdgeIndex, panelIndex: candidate.panelIndex, edgeIndex: candidate.edgeIndex });
      }));

      const nearbyExtensions = candidates.filter((candidate) => !candidate.sharesProjection
        && candidate.originGap <= PANEL_VERTEX_JUNCTION_ALONG_GAP_MM
        && candidate.nearestDistance <= PANEL_VERTEX_JUNCTION_CORNER_MM);
      const continuations = nearbyExtensions.filter((candidate) => (
        // 局所接合は選択点側へ続く辺だけ。固定端の先にある無関係な短辺は拾わない。
        candidate.projectionMax <= PANEL_EDGE_ALIGNMENT_TOLERANCE_MM
      ));
      continuations.forEach(addJunction);

      // 単独の対向壁は辺全体を平行化せず、開始点側の近端だけを接合として動かす。
      const singletonOpposingJunctions = visibleOriginWalls
        .filter((candidate) => !groupedEdges.has(`${candidate.panelIndex}:${candidate.edgeIndex}`))
        .filter((candidate) => {
          const sameWallContinuation = continuations.some((continuation) => sameNormalSide(
            continuation.signedNormalDistance,
            candidate.signedNormalDistance,
          ) && Math.abs(continuation.signedNormalDistance - candidate.signedNormalDistance)
            <= PANEL_VERTEX_WALL_OFFSET_TOLERANCE_MM);
          return !sameWallContinuation;
        });
      singletonOpposingJunctions.forEach(addJunction);
    });
  }

  const originalPanelPoints = panels.map(panelShapePoints);
  const nextPanelPoints = originalPanelPoints.map((points) => points.map((point): [number, number] => [
    roundMm(point[0]),
    roundMm(point[1]),
  ]));
  nextPanelPoints[panelIndex][vertexIndex] = selectedTarget;

  junctions.forEach((reference) => {
    const original = originalPanelPoints[reference.panelIndex]?.[reference.vertexIndex];
    const panel = panels[reference.panelIndex];
    if (!original || !panel) return;
    nextPanelPoints[reference.panelIndex][reference.vertexIndex] = constrainedJunctionPoint(
      panel,
      original,
      original[0] + deltaX,
      original[1] + deltaY,
      canvas,
    );
  });

  const constraints = new Map<string, LineConstraint[]>();
  splitDeformations.forEach((deformation) => {
    const selectedStartIndex = deformation.selectedEdgeIndex;
    const selectedEndIndex = (selectedStartIndex + 1) % selectedPoints.length;
    const oldStart = originalPanelPoints[panelIndex][selectedStartIndex];
    const oldEnd = originalPanelPoints[panelIndex][selectedEndIndex];
    const newStart = nextPanelPoints[panelIndex][selectedStartIndex];
    const newEnd = nextPanelPoints[panelIndex][selectedEndIndex];
    const oldVectorX = oldEnd[0] - oldStart[0], oldVectorY = oldEnd[1] - oldStart[1];
    const newVectorX = newEnd[0] - newStart[0], newVectorY = newEnd[1] - newStart[1];
    const oldLength = Math.hypot(oldVectorX, oldVectorY), newLength = Math.hypot(newVectorX, newVectorY);
    if (!oldLength || !newLength) return;
    const oldNormal: [number, number] = [-oldVectorY / oldLength, oldVectorX / oldLength];
    const newNormal: [number, number] = [-newVectorY / newLength, newVectorX / newLength];
    const candidatePoints = originalPanelPoints[deformation.panelIndex];
    const candidateIndices = [deformation.edgeIndex, (deformation.edgeIndex + 1) % candidatePoints.length];
    const distance = candidateIndices.reduce((sum, candidateIndex) => {
      const point = candidatePoints[candidateIndex];
      return sum + (point[0] - oldStart[0]) * oldNormal[0] + (point[1] - oldStart[1]) * oldNormal[1];
    }, 0) / candidateIndices.length;
    const linePoint: [number, number] = [
      newStart[0] + newNormal[0] * distance,
      newStart[1] + newNormal[1] * distance,
    ];
    const oldLengthSquared = oldVectorX * oldVectorX + oldVectorY * oldVectorY;
    const directionChange = Math.abs(oldVectorX * newVectorY - oldVectorY * newVectorX) / (oldLength * newLength);
    candidateIndices.forEach((candidateIndex) => {
      const key = `${deformation.panelIndex}:${candidateIndex}`;
      if (junctions.has(key)) return;
      const candidate = candidatePoints[candidateIndex];
      const parameter = ((candidate[0] - oldStart[0]) * oldVectorX
        + (candidate[1] - oldStart[1]) * oldVectorY) / oldLengthSquared;
      const line: LineConstraint = {
        point: linePoint,
        vector: [newVectorX, newVectorY],
        preferred: directionChange > 0.01 ? [
          linePoint[0] + newVectorX * parameter,
          linePoint[1] + newVectorY * parameter,
        ] : undefined,
      };
      constraints.set(key, [...(constraints.get(key) ?? []), line]);
    });
  });

  constraints.forEach((lines, key) => {
    const [pi, vi] = key.split(':').map(Number);
    const original = originalPanelPoints[pi]?.[vi];
    const panel = panels[pi];
    if (!original || !panel || !lines.length) return;
    const locks = pointBoundaryLocks(panel, original, undefined, canvas);
    const bounds = pointLegalBounds(panel, original, canvas);
    if (locks.x !== undefined && locks.y !== undefined) {
      nextPanelPoints[pi][vi] = [locks.x, locks.y];
      return;
    }
    if (locks.x !== undefined || locks.y !== undefined) {
      const boundary: LineConstraint = locks.x !== undefined
        ? { point: [locks.x, 0], vector: [0, 1] }
        : { point: [0, locks.y!], vector: [1, 0] };
      const target = lines.map((line) => lineIntersection(line, boundary))
        .filter((point): point is [number, number] => point !== null)
        .filter((point) => pointWithinLegalBounds(point, bounds))
        .sort((left, right) => Math.hypot(left[0] - original[0], left[1] - original[1])
          - Math.hypot(right[0] - original[0], right[1] - original[1]))[0] ?? original;
      nextPanelPoints[pi][vi] = [roundMm(target[0]), roundMm(target[1])];
      return;
    }

    const intersections: [number, number][] = [];
    let hasNonParallelPair = false;
    for (let first = 0; first < lines.length; first += 1) {
      for (let second = first + 1; second < lines.length; second += 1) {
        const intersection = lineIntersection(lines[first], lines[second]);
        if (!intersection) continue;
        hasNonParallelPair = true;
        if (pointWithinLegalBounds(intersection, bounds)) intersections.push(intersection);
      }
    }
    if (intersections.length) {
      const target = intersections.sort((left, right) => Math.hypot(left[0] - original[0], left[1] - original[1])
        - Math.hypot(right[0] - original[0], right[1] - original[1]))[0];
      nextPanelPoints[pi][vi] = [roundMm(target[0]), roundMm(target[1])];
      return;
    }
    if (hasNonParallelPair) {
      // 2本の拘束を同時に満たす合法点がない時は、成分別に歪めず開始時の合法点へ残す。
      nextPanelPoints[pi][vi] = [roundMm(original[0]), roundMm(original[1])];
      return;
    }
    const preferred = lines[0].preferred ?? constrainedPointOnLine(original, lines[0]);
    nextPanelPoints[pi][vi] = pointOnLineWithinBounds(lines[0], preferred, bounds)
      ?? [roundMm(original[0]), roundMm(original[1])];
  });

  const affectedPanels = new Set<number>([panelIndex]);
  junctions.forEach((reference) => affectedPanels.add(reference.panelIndex));
  splitDeformations.forEach((deformation) => affectedPanels.add(deformation.panelIndex));
  panels.forEach((panel, pi) => {
    if (!affectedPanels.has(pi)) return;
    const nextPoints = nextPanelPoints[pi];
    if (panel.shape.type === 'polygon') {
      panel.shape.points = nextPoints;
      return;
    }
    const remainsRect = Math.abs(nextPoints[0][1] - nextPoints[1][1]) <= 0.05
      && Math.abs(nextPoints[1][0] - nextPoints[2][0]) <= 0.05
      && Math.abs(nextPoints[2][1] - nextPoints[3][1]) <= 0.05
      && Math.abs(nextPoints[3][0] - nextPoints[0][0]) <= 0.05
      && nextPoints[1][0] - nextPoints[0][0] >= MIN_SIZE_MM
      && nextPoints[3][1] - nextPoints[0][1] >= MIN_SIZE_MM;
    if (remainsRect) {
      resizePanelToBounds(panel, {
        x: nextPoints[0][0],
        y: nextPoints[0][1],
        w: nextPoints[1][0] - nextPoints[0][0],
        h: nextPoints[3][1] - nextPoints[0][1],
      });
    } else {
      panel.shape = { type: 'polygon', points: nextPoints };
    }
  });
}
