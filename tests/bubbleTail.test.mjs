import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bubbleJoinGeometry,
  bubbleTailDisabled,
  bubbleTailGeometry,
  bubbleTailPath,
  bubbleTailTargetPoint,
  monologueTailEllipses,
  normalizedBubbleTailTarget,
} from '../src/lib/bubbleTail.ts';

test('しっぽ先端は人物枠外へ短く止められ、既存の枠内座標も保持する', () => {
  const speakerBox = { x: 40, y: 60, w: 80, h: 100 };
  assert.deepEqual(bubbleTailTargetPoint(speakerBox), { x: 80, y: 110 });
  assert.deepEqual(bubbleTailTargetPoint(speakerBox, { x: 0.25, y: 0.8 }), { x: 60, y: 140 });
  const shortTip = { x: 20, y: 200 };
  const relative = normalizedBubbleTailTarget(speakerBox, shortTip);
  assert.deepEqual(relative, { x: -0.25, y: 1.4 });
  assert.deepEqual(bubbleTailTargetPoint(speakerBox, relative), shortTip);
  assert.deepEqual(bubbleTailTargetPoint(speakerBox, { x: NaN, y: Infinity }), { x: 80, y: 110 });
  assert.deepEqual(normalizedBubbleTailTarget(speakerBox, { x: NaN, y: Infinity }), { x: .5, y: .5 });
  const bubble = { x: 10, y: 180, w: 20, h: 16 };
  assert.match(bubbleTailGeometry(bubble, shortTip).outlinePath, /L 20 200 L/);
});

test('しっぽはフキダシ外周から先端へ閉じたベクターパスを作る', () => {
  const path = bubbleTailPath({ x: 140, y: 20, w: 40, h: 50 }, { x: 80, y: 110 }, 'normal');
  assert.ok(path);
  assert.match(path, /^M /);
  assert.match(path, /L 80 110 L/);
  assert.match(path, / Z$/);
  assert.equal(bubbleTailPath({ x: 140, y: 20, w: 40, h: 50 }, { x: 160, y: 45 }, 'normal'), null);
});

test('しっぽの輪郭は根元を閉じず、本体輪郭を消すマスクを返す', () => {
  const geometry = bubbleTailGeometry({ x: 140, y: 20, w: 40, h: 50 }, { x: 80, y: 110 }, 'normal');
  assert.ok(geometry);
  assert.match(geometry.fillPath, / Z$/);
  assert.doesNotMatch(geometry.outlinePath, / Z$/);
  assert.equal(geometry.seamMask.points.length, 4);
  assert.ok(geometry.seamMask.points.flat().every(Number.isFinite));
});

test('フキダシ結合は双方の輪郭マスクと、離れた本体間の開いた輪郭を返す', () => {
  const geometry = bubbleJoinGeometry(
    { x: 20, y: 30, w: 34, h: 46 },
    'normal',
    { x: 72, y: 38, w: 32, h: 42 },
    'thought',
  );
  assert.ok(geometry);
  assert.ok(geometry.fillPath);
  assert.equal(geometry.outlinePaths.length, 2);
  assert.ok(geometry.outlinePaths.every((path) => !path.endsWith(' Z')));
  assert.equal(geometry.firstSeamMask.points.length, 4);
  assert.equal(geometry.secondSeamMask.points.length, 4);
});

test('重なったフキダシ結合は橋を増やさず、輪郭マスクだけを返す', () => {
  const geometry = bubbleJoinGeometry(
    { x: 20, y: 30, w: 40, h: 50 },
    'normal',
    { x: 48, y: 35, w: 40, h: 50 },
    'normal',
  );
  assert.ok(geometry);
  assert.equal(geometry.fillPath, null);
  assert.deepEqual(geometry.outlinePaths, []);
});

test('しっぽなし・コマ外の声・枠なし文字はしっぽを描かない', () => {
  assert.equal(bubbleTailDisabled({ tail: false }), true);
  assert.equal(bubbleTailDisabled({ offscreen: true }), true);
  assert.equal(bubbleTailDisabled({ shape: 'caption' }), true);
  assert.equal(bubbleTailDisabled({ shape: 'normal' }), false);
});

test('モノローグのしっぽは縦長で、人物側ほど小さく間隔が広い', () => {
  const ellipses = monologueTailEllipses({ x: 140, y: 20, w: 40, h: 50 }, { x: 40, y: 200 });
  assert.equal(ellipses.length, 3);
  assert.ok(ellipses.every((ellipse) => ellipse.ry > ellipse.rx));
  assert.ok(ellipses[0].rx > ellipses[1].rx && ellipses[1].rx > ellipses[2].rx);
  const firstGap = Math.hypot(ellipses[1].cx - ellipses[0].cx, ellipses[1].cy - ellipses[0].cy);
  const lastGap = Math.hypot(ellipses[2].cx - ellipses[1].cx, ellipses[2].cy - ellipses[1].cy);
  assert.ok(lastGap > firstGap);
  assert.ok(lastGap > ellipses[1].ry + ellipses[2].ry);
});

test('短いモノローグしっぽでも人物側の粒は前の粒と重ならない', () => {
  const ellipses = monologueTailEllipses({ x: 10, y: 10, w: 20, h: 20 }, { x: 20, y: 31.5 });
  assert.equal(ellipses.length, 2);
  const gap = Math.hypot(ellipses[1].cx - ellipses[0].cx, ellipses[1].cy - ellipses[0].cy);
  assert.ok(gap > ellipses[0].ry + ellipses[1].ry);
});

test('pointed tail union has one closed outline with no seam at the oval boundary', async () => {
  const { bubbleTailComposite } = await import('../src/lib/bubbleTail.ts');
  const { paperPath, defaultVectorStyle } = await import('../src/lib/vectorGeometry.ts');
  const result = bubbleTailComposite({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 150 });
  assert.ok(result);
  assert.equal((result.path.match(/m/gi) ?? []).length, 1);
  assert.equal((result.path.match(/z/gi) ?? []).length, 1);
  const path = paperPath({ id: 'test', closed: true, nodes: [], style: defaultVectorStyle() });
  try {
    path.pathData = result.path;
    assert.ok(path.contains([50, 100]));
    assert.ok(path.contains([50, 120]));
    assert.ok(path.getNearestPoint([50, 100]).getDistance([50, 100]) > 1, 'former body/tail seam is inside the fill, not on the outline');
    assert.ok(path.area > Math.PI * 2500);
  } finally { path.remove(); }
});

test('tail union follows custom/material/legacy outlines through angles and non-square resizing without changing source nodes', async () => {
  const { bubbleTailComposite } = await import('../src/lib/bubbleTail.ts');
  const { createBubbleBezier } = await import('../src/lib/bubbleBezier.ts');
  const { BUBBLE_MATERIALS } = await import('../src/lib/bubblePresetData.ts');
  const { default: paper } = await import('paper');
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(1, 1));
  const fixtures = [['normal', createBubbleBezier('ellipse')], ['square', undefined], ['flash', undefined], ['wobbly', undefined], ['whisper', undefined], ...BUBBLE_MATERIALS.map(p => [p.shape, p.bezier])];
  for (const [shape, bezier] of fixtures) {
    const before = JSON.stringify(bezier);
    for (let angle = 0; angle < 360; angle += 45) {
      const a = angle * Math.PI / 180;
      const result = bubbleTailComposite({ x: 13, y: 27, w: 35, h: 60 }, { x: 30.5 + 90 * Math.cos(a), y: 57 + 90 * Math.sin(a) }, shape, bezier);
      assert.ok(result, `${shape} ${angle}`);
      assert.doesNotMatch(result.path, /NaN|Infinity/);
      const composed = new scope.CompoundPath({ pathData: result.path, insert: false });
      try {
        // A source contour can contain a small hole; it must still have one exterior.
        assert.equal(composed.children.filter(part => part.area > 0).length, 1, `${shape} ${angle}: disconnected body/tail`);
      } finally { composed.remove(); }
    }
    assert.equal(JSON.stringify(bezier), before);
  }
  assert.equal(bubbleTailComposite({ x: 0, y: 0, w: 30, h: 50 }, { x: 15, y: 25 }), null);
  assert.equal(bubbleTailComposite({ x: 0, y: 0, w: 0, h: 50 }, { x: 60, y: 25 }), null);
});
