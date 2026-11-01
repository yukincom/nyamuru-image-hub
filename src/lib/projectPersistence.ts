import { loadBackgroundStage } from './backgroundStageStore.ts';
import { imageAssetIds, validateImagePlacements, verifyOriginal } from './imagePlacement.ts';
import { stageMediaType, verifyBackgroundStage } from './background3d.ts';
import type { MangaDocument, PersistentAnalogAssetRef } from '../types.ts';
import type { EpisodeWorkspace } from './localBridge.ts';
import { cloneDocument, parseMangaYaml, toStoredMangaYaml } from './manga.ts';
import { loadFigureCropAsset, saveFigureCropAssets, type FigureCropAsset } from './figureCropStore.ts';

export interface ProjectBinding extends EpisodeWorkspace {
  episodeId: string;
  projectRevision?: string | null;
}
export interface ProjectSnapshot {
  version: 1;
  document: MangaDocument;
  assets: Array<{ id: string; type: string; data: string }>;
}
function imageReferences(document: MangaDocument) {
  const refs: Array<{ assetId: string; persistentAsset?: PersistentAnalogAssetRef }> = [];
  for (const page of document.manga.pages) {
    for (const owner of [...page.panels, ...(page.page_overlay ? [page.page_overlay] : [])]) {
      for (const figure of owner.figures ?? []) {
        if (figure.analogImport) refs.push(figure.analogImport);
        if (figure.human_pose?.preview) refs.push(figure.human_pose.preview);
      }
      for (const bubble of owner.bubbles ?? []) if (bubble.analogTextImport) refs.push(bubble.analogTextImport);
    }
  }
  for (const asset of document.manga.image_assets ?? []) {
    refs.push({ get assetId() { return asset.storageId; }, set assetId(id: string) { asset.storageId = id; } });
  }
  for(const stage of document.manga.background_stages??[])refs.push({get assetId(){return stage.storageId;},set assetId(id:string){stage.storageId=id;}});
  return refs;
}

export async function createProjectSnapshot(document: MangaDocument, loadAsset = loadFigureCropAsset): Promise<ProjectSnapshot> {
  validateImagePlacements(document);
  const saved = cloneDocument(document);
  const placedIds = imageAssetIds(saved);
  if (saved.manga.image_assets) saved.manga.image_assets = saved.manga.image_assets.filter(asset => placedIds.has(asset.id));
  const assets: ProjectSnapshot['assets'] = [];
  const seen = new Set<string>();
  for (const ref of imageReferences(saved)) {
    if (seen.has(ref.assetId)) continue;
    const stage=(saved.manga.background_stages??[]).find(item=>item.storageId===ref.assetId);
    const blob = stage&&loadAsset===loadFigureCropAsset?await loadBackgroundStage(stage):await loadAsset(ref.assetId, ref.persistentAsset);
    if (!blob) throw new Error('参照画像を読み込めないため、作品の保存を中止しました。画像のある元の環境で保存してください');
    for (const asset of saved.manga.image_assets ?? []) if (asset.storageId === ref.assetId) await verifyOriginal(asset, blob);
    for(const stage of saved.manga.background_stages??[])if(stage.storageId===ref.assetId)await verifyBackgroundStage(stage,blob);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    assets.push({ id: ref.assetId, type: blob.type || 'image/png', data: btoa(binary) });
    seen.add(ref.assetId);
  }
  return { version: 1, document: saved, assets };
}

/** Validate before writing images; fresh IDs never overwrite another open work's cached images. */
export async function restoreProjectSnapshot(value: unknown, saveAssets = saveFigureCropAssets): Promise<MangaDocument> {
  const snapshot = value as ProjectSnapshot | null;
  if (snapshot?.version !== 1 || !snapshot.document?.manga || !Array.isArray(snapshot.assets)) {
    throw new Error('作品の保存データを読み込めませんでした');
  }
  const document = parseMangaYaml(toStoredMangaYaml(snapshot.document));
  const originalIds = new Set([...(document.manga.image_assets??[]),...(document.manga.background_stages??[])].map(asset => asset.storageId));
  const stages=new Map((document.manga.background_stages??[]).map(stage=>[stage.storageId,stage]));
  const available = new Map<string, FigureCropAsset>();
  for (const asset of snapshot.assets) {
    const stage=stages.get(asset.id);
    if (!asset.id || available.has(asset.id) || !(stage?asset.type===stageMediaType(stage):['image/png', 'image/jpeg', 'image/webp'].includes(asset.type)) || typeof asset.data !== 'string') {
      throw new Error('参照画像の保存データを読み込めませんでした');
    }
    const binary = atob(asset.data);
    if (!binary.length) throw new Error('参照画像が空です');
    available.set(asset.id, { id: `${originalIds.has(asset.id) ? 'original' : 'project'}-${crypto.randomUUID()}`, blob: new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: asset.type }) });
  }
  for (const asset of document.manga.image_assets ?? []) {
    const original = available.get(asset.storageId);
    if (!original) throw new Error('作品の原本画像が不足しています');
    await verifyOriginal(asset, original.blob);
  }
  for(const stage of stages.values()){
    const original=available.get(stage.storageId);
    if(!original)throw new Error('作品の3D舞台の原本が不足しています');
    await verifyBackgroundStage(stage,original.blob);
  }
  const needed = new Map<string, FigureCropAsset>();
  for (const ref of imageReferences(document)) {
    const asset = available.get(ref.assetId);
    if (!asset) throw new Error('作品の参照画像が不足しています');
    needed.set(asset.id, asset);
    ref.assetId = asset.id;
  }
  await saveAssets([...needed.values()]);
  return document;
}
