import assert from 'node:assert/strict';
import test from 'node:test';
import { attachRecognizedTextToPage, groupRecognizedTextLines, normalizeLayoutRecognition } from '../src/lib/localBridge.ts';

test('検出した正規化座標をA4紙面上の編集可能な矩形へ変換する', () => {
  const result = normalizeLayoutRecognition({
    panel_boxes: [
      [0.5, 0.1, 0.4, 0.2],
      [-0.1, 0.2, 0.2, 0.3],
      [0.1, 0.1, -0.05, 0.1],
      ['bad', 0, 1, 1],
    ],
    reason: '検出した矩形を直接使用します',
    rotation_degrees: 90,
  });
  assert.deepEqual(result.detectedPanels, [
    { type: 'rect', x: 105, y: 29.7, w: 84, h: 59.4 },
    { type: 'rect', x: 0, y: 59.4, w: 21, h: 89.1 },
  ]);
  assert.equal(result.detectedPanelCount, 2);
  assert.equal(result.reason, '検出した矩形を直接使用します');
  assert.equal(result.rotationDegrees, 90);
});

test('コマ未検出時は安全な空配列と案内文を返す', () => {
  const result = normalizeLayoutRecognition({});
  assert.deepEqual(result.detectedPanels, []);
  assert.equal(result.detectedPanelCount, 0);
  assert.match(result.reason, /特定できません/);
});

test('画像の回転補正は直角だけを受け入れる', () => {
  assert.equal(normalizeLayoutRecognition({ rotation_degrees: 270 }).rotationDegrees, 270);
  assert.equal(normalizeLayoutRecognition({ rotation_degrees: 45 }).rotationDegrees, 0);
});

test('OCR候補とQwen使用箇所を安全に正規化する', () => {
  const result = normalizeLayoutRecognition({
    panel_boxes: [[0.05, 0.04, 0.9, 0.42], [0.05, 0.5, 0.9, 0.44]],
    detected_panel_count: 3,
    orientation: { engine: '手動確認済み', confidence: 1, high_confidence: true },
    structure: {
      engine: 'RT-DETR',
      excluded_as_text_count: 2,
      excluded_as_face_count: 1,
      excluded_as_body_count: 0,
      text_region_count: 5,
      face_region_count: 2,
      body_region_count: 3,
    },
    ocr: { engine: 'NDLOCR-Lite', lines: [
      {
        id: 'line-1', text: 'こんにちは', bbox: [0.6, 0.1, 0.2, 0.12], confidence: 1.4,
        vertical: true, source: 'qwen-fallback', needs_review: true, qwen_text: 'こんにちは', group_id: 'block-1',
      },
      {
        id: 'line-2', text: '次のコマ', bbox: [0.6, 0.62, 0.2, 0.12], confidence: 0.8,
        vertical: true, source: 'ndlocr', needs_review: false, group_id: 'block-2',
      },
    ] },
    qwen: { mode: 'compare', ocr_used: true, ocr_changed: 1 },
  });
  assert.equal(result.detectedPanelCount, 2);
  assert.equal(result.orientationEngine, '手動確認済み');
  assert.equal(result.orientationConfidence, 1);
  assert.equal(result.orientationHighConfidence, true);
  assert.equal(result.structureEngine, 'RT-DETR');
  assert.equal(result.excludedNonPanelCount, 3);
  assert.equal(result.detectedTextRegionCount, 5);
  assert.equal(result.detectedFaceRegionCount, 2);
  assert.equal(result.detectedBodyRegionCount, 3);
  assert.equal(result.ocrLines[0].text, 'こんにちは');
  assert.equal(result.ocrLines[0].confidence, 1);
  assert.equal(result.ocrLines[0].groupId, 'block-1');
  assert.equal(result.qwenMode, 'compare');
  assert.equal(result.qwenOcrUsed, true);
  assert.equal(result.qwenOcrChanged, 1);
});

test('文字を持つ最小のコマだけを残し、重複候補を除いてコマ間を5mm空ける', () => {
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
      const horizontalGap = Math.max(first.x, second.x) - Math.min(first.x + first.w, second.x + second.w);
      const verticalGap = Math.max(first.y, second.y) - Math.min(first.y + first.h, second.y + second.h);
      assert.ok(horizontalGap >= 4.9 || verticalGap >= 4.9, `コマ${index + 1}と${otherIndex + 1}の間隔`);
    }
  }
});

test('同一テキストブロックの縦書き行を右から改行で一つにまとめる', () => {
  const grouped = groupRecognizedTextLines([
    { id: 'left', text: '左の行', bbox: { x: 0.65, y: 0.1, w: 0.05, h: 0.2 }, confidence: 0.7, vertical: true, source: 'ndlocr', needsReview: false, groupId: 'bubble-1' },
    { id: 'right', text: '右の行', bbox: { x: 0.75, y: 0.1, w: 0.05, h: 0.2 }, confidence: 0.8, vertical: true, source: 'ndlocr', needsReview: true, groupId: 'bubble-1' },
    { id: 'other', text: '別の吹き出し', bbox: { x: 0.1, y: 0.6, w: 0.2, h: 0.08 }, confidence: 0.9, vertical: false, source: 'ndlocr', needsReview: false, groupId: 'bubble-2' },
  ]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].text, '右の行\n左の行');
  assert.equal(grouped[0].bbox.x, 0.65);
  assert.equal(grouped[0].bbox.y, 0.1);
  assert.ok(Math.abs(grouped[0].bbox.w - 0.15) < 1e-9);
  assert.ok(Math.abs(grouped[0].bbox.h - 0.2) < 1e-9);
  assert.equal(grouped[0].needsReview, true);
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
    confidence: 0.8, vertical: true, source: 'ndlocr', needsReview: false,
  }]);
  assert.equal(page.panels[0].bubbles.length, 0);
  assert.equal(page.panels[1].bubbles[0].text, '内側');
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
    confidence: 0.7, vertical: true, source: 'ndlocr', needsReview: true,
  }]);
  assert.deepEqual(result, { added: 1, needsReview: 1 });
  assert.equal(page.panels[0].bubbles.length, 0);
  assert.equal(page.panels[1].bubbles[0].text, '右のコマ');
  assert.ok(page.panels[1].bubbles[0].bbox.x >= 110);
});
