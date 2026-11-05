import { llmOwnershipMode } from './local-llm-supervisor.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const BRIDGE_SERVICE = 'nyamuru-image-hub-local-bridge';

const BRIDGE_PROTOCOL_VERSION = 3;

export const DEFAULT_BRIDGE_HOST = '127.0.0.1';

export const DEFAULT_BRIDGE_PORT = 8787;

const DEFAULT_BRIDGE_URL = `http://${DEFAULT_BRIDGE_HOST}:${DEFAULT_BRIDGE_PORT}`;

export const DEFAULT_LLM_URL = 'http://127.0.0.1:8080/v1/chat/completions';

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

export async function checkBridgeState(
  bridgeUrl = DEFAULT_BRIDGE_URL,
  timeoutMs = 700,
  expectedLlmMode = llmOwnershipMode(),
  expectedLlmUrl = process.env.NYAMURU_PANEL_ACTION_LLM_URL || DEFAULT_LLM_URL,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${bridgeUrl}/api/health`, { signal: controller.signal });
    if (!response.ok) return 'foreign';
    const payload = await response.json().catch(() => ({}));
    return payload.service === BRIDGE_SERVICE
      && payload.layout_protocol_version === BRIDGE_PROTOCOL_VERSION
      && payload.image_generation_lifecycle_version === 2
      && payload.panel_action_llm_mode === expectedLlmMode
      && payload.panel_action_llm_url === expectedLlmUrl
      ? 'ready'
      : 'foreign';
  } catch {
    return 'missing';
  } finally {
    clearTimeout(timer);
  }
}

async function portIsAvailable(host, port) {
  const probe = createServer();
  return new Promise((resolveAvailability) => {
    let settled = false;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      resolveAvailability(available);
    };
    probe.once('error', () => finish(false));
    probe.listen(port, host, () => probe.close(() => finish(true)));
  });
}

export async function selectLocalBridgeTarget({
  host = DEFAULT_BRIDGE_HOST,
  preferredPort = DEFAULT_BRIDGE_PORT,
  maxFallbacks = 20,
  checkState = (url) => checkBridgeState(url),
  canListen = (candidateHost, candidatePort) => portIsAvailable(candidateHost, candidatePort),
} = {}) {
  if (!Number.isSafeInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
    throw new Error(`NYAMURU_BRIDGE_PORTが正しくありません: ${preferredPort}`);
  }
  for (let offset = 0; offset <= maxFallbacks && preferredPort + offset <= 65535; offset += 1) {
    const port = preferredPort + offset;
    const url = `http://${host}:${port}`;
    if (await checkState(url) === 'ready') return { host, port, url, reused: true };
    if (await canListen(host, port)) return { host, port, url, reused: false };
  }
  throw new Error(`ローカル連携用の空きポートが見つかりません（${preferredPort}から${Math.min(65535, preferredPort + maxFallbacks)}）`);
}

export function launchBridgeProcess(repoRoot, bridgePort) {
  const child = spawn(process.execPath, [resolve(repoRoot, 'scripts/start-local-bridge.mjs'), '--port', String(bridgePort)], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  child.nyamuruSpawnError = null;
  child.once('error', (error) => { child.nyamuruSpawnError = error; });
  return child;
}

export function bridgeProcessIsRunning(child) {
  return child.exitCode === null && child.signalCode === null && !child.nyamuruSpawnError;
}

export async function waitForBridgeProcess(child, bridgeUrl, expectedLlmMode, expectedLlmUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.nyamuruSpawnError) throw child.nyamuruSpawnError;
    if (!bridgeProcessIsRunning(child)) throw new Error('ローカル連携が起動前に終了しました');
    const state = await checkBridgeState(bridgeUrl, 350, expectedLlmMode, expectedLlmUrl);
    if (state === 'ready') return;
    if (state === 'foreign') throw new Error('起動したローカル連携を確認できませんでした');
    await delay(100);
  }
  throw new Error('ローカル連携の起動が時間内に完了しませんでした');
}

export async function stopBridgeProcess(child) {
  if (!bridgeProcessIsRunning(child)) return;
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.kill('SIGTERM');
  const completed = await Promise.race([exited.then(() => true), delay(6_000).then(() => false)]);
  if (!completed && bridgeProcessIsRunning(child)) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(1_000)]);
  }
}
