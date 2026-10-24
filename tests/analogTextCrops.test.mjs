import assert from 'node:assert/strict';
import test from 'node:test';

import { levelCorrectionRange } from '../src/lib/analogTextCrops.ts';

test('原字参照のレベル補正は暗い線と白い紙を決定的な両端に取る', () => {
  const values = new Uint8Array([...Array(10).fill(0), ...Array(90).fill(255)]);
  assert.deepEqual(levelCorrectionRange(values), { blackPoint: 0, whitePoint: 255 });
  assert.deepEqual(levelCorrectionRange(values), levelCorrectionRange(values));
});

test('コントラストの低い鉛筆領域でも最低80階調の補正幅を確保する', () => {
  const range = levelCorrectionRange(new Uint8Array(Array(100).fill(220)));
  assert.equal(range.whitePoint - range.blackPoint, 80);
});
