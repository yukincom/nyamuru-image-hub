import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { LocalLlmController, llmOwnershipMode } from './local-llm-supervisor.mjs';
import { existingComfyLauncher, LocalComfyController } from './local-comfy-supervisor.mjs';

export const BRIDGE_SUPERVISOR_SERVICE = 'nyamuru-image-hub-bridge-supervisor';
export const BRIDGE_SUPERVISOR_PROTOCOL_VERSION = 1;
const BRIDGE_SERVICE = 'nyamuru-image-hub-local-bridge';
const BRIDGE_PROTOCOL_VERSION = 3;
const DEFAULT_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_BRIDGE_PORT = 8787;
const DEFAULT_BRIDGE_URL = `http://${DEFAULT_BRIDGE_HOST}:${DEFAULT_BRIDGE_PORT}`;
const DEFAULT_LLM_URL = 'http://127.0.0.1:8080/v1/chat/completions';

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

export function isAllowedLifecycleOrigin(origin) {
  if (!origin) return true;
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(origin);
}

export class BridgeLeaseController {
  constructor({ checkBridge, launchBridge, waitForBridge, stopBridge, bridgeIsRunning, createToken = randomUUID }) {
    this.checkBridge = checkBridge;
    this.launchBridge = launchBridge;
    this.waitForBridge = waitForBridge;
    this.stopBridge = stopBridge;
    this.bridgeIsRunning = bridgeIsRunning;
    this.createToken = createToken;
    this.bridgeChild = null;
    this.ensureTask = null;
    this.leases = new Set();
    this.queue = Promise.resolve();
    this.closed = false;
  }

  exclusive(task) {
    const next = this.queue.then(task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async ensureBridge() {
    if (this.ensureTask) return this.ensureTask;
    this.ensureTask = (async () => {
      if (this.bridgeChild && !this.bridgeIsRunning(this.bridgeChild)) this.bridgeChild = null;
      const state = await this.checkBridge();
      if (state === 'ready') return { managed: Boolean(this.bridgeChild), started: false };
      if (state === 'foreign') throw new Error('ポート8787で別のローカルサービスが起動しています');

      const child = this.launchBridge();
      this.bridgeChild = child;
      try {
        await this.waitForBridge(child);
      } catch (error) {
        if (this.bridgeChild === child) this.bridgeChild = null;
        await this.stopBridge(child).catch(() => undefined);
        throw error;
      }
      return { managed: true, started: true };
    })();
    try {
      return await this.ensureTask;
    } finally {
      this.ensureTask = null;
    }
  }

  async acquire() {
    return this.exclusive(async () => {
      if (this.closed) throw new Error('ローカル起動管理は終了しています');
      const readiness = await this.ensureBridge();
      const token = this.createToken();
      this.leases.add(token);
      return { token, ...readiness };
    });
  }

  async release(token) {
    return this.exclusive(async () => {
      const released = this.leases.delete(token);
      if (!released || this.leases.size || !this.bridgeChild) return { released, stopped: false };
      const child = this.bridgeChild;
      this.bridgeChild = null;
      await this.stopBridge(child);
      return { released: true, stopped: true };
    });
  }

  async close() {
    this.closed = true;
    return this.exclusive(async () => {
      this.leases.clear();
      if (!this.bridgeChild) return;
      const child = this.bridgeChild;
      this.bridgeChild = null;
      await this.stopBridge(child);
    });
  }
}

/** Tie an app-owned text model to the explicit operation leases that requested it. */
export class PanelActionLeaseController {
  constructor({ llmController, bridgeLeases }) {
    this.llmController = llmController;
    this.bridgeLeases = bridgeLeases;
    this.leases = new Map();
    this.queue = Promise.resolve();
    this.closed = false;
    this.imageToken = null;
    this.imageRecovery = null;
    this.imageShutdown = null;
  }

  exclusive(task) {
    const next = this.queue.then(task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async prepare(token, requestedAlias = '') {
    if (this.imageToken) throw new Error('画像生成が終わり、文章LLMが復帰するまでお待ちください');
    return this.exclusive(async () => {
      if (this.imageToken) throw new Error('画像生成が終わり、文章LLMが復帰するまでお待ちください');
      if (this.closed || !this.bridgeLeases.has(token)) {
        throw new Error('先にローカル連携を準備してください');
      }
      const requestedModel = typeof this.llmController.modelIdentity === 'function'
        ? this.llmController.modelIdentity(requestedAlias)
        : requestedAlias;
      const current = this.leases.get(token);
      if (current) {
        if (current.modelAlias !== requestedModel) throw new Error('この操作では別のLLMモデルがすでに準備されています');
        return current;
      }
      if ([...this.leases.values()].some(readiness => readiness.modelAlias !== requestedModel)) {
        throw new Error('別のLLMモデルを使う操作が実行中です');
      }
      const readiness = await this.llmController.ensure(requestedAlias);
      // A cancelled operation must not leave a late-starting model resident.
      if (!this.bridgeLeases.has(token)) {
        if (!this.leases.size) await this.llmController.unload();
        throw new Error('ローカル連携の利用が終了しています');
      }
      this.leases.set(token, readiness);
      return readiness;
    });
  }

  async suspendForImages(token, { requiresLlm = true } = {}) {
    return this.exclusive(async () => {
      if (this.closed || !this.bridgeLeases.has(token) || requiresLlm && !this.leases.has(token)) {
        throw new Error('先に画像生成指示の英訳を準備してください');
      }
      if (this.imageToken === token) return;
      if (this.imageToken || this.leases.size !== Number(this.leases.has(token))) throw new Error('別の文章処理が実行中です。完了後に生成してください');
      this.imageToken = token;
      this.imageShutdown = new AbortController();
      try {
        this.imageRecovery = await this.llmController.suspendForImages(token, { signal: this.imageShutdown.signal });
      } catch (error) {
        this.imageToken = null;
        this.imageShutdown = null;
        throw error;
      }
    });
  }

  async submitImage(token, submit) {
    // Keep release/pagehide behind the in-flight bridge submission. Its uploads
    // can take time even while the Comfy queue still appears empty.
    return this.exclusive(async () => {
      if (this.closed || this.imageToken !== token || !this.imageRecovery) throw new Error('画像生成の一時停止情報がありません');
      return submit();
    });
  }

  async release(token, { shutdown = false } = {}) {
    // Shutdown must reach a guardian even while submit/resume holds the queue.
    if (shutdown && this.imageToken === token) this.imageShutdown?.abort();
    return this.exclusive(async () => {
      const released = this.leases.delete(token);
      if (this.imageToken === token) {
        try {
          const restored = await (shutdown || this.closed || this.imageShutdown?.signal.aborted
            ? this.imageRecovery.shutdown() : this.imageRecovery.resume());
          return { released, stopped: true, restored };
        } finally {
          this.imageToken = null;
          this.imageRecovery = null;
          this.imageShutdown = null;
        }
      }
      if (!released || this.leases.size) return { released, stopped: false };
      return { released: true, stopped: await this.llmController.unload() };
    });
  }

  async close() {
    this.closed = true;
    this.imageShutdown?.abort();
    return this.exclusive(async () => {
      this.leases.clear();
      try { await this.imageRecovery?.shutdown(); }
      finally {
        this.imageToken = null;
        this.imageRecovery = null;
        this.imageShutdown = null;
        await this.llmController.close();
      }
    });
  }
}

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

function launchBridgeProcess(repoRoot, bridgePort) {
  const child = spawn(process.execPath, [resolve(repoRoot, 'scripts/start-local-bridge.mjs'), '--port', String(bridgePort)], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  child.nyamuruSpawnError = null;
  child.once('error', (error) => { child.nyamuruSpawnError = error; });
  return child;
}

function bridgeProcessIsRunning(child) {
  return child.exitCode === null && child.signalCode === null && !child.nyamuruSpawnError;
}

async function waitForBridgeProcess(child, bridgeUrl, expectedLlmMode, expectedLlmUrl) {
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

async function stopBridgeProcess(child) {
  if (!bridgeProcessIsRunning(child)) return;
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.kill('SIGTERM');
  const completed = await Promise.race([exited.then(() => true), delay(6_000).then(() => false)]);
  if (!completed && bridgeProcessIsRunning(child)) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(1_000)]);
  }
}

function jsonResponse(response, status, payload, origin) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
  response.end(`${JSON.stringify(payload)}\n`);
}

async function jsonBody(request, maximum = 8_192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw new Error('要求が大きすぎます');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function finishMangaRaster(repoRoot, body, signal) {
  const { root } = await existingComfyLauncher('http://127.0.0.1:8188');
  const python = process.env.NYAMURU_BRIDGE_PYTHON || resolve(process.env.NYAMURU_VISION_ROOT || resolve(repoRoot, '.local-vision'),
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  signal.throwIfAborted();
  return new Promise((done, fail) => {
    const child = execFile(python, ['-B', resolve(repoRoot, 'scripts/manga_finish.py'), root], {
      signal, timeout: 120_000, maxBuffer: 96 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) return fail(new Error(stderr.trim() || 'MangaScreenの画像処理を実行できませんでした'));
      try { done(JSON.parse(stdout)); } catch { fail(new Error('MangaScreenの処理結果を読み込めませんでした')); }
    });
    // A worker can exit before consuming stdin (for example if its environment is missing).
    child.stdin.on('error', fail);
    child.stdin.end(JSON.stringify(body));
  });
}

export async function startLocalBridgeSupervisor({
  repoRoot,
  host = '127.0.0.1',
  port = 8786,
  bridgePort = DEFAULT_BRIDGE_PORT,
  bridgeUrl = `http://${DEFAULT_BRIDGE_HOST}:${bridgePort}`,
  llmController = new LocalLlmController(),
  comfyController,
} = {}) {
  if (!repoRoot) throw new Error('bridge supervisorにはリポジトリの場所が必要です');
  const expectedLlmMode = llmController.ownershipMode || llmOwnershipMode();
  const expectedLlmUrl = llmController.env?.NYAMURU_PANEL_ACTION_LLM_URL
    || process.env.NYAMURU_PANEL_ACTION_LLM_URL
    || DEFAULT_LLM_URL;
  const controller = new BridgeLeaseController({
    checkBridge: () => checkBridgeState(bridgeUrl, 700, expectedLlmMode, expectedLlmUrl),
    launchBridge: () => launchBridgeProcess(repoRoot, bridgePort),
    waitForBridge: (child) => waitForBridgeProcess(child, bridgeUrl, expectedLlmMode, expectedLlmUrl),
    stopBridge: stopBridgeProcess,
    bridgeIsRunning: bridgeProcessIsRunning,
  });
  const panelActions = new PanelActionLeaseController({
    llmController,
    bridgeLeases: controller.leases,
  });
  const comfy = comfyController ?? new LocalComfyController({repoRoot,busy:()=>Boolean(panelActions.imageToken)});
  const runtimeOperations = new Map();
  let mangaFinish = null;
  const forgetOperation = token => {
    for(const operations of runtimeOperations.values()) operations.delete(token);
  };

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (!isAllowedLifecycleOrigin(origin)) {
      jsonResponse(response, 403, { ok: false, error: 'この画面からは操作できません' });
      return;
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.end();
      return;
    }

    const pathname = new URL(request.url || '/', `http://${host}:${port}`).pathname;
    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        jsonResponse(response, 200, {
          ok: true,
          service: BRIDGE_SUPERVISOR_SERVICE,
          protocol_version: BRIDGE_SUPERVISOR_PROTOCOL_VERSION,
          comfy_lifecycle_version: 1,
        }, origin);
        return;
      }
      if (request.method === 'POST' && pathname === '/api/manga-finish') {
        if (mangaFinish) {
          jsonResponse(response, 409, { ok: false, error: '別の漫画仕上げの完了をお待ちください' }, origin);
          return;
        }
        const operation = new AbortController();
        mangaFinish = operation;
        response.once('close', () => operation.abort());
        try {
          const body = await jsonBody(request, 96 * 1024 * 1024);
          const result = await finishMangaRaster(repoRoot, body, operation.signal);
          if (!response.destroyed) jsonResponse(response, 200, {
            ...result, ok: true, service: BRIDGE_SUPERVISOR_SERVICE, protocol_version: BRIDGE_SUPERVISOR_PROTOCOL_VERSION,
          }, origin);
        } finally {
          mangaFinish = null;
        }
        return;
      }
      if(request.method === 'POST' && pathname === '/api/image-generation/start') {
        const body = await jsonBody(request);
        if(typeof body.session_token !== 'string' || typeof body.comfyui_url !== 'string') throw new Error('生成画面の起動情報がありません');
        const result = await comfy.acquire(body.session_token,body.comfyui_url);
        if(response.destroyed) { await comfy.release(body.session_token); return; }
        jsonResponse(response,200,{
          ok:true,service:BRIDGE_SUPERVISOR_SERVICE,protocol_version:BRIDGE_SUPERVISOR_PROTOCOL_VERSION,
          session_token:body.session_token,comfy_ready:true,comfy_started:result.started,comfy_managed:result.managed,
        },origin);
        return;
      }
      if(request.method === 'POST' && pathname === '/api/image-generation/stop') {
        const body = await jsonBody(request);
        if(typeof body.session_token !== 'string' || !body.session_token) throw new Error('生成画面の終了情報がありません');
        // Abort the guardian immediately, including while prepare/submit owns its queue.
        const operations = [...(runtimeOperations.get(body.session_token) ?? [])];
        const cleanup = operations.map(async token => {
          try { await panelActions.release(token,{shutdown:true}); }
          finally { await controller.release(token); forgetOperation(token); }
        });
        const release = comfy.release(body.session_token);
        const outcomes = await Promise.allSettled([...cleanup,release]);
        const last = outcomes.at(-1);
        const result = last.status === 'fulfilled' ? last.value : null;
        runtimeOperations.delete(body.session_token);
        const failed = outcomes.find(item=>item.status === 'rejected');
        if(failed) throw failed.reason;
        jsonResponse(response,200,{
          ok:true,service:BRIDGE_SUPERVISOR_SERVICE,protocol_version:BRIDGE_SUPERVISOR_PROTOCOL_VERSION,
          comfy_released:result.released,comfy_stopped:result.stopped,
        },origin);
        return;
      }
      if(request.method === 'POST' && pathname === '/api/image-generation/progress') {
        const body = await jsonBody(request);
        const progress = comfy.progress(body.session_token,body);
        jsonResponse(response,200,{service:BRIDGE_SUPERVISOR_SERVICE,protocol_version:BRIDGE_SUPERVISOR_PROTOCOL_VERSION,...progress},origin);
        return;
      }
      if (request.method === 'POST' && pathname === '/api/new-creation/start') {
        const body = await jsonBody(request);
        const runtime = body.session_token;
        if(runtime !== undefined && !comfy.leases.has(runtime)) throw new Error('生成画面の利用が終了しています');
        const result = await controller.acquire();
        if(runtime !== undefined) {
          if(!comfy.leases.has(runtime) || comfy.cancelled?.has(runtime)) { await controller.release(result.token); throw new Error('生成画面の利用が終了しています'); }
          if(!runtimeOperations.has(runtime)) runtimeOperations.set(runtime,new Set());
          runtimeOperations.get(runtime).add(result.token);
        }
        if (response.destroyed) {
          await controller.release(result.token);
          return;
        }
        jsonResponse(response, 200, {
          ok: true,
          service: BRIDGE_SUPERVISOR_SERVICE,
          protocol_version: BRIDGE_SUPERVISOR_PROTOCOL_VERSION,
          lease_token: result.token,
          bridge_started: result.started,
          bridge_managed: result.managed,
        }, origin);
        return;
      }
      if (request.method === 'POST' && pathname === '/api/new-creation/stop') {
        const body = await jsonBody(request);
        const token = typeof body.lease_token === 'string' ? body.lease_token : '';
        if (!token) {
          jsonResponse(response, 400, { ok: false, error: '終了用トークンがありません' }, origin);
          return;
        }
        let llm;
        let llmError;
        if (body.shutdown !== undefined && typeof body.shutdown !== 'boolean') throw new Error('終了理由が不正です');
        try {
          llm = await panelActions.release(token, { shutdown: body.shutdown === true });
        } catch (error) {
          llmError = error;
        }
        // Always release the bridge lease even when unloading the owned LLM reports an error.
        const result = await controller.release(token);
        forgetOperation(token);
        if (llmError) throw llmError;
        jsonResponse(response, 200, {
          ok: true,
          service: BRIDGE_SUPERVISOR_SERVICE,
          protocol_version: BRIDGE_SUPERVISOR_PROTOCOL_VERSION,
          ...result,
          llm_released: llm.released,
          llm_stopped: llm.stopped,
          llm_restored: llm.restored === true,
        }, origin);
        return;
      }
      if (request.method === 'POST' && pathname === '/api/image-generation/prepare') {
        const body = await jsonBody(request);
        if (typeof body?.lease_token !== 'string') throw new Error('画像生成の利用情報がありません');
        if(body.requires_llm !== undefined && typeof body.requires_llm !== 'boolean')throw new Error('文章LLMの準備指定が不正です');
        await panelActions.suspendForImages(body.lease_token, { requiresLlm: body.requires_llm !== false });
        // Page exit requests cleanup without restoration, including through LAN.
        jsonResponse(response, 200, {
          ok: true, service: BRIDGE_SUPERVISOR_SERVICE, protocol_version: BRIDGE_SUPERVISOR_PROTOCOL_VERSION,
          llm_stopped: true,
        }, origin);
        return;
      }
      if (request.method === 'POST' && pathname === '/api/image-generation/submit') {
        const body = await jsonBody(request, 96 * 1024 * 1024);
        if (typeof body?.lease_token !== 'string' || !body.payload || typeof body.payload !== 'object') throw new Error('画像生成の入力がありません');
        const result = await panelActions.submitImage(body.lease_token, async () => {
          const forwarded = await fetch(`${bridgeUrl}/api/qwen-generation/submit`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body.payload, image_session_token: body.lease_token }),
            signal: AbortSignal.timeout(180_000), redirect: 'error',
          });
          return { status: forwarded.status, payload: await forwarded.json() };
        });
        jsonResponse(response, result.status, {
          ...result.payload,
          // The bridge's service marker must not replace the supervisor envelope.
          service: BRIDGE_SUPERVISOR_SERVICE, protocol_version: BRIDGE_SUPERVISOR_PROTOCOL_VERSION,
        }, origin);
        return;
      }
      if (request.method === 'POST' && pathname === '/api/panel-actions/prepare') {
        const body = await jsonBody(request);
        if (typeof body?.lease_token !== 'string' || !controller.leases.has(body.lease_token)) {
          jsonResponse(response, 400, { ok: false, error: '先にローカル連携を準備してください' }, origin);
          return;
        }
        const modelAlias = typeof body.llm_model_alias === 'string' ? body.llm_model_alias.trim() : '';
        if (!modelAlias || modelAlias.length > 120 || !/^[A-Za-z0-9._+-]+$/u.test(modelAlias)) {
          jsonResponse(response, 400, { ok: false, error: 'LLMモデルのエイリアスが正しくありません' }, origin);
          return;
        }
        const result = await panelActions.prepare(body.lease_token, modelAlias);
        if (response.destroyed) return;
        jsonResponse(response, 200, {
          ok: true, service: BRIDGE_SUPERVISOR_SERVICE, protocol_version: BRIDGE_SUPERVISOR_PROTOCOL_VERSION,
          llm_started: result.started, llm_managed: result.managed, llm_model_alias: result.modelAlias,
          llm_mode: result.ownershipMode || 'managed',
        }, origin);
        return;
      }
      jsonResponse(response, 404, { ok: false, error: '操作が見つかりません' }, origin);
    } catch (error) {
      jsonResponse(response, 503, {
        ok: false,
        error: error instanceof Error ? error.message : 'ローカル連携を操作できませんでした',
      }, origin);
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  let closed = false;
  return {
    url: `http://${host}:${server.address().port}`,
    async close() {
      if (closed) return;
      closed = true;
      mangaFinish?.abort();
      await Promise.all([
        new Promise((resolveClose) => server.close(() => resolveClose())),
        controller.close(),
        (async()=>{try{await panelActions.close();}finally{await comfy.close();}})(),
      ]);
    },
  };
}
