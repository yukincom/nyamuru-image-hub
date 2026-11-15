import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toggleCanvasSelection,
  selectionsInLasso,
  extractFigureTargets,
} from '../src/lib/canvasSelection.ts';
import { isMemoryReleaseFailure } from '../src/lib/generation/multiFigureBatch.ts';

function makePage() {
  return {
    page: 1,
    canvas: { w: 1000, h: 1400 },
    images: [],
    panels: [
      {
        id: 1,
        shape: { type: 'rect', x: 50, y: 50, w: 900, h: 600 },
        bg: 'white',
        figures: [
          { name: 'ユキ', bbox: { x: 100, y: 100, w: 180, h: 300 } },
          { name: '刀', kind: 'prop', bbox: { x: 300, y: 150, w: 80, h: 80 } },
          { name: 'ミカ', locked: true, artwork: { assetId: 'a1', bbox: { x: 500, y: 100, w: 150, h: 250 }, locked: true }, bbox: { x: 500, y: 100, w: 150, h: 250 } },
        ],
        bubbles: [
          { text: 'セリフ', shape: 'normal', bbox: { x: 120, y: 80, w: 120, h: 90 } },
        ],
        screen_text: [
          { text: 'ドン', bbox: { x: 200, y: 200, w: 100, h: 60 } },
        ],
        images: [
          { id: 'img-1', assetId: 'asset-1', bbox: { x: 400, y: 400, w: 120, h: 120 } },
        ],
      },
      {
        id: 2,
        shape: { type: 'rect', x: 50, y: 700, w: 900, h: 600 },
        bg: 'white',
        figures: [
          { name: 'アキラ', bbox: { x: 150, y: 750, w: 200, h: 350 } },
        ],
        bubbles: [],
      },
    ],
    page_overlay: {
      figures: [
        { name: '前景ユキ', bbox: { x: 700, y: 750, w: 180, h: 300 } },
      ],
      bubbles: [],
    },
  };
}

test('Shift+クリック用の toggleCanvasSelection が複数選択とトグル解除を行える', () => {
  const first = { type: 'figure', index: 0, scope: 'panel', panelIndex: 0 };
  const second = { type: 'figure', index: 0, scope: 'panel', panelIndex: 1 };
  const bubble = { type: 'bubble', index: 0, scope: 'panel', panelIndex: 0 };

  let list = toggleCanvasSelection([], first, 0);
  assert.equal(list.length, 1);

  list = toggleCanvasSelection(list, second, 0);
  assert.equal(list.length, 2);

  list = toggleCanvasSelection(list, bubble, 0);
  assert.equal(list.length, 3);

  // 同じ要素を再度 Shift+クリックすると解除される
  list = toggleCanvasSelection(list, second, 0);
  assert.equal(list.length, 2);
  assert.equal(list.some((item) => item.panelIndex === 1), false);
});

test('投げ縄選択は複数コマ・ページ前景の要素を検出し、人物以外は extractFigureTargets でエラーなく自動除外される', () => {
  const page = makePage();
  const lasso = [
    { x: 80, y: 60 },
    { x: 920, y: 60 },
    { x: 920, y: 1150 },
    { x: 80, y: 1150 },
  ];

  const hits = selectionsInLasso(page, lasso);
  // コマ1のユキ(0), 刀(1:prop), セリフ(bubble), ドン(screen_text), img-1(image) + コマ2のアキラ(0) + 前景ユキ(overlay:0)
  // ロック済みのミカ(2)は投げ縄の時点で除外
  assert.ok(hits.some((h) => h.type === 'bubble'));
  assert.ok(hits.some((h) => h.type === 'screen_text'));
  assert.ok(hits.some((h) => h.type === 'image'));

  const figures = extractFigureTargets(hits, page, 0);
  assert.equal(figures.length, 3);
  assert.deepEqual(
    figures.map((f) => ({ panelIndex: f.panelIndex, figureIndex: f.figureIndex, overlay: f.overlay, name: f.figure.name })),
    [
      { panelIndex: 0, figureIndex: 0, overlay: false, name: 'ユキ' },
      { panelIndex: 1, figureIndex: 0, overlay: false, name: 'アキラ' },
      { panelIndex: 0, figureIndex: 0, overlay: true, name: '前景ユキ' },
    ],
  );
});

test('人物以外（吹き出しや画像や小道具）だけを選択しても extractFigureTargets は空配列を返しエラーにしない', () => {
  const page = makePage();
  const nonFigures = [
    { type: 'bubble', index: 0, scope: 'panel', panelIndex: 0 },
    { type: 'screen_text', index: 0, scope: 'panel', panelIndex: 0 },
    { type: 'image', index: 0, scope: 'panel', panelIndex: 0 },
    { type: 'figure', index: 1, scope: 'panel', panelIndex: 0 }, // prop
  ];
  const figures = extractFigureTargets(nonFigures, page, 0);
  assert.deepEqual(figures, []);
});

test('isMemoryReleaseFailure は ComfyUI メモリ解放確認失敗を検知する', () => {
  assert.equal(isMemoryReleaseFailure(new Error('ComfyUIのidle・モデル解放を確認できません')), true);
  assert.equal(isMemoryReleaseFailure(new Error('文章LLMの利用終了を確認できませんでした')), true);
  assert.equal(isMemoryReleaseFailure(new Error('ノード生成エラー')), false);
});
