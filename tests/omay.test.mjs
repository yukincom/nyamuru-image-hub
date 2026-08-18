import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
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
});

test('生成プロンプト本体には定型ブロックが残っていない', () => {
  const prompt = readFileSync(new URL('../src/content/nyamuru-manga-generation-prompt-v10.md', import.meta.url), 'utf8');
  assert.ok(!prompt.includes('style_notes の内容（作画・演出ルール一般）'));
  assert.ok(!prompt.includes('layout_spec の内容（画像生成AI向け'));
  assert.ok(prompt.includes('OMAY'));
});

test('分離版OMNYは画像生成ルールを含まず、ネームデータは全部入り版と同一', () => {
  const document = parseMangaYaml(sampleSource);
  const separated = parse(toSeparatedMangaYaml(document));
  assert.equal(separated.manga.meta.style_notes, undefined);
  assert.equal(separated.manga.layout_spec, undefined);
  // 全部入り版＝分離版＋ルールの合成。ルールを除けば両者は一致する
  const full = parse(toMangaYaml(document));
  delete full.manga.meta.style_notes;
  delete full.manga.layout_spec;
  assert.deepEqual(separated, full);
});

test('分離版OMNYを読み戻すと空のルール欄が補完される', () => {
  const document = parseMangaYaml(sampleSource);
  const reloaded = parseMangaYaml(toSeparatedMangaYaml(document));
  assert.deepEqual(reloaded.manga.meta.style_notes, []);
  assert.equal(reloaded.manga.layout_spec, '');
});

test('作品情報のルールをOMAYとして書き出すと読み戻せる', () => {
  const document = parseMangaYaml(sampleSource);
  const omay = parseOmayYaml(toOmayYaml(document));
  assert.deepEqual(omay.style_notes, document.manga.meta.style_notes);
  assert.equal(omay.layout_spec, document.manga.layout_spec);
  // OMAYの版数はOMNYのschema_versionと独立管理のため、書き出しには刻印されない
  assert.equal(omay.spec_version, undefined);
});

test('新規取り込みの枠線幅を重複なく作画指定へ保存して読み戻す', () => {
  const original = [
    '[style] カラー漫画',
    '[style] 通常の辺(bleed なし): 太さ約1mmの黒い枠線を描く',
  ];
  const updated = withPanelFrameLineWidthStyleNote(original, 2.2);
  assert.equal(updated.length, 2);
  assert.equal(panelFrameLineWidthFromStyleNotes(updated), 2.2);
  assert.match(updated[1], /太さ約2.2mm/);
  assert.equal(panelFrameLineWidthFromStyleNotes(original), 1.6);
});

test('新規取り込みまたはテンプレートのコマ間隔を作品設定へ保存して読み戻す', () => {
  const updated = withPanelGutterStyleNote(['[style] モノクロ漫画'], { rowGapMm: 6, columnGapMm: 3 });
  assert.equal(updated.length, 2);
  assert.deepEqual(panelGuttersFromStyleNotes(updated), { rowGapMm: 6, columnGapMm: 3 });
  assert.deepEqual(panelGuttersFromStyleNotes([], { rowGapMm: 5, columnGapMm: 5 }), { rowGapMm: 5, columnGapMm: 5 });
});

test('保存2種類とOMAYのファイル名に対応する拡張子が付く', () => {
  assert.equal(safeFileName('にゃむる'), 'にゃむる.yaml');
  assert.equal(omnyFileName('にゃむる'), 'にゃむる.omny.yaml');
  assert.equal(omayFileName(''), 'manga-name.omay.yaml');
});

test('壊れたOMAYを拒否する', () => {
  assert.throws(() => parseOmayYaml('style_notes: "not-an-array"\nlayout_spec: ""'));
  assert.throws(() => parseOmayYaml('42'));
});
