export interface ProjectFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(options?: { mode?: 'exclusive'; keepExistingData?: boolean }): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}
export interface ProjectFileBinding { handle: ProjectFileHandle; revision: string }
export const MAX_PROJECT_FILE_BYTES = 192 * 1024 * 1024;

export async function blobRevision(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function chooseBrowserFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.hidden = true;
    document.body.append(input);
    const finish = (files: File[]) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => finish([]), { once: true });
    input.click();
  });
}
export function downloadBrowserBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  // Revocation after navigation lets Safari finish accepting the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
const pendingWrites = new Map<string, Promise<unknown>>();
async function withFileLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const key = `nyamuru-project:${name}`;
  if (globalThis.navigator?.locks) return navigator.locks.request(key, operation);
  // Older browsers still serialize saves in this window; the native writer also requests exclusivity.
  const pending = (pendingWrites.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
  pendingWrites.set(key, pending);
  try { return await pending; }
  finally { if (pendingWrites.get(key) === pending) pendingWrites.delete(key); }
}
export async function writeProjectFile(blob: Blob, binding: ProjectFileBinding): Promise<{ binding: ProjectFileBinding }> {
  if (blob.size > MAX_PROJECT_FILE_BYTES) throw new Error('作品ファイルが大きすぎます（上限192MiB）');
  if (!binding) throw new Error('作品フォルダーを選んでください');
  return withFileLock(binding.handle.name, async () => {
    const checkRevision = async () => {
      if (await blobRevision(await binding.handle.getFile()) !== binding.revision) throw new Error('保存先のファイルが他の画面やアプリで更新されています。環境設定から別のフォルダーを選んでください');
    };
    await checkRevision();
    const revision = await blobRevision(blob);
    const writable = await binding.handle.createWritable({ mode: 'exclusive' });
    try { await checkRevision(); await writable.write(blob); await writable.close(); }
    catch (error) { await writable.abort().catch(() => undefined); throw error; }
    return { binding: { handle: binding.handle, revision } };
  });
}
