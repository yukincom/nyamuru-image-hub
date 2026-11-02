import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  analyzeCharacterReferenceSetWithLocalVlm,
  attachDetectedFiguresToPage,
  attachRecognizedTextToPage,
  beginSeriesCatalogDraft,
  chooseEpisodeWorkspaceSource,
  commitSeriesCatalogDraft,
  chooseSeriesDirectory,
  chooseSeriesReferenceText,
  DETECTED_FIGURE_NAME,
  discardUnsavedSeriesCatalog,
  discardSeriesCatalogDraft,
  groupRecognizedTextLines,
  generatePanelDraftWithComfyUI,
  getSeriesCharacterTextStatus,
  isLoopbackBridgeUrl,
  linkSeriesCharacterText,
  listPanelDraftAttempts,
  listSeriesCatalogs,
  loadCharacterReferenceImage,
  normalizeLayoutRecognition as normalizeCurrentLayoutRecognition,
  prepareEpisodeWorkspace,
  reconcilePanelDraftAttempt,
  recognizedTextOwnerKey,
  reviewPanelDraftAttempt,
  selectEpisodeWorkspace,
  suggestEpisodeWorkspaceText,
  suggestPanelFigureActions,
  openMacScanner,
  saveSeriesCatalog,
  saveSourceCoverageReport,
  restoreSeriesCharacterText,
  syncSeriesCharacterText,
} from '../src/lib/localBridge.ts';

test('人物アクションは完成文の通信形式と全対象IDを確認し、古い補足応答や部分回答を拒否する', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  const request = {
    work: {}, characters: [], previousPanel: null, nextPanel: null,
    currentPanel: { pageNumber: 1, panelId: 2, panelAction: 'アキは怪訝な表情。', people: ['アキ', 'ユキ'], dialogues: [{ speaker: 'アキ', text: '本当に？' }] },
    figures: [{ id: 'figure-0', name: 'アキ', currentAction: '顔は右向き。困惑や驚きの可能性あり。' }, { id: 'figure-2', name: 'ユキ', currentAction: '立っている。' }],
  };
  const complete = '顔は右向き。怪訝な表情。' + '姿勢の描写。'.repeat(100);
  const actions = [{ id: 'figure-0', action: complete }, { id: 'figure-2', action: '' }];
  let response = { action_mode: 'reconcile', actions, model: 'test-model' };
  let sent;
  globalThis.fetch = async (url, options) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3, ok: true };
    if (String(url).endsWith('/api/health')) return Response.json(common);
    assert.ok(String(url).endsWith('/api/panel-actions/suggest'));
    sent = JSON.parse(options.body);
    return Response.json({ ...common, ...response });
  };
  try {
    assert.deepEqual(await suggestPanelFigureActions(request), { actions, model: 'test-model' });
    assert.equal(sent.action_mode, 'reconcile');
    assert.equal(sent.current_panel.panel_action, request.currentPanel.panelAction);
    assert.equal(sent.current_panel.dialogues[0].text, '本当に？');
    assert.equal(sent.figures[0].current_action, request.figures[0].currentAction);
    response = { actions };
    await assert.rejects(() => suggestPanelFigureActions(request), /応答形式が一致/);
    for (const invalid of [actions.slice(0, 1), [...actions, { id: 'figure-99', action: '追加人物' }], [actions[0], actions[0]], [null, actions[1]], [{ id: 'figure-0', action: 3 }, actions[1]], [{ id: 'figure-0', action: 'a'.repeat(4001) }, actions[1]]]) {
      response = { action_mode: 'reconcile', actions: invalid };
      await assert.rejects(() => suggestPanelFigureActions(request));
    }
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('エピソード資料選択はworkspace内相対pathと検証済みidentityを保持する', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  const sha = 'a'.repeat(64);
  globalThis.fetch = async (url) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ...common,
      ok: true,
      cancelled: false,
      filename: 'episode.md',
      text: '# あらすじ\n本文',
      relative_path: 'origin_data/episode.md',
      byte_size: 24,
      sha256: sha,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await chooseEpisodeWorkspaceSource('token-one');
    assert.equal(result.relativePath, 'origin_data/episode.md');
    assert.equal(result.byteSize, 24);
    assert.equal(result.sha256, sha);
    assert.equal(result.file.name, 'episode.md');
    assert.equal(await result.file.text(), '# あらすじ\n本文');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('coverage report保存clientはcaller pathを送らずstrictな相対path応答だけを受ける', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  const sha = 'b'.repeat(64);
  let requestBody;
  globalThis.fetch = async (url, options) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      ...common,
      ok: true,
      relative_path: `name_data/coverage/source-coverage-${sha}.json`,
      sha256: sha,
      byte_size: 1200,
      created: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const report = { schema_name: 'nyamuru-source-coverage' };
    const result = await saveSourceCoverageReport('token-one', 'episode-one', report);
    assert.deepEqual(result, {
      relativePath: `name_data/coverage/source-coverage-${sha}.json`,
      sha256: sha,
      byteSize: 1200,
      created: true,
    });
    assert.deepEqual(Object.keys(requestBody).sort(), ['episode_id', 'report', 'workspace_token']);
    assert.equal(requestBody.episode_id, 'episode-one');
    assert.deepEqual(requestBody.report, report);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('人物資料の一括解析は安定特徴と画像ごとの分類を受け取る', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  const first = `image-${'a'.repeat(64)}`;
  const second = `image-${'b'.repeat(64)}`;
  let requestBody;
  globalThis.fetch = async (url, options) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      ...common,
      recognition: { hair: { observed: ['顎までの黒いボブ'], inferred: [] } },
      reference_views: [{ asset_id: first, view: 'front', confidence: 'high' }, { asset_id: second, view: 'expression', confidence: 'medium' }],
      analyzer: { provider: 'local', runtime: 'mlx-vlm', model: 'local-qwen', prompt_version: 'character-reference-v17', analyzed_at: '2026-09-01T00:00:00Z' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await analyzeCharacterReferenceSetWithLocalVlm('series-one', 'character-one', [first, second], 'グレー');
    assert.deepEqual(result.recognition.hair.observed, ['顎までの黒いボブ']);
    assert.deepEqual(result.referenceViews, [
      { assetId: first, referenceView: 'front', confidence: 'high' },
      { assetId: second, referenceView: 'expression', confidence: 'medium' },
    ]);
    assert.deepEqual(requestBody.asset_ids, [first, second]);
    assert.equal(requestBody.vlm_model, 'lmstudio-community/Qwen3-VL-8B-Instruct-MLX-4bit');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

function validBox(entry) {
  if (!Array.isArray(entry) || entry.length !== 4) return null;
  const values = entry.map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [x, y, w, h] = values;
  const left = Math.max(0, Math.min(1, x));
  const top = Math.max(0, Math.min(1, y));
  const right = Math.max(0, Math.min(1, x + w));
  const bottom = Math.max(0, Math.min(1, y + h));
  return right - left >= 0.005 && bottom - top >= 0.005 ? values : null;
}

function shapeBounds(shape) {
  if (shape?.type === 'rect') return validBox([shape.x, shape.y, shape.w, shape.h]);
  if (shape?.type !== 'polygon' || !Array.isArray(shape.points) || shape.points.length < 3) return null;
  const points = shape.points.filter((point) => Array.isArray(point) && point.length === 2).map(([x, y]) => [Number(x), Number(y)]);
  if (points.length < 3 || points.some((point) => point.some((value) => !Number.isFinite(value)))) return null;
  const left = Math.min(...points.map(([x]) => x));
  const top = Math.min(...points.map(([, y]) => y));
  const right = Math.max(...points.map(([x]) => x));
  const bottom = Math.max(...points.map(([, y]) => y));
  return validBox([left, top, right - left, bottom - top]);
}

// 既存の幾何fixtureをbridge v3の正規形式へ載せるためのテスト専用アダプター。
// 本番コードは旧panel_boxes/panel_shapes形式を受理しない。
function normalizeLayoutRecognition(payload = {}, gutters) {
  const { panel_boxes: panelBoxes = [], panel_shapes: panelShapes = [], ...rest } = payload;
  const sourceEntries = Array.isArray(panelShapes) && panelShapes.length ? panelShapes : panelBoxes;
  const panels = sourceEntries.flatMap((entry, index) => {
    const shape = Array.isArray(panelShapes) && panelShapes.length
      ? entry
      : validBox(entry) ? { type: 'rect', x: entry[0], y: entry[1], w: entry[2], h: entry[3] } : null;
    const detectorBox = validBox(Array.isArray(panelBoxes) ? panelBoxes[index] : null) ?? shapeBounds(shape);
    if (!shape || !detectorBox) return [];
    return [{ id: `panel-${String(index + 1).padStart(3, '0')}`, detector_box: detectorBox, shape }];
  });
  return normalizeCurrentLayoutRecognition({ ...rest, layout_protocol_version: 3, panels }, gutters);
}

function ownerPanelsFor(recognition, page) {
  return new Map(recognition.detectedPanelIds.map((id, index) => [id, page.panels[index]]));
}

test('検出した正規化座標をA4紙面上の編集可能な矩形へ変換する', () => {
  const result = normalizeLayoutRecognition({
    panel_boxes: [
      [0.5, 0.1, 0.4, 0.2],
      [-0.1, 0.2, 0.2, 0.3],
      [0.1, 0.1, -0.05, 0.1],
      ['bad', 0, 1, 1],
    ],
    reason: '検出した矩形を直接使用します',
  });
  assert.deepEqual(result.detectedPanels, [
    { type: 'rect', x: 105, y: 29.7, w: 84, h: 59.4 },
    { type: 'rect', x: 15, y: 59.4, w: 8, h: 89.1 },
  ]);
  assert.equal(result.detectedPanelCount, 2);
  assert.deepEqual(result.detectedPanelIds, ['panel-001', 'panel-002']);
  assert.match(result.reason, /^検出した矩形を直接使用します。? 内枠内へ収め/);
});

test('RT-DETRが分けた斜め枠線を多角形のまま保ち、OCRが無くても捨てない', () => {
  const result = normalizeLayoutRecognition({
    panel_shapes: [
      { type: 'polygon', points: [[0.42, 0], [1, 0], [1, 0.45], [0.66, 0.45]] },
      { type: 'polygon', points: [[0, 0], [0.42, 0], [0.66, 0.45], [0, 0.45]] },
      { type: 'polygon', points: [[0, 0.45], [1, 0.45], [1, 0.69], [0, 0.69]] },
      { type: 'polygon', points: [[0, 0.69], [1, 0.69], [1, 0.97], [0, 0.97]] },
    ],
    ocr: { lines: [{ id: 'only-one', text: '一箇所だけ', bbox: [0.7, 0.1, 0.1, 0.1] }] },
  }, { rowGapMm: 5, columnGapMm: 3 });

  assert.equal(result.detectedPanelCount, 4);
  const [topRight, topLeft, middle, bottom] = result.detectedPanels;
  assert.equal(topRight.type, 'polygon');
  assert.equal(topLeft.type, 'polygon');
  assert.equal(middle.type, 'rect');
  assert.equal(bottom.type, 'rect');
  assert.ok(Math.abs(topRight.points[0][0] - topLeft.points[1][0] - 3) < 0.11);
  assert.ok(Math.abs(topRight.points[3][0] - topLeft.points[2][0] - 3) < 0.11);
  assert.ok(Math.abs(middle.y - topRight.points[3][1] - 5) < 0.11);
  assert.ok(Math.abs(bottom.y - (middle.y + middle.h) - 5) < 0.11);
});

test('5°以内の傾きだけをrectへ補正し、それを超える斜め辺はpolygonに残す', () => {
  const fourDegrees = normalizeLayoutRecognition({
    panel_shapes: [{ type: 'polygon', points: [[0.10, 0.10], [0.40, 0.10], [0.43, 0.40], [0.13, 0.40]] }],
  });
  const sixDegrees = normalizeLayoutRecognition({
    panel_shapes: [{ type: 'polygon', points: [[0.10, 0.10], [0.40, 0.10], [0.445, 0.40], [0.145, 0.40]] }],
  });

  assert.equal(fourDegrees.detectedPanels[0].type, 'rect');
  assert.equal(sixDegrees.detectedPanels[0].type, 'polygon');
});

test('縦長の斜めコマに隣接する上下2コマを同じ行へ潰さない', () => {
  const result = normalizeLayoutRecognition({
    panel_shapes: [
      { type: 'polygon', points: [[0.55, 0.55], [0.95, 0.55], [0.95, 0.95], [0.65, 0.95]] },
      { type: 'polygon', points: [[0.05, 0.55], [0.55, 0.55], [0.60, 0.73], [0.05, 0.73]] },
      { type: 'polygon', points: [[0.05, 0.76], [0.61, 0.76], [0.65, 0.95], [0.05, 0.95]] },
    ],
  }, { rowGapMm: 5, columnGapMm: 3 });

  assert.equal(result.detectedPanelCount, 3);
  const [rightTall, leftUpper, leftLower] = result.detectedPanels;
  assert.equal(rightTall.type, 'polygon');
  assert.equal(leftUpper.type, 'polygon');
  assert.equal(leftLower.type, 'polygon');
  assert.ok(leftUpper.points[2][1] < leftLower.points[1][1], '左側2コマは上下分割のまま');
  assert.ok(Math.abs(leftLower.points[1][1] - leftUpper.points[2][1] - 5) < 0.11, '上下間隔は5mm');
  assert.ok(rightTall.points[0][1] < leftUpper.points[2][1], '右の縦長コマは上段を覆う');
  assert.ok(rightTall.points[3][1] > leftLower.points[1][1], '右の縦長コマは下段を覆う');
  assert.ok(Math.abs(rightTall.points[0][0] - leftUpper.points[1][0] - 3) < 0.11, '上側の斜め境界は左右3mm');
  assert.ok(Math.abs(rightTall.points[3][0] - leftLower.points[2][0] - 3) < 0.11, '下側の斜め境界は左右3mm');
});

test('コマ未検出時は安全な空配列と案内文を返す', () => {
  const result = normalizeLayoutRecognition({});
  assert.deepEqual(result.detectedPanels, []);
  assert.equal(result.detectedPanelCount, 0);
  assert.match(result.reason, /特定できません/);
});

test('金城07型の複数コマをまたぐ人物をページ前景として保持する', () => {
  const recognition = normalizeLayoutRecognition({
    panel_boxes: [
      [0.05, 0.05, 0.90, 0.44],
      [0.05, 0.51, 0.65, 0.44],
    ],
    people: {
      regions: [
        { id: 'foreground-body', source: 'body', bbox: [0.44, 0.26, 0.56, 0.61], confidence: 0.38 },
        { id: 'top-panel-body', source: 'body', bbox: [0.27, 0.07, 0.48, 0.43], confidence: 0.30 },
        { id: 'lower-panel-body', source: 'body', bbox: [0.20, 0.56, 0.37, 0.42], confidence: 0.53 },
      ],
    },
  });
  const foreground = recognition.detectedFigures.find((region) => region.id === 'foreground-body');
  const topLocal = recognition.detectedFigures.find((region) => region.id === 'top-panel-body');
  const local = recognition.detectedFigures.find((region) => region.id === 'lower-panel-body');
  assert.equal(foreground?.pageOverlay, true);
  assert.equal(foreground?.sourcePanelId, undefined);
  assert.ok(local?.sourcePanelId);
  assert.ok(topLocal?.sourcePanelId);
  assert.equal(local?.pageOverlay, undefined);
  assert.equal(topLocal?.pageOverlay, undefined);

  const page = {
    page: 1,
    canvas: { w: 210, h: 297, unit: 'mm' },
    panels: recognition.detectedPanels.map((shape, index) => ({ id: index + 1, shape, bg: 0, bubbles: [], action: null })),
  };
  const attached = attachDetectedFiguresToPage(page, recognition.detectedFigures, undefined, recognition.sourceFrame, ownerPanelsFor(recognition, page));
  assert.equal(attached.added, 3);
  assert.equal(page.page_overlay.frame, false);
  assert.equal(page.page_overlay.layer, 'above_panel_frames');
  assert.equal(page.page_overlay.figures.length, 1);
  assert.equal(page.page_overlay.figures[0].name, DETECTED_FIGURE_NAME);
  assert.equal(page.panels.reduce((count, panel) => count + (panel.figures?.length ?? 0), 0), 2);
});

test('金城05型の小コマに完全包含された人物をページ前景へ誤昇格させない', () => {
  const recognition = normalizeCurrentLayoutRecognition({
    layout_protocol_version: 3,
    panels: [
      { id: 'panel-001', detector_box: [0.482441, 0.054645, 0.428140, 0.906881], shape: { type: 'polygon', points: [[0.482441, 0.054645], [0.910580, 0.054645], [0.910580, 0.961526], [0.482441, 0.961526]] } },
      { id: 'panel-002', detector_box: [0.085303, 0.050096, 0.387032, 0.555154], shape: { type: 'polygon', points: [[0.083087, 0.050096], [0.492177, 0.050096], [0.492177, 0.486682], [0.083087, 0.564487]] } },
      { id: 'panel-003', detector_box: [0.092876, 0.502370, 0.371544, 0.141094], shape: { type: 'polygon', points: [[0.083087, 0.564487], [0.492177, 0.486682], [0.492177, 0.659188], [0.083087, 0.592364]] } },
      { id: 'panel-004', detector_box: [0.083087, 0.576056, 0.409090, 0.390086], shape: { type: 'polygon', points: [[0.083087, 0.592364], [0.492177, 0.659188], [0.492177, 0.966142], [0.083087, 0.966142]] } },
    ],
    people: {
      regions: [
        { id: 'small-panel-body', source: 'body', bbox: [0.221359, 0.510240, 0.199723, 0.117399], confidence: 0.6925 },
      ],
    },
  });

  const figure = recognition.detectedFigures[0];
  assert.equal(figure?.pageOverlay, undefined);
  assert.equal(figure?.sourcePanelId, 'panel-003');
});

test('明示したページ前景フキダシを特定コマへ吸着させず保持する', () => {
  const page = {
    page: 1,
    canvas: { w: 210, h: 297, unit: 'mm' },
    panels: [
      { id: 1, shape: { type: 'rect', x: 10, y: 10, w: 190, h: 130 }, bg: 0, bubbles: [], action: null },
      { id: 2, shape: { type: 'rect', x: 10, y: 145, w: 190, h: 142 }, bg: 0, bubbles: [], action: null },
    ],
  };
  const line = {
    id: 'crossing-text', groupId: 'crossing-bubble', pageOverlay: true,
    text: 'コマをまたぐ声', bbox: { x: 0.30, y: 0.42, w: 0.20, h: 0.20 },
    confidence: 0.8, vertical: true, source: 'rtdetr-text', needsReview: true,
  };
  assert.equal(recognizedTextOwnerKey(line), 'page-overlay/crossing-bubble');
  const attached = attachRecognizedTextToPage(page, [line]);
  assert.deepEqual(attached, { added: 1, needsReview: 1 });
  assert.equal(page.page_overlay.bubbles[0].text, 'コマをまたぐ声');
  assert.equal(page.panels.reduce((count, panel) => count + panel.bubbles.length, 0), 0);
});

test('旧bridgeや別アプリの応答を黙って矩形へフォールバックしない', () => {
  assert.throws(
    () => normalizeCurrentLayoutRecognition({ panel_boxes: [[0, 0, 1, 1]] }),
    /bridgeが古いか別のアプリ/,
  );
});

test('bridge v3のコマID重複とshape欠落を拒否する', () => {
  assert.throws(() => normalizeCurrentLayoutRecognition({
    layout_protocol_version: 3,
    panels: [
      { id: 'panel-001', detector_box: [0, 0, 0.5, 1], shape: { type: 'rect', x: 0, y: 0, w: 0.5, h: 1 } },
      { id: 'panel-001', detector_box: [0.5, 0, 0.5, 1], shape: { type: 'rect', x: 0.5, y: 0, w: 0.5, h: 1 } },
    ],
  }), /IDまたは検出枠/);
  assert.throws(() => normalizeCurrentLayoutRecognition({
    layout_protocol_version: 3,
    panels: [{ id: 'panel-001', detector_box: [0, 0, 1, 1] }],
  }), /編集形状がありません/);
});

// 模擬検出で体に付随する顔だけ原稿座標に残し、二重に人物を作らない。OCR・コマの所属も保持する。
test('OCR候補と人物領域を安全に正規化する', () => {
  const result = normalizeLayoutRecognition({
    panel_boxes: [[0.05, 0.04, 0.9, 0.42], [0.05, 0.5, 0.9, 0.44]],
    structure: {
      engine: 'RT-DETR',
      excluded_as_text_count: 2,
      excluded_as_face_count: 1,
      excluded_as_body_count: 0,
      excluded_as_header_count: 2,
      text_region_count: 5,
      face_region_count: 2,
      body_region_count: 3,
    },
    people: { engine: 'RT-DETR', regions: [
      { source: 'body', bbox: [0.18, 0.12, 0.2, 0.3], face_bbox: [0.25, 0.125, 0.125, 0.125] },
      { source: 'face', bbox: [0.22, 0.15, 0.08, 0.08] },
      { source: 'face', bbox: [0.7, 0.62, 0.1, 0.1] },
    ] },
    ocr: { engine: 'Baberu OCR', lines: [
      {
        id: 'line-1', text: 'こんにちは', bbox: [0.6, 0.1, 0.2, 0.12], confidence: 1.4,
        vertical: true, source: 'rtdetr-text', needs_review: true, group_id: 'block-1',
      },
      {
        id: 'line-2', text: '次のコマ', bbox: [0.6, 0.62, 0.2, 0.12], confidence: 0.8,
        vertical: true, source: 'rtdetr-text', needs_review: false, group_id: 'block-2',
      },
      {
        id: 'line-3', text: '', bbox: [0.2, 0.7, 0.1, 0.08], confidence: 0.6,
        vertical: true, source: 'rtdetr-text', needs_review: true, group_id: 'block-3', unreadable: true,
      },
    ] },
  });
  assert.equal(result.detectedPanelCount, 2);
  assert.equal(result.structureEngine, 'RT-DETR');
  assert.equal(result.excludedNonPanelCount, 5);
  assert.equal(result.detectedTextRegionCount, 5);
  assert.equal(result.detectedFaceRegionCount, 2);
  assert.equal(result.detectedBodyRegionCount, 3);
  assert.deepEqual(result.detectedFigures, [
    { id: 'figure-001', source: 'body', bbox: { x: 0.18, y: 0.12, w: 0.2, h: 0.3 }, faceBBox: { x: 0.25, y: 0.125, w: 0.125, h: 0.125 }, sourcePanelId: 'panel-001' },
    { id: 'figure-002', source: 'face', bbox: { x: 0.7, y: 0.62, w: 0.1, h: 0.1 }, sourcePanelId: 'panel-002' },
  ]);
  assert.equal(result.ocrLines[0].text, 'こんにちは');
  assert.equal(result.ocrLines[0].confidence, 1);
  assert.equal(result.ocrLines[0].groupId, 'block-1');
  assert.equal(result.ocrLines[2].unreadable, true);
});

test('分割された小コマを覆う検出アーティファクトだけを形状で除外する', () => {
  const result = normalizeLayoutRecognition({
    panel_boxes: [
      [0, 0, 1, 0.38],
      [0.58, 0.30, 0.42, 0.35],
      [0, 0.29, 1, 0.38],
      [0, 0.34, 0.58, 0.34],
      [0.58, 0.65, 0.42, 0.35],
      [0, 0.64, 1, 0.36],
      [0, 0.66, 0.62, 0.34],
    ],
    ocr: { lines: [
      { id: 'top', text: '上', bbox: [0.9, 0.08, 0.04, 0.12] },
      { id: 'middle-right', text: '右中', bbox: [0.8, 0.42, 0.05, 0.12] },
      { id: 'middle-left', text: '左中', bbox: [0.2, 0.44, 0.05, 0.12] },
      { id: 'bottom-right', text: '右下', bbox: [0.8, 0.76, 0.05, 0.12] },
      { id: 'bottom-left', text: '左下', bbox: [0.2, 0.76, 0.05, 0.12] },
    ] },
  });

  assert.equal(result.detectedPanelCount, 5);
  assert.match(result.reason, /候補を2個除外/);
  for (let index = 0; index < result.detectedPanels.length; index += 1) {
    const first = result.detectedPanels[index];
    assert.equal(first.type, 'rect');
    for (let otherIndex = index + 1; otherIndex < result.detectedPanels.length; otherIndex += 1) {
      const second = result.detectedPanels[otherIndex];
      assert.equal(second.type, 'rect');
      const horizontalOverlap = Math.max(0, Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x));
      const verticalOverlap = Math.max(0, Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y));
      const horizontalGap = Math.max(first.x, second.x) - Math.min(first.x + first.w, second.x + second.w);
      const verticalGap = Math.max(first.y, second.y) - Math.min(first.y + first.h, second.y + second.h);
      if (horizontalOverlap > 0) assert.ok(verticalGap >= 4.9, `コマ${index + 1}と${otherIndex + 1}の上下間隔`);
      else if (verticalOverlap > 0) assert.ok(horizontalGap >= 2.9, `コマ${index + 1}と${otherIndex + 1}の左右間隔`);
      else assert.ok(horizontalGap >= 2.9 || verticalGap >= 4.9, `コマ${index + 1}と${otherIndex + 1}の間隔`);
    }
  }
});

test('文字がないコマもOCR結果に関係なく保持する', () => {
  const result = normalizeLayoutRecognition({
    panel_boxes: [
      [0.05, 0.04, 0.44, 0.25],
      [0.50, 0.04, 0.45, 0.25],
      [0.05, 0.31, 0.44, 0.25],
      [0.50, 0.31, 0.45, 0.25],
      [0.05, 0.58, 0.90, 0.36],
    ],
    ocr: { lines: [{ id: 'top-right', text: '右上だけ', bbox: [0.7, 0.1, 0.1, 0.1] }] },
  }, { rowGapMm: 5, columnGapMm: 3 });
  assert.equal(result.detectedPanelCount, 5);
});

test('検出コマを内枠内に収め、4mm以内の隣接辺を整列して左右3mm空ける', () => {
  const result = normalizeLayoutRecognition({
    panel_boxes: [
      [0.05, 0.04, 0.44, 0.25],
      [0.50, 0.05, 0.45, 0.24],
    ],
  });
  const [left, right] = result.detectedPanels;
  assert.equal(left.type, 'rect');
  assert.equal(right.type, 'rect');
  assert.equal(left.x, 15);
  assert.equal(right.x + right.w, 195);
  assert.equal(left.y, 14.5);
  assert.equal(right.y, 14.5);
  assert.ok(Math.abs(right.x - (left.x + left.w) - 3) < 0.11);
  for (const panel of result.detectedPanels) {
    assert.ok(panel.x >= 15 && panel.y >= 14.5);
    assert.ok(panel.x + panel.w <= 195 && panel.y + panel.h <= 282.5);
  }
});

test('新規取り込みで指定した上下・左右の間隔を別々に適用する', () => {
  const result = normalizeLayoutRecognition({
    panel_boxes: [
      [0.05, 0.04, 0.44, 0.25],
      [0.50, 0.04, 0.45, 0.25],
      [0.05, 0.31, 0.44, 0.25],
      [0.50, 0.31, 0.45, 0.25],
    ],
  }, { rowGapMm: 7, columnGapMm: 2 });
  const [topLeft, topRight, bottomLeft, bottomRight] = result.detectedPanels;
  assert.ok(Math.abs(topRight.x - (topLeft.x + topLeft.w) - 2) < 0.11);
  assert.ok(Math.abs(bottomRight.x - (bottomLeft.x + bottomLeft.w) - 2) < 0.11);
  assert.ok(Math.abs(bottomLeft.y - (topLeft.y + topLeft.h) - 7) < 0.11);
  assert.ok(Math.abs(bottomRight.y - (topRight.y + topRight.h) - 7) < 0.11);
  assert.match(result.reason, /上下7mm・左右2mm/);
});

test('一つのコマに複数のコマが隣接しても共有境界を一直線に保つ', () => {
  const rowSplit = normalizeLayoutRecognition({
    panel_boxes: [
      [0.05, 0.04, 0.90, 0.25],
      [0.05, 0.29, 0.44, 0.25],
      [0.50, 0.29, 0.45, 0.25],
    ],
  }, { rowGapMm: 7, columnGapMm: 2 });
  const [upper, lowerLeft, lowerRight] = rowSplit.detectedPanels;
  assert.equal(lowerLeft.y, lowerRight.y);
  assert.equal(upper.y + upper.h, lowerLeft.y - 7);
  assert.equal(upper.y + upper.h, lowerRight.y - 7);

  const columnSplit = normalizeLayoutRecognition({
    panel_boxes: [
      [0.05, 0.04, 0.44, 0.25],
      [0.05, 0.31, 0.44, 0.25],
      [0.49, 0.04, 0.46, 0.52],
    ],
  }, { rowGapMm: 7, columnGapMm: 2 });
  const [leftUpper, leftLower, right] = columnSplit.detectedPanels;
  assert.equal(leftUpper.x + leftUpper.w, leftLower.x + leftLower.w);
  assert.equal(right.x, leftUpper.x + leftUpper.w + 2);
  assert.equal(right.x, leftLower.x + leftLower.w + 2);
});

test('同一テキストブロックの縦書き行を右から改行で一つにまとめる', () => {
  const grouped = groupRecognizedTextLines([
    { id: 'left', text: '左の行', bbox: { x: 0.65, y: 0.1, w: 0.05, h: 0.2 }, confidence: 0.7, vertical: true, source: 'baberu', needsReview: false, groupId: 'bubble-1' },
    { id: 'right', text: '右の行', bbox: { x: 0.75, y: 0.1, w: 0.05, h: 0.2 }, confidence: 0.8, vertical: true, source: 'baberu', needsReview: true, groupId: 'bubble-1' },
    { id: 'other', text: '別の吹き出し', bbox: { x: 0.1, y: 0.6, w: 0.2, h: 0.08 }, confidence: 0.9, vertical: false, source: 'baberu', needsReview: false, groupId: 'bubble-2' },
  ]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].text, '右の行\n左の行');
  assert.equal(grouped[0].bbox.x, 0.65);
  assert.equal(grouped[0].bbox.y, 0.1);
  assert.ok(Math.abs(grouped[0].bbox.w - 0.15) < 1e-9);
  assert.ok(Math.abs(grouped[0].bbox.h - 0.2) < 1e-9);
  assert.equal(grouped[0].needsReview, true);
});

test('同じOCRグループ名でも所属コマが異なる行は別フキダシに保つ', () => {
  const grouped = groupRecognizedTextLines([
    { id: 'p1', text: '一コマ目', bbox: { x: 0.7, y: 0.1, w: 0.1, h: 0.2 }, confidence: 0.8, vertical: true, source: 'baberu', needsReview: false, groupId: 'shared', sourcePanelId: 'panel-001' },
    { id: 'p2', text: '二コマ目', bbox: { x: 0.2, y: 0.1, w: 0.1, h: 0.2 }, confidence: 0.8, vertical: true, source: 'baberu', needsReview: false, groupId: 'shared', sourcePanelId: 'panel-002' },
  ]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped.map((line) => line.sourcePanelId), ['panel-001', 'panel-002']);
});

test('重なるコマでは文字を最小の内側コマへ割り当てる', () => {
  const page = {
    page: 1,
    canvas: { w: 210, h: 297, unit: 'mm' },
    panels: [
      { id: 1, shape: { type: 'rect', x: 0, y: 0, w: 210, h: 297 }, bg: 0, bubbles: [], action: null },
      { id: 2, shape: { type: 'rect', x: 110, y: 20, w: 80, h: 100 }, bg: 0, bubbles: [], action: null },
    ],
  };
  attachRecognizedTextToPage(page, [{
    id: 'inside-small', text: '内側', bbox: { x: 0.65, y: 0.12, w: 0.1, h: 0.1 },
    confidence: 0.8, vertical: true, source: 'baberu', needsReview: false,
  }]);
  assert.equal(page.panels[0].bubbles.length, 0);
  assert.equal(page.panels[1].bubbles[0].text, '内側');
});

test('検出した身体と顔を所属コマの編集可能な人物あたりへ配置する', () => {
  const page = {
    page: 1,
    canvas: { w: 210, h: 297, unit: 'mm' },
    panels: [
      { id: 1, shape: { type: 'rect', x: 10, y: 10, w: 90, h: 277 }, bg: 0, bubbles: [], action: null },
      { id: 2, shape: { type: 'rect', x: 110, y: 10, w: 90, h: 277 }, bg: 0, bubbles: [], action: null },
    ],
  };
  const result = attachDetectedFiguresToPage(page, [
    { id: 'body-1', source: 'body', bbox: { x: 0.62, y: 0.12, w: 0.18, h: 0.5 } },
    { id: 'body-2', source: 'body', bbox: { x: 0.625, y: 0.125, w: 0.17, h: 0.49 } },
    { id: 'face-1', source: 'face', bbox: { x: 0.18, y: 0.2, w: 0.1, h: 0.1 } },
  ], new Map([['face-1', {
    schemaVersion: 1,
    sourceRegionId: 'page-1:face-1',
    assetId: 'analog-figure:page-1:face-1',
    sourceBBox: { x: 0.18, y: 0.2, w: 0.1, h: 0.1 },
    detectionSource: 'face',
    draft: true,
  }]]));
  assert.deepEqual(result, { added: 2 });
  assert.equal(page.panels[0].figures[0].name, DETECTED_FIGURE_NAME);
  assert.equal(page.panels[0].figures[0].size, 'face');
  assert.equal(page.panels[0].figures[0].analogImport.draft, true);
  assert.equal(page.panels[0].figures[0].analogImport.assetId, 'analog-figure:page-1:face-1');
  assert.equal(page.panels[1].figures[0].name, DETECTED_FIGURE_NAME);
  assert.ok(page.panels[1].figures[0].bbox.x >= 110);
});

test('認識文字を位置に対応するコマの編集可能なフキダシへ配置する', () => {
  const page = {
    page: 1,
    canvas: { w: 210, h: 297, unit: 'mm' },
    panels: [
      { id: 1, shape: { type: 'rect', x: 10, y: 10, w: 90, h: 277 }, bg: 0, bubbles: [], action: null },
      { id: 2, shape: { type: 'rect', x: 110, y: 10, w: 90, h: 277 }, bg: 0, bubbles: [], action: null },
    ],
  };
  const result = attachRecognizedTextToPage(page, [{
    id: 'line-1', text: '右のコマ', bbox: { x: 0.62, y: 0.1, w: 0.18, h: 0.12 },
    confidence: 0.7, vertical: true, source: 'baberu', needsReview: true,
  }]);
  assert.deepEqual(result, { added: 1, needsReview: 1 });
  assert.equal(page.panels[0].bubbles.length, 0);
  assert.equal(page.panels[1].bubbles[0].text, '右のコマ');
  assert.ok(page.panels[1].bubbles[0].bbox.x >= 110);
  assert.equal(page.panels[1].bubbles[0].anchor, undefined);
});

test('検出原稿の外枠を基準にコマ・人物・文字へ同じ座標変換を適用する', () => {
  const recognition = normalizeLayoutRecognition({
    panel_boxes: [[0.10, 0.10, 0.39, 0.80], [0.51, 0.10, 0.39, 0.80]],
    people: { regions: [{ id: 'right-person', source: 'body', bbox: [0.60, 0.20, 0.12, 0.30] }] },
    ocr: { lines: [{ id: 'right-text', text: '右', bbox: [0.75, 0.18, 0.08, 0.12], needs_review: false }] },
  }, { rowGapMm: 5, columnGapMm: 3 });
  assert.deepEqual(recognition.sourceFrame, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const page = {
    page: 1,
    canvas: { w: 210, h: 297, unit: 'mm' },
    panels: recognition.detectedPanels.map((shape, index) => ({ id: index + 1, shape, bg: 0, bubbles: [], action: null })),
  };
  const ownerPanels = ownerPanelsFor(recognition, page);
  attachDetectedFiguresToPage(page, recognition.detectedFigures, undefined, recognition.sourceFrame, ownerPanels);
  attachRecognizedTextToPage(page, recognition.ocrLines, undefined, recognition.sourceFrame, ownerPanels);
  assert.equal(page.panels[0].figures?.length ?? 0, 0);
  assert.equal(page.panels[0].bubbles.length, 0);
  assert.equal(page.panels[1].figures?.length, 1);
  assert.equal(page.panels[1].bubbles[0].text, '右');
});

test('scan02の中央境界を保ち「感覚がズレているんだ」を第4コマへ割り当てる', () => {
  const recognition = normalizeLayoutRecognition({
    panel_boxes: [
      [0.444639, 0.000483, 0.547622, 0.338850],
      [0.004444, 0.000322, 0.443318, 0.346306],
      [0.507218, 0.337756, 0.491523, 0.361161],
      [0.009596, 0.342872, 0.496636, 0.368600],
      [0.011927, 0.696028, 0.987910, 0.300983],
    ],
    // scan02の実レスポンス。中央段の枠線追跡だけが人物の線へ逸れ、
    // 正しいRT-DETR矩形より大幅に狭い／広い多角形を返していた。
    panel_shapes: [
      { type: 'polygon', points: [[0.439588, 0.000483], [0.992261, 0.000483], [0.992261, 0.346306], [0.439783, 0.346306]] },
      { type: 'polygon', points: [[0.004444, 0.000322], [0.439588, 0.000483], [0.439783, 0.346306], [0.004444, 0.346306]] },
      { type: 'polygon', points: [[0.297519, 0.337756], [0.998741, 0.337756], [0.998741, 0.711472], [0.321605, 0.711472]] },
      { type: 'polygon', points: [[0.009596, 0.337756], [0.297519, 0.337756], [0.321605, 0.711472], [0.009596, 0.711472]] },
      { type: 'polygon', points: [[0.011927, 0.696028], [0.999837, 0.696028], [0.999837, 0.997011], [0.011927, 0.997011]] },
    ],
    ocr: {
      lines: [{
        id: 'scan02-middle-left',
        text: '感覚がズレているんだ',
        bbox: [0.3590755, 0.3510681, 0.1335964, 0.108021],
        needs_review: false,
      }],
    },
  }, { rowGapMm: 5, columnGapMm: 3 });

  assert.equal(recognition.detectedPanels.length, 5);
  const middleRight = recognition.detectedPanels[2];
  const middleLeft = recognition.detectedPanels[3];
  assert.ok(middleRight.x > 105 && middleRight.x < 110);
  assert.ok(middleLeft.x + middleLeft.w > 102 && middleLeft.x + middleLeft.w < 107);
  assert.ok(Math.abs(middleRight.x - (middleLeft.x + middleLeft.w) - 3) < 0.11);

  const page = {
    page: 2,
    canvas: { w: 210, h: 297, unit: 'mm' },
    panels: recognition.detectedPanels.map((shape, index) => ({ id: index + 1, shape, bg: 0, bubbles: [], action: null })),
  };
  attachRecognizedTextToPage(page, recognition.ocrLines, undefined, recognition.sourceFrame, ownerPanelsFor(recognition, page));

  assert.equal(page.panels[2].bubbles.length, 0);
  assert.equal(page.panels[3].bubbles[0].text, '感覚がズレているんだ');
});

test('scan04の斜め境界で「だよね」を外接矩形ではなく第2コマへ割り当てる', () => {
  const recognition = normalizeLayoutRecognition({
    panel_boxes: [
      [0.419412, 0.000439, 0.579114, 0.450406],
      [0.005608, 0.001161, 0.657413, 0.449983],
      [0.007897, 0.451783, 0.992337, 0.234328],
      [0.002571, 0.685811, 0.997341, 0.286539],
    ],
    panel_shapes: [
      { type: 'polygon', points: [[0.427834, 0.000439], [0.998525, 0.000439], [0.998525, 0.451144], [0.660278, 0.451144]] },
      { type: 'polygon', points: [[0.005608, 0.000439], [0.427834, 0.000439], [0.660278, 0.451144], [0.005608, 0.451144]] },
      { type: 'polygon', points: [[0.007897, 0.451783], [1.000234, 0.451783], [1.000234, 0.686111], [0.007897, 0.686111]] },
      { type: 'polygon', points: [[0.002571, 0.685811], [0.999911, 0.685811], [0.999911, 0.972350], [0.002571, 0.972350]] },
    ],
    ocr: {
      lines: [{
        id: 'scan04-top-left',
        text: 'だよね！！',
        bbox: [0.5004029, 0.2994444, 0.0435133, 0.1505556],
        needs_review: false,
      }],
    },
  }, { rowGapMm: 5, columnGapMm: 3 });

  const page = {
    page: 4,
    canvas: { w: 210, h: 297, unit: 'mm' },
    panels: recognition.detectedPanels.map((shape, index) => ({ id: index + 1, shape, bg: 0, bubbles: [], action: null })),
  };
  attachRecognizedTextToPage(page, recognition.ocrLines, undefined, recognition.sourceFrame, ownerPanelsFor(recognition, page));

  assert.equal(page.panels[0].bubbles.length, 0);
  assert.equal(page.panels[1].bubbles[0].text, 'だよね！！');
});

test('scan04の検出揺れでも整形前の斜め境界で「だよね」の所属を固定する', () => {
  const recognition = normalizeLayoutRecognition({
    panel_boxes: [
      [0.421533, 0.000521, 0.576934, 0.450426],
      [0.004937, 0.00142, 0.657683, 0.45],
      [0.007334, 0.451704, 0.992786, 0.234548],
      [0.00254, 0.685728, 0.997077, 0.286347],
    ],
    panel_shapes: [
      { type: 'polygon', points: [[0.428167, 0.000521], [0.998467, 0.000521], [0.998467, 0.45142], [0.660511, 0.45142]] },
      { type: 'polygon', points: [[0.004937, 0.000521], [0.428167, 0.000521], [0.660511, 0.45142], [0.004937, 0.45142]] },
      { type: 'polygon', points: [[0.007334, 0.451704], [1.00012, 0.451704], [1.00012, 0.686252], [0.007334, 0.686252]] },
      { type: 'polygon', points: [[0.00254, 0.685728], [0.999617, 0.685728], [0.999617, 0.972075], [0.00254, 0.972075]] },
    ],
    ocr: {
      lines: [{
        id: 'scan04-top-left-current',
        text: 'だよね！！',
        bbox: [0.5005720824, 0.2990138067, 0.0429061785, 0.1510848126],
        needs_review: false,
      }],
    },
  }, { rowGapMm: 5, columnGapMm: 3 });

  assert.equal(recognition.ocrLines[0].sourcePanelId, 'panel-002');
  const page = {
    page: 4,
    canvas: { w: 210, h: 297, unit: 'mm' },
    panels: recognition.detectedPanels.map((shape, index) => ({ id: index + 1, shape, bg: 0, bubbles: [], action: null })),
  };
  attachRecognizedTextToPage(page, recognition.ocrLines, undefined, recognition.sourceFrame, ownerPanelsFor(recognition, page));
  assert.equal(page.panels[0].bubbles.length, 0);
  assert.equal(page.panels[1].bubbles[0].text, 'だよね！！');
});

test('Baberu候補と原字参照を位置に対応する編集可能なフキダシへ配置する', () => {
  const page = {
    page: 1,
    canvas: { w: 210, h: 297, unit: 'mm' },
    panels: [
      { id: 1, shape: { type: 'rect', x: 10, y: 10, w: 90, h: 277 }, bg: 0, bubbles: [], action: null },
      { id: 2, shape: { type: 'rect', x: 110, y: 10, w: 90, h: 277 }, bg: 0, bubbles: [], action: null },
    ],
  };
  const metadata = {
    schemaVersion: 1,
    sourceRegionId: 'page-1:bubble-1',
    assetId: 'analog-text:page-1:bubble-1',
    sourceBBox: { x: 0.62, y: 0.1, w: 0.18, h: 0.12 },
    detectionSource: 'rtdetr-text',
    recognitionEngine: 'Baberu OCR',
    confidence: 0.7,
    needsReview: true,
    levelAdjusted: true,
  };
  const result = attachRecognizedTextToPage(page, [{
    id: 'line-1', text: '右のコマ', bbox: metadata.sourceBBox,
    confidence: 0.7, vertical: true, source: 'rtdetr-text', needsReview: true, groupId: 'bubble-1',
  }], new Map([['bubble-1', metadata]]));
  assert.deepEqual(result, { added: 1, needsReview: 1 });
  assert.equal(page.panels[1].bubbles[0].analogTextImport.assetId, 'analog-text:page-1:bubble-1');
});

test('同じOCRグループ名を別コマで再利用しても原字参照を取り違えない', () => {
  const page = {
    page: 1,
    canvas: { w: 210, h: 297, unit: 'mm' },
    panels: [
      { id: 1, shape: { type: 'rect', x: 10, y: 10, w: 90, h: 277 }, bg: 0, bubbles: [], action: null },
      { id: 2, shape: { type: 'rect', x: 110, y: 10, w: 90, h: 277 }, bg: 0, bubbles: [], action: null },
    ],
  };
  const lines = [
    {
      id: 'line-left', groupId: 'shared', sourcePanelId: 'panel-001', text: '左',
      bbox: { x: 0.15, y: 0.1, w: 0.12, h: 0.12 }, confidence: 0.8,
      vertical: true, source: 'rtdetr-text', needsReview: false,
    },
    {
      id: 'line-right', groupId: 'shared', sourcePanelId: 'panel-002', text: '右',
      bbox: { x: 0.68, y: 0.1, w: 0.12, h: 0.12 }, confidence: 0.8,
      vertical: true, source: 'rtdetr-text', needsReview: false,
    },
  ];
  const leftKey = recognizedTextOwnerKey(lines[0]);
  const rightKey = recognizedTextOwnerKey(lines[1]);
  assert.equal(leftKey, 'panel-001/shared');
  assert.equal(rightKey, 'panel-002/shared');
  assert.notEqual(leftKey, rightKey);

  const analogImports = new Map([
    [leftKey, { schemaVersion: 1, sourceRegionId: 'page-1:left', assetId: 'analog-text:left', sourceBBox: lines[0].bbox, detectionSource: 'rtdetr-text', recognitionEngine: 'Baberu OCR', confidence: 0.8, needsReview: false, levelAdjusted: true }],
    [rightKey, { schemaVersion: 1, sourceRegionId: 'page-1:right', assetId: 'analog-text:right', sourceBBox: lines[1].bbox, detectionSource: 'rtdetr-text', recognitionEngine: 'Baberu OCR', confidence: 0.8, needsReview: false, levelAdjusted: true }],
  ]);
  const owners = new Map([['panel-001', page.panels[0]], ['panel-002', page.panels[1]]]);
  attachRecognizedTextToPage(page, lines, analogImports, null, owners);

  assert.equal(page.panels[0].bubbles[0].analogTextImport.assetId, 'analog-text:left');
  assert.equal(page.panels[1].bubbles[0].analogTextImport.assetId, 'analog-text:right');
});

test('別アプリのbridgeにはPOSTせずhealth確認だけで停止する', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method ?? 'GET' });
    return new Response(JSON.stringify({
      ok: true,
      service: 'unrelated-local-bridge',
      layout_protocol_version: 3,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await assert.rejects(openMacScanner(), /古いか別のアプリ/);
    assert.deepEqual(requests, [{ url: 'http://127.0.0.1:8787/api/health', method: 'GET' }]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('エピソード保存先を選び、管理対象の4フォルダだけを準備する', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (url, options = {}) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    const payload = String(url).endsWith('/select')
      ? { ...common, ok: true, cancelled: false, workspace_token: 'workspace-1', directory: '/作品/no.1.5', folder_name: 'no.1.5', series_directory: '/作品' }
      : { ...common, ok: true, managed_directories: ['name_data', 'draft_data', 'manuscript_data', 'export_data'] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await selectEpisodeWorkspace('/作品'), {
      token: 'workspace-1', directory: '/作品/no.1.5', folderName: 'no.1.5', seriesDirectory: '/作品',
    });
    assert.deepEqual(await prepareEpisodeWorkspace('workspace-1'), ['name_data', 'draft_data', 'manuscript_data', 'export_data']);
    assert.deepEqual(requests, [
      { url: 'http://127.0.0.1:8787/api/episode-workspace/select', body: { default_directory: '/作品' } },
      { url: 'http://127.0.0.1:8787/api/episode-workspace/prepare', body: { workspace_token: 'workspace-1' } },
    ]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('シリーズ一覧は不正なIDと空の名称をブラウザ側でも除外する', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (url) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ...common,
      series: [
        { series_id: 'series-one', series_name: '猫の旅', updated_at: '2026-08-30T00:00:00Z' },
        { series_id: '../outside', series_name: '危険' },
        { series_id: 'series-empty', series_name: '   ' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await listSeriesCatalogs(), [{
      seriesId: 'series-one', seriesName: '猫の旅', updatedAt: '2026-08-30T00:00:00Z',
      seriesDirectory: '', seriesTextFileName: '',
    }]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('シリーズ資料テキストはシリーズフォルダを起点に選択する', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (url, options = {}) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      ...common,
      ok: true,
      cancelled: false,
      series_directory: '/作品',
      relative_path: 'character_data/character.md',
      file_name: 'character.md',
      text: '# 登場人物設定',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await chooseSeriesReferenceText('series-one', '/作品'), {
      seriesDirectory: '/作品',
      relativePath: 'character_data/character.md',
      fileName: 'character.md',
      text: '# 登場人物設定',
    });
    assert.deepEqual(requests, [{
      url: 'http://127.0.0.1:8787/api/series/reference-text/choose',
      body: { series_id: 'series-one', default_directory: '/作品' },
    }]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('シリーズフォルダ選択は人物資料候補を確認前の状態で受け取る', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (url) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ...common,
      ok: true,
      cancelled: false,
      series_directory: '/作品',
      reference: {
        candidate_count: 2,
        ambiguous: false,
        candidates: [{
          relative_path: 'text/series_setting.md',
          file_name: 'series_setting.md',
          text: '# シリーズ設定',
          kind: 'series-setting',
          confidence: 'high',
          recommended: true,
        }, {
          relative_path: 'character_data/character.md',
          file_name: 'character.md',
          text: '# 登場人物設定',
          kind: 'characters',
          confidence: 'high',
          recommended: true,
        }],
        suggestion: {
          relative_path: 'character_data/character.md',
          file_name: 'character.md',
          text: '# 登場人物設定',
          selected_by: 'rules',
          confidence: 'high',
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await chooseSeriesDirectory('/作品'), {
      seriesDirectory: '/作品',
      candidateCount: 2,
      ambiguous: false,
      candidates: [{
        relativePath: 'text/series_setting.md',
        fileName: 'series_setting.md',
        text: '# シリーズ設定',
        kind: 'series-setting',
        confidence: 'high',
        recommended: true,
      }, {
        relativePath: 'character_data/character.md',
        fileName: 'character.md',
        text: '# 登場人物設定',
        kind: 'characters',
        confidence: 'high',
        recommended: true,
      }],
      suggestion: {
        relativePath: 'character_data/character.md',
        fileName: 'character.md',
        text: '# 登場人物設定',
        selectedBy: 'rules',
        confidence: 'high',
      },
    });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('エピソードフォルダ内の参照テキスト候補を受け取る', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (url) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ...common,
      ok: true,
      candidate_count: 1,
      ambiguous: false,
      suggestion: {
        relative_path: 'origin_data/text/origin_name.md',
        file_name: 'origin_name.md',
        text: '# あらすじ\n本文',
        selected_by: 'local-llm',
        confidence: 'medium',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await suggestEpisodeWorkspaceText('workspace-1'), {
      candidateCount: 1,
      ambiguous: false,
      suggestion: {
        relativePath: 'origin_data/text/origin_name.md',
        fileName: 'origin_name.md',
        text: '# あらすじ\n本文',
        selectedBy: 'local-llm',
        confidence: 'medium',
      },
    });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('シリーズ保存はbridgeが返すリビジョンを検証する', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (url) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ...common, series_id: 'series-one', revision: 'invalid' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await assert.rejects(saveSeriesCatalog('猫の旅', 'series-one', 'manga: {}', ''), /保存できませんでした/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('保存していない新規シリーズの内部データだけを破棄する', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ...common, ok: true, deleted: true, series_id: 'series-one' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    assert.equal(await discardUnsavedSeriesCatalog('仮シリーズ', 'series-one', 'episode-one'), true);
    assert.deepEqual(calls, [{
      url: 'http://127.0.0.1:8787/api/series/discard-unsaved',
      body: { series_name: '仮シリーズ', series_id: 'series-one', episode_id: 'episode-one' },
    }]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('新規作成の人物台帳は仮保存を開始・破棄・確定できる', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/begin')) {
      return new Response(JSON.stringify({ ...common, ok: true, draft_token: 'a'.repeat(32), series_id: 'series-one', episode_id: 'episode-one' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const key = String(url).endsWith('/discard') ? 'discarded' : 'committed';
    return new Response(JSON.stringify({ ...common, ok: true, draft_token: 'a'.repeat(32), [key]: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const draft = await beginSeriesCatalogDraft('猫の旅', 'series-one', 'episode-one');
    assert.equal(draft.token, 'a'.repeat(32));
    assert.equal(await discardSeriesCatalogDraft(draft.token), true);
    assert.equal(await commitSeriesCatalogDraft(draft.token), true);
    assert.deepEqual(calls.map((entry) => entry.url.split('/').at(-1)), ['begin', 'discard', 'commit']);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('シリーズ人物テキストの紐づけ・同期・復元結果を検証する', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/status')) return new Response(JSON.stringify({
      ...common, linked: false, needs_relink: true, series_id: 'series-one', file_name: 'character.md', deleted_characters: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (String(url).endsWith('/link')) return new Response(JSON.stringify({
      ...common, linked: true, series_id: 'series-one', series_directory: '/作品', relative_path: 'character_data/character.md', file_name: 'character.md', text: '# 登場人物設定', deleted_characters: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (String(url).endsWith('/sync')) return new Response(JSON.stringify({
      ...common, ok: true, linked: true, series_id: 'series-one', relative_path: 'character_data/character.md', file_name: 'character.md', deleted_characters: [{ deletion_id: 'deleted-20260831-abc', character_catalog_id: 'character-yuki', character_name: 'ユキ', deleted_at: '2026-08-31T00:00:00Z', expires_at: '2026-09-30T00:00:00Z' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({
      ...common, found: true, series_id: 'series-one', deletion_id: 'deleted-20260831-abc', character_name: 'ユキ', omny_yaml: 'manga: {}',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.equal((await getSeriesCharacterTextStatus('series-one')).needsRelink, true);
    assert.equal((await linkSeriesCharacterText('作品', 'series-one', '/作品')).fileName, 'character.md');
    const synced = await syncSeriesCharacterText('series-one', '# 登場人物設定', ['character-yuki'], {
      characterCatalogId: 'character-old', characterName: '旧人物', omnyYaml: 'manga: {}',
    });
    assert.equal(synced.deletedCharacters[0].characterName, 'ユキ');
    assert.equal((await restoreSeriesCharacterText('series-one', 'deleted-20260831-abc')).omnyYaml, 'manga: {}');
    assert.deepEqual(calls[2].body.archive, {
      character_catalog_id: 'character-old', character_name: '旧人物', omny_yaml: 'manga: {}',
    });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('人物資料画像の読込はPNG以外のdata URLを拒否する', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout, atob: globalThis.atob };
  globalThis.fetch = async (url) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ...common,
      found: true,
      series_id: 'series-one',
      character_catalog_id: 'character-one',
      asset_id: `image-${'a'.repeat(64)}`,
      image: 'data:image/jpeg;base64,AA==',
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await assert.rejects(loadCharacterReferenceImage('series-one', 'character-one', `image-${'a'.repeat(64)}`), /読み込めませんでした/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('人物資料画像の読込はfoundの型を厳密に検査する', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout, atob: globalThis.atob };
  globalThis.fetch = async (url) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ...common,
      found: 'false',
      series_id: 'series-one',
      character_catalog_id: 'character-one',
      asset_id: `image-${'a'.repeat(64)}`,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await assert.rejects(loadCharacterReferenceImage('series-one', 'character-one', `image-${'a'.repeat(64)}`), /応答形式/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('人物資料画像の読込はPNG署名とasset IDのSHA-256を検査する', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const actualSha = createHash('sha256').update(png).digest('hex');
  const assetId = `image-${actualSha}`;
  globalThis.window = { setTimeout, clearTimeout, atob: globalThis.atob };
  let mismatched = true;
  globalThis.fetch = async (url) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ...common,
      found: true,
      series_id: 'series-one',
      character_catalog_id: 'character-one',
      asset_id: mismatched ? `image-${'a'.repeat(64)}` : assetId,
      image: `data:image/png;base64,${png.toString('base64')}`,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await assert.rejects(loadCharacterReferenceImage('series-one', 'character-one', `image-${'a'.repeat(64)}`), /整合性/);
    mismatched = false;
    const loaded = await loadCharacterReferenceImage('series-one', 'character-one', assetId);
    assert.equal(loaded?.type, 'image/png');
    assert.equal(loaded?.size, png.length);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});


test('確認済みのmanga-base作画用ラフ計画をローカルbridgeへ渡す', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  const imageBytes = Buffer.from('iVBORw0KGgo=', 'base64');
  const imageSha256 = createHash('sha256').update(imageBytes).digest('hex');
  const provenanceSha256 = 'b'.repeat(64);
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (url, options = {}) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      ...common,
      image: `data:image/png;base64,${imageBytes.toString('base64')}`,
      job_id: '11111111-1111-4111-8111-111111111111',
      attempt_id: '22222222-2222-4222-8222-222222222222',
      attempt_number: 1,
      prompt_id: '22222222-2222-4222-8222-222222222222',
      status: 'succeeded',
      review: { decision: 'unreviewed', note: '', reviewed_at: null },
      artifacts: {
        manga_base_composite: {
          sha256: imageSha256, byte_size: imageBytes.length, media_type: 'image/png',
          workspace_relative_path: `draft_data/nyamuru/artifacts/sha256/${imageSha256.slice(0, 2)}/${imageSha256}.png`,
        },
      },
      audit_events: [{
        event_id: 1, status: 'succeeded', recorded_at: '2026-09-01T00:00:00+00:00',
        detail: {}, error_message: '', provenance_sha256: provenanceSha256, provenance_verified: true,
        provenance: {
          sha256: provenanceSha256, byte_size: 128, media_type: 'application/json',
          workspace_relative_path: `draft_data/nyamuru/artifacts/sha256/bb/${provenanceSha256}.json`,
        },
      }],
      file_name: 'page_0003_panel_0002_00001_.png',
      download_name: 'manga-base_page_0003_panel_0002_seed_2026082901.png',
      subfolder: 'manga_base_drafts',
      profile: 'manga-base',
      palette: { ink: '#000000', dense_tone: '#E60012', light_tone: '#00D7E8', paper: '#FFFFFF' },
      checkpoint: 'animagine-xl-3.1.safetensors',
      seed: 2026082901,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await generatePanelDraftWithComfyUI({
      pageNumber: 3,
      panelId: 2,
      profile: 'manga-base',
      positivePrompt: 'Japanese comic panel, アキが驚く',
      negativePrompt: 'text, speech bubble',
      checkpoint: 'animagine-xl-3.1.safetensors',
      width: 512,
      height: 512,
      steps: 20,
      cfg: 6,
      seed: 2026082901,
    }, {
      workspaceToken: '0123456789abcdef0123456789abcdef',
      jobId: '11111111-1111-4111-8111-111111111111',
      attemptId: '22222222-2222-4222-8222-222222222222',
      retryOfAttemptId: null,
      seriesId: 'series-one',
      episodeId: '33333333-3333-4333-8333-333333333333',
      omnySnapshot: 'manga:\n  meta: {}\n',
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://127.0.0.1:8787/api/panel-draft/generate');
    assert.deepEqual(requests[0].body, {
      workspace_token: '0123456789abcdef0123456789abcdef',
      job_id: '11111111-1111-4111-8111-111111111111',
      attempt_id: '22222222-2222-4222-8222-222222222222',
      retry_of_attempt_id: null,
      series_id: 'series-one',
      episode_id: '33333333-3333-4333-8333-333333333333',
      omny_snapshot: 'manga:\n  meta: {}\n',
      page_number: 3,
      panel_id: 2,
      profile: 'manga-base',
      positive_prompt: 'Japanese comic panel, アキが驚く',
      negative_prompt: 'text, speech bubble',
      checkpoint: 'animagine-xl-3.1.safetensors',
      width: 512,
      height: 512,
      steps: 20,
      cfg: 6,
      seed: 2026082901,
    });
    assert.equal(result.promptId, '22222222-2222-4222-8222-222222222222');
    assert.equal(result.jobId, '11111111-1111-4111-8111-111111111111');
    assert.equal(result.attemptId, '22222222-2222-4222-8222-222222222222');
    assert.equal(result.attemptNumber, 1);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.artifacts.manga_base_composite.sha256, imageSha256);
    assert.equal(result.verifiedArtifactSha256, imageSha256);
    assert.equal(result.fileName, 'manga-base_page_0003_panel_0002_seed_2026082901.png');
    assert.equal(result.sourceFileName, 'page_0003_panel_0002_00001_.png');
    assert.equal(result.profile, 'manga-base');
    assert.deepEqual(result.palette, { ink: '#000000', denseTone: '#E60012', lightTone: '#00D7E8', paper: '#FFFFFF' });
    assert.match(result.imageDataUrl, /^data:image\/png;base64,/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('作画用ラフの画像がないbridge応答は表示しない', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (url) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ...common,
      prompt_id: 'prompt-123', file_name: 'draft.png', download_name: 'manga-base_draft.png', subfolder: '',
      profile: 'manga-base', palette: { ink: '#000000', dense_tone: '#E60012', light_tone: '#00D7E8', paper: '#FFFFFF' },
      checkpoint: 'animagine-xl-3.1.safetensors', seed: 2026082901,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await assert.rejects(generatePanelDraftWithComfyUI({
      pageNumber: 1, panelId: 1, profile: 'manga-base', positivePrompt: 'panel', negativePrompt: 'text',
      checkpoint: 'animagine-xl-3.1.safetensors', width: 512, height: 512, steps: 20, cfg: 6, seed: 2026082901,
    }, {
      workspaceToken: '0123456789abcdef0123456789abcdef',
      jobId: '11111111-1111-4111-8111-111111111111',
      attemptId: '22222222-2222-4222-8222-222222222222',
      retryOfAttemptId: null,
      seriesId: 'series-one',
      episodeId: '33333333-3333-4333-8333-333333333333',
      omnySnapshot: 'manga:\n  meta: {}\n',
    }), /生成画像を読み取れません/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('作画用4値data URLは台帳SHA-256と一致するまで表示しない', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  const imageBytes = Buffer.from('iVBORw0KGgo=', 'base64');
  const provenanceSha256 = 'b'.repeat(64);
  globalThis.fetch = async (url) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ...common,
      image: `data:image/png;base64,${imageBytes.toString('base64')}`,
      job_id: '11111111-1111-4111-8111-111111111111',
      attempt_id: '22222222-2222-4222-8222-222222222222',
      attempt_number: 1,
      prompt_id: '22222222-2222-4222-8222-222222222222',
      status: 'succeeded',
      review: { decision: 'unreviewed', note: '', reviewed_at: null, revision: 0 },
      artifacts: {
        manga_base_composite: {
          sha256: 'a'.repeat(64), byte_size: imageBytes.length, media_type: 'image/png',
          workspace_relative_path: `draft_data/nyamuru/artifacts/sha256/aa/${'a'.repeat(64)}.png`,
        },
      },
      audit_events: [{
        event_id: 1, status: 'succeeded', recorded_at: '2026-09-01T00:00:00+00:00',
        detail: {}, error_message: '', provenance_sha256: provenanceSha256, provenance_verified: true,
        provenance: {
          sha256: provenanceSha256, byte_size: 128, media_type: 'application/json',
          workspace_relative_path: `draft_data/nyamuru/artifacts/sha256/bb/${provenanceSha256}.json`,
        },
      }],
      file_name: 'draft.png', download_name: 'manga-base_draft.png', subfolder: '',
      profile: 'manga-base', palette: { ink: '#000000', dense_tone: '#E60012', light_tone: '#00D7E8', paper: '#FFFFFF' },
      checkpoint: 'animagine-xl-3.1.safetensors', seed: 2026082901,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await assert.rejects(generatePanelDraftWithComfyUI({
      pageNumber: 1, panelId: 1, profile: 'manga-base', positivePrompt: 'panel', negativePrompt: 'text',
      checkpoint: 'animagine-xl-3.1.safetensors', width: 512, height: 512, steps: 20, cfg: 6, seed: 2026082901,
    }, {
      workspaceToken: '0123456789abcdef0123456789abcdef',
      jobId: '11111111-1111-4111-8111-111111111111',
      attemptId: '22222222-2222-4222-8222-222222222222',
      seriesId: 'series-one', episodeId: '33333333-3333-4333-8333-333333333333',
      omnySnapshot: 'manga:\n  meta: {}\n',
    }), /SHA-256/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('bridge URLはloopback HTTPだけを受け入れる', () => {
  assert.equal(isLoopbackBridgeUrl('http://127.0.0.1:8787'), true);
  assert.equal(isLoopbackBridgeUrl('http://localhost:8787/'), true);
  assert.equal(isLoopbackBridgeUrl('http://[::1]:8787'), true);
  assert.equal(isLoopbackBridgeUrl('https://127.0.0.1:8787'), false);
  assert.equal(isLoopbackBridgeUrl('http://192.168.1.2:8787'), false);
  assert.equal(isLoopbackBridgeUrl('http://127.0.0.1:8787/other'), false);
  assert.equal(isLoopbackBridgeUrl('http://user@127.0.0.1:8787'), false);
});

test('制作履歴・再照合・reviewはopaque tokenとattempt IDだけをbridgeへ渡す', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.window = { setTimeout, clearTimeout };
  const provenanceSha256 = 'c'.repeat(64);
  const successProvenanceSha256 = 'e'.repeat(64);
  const reviewedArtifactSha256 = 'd'.repeat(64);
  const reviewNonce = '55555555-5555-4555-8555-555555555555';
  const attempt = {
    job_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: '22222222-2222-4222-8222-222222222222',
    attempt_number: 1,
    retry_of_attempt_id: null,
    prompt_id: '22222222-2222-4222-8222-222222222222',
    status: 'outcome_unknown',
    page_number: 3,
    panel_id: 2,
    created_at: '2026-09-01T00:00:00+00:00',
    submitted_at: '2026-09-01T00:00:01+00:00',
    finished_at: null,
    error: { code: 'comfy_timeout', message: '結果を確認できません' },
    review: { decision: 'unreviewed', note: '', reviewed_at: null },
    artifacts: {},
    audit_events: [{
      event_id: 1, status: 'outcome_unknown', recorded_at: '2026-09-01T00:00:01+00:00',
      detail: { error_code: 'comfy_timeout' }, error_message: '結果を確認できません',
      provenance_sha256: provenanceSha256, provenance_verified: true,
      provenance: {
        sha256: provenanceSha256, byte_size: 128, media_type: 'application/json',
        workspace_relative_path: `draft_data/nyamuru/artifacts/sha256/cc/${provenanceSha256}.json`,
      },
    }],
  };
  globalThis.fetch = async (url, options = {}) => {
    const common = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
    if (String(url).endsWith('/api/health')) {
      return new Response(JSON.stringify({ ...common, ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const body = JSON.parse(options.body);
    requests.push({ url: String(url), body });
    if (String(url).endsWith('/api/panel-draft/list')) {
      return new Response(JSON.stringify({ ...common, attempts: [attempt] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).endsWith('/api/panel-draft/reconcile')) {
      return new Response(JSON.stringify({ ...common, attempt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ...common,
      attempt: {
        ...attempt,
        status: 'succeeded',
        error: null,
        audit_events: [...attempt.audit_events, {
          event_id: 2, status: 'succeeded', recorded_at: '2026-09-01T00:02:00+00:00',
          detail: {}, error_message: '',
          provenance_sha256: successProvenanceSha256, provenance_verified: true,
          provenance: {
            sha256: successProvenanceSha256, byte_size: 256, media_type: 'application/json',
            workspace_relative_path: `draft_data/nyamuru/artifacts/sha256/ee/${successProvenanceSha256}.json`,
          },
        }],
        review: {
          decision: 'accepted', note: '採用', reviewed_at: '2026-09-01T00:03:00+00:00',
          revision: 1, review_event_id: 1, request_nonce: reviewNonce, artifact_sha256: reviewedArtifactSha256,
        },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const token = '0123456789abcdef0123456789abcdef';
    const attempts = await listPanelDraftAttempts(token, 3, 2);
    assert.equal(attempts[0].status, 'outcome_unknown');
    const reconciled = await reconcilePanelDraftAttempt(token, attempt.attempt_id);
    assert.equal(reconciled.attemptId, attempt.attempt_id);
    const reviewed = await reviewPanelDraftAttempt(
      token, attempt.attempt_id, 'accepted', 0, reviewedArtifactSha256, reviewNonce, '採用',
    );
    assert.equal(reviewed.review.decision, 'accepted');
    assert.deepEqual(requests.map(({ body }) => body), [
      { workspace_token: token, page_number: 3, panel_id: 2 },
      { workspace_token: token, attempt_id: attempt.attempt_id },
      {
        workspace_token: token,
        attempt_id: attempt.attempt_id,
        decision: 'accepted',
        expected_revision: 0,
        artifact_sha256: reviewedArtifactSha256,
        request_nonce: reviewNonce,
        note: '採用',
      },
    ]);
    assert.equal(requests.some(({ body }) => 'image' in body || 'path' in body), false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
