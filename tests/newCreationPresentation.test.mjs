import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const elements = [];
function visit(node) {
  if (ts.isJsxElement(node)) elements.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
const attr = (node, name) => node.openingElement.attributes.properties.find(p => p.name?.getText(ast) === name)?.initializer?.text;
const topics = elements.filter(node => attr(node, 'class') === 'new-creation-topic');

test('新規作成はシリーズとエピソードの二つの話題へまとめる', () => {
  assert.deepEqual(topics.map(node => attr(node, 'aria-labelledby')), ['new-series-topic-title', 'new-episode-topic-title']);
  assert.match(topics[0].getText(ast), /シリーズ名/);
  assert.match(topics[0].getText(ast), /シリーズの設定資料/);
  assert.match(topics[1].getText(ast), /今回のエピソード資料/);
  for (const topic of topics) {
    assert.doesNotMatch(topic.getText(ast), /new-workspace-picker|new-reference-suggestions|未反映|まだ反映|資料の候補/);
  }
});

test('エピソード資料欄は保存先フォルダの選択後に表示する', () => {
  for (const [label, prerequisite] of [['シリーズの設定資料', 'newSeriesDirectory'], ['今回のエピソード資料', 'newEpisodeWorkspace']]) {
    const element = elements.find(node => attr(node, 'aria-label') === label);
    assert.ok(element);
    assert.ok(ts.isBinaryExpression(element.parent));
    assert.equal(element.parent.left.getText(ast), prerequisite === 'newEpisodeWorkspace' ? prerequisite : `(isLanClient || ${prerequisite})`);
    assert.equal(element.parent.operatorToken.kind, ts.SyntaxKind.AmpersandAmpersandToken);
  }
});

test('反映操作は資料の後ろに置き、次へから呼ばない', () => {
  const actions = elements.filter(node => attr(node, 'class')?.startsWith('new-creation-reference-actions'));
  assert.equal(actions.length, 2);
  assert.match(actions[0].getText(ast), /onClick=\{applySelectedNewSeriesReferences\}/);
  assert.match(actions[1].getText(ast), /applySuggestedReferenceTexts/);
  const continuation = source.slice(source.indexOf('const continueFromSeriesSelection ='), source.indexOf('const continueFromSeriesSelection =') + 5500);
  assert.doesNotMatch(continuation, /applySelectedNewSeriesReferences\(|applySuggestedReferenceTexts\(/);
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  assert.match(css, /\.new-creation-reference-actions\s*\{[^}]*justify-content: flex-end/);
  assert.doesNotMatch(css, /\.new-creation-reference-actions > \.primary-button\s*\{[^}]*margin-left: auto/);
});

test('上部の次へは対応するフォームを送信し、入力欄の制約検証を通る', () => {
  const navigation = elements.find(node => attr(node, 'aria-label') === '作成手順の移動');
  assert.ok(navigation);
  const submits = elements.filter(node => node.pos > navigation.pos && node.end < navigation.end
    && attr(node, 'type') === 'submit' && node.getText(ast).includes('次へ'));
  assert.equal(submits.length, 2);
  for (const submit of submits) {
    const form = elements.find(node => node.openingElement.tagName.getText(ast) === 'form'
      && attr(node, 'id') === attr(submit, 'form'));
    assert.ok(form, `missing form: ${attr(submit, 'form')}`);
    assert.ok(form.openingElement.attributes.properties.some(p => p.name?.getText(ast) === 'onSubmit'));
    assert.ok(!form.openingElement.attributes.properties.some(p => p.name?.getText(ast) === 'noValidate'));
    assert.ok(!submit.openingElement.attributes.properties.some(p => ['onClick', 'formNoValidate'].includes(p.name?.getText(ast))));
    assert.match(submit.getText(ast), /次へ/);
  }
});

test('フォルダ名を作品名へ流用せず、世界観の長文より読み込み結果を表示する', () => {
  const chooser = source.slice(source.indexOf('const chooseNewSeriesDirectory ='), source.indexOf('const chooseNewSeriesReferenceTextFile ='));
  assert.doesNotMatch(chooser, /setNewSeriesName\(/);
  assert.doesNotMatch(topics[0].getText(ast), /seriesSettingSummary|new-creation-summary/);
  assert.match(topics[0].getText(ast), /newSeriesReferenceMessage/);
  assert.match(topics[1].getText(ast), /newReferenceMessage/);
  assert.match(topics[0].getText(ast), /isLanClient && newSeriesMode === 'new' && <label[^>]*><span>シリーズ名<\/span><input value=\{newSeriesName\}/);
  assert.match(source, /シリーズ名を含む資料（例：シリーズ名：作品名）を反映してください。/);
});

test('両見出しは名前がある時だけ中央にかぎ括弧付きで表示する', () => {
  for (const [id, value] of [['new-series-topic-title', 'newSeriesName'], ['new-episode-topic-title', 'newWorkTitle']]) {
    const heading = elements.find(node => attr(node, 'id') === id);
    assert.ok(heading.getText(ast).includes(`${value}.trim() && <span class="new-creation-topic-name">`));
    assert.ok(heading.getText(ast).includes('「　${' + value + '.trim()}　」'));
  }
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  assert.match(css, /\.new-creation-topic h4\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 2fr\) minmax\(0, 1fr\)/);
  assert.match(css, /\.new-creation-topic-name\s*\{[^}]*text-align: center;[^}]*overflow-wrap: anywhere/);
});

test('エピソードの読み込み通知も原稿ファイル名の列へ揃える', () => {
  const message = elements.find(node => node.getText(ast).includes('{newReferenceMessage}') && attr(node, 'role') === 'status');
  assert.equal(attr(message, 'class'), 'new-reference-message is-file-aligned');
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  assert.match(css, /\.new-reference-message.is-file-aligned \{ margin-inline: 0;/);
});

test('シリーズ資料の反映結果は追加ボタンと同じ行の左側に置き、狭幅では折り返す', () => {
  const actions = elements.find(node => attr(node, 'class') === 'new-creation-reference-actions');
  const message = elements.find(node => attr(node, 'role') === 'status'
    && node.getText(ast).includes('{newSeriesReferenceMessage}'));
  let parent = message.parent;
  while (!ts.isJsxElement(parent)) parent = parent.parent;
  assert.equal(parent, actions);
  assert.ok(actions.getText(ast).indexOf('{newSeriesReferenceMessage}') < actions.getText(ast).indexOf('<button'));
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  assert.match(css, /\.new-creation-reference-actions\s*\{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.new-creation-reference-actions > \.new-reference-message\s*\{[^}]*flex: 1 1 240px;[^}]*min-width: 0;[^}]*margin: 0;[^}]*overflow-wrap: anywhere/);
});

test('シリーズ選択画面の操作ボタンにはラベルと装飾アイコンを併記する', () => {
  const form = elements.find(node => attr(node, 'class') === 'new-series-step');
  const buttons = elements.filter(node => node.openingElement.tagName.getText(ast) === 'button'
    && node.pos >= form.pos && node.end <= form.end);
  assert.ok(buttons.length >= 10);
  for (const button of buttons) {
    assert.ok(button.children.some(child => ts.isJsxSelfClosingElement(child)
      && ['FilePlus2', 'Files', 'FileText', 'FolderOpen', 'ClipboardCheck', 'ChevronRight', 'Trash2'].includes(child.tagName.getText(ast))
      && child.attributes.properties.some(p => p.name?.getText(ast) === 'aria-hidden' && p.initializer?.text === 'true')), button.getText(ast));
  }
});

test('フォルダ案内と選択ボタンを指定の簡潔な文言で表示する', () => {
  for (const topic of topics) {
    assert.match(topic.getText(ast), /<strong>保存先<\/strong>/);
    assert.match(topic.getText(ast), /フォルダを選択してください。/);
    assert.doesNotMatch(topic.getText(ast), /保存先を選択してください|<strong>フォルダ<\/strong>/);
    assert.doesNotMatch(topic.getText(ast), /選んで始めます|新規作成・選択/);
  }
});

test('二枠の見出しと操作ボタンは黒文字のセージ・サンド配色で輪郭を持つ', () => {
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  const heading = css.match(/\.new-creation-topic h4\s*\{([^}]+)\}/)[1];
  assert.match(heading, /background: var\(--accent-fill\)/);
  assert.match(heading, /color: var\(--ink\)/);
  assert.match(heading, /font-weight: 800/);
  const button = css.match(/\.new-creation-change\s*\{([^}]+)\}/)[1];
  assert.match(button, /border: 1\.5px solid var\(--control-border\)/);
  assert.match(button, /background: var\(--control\)/);
  assert.match(button, /color: var\(--ink\)/);
  const primary = css.match(/\n\.primary-button\s*\{([^}]+)\}/)[1];
  assert.match(primary, /border: 1\.5px solid var\(--accent\)/);
  assert.match(primary, /color: var\(--ink\)/);
  assert.match(primary, /box-shadow: none/);
});

test('C配色は文字4.5:1以上、操作枠3:1以上の明暗差を持つ', () => {
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  const palette = css.match(/:root\s*\{([^}]+)\}/)[1];
  const color = name => palette.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))[1];
  assert.equal(color('accent-fill'), '#dce9df');
  assert.equal(color('control'), '#f1e2cf');
  assert.equal(color('ink'), '#242424');
  // WCAG 2.2 relative luminance, evaluated before rounding.
  const luminance = hex => {
    const [r, g, b] = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  for (const background of ['accent-fill', 'accent-fill-hover', 'accent-soft', 'control', 'control-hover', 'neutral-soft', 'surface', 'canvas']) {
    assert.ok(contrast(color('ink'), color(background)) >= 4.5, `ink on ${background}`);
  }
  for (const text of ['muted', 'accent', 'accent-dark']) {
    assert.ok(contrast(color(text), color('surface')) >= 4.5, `${text} on surface`);
    assert.ok(contrast(color(text), '#ffffff') >= 4.5, `${text} on white`);
  }
  for (const [border, backgrounds] of [
    ['accent', ['accent-fill', 'accent-fill-hover', 'accent-soft', 'surface']],
    ['control-border', ['control', 'control-hover', 'surface']],
  ]) {
    for (const background of backgrounds) assert.ok(contrast(color(border), color(background)) >= 3, `${border} on ${background}`);
  }
  assert.ok(contrast('#ffffff', color('accent')) >= 4.5, 'white step number on dark sage');
  assert.ok(contrast(color('muted'), color('neutral-soft')) >= 4.5, 'inactive step number');
});
