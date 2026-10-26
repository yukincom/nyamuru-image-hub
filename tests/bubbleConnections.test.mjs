import assert from 'node:assert/strict';
import test from 'node:test';
import { appendBubbles, normalizeBubbleConnections, removeBubbleAt } from '../src/lib/bubbleConnections.ts';

test('フキダシ削除後も結合番号を詰め、削除対象への結合は解除する', () => {
  const bubbles = [
    { text: '一' },
    { text: '二', join_to: 1 },
    { text: '三', join_to: 2 },
    { text: '四', join_to: 1 },
  ];
  assert.equal(removeBubbleAt(bubbles, 1)?.text, '二');
  assert.deepEqual(bubbles, [
    { text: '一' },
    { text: '三' },
    { text: '四', join_to: 1 },
  ]);
});

test('自分以降を指す不正な結合参照を読込時に解除する', () => {
  const bubbles = [{ text: '一', join_to: 1 }, { text: '二', join_to: 3 }, { text: '三', join_to: 1 }];
  normalizeBubbleConnections(bubbles);
  assert.deepEqual(bubbles, [{ text: '一' }, { text: '二' }, { text: '三', join_to: 1 }]);
});

test('別配列を連結すると結合相手の番号も連結位置へずらす', () => {
  const target = [{ text: '先頭' }];
  appendBubbles(target, [{ text: '親' }, { text: '子', join_to: 1 }]);
  assert.deepEqual(target, [{ text: '先頭' }, { text: '親' }, { text: '子', join_to: 2 }]);
});
