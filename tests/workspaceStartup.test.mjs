import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseMangaYaml, STORAGE_KEY, toStoredMangaYaml } from '../src/lib/manga.ts';
import {
  createEmptyWorkspaceDocument,
  isUnstartedDocument,
  workspaceFromStored,
  LEGACY_SAMPLE_ARCHIVE_KEY,
  preserveLegacySample,
  storeWorkspaceDocument,
} from '../src/lib/workspaceStartup.ts';

test('保存作品がない起動時はキャンバスを開かない', () => {
  const startup = workspaceFromStored(null);
  assert.equal(startup.hasDocument, false);
  assert.equal(startup.document.manga.pages.length, 1);
  assert.deepEqual(startup.document.manga.pages[0].panels, []);
});

test('内部の空データだけが残っていても未開始として扱う', () => {
  const empty = createEmptyWorkspaceDocument();
  const startup = workspaceFromStored(toStoredMangaYaml(empty));
  assert.equal(isUnstartedDocument(empty), true);
  assert.equal(startup.hasDocument, false);
});

test('舞台情報またはコマがある作品は起動時に復元する', () => {
  const storyOnly = createEmptyWorkspaceDocument();
  storyOnly.manga.setting.situation = '駅前で二人が再会する。';
  assert.equal(workspaceFromStored(toStoredMangaYaml(storyOnly)).hasDocument, true);

  const panelOnly = createEmptyWorkspaceDocument();
  panelOnly.manga.pages[0].panels.push({
    id: 1,
    shape: { type: 'rect', x: 10, y: 10, w: 190, h: 277 },
    bg: 1,
    bubbles: [],
    action: null,
  });
  assert.equal(workspaceFromStored(toStoredMangaYaml(panelOnly)).hasDocument, true);
});

test('システム人物だけでは開始扱いにせず、ユーザー人物は作品として復元する', () => {
  const document = createEmptyWorkspaceDocument();
  document.manga.characters.unshift({ name: '主人公', role: '主人公', scope: 'episode' });
  assert.equal(isUnstartedDocument(document), false);
  assert.equal(workspaceFromStored(toStoredMangaYaml(document)).hasDocument, true);
});

const bundledSample = readFileSync(new URL('../src/content/sample.omny.yaml', import.meta.url), 'utf8');
const memoryStorage = (saved) => {
  const values = new Map([[STORAGE_KEY, saved]]);
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('以前のサンプルを自動表示せず、元の保存文字列を復旧用に残す', () => {
  const startup = workspaceFromStored(bundledSample);
  assert.equal(startup.hasDocument, false);
  assert.equal(startup.document.manga.meta.title, '');
  assert.equal(startup.deferredSample, bundledSample);
  const edited = parseMangaYaml(bundledSample);
  edited.manga.pages[0].panels[0].bubbles[0].text = '利用者が編集した台詞';
  const editedRaw = toStoredMangaYaml(edited);
  assert.equal(workspaceFromStored(editedRaw).deferredSample, editedRaw);
});

test('同名のオリジナル作品や別タイトルに発展させた作品は通常復元する', () => {
  const original = createEmptyWorkspaceDocument();
  original.manga.meta.title = '押しかけ妖精にゃむるたん';
  assert.equal(workspaceFromStored(toStoredMangaYaml(original)).hasDocument, true);
  const changed = parseMangaYaml(bundledSample);
  changed.manga.meta.title = '私の新作';
  assert.equal(workspaceFromStored(toStoredMangaYaml(changed)).hasDocument, true);
});

test('新規作品を保存する前に編集済みサンプルを原文のまま保管し、重複しない', () => {
  const storage = memoryStorage(bundledSample);
  assert.deepEqual(preserveLegacySample(storage), [bundledSample]);
  assert.deepEqual(preserveLegacySample(storage), [bundledSample]);
  assert.equal(storage.getItem(STORAGE_KEY), bundledSample);
  const editedRaw = bundledSample.replace('休日の昼下がり。', '夕方に変更した台詞。');
  storage.setItem(STORAGE_KEY, editedRaw);
  const next = toStoredMangaYaml(createEmptyWorkspaceDocument());
  storeWorkspaceDocument(storage, next);
  assert.equal(storage.getItem(STORAGE_KEY), next);
  assert.deepEqual(JSON.parse(storage.getItem(LEGACY_SAMPLE_ARCHIVE_KEY)), [bundledSample, editedRaw]);
});

test('容量不足や保管データ破損時は元の作品を上書きしない', () => {
  const storage = memoryStorage(bundledSample);
  const next = toStoredMangaYaml(createEmptyWorkspaceDocument());
  const failArchive = { getItem: storage.getItem, setItem: (key, value) => {
    if (key === LEGACY_SAMPLE_ARCHIVE_KEY) throw new Error('quota');
    storage.setItem(key, value);
  } };
  assert.throws(() => storeWorkspaceDocument(failArchive, next), /quota/);
  assert.equal(storage.getItem(STORAGE_KEY), bundledSample);
  storage.setItem(LEGACY_SAMPLE_ARCHIVE_KEY, '{broken');
  assert.throws(() => storeWorkspaceDocument(storage, next));
  assert.equal(storage.getItem(STORAGE_KEY), bundledSample);
});

test('復旧サンプルの継続編集では全文の保管履歴を増やさない', () => {
  const storage = memoryStorage(bundledSample);
  preserveLegacySample(storage);
  for (let index = 0; index < 5; index++) {
    const changed = bundledSample.replace('休日の昼下がり。', `利用者の編集${index}。`);
    storeWorkspaceDocument(storage, changed);
    assert.equal(storage.getItem(STORAGE_KEY), changed);
  }
  assert.deepEqual(JSON.parse(storage.getItem(LEGACY_SAMPLE_ARCHIVE_KEY)), [bundledSample]);
});


test('assistant placement QA is archived with edits and never auto-opens the foreign cast', () => {
  const doc = parseMangaYaml(bundledSample);
  doc.manga.meta.title = '画像配置の動作確認';
  doc.manga.meta.episode_id = 'placement-qa-20260926';
  doc.manga.pages[0].panels[0].figures[0].bbox.x = 90.79;
  const raw = toStoredMangaYaml(doc), storage = memoryStorage(raw);
  assert.equal(workspaceFromStored(raw).hasDocument, false);
  assert.equal(workspaceFromStored(raw).deferredSample, raw);
  assert.deepEqual(preserveLegacySample(storage), [raw]);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  doc.manga.meta.episode_id = 'my-own-work';
  assert.equal(workspaceFromStored(toStoredMangaYaml(doc)).hasDocument, true);
});

test('an untitled page containing only artwork is a started document', () => {
  const doc = createEmptyWorkspaceDocument();
  doc.manga.image_assets = [{id:'art',storageId:'original',sha256:'0'.repeat(64),mediaType:'image/png',originalName:'art.png',widthPx:1,heightPx:1,byteLength:1}];
  doc.manga.pages[0].images = [{id:'one',assetId:'art',bbox:{x:0,y:0,w:10,h:10},crop:{x:0,y:0,w:1,h:1},opacity:1,hidden:false,locked:false}];
  assert.equal(workspaceFromStored(toStoredMangaYaml(doc)).hasDocument, true);
});
