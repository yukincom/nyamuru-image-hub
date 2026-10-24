import type { Manga, MangaDocument, Panel } from '../types.ts';

/** Empty string is an explicit edit; only an absent value inherits the episode location. */
export function panelBackgroundDescription(panel: Panel, setting: Manga['setting']): string {
  if (panel.bg === -1) return '';
  return panel.background_description ?? (panel.bg > 0 ? setting.location.trim() : '');
}

export function initializePanelBackgrounds(document: MangaDocument): void {
  for (const page of document.manga.pages) for (const panel of page.panels) {
    if (panel.background_description === undefined) {
      const description = panelBackgroundDescription(panel, document.manga.setting);
      if (description) panel.background_description = description;
    }
  }
}
