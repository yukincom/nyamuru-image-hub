import assert from 'node:assert/strict';
import test from 'node:test';
import { agentWorkflowYamlFiles } from '../src/lib/generationHandoff.ts';
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
