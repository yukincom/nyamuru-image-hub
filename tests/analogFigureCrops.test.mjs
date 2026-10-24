import assert from 'node:assert/strict';
import test from 'node:test';
import { cropPixelBounds } from '../src/lib/analogFigureCrops.ts';

test('正規化した人物領域を欠けない整数画素の切り抜き範囲へ変換する', () => {
  assert.deepEqual(
    cropPixelBounds({ x: 0.125, y: 0.2, w: 0.25, h: 0.3 }, 1000, 800),
    { x: 125, y: 160, w: 250, h: 240 },
  );
  assert.deepEqual(
    cropPixelBounds({ x: -0.1, y: 0.9, w: 0.25, h: 0.3 }, 101, 99),
    { x: 0, y: 89, w: 16, h: 10 },
  );
});
