import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { artworkSettingsFromSource, compileArtworkRules, compileArtworkForMode, getArtworkSettings, applyArtworkSettings, appendArtworkSettings, artworkNumberControls, setArtworkNumber, parseArtworkSettings, getWorkStylePrompt, setWorkStylePrompt } from '../src/lib/artworkRules.ts';
import { parseMangaYaml, parseOmayYaml, toStoredMangaYaml, toMangaYaml, toSeparatedMangaYaml, toSeriesCatalogMangaYaml, toOmayYaml, toArtworkSettingsYaml } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sample = () => parseMangaYaml(read('src/content/sample.omny.yaml'));
const standard = () => parseOmayYaml(read('src/content/standard.omay.yaml'));

test('作品の画風は既存ルールを保って全生成対象へ届き、作品保存から原文を復元できる', async () => {
  const document = sample();
  const prior = getArtworkSettings(document.manga);
  prior.groups.find(group => group.id === 'page').enabled = false;
  applyArtworkSettings(document.manga, prior);
  const prompt = '輪郭は太い黒線。\n内側は細く、かすれを残す。';
  setWorkStylePrompt(document.manga, prompt);
  const settings = getArtworkSettings(document.manga);
  assert.deepEqual(settings.groups.filter(group => group.id !== 'work-style'), prior.groups);
  assert.deepEqual(settings.fragments.filter(part => part.groupId !== 'work-style'), prior.fragments);
  for (const target of ['character', 'integrated']) assert.ok(compileArtworkRules(settings, target).style_notes.includes(prompt));
  const restored = await restoreProjectSnapshot(JSON.parse(JSON.stringify(await createProjectSnapshot(document))));
  assert.equal(getWorkStylePrompt(restored.manga), prompt);
  assert.equal(getWorkStylePrompt(parseMangaYaml(toStoredMangaYaml(document)).manga), prompt);
  setWorkStylePrompt(document.manga, '変更した画風');
  assert.equal(getArtworkSettings(document.manga).groups.filter(group => group.id === 'work-style').length, 1);
  assert.ok(!compileArtworkRules(getArtworkSettings(document.manga), 'character').style_notes.includes(prompt));
  setWorkStylePrompt(document.manga, '');
  assert.equal(getWorkStylePrompt(document.manga), '');
  assert.deepEqual(compileArtworkRules(getArtworkSettings(document.manga), 'character'), compileArtworkRules(prior, 'character'));
});

test('既存資料と独自ルールは順序・本文を維持し、表示だけでは初期化しない', () => {
  for (const source of [standard(), { style_notes: sample().manga.meta.style_notes, layout_spec: sample().manga.layout_spec }, { style_notes: ['独自ルール', '', '同じ', '同じ'], layout_spec: '独自のレイアウト\n### 独自の見出し\n本文' }]) {
    const before = structuredClone(source);
    assert.deepEqual(compileArtworkRules(artworkSettingsFromSource(source), 'integrated'), { style_notes: source.style_notes, layout_spec: source.layout_spec });
    assert.deepEqual(source, before);
  }
  const doc = sample();
  getArtworkSettings(doc.manga);
  assert.equal(doc.manga.artwork_settings, undefined);
});

test('共通だけの生成にページ・文字・背景・検品の一体型ルールを混ぜない', () => {
  const settings = artworkSettingsFromSource(standard());
  assert.deepEqual(settings.groups.map(group => [group.id, group.scope]), [['tone', 'common'], ['identity', 'common'], ['acting', 'common'], ['page', 'integrated']]);
  const result = compileArtworkRules(settings, 'character');
  assert.match(result.layout_spec, /キャラクターの識別記号/);
  assert.match(result.layout_spec, /figures\[\]\.action/);
  assert.doesNotMatch(JSON.stringify(result), /ヘッダー|フッター|Nページ|一発生成|フキダシ|自己検品|2コマ制限/);
  // 見出しが同じでも追記された本文は共通へ勝手に移さない。
  const source = standard();
  source.layout_spec = source.layout_spec.replace('### 画風を変えてもキャラを保つ', '### 画風を変えてもキャラを保つ\n追加: 必ずページ番号を描く');
  assert.doesNotMatch(compileArtworkRules(artworkSettingsFromSource(source), 'character').layout_spec, /追加:|キャラクターの識別記号/);
});

test('背景の追加ルールは全体生成だけへ届き、下書きや人物生成へ漏れない', () => {
  const settings = artworkSettingsFromSource(standard());
  const before = structuredClone(settings);
  const backgroundRule = /背後の要素を少なくとも1点|bg:-1=背景無描画（プレースホルダー）/;
  assert.match(JSON.stringify(compileArtworkForMode(settings, 'integrated')), backgroundRule);
  for (const rules of [compileArtworkForMode(settings, 'draft'), compileArtworkRules(settings, 'character')]) {
    assert.doesNotMatch(JSON.stringify(rules), backgroundRule);
  }
  assert.deepEqual(settings, before);
});

test('標準候補の追加で既存作品の背景ルールを自動更新せず、保存後も元の指定を保つ', () => {
  const document = sample();
  document.manga.meta.style_notes = [...document.manga.meta.style_notes.filter(note => note.startsWith('[style] 作品の出力形式')), '作者独自の背景色'];
  document.manga.layout_spec = document.manga.layout_spec.replace(/### 背景詳細度\(bg\)\n[\s\S]*?(?=\n### ト書き)/,
    '### 背景詳細度(bg)\n- [const] bg:-1=背景無描画。1色のベタ塗りのみを敷く。キャラクター・フキダシ・コマ枠・キャラに付随する漫符(頭上の汗・怒りマーク等)は通常どおり描く\n');
  delete document.manga.artwork_settings;
  const original = structuredClone(document);
  const current = getArtworkSettings(document.manga);
  const added = appendArtworkSettings(current, artworkSettingsFromSource(standard()), '標準');
  assert.deepEqual(document, original);
  assert.ok(added.groups.length > current.groups.length);
  assert.ok(added.groups.slice(current.groups.length).every(group => !group.enabled));
  assert.deepEqual(compileArtworkRules(added, 'integrated'), compileArtworkRules(current, 'integrated'));
  applyArtworkSettings(document.manga, added);
  const restored = parseMangaYaml(toStoredMangaYaml(document));
  assert.deepEqual(restored.manga.meta.style_notes, original.manga.meta.style_notes);
  assert.equal(restored.manga.layout_spec, original.manga.layout_spec);
  assert.deepEqual(restored.manga.pages, original.manga.pages);
  assert.deepEqual(getArtworkSettings(restored.manga), added);
});

test('OFFは非反映だけ。保存・再読込・再ONでルールも数値も戻る', () => {
  const doc = sample();
  let settings = setArtworkNumber(getArtworkSettings(doc.manga), 'page', 'header', 6.2);
  const enabled = compileArtworkRules(settings, 'integrated');
  const originalFragments = structuredClone(settings.fragments);
  settings.groups.find(group => group.id === 'page').enabled = false;
  applyArtworkSettings(doc.manga, settings);
  assert.doesNotMatch(toOmayYaml(doc), /ヘッダー|Header text|6\.2mm/);
  const loaded = parseMangaYaml(toStoredMangaYaml(doc));
  assert.deepEqual(loaded.manga.artwork_settings.fragments, originalFragments);
  assert.equal(artworkNumberControls(getArtworkSettings(loaded.manga), 'page').find(control => control.id === 'header').value, 6.2);
  const restored = getArtworkSettings(loaded.manga);
  restored.groups.find(group => group.id === 'page').enabled = true;
  applyArtworkSettings(loaded.manga, restored);
  assert.deepEqual({ style_notes: loaded.manga.meta.style_notes, layout_spec: loaded.manga.layout_spec }, enabled);
});

test('内部保存と設定控えのみOFFの原本を保持し、生成・ストーリー・カタログへ漏らさない', () => {
  const doc = sample();
  const settings = getArtworkSettings(doc.manga);
  settings.groups.find(group => group.id === 'page').enabled = false;
  applyArtworkSettings(doc.manga, settings);
  assert.deepEqual(parseOmayYaml(toArtworkSettingsYaml(doc)).artwork_settings, settings);
  const full = parse(toMangaYaml(doc));
  assert.equal(full.manga.artwork_settings, undefined);
  assert.doesNotMatch(toMangaYaml(doc), /ヘッダー|Header text/);
  const separated = parse(toSeparatedMangaYaml(doc));
  assert.equal(separated.manga.meta.style_notes, undefined);
  assert.equal(separated.manga.layout_spec, undefined);
  assert.equal(separated.manga.artwork_settings, undefined);
  assert.equal(parse(toSeriesCatalogMangaYaml(doc)).manga.artwork_settings, undefined);
  assert.equal(parse(toOmayYaml(doc, 'character')).artwork_settings, undefined);
});

test('通常の作品フォルダ保存データもOFFの項目と数値を丸ごと復元する', async () => {
  const document = sample();
  const settings = setArtworkNumber(getArtworkSettings(document.manga), 'page', 'footer', 4.8);
  settings.groups.find(group => group.id === 'page').enabled = false;
  applyArtworkSettings(document.manga, settings);
  const snapshot = await createProjectSnapshot(document);
  const restored = await restoreProjectSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(restored, document);
  assert.equal(artworkNumberControls(getArtworkSettings(restored.manga), 'page').find(control => control.id === 'footer').value, 4.8);
});

test('候補追加は既存のON/OFFを変えず、同じ原本を重複追加しない', () => {
  const current = artworkSettingsFromSource(standard());
  current.groups.find(group => group.id === 'page').enabled = false;
  const original = structuredClone(current);
  assert.deepEqual(appendArtworkSettings(current, artworkSettingsFromSource(standard()), '標準'), current);
  const incoming = artworkSettingsFromSource({ style_notes: ['独自の指示'], layout_spec: '独自のレイアウト' });
  const added = appendArtworkSettings(current, incoming, 'custom');
  assert.deepEqual(current, original);
  assert.equal(added.groups.at(-1).enabled, false);
  assert.deepEqual(compileArtworkRules(added, 'integrated'), compileArtworkRules(current, 'integrated'));
  assert.deepEqual(appendArtworkSettings(added, incoming, 'custom'), added);
  assert.equal(added.fragments.at(-1).text, '独自のレイアウト');
});

test('空の設定へ候補を読み込んでも元の本文順を保ち、再読込で重複しない', () => {
  const source = standard();
  const incoming = artworkSettingsFromSource(source);
  const added = appendArtworkSettings(artworkSettingsFromSource({ style_notes: [], layout_spec: '' }), incoming, '標準');
  added.groups.forEach(group => { group.enabled = true; });
  assert.deepEqual(compileArtworkRules(added, 'integrated'), { style_notes: source.style_notes, layout_spec: source.layout_spec });
  assert.deepEqual(appendArtworkSettings(added, incoming, '標準'), added);
});

test('数値欄の更新は反復する同じ指定をそろえ、OFFの設定にも値を残す', () => {
  let settings = artworkSettingsFromSource(standard());
  for (const [id, value] of [['header', 6], ['footer', 4.2], ['footerOffset', 2.8], ['emphasisMax', 1.8], ['emphasisMin', 1.6], ['backgrounds', 3]]) {
    settings = setArtworkNumber(settings, 'page', id, value);
    assert.equal(artworkNumberControls(settings, 'page').find(control => control.id === id).value, value);
  }
  const source = compileArtworkRules(settings, 'integrated');
  const header = source.style_notes.find(note => note.includes('ヘッダーの文字:'));
  assert.equal([...header.matchAll(/フォントサイズ約6mm/g)].length, 2);
  assert.doesNotMatch(header, /約5mm/);
  assert.match(source.layout_spec, /1ページに3コマまで.*この3コマ制限/);
  assert.match(source.style_notes.join('\n'), /それぞれを1.6〜1.8倍/);
  for (const bad of [NaN, Infinity, -1, 101, 1.5]) assert.throws(() => setArtworkNumber(settings, 'page', 'backgrounds', bad));
  assert.throws(() => setArtworkNumber(settings, 'page', 'emphasisMin', 2));
  assert.throws(() => setArtworkNumber(settings, 'page', 'emphasisMax', 1.2));
});

test('不正な編集用設定を捨てて初期化しない', () => {
  const data = artworkSettingsFromSource(standard());
  for (const invalid of [null, { ...data, version: 2 }, { ...data, groups: [...data.groups, data.groups[0]] }, { ...data, fragments: [{ groupId: 'missing', kind: 'style', text: 'keep' }] }]) assert.throws(() => parseArtworkSettings(invalid));
  assert.throws(() => parseOmayYaml('style_notes: []\nlayout_spec: ""\nartwork_settings: {version: 2}'));
});

test('同じ原文断片に作者名の指定があっても見出しの文字サイズだけを変える', () => {
  for (const separator of ['\n', ' ']) {
    const source = standard();
    const header = source.style_notes.find(note => note.includes('ヘッダーの文字:'));
    const footer = source.style_notes.find(note => note.includes('フッターの文字:'));
    const settings = artworkSettingsFromSource({ style_notes: [header + separator + footer], layout_spec: '' });
    const changed = compileArtworkRules(setArtworkNumber(settings, 'page', 'header', 6), 'integrated');
    assert.match(changed.style_notes[0], /ヘッダーの文字:.*フォントサイズ約6mm/);
    assert.ok(changed.style_notes[0].endsWith(footer));
  }
});

test('演技のチェックを外すと、人物配置の節に重複した演技指示も非反映になる', () => {
  for (const source of [standard(), { style_notes: sample().manga.meta.style_notes, layout_spec: sample().manga.layout_spec }]) {
    const settings = artworkSettingsFromSource(source);
    const original = structuredClone(settings.fragments);
    settings.groups.find(group => group.id === 'acting').enabled = false;
    const off = compileArtworkRules(settings, 'integrated');
    assert.doesNotMatch(off.layout_spec, /### ト書き\(action\)|action: その人物だけの画像生成指示|背景・カメラ・画風には使わず/);
    assert.deepEqual(settings.fragments, original);
    settings.groups.find(group => group.id === 'acting').enabled = true;
    assert.equal(compileArtworkRules(settings, 'integrated').layout_spec, source.layout_spec);
  }
});
