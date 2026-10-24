import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import translations from '../src/content/artwork-translations.json' with { type: 'json' };
import { toEnglishArtworkText, toEditableArtworkText, toEnglishMangaFormat, toEditableMangaFormat } from '../src/lib/artworkEnglish.ts';
import { getArtworkSettings, setArtworkNumber, compileArtworkForMode, applyArtworkSettings, artworkNumberControls, artworkSettingsFromSource } from '../src/lib/artworkRules.ts';
import { parseMangaYaml, parseOmayYaml, toMangaYaml, toOmayYaml, toStoredMangaYaml, toSeparatedMangaYaml, toArtworkSettingsYaml } from '../src/lib/manga.ts';
import { finishLayoutInstruction } from '../src/lib/finishLayout.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sample = () => parseMangaYaml(read('src/content/sample.omny.yaml'));
const assertEnglish = text => assert.doesNotMatch(text.replaceAll('アンチック体', ''), /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
const tokens = text => [...text.matchAll(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g)].map(match => match[1]).sort();

test('標準テンプレートと両モードの生成用OMNY/OMAYは固定文・形式を英語で出す', () => {
  const standard = parse(read('src/content/standard.omay.yaml'));
  assertEnglish([...standard.style_notes, standard.layout_spec].join('\n'));
  for (const mode of ['integrated', 'draft']) {
    const doc = sample();
    doc.manga.finish_settings = { width_mm: 148, height_mm: 210, dpi: 600, bleed_mm: 3 };
    applyArtworkSettings(doc.manga, { ...getArtworkSettings(doc.manga), mode });
    const before = structuredClone(doc);
    const full = parse(toMangaYaml(doc)).manga;
    const separated = parse(toSeparatedMangaYaml(doc)).manga;
    for (const output of [{ style_notes: full.meta.style_notes, layout_spec: full.layout_spec }, parse(toOmayYaml(doc)), parse(toOmayYaml(doc, 'character'))]) {
      assertEnglish([...output.style_notes, output.layout_spec].join('\n'));
    }
    assert.equal(full.meta.format, 'color manga');
    assert.equal(full.finish_layout.format, full.meta.format);
    assert.equal(separated.meta.format, full.meta.format);
    assert.equal(separated.layout_spec, undefined);
    assert.equal(separated.meta.style_notes, undefined);
    assert.equal(full.meta.title, doc.manga.meta.title);
    assert.equal(full.meta.author, doc.manga.meta.author);
    assert.equal(full.meta.font, doc.manga.meta.font);
    assert.equal(full.pages[0].panels[0].bubbles[0].text, doc.manga.pages[0].panels[0].bubbles[0].text);
    assert.deepEqual(full.characters.map(c => c.name), doc.manga.characters.map(c => c.name));
    assert.deepEqual(full.materials.map(m => m.name), doc.manga.materials.map(m => m.name));
    assert.deepEqual(doc, before);
    assert.deepEqual(parse(toStoredMangaYaml(doc)).manga.meta.style_notes, doc.manga.meta.style_notes);
    assert.equal(parse(toStoredMangaYaml(doc)).manga.layout_spec, doc.manga.layout_spec);
    assert.deepEqual(parseOmayYaml(toArtworkSettingsYaml(doc)).artwork_settings, doc.manga.artwork_settings);
  }
});

test('英語の生成データを読み戻しても日本語の編集原本・分類・6数値を復元する', () => {
  const doc = sample();
  let settings = getArtworkSettings(doc.manga);
  const values = { header: 6.2, footer: 4.7, footerOffset: 2.8, emphasisMax: 1.9, emphasisMin: 1.6, backgrounds: 3 };
  for (const [id, value] of Object.entries(values)) settings = setArtworkNumber(settings, 'page', id, value);
  applyArtworkSettings(doc.manga, settings);
  const omay = parseOmayYaml(toOmayYaml(doc));
  assert.deepEqual(omay.style_notes, doc.manga.meta.style_notes);
  assert.equal(omay.layout_spec, doc.manga.layout_spec);
  const loaded = parseMangaYaml(toMangaYaml(doc));
  assert.equal(loaded.manga.meta.format, doc.manga.meta.format);
  assert.deepEqual(loaded.manga.meta.style_notes, doc.manga.meta.style_notes);
  assert.equal(loaded.manga.layout_spec, doc.manga.layout_spec);
  for (const restored of [getArtworkSettings(loaded.manga), artworkSettingsFromSource(omay)]) {
    assert.deepEqual(restored.groups.map(g => [g.id, g.scope]), settings.groups.map(g => [g.id, g.scope]));
    assert.deepEqual(Object.fromEntries(artworkNumberControls(restored, 'page').map(c => [c.id, c.value])), values);
    const updated = setArtworkNumber(restored, 'page', 'header', 7.1);
    applyArtworkSettings(loaded.manga, updated);
    assert.match(parse(toOmayYaml(loaded)).style_notes.join('\n'), /7\.1mm/);
  }
});

test('持ち込みの自由文は固定文と並んでも変更せず、作品固有情報を自動翻訳しない', () => {
  const doc = sample();
  const custom = '[style] 雨粒を月明かりで銀色に描いてください。';
  doc.manga.meta.style_notes.push(custom);
  doc.manga.setting.location = '京都の古書店';
  doc.manga.characters[0].name = '小雪';
  const full = parse(toMangaYaml(doc)).manga;
  assert.ok(full.meta.style_notes.includes(custom));
  assert.equal(full.setting.location, '京都の古書店');
  assert.equal(full.characters[0].name, '小雪');
  assert.ok(parse(toOmayYaml(doc)).style_notes.includes(custom));
});

test('翻訳表は重複・欠落のない双方向対応で、タグ・数値パラメータを保持する', () => {
  const japanese = new Set(), english = new Set();
  for (const entry of translations) {
    assert.ok(entry.ja && entry.en);
    assert.ok(!japanese.has(entry.ja), entry.ja);
    assert.ok(!english.has(entry.en), entry.en);
    japanese.add(entry.ja); english.add(entry.en);
    assert.deepEqual(tokens(entry.ja), tokens(entry.en));
    assert.deepEqual([...entry.ja.matchAll(/\[(const|must|panel|style|default)\]/g)].map(x => x[0]), [...entry.en.matchAll(/\[(const|must|panel|style|default)\]/g)].map(x => x[0]));
    assertEnglish(entry.en);
    const ja = entry.ja.replace(/\{\{[A-Za-z][A-Za-z0-9]*\}\}/g, '6.2');
    const en = entry.en.replace(/\{\{[A-Za-z][A-Za-z0-9]*\}\}/g, '6.2');
    assert.equal(toEnglishArtworkText(ja), en);
    assert.equal(toEditableArtworkText(en), ja);
    assert.equal(toEnglishArtworkText(en), en);
    assert.equal(toEditableArtworkText(ja), ja);
  }
});

test('標準・サンプル・下書き・仕上がりの固定文を英語にし、原本へ正確に戻せる', () => {
  const standard = parse(read('src/content/standard.omay.yaml'));
  const doc = sample();
  for (const source of [standard, { style_notes: doc.manga.meta.style_notes, layout_spec: doc.manga.layout_spec }, compileArtworkForMode(getArtworkSettings(doc.manga), 'draft')]) {
    for (const text of [...source.style_notes, source.layout_spec]) {
      const editable = toEditableArtworkText(text);
      assertEnglish(toEnglishArtworkText(editable));
      assert.equal(toEditableArtworkText(toEnglishArtworkText(editable)), editable);
    }
  }
  assertEnglish(toEnglishArtworkText(finishLayoutInstruction()));
});

test('6つの数値設定は英語出力と再読込で値と反復指定を失わない', () => {
  let settings = getArtworkSettings(sample().manga);
  for (const [id, value] of [['header', 6.2], ['footer', 4.7], ['footerOffset', 2.8], ['emphasisMax', 1.9], ['emphasisMin', 1.6], ['backgrounds', 3]]) settings = setArtworkNumber(settings, 'page', id, value);
  const rules = compileArtworkForMode(settings, 'integrated');
  for (const text of [...rules.style_notes, rules.layout_spec]) {
    const en = toEnglishArtworkText(text);
    assertEnglish(en);
    assert.equal(toEditableArtworkText(en), text);
  }
  const english = rules.style_notes.map(toEnglishArtworkText).join('\n');
  assert.equal([...english.matchAll(/6\.2mm/g)].length, 2);
  for (const number of ['4.7', '2.8', '1.6', '1.9']) assert.ok(english.includes(number));
});

test('未知の追記を推測・削除せず、インデント・空行・数値の表記を保持する', () => {
  const entry = translations.find(entry => entry.ja.includes('{{headerTitle}}'));
  assert.ok(entry);
  const original = '\n  ' + entry.ja.replaceAll('{{headerTitle}}', '06.20').replaceAll('{{headerPage}}', '7.1') + '  \n\n';
  assert.equal(toEditableArtworkText(toEnglishArtworkText(original)), original);
  for (const text of ['作者独自の指示を保持', '## 独自の見出し\nユキは画面右を向く。', entry.ja + ' 追加の指示']) assert.equal(toEnglishArtworkText(text), text);
  for (const [ja, en] of [['カラー漫画', 'color manga'], ['モノクロ漫画', 'black-and-white manga'], ['グレースケール漫画', 'grayscale manga']]) {
    assert.equal(toEnglishMangaFormat(ja), en);
    assert.equal(toEditableMangaFormat(en), ja);
  }
  assert.equal(toEnglishMangaFormat('作者の独自形式'), '作者の独自形式');
});
