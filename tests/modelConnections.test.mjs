// 見込み: 選択IDと接続先を共有すれば、接続確認が別設定や生成を作らない。
// 合格: ID/版/URLを保持、追加保存・生成送信0件。範囲: decoderとbridge transport、HTTP/storageは模擬。実生成なし。
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeImageGenerationConnections } from '../src/lib/modelConnections.ts';
import { connectAgentImageGeneration, getImageGenerationConnections } from '../src/lib/localBridge.ts';
import { LOCAL_MODEL_PREFERENCES_STORAGE_KEY, DEFAULT_LOCAL_MODEL_PREFERENCES } from '../src/lib/localModelPreferences.ts';
import { GENERATION_PREFERENCES_STORAGE_KEY, DEFAULT_GENERATION_PREFERENCES } from '../src/lib/generationPreferences.ts';

const WORKFLOW_ID = 'e679ae9f-8769-4c90-8dfb-4a946f34aa18';
const OTHER_WORKFLOW_ID = '198ea774-ddca-4e90-a8cc-a41d9ba081b0';
const LEGACY_IMAGE_MODEL_KEY = 'nyamuru.image-generation-model.v1';
const response = () => ({
  workflow: { id: WORKFLOW_ID, name: '作者のワークフロー', version: 3, available: false, message: '利用可否はまだ確認していません' },
  comfyui: { endpoint: 'http://127.0.0.1:8199', status: 'unchecked', version: '', message: '接続はまだ確認していません' },
  memory_release: { available: false },
});

async function withBrowser({ workflowId = WORKFLOW_ID, result = response() } = {}, check) {
  const before = { window: globalThis.window, fetch: globalThis.fetch };
  const calls = [], reads = [], writes = [];
  const saved = new Map([
    [LOCAL_MODEL_PREFERENCES_STORAGE_KEY, JSON.stringify({ ...DEFAULT_LOCAL_MODEL_PREFERENCES, comfyuiUrl: 'http://localhost:8199' })],
    [GENERATION_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 2, ...DEFAULT_GENERATION_PREFERENCES,
      local: { ...DEFAULT_GENERATION_PREFERENCES.local, workflowId } })],
    [LEGACY_IMAGE_MODEL_KEY, 'qwen-image-2.1-turbo'],
  ]);
  globalThis.window = { setTimeout, clearTimeout, localStorage: {
    getItem: key => { reads.push(key); return saved.get(key) ?? null; },
    setItem: (key, value) => { writes.push([key, value]); throw Error('接続確認から設定を書き込まない'); },
  } };
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (/\/api\/new-creation\/(start|stop)$/.test(String(url))) return Response.json({
      service: 'nyamuru-image-hub-bridge-supervisor', protocol_version: 1, lease_token: 'fixture', released: true,
    });
    return Response.json({ ...result, service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 });
  };
  try { await check({ calls, reads, writes, saved }); }
  finally { globalThis.window = before.window; globalThis.fetch = before.fetch; }
}

// 見込み: 接続と利用可否を独立させれば、接続だけで生成可能と表示しない。
// 合格: 未確認/利用不可/利用可/null選択とID・版を保持。範囲: decoder、実接続なし。
test('connection decoding preserves the selected revision and distinguishes connection from availability', () => {
  const unchecked = decodeImageGenerationConnections(response());
  assert.equal(unchecked.workflow.id, WORKFLOW_ID);
  assert.equal(unchecked.workflow.version, 3);
  assert.equal(unchecked.workflow.available, false);
  assert.equal(unchecked.comfyui.status, 'unchecked');
  const connected = { ...response(), comfyui: { ...response().comfyui, status: 'connected', version: 'fixture' } };
  assert.equal(decodeImageGenerationConnections(connected).workflow.available, false);
  assert.equal(decodeImageGenerationConnections({ ...connected, workflow: { ...connected.workflow, available: true },
    memory_release: { available: true } }).workflow.available, true);
  assert.equal(decodeImageGenerationConnections({ ...connected, workflow: null }).workflow, null);
});

// 見込み: 旧固定Qwen応答や不正な版・型を拒否すれば、利用可能な登録を捏造しない。
// 合格: 必須欄欠落、非bool、不正な版、未知状態は例外。範囲: decoder入力境界。
test('connection decoding rejects old and malformed contracts', () => {
  const invalid = [null, {}, { qwen: { available: true }, comfyui: response().comfyui },
    { ...response(), workflow: undefined }, { ...response(), memory_release: null },
    { ...response(), memory_release: { available: 'yes' } },
    { ...response(), comfyui: { ...response().comfyui, status: 'ready' } }];
  for (const change of [{ id: 1 }, { name: null }, { version: 0 }, { version: 1.5 },
    { version: Number.MAX_SAFE_INTEGER + 1 }, { available: 'yes' }, { message: null }]) {
    invalid.push({ ...response(), workflow: { ...response().workflow, ...change } });
  }
  for (const value of invalid) assert.throws(() => decodeImageGenerationConnections(value), /接続情報/);
});

// 見込み: 共通設定を読むなら、確認先を別登録へ取り違えない。
// 合格: 保存ID/URLがbodyに一致、返された版3を保持、生成POST/write0件。範囲: 固定HTTPによる実transport。
test('UI and agent send the saved workflow id and URL through the existing bridge only', async () => {
  await withBrowser({ workflowId: OTHER_WORKFLOW_ID, result: { ...response(), workflow: { ...response().workflow, id: OTHER_WORKFLOW_ID } } }, async ({ calls, writes }) => {
    const result = await getImageGenerationConnections(undefined, true);
    assert.equal(result.workflow.id, OTHER_WORKFLOW_ID);
    assert.equal(result.workflow.version, 3);
    assert.equal(result.comfyui.endpoint, 'http://127.0.0.1:8199');
    const operation = calls.find(call => call.url.endsWith('/api/image-generation/connections'));
    assert.deepEqual(JSON.parse(operation.options.body), {
      comfyui_url: 'http://localhost:8199', check_comfyui: true, workflow_id: OTHER_WORKFLOW_ID,
    });
    assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
      '/api/new-creation/start', '/api/health', '/api/image-generation/connections', '/api/new-creation/stop',
    ]);
    assert.deepEqual(writes, []);
  });
});

// 見込み: 明示URLも送信前検証すれば外部hostや資格情報をbridgeへ渡さない。
// 合格: remote/HTTPS/資格情報/pathをfetch0回で拒否。範囲: browser側のURL境界。
test('invalid connection URLs are rejected before acquiring a bridge session', async () => {
  await withBrowser({}, async ({ calls, writes }) => {
    for (const url of ['http://example.com', 'https://localhost:8188', 'http://user:password@localhost:8188', 'http://localhost:8188/path']) {
      await assert.rejects(getImageGenerationConnections(url, true), /localhost/);
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(writes, []);
  });
});

// 見込み: 確認は現在の登録を検証するだけなので、成功・失敗・取消しで別キーを増やさない。
// 合格: 利用可だけ成功、旧キー読取/全write/生成POST0件。範囲: 模擬HTTPとstorage。
test('agent connection verifies the current selection without a second localStorage key', async () => {
  for (const state of ['available', 'missing', 'cancelled']) {
    const result = { ...response(), workflow: { ...response().workflow, available: state !== 'missing', message: '必要ノードなし' },
      comfyui: { ...response().comfyui, status: 'connected' }, memory_release: { available: true } };
    await withBrowser({ result }, async ({ calls, reads, writes, saved }) => {
      const previous = [...saved];
      if (state === 'available') assert.equal((await connectAgentImageGeneration()).workflow.id, WORKFLOW_ID);
      else await assert.rejects(connectAgentImageGeneration(() => state !== 'cancelled'), state === 'missing' ? /必要ノードなし/ : /中止/);
      assert.deepEqual(writes, []);
      assert.deepEqual([...saved], previous);
      assert.ok(!reads.includes(LEGACY_IMAGE_MODEL_KEY));
      assert.ok(calls.every(call => !/qwen-generation|image-generation\/(prepare|submit)/.test(call.url)));
      assert.equal(calls.filter(call => call.url.endsWith('/api/image-generation/connections')).length, 1);
    });
  }
});

// 見込み: 旧Qwen接続済みキーだけでは登録定義を特定できない。
// 合格: 未選択時は旧キーがあっても案内して停止、fetch/write0件。範囲: 端末設定とagent入口。
test('an old Qwen connection flag cannot substitute for selecting a workflow', async () => {
  await withBrowser({ workflowId: '' }, async ({ calls, writes }) => {
    await assert.rejects(connectAgentImageGeneration(), /ワークフローを選んで/);
    assert.deepEqual(calls, []);
    assert.deepEqual(writes, []);
  });
});
