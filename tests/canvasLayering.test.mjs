import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function zIndexOf(selector) {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const rule = rules.find((match) => (
    match[1].split(',').map((part) => part.trim()).includes(selector)
    && /z-index:\s*(-?\d+)/.test(match[2])
  ));
  assert.ok(rule, `${selector} のCSS規則が存在すること`);
  const zIndex = rule[2].match(/z-index:\s*(-?\d+)/);
  assert.ok(zIndex, `${selector} に z-index が指定されていること`);
  return Number(zIndex[1]);
}

test('人物を選択中でもフキダシは人物より前面に残る', () => {
  assert.ok(zIndexOf('.bubble-guide') > zIndexOf('.figure-guide.is-element-selected'));
});

test('要素種別ごとの前後関係を選択中も維持する', () => {
  assert.ok(zIndexOf('.screen-text-guide') > zIndexOf('.figure-guide.is-element-selected'));
  assert.ok(zIndexOf('.bubble-guide') > zIndexOf('.screen-text-guide.is-element-selected'));
  assert.ok(zIndexOf('.bubble-guide.is-element-selected') > zIndexOf('.bubble-guide'));
});

test('ページ前景はコマ枠より上で、人物よりフキダシが前面にある', () => {
  assert.ok(zIndexOf('.page-overlay-figure-layer') > zIndexOf('.panel-frame-overlay'));
  assert.ok(zIndexOf('.panel-bubble-layer') > zIndexOf('.page-overlay-figure-layer'));
  assert.ok(zIndexOf('.page-overlay-bubble-layer') > zIndexOf('.page-overlay-figure-layer'));
});
