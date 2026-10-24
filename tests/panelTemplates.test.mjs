import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPanelTemplate, mergeSelectedPanels, moveBubbleToOwner, PANEL_TEMPLATES, reconcileSplitOverlapFlags, splitPanel } from '../src/lib/panelTemplates.ts';

const rect = (x, y, w, h) => ({ type: 'rect', x, y, w, h });

function pageWith(panels) {
  return { page: 1, canvas: { w: 210, h: 297, unit: 'mm' }, panels };
}

function panel(id, shape, overrides = {}) {
  return { id, shape, bg: 1, bubbles: [], action: null, ...overrides };
}

test('プロンプト§BのパターンA〜Zを選択肢として持つ', () => {
  assert.equal(PANEL_TEMPLATES.map((template) => template.id).join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  assert.deepEqual(PANEL_TEMPLATES.map((template) => template.shapes.length), [3, 6, 1, 4, 5, 4, 4, 6, 4, 5, 5, 3, 1, 4, 3, 4, 4, 4, 4, 5, 3, 3, 4, 4, 4, 5]);
  assert.deepEqual(PANEL_TEMPLATES.find((template) => template.id === 'B').shapes[1], {
    type: 'polygon', points: [[200, 95], [200, 170], [105, 170], [115, 95]],
  });
  assert.deepEqual(PANEL_TEMPLATES.find((template) => template.id === 'M').shapes[0], rect(0, 10, 210, 287));
});

test('タチキリ系テンプレートは bleed 宣言を持ち、適用したコマへ引き継がれる', () => {
  const template = PANEL_TEMPLATES.find((t) => t.id === 'M');
  assert.deepEqual(template.bleeds[0], ['left', 'right', 'bottom']);
  const page = pageWith([panel(1, rect(10, 10, 190, 100))]);
  applyPanelTemplate(page, template);
  assert.deepEqual(page.panels[0].bleed, ['left', 'right', 'bottom']);
});

test('タチキリ系テンプレートN〜Qは紙端(x=0/x=210/y=297)に達し、上端はy=10を守る', () => {
  for (const id of ['N', 'O', 'P', 'Q']) {
    const template = PANEL_TEMPLATES.find((t) => t.id === id);
    const bleeds = template.shapes.filter((s) => s.x === 0 || s.x + s.w === 210 || s.y + s.h === 297);
    assert.ok(bleeds.length >= 1 && bleeds.length <= 2, `${id}のタチキリコマは1〜2個`);
    for (const s of template.shapes) {
      assert.ok(s.y >= 10, `${id}の上端はヘッダー帯のためy=10まで`);
    }
  }
});

test('多角形系テンプレートR〜Uは多角形コマを含み、余白(x:10〜200, y:10〜287)に収まる', () => {
  for (const id of ['R', 'S', 'T', 'U']) {
    const template = PANEL_TEMPLATES.find((t) => t.id === id);
    const polygons = template.shapes.filter((s) => s.type === 'polygon');
    assert.ok(polygons.length >= 2, `${id}は多角形コマを2個以上持つ`);
    for (const shape of polygons) {
      for (const [x, y] of shape.points) {
        assert.ok(x >= 10 && x <= 200, `${id}のx座標は余白内`);
        assert.ok(y >= 10 && y <= 287, `${id}のy座標は余白内`);
      }
    }
  }
});

test('既存の人物とフキダシを新しいコマの絶対mm座標へ変換する', () => {
  const page = pageWith([
    panel(1, rect(10, 10, 100, 100), {
      figures: [{ name: '人物', bbox: { x: 20, y: 30, w: 20, h: 40 } }],
      bubbles: [{ text: 'セリフ' }],
    }),
  ]);
  const template = { id: 'X', name: 'テスト', usage: '', shapes: [rect(20, 30, 180, 50)] };

  applyPanelTemplate(page, template);

  assert.deepEqual(page.panels[0].shape, rect(20, 30, 180, 50));
  assert.deepEqual(page.panels[0].figures[0].bbox, { x: 38, y: 40, w: 36, h: 20 });
  // bbox未指定でも、適用前に画面へ表示されていたフォールバック位置（縦長40×50目安）から移動して保存する。
  assert.deepEqual(page.panels[0].bubbles[0].bbox, { x: 129.8, y: 32, w: 63, h: 22.5 });
});

test('テンプレートの方が多いときは既存内容を保ち、残りを空コマで追加する', () => {
  const page = pageWith([
    panel(1, rect(10, 10, 190, 100), { bubbles: [{ text: '残す' }] }),
  ]);
  const template = { id: 'X', name: 'テスト', usage: '', shapes: [rect(10, 10, 190, 80), rect(10, 95, 190, 90)] };

  applyPanelTemplate(page, template);

  assert.equal(page.panels.length, 2);
  assert.equal(page.panels[0].bubbles[0].text, '残す');
  assert.deepEqual(page.panels[1], panel(2, rect(10, 95, 190, 90)));
});

test('テンプレートの方が少なくても全コマの内容を統合して保持する', () => {
  const page = pageWith([
    panel(1, rect(10, 10, 190, 80), {
      figures: [{ name: '右の人物', bbox: { x: 30, y: 20, w: 40, h: 50 } }],
      bubbles: [{ text: 'ひとつめ', bbox: { x: 140, y: 20, w: 35, h: 30 } }],
      assets: ['人物素材'], action: '右を見る', background_description: '教室の右側',
    }),
    panel(2, rect(10, 100, 190, 80), {
      figures: [{ name: '左の人物', bbox: { x: 110, y: 110, w: 40, h: 50 } }],
      bubbles: [{ text: 'ふたつめ', bbox: { x: 30, y: 110, w: 35, h: 30 } }],
      assets: ['背景素材'], action: '左を見る', background_description: '教室の左側',
    }),
  ]);
  const template = { id: 'X', name: 'テスト', usage: '', shapes: [rect(10, 10, 190, 277)] };

  applyPanelTemplate(page, template);

  assert.equal(page.panels.length, 1);
  assert.deepEqual(page.panels[0].figures.map((figure) => figure.name), ['右の人物', '左の人物']);
  assert.deepEqual(page.panels[0].bubbles.map((bubble) => bubble.text), ['ひとつめ', 'ふたつめ']);
  assert.deepEqual(page.panels[0].assets, ['人物素材', '背景素材']);
  assert.equal(page.panels[0].action, '右を見る\n左を見る');
  assert.equal(page.panels[0].background_description, '教室の右側\n教室の左側');
  for (const item of [...page.panels[0].figures, ...page.panels[0].bubbles]) {
    assert.ok(item.bbox.x >= 10 && item.bbox.y >= 10);
    assert.ok(item.bbox.x + item.bbox.w <= 200 && item.bbox.y + item.bbox.h <= 287);
  }
});

test('テンプレート統合は背景詳細度の高いコマを優先し、背景情報と矛盾させない', () => {
  const page = pageWith([
    panel(1, rect(10, 10, 190, 80), { bg: -1 }),
    panel(2, rect(10, 100, 190, 80), { bg: 2, background_description: '夜の駅前を詳細に描く' }),
  ]);
  const template = { id: 'X', name: 'テスト', usage: '', shapes: [rect(10, 10, 190, 277)] };

  applyPanelTemplate(page, template);

  assert.equal(page.panels[0].bg, 2);
  assert.equal(page.panels[0].background_description, '夜の駅前を詳細に描く');
});

test('選択したコマを吹き出しごと外接矩形へ合体する', () => {
  const page = pageWith([
    panel(1, rect(10, 10, 90, 80), {
      figures: [{ name: '人物', bbox: { x: 20, y: 20, w: 30, h: 50 } }],
      bubbles: [{ text: '右', bbox: { x: 60, y: 20, w: 30, h: 30 } }],
      assets: ['人物素材'], action: '右を見る', background_description: '右の窓', bg: 1,
    }),
    panel(2, rect(105, 10, 95, 80), {
      bubbles: [{ text: '左', bbox: { x: 150, y: 20, w: 30, h: 30 } }],
      screen_text: [{ text: '看板', bbox: { x: 115, y: 60, w: 30, h: 12 } }],
      assets: ['背景素材'], action: '左を見る', background_description: '左の机', bg: 2,
    }),
    panel(3, rect(10, 95, 190, 90), { bubbles: [{ text: '残る' }] }),
  ]);

  assert.equal(mergeSelectedPanels(page, [1, 0, 1]), 0);
  assert.equal(page.panels.length, 2);
  assert.deepEqual(page.panels[0].shape, rect(10, 10, 190, 80));
  assert.deepEqual(page.panels[0].bubbles.map((bubble) => bubble.text), ['右', '左']);
  assert.deepEqual(page.panels[0].bubbles.map((bubble) => bubble.bbox.x), [60, 150]);
  assert.deepEqual(page.panels[0].figures.map((figure) => figure.name), ['人物']);
  assert.deepEqual(page.panels[0].screen_text.map((item) => item.text), ['看板']);
  assert.deepEqual(page.panels[0].assets, ['人物素材', '背景素材']);
  assert.equal(page.panels[0].action, '右を見る\n左を見る');
  assert.equal(page.panels[0].background_description, '右の窓\n左の机');
  assert.equal(page.panels[0].bg, 2);
  assert.equal(page.panels[1].id, 2);
  assert.equal(page.panels[1].bubbles[0].text, '残る');
});

test('コマ合体は矩形より検出済みの多角形を優先して斜め辺を残す', () => {
  const diagonal = { type: 'polygon', points: [[80, 10], [200, 10], [200, 120], [110, 120]] };
  const page = pageWith([
    panel(1, rect(75, 10, 125, 110), { bubbles: [{ text: '矩形候補' }] }),
    panel(2, diagonal, { bubbles: [{ text: '斜め候補' }] }),
  ]);

  mergeSelectedPanels(page, [0, 1]);

  assert.deepEqual(page.panels[0].shape, diagonal);
  assert.deepEqual(page.panels[0].bubbles.map((bubble) => bubble.text), ['矩形候補', '斜め候補']);
});

test('コマ合体では同じ検出元の人物を一つにし、ユーザー編集済みを優先する', () => {
  const sourceBBox = { x: 0.1, y: 0.1, w: 0.2, h: 0.4 };
  const analogImport = {
    schemaVersion: 1,
    sourceRegionId: 'scan-1:figure-001',
    assetId: 'analog-figure:scan-1:figure-001',
    sourceBBox,
    detectionSource: 'body',
    confidence: 0.8,
    draft: true,
  };
  const page = pageWith([
    panel(1, rect(10, 10, 90, 80), {
      figures: [{ name: '人物あたり', bbox: { x: 20, y: 20, w: 30, h: 50 }, analogImport }],
    }),
    panel(2, rect(105, 10, 95, 80), {
      figures: [{
        name: '人物あたり', bbox: { x: 120, y: 20, w: 30, h: 50 },
        analogImport: { ...analogImport, userEdited: true },
      }],
    }),
  ]);

  mergeSelectedPanels(page, [0, 1]);

  assert.equal(page.panels[0].figures.length, 1);
  assert.equal(page.panels[0].figures[0].bbox.x, 120);
  assert.equal(page.panels[0].figures[0].analogImport.userEdited, true);
});

test('異なる検出元IDの人物は枠が重なっていてもコマ合体で消さない', () => {
  const importMetadata = (id) => ({
    schemaVersion: 1,
    sourceRegionId: id,
    assetId: `analog-figure:${id}`,
    sourceBBox: { x: 0.1, y: 0.1, w: 0.2, h: 0.4 },
    detectionSource: 'body',
    draft: true,
  });
  const page = pageWith([
    panel(1, rect(10, 10, 90, 80), {
      figures: [{ name: '人物あたり', bbox: { x: 20, y: 20, w: 30, h: 50 }, analogImport: importMetadata('scan:001') }],
    }),
    panel(2, rect(105, 10, 95, 80), {
      figures: [{ name: '人物あたり', bbox: { x: 20, y: 20, w: 30, h: 50 }, analogImport: importMetadata('scan:002') }],
    }),
  ]);

  mergeSelectedPanels(page, [0, 1]);

  assert.equal(page.panels[0].figures.length, 2);
});

test('タテ分割は現在の左右間隔で右から左へ二分し、要素を中心位置で振り分ける', () => {
  const page = pageWith([
    panel(1, rect(10, 10, 190, 80), {
      figures: [
        { name: '右の人物', bbox: { x: 130, y: 20, w: 40, h: 55 } },
        { name: '左の人物', bbox: { x: 25, y: 20, w: 40, h: 55 } },
      ],
      bubbles: [
        { text: '右', bbox: { x: 160, y: 18, w: 25, h: 30 } },
        { text: '左', bbox: { x: 25, y: 18, w: 25, h: 30 } },
      ],
      screen_text: [
        { text: 'RIGHT', bbox: { x: 120, y: 65, w: 30, h: 10 } },
        { text: 'LEFT', bbox: { x: 45, y: 65, w: 30, h: 10 } },
      ],
      action: '元の演出',
      background_description: '雨の教室',
    }),
    panel(2, rect(10, 95, 190, 80), { bubbles: [{ text: '後続' }] }),
  ]);

  assert.deepEqual(splitPanel(page, 0, 'vertical', { rowGapMm: 6, columnGapMm: 4 }), [0, 1]);
  assert.equal(page.panels.length, 3);
  assert.deepEqual(page.panels[0].shape, rect(107, 10, 93, 80));
  assert.deepEqual(page.panels[1].shape, rect(10, 10, 93, 80));
  assert.deepEqual(page.panels[0].bubbles.map((bubble) => bubble.text), ['右']);
  assert.deepEqual(page.panels[1].bubbles.map((bubble) => bubble.text), ['左']);
  assert.deepEqual(page.panels[0].figures.map((figure) => figure.name), ['右の人物']);
  assert.deepEqual(page.panels[1].figures.map((figure) => figure.name), ['左の人物']);
  assert.deepEqual(page.panels[0].screen_text.map((item) => item.text), ['RIGHT']);
  assert.deepEqual(page.panels[1].screen_text.map((item) => item.text), ['LEFT']);
  assert.equal(page.panels[0].action, '元の演出');
  assert.equal(page.panels[1].action, null);
  assert.equal(page.panels[0].background_description, '雨の教室');
  assert.equal(page.panels[1].background_description, '雨の教室');
  assert.deepEqual(page.panels.map((item) => item.id), [1, 2, 3]);
  assert.equal(page.panels[2].bubbles[0].text, '後続');
});

test('ヨコ分割は斜め辺を多角形のまま残し、上下間隔を空ける', () => {
  const page = pageWith([
    panel(1, { type: 'polygon', points: [[10, 10], [200, 20], [190, 170], [20, 160]] }, {
      bubbles: [
        { text: '上', bbox: { x: 145, y: 35, w: 30, h: 30 } },
        { text: '下', bbox: { x: 35, y: 120, w: 30, h: 30 } },
      ],
    }),
  ]);

  assert.deepEqual(splitPanel(page, 0, 'horizontal', { rowGapMm: 8, columnGapMm: 3 }), [0, 1]);
  assert.equal(page.panels[0].shape.type, 'polygon');
  assert.equal(page.panels[1].shape.type, 'polygon');
  assert.equal(Math.max(...page.panels[0].shape.points.map(([, y]) => y)), 86);
  assert.equal(Math.min(...page.panels[1].shape.points.map(([, y]) => y)), 94);
  assert.deepEqual(page.panels[0].bubbles.map((bubble) => bubble.text), ['上']);
  assert.deepEqual(page.panels[1].bubbles.map((bubble) => bubble.text), ['下']);
});

test('小さすぎるコマは分割せず元データを保つ', () => {
  const page = pageWith([panel(1, rect(10, 10, 12, 40), { bubbles: [{ text: '保持' }] })]);
  const before = structuredClone(page);
  assert.equal(splitPanel(page, 0, 'vertical', { rowGapMm: 5, columnGapMm: 4 }), null);
  assert.deepEqual(page, before);
});

test('分割線をまたぐ内容は両方へ複製し、同じ確認グループとして緑フラグを立てる', () => {
  const page = pageWith([panel(1, rect(10, 10, 190, 100), {
    figures: [{ name: 'またぐ人物', bbox: { x: 85, y: 20, w: 40, h: 70 } }],
    bubbles: [{ text: 'またぐセリフ', bbox: { x: 92, y: 25, w: 26, h: 40 } }],
    screen_text: [{ text: 'またぐ文字', bbox: { x: 95, y: 72, w: 20, h: 10 } }],
    assets: ['背景資料'],
  })]);

  splitPanel(page, 0, 'vertical', { rowGapMm: 5, columnGapMm: 4 });

  for (const key of ['figures', 'bubbles', 'screen_text']) {
    const first = page.panels[0][key][0];
    const second = page.panels[1][key][0];
    assert.equal(first.splitOverlap, true);
    assert.equal(second.splitOverlap, true);
    assert.equal(first.splitOverlapId, second.splitOverlapId);
  }
  assert.equal(page.panels[0].bg, 1);
  assert.equal(page.panels[1].bg, 1);
  assert.deepEqual(page.panels[0].assets, ['背景資料']);
  assert.deepEqual(page.panels[1].assets, ['背景資料']);
});

test('片方を削除した分割重複は残った側も通常表示へ戻す', () => {
  const page = pageWith([panel(1, rect(10, 10, 190, 100), {
    bubbles: [{ text: 'またぐ', bbox: { x: 92, y: 25, w: 26, h: 40 } }],
    assets: ['背景資料'],
  })]);
  const document = { manga: { pages: [page] } };
  splitPanel(page, 0, 'vertical', { rowGapMm: 5, columnGapMm: 4 });

  page.panels[0].bubbles.splice(0, 1);
  reconcileSplitOverlapFlags(document);

  assert.equal(page.panels[1].bubbles[0].splitOverlap, undefined);
  assert.equal(page.panels[1].bubbles[0].splitOverlapId, undefined);
});

test('分割後のフキダシ本文を片方だけ変更すると、両方を別物として重複表示を解除する', () => {
  const page = pageWith([panel(1, rect(10, 10, 190, 100), {
    bubbles: [{ text: '変更前', bbox: { x: 92, y: 25, w: 26, h: 40 } }],
  })]);
  const document = { manga: { pages: [page] } };
  splitPanel(page, 0, 'vertical', { rowGapMm: 5, columnGapMm: 4 });
  assert.equal(page.panels[0].bubbles[0].splitOverlap, true);
  assert.equal(page.panels[1].bubbles[0].splitOverlap, true);

  page.panels[1].bubbles[0].text = '変更後';
  reconcileSplitOverlapFlags(document);

  for (const child of page.panels) {
    assert.equal(child.bubbles[0].splitOverlap, undefined);
    assert.equal(child.bubbles[0].splitOverlapId, undefined);
  }
});

test('フキダシを別コマとページ前景の間で往復できる', () => {
  const page = pageWith([
    panel(1, rect(105, 10, 95, 80), { bubbles: [{ text: '移動する', bbox: { x: 140, y: 20, w: 30, h: 30 } }] }),
    panel(2, rect(10, 10, 90, 80), { bubbles: [] }),
  ]);

  assert.deepEqual(moveBubbleToOwner(page, 0, 0, 1), { owner: 1, index: 0 });
  assert.equal(page.panels[0].bubbles.length, 0);
  assert.equal(page.panels[1].bubbles[0].text, '移動する');
  assert.deepEqual(moveBubbleToOwner(page, 1, 0, 'page_overlay'), { owner: 'page_overlay', index: 0 });
  assert.equal(page.panels[1].bubbles.length, 0);
  assert.equal(page.page_overlay.bubbles[0].text, '移動する');
  assert.deepEqual(moveBubbleToOwner(page, 'page_overlay', 0, 0), { owner: 0, index: 0 });
  assert.equal(page.panels[0].bubbles[0].text, '移動する');
  assert.equal(page.page_overlay, undefined);
});

test('結合済みフキダシを別の所属へ動かすと元配列を再採番し結合を解除する', () => {
  const page = pageWith([
    panel(1, rect(105, 10, 95, 80), { bubbles: [
      { text: '親' },
      { text: '移動', join_to: 1 },
      { text: '残る', join_to: 2 },
    ] }),
    panel(2, rect(10, 10, 90, 80), { bubbles: [] }),
  ]);

  assert.deepEqual(moveBubbleToOwner(page, 0, 1, 1), { owner: 1, index: 0 });
  assert.equal(page.panels[0].bubbles[1].join_to, undefined);
  assert.equal(page.panels[1].bubbles[0].join_to, undefined);
});

test('コマ合体では後続コマ内のフキダシ結合番号を連結位置へずらす', () => {
  const page = pageWith([
    panel(1, rect(105, 10, 95, 80), { bubbles: [{ text: '右親' }, { text: '右子', join_to: 1 }] }),
    panel(2, rect(10, 10, 90, 80), { bubbles: [{ text: '左親' }, { text: '左子', join_to: 1 }] }),
  ]);
  assert.equal(mergeSelectedPanels(page, [0, 1]), 0);
  assert.equal(page.panels[0].bubbles[1].join_to, 1);
  assert.equal(page.panels[0].bubbles[3].join_to, 3);
});

test('コマ分割では同じ分割先に残る結合相手を新しい番号へ付け替える', () => {
  const page = pageWith([panel(1, rect(10, 10, 190, 100), { bubbles: [
    { text: '左だけ', bbox: { x: 25, y: 20, w: 20, h: 30 } },
    { text: '右親', bbox: { x: 145, y: 20, w: 20, h: 30 } },
    { text: '右子', join_to: 2, bbox: { x: 170, y: 20, w: 20, h: 30 } },
  ] })]);
  splitPanel(page, 0, 'vertical', { rowGapMm: 5, columnGapMm: 4 });
  assert.deepEqual(page.panels[0].bubbles.map(({ text, join_to }) => ({ text, join_to })), [
    { text: '右親', join_to: undefined },
    { text: '右子', join_to: 1 },
  ]);
  assert.equal(page.panels[1].bubbles[0].join_to, undefined);
});
