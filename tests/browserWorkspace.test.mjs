import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserWorkspaces, browserReferenceCandidates } from '../src/lib/browserWorkspace.ts';

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
  const first = await f.client.write(new Blob(['project A']), await f.client.saveTarget(workspace));
  const fresh = new BrowserWorkspaces(f.storage);
  const opened = await fresh.open(workspace);
  assert.equal(await opened.file.text(), 'project A');
  const binding = { ...workspace, projectRevision: opened.binding.revision };
  const second = await fresh.write(new Blob(['project B']), await fresh.saveTarget(binding));
  assert.notEqual(first.binding.revision, second.binding.revision);
  assert.equal(await (await fresh.open(workspace)).file.text(), 'project B');
});
test('existing portable or native work cannot be chosen as a new project destination', async () => {
  const f = fixture(); await f.episode.add('作品.nyamuru', 'existing');
  await assert.rejects(f.client.chooseEpisode('', '', true), /保存されています/);
  const native = new Folder('native'); f.pick(native);
  await (await native.getDirectoryHandle('.nyamuru', { create: true })).add('project.json', 'existing');
  await assert.rejects(f.client.chooseEpisode('', '', true), /Mac Studio形式/);
});
test('external updates, removed files, and files created after destination choice cannot be overwritten', async () => {
  const f = fixture(), workspace = await f.client.chooseEpisode();
  const first = await f.client.write(new Blob(['original']), await f.client.saveTarget(workspace));
  const bound = { ...workspace, projectRevision: first.binding.revision };
  await f.episode.add('作品.nyamuru', 'external');
  await assert.rejects(f.client.saveTarget(bound), /更新されています/);
  assert.equal(await (await f.client.open(workspace)).file.text(), 'external');
  f.episode.entries.delete('作品.nyamuru');
  await assert.rejects(f.client.saveTarget(bound), /見つかりません/);
  const target = await f.client.saveTarget(workspace);
  await f.episode.add('作品.nyamuru', 'race winner');
  await assert.rejects(f.client.write(new Blob(['loser']), target), /別の作品/);
  assert.equal(await (await f.client.open(workspace)).file.text(), 'race winner');
});
test('failed writes abort and preserve the last saved project', async () => {
  const f = fixture(), workspace = await f.client.chooseEpisode();
  const first = await f.client.write(new Blob(['original']), await f.client.saveTarget(workspace));
  const handle = await f.episode.getFileHandle('作品.nyamuru'); handle.fail = true;
  const target = await f.client.saveTarget({ ...workspace, projectRevision: first.binding.revision });
  await assert.rejects(f.client.write(new Blob(['new']), target), /disk full/);
  assert.equal(handle.aborted, true); assert.equal(await handle.file.text(), 'original');
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
  await f.episode.add('作品.nyamuru', 'folder project');
  assert.equal(await (await f.client.open(workspace)).file.text(), 'folder project');
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
