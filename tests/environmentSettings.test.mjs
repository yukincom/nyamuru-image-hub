import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as jsxRuntime from 'preact/jsx-runtime';
import ts from 'typescript';
import * as manga from '../src/lib/manga.ts';
import * as localModels from '../src/lib/localModelPreferences.ts';
import * as generation from '../src/lib/generationPreferences.ts';
import * as artwork from '../src/lib/artworkRules.ts';
import * as finish from '../src/lib/finishLayout.ts';
import * as print from '../src/lib/printSettings.ts';
import * as artworkEnglish from '../src/lib/artworkEnglish.ts';
import * as canvasText from '../src/lib/canvasText.ts';
import { standardRulesTestDocument } from './fixtures/emptyTestDocument.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sample = () => standardRulesTestDocument(read('src/content/standard-settings.yaml'));

// 実際のTSXを固定したhook状態で検証し、利用者の保存データは使わない。
function loadComponent(file, globals = {}) {
  let cursor = 0;
  const state = [];
  const stub = new Proxy({}, { get: (_, key) => key === '__esModule' ? true : String(key) });
  const storage = new Map(globals.initialStorage ?? []);
  const writes = [];
  const window = { localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); writes.push([key, value]); },
  } };
  const exports = {};
  const imports = {
    'preact/jsx-runtime': jsxRuntime,
    'preact/hooks': {
      useState: initial => {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
      },
      useRef: initial => {const index=cursor++;return state[index]??=( {current:initial} );},
    },
    '../lib/manga': manga,
    '../lib/paintWorkspace': { usePaintWorkspace: () => null },
    '../lib/clientRuntime': { isLanClient: globals.isLanClient ?? false },
    '../lib/artworkRules': artwork,
    '../lib/finishLayout': finish,
    '../lib/printSettings': print,
    '../lib/artworkEnglish': artworkEnglish,
    '../lib/canvasText': canvasText,
    '../lib/localModelPreferences': localModels,
    '../lib/generationPreferences': generation,
    '../lib/localBridge': globals.localBridge ?? stub,
    '../lib/bubbleFonts': { BUBBLE_FONT_PRESETS: ['アンチック体'] },
    './FontFamilyPicker': { __esModule: true, default: 'FontFamilyPicker' },
    './FinishLayoutSettings': { __esModule: true, default: 'FinishLayoutSettings', FinishTextSettings: 'FinishTextSettings' },
    './ArtworkSettings': { __esModule: true, default: 'ArtworkSettings' },
    '../content/standard-settings.yaml?raw': { __esModule: true, default: read('src/content/standard-settings.yaml') },
  };
  const compiled = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'preact',
  } }).outputText;
  runInNewContext(compiled, {
    exports, require: name => imports[name] ?? imports[name.replace(/\.ts$/u, '')] ?? stub,
    structuredClone, window, Blob, URL, Error, confirm: () => true, ...globals,
  });
  return {
    render: (props, name = 'default') => { cursor = 0; return exports[name](props); },
    writes,
  };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return text(tree.props?.children);
}
const find = (tree, predicate) => {
  const node = nodes(tree).find(predicate);
  assert.ok(node, 'expected element exists');
  return node;
};
const panel = (tree, id) => find(tree, node => node.props?.id === `environment-panel-${id}`);
const field = (tree, label) => find(tree, node => node.type === 'Field' && node.props.label === label);
const input = tree => find(tree, node => node.type === 'input');
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node) === label);
const clone = value => JSON.parse(JSON.stringify(value));
function settingsProps(document = sample()) {
  return {
    document, onChangeDocument: () => {}, onNotify: () => {},
    showGuides: true, spreadView: false, pageCount: document.manga.pages.length,
    fontFamilies: [{ family: 'I-OTFアンチックStd B', support: 'japanese' }], frameLineWidthMm: 0.6, rowGapMm: 5, columnGapMm: 3, paintCursorMode: 'circle',
    onChangeShowGuides: () => {}, onChangeSpreadView: () => {},
    onChangeFrameLineWidth: () => {},
    onChangeRowGap: () => {}, onChangeColumnGap: () => {},
  };
}

test('データ管理は作品フォルダと構成データの書き出しを扱う', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  const calls = [];
  const props = { ...settingsProps(), saveDirectory: '/test/episode', onChangeSaveDirectory: () => calls.push('folder') };
  const data = panel(component.render(props), 'data');
  const originTitle = find(data, node => node.props?.id === 'origin-data-title');
  const cacheTitle = find(data, node => node.props?.id === 'generation-cache-title');
  assert.equal(text(originTitle), 'オリジンデータ');
  assert.equal(originTitle.type, cacheTitle.type);
  assert.equal(find(data, node => node.type === 'FilePenLine').props['aria-hidden'], 'true');
  assert.match(text(data), /オリジンデータ.*作品フォルダ.*\/test\/episode.*保存先フォルダを変更/s);
  assert.doesNotMatch(text(data), /作品の保存先|保存先を変更して保存|選び直した参照先に現在の内容を保存|⌘S|Ctrl\+S/);
  const css = read('src/styles/global.css');
  assert.match(css, /\.origin-data-row \{[^}]*justify-content: flex-start/);
  assert.match(css, /\.origin-data-current \{[^}]*flex: 0 1 400px/);
  assert.match(css, /\.generation-cache-current-size > :first-child, \.generation-cache-delete-row > :first-child \{[^}]*flex: none/);
  button(data, '保存先フォルダを変更').props.onClick();
  assert.deepEqual(calls, ['folder']);
  const busy = panel(component.render({ ...props, projectBusy: true }), 'data');
  assert.equal(button(busy, '保存先フォルダを変更').props.disabled, true);
  assert.doesNotMatch(text(data), /ファイルの読み込み・受け渡し|OMNYを書き出す|サンプルに戻す|原画参照をファイル保存/);
});

test('データ管理は現在作品と生成profileのVAE cacheだけを確認付きで削除する', async () => {
  const document = sample();
  document.manga.meta.series_id = 'series-test';
  document.manga.meta.series = '現在の連載';
  const ownerId = document.manga.meta.series_id || document.manga.meta.episode_id;
  const ownerKind = document.manga.meta.series_id ? 'series' : 'one-shot';
  const empty = { root: '/cache', profiles: [], invalidEntryCount: 0 };
  const summary = { root: '/cache', invalidEntryCount: 0, profiles: [{
    profileId: 'a'.repeat(64), label: 'Krea2 test', entryCount: 1, byteSize: 524288,
    owners: [{ kind: ownerKind, id: ownerId, label: '現在の作品', entryCount: 1, byteSize: 524288,
      lastUsedAt: '2026-09-10T00:00:00Z', expiresAt: ownerKind === 'series' ? null : '2026-10-10T00:00:00Z', expired: false }],
  }] };
  const deletes = [], notices = [];
  const component = loadComponent('src/components/EnvironmentSettings.tsx', { localBridge: {
    listGenerationCaches: async () => summary,
    deleteGenerationCache: async target => { deletes.push(target); return { deleted: true, summary: empty }; },
  } });
  const props = { ...settingsProps(document), onNotify: message => notices.push(message) };
  let tree = component.render(props);
  button(tree, 'データ管理').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = component.render(props);
  let data = panel(tree, 'data');
  assert.match(text(data), /生成キャッシュ.*現在の保存容量512 KiB.*このシリーズのキャッシュを削除する削除/s);
  assert.match(text(data), /削除しても作品や参照画像は消えず.*シリーズは自動で削除されません.*読み切り.*30日後/s);
  assert.doesNotMatch(text(data), /AI生成データ|再確認/);
  const deleteButton = button(data, '削除');
  assert.equal(deleteButton.props.class, 'secondary-button is-danger');
  deleteButton.props.onClick();
  data = panel(component.render(props), 'data');
  assert.match(text(data), /本当に削除しますか？.*このシリーズの生成キャッシュ（512 KiB）を削除.*作品と参照画像は残ります/s);
  await button(data, 'はい、削除する').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(deletes)), [{ scope: 'owner', ownerKind, ownerId }]);
  assert.deepEqual(notices, ['このシリーズの生成キャッシュを削除しました']);

  tree = component.render(props);
  button(tree, 'データ管理').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  data = panel(component.render(props), 'data');
  assert.match(text(data), /現在の保存容量0 B.*このシリーズのキャッシュを削除する削除/s);
  assert.doesNotMatch(text(data), /削除できるキャッシュはありません/);
  assert.equal(button(data, '削除').props.disabled, false);
  button(data, '削除').props.onClick();
  data = panel(component.render(props), 'data');
  assert.match(text(data), /削除できるキャッシュはありません/);
  assert.equal(nodes(data).some(node => node.props?.role === 'alert'), false);
});

test('作品情報は基本情報と画風を表示し、編集後も内部形式・方向・作画データを保持する', () => {
  const document = sample();
  const before = structuredClone(document);
  const component = loadComponent('src/components/DocumentEditors.tsx');
  let changed;
  const tree = component.render({ document, onChange: value => { changed = value; } }, 'MetaEditor');
  const labels = nodes(tree).filter(node => node.type === 'Field').map(node => node.props.label);
  assert.deepEqual(labels, ['作品タイトル（シリーズ名）', 'サブタイトル', '話数', '作者名', 'ページ数', '画風プロンプト']);
  input(field(tree, 'サブタイトル')).props.onInput({ currentTarget: { value: '変更したタイトル' } });
  const expected = structuredClone(before);
  expected.manga.meta.title = '変更したタイトル';
  assert.deepEqual(changed, expected);
  assert.deepEqual(document, before);
});

test('環境設定はテキスト専用タブを廃止して7分類で1枚だけ表示する', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  const props = settingsProps();
  let changes = 0;
  props.onChangeDocument = () => { changes++; };
  let tree = component.render(props);
  const tabs = nodes(tree).filter(node => node.props?.role === 'tab');
  assert.deepEqual(tabs.map(text), ['レイアウト', '手描き・編集', '生成ルール', '作画設定（YAML）', '表示', 'モデル設定', 'データ管理']);
  for (const [index, id] of ['page', 'drawing', 'generation', 'omay', 'display', 'ai', 'data'].entries()) {
    button(tree, text(tabs[index])).props.onClick();
    tree = component.render(props);
    const selected = nodes(tree).filter(node => node.props?.role === 'tab' && node.props['aria-selected']);
    const shown = nodes(tree).filter(node => node.props?.role === 'tabpanel' && !node.props.hidden);
    assert.equal(selected.length, 1);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].props.id, `environment-panel-${id}`);
    assert.equal(shown[0].props['aria-labelledby'], selected[0].props.id);
    assert.equal(selected[0].props['aria-controls'], shown[0].props.id);
    assert.equal(selected[0].props.tabIndex, 0);
    assert.equal(nodes(tree).filter(node => node.props?.role === 'tab' && node.props.tabIndex === -1).length, 6);
  }
  assert.equal(nodes(tree).some(node => node.type === 'Field' && /読み方向|文字方向|テキスト方向/.test(node.props.label)), false);
  assert.equal(nodes(tree).some(node => node.type === 'SectionTitle' && /方向/.test(node.props.title)), false);
  assert.doesNotMatch(text(tree), /右綴じ固定|縦書き固定/);
  assert.equal(props.document.manga.meta.reading_direction, 'right-to-left');
  assert.equal(props.document.manga.meta.text_orientation, 'vertical');
  assert.equal(nodes(panel(tree, 'display')).filter(node => node.props?.type === 'checkbox').length, 3);
  assert.equal(nodes(panel(tree, 'data')).filter(node => node.props?.type === 'checkbox').length, 0);
  assert.equal(nodes(panel(tree, 'ai')).filter(node => node.props?.type === 'checkbox').length, 0);
  assert.equal(nodes(panel(tree, 'page')).filter(node => node.type === 'FinishLayoutSettings').length, 1);
  assert.equal(nodes(panel(tree, 'page')).some(node => node.type === 'ArtworkSettings'), false);
  for(const [id,section] of [['generation','rules'],['omay','omay']]){
    const artwork = find(panel(tree, id), node => node.props?.section === section);
    assert.equal(artwork.props.document, props.document);
    assert.equal(artwork.props.onNotify, props.onNotify);
  }
  assert.equal(changes, 0);
  assert.equal(component.writes.length, 0);
});

test('基本書体・出力・コマはレイアウト、生成用テキスト数値は生成ルールへ分離する', () => {
  const document = sample();
  const before = structuredClone(document);
  const calls = [];
  let changed, fontRequests=0;
  const props = {
    ...settingsProps(document),
    onChangeDocument: value => { changed=value; },
    onRequestFonts: () => { fontRequests++; },
    onChangeFrameLineWidth: value => calls.push(['frame', value]),
    onChangeRowGap: value => calls.push(['row', value]),
    onChangeColumnGap: value => calls.push(['column', value]),
    onChangePaintCursorMode: value => calls.push(['cursor', value]),
  };
  const tree = loadComponent('src/components/EnvironmentSettings.tsx').render(props);
  const page = panel(tree, 'page');
  const generationPanel = panel(tree, 'generation');
  const drawingPanel = panel(tree, 'drawing');
  const labels = tree => nodes(tree).filter(node => node.type === 'Field').map(node => node.props.label);
  assert.deepEqual(labels(page), ['作品の基本書体', 'コマ枠線幅', '上下のコマ間隔', '左右のコマ間隔']);
  assert.deepEqual(labels(drawingPanel), ['ぬりたし', '手ぶれ補正', 'ペンカーソル', '履歴の保持ステップ数']);
  assert.equal(find(drawingPanel, node => node.props?.role === 'group' && node.props?.['aria-label'] === 'ペンカーソル').type, 'div');
  button(drawingPanel, '十字').props.onClick();
  assert.equal(nodes(tree).some(node => node.props?.id === 'environment-panel-text'), false);
  assert.doesNotMatch(text(tree), /フキダシ線幅|フォントを読み込み/);
  const fontPicker=find(page,node=>node.type==='FontFamilyPicker');
  assert.equal(fontPicker.props.value,document.manga.meta.font);
  assert.deepEqual(fontPicker.props.families,props.fontFamilies);
  fontPicker.props.onOpen();
  fontPicker.props.onChange('I-OTFアンチックStd B');
  assert.equal(fontRequests,1);
  assert.equal(changed.manga.meta.font,'I-OTFアンチックStd B');
  const textSettings = find(generationPanel, node => node.type === 'FinishTextSettings');
  assert.equal(textSettings.props.document, document);
  assert.equal(textSettings.props.onChange, props.onChangeDocument);
  assert.equal(textSettings.props.onNotify, props.onNotify);
  assert.equal(nodes(page).some(node => node.type === 'FinishTextSettings'), false);
  const finishComponent = loadComponent('src/components/FinishLayoutSettings.tsx');
  const finishProps = { document, onChange: () => assert.fail('render must not mutate'), onNotify: () => {} };
  const finishTree = finishComponent.render(finishProps);
  assert.deepEqual(labels(finishTree), []);
  assert.ok(text(finishTree).includes(print.printSummary(print.getPrintSetup(document.manga))));
  button(finishTree, '変更').props.onClick();
  assert.equal(find(finishComponent.render(finishProps), node => node.type === 'default').props.lockedPageCount, document.manga.pages.length);
  assert.deepEqual(labels(finishComponent.render(finishProps, 'FinishTextSettings')), ['見出しのテキストサイズ（mm）', '作者名のテキストサイズ（mm）', '作者名の下端からの距離（mm）', '強調テキストの倍率・最小', '強調テキストの倍率・最大']);
  for (const [pane, label, value] of [[page, 'コマ枠線幅', '1.2'], [page, '上下のコマ間隔', '6'], [page, '左右のコマ間隔', '4']]) {
    input(field(pane, label)).props.onInput({ currentTarget: { value } });
  }
  assert.deepEqual(calls, [['cursor', 'crosshair'], ['frame', 1.2], ['row', 6], ['column', 4]]);
  assert.deepEqual(document, before);
});

test('印刷設定は確定だけで更新し、取消し・再表示は本文と保存を変更しない', () => {
  const component = loadComponent('src/components/FinishLayoutSettings.tsx');
  let document = sample(), changes = 0;
  const before = structuredClone(document);
  const props = () => ({ document, onChange: next => { document = next; changes++; }, onNotify() {} });
  const edit = () => {
    button(component.render(props()), '変更').props.onClick();
    return find(component.render(props()), node => node.type === 'default').props;
  };
  edit().onCancel();
  assert.deepEqual(document, before);
  assert.equal(component.writes.length, 0);
  const first = edit();
  first.onConfirm({ ...first.initial, format: 'グレースケール漫画', dpi: 450 });
  assert.equal(changes, 1);
  assert.equal(component.writes.length, 1);
  const output = finish.getOutputSettings(document.manga);
  assert.match(text(component.render(props())), new RegExp(`${output.trim_pixels.width} × ${output.trim_pixels.height} px`));
  const reopened = edit();
  assert.equal(reopened.initial.dpi, 450);
  assert.equal(reopened.initial.format, 'グレースケール漫画');
  reopened.onCancel();
  component.render(props());
  assert.equal(changes, 1);
  assert.equal(component.writes.length, 1);
  const rules = loadComponent('src/components/ArtworkSettings.tsx').render(props());
  assert.equal(nodes(rules).some(node => /完成画像の|出力解像度/.test(node.props?.['aria-label'] ?? '')), false);
});

test('左右キー・Home・Endは設定タブの選択とフォーカスを移し、作品ショートカットへ伝播しない', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  const props = settingsProps();
  for (const [key, expected] of [['ArrowRight', 'drawing'], ['ArrowRight', 'generation'], ['End', 'data'], ['ArrowRight', 'page'], ['ArrowLeft', 'data'], ['Home', 'page']]) {
    const tree = component.render(props);
    let focused, prevented = false, stopped = false;
    find(tree, node => node.props?.role === 'tablist').props.onKeyDown({
      key,
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; },
      currentTarget: { querySelector: selector => ({ focus: () => { focused = selector; } }) },
    });
    assert.equal(focused, `#environment-tab-${expected}`);
    assert.ok(prevented && stopped);
    assert.equal(panel(component.render(props), expected).props.hidden, false);
  }
  const tree = component.render(props);
  find(tree, node => node.props?.role === 'tablist').props.onKeyDown({
    key: 'ArrowRight', metaKey: true, preventDefault: () => assert.fail('do not intercept modified shortcuts'),
  });
  assert.equal(panel(component.render(props), 'page').props.hidden, false);
});

test('表示・モデルの端末設定は作品自体を書き換えない', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  const calls = [];
  const props = settingsProps();
  props.onChangeDocument = () => assert.fail('device preferences must not mutate the document');
  props.onChangeEditGuide = value => calls.push(['editGuide', value]);
  props.onChangeShowGuides = value => calls.push(['guides', value]);
  props.onChangeSpreadView = value => calls.push(['spread', value]);
  let tree = component.render(props);
  const display = nodes(panel(tree, 'display')).filter(node => node.props?.type === 'checkbox');
  display[0].props.onChange({ currentTarget: { checked: false } });
  display[1].props.onChange({ currentTarget: { checked: false } });
  display[2].props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(calls, [['editGuide', false], ['guides', false], ['spread', true]]);
  find(panel(tree, 'ai'), node => node.props?.name === 'generation-execution' && node.props.value === 'cloud').props.onChange({ currentTarget: { checked: true } });
  tree = component.render(props);
  assert.equal(nodes(panel(tree, 'ai')).filter(node => node.props?.type === 'checkbox').length, 1);
  assert.equal(component.writes.length, 1);
  assert.equal(component.writes[0][0], generation.GENERATION_PREFERENCES_STORAGE_KEY);
  assert.equal(JSON.parse(component.writes[0][1]).execution, 'cloud');
});

test('モデル欄は文章LLMと画像VLMを入力時に端末設定へ保存し、不完全な入力で既存設定を失わない', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  const document = sample();
  const before = structuredClone(document);
  const notices = [];
  const props = { ...settingsProps(document), onChangeDocument: () => assert.fail('model preferences must not mutate document'), onNotify: message => notices.push(message) };
  let ai = panel(component.render(props), 'ai');
  assert.equal(input(field(ai, '文章LLM')).props.value, localModels.DEFAULT_LOCAL_MODEL_PREFERENCES.llmAlias);
  assert.equal(input(field(ai, '画像VLM')).props.value, localModels.DEFAULT_LOCAL_MODEL_PREFERENCES.vlmModelId);
  input(field(ai, '文章LLM')).props.onInput({ currentTarget: { value: 'Qwen3.6-35B-A3B-4bit-DWQ' } });
  ai = panel(component.render(props), 'ai');
  assert.equal(component.writes.length, 1, 'no blur or save button is required');
  input(field(ai, '画像VLM')).props.onInput({ currentTarget: { value: 'local-owner/vision-model-4bit' } });
  ai = panel(component.render(props), 'ai');
  const saved = JSON.parse(component.writes.at(-1)[1]);
  assert.deepEqual(saved, { llmAlias: 'Qwen3.6-35B-A3B-4bit-DWQ', vlmModelId: 'local-owner/vision-model-4bit', comfyuiUrl: 'http://127.0.0.1:8188' });
  assert.equal(notices.length, 0, 'typing should not produce save notifications');
  input(field(ai, '画像VLM')).props.onInput({ currentTarget: { value: 'new-owner/' } });
  ai = panel(component.render(props), 'ai');
  assert.equal(input(field(ai, '画像VLM')).props.value, 'new-owner/');
  assert.equal(component.writes.length, 2);
  assert.match(text(ai), /直前の有効な設定を保持/);
  input(field(ai, '画像VLM')).props.onInput({ currentTarget: { value: 'new-owner/new-model' } });
  ai = panel(component.render(props), 'ai');
  assert.equal(JSON.parse(component.writes.at(-1)[1]).vlmModelId, 'new-owner/new-model');
  assert.doesNotMatch(text(ai), /直前の有効な設定を保持/);
  assert.deepEqual(document, before);
});

test('クラウドとローカルは選択した設定だけを表示し、各利用方法を自動保存する', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  const props = settingsProps();
  props.onChangeDocument = () => assert.fail('generation preferences are device-local');
  const choose = (name, value) => {
    find(panel(component.render(props), 'ai'), node => node.props?.name === name && node.props.value === value).props.onChange({ currentTarget: { checked: true } });
  };
  let ai = panel(component.render(props), 'ai');
  assert.equal(nodes(ai).some(node => node.props?.['aria-label'] === 'クラウドモデル設定'), false);
  assert.equal(nodes(ai).filter(node => node.props?.name === 'generation-execution' && node.props.checked).length, 1);
  choose('generation-execution', 'cloud');
  ai = panel(component.render(props), 'ai');
  assert.equal(nodes(ai).some(node => node.props?.['aria-label'] === 'ローカルモデル設定'), false);
  assert.equal(nodes(ai).some(node => node.type === 'Field' && node.props.label === '文章LLM'), false);
  assert.equal(find(ai, node => node.props?.['aria-label'] === 'クラウドエージェント').props.value, 'codex');
  choose('cloud-generation-method', 'api');
  ai = panel(component.render(props), 'ai');
  assert.equal(nodes(ai).some(node => node.props?.['aria-label'] === 'クラウドエージェント'), false);
  input(field(ai, 'API接続先')).props.onInput({ currentTarget: { value: 'https://images.example.test/v1' } });
  ai = panel(component.render(props), 'ai');
  input(field(ai, 'APIモデル')).props.onInput({ currentTarget: { value: 'image-v1' } });
  choose('generation-execution', 'local');
  ai = panel(component.render(props), 'ai');
  assert.equal(nodes(ai).some(node => node.props?.['aria-label'] === 'クラウドモデル設定'), false);
  choose('generation-execution', 'cloud');
  ai = panel(component.render(props), 'ai');
  assert.equal(input(field(ai, 'API接続先')).props.value, 'https://images.example.test/v1');
  assert.equal(input(field(ai, 'APIモデル')).props.value, 'image-v1');
  const saved = JSON.parse(component.writes.filter(([key]) => key === generation.GENERATION_PREFERENCES_STORAGE_KEY).at(-1)[1]);
  assert.equal(saved.cloud.method, 'api');
  assert.equal(saved.cloud.apiModel, 'image-v1');
  assert.equal(saved.execution, 'cloud');
  assert.equal(nodes(ai).some(node => node.type === 'button' && /保存/.test(text(node))), false);
  choose('cloud-generation-method', 'agent');
  ai = panel(component.render(props), 'ai');
  find(ai, node => node.props?.['aria-label'] === 'クラウドエージェント').props.onChange({ currentTarget: { value: 'other' } });
  ai = panel(component.render(props), 'ai');
  input(field(ai, 'エージェント名')).props.onInput({ currentTarget: { value: 'Example agent' } });
  const agent = JSON.parse(component.writes.at(-1)[1]);
  assert.equal(agent.cloud.agent, 'other');
  assert.equal(agent.cloud.agentName, 'Example agent');
  const reloaded = loadComponent('src/components/EnvironmentSettings.tsx', { initialStorage: component.writes });
  const restored = panel(reloaded.render(props), 'ai');
  assert.equal(find(restored, node => node.props?.name === 'generation-execution' && node.props.checked).props.value, 'cloud');
  assert.equal(find(restored, node => node.props?.name === 'cloud-generation-method' && node.props.checked).props.value, 'agent');
  assert.equal(input(field(restored, 'エージェント名')).props.value, 'Example agent');
  assert.equal(reloaded.writes.length, 0, 'restoring settings must not write or run a model');
  assert.ok(component.writes.every(([key]) => key === generation.GENERATION_PREFERENCES_STORAGE_KEY), 'execution and cloud details have one writer');
});

test('保存失敗は設定画面へ表示し、保存成功として通知しない', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx', { window: { localStorage: { getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); } } } });
  const props = { ...settingsProps(), onNotify: () => assert.fail('no success notification') };
  const ai = panel(component.render(props), 'ai');
  find(ai, node => node.props?.name === 'generation-execution' && node.props.value === 'cloud').props.onChange({ currentTarget: { checked: true } });
  assert.match(text(panel(component.render(props), 'ai')), /設定を保存できませんでした/);
  assert.equal(find(panel(component.render(props), 'ai'), node => node.props?.name === 'generation-execution' && node.props.checked).props.value, 'local');
});

test('成人同意は一回の保存で確定し、切替で保持、保存失敗ではUIも保持する', () => {
  const storage = new Map(); let failing = false;
  const component = loadComponent('src/components/EnvironmentSettings.tsx', { window: { localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { if (failing) throw new Error('quota'); storage.set(key, value); },
  } } });
  const props = { ...settingsProps(), onChangeDocument: () => assert.fail('device preferences are not document edits') };
  const ai = () => panel(component.render(props), 'ai');
  const execution = value => find(ai(), node => node.props?.name === 'generation-execution' && node.props.value === value).props.onChange({ currentTarget: { checked: true } });
  execution('cloud');
  find(ai(), node => node.props?.type === 'checkbox').props.onChange({ currentTarget: { checked: true } });
  execution('local'); execution('cloud');
  assert.equal(find(ai(), node => node.props?.type === 'checkbox').props.checked, true);
  assert.equal(storage.size, 1);
  failing = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    execution('local');
    assert.equal(find(ai(), node => node.props?.name === 'generation-execution' && node.props.checked).props.value, 'cloud');
    find(ai(), node => node.props?.type === 'checkbox').props.onChange({ currentTarget: { checked: false } });
    assert.equal(find(ai(), node => node.props?.type === 'checkbox').props.checked, true);
  }
  const saved = generation.loadGenerationPreferences({ getItem: key => storage.get(key) ?? null });
  assert.equal(saved.execution, 'cloud');
  assert.equal(saved.cloud.adultTermsConfirmed, true);
});

test('作画方法の旧radioは表示せず、既存モードと原本や仕上がりを保持する', () => {
  const component = loadComponent('src/components/ArtworkSettings.tsx');
  const document = sample();
  const before = structuredClone(document);
  let changed;
  const props = { document, onChange: value => { changed = value; }, onNotify: () => {} };
  const tree = component.render(props);
  assert.equal(changed, undefined);
  assert.equal(nodes(tree).some(node => node.type === 'TextListEditor' || node.type === 'textarea'), false);
  assert.equal(nodes(tree).some(node => node.props?.['aria-label'] === '削除'), false);
  assert.doesNotMatch(text(tree), /\[const\]|layout_spec|置き換え|初期設定に戻す/);
  assert.doesNotMatch(text(tree), /出力形式に合わせた仕上げ|人物の演技と背景の指示を分ける|一体型専用/);
  assert.equal(nodes(tree).filter(node => node.props?.type === 'radio').length, 0);
  assert.doesNotMatch(text(tree), /下書きを生成する|一体型で生成する/);
  assert.match(text(tree), /ページ全体・コマ・人物.*キャンバスの右クリック/);
  assert.equal(changed, undefined);
  assert.deepEqual(document, before);
});

test('無効な数値入力は既存値に戻し、本文を書き換えない', () => {
  const notifications = [];
  const component = loadComponent('src/components/FinishLayoutSettings.tsx');
  const tree = component.render({ document: sample(), onChange: () => assert.fail('invalid values must not be applied'), onNotify: message => notifications.push(message) }, 'FinishTextSettings');
  const number = input(field(tree, '見出しのテキストサイズ（mm）'));
  for (const value of ['', '-3', 'NaN', '999']) {
    const event = { currentTarget: { value } };
    number.props.onChange(event);
    assert.equal(event.currentTarget.value, '5');
  }
  assert.equal(notifications.length, 4);
});

test('用紙設定を編集画面へ反映し、下書き中も文字サイズを編集できる', () => {
  const component = loadComponent('src/components/FinishLayoutSettings.tsx');
  let document = sample();
  artwork.applyArtworkSettings(document.manga, { ...artwork.getArtworkSettings(document.manga), mode: 'draft' });
  const before = structuredClone(document);
  const props = () => ({ document, onChange: next => { document = next; }, onNotify: () => assert.fail('valid input') });
  const finishProps = () => ({ ...props(), onNotify: () => {} });
  button(component.render(finishProps()), '変更').props.onClick();
  const editor = find(component.render(finishProps()), node => node.type === 'default');
  editor.props.onConfirm({ ...print.getPrintSetup(document.manga), width_mm: 148, height_mm: 210, dpi: 600, bleed_mm: 3 });
  assert.deepEqual(clone(document.manga.finish_settings), { width_mm: 148, height_mm: 210, dpi: 600, bleed_mm: 3 });
  assert.ok(document.manga.pages.every(page => page.canvas.w === 148 && page.canvas.h === 210));
  assert.equal(document.manga.pages.length, before.manga.pages.length);
  assert.deepEqual(document.manga.meta, before.manga.meta);
  input(field(component.render(props(), 'FinishTextSettings'), '見出しのテキストサイズ（mm）')).props.onChange({ currentTarget: { value: '6.2' } });
  assert.equal(document.manga.artwork_settings.mode, 'draft');
  assert.equal(finish.getFinishLayout(document.manga).text.typography_groups[0].values.header, 6.2);
  assert.doesNotMatch(document.manga.meta.style_notes.join('\n'), /ヘッダーの文字:/);
});

test('旧draft作品でもすべての作画候補と数値を編集でき、保存済みmodeを保持する', () => {
  const component = loadComponent('src/components/ArtworkSettings.tsx');
  const document = sample();
  const settings = artwork.appendArtworkSettings(artwork.getArtworkSettings(document.manga), artwork.artworkSettingsFromSource({ style_notes: ['独自のルール'], layout_spec: '' }), '独自');
  settings.groups.at(-1).enabled = true;
  settings.mode = 'draft';
  artwork.applyArtworkSettings(document.manga, settings);
  let changed;
  const props = { document, onChange: next => { changed = next; }, onNotify: () => {} };
  const tree = component.render(props);
  const row = find(tree, node => node.type === 'label' && text(node).includes('独自：'));
  assert.match(text(row), /反映する/);
  assert.doesNotMatch(text(row), /完成原稿でのみ反映/);
  assert.equal(input(row).props.checked, true);
  assert.notEqual(input(row).props.disabled, true);
  assert.equal(changed, undefined);
  input(row).props.onChange({ currentTarget: { checked: false } });
  assert.equal(changed.manga.artwork_settings.groups.at(-1).enabled, false);
  assert.equal(changed.manga.artwork_settings.mode, 'draft');
  const nextTree = component.render({ ...props, document: changed });
  input(find(nextTree, node => node.type === 'label' && text(node).includes('独自：'))).props.onChange({ currentTarget: { checked: true } });
  assert.equal(changed.manga.artwork_settings.mode, 'draft');
  assert.ok(changed.manga.meta.style_notes.includes('独自のルール'));
  assert.doesNotMatch(changed.manga.layout_spec, /手描き仕上げ用の下書き/);
  const backgrounds = input(field(nextTree, '詳細背景の上限（コマ／ページ）'));
  backgrounds.props.onChange({ currentTarget: { value: '3' } });
  assert.equal(changed.manga.artwork_settings.mode, 'draft');
  assert.equal(input(field(component.render({ ...props, document: changed }), '詳細背景の上限（コマ／ページ）')).props.value, 3);
  assert.equal(document.manga.artwork_settings.groups.at(-1).enabled, true);
  assert.equal(document.manga.artwork_settings.mode, 'draft');
});

test('旧draft作品の生成用はintegratedで書き出し、控えと編集原本のmodeやOFF項目を保持する', async () => {
  const document = sample();
  const settings = artwork.getArtworkSettings(document.manga);
  settings.mode = 'draft';
  settings.groups.push({ id: 'export-regression', label: 'export regression', scope: 'integrated', enabled: true });
  settings.fragments.push({ groupId: 'export-regression', kind: 'style', text: 'UNIQUE_INTEGRATED_EXPORT_RULE' });
  settings.groups.push({ id: 'disabled-regression', label: 'disabled regression', scope: 'integrated', enabled: false });
  settings.fragments.push({ groupId: 'disabled-regression', kind: 'style', text: 'UNIQUE_ARCHIVE_ONLY_RULE' });
  artwork.applyArtworkSettings(document.manga, settings);
  const before = structuredClone(document), blobs = [], downloads = [];
  const component = loadComponent('src/components/ArtworkSettings.tsx', {
    URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:fixture'; }, revokeObjectURL: () => {} },
    window: { document: { createElement: () => ({ href: '', download: '', click() { downloads.push(this.download); } }) } },
  });
  const tree = component.render({ document, onChange: () => assert.fail('export must not mutate the document'), onNotify: () => {} });
  button(tree, '生成用を書き出す').props.onClick();
  button(tree, '作画設定の控えを書き出す').props.onClick();
  const generated = await blobs[0].text(), archived = await blobs[1].text();
  assert.match(generated, /generation_mode: integrated/);
  assert.match(generated, /UNIQUE_INTEGRATED_EXPORT_RULE/);
  assert.doesNotMatch(generated, /UNIQUE_ARCHIVE_ONLY_RULE|hand-drawn|draft images|手描き仕上げ用の下書き/);
  assert.match(downloads[0], /-generation\.yaml$/);
  assert.match(downloads[1], /-settings\.yaml$/);
  const restored = manga.parseOmayYaml(archived).artwork_settings;
  assert.equal(restored.mode, 'draft');
  assert.equal(restored.groups.find(group => group.id === 'disabled-regression').enabled, false);
  assert.ok(restored.fragments.some(fragment => fragment.text === 'UNIQUE_ARCHIVE_ONLY_RULE'));
  assert.deepEqual(document, before);
});

test('ファイルと標準設定はOFFの候補を追加し、現在のルール・NDM・本文を上書きしない', async () => {
  let changes = 0;
  let changed;
  const notifications = [];
  const component = loadComponent('src/components/ArtworkSettings.tsx', { confirm: () => assert.fail('nothing is being deleted') });
  const document = sample();
  const props = { document, onChange: value => { changed = value; changes++; }, onNotify: value => notifications.push(value) };
  const tree = component.render(props);
  const upload = find(tree, node => node.props?.type === 'file');
  await upload.props.onChange({ currentTarget: { files: [{ name: 'custom.omay.yaml', text: async () => 'spec_name: Open Manga Artwork YAML\nspec_version: 1\nstyle_notes: [custom]\nlayout_spec: custom-layout\n' }] } });
  assert.equal(changes, 1);
  const withoutSettings = structuredClone(changed);
  delete withoutSettings.manga.artwork_settings;
  assert.deepEqual(clone(withoutSettings), document);
  assert.equal(changed.manga.artwork_settings.groups.at(-1).enabled, false);
  assert.equal(changed.manga.artwork_settings.fragments.at(-1).text, 'custom-layout');
  assert.match(notifications.at(-1), /候補に追加しました/);
  await upload.props.onChange({ currentTarget: { files: [{ name: 'bad.yaml', text: async () => 'not a valid config' }] } });
  assert.equal(changes, 1);
  assert.match(notifications.at(-1), /読み込めませんでした/);
  button(tree, '標準設定を候補に追加').props.onClick();
  assert.equal(changed.manga.schema_version, document.manga.schema_version);
  assert.equal(changed.manga.layout_spec, document.manga.layout_spec);
  assert.deepEqual(clone(changed.manga.meta.style_notes), document.manga.meta.style_notes);
});

test('形式情報の更新はデータ管理に残り、サンプル操作は存在しない', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  const document = sample();
  document.manga.schema_version = 10.32;
  const props = settingsProps(document);
  let changed;
  props.onChangeDocument = value => { changed = value; };
  const tree = component.render(props);
  assert.doesNotMatch(text(tree), /NDM|10\.32/);
  button(panel(tree, 'data'), '形式情報を更新').props.onClick();
  const expected = structuredClone(document);
  expected.manga.schema_version = manga.CURRENT_NDM_SCHEMA_VERSION;
  assert.deepEqual(changed, expected);
  assert.doesNotMatch(text(panel(tree, 'data')), /サンプル/);
  assert.equal(document.manga.schema_version, 10.32);
});

test('環境設定は現在作品のstateへ接続され、非表示タブはCSSでも確実に隠れる', () => {
  const app = read('src/components/App.tsx');
  assert.match(app, /document=\{document\}\s+onChangeDocument=\{setDocument\}\s+onNotify=\{setToast\}/);
  assert.match(read('src/styles/global.css'), /\.environment-tab-panel\[hidden\] \{ display: none; \}/);
  assert.match(read('src/styles/global.css'), /\.environment-tabs \{[^}]*flex-wrap: wrap/);
  assert.match(app, /id: 'coverage', label: 'シナリオ'/);
  const newLayout = read('src/components/new-project/NewLayoutStep.tsx');
  assert.match(newLayout, /切り出した原画参照をすぐファイル保存/);
  assert.match(newLayout, /登場人物・背景・小道具の資料保存とは別/);
  assert.doesNotMatch(app, /sample\.yaml\?raw|サンプル漫画に戻す/);
});


test('startup settings expose general preferences without an editable placeholder project', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  const props = { ...settingsProps(), hasDocument: false };
  let tree = component.render(props);
  assert.deepEqual(nodes(tree).filter(node => node.props?.role === 'tab').map(text), ['手描き・編集', '表示', 'モデル設定', 'データ管理']);
  assert.equal(panel(tree, 'display').props.hidden, false);
  assert.equal(nodes(tree).some(node => ['ArtworkSettings', 'FinishLayoutSettings', 'FinishTextSettings'].includes(node.type)), false);
  const data = panel(tree, 'data');
  assert.equal(button(data, '保存先フォルダを変更').props.disabled, true);
  assert.equal(button(data, '構成データを書き出す').props.disabled, true);
  let focused;
  find(tree, node => node.props?.role === 'tablist').props.onKeyDown({
    key: 'Home', preventDefault() {}, stopPropagation() {},
    currentTarget: { querySelector: selector => ({ focus: () => { focused = selector; } }) },
  });
  tree = component.render(props);
  assert.equal(focused, '#environment-tab-drawing');
  assert.equal(panel(tree, 'drawing').props.hidden, false);
});

test('OMNY export is available for an opened project and disabled while busy', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  let exported = 0;
  const props = { ...settingsProps(), onExportOmny: () => exported++ };
  const data = panel(component.render(props), 'data');
  button(data, '構成データを書き出す').props.onClick(); assert.equal(exported, 1);
  assert.equal(Boolean(button(data, '構成データを書き出す').props.disabled), false);
  assert.equal(button(panel(component.render({ ...props, projectBusy: true }), 'data'), '構成データを書き出す').props.disabled, true);
});

function appHandler(name, context) {
  const ast = ts.createSourceFile('App.tsx', read('src/components/App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration);
  return runInNewContext(ts.transpileModule(`(${declaration.initializer.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
}

test('settings overlay toggles independently of the current page and commits a focused draft before closing', async () => {
  const calls = [];
  class FieldElement { blur() { calls.push('autosave on blur'); } }
  const field = new FieldElement();
  const context = {
    HTMLElement: FieldElement, environmentOpen: false,
    openingEnvironment:{current:false},projectOperation:{current:false},qwenGeneration:null,paintSessionRef:{current:null},endTextEdit(){},
    environmentPanel: { current: { contains: element => element === field } },
    window: { document: { activeElement: field, querySelector: () => ({ focus: () => calls.push('focus gear') }) } },
    setEnvironmentOpen: value => { calls.push(value ? 'open' : 'close'); context.environmentOpen = value; },
  };
  context.closeEnvironmentSettings = appHandler('closeEnvironmentSettings', context);
  context.showEnvironmentSettings = appHandler('showEnvironmentSettings', context);
  const toggle = appHandler('toggleEnvironmentSettings', context);
  await toggle(); await toggle();
  assert.deepEqual(calls, ['open', 'autosave on blur', 'close', 'focus gear']);
});

test('overlay Escape closes only settings and ignores IME composition', () => {
  let closes = 0, stopped = 0;
  const keydown = appHandler('environmentKeyDown', { environmentOpen: true, closeEnvironmentSettings: () => closes++ });
  const event = { key: 'Escape', preventDefault() {}, stopPropagation() { stopped++; } };
  keydown({ ...event, isComposing: true }); assert.equal(closes, 0);
  keydown(event); assert.equal(closes, 1); assert.equal(stopped, 1);
});

test('overlay Tab cycles between its visible controls and the header close button', () => {
  const focused = [];
  const item = (name, visible = true) => ({ tabIndex: 0, matches: () => false, getClientRects: () => visible ? [{}] : [], focus: () => focused.push(name) });
  const gear = item('gear'), first = item('first'), last = item('last'), hidden = item('hidden', false);
  const document = { activeElement: last, querySelector: () => gear };
  const keydown = appHandler('environmentKeyDown', {
    environmentOpen: true, window: { document }, environmentPanel: { current: { querySelectorAll: () => [first, last, hidden] } },
  });
  const event = { key: 'Tab', preventDefault() {} };
  keydown(event); document.activeElement = gear; keydown({ ...event, shiftKey: true });
  assert.deepEqual(focused, ['gear', 'last']);
});

test('header switches the settings gear to a close icon and blocks background actions', () => {
  const component = loadComponent('src/components/Header.tsx');
  const props = { hasDocument: true, canUndo: true, canRedo: true, busy: false, workspaceBlocked: false, settingsOpen: false };
  let tree = component.render(props);
  const gear = find(tree, node => node.props?.['data-environment-settings'] !== undefined);
  assert.equal(gear.props['aria-label'], '環境設定');
  assert.equal(gear.props.children.type, 'Settings');
  tree = component.render({ ...props, settingsOpen: true, workspaceBlocked: true });
  const close = find(tree, node => node.props?.['data-environment-settings'] !== undefined);
  assert.equal(close.props['aria-label'], '環境設定を閉じる');
  assert.equal(close.props['aria-expanded'], true);
  assert.equal(close.props.children.type, 'X');
  assert.equal(close.props.disabled, false);
  assert.ok(nodes(tree).filter(node => node.type === 'button' && node !== close).every(node => node.props.disabled));
});


test('opening settings pauses ink without materializing it and preserves errors',async()=>{
  for(const fail of [false,true]){
    const calls=[];
    const context={Error,environmentOpen:false,openingEnvironment:{current:false},projectOperation:{current:false},qwenGeneration:null,
      paintSessionRef:{current:{document:{}}},paintController:{current:{pause:async()=>{calls.push('pause');if(fail)throw Error('描画確定失敗');}}},
      endTextEdit:()=>calls.push('end-text'),setEnvironmentOpen:()=>{assert.ok(context.paintSessionRef.current);calls.push('open');},setToast:value=>calls.push(value)};
    context.showEnvironmentSettings=appHandler('showEnvironmentSettings',context);
    await appHandler('toggleEnvironmentSettings',context)();
    assert.deepEqual(calls,fail?['pause','描画確定失敗']:['pause','end-text','open']);
    assert.equal(context.openingEnvironment.current,false);
  }
});

test('document settings await paint once, ignore repeated tab requests and retain the tab on failure',async()=>{
  const component=loadComponent('src/components/EnvironmentSettings.tsx');
  let release,fail=false,calls=0;
  const notices=[];
  const props={...settingsProps(),initialTab:'drawing',onNotify:value=>notices.push(value),prepareDocumentSettings:async()=>{calls++;await new Promise(resolve=>{release=resolve;});if(fail)throw Error('ink failure');}};
  let tree=component.render(props);
  assert.equal(panel(tree,'drawing').props.hidden,false);
  await button(tree,'表示').props.onClick();assert.equal(calls,0);
  tree=component.render(props);
  const pending=button(tree,'レイアウト').props.onClick();
  tree=component.render(props);
  assert.equal(panel(tree,'display').props.hidden,false);
  assert.equal(button(tree,'レイアウト').props['aria-disabled'],true);
  await button(tree,'生成ルール').props.onClick();assert.equal(calls,1);
  release();await pending;
  tree=component.render(props);assert.equal(panel(tree,'page').props.hidden,false);
  fail=true;
  const failed=button(tree,'生成ルール').props.onClick();release();await failed;
  tree=component.render(props);assert.equal(panel(tree,'page').props.hidden,false);assert.deepEqual(notices,['ink failure']);
  fail=false;
  const retried=button(tree,'生成ルール').props.onClick();release();await retried;
  assert.equal(panel(component.render(props),'generation').props.hidden,false);
});
