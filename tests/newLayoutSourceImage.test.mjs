import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// 見込み: Fileを正本に表示ごとにURLを所有すれば、effectの再作成でも失効URLを引き継がない。
// 確認範囲: 実componentのeffectと描画を模擬hooks/URLで実行。実ブラウザーのdecodeは隣のbrowser fixtureで確認。
function imageFixture() {
  const slots = [], pending = [], live = new Map(), released = [];
  let cursor = 0, sequence = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, value => { slots[index].value = value; }];
    },
    useEffect(run, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        slots[index] = { deps, run };
        pending.push(() => { previous?.cleanup(); slots[index].cleanup = run(); });
      }
    },
  };
  const exports = {};
  const source = readFileSync(new URL('../src/components/NewLayoutSourceImage.tsx', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'preact' },
  }).outputText, {
    exports,
    require: id => id === 'preact/hooks' ? hooks : { jsx: (type, props) => ({ type, props }) },
    URL: {
      createObjectURL: file => { const url = `blob:${++sequence}`; live.set(url, file); return url; },
      revokeObjectURL: url => { released.push(url); live.delete(url); },
    },
  });
  return {
    render(file) {
      cursor = 0;
      const tree = exports.default({ file, alt: '原画', style: { transform: 'rotate(90deg)' } });
      while (pending.length) pending.shift()();
      return tree;
    },
    replayEffects() {
      for (const slot of slots) if (slot.run) { slot.cleanup(); slot.cleanup = slot.run(); }
    },
    dispose() { for (const slot of slots) slot.cleanup?.(); },
    live, released,
  };
}

// 合格: 同じFileのeffectを破棄・再実行すると別の有効URLを表示し、古いURLだけが解放される。
test('開発中のeffect再実行で原画URLを再生成する', () => {
  const fixture = imageFixture(), file = { name: 'page.png' };
  assert.equal(fixture.render(file), null);
  const first = fixture.render(file);
  fixture.replayEffects();
  const next = fixture.render(file);
  assert.notEqual(next.props.src, first.props.src);
  assert.equal(fixture.live.get(next.props.src), file);
  assert.deepEqual(fixture.released, [first.props.src]);
  assert.equal(next.props.alt, '原画');
  assert.equal(next.props.style.transform, 'rotate(90deg)');
  fixture.dispose();
  assert.equal(fixture.live.size, 0);
});

// 合格: ページ切替直後に前ページを表示せず、新しいFileのURLを使う。同じFileの再描画ではURLを増やさず、終了時に解放する。
test('ページ切替と再描画で正しいFileとURLを保持する', () => {
  const fixture = imageFixture(), firstFile = {}, secondFile = {};
  fixture.render(firstFile);
  const first = fixture.render(firstFile);
  assert.equal(fixture.render(firstFile).props.src, first.props.src);
  assert.equal(fixture.render(secondFile), null);
  const second = fixture.render(secondFile);
  assert.equal(fixture.live.get(second.props.src), secondFile);
  assert.equal(fixture.live.size, 1);
  assert.deepEqual(fixture.released, [first.props.src]);
  fixture.dispose();
  assert.equal(fixture.live.size, 0);
});

// 合格: 原画サムネイルとフォーカスは両方File所有componentを通り、Appは失効するURLをstateへ保存しない。
test('全プレビューは元のFileから生成する', () => {
  const app = readFileSync(new URL('../src/components/workspace/useWorkspaceState.ts', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../src/components/new-project/NewLayoutStep.tsx', import.meta.url), 'utf8');
  assert.match(view, /<NewLayoutSourceImage file=\{item.file\} alt=""/);
  assert.match(view, /<NewLayoutSourceImage file=\{activeLayoutItem.file\} alt="読み込んだネーム画像のプレビュー"/);
  assert.doesNotMatch(app + view, /previewUrl|URL\.createObjectURL|URL\.revokeObjectURL/);
});
