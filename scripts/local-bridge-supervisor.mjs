import { existingComfyLauncher, LocalComfyController } from './local-comfy-supervisor.mjs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { DEFAULT_BRIDGE_PORT, DEFAULT_BRIDGE_HOST, DEFAULT_LLM_URL, checkBridgeState, launchBridgeProcess, waitForBridgeProcess, stopBridgeProcess, bridgeProcessIsRunning } from './bridge-process.mjs';
import { LocalLlmController, llmOwnershipMode } from './local-llm-supervisor.mjs';
import { BridgeLeaseController, PanelActionLeaseController } from './bridge-lease-controller.mjs';
import { createServer } from 'node:http';

export const BRIDGE_SUPERVISOR_SERVICE = 'nyamuru-image-hub-bridge-supervisor';

export const BRIDGE_SUPERVISOR_PROTOCOL_VERSION = 1;

export function isAllowedLifecycleOrigin(origin) {
  if (!origin) return true;
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(origin);
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

export { BridgeLeaseController, PanelActionLeaseController } from './bridge-lease-controller.mjs';
export { checkBridgeState, selectLocalBridgeTarget } from './bridge-process.mjs';
