// 模擬した解析結果を作品へ反映し、取込領域・人間の編集・生成用の本文を区別する。実画像の認識精度は後日に確認。
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCharacterMatchAssignments, applyCharacterReadOutcomes, buildCharacterMatchCandidates, collectUnmatchedCharacterTargets } from '../src/lib/characterMatching.ts';

import { analyzeFigureCharacterMatchWithLocalVlm } from '../src/lib/localBridge.ts';
import { parseMangaYaml, toMangaYaml, toStoredMangaYaml } from '../src/lib/manga.ts';
import { emptyTestDocument } from './fixtures/emptyTestDocument.ts';

const noFace = {catalog_version: '86-test', catalog_sha256: 'a'.repeat(64), target_face_id: null, target_evidence_en: null, faces: []};
const face = { face_id: 'face_01', bbox: [0.1, 0.1, 0.9, 0.9], confidence: 'medium',
  parts_mapping: {base_emotion: null, brows: null, eyes: null, mouth: {id: 'S050', evidence_en: 'short straight closed mouth', source: 'observation'}, extras: []},
  qwen_image21_prompt_en: 'Short straight closed mouth.' };

function documentFixture() {
  const analogImport = { schemaVersion: 1, sourceRegionId: 'region-1', assetId: 'asset-1', sourceBBox: { x: 0, y: 0, w: 1, h: 1 }, detectionSource: 'body', draft: true };
  return { manga: {
    characters: [
      { localId: 'person-a', name: 'A', role: '', scope: 'series', recognition: { hair: { observed: ['短いボブ'], inferred: [] }, face: { observed: [], inferred: [] }, silhouette: { observed: [], inferred: [] }, outfit: { observed: [], inferred: [] }, accessories: { observed: [], inferred: [] }, ambiguous_design: { observed: [], inferred: [] } } },
      { localId: 'person-mob', name: 'モブキャラ', role: '背景扱いのモブ', scope: 'series', catalog_id: 'character-system-mob', recognition: { silhouette: { observed: ['単純な造形'], inferred: [] } } },
      { localId: 'person-draft', name: '人物あたり', role: '', scope: 'episode' },
    ],
    pages: [{ page: 1, canvas: { w: 210, h: 297, unit: 'mm' }, panels: [
      { id: 1, shape: { type: 'rect', x: 0, y: 0, w: 100, h: 100 }, bg: 1, bubbles: [], action: null, figures: [{ name: '人物あたり', kind: 'person', analogImport: structuredClone(analogImport) }] },
      { id: 2, shape: { type: 'rect', x: 100, y: 0, w: 100, h: 100 }, bg: 1, bubbles: [], action: null, figures: [{ name: '人物あたり', kind: 'person', analogImport: structuredClone(analogImport) }] },
    ] }],
  }};
}

test('同じ原画領域の分割複製を1件へまとめる', () => {
  const targets = collectUnmatchedCharacterTargets(documentFixture());
  assert.equal(targets.length, 1);
  assert.deepEqual(targets[0].locations, ['ページ 01・コマ 01', 'ページ 01・コマ 02']);
  assert.equal(targets[0].currentSize, 'bust-up');
});

// 人物名から推測させない。採用済みの手入力は原文で残し、名前・別名・推定・未判定を候補から外す（モデル入力の準備のみ）。
test('照合候補には人物あたりを含めず観察済み特徴だけを渡す', () => {
  const { characters } = documentFixture().manga;
  characters[0].aliases = ["役名"];
  characters[0].recognition.hair.inferred.push("推定色");
  characters[0].recognition.ambiguous_design.observed.push("未判定");
  const candidates = buildCharacterMatchCandidates(characters);
  assert.deepEqual(candidates, [{ id: 'person-a', observedTraits: ['短いボブ'] }]);
});

test('確認した人物を同じ原画領域の全配置へ反映し再照合対象から外す', () => {
  const document = documentFixture();
  assert.equal(applyCharacterMatchAssignments(document, new Map([['region-1', 'person-a']])), 2);
  assert.equal(collectUnmatchedCharacterTargets(document).length, 0);
  for (const panel of document.manga.pages[0].panels) {
    assert.equal(panel.figures[0].refId, 'person-a');
    assert.equal(panel.figures[0].name, 'A');
    assert.equal(panel.figures[0].analogImport.userEdited, true);
  }
});

test('同じ原画領域でも手作業で確認済みの配置は上書きしない', () => {
  const document = documentFixture();
  const protectedFigure = document.manga.pages[0].panels[0].figures[0];
  protectedFigure.refId = 'person-manual';
  protectedFigure.name = '手動指定';
  protectedFigure.analogImport.userEdited = true;
  assert.equal(applyCharacterMatchAssignments(document, new Map([['region-1', 'person-a']])), 1);
  assert.equal(protectedFigure.refId, 'person-manual');
  assert.equal(document.manga.pages[0].panels[1].figures[0].refId, 'person-a');
});

// 顔が見えても人物照合の信頼度は独立。固定した返値を2配置に適用し、同じ領域1件だけを要確認として数える。
test('新規作成時の人物・演技を反映し、低信頼だけ要確認にする', () => {
  const document = documentFixture();
  const result = applyCharacterReadOutcomes(document, new Map([['region-1', {
    ok: true,
    candidateId: 'person-a',
    confidence: 'low',
    expressionReading: {...noFace, target_face_id: face.face_id, faces: [face]},
    action: 'Facing front. Short straight closed mouth.',
    suggestedSize: 'full',
    reason: '髪型は近いが顔が簡略化されている',
  }]]));
  assert.deepEqual(result, { applied: 2, needsReview: 1 });
  for (const panel of document.manga.pages[0].panels) {
    assert.equal(panel.figures[0].name, 'A');
    assert.equal(panel.figures[0].action, 'Facing front. Short straight closed mouth.');
    assert.deepEqual(panel.figures[0].analogImport.expressionReading.faces, [face]);
    assert.equal(panel.figures[0].size, 'full');
    assert.equal(panel.figures[0].analogImport.analysisReview, 'low-confidence');
    assert.equal(panel.figures[0].analogImport.userEdited, undefined);
  }
});

test('人物・演技の読み取り失敗を黄色表示用のエラーとして保持する', () => {
  const document = documentFixture();
  const result = applyCharacterReadOutcomes(document, new Map([['region-1', { ok: false, error: 'VLMに接続できません' }]]));
  assert.deepEqual(result, { applied: 0, needsReview: 1 });
  assert.equal(document.manga.pages[0].panels[0].figures[0].analogImport.analysisReview, 'error');
  assert.equal(document.manga.pages[0].panels[0].figures[0].analogImport.analysisReviewMessage, 'VLMに接続できません');
});

// 画像の役割やタグは再送せず、顔がないときも照合結果は残す。模擬HTTPと画像変換で実際の送信欄・応答の選別を確認。VLMは使わない。
test('照合要求は人物の観察語とIDだけを送り、空の演技と顔なしを受け取る', async t => {
  const originalWindow = globalThis.window, originalReader = globalThis.FileReader;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.FileReader = class { readAsDataURL() { this.result = 'data:image/png;base64,iVBORw0KGgo='; this.onload(); } };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalReader === undefined) delete globalThis.FileReader; else globalThis.FileReader = originalReader;
  });
  let analysis = { expression: {...noFace, tag_hints: [{tag: 'smile'}]}, pose: {} };
  const candidates = [{id: 'a', name: '名前', aliases: ['別名'], observedTraits: ['顎までのボブ']}];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const common = {ok: true, service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3};
    if (String(url).endsWith('/api/health')) return Response.json(common);
    assert.ok(String(url).endsWith('/api/character-match/analyze'));
    assert.deepEqual(JSON.parse(options.body).candidates, [{id: 'a', observed_traits: ['顎までのボブ']}]);
    return Response.json({...common, analyzer: {provider: 'local', runtime: 'mlx-vlm'}, action: '', analysis,
      candidate_id: 'a', confidence: 'medium', suggested_size: 'face'});
  });
  const read = () => analyzeFigureCharacterMatchWithLocalVlm(new Blob([]), candidates, 'face');
  const result = await read();
  assert.equal(result.action, '');
  assert.equal(result.candidateId, 'a');
  assert.deepEqual(result.expressionReading, noFace);
  analysis = {expression: {faces: []}};
  await assert.rejects(read, /人物表情/);
});

// 所属の決められない2顔は両方の根拠を残し、古い生成案を現在の演技欄へ戻さない。通常の作品用YAMLの往復・公開形式を確認（作品の実保存なし）。
test('複数顔の要確認と部位記録を作品で保持し、公開OMNYには現在の演技だけを出す', () => {
  const doc = emptyTestDocument(), fixture = documentFixture().manga;
  doc.manga.characters = fixture.characters;
  doc.manga.pages = fixture.pages;
  const reading = {...noFace, faces: [face, {...face, face_id: 'face_02'}]};
  const result = applyCharacterReadOutcomes(doc, new Map([['region-1', {
    ok: true, candidateId: 'person-a', confidence: 'high', suggestedSize: 'waist-up', reason: '',
    action: 'Standing.', expressionReading: reading,
  }]]));
  assert.deepEqual(result, {applied: 2, needsReview: 1});
  const first = doc.manga.pages[0].panels[0].figures[0];
  first.action = '手動で口を閉じる。';
  const reopened = parseMangaYaml(toStoredMangaYaml(doc));
  for (const [index, panel] of reopened.manga.pages[0].panels.entries()) {
    const f = panel.figures[0];
    assert.equal(f.analogImport.analysisReview, 'low-confidence');
    assert.equal(f.action, index ? 'Standing.' : '手動で口を閉じる。');
    assert.deepEqual(f.analogImport.expressionReading, reading);
  }
  const omny = toMangaYaml(reopened);
  assert.match(omny, /手動で口を閉じる/);
  assert.doesNotMatch(omny, /S050|face_02|short straight closed mouth|catalog_sha256/i);
});
