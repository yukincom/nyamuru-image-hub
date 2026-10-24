import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as jsxRuntime from 'preact/jsx-runtime';
import ts from 'typescript';
import * as manga from '../src/lib/manga.ts';
import * as privacy from '../src/lib/modelPrivacy.ts';
import * as localModels from '../src/lib/localModelPreferences.ts';
import * as artwork from '../src/lib/artworkRules.ts';
import * as finish from '../src/lib/finishLayout.ts';
import * as print from '../src/lib/printSettings.ts';
import * as artworkEnglish from '../src/lib/artworkEnglish.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sample = () => manga.parseMangaYaml(read('src/content/sample.omny.yaml'));

// 実際のTSXを固定したhook状態で検証し、利用者の保存データは使わない。
function loadComponent(file, globals = {}) {
  let cursor = 0;
  const state = [];
  const stub = new Proxy({}, { get: (_, key) => key === '__esModule' ? true : String(key) });
  const storage = new Map();
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
      useRef: initial => ({ current: initial }),
    },
    '../lib/manga': manga,
    '../lib/paintWorkspace': { usePaintWorkspace: () => null },
    '../lib/clientRuntime': { isLanClient: globals.isLanClient ?? false },
    '../lib/artworkRules': artwork,
    '../lib/finishLayout': finish,
    '../lib/printSettings': print,
    '../lib/artworkEnglish': artworkEnglish,
    '../lib/modelPrivacy': privacy,
    '../lib/localModelPreferences': localModels,
    '../lib/localBridge': globals.localBridge ?? stub,
    '../lib/bubbleFonts': { BUBBLE_FONT_PRESETS: ['アンチック体'] },
    '../content/standard.omay.yaml?raw': { __esModule: true, default: read('src/content/standard.omay.yaml') },
  };
  const compiled = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'preact',
  } }).outputText;
  runInNewContext(compiled, {
    exports, require: name => imports[name] ?? imports[name.replace(/\.ts$/u, '')] ?? stub,
    structuredClone, window, Blob, URL, confirm: () => true, ...globals,
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
    defaultFont: document.manga.meta.font, bubbleLineWidthMm: 0.3, frameLineWidthMm: 0.6, rowGapMm: 5, columnGapMm: 3,
    onChangeShowGuides: () => {}, onChangeSpreadView: () => {},
    onChangeDefaultFont: () => {}, onChangeBubbleLineWidth: () => {}, onChangeFrameLineWidth: () => {},
    onChangeRowGap: () => {}, onChangeColumnGap: () => {},
  };
}

test('データ管理は作品フォルダとOMNY書き出しを扱う', () => {
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

test('環境設定は6分類で1枚だけ表示し、各設定の対象と既存操作を保持する', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  const props = settingsProps();
  let changes = 0;
  props.onChangeDocument = () => { changes++; };
  let tree = component.render(props);
  const tabs = nodes(tree).filter(node => node.props?.role === 'tab');
  assert.deepEqual(tabs.map(text), ['レイアウト', 'テキスト', '作画方法', '表示', 'モデル設定', 'データ管理']);
  for (const [index, id] of ['page', 'text', 'artwork', 'display', 'ai', 'data'].entries()) {
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
    assert.equal(nodes(tree).filter(node => node.props?.role === 'tab' && node.props.tabIndex === -1).length, 5);
  }
  assert.equal(nodes(tree).some(node => node.type === 'Field' && /読み方向|文字方向|テキスト方向/.test(node.props.label)), false);
  assert.equal(nodes(tree).some(node => node.type === 'SectionTitle' && /方向/.test(node.props.title)), false);
  assert.doesNotMatch(text(tree), /右綴じ固定|縦書き固定/);
  assert.equal(props.document.manga.meta.reading_direction, 'right-to-left');
  assert.equal(props.document.manga.meta.text_orientation, 'vertical');
  assert.equal(nodes(panel(tree, 'display')).filter(node => node.props?.type === 'checkbox').length, 3);
  assert.equal(nodes(panel(tree, 'data')).filter(node => node.props?.type === 'checkbox').length, 0);
  assert.equal(nodes(panel(tree, 'ai')).filter(node => node.props?.type === 'checkbox').length, 1);
  const artwork = find(panel(tree, 'artwork'), node => node.props?.onChange === props.onChangeDocument);
  assert.equal(artwork.props.document, props.document);
  assert.equal(artwork.props.onNotify, props.onNotify);
  assert.equal(changes, 0);
  assert.equal(component.writes.length, 0);
});

test('用紙とコマはレイアウト、書体と全テキスト数値はテキストへ分離し既存の反映先を保つ', () => {
  const document = sample();
  const before = structuredClone(document);
  const calls = [];
  const props = {
    ...settingsProps(document),
    onChangeDefaultFont: value => calls.push(['font', value]),
    onChangeBubbleLineWidth: value => calls.push(['bubble', value]),
    onChangeFrameLineWidth: value => calls.push(['frame', value]),
    onChangeRowGap: value => calls.push(['row', value]),
    onChangeColumnGap: value => calls.push(['column', value]),
  };
  const tree = loadComponent('src/components/EnvironmentSettings.tsx').render(props);
  const page = panel(tree, 'page');
  const textPanel = panel(tree, 'text');
  const labels = tree => nodes(tree).filter(node => node.type === 'Field').map(node => node.props.label);
  assert.deepEqual(labels(page), ['コマ枠線幅', '上下のコマ間隔', '左右のコマ間隔']);
  assert.deepEqual(labels(textPanel), ['フキダシ線幅', '作品の基本書体']);
  const textSettings = find(textPanel, node => node.type === 'FinishTextSettings');
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
  for (const [pane, label, value] of [[textPanel, '作品の基本書体', '明朝体'], [textPanel, 'フキダシ線幅', '0.7'], [page, 'コマ枠線幅', '1.2'], [page, '上下のコマ間隔', '6'], [page, '左右のコマ間隔', '4']]) {
    input(field(pane, label)).props.onInput({ currentTarget: { value } });
  }
  assert.deepEqual(calls, [['font', '明朝体'], ['bubble', 0.7], ['frame', 1.2], ['row', 6], ['column', 4]]);
  assert.deepEqual(document, before);
});

test('左右キー・Home・Endは設定タブの選択とフォーカスを移し、作品ショートカットへ伝播しない', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  const props = settingsProps();
  for (const [key, expected] of [['ArrowRight', 'text'], ['ArrowRight', 'artwork'], ['End', 'data'], ['ArrowRight', 'page'], ['ArrowLeft', 'data'], ['Home', 'page']]) {
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
  find(panel(tree, 'ai'), node => node.props?.type === 'checkbox').props.onChange({ currentTarget: { checked: true } });
  tree = component.render(props);
  assert.equal(nodes(panel(tree, 'ai')).filter(node => node.props?.type === 'checkbox').length, 2);
  assert.equal(component.writes.length, 1);
  assert.equal(JSON.parse(component.writes[0][1]).enabled, true);
});

test('モデル欄は文章LLMと画像VLMを別々の端末設定として保存する', () => {
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
  input(field(ai, '文章LLM')).props.onBlur();
  ai = panel(component.render(props), 'ai');
  input(field(ai, '画像VLM')).props.onInput({ currentTarget: { value: 'local-owner/vision-model-4bit' } });
  ai = panel(component.render(props), 'ai');
  input(field(ai, '画像VLM')).props.onBlur();
  const saved = JSON.parse(component.writes.at(-1)[1]);
  assert.deepEqual(saved, { llmAlias: 'Qwen3.6-35B-A3B-4bit-DWQ', vlmModelId: 'local-owner/vision-model-4bit', comfyuiUrl: '' });
  assert.equal(notices.filter(message => /保存しました/.test(message)).length, 2);
  assert.deepEqual(document, before);
});

test('作画方法は二択のradioで、内部ルールは非表示、モード変更で原本や仕上がりを失わない', () => {
  const component = loadComponent('src/components/ArtworkSettings.tsx');
  const document = sample();
  const before = structuredClone(document);
  let changed;
  const props = { document, onChange: value => { changed = value; }, onNotify: () => {} };
  let tree = component.render(props);
  assert.equal(changed, undefined);
  assert.equal(nodes(tree).some(node => node.type === 'TextListEditor' || node.type === 'textarea'), false);
  assert.equal(nodes(tree).some(node => node.props?.['aria-label'] === '削除'), false);
  assert.doesNotMatch(text(tree), /\[const\]|layout_spec|置き換え|初期設定に戻す/);
  assert.doesNotMatch(text(tree), /出力形式に合わせた仕上げ|人物の演技と背景の指示を分ける|一体型専用/);
  const radios = nodes(tree).filter(node => node.props?.type === 'radio');
  assert.deepEqual(radios.map(node => [node.props.name, node.props.value, node.props.checked]), [['artwork-generation-mode', 'integrated', true], ['artwork-generation-mode', 'draft', false]]);
  const originalSettings = artwork.getArtworkSettings(document.manga);
  radios[1].props.onChange({ currentTarget: { checked: true } });
  tree = component.render({ ...props, document: changed });
  assert.equal(changed.manga.artwork_settings.mode, 'draft');
  assert.deepEqual(changed.manga.artwork_settings.fragments, originalSettings.fragments);
  assert.deepEqual(changed.manga.artwork_settings.groups, originalSettings.groups);
  assert.equal(nodes(tree).some(node => node.type === 'Field' && node.props.label === '詳細背景の上限（コマ／ページ）'), false);
  const textTree = loadComponent('src/components/FinishLayoutSettings.tsx').render({ ...props, document: changed }, 'FinishTextSettings');
  assert.equal(input(field(textTree, '見出しのテキストサイズ（mm）')).props.value, 5);
  assert.notEqual(input(field(textTree, '見出しのテキストサイズ（mm）')).props.disabled, true);
  nodes(tree).find(node => node.props?.type === 'radio' && node.props.value === 'integrated').props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(changed.manga.meta.style_notes, before.manga.meta.style_notes);
  assert.equal(changed.manga.layout_spec, before.manga.layout_spec);
  const strip = doc => {
    const copy = structuredClone(doc);
    delete copy.manga.artwork_settings;
    delete copy.manga.meta.style_notes;
    delete copy.manga.layout_spec;
    return copy;
  };
  assert.deepEqual(strip(changed), strip(before));
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
  editor.props.onConfirm({ ...print.getPrintSetup(document.manga), width_mm: 148, height_mm: 210, bleed_mm: 3 });
  const artworkComponent = loadComponent('src/components/ArtworkSettings.tsx');
  find(field(artworkComponent.render(props()), '出力解像度'), node => node.type === 'select').props.onChange({ currentTarget: { value: '600' } });
  assert.deepEqual(clone(document.manga.finish_settings), { width_mm: 148, height_mm: 210, dpi: 600, bleed_mm: 3 });
  assert.ok(document.manga.pages.every(page => page.canvas.w === 148 && page.canvas.h === 210));
  assert.equal(document.manga.pages.length, before.manga.pages.length);
  assert.deepEqual(document.manga.meta, before.manga.meta);
  input(field(component.render(props(), 'FinishTextSettings'), '見出しのテキストサイズ（mm）')).props.onChange({ currentTarget: { value: '6.2' } });
  assert.equal(document.manga.artwork_settings.mode, 'draft');
  assert.equal(finish.getFinishLayout(document.manga).text.typography_groups[0].values.header, 6.2);
  assert.doesNotMatch(document.manga.meta.style_notes.join('\n'), /ヘッダーの文字:/);
  const invalid = artworkComponent.render({ document, onChange: () => assert.fail('invalid input'), onNotify: () => {} });
  const event = { currentTarget: { value: '0' } };
  find(field(invalid, '出力解像度'), node => node.type === 'select').props.onChange(event);
  assert.equal(event.currentTarget.value, '600');
});

test('完成原稿専用の追加候補は下書き中の反映を装わず、チェック状態を保持する', () => {
  const component = loadComponent('src/components/ArtworkSettings.tsx');
  const document = sample();
  const settings = artwork.appendArtworkSettings(artwork.getArtworkSettings(document.manga), artwork.artworkSettingsFromSource({ style_notes: ['独自のルール'], layout_spec: '' }), '独自');
  settings.groups.at(-1).enabled = true;
  settings.mode = 'draft';
  artwork.applyArtworkSettings(document.manga, settings);
  let changed;
  const tree = component.render({ document, onChange: next => { changed = next; }, onNotify: () => {} });
  const row = find(tree, node => node.type === 'label' && text(node).includes('独自：'));
  assert.match(text(row), /完成原稿でのみ反映/);
  assert.equal(input(row).props.checked, true);
  assert.equal(input(row).props.disabled, true);
  nodes(tree).find(node => node.props?.type === 'radio' && node.props.value === 'integrated').props.onChange({ currentTarget: { checked: true } });
  assert.ok(changed.manga.meta.style_notes.includes('独自のルール'));
  assert.equal(changed.manga.artwork_settings.groups.at(-1).enabled, true);
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
  assert.match(app, /<EnvironmentSettings\s+document=\{document\}\s+onChangeDocument=\{setDocument\}\s+onNotify=\{setToast\}/);
  assert.match(read('src/styles/global.css'), /\.environment-tab-panel\[hidden\] \{ display: none; \}/);
  assert.match(read('src/styles/global.css'), /\.environment-tabs \{[^}]*flex-wrap: wrap/);
  assert.match(app, /id: 'coverage', label: 'シナリオ'/);
  assert.match(app, /切り出した原画参照をすぐファイル保存/);
  assert.match(app, /登場人物・背景・小道具の資料保存とは別/);
  assert.doesNotMatch(app, /sample\.omny\.yaml\?raw|サンプル漫画に戻す/);
});


test('startup settings expose general preferences without an editable placeholder project', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  const props = { ...settingsProps(), hasDocument: false };
  let tree = component.render(props);
  assert.deepEqual(nodes(tree).filter(node => node.props?.role === 'tab').map(text), ['作画方法', '表示', 'モデル設定', 'データ管理']);
  assert.equal(panel(tree, 'display').props.hidden, false);
  assert.equal(nodes(tree).some(node => ['ArtworkSettings', 'FinishLayoutSettings', 'FinishTextSettings'].includes(node.type)), false);
  const data = panel(tree, 'data');
  assert.equal(button(data, '保存先フォルダを変更').props.disabled, true);
  assert.equal(button(data, 'OMNY書き出し').props.disabled, true);
  let focused;
  find(tree, node => node.props?.role === 'tablist').props.onKeyDown({
    key: 'Home', preventDefault() {}, stopPropagation() {},
    currentTarget: { querySelector: selector => ({ focus: () => { focused = selector; } }) },
  });
  tree = component.render(props);
  assert.equal(focused, '#environment-tab-artwork');
  assert.equal(panel(tree, 'artwork').props.hidden, false);
});

test('OMNY export is available for an opened project and disabled while busy', () => {
  const component = loadComponent('src/components/EnvironmentSettings.tsx');
  let exported = 0;
  const props = { ...settingsProps(), onExportOmny: () => exported++ };
  const data = panel(component.render(props), 'data');
  button(data, 'OMNY書き出し').props.onClick(); assert.equal(exported, 1);
  assert.equal(Boolean(button(data, 'OMNY書き出し').props.disabled), false);
  assert.equal(button(panel(component.render({ ...props, projectBusy: true }), 'data'), 'OMNY書き出し').props.disabled, true);
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


test('opening settings flushes the existing paint session before document settings can mutate it',async()=>{
  for(const fail of [false,true]){
    const calls=[];
    const context={Error,environmentOpen:false,openingEnvironment:{current:false},projectOperation:{current:false},qwenGeneration:null,
      paintSessionRef:{current:{document:{}}},paintController:{current:{close:async()=>{calls.push('flush-and-close');if(fail)throw Error('描画確定失敗');context.paintSessionRef.current=null;}}},
      endTextEdit:()=>calls.push('end-text'),setEnvironmentOpen:()=>{assert.equal(context.paintSessionRef.current,null);calls.push('open');},setToast:value=>calls.push(value)};
    await appHandler('toggleEnvironmentSettings',context)();
    assert.deepEqual(calls,fail?['flush-and-close','描画確定失敗']:['flush-and-close','end-text','open']);
    assert.equal(context.openingEnvironment.current,false);
  }
});
