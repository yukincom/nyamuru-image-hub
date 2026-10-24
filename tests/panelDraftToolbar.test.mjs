import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const inspector = read('../src/components/PanelInspector.tsx');
const app = read('../src/components/App.tsx');
const css = read('../src/styles/global.css');
const ast = ts.createSourceFile('PanelInspector.tsx', inspector, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let portal, open;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'createPortal'
    && node.arguments[1]?.getText(ast) === 'panelDraftToolbarTarget') portal = node.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'openPanelDraftDialog') open = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
function evaluate(expression, context) {
  const code = ts.transpileModule(`(${expression})`, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h',
  }, fileName: 'test.tsx' }).outputText;
  return runInNewContext(code, context);
}

test('generation entry portals to the toolbar with the current panel and opens confirmation only', () => {
  for (const id of [1, 4]) {
    const panelDraftToolbarTarget = {};
    const dialogs = [];
    const handler = evaluate(open, {
      manga: {}, pageIndex: 1, panelIndex: id - 1, episodeWorkspaceToken: '',
      buildPanelDraftPlan: (_manga, page, panel) => ({ page, panel }),
      setPanelDraftDialog: value => dialogs.push(value),
      setGenerationStatus: () => assert.fail('unexpected error'),
      loadPanelDraftHistory: () => assert.fail('no workspace'),
    });
    const context = {
      h: (type, props, ...children) => ({ type, props, children }),
      createPortal: (child, target) => ({ child, target }), ImageIcon: () => null,
      panel: { id }, panelDisplayLabel: n => `コマ ${String(n).padStart(2, '0')}`,
      panelDraftToolbarTarget, panelDraftDialog: null, openPanelDraftDialog: handler,
    };
    const result = evaluate(portal, context);
    assert.equal(result.target, panelDraftToolbarTarget);
    assert.equal(result.child.props['aria-haspopup'], 'dialog');
    assert.equal(result.child.props.disabled, false);
    assert.ok(result.child.children.includes(`コマ ${String(id).padStart(2, '0')}`));
    result.child.props.onClick();
    assert.equal(dialogs[0].status, 'confirm');
    assert.equal(dialogs[0].plan.panel, id - 1);
    context.panelDraftDialog = { status: 'loading' };
    assert.equal(evaluate(portal, context).child.props.disabled, true);
  }
});

test('ordinary owner generation is Qwen and separate from panel splitting and action injection', () => {
  const toolbar = app.slice(app.indexOf('<div class="canvas-toolbar">'), app.indexOf('const activeCanvas ='));
  assert.match(read('../src/components/PanelControls.tsx'), /aria-label="コマ分割を適用"/);
  assert.doesNotMatch(toolbar, /コマ分割|コマ合体/);
  assert.doesNotMatch(toolbar, /canvas-generation-slot|Animagine|Krea2/);
  assert.match(app, /<PanelInspector[\s\S]*?panelDraftToolbarTarget=\{null\}/);
  assert.match(app, /QwenGenerationDialog/);
  for(const component of ['MangaCanvas','PaintEditor']){
    const source=read(`../src/components/${component}.tsx`);
    assert.match(source, /role="menuitem"[^\n]*>生成<\/button>/);
    assert.doesNotMatch(source, /この画像を参照して生成する|ネームの人物ラフから生成/);
  }
  const lower = inspector.slice(inspector.indexOf('<div class="panel-generation-assistant">'), inspector.indexOf('{panelDraftToolbarTarget &&'));
  assert.doesNotMatch(lower, /openPanelDraftDialog|ラフを生成/);
  assert.match(lower, /panelDisplayLabel\(panel.id\).*の人物へ注入/);
  const action = inspector.slice(inspector.indexOf('class=\"editor-section panel-action-section\"'), inspector.indexOf('class=\"editor-section panel-background-section\"'));
  assert.match(action, /class=\"panel-generation-assistant\"/);
  assert.equal((inspector.match(/class=\"panel-generation-assistant\"/g) ?? []).length, 1);
  // The mobile editor hides the inspector pane. Its dialog must render outside
  // that pane and outside the toolbar's backdrop-filter containing block.
  assert.match(inspector, /panelDraftDialog && typeof window !== 'undefined' && createPortal\(<>/);
  assert.match(inspector, /<\/>, window.document.body\)/);
});

test('separator is vertical on wide canvases and horizontal on wrapped narrow canvases', () => {
  assert.match(css, /\.canvas-generation-slot \{[^}]*border-left: 1px solid/);
  assert.match(css, /\.canvas-generation-slot:empty \{ display: none;/);
  assert.match(css, /@container canvas-stage \(max-width: 760px\)[\s\S]*?\.canvas-generation-slot \{[^}]*flex-basis: 100%;[^}]*border-left: 0;[^}]*border-top: 1px solid/);
  assert.match(css, /\.canvas-stage \{[^}]*grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(css, /\.canvas-toolbar \{[^}]*flex-wrap: wrap/);
});
