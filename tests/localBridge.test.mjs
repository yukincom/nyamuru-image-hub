import assert from 'node:assert/strict';
import test from 'node:test';
import { attachRecognizedTextToPage, normalizeLayoutRecognition } from '../src/lib/localBridge.ts';

const ids = ['A', 'B', 'C'];

test('bridgeの有効なテンプレート候補を正規化する', () => {
  assert.deepEqual(normalizeLayoutRecognition({
    template_id: ' b ', confidence: 0.84, reason: '6コマの配置が近い', rotation_degrees: 90,
  }, ids), {
    templateId: 'B', confidence: 0.84, reason: '6コマの配置が近い', rotationDegrees: 90,
    detectedPanelCount: 0,
    orientationEngine: '',
    orientationConfidence: 0,
    orientationHighConfidence: false,
    structureEngine: '',
    excludedNonPanelCount: 0,
    detectedTextRegionCount: 0,
    detectedFaceRegionCount: 0,
    detectedBodyRegionCount: 0,
    ocrEngine: '',
    ocrLines: [],
    qwenMode: 'auto',
    qwenOrientationUsed: false,
    qwenLayoutUsed: false,
    qwenLayoutAgreed: null,
    qwenOcrUsed: false,
    qwenOcrChanged: 0,
  });
});

test('未知のテンプレートIDは自動適用候補にしない', () => {
  const result = normalizeLayoutRecognition({ template_id: 'Z', confidence: 2 }, ids);
  assert.equal(result.templateId, null);
  assert.equal(result.confidence, 1);
});

test('確信度の欠損や範囲外を安全な範囲へ収める', () => {
  assert.equal(normalizeLayoutRecognition({ template_id: 'A', confidence: -0.5 }, ids).confidence, 0);
  assert.equal(normalizeLayoutRecognition({ template_id: 'A', confidence: 'not-a-number' }, ids).confidence, 0);
});

test('画像の回転補正は直角だけを受け入れる', () => {
  assert.equal(normalizeLayoutRecognition({ template_id: 'A', rotation_degrees: 270 }, ids).rotationDegrees, 270);
  assert.equal(normalizeLayoutRecognition({ template_id: 'A', rotation_degrees: 45 }, ids).rotationDegrees, 0);
});

test('OCR候補とQwen使用箇所を安全に正規化する', () => {
  const result = normalizeLayoutRecognition({
    template_id: 'A',
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
    qwen: { mode: 'compare', orientation_used: false, layout: { used: true, agreed: false }, ocr_used: true, ocr_changed: 1 },
  }, ids);
  assert.equal(result.detectedPanelCount, 3);
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
  assert.equal(result.qwenLayoutAgreed, false);
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
