import type { MangaDocument } from '../types.ts';
import { parseMangaYaml, toSeriesCatalogMangaYaml } from './manga.ts';
import { prepareDocumentForSeriesSave } from './seriesCatalog.ts';
import { blobRevision } from './browserFiles.ts';

interface BrowserCatalog { seriesId: string; seriesName: string; omnyYaml: string; revision: string; updatedAt: string }
const catalogs = new Map<string, BrowserCatalog>();
export async function listBrowserCatalogs(): Promise<BrowserCatalog[]> {
  return [...catalogs.values()].map(item => ({ ...item }));
}
export async function loadBrowserCatalog(seriesName: string, seriesId: string) {
  const catalogs = await listBrowserCatalogs();
  const item = seriesId ? catalogs.find(row => row.seriesId === seriesId) : catalogs.find(row => row.seriesName === seriesName);
  return item ? { ...item, found: true } : { found: false, seriesName, seriesId, omnyYaml: '', revision: '' };
}
export async function saveBrowserCatalog(seriesName: string, seriesId: string, omnyYaml: string, expectedRevision: string) {
  const parsed = parseMangaYaml(omnyYaml);
  if (!seriesId || parsed.manga.meta.series_id !== seriesId || parsed.manga.meta.series !== seriesName) throw new Error('シリーズの保存情報が一致しません');
  const revision = await blobRevision(new Blob([omnyYaml]));
  if ((catalogs.get(seriesId)?.revision ?? '') !== expectedRevision) throw new Error('シリーズが更新されました。開き直してください');
  catalogs.set(seriesId, { seriesName, seriesId, omnyYaml, revision, updatedAt: new Date().toISOString() });
  return { seriesId, directory: '編集中のシリーズ', revision };
}
/** File import populates this page's series picker only for the current session. */
export async function rememberBrowserCatalog(document: MangaDocument): Promise<void> {
  const prepared = prepareDocumentForSeriesSave(document);
  const { series: name, series_id: id } = prepared.manga.meta;
  if (!name || !id) return;
  const current = await loadBrowserCatalog(name, id);
  // Existing series are reconciled by the normal catalog editor, never replaced by an older file.
  if (!current.found) await saveBrowserCatalog(name, id, toSeriesCatalogMangaYaml(prepared), '');
}

export const characterImageCacheId = (seriesId: string, characterId: string, assetId: string) => `original-character-${seriesId}-${characterId}-${assetId}`;
