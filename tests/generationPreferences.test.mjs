import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentGenerationPreferences, DEFAULT_GENERATION_PREFERENCES, GENERATION_PREFERENCES_STORAGE_KEY,
  loadGenerationPreferences, saveGenerationPreferences,
} from '../src/lib/generationPreferences.ts';

function memoryStorage(initial = null) {
  let value = initial;
  const writes = [];
  return { writes, getItem: () => value, setItem: (key, next) => { assert.equal(key, GENERATION_PREFERENCES_STORAGE_KEY); writes.push(next); value = next; } };
}

test('generation preferences default to local without writing or sharing mutable defaults', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadGenerationPreferences(storage), DEFAULT_GENERATION_PREFERENCES);
  assert.deepEqual(currentGenerationPreferences(), DEFAULT_GENERATION_PREFERENCES);
  assert.equal(storage.writes.length, 0);
  const first = loadGenerationPreferences(storage);
  first.cloud.agent = 'other';
  assert.equal(loadGenerationPreferences(storage).cloud.agent, 'codex');
});

test('cloud method, provider and local model survive reload and execution switching', () => {
  const storage = memoryStorage();
  const preferences = loadGenerationPreferences(storage);
  preferences.execution = 'cloud';
  preferences.cloud = { method: 'api', apiEndpoint: 'https://images.example.test/v1', apiModel: 'image-model', agent: 'other', agentName: 'External agent' };
  saveGenerationPreferences(storage, preferences);
  assert.deepEqual(loadGenerationPreferences(storage), preferences);
  saveGenerationPreferences(storage, { ...preferences, execution: 'local' });
  const switched = loadGenerationPreferences(storage);
  assert.equal(switched.execution, 'local');
  assert.deepEqual(switched.cloud, preferences.cloud);
  assert.equal(switched.local.imageModel, 'qwen-image-2.1-turbo');
});

test('old or unknown values fall back to supported options without retaining credentials', () => {
  const storage = memoryStorage(JSON.stringify({ execution: 'unknown', cloud: { method: 'unknown', agent: 'unknown', apiKey: 'secret', apiEndpoint: 'https://user:secret@images.example.test/v1' }, local: { imageModel: 'retired-model' }, apiKey: 'secret' }));
  const loaded = loadGenerationPreferences(storage);
  assert.deepEqual(loaded, DEFAULT_GENERATION_PREFERENCES);
  assert.equal(JSON.stringify(loaded).includes('secret'), false);
  for (const value of ['null', '{', '[]']) assert.deepEqual(loadGenerationPreferences(memoryStorage(value)), DEFAULT_GENERATION_PREFERENCES);
});

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

test('storage errors are visible to callers and reading a denied store remains local', () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(loadGenerationPreferences(broken), DEFAULT_GENERATION_PREFERENCES);
  assert.throws(() => saveGenerationPreferences(broken, loadGenerationPreferences()), /denied/);
});
