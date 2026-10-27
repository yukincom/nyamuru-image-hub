import type { PersistentAnalogAssetRef } from '../types.ts';
import { loadPersistedAnalogAsset } from './localBridge.ts';

// Work images live only in this page's memory. Explicit project saves embed them.
const assets = new Map<string, Blob>();

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

export async function saveFigureCropAssets(items: readonly FigureCropAsset[]): Promise<void> {
  items.forEach(asset => assets.set(asset.id, asset.blob));
}

export async function loadFigureCropAsset(assetId: string, persistentAsset?: PersistentAnalogAssetRef): Promise<Blob | null> {
  const stored = assets.get(assetId);
  if (stored) return stored;
  if (!persistentAsset) return null;
  const restored = await loadPersistedAnalogAsset(persistentAsset);
  if (restored) assets.set(assetId, restored);
  return restored;
}

export async function deleteFigureCropAssets(assetIds: readonly string[]): Promise<void> {
  assetIds.forEach(id => assets.delete(id));
}

/**
 * 現在の作品・Undo履歴から参照されない切り抜き画像を削除する。
 * 作品の保存とは独立した、編集中メモリーの回収。
 */
export async function pruneFigureCropAssets(referencedAssetIds: readonly string[], currentReferences?:()=>readonly string[]|null, canDeletePaintAsset?:(id:string)=>boolean): Promise<number> {
  const keep = new Set(referencedAssetIds.filter(Boolean));
  const current = currentReferences?.();
  if (current === null) return 0;
  current?.forEach(id => keep.add(id));
  let removed = 0;
  for (const key of assets.keys()) {
    // Keep imported originals until this page closes; they can still be in an import dialog.
    if (!key.startsWith('original-') && !keep.has(key) && (!key.startsWith('paint-') || canDeletePaintAsset?.(key))) {
      assets.delete(key);
      removed += 1;
    }
  }
  return removed;
}
