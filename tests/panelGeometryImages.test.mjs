import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { INNER_FRAME_BOUNDS, pointInPanel } from '../src/lib/canvasGeometry.ts';
import { normalizeLayoutRecognition } from '../src/lib/localBridge.ts';

// Opt-in local image regression: originals/models are never copied to the repo.
// See docs/PANEL_AXIS_RECOVERY.md. The worker only reads existing local assets.
const { NYAMURU_TEST_SCAN_IMAGE: scan, NYAMURU_TEST_ONE_IMAGES: one,
  NYAMURU_TEST_VISION_ROOT: vision, NYAMURU_TEST_PANEL_IMAGES: pages } = process.env;
const skip = !(scan && one && vision);
const worker = String.raw`
import sys,json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,'scripts')
import nyamuru_vision_state as vision
image,root=map(Path,sys.argv[1:])
state=SimpleNamespace(vision_root=root, rtdetr_python=root/'.venv/bin/python',
    rtdetr_model=root/'models/rtdetrv4-x-manga109s_v2/model.onnx', baberu_model=root/'models/baberu-ocr')
worker=vision.run_local_worker
def layout_worker(**kwargs):
    return {"lines": []} if kwargs['engine']=='baberu' else worker(**kwargs)
with patch.object(vision,'run_local_worker',side_effect=layout_worker):
    print(json.dumps(vision.LocalVisionState.analyze(state,image.read_bytes(),0)))
`;
function recognizeLayout(path) {
  const payload = JSON.parse(execFileSync(join(vision, '.venv/bin/python'), ['-B', '-c', worker, path, vision],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 120000, maxBuffer: 8e6 }));
  return normalizeLayoutRecognition(payload, { rowGapMm: 5, columnGapMm: 3 });
}
function bounds(shape) {
  if (shape.type === 'rect') return [shape.x, shape.y, shape.w, shape.h];
  const xs = shape.points.map(p => p[0]), ys = shape.points.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

test('local scan01: image detection through canvas geometry retains staggered dividers', { skip }, () => {
  const panels = recognizeLayout(scan).detectedPanels.map(bounds);
  assert.equal(panels.length, 5);
  assert.ok(panels[2][0] - panels[0][0] > 8, JSON.stringify(panels));
  for (const [right, left] of [[panels[0], panels[1]], [panels[2], panels[3]]]) {
    assert.ok(Math.abs(right[0] - left[0] - left[2] - 3) < .2);
    assert.ok(Math.abs(left[0] - INNER_FRAME_BOUNDS.x) < .2);
    assert.ok(Math.abs(right[0] + right[2] - (INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w)) < .2);
  }
});

// Measured pre-fix canvas bounds, in mm, from the same local detector pipeline.
// Preserve existing layout, including known title/line-tracing imperfections;
// these are non-regression references, not ground-truth typesetting targets.
const references = {
  'one03.jpg': [[106.3,53.7,73.7,47.5],[29.9,53.7,73.4,39.2],[106.3,106.2,73.7,46.2],[29.9,97.9,73.4,54.5],
    [106.3,157.4,73.7,44.7],[29.9,157.4,73.4,44.7],[106.3,207.1,73.7,51.5],[29.9,207.1,73.4,51.5]],
  // Pre-change (606bc49) with today's manuscript inner frame. Both column titles are retained.
  'one04.jpg': [[106.5,14.6,88.5,17.8],[15,14.5,88.5,20.7],[106.2,37.4,88.7,60.9],[15.1,40.2,88.3,58.1],
    [113.4,103.3,81.5,54.8],[15.1,103.3,95.3,52.7],[106.3,160.7,88.6,65.8],[15.1,161,88.6,60.4],
    [111.4,222.3,83.5,60.1],[15.1,226.2,93.3,56.3]],
};
for (const [name, expected] of Object.entries(references)) {
  test(`local ${name}: both four-panel strips retain count, order and frame bounds`, { skip }, () => {
    const panels = recognizeLayout(join(one, name)).detectedPanels.map(bounds);
    assert.equal(panels.length, expected.length);
    panels.forEach((box, i) => box.forEach((value, axis) =>
      assert.ok(Math.abs(value - expected[i][axis]) < 1, `${name} panel ${i + 1}, axis ${axis}: ${value} vs ${expected[i][axis]}`)));
  });
}

// Compare editable shapes to the source in page fractions, undoing the editor's inner-frame scaling.
function sourcePolygons(path) {
  const { detectedPanels, sourceFrame: frame } = recognizeLayout(path);
  assert.ok(frame, 'both full-page test layouts must calibrate to the inner frame');
  const inner = INNER_FRAME_BOUNDS;
  return detectedPanels.map(shape => {
    const { x, y, w, h } = shape;
    const points = shape.type === 'rect' ? [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] : shape.points;
    return points.map(([px, py]) => [
      frame.x + (px - inner.x) * frame.w / inner.w,
      frame.y + (py - inner.y) * frame.h / inner.h,
    ]);
  });
}

function near(value, expected, tolerance = .035) {
  assert.ok(Math.abs(value - expected) <= tolerance, `${value} should be within ${tolerance} of ${expected}`);
}
function checkOwner(polygons, x, y, expectedIndex) {
  const owners = polygons.flatMap((points, index) =>
    pointInPanel({ shape: { type: 'polygon', points } }, x, y) ? [index] : []);
  assert.deepEqual(owners, [expectedIndex], `owners of source point (${x}, ${y})`);
}

// 見込み: 上下の実枠に続く斜線2本と人物が中央の欠落を裏付ける。実モデル→編集枠で
// 上中下の3場面を分離し、両斜線の両端（表裏とも）を原稿高3.5%以内に復元する。OCRは対象外。
test('local missing row: three panels meet both slopes behind the balloons', { skip: !(pages && vision) }, () => {
  const panels = sourcePolygons(join(pages, '11.jpg'));
  assert.equal(panels.length, 3);
  for (const [i, y] of [.22, .59, .86].entries()) checkOwner(panels, .48, y, i);
  for (const [upper, lower, left, right] of [[panels[0], panels[1], .343, .504], [panels[1], panels[2], .791, .684]]) {
    near(upper[3][1], left); near(lower[0][1], left);
    near(upper[2][1], right); near(lower[1][1], right);
  }
  for (const q of panels) {
    for (const i of [0, 3]) near(q[i][0], .016);
    for (const i of [1, 2]) near(q[i][0], .938);
  }
  near(panels[0][0][1], .060); near(panels[2][2][1], .954);
});

// 見込み: 下段右の実線と隣の候補が、人物と重なる右枠を裏付ける。実モデル→編集枠の
// 5コマの順・位置、下右の4辺、枠なし左下の顔とふきだしの所属を原稿座標で検査する。
test('local framed close-up: the divider stays to the right of the borderless face', { skip: !(pages && vision) }, () => {
  const panels = sourcePolygons(join(pages, 'yunchan', 'yun02.jpg'));
  assert.equal(panels.length, 5);
  for (const [i, [x, y]] of [[.83,.16],[.36,.16],[.66,.51],[.73,.77],[.34,.78]].entries()) checkOwner(panels, x, y, i);
  checkOwner(panels, .10, .85, 4); // left balloon
  checkOwner(panels, .43, .80, 4); // far side of the left face
  for (const i of [0, 3]) near(panels[3][i][0], .52);
  for (const i of [1, 2]) near(panels[3][i][0], .92);
  near(panels[3][0][1], .67); near(panels[3][2][1], .99);
  near(panels[0][0][0], .60); near(panels[1][1][0], .56);
  near(panels[2][0][1], .42); near(panels[2][2][1], .66);
});
