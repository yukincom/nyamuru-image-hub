import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseMangaYaml, toMangaYaml, toSeparatedMangaYaml, toStoredMangaYaml, newPage } from '../src/lib/manga.ts';
import { parseStoryReferenceText } from '../src/lib/settingTextImport.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { attachRecognizedTextToPage } from '../src/lib/localBridge.ts';
import { SCENARIO_MATCH_THRESHOLD, parseScenario, scenarioSimilarity, applyScenarioToNewDocument, availableScenarioCandidates, confirmScenarioCorrespondence, releaseScenarioCorrespondence, linkScenarioSpeaker, scenarioCharacter, restoreProvisionalScenarioText, useScenarioBubbleText } from '../src/lib/scenario.ts';

const sample = readFileSync(new URL('../src/content/sample.omny.yaml', import.meta.url), 'utf8');
const source = text => ({ version: 1, fileName: 'origin_name.md', text });
const script = (body, page = 1, panel = 1) => `# シナリオ\n## page${page}\n### コマ${panel}\n${body}`;
function documentWith(texts = []) {
  const document = parseMangaYaml(sample);
  document.manga.characters = [{ name: 'ハル', aliases: ['春'], role: '', scope: 'episode', localId: 'haru' }, { name: 'アキ', role: '', scope: 'episode', localId: 'aki' }];
  document.manga.pages = [newPage(1)];
  document.manga.meta.page_count = 1;
  document.manga.pages[0].panels[0].bubbles = texts.map((text, i) => ({ text, bbox: { x: 20 + i * 15, y: 20, w: 10, h: 30 } }));
  return document;
}
const bubbles = document => document.manga.pages[0].panels[0].bubbles;

test('scenario parser separates full-width numbered panels, adjacent dialogue, multiline text, emphasis and stage directions', () => {
  const parsed = parseScenario(`# 星の店\n- 話数：第1話\n＃ シナリオ\n## page１\n###　コマ１\n春「**明日**の\n予定は？」「**楽しみ**だね」\n春は窓を見る。\nアキは「本当かな」と考える。\n## page2\n### コマ２\nアキ「またね」\n# 資料\n別資料の本文`);
  assert.equal(parsed.panels.length, 2);
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.panels[0].dialogues, [
    { id: 'p1-c1-d1', speaker: '春', text: '明日の\n予定は？', emphasis: '明日' },
    { id: 'p1-c1-d2', speaker: '春', text: '楽しみだね', emphasis: '楽しみ' },
  ]);
  assert.equal(parsed.panels[0].action, '春は窓を見る。\nアキは「本当かな」と考える。');
  assert.equal(parsed.panels[1].page, 2);
  assert.equal(parsed.panels[1].panel, 2);
});

test('新規作成のナレーション表記は話者なしの四角フキダシとして読み込む', () => {
  const parsed = parseScenario(script('ナレーション：**翌朝**、雨は上がった。\nナレーション「それでも町は静かだった。」\nナレーション：「誰もいない。」'));
  assert.deepEqual(parsed.panels[0].dialogues, [
    { id: 'p1-c1-d1', speaker: '', text: '翌朝、雨は上がった。', emphasis: '翌朝', shape: 'square' },
    { id: 'p1-c1-d2', speaker: '', text: 'それでも町は静かだった。', emphasis: '', shape: 'square' },
    { id: 'p1-c1-d3', speaker: '', text: '誰もいない。', emphasis: '', shape: 'square' },
  ]);
  const document = documentWith(['翌朝、雨は上がった。']);
  bubbles(document)[0].shape = 'normal';
  applyScenarioToNewDocument(document, source(script('ナレーション：翌朝、雨は上がった。')));
  assert.equal(bubbles(document)[0].shape, 'square');
  assert.equal('speaker' in bubbles(document)[0], false);
  assert.equal(bubbles(document)[0].speakerId, undefined);
  assert.equal(bubbles(document)[0].scenarioMatch.status, 'automatic');
});

test('scenario is not misread as title, synopsis, setting labels or fenced instructions', () => {
  const onlyScenario = script('春「タイトル：明日」\n場所：校庭');
  assert.deepEqual(parseStoryReferenceText(onlyScenario), { seriesTitle: '', subtitle: '', episodeNumber: '', setting: { location: '', time: '', weather: '', situation: '' } });
  const meta = parseStoryReferenceText(`# 星の店\n- 場所：店内\n## あらすじ\n再会する。\n${onlyScenario}`);
  assert.equal(meta.seriesTitle, '星の店');
  assert.equal(meta.setting.location, '店内');
  assert.equal(meta.setting.situation, '再会する。');
  assert.equal(parseScenario('```md\n# シナリオ\n```'), null);
  assert.equal(parseScenario(script('```\n春「実行しない」\n```\n春「こんにちは」')).panels[0].dialogues.length, 1);
});

test('duplicate panel and text without ownership are retained as explicit source warnings', () => {
  const parsed = parseScenario('# シナリオ\n説明\n## page1\n### コマ1\n春「一つ」\n### コマ1\n春「二つ」');
  assert.equal(parsed.panels.length, 1);
  assert.ok(parsed.warnings.length >= 2);
});

test('matching ignores wrapping/fullwidth/punctuation, threshold is exactly the requested 70 percent', () => {
  assert.equal(SCENARIO_MATCH_THRESHOLD, 0.7);
  assert.equal(scenarioSimilarity('明日は\n学校へ 行こう！', '明日は学校へ行こう'), 1);
  assert.equal(scenarioSimilarity('ＡＢＣ', 'abc'), 1);
  assert.equal(scenarioSimilarity('abcdefghij', 'abcdefgXYZ'), 0.7);
  assert.equal(scenarioSimilarity('abcdefghij', 'abcdefWXYZ'), 0.6);
  assert.equal(scenarioSimilarity('', '言葉'), 0);
  assert.equal(scenarioSimilarity('・・・', '・・・'), 1);
  assert.notEqual(scenarioSimilarity('？', '・・・'), 1);
  for (const [ocr, status] of [['abcdefgXYZ', 'automatic'], ['abcdefWXYZ', 'review']]) {
    const document = documentWith([ocr]);
    applyScenarioToNewDocument(document, source(script('春「abcdefghij」')));
    assert.equal(bubbles(document)[0].scenarioMatch.status, status);
  }
});

test('authoritative dialogue, canonical speaker, emphasis and action replace OCR without moving or deleting crops', () => {
  const document = documentWith(['明日は学枚へ\n行こう']);
  const bubble = bubbles(document)[0];
  const box = structuredClone(bubble.bbox);
  bubble.analogTextImport = { schemaVersion: 1, sourceRegionId: 'r', assetId: 'a', sourceBBox: { x: 0, y: 0, w: 1, h: 1 }, recognitionEngine: 'Baberu OCR', needsReview: true, unreadable: false, levelAdjusted: true };
  const result = applyScenarioToNewDocument(document, source(script('春「明日は**学校**へ行こう！」\n春は窓を指す。')));
  assert.deepEqual(result, { matched: 1, review: 0, actions: 1 });
  assert.equal(bubble.text, '明日は学校へ行こう！');
  assert.equal(bubble.speaker, 'ハル');
  assert.equal(bubble.speakerId, 'haru');
  assert.equal(bubble.emphasis, '学校');
  assert.equal(bubble.scenarioMatch.ocrText, '明日は学枚へ\n行こう');
  assert.equal(bubble.analogTextImport.referenceHidden, true);
  assert.equal(bubble.analogTextImport.needsReview, false);
  assert.equal(bubble.analogTextImport.assetId, 'a');
  assert.deepEqual(bubble.bbox, box);
  assert.equal(document.manga.pages[0].panels[0].action, '春は窓を指す。');
});

test('identical utterances stay scoped to page/panel; duplicate source or OCR competition asks for review', () => {
  const document = documentWith(['こんにちは']);
  document.manga.pages.push(newPage(2));
  document.manga.pages[1].panels[0].bubbles = [{ text: 'こんにちは' }];
  applyScenarioToNewDocument(document, source(script('春「こんにちは」') + '\n## page2\n### コマ1\nアキ「こんにちは」'));
  assert.equal(bubbles(document)[0].speaker, 'ハル');
  assert.equal(document.manga.pages[1].panels[0].bubbles[0].speaker, 'アキ');
  for (const [texts, text] of [
    [['はい'], '春「はい」\nアキ「はい」'],
    [['こんにちは', 'こんにちは'], '春「こんにちは」'],
  ]) {
    const competing = documentWith(texts);
    const result = applyScenarioToNewDocument(competing, source(script(text)));
    assert.equal(result.matched, 0);
    assert.equal(result.review, texts.length);
  }
});

test('grouped OCR can take adjacent source phrases from the same speaker but never merge different speakers', () => {
  const document = documentWith(['明日は学校へ行こうまた会おう']);
  applyScenarioToNewDocument(document, source(script('春「明日は**学校**へ行こう」「また**会おう**」')));
  assert.equal(bubbles(document)[0].text, '明日は学校へ行こう\nまた会おう');
  assert.equal(bubbles(document)[0].emphasis, '学校, 会おう');
  assert.equal(bubbles(document)[0].scenarioMatch.sourceIds.length, 2);
  const different = documentWith(['abcdefghij']);
  applyScenarioToNewDocument(different, source(script('春「abcde」\nアキ「fghij」')));
  assert.equal(bubbles(different)[0].scenarioMatch.status, 'review');
});

test('low match preserves OCR pending a real manual choice, which cannot reuse another source assignment', () => {
  const document = documentWith(['読み取り不能', 'また明日会おう']);
  applyScenarioToNewDocument(document, source(script('春「**学校**へ行こう」\nアキ「また明日会おう」')));
  assert.equal(bubbles(document)[0].text, '読み取り不能');
  assert.equal(bubbles(document)[0].scenarioMatch.ocrText, '読み取り不能');
  assert.equal(bubbles(document)[0].scenarioMatch.status, 'review');
  const location = { pageIndex: 0, panelIndex: 0, bubbleIndex: 0 };
  const candidates = availableScenarioCandidates(document, location);
  assert.equal(candidates.length, 1);
  assert.throws(() => confirmScenarioCorrespondence(document, location, ['p1-c1-d2']), /使用中/);
  confirmScenarioCorrespondence(document, location, ['p1-c1-d1']);
  assert.equal(bubbles(document)[0].text, '学校へ行こう');
  assert.equal(bubbles(document)[0].scenarioMatch.status, 'confirmed');
  assert.equal(bubbles(document)[0].scenarioMatch.ocrText, '読み取り不能');
});

test('unknown speaker is not guessed; explicit alias choice updates linked bubbles; duplicate aliases are ambiguous', () => {
  const document = documentWith(['こんにちは']);
  applyScenarioToNewDocument(document, source(script('春子「こんにちは」')));
  assert.equal(bubbles(document)[0].speaker, '春子');
  assert.equal(bubbles(document)[0].speakerId, undefined);
  linkScenarioSpeaker(document, '春子', 'haru');
  assert.equal(bubbles(document)[0].speakerId, 'haru');
  assert.equal(bubbles(document)[0].speaker, 'ハル');
  assert.ok(document.manga.characters[0].aliases.includes('春子'));
  assert.throws(() => linkScenarioSpeaker(document, '春子', 'aki'), /別の登場人物/);
  assert.equal(scenarioCharacter([{ name: 'A', aliases: ['同名'] }, { name: 'B', aliases: ['同名'] }], '同名'), undefined);
});

test('missing OCR/pages remain in the source; page overlay requires explicit panel-aware correspondence', () => {
  const document = documentWith([]);
  document.manga.pages[0].page_overlay = { bubbles: [{ text: 'こんにちは' }] };
  applyScenarioToNewDocument(document, source(script('春「こんにちは」\n雨が降る。') + '\n## page2\n### コマ1\nアキ「またね」'));
  assert.equal(bubbles(document).length, 0);
  assert.equal(parseScenario(document.manga.scenario.text).panels.length, 2);
  assert.equal(document.manga.pages[0].page_overlay.bubbles[0].scenarioMatch.status, 'review');
  const location = { pageIndex: 0, panelIndex: 0, bubbleIndex: 0, overlay: true };
  assert.throws(() => confirmScenarioCorrespondence(document, location, ['p2-c1-d1']), /異なります/);
  confirmScenarioCorrespondence(document, location, ['p1-c1-d1']);
  assert.equal(document.manga.pages[0].page_overlay.bubbles[0].speakerId, 'haru');
});

test('real OCR attachment preserves grouped regions/ownership before scenario correction', () => {
  const document = documentWith([]);
  const page = document.manga.pages[0];
  const attached = attachRecognizedTextToPage(page, [
    { id: 'l1', groupId: 'b1', sourcePanelId: 'p1', text: '明日は', bbox: { x: 0.3, y: 0.2, w: 0.1, h: 0.1 }, needsReview: true, vertical: true, confidence: 0.5, source: 'Baberu OCR' },
    { id: 'l2', groupId: 'b1', sourcePanelId: 'p1', text: '学校へ行こう', bbox: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 }, needsReview: true, vertical: true, confidence: 0.5, source: 'Baberu OCR' },
  ], undefined, null, new Map([['p1', page.panels[0]]]));
  assert.equal(attached.added, 1);
  const box = structuredClone(bubbles(document)[0].bbox);
  applyScenarioToNewDocument(document, source(script('春「明日は学校へ行こう」')));
  assert.equal(bubbles(document)[0].text, '明日は学校へ行こう');
  assert.equal(bubbles(document)[0].scenarioMatch.status, 'automatic');
  assert.deepEqual(bubbles(document)[0].bbox, box);
});

test('project/browser roundtrip preserves source and OCR; exports include editable provisional text without local metadata', async () => {
  const document = documentWith(['明日は学校へ行こう', '未読']);
  applyScenarioToNewDocument(document, source(script('春「明日は**学校**へ行こう」\n春は走る。')));
  const restored = await restoreProjectSnapshot(await createProjectSnapshot(document));
  assert.deepEqual(restored.manga.scenario, document.manga.scenario);
  assert.deepEqual(bubbles(restored).map(b => b.scenarioMatch), bubbles(document).map(b => b.scenarioMatch));
  assert.deepEqual(parseMangaYaml(toStoredMangaYaml(document)).manga.scenario, document.manga.scenario);
  for (const yaml of [toMangaYaml(document), toSeparatedMangaYaml(document)]) {
    assert.doesNotMatch(yaml, /scenario|ocrText|origin_name\.md|sourceIds/u);
    const parsed = parseMangaYaml(yaml);
    assert.equal(bubbles(parsed)[0].text, '明日は学校へ行こう');
    assert.equal(bubbles(parsed)[0].speaker, 'ハル');
    assert.equal(bubbles(parsed)[0].emphasis, '学校');
    assert.equal(parsed.manga.pages[0].panels[0].action, '春は走る。');
    assert.equal(bubbles(parsed)[1].text, '未読', 'provisional OCR remains usable without a forced scenario match');
  }
});

test('correspondences can be swapped without deleting bubbles; newly added bubbles can take unused dialogue', () => {
  const document = documentWith(['こんにちは', 'また明日']);
  applyScenarioToNewDocument(document, source(script('春「こんにちは」「また明日」「おやすみ」')));
  const first = { pageIndex: 0, panelIndex: 0, bubbleIndex: 0 };
  const second = { ...first, bubbleIndex: 1 };
  const before = structuredClone(bubbles(document)[0]);
  releaseScenarioCorrespondence(document, first);
  assert.equal(bubbles(document)[0].text, before.text);
  assert.deepEqual(bubbles(document)[0].bbox, before.bbox);
  confirmScenarioCorrespondence(document, second, ['p1-c1-d1']);
  confirmScenarioCorrespondence(document, first, ['p1-c1-d2']);
  assert.equal(bubbles(document)[0].text, 'また明日');
  assert.equal(bubbles(document)[1].text, 'こんにちは');
  bubbles(document).push({ text: '' });
  confirmScenarioCorrespondence(document, { ...first, bubbleIndex: 2 }, ['p1-c1-d3']);
  assert.equal(bubbles(document)[2].text, 'おやすみ');
});

test('documents without a scenario are unchanged by the optional import', () => {
  const document = documentWith(['元のまま']);
  const before = structuredClone(document);
  applyScenarioToNewDocument(document, source('# あらすじ\n友人と再会する。'));
  assert.deepEqual(document, before);
});

test('manual extra dialogue and linebreak edits survive roundtrip without requiring a source match', () => {
  const document = documentWith(['ええっ', 'また明日']);
  applyScenarioToNewDocument(document, source(script('春「また明日」')));
  const first = bubbles(document)[0];
  useScenarioBubbleText(first, 'ええっ！\nそんな');
  const second = bubbles(document)[1];
  useScenarioBubbleText(second, 'また\n明日');
  const restored = parseMangaYaml(toStoredMangaYaml(document));
  assert.equal(bubbles(restored)[0].text, 'ええっ！\nそんな');
  assert.equal(bubbles(restored)[0].scenarioMatch.status, 'manual');
  assert.equal(bubbles(restored)[0].scenarioMatch.ocrText, 'ええっ');
  assert.equal(bubbles(restored)[1].text, 'また\n明日');
  assert.deepEqual(bubbles(restored)[1].scenarioMatch.sourceIds, ['p1-c1-d1']);
});

test('first-importer blanks are restored once, never overwriting manual text or later clears', () => {
  const document = documentWith(['', '編集済み', '']);
  bubbles(document).forEach(bubble => { bubble.scenarioMatch = { status: 'review', sourceIds: [], ocrText: 'OCR控え', score: .2 }; });
  useScenarioBubbleText(bubbles(document)[2], '');
  assert.equal(restoreProvisionalScenarioText(document), true);
  assert.deepEqual(bubbles(document).map(b => b.text), ['OCR控え', '編集済み', '']);
  bubbles(document)[0].text = '';
  assert.equal(restoreProvisionalScenarioText(document), false);
  assert.equal(bubbles(document)[0].text, '');
});

test('initial plot roles set editable oval/rectangle paths and survive every OMNY export', async () => {
  const document = documentWith(['こんにちは', '心に決めた', '翌朝になった']);
  for (const bubble of bubbles(document)) {
    bubble.shape = 'flash';
    bubble.bezier = { nodes: [{ x: 20, y: 10 }, { x: 80, y: 10 }, { x: 50, y: 90 }] };
  }
  applyScenarioToNewDocument(document, source(script('春「こんにちは」\n春（独白）「心に決めた」\nナレーション：翌朝になった')));
  const placed = bubbles(document);
  assert.deepEqual(placed.map(b => b.shape), ['normal', 'normal', 'square']);
  assert.deepEqual(placed.map(b => b.monologue), [undefined, true, undefined]);
  assert.deepEqual(placed.slice(0, 2).map(b => b.speakerId), ['haru', 'haru']);
  assert.ok(placed[0].bezier.nodes.some(n => n.handleIn || n.handleOut));
  assert.deepEqual(placed[0].bezier, placed[1].bezier);
  assert.equal(placed[2].bezier.nodes.length, 4);
  assert.ok(placed[2].bezier.nodes.every(n => [0, 100].includes(n.x) && [0, 100].includes(n.y) && !n.handleIn && !n.handleOut));
  assert.equal(placed[2].tail, false);
  for (const serialize of [toStoredMangaYaml, toMangaYaml, toSeparatedMangaYaml]) {
    const restored = bubbles(parseMangaYaml(serialize(document)));
    assert.deepEqual(restored.map(({ text, shape, monologue, bezier, tail }) => ({ text, shape, monologue, bezier, tail })),
      placed.map(({ text, shape, monologue, bezier, tail }) => ({ text, shape, monologue, bezier, tail })));
  }
  assert.deepEqual(bubbles(await restoreProjectSnapshot(await createProjectSnapshot(document))).map(b => b.bezier), placed.map(b => b.bezier));
});

test('relinking updates semantic roles without resetting an edited outline or tail', () => {
  const document = documentWith(['心に決めた']);
  applyScenarioToNewDocument(document, source(script('春（独白）「心に決めた」\nナレーション「その夜」')));
  const bubble = bubbles(document)[0];
  bubble.shape = 'wobbly';
  bubble.bezier.nodes[0].x = 7;
  bubble.tail = { x: -0.3, y: 1.1 };
  const before = structuredClone(bubble);
  confirmScenarioCorrespondence(document, { pageIndex: 0, panelIndex: 0, bubbleIndex: 0 }, ['p1-c1-d2']);
  assert.equal(bubble.text, 'その夜');
  assert.equal(bubble.monologue, undefined);
  assert.equal(bubble.shape, before.shape);
  assert.deepEqual(bubble.bezier, before.bezier);
  assert.deepEqual(bubble.tail, before.tail);
});

test('explicit monologue labels do not absorb spoken text or infer a role from prose', () => {
  const parsed = parseScenario(script('独白：迷っている\n春（心の声）：「どうしよう」\n春「これは独白という言葉だ」\n春は独白した。'));
  assert.equal(parsed.panels[0].dialogues[0].monologue, true);
  assert.equal(parsed.panels[0].dialogues[1].speaker, '春');
  assert.equal(parsed.panels[0].dialogues[2].monologue, undefined);
  const document = documentWith(['abcdef']);
  applyScenarioToNewDocument(document, source(script('春「abc」\n春（独白）「def」')));
  assert.equal(bubbles(document)[0].scenarioMatch.status, 'review');
  assert.equal(bubbles(document)[0].bezier, undefined);
});
