import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserWorkspaces, browserReferenceCandidates } from '../src/lib/browserWorkspace.ts';
import { blobRevision } from '../src/lib/browserFiles.ts';

const project = title => ({ format: 'nyamuru-project', version: 1, snapshot: { document: { manga: { meta: { title } } } }, characterImages: [] });
const json = title => JSON.stringify(project(title));
const title = opened => opened.value.snapshot.document.manga.meta.title;

class Folder {
  kind = 'directory'; entries = new Map(); permission = 'granted';
  constructor(name) { this.name = name; }
  async *values() { yield* this.entries.values(); }
  async isSameEntry(other) { return other === this; }
  async queryPermission() { return this.permission; }
  async requestPermission() { return this.permission; }
  async resolve(target) {
    if (target === this) return [];
    for (const [name, entry] of this.entries) {
      if (entry === target) return [name];
      if (entry.kind === 'directory') { const rest = await entry.resolve(target); if (rest) return [name, ...rest]; }
    }
    return null;
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.entries.has(name) && create) this.entries.set(name, new Folder(name));
    const found = this.entries.get(name);
    if (!found) throw new DOMException('missing', 'NotFoundError');
    if (found.kind !== 'directory') throw new DOMException('wrong kind', 'TypeMismatchError');
    return found;
  }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.entries.has(name) && create) {
      const handle = { name, kind: 'file', file: new File([], name), fail: false, aborted: false,
        async getFile() { return this.file; },
        async createWritable() {
          let pending; const handle = this;
          return {
            async write(blob) { if (handle.fail) throw Error('disk full'); pending = blob; },
            async close() { handle.file = new File([pending], name); },
            async abort() { handle.aborted = true; },
          };
        },
      };
      this.entries.set(name, handle);
    }
    const found = this.entries.get(name);
    if (!found) throw new DOMException('missing', 'NotFoundError');
    if (found.kind !== 'file') throw new DOMException('wrong kind', 'TypeMismatchError');
    return found;
  }
  async add(name, text) {
    const handle = await this.getFileHandle(name, { create: true });
    handle.file = new File([text], name); return handle;
  }
}
function fixture() {
  const saved = new Map(), storage = { all: async () => [...saved.values()], put: async record => { saved.set(record.id, record); } };
  const series = new Folder('星の喫茶室'), episode = new Folder('第1話');
  series.entries.set(episode.name, episode);
  let picked = episode, opened;
  globalThis.window = { showDirectoryPicker: async () => picked, showOpenFilePicker: async () => [opened] };
  return { series, episode, storage, client: new BrowserWorkspaces(storage), pick: value => { picked = value; }, open: value => { opened = value; } };
}
test('local folder discovery reads nested text, excludes managed data, and recognizes ambiguous scripts', async () => {
  const f = fixture(), sub = await f.series.getDirectoryHandle('資料', { create: true });
  await sub.add('人物設定.md', '# 登場人物\nアオ：店員');
  await f.episode.add('台本.txt', '台詞');
  const managed = await f.episode.getDirectoryHandle('draft_data', { create: true }); await managed.add('ignored.txt', 'ignored');
  const candidates = await browserReferenceCandidates(f.series);
  assert.deepEqual(candidates.map(x => x.relativePath).sort(), ['第1話/台本.txt', '資料/人物設定.md'].sort());
  assert.equal(candidates[0].kind, 'characters');
  const workspace = await f.client.chooseEpisode();
  assert.equal((await f.client.suggest(workspace.token)).suggestion.text, '台詞');
  await f.episode.add('原作.txt', '別の候補');
  assert.equal((await f.client.suggest(workspace.token)).ambiguous, true);
  assert.equal((await f.client.suggest(workspace.token)).suggestion, null);
});
test('episode must be inside the chosen series and series references cannot escape it', async () => {
  const f = fixture(); f.pick(f.series);
  const series = await f.client.chooseSeries();
  await assert.rejects(f.client.chooseEpisode('', series.seriesDirectory, true), /エピソード用/);
  f.pick(new Folder('別の作品'));
  await assert.rejects(f.client.chooseEpisode('', series.seriesDirectory, true), /エピソード用/);
  f.pick(f.episode);
  assert.equal((await f.client.chooseEpisode('', series.seriesDirectory, true)).seriesDirectory, series.seriesDirectory);
  const text = await f.episode.add('台本.txt', '台詞'); f.open(text);
  assert.equal((await f.client.chooseText(series.seriesDirectory, true)).relativePath, '第1話/台本.txt');
  f.open(await new Folder('outside').add('外.txt', '外部'));
  await assert.rejects(f.client.chooseText(series.seriesDirectory, true), /同じシリーズ/);
});
test('save writes a real project file in the selected folder; a fresh client recovers the stored handle', async () => {
  const f = fixture(), workspace = await f.client.chooseEpisode('', '', true);
  const dirs = await f.client.prepare(workspace.token);
  assert.deepEqual(dirs, ['name_data', 'draft_data', 'manuscript_data', 'export_data']);
  const first = await f.client.write(project('project A'), await f.client.saveTarget(workspace));
  const fresh = new BrowserWorkspaces(f.storage);
  const opened = await fresh.open(workspace);
  assert.equal(title(opened), 'project A');
  assert.equal(opened.file.name, 'project.json');
  assert.equal(f.episode.entries.has('作品.nyamuru'), false);
  const binding = { ...workspace, projectRevision: opened.binding.revision };
  const second = await fresh.write(project('project B'), await fresh.saveTarget(binding));
  assert.notEqual(first.binding.revision, second.binding.revision);
  assert.equal(title(await fresh.open(workspace)), 'project B');
});
test('existing portable or native work cannot be chosen as a new project destination', async () => {
  const f = fixture(); await f.episode.add('作品.nyamuru', json('existing'));
  await assert.rejects(f.client.chooseEpisode('', '', true), /保存されています/);
  const native = new Folder('native'); f.pick(native);
  await (await native.getDirectoryHandle('.nyamuru', { create: true })).add('project.json', 'existing');
  await assert.rejects(f.client.chooseEpisode('', '', true), /Mac Studio形式/);
});
test('external updates, removed files, and files created after destination choice cannot be overwritten', async () => {
  const f = fixture(), workspace = await f.client.chooseEpisode();
  const first = await f.client.write(project('original'), await f.client.saveTarget(workspace));
  const bound = { ...workspace, projectRevision: first.binding.revision };
  await f.episode.add('project.json', json('external'));
  await assert.rejects(f.client.saveTarget(bound), /更新されています/);
  assert.equal(title(await f.client.open(workspace)), 'external');
  f.episode.entries.delete('project.json');
  await assert.rejects(f.client.saveTarget(bound), /見つかりません/);
  const target = await f.client.saveTarget(workspace);
  await f.episode.add('project.json', json('race winner'));
  await assert.rejects(f.client.write(project('loser'), target), /更新されています/);
  assert.equal(title(await f.client.open(workspace)), 'race winner');
});
test('failed writes abort and preserve the last saved project', async () => {
  const f = fixture(), workspace = await f.client.chooseEpisode();
  const first = await f.client.write(project('original'), await f.client.saveTarget(workspace));
  const handle = await f.episode.getFileHandle('project.json'); handle.fail = true;
  const target = await f.client.saveTarget({ ...workspace, projectRevision: first.binding.revision });
  await assert.rejects(f.client.write(project('new'), target), /disk full/);
  assert.equal(handle.aborted, true); assert.equal(await handle.file.text(), json('original'));
});
test('cancel and denied permission do not create files or report a saved project', async () => {
  const f = fixture(), workspace = await f.client.chooseEpisode();
  f.episode.permission = 'denied';
  await assert.rejects(f.client.saveTarget(workspace), /許可されません/);
  assert.equal(f.episode.entries.size, 0);
  window.showDirectoryPicker = async () => { throw new DOMException('cancelled', 'AbortError'); };
  assert.equal(await f.client.chooseEpisode(), null);
});
test('renamed standalone files and remembered legacy names cannot bypass folder storage', async () => {
  const f = fixture(), workspace = await f.client.chooseEpisode();
  await f.episode.add('第1話.nyamuru', 'standalone');
  await assert.rejects(f.client.open(workspace), /単独で書き出した/);
  await assert.rejects(f.client.saveTarget(workspace), /単独で書き出した/);
  assert.equal(f.episode.entries.has('作品.nyamuru'), false);
  await f.episode.getFileHandle('project.json', { create: true });
  await assert.rejects(f.client.chooseEpisode('', '', true), /単独で書き出した/);
  await assert.rejects(f.client.saveTarget(workspace), /単独で書き出した/);
  await assert.rejects(f.client.open(workspace), /単独で書き出した/);
  await f.episode.add('作品.nyamuru', json('folder project'));
  assert.equal(title(await f.client.open(workspace)), 'folder project');
});

test('unsupported browsers fail explicitly without offering standalone files', async () => {
  const f = fixture();
  delete window.showDirectoryPicker;
  await assert.rejects(f.client.chooseEpisode(), error => {
    assert.match(error.message, /Chrome/);
    assert.doesNotMatch(error.message, /作品ファイルで保存/);
    return true;
  });
  assert.equal(f.episode.entries.size, 0);
});

test('legacy-only open is read-only; explicit saves migrate once and retain the original provenance', async () => {
  const f = fixture(), legacy = await f.episode.add('作品.nyamuru', json('old'));
  const original = legacy.file, workspace = await f.client.chooseEpisode();
  const opened = await f.client.open(workspace);
  assert.equal(opened.file, original);
  assert.equal(f.episode.entries.size, 1);
  const bound = { ...workspace, projectRevision: opened.binding.revision };
  const migrated = await f.client.write(project('new'), await f.client.saveTarget(bound));
  assert.equal(legacy.file, original);
  assert.equal(migrated.binding.handle.name, 'project.json');
  const origin = { file_name: '作品.nyamuru', sha256: await blobRevision(original) };
  assert.deepEqual((await f.client.open(workspace)).value.legacy_source, origin);
  f.episode.entries.delete('作品.nyamuru');
  const second = await f.client.write(project('newer'), await f.client.saveTarget({ ...bound, projectRevision: migrated.binding.revision }));
  assert.deepEqual((await f.client.open(workspace)).value.legacy_source, origin);
  await f.episode.add('作品.nyamuru', json('old app edit'));
  await assert.rejects(f.client.open(workspace), /更新されています/);
  await assert.rejects(f.client.saveTarget({ ...bound, projectRevision: second.binding.revision }), /更新されています/);
  assert.equal(JSON.parse(await second.binding.handle.file.text()).snapshot.document.manga.meta.title, 'newer');
});

test('both names require identical bytes or valid provenance; invalid records are not adopted', async () => {
  for (const variant of ['identical', 'different', 'valid', 'invalid']) {
    const f = fixture(), workspace = await f.client.chooseEpisode();
    const legacy = await f.episode.add('作品.nyamuru', json('old'));
    const value = project(variant === 'identical' ? 'old' : 'new');
    if (variant === 'valid') value.legacy_source = { file_name: '作品.nyamuru', sha256: await blobRevision(legacy.file) };
    if (variant === 'invalid') value.legacy_source = { file_name: 'unknown.nyamuru', sha256: 'bad' };
    const current = await f.episode.add('project.json', JSON.stringify(value)), before = current.file;
    if (variant === 'different' || variant === 'invalid') await assert.rejects(f.client.open(workspace), /更新されています|移行記録が不正/);
    else {
      const opened = await f.client.open(workspace);
      assert.equal(opened.file.name, 'project.json');
      const target = await f.client.saveTarget({ ...workspace, projectRevision: opened.binding.revision });
      await f.client.write(project('next'), target);
      assert.equal((await f.client.open(workspace)).value.legacy_source.sha256, await blobRevision(legacy.file));
    }
    assert.equal(await legacy.file.text(), json('old'));
    if (variant === 'different' || variant === 'invalid') assert.equal(current.file, before);
  }
});

test('prepared migrations reject appearance, removal or changes of either name', async () => {
  for (const change of ['create-current', 'change-legacy', 'remove-legacy', 'create-legacy', 'remove-current', 'change-current']) {
    const f = fixture(), workspace = await f.client.chooseEpisode();
    const legacyStart = ['create-current', 'change-legacy', 'remove-legacy'].includes(change);
    await f.episode.add(legacyStart ? '作品.nyamuru' : 'project.json', json('start'));
    const opened = await f.client.open(workspace);
    const target = await f.client.saveTarget({ ...workspace, projectRevision: opened.binding.revision });
    if (change.startsWith('remove')) f.episode.entries.delete(legacyStart ? '作品.nyamuru' : 'project.json');
    else await f.episode.add(change.endsWith('legacy') ? '作品.nyamuru' : 'project.json', json('external'));
    const before = [...f.episode.entries].map(([name, handle]) => [name, handle.file]);
    await assert.rejects(f.client.write(project('loser'), target), /更新されています/);
    assert.deepEqual([...f.episode.entries].map(([name, handle]) => [name, handle.file]), before);
  }
});

test('migration checks legacy changes after writer acquisition and before publication', async () => {
  for (const phase of ['open', 'write']) {
    const f = fixture(), workspace = await f.client.chooseEpisode();
    const legacy = await f.episode.add('作品.nyamuru', json('old'));
    const empty = await f.episode.getFileHandle('project.json', { create: true });
    const opened = await f.client.open(workspace), before = empty.file;
    const target = await f.client.saveTarget({ ...workspace, projectRevision: opened.binding.revision });
    const create = empty.createWritable.bind(empty);
    empty.createWritable = async () => {
      const writer = await create();
      if (phase === 'open') legacy.file = new File([json('external')], legacy.name);
      else { const write = writer.write; writer.write = async blob => { await write(blob); legacy.file = new File([json('external')], legacy.name); }; }
      return writer;
    };
    await assert.rejects(f.client.write(project('new'), target), /更新されています/);
    assert.equal(empty.file, before); assert.equal(empty.aborted, true);
  }
});

test('failed first migration retains old bytes and can retry through the existing empty destination', async () => {
  const f = fixture(), workspace = await f.client.chooseEpisode();
  const legacy = await f.episode.add('作品.nyamuru', json('old')), original = legacy.file;
  const opened = await f.client.open(workspace), bound = { ...workspace, projectRevision: opened.binding.revision };
  const target = await f.client.saveTarget(bound);
  const get = f.episode.getFileHandle.bind(f.episode);
  f.episode.getFileHandle = async (name, options) => { const handle = await get(name, options); if (options?.create) handle.fail = true; return handle; };
  await assert.rejects(f.client.write(project('new'), target), /disk full/);
  assert.equal(legacy.file, original);
  assert.equal(title(await f.client.open(workspace)), 'old');
  f.episode.getFileHandle = get;
  (await get('project.json')).fail = false;
  await f.client.write(project('new'), await f.client.saveTarget(bound));
  assert.equal(title(await f.client.open(workspace)), 'new');
  assert.equal(legacy.file, original);
});

test('same-folder concurrent new saves and migrations have exactly one winner', async () => {
  for (const migrating of [false, true]) {
    const f = fixture(), workspace = await f.client.chooseEpisode();
    if (migrating) {
      await f.episode.add('作品.nyamuru', json('old'));
      workspace.projectRevision = (await f.client.open(workspace)).binding.revision;
    }
    const targets = await Promise.all([f.client.saveTarget(workspace), f.client.saveTarget(workspace)]);
    const outcomes = await Promise.allSettled(targets.map((target, i) => f.client.write(project(`edit-${i}`), target)));
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(outcomes.find(result => result.status === 'rejected').reason.message, /更新されています/);
    assert.equal(title(await f.client.open(workspace)), 'edit-0');
  }
});

test('default folder handles stay in page memory and require selection again in a fresh page', async () => {
  const f=fixture(),client=new BrowserWorkspaces();
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,get:()=>assert.fail('must not access IndexedDB')});
  try {
    const workspace=await client.chooseEpisode();
    assert.equal(f.episode.entries.size,0,'selection alone writes no project');
    await client.write(project('explicit save'),await client.saveTarget(workspace));
    assert.equal(title(await new BrowserWorkspaces().open(workspace)),'explicit save');
    const fresh=await import('../src/lib/browserWorkspace.ts?fresh-memory-test');
    const reopened=new fresh.BrowserWorkspaces();
    await assert.rejects(reopened.open(workspace),/選び直し/);
    const selected=await reopened.chooseEpisode();
    assert.equal(title(await reopened.open(selected)),'explicit save');
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'indexedDB',descriptor);else delete globalThis.indexedDB;
  }
});

import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { toSeriesCatalogMangaYaml } from '../src/lib/manga.ts';
import { saveBrowserCatalog, loadBrowserCatalog, listBrowserCatalogs } from '../src/lib/browserCatalog.ts';
test('client series catalogs are session-only and retain revision conflicts without browser writes', async () => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,get:()=>assert.fail('must not access IndexedDB')});
  try {
    const doc=createEmptyWorkspaceDocument();doc.manga.meta.series='memory-series';doc.manga.meta.series_id='memory-series-id';
    const yaml=toSeriesCatalogMangaYaml(doc);
    const result=await saveBrowserCatalog('memory-series','memory-series-id',yaml,'');
    assert.equal((await loadBrowserCatalog('memory-series','memory-series-id')).revision,result.revision);
    await assert.rejects(saveBrowserCatalog('memory-series','memory-series-id',yaml,'stale'),/更新/);
    const items=await listBrowserCatalogs();items[0].seriesName='mutated copy';
    assert.equal((await loadBrowserCatalog('memory-series','memory-series-id')).seriesName,'memory-series');
    const fresh=await import('../src/lib/browserCatalog.ts?fresh-memory-test');
    assert.equal((await fresh.loadBrowserCatalog('memory-series','memory-series-id')).found,false);
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'indexedDB',descriptor);else delete globalThis.indexedDB;
  }
});
