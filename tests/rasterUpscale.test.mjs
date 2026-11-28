import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { SUPERVISOR_PATHS } from '../scripts/lan-server.mjs';
import { applyRasterUpscaleLayers } from '../src/lib/rasterUpscaleLayers.ts';
import { newPaintLayer, validatePaintDocument } from '../src/lib/paintDocument.ts';

function makeAsset(id, widthPx = 100, heightPx = 100) {
  return {
    id,
    storageId: id,
    originalName: `${id}.png`,
    mediaType: 'image/png',
    byteLength: 128,
    widthPx,
    heightPx,
  };
}

test('applyRasterUpscaleLayers inserts single upscaled raster layer above hidden source and enforces 64-layer cap', () => {
  const sourceColor = {
    ...newPaintLayer('下絵'),
    antialias: 3,
    strokes: [{ tool: 'pen', color: '#000000', size: 4, points: [{ x: 10, y: 10, pressure: 1, time: 0 }] }],
  };
  const sourceMono = {
    ...newPaintLayer('線画元'),
    antialias: 2,
    strokes: [{ tool: 'pen', color: '#000000', size: 3, points: [{ x: 20, y: 20, pressure: 1, time: 0 }] }],
  };
  const owner = {
    key: 'figure:0',
    kind: 'figure',
    index: 0,
    label: '人物 1',
    frame: { x: 0, y: 0, w: 200, h: 200 },
    paint: { version: 1, width: 200, height: 200, dpi: 300, layers: [sourceColor, sourceMono] },
  };
  const scene = { frame: owner.frame, owners: [owner] };
  const colorAsset = makeAsset('up-color', 200, 200);
  const monoAsset = makeAsset('up-mono', 200, 200);

  const next = applyRasterUpscaleLayers(scene, [
    { owner, layer: sourceColor, bbox: { x: 0, y: 0, w: 100, h: 100 }, asset: colorAsset, outputMode: 'color' },
    { owner, layer: sourceMono, bbox: { x: 0, y: 0, w: 100, h: 100 }, asset: monoAsset, outputMode: 'monochrome' },
  ]);

  const updated = next.owners[0].paint;
  assert.equal(updated.layers.length, 4);
  assert.equal(updated.layers[0].id, sourceColor.id);
  assert.equal(updated.layers[0].visible, false);
  assert.equal(updated.layers[1].name, '下絵（高精細）');
  assert.equal(updated.layers[1].kind, 'raster');
  assert.equal(updated.layers[1].antialias, 3);
  assert.equal(updated.layers[1].image?.assetId, 'up-color');

  assert.equal(updated.layers[2].id, sourceMono.id);
  assert.equal(updated.layers[2].visible, false);
  assert.equal(updated.layers[3].name, '線画元（高精細）');
  assert.equal(updated.layers[3].kind, 'raster');
  assert.equal(updated.layers[3].antialias, 0);
  assert.equal(updated.layers[3].image?.assetId, 'up-mono');

  assert.doesNotThrow(() => validatePaintDocument(updated, [colorAsset, monoAsset]));

  const fullLayers = Array.from({ length: 64 }, (_, i) => newPaintLayer(`L${i}`));
  const fullOwner = { ...owner, paint: { version: 1, width: 200, height: 200, dpi: 300, layers: fullLayers } };
  assert.throws(
    () =>
      applyRasterUpscaleLayers(
        { frame: owner.frame, owners: [fullOwner] },
        [{ owner: fullOwner, layer: fullLayers[0], bbox: { x: 0, y: 0, w: 50, h: 50 }, asset: colorAsset, outputMode: 'color' }],
      ),
    /上限（64）/,
  );
});

test('LAN server exposes /api/raster-upscale supervisor route', () => {
  assert.ok(SUPERVISOR_PATHS.has('/api/raster-upscale'));
});

test('line_trace_upscale.py handles opaque RGB, transparent RGBA, and transparent monochrome outputs', (t) => {
  const repoRoot = resolve(import.meta.dirname, '..');
  const visionRoot = resolve(repoRoot, '.local-vision');
  const python = resolve(visionRoot, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  const script = resolve(repoRoot, 'scripts/line_trace_upscale.py');
  if (!existsSync(python)) {
    t.skip('.local-vision/.venv python is not installed in this environment');
    return;
  }

  const pyProbe = `
import base64, io, json, subprocess, sys
import numpy as np
from PIL import Image

script = sys.argv[1]
vision_root = sys.argv[2]

def to_url(img):
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')

def from_url(url):
    _, b64 = url.split(',', 1)
    return Image.open(io.BytesIO(base64.b64decode(b64)))

def call(payload):
    out = subprocess.check_output([sys.executable, '-B', script, vision_root], input=json.dumps(payload).encode('utf-8'))
    return json.loads(out.decode('utf-8'))

# 1. Opaque RGB -> 2x RGB
rgb = Image.new('RGB', (48, 32), (255, 255, 255))
arr = np.asarray(rgb).copy()
arr[10:22, 16:32] = (30, 80, 160)
res_rgb = call({'image': to_url(Image.fromarray(arr, 'RGB')), 'mode': 'ai2x', 'preserveAlpha': True, 'outputMode': 'color'})
out_rgb = from_url(res_rgb['image'])
assert res_rgb['width'] == 96 and res_rgb['height'] == 64, res_rgb
assert out_rgb.size == (96, 64) and out_rgb.mode == 'RGB', (out_rgb.size, out_rgb.mode)

# 2. Transparent RGBA -> 2x RGBA color with transparent corner & opaque center
rgba = Image.new('RGBA', (48, 32), (0, 0, 0, 0))
arr_a = np.asarray(rgba).copy()
arr_a[10:22, 16:32] = (20, 20, 20, 255)
rgba_url = to_url(Image.fromarray(arr_a, 'RGBA'))
res_rgba = call({'image': rgba_url, 'mode': 'ai2x', 'preserveAlpha': True, 'outputMode': 'color'})
out_rgba = from_url(res_rgba['image'])
assert res_rgba['width'] == 96 and res_rgba['height'] == 64, res_rgba
assert out_rgba.size == (96, 64) and out_rgba.mode == 'RGBA', (out_rgba.size, out_rgba.mode)
out_a = np.asarray(out_rgba)
assert int(out_a[0, 0, 3]) <= 4, f'corner alpha expected ~0, got {out_a[0, 0, 3]}'
assert int(out_a[32, 48, 3]) > 200, f'center alpha expected >200, got {out_a[32, 48, 3]}'

# 3. Transparent RGBA -> 2x RGBA monochrome (pure black ink, transparent background)
res_mono = call({'image': rgba_url, 'mode': 'ai2x', 'preserveAlpha': True, 'outputMode': 'monochrome', 'threshold': 180})
out_mono = from_url(res_mono['image'])
assert res_mono['width'] == 96 and res_mono['height'] == 64, res_mono
assert out_mono.size == (96, 64) and out_mono.mode == 'RGBA', (out_mono.size, out_mono.mode)
mono_arr = np.asarray(out_mono)
assert tuple(int(v) for v in mono_arr[0, 0]) == (0, 0, 0, 0), mono_arr[0, 0]
assert tuple(int(v) for v in mono_arr[32, 48]) == (0, 0, 0, 255), mono_arr[32, 48]

print('OK', res_rgb['modeUsed'], res_rgba['modeUsed'], res_mono['modeUsed'])
`;
  const result = execFileSync(python, ['-c', pyProbe, script, visionRoot], { encoding: 'utf8' });
  assert.match(result, /^OK /);
});
