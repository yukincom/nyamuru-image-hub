import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { newPage, newPanel, parseMangaYaml, validateManga } from '../src/lib/manga.ts';
import { defaultPrintSetup, withPrintSetup } from '../src/lib/printSettings.ts';
import { resizePageCanvas } from '../src/lib/pageCanvas.ts';
import { getFinishLayout } from '../src/lib/finishLayout.ts';
import { applyPanelTemplate, PANEL_TEMPLATES } from '../src/lib/panelTemplates.ts';
import { clampedPanelDelta, movePanelEdge, movePanelVertexWithSnap, resizedBox, snapPanelDeltaToInnerFrame, snapPanelResizeToInnerFrame, snapPointToInnerFrame } from '../src/lib/canvasGeometry.ts';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const sample = () => parseMangaYaml(readFileSync(new URL('../src/content/sample.yaml', import.meta.url), 'utf8'));

test('紙面変更は図形・絵・文字・前景を同じ比率で変換し、元画像と相対しっぽを保持する', () => {
  const document = sample();
  const panel = document.manga.pages[0].panels[0];
  panel.shape = { type: 'polygon', points: [[10, 10], [200, 10], [200, 110], [10, 90]] };
  panel.figures = [{ name: 'fixture', bbox: { x: 30, y: 25, w: 40, h: 70 }, analogImport: { assetId: 'source', sourceBBox: { x: .2, y: .1, w: .4, h: .7 } } }];
  panel.bubbles = [{ text: 'fixture', bbox: { x: 80, y: 40, w: 30, h: 35 }, tail: { x: .3, y: .8 } }];
  panel.screen_text = [{ text: 'sound', bbox: { x: 35, y: 20, w: 60, h: 20 } }];
  document.manga.pages[0].page_overlay = { frame: false, layer: 'above_panel_frames', figures: [{ name: 'overlay', bbox: { x: 25, y: 30, w: 80, h: 120 } }], bubbles: [{ text: 'overlay text', bbox: { x: 30, y: 30, w: 35, h: 45 } }], screen_text: [{ text: 'page text', bbox: { x: 100, y: 120, w: 30, h: 15 }, text_style: { fontSize: 15 } }] };
  const original = structuredClone(document);
  const setup = { ...defaultPrintSetup(), width_mm: 257, height_mm: 182 };
  const next = withPrintSetup(document, setup);
  assert.deepEqual(document, original);
  const page = next.manga.pages[0], scaled = page.panels[0];
  const scale = 182 / 297, offset = (257 - 210 * scale) / 2;
  assert.deepEqual(page.canvas, { w: 257, h: 182, unit: 'mm' });
  for (const [a, b] of [[scaled.figures[0], panel.figures[0]], [scaled.bubbles[0], panel.bubbles[0]], [scaled.screen_text[0], panel.screen_text[0]], [page.page_overlay.figures[0], original.manga.pages[0].page_overlay.figures[0]], [page.page_overlay.bubbles[0], original.manga.pages[0].page_overlay.bubbles[0]], [page.page_overlay.screen_text[0], original.manga.pages[0].page_overlay.screen_text[0]]]) {
    close(a.bbox.x, offset + b.bbox.x * scale); close(a.bbox.y, b.bbox.y * scale);
    close(a.bbox.w / a.bbox.h, b.bbox.w / b.bbox.h);
  }
  close(scaled.shape.points[2][0], offset + 200 * scale);
  assert.deepEqual(scaled.figures[0].analogImport, panel.figures[0].analogImport);
  assert.deepEqual(scaled.bubbles[0].tail, panel.bubbles[0].tail);
  assert.ok(getFinishLayout(next.manga).page_transforms.every(p => p.scale_x === 1 && p.scale_y === 1));
  assert.deepEqual(withPrintSetup(next, setup), next);
  assert.deepEqual(withPrintSetup(next, { ...setup, dpi: 1200 }).manga.pages, next.manga.pages);
});

test('スキャン初期配置の用紙変更は紙端と内枠を保ったまま対象判型へ写す', () => {
  const page = newPage(1);
  page.panels = [{
    id: 1,
    shape: { type: 'rect', x: 15, y: 14.5, w: 180, h: 268 },
    bg: 0,
    action: null,
    figures: [{ name: '人物', bbox: { x: 25, y: 29.5, w: 40, h: 80 } }],
    bubbles: [{ text: '台詞', bbox: { x: 155, y: 24.5, w: 30, h: 40 } }],
  }];
  resizePageCanvas(page, { w: 182, h: 257 }, 'inner-frame');
  assert.deepEqual(page.canvas, { w: 182, h: 257, unit: 'mm' });
  assert.deepEqual(page.panels[0].shape, { type: 'rect', x: 16, y: 18.5, w: 150, h: 220 });
  close(page.panels[0].figures[0].bbox.x, 16 + 10 * 150 / 180);
  close(page.panels[0].bubbles[0].bbox.x + page.panels[0].bubbles[0].bbox.w, 16 + 170 * 150 / 180);
});

test('B5横・A5・正方形・小さなpx用紙でテンプレートと追加コマが紙面を保つ', () => {
  for (const canvas of [{ w: 257, h: 182 }, { w: 148, h: 210 }, { w: 100, h: 100 }, { w: 128 * 25.4 / 350, h: 128 * 25.4 / 350 }]) {
    const page = newPage(1, canvas);
    const extra = newPanel(2, 500, canvas);
    assert.ok(extra.shape.x >= 0 && extra.shape.y >= 0);
    assert.ok(extra.shape.x + extra.shape.w <= canvas.w && extra.shape.y + extra.shape.h <= canvas.h);
    for (const template of PANEL_TEMPLATES) {
      page.panels = [];
      applyPanelTemplate(page, template);
      assert.equal(page.canvas.w, canvas.w); assert.equal(page.canvas.h, canvas.h);
      for (const panel of page.panels) {
        const points = panel.shape.type === 'rect' ? [[panel.shape.x, panel.shape.y], [panel.shape.x + panel.shape.w, panel.shape.y + panel.shape.h]] : panel.shape.points;
        assert.ok(points.every(([x,y]) => x >= -1e-6 && y >= -1e-6 && x <= canvas.w + 1e-6 && y <= canvas.h + 1e-6));
      }
    }
  }
});

test('横向き用紙のドラッグ換算・端の制限・内枠吸着が同じmmを使う', () => {
  const canvas = { w: 257, h: 182 }, bounds = { x: 0, y: 0, ...canvas };
  const interaction = { canvas, mode: 'move', startClientX: 0, startClientY: 0, startBox: { x: 20, y: 20, w: 40, h: 50 }, bounds, paperRect: { width: 514, height: 364 } };
  assert.deepEqual(resizedBox(interaction, 40, 20), { x: 40, y: 30, w: 40, h: 50 });
  assert.deepEqual(resizedBox({ ...interaction, mode: 'se' }, 1000, 1000), { x: 20, y: 20, w: 237, h: 162 });
  assert.deepEqual(clampedPanelDelta(interaction.startBox, 1000, 1000, canvas), { x: 197, y: 112 });
  assert.deepEqual(snapPointToInnerFrame(237, 165, undefined, canvas), { x: 238.5, y: 166 });
  assert.deepEqual(snapPanelDeltaToInnerFrame({ x: 190, y: 115, w: 40, h: 40 }, 7, 10, undefined, canvas), { x: 8.5, y: 11 });
  assert.deepEqual(snapPanelResizeToInnerFrame({ x: 10, y: 10, w: 227, h: 155 }, 'se', 20, undefined, canvas), { x: 10, y: 10, w: 228.5, h: 156 });
});

test('横向き用紙の右下タチキリと連動頂点がA4の端に吸われない', () => {
  const canvas = { w: 257, h: 182 };
  const panels = [newPanel(1, 0, canvas)];
  panels[0].shape = { type: 'rect', x: 200, y: 120, w: 35, h: 35 };
  movePanelEdge(panels, 0, 1, 100, 0, false, undefined, canvas);
  movePanelEdge(panels, 0, 2, 0, 100, false, undefined, canvas);
  assert.equal(panels[0].shape.x + panels[0].shape.w, canvas.w);
  assert.equal(panels[0].shape.y + panels[0].shape.h, canvas.h);
  panels[0].bleed = ['right', 'bottom'];
  const document = sample(); document.manga.pages = [{ page: 1, canvas: { ...canvas, unit: 'mm' }, panels }];
  assert.equal(validateManga(document).filter(x => x.path.endsWith('.canvas') || x.path.endsWith('.bleed')).length, 0);
  const linked = [
    { ...newPanel(1), shape: { type: 'polygon', points: [[18.5, 16], [238.5, 16], [238.5, 70], [18.5, 70]] } },
    { ...newPanel(2), shape: { type: 'polygon', points: [[18.5, 75], [238.5, 75], [238.5, 166], [18.5, 166]] } },
  ];
  movePanelVertexWithSnap(linked, 0, 2, 255, 90, true, canvas);
  assert.deepEqual(linked[0].shape.points[2], [238.5, 90]);
  assert.deepEqual(linked[1].shape.points[1], [238.5, 95]);
  assert.deepEqual(linked[1].shape.points[2], [238.5, 166]);
});

test('A6の細いテンプレートコマを動かし始めても最小寸法へ跳ばない', () => {
  const canvas = { w: 105, h: 148 }, page = newPage(1, canvas);
  page.panels = [];
  const template = PANEL_TEMPLATES.find(t => t.id === 'W') ?? PANEL_TEMPLATES.find(t => t.shapes.some(s => s.type === 'rect' && s.w < 50));
  assert.ok(template);
  applyPanelTemplate(page, template);
  const index = page.panels.findIndex(p => p.shape.type === 'rect' && p.shape.w < 20);
  assert.ok(index >= 0);
  const original = structuredClone(page.panels[index]);
  const delta = movePanelEdge(page.panels, index, 1, 0, 0, false, undefined, canvas);
  assert.equal(delta.x, 0);
  assert.deepEqual(page.panels[index], original);
  const interaction = { canvas, mode: 'se', startClientX: 0, startClientY: 0, startBox: original.shape, bounds: { x: 0, y: 0, ...canvas }, paperRect: { width: 210, height: 296 } };
  assert.deepEqual(resizedBox(interaction, 0, 0, 20), original.shape);
});
