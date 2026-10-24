import { blobRevision, writeProjectFile, MAX_PROJECT_FILE_BYTES, type ProjectFileBinding, type ProjectFileHandle } from './browserFiles.ts';
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
export interface FolderSaveTarget { workspace: BrowserProjectWorkspace; directory: BrowserDirectoryHandle; fileName: string; binding: ProjectFileBinding | null }
type PickerWindow = Window & {
  showDirectoryPicker?: (options: object) => Promise<BrowserDirectoryHandle>;
  showOpenFilePicker?: (options: object) => Promise<BrowserFileHandle[]>;
};
const PROJECT_NAME = '作品.nyamuru';
const MANAGED_DIRECTORIES = ['name_data', 'draft_data', 'manuscript_data', 'export_data'];
const TEXT_LIMIT = 5 * 1024 * 1024;
const TEXT_EXT = /\.(?:md|markdown|txt|text)$/i;
const folderId = (directory: string) => directory.split('/')[0];
export const isBrowserWorkspace = (workspace?: EpisodeWorkspace | null): boolean => Boolean(workspace?.token.startsWith('browser-folder:'));
const cancelled = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
const displayDirectory = (record: FolderRecord) => `${record.id}/${record.handle.name}`;

function folderDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('nyamuru-browser-folders', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('folders', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const folderStorage: BrowserFolderStorage = {
  async all() {
    const db = await folderDatabase();
    try { return await new Promise<FolderRecord[]>((resolve, reject) => {
      const request = db.transaction('folders').objectStore('folders').getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    }); } finally { db.close(); }
  },
  async put(record) {
    const db = await folderDatabase();
    try { await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('folders', 'readwrite');
      tx.objectStore('folders').put(record);
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
    }); } finally { db.close(); }
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

/** FileSystem handles stay in this browser. They are never sent to the AI server. */
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
      if (existing && existing.file.size) throw new Error('このフォルダーには作品が保存されています。「作品フォルダーを開く」で再開するか、新しいフォルダーを選んでください');
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
    const saved = await optionalFile(record.handle, PROJECT_NAME);
    if (saved) return saved;
    for await (const entry of record.handle.values()) {
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.nyamuru')) {
        throw new Error('作品フォルダーには「作品.nyamuru」が必要です。単独で書き出した作品ファイルは開けません');
      }
    }
    return null;
  }
  async open(workspace: EpisodeWorkspace): Promise<{ file: File; binding: ProjectFileBinding }> {
    const record = await this.authorize(workspace.token);
    const saved = await this.projectFile(record);
    if (!saved) throw new Error('このフォルダーに作品ファイル（.nyamuru）がありません');
    if (saved.file.size > MAX_PROJECT_FILE_BYTES) throw new Error('作品ファイルが大きすぎます（上限192MiB）');
    return { file: saved.file, binding: { handle: saved.handle, revision: await blobRevision(saved.file) } };
  }
  /** Acquire permission while the Save click is still active, before encoding the images. */
  async saveTarget(workspace: BrowserProjectWorkspace): Promise<FolderSaveTarget> {
    const record = await this.authorize(workspace.token, 'readwrite');
    const saved = await this.projectFile(record);
    const expected = workspace.projectRevision ?? null;
    if (saved?.file.size && expected === null) throw new Error('保存先に別の作品があります。別のフォルダーを選ぶか、保存済みの作品を開いてください');
    if (!saved && expected !== null) throw new Error('保存先の作品ファイルが見つかりません。別のフォルダーに保存してください');
    const revision = saved ? await blobRevision(saved.file) : null;
    if (expected !== null && revision !== expected) throw new Error('作品ファイルが他の画面やアプリで更新されています。別のフォルダーに保存してください');
    return { workspace, directory: record.handle, fileName: PROJECT_NAME, binding: saved ? { handle: saved.handle, revision: revision! } : null };
  }
  async write(blob: Blob, target: FolderSaveTarget) {
    if (blob.size > MAX_PROJECT_FILE_BYTES) throw new Error('作品ファイルが大きすぎます（上限192MiB）');
    let binding = target.binding;
    if (!binding) {
      const handle = await target.directory.getFileHandle(target.fileName, { create: true });
      const file = await handle.getFile();
      if (file.size) throw new Error('保存先に別の作品が作られています。別のフォルダーに保存してください');
      binding = { handle, revision: await blobRevision(file) };
    }
    return writeProjectFile(blob, binding);
  }
}
export const browserWorkspaces = new BrowserWorkspaces();
