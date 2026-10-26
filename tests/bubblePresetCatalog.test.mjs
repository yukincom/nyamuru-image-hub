import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BUBBLE_MATERIALS, BUBBLE_PRESET_LAYERS, materialBubbleBezier, setBubbleShape } from '../src/lib/bubblePresetData.ts';
import { isBubbleBezier } from '../src/lib/bubbleBezier.ts';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { parseMangaYaml, toMangaYaml, toStoredMangaYaml, validateManga } from '../src/lib/manga.ts';

const root = new URL('../src/assets/materials/bubbles/', import.meta.url);
const assetsRoot = fileURLToPath(root);
const presets = JSON.parse(readFileSync(new URL('paths.json', root), 'utf8'));
const counts = { thought: 7, critical: 10, nomal: 6, tense: 6, toge: 5, announce: 6, toge_natural: 5 };
const directoryCounts={kumo:7,critical:10,nomal:6,tense:6,toge:5,announce:6,toge_natural:5};
const kumoHashes = [
  '18135af8ba1b730c1567ed032953834b3ae09c3172dfebbd57650b416b71f073',
  'c9c346160c8ca86b6a22b252b57b6c9c28a5d2718c0bcae3e72e30d5651254b6',
  'aedd50fcd0f1dafcd487eb65edf0f01b479b85aaef5d6a11d4e1047ec2c57fdf',
  'a7a3fc8954ae90bfa1528ac4705122652f1323379093cd90bafa993589bf8946',
  '81e22542ad95d532d016a90153fc709d3ca0971c9a48376e1fc0996a88f5f01c',
  '6e6f25fdc8878fc19b389c3fde2d98afd706327b493e43c31de6af2f5119a491',
  '90701af75572748b57f344eb4cd3605d1b64f8e5e18543fb096b6a5541804313',
];
test('all bubble material tiles visibly identify their editable vector format',()=>{
  const source=readFileSync(new URL('../src/components/BubbleMaterialPicker.tsx',import.meta.url),'utf8');
  assert.match(source,/<small class="bubble-material-kind"><PenTool size=\{11\} aria-hidden="true"\/>ベクター<\/small>/);
  assert.match(source,/BUBBLE_PRESETS\.filter\([\s\S]*\.map\(p=>/);
});

test('bubble preset catalog covers all source layers and SVGs', () => {
  assert.equal(presets.length, 45);
  for (const [layer, expected] of Object.entries(counts)) {
    const group = presets.filter(preset => preset.layer === layer);
    assert.equal(group.length, expected, layer);
    const prefix=layer==='thought'?'kumo':layer;
    assert.deepEqual(group.map(preset => preset.id), Array.from({ length: expected }, (_, i) => `${prefix}_${String(i + 1).padStart(2, '0')}`));
    for (const preset of group) {
      const svgPath = join(assetsRoot, preset.asset);
      const svg = readFileSync(svgPath, 'utf8');
      assert.match(svg, /(?:^|\n)<svg\s/);
      if(layer!=='thought')assert.match(svg, /fill="#fff"/);
      assert.match(svg, /<path[^>]*\sd="M\s?/);
      assert.ok(isBubbleBezier(preset.bezier), preset.id);
    }
  }
});

test('preset directories contain only the expected individual SVG count', () => {
  for (const [layer, expected] of Object.entries(directoryCounts)) {
    assert.equal(readdirSync(join(assetsRoot, layer)).filter(name => name.endsWith('.svg')).length, expected, layer);
  }
  assert.equal(existsSync(join(assetsRoot,'thought')),false);
});

test('material catalog exposes the seven exact recovered author clouds before the other 38 source materials',()=>{
  assert.equal(BUBBLE_MATERIALS.length,45);
  assert.deepEqual(BUBBLE_PRESET_LAYERS,['thought','critical','nomal','tense','toge','announce','toge_natural']);
  const clouds=BUBBLE_MATERIALS.slice(0,7);
  assert.deepEqual(clouds.map(cloud=>cloud.id),Array.from({length:7},(_,i)=>`kumo_${String(i+1).padStart(2,'0')}`));
  assert.ok(clouds.every(cloud=>cloud.shape==='thought'&&cloud.layer==='thought'&&isBubbleBezier(cloud.bezier)));
  assert.deepEqual(clouds.map(cloud=>createHash('sha256').update(readFileSync(join(assetsRoot,cloud.asset))).digest('hex')),kumoHashes);
  assert.ok(!BUBBLE_MATERIALS.some(material=>material.id==='thought_01'));
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
