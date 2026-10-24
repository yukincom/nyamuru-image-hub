import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A detached guardian keeps the original launch data in memory, including after UI/supervisor exit. */
export async function suspendSharedLlm({ env = process.env, port = '8080', restore = true, token = randomUUID(), spawnImpl = spawn } = {}) {
  const python = env.NYAMURU_BRIDGE_PYTHON || resolve(env.NYAMURU_VISION_ROOT || resolve(root, '.local-vision'), '.venv/bin/python');
  const child = spawnImpl(python, [resolve(root, 'scripts/shared_llm_process.py'), restore ? '--session' : '--images-only', String(port),
    resolve(root, '.astro/shared-llm.log'), token], {
    cwd: root, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let readyResolve, readyReject, restoredResolve, restoredReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const restored = new Promise((resolve, reject) => { restoredResolve = resolve; restoredReject = reject; });
  // Restoration may fail before the caller has finished its image operation.
  void restored.catch(() => undefined);
  let finished = false;
  let resumeRequested = false;
  const fail = message => {
    finished = true;
    const error = new Error(message);
    readyReject(error);
    restoredReject(error);
  };
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 16_384) { fail('共有LLMの復帰管理から不正な応答を受け取りました'); child.stdin.end(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let value;
      try { value = JSON.parse(line); } catch { continue; }
      if (value.state === 'paused') readyResolve();
      if (value.state === 'restored') { finished = true; restoredResolve(value.was_running === true); }
      if (value.state === 'error') fail(typeof value.message === 'string' ? value.message : '共有LLMを復帰できませんでした');
    }
  });
  // Never relay argv/environment or native diagnostics to the browser.
  child.stderr.resume();
  child.stdin.on('error', () => {});
  child.once('error', () => fail('共有LLMの復帰管理を起動できませんでした'));
  child.once('close', () => { if (!finished) fail('共有LLMの復帰管理が予期せず終了しました'); });
  // The HTTP caller has a timeout, but recovery must retain its lease until the
  // guardian confirms success/failure. SIGTERM on a slow server cannot be undone.
  await ready;
  return {
    resume() {
      if (!resumeRequested) { resumeRequested = true; child.stdin.end('resume\n'); }
      return restored;
    },
  };
}
