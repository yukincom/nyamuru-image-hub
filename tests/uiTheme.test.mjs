import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const css = read('src/styles/global.css');
const rule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, selector);
  return match[1];
};

test('新規作成は共通テーマを継承し、現在位置の丸だけを濃いセージにする', () => {
  assert.doesNotMatch(rule('.new-series-step'), /--[\w-]+:/);
  assert.match(rule('.new-creation-steps li.is-active'), /background: var\(--accent-soft\); color: var\(--ink\)/);
  assert.match(rule('.new-creation-steps li.is-active span'), /background: var\(--accent\); color: white/);
  assert.match(rule('.new-creation-steps li span'), /background: var\(--neutral-soft\)/);
  for (const step of ['series', 'characters', 'setting', 'layout']) {
    assert.ok(read('src/components/App.tsx').includes(`aria-current={newCreationStep === '${step}' ? 'step' : undefined}`));
  }
});

test('通常の大きい操作面は淡色と墨黒、エラーや削除は独立した意味色', () => {
  for (const selector of ['.primary-button', '.panel-generation-button', '.character-visuals-head .character-extract-all', '.character-reference-actions .character-extract-button', '.new-layout-import-actions .scanner-finish-button', '.inspector-sticky-head']) {
    assert.match(rule(selector), /background: var\(--accent-fill\)/, selector);
    assert.match(rule(selector), /color: var\(--ink\)/, selector);
  }
  assert.match(rule('.secondary-button'), /background: var\(--control\)/);
  assert.match(rule('.bubble-guide .bubble-text.is-text-review'), /color: var\(--danger\)/);
  assert.match(rule('.new-layout-analysis-detail li strong.is-text-review'), /color: var\(--danger\)/);
  assert.match(rule('.panel-draft-message.is-error'), /var\(--danger-border\)/);
  assert.match(rule('.new-layout-thumb-card.is-error .new-layout-analysis-placeholder'), /color: var\(--danger\)/);
  assert.match(rule('.panel-draft-workspace.is-missing'), /var\(--warning-soft\)/);
  assert.match(css, /button\[aria-label\$="を削除"\]:hover:not\(:disabled\) \{ color: var\(--danger\)/);
});

test('通常UIとドキュメントには旧ピンクの直書きや旧テーマ変数を残さない', () => {
  const files = ['src/styles/global.css', 'src/styles/sourceCoverage.css', 'src/layouts/DocsLayout.astro', 'src/pages/docs/index.astro', 'src/pages/licenses.astro', 'src/pages/changelog.astro', 'src/pages/404.astro'];
  for (const file of files) {
    const ui = read(file).split('\n').filter(line => !line.includes('--panel-bg-')).join('\n');
    assert.doesNotMatch(ui, /#(?:ff6b81|ff8899|ffb3ba|e64f68|d94661)\b|rgba\(255,\s*(?:107,\s*129|179,\s*186),|--retro-(?:pink|blue)/i, file);
  }
});

test('誌面と生成用の色はUIテーマから切り離され、PWAの外枠だけを揃える', () => {
  assert.match(css, /--paper: #fffefb;/);
  assert.match(css, /--panel-bg-n1-color: #b4b8be;/);
  assert.match(css, /--panel-bg-0-color: #fff6f8;/);
  assert.match(css, /--panel-bg-1-color: #f5faff;/);
  assert.match(css, /--panel-bg-2-color: #f3faf5;/);
  assert.match(rule('.bubble-svg-outline-surface'), /stroke: #2b292e;/);
  assert.match(read('src/lib/panelDraft.ts'), /denseTone: '#E60012'/);
  assert.match(read('src/lib/panelDraft.ts'), /lightTone: '#00D7E8'/);
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.theme_color, '#DCE9DF');
  assert.equal(manifest.background_color, '#f6f5f3');
  assert.ok(read('src/layouts/Layout.astro').includes('name="theme-color" content="#DCE9DF"'));
});

test('コマ情報は人物で始まり、吹き出しカードは情報タブへ移す', () => {
  assert.match(rule('.inspector-fields'), /display:flex;\s*flex-direction:column/);
  const ordered = [
    ['.inspector-fields>.panel-figure-section', 2],
    ['.inspector-fields>.panel-prop-section', 3],
    ['.inspector-fields>.panel-text-section', 4],
    ['.inspector-fields>.panel-action-section', 5],
    ['.inspector-fields>.panel-images-section', 6],
    ['.inspector-fields>.panel-background-section', 7],
  ];
  for (const [selector, order] of ordered) assert.match(rule(selector), new RegExp(`order:${order}`));
  const inspector = read('src/components/PanelInspector.tsx');
  assert.doesNotMatch(css, /\.inspector-fields>\.panel-bubble-section/);
  assert.match(inspector, /<BubbleInfoPortal[\s\S]*?class="editor-section inspector-category-section panel-bubble-section"[\s\S]*?<\/BubbleInfoPortal>/);
  for (const name of [ 'panel-figure-section', 'panel-background-section']) assert.match(inspector, new RegExp(`class="[^"]*${name}`));
});
