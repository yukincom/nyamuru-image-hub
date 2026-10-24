import assert from 'node:assert/strict';
import test from 'node:test';
import {
  startNewCreationBridgeSession,
  stopNewCreationBridgeSession,
  withNewCreationBridgeSession,
  withPanelActionServices,
  withImageGenerationServices,
  submitImageGenerationRequest,
} from '../src/lib/localBridgeLifecycle.ts';

test('画像生成は共有LLMで英訳→停止確認→全画像→復帰の順を維持する', async () => {
  const events = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(String(url)).pathname;
    events.push(path);
    if (path.endsWith('/start')) return jsonResponse({ ...common, lease_token: 'image-lease' });
    assert.equal(JSON.parse(options.body).lease_token, 'image-lease');
    if (path === '/api/panel-actions/prepare') return jsonResponse({ ...common, llm_mode: 'external-shared' });
    if (path === '/api/image-generation/prepare') return jsonResponse({ ...common, llm_stopped: true });
    return jsonResponse({ ...common, released: true, llm_released: true, llm_restored: true });
  };
  const result = await withImageGenerationServices(async () => { events.push('translate'); return 'English'; }, async (value, token) => {
    assert.equal(value, 'English'); assert.equal(token, 'image-lease'); events.push('generate'); return 'PNG';
  }, {}, fetchImpl);
  assert.equal(result, 'PNG');
  assert.deepEqual(events, ['/api/new-creation/start', '/api/panel-actions/prepare', 'translate', '/api/image-generation/prepare', 'generate', '/api/new-creation/stop']);
});

test('画像生成失敗でも復帰を要求し、復帰失敗も隠さない', async () => {
  for (const restoreFails of [false, true]) {
    let releases = 0;
    const fetchImpl = async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/start')) return jsonResponse({ ...common, lease_token: 'image-lease' });
      if (path.endsWith('/stop')) {
        releases += 1;
        return restoreFails ? jsonResponse({ error: 'restore failed' }, 503) : jsonResponse({ ...common, llm_released: true });
      }
      return jsonResponse({ ...common, llm_stopped: true });
    };
    await assert.rejects(() => withImageGenerationServices(async () => 'English', async () => { throw new Error('image failed'); }, {}, fetchImpl),
      restoreFails ? /image failed\nrestore failed/ : /image failed/);
    assert.equal(releases, 1);
  }
});

test('停止の確認がないと画像を送信せず、画面終了後の英訳も送信に進めない', async () => {
  for (const cancel of [false, true]) {
    let current = true, generations = 0, releases = 0;
    const fetchImpl = async url => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/start')) return jsonResponse({ ...common, lease_token: 'image-lease' });
      if (path.endsWith('/stop')) { releases++; return jsonResponse({ ...common, llm_released: true }); }
      return jsonResponse(common);
    };
    const run = () => withImageGenerationServices(async () => { if (cancel) current = false; return ''; }, async () => { generations++; }, { isCurrent: () => current }, fetchImpl);
    if (cancel) await run(); else await assert.rejects(run, /一時停止/);
    assert.equal(generations, 0); assert.equal(releases, 1);
  }
});

test('画像送信は復帰管理のleaseを伴ってsupervisor経由で行う', async () => {
  await submitImageGenerationRequest('image-lease', { job_id: 'image-1' }, async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/image-generation/submit');
    assert.deepEqual(JSON.parse(options.body), { lease_token: 'image-lease', payload: { job_id: 'image-1' } });
    return jsonResponse({ ...common, status: 'queued' });
  });
});

const common = { service: 'nyamuru-image-hub-bridge-supervisor', protocol_version: 1 };

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('新規作成用の起動情報を検証して受け取る', async () => {
  const requests = [];
  const session = await startNewCreationBridgeSession(async (url, options) => {
    requests.push({ url, method: options?.method, body: JSON.parse(String(options?.body)) });
    return jsonResponse({ ...common, ok: true, lease_token: 'lease-1', bridge_started: true, bridge_managed: true });
  });
  assert.deepEqual(session, { token: 'lease-1', bridgeStarted: true, bridgeManaged: true });
  assert.deepEqual(requests, [{ url: 'http://127.0.0.1:8786/api/new-creation/start', method: 'POST', body: {} }]);
});

test('終了時は受け取ったトークンだけを起動管理へ返す', async () => {
  const requests = [];
  const result = await stopNewCreationBridgeSession('lease-2', async (url, options) => {
    requests.push({ url, method: options?.method, body: JSON.parse(String(options?.body)) });
    return jsonResponse({ ...common, ok: true, released: true, stopped: true, llm_released: true, llm_stopped: false });
  });
  assert.deepEqual(result, { released: true, stopped: true, llmReleased: true, llmStopped: false });
  assert.deepEqual(requests[0].body, { lease_token: 'lease-2' });
});

test('一時利用はbridgeを起動して処理後にleaseを必ず返す', async () => {
  const events = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(options?.body));
    events.push(path === '/api/new-creation/start' ? 'start' : `stop:${body.lease_token}`);
    return path === '/api/new-creation/start'
      ? jsonResponse({ ...common, ok: true, lease_token: 'coverage-lease', bridge_started: true, bridge_managed: true })
      : jsonResponse({ ...common, ok: true, released: true, stopped: true });
  };
  const result = await withNewCreationBridgeSession(async () => {
    events.push('save');
    return 'saved';
  }, fetchImpl);
  assert.equal(result, 'saved');
  assert.deepEqual(events, ['start', 'save', 'stop:coverage-lease']);
});

test('一時利用の処理が失敗してもleaseを返す', async () => {
  const events = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(options?.body));
    events.push(path === '/api/new-creation/start' ? 'start' : `stop:${body.lease_token}`);
    return path === '/api/new-creation/start'
      ? jsonResponse({ ...common, ok: true, lease_token: 'failed-lease', bridge_started: true, bridge_managed: true })
      : jsonResponse({ ...common, ok: true, released: true, stopped: true });
  };
  await assert.rejects(
    () => withNewCreationBridgeSession(async () => {
      events.push('save');
      throw new Error('save failed');
    }, fetchImpl),
    /save failed/,
  );
  assert.deepEqual(events, ['start', 'save', 'stop:failed-lease']);
});

test('別アプリの起動管理応答を拒否する', async () => {
  await assert.rejects(
    () => startNewCreationBridgeSession(async () => jsonResponse({ service: 'other', protocol_version: 1, lease_token: 'x' })),
    /別のアプリ/,
  );
});

test('起動失敗の理由を画面へ伝える', async () => {
  await assert.rejects(
    () => startNewCreationBridgeSession(async () => jsonResponse({ ...common, error: '画像解析環境がありません' }, 503)),
    /画像解析環境がありません/,
  );
});

function actionServicesFetch(events, prepare = async () => jsonResponse({ ...common, ok: true })) {
  return async (url, options) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(options.body));
    events.push(path);
    if (path === '/api/new-creation/start') return jsonResponse({ ...common, lease_token: 'action-lease' });
    assert.equal(body.lease_token, 'action-lease');
    if (path === '/api/panel-actions/prepare') return prepare();
    return jsonResponse({ ...common, released: true, stopped: false, llm_released: true, llm_stopped: true });
  };
}

test('再注入はbridge→LLM準備→推論の順に一度実行し、leaseを返す', async () => {
  const events = [];
  const result = await withPanelActionServices(async () => { events.push('inference'); return 'added'; },
    { onPhase: (phase) => events.push(phase) }, actionServicesFetch(events));
  assert.equal(result, 'added');
  assert.deepEqual(events, ['bridge', '/api/new-creation/start', 'llm', '/api/panel-actions/prepare', 'ready', 'inference', '/api/new-creation/stop']);
});

test('端末設定で選んだLLM aliasを準備要求へ明示する', async () => {
  const bodies = [];
  const result = await withPanelActionServices(async () => 'translated', { llmModelAlias: 'Qwen3.6-35B-A3B-4bit-DWQ' }, async (url, options) => {
    const path = new URL(String(url)).pathname;
    bodies.push([path, JSON.parse(String(options.body))]);
    if (path === '/api/new-creation/start') return jsonResponse({ ...common, lease_token: 'model-lease' });
    if (path === '/api/panel-actions/prepare') return jsonResponse(common);
    return jsonResponse({ ...common, released: true, stopped: false, llm_released: true, llm_stopped: true });
  });
  assert.equal(result, 'translated');
  assert.deepEqual(bodies.find(([path]) => path === '/api/panel-actions/prepare')[1], {
    lease_token: 'model-lease', llm_model_alias: 'Qwen3.6-35B-A3B-4bit-DWQ',
  });
});

test('通常の再注入もLLM lease解放失敗を成功として扱わない', async () => {
  await assert.rejects(() => withPanelActionServices(
    async () => 'suggested',
    {},
    async (url, options) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/new-creation/start') return jsonResponse({ ...common, lease_token: 'release-lease' });
      if (path === '/api/panel-actions/prepare') return jsonResponse(common);
      assert.equal(JSON.parse(String(options.body)).lease_token, 'release-lease');
      return jsonResponse({ ...common, released: true, stopped: false, llm_released: false, llm_stopped: false });
    },
  ), /利用終了/);
});

test('LLM起動失敗時は推論せずbridgeの利用権を返す', async () => {
  const events = [];
  await assert.rejects(() => withPanelActionServices(async () => { throw new Error('呼んではいけない'); }, {},
    actionServicesFetch(events, async () => jsonResponse({ error: 'モデルがありません' }, 503))), /モデルがありません/);
  assert.equal(events.at(-1), '/api/new-creation/stop');
});

test('コマ移動・編集中に起動完了しても旧内容の推論を送らない', async () => {
  const events = [];
  let current = true;
  const result = await withPanelActionServices(async () => { throw new Error('呼んではいけない'); },
    { isCurrent: () => current }, actionServicesFetch(events, async () => { current = false; return jsonResponse(common); }));
  assert.equal(result, undefined);
  assert.equal(events.at(-1), '/api/new-creation/stop');
});

test('再注入失敗時に自動で推論を再送せずleaseを返す', async () => {
  const events = [];
  let calls = 0;
  await assert.rejects(() => withPanelActionServices(async () => { calls += 1; throw new Error('推論失敗'); }, {}, actionServicesFetch(events)), /推論失敗/);
  assert.equal(calls, 1);
  assert.equal(events.at(-1), '/api/new-creation/stop');
});
