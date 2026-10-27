import { blobRevision, writeProjectFile, MAX_PROJECT_FILE_BYTES, type ProjectFileBinding, type ProjectFileHandle } from './browserFiles.ts';
import { readPortableProject, portableProjectBlob, type PortableProject, type LegacyProjectSource } from './portableProject.ts';
import type { EpisodeWorkspace, EpisodeWorkspaceTextSelection, ReferenceTextSuggestionResult, SeriesDirectorySelection, SeriesReferenceTextCandidate } from './localBridge.ts';

export interface BrowserFileHandle extends ProjectFileHandle { kind: 'file' }
export interface BrowserDirectoryHandle {
  kind: 'directory'; name: string;
  values(): AsyncIterable<BrowserDirectoryHandle | BrowserFileHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<BrowserDirectoryHandle>;
  resolve(handle: BrowserDirectoryHandle | BrowserFileHandle): Promise<string[] | null>;
  isSameEntry(handle: BrowserDirectoryHandle): Promise<boolean>;
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
interface FolderRecord { id: string; handle: BrowserDirectoryHandle }
export interface BrowserFolderStorage {
  all(): Promise<FolderRecord[]>;
  put(record: FolderRecord): Promise<void>;
}
export interface BrowserProjectWorkspace extends EpisodeWorkspace { projectRevision?: string | null }
export interface FolderSaveTarget {
  workspace: BrowserProjectWorkspace; directory: BrowserDirectoryHandle;
  currentRevision: string | null; legacyRevision: string | null; legacySource?: LegacyProjectSource;
}
type PickerWindow = Window & {
  showDirectoryPicker?: (options: object) => Promise<BrowserDirectoryHandle>;
  showOpenFilePicker?: (options: object) => Promise<BrowserFileHandle[]>;
};
const PROJECT_NAME = 'project.json';
const LEGACY_PROJECT_NAME = '作品.nyamuru';
const projectConflict = () => new Error('保存先の作品ファイルが他の画面やアプリで更新されています。新旧両方を保管して確認し、別のフォルダーに保存してください');
const MANAGED_DIRECTORIES = ['name_data', 'draft_data', 'manuscript_data', 'export_data'];
const TEXT_LIMIT = 5 * 1024 * 1024;
const TEXT_EXT = /\.(?:md|markdown|txt|text)$/i;
const folderId = (directory: string) => directory.split('/')[0];
export const isBrowserWorkspace = (workspace?: EpisodeWorkspace | null): boolean => Boolean(workspace?.token.startsWith('browser-folder:'));
const cancelled = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
const displayDirectory = (record: FolderRecord) => `${record.id}/${record.handle.name}`;

const folders = new Map<string, FolderRecord>();
const folderStorage: BrowserFolderStorage = {
  async all() {
    return [...folders.values()];
  },
  async put(record) {
    folders.set(record.id, record);
  },
};

async function readText(file: File): Promise<string> {
  if (!TEXT_EXT.test(file.name) || file.size > TEXT_LIMIT) throw new Error('文章は5MiB以下のUTF-8テキストファイルを選んでください');
  return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
}
async function optionalFile(directory: BrowserDirectoryHandle, name: string) {
  try { const handle = await directory.getFileHandle(name); return { handle, file: await handle.getFile() }; }
  catch (error) { if (missing(error)) return null; throw error; }
}
async function projectEntry(directory: BrowserDirectoryHandle, name: string) {
  const entry = await optionalFile(directory, name);
  if (!entry) return null;
  if (entry.file.size > MAX_PROJECT_FILE_BYTES) throw new Error('作品ファイルが大きすぎます（上限192MiB）');
  return { ...entry, revision: await blobRevision(entry.file) };
}
/** Discovery reads only bounded text inside the explicitly selected folder. */
export async function browserReferenceCandidates(directory: BrowserDirectoryHandle): Promise<SeriesReferenceTextCandidate[]> {
  const found: SeriesReferenceTextCandidate[] = [];
  let visited = 0, bytes = 0;
  async function visit(current: BrowserDirectoryHandle, prefix = '', depth = 0): Promise<void> {
    for await (const entry of current.values()) {
      if (++visited > 1000 || found.length >= 200) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || MANAGED_DIRECTORIES.includes(entry.name)) continue;
      const relativePath = `${prefix}${entry.name}`;
      if (entry.kind === 'directory') { if (depth < 4) await visit(entry, `${relativePath}/`, depth + 1); continue; }
      if (!TEXT_EXT.test(entry.name)) continue;
      const file = await entry.getFile();
      if (file.size > TEXT_LIMIT || bytes + file.size > 20 * 1024 * 1024) continue;
      bytes += file.size;
      let text: string;
      try { text = await readText(file); } catch { continue; }
      const hints = `${relativePath}\n${text.slice(0, 2000)}`;
      const kind = /人物設定|登場人物|キャラクター|characters?/i.test(hints) ? 'characters'
        : /シリーズ設定|世界観|series.?setting|world.?setting/i.test(hints) ? 'series-setting' : 'series-reference';
      found.push({ relativePath, fileName: file.name, text, kind, confidence: kind === 'series-reference' ? 'medium' : 'high', recommended: kind !== 'series-reference' });
    }
  }
  await visit(directory);
  return found.sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.relativePath.localeCompare(b.relativePath, 'ja')).slice(0, 20);
}

/** FileSystem handles stay in page memory until it closes, never in browser storage. */
export class BrowserWorkspaces {
  private storage: BrowserFolderStorage;
  private records = new Map<string, FolderRecord>();
  constructor(storage: BrowserFolderStorage = folderStorage) { this.storage = storage; }
  private async record(key: string): Promise<FolderRecord> {
    const id = folderId(key);
    if (!this.records.has(id)) for (const item of await this.storage.all()) this.records.set(item.id, item);
    const record = this.records.get(id);
    if (!record) throw new Error('このPCの作品フォルダーを選び直してください');
    return record;
  }
  private async remember(handle: BrowserDirectoryHandle): Promise<FolderRecord> {
    for (const item of await this.storage.all()) {
      if (await handle.isSameEntry(item.handle)) { this.records.set(item.id, item); return item; }
    }
    const record = { id: `browser-folder:${crypto.randomUUID()}`, handle };
    await this.storage.put(record); this.records.set(record.id, record);
    return record;
  }
  private async authorize(key: string, mode: 'read' | 'readwrite' = 'read'): Promise<FolderRecord> {
    const record = await this.record(key);
    if (record.handle.queryPermission && await record.handle.queryPermission({ mode }) !== 'granted'
      && (!record.handle.requestPermission || await record.handle.requestPermission({ mode }) !== 'granted')) {
      throw new Error('このPCの作品フォルダーへのアクセスが許可されませんでした。フォルダーを選び直してください');
    }
    return record;
  }
  private async pick(startIn = ''): Promise<FolderRecord | null> {
    const picker = typeof window !== 'undefined' && (window as PickerWindow).showDirectoryPicker;
    if (!picker) throw new Error('このブラウザーではフォルダーを選べません。フォルダー選択に対応したChromeで開いてください');
    const previous = startIn ? await this.record(startIn).catch(() => null) : null;
    try {
      const handle = await picker.call(window, { mode: 'readwrite', ...(previous ? { startIn: previous.handle } : {}) });
      return await this.remember(handle);
    } catch (error) { if (cancelled(error)) return null; throw error; }
  }
  async chooseSeries(startIn = ''): Promise<SeriesDirectorySelection | null> {
    const record = await this.pick(startIn);
    if (!record) return null;
    const candidates = await browserReferenceCandidates(record.handle);
    return { seriesDirectory: displayDirectory(record), candidates, candidateCount: candidates.length, ambiguous: candidates.length > 1, suggestion: null };
  }
  async chooseEpisode(startIn = '', seriesDirectory = '', forNew = false): Promise<EpisodeWorkspace | null> {
    const record = await this.pick(startIn || seriesDirectory);
    if (!record) return null;
    let parent = displayDirectory(record);
    if (seriesDirectory) {
      const series = await this.authorize(seriesDirectory);
      const relative = await series.handle.resolve(record.handle);
      if (!relative || !relative.length) throw new Error('シリーズフォルダー内の、今回のエピソード用フォルダーを選んでください');
      parent = seriesDirectory;
    }
    if (forNew) {
      let nativeProject = null;
      try { nativeProject = await optionalFile(await record.handle.getDirectoryHandle('.nyamuru'), 'project.json'); }
      catch (error) { if (!missing(error)) throw error; }
      if (nativeProject) throw new Error('このフォルダーにはMac Studio形式の作品があります。元のMac Studioの画面で開くか、新しいフォルダーを選んでください');
      const existing = await this.projectFile(record);
      if (existing.saved?.file.size) throw new Error('このフォルダーには作品が保存されています。「作品フォルダーを開く」で再開するか、新しいフォルダーを選んでください');
    }
    return { token: record.id, directory: displayDirectory(record), folderName: record.handle.name, seriesDirectory: parent };
  }
  async suggest(token: string): Promise<ReferenceTextSuggestionResult> {
    const record = await this.authorize(token);
    const candidates = await browserReferenceCandidates(record.handle);
    const preferred = candidates.filter(item => /原作|台本|シナリオ|プロット|脚本|scenario|script|plot/i.test(item.relativePath));
    const pool = preferred.length ? preferred : candidates;
    const item = pool.length === 1 ? pool[0] : null;
    return { candidateCount: candidates.length, ambiguous: pool.length > 1, suggestion: item ? { ...item, selectedBy: 'rules', confidence: 'high' } : null };
  }
  async chooseText(key: string, inFolder = false): Promise<EpisodeWorkspaceTextSelection | null> {
    const record = await this.authorize(key);
    const picker = (window as PickerWindow).showOpenFilePicker;
    if (!picker) throw new Error('このブラウザーではフォルダー内の資料を選べません。Chromeで開いてください');
    try {
      const [handle] = await picker.call(window, { startIn: record.handle, multiple: false, types: [{ description: '原作・台本・設定資料', accept: { 'text/plain': ['.md', '.markdown', '.txt', '.text'] } }] });
      const relative = await record.handle.resolve(handle);
      if (inFolder && !relative) throw new Error('同じシリーズフォルダー内の資料を選んでください');
      const file = await handle.getFile();
      await readText(file);
      return { file, relativePath: relative?.join('/') ?? null, byteSize: file.size, sha256: await blobRevision(file) };
    } catch (error) { if (cancelled(error)) return null; throw error; }
  }
  async prepare(token: string): Promise<string[]> {
    const record = await this.authorize(token, 'readwrite');
    for (const name of MANAGED_DIRECTORIES) await record.handle.getDirectoryHandle(name, { create: true });
    return [...MANAGED_DIRECTORIES];
  }
  private async projectFile(record: FolderRecord) {
    const current = await projectEntry(record.handle, PROJECT_NAME);
    const legacy = await projectEntry(record.handle, LEGACY_PROJECT_NAME);
    // An aborted first write can leave an empty destination. It contains no project.
    const saved = current?.file.size ? current : legacy?.file.size ? legacy : current;
    const value = saved?.file.size ? await readPortableProject(saved.file) : null;
    let legacySource = current?.file.size ? value?.legacy_source : undefined;
    if (current?.file.size && legacy) {
      if (legacySource ? legacySource.sha256 !== legacy.revision : current.revision !== legacy.revision) throw projectConflict();
    }
    if (legacy?.file.size && !legacySource) legacySource = { file_name: LEGACY_PROJECT_NAME, sha256: legacy.revision };
    if (!saved?.file.size) for await (const entry of record.handle.values()) {
      if (entry.kind === 'file' && entry.name !== LEGACY_PROJECT_NAME && entry.name.toLowerCase().endsWith('.nyamuru')) {
        throw new Error('作品フォルダーには「project.json」が必要です。単独で書き出した作品ファイルは開けません');
      }
    }
    return { saved, value, legacySource, currentRevision: current?.revision ?? null, legacyRevision: legacy?.revision ?? null };
  }
  async open(workspace: EpisodeWorkspace): Promise<{ file: File; value: PortableProject; binding: ProjectFileBinding }> {
    const record = await this.authorize(workspace.token);
    const { saved, value } = await this.projectFile(record);
    if (!saved || !value) throw new Error('このフォルダーに作品ファイル（project.json）がありません');
    return { file: saved.file, value, binding: { handle: saved.handle, revision: saved.revision } };
  }
  /** Acquire permission while the Save click is still active, before encoding the images. */
  async saveTarget(workspace: BrowserProjectWorkspace): Promise<FolderSaveTarget> {
    const record = await this.authorize(workspace.token, 'readwrite');
    const { saved, legacySource, currentRevision, legacyRevision } = await this.projectFile(record);
    const expected = workspace.projectRevision ?? null;
    if (saved?.file.size && expected === null) throw new Error('保存先に別の作品があります。別のフォルダーを選ぶか、保存済みの作品を開いてください');
    if (!saved && expected !== null) throw new Error('保存先の作品ファイルが見つかりません。別のフォルダーに保存してください');
    const revision = saved?.revision ?? null;
    if (expected !== null && revision !== expected) throw new Error('作品ファイルが他の画面やアプリで更新されています。別のフォルダーに保存してください');
    return { workspace, directory: record.handle, legacySource, currentRevision, legacyRevision };
  }
  async write(file: PortableProject, target: FolderSaveTarget) {
    const { legacy_source: _source, ...content } = file;
    const blob = portableProjectBlob({ ...content, ...(target.legacySource ? { legacy_source: target.legacySource } : {}) });
    let currentRevision = target.currentRevision;
    const check = async () => {
      const current = await projectEntry(target.directory, PROJECT_NAME);
      const legacy = await projectEntry(target.directory, LEGACY_PROJECT_NAME);
      if ((current?.revision ?? null) !== currentRevision || (legacy?.revision ?? null) !== target.legacyRevision) throw projectConflict();
    };
    return writeProjectFile(blob, {
      name: PROJECT_NAME, check,
      resolve: async () => {
        await check();
        const handle = await target.directory.getFileHandle(PROJECT_NAME, { create: true });
        const initial = await handle.getFile();
        if (currentRevision === null) {
          if (initial.size) throw projectConflict();
          currentRevision = await blobRevision(initial);
        }
        return { handle, revision: currentRevision };
      },
    });
  }
}
export const browserWorkspaces = new BrowserWorkspaces();
