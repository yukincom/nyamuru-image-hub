import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBubbleSpeakerFigureIndex } from '../src/lib/bubbleRelations.ts';

const panel = (figures) => ({
  id: 1,
  shape: { type: 'rect', x: 10, y: 10, w: 190, h: 120 },
  bg: 0,
  figures,
  bubbles: [],
  action: null,
});

test('一意に配置された話者だけをフキダシの接続先にする', () => {
  const target = panel([
    { name: '葵', bbox: { x: 20, y: 30, w: 40, h: 70 } },
    { name: '蓮', bbox: { x: 120, y: 30, w: 40, h: 70 } },
  ]);
  assert.equal(resolveBubbleSpeakerFigureIndex(target, { text: 'こんにちは', speaker: '蓮' }), 1);
  assert.equal(resolveBubbleSpeakerFigureIndex(target, { text: 'こんにちは' }), null);
});

test('人物あたりと同名人物が複数いる曖昧な配置には接続しない', () => {
  assert.equal(resolveBubbleSpeakerFigureIndex(panel([
    { name: '人物あたり', bbox: { x: 20, y: 30, w: 40, h: 70 } },
    { name: '人物あたり', bbox: { x: 120, y: 30, w: 40, h: 70 } },
  ]), { text: '仮セリフ', speaker: '人物あたり' }), null);

  assert.equal(resolveBubbleSpeakerFigureIndex(panel([
    { name: '葵', bbox: { x: 20, y: 30, w: 40, h: 70 } },
    { name: '葵', bbox: { x: 120, y: 30, w: 40, h: 70 } },
  ]), { text: 'どちら？', speaker: '葵' }), null);
});
