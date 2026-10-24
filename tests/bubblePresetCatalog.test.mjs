import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BUBBLE_MATERIALS, materialBubbleBezier, setBubbleShape } from '../src/lib/bubblePresetData.ts';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { parseMangaYaml, toMangaYaml, toStoredMangaYaml, validateManga } from '../src/lib/manga.ts';

const root = new URL('../src/assets/materials/bubbles/', import.meta.url);
const assetsRoot = fileURLToPath(root);
const presets = JSON.parse(readFileSync(new URL('paths.json', root), 'utf8'));
const counts = { critical: 10, nomal: 6, tense: 6, toge: 5, announce: 6, toge_natural: 5 };

test('bubble preset catalog covers all source layers and SVGs', () => {
  assert.equal(presets.length, 38);
  for (const [layer, expected] of Object.entries(counts)) {
    const group = presets.filter(preset => preset.layer === layer);
    assert.equal(group.length, expected, layer);
    assert.deepEqual(group.map(preset => preset.id), Array.from({ length: expected }, (_, i) => `${layer}_${String(i + 1).padStart(2, '0')}`));
    for (const preset of group) {
      const svgPath = join(assetsRoot, preset.asset);
      const svg = readFileSync(svgPath, 'utf8');
      assert.match(svg, /^<svg\s/);
      assert.match(svg, /fill="#fff"/);
      assert.match(svg, /<path\s+d="M /);
      assert.ok(preset.bezier.nodes.length >= 3 && preset.bezier.nodes.length <= 64, preset.id);
      assert.ok(preset.bezier.nodes.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 100 && y >= 0 && y <= 100), preset.id);
    }
  }
});

test('preset directories contain only the expected individual SVG count', () => {
  for (const [layer, expected] of Object.entries(counts)) {
    assert.equal(readdirSync(join(assetsRoot, layer)).filter(name => name.endsWith('.svg')).length, expected, layer);
  }
});

test('author classes and editable outlines survive local and OMNY round trips without replacing square or caption', () => {
  const doc = createEmptyWorkspaceDocument();
  doc.manga.pages[0].panels = [{ id: 1, shape: { type: 'rect', x: 20, y: 40, w: 170, h: 220 }, bg: 0, action: null, bubbles: [] }];
  const panel = doc.manga.pages[0].panels[0];
  panel.bubbles = BUBBLE_MATERIALS.map(preset => ({ text: preset.id, shape: preset.shape, bezier: structuredClone(preset.bezier), tail: false }));
  for (const preset of BUBBLE_MATERIALS) assert.equal(preset.shape, preset.layer === 'nomal' ? 'normal' : preset.layer);
  for (const shape of ['square', 'caption']) {
    const bubble = { text: shape, bezier: structuredClone(presets[0].bezier) };
    setBubbleShape(bubble, shape);
    assert.equal(bubble.shape, shape);
    assert.equal(bubble.bezier, undefined);
    assert.equal(materialBubbleBezier(shape), undefined);
    panel.bubbles.push(bubble);
  }
  assert.ok(!validateManga(doc).some(issue => issue.level === 'error'));
  for (const serialize of [toStoredMangaYaml, toMangaYaml]) {
    const restored = parseMangaYaml(serialize(doc)).manga.pages[0].panels[0].bubbles;
    assert.deepEqual(restored.map(({ text, shape, bezier }) => ({ text, shape, bezier })), panel.bubbles.map(({ text, shape, bezier }) => ({ text, shape, bezier })));
  }
});
