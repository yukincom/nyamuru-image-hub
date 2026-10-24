import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { applySuggestedReferenceView, prepareCharacterReferenceDestination } from '../src/lib/characterReferences.ts';
import { parseMangaYaml, toSeparatedMangaYaml, toSeriesCatalogMangaYaml, validateManga } from '../src/lib/manga.ts';
import { mergeSeriesCatalog, prefillEpisodeSettingFromSeries, prepareDocumentForSeriesSave, removeCharactersFromSeriesCatalog, removeMaterialsFromSeriesCatalog, upsertEpisodeIntoSeriesCatalog } from '../src/lib/seriesCatalog.ts';
import { SYSTEM_MOB_CATALOG_ID } from '../src/lib/systemCharacters.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';

const sampleSource = readFileSync(new URL('../src/content/sample.omny.yaml', import.meta.url), 'utf8');

test('人物のビジュアル指定は台帳と作品保存で人物像から独立し、空欄への変更も保持する', async () => {
  const episode = parseMangaYaml(sampleSource);
  episode.manga.characters = [{ localId: 'local-one', catalog_id: 'character-one', name: '人物', role: '慎重な性格', scope: 'series' }];
  const catalog = structuredClone(episode);
  catalog.manga.characters[0].role = '台帳側の人物像';
  catalog.manga.characters[0].visual_prompt = '黒い短髪。\n細い眉。';
  const merged = mergeSeriesCatalog(episode, catalog).document;
  assert.equal(merged.manga.characters[0].visual_prompt, '黒い短髪。\n細い眉。');
  assert.equal(merged.manga.characters[0].role, '慎重な性格');
  const restored = await restoreProjectSnapshot(JSON.parse(JSON.stringify(await createProjectSnapshot(merged))));
  assert.equal(restored.manga.characters[0].visual_prompt, merged.manga.characters[0].visual_prompt);
  episode.manga.characters[0].visual_prompt = 'この話で指定した外見';
  assert.equal(mergeSeriesCatalog(episode, catalog).document.manga.characters[0].visual_prompt, 'この話で指定した外見');
  episode.manga.characters[0].visual_prompt = '';
  assert.equal(mergeSeriesCatalog(episode, catalog).document.manga.characters[0].visual_prompt, '');
  assert.equal(upsertEpisodeIntoSeriesCatalog(catalog, episode).document.manga.characters[0].visual_prompt, '');
});

test('一括解析の画像分類は未分類だけを補完し、既存分類を変えない', () => {
  assert.equal(applySuggestedReferenceView('back', 'expression'), 'back');
  assert.equal(applySuggestedReferenceView('expression', 'front'), 'expression');
  assert.equal(applySuggestedReferenceView('other', 'expression'), 'expression');
  assert.equal(applySuggestedReferenceView('other', 'other'), 'other');
});

test('人物資料画像はシリーズ台帳を先に保存してから保存先IDを使う', async () => {
  const document = parseMangaYaml(sampleSource);
  const character = document.manga.characters[0];
  character.scope = 'series';
  character.catalog_id = 'character-before-save';
  document.manga.meta.series = '猫の旅';
  document.manga.meta.series_id = 'series-before-save';
  let persisted = false;

  const destination = await prepareCharacterReferenceDestination(document, character, async (source) => {
    persisted = true;
    const prepared = structuredClone(source);
    prepared.manga.meta.series_id = 'series-after-save';
    prepared.manga.characters[0].catalog_id = 'character-after-save';
    return prepared;
  });

  assert.equal(persisted, true);
  assert.equal(destination.seriesId, 'series-after-save');
  assert.equal(destination.characterCatalogId, 'character-after-save');
});

test('シリーズ人物を明示削除すると、その人物専用資料も台帳から外れる', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.characters = [
    { localId: 'person-one', name: '一人目', role: '', scope: 'series', catalog_id: 'character-one' },
    { localId: 'person-two', name: '二人目', role: '', scope: 'series', catalog_id: 'character-two' },
  ];
  document.manga.materials = [
    { localId: 'material-one', key: '一人目資料', type: 'character', scope: 'series', keywords: [], characterId: 'person-one', character_catalog_id: 'character-one', catalog_id: 'material-one' },
    { localId: 'material-two', key: '二人目資料', type: 'character', scope: 'series', keywords: [], characterId: 'person-two', character_catalog_id: 'character-two', catalog_id: 'material-two' },
  ];

  const result = removeCharactersFromSeriesCatalog(document, ['character-one']);
  assert.deepEqual(result.manga.characters.filter((entry) => entry.catalog_id !== SYSTEM_MOB_CATALOG_ID).map((entry) => entry.catalog_id), ['character-two']);
  assert.deepEqual(result.manga.materials.map((entry) => entry.catalog_id), ['material-two']);
});

test('シリーズ素材に変更されないIDと登録元エピソードを付ける', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.meta.title = 'はじまり';
  document.manga.meta.series = '猫の旅';
  document.manga.meta.episode_number = '第1話';
  document.manga.meta.episode_id = 'episode-one';
  document.manga.materials[0].scope = 'series';
  let number = 0;
  const prepared = prepareDocumentForSeriesSave(document, () => `generated-${++number}`);

  assert.equal(prepared.manga.meta.series_id, 'generated-1');
  assert.equal(prepared.manga.materials[0].catalog_id, 'generated-2');
  assert.deepEqual(prepared.manga.materials[0].origin, {
    episode_id: 'episode-one', episode_title: 'はじまり', episode_number: '第1話',
  });
});

test('同じエピソードの題名変更は由来表示だけ更新し、素材IDを保つ', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.meta.series = '猫の旅';
  document.manga.meta.series_id = 'series-one';
  document.manga.meta.episode_id = 'episode-one';
  document.manga.materials[0].scope = 'series';
  document.manga.materials[0].catalog_id = 'material-one';
  document.manga.materials[0].origin = { episode_id: 'episode-one', episode_title: '仮題', episode_number: '1' };
  document.manga.meta.title = '正式タイトル';
  document.manga.meta.episode_number = '第1話';

  const prepared = prepareDocumentForSeriesSave(document, () => 'unused');
  assert.equal(prepared.manga.materials[0].catalog_id, 'material-one');
  assert.deepEqual(prepared.manga.materials[0].origin, {
    episode_id: 'episode-one', episode_title: '正式タイトル', episode_number: '第1話',
  });
});

test('シリーズ共通の統合は作業中の同名素材を優先し、重複を作らない', () => {
  const episode = parseMangaYaml(sampleSource);
  episode.manga.setting = { location: '今回の駅前', time: '夜', weather: '雨', situation: '今回の事件。' };
  episode.manga.materials = [{ key: '赤い傘', type: 'prop', scope: 'episode', keywords: [], note: '' }];
  const catalog = parseMangaYaml(sampleSource);
  catalog.manga.meta.series_id = 'series-one';
  catalog.manga.series_setting = {
    genre: 'ファンタジー', target_audience: '少年・少女', adult_content: false, situation: 'シリーズの世界観。',
  };
  catalog.manga.materials = [
    { key: '赤い傘', type: 'prop', scope: 'series', keywords: ['傘'], note: '' },
    { key: '駅前', type: 'background', scope: 'series', keywords: ['駅'], note: '' },
  ];

  const merged = mergeSeriesCatalog(episode, catalog);
  assert.equal(merged.added, 1);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.document.manga.materials.map((material) => material.key), ['赤い傘', '駅前']);
  assert.equal(merged.document.manga.materials[0].scope, 'series');
  assert.deepEqual(merged.document.manga.series_setting, catalog.manga.series_setting);
  assert.deepEqual(merged.document.manga.setting, episode.manga.setting);
});

test('シリーズ台帳に保存したモブの等身とデザイン詳細を新しい話へ読み込む', () => {
  const episode = parseMangaYaml(sampleSource);
  const catalog = parseMangaYaml(sampleSource);
  const catalogMob = catalog.manga.characters.find((character) => character.catalog_id === SYSTEM_MOB_CATALOG_ID);
  catalogMob.default_proportion = { head_count: 8 };
  catalogMob.recognition.silhouette.observed = ['四角い輪郭の群衆'];

  const merged = mergeSeriesCatalog(episode, catalog).document;
  const mob = merged.manga.characters.find((character) => character.catalog_id === SYSTEM_MOB_CATALOG_ID);
  assert.equal(mob.default_proportion.head_count, 8);
  assert.deepEqual(mob.recognition.silhouette.observed, ['四角い輪郭の群衆']);
  assert.equal(merged.manga.characters.at(-1).catalog_id, SYSTEM_MOB_CATALOG_ID);
});

test('ストーリーOMNYは全素材を保持し、内部シリーズ台帳はシリーズ素材だけを出す', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.meta.series = '猫の旅';
  document.manga.materials = [
    { key: '今回だけ', type: 'prop', scope: 'episode', keywords: [], note: '' },
    { key: 'いつもの家', type: 'background', scope: 'series', keywords: [], note: '' },
  ];
  const story = parse(toSeparatedMangaYaml(document));
  const series = parse(toSeriesCatalogMangaYaml(document));

  assert.deepEqual(story.manga.materials.map((material) => material.key), ['今回だけ', 'いつもの家']);
  assert.deepEqual(series.manga.materials.map((material) => material.key), ['いつもの家']);
  assert.equal(story.manga.meta.document_type, 'story');
  assert.equal(series.manga.meta.document_type, 'series-catalog');
  assert.equal(series.manga.meta.format, document.manga.meta.format);
  assert.deepEqual(series.manga.pages, []);
  assert.equal(series.manga.meta.page_count, 0);
});

test('シリーズ台帳は作品分類と世界観を各話の舞台設定と分けて保存する', () => {
  const episode = parseMangaYaml(sampleSource);
  episode.manga.meta.series = '猫の旅';
  episode.manga.setting = {
    location: '今回だけの駅前', time: '夕方', weather: '雨', situation: '二人が再会する。',
  };
  const seriesSetting = {
    genre: 'ファンタジー', target_audience: '少年・少女', adult_content: false,
    situation: '人と猫が言葉を交わせる世界。', location: '', time: '', weather: '',
  };

  const withoutSeriesSetting = parseMangaYaml(toSeriesCatalogMangaYaml(episode));
  const catalog = parseMangaYaml(toSeriesCatalogMangaYaml(episode, { seriesSetting }));

  assert.deepEqual(withoutSeriesSetting.manga.series_setting, {
    genre: '', target_audience: '', adult_content: false, situation: '', location: '', time: '', weather: '',
  });
  assert.deepEqual(catalog.manga.series_setting, seriesSetting);
  assert.deepEqual(catalog.manga.setting, { location: '', time: '', weather: '', situation: '' });
  assert.notDeepEqual(catalog.manga.series_setting, episode.manga.setting);
});

test('既存シリーズ更新は作品分類と世界観を保持し、今回のあらすじで上書きしない', () => {
  const episode = parseMangaYaml(sampleSource);
  episode.manga.meta.series = '猫の旅';
  episode.manga.setting = {
    location: '今回だけの駅前', time: '夕方', weather: '雨', situation: '二人が再会する。',
  };
  const seriesSetting = {
    genre: 'ファンタジー', target_audience: '少年・少女', adult_content: false,
    situation: '人と猫が言葉を交わせる世界。', location: '', time: '', weather: '',
  };
  const catalog = parseMangaYaml(toSeriesCatalogMangaYaml(episode, { seriesSetting }));

  const updated = upsertEpisodeIntoSeriesCatalog(catalog, episode).document;

  assert.deepEqual(updated.manga.series_setting, seriesSetting);
  assert.deepEqual(updated.manga.setting, { location: '', time: '', weather: '', situation: '' });
});

test('シリーズ資料の場所・時間帯・天候は空の各話設定へ自動注入する', () => {
  const result = prefillEpisodeSettingFromSeries(
    { location: '', time: '深夜', weather: '', situation: 'この話だけの事件が起きる。' },
    {
      genre: 'ファンタジー', target_audience: '少年・少女', adult_content: false,
      situation: 'シリーズ全体の世界観。',
      location: '魔法都市', time: '現代', weather: '晴れ',
    },
  );

  assert.deepEqual(result, {
    location: '魔法都市',
    time: '深夜',
    weather: '晴れ',
    situation: 'この話だけの事件が起きる。',
  });
});

test('作品タイトル・サブタイトル・話数は空欄でも検査エラーにしない', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.meta.title = '';
  document.manga.meta.series = '';
  document.manga.meta.episode_number = '';
  assert.ok(!validateManga(document).some((issue) => issue.path === 'manga.meta.title'));
});

test('配置済みの物が小道具以外なら警告する', () => {
  const document = parseMangaYaml(sampleSource);
  const prop = document.manga.materials.find((material) => material.key === 'ノートPC');
  prop.type = 'background';
  document.manga.pages[0].panels[0].figures.push({ name: 'ノートPC', object: true, bbox: { x: 120, y: 60, w: 30, h: 20 } });
  assert.ok(validateManga(document).some((issue) => issue.message.includes('小道具にしてください')));
});

test('人物資料はシリーズ台帳を経由しても同じ登場人物へ戻る', () => {
  const episode = parseMangaYaml(sampleSource);
  const character = episode.manga.characters[0];
  const visual = episode.manga.materials.find((material) => material.characterId === character.localId);
  episode.manga.meta.series = '猫の旅';
  visual.scope = 'series';
  visual.keywords = visual.keywords.filter((keyword) => keyword !== character.name);

  const catalog = parseMangaYaml(toSeriesCatalogMangaYaml(episode));
  const catalogVisual = catalog.manga.materials.find((material) => material.key === visual.key);
  assert.ok(catalogVisual.keywords.includes(character.name));

  episode.manga.materials = episode.manga.materials.filter((material) => material.localId !== visual.localId);
  const merged = mergeSeriesCatalog(episode, catalog).document;
  assert.equal(merged.manga.materials.find((material) => material.key === visual.key).characterId, character.localId);
});

test('シリーズ人物と人物資料へ安定IDを付け、公開リンクを保存する', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.meta.series = '猫の旅';
  document.manga.meta.series_id = 'series-one';
  document.manga.meta.episode_id = 'episode-one';
  const character = document.manga.characters[0];
  const visual = document.manga.materials.find((material) => material.characterId === character.localId);
  character.scope = 'series';
  visual.scope = 'series';
  let number = 0;

  const prepared = prepareDocumentForSeriesSave(document, () => `stable-${++number}`);
  assert.equal(prepared.manga.characters[0].catalog_id, 'stable-1');
  assert.equal(prepared.manga.materials.find((material) => material.key === visual.key).character_catalog_id, 'stable-1');
});

test('シリーズOMNYはシリーズ人物と画像参照を保持し、ストーリーOMNYはローカル画像参照を除く', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.meta.series = '猫の旅';
  document.manga.meta.series_id = 'series-one';
  const character = document.manga.characters[0];
  const visual = document.manga.materials.find((material) => material.characterId === character.localId);
  character.scope = 'series';
  character.catalog_id = 'character-one';
  character.aliases = ['にゃむ'];
  character.default_proportion = { head_count: 4 };
  character.visual_prompt = '細い黒線で、髪は大きな塊として描く。';
  visual.scope = 'series';
  visual.catalog_id = 'material-one';
  visual.character_catalog_id = 'character-one';
  visual.view = 'turnaround';
  visual.source_image = {
    schema_version: 1,
    asset_id: `image-${'a'.repeat(64)}`,
    file_name: `characters/character-one/image-${'a'.repeat(64)}.png`,
    original_name: 'グレー.png',
    media_type: 'image/png', byte_size: 100, width_px: 640, height_px: 480, sha256: 'a'.repeat(64),
  };
  character.primary_material_catalog_id = 'material-one';

  const story = parse(toSeparatedMangaYaml(document));
  const series = parse(toSeriesCatalogMangaYaml(document));
  assert.equal(story.manga.characters[0].catalog_id, 'character-one');
  assert.equal(story.manga.characters[0].default_proportion.head_count, 4);
  assert.equal(story.manga.characters[0].visual_prompt, character.visual_prompt);
  assert.equal(series.manga.characters[0].visual_prompt, character.visual_prompt);
  assert.equal(story.manga.materials.find((material) => material.catalog_id === 'material-one').source_image, undefined);
  assert.deepEqual(series.manga.characters.map((entry) => entry.catalog_id), ['character-one', SYSTEM_MOB_CATALOG_ID]);
  assert.equal(series.manga.materials.find((material) => material.catalog_id === 'material-one').source_image.sha256, 'a'.repeat(64));
  assert.equal(series.manga.materials.find((material) => material.catalog_id === 'material-one').source_image.original_name, 'グレー.png');
});

test('ストーリーOMNYへ省いた人物画像参照を台帳から復元し、再保存でも失わない', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.meta.series = '猫の旅';
  document.manga.meta.series_id = 'series-one';
  const character = document.manga.characters[0];
  const visual = document.manga.materials.find((material) => material.characterId === character.localId);
  character.scope = 'series';
  character.catalog_id = 'character-one';
  visual.scope = 'series';
  visual.catalog_id = 'material-one';
  visual.character_catalog_id = 'character-one';
  visual.source_image = {
    schema_version: 1,
    asset_id: `image-${'b'.repeat(64)}`,
    file_name: `characters/character-one/image-${'b'.repeat(64)}.png`,
    media_type: 'image/png', byte_size: 100, width_px: 640, height_px: 480, sha256: 'b'.repeat(64),
  };

  const catalog = parseMangaYaml(toSeriesCatalogMangaYaml(document));
  const story = parseMangaYaml(toSeparatedMangaYaml(document));
  assert.equal(story.manga.materials.find((material) => material.catalog_id === 'material-one').source_image, undefined);

  const merged = mergeSeriesCatalog(story, catalog).document;
  assert.equal(merged.manga.materials.find((material) => material.catalog_id === 'material-one').source_image.sha256, 'b'.repeat(64));
  const upserted = upsertEpisodeIntoSeriesCatalog(catalog, story).document;
  assert.equal(upserted.manga.materials.find((material) => material.catalog_id === 'material-one').source_image.sha256, 'b'.repeat(64));
});

test('シリーズ人物は安定IDで再接続し、名前変更後も重複しない', () => {
  const episode = parseMangaYaml(sampleSource);
  episode.manga.characters = [{ localId: 'local-one', name: '仮名', role: '作業中', scope: 'series', catalog_id: 'character-one' }];
  episode.manga.materials = [];
  const catalog = parseMangaYaml(sampleSource);
  catalog.manga.characters = [{ name: '正式名', role: '台帳', scope: 'series', catalog_id: 'character-one' }];
  catalog.manga.materials = [{
    key: '正式名の三面図', type: 'character', scope: 'series', keywords: ['正式名'], catalog_id: 'material-one', character_catalog_id: 'character-one',
  }];

  const merged = mergeSeriesCatalog(episode, catalog);
  assert.equal(merged.addedCharacters, 0);
  assert.equal(merged.addedMaterials, 1);
  assert.equal(merged.document.manga.characters.filter((entry) => entry.catalog_id !== SYSTEM_MOB_CATALOG_ID).length, 1);
  assert.equal(merged.document.manga.materials[0].characterId, 'local-one');
});

test('シリーズ保存upsertは別話だけにある既存項目を削除しない', () => {
  const existing = parseMangaYaml(sampleSource);
  existing.manga.meta.series = '猫の旅';
  existing.manga.meta.series_id = 'series-one';
  existing.manga.characters = [{ name: '既存人物', role: '', scope: 'series', catalog_id: 'character-old' }];
  existing.manga.materials = [{ key: '既存の家', type: 'background', scope: 'series', keywords: [], catalog_id: 'material-old' }];
  existing.manga.pages = [];
  existing.manga.meta.page_count = 0;

  const episode = parseMangaYaml(sampleSource);
  episode.manga.meta.series = '猫の旅';
  episode.manga.meta.series_id = 'series-one';
  episode.manga.characters[0].scope = 'series';
  episode.manga.characters[0].catalog_id = 'character-new';
  episode.manga.materials = [];

  const upserted = upsertEpisodeIntoSeriesCatalog(existing, episode);
  assert.deepEqual(upserted.conflicts, []);
  assert.deepEqual(
    new Set(upserted.document.manga.characters.map((character) => character.catalog_id)),
    new Set(['character-old', 'character-new', SYSTEM_MOB_CATALOG_ID]),
  );
  assert.ok(upserted.document.manga.materials.some((material) => material.catalog_id === 'material-old'));
});

test('同名で異なる安定IDのシリーズ人物は自動統合せず競合にする', () => {
  const existing = parseMangaYaml(sampleSource);
  existing.manga.characters = [{ name: 'グレー', role: '', scope: 'series', catalog_id: 'character-one' }];
  existing.manga.materials = [];
  const episode = parseMangaYaml(sampleSource);
  episode.manga.meta.series = '作品';
  episode.manga.characters = [{ name: 'グレー', role: '', scope: 'series', catalog_id: 'character-two' }];
  episode.manga.materials = [];

  const upserted = upsertEpisodeIntoSeriesCatalog(existing, episode);
  assert.deepEqual(upserted.conflicts, ['人物: グレー']);
  assert.equal(upserted.document.manga.characters.filter((entry) => entry.catalog_id !== SYSTEM_MOB_CATALOG_ID).length, 1);
});

test('明示削除は指定したシリーズ素材だけを外し、代表画像リンクも解除する', () => {
  const catalog = parseMangaYaml(sampleSource);
  catalog.manga.characters = [{
    name: 'グレー', role: '', scope: 'series', catalog_id: 'character-one', primary_material_catalog_id: 'material-one',
  }];
  catalog.manga.materials = [
    { key: 'グレー三面図', type: 'character', scope: 'series', keywords: ['グレー'], catalog_id: 'material-one', character_catalog_id: 'character-one' },
    { key: '共通背景', type: 'background', scope: 'series', keywords: [], catalog_id: 'material-two' },
  ];

  const removed = removeMaterialsFromSeriesCatalog(catalog, ['material-one']);
  assert.deepEqual(removed.manga.materials.map((material) => material.catalog_id), ['material-two']);
  assert.equal(removed.manga.characters[0].primary_material_catalog_id, undefined);
});
