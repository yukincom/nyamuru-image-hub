import type { BrowserDirectoryHandle } from './browserWorkspace.ts';

// Keep just the last saved or opened folder. The browser owns its permission.
const store = 'folders';
const key = 'recent-project';

async function withFolderStore(
  mode: IDBTransactionMode,
  operation: (folders: IDBObjectStore) => IDBRequest,
): Promise<BrowserDirectoryHandle | null> {
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
      return await new Promise<BrowserDirectoryHandle | null>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = operation(tx.objectStore(store));
        tx.oncomplete = () => resolve(request.result?.kind === 'directory' ? request.result : null);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  } catch { return null; } // Private browsing or an unsupported handle can still use the folder this session.
}

export const recentBrowserFolder = () => withFolderStore('readonly', folders => folders.get(key));
export const rememberRecentBrowserFolder = (handle: BrowserDirectoryHandle) =>
  withFolderStore('readwrite', folders => folders.put(handle, key));
