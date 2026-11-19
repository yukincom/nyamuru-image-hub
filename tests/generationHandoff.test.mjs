import assert from 'node:assert/strict';
import test from 'node:test';
import { agentWorkflowCloudFiles, agentWorkflowYamlFiles, buildCloudGenerationSpec } from '../src/lib/generationHandoff.ts';
import { parseMangaYaml } from '../src/lib/manga.ts';
import { getArtworkSettings } from '../src/lib/artworkRules.ts';

test('external agent handoff exports pure OMNY YAML without ZIP or plain-text prompt wrapping', () => {
  const doc = parseMangaYaml('manga:\n  meta:\n    title: テスト作品\n');
  const before = structuredClone(doc);
  const files = agentWorkflowYamlFiles(doc);
  assert.equal(files.length, 1);
  assert.equal(files[0].fileName, 'テスト作品.yaml');
  assert.match(files[0].yaml, /title:\s*"?テスト作品"?/);
  assert.doesNotMatch(files[0].yaml, /layout_spec:/);
  assert.deepEqual(doc, before);
});

test('external agent handoff includes work-specific OMAY generation YAML when artwork_settings is present', () => {
  const doc = parseMangaYaml('manga:\n  meta:\n    title: カスタム作画作品\n');
  doc.manga.artwork_settings = getArtworkSettings(doc.manga);
  const files = agentWorkflowYamlFiles(doc);
  assert.deepEqual(files.map(file => file.fileName), ['カスタム作画作品.yaml', 'カスタム作画作品-generation.yaml']);
  assert.match(files[1].yaml, /spec_name:/);
  assert.match(files[1].yaml, /style_notes:/);
  assert.match(files[1].yaml, /layout_spec:/);
});

test('cloud generation JSON strips bezier/text_runs and makes background & bubble kind self-explanatory', () => {
  const doc = parseMangaYaml(`
manga:
  meta:
    title: クラウド作品
  setting:
    location: 個人宅の自室
  characters:
    - name: 小雪
      catalog_id: char-koyuki
  materials:
    - key: koyuki.png
      type: character
      scope: series
      keywords: [小雪]
      character_catalog_id: char-koyuki
      view: turnaround
  pages:
    - page: 1
      canvas: { w: 182, h: 257, unit: mm }
      panels:
        - id: 1
          shape: { type: rect, x: 16, y: 18.5, w: 150, h: 87.179 }
          bg: 0
          background_description: ポワポワした感情背景
          bubbles:
            - text: 恋愛脳なのか？
              speaker: 小雪
              shape: normal
              tail_style: thinking
              text_runs: [{ start: 0, end: 3, italic: false }]
              bezier:
                nodes:
                  - { x: 0, y: 50, handleIn: { x: 0, y: 27 }, handleOut: { x: 0, y: -27 } }
`);
  doc.manga.artwork_settings = getArtworkSettings(doc.manga);
  const files = agentWorkflowCloudFiles(doc);
  assert.equal(files.length, 1);
  assert.equal(files[0].fileName, 'クラウド作品-cloud.json');
  const spec = JSON.parse(files[0].yaml);
  assert.equal(spec.format, 'nyamuru-cloud-generation-v1');
  assert.ok(spec.artwork_rules);
  assert.deepEqual(spec.characters[0].reference_images, [{ key: 'koyuki.png', view: 'turnaround' }]);
  const panel = spec.pages[0].panels[0];
  assert.deepEqual(panel.background, { mode: 'abstract', description: 'ポワポワした感情背景' });
  assert.equal(panel.shape.h, 87.2);
  const bubble = panel.bubbles[0];
  assert.equal(bubble.kind, 'thought');
  assert.equal('bezier' in bubble, false);
  assert.equal('text_runs' in bubble, false);
  assert.equal(spec.pages[0].guide_image, '01.png');
  assert.deepEqual(buildCloudGenerationSpec(doc).pages[0].panels[0].bubbles[0].kind, 'thought');
  const omitted = buildCloudGenerationSpec(doc, { includeBackground: false, includeBubbles: false, exportReferenceImages: false });
  assert.deepEqual(omitted.render_options, {
    include_background: false,
    include_bubbles: false,
    include_handwritten: true,
    include_screen_text: true,
    include_panel_borders: false,
    panel_border_mode: 'light-blue-cutlines-no-black-borders',
    export_reference_images: false,
  });
  assert.equal(omitted.pages[0].panels[0].background.mode, 'omitted');
  assert.deepEqual(omitted.pages[0].panels[0].bubbles, []);
  assert.equal('guide_image' in omitted.pages[0], false);
});
