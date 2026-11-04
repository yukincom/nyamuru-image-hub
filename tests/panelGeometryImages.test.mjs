import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { INNER_FRAME_BOUNDS, pointInPanel } from '../src/lib/canvasGeometry.ts';
import { attachDetectedFiguresToPage, attachRecognizedTextToPage, normalizeLayoutRecognition } from '../src/lib/localBridge.ts';
import { newPage } from '../src/lib/manga.ts';

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
image,root=map(Path,sys.argv[1:3])
include_ocr=sys.argv[3]=='with-ocr'
state=SimpleNamespace(vision_root=root, rtdetr_python=root/'.venv/bin/python',
    rtdetr_model=root/'models/rtdetrv4-x-manga109s_v2/model.onnx', baberu_model=root/'models/baberu-ocr')
worker=vision.run_local_worker
def layout_worker(**kwargs):
    return {"lines": []} if kwargs['engine']=='baberu' and not include_ocr else worker(**kwargs)
with patch.object(vision,'run_local_worker',side_effect=layout_worker):
    print(json.dumps(vision.LocalVisionState.analyze(state,image.read_bytes(),0)))
`;
function recognizeLayout(path, includeOcr = false) {
  const payload = JSON.parse(execFileSync(join(vision, '.venv/bin/python'), ['-B', '-c', worker, path, vision, includeOcr ? 'with-ocr' : 'layout'],
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

// 見込み: 左右の列題の下に4コマずつ並ぶので、右列を読み切ってから左列へ移る。
// 実RT→編集用変換。元の8矩形（8212dc2、mm）の位置と寸法は変えず、順番だけが変われば合格。
test('local one03.jpg: read down the right strip then the left without moving a frame', { skip: !(one && vision) }, () => {
  const panels = recognizeLayout(join(one, 'one03.jpg')).detectedPanels;
  assert.ok(panels.every(p => p.type === 'rect'));
  assert.deepEqual(panels.map(bounds), [
    [106.4,53.7,73.4,47.5], [106.4,106.2,73.4,46.2], [106.4,157.4,73.4,44.7], [106.4,207.1,73.4,51.5],
    [29.9,53.7,73.5,39.2], [29.9,97.9,73.5,54.5], [29.9,157.4,73.5,44.7], [29.9,207.1,73.5,51.5],
  ]);
});

// 見込み: 各列の題字とその下の印刷枠から本文8枠を特定する。実RT・OCR→編集座標で、
// 列題はコマ・発話に入らず、右列→左列の全辺が原画の線中心から2px以内なら合格（上下溝5mm）。
test('local one04.jpg: keep the printed frames and exclude both strip titles', { skip: !(one && vision) }, () => {
  const result = recognizeLayout(join(one, 'one04.jpg'), true);
  assert.equal(result.detectedPanels.length, 8);
  assert.ok(result.ocrLines.length > 0, 'body dialogue must survive title removal');
  assert.ok(result.ocrLines.every(line => line.bbox.y * 851 > 145 && line.sourcePanelId));
  const frame = result.sourceFrame;
  const inner = INNER_FRAME_BOUNDS;
  const sourceX = x => 601 * (frame ? frame.x + (x - inner.x) * frame.w / inner.w : x / 210);
  const sourceY = y => 851 * (frame ? frame.y + (y - inner.y) * frame.h / inner.h : y / 297);
  const rows = [[156.5,296.5], [308.5,448.5], [460.5,600.5], [612.5,752.5]];
  result.detectedPanels.forEach((shape, i) => {
    assert.equal(shape.type, 'rect');
    const [l, r] = i < 4 ? [311.5, 522.5] : [77.5, 288.5];
    const [t, b] = rows[i % 4];
    const actual = [sourceX(shape.x), sourceX(shape.x + shape.w), sourceY(shape.y), sourceY(shape.y + shape.h)];
    [l, r, t, b].forEach((edge, axis) => near(actual[axis], edge, 2));
  });
});

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

// 見込み: 上下をまたぐ横顔の裏には右辺と下辺の実線がある。実RTから編集ページまで通し、
// 上下2枠が印刷外周に届くこと、横顔だけが枠より上の前景に入り上下の人物が各コマに残ることを検査。
test('local 07.jpeg: extend the lower frame behind the page foreground figure', { skip: !(pages && vision) }, () => {
  const result = recognizeLayout(join(pages, '07.jpeg'));
  assert.equal(result.detectedPanels.length, 2);
  const frame = result.sourceFrame;
  assert.ok(frame);
  const inner = INNER_FRAME_BOUNDS;
  const xPx = x => 725 * (frame.x + (x - inner.x) * frame.w / inner.w);
  const yPx = y => 1047 * (frame.y + (y - inner.y) * frame.h / inner.h);
  const [upper, lower] = result.detectedPanels;
  for (const panel of [upper, lower]) {
    assert.equal(panel.type, 'rect');
    near(xPx(panel.x), 39, 4);
    near(xPx(panel.x + panel.w), 666.5, 4);
  }
  near(yPx(upper.y), 60, 4);
  near(yPx((upper.y + upper.h + lower.y) / 2), 530, 4); // 溝の中心。右端の交点は横顔で隠れる
  near(yPx(lower.y + lower.h), 1002, 4);

  const overlays = result.detectedFigures.filter(f => f.pageOverlay);
  assert.equal(overlays.length, 1);
  assert.equal(overlays[0].sourcePanelId, undefined);
  near(overlays[0].bbox.x, .438, .03);
  near(overlays[0].bbox.y, .258, .03);
  near(overlays[0].bbox.x + overlays[0].bbox.w, 1, .015); // 横顔は印刷枠の外にも続く
  near(overlays[0].bbox.y + overlays[0].bbox.h, .87, .03);
  const page = newPage(1);
  page.panels = result.detectedPanels.map((shape, i) => ({ id: i + 1, shape, bubbles: [], bg: 1, action: null }));
  const owners = new Map(result.detectedPanelIds.map((id, i) => [id, page.panels[i]]));
  assert.equal(attachDetectedFiguresToPage(page, result.detectedFigures, undefined, frame, owners).added, 3);
  assert.equal(page.page_overlay.layer, 'above_panel_frames');
  assert.equal(page.page_overlay.figures.length, 1);
  assert.deepEqual(page.panels.map(p => p.figures.length), [1, 1]);
});

// 見込み: 紙いっぱいの人物と離れたセリフは全面1コマ。実RT・Baberuから編集データまで通し、
// 四隅と本文4か所の位置・所属を検査する。OCRの正確さや手描き輪郭の復元は保証しない。
test('local borderless scene: one full frame owns four editable dialogue regions', { skip: !(pages && vision) }, () => {
  const result = recognizeLayout(join(pages, 'yunchan', 'yun00.jpg'), true);
  assert.equal(result.detectedPanels.length, 1);
  assert.deepEqual(result.sourceFrame, { x: 0, y: 0, w: 1, h: 1 });
  const inner = INNER_FRAME_BOUNDS;
  assert.deepEqual(bounds(result.detectedPanels[0]), [inner.x, inner.y, inner.w, inner.h]);
  const page = newPage(1);
  page.panels = [{ ...page.panels[0], shape: result.detectedPanels[0], bubbles: [] }];
  const owners = new Map([[result.detectedPanelIds[0], page.panels[0]]]);
  for (const line of result.ocrLines) assert.equal(line.sourcePanelId, result.detectedPanelIds[0]);
  const attached = attachRecognizedTextToPage(page, result.ocrLines, undefined, result.sourceFrame, owners);
  assert.deepEqual(attached, { added: 4, needsReview: 4 });
  const expected = [[.77,.09], [.27,.41], [.69,.85], [.22,.81]];
  assert.equal(page.panels[0].bubbles.length, expected.length);
  page.panels[0].bubbles.forEach(({ bbox: b }, i) => {
    near((b.x + b.w / 2 - inner.x) / inner.w, expected[i][0]);
    near((b.y + b.h / 2 - inner.y) / inner.h, expected[i][1]);
    if (i === 3) assert.ok((b.y + b.h - inner.y) / inner.h < .92, 'exclude bottom production note');
  });
});

// 見込み: 人物も場面の描線もない表紙の用紙枠・題字は本文ではない。実モデルと編集用変換で
// コマと発話がともに0になり、未検出と違って表紙と説明されれば合格。
test('local title sheet: the paper guide and heading are not a panel and speech', { skip: !(pages && vision) }, () => {
  const result = recognizeLayout(join(pages, '00.jpeg'), true);
  assert.equal(result.detectedPanels.length, 0);
  assert.equal(result.ocrLines.length, 0);
  assert.match(result.reason, /表紙/);
});

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
