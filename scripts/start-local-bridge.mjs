import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolsRoot = resolve(repoRoot, '..');
const configuredComfyRoot = process.env.NYAMURU_COMFY_ROOT;
const comfyCandidates = [
  configuredComfyRoot,
  resolve(toolsRoot, 'ComfyUI-current'),
  resolve(toolsRoot, 'ComfyUI-v0.32.0'),
  resolve(toolsRoot, 'ComfyUI'),
].filter(Boolean);
const comfyRoot = comfyCandidates.find((candidate) => existsSync(resolve(candidate, 'main.py')));

if (!comfyRoot) {
  console.error('ComfyUIが見つかりません。NYAMURU_COMFY_ROOTにComfyUIのパスを指定してください。');
  process.exit(1);
}

const bundledPython = resolve(comfyRoot, '.venv/bin/python');
const python = existsSync(bundledPython) ? bundledPython : process.env.PYTHON || 'python3';
const child = spawn(
  python,
  [resolve(repoRoot, 'scripts/nyamuru_local_bridge.py'), '--comfy-root', comfyRoot, ...process.argv.slice(2)],
  { cwd: repoRoot, stdio: 'inherit', env: process.env },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => process.exitCode = signal ? 1 : (code ?? 1));
