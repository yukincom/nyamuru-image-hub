import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const archive = 'archive/legacy-howto-2026-09-05/';
const read = path => readFileSync(new URL(path, root), 'utf8');
const app = read('src/components/App.tsx');

test('初回案内と旧使い方タブを現行UIから外し、新規作成・フォルダ読込・環境設定を表示する', () => {
  assert.doesNotMatch(app, /showHowtoIntro|HOWTO_INTRO_KEY|HowToGuide|mangaViewerPage|SAMPLE_MANGA_PAGES|id: 'howto'/);
  assert.doesNotMatch(read('src/types.ts'), /'howto'/);
  assert.doesNotMatch(app, /from ['"][^'"]*archive\//);
  assert.match(app, /aria-label="起動メニュー"/);
  assert.match(app, /onClick=\{openNewDialog\}><FilePlus2 size=\{19\} \/>新規作成/);
  assert.match(app, /onClick=\{openProject\}><FolderOpen size=\{19\} \/>作品フォルダを開く/);
  assert.match(app, /<Header onSettings=\{toggleEnvironmentSettings\}/);
  assert.match(read('src/components/Header.tsx'), /data-environment-settings[^\n]*環境設定を閉じる/);
  assert.doesNotMatch(app, /id: 'environment', label: '環境設定'/);
  assert.doesNotMatch(app, /作品ファイルを開く|OMNYファイルを読み込む|AI処理はMac Studioで行います/);
  assert.equal(existsSync(new URL('src/content/how-to-guide.md', root)), false);
  assert.equal(existsSync(new URL('src/components/HowToGuide.tsx', root)), false);
});

test('旧使い方へのURLは空画面にせず通常のネームタブへ戻り、現行タブは維持する', () => {
  const ast = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'initialTab');
  const tabsDeclaration = ast.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(ast) === 'TABS');
  const tabs = tabsDeclaration.initializer.elements.map(element => ({ id: element.properties.find(property => property.name.getText(ast) === 'id').initializer.text }));
  const js = ts.transpileModule(declaration.getText(ast) + '\ninitialTab();', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [requested, expected] of [['howto', 'storyboard'], ['', 'storyboard'], ['materials', 'props'], ['environment', 'storyboard'], ['characters', 'characters']]) {
    assert.equal(runInNewContext(js, { TABS: tabs, URLSearchParams, window: { location: { search: `?tab=${requested}` } } }), expected);
  }
});

test('旧本文・表示コード・画像は移動前と同一のバイト列を保管している', () => {
  const expected = {
    'how-to-guide.md': '09a4fbf76605594b5a9cbccd17de24588ce6b6da66a59b4d5a409666d576515a',
    'HowToGuide.tsx.txt': '4dcb6e4d49525ada500830707c944cb0112ec6eff4cdefc1c2c7c32fb2ed3b6f',
    'nyamurutan-manga-p1.webp': '63d70eb5d1aff34ea2a82a7428a3127164201fb4b0a55f70c00c0ed234d10eed',
    'nyamurutan-manga-p2.webp': '6bd9fa71a2c793a6b4d6122b36210ca7ecb17f8d92e130f32d5fd7191d268cbb',
  };
  for (const [file, digest] of Object.entries(expected)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(archive + file, root))).digest('hex'), digest, file);
  }
  for (const page of [1, 2]) {
    assert.ok(existsSync(new URL(`src/assets/nyamurutan-manga-p${page}.webp`, root)));
  }
  assert.match(read('src/components/NyamurutanGuide.tsx'), /sampleMangaPages/);
});

test('旧版表示のJSXとCSSを保管し、現行から分離した説明と参照先を用意する', () => {
  assert.match(read(archive + 'startup-intro.tsx.txt'), /使い方を見てみる？/);
  assert.match(read(archive + 'startup-intro.tsx.txt'), /class="manga-viewer"/);
  assert.match(read(archive + 'styles.css'), /@media \(max-width: 800px\)/);
  assert.doesNotMatch(read('src/styles/global.css'), /\.howto-intro|\.manga-viewer/);
  const readme = read(archive + 'README.md');
  assert.match(readme, /現在のニャムルの操作手順ではありません/);
  assert.match(readme, /CC BY 4.0/);
  for (const [, path] of readme.matchAll(/\]\(([^)]+)\)/g)) {
    assert.ok(existsSync(new URL(path, new URL(archive + 'README.md', root))), path);
  }
  assert.match(read('docs/USAGE.md'), /旧版の使い方案内.*archive\/legacy-howto-2026-09-05\/README.md/);
});
