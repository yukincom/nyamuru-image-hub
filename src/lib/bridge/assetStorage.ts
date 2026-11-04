import type { CharacterReferenceSourceImage, AnalogAssetKind, PersistentAnalogAssetRef } from '../../types';
import { verifiedPngSha256, postJson, blobDataUrl, dataUrlBlob } from './transport.ts';
import { isLanClient } from '../clientRuntime.ts';
import { characterImageCacheId } from '../browserCatalog.ts';
import { checkCharacterReferenceSize } from '../characterReferences.ts';
import type { BackgroundStage } from '../../types.ts';
import { verifyBackgroundStage, stageMediaType } from '../background3d.ts';

export interface SavedCharacterReferenceImage {
  sourceImage: CharacterReferenceSourceImage;
  /** この要求で新しく作られた場合だけtrue。中断時の安全な整理に使う。 */
  created: boolean;
}

export async function saveCharacterReferenceImage(
  blob: Blob,
  originalName: string,
  seriesId: string,
  characterCatalogId: string,
): Promise<SavedCharacterReferenceImage> {
  const uploadedSha256 = await verifiedPngSha256(blob);
  if (isLanClient) {
    const { loadFigureCropAsset, saveFigureCropAssets } = await import('../figureCropStore.ts');
    const id = `image-${uploadedSha256}`, key = characterImageCacheId(seriesId, characterCatalogId, id);
    const bytes = new DataView(await blob.arrayBuffer());
    const width = bytes.byteLength >= 24 ? bytes.getUint32(16) : 0, height = bytes.byteLength >= 24 ? bytes.getUint32(20) : 0;
    checkCharacterReferenceSize(width, height);
    if (blob.size > 40 * 1024 * 1024) throw new Error('人物資料画像は40MB以内にしてください');
    const created = !await loadFigureCropAsset(key);
    await saveFigureCropAssets([{ id: key, blob }]);
    return { created, sourceImage: { schema_version: 1, asset_id: id, file_name: `characters/${characterCatalogId}/${id}.png`,
      original_name: originalName.replace(/[\\/]/g, '_').slice(0, 255) || 'image.png', media_type: 'image/png', byte_size: blob.size,
      width_px: width, height_px: height, sha256: uploadedSha256 } };
  }
  const payload = await postJson('/api/series/character-images/save', {
    series_id: seriesId,
    character_catalog_id: characterCatalogId,
    original_name: originalName,
    image: await blobDataUrl(blob),
  }, 60_000) as Record<string, unknown>;
  const source = payload.source_image && typeof payload.source_image === 'object' && !Array.isArray(payload.source_image)
    ? payload.source_image as Record<string, unknown>
    : null;
  const assetId = typeof source?.asset_id === 'string' ? source.asset_id : '';
  const fileName = typeof source?.file_name === 'string' ? source.file_name : '';
  const responseOriginalName = typeof source?.original_name === 'string' ? source.original_name.trim() : '';
  const sha256 = typeof source?.sha256 === 'string' ? source.sha256 : '';
  const byteSize = source?.byte_size;
  const width = source?.width_px;
  const height = source?.height_px;
  if (payload.ok !== true || typeof payload.created !== 'boolean'
    || source?.schema_version !== 1 || source?.media_type !== 'image/png'
    || payload.series_id !== seriesId || payload.character_catalog_id !== characterCatalogId
    || !/^image-[a-f0-9]{64}$/.test(assetId) || !/^[a-f0-9]{64}$/.test(sha256)
    || sha256 !== uploadedSha256 || byteSize !== blob.size
    || assetId !== `image-${sha256}`
    || fileName !== `characters/${characterCatalogId}/${assetId}.png`
    || !responseOriginalName || responseOriginalName.length > 255 || /[\\/]/.test(responseOriginalName)
    || typeof byteSize !== 'number' || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > 40 * 1024 * 1024
    || typeof width !== 'number' || typeof height !== 'number'
    || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > 12000 || height > 12000 || width * height > 60_000_000) {
    throw new Error('人物資料画像の保存結果が正しくありません');
  }
  return {
    created: payload.created,
    sourceImage: {
      schema_version: 1,
      asset_id: assetId,
      file_name: fileName,
      original_name: responseOriginalName,
      media_type: 'image/png',
      byte_size: byteSize,
      width_px: width,
      height_px: height,
      sha256,
    },
  };
}

export async function loadCharacterReferenceImage(
  seriesId: string,
  characterCatalogId: string,
  assetId: string,
): Promise<Blob | null> {
  const cached = await (await import('../figureCropStore.ts')).loadFigureCropAsset(characterImageCacheId(seriesId, characterCatalogId, assetId));
  if (cached) {
    if (assetId !== `image-${await verifiedPngSha256(cached)}`) throw new Error('人物資料画像の整合性を確認できません');
    return cached;
  }
  if (isLanClient) return null;
  const payload = await postJson('/api/series/character-images/load', {
    series_id: seriesId,
    character_catalog_id: characterCatalogId,
    asset_id: assetId,
  }, 20_000) as Record<string, unknown>;
  if (payload.series_id !== seriesId || payload.character_catalog_id !== characterCatalogId || payload.asset_id !== assetId) {
    throw new Error('保存済みの人物資料画像の応答形式が正しくありません');
  }
  if (payload.found !== true && payload.found !== false) {
    throw new Error('保存済みの人物資料画像の応答形式が正しくありません');
  }
  if (!payload.found) return null;
  const blob = dataUrlBlob(payload.image);
  if (!blob || blob.type !== 'image/png' || blob.size < 1 || blob.size > 40 * 1024 * 1024) {
    throw new Error('保存済みの人物資料画像を読み込めませんでした');
  }
  const sha256 = await verifiedPngSha256(blob);
  if (assetId !== `image-${sha256}`) throw new Error('保存済みの人物資料画像の整合性を確認できません');
  return blob;
}

export async function deleteCharacterReferenceImage(
  seriesId: string,
  characterCatalogId: string,
  assetId: string,
): Promise<void> {
  // Browser originals can still be referenced by Undo or another work; retain the cached blob.
  if (isLanClient) return;
  const payload = await postJson('/api/series/character-images/delete', {
    series_id: seriesId,
    character_catalog_id: characterCatalogId,
    asset_id: assetId,
  }, 20_000) as Record<string, unknown>;
  if (payload.ok !== true || payload.series_id !== seriesId
    || payload.character_catalog_id !== characterCatalogId || payload.asset_id !== assetId) {
    throw new Error('人物資料画像の削除結果が正しくありません');
  }
}

export async function persistAnalogAsset(
  blob: Blob,
  episodeId: string,
  workTitle: string,
  kind: AnalogAssetKind,
  assetId: string,
): Promise<PersistentAnalogAssetRef> {
  const payload = await postJson('/api/analog-assets/save', {
    episode_id: episodeId,
    work_title: workTitle,
    kind,
    asset_id: assetId,
    image: await blobDataUrl(blob),
  }, 30_000) as Record<string, unknown>;
  if (typeof payload.work_key !== 'string' || typeof payload.file_name !== 'string' || payload.kind !== kind) {
    throw new Error('原画参照画像の保存結果が正しくありません');
  }
  return {
    schemaVersion: 1,
    workKey: payload.work_key,
    kind,
    fileName: payload.file_name,
  };
}

export async function loadPersistedAnalogAsset(reference: PersistentAnalogAssetRef): Promise<Blob | null> {
  const payload = await postJson('/api/analog-assets/load', {
    work_key: reference.workKey,
    kind: reference.kind,
    file_name: reference.fileName,
  }, 15_000) as Record<string, unknown>;
  if (payload.found !== true) return null;
  const blob = dataUrlBlob(payload.image);
  if (!blob) throw new Error('保存済みの原画参照画像を読み込めませんでした');
  return blob;
}

export async function saveSeriesBackgroundModel(seriesId:string,stage:BackgroundStage,blob:Blob):Promise<void> {
  await verifyBackgroundStage(stage,blob);
  const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  const payload=await postJson('/api/series/background-models/save',{series_id:seriesId,stage,model_data:btoa(binary)},60_000) as Record<string,unknown>;
  if(payload.ok!==true||payload.series_id!==seriesId||payload.stage_id!==stage.id||typeof payload.created!=='boolean')throw new Error('シリーズ背景の3Dモデルを保存できませんでした');
}

export async function loadSeriesBackgroundModel(seriesId:string,stage:BackgroundStage):Promise<Blob|null> {
  const payload=await postJson('/api/series/background-models/load',{series_id:seriesId,stage_id:stage.id,format:stage.format},60_000) as Record<string,unknown>;
  if(payload.series_id!==seriesId||payload.stage_id!==stage.id||payload.format!==stage.format||typeof payload.found!=='boolean')throw new Error('シリーズ背景の3Dモデルの応答形式が正しくありません');
  if(!payload.found)return null;
  if(typeof payload.model_data!=='string')throw new Error('シリーズ背景の3Dモデルが空です');
  const binary=atob(payload.model_data),blob=new Blob([Uint8Array.from(binary,char=>char.charCodeAt(0))],{type:stageMediaType(stage)});
  await verifyBackgroundStage(stage,blob);return blob;
}

/** The server verifies the immutable original without returning its model bytes. */
export async function hasSeriesBackgroundModel(seriesId:string,stage:BackgroundStage):Promise<boolean> {
  const payload=await postJson('/api/series/background-models/load',{series_id:seriesId,stage_id:stage.id,format:stage.format,verify_only:true},60_000) as Record<string,unknown>;
  if(payload.series_id!==seriesId||payload.stage_id!==stage.id||payload.format!==stage.format||typeof payload.found!=='boolean'||payload.found&&payload.byte_length!==stage.byteLength)throw new Error('シリーズ背景の3Dモデルの保存状態を確認できませんでした');
  return payload.found;
}
