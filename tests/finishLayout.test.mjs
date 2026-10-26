import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { toEditableArtworkText } from '../src/lib/artworkEnglish.ts';
import { applyArtworkSettings, compileArtworkForMode, getArtworkSettings, getArtworkMode, parseArtworkSettings, setArtworkNumber } from '../src/lib/artworkRules.ts';
import { finishLayoutInstruction, getFinishLayout, getFinishSettings, getOutputSettings, validateFinishSettings, OUTPUT_FORMAT_OPTIONS } from '../src/lib/finishLayout.ts';
import { getPrintSetup, withPrintSetup } from '../src/lib/printSettings.ts';
import { parseMangaYaml, toMangaYaml, toSeparatedMangaYaml, toSeriesCatalogMangaYaml, toOmayYaml, toStoredMangaYaml } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';

const sample = () => parseMangaYaml(readFileSync(new URL('../src/content/sample.yaml', import.meta.url), 'utf8'));
const finish = { width_mm: 148, height_mm: 210, dpi: 600, bleed_mm: 3 };

test('仕上がり仕様は編集座標を変えず、裁ち落とし前後のpxと配置時の換算を共有する', () => {
  const doc = sample();
  const before = structuredClone(doc);
  const fallback = getFinishSettings(doc.manga);
  assert.equal(fallback.width_mm, doc.manga.pages[0].canvas.w);
  assert.equal(fallback.height_mm, doc.manga.pages[0].canvas.h);
  assert.equal(fallback.dpi, 350);
  assert.equal(fallback.bleed_mm, 0);
  assert.deepEqual(doc, before);
  doc.manga.finish_settings = finish;
  const layout = getFinishLayout(doc.manga);
  assert.deepEqual(layout.trim_pixels, { width: 3496, height: 4961 });
  assert.deepEqual(layout.bleed_pixels, { width: 3638, height: 5102 });
  assert.equal(layout.text.font, doc.manga.meta.font);
  assert.equal(layout.panels.frame_width_mm, doc.manga.meta.panel_frame_width_mm);
  assert.equal(layout.panels.row_gap_mm, doc.manga.meta.panel_gutter_row_mm);
  assert.deepEqual(layout.page_transforms, doc.manga.pages.map(page => ({
    page: page.page, source_width_mm: page.canvas.w, source_height_mm: page.canvas.h,
    scale_x: 148 / page.canvas.w, scale_y: 210 / page.canvas.h, bleed_offset_mm: 3,
  })));
  assert.deepEqual(doc.manga.pages, before.manga.pages);
});

test('下書き用指示は後加工禁止・一発生成を外し、文字原文と隠した演技ルールを保つ', () => {
  const doc = sample();
  const settings = getArtworkSettings(doc.manga);
  settings.groups.find(group => group.id === 'acting').enabled = false;
  const before = structuredClone(settings);
  const result = compileArtworkForMode(settings, 'draft');
  assert.match(result.layout_spec, /コマごとに独立した下書き/);
  assert.match(result.layout_spec, /画像に焼き込まず/);
  assert.match(result.layout_spec, /元の文字データは省略・変更せず保持/);
  assert.match(result.layout_spec, /figures\[\]\.action/);
  assert.doesNotMatch(JSON.stringify(result), /後加工禁止|一発生成|自己検品|ヘッダーの文字:|ベタ塗り/);
  assert.deepEqual(settings, before);
});

test('作画方法切替とフォルダ保存・再読込で、仕上がり仕様と数値原本を保持する', async () => {
  const doc = sample();
  doc.manga.finish_settings = finish;
  const settings = setArtworkNumber(getArtworkSettings(doc.manga), 'page', 'header', 6.2);
  settings.mode = 'integrated';
  applyArtworkSettings(doc.manga, settings);
  const integrated = structuredClone(doc);
  const finishedOutput = parse(toOmayYaml(doc));
  applyArtworkSettings(doc.manga, { ...settings, mode: 'draft' });
  const draftOutput = parse(toOmayYaml(doc));
  assert.equal(finishedOutput.generation_mode, 'integrated');
  assert.equal(draftOutput.generation_mode, 'draft');
  assert.deepEqual(draftOutput.finish_layout, finishedOutput.finish_layout);
  assert.equal(draftOutput.finish_layout.text.typography_groups[0].values.header, 6.2);
  const character = parse(toOmayYaml(doc, 'character'));
  assert.deepEqual(character.finish_layout, getOutputSettings(doc.manga));
  assert.equal(character.finish_layout.panels, undefined);
  assert.equal(character.finish_layout.text, undefined);
  assert.match(character.style_notes.join('\n'), /Generate only the requested character/);
  const snapshot = await createProjectSnapshot(doc);
  const restored = await restoreProjectSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(restored, doc);
  applyArtworkSettings(restored.manga, { ...getArtworkSettings(restored.manga), mode: 'integrated' });
  assert.deepEqual(restored, integrated);
});

test('OMNYとOMAYは同じ仕上がり仕様を出し、ストーリー側に原本や指示を混ぜない', () => {
  const doc = sample();
  doc.manga.finish_settings = finish;
  applyArtworkSettings(doc.manga, { ...getArtworkSettings(doc.manga), mode: 'draft' });
  const before = structuredClone(doc);
  const full = parse(toMangaYaml(doc)).manga;
  const separated = parse(toSeparatedMangaYaml(doc)).manga;
  const omay = parse(toOmayYaml(doc));
  assert.deepEqual(full.finish_layout, omay.finish_layout);
  assert.deepEqual(separated.finish_layout, omay.finish_layout);
  assert.equal(separated.artwork_settings, undefined);
  assert.equal(separated.meta.style_notes, undefined);
  assert.equal(separated.layout_spec, undefined);
  assert.equal(full.artwork_settings, undefined);
  const catalog = parse(toSeriesCatalogMangaYaml(doc)).manga;
  assert.equal(catalog.finish_settings, undefined);
  assert.equal(catalog.finish_layout, undefined);
  assert.deepEqual(doc, before);
});

test('書き出したOMNYを再読込しても派生仕様・補助文を蓄積せず、変更後の正本から再計算する', () => {
  const doc = sample();
  doc.manga.finish_settings = finish;
  const loaded = parseMangaYaml(toMangaYaml(doc));
  assert.equal(loaded.manga.finish_layout, undefined);
  assert.equal(loaded.manga.meta.style_notes.includes(finishLayoutInstruction()), false);
  loaded.manga.finish_settings.dpi = 300;
  const exported = parse(toMangaYaml(loaded)).manga;
  assert.equal(exported.finish_layout.trim_pixels.width, 1748);
  assert.equal(exported.meta.style_notes.filter(note => toEditableArtworkText(note) === finishLayoutInstruction()).length, 1);
  assert.equal(parseMangaYaml(toStoredMangaYaml(loaded)).manga.finish_settings.dpi, 300);
});

test('不正な寸法・解像度・モードは黙って初期化せず拒否する', () => {
  for (const invalid of [
    { width_mm: 0 }, { height_mm: -1 }, { width_mm: Infinity }, { width_mm: Number.MIN_VALUE },
    { dpi: 0 }, { dpi: 300.5 }, { dpi: Number.MAX_VALUE }, { bleed_mm: -1 }, { bleed_mm: NaN },
  ]) assert.throws(() => validateFinishSettings({ ...finish, ...invalid }));
  const settings = getArtworkSettings(sample().manga);
  assert.throws(() => parseArtworkSettings({ ...settings, mode: 'unknown' }));
  settings.groups.find(group => group.id === 'page').enabled = false;
  assert.equal(getArtworkMode(settings), 'draft');
  assert.equal(getArtworkMode({ ...settings, mode: 'integrated' }), 'integrated');
});

test('カラー3択と全解像度は保存・再読込・全生成指示で同一の正本を参照する', () => {
  const original = sample();
  const before = structuredClone(original);
  for (const { value: format } of OUTPUT_FORMAT_OPTIONS) {
    for (const dpi of [150, 300, 350, 600, 1200]) {
      const doc = withPrintSetup(original, { ...getPrintSetup(original.manga), format, dpi });
      const reopened = parseMangaYaml(toStoredMangaYaml(doc));
      assert.equal(reopened.manga.meta.format, format);
      assert.equal(reopened.manga.finish_settings.dpi, dpi);
      assert.deepEqual(doc.manga.pages, original.manga.pages);
      const expected = getOutputSettings(doc.manga);
      for (const mode of ['integrated', 'draft']) {
        applyArtworkSettings(reopened.manga, { ...getArtworkSettings(reopened.manga), mode });
        for (const output of [
          parse(toMangaYaml(reopened)).manga,
          parse(toSeparatedMangaYaml(reopened)).manga,
          parse(toOmayYaml(reopened)),
          parse(toOmayYaml(reopened, 'character')),
        ]) {
          for (const [key, value] of Object.entries(expected)) assert.deepEqual(output.finish_layout[key], value);
        }
      }
    }
  }
  assert.deepEqual(original, before);
});

test('既存の独自カラー・解像度や未設定原稿を表示しても変更しない', () => {
  const doc = sample();
  doc.manga.meta.format = '特色2色';
  doc.manga.finish_settings = { ...finish, dpi: 450 };
  const before = structuredClone(doc);
  assert.equal(getOutputSettings(doc.manga).dpi, 450);
  assert.equal(getOutputSettings(doc.manga).format, '特色2色');
  assert.deepEqual(doc, before);
  assert.equal(withPrintSetup(doc, { ...getPrintSetup(doc.manga), format: 'カラー漫画' }).manga.finish_settings.dpi, 450);
  assert.equal(withPrintSetup(doc, { ...getPrintSetup(doc.manga), dpi: 600 }).manga.meta.format, '特色2色');
  assert.throws(() => withPrintSetup(doc, { ...getPrintSetup(doc.manga), format: '' }));
  assert.throws(() => withPrintSetup(doc, { ...getPrintSetup(doc.manga), dpi: 0 }));
  const unset = sample();
  delete unset.manga.finish_settings;
  delete unset.manga.artwork_settings;
  const unsetBefore = structuredClone(unset);
  assert.equal(parse(toMangaYaml(unset)).manga.finish_layout.dpi, 350);
  assert.deepEqual(unset, unsetBefore);
});
