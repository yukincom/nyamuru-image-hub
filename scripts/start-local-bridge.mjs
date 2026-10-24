import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimRunState, signalExitCode, watchInitialParent } from './process-lifecycle.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const visionRoot = resolve(process.env.NYAMURU_VISION_ROOT || resolve(repoRoot, '.local-vision'));
const pythonRelativePath = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
const visionPython = resolve(visionRoot, '.venv', pythonRelativePath);
const python = process.env.NYAMURU_BRIDGE_PYTHON || visionPython;
const runStatePath = resolve(process.env.NYAMURU_BRIDGE_RUN_STATE || resolve(repoRoot, '.astro', 'nyamuru-bridge-process.json'));

if (!process.env.NYAMURU_BRIDGE_PYTHON && !existsSync(python)) {
  console.error('ローカル画像解析環境が見つかりません。先に `npm run setup:vision` を実行してください。');
  process.exit(1);
}

// Read-only diagnostics neither listen nor own the running bridge's process record.
const checkOnly = process.argv.slice(2).some((arg) => arg === '--check' || arg === '--check-vlm');
const releaseRunState = checkOnly ? () => {} : claimRunState(runStatePath, 'Nyamuru Image Hubローカルbridge');
const childEnv = {
  ...process.env,
  NYAMURU_BRIDGE_PARENT_PID: String(process.pid),
};

const child = spawn(
  python,
  [resolve(repoRoot, 'scripts/nyamuru_local_bridge.py'), ...process.argv.slice(2)],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: childEnv,
    detached: process.platform !== 'win32',
  },
);

let stopping = false;
let requestedExitCode = 0;
let forceTimer;
let stopWatchingParent = () => {};

const forceChildTree = () => {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  } catch {
    // 既に終了済み。
  }
};

const stopChild = (signal, exitCode = signalExitCode(signal)) => {
  if (stopping) {
    forceChildTree();
    return;
  }
  stopping = true;
  requestedExitCode = exitCode;
  stopWatchingParent();
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  forceTimer = setTimeout(forceChildTree, 5_000);
  forceTimer.unref();
};
stopWatchingParent = watchInitialParent(() => stopChild('SIGTERM', 0));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
  process.on(signal, () => stopChild(signal));
}
process.once('exit', () => {
  stopWatchingParent();
  clearTimeout(forceTimer);
  forceChildTree();
  releaseRunState();
});
child.on('error', (error) => {
  stopWatchingParent();
  clearTimeout(forceTimer);
  releaseRunState();
  console.error(`ローカルbridgeを起動できませんでした: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  stopWatchingParent();
  clearTimeout(forceTimer);
  // bridge本体が予期せず終了しても、同じprocess groupのモデルワーカーを残さない。
  forceChildTree();
  releaseRunState();
  process.exitCode = stopping ? requestedExitCode : (code ?? (signal ? signalExitCode(signal) : 1));
});
