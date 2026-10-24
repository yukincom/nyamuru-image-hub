import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse, stringify } from 'yaml';
import { OMAY_SPEC_NAME, omayFileName, omnyFileName, panelFrameLineWidthFromStyleNotes, panelGuttersFromStyleNotes, parseMangaYaml, parseOmayYaml, safeFileName, toMangaYaml, toOmayYaml, toSeparatedMangaYaml, withPanelFrameLineWidthStyleNote, withPanelGutterStyleNote } from '../src/lib/manga.ts';

const omaySource = readFileSync(new URL('../src/content/standard.omay.yaml', import.meta.url), 'utf8');
const sampleSource = readFileSync(new URL('../src/content/sample.omny.yaml', import.meta.url), 'utf8');

test('標準OMAYテンプレートがspec情報と両ルールを持つ', () => {
  const omay = parseOmayYaml(omaySource);
  assert.equal(omay.spec_name, OMAY_SPEC_NAME);
  assert.equal(omay.spec_version, '10.5');
  assert.ok(omay.style_notes.length > 0);
  assert.ok(omay.layout_spec.includes('出力枚数(最重要)'));
  assert.ok(omay.layout_spec.includes('ページヘッダー・フッター'));
  assert.ok(omay.layout_spec.includes('配置の優先順位'));
  assert.ok(omay.style_notes.some((note) => note.includes('meta.format')));
  assert.ok(!omay.style_notes.some((note) => note.startsWith('[style] カラー漫画。')));
  assert.ok(omay.style_notes.some((note) => note.includes('漢字＝ゴシック体、ひらがな・カタカナ＝明朝体')));
  assert.ok(!omay.style_notes.some((note) => note.includes('漢字=明朝体、かな=ゴシック体')));
  assert.ok(omay.layout_spec.includes('meta.panel_frame_width_mm'));
  assert.ok(omay.layout_spec.includes('meta.panel_gutter_row_mm'));
  assert.ok(!omay.layout_spec.includes('外周に約2〜3mmの白マージン'));
});

test('生成プロンプト本体には定型ブロックが残っていない', () => {
  const prompt = readFileSync(new URL('../src/content/nyamuru-manga-generation-prompt-v10.md', import.meta.url), 'utf8');
  assert.ok(!prompt.includes('style_notes の内容（作画・演出ルール一般）'));
  assert.ok(!prompt.includes('layout_spec の内容（画像生成AI向け'));
  assert.ok(prompt.includes('OMAY'));
});

test('ストーリーOMNYはスタイルOMNYのルールを含まず、作品データを保持する', () => {
  const document = parseMangaYaml(sampleSource);
  const separated = parse(toSeparatedMangaYaml(document));
  assert.equal(separated.manga.meta.style_notes, undefined);
  assert.equal(separated.manga.layout_spec, undefined);
  const editorDocument = parse(toMangaYaml(document));
  delete editorDocument.manga.meta.style_notes;
  delete editorDocument.manga.layout_spec;
  assert.deepEqual(separated, editorDocument);
  assert.equal(separated.manga.meta.panel_frame_width_mm, 1);
  assert.equal(separated.manga.meta.panel_gutter_row_mm, 5);
  assert.equal(separated.manga.meta.panel_gutter_column_mm, 3);
});

test('ストーリーOMNYを読み戻すと空のスタイル欄が補完される', () => {
  const document = parseMangaYaml(sampleSource);
  const reloaded = parseMangaYaml(toSeparatedMangaYaml(document));
  assert.deepEqual(reloaded.manga.meta.style_notes, []);
  assert.equal(reloaded.manga.layout_spec, '');
});

test('作品情報のルールをスタイルOMNYとして書き出すと読み戻せる', () => {
  const document = parseMangaYaml(sampleSource);
  const omay = parseOmayYaml(toOmayYaml(document));
  assert.deepEqual(omay.style_notes, document.manga.meta.style_notes);
  assert.equal(omay.layout_spec, document.manga.layout_spec);
  // OMAYの版数はOMNYのschema_versionと独立管理のため、書き出しには刻印されない
  assert.equal(omay.spec_version, undefined);
});

test('旧OMNYの枠線幅を移行用ヘルパーで読み戻せる', () => {
  const original = [
    '[style] カラー漫画',
    '[style] 通常の辺(bleed なし): 太さ約1mmの黒い枠線を描く',
  ];
  const updated = withPanelFrameLineWidthStyleNote(original, 2.2);
  assert.equal(updated.length, 2);
  assert.equal(panelFrameLineWidthFromStyleNotes(updated), 2.2);
  assert.match(updated[1], /太さ約2.2mm/);
  assert.equal(panelFrameLineWidthFromStyleNotes(original), 1);
});

test('旧OMNYのコマ間隔を移行用ヘルパーで読み戻せる', () => {
  const updated = withPanelGutterStyleNote(['[style] モノクロ漫画'], { rowGapMm: 6, columnGapMm: 3 });
  assert.equal(updated.length, 2);
  assert.deepEqual(panelGuttersFromStyleNotes(updated), { rowGapMm: 6, columnGapMm: 3 });
  assert.deepEqual(panelGuttersFromStyleNotes([], { rowGapMm: 5, columnGapMm: 5 }), { rowGapMm: 5, columnGapMm: 5 });
});

test('旧OMNYの枠線幅とコマ間隔をmetaへ移し、重複指定を除く', () => {
  const legacy = parse(sampleSource);
  delete legacy.manga.meta.panel_frame_width_mm;
  delete legacy.manga.meta.panel_gutter_row_mm;
  delete legacy.manga.meta.panel_gutter_column_mm;
  legacy.manga.meta.style_notes.push(
    '[style] コマ枠線幅: 2.2mm。通常の辺(bleed なし): 外周に約2〜3mmの白マージンを取り、太さ約2.2mmの黒い枠線を描く。隣接コマの枠線は共有せず独立して描く',
    '[layout] コマ間隔: 上下6mm・左右3mm',
  );
  legacy.manga.layout_spec = legacy.manga.layout_spec.replace(
    /- \[style\] 通常の辺\(bleed なし\):.*独立して描く/,
    '- [style] 通常の辺(bleed なし): 外周に約2〜3mmの白マージンを取り、太さ約1mmの黒い枠線を描く。隣接コマの枠線は共有せず独立して描く',
  );

  const migrated = parseMangaYaml(stringify(legacy));
  assert.equal(migrated.manga.meta.panel_frame_width_mm, 2.2);
  assert.equal(migrated.manga.meta.panel_gutter_row_mm, 6);
  assert.equal(migrated.manga.meta.panel_gutter_column_mm, 3);
  assert.ok(!migrated.manga.meta.style_notes.some((note) => note.startsWith('[style] コマ枠線幅:')));
  assert.ok(!migrated.manga.meta.style_notes.some((note) => note.startsWith('[layout] コマ間隔:')));
  assert.ok(migrated.manga.layout_spec.includes('meta.panel_frame_width_mm'));
  assert.ok(!migrated.manga.layout_spec.includes('外周に約2〜3mmの白マージン'));
});

test('旧OMNYの逆向きアンチック指定を正しい混植とmeta参照へ移す', () => {
  const legacy = parse(sampleSource);
  legacy.manga.meta.style_notes = legacy.manga.meta.style_notes.filter((note) => !note.includes('meta.font'));
  legacy.manga.meta.style_notes.push('[style] 本文フォントはアンチック体（漢字＝明朝体、ひらがな・カタカナ＝ゴシック体の混植）');
  const migrated = parseMangaYaml(stringify(legacy));
  assert.ok(migrated.manga.meta.style_notes.some((note) => note.includes('漢字＝ゴシック体、ひらがな・カタカナ＝明朝体')));
  assert.ok(!migrated.manga.meta.style_notes.some((note) => note.includes('漢字＝明朝体')));
});

test('旧OMNYの固定カラー指定を出力形式のmeta参照へ移す', () => {
  const legacy = parse(sampleSource);
  legacy.manga.meta.style_notes = legacy.manga.meta.style_notes.filter((note) => !note.includes('meta.format'));
  legacy.manga.meta.style_notes.push('[style] カラー漫画。線画＋ベタ塗り、必要に応じてグラデーション');
  const migrated = parseMangaYaml(stringify(legacy));
  assert.equal(migrated.manga.meta.format, 'カラー漫画');
  assert.ok(migrated.manga.meta.style_notes.some((note) => note.includes('meta.format')));
  assert.ok(!migrated.manga.meta.style_notes.some((note) => note.startsWith('[style] カラー漫画。')));
});

test('ストーリーOMNYとスタイルOMNYのファイル名に対応する拡張子が付く', () => {
  assert.equal(safeFileName('にゃむる'), 'にゃむる.yaml');
  assert.equal(omnyFileName('にゃむる'), 'にゃむる.omny.yaml');
  assert.equal(omayFileName(''), 'manga-name.omay.yaml');
});

test('壊れたOMAYを拒否する', () => {
  assert.throws(() => parseOmayYaml('style_notes: "not-an-array"\nlayout_spec: ""'));
  assert.throws(() => parseOmayYaml('42'));
});
