import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('bridgeの読取専用checkは稼働中の所有記録を取得・削除しない', () => {
  const root = mkdtempSync(join(tmpdir(), 'cih-bridge-check-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, '.astro'));
    for (const name of ['start-local-bridge.mjs', 'process-lifecycle.mjs']) {
      copyFileSync(new URL(`../scripts/${name}`, import.meta.url), join(root, 'scripts', name));
    }
    // A tiny JS child exercises launcher ownership only; no Python/model is loaded.
    writeFileSync(join(root, 'scripts', 'nyamuru_local_bridge.py'), 'console.log(JSON.stringify(process.argv.slice(2)));');
    const record = join(root, '.astro', 'nyamuru-bridge-process.json');
    const before = JSON.stringify({ pid: process.pid, marker: 'untouched owner' });
    writeFileSync(record, before);
    const run = (args) => spawnSync(process.execPath, [join(root, 'scripts', 'start-local-bridge.mjs'), ...args], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, NYAMURU_BRIDGE_PYTHON: process.execPath },
    });
    for (const flag of ['--check', '--check-vlm']) {
      const result = run([flag]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), [flag]);
      assert.equal(readFileSync(record, 'utf8'), before);
    }
    const duplicate = run([]);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /すでに起動/);
    assert.equal(readFileSync(record, 'utf8'), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
