import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOCAL_MODEL_PREFERENCES,
  LOCAL_MODEL_PREFERENCES_STORAGE_KEY,
  loadLocalModelPreferences,
  normalizeLocalModelPreferences,
  saveLocalModelPreferences,
  normalizeComfyuiUrl,
} from '../src/lib/localModelPreferences.ts';

function memoryStorage(initial = new Map()) {
  return {
    values: initial,
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
  };
}

test('既存のLLM・VLMを端末設定の既定値とし、読込だけでは保存しない', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadLocalModelPreferences(storage), DEFAULT_LOCAL_MODEL_PREFERENCES);
  assert.equal(storage.values.size, 0);
});

test('ComfyUI接続先を端末に保存し、外部・認証付き・パス付きURLを拒否する', () => {
  const storage = memoryStorage();
  const saved = saveLocalModelPreferences(storage, { ...DEFAULT_LOCAL_MODEL_PREFERENCES, comfyuiUrl: 'http://localhost:8199/' });
  assert.equal(loadLocalModelPreferences(storage).comfyuiUrl, 'http://localhost:8199');
  assert.equal(saved.llmAlias, DEFAULT_LOCAL_MODEL_PREFERENCES.llmAlias);
  for (const value of ['https://localhost:8188', 'http://example.com', 'http://192.168.1.4:8188', 'http://localhost:0',
    'http://localhost:65536', 'http://name:secret@localhost:8188', 'http://localhost:8188/api',
    'http://localhost:8188/?token=secret', 'http://localhost:8188/#fragment', 'http://local\nhost:8188', null]) {
    assert.throws(() => normalizeComfyuiUrl(value), /localhost/);
  }
  assert.equal(normalizeComfyuiUrl('http://[::1]:8188/'), 'http://[::1]:8188');
  assert.equal(normalizeComfyuiUrl(''), '');
});

test('LLM aliasとVLM model IDを別々に検証して端末だけへ保存する', () => {
  const storage = memoryStorage();
  const saved = saveLocalModelPreferences(storage, {
    llmAlias: 'Qwen3.6-35B-A3B-4bit-DWQ',
    vlmModelId: 'local-owner/vision-model-4bit',
  });
  assert.deepEqual(loadLocalModelPreferences(storage), saved);
  assert.deepEqual(JSON.parse(storage.values.get(LOCAL_MODEL_PREFERENCES_STORAGE_KEY)), saved);
  assert.throws(() => normalizeLocalModelPreferences({ ...saved, llmAlias: '../model' }), /models.conf/);
  assert.throws(() => normalizeLocalModelPreferences({ ...saved, vlmModelId: '/tmp/model' }), /Hugging Face/);
});

test('壊れた保存値や旧形式を実行に使わず既定へ戻す', () => {
  for (const raw of ['{', JSON.stringify({ llmAlias: 'Qwen' }), JSON.stringify({ llmAlias: 'bad alias', vlmModelId: 'a/b' })]) {
    const storage = memoryStorage(new Map([[LOCAL_MODEL_PREFERENCES_STORAGE_KEY, raw]]));
    assert.deepEqual(loadLocalModelPreferences(storage), DEFAULT_LOCAL_MODEL_PREFERENCES);
  }
});
