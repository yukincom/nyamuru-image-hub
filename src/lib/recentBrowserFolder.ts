import type { BrowserDirectoryHandle } from './browserWorkspace.ts';

// Remember folder handles so the browser can reuse their permissions.
const store = 'folders';
const key = 'recent-project';

async function withFolderStore<T>(
  mode: IDBTransactionMode,
  operation: (folders: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  try {
    const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
      const open = indexedDB.open('nyamuru-workspace-folder', 1);
      let blocked = false;
      open.onupgradeneeded = () => open.result.createObjectStore(store);
      open.onblocked = () => { blocked = true; resolve(null); };
      open.onsuccess = () => { if (blocked) open.result.close(); else resolve(open.result); };
      open.onerror = () => reject(open.error);
    });
    if (!db) return null;
    try {
      return await new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = operation(tx.objectStore(store));
        tx.oncomplete = () => resolve(request.result ?? null);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  } catch { return null; } // Private browsing or an unsupported handle can still use the folder this session.
}

export const recentBrowserFolder = () => withFolderStore<BrowserDirectoryHandle>('readonly', folders => folders.get(key));
export const rememberRecentBrowserFolder = (handle: BrowserDirectoryHandle) =>
  withFolderStore('readwrite', folders => folders.put(handle, key));

export interface BrowserSeriesFolder { id: string; handle: BrowserDirectoryHandle; series: true }
export const rememberBrowserSeriesFolder = (record: BrowserSeriesFolder) =>
  withFolderStore('readwrite', folders => folders.put(record, record.id));
export async function savedBrowserSeriesFolders(): Promise<BrowserSeriesFolder[]> {
  const records = await withFolderStore<BrowserSeriesFolder[]>('readonly', folders => folders.getAll());
  return (records ?? []).filter(record => record.series === true && record.handle?.kind === 'directory');
}
