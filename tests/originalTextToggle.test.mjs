import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function originalToggle(file, context) {
  const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let label;
  const visit = (node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'label'
      && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute)
        && attribute.name.getText(ast) === 'class' && attribute.initializer?.text?.includes('analog-text-reference-toggle'))) label = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(label, `${file} must expose the original image toggle`);
  const javascript = ts.transpileModule(`(${label.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' },
  }).outputText;
  return runInNewContext(javascript, { ...context, h: (type, props, ...children) => ({ type, props, children }) });
}

for (const file of ['PanelInspector.tsx', 'PageOverlayInspector.tsx']) {
  test(`${file}: 原画表示は親カードの選択を発火せず、表示だけを切り替える`, () => {
    let owner = { bubbles: [{ text: '入力したセリフ', speaker: '人物', scenarioMatch: { status: 'review' },
      analogTextImport: { assetId: 'existing-crop', referenceHidden: true, needsReview: true } }] };
    const before = structuredClone(owner);
    for (const checked of [true, false]) {
      const label = originalToggle(file, { index: 0, bubble: owner.bubbles[0], update: (recipe) => {
        const next = structuredClone(owner); recipe(next); owner = next;
      } });
      assert.equal(label.children.find((child) => child.type === 'span').children[0], '原画を表示');
      const input = label.children.find((child) => child.type === 'input');
      assert.equal(input.props.checked, !checked);
      let stopped = false;
      const event = { currentTarget: { checked }, stopPropagation: () => { stopped = true; } };
      label.props.onClick(event);
      assert.equal(stopped, true, 'click must not reach the selectable card before change');
      input.props.onChange(event);
      assert.equal(!owner.bubbles[0].analogTextImport.referenceHidden, checked);
      const expected = structuredClone(before);
      if (checked) delete expected.bubbles[0].analogTextImport.referenceHidden;
      assert.deepEqual(owner, expected, '本文・話者・確認状態・画像参照は変更しない');
    }
  });
}

test('候補欄は不要な説明を表示せず、候補選択・本文の確認操作を残す', () => {
  const source = readFileSync(new URL('../src/components/ScenarioBubbleNotice.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /OCRを仮入力しています|このコマに未使用の候補はありません/);
  assert.match(source, /candidates\.length > 0 &&/);
  assert.match(source, /<summary>候補を確認<\/summary>/);
  assert.match(source, /choose\(null\)/);
});
