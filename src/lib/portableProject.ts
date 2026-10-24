import type { MangaDocument } from '../types.ts';
import { createProjectSnapshot, restoreProjectSnapshot, type ProjectSnapshot } from './projectPersistence.ts';
import { loadCharacterReferenceImage } from './localBridge.ts';
import { saveFigureCropAssets } from './figureCropStore.ts';
import { characterImageCacheId } from './browserCatalog.ts';
import { blobRevision, MAX_PROJECT_FILE_BYTES } from './browserFiles.ts';

interface CharacterImage { seriesId: string; characterId: string; assetId: string; data: string }
export interface PortableProject { format: 'nyamuru-project'; version: 1; snapshot: ProjectSnapshot; characterImages: CharacterImage[] }
const characterReferences = (document: MangaDocument) => document.manga.materials.flatMap(material => {
  if (!material.source_image) return [];
  const characterId = material.character_catalog_id || document.manga.characters.find(item => item.localId === material.characterId)?.catalog_id;
  if (!document.manga.meta.series_id || !characterId) throw new Error('人物資料画像の所属を確認できません');
  return [{ seriesId: document.manga.meta.series_id, characterId, source: material.source_image }];
});
async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export async function createPortableProject(document: MangaDocument, services = { snapshot: createProjectSnapshot, loadCharacter: loadCharacterReferenceImage }): Promise<PortableProject> {
  const snapshot = await services.snapshot(document);
  const characterImages: CharacterImage[] = [], seen = new Set<string>();
  for (const { seriesId, characterId, source } of characterReferences(snapshot.document)) {
    const key = characterImageCacheId(seriesId, characterId, source.asset_id);
    if (seen.has(key)) continue;
    const blob = await services.loadCharacter(seriesId, characterId, source.asset_id);
    if (!blob || blob.size !== source.byte_size || await blobRevision(blob) !== source.sha256) throw new Error('人物資料画像を読み込めないため、作品の保存を中止しました。元の環境で画像を確認してください');
    characterImages.push({ seriesId, characterId, assetId: source.asset_id, data: await base64(blob) }); seen.add(key);
  }
  return { format: 'nyamuru-project', version: 1, snapshot, characterImages };
}
export async function restorePortableProject(value: unknown, services = { restore: restoreProjectSnapshot, saveCharacters: saveFigureCropAssets }): Promise<MangaDocument> {
  const file = value as PortableProject | null;
  if (file?.format !== 'nyamuru-project' || file.version !== 1 || !file.snapshot?.document?.manga || !Array.isArray(file.characterImages)) throw new Error('Nyamuru作品ファイルではありません');
  const images = new Map<string, Blob>();
  for (const image of file.characterImages) {
    if (!image || typeof image.seriesId !== 'string' || typeof image.characterId !== 'string' || !/^image-[a-f0-9]{64}$/.test(image.assetId) || typeof image.data !== 'string') throw new Error('人物資料画像の保存データが不正です');
    const key = characterImageCacheId(image.seriesId, image.characterId, image.assetId);
    if (images.has(key)) throw new Error('人物資料画像が重複しています');
    const blob = new Blob([Uint8Array.from(atob(image.data), c => c.charCodeAt(0))], { type: 'image/png' });
    if (blob.size > 40 * 1024 * 1024 || await blobRevision(blob) !== image.assetId.slice(6)) throw new Error('人物資料画像が保存時と一致しません');
    images.set(key, blob);
  }
  for (const { seriesId, characterId, source } of characterReferences(file.snapshot.document)) {
    const blob = images.get(characterImageCacheId(seriesId, characterId, source.asset_id));
    if (!blob || blob.size !== source.byte_size || source.asset_id !== `image-${source.sha256}`) throw new Error('作品の人物資料画像が不足しています');
    const bytes = new Uint8Array(await blob.arrayBuffer()), header = new DataView(bytes.buffer);
    if (bytes.length < 24 || [137,80,78,71,13,10,26,10].some((b, i) => bytes[i] !== b)
      || header.getUint32(16) !== source.width_px || header.getUint32(20) !== source.height_px) throw new Error('人物資料画像の形式・寸法が一致しません');
  }
  const restored = await services.restore(file.snapshot);
  await services.saveCharacters([...images].map(([id, blob]) => ({ id, blob })));
  return restored;
}
export function portableProjectBlob(file: PortableProject): Blob {
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  if (blob.size > MAX_PROJECT_FILE_BYTES) throw new Error('作品ファイルが大きすぎます（上限192MiB）');
  return blob;
}
export async function readPortableProject(file: File): Promise<unknown> {
  if (file.size > MAX_PROJECT_FILE_BYTES) throw new Error('作品ファイルが大きすぎます（上限192MiB）');
  return JSON.parse(await file.text());
}
