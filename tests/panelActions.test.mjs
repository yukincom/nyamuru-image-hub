import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyReconciledPanelActions,
  buildPanelActionSuggestionRequest,
} from '../src/lib/panelActions.ts';

function panelFixture() {
  return {
    id: 2,
    shape: { type: 'rect', x: 10, y: 10, w: 190, h: 100 },
    bg: 1,
    action: 'アキがユキを見て驚く。カメラは二人の正面。',
    figures: [
      { name: 'アキ', kind: 'person', refId: 'person-aki', size: 'bust-up', role: 'main' },
      { name: '机', kind: 'prop', refId: 'material-desk' },
      { name: 'ユキ', kind: 'person', refId: 'person-yuki', size: 'waist-up', role: 'sub' },
    ],
    bubbles: [
      { speaker: 'アキ', text: '本当に？', monologue: true, shape: 'thought' },
      { speaker: 'ユキ', text: 'うん' },
    ],
  };
}

function mangaFixture() {
  return {
    schema_name: 'Nyamuru Data Model',
    schema_version: 10.31,
    meta: {
      series: 'ふたりの放課後', title: '秘密の相談', episode_number: '第3話', episode_id: 'episode-3',
      author: '', format: 'モノクロ漫画', page_count: 2, reading_direction: 'right-to-left', text_orientation: 'vertical',
      font: 'アンチック体', bubble_line_width_mm: 0.5, panel_frame_width_mm: 1, panel_gutter_row_mm: 5, panel_gutter_column_mm: 3, style_notes: [],
    },
    layout_spec: '',
    setting: { location: '放課後の教室', time: '夕方', weather: '雨', situation: 'アキがユキへ秘密を打ち明け、二人の関係が変わり始める。' },
    characters: [
      { localId: 'person-aki', name: 'アキ', role: '慎重で感情を表に出しにくい主人公' },
      { localId: 'person-yuki', name: 'ユキ', role: '快活だが友人の変化には敏感' },
      { localId: 'person-mio', name: 'ミオ', role: '二人の共通の友人' },
    ],
    materials: [],
    pages: [
      { page: 1, canvas: { w: 210, h: 297, unit: 'mm' }, panels: [
        { id: 1, shape: { type: 'rect', x: 10, y: 10, w: 190, h: 70 }, bg: 1, action: 'アキが言葉を探す。', figures: [{ name: 'アキ', kind: 'person' }], bubbles: [{ speaker: 'アキ', text: 'あのさ' }] },
        panelFixture(),
      ] },
      { page: 2, canvas: { w: 210, h: 297, unit: 'mm' }, panels: [
        { id: 1, shape: { type: 'rect', x: 10, y: 10, w: 190, h: 70 }, bg: 1, action: 'ユキが笑う。', figures: [{ name: 'ユキ', kind: 'person' }], bubbles: [{ speaker: 'ユキ', text: 'よかった' }] },
      ] },
    ],
  };
}

test('人物アクション依頼は作品文脈・全人物像・前後コマ・吹き出し形状を含む', () => {
  const request = buildPanelActionSuggestionRequest(mangaFixture(), 0, 1);

  assert.deepEqual(request.figures.map(({ id, name }) => ({ id, name })), [
    { id: 'figure-0', name: 'アキ' },
    { id: 'figure-2', name: 'ユキ' },
  ]);
  assert.equal(request.figures[0].description, '慎重で感情を表に出しにくい主人公');
  assert.deepEqual(request.work, {
    seriesTitle: 'ふたりの放課後', subtitle: '秘密の相談', episodeNumber: '第3話',
    synopsis: 'アキがユキへ秘密を打ち明け、二人の関係が変わり始める。',
    location: '放課後の教室', time: '夕方', weather: '雨',
  });
  assert.deepEqual(request.characters.map(({ name }) => name), ['アキ', 'ユキ', 'ミオ']);
  assert.equal(request.previousPanel.panelAction, 'アキが言葉を探す。');
  assert.equal(request.currentPanel.pageNumber, 1);
  assert.deepEqual(request.currentPanel.dialogues[0], {
    speaker: 'アキ', text: '本当に？', monologue: true, offscreen: false, shape: 'thought',
  });
  assert.equal(request.nextPanel.pageNumber, 2);
  assert.equal(request.nextPanel.dialogues[0].shape, 'normal');
});

test('再注入は重複した原文を完成文へ置き換え、確かな描写と怪訝の表現を保持する', () => {
  const panel = panelFixture();
  panel.figures[0].action = '顔は画像右向きの横顔。開眼で口がわずかに開いている。困惑や驚きの可能性あり。\n顔は右向きの横顔。\n目を見開き、口をわずかに開けて困惑した表情を見せる。';
  panel.action = 'アキが怪訝な表情をする。';
  panel.figures[2].action = '黙って立つ。';
  panel.background_description = '利用者が決めた背景';
  const original = structuredClone(panel);
  const complete = '顔は画像右向きの横顔。目は開き、口はわずかに開いている。怪訝な表情。';
  const actions = [{ id: 'figure-0', action: complete }, { id: 'figure-2', action: '' }];
  assert.equal(applyReconciledPanelActions(panel, actions), 1);
  assert.equal(panel.figures[0].action, complete);
  assert.equal(applyReconciledPanelActions(panel, actions), 0);
  const expected = structuredClone(original);
  expected.figures[0].action = complete;
  assert.deepEqual(panel, expected, '背景・ト書き・形・座標・他人・小道具は変えない');
});

test('欠落・重複・対象外・長すぎる回答は一人も変更せずに拒否する', () => {
  for (const tail of [[], [{ id: 'figure-0', action: '笑う。' }], [{ id: 'figure-1', action: '小道具' }], [{ id: 'figure-99', action: '知らない人' }], [{ id: 'figure-2', action: 'あ'.repeat(4001) }]]) {
    const panel = panelFixture();
    panel.figures[0].action = '元の動作。';
    const before = structuredClone(panel);
    assert.throws(() => applyReconciledPanelActions(panel, [{ id: 'figure-0', action: '窓を指す。' }, ...tail]));
    assert.deepEqual(panel, before);
  }
});

test('完成文は500文字を超えても保持し、空の回答で原文を消さない', () => {
  const panel = panelFixture();
  panel.figures[0].action = '原文。';
  const complete = '描写。'.repeat(200);
  assert.equal(applyReconciledPanelActions(panel, [{ id: 'figure-0', action: '' }, { id: 'figure-2', action: complete }]), 1);
  assert.equal(panel.figures[0].action, '原文。');
  assert.equal(panel.figures[2].action, complete);
});
