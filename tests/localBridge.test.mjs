import assert from 'node:assert/strict';
import test from 'node:test';
import { attachRecognizedTextToPage, normalizeLayoutRecognition } from '../src/lib/localBridge.ts';

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
    ocr: { engine: 'NDLOCR-Lite', lines: [{
      id: 'line-1', text: 'こんにちは', bbox: [0.6, 0.1, 0.2, 0.12], confidence: 1.4,
      vertical: true, source: 'qwen-fallback', needs_review: true, qwen_text: 'こんにちは',
    }] },
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
  assert.equal(result.qwenMode, 'compare');
  assert.equal(result.qwenOcrUsed, true);
  assert.equal(result.qwenOcrChanged, 1);
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
