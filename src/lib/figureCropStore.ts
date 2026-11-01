import type { MangaDocument, Panel, PersistentAnalogAssetRef } from '../types.ts';
import { loadPersistedAnalogAsset } from './localBridge.ts';
import { imageAssetIds } from './imagePlacement.ts';
import { characterImageCacheIds } from './browserCatalog.ts';

// Work images live only in this page's memory. Explicit project saves embed them.
const assets = new Map<string, Blob>();
let importing = 0;
const collectionListeners = new Set<() => void>();

/** Keep unpublished imports alive until their caller commits or abandons them. */
export function beginFigureCropImport(): () => void {
  importing += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--importing === 0) collectionListeners.forEach(notify => notify());
  };
}

export function onFigureCropAssetsChanged(notify: () => void): () => void {
  collectionListeners.add(notify);
  return () => { collectionListeners.delete(notify); };
}

export interface FigureCropAsset {
  id: string;
  blob: Blob;
}

/** 現在の編集データが参照しているローカル画像IDだけを収集する。 */
export function collectFigureCropAssetIds(document: MangaDocument, pendingImageIds: Iterable<string> = []): string[] {
  const assetIds = new Set<string>();
  const used = imageAssetIds(document);
  for (const id of pendingImageIds) used.add(id);
  document.manga?.image_assets?.forEach(asset => { if (used.has(asset.id)) assetIds.add(asset.storageId); });
  // Registered stages and character materials remain usable without a canvas placement.
  document.manga?.background_stages?.forEach(asset => assetIds.add(asset.storageId));
  characterImageCacheIds(document).forEach(id => assetIds.add(id));
  const collect = (owner: Partial<Pick<Panel, 'figures' | 'bubbles'>>) => {
    owner.figures?.forEach((figure) => {
      if (figure.human_pose?.preview) assetIds.add(figure.human_pose.preview.assetId);
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

export async function saveFigureCropAssets(items: readonly FigureCropAsset[]): Promise<void> {
  items.forEach(asset => assets.set(asset.id, asset.blob));
  if (items.length && !importing) collectionListeners.forEach(notify => notify());
}

export async function loadFigureCropAsset(assetId: string, persistentAsset?: PersistentAnalogAssetRef): Promise<Blob | null> {
  const stored = assets.get(assetId);
  if (stored) return stored;
  if (!persistentAsset) return null;
  const restored = await loadPersistedAnalogAsset(persistentAsset);
  if (restored) await saveFigureCropAssets([{id: assetId, blob: restored}]);
  return restored;
}

export async function deleteFigureCropAssets(assetIds: readonly string[]): Promise<void> {
  assetIds.forEach(id => assets.delete(id));
}

/**
 * 現在の作品・Undo履歴から参照されない切り抜き画像を削除する。
 * 作品の保存とは独立した、編集中メモリーの回収。
 */
export async function pruneFigureCropAssets(referencedAssetIds: readonly string[], currentReferences?:()=>readonly string[]|null): Promise<number> {
  if (importing) return 0;
  const keep = new Set(referencedAssetIds.filter(Boolean));
  const current = currentReferences?.();
  if (current === null) return 0;
  current?.forEach(id => keep.add(id));
  let removed = 0;
  for (const key of assets.keys()) {
    if (!keep.has(key)) {
      assets.delete(key);
      removed += 1;
    }
  }
  return removed;
}
