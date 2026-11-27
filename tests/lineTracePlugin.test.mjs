import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

test('LAN server exposes /api/line-trace supervisor route and binary bridge processes real PNG', (t) => {
  assert.ok(SUPERVISOR_PATHS.has('/api/line-trace'));

  const repoRoot = resolve(import.meta.dirname, '..');
  const binPath = resolve(repoRoot, '.local-clip-export/bin/nyamuru-line-trace');
  const sampleImg = resolve(repoRoot, '../line-trace-strokes/examples/anime/anime_input.png');
  if (!existsSync(binPath) || !existsSync(sampleImg)) {
    t.skip('local nyamuru-line-trace binary or sibling line-trace-strokes sample not present');
    return;
  }
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

test('tracedStrokesToVectorPaths imports minimal-anchor cubic Bezier handles and adaptive clipExportVectorLines', () => {
  const paths = tracedStrokesToVectorPaths(
    [
      {
        closed: false,
        points: [],
        corners: [],
        nodes: [
          { x: 0, y: 0, r: 2.0, ho: [0, 30] },
          { x: 50, y: 50, r: 4.0, hi: [-30, 0] },
          { x: 80, y: 50, r: 2.0, c: true },
        ],
      },
    ],
    100,
    100,
    { x: 0, y: 0, w: 100, h: 100 },
  );

  assert.equal(paths.length, 1);
  assert.equal(paths[0].nodes.length, 3);
  assert.deepEqual(paths[0].nodes[0].handleOut, { x: 0, y: 30 });
  assert.deepEqual(paths[0].nodes[1].handleIn, { x: -30, y: 0 });
  assert.equal(paths[0].nodes[2].corner, true);

  const clipLines = clipExportVectorLines(
    paths,
    { width: 100, height: 100 },
    { x: 0, y: 0, w: 100, h: 100 },
    { w: 100, h: 100 },
    { width: 100, height: 100 },
  );
  assert.equal(clipLines.length, 1);
  assert.ok(clipLines[0].points.length > 3, `curved cubic segment must subdivide, got ${clipLines[0].points.length}`);
  assert.deepEqual(clipLines[0].corners, [clipLines[0].points.length - 1]);
});

test('validatePaintDocument accepts valid VectorStyle.wobble and rejects invalid bounds', () => {
  const paths = tracedStrokesToVectorPaths(
    [{ closed: false, points: [[10, 10, 2], [90, 10, 2]], corners: [] }],
    100,
    100,
    { x: 0, y: 0, w: 100, h: 100 },
  );
  paths[0].style.wobble = { amount: 0.35, scale: 14, seed: 42 };
  const validLayer = { ...newPaintLayer('線画', 'vector'), kind: 'vector', paths };
  assert.doesNotThrow(() =>
    validatePaintDocument({ version: 1, width: 100, height: 100, dpi: 300, layers: [validLayer] }, []),
  );

  const badAmountLayer = structuredClone(validLayer);
  badAmountLayer.paths[0].style.wobble.amount = 1.5;
  assert.throws(() =>
    validatePaintDocument({ version: 1, width: 100, height: 100, dpi: 300, layers: [badAmountLayer] }, []),
  );

  const badScaleLayer = structuredClone(validLayer);
  badScaleLayer.paths[0].style.wobble.scale = 1;
  assert.throws(() =>
    validatePaintDocument({ version: 1, width: 100, height: 100, dpi: 300, layers: [badScaleLayer] }, []),
  );
});

test('line_trace_upscale.py ai2x upscales 2x with JaNai V3 SPAN while preserving logical bbox', (t) => {
  const repoRoot = resolve(import.meta.dirname, '..');
  const python = resolve(repoRoot, '.local-vision/.venv/bin/python');
  const script = resolve(repoRoot, 'scripts/line_trace_upscale.py');
  const visionRoot = resolve(repoRoot, '.local-vision');
  const binPath = resolve(repoRoot, '.local-clip-export/bin/nyamuru-line-trace');
  const modelPath = resolve(
    visionRoot,
    'models/janai-v3-span/2x_IllustrationJaNai_V3denoise_SPAN_S_30k_fp16_1x3xHxW_dyn-HW_strong_fp16_op23.onnx',
  );
  if (!existsSync(python) || !existsSync(binPath) || !existsSync(modelPath)) {
    t.skip('local .local-vision venv, JaNai V3 SPAN ONNX model, or nyamuru-line-trace binary not present');
    return;
  }

  // Synthesize a crisp 80x40 test PNG via python PIL
  const sampleUrl = execFileSync(python, [
    '-c',
    'import base64, io; from PIL import Image, ImageDraw; '
    + 'im=Image.new("RGB",(80,40),(255,255,255)); d=ImageDraw.Draw(im); '
    + 'd.line([(10,20),(70,20)], fill=(0,0,0), width=3); '
    + 'b=io.BytesIO(); im.save(b,"PNG"); print("data:image/png;base64,"+base64.b64encode(b.getvalue()).decode())',
  ]).toString('utf8').trim();

  const preOut = JSON.parse(
    execFileSync(python, ['-B', script, visionRoot], {
      input: JSON.stringify({ image: sampleUrl, mode: 'ai2x', maxEdge: 4096 }),
      maxBuffer: 32 * 1024 * 1024,
    }).toString('utf8'),
  );
  assert.equal(preOut.modeUsed, 'ai2x');
  assert.equal(preOut.width, 160);
  assert.equal(preOut.height, 80);

  const traced = JSON.parse(
    execFileSync(binPath, ['--bridge-stdin'], {
      input: JSON.stringify({ image: preOut.image, threshold: 180, tol: 0.3, detectBeta: false }),
      maxBuffer: 32 * 1024 * 1024,
    }).toString('utf8'),
  );
  assert.equal(traced.width, 160);
  assert.equal(traced.height, 80);
  assert.ok(traced.strokes.length >= 1);

  const bbox = { x: 100, y: 50, w: 80, h: 40 };
  const paths = tracedStrokesToVectorPaths(traced.strokes, traced.width, traced.height, bbox);
  assert.ok(paths.length >= 1);
  for (const p of paths) {
    for (const n of p.nodes) {
      assert.ok(n.x >= bbox.x - 1 && n.x <= bbox.x + bbox.w + 1, `node x out of logical bbox: ${n.x}`);
      assert.ok(n.y >= bbox.y - 1 && n.y <= bbox.y + bbox.h + 1, `node y out of logical bbox: ${n.y}`);
    }
  }
});
