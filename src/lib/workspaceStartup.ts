import type { MangaDocument } from '../types.ts';
import { CURRENT_NDM_SCHEMA_VERSION, NDM_SCHEMA_NAME, STORAGE_KEY, normalizeDocument, parseMangaYaml, toStoredMangaYaml } from './manga.ts';
import { createSystemMobCharacter, isDetectedFigureCharacter, isSystemMobCharacter } from './systemCharacters.ts';

export interface WorkspaceStartupState {
  document: MangaDocument;
  hasDocument: boolean;
}

type WorkspaceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Names alone are not enough: require the bundled story title and its cast. */
function isRemovedBundledStory(document: MangaDocument): boolean {
  const { meta, characters } = document.manga;
  return (meta.title === '押しかけ妖精にゃむるたん'
    || (meta.title === '画像配置の動作確認' && meta.episode_id === 'placement-qa-20260926'))
    && characters.some((character) => character.name === 'にゃむるたん')
    && characters.some((character) => character.name === 'ツクル');
}

/** Remove only the retired bundled story and its dedicated recovery archive.
 * The identifiers above are migration markers, not story content. Other works,
 * preferences and source files are never cleared by this migration. */
export function removeBundledStoryStorage(storage: Pick<Storage, 'getItem' | 'removeItem'>): void {
  storage.removeItem(`${STORAGE_KEY}.legacy-sample-archive`);
  const saved = storage.getItem(STORAGE_KEY);
  if (!saved) return;
  let document: MangaDocument;
  try { document = parseMangaYaml(saved); } catch { return; }
  if (isRemovedBundledStory(document)) storage.removeItem(STORAGE_KEY);
}

export interface StoredWorkspaceDocument { document: MangaDocument; serialized: string }

export function storeWorkspaceDocument(storage: WorkspaceStorage, document: MangaDocument, previous?: StoredWorkspaceDocument): StoredWorkspaceDocument {
  const knownSave = previous && storage.getItem(STORAGE_KEY) === previous.serialized;
  if (knownSave && previous.document === document) return previous;
  const serialized = toStoredMangaYaml(document);
  storage.setItem(STORAGE_KEY, serialized);
  return { document, serialized };
}

export function createEmptyWorkspaceDocument(): MangaDocument {
  return normalizeDocument({
    manga: {
      schema_name: NDM_SCHEMA_NAME,
      schema_version: CURRENT_NDM_SCHEMA_VERSION,
      meta: {
        document_type: 'story',
        title: '',
        series: '',
        series_id: '',
        episode_number: '',
        episode_id: '',
        author: '',
        format: 'カラー漫画',
        page_count: 1,
        reading_direction: 'right-to-left',
        text_orientation: 'vertical',
        font: 'アンチック体',
        bubble_line_width_mm: 0.5,
        panel_frame_width_mm: 1,
        panel_gutter_row_mm: 5,
        panel_gutter_column_mm: 3,
        style_notes: [],
      },
      layout_spec: '',
      series_setting: {
        genre: '', target_audience: '', adult_content: false, situation: '', location: '', time: '', weather: '',
      },
      setting: { location: '', time: '', weather: '', situation: '' },
      characters: [createSystemMobCharacter()],
      materials: [],
      pages: [{ page: 1, canvas: { w: 210, h: 297, unit: 'mm' }, panels: [] }],
    },
  });
}

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function isUnstartedDocument(document: MangaDocument): boolean {
  const { manga } = document;
  const hasWorkMeta = [
    manga.meta.title,
    manga.meta.series,
    manga.meta.episode_number,
    manga.meta.author,
    manga.setting?.location,
    manga.setting?.time,
    manga.setting?.weather,
    manga.setting?.situation,
  ].some(hasText);
  if (hasWorkMeta || manga.materials.length > 0) return false;

  const userCharacters = manga.characters.filter((character) => (
    !isSystemMobCharacter(character) && !isDetectedFigureCharacter(character)
  ));
  if (userCharacters.length > 0) return false;

  if (manga.pages.length > 1) return false;
  const page = manga.pages[0];
  if (!page) return true;
  if (page.panels.length > 0 || page.images?.length) return false;
  return !(page.page_overlay?.figures?.length || page.page_overlay?.bubbles?.length);
}

export function workspaceFromStored(stored: string | null | undefined): WorkspaceStartupState {
  if (stored) {
    try {
      const document = parseMangaYaml(stored);
      if (isRemovedBundledStory(document)) {
        return { document: createEmptyWorkspaceDocument(), hasDocument: false };
      }
      if (!isUnstartedDocument(document)) return { document, hasDocument: true };
    } catch { /* 壊れた自動保存は起動画面で安全に止める */ }
  }
  return { document: createEmptyWorkspaceDocument(), hasDocument: false };
}
