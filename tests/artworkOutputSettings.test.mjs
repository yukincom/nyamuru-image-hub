import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { parse } from 'yaml';
import { getOutputSettings, OUTPUT_DPI_OPTIONS, OUTPUT_FORMAT_OPTIONS, withOutputSettings } from '../src/lib/finishLayout.ts';
import { toEditableMangaFormat } from '../src/lib/artworkEnglish.ts';
import { getArtworkSettings, getArtworkMode, applyArtworkSettings, isInternalArtworkGroup, artworkNumberControls } from '../src/lib/artworkRules.ts';
import { parseMangaYaml, toMangaYaml, toStoredMangaYaml } from '../src/lib/manga.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('src/components/ArtworkSettings.tsx');
const ast = ts.createSourceFile('ArtworkSettings.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'ArtworkSettings');
const code = ts.transpileModule(`(${component.getText(ast).replace('export default ', '')})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' }, fileName: 'test.tsx',
}).outputText;
function render(document) {
  const changes = [], notifications = [];
  const renderComponent = runInNewContext(code, {
    h: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    React: { Fragment: 'Fragment' },
    useRef: () => ({ current: null }), structuredClone,
    SectionTitle: 'SectionTitle', Field: 'Field', FileUp: 'FileUp', Plus: 'Plus', Download: 'Download',
    getArtworkSettings, getArtworkMode, applyArtworkSettings, isInternalArtworkGroup, artworkNumberControls,
    getOutputSettings, OUTPUT_DPI_OPTIONS, OUTPUT_FORMAT_OPTIONS, withOutputSettings, toEditableMangaFormat,
  });
  const tree = renderComponent({ document, onChange: value => changes.push(value), onNotify: value => notifications.push(value) });
  return { tree, changes, notifications };
}
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...nodes(value.children)];
}
const sample = () => parseMangaYaml(read('src/content/sample.omny.yaml'));
const control = (tree, label) => nodes(tree).find(node => node.type === 'select' && node.props['aria-label'] === label);

test('作品情報からカラー、レイアウトからdpiを外し、作画方法の実selectでOMNYを更新する', () => {
  assert.doesNotMatch(read('src/components/DocumentEditors.tsx'), /manga-format-options|完成画像のカラー指定/);
  assert.doesNotMatch(read('src/components/FinishLayoutSettings.tsx'), /key: 'dpi'/);
  const doc = sample();
  const before = structuredClone(doc);
  const { tree, changes, notifications } = render(doc);
  const color = control(tree, '完成画像のカラー指定');
  const dpi = control(tree, '完成画像の出力解像度');
  assert.deepEqual(nodes(color.children).filter(node => node.type === 'option').map(node => node.props.value), OUTPUT_FORMAT_OPTIONS.map(option => option.value));
  assert.deepEqual(nodes(dpi.children).filter(node => node.type === 'option').map(node => node.props.value), [...OUTPUT_DPI_OPTIONS]);
  color.props.onChange({ currentTarget: { value: 'グレースケール漫画' } });
  let next = changes.at(-1);
  const nextUi = render(next);
  control(nextUi.tree, '完成画像の出力解像度').props.onChange({ currentTarget: { value: '600' } });
  next = nextUi.changes.at(-1);
  const output = parse(toMangaYaml(next)).manga;
  assert.equal(output.meta.format, 'grayscale manga');
  assert.equal(output.finish_layout.format, 'grayscale manga');
  assert.equal(output.finish_layout.dpi, 600);
  assert.deepEqual(parseMangaYaml(toStoredMangaYaml(next)).manga.finish_settings, next.manga.finish_settings);
  assert.deepEqual(next.manga.pages, doc.manga.pages);
  assert.deepEqual(doc, before);
  assert.deepEqual(notifications, []);
});

test('独自値は現在値として表示し、旧作画モードの廃止で色とdpiを変えない', () => {
  const doc = sample();
  doc.manga.meta.format = '特色2色';
  doc.manga.finish_settings = { width_mm: 148, height_mm: 210, dpi: 450, bleed_mm: 3 };
  const { tree, changes } = render(doc);
  assert.equal(changes.length, 0);
  for (const [label, value] of [['完成画像のカラー指定', '特色2色'], ['完成画像の出力解像度', 450]]) {
    const select = control(tree, label);
    assert.equal(select.props.value, value);
    assert.ok(nodes(select.children).some(node => node.type === 'option' && node.props.value === value));
  }
  assert.equal(nodes(tree).some(node => node.type === 'input' && node.props.name === 'artwork-generation-mode'), false);
  assert.equal(changes.length, 0);
  assert.equal(doc.manga.meta.format, '特色2色');
  assert.deepEqual(doc.manga.finish_settings, { width_mm: 148, height_mm: 210, dpi: 450, bleed_mm: 3 });
});

test('生成対象は右クリックへ案内し、モデル別のサイズ制限を説明して無効入力は保存しない', () => {
  assert.match(source, /ページ全体・コマ・人物の生成は、キャンバスの右クリックから選びます/);
  assert.match(source, /実際に生成できる画像のサイズは、利用するモデルによって異なります/);
  assert.doesNotMatch(source, /下書きを生成する|クラウドのみ|ローカル4値ラフは512 × 512 pxの下書き専用/);
  const { tree, changes, notifications } = render(sample());
  const event = { currentTarget: { value: '0' } };
  control(tree, '完成画像の出力解像度').props.onChange(event);
  assert.equal(changes.length, 0);
  assert.equal(notifications.length, 1);
  assert.equal(event.currentTarget.value, '350');
});
