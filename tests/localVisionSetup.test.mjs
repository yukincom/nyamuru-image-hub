import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  MODEL_REVISION,
  MODEL_SHA256,
  parseSetupArgs,
  visionLayout,
} from '../scripts/setup-local-vision.mjs';


test('vision setup keeps models and external OCR under one ignored root', () => {
  const root = resolve('/tmp/nyamuru-vision-test');
  const layout = visionLayout(root);
  assert.equal(layout.root, root);
  assert.ok(layout.model.startsWith(root));
  assert.ok(layout.ndlocr.startsWith(root));
  assert.match(layout.python, /\.venv/);
});


test('setup options require an explicit value for a custom root', () => {
  assert.throws(() => parseSetupArgs(['--root']), /保存先/);
  const options = parseSetupArgs(['--yes', '--root', './vision-data']);
  assert.equal(options.yes, true);
  assert.equal(options.root, resolve('./vision-data'));
});


test('model download is pinned and verified', () => {
  assert.match(MODEL_REVISION, /^[0-9a-f]{40}$/);
  assert.match(MODEL_SHA256, /^[0-9a-f]{64}$/);
});
