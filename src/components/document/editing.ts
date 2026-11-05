import type { MangaDocument, MaterialType, MaterialScope, Material } from '../../types';
import { newCatalogId } from '../../lib/catalogModel.ts';
import { currentEpisodeOrigin } from '../../lib/seriesCatalog.ts';

export interface BaseProps { document: MangaDocument; onChange: (document: MangaDocument) => void }

export interface MaterialPanelLinkMode {
  pageNumber: number;
  panelId: number;
  linkedKeys: readonly string[];
}

export function mutateDocument(document: MangaDocument, onChange: (document: MangaDocument) => void, recipe: (draft: MangaDocument) => void) {
  const next = structuredClone(document); recipe(next); onChange(next);
}

function uniqueMaterialName(document: MangaDocument, base: string): string {
  const names = new Set(document.manga.materials.map((material) => material.key));
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

export function uniqueCharacterName(document: MangaDocument, base = '新しいキャラクター'): string {
  const names = new Set(document.manga.characters.map((character) => character.name));
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

function ensureEpisodeId(document: MangaDocument): void {
  document.manga.meta.episode_id ||= crypto.randomUUID();
}

export function createMaterial(document: MangaDocument, type: MaterialType, scope: MaterialScope, baseName: string): Material {
  ensureEpisodeId(document);
  return {
    localId: newCatalogId('material'),
    key: uniqueMaterialName(document, baseName),
    type,
    scope,
    keywords: [],
    note: '',
    ...(scope === 'series' ? { catalog_id: crypto.randomUUID(), origin: currentEpisodeOrigin(document) } : {}),
  };
}

export function duplicateMaterial(document: MangaDocument, source: Material): Material {
  ensureEpisodeId(document);
  const copy = structuredClone(source);
  copy.localId = newCatalogId('material');
  copy.key = uniqueMaterialName(document, `${source.key} コピー`);
  delete copy.source_image;
  delete copy.view;
  if (copy.scope === 'series') {
    copy.catalog_id = crypto.randomUUID();
    copy.origin = currentEpisodeOrigin(document);
  } else {
    delete copy.catalog_id;
    delete copy.origin;
  }
  return copy;
}

export function setMaterialScope(document: MangaDocument, material: Material, scope: MaterialScope): void {
  if (material.scope === scope) return;
  ensureEpisodeId(document);
  material.scope = scope;
  if (scope === 'series') {
    material.catalog_id ||= crypto.randomUUID();
    material.origin ??= currentEpisodeOrigin(document);
  } else {
    delete material.catalog_id;
    delete material.origin;
  }
}
