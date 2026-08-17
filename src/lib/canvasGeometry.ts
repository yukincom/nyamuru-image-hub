import type { Anchor, BBox, CanvasElementType, Panel } from '../types';

export type ResizeHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export interface InteractionGeometry {
  mode: ResizeHandle;
  startClientX: number;
  startClientY: number;
  startBox: BBox;
  bounds: BBox;
  paperRect: { width: number; height: number };
}

export const MIN_SIZE_MM = 6;
export const INNER_FRAME_BOUNDS: Readonly<BBox> = { x: 10, y: 10, w: 190, h: 277 };
export const PANEL_SNAP_THRESHOLD_MM = 3;
export const PANEL_EDGE_LINK_DISTANCE_MM = 8;

export interface PanelEdgeReference {
  panelIndex: number;
  edgeIndex: number;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function roundMm(value: number) {
  return Math.round(value * 10) / 10;
}

export function panelBounds(panel: Panel): BBox {
  if (panel.shape.type === 'rect') return panel.shape;
  const xs = panel.shape.points.map(([x]) => x);
  const ys = panel.shape.points.map(([, y]) => y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** 紙面座標の頂点列。矩形も左上から時計回りの4頂点として扱う。 */
export function panelShapePoints(panel: Panel): [number, number][] {
  if (panel.shape.type === 'polygon') return panel.shape.points.map(([x, y]) => [x, y]);
  const { x, y, w, h } = panel.shape;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function edgePoints(panel: Panel, edgeIndex: number): [[number, number], [number, number]] | null {
  const points = panelShapePoints(panel);
  if (edgeIndex < 0 || edgeIndex >= points.length) return null;
  return [points[edgeIndex], points[(edgeIndex + 1) % points.length]];
}

function pointLineDistance(point: [number, number], start: [number, number], end: [number, number]): number {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  return Math.abs(dx * (start[1] - point[1]) - (start[0] - point[0]) * dy) / length;
}

/**
 * 選択辺と近接し、十分な投影区間を共有する平行辺を探す。
 * 水平・垂直だけでなく、辺ベクトルの外積で斜めのコマ境界も判定する。
 */
export function findLinkedPanelEdges(
  panels: Panel[],
  panelIndex: number,
  edgeIndex: number,
  maxDistance = PANEL_EDGE_LINK_DISTANCE_MM,
): PanelEdgeReference[] {
  const selectedPanel = panels[panelIndex];
  const selectedEdge = selectedPanel && edgePoints(selectedPanel, edgeIndex);
  if (!selectedEdge) return [];
  const [start, end] = selectedEdge;
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!length) return [];
  const unitX = dx / length, unitY = dy / length;
  const linked: Array<PanelEdgeReference & { distance: number }> = [];

  panels.forEach((panel, candidatePanelIndex) => {
    if (candidatePanelIndex === panelIndex) return;
    const points = panelShapePoints(panel);
    points.forEach((candidateStart, candidateEdgeIndex) => {
      const candidateEnd = points[(candidateEdgeIndex + 1) % points.length];
      const cdx = candidateEnd[0] - candidateStart[0], cdy = candidateEnd[1] - candidateStart[1];
      const candidateLength = Math.hypot(cdx, cdy);
      if (!candidateLength) return;
      const parallelError = Math.abs(dx * cdy - dy * cdx) / (length * candidateLength);
      if (parallelError > 0.08) return;
      const distance = (pointLineDistance(candidateStart, start, end) + pointLineDistance(candidateEnd, start, end)) / 2;
      if (distance > maxDistance) return;
      const projectionA = (candidateStart[0] - start[0]) * unitX + (candidateStart[1] - start[1]) * unitY;
      const projectionB = (candidateEnd[0] - start[0]) * unitX + (candidateEnd[1] - start[1]) * unitY;
      const projectionMin = Math.min(projectionA, projectionB);
      const projectionMax = Math.max(projectionA, projectionB);
      const overlap = Math.max(0, Math.min(length, projectionMax) - Math.max(0, projectionMin));
      if (overlap < Math.min(8, Math.min(length, candidateLength) * 0.25)) return;
      linked.push({ panelIndex: candidatePanelIndex, edgeIndex: candidateEdgeIndex, distance });
    });
  });
  return linked.sort((left, right) => left.distance - right.distance).map(({ panelIndex: pi, edgeIndex: ei }) => ({ panelIndex: pi, edgeIndex: ei }));
}

// アンカー種別が指すコマ内の位置（mm）。端寄せは枠から少し内側に取る
export function anchorPoint(bounds: BBox, anchor: Anchor): { x: number; y: number } {
  const insetX = Math.min(6, bounds.w * .15);
  const insetY = Math.min(6, bounds.h * .15);
  const x = anchor.includes('left') ? bounds.x + insetX : anchor.includes('right') ? bounds.x + bounds.w - insetX : bounds.x + bounds.w / 2;
  const y = anchor.startsWith('top') ? bounds.y + insetY : anchor.startsWith('bottom') ? bounds.y + bounds.h - insetY : bounds.y + bounds.h / 2;
  return { x, y };
}

export const ANCHORS: Anchor[] = ['center', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

export function nearestAnchor(bounds: BBox, box: BBox): Anchor {
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  let best: Anchor = 'center';
  let bestDistance = Infinity;
  for (const anchor of ANCHORS) {
    const point = anchorPoint(bounds, anchor);
    const distance = (point.x - centerX) ** 2 + (point.y - centerY) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = anchor; }
  }
  return best;
}

export function fallbackBox(panel: Panel, type: CanvasElementType, index: number): BBox {
  const bounds = panelBounds(panel);
  // 画面内文字（screen_text）は横組みが既定なので横長bboxを既定にする
  if (type === 'screen_text') {
    const width = Math.min(46, Math.max(MIN_SIZE_MM, bounds.w * .4));
    const height = Math.min(18, Math.max(MIN_SIZE_MM, bounds.h * .2));
    return {
      x: clamp(bounds.x + (bounds.w - width) / 2, bounds.x, bounds.x + bounds.w - width),
      y: clamp(bounds.y + bounds.h / 2 - height / 2 + index * 4, bounds.y, bounds.y + bounds.h - height),
      w: roundMm(width),
      h: roundMm(height),
    };
  }
  let width = Math.min(type === 'figure' ? 42 : 40, Math.max(MIN_SIZE_MM, bounds.w * .35));
  const height = Math.min(type === 'figure' ? 55 : 50, Math.max(MIN_SIZE_MM, bounds.h * .45));
  // 縦書きフキダシは縦長bbox（通常サイズの目安 w40×h50）を保つ
  if (type === 'bubble') width = Math.max(MIN_SIZE_MM, Math.min(width, height * .8));
  const inset = 4 + index * 3;
  return {
    x: clamp(bounds.x + (type === 'bubble' ? bounds.w - width - inset : inset), bounds.x, bounds.x + bounds.w - width),
    y: clamp(bounds.y + inset, bounds.y, bounds.y + bounds.h - height),
    w: width,
    h: height,
  };
}

export function pointInPanel(panel: Panel, x: number, y: number): boolean {
  if (panel.shape.type === 'rect') {
    const { shape } = panel;
    return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
  }
  // レイキャスティング法による多角形の内外判定
  const { points } = panel.shape;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function panelHasElementAt(panel: Panel, x: number, y: number): boolean {
  const boxes: BBox[] = [
    ...(panel.figures ?? []).map((figure, index) => figure.bbox ?? fallbackBox(panel, 'figure', index)),
    ...panel.bubbles.map((bubble, index) => bubble.bbox ?? fallbackBox(panel, 'bubble', index)),
    ...(panel.screen_text ?? []).map((screenText, index) => screenText.bbox ?? fallbackBox(panel, 'screen_text', index)),
  ];
  return boxes.some((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
}

// パネルが重なった位置のクリック先を決める。重ね順は配列順で固定（先頭のパネル1が最奥）。
// 最前面のパネルのクリック位置にエレメント（人物・フキダシ・画面内文字）があればそのパネルを選び、
// なければクリックは空白部分を貫通する:
// - 選択中のパネルが重なりに含まれるときは一段ずつ奥へ送る（最奥まで行ったら最前面へ戻る）
// - 含まれないときはエレメントがある最前面のパネル、どこにもなければ最奥のパネルを選ぶ
export function resolveOverlapClick(panels: Panel[], clickedIndex: number, activeIndex: number, x: number, y: number): number {
  const stack = panels.map((_, index) => index).filter((index) => pointInPanel(panels[index], x, y)).reverse();
  if (stack.length < 2 || !stack.includes(clickedIndex)) return clickedIndex;
  if (panelHasElementAt(panels[stack[0]], x, y)) return stack[0];
  const activePosition = stack.indexOf(activeIndex);
  if (activePosition !== -1) return stack[(activePosition + 1) % stack.length];
  return stack.find((index) => panelHasElementAt(panels[index], x, y)) ?? stack[stack.length - 1];
}

export function resizedBox(interaction: InteractionGeometry, clientX: number, clientY: number, minSize = MIN_SIZE_MM): BBox {
  const { startBox, bounds, paperRect, mode } = interaction;
  const dx = (clientX - interaction.startClientX) * (210 / paperRect.width);
  const dy = (clientY - interaction.startClientY) * (297 / paperRect.height);
  const right = startBox.x + startBox.w;
  const bottom = startBox.y + startBox.h;
  let x = startBox.x, y = startBox.y, w = startBox.w, h = startBox.h;

  if (mode === 'move') {
    x = clamp(startBox.x + dx, bounds.x, bounds.x + bounds.w - startBox.w);
    y = clamp(startBox.y + dy, bounds.y, bounds.y + bounds.h - startBox.h);
  } else {
    if (mode.includes('w')) { x = clamp(startBox.x + dx, bounds.x, right - minSize); w = right - x; }
    if (mode.includes('e')) { w = clamp(startBox.w + dx, minSize, bounds.x + bounds.w - startBox.x); }
    if (mode.includes('n')) { y = clamp(startBox.y + dy, bounds.y, bottom - minSize); h = bottom - y; }
    if (mode.includes('s')) { h = clamp(startBox.h + dy, minSize, bounds.y + bounds.h - startBox.y); }
  }
  return { x: roundMm(x), y: roundMm(y), w: roundMm(w), h: roundMm(h) };
}

export function clampedPanelDelta(bounds: BBox, deltaX: number, deltaY: number): { x: number; y: number } {
  return {
    x: roundMm(clamp(deltaX, -bounds.x, 210 - (bounds.x + bounds.w))),
    y: roundMm(clamp(deltaY, -bounds.y, 297 - (bounds.y + bounds.h))),
  };
}

function snapCoordinate(value: number, targets: number[], threshold = PANEL_SNAP_THRESHOLD_MM): number {
  const nearest = targets.reduce((best, target) => (
    Math.abs(target - value) < Math.abs(best - value) ? target : best
  ), targets[0]);
  return Math.abs(nearest - value) <= threshold ? nearest : value;
}

/** コマ移動量を紙面内へ収め、外接矩形の四辺を内枠へ吸着させる。 */
export function snapPanelDeltaToInnerFrame(
  bounds: BBox,
  deltaX: number,
  deltaY: number,
  threshold = PANEL_SNAP_THRESHOLD_MM,
): { x: number; y: number } {
  const clamped = clampedPanelDelta(bounds, deltaX, deltaY);
  let nextX = bounds.x + clamped.x;
  let nextY = bounds.y + clamped.y;
  const innerRight = INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w;
  const innerBottom = INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h;

  const leftSnap = INNER_FRAME_BOUNDS.x - nextX;
  const rightSnap = innerRight - (nextX + bounds.w);
  if (Math.min(Math.abs(leftSnap), Math.abs(rightSnap)) <= threshold) {
    nextX += Math.abs(leftSnap) <= Math.abs(rightSnap) ? leftSnap : rightSnap;
  }

  const topSnap = INNER_FRAME_BOUNDS.y - nextY;
  const bottomSnap = innerBottom - (nextY + bounds.h);
  if (Math.min(Math.abs(topSnap), Math.abs(bottomSnap)) <= threshold) {
    nextY += Math.abs(topSnap) <= Math.abs(bottomSnap) ? topSnap : bottomSnap;
  }

  return clampedPanelDelta(bounds, nextX - bounds.x, nextY - bounds.y);
}

/** リサイズ中に動かしている辺だけを内枠へ吸着させる。 */
export function snapPanelResizeToInnerFrame(
  bounds: BBox,
  handle: Exclude<ResizeHandle, 'move'>,
  minSize = 20,
  threshold = PANEL_SNAP_THRESHOLD_MM,
): BBox {
  let { x, y, w, h } = bounds;
  const right = x + w;
  const bottom = y + h;
  const innerRight = INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w;
  const innerBottom = INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h;

  if (handle.includes('w')) {
    const snappedX = snapCoordinate(x, [INNER_FRAME_BOUNDS.x], threshold);
    if (right - snappedX >= minSize) { x = snappedX; w = right - snappedX; }
  }
  if (handle.includes('e')) {
    const snappedRight = snapCoordinate(right, [innerRight], threshold);
    if (snappedRight - x >= minSize) w = snappedRight - x;
  }
  if (handle.includes('n')) {
    const snappedY = snapCoordinate(y, [INNER_FRAME_BOUNDS.y], threshold);
    if (bottom - snappedY >= minSize) { y = snappedY; h = bottom - snappedY; }
  }
  if (handle.includes('s')) {
    const snappedBottom = snapCoordinate(bottom, [innerBottom], threshold);
    if (snappedBottom - y >= minSize) h = snappedBottom - y;
  }
  return { x: roundMm(x), y: roundMm(y), w: roundMm(w), h: roundMm(h) };
}

/** 多角形コマの頂点を、近い場合だけ内枠の縦横線へ吸着させる。 */
export function snapPointToInnerFrame(
  x: number,
  y: number,
  threshold = PANEL_SNAP_THRESHOLD_MM,
): { x: number; y: number } {
  return {
    x: roundMm(snapCoordinate(x, [INNER_FRAME_BOUNDS.x, INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w], threshold)),
    y: roundMm(snapCoordinate(y, [INNER_FRAME_BOUNDS.y, INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h], threshold)),
  };
}

/** 辺の2端点へ同じ移動量を適用したまま、最も近い内枠線へ吸着させる。 */
export function snapEdgeDeltaToInnerFrame(
  start: [number, number],
  end: [number, number],
  deltaX: number,
  deltaY: number,
  threshold = PANEL_SNAP_THRESHOLD_MM,
): { x: number; y: number } {
  const innerRight = INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w;
  const innerBottom = INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h;
  const movedX = [start[0] + deltaX, end[0] + deltaX];
  const movedY = [start[1] + deltaY, end[1] + deltaY];
  const xCorrections = movedX.flatMap((value) => [INNER_FRAME_BOUNDS.x - value, innerRight - value]);
  const yCorrections = movedY.flatMap((value) => [INNER_FRAME_BOUNDS.y - value, innerBottom - value]);
  const closestX = xCorrections.reduce((best, value) => Math.abs(value) < Math.abs(best) ? value : best);
  const closestY = yCorrections.reduce((best, value) => Math.abs(value) < Math.abs(best) ? value : best);
  return {
    x: roundMm(deltaX + (Math.abs(closestX) <= threshold ? closestX : 0)),
    y: roundMm(deltaY + (Math.abs(closestY) <= threshold ? closestY : 0)),
  };
}

function edgeReferences(panels: Panel[], panelIndex: number, edgeIndex: number, linkPanels: boolean): PanelEdgeReference[] {
  return [
    { panelIndex, edgeIndex },
    ...(linkPanels ? findLinkedPanelEdges(panels, panelIndex, edgeIndex) : []),
  ];
}

function clampedEdgeDelta(
  panels: Panel[],
  references: PanelEdgeReference[],
  deltaX: number,
  deltaY: number,
  minSize = 20,
): { x: number; y: number } {
  let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
  references.forEach(({ panelIndex, edgeIndex }) => {
    const panel = panels[panelIndex];
    const edge = panel && edgePoints(panel, edgeIndex);
    if (!panel || !edge) return;
    const [start, end] = edge;
    minX = Math.max(minX, -Math.min(start[0], end[0]));
    maxX = Math.min(maxX, 210 - Math.max(start[0], end[0]));
    minY = Math.max(minY, -Math.min(start[1], end[1]));
    maxY = Math.min(maxY, 297 - Math.max(start[1], end[1]));
    if (panel.shape.type !== 'rect') return;
    const { x, y, w, h } = panel.shape;
    if (edgeIndex === 0) maxY = Math.min(maxY, h - minSize);
    if (edgeIndex === 1) minX = Math.max(minX, minSize - w);
    if (edgeIndex === 2) minY = Math.max(minY, minSize - h);
    if (edgeIndex === 3) maxX = Math.min(maxX, w - minSize);
    // 紙面側の制限は端点制限と同値だが、数値誤差を避けるため明示する。
    if (edgeIndex === 0) minY = Math.max(minY, -y);
    if (edgeIndex === 1) maxX = Math.min(maxX, 210 - (x + w));
    if (edgeIndex === 2) maxY = Math.min(maxY, 297 - (y + h));
    if (edgeIndex === 3) minX = Math.max(minX, -x);
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
): { x: number; y: number; linkedEdges: number } {
  const selected = panels[panelIndex] && edgePoints(panels[panelIndex], edgeIndex);
  if (!selected) return { x: 0, y: 0, linkedEdges: 0 };
  const references = edgeReferences(panels, panelIndex, edgeIndex, linkPanels);
  const delta = clampedEdgeDelta(panels, references, deltaX, deltaY);
  references.forEach((reference) => {
    const panel = panels[reference.panelIndex];
    if (panel) applyEdgeDelta(panel, reference.edgeIndex, delta.x, delta.y);
  });
  return { ...delta, linkedEdges: Math.max(0, references.length - 1) };
}

interface VertexMove {
  moveX: boolean;
  moveY: boolean;
}

/**
 * 多角形の1頂点を動かす。linkPanels=true では、開始時にX/Yが一致する頂点は
 * 対応軸だけ追従し、近接する斜め平行辺の対応端点は両軸とも追従する。
 */
export function movePanelVertexWithSnap(
  panels: Panel[],
  panelIndex: number,
  vertexIndex: number,
  x: number,
  y: number,
  linkPanels = false,
  alignmentTolerance = 0.15,
): void {
  const selectedPanel = panels[panelIndex];
  if (!selectedPanel || selectedPanel.shape.type !== 'polygon') return;
  const selectedPoint = selectedPanel.shape.points[vertexIndex];
  if (!selectedPoint) return;
  const targetX = roundMm(clamp(x, 0, 210)), targetY = roundMm(clamp(y, 0, 297));
  const deltaX = targetX - selectedPoint[0], deltaY = targetY - selectedPoint[1];
  const moves = new Map<string, VertexMove>();
  const mark = (pi: number, vi: number, moveX: boolean, moveY: boolean) => {
    const key = `${pi}:${vi}`;
    const current = moves.get(key) ?? { moveX: false, moveY: false };
    current.moveX ||= moveX;
    current.moveY ||= moveY;
    moves.set(key, current);
  };
  mark(panelIndex, vertexIndex, true, true);

  if (linkPanels) {
    panels.forEach((panel, pi) => {
      panelShapePoints(panel).forEach((point, vi) => {
        if (pi === panelIndex && vi === vertexIndex) return;
        mark(pi, vi, Math.abs(point[0] - selectedPoint[0]) <= alignmentTolerance, Math.abs(point[1] - selectedPoint[1]) <= alignmentTolerance);
      });
    });
    const count = selectedPanel.shape.points.length;
    const incidentEdges = [vertexIndex, (vertexIndex - 1 + count) % count];
    incidentEdges.forEach((selectedEdgeIndex) => {
      findLinkedPanelEdges(panels, panelIndex, selectedEdgeIndex).forEach((reference) => {
        const edge = edgePoints(panels[reference.panelIndex], reference.edgeIndex);
        if (!edge) return;
        const distances = edge.map((point) => Math.hypot(point[0] - selectedPoint[0], point[1] - selectedPoint[1]));
        // 辺の中央付近だけが平行なケースは「隣接頂点」ではないため端点連動させない。
        if (Math.min(...distances) > PANEL_EDGE_LINK_DISTANCE_MM * 2) return;
        const linkedVertexIndex = distances[0] <= distances[1]
          ? reference.edgeIndex
          : (reference.edgeIndex + 1) % panelShapePoints(panels[reference.panelIndex]).length;
        mark(reference.panelIndex, linkedVertexIndex, true, true);
      });
    });
  }

  const rectMoves = new Map<number, { left: boolean; right: boolean; top: boolean; bottom: boolean }>();
  moves.forEach((move, key) => {
    if (!move.moveX && !move.moveY) return;
    const [pi, vi] = key.split(':').map(Number);
    const panel = panels[pi];
    if (!panel || panel.shape.type !== 'rect') return;
    const state = rectMoves.get(pi) ?? { left: false, right: false, top: false, bottom: false };
    if (move.moveX && (vi === 0 || vi === 3)) state.left = true;
    if (move.moveX && (vi === 1 || vi === 2)) state.right = true;
    if (move.moveY && (vi === 0 || vi === 1)) state.top = true;
    if (move.moveY && (vi === 2 || vi === 3)) state.bottom = true;
    rectMoves.set(pi, state);
  });

  // 追従頂点のどれかが紙端や最小サイズへ先に達した場合は、全頂点を同じ量で止める。
  // 個別に clamp すると斜め辺の角度や揃っていたX/Yが崩れるため、移動量を一括制限する。
  let minDeltaX = -Infinity, maxDeltaX = Infinity, minDeltaY = -Infinity, maxDeltaY = Infinity;
  moves.forEach((move, key) => {
    if (!move.moveX && !move.moveY) return;
    const [pi, vi] = key.split(':').map(Number);
    const point = panels[pi] && panelShapePoints(panels[pi])[vi];
    if (!point) return;
    if (move.moveX) {
      minDeltaX = Math.max(minDeltaX, -point[0]);
      maxDeltaX = Math.min(maxDeltaX, 210 - point[0]);
    }
    if (move.moveY) {
      minDeltaY = Math.max(minDeltaY, -point[1]);
      maxDeltaY = Math.min(maxDeltaY, 297 - point[1]);
    }
  });
  rectMoves.forEach((move, pi) => {
    const panel = panels[pi];
    if (!panel || panel.shape.type !== 'rect') return;
    if (move.left && !move.right) maxDeltaX = Math.min(maxDeltaX, panel.shape.w - MIN_SIZE_MM);
    if (move.right && !move.left) minDeltaX = Math.max(minDeltaX, MIN_SIZE_MM - panel.shape.w);
    if (move.top && !move.bottom) maxDeltaY = Math.min(maxDeltaY, panel.shape.h - MIN_SIZE_MM);
    if (move.bottom && !move.top) minDeltaY = Math.max(minDeltaY, MIN_SIZE_MM - panel.shape.h);
  });
  const linkedDeltaX = roundMm(clamp(deltaX, minDeltaX, maxDeltaX));
  const linkedDeltaY = roundMm(clamp(deltaY, minDeltaY, maxDeltaY));

  moves.forEach((move, key) => {
    if (!move.moveX && !move.moveY) return;
    const [pi, vi] = key.split(':').map(Number);
    const panel = panels[pi];
    if (!panel || panel.shape.type !== 'polygon') return;
    const point = panel.shape.points[vi];
    if (!point) return;
    panel.shape.points[vi] = [
      roundMm(point[0] + (move.moveX ? linkedDeltaX : 0)),
      roundMm(point[1] + (move.moveY ? linkedDeltaY : 0)),
    ];
  });
  rectMoves.forEach((move, pi) => {
    const panel = panels[pi];
    if (!panel || panel.shape.type !== 'rect') return;
    const next = { ...panel.shape };
    if (move.left) { next.x += linkedDeltaX; next.w -= linkedDeltaX; }
    if (move.right) next.w += linkedDeltaX;
    if (move.top) { next.y += linkedDeltaY; next.h -= linkedDeltaY; }
    if (move.bottom) next.h += linkedDeltaY;
    resizePanelToBounds(panel, next);
  });
}

export function translatePanel(panel: Panel, deltaX: number, deltaY: number): void {
  if (panel.shape.type === 'rect') {
    panel.shape.x = roundMm(panel.shape.x + deltaX);
    panel.shape.y = roundMm(panel.shape.y + deltaY);
  } else {
    panel.shape.points = panel.shape.points.map(([x, y]) => [roundMm(x + deltaX), roundMm(y + deltaY)]);
  }
  panel.figures?.forEach((figure) => {
    if (!figure.bbox) return;
    figure.bbox.x = roundMm(figure.bbox.x + deltaX);
    figure.bbox.y = roundMm(figure.bbox.y + deltaY);
  });
  panel.bubbles.forEach((bubble) => {
    if (!bubble.bbox) return;
    bubble.bbox.x = roundMm(bubble.bbox.x + deltaX);
    bubble.bbox.y = roundMm(bubble.bbox.y + deltaY);
  });
  panel.screen_text?.forEach((screenText) => {
    if (!screenText.bbox) return;
    screenText.bbox.x = roundMm(screenText.bbox.x + deltaX);
    screenText.bbox.y = roundMm(screenText.bbox.y + deltaY);
  });
}

export function resizePanelToBounds(panel: Panel, requestedBounds: BBox): void {
  const original = panelBounds(panel);
  const next = {
    x: roundMm(requestedBounds.x),
    y: roundMm(requestedBounds.y),
    w: Math.max(1, roundMm(requestedBounds.w)),
    h: Math.max(1, roundMm(requestedBounds.h)),
  };
  const scaleX = original.w ? next.w / original.w : 1;
  const scaleY = original.h ? next.h / original.h : 1;
  const transformBox = (box: BBox) => {
    box.x = roundMm(next.x + (box.x - original.x) * scaleX);
    box.y = roundMm(next.y + (box.y - original.y) * scaleY);
    box.w = roundMm(box.w * scaleX);
    box.h = roundMm(box.h * scaleY);
  };

  if (panel.shape.type === 'rect') {
    panel.shape = { type: 'rect', ...next };
  } else {
    panel.shape.points = panel.shape.points.map(([x, y]) => [
      roundMm(next.x + (x - original.x) * scaleX),
      roundMm(next.y + (y - original.y) * scaleY),
    ]);
  }
  panel.figures?.forEach((figure) => { if (figure.bbox) transformBox(figure.bbox); });
  panel.bubbles.forEach((bubble) => { if (bubble.bbox) transformBox(bubble.bbox); });
  panel.screen_text?.forEach((screenText) => { if (screenText.bbox) transformBox(screenText.bbox); });
}

export function convertPanelShape(panel: Panel, type: 'rect' | 'polygon'): void {
  if (panel.shape.type === type) return;
  const bounds = panelBounds(panel);
  panel.shape = type === 'rect'
    ? { type: 'rect', ...bounds }
    : { type: 'polygon', points: [
      [bounds.x, bounds.y],
      [bounds.x + bounds.w, bounds.y],
      [bounds.x + bounds.w, bounds.y + bounds.h],
      [bounds.x, bounds.y + bounds.h],
    ] };
}
