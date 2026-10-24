import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCharacterMatchAssignments, applyCharacterReadOutcomes, buildCharacterMatchCandidates, collectUnmatchedCharacterTargets } from '../src/lib/characterMatching.ts';

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

test('照合候補には人物あたりを含めず観察済み特徴だけを渡す', () => {
  const candidates = buildCharacterMatchCandidates(documentFixture().manga.characters);
  assert.deepEqual(candidates, [{ id: 'person-a', name: 'A', aliases: [], observedTraits: ['短いボブ'] }]);
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

test('新規作成時の人物・演技を反映し、低信頼だけ要確認にする', () => {
  const document = documentFixture();
  const result = applyCharacterReadOutcomes(document, new Map([['region-1', {
    ok: true,
    candidateId: 'person-a',
    confidence: 'low',
    action: '正面を向いて立っている。',
    suggestedSize: 'full',
    reason: '髪型は近いが顔が簡略化されている',
  }]]));
  assert.deepEqual(result, { applied: 2, needsReview: 1 });
  for (const panel of document.manga.pages[0].panels) {
    assert.equal(panel.figures[0].name, 'A');
    assert.equal(panel.figures[0].action, '正面を向いて立っている。');
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
