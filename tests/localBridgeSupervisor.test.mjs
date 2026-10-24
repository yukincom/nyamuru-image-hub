import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { submitImageGenerationRequest } from '../src/lib/localBridgeLifecycle.ts';
import {
  BridgeLeaseController,
  PanelActionLeaseController,
  checkBridgeState,
  isAllowedLifecycleOrigin,
  selectLocalBridgeTarget,
  startLocalBridgeSupervisor,
} from '../scripts/local-bridge-supervisor.mjs';

function fakeChild() {
  return { running: true };
}

test('画像生成中は文章処理を拒否し、送信完了後にだけ復帰する', async () => {
  const events = [];
  let complete;
  const submission = new Promise(resolve => { complete = resolve; });
  const controller = new PanelActionLeaseController({ bridgeLeases: new Set(['images', 'text']), llmController: {
    ensure: async () => ({ managed: false, modelAlias: 'same' }),
    suspendForImages: async () => ({ resume: async () => { events.push('resume'); return true; } }),
    unload: async () => false, close: async () => {},
  } });
  await controller.prepare('images', 'same');
  await controller.suspendForImages('images');
  await assert.rejects(() => controller.prepare('text', 'same'), /画像生成/);
  const sending = controller.submitImage('images', async () => { events.push('submit'); await submission; events.push('accepted'); });
  await new Promise(resolve => setImmediate(resolve));
  const releasing = controller.release('images');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['submit']);
  complete(); await sending;
  assert.deepEqual(await releasing, { released: true, stopped: true, restored: true });
  assert.deepEqual(events, ['submit', 'accepted', 'resume']);
  await assert.rejects(() => controller.submitImage('images', async () => {}), /一時停止情報/);
  await controller.prepare('text', 'same');
  await controller.close();
});

test('別の文章処理のleaseが残る間はLLMを停止しない', async () => {
  let suspends = 0;
  const controller = new PanelActionLeaseController({ bridgeLeases: new Set(['a', 'b']), llmController: {
    ensure: async () => ({ modelAlias: 'same' }), suspendForImages: async () => { suspends++; },
    unload: async () => false, close: async () => {},
  } });
  await controller.prepare('a', 'same'); await controller.prepare('b', 'same');
  await assert.rejects(() => controller.suspendForImages('a'), /別の文章処理/);
  assert.equal(suspends, 0);
  await controller.close();
});

test('supervisor終了も画像完了後の復帰を要求し、失敗を隠さない', async () => {
  const events = [];
  const controller = new PanelActionLeaseController({ bridgeLeases: new Set(['a']), llmController: {
    ensure: async () => ({ modelAlias: 'same' }),
    suspendForImages: async () => ({ resume: async () => { events.push('resume'); throw new Error('resume failed'); } }),
    close: async () => { events.push('close'); },
  } });
  await controller.prepare('a', 'same'); await controller.suspendForImages('a');
  await assert.rejects(() => controller.close(), /resume failed/);
  assert.deepEqual(events, ['resume', 'close']);
});

test('画像生成HTTPは準備済みleaseだけを転送し、復帰完了を返す', async t => {
  const received = [];
  const bridge = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/health') {
      response.end(JSON.stringify({ service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3, image_generation_lifecycle_version: 2,
        panel_action_llm_mode: 'auto', panel_action_llm_url: 'http://127.0.0.1:8080/v1/chat/completions' }));
      return;
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    received.push([request.url, JSON.parse(Buffer.concat(chunks))]);
    // The real bridge adds its identity to every JSON response.
    response.end(JSON.stringify({ ok: true, service: 'nyamuru-image-hub-local-bridge',
      layout_protocol_version: 3, status: 'queued', job_id: 'test-job' }));
  });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => bridge.close(resolve)));
  let resumes = 0;
  const supervisor = await startLocalBridgeSupervisor({ repoRoot: process.cwd(), port: 0,
    bridgeUrl: `http://127.0.0.1:${bridge.address().port}`, llmController: {
      ownershipMode: 'auto', modelIdentity: () => 'default_model',
      ensure: async () => ({ modelAlias: 'default_model', ownershipMode: 'external-shared' }),
      suspendForImages: async () => ({ resume: async () => { resumes++; return true; } }),
      unload: async () => false, close: async () => {},
    } });
  t.after(() => supervisor.close());
  const post = async (path, body = {}) => fetch(`${supervisor.url}${path}`, {
    method: 'POST', headers: { Origin: 'http://localhost:4321', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await post('/api/image-generation/prepare', { lease_token: 'missing' })).status, 503);
  const start = await (await post('/api/new-creation/start')).json();
  const lease_token = start.lease_token;
  await post('/api/panel-actions/prepare', { lease_token, llm_model_alias: 'saved-model' });
  assert.equal((await post('/api/image-generation/submit', { lease_token, payload: {} })).status, 503);
  assert.equal((await (await post('/api/image-generation/prepare', { lease_token })).json()).llm_stopped, true);
  const input = { job_id: 'test-job', prompt: 'English' };
  const accepted = await submitImageGenerationRequest(lease_token, input, (url, options) =>
    fetch(`${supervisor.url}${new URL(String(url)).pathname}`, options));
  assert.equal(accepted.service, 'nyamuru-image-hub-bridge-supervisor');
  assert.equal(accepted.protocol_version, 1);
  assert.equal(accepted.status, 'queued');
  assert.equal(accepted.job_id, 'test-job');
  assert.deepEqual(received, [['/api/qwen-generation/submit', { ...input, image_session_token: lease_token }]]);
  const end = await (await post('/api/new-creation/stop', { lease_token })).json();
  assert.equal(end.llm_restored, true); assert.equal(resumes, 1);
});

test('localhostと127.0.0.1の画面だけが起動管理を操作できる', () => {
  assert.equal(isAllowedLifecycleOrigin('http://127.0.0.1:4321'), true);
  assert.equal(isAllowedLifecycleOrigin('http://localhost:4321'), true);
  assert.equal(isAllowedLifecycleOrigin(undefined), true);
  assert.equal(isAllowedLifecycleOrigin('https://example.com'), false);
  assert.equal(isAllowedLifecycleOrigin('null'), false);
});

test('最初の新規作成でbridgeを起動し、最後の終了時だけ停止する', async () => {
  let state = 'missing';
  let launches = 0;
  let stops = 0;
  const controller = new BridgeLeaseController({
    checkBridge: async () => state,
    launchBridge: () => { launches += 1; return fakeChild(); },
    waitForBridge: async () => { state = 'ready'; },
    stopBridge: async (child) => { child.running = false; state = 'missing'; stops += 1; },
    bridgeIsRunning: (child) => child.running,
    createToken: () => `lease-${launches}-${Math.random()}`,
  });

  const first = await controller.acquire();
  const second = await controller.acquire();
  assert.equal(launches, 1);
  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.deepEqual(await controller.release(first.token), { released: true, stopped: false });
  assert.equal(stops, 0);
  assert.deepEqual(await controller.release(second.token), { released: true, stopped: true });
  assert.equal(stops, 1);
});

test('手動で起動済みのbridgeは新規作成終了時に停止しない', async () => {
  let stops = 0;
  const controller = new BridgeLeaseController({
    checkBridge: async () => 'ready',
    launchBridge: () => { throw new Error('起動してはいけません'); },
    waitForBridge: async () => undefined,
    stopBridge: async () => { stops += 1; },
    bridgeIsRunning: () => false,
    createToken: () => 'external-lease',
  });

  const lease = await controller.acquire();
  assert.equal(lease.managed, false);
  assert.deepEqual(await controller.release(lease.token), { released: true, stopped: false });
  assert.equal(stops, 0);
});

test('別サービスが8787を使っている場合は起動しない', async () => {
  const controller = new BridgeLeaseController({
    checkBridge: async () => 'foreign',
    launchBridge: () => { throw new Error('起動してはいけません'); },
    waitForBridge: async () => undefined,
    stopBridge: async () => undefined,
    bridgeIsRunning: () => false,
  });
  await assert.rejects(() => controller.acquire(), /別のローカルサービス/);
});

test('既存のNyamuru bridgeがあれば同じポートを再利用する', async () => {
  let availabilityChecks = 0;
  const selected = await selectLocalBridgeTarget({
    preferredPort: 8787,
    checkState: async () => 'ready',
    canListen: async () => { availabilityChecks += 1; return false; },
  });
  assert.deepEqual(selected, {
    host: '127.0.0.1',
    port: 8787,
    url: 'http://127.0.0.1:8787',
    reused: true,
  });
  assert.equal(availabilityChecks, 0);
});

test('既定ポートを別アプリが使っていれば次の空きポートへ切り替える', async () => {
  const checkedPorts = [];
  const selected = await selectLocalBridgeTarget({
    preferredPort: 8787,
    checkState: async () => 'foreign',
    canListen: async (_host, port) => {
      checkedPorts.push(port);
      return port === 8789;
    },
  });
  assert.deepEqual(checkedPorts, [8787, 8788, 8789]);
  assert.deepEqual(selected, {
    host: '127.0.0.1',
    port: 8789,
    url: 'http://127.0.0.1:8789',
    reused: false,
  });
});

test('明示ポートが使用中なら勝手に別ポートへ移らない', async () => {
  await assert.rejects(() => selectLocalBridgeTarget({
    preferredPort: 9000,
    maxFallbacks: 0,
    checkState: async () => 'foreign',
    canListen: async () => false,
  }), /空きポートが見つかりません/);
});

test('既存bridgeは文章LLMの所有モードまで一致する場合だけ再利用する', async () => {
  const response = (mode, lifecycle = 2) => async () => Response.json({
    service: 'nyamuru-image-hub-local-bridge',
    layout_protocol_version: 3, image_generation_lifecycle_version: lifecycle,
    panel_action_llm_mode: mode,
    panel_action_llm_url: 'http://127.0.0.1:8080/v1/chat/completions',
  });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = response('managed', 0);
    assert.equal(await checkBridgeState('http://127.0.0.1:8787', 700, 'managed'), 'foreign');
    globalThis.fetch = response('managed');
    assert.equal(await checkBridgeState('http://127.0.0.1:8787', 700, 'managed'), 'ready');
    assert.equal(await checkBridgeState('http://127.0.0.1:8787', 700, 'external-shared'), 'foreign');
    assert.equal(await checkBridgeState(
      'http://127.0.0.1:8787', 700, 'managed', 'http://127.0.0.1:8090/v1/chat/completions',
    ), 'foreign');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bridge停止中に再注入が始まっても、停止中のchildを外部serverとして貸さない', async () => {
  let state = 'missing';
  let launches = 0;
  let finishStop;
  let stopping;
  const stopped = new Promise((done) => { finishStop = done; });
  const stopStarted = new Promise((done) => { stopping = done; });
  const controller = new BridgeLeaseController({
    checkBridge: async () => state,
    launchBridge: () => { launches += 1; return fakeChild(); },
    waitForBridge: async () => { state = 'ready'; },
    stopBridge: async (child) => { stopping(); await stopped; child.running = false; state = 'missing'; },
    bridgeIsRunning: (child) => child.running,
  });
  const [first, shared] = await Promise.all([controller.acquire(), controller.acquire()]);
  assert.equal(launches, 1);
  await controller.release(first.token);
  const release = controller.release(shared.token);
  await stopStarted;
  let acquired = false;
  const next = controller.acquire().then((value) => { acquired = true; return value; });
  await new Promise((done) => setImmediate(done));
  assert.equal(acquired, false);
  finishStop();
  await release;
  const resumed = await next;
  assert.equal(resumed.managed, true);
  assert.equal(resumed.started, true);
  assert.equal(launches, 2);
  await controller.close();
});

test('同じLLMを共有中は保持し、最後の明示タスク終了時だけapp所有モデルを解放する', async () => {
  const bridgeLeases = new Set(['a', 'b']);
  const events = [];
  const controller = new PanelActionLeaseController({ bridgeLeases, llmController: {
    ensure: async alias => { events.push(`ensure:${alias}`); return { started: true, managed: true, modelAlias: alias }; },
    unload: async () => { events.push('unload'); return true; },
    close: async () => { events.push('close'); },
  } });
  await controller.prepare('a', 'same-model');
  await controller.prepare('b', 'same-model');
  assert.deepEqual(await controller.release('a'), { released: true, stopped: false });
  assert.deepEqual(await controller.release('b'), { released: true, stopped: true });
  assert.deepEqual(events, ['ensure:same-model', 'ensure:same-model', 'unload']);
  await controller.close();
});

test('別LLMモデルの同時利用は起動前に拒否する', async () => {
  const bridgeLeases = new Set(['a', 'b']);
  let ensures = 0;
  const controller = new PanelActionLeaseController({ bridgeLeases, llmController: {
    ensure: async alias => { ensures += 1; return { started: true, managed: true, modelAlias: alias }; },
    unload: async () => true,
    close: async () => {},
  } });
  await controller.prepare('a', 'model-a');
  await assert.rejects(() => controller.prepare('b', 'model-b'), /別のLLM/);
  assert.equal(ensures, 1);
});

test('共有LLMでは異なる画面aliasも同じdefault_model leaseとして扱い停止しない', async () => {
  const bridgeLeases = new Set(['a', 'b']);
  const events = [];
  const controller = new PanelActionLeaseController({ bridgeLeases, llmController: {
    modelIdentity: () => 'default_model',
    ensure: async alias => {
      events.push(`ensure:${alias}`);
      return { started: false, managed: false, modelAlias: 'default_model', ownershipMode: 'external-shared' };
    },
    unload: async () => { events.push('unload'); return false; },
    close: async () => { events.push('close'); },
  } });
  await controller.prepare('a', 'model-a');
  await controller.prepare('b', 'model-b');
  assert.deepEqual(await controller.release('a'), { released: true, stopped: false });
  assert.deepEqual(await controller.release('b'), { released: true, stopped: false });
  assert.deepEqual(events, ['ensure:model-a', 'ensure:model-b', 'unload']);
});

test('再注入HTTP経路は利用権付きの操作だけLLMを準備し、コマ情報やcommandを起動設定に使わない', async (t) => {
  const bridge = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3, image_generation_lifecycle_version: 2,
      panel_action_llm_mode: 'managed', panel_action_llm_url: 'http://127.0.0.1:8080/v1/chat/completions',
    }));
  });
  await new Promise((done) => bridge.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => bridge.close(done)));
  let prepares = 0;
  let unloads = 0;
  let closes = 0;
  const supervisor = await startLocalBridgeSupervisor({
    repoRoot: process.cwd(), port: 0,
    bridgeUrl: `http://127.0.0.1:${bridge.address().port}`,
    llmController: {
      ownershipMode: 'managed',
      ensure: async (...args) => { assert.deepEqual(args, ['Qwen3.6-35B-A3B-4bit-DWQ']); prepares += 1; return { started: false, managed: false, modelAlias: args[0] }; },
      unload: async () => { unloads += 1; return true; },
      close: async () => { closes += 1; },
    },
  });
  t.after(() => supervisor.close());
  const post = (path, body = {}, origin = 'http://127.0.0.1:4321') => fetch(`${supervisor.url}${path}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await post('/api/panel-actions/prepare')).status, 400);
  assert.equal((await post('/api/panel-actions/prepare', {}, 'https://example.com')).status, 403);
  assert.equal(prepares, 0);
  const start = await (await post('/api/new-creation/start')).json();
  assert.equal(start.bridge_managed, false);
  assert.equal((await post('/api/panel-actions/prepare', { lease_token: start.lease_token })).status, 400);
  const prepared = await (await post('/api/panel-actions/prepare', {
    lease_token: start.lease_token, command: 'ignored', llm_model_alias: 'Qwen3.6-35B-A3B-4bit-DWQ',
  })).json();
  assert.equal(prepared.llm_managed, false);
  assert.equal(prepared.llm_model_alias, 'Qwen3.6-35B-A3B-4bit-DWQ');
  assert.equal(prepared.llm_mode, 'managed');
  assert.equal(prepares, 1);
  const stop = await (await post('/api/new-creation/stop', { lease_token: start.lease_token })).json();
  assert.deepEqual({ released: stop.released, stopped: stop.stopped }, { released: true, stopped: false });
  assert.deepEqual({ llm_released: stop.llm_released, llm_stopped: stop.llm_stopped }, { llm_released: true, llm_stopped: true });
  assert.equal(unloads, 1);
  assert.equal((await post('/api/panel-actions/prepare', { lease_token: start.lease_token })).status, 400);
  await supervisor.close();
  assert.equal(closes, 1);
  assert.equal(bridge.listening, true);
});

test('LLM解放が失敗してもbridge leaseは必ず解放する', async (t) => {
  const bridge = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3, image_generation_lifecycle_version: 2,
      panel_action_llm_mode: 'managed', panel_action_llm_url: 'http://127.0.0.1:8080/v1/chat/completions',
    }));
  });
  await new Promise((done) => bridge.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => bridge.close(done)));
  const supervisor = await startLocalBridgeSupervisor({
    repoRoot: process.cwd(), port: 0,
    bridgeUrl: `http://127.0.0.1:${bridge.address().port}`,
    llmController: {
      ownershipMode: 'managed',
      ensure: async alias => ({ started: false, managed: false, modelAlias: alias }),
      unload: async () => { throw new Error('LLM stop failed'); },
      close: async () => {},
    },
  });
  t.after(() => supervisor.close());
  const post = (path, body = {}) => fetch(`${supervisor.url}${path}`, {
    method: 'POST', headers: { Origin: 'http://127.0.0.1:4321', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const start = await (await post('/api/new-creation/start')).json();
  await post('/api/panel-actions/prepare', { lease_token: start.lease_token, llm_model_alias: 'model-a' });
  assert.equal((await post('/api/new-creation/stop', { lease_token: start.lease_token })).status, 503);
  assert.equal((await post('/api/panel-actions/prepare', { lease_token: start.lease_token, llm_model_alias: 'model-a' })).status, 400);
});
