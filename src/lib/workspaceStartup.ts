import type { MangaDocument } from '../types.ts';
import { CURRENT_NDM_SCHEMA_VERSION, NDM_SCHEMA_NAME, normalizeDocument } from './manga.ts';
import { createSystemMobCharacter, isDetectedFigureCharacter, isSystemMobCharacter } from './systemCharacters.ts';

export interface WorkspaceStartupState {
  document: MangaDocument;
  hasDocument: boolean;
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

export function createInitialWorkspace(): WorkspaceStartupState {
  return { document: createEmptyWorkspaceDocument(), hasDocument: false };
}
