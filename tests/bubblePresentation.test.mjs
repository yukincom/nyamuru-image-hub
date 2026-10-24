import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUBBLE_SHAPE_LABELS,
  bubbleTailIsEnabled,
  bubbleUsesMonologueTail,
  normalizedBubbleLineWidth,
  normalizedEmphasis,
  setBubbleTailEnabled,
  suggestBubbleShape,
} from '../src/lib/bubblePresentation.ts';

test('形状名は日本語で表示できる', () => {
  assert.equal(BUBBLE_SHAPE_LABELS.whisper, 'ささやき');
  assert.equal(BUBBLE_SHAPE_LABELS.uniflash, 'ウニフラッシュ');
  assert.equal(BUBBLE_SHAPE_LABELS.thought, 'モノローグ');
});

test('数珠状のしっぽはモノローグ形状だけで決まり、古い意味フラグには依存しない', () => {
  assert.equal(bubbleUsesMonologueTail({ shape: 'thought' }), true);
  assert.equal(bubbleUsesMonologueTail({ shape: 'normal', monologue: true }), false);
});

test('四角・キャプション・フラッシュ系は既定でしっぽなし、明示すれば表示する', () => {
  for (const shape of ['square', 'caption', 'flash', 'uniflash']) {
    assert.equal(bubbleTailIsEnabled({ shape }), false);
  }
  const bubble = { text: '声', shape: 'flash' };
  setBubbleTailEnabled(bubble, true);
  assert.deepEqual(bubble.tail, { x: 0.5, y: 0.5 });
  assert.equal(bubbleTailIsEnabled(bubble), true);
});

test('線幅と複数の強調フレーズを決定的に正規化する', () => {
  assert.equal(normalizedBubbleLineWidth(Number.NaN), 0.5);
  assert.equal(normalizedBubbleLineWidth(3), 2);
  assert.equal(normalizedEmphasis(' 絶対、忘れない,絶対 '), '絶対, 忘れない');
});

test('ト書き・セリフ・人物の描写範囲から保守的に形を選ぶ', () => {
  const base = { action: '', figures: [{ name: 'アキ', size: 'bust-up', bbox: { x: 80, y: 80, w: 40, h: 80 } }] };
  assert.equal(suggestBubbleShape(base, { text: '（そんなはずは）', monologue: true }), 'thought');
  assert.equal(suggestBubbleShape({ ...base, action: 'アキが小声で耳打ちする' }, { text: '聞いて' }), 'whisper');
  assert.equal(suggestBubbleShape({ ...base, figures: [{ ...base.figures[0], size: 'face' }] }, { text: '何だって！', bbox: { x: 120, y: 30, w: 30, h: 40 } }), 'flash');
  assert.equal(suggestBubbleShape({ action: '', figures: [] }, { text: '翌朝' }), 'caption');
});
