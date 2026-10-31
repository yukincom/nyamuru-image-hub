/** Hermes foreground command; reuse Nyamuru's jobs and exact-launch restoration. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalLlmController } from './local-llm-supervisor.mjs';

const thisFile = fileURLToPath(import.meta.url);
const root = resolve(dirname(thisFile), '..');
const python = process.env.NYAMURU_BRIDGE_PYTHON || resolve(process.env.NYAMURU_VISION_ROOT || resolve(root, '.local-vision'), '.venv/bin/python');

export async function withImageSession(run, { controller = new LocalLlmController(), token = randomUUID() } = {}) {
  const session = await controller.suspendForImages(token);
  try { return await run(token); }
  finally { await session.resume(); }
}

function worker(args) {
  return new Promise((done, fail) => {
    const child = spawn(python, [resolve(root, 'scripts/hermes_qwen.py'), ...args], {
      cwd: root, env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', part => { output += part; });
    child.once('error', fail);
    child.once('close', code => {
      if (code !== 0) { fail(new Error(`Qwen adapter exited with ${code}; inspect the recorded job before retrying`)); return; }
      try { done(JSON.parse(output)); } catch { fail(new Error('Invalid Qwen adapter response')); }
    });
  });
}

export async function generate(args, { run = worker, session = withImageSession } = {}) {
  const prepared = await run(['prepare', ...args]);
  if (prepared.status === 'succeeded') return prepared;
  if (prepared.status !== 'prepared') throw new Error(`Job is ${prepared.status}; use status, do not resubmit`);
  // The guardian owns recovery if this CLI or the terminal tool disappears.
  return session(token => run(['run', '--job', prepared.job_id, '--image-session-token', token]));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ['--help', '-h'].includes(command)) {
    console.log('Usage: node scripts/hermes_qwen.mjs catalog | preview --request FILE | prepare --request FILE | generate --request FILE | status --job UUID | select --job UUID --candidate 1 | cancel --job UUID');
    return;
  }
  if (!['catalog', 'preview', 'prepare', 'generate', 'status', 'select', 'cancel'].includes(command)) throw new Error('Unknown command');
  const output = command === 'generate' ? await generate(args) : await worker([command, ...args]);
  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
}
