import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  claimRunState,
  processIsAlive,
  signalExitCode,
  watchInitialParent,
} from '../scripts/process-lifecycle.mjs';

test('signalをシェル互換の終了コードへ変換する', () => {
  assert.equal(signalExitCode('SIGINT'), 130);
  assert.equal(signalExitCode('SIGTERM'), 143);
});

test('run stateは同じサーバーの二重起動を拒否し、解放後は再取得できる', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nyamuru-lifecycle-'));
  const statePath = join(directory, 'server.json');
  try {
    const release = claimRunState(statePath, 'test server');
    assert.throws(() => claimRunState(statePath, 'test server'), /すでに起動/);
    release();
    const releaseAgain = claimRunState(statePath, 'test server');
    releaseAgain();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('起動時の親PIDが変わったら一度だけ停止通知する', async () => {
  let currentParent = 42;
  let notifications = 0;
  const stopWatching = watchInitialParent(
    () => { notifications += 1; },
    {
      parentPid: 42,
      currentParentPid: () => currentParent,
      isAlive: () => true,
      intervalMs: 5,
    },
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 12));
    assert.equal(notifications, 0);
    currentParent = 1;
    await new Promise((resolve) => setTimeout(resolve, 12));
    assert.equal(notifications, 1);
    await new Promise((resolve) => setTimeout(resolve, 12));
    assert.equal(notifications, 1);
  } finally {
    stopWatching();
  }
});

test('現在のプロセスだけを生存中と判定できる', () => {
  assert.equal(processIsAlive(process.pid), true);
  assert.equal(processIsAlive(-1), false);
});
