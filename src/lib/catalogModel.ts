import type {
  Bubble,
  Character,
  Figure,
  MangaDocument,
  Material,
  Panel,
  PlacementKind,
} from '../types.ts';
import { ensureSystemMobCharacter, isDetectedFigureCharacter } from './systemCharacters.ts';
import { paintReferenceBox } from './paint/ownerEdits.ts';

type CatalogIdKind = 'person' | 'character' | 'material';

function lookupValue(value: string): string {
  return value.normalize('NFKC').trim();
}

function hashSeed(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + 0x7ed55d16), 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function deterministicId(kind: CatalogIdKind, name: string, index: number): string {
  return `${kind}-${hashSeed(`${kind}\0${lookupValue(name)}\0${index}`)}`;
}

function usableId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
}

function assignIds<T extends { localId?: string }>(
  entries: readonly T[],
  kind: CatalogIdKind,
  name: (entry: T) => string,
): void {
  const used = new Set<string>();
  entries.forEach((entry, index) => {
    let candidate = usableId(entry.localId) && !used.has(entry.localId)
      ? entry.localId
      : deterministicId(kind, name(entry), index);
    let suffix = 2;
    while (used.has(candidate)) candidate = `${deterministicId(kind, name(entry), index)}-${suffix++}`;
    entry.localId = candidate;
    used.add(candidate);
  });
}

function uniqueNameMatch<T>(entries: readonly T[], value: string, name: (entry: T) => string): T | undefined {
  const target = lookupValue(value);
  if (!target) return undefined;
  const matches = entries.filter((entry) => lookupValue(name(entry)) === target);
  return matches.length === 1 ? matches[0] : undefined;
}

function characterLookupNames(character: Character): string[] {
  return [character.name, ...(character.aliases ?? [])].map(lookupValue).filter(Boolean);
}

/**
 * OMNYの人物資料を登場人物へ戻すための名前規則。
 * キーワード完全一致を優先し、素材名は「人物名の〜」等の明示的な接頭辞だけを使う。
 */
export function inferMaterialCharacter(material: Material, characters: readonly Character[]): Character | undefined {
  if (material.type !== 'character') return undefined;
  if (usableId(material.character_catalog_id)) {
    return characters.find((character) => character.catalog_id === material.character_catalog_id);
  }
  const byKeyword = characters.filter((character) => material.keywords.some((keyword) => (
    characterLookupNames(character).includes(lookupValue(keyword))
  )));
  const keywordMatch = byKeyword.length === 1 ? byKeyword[0] : undefined;
  if (keywordMatch) return keywordMatch;

  const key = lookupValue(material.key);
  const byKey = characters.flatMap((character) => {
    const matches = characterLookupNames(character).filter((name) => {
      if (key === name) return true;
      const remainder = key.slice(name.length);
      return key.startsWith(name) && /^(?:の|・|｜|:|：|\s)/u.test(remainder);
    });
    return matches.length ? [{ character, length: Math.max(...matches.map((name) => name.length)) }] : [];
  });
  if (!byKey.length) return undefined;
  const longest = Math.max(...byKey.map((entry) => entry.length));
  const matches = byKey.filter((entry) => entry.length === longest);
  return matches.length === 1 ? matches[0].character : undefined;
}

function synchronizeFigure(
  figure: Figure,
  characters: readonly Character[],
  materials: readonly Material[],
): void {
  const kind: PlacementKind = figure.kind === 'prop' || figure.object ? 'prop' : 'person';
  figure.kind = kind;
  delete figure.object;
  if (kind === 'person') {
    const byId = usableId(figure.refId)
      ? characters.find((character) => character.localId === figure.refId)
      : undefined;
    const linked = byId ?? uniqueNameMatch(characters, figure.name, (character) => character.name);
    if (!linked?.localId) {
      delete figure.refId;
      return;
    }
    figure.refId = linked.localId;
    figure.name = linked.name;
  } else {
    const props = materials.filter((material) => material.type === 'prop');
    const byId = usableId(figure.refId)
      ? props.find((material) => material.localId === figure.refId)
      : undefined;
    const linked = byId ?? uniqueNameMatch(props, figure.name, (material) => material.key);
    if (!linked?.localId) {
      delete figure.refId;
      return;
    }
    figure.refId = linked.localId;
    figure.name = linked.key;
  }
}

function synchronizeBubble(bubble: Bubble, characters: readonly Character[]): void {
  if (!bubble.speaker?.trim() && !bubble.speakerId) {
    delete bubble.speakerId;
    return;
  }
  const byId = usableId(bubble.speakerId)
    ? characters.find((character) => character.localId === bubble.speakerId)
    : undefined;
  const linked = byId ?? uniqueNameMatch(characters, bubble.speaker ?? '', (character) => character.name);
  if (!linked?.localId) {
    delete bubble.speakerId;
    return;
  }
  bubble.speakerId = linked.localId;
  bubble.speaker = linked.name;
}

function synchronizePanelAssets(panel: Panel, materials: readonly Material[]): void {
  if (!panel.assets?.length) {
    delete panel.assetIds;
    return;
  }
  const existingIds = panel.assetIds ?? [];
  panel.assetIds = panel.assets.map((key, index) => {
    const byId = usableId(existingIds[index])
      ? materials.find((material) => material.localId === existingIds[index])
      : undefined;
    const linked = byId ?? uniqueNameMatch(materials, key, (material) => material.key);
    if (!linked?.localId) return '';
    panel.assets![index] = linked.key;
    return linked.localId;
  });
}

function synchronizeOwner(
  owner: { figures?: Figure[]; bubbles?: Bubble[] },
  characters: readonly Character[],
  materials: readonly Material[],
): void {
  owner.figures?.forEach((figure) => synchronizeFigure(figure, characters, materials));
  owner.bubbles?.forEach((bubble) => synchronizeBubble(bubble, characters));
}

/** ローカル作業用のIDと名称を相互同期する。渡された文書をその場で更新する。 */
export function synchronizeCatalogReferences(document: MangaDocument): void {
  const { manga } = document;
  manga.characters ??= [];
  manga.materials ??= [];
  manga.characters = manga.characters.filter((character) => !isDetectedFigureCharacter(character));
  ensureSystemMobCharacter(manga.characters);
  assignIds(manga.characters, 'person', (character) => character.name);
  assignIds(manga.materials, 'material', (material) => material.key);

  const characterIds = new Set(manga.characters.map((character) => character.localId));
  manga.materials.forEach((material) => {
    if (material.type !== 'character') {
      delete material.characterId;
      delete material.character_catalog_id;
      delete material.view;
      delete material.source_image;
      return;
    }
    const existing = usableId(material.characterId)
      ? manga.characters.find((character) => character.localId === material.characterId)
      : undefined;
    const stable = usableId(material.character_catalog_id)
      ? manga.characters.find((character) => character.catalog_id === material.character_catalog_id)
      : undefined;
    const linked = existing ?? stable ?? inferMaterialCharacter(material, manga.characters);
    if (linked?.localId && characterIds.has(linked.localId)) {
      material.characterId = linked.localId;
      if (linked.catalog_id) material.character_catalog_id = linked.catalog_id;
      else delete material.character_catalog_id;
    } else {
      delete material.characterId;
    }
  });

  manga.pages.forEach((page) => {
    page.panels.forEach((panel) => {
      synchronizeOwner(panel, manga.characters, manga.materials);
      synchronizePanelAssets(panel, manga.materials);
    });
    if (page.page_overlay) synchronizeOwner(page.page_overlay, manga.characters, manga.materials);
  });
}

function replaceKeyword(keywords: string[], oldName: string, newName: string): string[] {
  const oldKey = lookupValue(oldName);
  const next = keywords.map((keyword) => lookupValue(keyword) === oldKey ? newName : keyword);
  if (newName.trim() && !next.some((keyword) => lookupValue(keyword) === lookupValue(newName))) next.push(newName.trim());
  return next.filter((keyword) => keyword.trim() !== '');
}

function renamedCharacterMaterialKey(key: string, oldName: string, newName: string): string {
  const oldKey = lookupValue(oldName);
  const normalizedKey = lookupValue(key);
  if (!oldKey || !normalizedKey.startsWith(oldKey)) return key;
  const remainder = normalizedKey.slice(oldKey.length);
  return remainder === '' || /^(?:の|・|｜|:|：|\s)/u.test(remainder) ? `${newName}${remainder}` : key;
}

function forEachOwner(document: MangaDocument, callback: (owner: { figures?: Figure[]; bubbles?: Bubble[] }) => void): void {
  document.manga.pages.forEach((page) => {
    page.panels.forEach(callback);
    if (page.page_overlay) callback(page.page_overlay);
  });
}

export function renameCharacter(document: MangaDocument, characterId: string, newName: string): void {
  synchronizeCatalogReferences(document);
  const character = document.manga.characters.find((entry) => entry.localId === characterId);
  if (!character) return;
  const oldName = character.name;
  character.name = newName;
  forEachOwner(document, (owner) => {
    owner.figures?.forEach((figure) => {
      if (figure.kind === 'person' && (figure.refId === characterId || lookupValue(figure.name) === lookupValue(oldName))) {
        figure.refId = characterId;
        figure.name = newName;
      }
    });
    owner.bubbles?.forEach((bubble) => {
      if (bubble.speakerId === characterId || lookupValue(bubble.speaker ?? '') === lookupValue(oldName)) {
        bubble.speakerId = characterId;
        if (newName.trim()) bubble.speaker = newName;
        else delete bubble.speaker;
      }
    });
  });
  document.manga.materials.filter((material) => material.characterId === characterId).forEach((material) => {
    const nextKey = renamedCharacterMaterialKey(material.key, oldName, newName);
    if (nextKey !== material.key && material.localId) renameMaterial(document, material.localId, nextKey);
    material.keywords = replaceKeyword(material.keywords, oldName, newName);
  });
}

export function renameMaterial(document: MangaDocument, materialId: string, newKey: string): void {
  synchronizeCatalogReferences(document);
  const material = document.manga.materials.find((entry) => entry.localId === materialId);
  if (!material) return;
  const oldKey = material.key;
  material.key = newKey;
  document.manga.pages.forEach((page) => {
    page.panels.forEach((panel) => {
      panel.figures?.forEach((figure) => {
        if (figure.kind === 'prop' && (figure.refId === materialId || lookupValue(figure.name) === lookupValue(oldKey))) {
          figure.refId = materialId;
          figure.name = newKey;
        }
      });
      panel.assets?.forEach((key, index) => {
        if (panel.assetIds?.[index] === materialId || lookupValue(key) === lookupValue(oldKey)) {
          panel.assets![index] = newKey;
          (panel.assetIds ??= [])[index] = materialId;
        }
      });
    });
    page.page_overlay?.figures?.forEach((figure) => {
      if (figure.kind === 'prop' && (figure.refId === materialId || lookupValue(figure.name) === lookupValue(oldKey))) {
        figure.refId = materialId;
        figure.name = newKey;
      }
    });
  });
  if (material.type === 'background' && lookupValue(document.manga.setting.location) === lookupValue(oldKey)) {
    document.manga.setting.location = newKey;
  }
}

export function assignCharacterMaterial(document: MangaDocument, materialId: string, characterId: string): void {
  synchronizeCatalogReferences(document);
  const material = document.manga.materials.find((entry) => entry.localId === materialId && entry.type === 'character');
  const character = document.manga.characters.find((entry) => entry.localId === characterId);
  if (!material || !character) return;
  const previous = document.manga.characters.find((entry) => entry.localId === material.characterId);
  material.characterId = characterId;
  if (character.catalog_id) material.character_catalog_id = character.catalog_id;
  else delete material.character_catalog_id;
  if (previous && previous.localId !== characterId) {
    material.keywords = material.keywords.filter((keyword) => lookupValue(keyword) !== lookupValue(previous.name));
  }
  if (!material.keywords.some((keyword) => lookupValue(keyword) === lookupValue(character.name))) {
    material.keywords.push(character.name);
  }
}

export function newCatalogId(kind: CatalogIdKind): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${kind}-${uuid}` : `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function isPropPlacement(figure: Figure): boolean {
  return figure.kind === 'prop' || figure.object === true;
}

export function characterVisuals(document: MangaDocument, characterId: string): Material[] {
  return document.manga.materials.filter((material) => material.type === 'character' && material.characterId === characterId);
}

/** 公開OMNYへ出す直前に名称参照へ戻し、ローカル専用フィールドを除く。 */
export function toOmnyCatalogDocument(
  source: MangaDocument,
  options: { includeSeriesImages?: boolean } = {},
): MangaDocument {
  const next = structuredClone(source);
  delete next.manga.image_assets;
  if(!options.includeSeriesImages)delete next.manga.background_stages;
  next.manga.pages.forEach(page => { delete page.images;delete page.layer; });
  synchronizeCatalogReferences(next);
  const charactersById = new Map(next.manga.characters.map((character) => [character.localId, character]));
  next.manga.materials.forEach((material) => {
    if (material.type === 'character' && material.characterId) {
      const character = charactersById.get(material.characterId);
      if (character) {
        if (character.catalog_id) material.character_catalog_id = character.catalog_id;
        if (!material.keywords.some((keyword) => lookupValue(keyword) === lookupValue(character.name))) {
          material.keywords.push(character.name);
        }
      }
    }
  });
  next.manga.pages.forEach((page) => {
    const exportOwner = (owner: { figures?: Figure[]; bubbles?: Bubble[] }) => {
      owner.figures?.forEach((figure) => {
        if (figure.kind === 'prop') figure.object = true;
        else delete figure.object;
        delete figure.kind;
        delete figure.refId;
        // 素材を含まないOMNYへ、読み直せないローカル舞台参照を残さない。
        if (!options.includeSeriesImages && figure.human_pose?.scene) delete figure.human_pose.scene.background;
        if(figure.bbox&&figure.artwork?.paint)figure.bbox=paintReferenceBox(figure.artwork.paint,figure.bbox,figure.artwork.crop);
        delete figure.artwork;
        delete figure.locked;
      });
      owner.bubbles?.forEach((bubble) => {
        if(bubble.bbox&&bubble.paint_overlay?.paint)bubble.bbox=paintReferenceBox(bubble.paint_overlay.paint,bubble.bbox,bubble.paint_overlay.crop);
        delete bubble.speakerId; delete bubble.paint_overlay;delete bubble.locked;delete bubble.nativeLocked;
      });
    };
    page.panels.forEach((panel) => {
      exportOwner(panel);
      delete panel.assetIds;
      delete panel.images;
      delete panel.background_images;
      delete panel.layer;
    });
    if (page.page_overlay) exportOwner(page.page_overlay);
  });
  next.manga.characters.forEach((character) => { delete character.localId; });
  next.manga.materials.forEach((material) => {
    delete material.localId;
    delete material.characterId;
    if (!options.includeSeriesImages) { delete material.source_image; delete material.source_stage_id; }
  });
  return next;
}
