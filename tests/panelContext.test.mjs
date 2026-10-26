import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { initializePanelBackgrounds, panelBackgroundDescription } from '../src/lib/panelContext.ts';
import { newPage, parseMangaYaml, toStoredMangaYaml, toSeparatedMangaYaml } from '../src/lib/manga.ts';
import { buildPanelDraftPlan } from '../src/lib/panelDraft.ts';

test('背景未指定だけが場所を継承し、明示空欄・独自背景・効果・描写なしを上書きしない', () => {
  const document = parseMangaYaml(readFileSync(new URL('../src/content/sample.yaml', import.meta.url), 'utf8'));
  document.manga.pages = [newPage(1)];
  document.manga.setting.location = '図書室';
  const panel = document.manga.pages[0].panels[0];
  panel.bg = 1;
  delete panel.background_description;
  assert.equal(panelBackgroundDescription(panel, document.manga.setting), '図書室');
  initializePanelBackgrounds(document);
  assert.equal(panel.background_description, '図書室');
  for (const value of ['', '駅のホーム']) {
    panel.background_description = value;
    initializePanelBackgrounds(document);
    assert.equal(panel.background_description, value);
    for (const yaml of [toStoredMangaYaml(document), toSeparatedMangaYaml(document)]) {
      assert.equal(parseMangaYaml(yaml).manga.pages[0].panels[0].background_description, value);
    }
  }
  panel.background_description = '';
  assert.doesNotMatch(buildPanelDraftPlan(document.manga, 0, 0).positivePrompt, /図書室/);
  for (const bg of [-1, 0]) {
    panel.bg = bg;
    delete panel.background_description;
    initializePanelBackgrounds(document);
    assert.equal(panel.background_description, undefined);
    assert.equal(panelBackgroundDescription(panel, document.manga.setting), '');
  }
});
