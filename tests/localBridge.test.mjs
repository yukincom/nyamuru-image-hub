import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLayoutRecognition } from '../src/lib/localBridge.ts';

const ids = ['A', 'B', 'C'];

test('bridgeの有効なテンプレート候補を正規化する', () => {
  assert.deepEqual(normalizeLayoutRecognition({
    template_id: ' b ', confidence: 0.84, reason: '6コマの配置が近い', rotation_degrees: 90,
  }, ids), {
    templateId: 'B', confidence: 0.84, reason: '6コマの配置が近い', rotationDegrees: 90,
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
