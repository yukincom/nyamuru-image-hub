import {readGlobalStyles} from './helpers/globalStyles.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Transpiled components and renderer must share the same CJS Preact hook runtime.
const require = createRequire(import.meta.url);
const { h } = require('preact');
const { renderToString } = require('preact-render-to-string');

const source = ['workspace/newProjectDraft.ts', 'workspace/newLayoutImportActions.ts'].map(path =>
  readFileSync(new URL('../src/components/' + path, import.meta.url), 'utf8')
).join('\n');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const layoutSource = readFileSync(new URL('../src/components/new-project/NewLayoutStep.tsx', import.meta.url), 'utf8');
const layoutAst = ts.createSourceFile('NewLayoutStep.tsx', layoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const css = readGlobalStyles();
const feedSource = readFileSync(new URL('../src/components/NewLayoutAnalysisFeed.tsx', import.meta.url), 'utf8');
const progressSource = readFileSync(new URL('../src/components/CharacterReadProgress.tsx', import.meta.url), 'utf8');
const progressExports = {};
runInNewContext(ts.transpileModule(progressSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'preact' },
}).outputText, { exports: progressExports, require });
const exports = {};
runInNewContext(ts.transpileModule(feedSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'preact' },
}).outputText, { exports, require: id => id === './CharacterReadProgress' ? progressExports : createRequire(import.meta.url)(id) });
const feed = (items, message = null, characterProgress = null) => renderToString(h(exports.default, { items, message, characterProgress }));

function handler(name, context) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(initializer, name);
  return runInNewContext(ts.transpileModule(`(${initializer.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText, context);
}

const analysis = (text = '読み取った文字') => ({
  detectedPanels: [{}], detectedPanelCount: 5, excludedNonPanelCount: 1,
  detectedTextRegionCount: 10, detectedFaceRegionCount: 2, detectedBodyRegionCount: 2,
  detectedFigures: [{}, {}], structureEngine: 'RT-DETR', ocrEngine: 'Baberu',
  ocrLines: [{ id: 'line1', text, source: 'Baberu', needsReview: true }],
});
const item = (id, result = null) => ({ id, file: { name: `${id}.png` }, analysis: result, analyzing: false, rotationOverride: 0 });

test('コマ割りは初期状態で閉じたネイティブの開閉欄に収め、解析中は選択できない', () => {
  let picker;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(p => p.initializer?.text === 'new-template-picker')) picker = node;
    ts.forEachChild(node, visit);
  }
  visit(layoutAst);
  assert.equal(picker.openingElement.tagName.getText(layoutAst), 'details');
  assert.ok(!picker.openingElement.attributes.properties.some(p => p.name.getText(layoutAst) === 'open'));
  assert.match(picker.getText(layoutAst), /<summary>コマ割りを選んで開始<\/summary>/);
  assert.match(picker.getText(layoutAst), /PANEL_TEMPLATES.map/);
  assert.match(picker.getText(layoutAst), /disabled=\{newLayoutTask !== 'idle'\}/);
});

test('進捗と全ページの詳細はフォーカス欄内の画像操作より下、画像なしでも通知を維持する', () => {
  let focus;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(p => p.initializer?.text === 'new-layout-focus-pane')) focus = node;
    ts.forEachChild(node, visit);
  }
  visit(layoutAst);
  const text = focus.getText(layoutAst);
  assert.ok(text.indexOf('<NewLayoutAnalysisFeed') > text.indexOf("onClick={analyzeNewLayouts}"));
  assert.doesNotMatch(text, /編集開始<\/button>/);
  assert.match(text, /items=\{newLayoutItems\} message=\{newLayoutMessage\}/);
  assert.match(layoutSource, /!activeLayoutItem && \(newCharacterReadProgress \? <CharacterReadProgress/);
  assert.match(feed([], '人物と演技を読み取っています… 3 / 13'), /role="status">人物と演技を読み取っています… 3 \/ 13/);
  assert.doesNotMatch(feed([]), /<details/);
});

test('人物解析のバーは実完了数のみで進み、現在の人物と経過時間を示す', () => {
  const html = feed([], '二重に表示しない', { completed: 3, total: 13, startedAt: Date.now() - 12000 });
  assert.match(html, /<progress[^>]*value="3"[^>]*max="13"/);
  assert.match(html, /処理済み 3 \/ 13 人/);
  assert.match(html, /4人目をローカルで解析中 · 12秒経過/);
  assert.doesNotMatch(html, /二重に表示しない/);
  const finished = feed([], null, { completed: 13, total: 13, startedAt: Date.now() });
  assert.match(finished, /読み取りが完了しました/);
  assert.doesNotMatch(finished, /14人目/);
  assert.match(progressSource, /clearInterval\(timer\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  let cleared = false;
  handler('updateNewLayoutTask', { newLayoutTaskRef: {}, setNewLayoutTask: () => {}, setNewCharacterReadProgress: value => { cleared = value === null; } })('idle');
  assert.equal(cleared, true);
});

test('完了分は新しいページが上、ページ名と読み取った文字が見え、原配列は変更しない', () => {
  const items = [item('first', analysis('前の結果')), item('second', analysis('<新しい結果>')), item('pending')];
  const html = feed(items);
  assert.ok(html.indexOf('PAGE 02') < html.indexOf('PAGE 01'));
  assert.doesNotMatch(html, /pending.png/);
  assert.match(html, /<details[^>]* open/);
  assert.match(html, /&lt;新しい結果(?:>|&gt;)/);
  assert.doesNotMatch(html, /要確認/);
  assert.match(html, /class="is-text-review"/);
  assert.deepEqual(items.map(entry => entry.id), ['first', 'second', 'pending']);
  assert.match(css, /\.new-layout-analysis-feed \{[^}]*max-height: 320px;[^}]*overflow-y: auto;[^}]*overflow-anchor: none/);
});

test('失敗とコマ未検出の理由もページ付きで保持し、結果の無効化で古い内容が消える', () => {
  const items = [item('no-panels', { ...analysis(), detectedPanels: [], detectedPanelCount: 0, reason: 'コマが見つかりません' }),
    { ...item('failed'), error: '画像を読み取れません' }];
  const html = feed(items);
  assert.match(html, /コマが見つかりません/);
  assert.match(html, /解析できませんでした/);
  assert.match(html, /画像を読み取れません/);
  assert.ok(html.indexOf('PAGE 02') < html.indexOf('PAGE 01'));
  assert.doesNotMatch(feed(items.map(entry => ({ ...entry, analysis: null, error: undefined }))), /<details/);
});

test('記録内の矢印キーはページ切替へ伝播させず、ブラウザのスクロール操作は残す', () => {
  const tree = exports.default({ items: [item('first', analysis())], message: null });
  const region = tree.props.children.find(child => child?.props?.role === 'region');
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Escape']) {
    let stopped = false;
    region.props.onKeyDown({ key, stopPropagation: () => { stopped = true; },
      preventDefault: () => assert.fail('ブラウザの既定操作を抑止してはいけない') });
    assert.equal(stopped, key.startsWith('Arrow'));
  }
});

// 見込み: コマ解析中も各ページの結果を逐次表示し、全件成功時だけ既存作成へ引き継ぐ。
// 合格: 後の結果ほど上に表示され、作成へ渡す結果・世代・scanner指定が一致。確認範囲は実handlerと実feed、検出APIと作成先は模擬。
test('実解析ハンドラは進捗を逐次表示し、最新の全件結果から自動作成を始める', async () => {
  const pending = [];
  const state = { items: [item('first', analysis('前回の結果')), item('second')], message: '' };
  const itemsRef = { current: state.items };
  const run = handler('analyzeNewLayouts', {
    newLayoutItemsRef: itemsRef, newLayoutTaskRef: { current: 'idle' }, newLayoutOperationGeneration: { current: 0 },
    updateNewLayoutTask: () => {}, setNewLayoutItems: items => { state.items = items; },
    setNewLayoutActiveIndex: () => {}, setNewLayoutMessage: message => { state.message = message; },
    newLayoutRowGapMm: 5, newLayoutColumnGapMm: 5,
    recognizePanelLayout: () => new Promise(resolve => pending.push(resolve)),
    createNewDocument: async (layouts, scanned, generation) => {
      assert.equal(layouts.length, 2);
      assert.equal(layouts[0].analysis, itemsRef.current[0].analysis);
      assert.equal(layouts[1].analysis, itemsRef.current[1].analysis);
      assert.equal(scanned, false);
      assert.equal(generation, 1);
    },
  });
  const completion = run();
  assert.doesNotMatch(feed(state.items), /前回の結果/);
  pending.shift()(analysis('1ページ目完了'));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(feed(state.items), /1ページ目完了/);
  assert.doesNotMatch(feed(state.items), /PAGE 02/);
  assert.match(state.message, /2 \/ 2枚目/);
  pending.shift()(analysis('2ページ目完了'));
  await completion;
  const html = feed(state.items);
  assert.ok(html.indexOf('2ページ目完了') < html.indexOf('1ページ目完了'));
});
