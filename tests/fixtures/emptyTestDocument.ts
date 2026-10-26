import type { MangaDocument, Panel } from '../../src/types.ts';
import { newPanel, normalizeDocument, parseOmayYaml } from '../../src/lib/manga.ts';
import { createEmptyWorkspaceDocument } from '../../src/lib/workspaceStartup.ts';

export const PERSON_A = 'PERSON_A';
export const PERSON_B = 'PERSON_B';
export const PERSON_A_MATERIAL = `${PERSON_A}の立ち絵`;
export const PROP_A = 'PROP_A';

/** A new document with no work, story, cast, setting, or artwork rules. */
export function emptyTestDocument(): MangaDocument {
  return createEmptyWorkspaceDocument();
}

function neutralPanel(id: number, offset: number): Panel {
  const panel = newPanel(id, offset);
  panel.bubbles = [{ text: `TEXT_${id}`, shape: 'normal' }];
  return panel;
}

/** Minimal geometry used by tests that need an addressable panel. */
export function panelTestDocument(): MangaDocument {
  const document = emptyTestDocument();
  document.manga.pages[0].panels = [neutralPanel(1, 0)];
  return normalizeDocument(document);
}

/**
 * Mechanical catalog and reference links, without a story or character design.
 * Four panels retain schema tests for panel renumbering without carrying demo content.
 */
export function linkedTestDocument(): MangaDocument {
  const document = emptyTestDocument();
  document.manga.characters.unshift(
    { localId: 'person-a', name: PERSON_A, role: '', scope: 'episode' },
    { localId: 'person-b', name: PERSON_B, role: '', scope: 'episode' },
  );
  document.manga.materials = [
    {
      localId: 'material-person-a', key: PERSON_A_MATERIAL, type: 'character', scope: 'episode',
      keywords: [PERSON_A], note: '', characterId: 'person-a',
    },
    {
      localId: 'material-person-b', key: `${PERSON_B}の立ち絵`, type: 'character', scope: 'episode',
      keywords: [PERSON_B], note: '', characterId: 'person-b',
    },
    {
      localId: 'material-prop-a', key: PROP_A, type: 'prop', scope: 'episode',
      keywords: [PROP_A], note: '',
    },
  ];
  const first = neutralPanel(1, 0);
  first.assets = [PERSON_A_MATERIAL, PROP_A];
  first.figures = [{
    name: PERSON_A, kind: 'person', refId: 'person-a',
    bbox: { x: 80, y: 20, w: 40, h: 40 }, size: 'bust-up', role: 'main',
  }];
  first.bubbles = [
    { text: 'TEXT_A', speaker: PERSON_A, speakerId: 'person-a', shape: 'normal', bbox: { x: 20, y: 15, w: 30, h: 30 } },
    { text: 'TEXT_B', speaker: PERSON_A, speakerId: 'person-a', shape: 'normal', bbox: { x: 140, y: 15, w: 30, h: 30 } },
  ];
  document.manga.pages[0].panels = [
    first,
    neutralPanel(2, 65),
    neutralPanel(3, 130),
    neutralPanel(4, 195),
  ];
  return normalizeDocument(document);
}

/** Add the canonical standard artwork rules only when a test exercises those rules. */
export function standardRulesTestDocument(standardSettingsYaml: string): MangaDocument {
  const document = linkedTestDocument();
  const standard = parseOmayYaml(standardSettingsYaml);
  document.manga.meta.style_notes = [...standard.style_notes];
  document.manga.layout_spec = standard.layout_spec;
  return normalizeDocument(document);
}
