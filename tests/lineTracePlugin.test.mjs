import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { SUPERVISOR_PATHS } from '../scripts/lan-server.mjs';
import { clipExportVectorLines } from '../src/lib/clip/layerData.ts';
import { applyLineTraceLayers, tracedStrokesToVectorPaths } from '../src/lib/lineTraceLayers.ts';
import { newPaintLayer, validatePaintDocument } from '../src/lib/paintDocument.ts';

test('tracedStrokesToVectorPaths converts variable-radius strokes into valid editable VectorPaths and CSP spline lines', () => {
  const paths = tracedStrokesToVectorPaths(
    [
      {
        closed: false,
        points: [
          [10, 20, 1.0],
          [30, 25, 2.5],
          [60, 45, 4.0],
          [90, 40, 1.5],
        ],
        corners: [2],
      },
    ],
    100,
    100,
    { x: 50, y: 80, w: 200, h: 200 },
  );

  assert.equal(paths.length, 1);
  const path = paths[0];
  assert.equal(path.style.profile, 'variable');
  assert.equal(path.style.width, 16);
  assert.equal(path.nodes.length, 4);
  assert.equal(path.nodes[0].x, 70);
  assert.equal(path.nodes[0].y, 120);
  assert.ok(Math.abs((path.nodes[0].width ?? 0) - 0.25) < 1e-6);
  assert.ok(path.nodes[1].handleIn && path.nodes[1].handleOut);
  assert.equal(path.nodes[2].corner, true);
  assert.equal(path.nodes[2].handleIn, undefined);

  /** @type {import('../src/types.ts').PaintLayer} */
  const vecLayer = { ...newPaintLayer('線画', 'vector'), kind: 'vector', paths };
  assert.doesNotThrow(() =>
    validatePaintDocument(
      { version: 1, width: 400, height: 400, dpi: 300, layers: [vecLayer] },
      [],
    ),
  );

  const clipLines = clipExportVectorLines(
    paths,
    { width: 400, height: 400 },
    { x: 0, y: 0, w: 400, h: 400 },
    { w: 400, h: 400 },
    { width: 800, height: 800 },
  );
  assert.equal(clipLines.length, 1);
  assert.equal(clipLines[0].curve, 'spline');
  assert.deepEqual(clipLines[0].corners, [2]);
  assert.equal(clipLines[0].widthPx, 32);
  assert.equal(clipLines[0].points.length, 4);
  assert.deepEqual(clipLines[0].points[2], [340, 340, 1]);
});

test('applyLineTraceLayers non-destructively hides source layer and inserts vector + beta folder', () => {
  /** @type {import('../src/types.ts').PaintLayer} */
  const sourceLayer = {
    ...newPaintLayer('生成キャラ'),
    strokes: [{ tool: 'pen', color: '#000000', size: 4, points: [{ x: 10, y: 10, pressure: 1, time: 0 }] }],
  };
  /** @type {import('../src/lib/paintDocument.ts').PaintOwner} */
  const owner = {
    key: 'figure:0',
    kind: 'figure',
    index: 0,
    label: '人物 1',
    frame: { x: 0, y: 0, w: 200, h: 200 },
    paint: { version: 1, width: 200, height: 200, dpi: 300, layers: [sourceLayer] },
  };
  /** @type {import('../src/lib/paintDocument.ts').PaintScene} */
  const scene = { frame: owner.frame, owners: [owner] };
  const betaAsset = {
    id: 'beta-1',
    storageId: 'beta-1',
    originalName: 'ベタ塗り.png',
    mediaType: 'image/png',
    byteLength: 128,
    widthPx: 100,
    heightPx: 100,
  };
  const paths = tracedStrokesToVectorPaths(
    [{ closed: false, points: [[5, 5, 1], [50, 50, 2]], corners: [] }],
    100,
    100,
    { x: 10, y: 10, w: 100, h: 100 },
  );

  const next = applyLineTraceLayers(scene, [{ owner, layer: sourceLayer, bbox: { x: 10, y: 10, w: 100, h: 100 }, paths, betaAsset }]);
  const updatedPaint = next.owners[0].paint;
  assert.equal(updatedPaint.layers.length, 3);
  assert.equal(updatedPaint.layers[0].id, sourceLayer.id);
  assert.equal(updatedPaint.layers[0].visible, false);
  assert.equal(updatedPaint.layers[1].name, 'ベタ塗り');
  assert.equal(updatedPaint.layers[1].antialias, 0);
  assert.equal(updatedPaint.layers[1].image?.assetId, 'beta-1');
  assert.equal(updatedPaint.layers[2].name, '線画');
  assert.equal(updatedPaint.layers[2].kind, 'vector');
  assert.equal(updatedPaint.layers[2].antialias, 0);
  assert.equal(updatedPaint.folders?.length, 1);
  assert.equal(updatedPaint.folders?.[0].name, 'ベクター線画✨');
  assert.doesNotThrow(() => validatePaintDocument(updatedPaint, [betaAsset]));
});

test('LAN server exposes /api/line-trace supervisor route and binary bridge processes real PNG', () => {
  assert.ok(SUPERVISOR_PATHS.has('/api/line-trace'));

  const repoRoot = resolve(import.meta.dirname, '..');
  const binPath = resolve(repoRoot, '.local-clip-export/bin/nyamuru-line-trace');
  const sampleImg = resolve(repoRoot, '../line-trace-strokes/examples/anime/anime_input.png');
  const b64 = readFileSync(sampleImg).toString('base64');

  const stdout = execFileSync(binPath, ['--bridge-stdin'], {
    input: JSON.stringify({
      image: `data:image/png;base64,${b64}`,
      threshold: 180,
      tol: 0.5,
      epsR: 0.2,
      detectBeta: true,
      chainMode: 'model',
    }),
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.width, 1120);
  assert.equal(parsed.height, 2240);
  assert.ok(parsed.strokes.length > 1000);
  assert.ok(typeof parsed.betaPng === 'string' && parsed.betaPng.startsWith('data:image/png;base64,'));
});
