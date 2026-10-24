import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMangaYaml } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { createPortableProject, restorePortableProject, portableProjectBlob, readPortableProject } from '../src/lib/portableProject.ts';
import { blobRevision } from '../src/lib/browserFiles.ts';
import { characterImageCacheId } from '../src/lib/browserCatalog.ts';

const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+y2ioAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
async function fixture() {
  const document = parseMangaYaml(readFileSync(new URL('../src/content/sample.omny.yaml', import.meta.url), 'utf8'));
  document.manga.meta.series_id = 'portable-series';
  document.manga.meta.episode_id = 'portable-episode';
  const character = document.manga.characters[0];
  character.catalog_id = 'portable-character'; character.scope = 'series';
  const sha = await blobRevision(png);
  document.manga.materials.push({ key: '持ち出す人物資料', type: 'character', scope: 'series', keywords: [],
    characterId: character.localId, character_catalog_id: character.catalog_id, catalog_id: 'portable-reference',
    source_image: { schema_version: 1, asset_id: `image-${sha}`, file_name: `characters/${character.catalog_id}/image-${sha}.png`,
      original_name: '参照.png', media_type: 'image/png', byte_size: png.size, width_px: 1, height_px: 1, sha256: sha } });
  const panel = document.manga.pages[0].panels[0];
  panel.figures = [{ name: character.name, analogImport: { schemaVersion: 1, assetId: 'old-crop', sourceRegionId: 'region', sourceBBox: { x: 0, y: 0, w: 1, h: 1 }, detectionSource: 'body', draft: true } }];
  return document;
}
test('portable file restores story, crop and character originals into empty client storage', async () => {
  const source = await fixture(), crops = [], characters = [];
  const file = await createPortableProject(source, { snapshot: doc => createProjectSnapshot(doc, async () => png), loadCharacter: async () => png });
  const serialized = await readPortableProject(new File([portableProjectBlob(file)], '持ち出し.nyamuru'));
  const restored = await restorePortableProject(serialized, {
    restore: snapshot => restoreProjectSnapshot(snapshot, async assets => crops.push(...assets)), saveCharacters: async assets => characters.push(...assets),
  });
  assert.equal(restored.manga.meta.title, source.manga.meta.title);
  assert.deepEqual(restored.manga.layout_spec, source.manga.layout_spec);
  assert.equal(crops.length, 1); assert.equal(characters.length, 1);
  const material = restored.manga.materials.find(item => item.source_image);
  assert.equal(characters[0].id, characterImageCacheId(restored.manga.meta.series_id, material.character_catalog_id, material.source_image.asset_id));
  assert.notEqual(restored.manga.pages[0].panels[0].figures[0].analogImport.assetId, 'old-crop');
  assert.equal(await blobRevision(characters[0].blob), material.source_image.sha256);
});
test('missing or corrupt character bytes fail before writing any imported assets', async () => {
  const source = await fixture();
  const file = await createPortableProject(source, { snapshot: doc => createProjectSnapshot(doc, async () => png), loadCharacter: async () => png });
  const services = { restore: async () => assert.fail('must validate first'), saveCharacters: async () => assert.fail('must validate first') };
  await assert.rejects(restorePortableProject({ ...file, characterImages: [] }, services), /不足/);
  const corrupt = structuredClone(file); corrupt.characterImages[0].data = btoa('corrupt');
  await assert.rejects(restorePortableProject(corrupt, services), /一致/);
  await assert.rejects(createPortableProject(source, { snapshot: doc => createProjectSnapshot(doc, async () => png), loadCharacter: async () => null }), /保存を中止/);
});
