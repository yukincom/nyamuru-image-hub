import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolsRoot = resolve(repoRoot, '..');
const mangaBabbleRoot = resolve(process.env.NYAMURU_MANGA_BABBLE_ROOT || resolve(toolsRoot, 'manga-babble-maker'));
const bundledPython = resolve(mangaBabbleRoot, '.venv/bin/python');
const python = process.env.NYAMURU_BRIDGE_PYTHON || bundledPython;

if (!process.env.NYAMURU_BRIDGE_PYTHON && !existsSync(bundledPython)) {
  console.error('manga-babble-makerのPython環境が見つかりません。NYAMURU_MANGA_BABBLE_ROOTまたはNYAMURU_BRIDGE_PYTHONを指定してください。');
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
