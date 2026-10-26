import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'yaml';
import {
  assignCharacterMaterial,
  inferMaterialCharacter,
  renameCharacter,
  renameMaterial,
  synchronizeCatalogReferences,
} from '../src/lib/catalogModel.ts';
import { parseMangaYaml, toMangaYaml, toStoredMangaYaml, validateManga } from '../src/lib/manga.ts';
import { linkedTestDocument, PERSON_A, PERSON_A_MATERIAL, PROP_A } from './fixtures/emptyTestDocument.ts';

const sample = linkedTestDocument;

test('OMNYの人物・素材・配置・話者・assetsへ決定的なローカル参照を付ける', () => {
  const first = sample();
  const second = sample();
  const characterA = first.manga.characters.find((character) => character.name === PERSON_A);
  const visual = first.manga.materials.find((material) => material.key === PERSON_A_MATERIAL);
  const figure = first.manga.pages.flatMap((page) => page.panels).flatMap((panel) => panel.figures ?? [])
    .find((entry) => entry.name === PERSON_A);
  const bubble = first.manga.pages.flatMap((page) => page.panels).flatMap((panel) => panel.bubbles)
    .find((entry) => entry.speaker === PERSON_A);
  const panel = first.manga.pages[0].panels[0];

  assert.ok(characterA.localId);
  assert.equal(second.manga.characters.find((character) => character.name === PERSON_A).localId, characterA.localId);
  assert.equal(visual.characterId, characterA.localId);
  assert.equal(figure.kind, 'person');
  assert.equal(figure.refId, characterA.localId);
  assert.equal(bubble.speakerId, characterA.localId);
  assert.equal(panel.assetIds.length, panel.assets.length);
  assert.ok(panel.assetIds.every(Boolean));
});

test('ローカル保存だけがIDを保持し、公開OMNYは従来の名称参照だけを出す', () => {
  const document = sample();
  document.manga.pages[0].panels[0].figures.push({
    name: PROP_A, object: true, kind: 'prop', refId: 'material-prop-a', bbox: { x: 120, y: 45, w: 20, h: 15 },
  });
  const stored = toStoredMangaYaml(document);
  const exported = toMangaYaml(document);

  assert.match(stored, /localId:/);
  assert.match(stored, /characterId:/);
  assert.match(stored, /refId:/);
  assert.match(stored, /speakerId:/);
  assert.match(stored, /assetIds:/);
  assert.doesNotMatch(exported, /localId:|characterId:|refId:|speakerId:|assetIds:|kind:/);
  assert.match(exported, /object: true/);

  const reopened = parseMangaYaml(exported);
  const characterA = reopened.manga.characters.find((character) => character.name === PERSON_A);
  assert.equal(reopened.manga.materials.find((material) => material.key === PERSON_A_MATERIAL).characterId, characterA.localId);
});

test('人物名の変更は配置・話者・人物資料名と再読込用キーワードへ伝播する', () => {
  const document = sample();
  const character = document.manga.characters.find((entry) => entry.name === PERSON_A);
  renameCharacter(document, character.localId, 'PERSON_RENAMED');

  const linkedVisual = document.manga.materials.find((material) => material.characterId === character.localId);
  assert.equal(linkedVisual.key, 'PERSON_RENAMEDの立ち絵');
  assert.ok(linkedVisual.keywords.includes('PERSON_RENAMED'));
  assert.ok(!linkedVisual.keywords.includes(PERSON_A));
  document.manga.pages.forEach((page) => page.panels.forEach((panel) => {
    panel.figures?.filter((figure) => figure.refId === character.localId).forEach((figure) => assert.equal(figure.name, 'PERSON_RENAMED'));
    panel.bubbles.filter((bubble) => bubble.speakerId === character.localId).forEach((bubble) => assert.equal(bubble.speaker, 'PERSON_RENAMED'));
  }));

  const reopened = parseMangaYaml(toMangaYaml(document));
  const reopenedCharacter = reopened.manga.characters.find((entry) => entry.name === 'PERSON_RENAMED');
  assert.equal(reopened.manga.materials.find((material) => material.key === 'PERSON_RENAMEDの立ち絵').characterId, reopenedCharacter.localId);
});

test('小道具名の変更は全ページの配置とassetsへID経由で伝播する', () => {
  const document = sample();
  const prop = document.manga.materials.find((material) => material.key === PROP_A);
  const panel = document.manga.pages[0].panels[0];
  panel.figures.push({ name: prop.key, kind: 'prop', refId: prop.localId, bbox: { x: 20, y: 20, w: 20, h: 20 } });
  synchronizeCatalogReferences(document);
  renameMaterial(document, prop.localId, '作業用ノートPC');

  assert.equal(panel.figures.at(-1).name, '作業用ノートPC');
  assert.ok(panel.assets.includes('作業用ノートPC'));
  assert.equal(panel.assetIds[panel.assets.indexOf('作業用ノートPC')], prop.localId);
});

test('人物資料の名前規則が曖昧なら勝手に割り当てず、明示割当で再読込可能にする', () => {
  const document = sample();
  document.manga.characters = [
    { name: '猫', role: '', localId: 'person-cat' },
    { name: '猫', role: '', localId: 'person-cat-other' },
  ];
  document.manga.materials = [{
    key: '猫の立ち絵', type: 'character', scope: 'episode', keywords: ['猫'], note: '', localId: 'material-cat',
  }];
  synchronizeCatalogReferences(document);
  assert.equal(inferMaterialCharacter(document.manga.materials[0], document.manga.characters), undefined);
  assert.equal(document.manga.materials[0].characterId, undefined);

  assignCharacterMaterial(document, 'material-cat', 'person-cat');
  assert.equal(document.manga.materials[0].characterId, 'person-cat');
});

test('公開OMNYの人物資料には対応人物名をキーワードとして残す', () => {
  const document = sample();
  const character = document.manga.characters[0];
  const visual = document.manga.materials.find((material) => material.characterId === character.localId);
  visual.keywords = visual.keywords.filter((keyword) => keyword !== character.name);
  const exported = parse(toMangaYaml(document));
  assert.ok(exported.manga.materials.find((material) => material.key === visual.key).keywords.includes(character.name));
});

test('公開OMNYを開いてそのまま書き出しても名称参照が変わらない', () => {
  const first = toMangaYaml(sample());
  const second = toMangaYaml(parseMangaYaml(first));
  assert.equal(second, first);
});

test('人物ごとのアクションは公開OMNYへ保存し、再読込しても人物配置に残る', () => {
  const document = sample();
  const figure = document.manga.pages.flatMap((page) => page.panels)
    .flatMap((panel) => panel.figures ?? [])
    .find((entry) => entry.kind === 'person');
  figure.action = '右手を上げ、画面左へ顔を向ける';

  const exported = toMangaYaml(document);
  const reopened = parseMangaYaml(exported);
  const reopenedFigure = reopened.manga.pages.flatMap((page) => page.panels)
    .flatMap((panel) => panel.figures ?? [])
    .find((entry) => entry.name === figure.name && entry.action);
  assert.equal(reopenedFigure.action, '右手を上げ、画面左へ顔を向ける');
});

test('解決できない旧OMNYの名称は消さずに保持する', () => {
  const document = sample();
  const panel = document.manga.pages[0].panels[0];
  panel.figures.push({ name: '未登録の人物', bbox: { x: 1, y: 1, w: 10, h: 10 } });
  panel.bubbles.push({ text: '声だけ', speaker: '未登録の話者', bbox: { x: 2, y: 2, w: 10, h: 10 } });
  synchronizeCatalogReferences(document);
  assert.equal(panel.figures.at(-1).name, '未登録の人物');
  assert.equal(panel.figures.at(-1).refId, undefined);
  assert.equal(panel.bubbles.at(-1).speaker, '未登録の話者');
  assert.equal(panel.bubbles.at(-1).speakerId, undefined);
  const exported = parse(toMangaYaml(document));
  assert.equal(exported.manga.pages[0].panels[0].figures.at(-1).name, '未登録の人物');
  assert.equal(exported.manga.pages[0].panels[0].bubbles.at(-1).speaker, '未登録の話者');
});

test('OMNYで名称参照が曖昧になる重複名を検査で止める', () => {
  const document = sample();
  document.manga.characters[1].name = document.manga.characters[0].name;
  document.manga.materials[1].key = document.manga.materials[0].key;
  const issues = validateManga(document);
  assert.ok(issues.some((issue) => issue.message.includes('人物名') && issue.message.includes('重複')));
  assert.ok(issues.some((issue) => issue.message.includes('素材名') && issue.message.includes('重複')));
});

test('人物資料は公開安定IDを名前推定より優先して再接続する', () => {
  const document = sample();
  document.manga.characters = [
    { localId: 'person-one', name: '同名候補', role: '', scope: 'series', catalog_id: 'character-one', aliases: ['グレー'] },
    { localId: 'person-two', name: 'グレー', role: '', scope: 'series', catalog_id: 'character-two' },
  ];
  document.manga.materials = [{
    localId: 'material-one', key: 'グレーの三面図', type: 'character', scope: 'series', keywords: ['グレー'],
    character_catalog_id: 'character-one', catalog_id: 'material-one',
  }];

  synchronizeCatalogReferences(document);
  assert.equal(document.manga.materials[0].characterId, 'person-one');
});

test('安定IDのない人物資料は別名の完全一致で一意な人物へ戻る', () => {
  const document = sample();
  document.manga.characters = [{ localId: 'person-one', name: '正式名', role: '', scope: 'series', aliases: ['ネーム略称'] }];
  document.manga.materials = [{
    localId: 'material-one', key: 'ネーム略称の立ち絵', type: 'character', scope: 'series', keywords: ['ネーム略称'],
  }];

  synchronizeCatalogReferences(document);
  assert.equal(document.manga.materials[0].characterId, 'person-one');
});
