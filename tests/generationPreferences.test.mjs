import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentGenerationPreferences, DEFAULT_GENERATION_PREFERENCES, GENERATION_PREFERENCES_STORAGE_KEY, LEGACY_CLOUD_MODEL_PREFERENCES_KEY,
  loadGenerationPreferences, saveGenerationPreferences,
} from '../src/lib/generationPreferences.ts';
import { DEFAULT_LOCAL_MODEL_PREFERENCES, saveLocalModelPreferences } from '../src/lib/localModelPreferences.ts';

// 見込み: 端末設定の正本を既存storageへ集約すれば、選択と利用条件を独立して保持できる。
// 合格: 保存往復・別設定の更新・保存失敗後の値を確認。Storageは模擬で、実画面・生成・作品保存は対象外。

function memoryStorage(initial = null, legacy = null) {
  const values = new Map([[GENERATION_PREFERENCES_STORAGE_KEY, initial], [LEGACY_CLOUD_MODEL_PREFERENCES_KEY, legacy]]);
  const writes = [];
  return { writes, getItem: key => values.get(key) ?? null, setItem: (key, next) => { assert.equal(key, GENERATION_PREFERENCES_STORAGE_KEY); writes.push(next); values.set(key, next); } };
}

// 見込み: 読込だけでは保存も既定値の共有変更も起こらない。合格: 書込0件、別読込の既定値不変。確認範囲: 純粋な設定reader。
test('generation preferences default to local without writing or sharing mutable defaults', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadGenerationPreferences(storage), DEFAULT_GENERATION_PREFERENCES);
  assert.deepEqual(currentGenerationPreferences(), DEFAULT_GENERATION_PREFERENCES);
  assert.equal(storage.writes.length, 0);
  const first = loadGenerationPreferences(storage);
  first.cloud.agent = 'other';
  assert.equal(loadGenerationPreferences(storage).cloud.agent, 'codex');
});

// 見込み: 実行先の切替は他の設定を消さない。合格: cloud設定を保存・切替後も保持。確認範囲: 模擬Storageの往復。
test('cloud method, provider and local model survive reload and execution switching', () => {
  const storage = memoryStorage();
  const preferences = loadGenerationPreferences(storage);
  preferences.execution = 'cloud';
  preferences.cloud = { adultTermsConfirmed: true, method: 'api', apiEndpoint: 'https://images.example.test/v1', apiModel: 'image-model', agent: 'other', agentName: 'External agent' };
  saveGenerationPreferences(storage, preferences);
  assert.deepEqual(loadGenerationPreferences(storage), preferences);
  saveGenerationPreferences(storage, { ...preferences, execution: 'local' });
  const switched = loadGenerationPreferences(storage);
  assert.equal(switched.execution, 'local');
  assert.deepEqual(switched.cloud, preferences.cloud);
  assert.equal(switched.local.imageModel, 'qwen-image-2.1-turbo');
});

// 見込み: 未知形式・認証情報を正規化で取り除ける。合格: 既定値へ戻りsecretを保持しない。確認範囲: readerの不正入力。
test('old or unknown values fall back to supported options without retaining credentials', () => {
  const storage = memoryStorage(JSON.stringify({ execution: 'unknown', cloud: { method: 'unknown', agent: 'unknown', apiKey: 'secret', apiEndpoint: 'https://user:secret@images.example.test/v1' }, local: { imageModel: 'retired-model' }, apiKey: 'secret' }));
  const loaded = loadGenerationPreferences(storage);
  assert.deepEqual(loaded, DEFAULT_GENERATION_PREFERENCES);
  assert.equal(JSON.stringify(loaded).includes('secret'), false);
  for (const value of ['null', '{', '[]']) assert.deepEqual(loadGenerationPreferences(memoryStorage(value)), DEFAULT_GENERATION_PREFERENCES);
});

// 見込み: 入力中URLは保持し認証情報付きURLは拒否する。合格: 前者だけ1件保存。確認範囲: writerと模擬Storage。
test('endpoint drafts autosave but credential-bearing URLs are rejected before storage', () => {
  const storage = memoryStorage();
  const preferences = loadGenerationPreferences(storage);
  preferences.cloud.apiEndpoint = 'https://';
  saveGenerationPreferences(storage, preferences);
  assert.equal(loadGenerationPreferences(storage).cloud.apiEndpoint, 'https://');
  for (const endpoint of ['https://user:secret@images.example.test', 'https://images.example.test?key=secret', 'https://images.example.test#secret']) {
    preferences.cloud.apiEndpoint = endpoint;
    assert.throws(() => saveGenerationPreferences(storage, preferences), /認証情報/);
  }
  assert.equal(storage.writes.length, 1);
});

// 見込み: 保存失敗を成功扱いしない。合格: writerは例外、読込不能時はlocal既定。確認範囲: Storage例外の模擬。
test('storage errors are visible to callers and reading a denied store remains local', () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(loadGenerationPreferences(broken), DEFAULT_GENERATION_PREFERENCES);
  assert.throws(() => saveGenerationPreferences(broken, loadGenerationPreferences()), /denied/);
});

// 見込み: 旧設定の不一致からcloud利用を許可しない。合格: 条件別の実行先と同意、読込時書込0件。確認範囲: 既存形式のreader。
test('legacy settings are read without writes; disagreement never grants cloud access', () => {
  for (const execution of [undefined, 'local', 'cloud']) for (const enabled of [false, true]) for (const adultTermsConfirmed of [false, true]) {
    const legacy = JSON.stringify({ enabled, adultTermsConfirmed });
    const storage = memoryStorage(execution === undefined ? null : JSON.stringify({ execution }), legacy);
    const loaded = loadGenerationPreferences(storage);
    assert.equal(loaded.execution, enabled && execution !== 'local' ? 'cloud' : 'local');
    assert.equal(loaded.cloud.adultTermsConfirmed, adultTermsConfirmed);
    assert.equal(storage.writes.length, 0);
    saveGenerationPreferences(storage, loaded);
    assert.equal(storage.writes.length, 1);
    assert.equal(JSON.parse(storage.writes[0]).version, 3);
    assert.equal(storage.getItem(LEGACY_CLOUD_MODEL_PREFERENCES_KEY), legacy);
    assert.deepEqual(loadGenerationPreferences(storage), loaded);
  }
  for (const raw of ['{', 'null', '[]', '{}', '{"version":3,"execution":"cloud"}']) {
    const storage = memoryStorage(raw, '{"enabled":true}');
    assert.equal(loadGenerationPreferences(storage).execution, 'local');
  }
  for (const legacy of [null, '{', '{"enabled":"true","adultTermsConfirmed":"true"}']) {
    assert.deepEqual(loadGenerationPreferences(memoryStorage('{"execution":"cloud"}', legacy)), DEFAULT_GENERATION_PREFERENCES);
  }
});

// 見込み: 現設定保存後は古い値が上書きしない。合格: 旧key未読、保存失敗後も直前値を保持。確認範囲: 模擬Storage。
test('one current setting owns execution and consent; stale legacy values cannot override it', () => {
  const storage = memoryStorage(null, '{"enabled":false,"adultTermsConfirmed":true}');
  const preferences = loadGenerationPreferences(storage);
  preferences.execution = 'cloud';
  preferences.cloud.adultTermsConfirmed = false;
  saveGenerationPreferences(storage, preferences);
  assert.deepEqual(loadGenerationPreferences(storage), preferences);
  assert.deepEqual(loadGenerationPreferences({ getItem: key => {
    if (key === LEGACY_CLOUD_MODEL_PREFERENCES_KEY) throw new Error('must not read legacy after a current save');
    return storage.getItem(key);
  } }), preferences);
  const remembered = storage.getItem(GENERATION_PREFERENCES_STORAGE_KEY);
  const denied = { getItem: storage.getItem, setItem() { throw new Error('quota'); } };
  assert.throws(() => saveGenerationPreferences(denied, { ...preferences, execution: 'local', cloud: { ...preferences.cloud, adultTermsConfirmed: true } }), /quota/);
  assert.equal(storage.getItem(GENERATION_PREFERENCES_STORAGE_KEY), remembered);
  assert.deepEqual(loadGenerationPreferences(storage), preferences);
});

// 見込み: 選択IDをlocal内で正規化すれば、再読込と他の端末設定変更で選択が消えない。
// 合格: B選択→cloud・URL・LLM設定更新後もB。確認範囲: 本体reader/writerと模擬Storage、UIは別確認。
test('workflow selection survives reload, execution changes and other device preference saves', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const id = 'c556af83-d9bb-42b0-ae40-67e999130180';
  const initial = loadGenerationPreferences(storage);
  assert.equal(initial.local.workflowId, '132c3a87-8f0a-4591-b2e0-4a28a7b7b002');
  const selected = { ...initial, local: { ...initial.local, workflowId: id } };
  saveGenerationPreferences(storage, selected);
  assert.deepEqual(loadGenerationPreferences(storage), selected);
  const switched = { ...loadGenerationPreferences(storage), execution: 'cloud', cloud: { ...selected.cloud, agentName: 'Reviewer' } };
  saveGenerationPreferences(storage, switched);
  saveLocalModelPreferences(storage, { ...DEFAULT_LOCAL_MODEL_PREFERENCES, llmAlias: 'local-text', comfyuiUrl: 'http://127.0.0.1:8189' });
  assert.equal(loadGenerationPreferences(storage).local.workflowId, id);
  assert.equal(loadGenerationPreferences(storage).cloud.agentName, 'Reviewer');
});

// 見込み: 不正なIDは利用先へ渡さず、保存失敗は確定済み選択を壊さない。
// 合格: malformed読込は未選択、拒否/容量不足後もA、明示解除で空。確認範囲: 設定writer、模擬Storage。
test('invalid or failed workflow selection leaves the last saved workflow unchanged', () => {
  const id = 'd520429e-2dc7-48d2-876c-17b427b27215';
  const storage = memoryStorage();
  const base = loadGenerationPreferences(storage);
  saveGenerationPreferences(storage, { ...base, local: { ...base.local, workflowId: id } });
  const saved = storage.getItem(GENERATION_PREFERENCES_STORAGE_KEY);
  for (const invalid of ['not-a-workflow', '../other', `${id} `]) {
    assert.throws(() => saveGenerationPreferences(storage, { ...base, local: { ...base.local, workflowId: invalid } }), /ワークフロー/);
    assert.equal(loadGenerationPreferences(memoryStorage(JSON.stringify({ ...base, version: 2, local: { workflowId: invalid } }))).local.workflowId, '');
  }
  const denied = { getItem: storage.getItem, setItem() { throw new Error('quota'); } };
  assert.throws(() => saveGenerationPreferences(denied, { ...base, local: { ...base.local, workflowId: '' } }), /quota/);
  assert.equal(storage.getItem(GENERATION_PREFERENCES_STORAGE_KEY), saved);
  assert.equal(loadGenerationPreferences(storage).local.workflowId, id);
  saveGenerationPreferences(storage, { ...base, local: { ...base.local, workflowId: '' } });
  assert.equal(loadGenerationPreferences(storage).local.workflowId, '');
});
