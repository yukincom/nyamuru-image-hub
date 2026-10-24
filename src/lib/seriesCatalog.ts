import type { Character, Manga, MangaDocument, Material, MaterialOrigin } from '../types';
import { cloneDocument } from './manga.ts';
import { backgroundMaterialStages, mergeBackgroundStages } from './background3d.ts';
import { isPropPlacement, newCatalogId, synchronizeCatalogReferences } from './catalogModel.ts';
import {
  isSystemMobCharacter,
  SYSTEM_MOB_CATALOG_ID,
  SYSTEM_MOB_NAME,
  SYSTEM_MOB_ROLE,
} from './systemCharacters.ts';

export interface SeriesCatalogMergeResult {
  document: MangaDocument;
  added: number;
  addedCharacters: number;
  addedMaterials: number;
  conflicts: string[];
}

export interface SeriesCatalogUpsertResult {
  document: MangaDocument;
  conflicts: string[];
}

type IdFactory = () => string;

/** シリーズ資料に既定値がある場合だけ、空の各話設定へ初期値として補完する。 */
export function prefillEpisodeSettingFromSeries(
  episode: Manga['setting'],
  series: Manga['series_setting'],
): Manga['setting'] {
  return {
    location: episode.location.trim() ? episode.location : series.location,
    time: episode.time.trim() ? episode.time : series.time,
    weather: episode.weather.trim() ? episode.weather : series.weather,
    situation: episode.situation,
  };
}

function defaultIdFactory(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function lookupValue(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
}

function characterLookupValues(character: Character): string[] {
  return [character.name, ...(character.aliases ?? [])].map(lookupValue).filter(Boolean);
}

function sameNamedCharacter(entries: readonly Character[], incoming: Character): Character | undefined {
  const incomingValues = new Set(characterLookupValues(incoming));
  if (!incomingValues.size) return undefined;
  const matches = entries.filter((entry) => characterLookupValues(entry).some((value) => incomingValues.has(value)));
  return matches.length === 1 ? matches[0] : undefined;
}

export function currentEpisodeOrigin(document: MangaDocument): MaterialOrigin {
  return {
    episode_id: document.manga.meta.episode_id,
    episode_title: document.manga.meta.title,
    episode_number: document.manga.meta.episode_number,
  };
}

export function materialIsPlacedAsObject(document: MangaDocument, materialKey: string): boolean {
  return document.manga.pages.some((page) => (
    page.panels.some((panel) => panel.figures?.some((figure) => isPropPlacement(figure) && figure.name === materialKey))
    || page.page_overlay?.figures?.some((figure) => isPropPlacement(figure) && figure.name === materialKey)
  ));
}

/** 明示された安定IDの素材だけをシリーズ台帳から外し、通常upsertの非破壊性と分離する。 */
export function removeMaterialsFromSeriesCatalog(
  source: MangaDocument,
  catalogIds: readonly string[],
): MangaDocument {
  const next = cloneDocument(source);
  const deletedIds = new Set(catalogIds.filter(Boolean));
  if (!deletedIds.size) return next;
  next.manga.materials = next.manga.materials.filter((material) => (
    !material.catalog_id || !deletedIds.has(material.catalog_id)
  ));
  next.manga.characters.forEach((character) => {
    if (character.primary_material_catalog_id && deletedIds.has(character.primary_material_catalog_id)) {
      delete character.primary_material_catalog_id;
    }
  });
  synchronizeCatalogReferences(next);
  return next;
}

/** 明示されたシリーズ人物と、その人物だけに紐づく資料を台帳から外す。 */
export function removeCharactersFromSeriesCatalog(
  source: MangaDocument,
  catalogIds: readonly string[],
): MangaDocument {
  const next = cloneDocument(source);
  const deletedIds = new Set(catalogIds.filter(Boolean));
  if (!deletedIds.size) return next;
  const deletedLocalIds = new Set(next.manga.characters.flatMap((character) => (
    character.catalog_id && deletedIds.has(character.catalog_id) && character.localId ? [character.localId] : []
  )));
  next.manga.characters = next.manga.characters.filter((character) => (
    !character.catalog_id || !deletedIds.has(character.catalog_id)
  ));
  next.manga.materials = next.manga.materials.filter((material) => (
    (!material.character_catalog_id || !deletedIds.has(material.character_catalog_id))
    && (!material.characterId || !deletedLocalIds.has(material.characterId))
  ));
  synchronizeCatalogReferences(next);
  return next;
}

/** シリーズ人物・素材へ、名称や話数の変更に左右されない追跡情報を付ける。 */
export function prepareDocumentForSeriesSave(
  source: MangaDocument,
  createId: IdFactory = defaultIdFactory,
): MangaDocument {
  const next = cloneDocument(source);
  synchronizeCatalogReferences(next);
  if (!next.manga.meta.series.trim()) return next;
  next.manga.meta.series_id ||= createId();
  next.manga.meta.episode_id ||= createId();

  next.manga.characters.forEach((character) => {
    if (character.scope === 'series') character.catalog_id ||= createId();
  });
  synchronizeCatalogReferences(next);

  const origin = currentEpisodeOrigin(next);
  next.manga.materials.forEach((material) => {
    if (material.scope !== 'series') return;
    material.catalog_id ||= createId();
    if (!material.origin || material.origin.episode_id === origin.episode_id) material.origin = { ...origin };
    if (material.type === 'character' && material.characterId) {
      const owner = next.manga.characters.find((character) => character.localId === material.characterId);
      if (owner?.scope === 'series' && owner.catalog_id) material.character_catalog_id = owner.catalog_id;
    }
  });

  const materialIds = new Set(
    next.manga.materials.filter((material) => material.scope === 'series').map((material) => material.catalog_id),
  );
  next.manga.characters.forEach((character) => {
    if (character.scope === 'series' && character.primary_material_catalog_id
      && !materialIds.has(character.primary_material_catalog_id)) {
      delete character.primary_material_catalog_id;
    }
  });
  return next;
}

function mergeCharacterFields(target: Character, catalog: Character): void {
  // 明示した話固有値を守り、未設定だけ共通人物から補完する。
  if (target.gender === undefined && catalog.gender !== undefined) target.gender = catalog.gender;
  if (isSystemMobCharacter(target) || isSystemMobCharacter(catalog)) {
    target.name = SYSTEM_MOB_NAME;
    target.role = SYSTEM_MOB_ROLE;
    target.scope = 'series';
    target.catalog_id = SYSTEM_MOB_CATALOG_ID;
    if (catalog.visual_prompt !== undefined) target.visual_prompt = catalog.visual_prompt;
    else delete target.visual_prompt;
    if (catalog.default_proportion) target.default_proportion = structuredClone(catalog.default_proportion);
    else delete target.default_proportion;
    if (catalog.recognition) target.recognition = structuredClone(catalog.recognition);
    else delete target.recognition;
    if (catalog.primary_material_catalog_id) {
      target.primary_material_catalog_id = catalog.primary_material_catalog_id;
    } else {
      delete target.primary_material_catalog_id;
    }
    return;
  }
  target.scope = 'series';
  target.catalog_id ||= catalog.catalog_id;
  if (!target.role.trim() && catalog.role.trim()) target.role = catalog.role;
  if (target.visual_prompt === undefined && catalog.visual_prompt !== undefined) target.visual_prompt = catalog.visual_prompt;
  if (!target.aliases?.length && catalog.aliases?.length) target.aliases = [...catalog.aliases];
  if (!target.default_proportion && catalog.default_proportion) target.default_proportion = structuredClone(catalog.default_proportion);
  if (!target.recognition && catalog.recognition) target.recognition = structuredClone(catalog.recognition);
  if (!target.primary_material_catalog_id && catalog.primary_material_catalog_id) {
    target.primary_material_catalog_id = catalog.primary_material_catalog_id;
  }
}

function mergeMaterialFields(target: Material, catalog: Material): void {
  target.scope = 'series';
  target.catalog_id ||= catalog.catalog_id;
  target.character_catalog_id ||= catalog.character_catalog_id;
  target.characterId ||= catalog.characterId;
  target.origin ||= catalog.origin ? structuredClone(catalog.origin) : undefined;
  target.view ||= catalog.view;
  target.source_image ||= catalog.source_image ? structuredClone(catalog.source_image) : undefined;
  if(target.source_stage_id===undefined)target.source_stage_id=catalog.source_stage_id;
  if (!target.keywords.length && catalog.keywords.length) target.keywords = [...catalog.keywords];
  if (!target.note?.trim() && catalog.note?.trim()) target.note = catalog.note;
}

/** シリーズカタログを作業中OMNYへ統合する。人物を先に安定IDで結び、作業中の内容を優先する。 */
export function mergeSeriesCatalog(
  source: MangaDocument,
  catalog: MangaDocument,
): SeriesCatalogMergeResult {
  const next = cloneDocument(source);
  const catalogCopy = cloneDocument(catalog);
  synchronizeCatalogReferences(next);
  synchronizeCatalogReferences(catalogCopy);
  next.manga.series_setting = structuredClone(catalogCopy.manga.series_setting);
  const conflicts: string[] = [];
  let addedCharacters = 0;
  let addedMaterials = 0;

  const existingCharacterLocalIds = new Set(next.manga.characters.map((character) => character.localId).filter(Boolean));
  catalogCopy.manga.characters.filter((character) => character.scope === 'series').forEach((incoming) => {
    const byId = incoming.catalog_id
      ? next.manga.characters.find((character) => character.catalog_id === incoming.catalog_id)
      : undefined;
    if (byId) {
      mergeCharacterFields(byId, incoming);
      return;
    }
    const byName = sameNamedCharacter(next.manga.characters, incoming);
    if (byName) {
      if (byName.catalog_id && incoming.catalog_id && byName.catalog_id !== incoming.catalog_id) {
        conflicts.push(`人物: ${incoming.name}`);
        return;
      }
      mergeCharacterFields(byName, incoming);
      return;
    }
    const copy = structuredClone(incoming) as Character;
    copy.scope = 'series';
    if (!copy.localId || existingCharacterLocalIds.has(copy.localId)) copy.localId = newCatalogId('person');
    next.manga.characters.push(copy);
    existingCharacterLocalIds.add(copy.localId);
    addedCharacters += 1;
  });

  synchronizeCatalogReferences(next);
  const existingLocalIds = new Set(next.manga.materials.map((material) => material.localId).filter(Boolean));
  catalogCopy.manga.materials.filter((material) => material.scope === 'series').forEach((incoming) => {
    const byId = incoming.catalog_id
      ? next.manga.materials.find((material) => material.catalog_id === incoming.catalog_id)
      : undefined;
    if (byId) {
      mergeMaterialFields(byId, incoming);
      return;
    }
    const byName = next.manga.materials.find((material) => lookupValue(material.key) === lookupValue(incoming.key));
    if (byName) {
      if (byName.catalog_id && incoming.catalog_id && byName.catalog_id !== incoming.catalog_id) {
        conflicts.push(incoming.key);
        return;
      }
      mergeMaterialFields(byName, incoming);
      return;
    }
    const copy = structuredClone(incoming) as Material;
    copy.scope = 'series';
    if (!copy.localId || existingLocalIds.has(copy.localId)) copy.localId = newCatalogId('material');
    if (copy.character_catalog_id) {
      copy.characterId = next.manga.characters.find((character) => character.catalog_id === copy.character_catalog_id)?.localId;
    }
    next.manga.materials.push(copy);
    existingLocalIds.add(copy.localId);
    addedMaterials += 1;
  });

  const needed=new Set(next.manga.materials.map(material=>material.source_stage_id));
  mergeBackgroundStages(next,catalogCopy,backgroundMaterialStages(catalogCopy,'series').filter(stage=>needed.has(stage.id)));
  if (!next.manga.meta.series_id) next.manga.meta.series_id = catalogCopy.manga.meta.series_id;
  synchronizeCatalogReferences(next);
  return {
    document: next,
    added: addedCharacters + addedMaterials,
    addedCharacters,
    addedMaterials,
    conflicts,
  };
}

/** 現在話のシリーズ項目を台帳へupsertし、読み込まれていない既存項目は保持する。 */
export function upsertEpisodeIntoSeriesCatalog(
  existingCatalog: MangaDocument,
  episode: MangaDocument,
): SeriesCatalogUpsertResult {
  const catalog = cloneDocument(existingCatalog);
  const seriesSetting = existingCatalog.manga.meta.document_type === 'series-catalog'
    ? structuredClone(existingCatalog.manga.series_setting)
    : {
      genre: '', target_audience: '', adult_content: false, situation: '', location: '', time: '', weather: '',
    };
  const prepared = prepareDocumentForSeriesSave(episode);
  synchronizeCatalogReferences(catalog);
  synchronizeCatalogReferences(prepared);
  const conflicts: string[] = [];

  prepared.manga.characters.filter((character) => character.scope === 'series').forEach((incoming) => {
    const byId = incoming.catalog_id
      ? catalog.manga.characters.find((character) => character.catalog_id === incoming.catalog_id)
      : undefined;
    const byName = sameNamedCharacter(catalog.manga.characters, incoming);
    if (!byId && byName?.catalog_id && incoming.catalog_id && byName.catalog_id !== incoming.catalog_id) {
      conflicts.push(`人物: ${incoming.name}`);
      return;
    }
    const target = byId ?? byName;
    const copy = structuredClone(incoming);
    if (copy.gender === undefined && target?.gender !== undefined) copy.gender = target.gender;
    if (target) copy.localId = target.localId;
    if (target) catalog.manga.characters[catalog.manga.characters.indexOf(target)] = copy;
    else catalog.manga.characters.push(copy);
  });

  synchronizeCatalogReferences(catalog);
  prepared.manga.materials.filter((material) => material.scope === 'series').forEach((incoming) => {
    const byId = incoming.catalog_id
      ? catalog.manga.materials.find((material) => material.catalog_id === incoming.catalog_id)
      : undefined;
    const byName = catalog.manga.materials.find((material) => lookupValue(material.key) === lookupValue(incoming.key));
    if (!byId && byName?.catalog_id && incoming.catalog_id && byName.catalog_id !== incoming.catalog_id) {
      conflicts.push(incoming.key);
      return;
    }
    const target = byId ?? byName;
    const copy = structuredClone(incoming);
    if (target?.source_image && !copy.source_image) copy.source_image = structuredClone(target.source_image);
    if(copy.source_stage_id===undefined&&target?.source_stage_id!==undefined)copy.source_stage_id=target.source_stage_id;
    if (copy.character_catalog_id) {
      copy.characterId = catalog.manga.characters.find((character) => character.catalog_id === copy.character_catalog_id)?.localId;
    }
    if (target) copy.localId = target.localId;
    if (target) catalog.manga.materials[catalog.manga.materials.indexOf(target)] = copy;
    else catalog.manga.materials.push(copy);
  });

  mergeBackgroundStages(catalog,prepared);
  catalog.manga.background_stages=backgroundMaterialStages(catalog,'series');
  if(!catalog.manga.background_stages.length)delete catalog.manga.background_stages;
  catalog.manga.schema_name = prepared.manga.schema_name;
  catalog.manga.schema_version = prepared.manga.schema_version;
  catalog.manga.meta = structuredClone(prepared.manga.meta);
  catalog.manga.meta.document_type = 'series-catalog';
  catalog.manga.meta.title = prepared.manga.meta.series.trim() || prepared.manga.meta.title;
  catalog.manga.meta.page_count = 0;
  catalog.manga.meta.style_notes = [];
  catalog.manga.layout_spec = '';
  delete catalog.manga.artwork_settings;
  delete catalog.manga.finish_settings;
  delete catalog.manga.print_settings;
  delete (catalog.manga as typeof catalog.manga & { finish_layout?: unknown }).finish_layout;
  catalog.manga.series_setting = seriesSetting;
  catalog.manga.setting = { location: '', time: '', weather: '', situation: '' };
  catalog.manga.pages = [];
  synchronizeCatalogReferences(catalog);
  return { document: catalog, conflicts };
}
