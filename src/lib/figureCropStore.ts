import type { PersistentAnalogAssetRef } from '../types.ts';
import { loadPersistedAnalogAsset } from './localBridge.ts';

const DATABASE_NAME = 'nyamuru-image-hub-local-assets';
const DATABASE_VERSION = 1;
const FIGURE_CROP_STORE = 'figure-crops';

export interface FigureCropAsset {
  id: string;
  blob: Blob;
}

interface LocalAssetReferenceDocument {
  manga?: {
    image_assets?: Array<{ storageId: string }>;
    background_stages?: Array<{ storageId: string }>;
    pages?: Array<{
      page_overlay?: {
        figures?: Array<{ analogImport?: { assetId?: string } }>;
        bubbles?: Array<{ analogTextImport?: { assetId?: string } }>;
      };
      panels?: Array<{
        figures?: Array<{ analogImport?: { assetId?: string } }>;
        bubbles?: Array<{ analogTextImport?: { assetId?: string } }>;
      }>;
    }>;
  };
}

/** 現在の編集データが参照しているローカル画像IDだけを収集する。 */
export function collectFigureCropAssetIds(document: LocalAssetReferenceDocument): string[] {
  const assetIds = new Set<string>();
  document.manga?.image_assets?.forEach(asset => assetIds.add(asset.storageId));
  document.manga?.background_stages?.forEach(asset => assetIds.add(asset.storageId));
  const collect = (owner: { figures?: Array<{ analogImport?: { assetId?: string } }>; bubbles?: Array<{ analogTextImport?: { assetId?: string } }> }) => {
    owner.figures?.forEach((figure) => {
      const assetId = figure.analogImport?.assetId?.trim();
      if (assetId) assetIds.add(assetId);
    });
    owner.bubbles?.forEach((bubble) => {
      const assetId = bubble.analogTextImport?.assetId?.trim();
      if (assetId) assetIds.add(assetId);
    });
  };
  document.manga?.pages?.forEach((page) => {
    page.panels?.forEach(collect);
    if (page.page_overlay) collect(page.page_overlay);
  });
  return [...assetIds];
}

function openFigureCropDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('このブラウザではローカル参照画像の保存を利用できません'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(FIGURE_CROP_STORE)) database.createObjectStore(FIGURE_CROP_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('ローカル参照画像の保存領域を開けませんでした'));
  });
}

export async function saveFigureCropAssets(assets: readonly FigureCropAsset[]): Promise<void> {
  if (!assets.length) return;
  const database = await openFigureCropDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(FIGURE_CROP_STORE, 'readwrite');
      const store = transaction.objectStore(FIGURE_CROP_STORE);
      assets.forEach((asset) => store.put(asset.blob, asset.id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('ローカル参照画像を保存できませんでした'));
      transaction.onabort = () => reject(transaction.error ?? new Error('ローカル参照画像の保存が中断されました'));
    });
  } finally {
    database.close();
  }
}

export async function loadFigureCropAsset(assetId: string, persistentAsset?: PersistentAnalogAssetRef): Promise<Blob | null> {
  if (typeof indexedDB !== 'undefined') {
    try {
      const database = await openFigureCropDatabase();
      try {
        const stored = await new Promise<Blob | null>((resolve, reject) => {
          const request = database.transaction(FIGURE_CROP_STORE, 'readonly').objectStore(FIGURE_CROP_STORE).get(assetId);
          request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
          request.onerror = () => reject(request.error ?? new Error('ローカル参照画像を読み込めませんでした'));
        });
        if (stored) return stored;
      } finally {
        database.close();
      }
    } catch {
      // ブラウザ保存が利用できない場合も、明示保存済みならDocumentsから復元する。
    }
  }
  if (!persistentAsset) return null;
  const restored = await loadPersistedAnalogAsset(persistentAsset);
  if (restored) await saveFigureCropAssets([{ id: assetId, blob: restored }]).catch(() => undefined);
  return restored;
}

export async function deleteFigureCropAssets(assetIds: readonly string[]): Promise<void> {
  const uniqueIds = [...new Set(assetIds.filter(Boolean))];
  if (!uniqueIds.length || typeof indexedDB === 'undefined') return;
  const database = await openFigureCropDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(FIGURE_CROP_STORE, 'readwrite');
      const store = transaction.objectStore(FIGURE_CROP_STORE);
      uniqueIds.forEach((assetId) => store.delete(assetId));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('ローカル参照画像を削除できませんでした'));
      transaction.onabort = () => reject(transaction.error ?? new Error('ローカル参照画像の削除が中断されました'));
    });
  } finally {
    database.close();
  }
}

/**
 * 現在の作品・Undo履歴から参照されない切り抜き画像を削除する。
 * 作成途中の強制終了で孤児が残っても、次回の自動保存後に回収できる。
 */
export async function pruneFigureCropAssets(referencedAssetIds: readonly string[], currentReferences?:()=>readonly string[]|null, canDeletePaintAsset?:(id:string)=>boolean): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const keep = new Set(referencedAssetIds.filter(Boolean));
  const database = await openFigureCropDatabase();
  try {
    return await new Promise<number>((resolve, reject) => {
      const transaction = database.transaction(FIGURE_CROP_STORE, 'readwrite');
      const store = transaction.objectStore(FIGURE_CROP_STORE);
      const keys = store.getAllKeys();
      let removed = 0;
      keys.onsuccess = () => {
        // Recheck at transaction time: a paint save may have started or finished while opening the database.
        const current=currentReferences?.();
        // null means the caller no longer knows which persisted work to protect.
        if(current===null)return;
        current?.forEach(id=>keep.add(id));
        keys.result.forEach((key) => {
          // Originals are persistent library assets, not disposable analysis crops.
          // Keep them across imports, document switches and stale prune transactions.
          if (typeof key === 'string' && !key.startsWith('original-') && !keep.has(key) && (!key.startsWith('paint-')||canDeletePaintAsset?.(key))) {
            store.delete(key);
            removed += 1;
          }
        });
      };
      keys.onerror = () => reject(keys.error ?? new Error('ローカル参照画像の一覧を取得できませんでした'));
      transaction.oncomplete = () => resolve(removed);
      transaction.onerror = () => reject(transaction.error ?? new Error('不要なローカル参照画像を削除できませんでした'));
      transaction.onabort = () => reject(transaction.error ?? new Error('不要なローカル参照画像の削除が中断されました'));
    });
  } finally {
    database.close();
  }
}
