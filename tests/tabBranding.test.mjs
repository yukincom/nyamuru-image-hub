import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const pages = ['src/layouts/Layout.astro', 'standalone/index.html', 'standalone/pages-loader.html'];

test('通常版と単一HTML版のタブ左端は同じ猫アイコンで、外部画像を要求しない', () => {
  const icons = pages.map(path => {
    const links = read(path).match(/<link\b[^>]*rel="icon"[^>]*>/g);
    assert.equal(links.length, 1, path);
    assert.match(links[0], /type="image\/svg\+xml"/);
    const href = links[0].match(/href="([^"]+)"/)[1];
    assert.ok(href.startsWith('data:image/svg+xml,'));
    const svg = decodeURIComponent(href.slice('data:image/svg+xml,'.length));
    assert.match(svg, /viewBox="0 0 64 64"/);
    assert.match(svg, />🐱<\/text>/);
    assert.doesNotMatch(svg, /<image|<script|href=/);
    return href;
  });
  assert.equal(new Set(icons).size, 1);
});

test('タブ名では猫を重複させず、上流クレジットとホーム用アイコンは変更しない', () => {
  const layout = read(pages[0]);
  assert.ok(layout.includes("const tabTitle = title.replace(/Nyamuru\\s*🐱/u, 'Nyamuru');"));
  assert.match(read('src/components/Header.tsx'), /<h1>NYAMURU - Image Hub<\/h1>/);
  for (const path of ['public/manifest.webmanifest', 'standalone/pages-manifest.webmanifest']) {
    const manifest = JSON.parse(read(path));
    assert.equal(manifest.name, 'Nyamuru 🐱 Image Hub');
    assert.equal(manifest.short_name, 'Nyamuru Hub');
  }
  assert.match(layout, /<title>\{tabTitle\}<\/title>/);
  for (const path of pages.slice(1)) {
    assert.doesNotMatch(read(path).match(/<title>(.*?)<\/title>/)[1], /🐱/);
  }
  assert.match(layout, /Copyright © 2026 sa-san10/);
  assert.match(layout, /rel="apple-touch-icon" href="\/icons\/icon-192.png"/);
});
