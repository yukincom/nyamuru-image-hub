import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPageNumberFromFileName,
  matchFilesToPages,
  detectCutlinePanelCrops,
  maskOutsidePanelPolygon,
  splitPanelCharacters,
} from '../src/lib/cloudPageSplit.ts';

function makeSolidRgba(width, height, r = 255, g = 255, b = 255, a = 255) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  }
  return rgba;
}

function drawRect(rgba, width, x0, y0, x1, y1, r, g, b, a = 255) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const idx = (y * width + x) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = a;
    }
  }
}

test('extractPageNumberFromFileName and matchFilesToPages match numbered filenames', () => {
  assert.equal(extractPageNumberFromFileName('01.png'), 1);
  assert.equal(extractPageNumberFromFileName('page_03_cutline.png'), 3);
  assert.equal(extractPageNumberFromFileName('cover.png'), null);

  const files = [
    new File(['a'], '02.png', { type: 'image/png' }),
    new File(['b'], '01.png', { type: 'image/png' }),
    new File(['c'], '99.png', { type: 'image/png' }),
    new File(['d'], 'extra.png', { type: 'image/png' }),
  ];
  const matched = matchFilesToPages(files, 3);
  assert.deepEqual(
    matched.map(entry => [entry.file.name, entry.pageIndex]),
    [
      ['01.png', 0],
      ['02.png', 1],
      ['99.png', 2],
      ['extra.png', null],
    ],
  );
});

test('detectCutlinePanelCrops detects light-blue cutlines and falls back proportionally when absent', () => {
  const width = 100;
  const height = 120;
  const canvasMm = { w: 100, h: 120 };
  const panels = [
    { id: 1, shape: { type: 'rect', x: 10, y: 10, w: 80, h: 45 } },
    { id: 2, shape: { type: 'rect', x: 10, y: 65, w: 80, h: 45 } },
  ];

  // Proportional fallback on plain white image
  const plain = makeSolidRgba(width, height);
  const fallbackCrops = detectCutlinePanelCrops(plain, width, height, panels, canvasMm);
  assert.equal(fallbackCrops.length, 2);
  assert.deepEqual(fallbackCrops[0], { x: 10, y: 10, w: 80, h: 45 });
  assert.deepEqual(fallbackCrops[1], { x: 10, y: 65, w: 80, h: 45 });

  // Cutline image with shifted light-blue borders (R<200, G~205, B>215)
  const cutline = makeSolidRgba(width, height);
  drawRect(cutline, width, 12, 8, 88, 10, 140, 200, 245); // top of panel 1
  drawRect(cutline, width, 12, 52, 88, 54, 140, 200, 245); // bottom of panel 1
  drawRect(cutline, width, 12, 8, 14, 54, 140, 200, 245); // left of panel 1
  drawRect(cutline, width, 86, 8, 88, 54, 140, 200, 245); // right of panel 1

  const detected = detectCutlinePanelCrops(cutline, width, height, panels, canvasMm);
  assert.equal(detected.length, 2);
  assert.ok(detected[0].x >= 12 && detected[0].x <= 15);
  assert.ok(detected[0].y >= 8 && detected[0].y <= 11);
  assert.ok(detected[0].y + detected[0].h >= 51 && detected[0].y + detected[0].h <= 55);
});

test('splitPanelCharacters separates two characters left-to-right and makes outer white transparent while preserving inner white', () => {
  const width = 120;
  const height = 80;
  const rgba = makeSolidRgba(width, height, 255, 255, 255, 255);

  // Left character: dark outline box with interior white (e.g., white shirt)
  drawRect(rgba, width, 15, 20, 45, 65, 20, 20, 20, 255);
  drawRect(rgba, width, 20, 25, 40, 60, 255, 255, 255, 255);

  // Right character: dark figure
  drawRect(rgba, width, 75, 15, 105, 68, 25, 25, 25, 255);

  const figures = [
    { id: 'fig-right', name: 'Right', bbox: { x: 60, y: 10, w: 30, h: 50 } },
    { id: 'fig-left', name: 'Left', bbox: { x: 10, y: 10, w: 30, h: 50 } },
  ];

  const results = splitPanelCharacters(rgba, width, height, figures, true);
  assert.equal(results.length, 2);

  const leftResult = results.find(item => item.figureIndex === 1);
  const rightResult = results.find(item => item.figureIndex === 0);
  assert.ok(leftResult);
  assert.ok(rightResult);

  // Left result should have transparent outer background (0,0) and opaque interior white
  assert.equal(leftResult.rgba[3], 0);
  const centerIdx = (Math.floor(leftResult.height / 2) * leftResult.width + Math.floor(leftResult.width / 2)) * 4;
  assert.equal(leftResult.rgba[centerIdx + 3], 255);
  assert.equal(leftResult.rgba[centerIdx], 255);
});

test('cool-gray art and stray edge pixels stay strictly inside panel bounds and polygon mask clears outside', () => {
  const width = 100;
  const height = 120;
  const canvasMm = { w: 100, h: 120 };
  const panels = [
    { id: 1, shape: { type: 'rect', x: 10, y: 10, w: 80, h: 45 } },
    { id: 2, shape: { type: 'rect', x: 10, y: 65, w: 80, h: 45 } },
  ];

  const img = makeSolidRgba(width, height);
  // Cool gray shadow inside panel 1 (b - r = 18 < 28): must NOT trigger cutline detection or shift crops
  drawRect(img, width, 15, 20, 85, 35, 175, 180, 193);
  // A single stray blue-tinted cutline mark at top edge (x=0,y=0): must NOT trigger fullBleedX
  drawRect(img, width, 0, 0, 1, 1, 80, 80, 80);
  // Actual light-blue borders around panel 1 only at (x=10..90, y=10..55)
  drawRect(img, width, 10, 10, 90, 11, 140, 200, 245);
  drawRect(img, width, 10, 54, 90, 55, 140, 200, 245);

  const crops = detectCutlinePanelCrops(img, width, height, panels, canvasMm);
  assert.deepEqual(crops[0], { x: 10, y: 10, w: 80, h: 44 });
  assert.deepEqual(crops[1], { x: 10, y: 65, w: 80, h: 45 });

  // Asymmetric figure bboxes with panelBox keep right-shifted split boundary
  const asymRgba = makeSolidRgba(100, 50, 255, 255, 255, 255);
  drawRect(asymRgba, 100, 5, 10, 65, 45, 20, 20, 20, 255); // wide left character
  drawRect(asymRgba, 100, 78, 10, 95, 45, 20, 20, 20, 255); // right character
  const split = splitPanelCharacters(
    asymRgba, 100, 50,
    [
      { id: 'left', name: 'Left', bbox: { x: 10, y: 10, w: 55, h: 35 } },
      { id: 'right', name: 'Right', bbox: { x: 75, y: 10, w: 15, h: 35 } },
    ],
    true,
    { x: 10, y: 10, w: 80, h: 35 },
  );
  assert.equal(split.length, 2);
  assert.ok(split.find(item => item.figureIndex === 0).crop.w > 50);

  // Polygon mask clears pixels outside slanted polygon panel
  const polyRgba = makeSolidRgba(20, 20, 30, 30, 30, 255);
  const triangle = { id: 3, shape: { type: 'polygon', points: [[0, 0], [20, 0], [0, 20]] } };
  const masked = maskOutsidePanelPolygon(polyRgba, 20, 20, triangle, true);
  assert.equal(masked[(18 * 20 + 18) * 4 + 3], 0);
  assert.equal(masked[(2 * 20 + 2) * 4 + 3], 255);
});
