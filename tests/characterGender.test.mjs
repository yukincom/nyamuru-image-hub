import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { isCharacterGender, resolveCharacterGender } from '../src/lib/characterGender.ts';
import { mergeCharacterTextCatalog, parseCharacterText, toCharacterTextMarkdown } from '../src/lib/characterTextCatalog.ts';
import { renderCharacterHumanPoseTemplate } from '../src/lib/humanPoseTemplate.ts';
import { normalizeDocument, parseMangaYaml, toMangaYaml, toSeparatedMangaYaml, toSeriesCatalogMangaYaml, toStoredMangaYaml, validateManga } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { mergeSeriesCatalog, upsertEpisodeIntoSeriesCatalog } from '../src/lib/seriesCatalog.ts';
import { createSystemMobCharacter, SYSTEM_MOB_CATALOG_ID } from '../src/lib/systemCharacters.ts';

const sample = readFileSync(new URL('../src/content/sample.yaml', import.meta.url), 'utf8');
const genders = ['female', 'male', 'neutral'];
const labels = ['女性', '男性', '中性'];

// 保存先によらず、明示値と未設定を区別する。
function story(gender) {
  const document = parseMangaYaml(sample);
  document.manga.characters = [{
    localId: 'person-one', catalog_id: 'character-one', name: '人物一', role: '慎重', scope: 'series',
    visual_prompt: '短い髪、ゆったりした上着', ...(gender === undefined ? {} : { gender }),
  }];
  document.manga.materials = [];
  return document;
}

test('性別3値と未設定は各OMNY保存・snapshotの往復で変わらない', async () => {
  for (const gender of [...genders, undefined]) {
    const source = story(gender);
    for (const serialize of [toMangaYaml, toSeparatedMangaYaml, toSeriesCatalogMangaYaml, toStoredMangaYaml]) {
      const raw = parse(serialize(source));
      assert.equal(raw.manga.characters[0].gender, gender);
      assert.equal(Object.hasOwn(raw.manga.characters[0], 'gender'), gender !== undefined);
      const restored = parseMangaYaml(serialize(source));
      assert.equal(restored.manga.characters[0].gender, gender);
      assert.equal(restored.manga.characters[0].visual_prompt, source.manga.characters[0].visual_prompt);
      assert.equal(validateManga(restored).some(issue => issue.path.endsWith('.gender')), false);
    }
    const restored = await restoreProjectSnapshot(JSON.parse(JSON.stringify(await createProjectSnapshot(source))));
    assert.equal(restored.manga.characters[0].gender, gender);
    assert.equal(Object.hasOwn(restored.manga.characters[0], 'gender'), gender !== undefined);
  }
});

test('不正な性別は丸めず、入力検証と英文変換で拒否する', () => {
  for (const value of ['', 'Female', '女性', 'other', 'constructor', null, 0, {}]) {
    const normalized = normalizeDocument(story(value));
    assert.deepEqual(normalized.manga.characters[0].gender, value);
    assert.equal(isCharacterGender(value), false);
    assert.deepEqual(validateManga(normalized).filter(issue => issue.path.endsWith('.gender')).map(issue => issue.level), ['error']);
    assert.throws(() => resolveCharacterGender(normalized.manga.characters[0]));
  }
});

test('人物Markdownは日本語の性別を往復し、明示した変更だけを反映する', () => {
  for (let index = 0; index < genders.length; index += 1) {
    const source = story(genders[index]);
    const text = toCharacterTextMarkdown(source);
    assert.ok(text.includes(`- 性別：${labels[index]}`));
    const entries = parseCharacterText(text);
    assert.equal(entries[0].gender, genders[index]);
    const changed = mergeCharacterTextCatalog(story('male'), entries).document;
    assert.equal(changed.manga.characters[0].gender, genders[index]);
    const empty = story();
    empty.manga.characters = [];
    assert.equal(mergeCharacterTextCatalog(empty, entries).document.manga.characters[0].gender, genders[index]);
  }
  assert.doesNotMatch(toCharacterTextMarkdown(story()), /性別/u);
  const missing = parseCharacterText('### 人物一\n#### 人物像\n好奇心が強い女性');
  assert.equal(Object.hasOwn(missing[0], 'gender'), false);
  assert.equal(mergeCharacterTextCatalog(story('male'), missing).document.manga.characters[0].gender, 'male');
  assert.equal(Object.hasOwn(mergeCharacterTextCatalog(story(), missing).document.manga.characters[0], 'gender'), false);
  for (const value of ['female', '不明', '']) {
    assert.throws(() => parseCharacterText(`### 人物一\n- 性別: ${value}`), /性別/u);
  }
});

test('共通人物からは未設定だけ補完し、各話の明示値を保持する', () => {
  const catalog = story('female');
  for (const gender of genders) {
    const episode = story(gender);
    assert.equal(mergeSeriesCatalog(episode, catalog).document.manga.characters[0].gender, gender);
    assert.equal(upsertEpisodeIntoSeriesCatalog(catalog, episode).document.manga.characters[0].gender, gender);
  }
  assert.equal(mergeSeriesCatalog(story(), catalog).document.manga.characters[0].gender, 'female');
  assert.equal(upsertEpisodeIntoSeriesCatalog(catalog, story()).document.manga.characters[0].gender, 'female');
  assert.equal(Object.hasOwn(mergeSeriesCatalog(story(), story()).document.manga.characters[0], 'gender'), false);
});

test('システム人物も未設定を保ち、明示した性別は保存・mergeできる', () => {
  assert.equal(Object.hasOwn(createSystemMobCharacter(), 'gender'), false);
  const episode = normalizeDocument(story());
  const catalog = structuredClone(episode);
  const findMob = document => document.manga.characters.find(character => character.catalog_id === SYSTEM_MOB_CATALOG_ID);
  findMob(catalog).gender = 'male';
  assert.equal(findMob(mergeSeriesCatalog(episode, catalog).document).gender, 'male');
  findMob(episode).gender = 'neutral';
  assert.equal(findMob(mergeSeriesCatalog(episode, catalog).document).gender, 'neutral');
  assert.equal(findMob(parseMangaYaml(toStoredMangaYaml(episode))).gender, 'neutral');
});

// templateのtokenだけを展開し、既存の原文や人物像には触れない。
test('共通rendererは目的格・所有格・再帰形とbe/haveを属性ごとに解決する', () => {
  const template = '{{subject}} {{verb:be}} beside a wall behind {{object}}; {{subject}} {{verb:have}} {{possessive_adjective}} bag; it is {{possessive_pronoun}}; {{reflexive}}';
  const expected = [
    'She is beside a wall behind her; she has her bag; it is hers; herself',
    'He is beside a wall behind him; he has his bag; it is his; himself',
    'They are beside a wall behind them; they have their bag; it is theirs; themselves',
  ];
  genders.forEach((gender, index) => {
    assert.deepEqual(renderCharacterHumanPoseTemplate(template, { gender }), { gender, isFallback: false, text: expected[index] });
  });
  const character = story().manga.characters[0];
  const before = structuredClone(character);
  assert.deepEqual(renderCharacterHumanPoseTemplate(template, character), { gender: 'neutral', isFallback: true, text: expected[2] });
  assert.deepEqual(character, before);
  assert.deepEqual(renderCharacterHumanPoseTemplate('{{subject}} {{verb:stand}}'), { gender: 'neutral', isFallback: true, text: 'They stand' });
});
