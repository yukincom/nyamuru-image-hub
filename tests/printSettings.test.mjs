import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as jsxRuntime from 'preact/jsx-runtime';
import ts from 'typescript';
import * as print from '../src/lib/printSettings.ts';
import * as finish from '../src/lib/finishLayout.ts';
import * as geometry from '../src/lib/canvasGeometry.ts';
import { PRINTER_PRESETS } from '../src/lib/printerPresets.ts';
import { parseMangaYaml, toMangaYaml, toStoredMangaYaml, toSeriesCatalogMangaYaml, toSeparatedMangaYaml } from '../src/lib/manga.ts';
import { mergeSeriesCatalog, upsertEpisodeIntoSeriesCatalog } from '../src/lib/seriesCatalog.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const sample = () => parseMangaYaml(read('src/content/sample.omny.yaml'));
function storage() { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }; }
function configured() {
  const setup = print.defaultPrintSetup();
  Object.assign(setup, { printer: '金沢印刷', product: '本文セット', width_mm: 148, height_mm: 210, dpi: 1200, bleed_mm: 5, binding: 'left', tone_lpi: 65, body_pages: 20 });
  setup.cover = { enabled: true, format: 'カラー漫画', dpi: 350, layout: 'spread', spine_mm: 3.8 };
  setup.folio = { enabled: true, hidden: true, start: 3, font: '明朝', size_pt: 9, position: 'inside' };
  return setup;
}
test('本体の確定値を記憶し、ページ数・背幅を新作へコピーしない', () => {
  const store = storage();
  assert.equal(print.loadPrintPreferences(store), null);
  const setup = configured();
  const original = structuredClone(setup);
  print.savePrintPreferences(store, setup);
  assert.deepEqual(setup, original);
  const loaded = print.loadPrintPreferences(store);
  assert.equal(loaded.body_pages, 4);
  assert.equal(loaded.cover.spine_mm, 0);
  for (const key of ['printer', 'product', 'binding', 'dpi', 'bleed_mm', 'tone_lpi']) assert.equal(loaded[key], setup[key]);
  assert.equal(JSON.parse(store.getItem(print.PRINT_PREFERENCES_KEY)).body_pages, undefined);
  loaded.printer = '栄光';
  assert.equal(print.loadPrintPreferences(store).printer, '金沢印刷');
  const remembered = store.getItem(print.PRINT_PREFERENCES_KEY);
  assert.throws(() => print.savePrintPreferences(store, { ...setup, dpi: 0 }));
  assert.equal(store.getItem(print.PRINT_PREFERENCES_KEY), remembered);
  store.setItem(print.PRINT_PREFERENCES_KEY, '{broken');
  assert.equal(print.loadPrintPreferences(store), null);
});
test('原稿の印刷条件は保存・書き出し・フォルダ復元で往復し、判型と読順を保つ', async () => {
  const source = sample();
  const before = structuredClone(source);
  const document = print.withPrintSetup(source, configured());
  assert.deepEqual(source, before);
  assert.ok(document.manga.pages.every(page => page.canvas.w === 148 && page.canvas.h === 210));
  assert.deepEqual(print.withPrintSetup(document, configured()), document);
  assert.equal(document.manga.meta.reading_direction, before.manga.meta.reading_direction);
  assert.equal(document.manga.meta.page_count, before.manga.pages.length);
  for (const serialize of [toStoredMangaYaml, toMangaYaml, toSeparatedMangaYaml]) {
    const restored = parseMangaYaml(serialize(document));
    assert.deepEqual(restored.manga.print_settings, document.manga.print_settings);
    assert.deepEqual(restored.manga.finish_settings, document.manga.finish_settings);
  }
  const restored = await restoreProjectSnapshot(JSON.parse(JSON.stringify(await createProjectSnapshot(document))));
  assert.deepEqual(restored.manga.print_settings, document.manga.print_settings);
  assert.deepEqual(restored.manga.pages, document.manga.pages);
});
test('シリーズ保存の両経路から印刷条件を除き、別シリーズでも原稿の値を守る', () => {
  const doc = print.withPrintSetup(sample(), configured());
  const catalog = parseMangaYaml(toSeriesCatalogMangaYaml(doc));
  assert.equal(catalog.manga.print_settings, undefined);
  assert.equal(catalog.manga.finish_settings, undefined);
  const upserted = upsertEpisodeIntoSeriesCatalog(doc, doc).document;
  assert.equal(upserted.manga.print_settings, undefined);
  assert.equal(upserted.manga.finish_settings, undefined);
  const merged = mergeSeriesCatalog(doc, catalog).document;
  assert.deepEqual(merged.manga.print_settings, doc.manga.print_settings);
});
test('旧原稿を開くだけでは初期化も本体更新も行わず、既存の出力設定と正本を共有する', () => {
  const store = storage();
  print.savePrintPreferences(store, configured());
  const remembered = store.getItem(print.PRINT_PREFERENCES_KEY);
  const doc = sample();
  doc.manga.meta.format = '特色2色';
  doc.manga.finish_settings = { width_mm: 148.5, height_mm: 210, dpi: 450, bleed_mm: 4 };
  const before = structuredClone(doc);
  const setup = print.getPrintSetup(doc.manga);
  assert.equal(setup.format, '特色2色');
  assert.equal(setup.width_mm, 148.5);
  assert.equal(setup.dpi, 450);
  assert.deepEqual(doc, before);
  const edited = print.withPrintSetup(doc, setup);
  const changed = finish.withOutputSettings(edited, { dpi: 600, format: 'モノクロ漫画' });
  assert.equal(print.getPrintSetup(changed.manga).dpi, 600);
  assert.equal(print.getPrintSetup(changed.manga).format, 'モノクロ漫画');
  assert.equal('dpi' in changed.manga.print_settings, false);
  assert.equal('format' in changed.manga.print_settings, false);
  assert.equal(store.getItem(print.PRINT_PREFERENCES_KEY), remembered);
});
test('単位換算とpxの往復で実寸・画素数を保ち、JIS寸法を識別する', () => {
  for (const unit of ['mm', 'cm', 'in', 'px', 'pt']) for (const dpi of [350, 600, 1200]) {
    const mm = 148.5;
    assert.ok(Math.abs(print.unitToMm(print.mmToUnit(mm, unit, dpi), unit, dpi) - mm) < 1e-10);
  }
  assert.ok(Math.abs(print.mmToUnit(25.4, 'in', 350) - 1) < 1e-12);
  assert.ok(Math.abs(print.mmToUnit(25.4, 'pt', 350) - 72) < 1e-12);
  assert.ok(Math.abs(print.mmToUnit(print.unitToMm(1201, 'px', 350), 'px', 350) - 1201) < 1e-10);
  assert.equal(print.paperSizeId({ width_mm: 257, height_mm: 182 }), 'B5');
  assert.equal(print.paperSizeId({ width_mm: 176, height_mm: 250 }), 'custom');
});
test('無効な設定は拒否し、ページ数の4の倍数は一律制約にしない', () => {
  const setup = configured();
  for (const change of [{ dpi: 0 }, { dpi: 350.5 }, { width_mm: NaN }, { bleed_mm: -1 }, { tone_lpi: 0 }, { body_pages: 0 }, { body_pages: 1001 }, { safe_margin_mm: 500 }, { purpose: 'animation' }]) assert.throws(() => print.validatePrintSetup({ ...setup, ...change }));
  assert.equal(print.validatePrintSetup({ ...setup, body_pages: 5 }).body_pages, 5);
  assert.match(print.pageCountAdvice({ ...setup, body_pages: 6, binding_style: 'saddle' }), /4の倍数/);
  assert.equal(print.pageCountAdvice({ ...setup, body_pages: 6, binding_style: 'perfect' }), '');
  assert.match(print.pageCountAdvice({ ...setup, body_pages: 5, binding_style: 'perfect' }), /2ページ/);
});
// Execute real event handlers with isolated hook state; no access to the user's storage.
function editor(initial, extra = {}) {
  let cursor = 0; const state = []; const committed = []; let cancelled = 0;
  const imports = {
    'preact/jsx-runtime': jsxRuntime,
    'preact/hooks': { useState: value => { const i = cursor++; if (!(i in state)) state[i] = typeof value === 'function' ? value() : value; return [state[i], next => state[i] = typeof next === 'function' ? next(state[i]) : next]; } },
    '../lib/finishLayout': finish, '../lib/printSettings': print, '../lib/canvasGeometry': geometry,
  };
  const exports = {};
  runInNewContext(ts.transpileModule(read('src/components/PrintSettingsEditor.tsx'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'preact' } }).outputText, { exports, require: n => imports[n] ?? {}, structuredClone });
  return { render: () => { cursor = 0; return exports.default({ initial, onConfirm: s => committed.push(s), onCancel: () => cancelled++, ...extra }); }, committed, cancelled: () => cancelled };
}
function nodes(tree) { if (Array.isArray(tree)) return tree.flatMap(nodes); if (!tree || typeof tree !== 'object') return []; return [tree, ...nodes(tree.props?.children)]; }
function text(tree) { if (Array.isArray(tree)) return tree.map(text).join(''); return !tree || typeof tree !== 'object' ? String(tree ?? '') : text(tree.props?.children); }
const control = (tree, label) => nodes(tree).find(n => n.props?.['aria-label'] === label);
const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && text(n) === label);
const submit = tree => nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
const checkbox = (tree, label) => nodes(nodes(tree).find(n => n.type === 'label' && text(n) === label)).find(n => n.type === 'input');
test('上部操作用フォームも不正値を拒否し、修正後の最新設定だけを確定する', () => {
  const ui = editor(print.defaultPrintSetup(), { externalFormId: 'new-print-form' });
  assert.equal(ui.render().props.id, 'new-print-form');
  assert.equal(button(ui.render(), 'キャンセル'), undefined);
  assert.equal(button(ui.render(), '設定完了'), undefined);
  control(ui.render(), '解像度を数値で指定（dpi）').props.onInput({ currentTarget: { valueAsNumber: 0 } });
  submit(ui.render());
  assert.equal(ui.committed.length, 0);
  assert.ok(nodes(ui.render()).find(n => n.props?.role === 'alert'));
  control(ui.render(), '解像度を数値で指定（dpi）').props.onInput({ currentTarget: { valueAsNumber: 1200 } });
  submit(ui.render());
  assert.equal(ui.committed.length, 1);
  assert.equal(ui.committed[0].dpi, 1200);
  assert.equal(nodes(ui.render()).find(n => n.props?.role === 'alert'), undefined);
});
test('用途・表紙・色の出し分けと、表紙切替でも本文数を維持する', () => {
  const ui = editor({ ...print.defaultPrintSetup(), body_pages: 1 });
  assert.equal(control(ui.render(), 'ページ数'), undefined);
  assert.ok(control(ui.render(), '綴じ方向'));
  assert.doesNotMatch(text(ui.render()), /本文ページ数|総ページ数|本文 1 ページ|新しい描画レイヤー/);
  assert.equal(control(ui.render(), '表紙の表現色'), undefined);
  assert.ok(nodes(ui.render()).filter(n => n.type === 'details').every(n => !n.props.open));
  checkbox(ui.render(), '表紙を付ける').props.onChange({ currentTarget: { checked: true } });
  assert.equal(control(ui.render(), 'ページ数'), undefined);
  assert.ok(control(ui.render(), '表紙の表現色'));
  checkbox(ui.render(), '表紙を付ける').props.onChange({ currentTarget: { checked: false } });
  control(ui.render(), '基本表現色').props.onChange({ currentTarget: { value: 'カラー漫画' } });
  assert.equal(control(ui.render(), '基本線数（lpi）'), undefined);
  button(ui.render(), 'イラスト').props.onClick();
  assert.equal(control(ui.render(), 'ページ数'), undefined);
  assert.equal(control(ui.render(), '綴じ方向'), undefined);
  assert.equal(checkbox(ui.render(), '表紙を付ける'), undefined);
  assert.ok(control(ui.render(), 'サイズの単位'));
  button(ui.render(), '漫画').props.onClick();
  assert.equal(control(ui.render(), 'ページ数'), undefined);
  submit(ui.render());
  assert.equal(ui.committed[0].body_pages, 1);
  button(ui.render(), 'キャンセル').props.onClick();
  assert.equal(ui.cancelled(), 1);
  assert.equal(ui.committed.length, 1);
});
test('編集確定だけが値を渡し、用紙単位を往復しても原寸を丸めない', () => {
  const setup = { ...configured(), purpose: 'illustration', unit: 'px', width_mm: print.unitToMm(1201, 'px', 1200) };
  const ui = editor(setup);
  for (const unit of ['pt', 'in', 'px']) control(ui.render(), 'サイズの単位').props.onChange({ currentTarget: { value: unit } });
  submit(ui.render());
  assert.equal(ui.committed.length, 1);
  assert.equal(ui.committed[0].width_mm, setup.width_mm);
  assert.equal(ui.committed[0].body_pages, 1);
  assert.equal(setup.body_pages, 20);
});
test('既存本文数は印刷設定で削減せず、不正数値は確定を止める', () => {
  const ui = editor(configured(), { lockedPageCount: 7 });
  assert.equal(control(ui.render(), 'ページ数'), undefined);
  control(ui.render(), '塗り足し（mm）').props.onInput({ currentTarget: { valueAsNumber: NaN } });
  submit(ui.render());
  assert.equal(ui.committed.length, 0);
  assert.ok(nodes(ui.render()).find(n => n.props?.role === 'alert'));
  control(ui.render(), '塗り足し（mm）').props.onInput({ currentTarget: { valueAsNumber: 3 } });
  submit(ui.render());
  assert.equal(ui.committed[0].body_pages, 7);
});

test('イラストは初回の余白0・カラー350dpi、小さなpxサイズも確定できる', () => {
  const ui = editor(print.defaultPrintSetup());
  button(ui.render(), 'イラスト').props.onClick();
  assert.equal(control(ui.render(), '塗り足し（mm）').props.value, 0);
  assert.equal(control(ui.render(), '安全余白（mm）').props.value, 0);
  control(ui.render(), '用紙サイズ').props.onChange({ currentTarget: { value: 'custom' } });
  control(ui.render(), 'サイズの単位').props.onChange({ currentTarget: { value: 'px' } });
  control(ui.render(), '幅（px）').props.onInput({ currentTarget: { valueAsNumber: 128 } });
  control(ui.render(), '高さ（px）').props.onInput({ currentTarget: { valueAsNumber: 128 } });
  submit(ui.render());
  assert.equal(ui.committed.length, 1);
  assert.equal(Math.round(ui.committed[0].width_mm * 350 / 25.4), 128);
  button(ui.render(), '漫画').props.onClick();
  assert.equal(control(ui.render(), '塗り足し（mm）').props.value, 3);
  assert.equal(control(ui.render(), '解像度').props.value, 600);
  button(ui.render(), 'イラスト').props.onClick();
  assert.equal(control(ui.render(), '幅（px）').props.value, 128);
});

test('色変更で解像度を合わせる時も、指定済みの画素数を保つ', () => {
  const ui = editor({ ...print.defaultPrintSetup(), purpose: 'illustration', unit: 'px', format: 'グレースケール漫画', dpi: 600, width_mm: 1200 * 25.4 / 600, height_mm: 800 * 25.4 / 600 });
  const mode = nodes(ui.render()).find(n => n.type === 'select' && nodes(n).some(o => o.type === 'option' && text(o) === '画素数を保つ'));
  mode.props.onChange({ currentTarget: { value: 'pixels' } });
  control(ui.render(), '基本表現色').props.onChange({ currentTarget: { value: 'カラー漫画' } });
  assert.equal(control(ui.render(), '解像度').props.value, 350);
  assert.equal(control(ui.render(), '幅（px）').props.value, 1200);
  assert.equal(control(ui.render(), '高さ（px）').props.value, 800);
  assert.doesNotMatch(text(ui.render()), /A4表示のまま|（JIS）/);
});

test('調査済み24社の選択で塗り足し・本文色別dpi・表紙dpiを実際に反映する', () => {
  const research = JSON.parse(read('docs/research/printer-requirements-2026-09-25.json'));
  assert.deepEqual(print.PRINTER_NAMES, research.printers.map(p => p.name));
  const expected = [
    [3,600,600,350], [3,600,600,350], [5,1200,600,350], [5,600,600,350],
    [3,600,600,350], [3,600,600,350], [3,600,600,350], [3,600,600,350],
    [3,600,600,350], [3,600,600,350], [3,600,600,350], [3,600,600,350],
    [3,600,350,350], [3,600,600,350], [3,600,600,350], [3,600,600,350],
    [3,600,600,350], [4,600,350,350], [3,600,600,350], [3,600,600,350],
    [5,600,600,350], [3,600,600,450], [3,600,600,350], [3,600,600,350],
  ];
  PRINTER_PRESETS.forEach((preset, index) => {
    const source = research.printers[index];
    assert.equal(preset.checkedAt, source.checkedAt);
    assert.ok(preset.sources.length > 0 && preset.sources.every(url => source.sources.some(s => s.url === url)));
    for (const format of ['特色2色', 'constructor']) {
      assert.equal(print.applyPrinterPreset({ ...configured(), format, dpi: 450 }, preset.name).dpi, 450);
    }
    ['モノクロ漫画', 'グレースケール漫画', 'カラー漫画'].forEach((format, color) => {
      const original = { ...configured(), format, bleed_mm: 7, dpi: 450, cover: { ...configured().cover, dpi: 450 } };
      const ui = editor(original);
      control(ui.render(), '印刷所').props.onChange({ currentTarget: { value: preset.name } });
      submit(ui.render());
      const result = ui.committed[0];
      assert.ok(result, preset.name);
      assert.equal(result.bleed_mm, expected[index][0], preset.name);
      assert.equal(result.dpi, expected[index][color + 1], `${preset.name}: ${format}`);
      assert.equal(result.cover.dpi, 350);
      assert.equal(result.cover.spine_mm, original.cover.spine_mm);
      assert.equal(result.body_pages, 20);
      assert.equal(result.binding, 'left');
      assert.equal(result.tone_lpi, 65);
      assert.equal(result.product, '');
      assert.equal(original.bleed_mm, 7);
    });
  });
});

test('EditNetの実寸へ判型・縦横を保って切り替え、別社ではJIS寸法へ戻す', () => {
  const ui = editor({ ...configured(), width_mm: 210, height_mm: 148 });
  const select = (label, value) => control(ui.render(), label).props.onChange({ currentTarget: { value } });
  select('印刷所', 'EditNetプリンテック');
  assert.equal(control(ui.render(), '用紙サイズ').props.value, 'A5');
  submit(ui.render());
  assert.equal(ui.committed.at(-1).width_mm, 210);
  assert.equal(ui.committed.at(-1).height_mm, 148.5);
  select('用紙サイズ', 'B6');
  submit(ui.render());
  assert.equal(ui.committed.at(-1).width_mm, 182);
  assert.equal(ui.committed.at(-1).height_mm, 128.5);
  select('用紙の向き', 'portrait');
  select('印刷所', '緑陽社');
  submit(ui.render());
  assert.equal(ui.committed.at(-1).width_mm, 128);
  assert.equal(ui.committed.at(-1).height_mm, 182);
  const custom = { ...configured(), width_mm: 152.7, height_mm: 215.2 };
  assert.equal(print.applyPrinterPreset(custom, 'EditNetプリンテック').width_mm, custom.width_mm);
  assert.equal(print.paperSizeId({ width_mm: 148.5, height_mm: 210, printer: 'EditNetプリンテック' }), 'A5');
  assert.equal(print.paperSizeId({ width_mm: 148.5, height_mm: 210 }), 'custom');
});

test('選択後の本文・表紙の色変更も社別推奨を使い、手動値は確定と再表示で保つ', () => {
  const ui = editor(configured());
  const select = (label, value) => control(ui.render(), label).props.onChange({ currentTarget: { value } });
  select('印刷所', 'サンライズ');
  select('基本表現色', 'カラー漫画');
  assert.equal(control(ui.render(), '解像度').props.value, 350);
  select('基本表現色', 'モノクロ漫画');
  assert.equal(control(ui.render(), '解像度').props.value, 1200);
  select('表紙の表現色', 'モノクロ漫画');
  assert.equal(control(ui.render(), '表紙の解像度').props.value, 1200);
  control(ui.render(), '塗り足し（mm）').props.onInput({ currentTarget: { valueAsNumber: 4 } });
  control(ui.render(), '解像度を数値で指定（dpi）').props.onInput({ currentTarget: { valueAsNumber: 800 } });
  submit(ui.render());
  const saved = storage();
  print.savePrintPreferences(saved, ui.committed[0]);
  const reopened = editor(print.loadPrintPreferences(saved));
  assert.equal(control(reopened.render(), '塗り足し（mm）').props.value, 4);
  assert.equal(control(reopened.render(), '解像度').props.value, 800);
  const unknown = print.applyPrinterPreset(ui.committed[0], '独自の印刷所');
  assert.equal(unknown.dpi, 800);
  assert.equal(unknown.bleed_mm, 4);
  const unspecified = print.applyPrinterPreset(ui.committed[0], '');
  assert.equal(unspecified.dpi, 800);
  assert.equal(unspecified.bleed_mm, 4);
});

const previewRegion = (tree, region) => nodes(tree).find(n => n.props?.['data-print-region'] === region)?.props;
test('紙見本は内枠だけ破線とし、塗り足しを細い実線と塗りで仕上がりの外側に描く', () => {
  const ui = editor(print.defaultPrintSetup());
  const trim = previewRegion(ui.render(), 'trim');
  const bleed = previewRegion(ui.render(), 'bleed');
  const inner = previewRegion(ui.render(), 'inner');
  assert.equal(trim['stroke-dasharray'], undefined);
  assert.equal(bleed['stroke-dasharray'], undefined);
  assert.ok(inner['stroke-dasharray']);
  assert.equal(inner.fill, 'none');
  assert.notEqual(bleed.fill, 'none');
  assert.ok(Number(bleed['stroke-width']) < Number(trim['stroke-width']));
  const scale = trim.width / 182;
  assert.ok(Math.abs((trim.x - bleed.x) / scale - 3) < 1e-9);
  assert.ok(Math.abs((inner.x - trim.x) / scale - 10) < 1e-9);
  control(ui.render(), '安全余白（mm）').props.onInput({ currentTarget: { valueAsNumber: 20 } });
  assert.deepEqual(previewRegion(ui.render(), 'inner'), inner);
  control(ui.render(), '塗り足し（mm）').props.onInput({ currentTarget: { valueAsNumber: 5 } });
  assert.deepEqual(previewRegion(ui.render(), 'trim'), trim);
  assert.deepEqual(previewRegion(ui.render(), 'inner'), inner);
  assert.ok(Math.abs((trim.x - previewRegion(ui.render(), 'bleed').x) / scale - 5) < 1e-9);
});

test('定型用紙の寸法変更は同一縮尺で仕上がり枠へ反映し、同じ塗り足しは同じ幅になる', () => {
  const ui = editor(print.defaultPrintSetup());
  let scale;
  for (const paper of print.PAPER_SIZES) for (const orientation of ['portrait', 'landscape']) {
    control(ui.render(), '用紙サイズ').props.onChange({ currentTarget: { value: paper.id } });
    control(ui.render(), '用紙の向き').props.onChange({ currentTarget: { value: orientation } });
    const width = orientation === 'portrait' ? paper.width : paper.height;
    const height = orientation === 'portrait' ? paper.height : paper.width;
    const trims = nodes(ui.render()).filter(n => n.props?.['data-print-region'] === 'trim').map(n => n.props);
    const bleeds = nodes(ui.render()).filter(n => n.props?.['data-print-region'] === 'bleed').map(n => n.props);
    assert.equal(trims.length, 2);
    for (let i = 0; i < 2; i++) {
      const trim = trims[i], bleed = bleeds[i];
      scale ??= trim.width / width;
      assert.ok(Math.abs(trim.width / width - scale) < 1e-9, `${paper.id} ${orientation}`);
      assert.ok(Math.abs(trim.width / trim.height - width / height) < 1e-9);
      assert.ok(Math.abs((trim.x - bleed.x) / scale - 3) < 1e-9);
      assert.ok(bleed.x >= 0 && bleed.y >= 0 && bleed.x + bleed.width <= 320 && bleed.y + bleed.height <= 200);
    }
    assert.ok(bleeds[0].x + bleeds[0].width < bleeds[1].x);
  }
  button(ui.render(), 'イラスト').props.onClick();
  assert.equal(previewRegion(ui.render(), 'inner'), undefined);
});

test('二枚の中央の❶❷だけで綴じ方向を示し、綴じ変更で紙寸法を変えない', () => {
  const ui = editor(print.defaultPrintSetup());
  const preview = () => nodes(ui.render()).find(n => n.type === 'figure');
  const numbers = () => nodes(preview()).filter(n => n.type === 'text');
  const rects = () => nodes(preview()).filter(n => n.type === 'rect').map(n => n.props);
  const initialRects = rects();
  assert.equal(text(preview()), '❷❶');
  assert.equal(nodes(preview()).some(n => n.type === 'figcaption'), false);
  control(ui.render(), '綴じ方向').props.onChange({ currentTarget: { value: 'left' } });
  assert.equal(text(preview()), '❶❷');
  assert.deepEqual(rects(), initialRects);
  const trims = rects().filter(p => p['data-print-region'] === 'trim');
  numbers().forEach((n, i) => {
    assert.equal(n.props.x, trims[i].x + trims[i].width / 2);
    assert.ok(Math.abs(Number(n.props.y) - (trims[i].y + trims[i].height / 2)) < 1e-9);
  });
  button(ui.render(), 'イラスト').props.onClick();
  assert.equal(numbers().length, 0);
  assert.equal(rects().filter(p => p['data-print-region'] === 'trim').length, 1);
});
