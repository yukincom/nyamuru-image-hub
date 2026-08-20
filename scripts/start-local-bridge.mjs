import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const visionRoot = resolve(process.env.NYAMURU_VISION_ROOT || resolve(repoRoot, '.local-vision'));
const pythonRelativePath = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
const visionPython = resolve(visionRoot, '.venv', pythonRelativePath);
const python = process.env.NYAMURU_BRIDGE_PYTHON || visionPython;

if (!process.env.NYAMURU_BRIDGE_PYTHON && !existsSync(python)) {
  console.error('ローカル画像解析環境が見つかりません。先に `npm run setup:vision` を実行してください。');
  process.exit(1);
}

const child = spawn(
  python,
  [resolve(repoRoot, 'scripts/nyamuru_local_bridge.py'), ...process.argv.slice(2)],
  { cwd: repoRoot, stdio: 'inherit', env: process.env },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => process.exitCode = signal ? 1 : (code ?? 1));
