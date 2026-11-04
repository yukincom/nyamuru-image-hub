import type { MangaDocument, MangaSeriesSetting } from '../types';
import { cloneDocument } from './manga.ts';
import { synchronizeCatalogReferences } from './catalogModel.ts';
import { parseCharacterText } from './characterTextCatalog.ts';
import { parseSeriesSettingText, parseSeriesTitleText, type ImportedSeriesSetting, type ImportedStorySetting } from './settingTextImport.ts';
import type { SeriesReferenceTextCandidate, SeriesReferenceTextSelection } from './localBridge.ts';
import type { SourceCoverageSource } from './sourceCoverage.ts';

export type NewCreationStep = 'series' | 'characters' | 'setting' | 'layout';
export type NewSeriesMode = '' | 'new' | 'existing' | 'none';

export interface SeriesCatalogPersistOptions {
  deleteMaterialCatalogIds?: readonly string[];
  deleteCharacterCatalogIds?: readonly string[];
  seriesSetting?: MangaSeriesSetting;
  seriesDirectory?: string;
  seriesReference?: SeriesReferenceTextSelection | null;
}

export interface NewSourceSnapshot {
  source: SourceCoverageSource;
  seriesMode: NewSeriesMode;
  workspaceDirectory: string;
  selectedByteSize: number;
  selectedSha256: string | null;
}

export interface BoundSourceSnapshot extends NewSourceSnapshot {
  episodeId: string;
}

export function emptyNewWorkSetting(): ImportedStorySetting {
  return { location: '', time: '', weather: '', situation: '' };
}

export function emptyNewSeriesSetting(): MangaSeriesSetting {
  return {
    genre: '',
    target_audience: '',
    adult_content: false,
    location: '',
    time: '',
    weather: '',
    situation: '',
  };
}

export function seriesSettingFromImported(imported: ImportedSeriesSetting): MangaSeriesSetting {
  return {
    genre: imported.genre,
    target_audience: imported.targetAudience,
    adult_content: imported.adultContent,
    location: imported.location,
    time: imported.time,
    weather: imported.weather,
    situation: imported.situation,
  };
}

export function fillEmptySeriesSetting(
  current: MangaSeriesSetting,
  incoming: MangaSeriesSetting,
): MangaSeriesSetting {
  return {
    genre: current.genre?.trim() ? current.genre : incoming.genre,
    target_audience: current.target_audience?.trim() ? current.target_audience : incoming.target_audience,
    adult_content: current.adult_content === true || incoming.adult_content === true,
    location: current.location.trim() ? current.location : incoming.location,
    time: current.time.trim() ? current.time : incoming.time,
    weather: current.weather.trim() ? current.weather : incoming.weather,
    situation: current.situation.trim() ? current.situation : incoming.situation,
  };
}

export function seriesSettingSummary(setting: MangaSeriesSetting): string {
  return [setting.genre, setting.target_audience, setting.adult_content ? '成人指定' : '', setting.situation]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join('・');
}

export function detectedSeriesReferenceKind(selection: SeriesReferenceTextSelection): SeriesReferenceTextCandidate['kind'] {
  if (selection.kind) return selection.kind;
  // 人物の入力エラーは反映時に示し、候補の分類では画面を止めない。
  try {
    if (parseCharacterText(selection.text).length) return 'characters';
  } catch {
    return 'characters';
  }
  const setting = parseSeriesSettingText(selection.text);
  if (setting.genre || setting.targetAudience || setting.adultContent || setting.location
    || setting.time || setting.weather || setting.situation) return 'series-setting';
  return 'series-reference';
}

export const seriesTitleFromReferences = (selections: readonly SeriesReferenceTextSelection[]): string => selections
  .map((selection) => parseSeriesTitleText(selection.text, detectedSeriesReferenceKind(selection) !== 'characters'))
  .find((title) => title.trim()) ?? '';

export function withoutSeriesCharacter(source: MangaDocument, characterLocalId: string): MangaDocument {
  const next = cloneDocument(source);
  const character = next.manga.characters.find((entry) => entry.localId === characterLocalId);
  if (!character) return next;
  const catalogId = character.catalog_id;
  next.manga.characters = next.manga.characters.filter((entry) => entry.localId !== characterLocalId);
  next.manga.materials = next.manga.materials.filter((material) => (
    material.characterId !== characterLocalId
    && (!catalogId || material.character_catalog_id !== catalogId)
  ));
  synchronizeCatalogReferences(next);
  return next;
}
