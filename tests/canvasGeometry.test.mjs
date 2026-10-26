import assert from 'node:assert/strict';
import test from 'node:test';
import { anchorPoint, clampedPanelDelta, constrainDragDeltaToAxis, convertPanelShape, createShiftAxisSession, fallbackBox, findLinkedPanelEdges, inferPanelGutters, innerFrameBounds, movePanelEdge, movePanelVertexWithSnap, nearestAnchor, panelBounds, panelShapePoints, pointInPanel, resizedBox, resizePanelToBounds, resolveOverlapClick, resolveShiftAxisDrag, resolveShiftAxisSession, resolveVertexDragStartZone, snapEdgeDeltaToInnerFrame, snapPanelDeltaToInnerFrame, snapPanelEdgeDeltaToGutter, snapPanelEdgeDeltaToNeighbor, snapPanelResizeToInnerFrame, snapPanelVertexPointToGutter, snapPointToInnerFrame, syncPanelBleedAtTrim, translatePanel } from '../src/lib/canvasGeometry.ts';

const rectPanel = {
  id: 1,
  shape: { type: 'rect', x: 10, y: 10, w: 190, h: 100 },
  bg: 1,
  bubbles: [],
  action: null,
};

const page1TopologyPanels = () => [
  { ...rectPanel, id: 1, shape: { type: 'polygon', points: [[10, 10], [200, 10], [200, 115.2], [10, 115.2]] } },
  { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[10, 120.2], [200, 120.2], [200, 167.9], [10, 167.5]] } },
  { ...rectPanel, id: 3, shape: { type: 'polygon', points: [[126.6, 172.9], [200, 172.9], [200, 287], [126.6, 287]] } },
  { ...rectPanel, id: 4, shape: { type: 'polygon', points: [[10, 173.2], [120.3, 173.2], [120.3, 224.1], [10, 224.1]] } },
  { ...rectPanel, id: 5, shape: { type: 'polygon', points: [[10, 229.1], [121.6, 228.8], [121.6, 287], [10, 287]] } },
];

const page2TopologyPanels = () => [
  { ...rectPanel, id: 1, shape: { type: 'polygon', points: [[96.8, 10], [200, 10], [200, 97.2], [96.8, 97.2]] } },
  { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[10, 10], [91.8, 10], [91.8, 97.4], [10, 97.4]] } },
  { ...rectPanel, id: 3, shape: { type: 'polygon', points: [[108, 102.4], [200, 102.4], [200, 202.1], [108, 202.1]] } },
  { ...rectPanel, id: 4, shape: { type: 'polygon', points: [[10, 102.4], [103, 102.4], [103, 202.1], [10, 202.1]] } },
  { ...rectPanel, id: 5, shape: { type: 'polygon', points: [[10, 208.4], [200, 208.4], [200, 287], [10, 287]] } },
];

const liveAPlusPanels = () => [
  { ...rectPanel, id: 1, shape: { type: 'polygon', points: [[110, 10], [200, 10], [200, 72.1], [66.6, 53.9]] } },
  { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[10, 10], [101.6, 10], [60.2, 53.1], [10, 46.3]] } },
  { ...rectPanel, id: 3, shape: { type: 'polygon', points: [[69.1, 60.4], [200, 78.2], [200, 140], [122, 140]] } },
  { ...rectPanel, id: 4, shape: { type: 'polygon', points: [[10, 52.4], [62.6, 59.5], [116.1, 140], [10, 140]] } },
  { ...rectPanel, id: 5, shape: { type: 'rect', x: 10, y: 146, w: 190, h: 64 } },
  { ...rectPanel, id: 6, shape: { type: 'rect', x: 10, y: 216, w: 190, h: 71 } },
];

const baseInteraction = {
  mode: 'move',
  startClientX: 100,
  startClientY: 100,
  startBox: { x: 20, y: 20, w: 40, h: 50 },
  bounds: { x: 10, y: 10, w: 190, h: 100 },
  paperRect: { width: 420, height: 594 },
};

test('ドラッグの画面座標をキャンバスmmへ変換する', () => {
  assert.deepEqual(resizedBox(baseInteraction, 142, 120), { x: 41, y: 30, w: 40, h: 50 });
});

test('裁ち切り線の外へ出た矩形辺は紙端へ伸びOMNY bleedになり、内側へ戻すと解除される', () => {
  const panel = structuredClone(rectPanel);
  resizePanelToBounds(panel, { x: -1.2, y: -0.4, w: 206.5, h: 298.1 });
  assert.equal(syncPanelBleedAtTrim(panel, { w: 210, h: 297 }, 3), true);
  assert.deepEqual(panel.shape, { type: 'rect', x: 0, y: 0, w: 205.3, h: 297 });
  assert.deepEqual(panel.bleed, ['left', 'top', 'bottom']);

  resizePanelToBounds(panel, { x: 4, y: 5, w: 201, h: 287 });
  syncPanelBleedAtTrim(panel, { w: 210, h: 297 }, 3);
  assert.equal(panel.bleed, undefined);
  assert.deepEqual(panel.shape, { type: 'rect', x: 4, y: 5, w: 201, h: 287 });
});

test('裁ち切り線に触れただけの矩形はbleedにせず、既存bleedは紙端で保持する', () => {
  const touching = { ...structuredClone(rectPanel), shape: { type: 'rect', x: 0, y: 10, w: 190, h: 100 } };
  assert.equal(syncPanelBleedAtTrim(touching, { w: 210, h: 297 }, 3), false);
  assert.equal(touching.bleed, undefined);

  const existing = { ...structuredClone(touching), bleed: ['left'] };
  syncPanelBleedAtTrim(existing, { w: 210, h: 297 }, 3);
  assert.deepEqual(existing.bleed, ['left']);
  assert.equal(clampedPanelDelta({ x: 10, y: 10, w: 100, h: 100 }, -20, -20, { w: 210, h: 297 }, 3).x, -13);
});

test('多角形はrect専用のOMNY bleedへ暗黙変換しない', () => {
  const panel = { ...structuredClone(rectPanel), shape: { type: 'polygon', points: [[-1, 0], [100, 0], [100, 100]] } };
  assert.equal(syncPanelBleedAtTrim(panel, { w: 210, h: 297 }, 3), false);
  assert.equal(panel.bleed, undefined);
  assert.deepEqual(panel.shape.points[0], [-1, 0]);
});

test('Shiftドラッグは変化量の大きい軸だけを残す', () => {
  assert.deepEqual(constrainDragDeltaToAxis(20, 8), { x: 20, y: 0 });
  assert.deepEqual(constrainDragDeltaToAxis(-7, 18), { x: 0, y: 18 });
  assert.deepEqual(constrainDragDeltaToAxis(-12, -12), { x: -12, y: 0 });
});

test('Shiftドラッグは2.5mmの初動後に最初の軸を固定し、途中で切り替えない', () => {
  let state = {};
  let result = resolveShiftAxisDrag(2, 1, state);
  assert.deepEqual({ x: result.x, y: result.y, axis: result.state.axis }, { x: 0, y: 0, axis: undefined });

  state = result.state;
  result = resolveShiftAxisDrag(3, 1, state);
  assert.deepEqual({ x: result.x, y: result.y, axis: result.state.axis }, { x: 3, y: 0, axis: 'x' });

  state = result.state;
  result = resolveShiftAxisDrag(1, 20, state);
  assert.deepEqual({ x: result.x, y: result.y, axis: result.state.axis }, { x: 1, y: 0, axis: 'x' });

  state = result.state;
  result = resolveShiftAxisDrag(-4, -30, state);
  assert.deepEqual({ x: result.x, y: result.y, axis: result.state.axis }, { x: -4, y: 0, axis: 'x' });
});

test('Shiftを離して押し直すと現在位置を保ったまま新しい軸を選べる', () => {
  let session = createShiftAxisSession(true);
  let result = resolveShiftAxisSession(8, 1, true, session, 0, 0);
  assert.deepEqual({ x: result.x, y: result.y, axis: result.axis }, { x: 8, y: 0, axis: 'x' });

  session = result.state;
  result = resolveShiftAxisSession(8, 20, true, session, 8, 0);
  assert.deepEqual({ x: result.x, y: result.y, axis: result.axis }, { x: 8, y: 0, axis: 'x' });

  session = result.state;
  result = resolveShiftAxisSession(8, 20, false, session, 8, 0);
  assert.deepEqual({ x: result.x, y: result.y, axis: result.axis }, { x: 8, y: 0, axis: undefined });

  session = result.state;
  result = resolveShiftAxisSession(8, 20, true, session, 8, 0);
  assert.deepEqual({ x: result.x, y: result.y, axis: result.axis }, { x: 8, y: 0, axis: undefined });

  session = result.state;
  result = resolveShiftAxisSession(8, 23, true, session, 8, 0);
  assert.deepEqual({ x: result.x, y: result.y, axis: result.axis }, { x: 8, y: 3, axis: 'y' });
});

test('Shift解除後の自由移動も解除地点から継続してワープしない', () => {
  let session = createShiftAxisSession(true);
  let result = resolveShiftAxisSession(10, 1, true, session, 0, 0);
  session = result.state;

  result = resolveShiftAxisSession(10, 8, false, session, 10, 0);
  assert.deepEqual({ x: result.x, y: result.y }, { x: 10, y: 0 });

  session = result.state;
  result = resolveShiftAxisSession(12, 11, false, session, 10, 0);
  assert.deepEqual({ x: result.x, y: result.y }, { x: 12, y: 3 });
});

test('ドラッグした要素をコマ境界内へ収める', () => {
  assert.deepEqual(resizedBox(baseInteraction, 1000, 1000), { x: 160, y: 60, w: 40, h: 50 });
  assert.deepEqual(resizedBox(baseInteraction, -1000, -1000), { x: 10, y: 10, w: 40, h: 50 });
});

test('南東ハンドルで幅と高さを拡大する', () => {
  assert.deepEqual(resizedBox({ ...baseInteraction, mode: 'se' }, 142, 159.4), { x: 20, y: 20, w: 61, h: 79.7 });
});

test('北西ハンドルは最小6mmを保つ', () => {
  assert.deepEqual(resizedBox({ ...baseInteraction, mode: 'nw' }, 1000, 1000), { x: 54, y: 64, w: 6, h: 6 });
});

test('多角形コマの外接矩形を操作境界として求める', () => {
  assert.deepEqual(panelBounds({ ...rectPanel, shape: { type: 'polygon', points: [[20, 30], [190, 25], [180, 140], [10, 130]] } }), { x: 10, y: 25, w: 180, h: 115 });
});

test('bbox未指定の要素にもコマ内の初期操作領域を与える', () => {
  const figure = fallbackBox(rectPanel, 'figure', 0);
  const bubble = fallbackBox(rectPanel, 'bubble', 0);
  assert.ok(figure.x >= 10 && figure.y >= 10 && figure.x + figure.w <= 200 && figure.y + figure.h <= 110);
  assert.ok(bubble.x >= 10 && bubble.y >= 10 && bubble.x + bubble.w <= 200 && bubble.y + bubble.h <= 110);
  assert.ok(bubble.x > figure.x);
});

test('コマ移動量をキャンバス内へ制限する', () => {
  assert.deepEqual(clampedPanelDelta({ x: 10, y: 20, w: 80, h: 100 }, 25.24, 30.26), { x: 25.2, y: 30.3 });
  assert.deepEqual(clampedPanelDelta({ x: 10, y: 20, w: 80, h: 100 }, -50, -50), { x: -10, y: -20 });
  assert.deepEqual(clampedPanelDelta({ x: 150, y: 230, w: 50, h: 60 }, 50, 50), { x: 10, y: 7 });
});

test('コマ移動時に近い辺だけを内枠へスナップする', () => {
  assert.deepEqual(snapPanelDeltaToInnerFrame({ x: 17, y: 17, w: 80, h: 100 }, 0, 0), { x: -2, y: -2.5 });
  assert.deepEqual(snapPanelDeltaToInnerFrame({ x: 19, y: 40, w: 80, h: 100 }, 0, 0), { x: -4, y: 0 });
  assert.deepEqual(snapPanelDeltaToInnerFrame({ x: 112, y: 180, w: 80, h: 100 }, 0, 0), { x: 3, y: 2.5 });
  assert.deepEqual(snapPanelDeltaToInnerFrame({ x: 25, y: 30, w: 80, h: 100 }, 0, 0), { x: 0, y: 0 });
});

test('リサイズ中に操作中の辺だけを内枠へスナップする', () => {
  assert.deepEqual(snapPanelResizeToInnerFrame({ x: 17, y: 20, w: 80, h: 100 }, 'nw'), { x: 15, y: 20, w: 82, h: 100 });
  assert.deepEqual(snapPanelResizeToInnerFrame({ x: 20, y: 30, w: 173, h: 250 }, 'se'), { x: 20, y: 30, w: 175, h: 252.5 });
});

test('多角形頂点を近い内枠線へスナップする', () => {
  assert.deepEqual(snapPointToInnerFrame(17, 281), { x: 15, y: 282.5 });
  assert.deepEqual(snapPointToInnerFrame(100, 120), { x: 100, y: 120 });
});

test('内枠は固定10mmではなく判型別の標準寸法を使う', () => {
  assert.deepEqual(innerFrameBounds({ w: 182, h: 257 }), { x: 16, y: 18.5, w: 150, h: 220 });
  assert.deepEqual(innerFrameBounds({ w: 257, h: 182 }), { x: 18.5, y: 16, w: 220, h: 150 });
  assert.deepEqual(innerFrameBounds({ w: 148, h: 210 }), { x: 11.5, y: 15, w: 125, h: 180 });
  assert.deepEqual(innerFrameBounds({ w: 128, h: 182 }), { x: 11.5, y: 16, w: 105, h: 150 });
  assert.deepEqual(innerFrameBounds({ w: 210, h: 297 }), { x: 15, y: 14.5, w: 180, h: 268 });
  assert.deepEqual(innerFrameBounds({ w: 257, h: 364 }), { x: 22.5, y: 32, w: 212, h: 300 });
});

test('頂点ドラッグ開始付近では別のスナップを抑え、元位置へ正確に戻せる', () => {
  assert.deepEqual(resolveVertexDragStartZone(69.1, 60.4, 69.1, 60.4), {
    x: 69.1, y: 60.4, suppressOtherSnaps: true, restored: true,
  });
  assert.deepEqual(resolveVertexDragStartZone(70.1, 60.4, 69.1, 60.4), {
    x: 70.1, y: 60.4, suppressOtherSnaps: true, restored: false,
  });
  assert.deepEqual(resolveVertexDragStartZone(74.1, 60.4, 69.1, 60.4), {
    x: 74.1, y: 60.4, suppressOtherSnaps: false, restored: false,
  });
  assert.deepEqual(resolveVertexDragStartZone(69.4, 60.4, 69.1, 60.4, false), {
    x: 69.4, y: 60.4, suppressOtherSnaps: false, restored: false,
  });
  assert.deepEqual(resolveVertexDragStartZone(12, 50, 12, 50, false), {
    x: 12, y: 50, suppressOtherSnaps: true, restored: true,
  });
  assert.deepEqual(resolveVertexDragStartZone(12.1, 50, 12, 50, false), {
    x: 12.1, y: 50, suppressOtherSnaps: false, restored: false,
  });
});

test('矩形も辺操作用の時計回り頂点列として扱う', () => {
  assert.deepEqual(panelShapePoints(rectPanel), [[10, 10], [200, 10], [200, 110], [10, 110]]);
});

test('辺の角度を保ったまま内枠へスナップする', () => {
  const delta = snapEdgeDeltaToInnerFrame([12, 30], [22, 100], 0, 0);
  assert.deepEqual(delta, { x: 3, y: 0 });
  assert.deepEqual([[12 + delta.x, 30 + delta.y], [22 + delta.x, 100 + delta.y]], [[15, 30], [25, 100]]);
});

test('テンプレートのコマ座標から上下・左右の代表間隔を求める', () => {
  assert.deepEqual(inferPanelGutters([
    { type: 'rect', x: 10, y: 10, w: 190, h: 60 },
    { type: 'rect', x: 10, y: 76, w: 90, h: 80 },
    { type: 'rect', x: 105, y: 76, w: 95, h: 80 },
    { type: 'rect', x: 10, y: 162, w: 190, h: 125 },
  ]), { rowGapMm: 6, columnGapMm: 5 });
});

test('辺を設定済みの上下・左右コマ間隔へ近づけると吸着する', () => {
  const rowPanels = [
    { ...rectPanel, shape: { type: 'rect', x: 10, y: 10, w: 190, h: 80 } },
    { ...rectPanel, id: 2, shape: { type: 'rect', x: 10, y: 96, w: 190, h: 80 } },
  ];
  const rowSnap = snapPanelEdgeDeltaToGutter(rowPanels, 0, 2, 0, 0, { rowGapMm: 5, columnGapMm: 3 });
  assert.equal(rowSnap.snapped, true);
  assert.deepEqual({ x: rowSnap.x, y: rowSnap.y }, { x: 0, y: 1 });

  const columnPanels = [
    { ...rectPanel, shape: { type: 'rect', x: 10, y: 10, w: 90, h: 100 } },
    { ...rectPanel, id: 2, shape: { type: 'rect', x: 104, y: 10, w: 90, h: 100 } },
  ];
  const columnSnap = snapPanelEdgeDeltaToGutter(columnPanels, 0, 1, 0, 0, { rowGapMm: 5, columnGapMm: 3 });
  assert.equal(columnSnap.snapped, true);
  assert.deepEqual({ x: columnSnap.x, y: columnSnap.y }, { x: 1, y: 0 });
});

test('頂点を設定済みの上下・左右コマ間隔へ近づけると許可軸上で吸着する', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'polygon', points: [[10, 10], [99, 10], [99, 90], [10, 90]] } },
    { ...rectPanel, id: 2, shape: { type: 'rect', x: 105, y: 10, w: 95, h: 80 } },
    { ...rectPanel, id: 3, shape: { type: 'rect', x: 10, y: 95, w: 190, h: 80 } },
  ];
  const horizontal = snapPanelVertexPointToGutter(panels, 0, 1, 101, 13, { rowGapMm: 5, columnGapMm: 5 }, undefined, 'x');
  assert.deepEqual({ x: horizontal.x, y: horizontal.y, snapped: horizontal.snapped }, { x: 100, y: 13, snapped: true });

  const vertical = snapPanelVertexPointToGutter(panels, 0, 2, 99, 91, { rowGapMm: 5, columnGapMm: 5 }, undefined, 'y');
  assert.deepEqual({ x: vertical.x, y: vertical.y, snapped: vertical.snapped }, { x: 99, y: 90, snapped: true });

  const free = snapPanelVertexPointToGutter(panels, 0, 2, 101, 91, { rowGapMm: 5, columnGapMm: 5 });
  assert.deepEqual({ x: free.x, y: free.y, snapped: free.snapped }, { x: 100, y: 90, snapped: true });
});

test('近接する斜め平行辺をコマ間の連動対象として見つける', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'polygon', points: [[10, 10], [100, 10], [90, 100], [10, 100]] } },
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[105, 10], [195, 10], [195, 100], [95, 100]] } },
  ];
  assert.deepEqual(findLinkedPanelEdges(panels, 0, 1), [{ panelIndex: 1, edgeIndex: 3 }]);
});

test('辺ドラッグは選択した2頂点を同量移動して傾きを維持する', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'polygon', points: [[10, 10], [100, 10], [90, 100], [10, 100]] } },
  ];
  movePanelEdge(panels, 0, 1, 5, 3);
  assert.deepEqual(panels[0].shape.points, [[10, 10], [105, 13], [95, 103], [10, 100]]);
});

test('コマシンクロ中の辺ドラッグは隣接する斜め平行辺も連動する', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'polygon', points: [[10, 10], [100, 10], [90, 100], [10, 100]] } },
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[105, 10], [195, 10], [195, 100], [95, 100]] } },
  ];
  const result = movePanelEdge(panels, 0, 1, 4, 2, true);
  assert.equal(result.linkedEdges, 1);
  assert.deepEqual(panels[0].shape.points, [[10, 10], [104, 12], [94, 102], [10, 100]]);
  assert.deepEqual(panels[1].shape.points, [[109, 12], [195, 10], [195, 100], [99, 102]]);
});

test('1頂点ドラッグでは同じX/Yにあるだけの頂点や離れたコマへ影響しない', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'polygon', points: [[20, 20], [100, 20], [100, 100], [20, 100]] } },
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[110, 20], [190, 20], [190, 100], [110, 100]] } },
  ];
  movePanelVertexWithSnap(panels, 0, 0, 25, 23, true);
  assert.deepEqual(panels[0].shape.points, [[25, 23], [100, 20], [100, 100], [20, 100]]);
  assert.deepEqual(panels[1].shape.points, [[110, 20], [190, 20], [190, 100], [110, 100]]);
});

test('局所接合は選択点側の延長だけを追従し、固定端の先にある短辺を拾わない', () => {
  const selected = { ...rectPanel, shape: { type: 'polygon', points: [[20, 20], [26, 20], [20, 80]] } };

  const beyondFixedEnd = [
    structuredClone(selected),
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[28, 15], [34, 15], [31, 5]] } },
  ];
  movePanelVertexWithSnap(beyondFixedEnd, 0, 0, 15, 20, true);
  assert.deepEqual(panelShapePoints(beyondFixedEnd[1]), [[28, 15], [34, 15], [31, 5]]);

  const overlappingOnlyAtFixedEnd = [
    structuredClone(selected),
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[24, 15], [30, 15], [27, 5]] } },
  ];
  movePanelVertexWithSnap(overlappingOnlyAtFixedEnd, 0, 0, 15, 20, true);
  assert.deepEqual(panelShapePoints(overlappingOnlyAtFixedEnd[1]), [[24, 15], [30, 15], [27, 5]]);

  const beforeSelectedPoint = [
    structuredClone(selected),
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[6, 15], [18, 15], [12, 5]] } },
  ];
  movePanelVertexWithSnap(beforeSelectedPoint, 0, 0, 15, 20, true);
  assert.deepEqual(panelShapePoints(beforeSelectedPoint[1]), [[6, 15], [15, 15], [12, 5]]);

  const touchingSelectedPoint = [
    structuredClone(selected),
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[12, 15], [20, 15], [16, 5]] } },
  ];
  movePanelVertexWithSnap(touchingSelectedPoint, 0, 0, 15, 20, true);
  assert.deepEqual(panelShapePoints(touchingSelectedPoint[1]), [[12, 15], [15, 15], [16, 5]]);

  const selectedSideWallWithFixedEndNoise = [
    structuredClone(selected),
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[14, 15], [22, 15], [18, 5]] } },
    { ...rectPanel, id: 3, shape: { type: 'polygon', points: [[28, 15], [34, 15], [31, 5]] } },
  ];
  movePanelVertexWithSnap(selectedSideWallWithFixedEndNoise, 0, 0, 15, 20, true);
  assert.deepEqual(panelShapePoints(selectedSideWallWithFixedEndNoise[1]), [[14, 15], [17, 15], [18, 5]]);
  assert.deepEqual(panelShapePoints(selectedSideWallWithFixedEndNoise[2]), [[28, 15], [34, 15], [31, 5]]);
});

test('A+頂点連動は近い接合点だけへ選択点の拘束後変位を同量伝える', () => {
  const unchanged = [
    { panelIndex: 0, vertexIndex: 3, point: [66.6, 53.9] },
    { panelIndex: 1, vertexIndex: 1, point: [101.6, 10] },
    { panelIndex: 1, vertexIndex: 3, point: [10, 46.3] },
    { panelIndex: 3, vertexIndex: 0, point: [10, 52.4] },
    { panelIndex: 3, vertexIndex: 2, point: [116.1, 140] },
  ];

  const horizontal = liveAPlusPanels();
  movePanelVertexWithSnap(horizontal, 2, 0, 77.1, 60.4, true);
  assert.deepEqual(panelShapePoints(horizontal[2])[0], [77.1, 60.4]);
  assert.deepEqual(panelShapePoints(horizontal[1])[2], [68.2, 53.1]);
  assert.deepEqual(panelShapePoints(horizontal[3])[1], [70.6, 59.5]);
  unchanged.forEach(({ panelIndex, vertexIndex, point }) => {
    assert.deepEqual(panelShapePoints(horizontal[panelIndex])[vertexIndex], point);
  });

  const vertical = liveAPlusPanels();
  movePanelVertexWithSnap(vertical, 2, 0, 69.1, 68.4, true);
  assert.deepEqual(panelShapePoints(vertical[2])[0], [69.1, 68.4]);
  assert.deepEqual(panelShapePoints(vertical[1])[2], [60.2, 61.1]);
  assert.deepEqual(panelShapePoints(vertical[3])[1], [62.6, 67.5]);
  unchanged.forEach(({ panelIndex, vertexIndex, point }) => {
    assert.deepEqual(panelShapePoints(vertical[panelIndex])[vertexIndex], point);
  });
});

test('短い投影重なりでも選択点をまたぐ直近の対向頂点は同量追従する', () => {
  const panels = [
    { ...rectPanel, id: 1, shape: { type: 'polygon', points: [[10, 10], [200, 10], [200, 65], [10, 90]] } },
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[200, 70], [200, 175.7], [112, 175.7], [122, 80]] } },
    { ...rectPanel, id: 3, shape: { type: 'polygon', points: [[117, 81], [107, 175.7], [10, 175.7], [10, 95]] } },
    { ...rectPanel, id: 4, shape: { type: 'polygon', points: [[200, 180.7], [200, 287], [82, 287], [100, 180.7]] } },
    { ...rectPanel, id: 5, shape: { type: 'polygon', points: [[95, 180.7], [77, 287], [10, 287], [10, 180.7]] } },
  ];

  movePanelVertexWithSnap(panels, 2, 1, 115, 175.7, true);

  assert.deepEqual(panelShapePoints(panels[1])[2], [120, 175.7]);
  assert.deepEqual(panelShapePoints(panels[2])[1], [115, 175.7]);
  assert.deepEqual(panelShapePoints(panels[3])[3], [108, 180.7]);
  assert.deepEqual(panelShapePoints(panels[4])[0], [95, 180.7]);
});

test('追従点の境界制限は選択頂点の到達位置を短縮しない', () => {
  const panels = liveAPlusPanels();
  movePanelVertexWithSnap(panels, 2, 0, 69.1, 10, true);
  assert.deepEqual(panelShapePoints(panels[2])[0], [69.1, 10]);
  for (const panel of panels) {
    for (const [x, y] of panelShapePoints(panel)) {
      assert.ok(x >= 0 && x <= 210 && y >= 0 && y <= 297);
    }
  }
});

test('局所追従点だけが内枠上の合法位置で止まり、選択頂点は要求位置まで動く', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'polygon', points: [[15, 25], [100, 25], [15, 100]] } },
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[5, 20], [10, 20], [7.5, 10]] } },
  ];
  movePanelVertexWithSnap(panels, 0, 0, 15, 14.5, true);
  assert.deepEqual(panelShapePoints(panels[0]), [[15, 14.5], [100, 25], [15, 100]]);
  assert.deepEqual(panelShapePoints(panels[1]), [[5, 20], [10, 14.5], [7.5, 10]]);
});

test('狭いコマでは選択点に近い壁だけを局所接合にし、反対側の壁へ渡らない', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'polygon', points: [[20, 20], [20, 150], [100, 150], [100, 20]] } },
    { ...rectPanel, id: 2, shape: { type: 'rect', x: 12, y: 20, w: 6, h: 130 } },
  ];
  movePanelVertexWithSnap(panels, 0, 0, 20, 30, true);
  assert.deepEqual(panelShapePoints(panels[0]), [[20, 30], [20, 150], [100, 150], [100, 20]]);
  assert.deepEqual(panelShapePoints(panels[1]), [[12, 20], [18, 30], [18, 150], [12, 150]]);
});

test('狭いコマの両壁が分割されていても最前面の分割壁だけを補間する', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'polygon', points: [[20, 20], [20, 150], [100, 150], [100, 20]] } },
    { ...rectPanel, id: 2, shape: { type: 'rect', x: 12, y: 20, w: 6, h: 60 } },
    { ...rectPanel, id: 3, shape: { type: 'rect', x: 12, y: 85, w: 6, h: 65 } },
  ];
  movePanelVertexWithSnap(panels, 0, 0, 30, 20, true);
  const selectedEdge = [panelShapePoints(panels[0])[0], panelShapePoints(panels[0])[1]];
  const selectedVector = [selectedEdge[1][0] - selectedEdge[0][0], selectedEdge[1][1] - selectedEdge[0][1]];
  panels.slice(1).forEach((panel, index) => {
    const points = panelShapePoints(panel);
    const expectedFarY = index === 0 ? [20, 80] : [85, 150];
    assert.deepEqual([points[0], points[3]], [[12, expectedFarY[0]], [12, expectedFarY[1]]]);
    const nearVector = [points[2][0] - points[1][0], points[2][1] - points[1][1]];
    const parallelError = Math.abs(selectedVector[0] * nearVector[1] - selectedVector[1] * nearVector[0])
      / (Math.hypot(...selectedVector) * Math.hypot(...nearVector));
    assert.ok(parallelError < 0.002);
  });
});

test('斜めの局所追従点は境界で移動線分上の最後の合法点に止まる', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'polygon', points: [[190, 95], [100, 95], [100, 50]] } },
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[195, 100], [150, 100], [150, 150], [195, 150]] } },
  ];
  movePanelVertexWithSnap(panels, 0, 0, 200, 105, true);
  assert.deepEqual(panelShapePoints(panels[0])[0], [200, 105]);
  assert.deepEqual(panelShapePoints(panels[1]), [[195, 110], [150, 100], [150, 150], [195, 150]]);
});

test('分割対向壁が境界へ達しても変形後の平行線上に残る', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'polygon', points: [[20, 20], [200, 20], [200, 280], [20, 280]] } },
    { ...rectPanel, id: 2, shape: { type: 'rect', x: 28, y: 30, w: 50, h: 100 } },
    { ...rectPanel, id: 3, shape: { type: 'rect', x: 28, y: 135, w: 50, h: 100 } },
  ];
  movePanelVertexWithSnap(panels, 0, 0, 210, 20, true);
  const selectedEdge = [panelShapePoints(panels[0])[3], panelShapePoints(panels[0])[0]];
  const selectedVector = [selectedEdge[1][0] - selectedEdge[0][0], selectedEdge[1][1] - selectedEdge[0][1]];
  for (const panel of panels.slice(1)) {
    const points = panelShapePoints(panel);
    const followerVector = [points[0][0] - points[3][0], points[0][1] - points[3][1]];
    const parallelError = Math.abs(selectedVector[0] * followerVector[1] - selectedVector[1] * followerVector[0])
      / (Math.hypot(...selectedVector) * Math.hypot(...followerVector));
    assert.ok(parallelError < 0.002);
    assert.ok(points[0][0] >= 10 && points[0][0] <= 200 && points[0][1] >= 10 && points[0][1] <= 287);
    assert.ok(points[3][0] >= 10 && points[3][0] <= 200 && points[3][1] >= 10 && points[3][1] <= 287);
  }
  assert.deepEqual(panelShapePoints(panels[1]).slice(1, 3), [[78, 30], [78, 130]]);
  assert.deepEqual(panelShapePoints(panels[2]).slice(1, 3), [[78, 135], [78, 235]]);
});

test('頂点ドラッグは隣接辺だけを5mm間隔で傾け、外側の遠い角を動かさない', () => {
  const panels = [
    { ...rectPanel, id: 1, shape: { type: 'polygon', points: [[10, 10], [200, 10], [200, 90], [10, 90]] } },
    { ...rectPanel, id: 2, shape: { type: 'rect', x: 105, y: 95, w: 95, h: 55 } },
    { ...rectPanel, id: 3, shape: { type: 'rect', x: 10, y: 95, w: 90, h: 55 } },
  ];
  movePanelVertexWithSnap(panels, 0, 2, 200, 65, true);

  assert.deepEqual(panels[0].shape.points, [[10, 10], [200, 10], [200, 65], [10, 90]]);
  assert.equal(panels[1].shape.type, 'polygon');
  assert.equal(panels[2].shape.type, 'polygon');
  assert.deepEqual(panels[1].shape.points.slice(2), [[200, 150], [105, 150]]);
  assert.deepEqual(panels[2].shape.points.slice(2), [[100, 150], [10, 150]]);

  const selectedEdge = [panels[0].shape.points[2], panels[0].shape.points[3]];
  const distance = (point) => Math.abs(
    (selectedEdge[1][0] - selectedEdge[0][0]) * (selectedEdge[0][1] - point[1])
      - (selectedEdge[0][0] - point[0]) * (selectedEdge[1][1] - selectedEdge[0][1]),
  ) / Math.hypot(selectedEdge[1][0] - selectedEdge[0][0], selectedEdge[1][1] - selectedEdge[0][1]);
  for (const point of [...panels[1].shape.points.slice(0, 2), ...panels[2].shape.points.slice(0, 2)]) {
    assert.ok(Math.abs(distance(point) - 5) < 0.1);
  }
});

test('コマシンクロOFFなら1頂点だけを移動する', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'polygon', points: [[20, 20], [100, 20], [100, 100], [20, 100]] } },
  ];
  movePanelVertexWithSnap(panels, 0, 0, 25, 23, false);
  assert.deepEqual(panels[0].shape.points, [[25, 23], [100, 20], [100, 100], [20, 100]]);
});

test('矩形の頂点もShift相当の水平・垂直移動で多角形化し、隣接コマへ連動する', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'rect', x: 20, y: 20, w: 80, h: 80 } },
    { ...rectPanel, id: 2, shape: { type: 'rect', x: 105, y: 20, w: 85, h: 80 } },
  ];
  movePanelVertexWithSnap(panels, 0, 1, 110, 20, true);

  assert.equal(panels[0].shape.type, 'polygon');
  assert.deepEqual(panels[0].shape.points, [[20, 20], [110, 20], [100, 100], [20, 100]]);
  assert.equal(panels[1].shape.type, 'polygon');
  assert.notDeepEqual(panels[1].shape.points, [[105, 20], [190, 20], [190, 100], [105, 100]]);

  const verticalPanels = [
    { ...rectPanel, shape: { type: 'rect', x: 20, y: 20, w: 80, h: 80 } },
    { ...rectPanel, id: 2, shape: { type: 'rect', x: 20, y: 105, w: 80, h: 85 } },
  ];
  movePanelVertexWithSnap(verticalPanels, 0, 2, 100, 110, true);
  assert.equal(verticalPanels[0].shape.type, 'polygon');
  assert.deepEqual(verticalPanels[0].shape.points, [[20, 20], [100, 20], [100, 110], [20, 100]]);
  assert.equal(verticalPanels[1].shape.type, 'polygon');
  assert.notDeepEqual(verticalPanels[1].shape.points, [[20, 105], [100, 105], [100, 190], [20, 190]]);
});

test('内枠とタチキリ上の頂点は境界線に沿う方向だけへ動く', () => {
  const innerFramePanel = { ...rectPanel, shape: { type: 'polygon', points: [[15, 20], [100, 20], [100, 100], [15, 100]] } };
  movePanelVertexWithSnap([innerFramePanel], 0, 0, 30, 35, false);
  assert.deepEqual(innerFramePanel.shape.points[0], [15, 35]);

  const innerCornerPanel = { ...rectPanel, shape: { type: 'polygon', points: [[15, 14.5], [100, 14.5], [100, 100], [15, 100]] } };
  movePanelVertexWithSnap([innerCornerPanel], 0, 0, 30, 35, false);
  assert.deepEqual(innerCornerPanel.shape.points[0], [15, 14.5]);

  const bleedPanel = { ...rectPanel, bleed: ['left'], shape: { type: 'polygon', points: [[0, 40], [100, 40], [100, 120], [0, 120]] } };
  movePanelVertexWithSnap([bleedPanel], 0, 0, 20, 55, false);
  assert.deepEqual(bleedPanel.shape.points[0], [0, 55]);
});

test('page 2型でも接合点だけを同量動かし、遠端や下段へ変形を漏らさない', () => {
  const makePanels = () => [
    { ...rectPanel, id: 1, shape: { type: 'polygon', points: [[96.8, 10], [200, 10], [200, 97.2], [96.8, 97.2]] } },
    { ...rectPanel, id: 2, shape: { type: 'rect', x: 10, y: 10, w: 81.8, h: 87.4 } },
    { ...rectPanel, id: 3, shape: { type: 'polygon', points: [[108, 102.4], [200, 102.4], [200, 202.1], [108, 202.1]] } },
    { ...rectPanel, id: 4, shape: { type: 'rect', x: 10, y: 102.4, w: 93, h: 99.7 } },
    { ...rectPanel, id: 5, shape: { type: 'rect', x: 10, y: 208.4, w: 190, h: 78.6 } },
  ];

  const fromPanel1 = makePanels();
  movePanelVertexWithSnap(fromPanel1, 0, 3, 96.8, 92.2, true);
  assert.deepEqual(panelShapePoints(fromPanel1[1]), [[10, 10], [91.8, 10], [91.8, 92.4], [10, 97.4]]);
  assert.deepEqual(panelShapePoints(fromPanel1[3]), [[10, 102.4], [103, 97.4], [103, 202.1], [10, 202.1]]);
  assert.deepEqual(panelShapePoints(fromPanel1[4]), [[10, 208.4], [200, 208.4], [200, 287], [10, 287]]);

  const fromPanel3 = makePanels();
  movePanelVertexWithSnap(fromPanel3, 2, 3, 108, 192.1, true);
  assert.deepEqual(panelShapePoints(fromPanel3[3]), [[10, 102.4], [103, 102.4], [103, 192.1], [10, 202.1]]);
  assert.deepEqual(panelShapePoints(fromPanel3[4]), [[10, 208.4], [200, 208.4], [200, 287], [10, 287]]);
});

test('page 2型の頂点変形は直接接する溝だけで止まり、2段先へ伝播しない', () => {
  const fromPanel3 = page2TopologyPanels();
  movePanelVertexWithSnap(fromPanel3, 2, 0, 108, 112.4, true);
  assert.deepEqual(panelShapePoints(fromPanel3[0]), [[96.8, 10], [200, 10], [200, 97.2], [96.8, 107.2]]);
  assert.deepEqual(panelShapePoints(fromPanel3[1]), [[10, 10], [91.8, 10], [91.8, 97.4], [10, 97.4]]);
  assert.deepEqual(panelShapePoints(fromPanel3[3]), [[10, 102.4], [103, 112.4], [103, 202.1], [10, 202.1]]);
  assert.deepEqual(panelShapePoints(fromPanel3[4]), [[10, 208.4], [200, 208.4], [200, 287], [10, 287]]);

  const fromPanel4 = page2TopologyPanels();
  movePanelVertexWithSnap(fromPanel4, 3, 1, 103, 112.4, true);
  assert.deepEqual(panelShapePoints(fromPanel4[0]), [[96.8, 10], [200, 10], [200, 97.2], [96.8, 107.2]]);
  assert.deepEqual(panelShapePoints(fromPanel4[1]), [[10, 10], [91.8, 10], [91.8, 97.4], [10, 97.4]]);
  assert.deepEqual(panelShapePoints(fromPanel4[2]), [[108, 112.4], [200, 102.4], [200, 202.1], [108, 202.1]]);
  assert.deepEqual(panelShapePoints(fromPanel4[4]), [[10, 208.4], [200, 208.4], [200, 287], [10, 287]]);
});

test('頂点を辺に沿って動かすと近い接合点だけが同量追従する', () => {
  for (const targetX of [86.8, 106.8]) {
    const panels = page2TopologyPanels();
    const deltaX = targetX - 96.8;
    const panel3Before = panelShapePoints(panels[2]);
    const panel4Before = panelShapePoints(panels[3]);
    movePanelVertexWithSnap(panels, 0, 3, targetX, 97.2, true);
    assert.deepEqual(panelShapePoints(panels[2]), panel3Before);
    assert.deepEqual(panelShapePoints(panels[1]), [[10, 10], [91.8, 10], [91.8 + deltaX, 97.4], [10, 97.4]]);
    assert.deepEqual(panelShapePoints(panels[3]), [panel4Before[0], [103 + deltaX, 102.4], panel4Before[2], panel4Before[3]]);
  }
});

test('page 1型の短い切れ目でも近端だけが接合追従し、遠端は動かない', () => {
  const fromPanel5 = page1TopologyPanels();
  movePanelVertexWithSnap(fromPanel5, 4, 1, 131.6, 228.8, true);
  assert.deepEqual(panelShapePoints(fromPanel5[3]), [[10, 173.2], [120.3, 173.2], [130.3, 224.1], [10, 224.1]]);
  assert.deepEqual(panelShapePoints(fromPanel5[2]), [[126.6, 172.9], [200, 172.9], [200, 287], [126.6, 287]]);

  const fromPanel4 = page1TopologyPanels();
  movePanelVertexWithSnap(fromPanel4, 3, 0, 10, 183.2, true);
  assert.deepEqual(panelShapePoints(fromPanel4[1]), [[10, 120.2], [200, 120.2], [200, 167.9], [10, 177.5]]);
  assert.deepEqual(panelShapePoints(fromPanel4[2]), [[126.6, 172.9], [200, 172.9], [200, 287], [126.6, 287]]);
  assert.deepEqual(panelShapePoints(fromPanel4[4]), [[10, 229.1], [121.6, 228.8], [121.6, 287], [10, 287]]);
});

test('追従点が紙端に留まっても選択頂点は自身の要求位置まで動く', () => {
  const panels = [
    { ...rectPanel, shape: { type: 'polygon', points: [[10, 200], [100, 250], [90, 290], [10, 290]] } },
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[105, 257], [195, 257], [195, 297], [95, 297]] } },
  ];
  movePanelVertexWithSnap(panels, 0, 2, 93, 297, true);
  assert.deepEqual(panels[0].shape.points[2], [93, 297]);
  assert.equal(panels[1].shape.points[3][1], 297);
  assert.deepEqual(panels[1].shape.points[3], [95, 297]);
});

test('横に分割されて少しズレた辺は隣辺へ吸着し、揃った後は連動する', () => {
  const panels = [
    { ...rectPanel, id: 1, shape: { type: 'polygon', points: [[10, 10], [200, 10], [200, 88.1], [10, 88.1]] } },
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[104, 95.5], [200, 95.5], [200, 171], [104, 171]] } },
    { ...rectPanel, id: 3, shape: { type: 'rect', x: 10, y: 95.1, w: 90, h: 75.9 } },
    { ...rectPanel, id: 4, shape: { type: 'rect', x: 1, y: 177, w: 209, h: 120 } },
  ];
  assert.deepEqual(findLinkedPanelEdges(panels, 1, 0), [
    { panelIndex: 0, edgeIndex: 2 },
  ]);
  const snapped = snapPanelEdgeDeltaToNeighbor(panels, 1, 0, 0, 0);
  assert.deepEqual(snapped, { x: 0, y: -0.4, snapped: true, target: { panelIndex: 2, edgeIndex: 0 } });
  movePanelEdge(panels, 1, 0, snapped.x, snapped.y, true, snapped.target);
  assert.deepEqual(panels[1].shape.points.slice(0, 2), [[104, 95.1], [200, 95.1]]);
  assert.deepEqual(panels[2].shape, { type: 'rect', x: 10, y: 95.1, w: 90, h: 75.9 });
  assert.deepEqual(panels[0].shape.points.slice(2), [[200, 87.7], [10, 87.7]]);

  assert.deepEqual(findLinkedPanelEdges(panels, 1, 0), [
    { panelIndex: 2, edgeIndex: 0 },
    { panelIndex: 0, edgeIndex: 2 },
  ]);
  movePanelEdge(panels, 1, 0, 0, 5, true);
  assert.deepEqual(panels[1].shape.points.slice(0, 2), [[104, 100.1], [200, 100.1]]);
  assert.deepEqual(panels[2].shape, { type: 'rect', x: 10, y: 100.1, w: 90, h: 70.9 });
  assert.deepEqual(panels[0].shape.points.slice(2), [[200, 92.7], [10, 92.7]]);
});

test('コマシンクロOFF相当ではズレた隣辺へ干渉しない', () => {
  const panels = [
    { ...rectPanel, id: 1, shape: { type: 'polygon', points: [[10, 10], [200, 10], [200, 88.1], [10, 88.1]] } },
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[104, 95.5], [200, 95.5], [200, 171], [104, 171]] } },
    { ...rectPanel, id: 3, shape: { type: 'rect', x: 10, y: 95.1, w: 90, h: 75.9 } },
  ];
  movePanelEdge(panels, 1, 0, 0, 5, false);
  assert.deepEqual(panels[1].shape.points.slice(0, 2), [[104, 100.5], [200, 100.5]]);
  assert.equal(panels[2].shape.y, 95.1);
  assert.deepEqual(panels[0].shape.points.slice(2), [[200, 88.1], [10, 88.1]]);
});

test('斜めに延長された隣辺にも角度を保って吸着する', () => {
  const panels = [
    { ...rectPanel, id: 1, shape: { type: 'polygon', points: [[10, 10], [50, 50], [45, 90], [5, 50]] } },
    { ...rectPanel, id: 2, shape: { type: 'polygon', points: [[54, 56], [90, 92], [86, 110], [50, 74]] } },
  ];
  assert.deepEqual(snapPanelEdgeDeltaToNeighbor(panels, 0, 0, 0, 0), {
    x: -1,
    y: 1,
    snapped: true,
    target: { panelIndex: 1, edgeIndex: 0 },
  });
});

test('同一直線上の辺グループは隣接関係をたどって端まで連動する', () => {
  const panels = [
    { ...rectPanel, id: 1, shape: { type: 'rect', x: 10, y: 10, w: 40, h: 80 } },
    { ...rectPanel, id: 2, shape: { type: 'rect', x: 54, y: 10, w: 40, h: 80 } },
    { ...rectPanel, id: 3, shape: { type: 'rect', x: 98, y: 10, w: 40, h: 80 } },
  ];
  movePanelEdge(panels, 0, 0, 0, 5, true);
  assert.deepEqual(panels.map((panel) => panel.shape.y), [15, 15, 15]);
});

test('長い斜め境界の1頂点変位を隣接する分割辺全体へ補間する', () => {
  const selectedBefore = [[90.9, 14.5], [88.5, 282.5]];
  const adjacentBefore = [
    [[82.6, 14.5], [82.6, 96.1]],
    [[82.6, 100], [82.6, 191]],
    [[82.6, 194.9], [82.6, 282.5]],
  ];
  const panels = [
    { ...rectPanel, id: 1, shape: { type: 'polygon', points: [[90.9, 14.5], [210, 14.5], [207.6, 282.5], [88.5, 282.5]] } },
    { ...rectPanel, id: 2, shape: { type: 'rect', x: 10, y: 14.5, w: 72.6, h: 81.6 } },
    { ...rectPanel, id: 3, shape: { type: 'rect', x: 10, y: 100, w: 72.6, h: 91 } },
    { ...rectPanel, id: 4, shape: { type: 'rect', x: 10, y: 194.9, w: 72.6, h: 87.6 } },
  ];
  movePanelVertexWithSnap(panels, 0, 0, 100.9, 14.5, true);

  for (const panel of panels.slice(1)) assert.equal(panel.shape.type, 'polygon');
  const rightEdgeX = panels.slice(1).flatMap((panel) => [panel.shape.points[1][0], panel.shape.points[2][0]]);
  assert.deepEqual(rightEdgeX, [93, 89.2, 89.8, 85.6, 86.3, 82.2]);
  assert.deepEqual(panels.slice(1).map((panel) => [panel.shape.points[0][0], panel.shape.points[3][0]]), [
    [10, 10], [10, 10], [10, 10],
  ]);

  const selectedAfter = [panels[0].shape.points[0], panels[0].shape.points[3]];
  const slope = (edge) => (edge[1][0] - edge[0][0]) / (edge[1][1] - edge[0][1]);
  const lineDistance = (line, point) => Math.abs(
    (line[1][0] - line[0][0]) * (line[0][1] - point[1])
      - (line[0][0] - point[0]) * (line[1][1] - line[0][1]),
  ) / Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]);
  panels.slice(1).forEach((panel, index) => {
    const edge = [panel.shape.points[1], panel.shape.points[2]];
    assert.ok(Math.abs(slope(edge) - slope(selectedAfter)) < 0.002);
    const gapBefore = adjacentBefore[index].reduce((sum, point) => sum + lineDistance(selectedBefore, point), 0) / 2;
    const gapAfter = edge.reduce((sum, point) => sum + lineDistance(selectedAfter, point), 0) / 2;
    assert.ok(Math.abs(gapBefore - gapAfter) < 0.03);
  });
});

test('コマ移動時に形状・人物・フキダシを一緒に移動する', () => {
  const panel = {
    ...rectPanel,
    shape: { ...rectPanel.shape },
    figures: [{ name: '人物', bbox: { x: 20, y: 30, w: 40, h: 50 } }],
    bubbles: [{ text: 'セリフ', bbox: { x: 70, y: 25, w: 30, h: 20 } }],
  };
  translatePanel(panel, 12.25, -4.24);
  assert.deepEqual(panel.shape, { type: 'rect', x: 22.3, y: 5.8, w: 190, h: 100 });
  assert.deepEqual(panel.figures[0].bbox, { x: 32.3, y: 25.8, w: 40, h: 50 });
  assert.deepEqual(panel.bubbles[0].bbox, { x: 82.3, y: 20.8, w: 30, h: 20 });
});

test('形状タイプの切り替えで左上位置と大きさを維持する', () => {
  const panel = {
    ...rectPanel,
    shape: { type: 'polygon', points: [[15, 25], [190, 20], [200, 115], [10, 120]] },
    figures: [{ name: '人物', bbox: { x: 30, y: 40, w: 50, h: 60 } }],
  };
  const before = structuredClone(panel.figures[0].bbox);
  convertPanelShape(panel, 'rect');
  assert.deepEqual(panel.shape, { type: 'rect', x: 10, y: 20, w: 190, h: 100 });
  assert.deepEqual(panel.figures[0].bbox, before);
  convertPanelShape(panel, 'polygon');
  assert.deepEqual(panel.shape.points, [[10, 20], [200, 20], [200, 120], [10, 120]]);
  assert.deepEqual(panel.figures[0].bbox, before);
});

test('コマ拡大縮小時に人物・フキダシも相対的に追従する', () => {
  const panel = {
    ...rectPanel,
    shape: { type: 'rect', x: 10, y: 10, w: 100, h: 100 },
    figures: [{ name: '人物', bbox: { x: 20, y: 20, w: 20, h: 40 } }],
    bubbles: [{ text: 'セリフ', bbox: { x: 70, y: 30, w: 20, h: 20 } }],
  };
  resizePanelToBounds(panel, { x: 20, y: 30, w: 180, h: 50 });
  assert.deepEqual(panel.shape, { type: 'rect', x: 20, y: 30, w: 180, h: 50 });
  assert.deepEqual(panel.figures[0].bbox, { x: 38, y: 35, w: 36, h: 20 });
  assert.deepEqual(panel.bubbles[0].bbox, { x: 128, y: 40, w: 36, h: 10 });
});

test('多角形コマの拡大縮小で各頂点を外接矩形へ合わせる', () => {
  const panel = { ...rectPanel, shape: { type: 'polygon', points: [[10, 10], [100, 20], [110, 110], [20, 100]] } };
  resizePanelToBounds(panel, { x: 20, y: 30, w: 180, h: 160 });
  assert.deepEqual(panel.shape.points, [[20, 30], [182, 46], [200, 190], [38, 174]]);
});

test('アンカー種別ごとにコマ内の位置を求める（端は内側6mm）', () => {
  const bounds = { x: 10, y: 10, w: 100, h: 80 };
  assert.deepEqual(anchorPoint(bounds, 'center'), { x: 60, y: 50 });
  assert.deepEqual(anchorPoint(bounds, 'left'), { x: 16, y: 50 });
  assert.deepEqual(anchorPoint(bounds, 'right'), { x: 104, y: 50 });
  assert.deepEqual(anchorPoint(bounds, 'top-left'), { x: 16, y: 16 });
  assert.deepEqual(anchorPoint(bounds, 'bottom-right'), { x: 104, y: 84 });
});

test('小さいコマではアンカーの内側マージンを縮める', () => {
  assert.deepEqual(anchorPoint({ x: 0, y: 0, w: 20, h: 10 }, 'top-left'), { x: 3, y: 1.5 });
});

test('bbox中心に最も近いコマ内アンカーを求める', () => {
  const bounds = { x: 10, y: 10, w: 190, h: 100 };
  assert.equal(nearestAnchor(bounds, { x: 12, y: 12, w: 10, h: 10 }), 'top-left');
  assert.equal(nearestAnchor(bounds, { x: 85, y: 40, w: 40, h: 40 }), 'center');
  assert.equal(nearestAnchor(bounds, { x: 180, y: 40, w: 18, h: 40 }), 'right');
  assert.equal(nearestAnchor(bounds, { x: 20, y: 80, w: 30, h: 28 }), 'bottom-left');
  assert.equal(nearestAnchor(bounds, { x: 150, y: 12, w: 40, h: 20 }), 'top-right');
});

test('矩形と多角形のパネル内外を判定する', () => {
  assert.equal(pointInPanel(rectPanel, 15, 15), true);
  assert.equal(pointInPanel(rectPanel, 5, 15), false);
  const triangle = { ...rectPanel, shape: { type: 'polygon', points: [[0, 0], [30, 0], [0, 30]] } };
  assert.equal(pointInPanel(triangle, 5, 5), true);
  assert.equal(pointInPanel(triangle, 25, 25), false);
});

test('重なったパネルの空白クリックは貫通する', () => {
  const back = { id: 1, shape: { type: 'rect', x: 10, y: 10, w: 100, h: 100 }, bg: 1, bubbles: [{ text: 'あ', bbox: { x: 90, y: 90, w: 15, h: 15 } }], action: null };
  const front = { id: 2, shape: { type: 'rect', x: 50, y: 50, w: 100, h: 100 }, bg: 1, bubbles: [{ text: 'い', bbox: { x: 60, y: 60, w: 20, h: 20 } }], action: null };
  const panels = [back, front];
  // 重なりのない位置は貫通しない
  assert.equal(resolveOverlapClick(panels, 1, -1, 140, 100), 1);
  // 最前面パネルのエレメント上はそのパネルのまま
  assert.equal(resolveOverlapClick(panels, 1, -1, 70, 70), 1);
  // 空白の下にエレメントを持つパネルがあればそこへ貫通
  assert.equal(resolveOverlapClick(panels, 1, -1, 95, 95), 0);
  // どのパネルにもエレメントがなければ最奥へ
  assert.equal(resolveOverlapClick(panels, 1, -1, 55, 80), 0);
  // 選択中パネルからは一段ずつ奥へ送り、最奥からは最前面へ戻る
  assert.equal(resolveOverlapClick(panels, 1, 1, 55, 80), 0);
  assert.equal(resolveOverlapClick(panels, 1, 0, 55, 80), 1);
});


test('overlap selection accepts rendered-content coverage instead of the paint frame',()=>{
 const make=()=>({id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:1,action:null,figures:[{name:'padded',bbox:{x:0,y:0,w:100,h:100}}],bubbles:[]});
 const panels=[make(),make()];
 assert.equal(resolveOverlapClick(panels,1,-1,50,50,(_panel,index)=>index===0),0);
 assert.equal(resolveOverlapClick(panels,1,-1,50,50,(_panel,index)=>index===1),1);
});
