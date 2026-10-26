import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bubbleTailIsEnabled,
  bubbleTailStyle,
  bubbleUsesMonologueTail,
  normalizedBubbleLineWidth,
  setBubbleTailEnabled,
  setBubbleTailStyle,
} from '../src/lib/bubblePresentation.ts';

test('旧データは形状から補完し、明示したthinking／通常しっぽを優先する', () => {
  assert.equal(bubbleUsesMonologueTail({ shape: 'thought' }), true);
  assert.equal(bubbleUsesMonologueTail({ shape: 'normal', monologue: true }), false);
  assert.equal(bubbleUsesMonologueTail({shape:'normal',tail_style:'thinking'}),true);
  assert.equal(bubbleUsesMonologueTail({shape:'thought',tail_style:'normal'}),false);
  const bubble={text:'声',shape:'normal'};
  setBubbleTailStyle(bubble,'thinking');assert.equal(bubbleTailStyle(bubble),'thinking');assert.equal(bubble.tail_style,'thinking');
  setBubbleTailStyle(bubble,'normal');assert.equal(bubbleTailStyle(bubble),'normal');
  setBubbleTailStyle(bubble,'none');assert.equal(bubbleTailStyle(bubble),'none');assert.equal(bubble.tail,false);
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

test('線幅を決定的に正規化する', () => {
  assert.equal(normalizedBubbleLineWidth(Number.NaN), 0.5);
  assert.equal(normalizedBubbleLineWidth(3), 2);
});
