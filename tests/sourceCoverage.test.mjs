import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildSourceCoverageReport,
  canonicalizeSourceText,
  decisionForReport,
  extractOmnyCoverageTargets,
  extractSourceUnits,
  MAX_CANDIDATES_PER_UNIT,
} from '../src/lib/sourceCoverage.ts';

function makeDocument() {
  return {
    manga: {
      schema_name: 'Nyamuru Data Model',
      schema_version: 10.33,
      meta: {
        document_type: 'story',
        title: '雨の手紙',
        series: '喫茶店日記',
        series_id: 'series-one',
        episode_number: '第1話',
        episode_id: 'episode-one',
        author: '',
        format: 'monochrome',
        page_count: 1,
        reading_direction: 'right-to-left',
        text_orientation: 'vertical',
        font: 'アンチック体',
        bubble_line_width_mm: 0.5,
        panel_frame_width_mm: 1,
        panel_gutter_row_mm: 5,
        panel_gutter_column_mm: 5,
        style_notes: ['coverage対象外'],
      },
      layout_spec: 'coverage対象外',
      series_setting: {
        genre: '日常', target_audience: '一般', adult_content: false,
        location: '', time: '', weather: '', situation: '手紙が人をつなぐ世界。',
      },
      setting: {
        location: '海沿いの古い喫茶店', time: '夕方', weather: '雨',
        situation: '閉店間際、主人公が十年前の手紙を見つける。',
      },
      characters: [
        { name: '有栖', role: '主人公', scope: 'series', aliases: ['アリス'] },
        { name: '店主', role: '脇役', scope: 'episode', aliases: [] },
      ],
      materials: [{ key: '古い手紙', type: 'prop', scope: 'episode', keywords: ['封蝋'], note: '黄ばんだ紙' }],
      pages: [{
        page: 1,
        canvas: { w: 210, h: 297, unit: 'mm' },
        panels: [
          {
            id: 1,
            shape: { type: 'rect', x: 10, y: 10, w: 90, h: 100 },
            bg: 1,
            background_description: '雨粒のついた窓と古い木のカウンター',
            figures: [{ name: '有栖', action: '濡れた封筒を両手で開く' }],
            bubbles: [
              { speaker: '有栖', text: 'おはよう' },
              { speaker: '有栖', text: '世界' },
              { speaker: '有栖', text: 'また会えたね' },
            ],
            screen_text: [{ text: '十年前' }],
            action: '有栖が古い手紙を見つける',
          },
          {
            id: 2,
            shape: { type: 'rect', x: 110, y: 10, w: 90, h: 100 },
            bg: 0,
            bubbles: [{ speaker: '店主', text: 'はい' }, { speaker: '有栖', text: 'はい' }],
            action: null,
          },
        ],
        page_overlay: {
          frame: false,
          layer: 'above_panel_frames',
          figures: [{ name: '店主', action: '入口を振り返る' }],
          bubbles: [{ speaker: '店主', text: 'いらっしゃい' }],
        },
      }],
    },
  };
}

test('source canonicalizationはBOMと改行だけを正規化し不正Unicodeを拒否する', () => {
  assert.equal(canonicalizeSourceText('\uFEFF一行目\r\n二行目\r三行目'), '一行目\n二行目\n三行目');
  assert.throws(() => canonicalizeSourceText('bad\0text'), /NUL/);
  assert.throws(() => canonicalizeSourceText(`bad${String.fromCharCode(0xD800)}`), /surrogate/);
});

test('全非空行を一度だけunit化しfenceとseparatorをexcludedにする', () => {
  const units = extractSourceUnits('# 雨の手紙\n\n場所：喫茶店\n```js\nalert(1)\n```\n---\n本文');
  assert.deepEqual(units.map((unit) => unit.line), [1, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(units.filter((unit) => unit.kind === 'excluded').map((unit) => unit.line), [4, 5, 6, 7]);
  assert.equal(units[1].matchText, '喫茶店');
  assert.throws(() => extractSourceUnits('あ'.repeat(2_001)), /2,000文字/);
  assert.throws(() => extractSourceUnits('\n```\ncode\n```\n'), /監査できる本文行/);
});

test('OMNYからcontextとstoryboardの対象を分離して全対象種を抽出する', async () => {
  const targets = await extractOmnyCoverageTargets(makeDocument());
  const kinds = new Set(targets.map((target) => target.kind));
  for (const kind of [
    'meta_title', 'setting_situation', 'character_alias', 'material_keyword',
    'panel_action', 'panel_background', 'figure_action', 'bubble', 'bubble_sequence',
    'screen_text', 'overlay_figure_action',
  ]) assert.ok(kinds.has(kind), `missing target kind: ${kind}`);
  assert.ok(targets.find((target) => target.kind === 'setting_situation')?.layer === 'context_retained');
  assert.ok(targets.find((target) => target.kind === 'panel_action')?.layer === 'storyboard_evidenced');
  assert.ok(!targets.some((target) => target.value.includes('coverage対象外')));
});

test('一意の台詞・speaker alias・隣接bubbleをconfirmedにする', async () => {
  const report = await buildSourceCoverageReport({
    fileName: 'episode.md', relativePath: 'origin_data/episode.md',
    text: 'アリス：また会えたね\n有栖：おはよう世界\n雨粒のついた窓と古い木のカウンター',
  }, makeDocument());
  assert.deepEqual(report.source_units.map((unit) => unit.status), ['confirmed', 'confirmed', 'confirmed']);
  const sequenceTarget = report.targets.find((target) => target.target_id === report.source_units[1].candidate_target_ids[0]);
  assert.equal(sequenceTarget?.kind, 'bubble_sequence');
});

test('話者の異なる隣接bubbleを単一話者の台詞とは確認しない', async () => {
  const report = await buildSourceCoverageReport({
    fileName: 'episode.md', relativePath: null, text: '有栖：はいはい',
  }, makeDocument());
  assert.equal(report.source_units[0].status, 'unverified');
});

test('OMNY側が12 code point以上の原文全体を含む場合だけsubstringでconfirmedにする', async () => {
  const report = await buildSourceCoverageReport({
    fileName: 'episode.md', relativePath: null,
    text: '背景：雨粒のついた窓と古い木の',
  }, makeDocument());
  assert.equal(report.source_units[0].status, 'confirmed');
  const target = report.targets.find((entry) => entry.target_id === report.source_units[0].candidate_target_ids[0]);
  assert.equal(target?.kind, 'panel_background');
});

test('OMNY targetが長い原文行の一部分だけなら候補を示してもconfirmedにしない', async () => {
  const report = await buildSourceCoverageReport({
    fileName: 'episode.md', relativePath: null,
    text: '有栖が古い手紙を見つける。しかしその後店が爆発し全員が死ぬ。',
  }, makeDocument());
  assert.equal(report.source_units[0].status, 'unverified');
  assert.equal(report.source_units[0].candidate_total, 1);
  assert.equal(report.summary.unresolved_after_review, 1);
  assert.equal(report.verdict, 'review_required');
});

test('setting.situationだけの一致はstoryboard coverageにせずcontext-onlyで要確認にする', async () => {
  const report = await buildSourceCoverageReport({
    fileName: 'plot.txt', relativePath: null,
    text: '閉店間際、主人公が十年前の手紙を見つける。',
  }, makeDocument());
  assert.equal(report.source_units[0].status, 'unverified');
  assert.equal(report.source_units[0].context_retained, true);
  assert.equal(report.verdict, 'review_required');
  assert.ok(report.warnings.includes('context_only_matches_require_storyboard_review'));
});

test('重複した短い台詞はambiguous、言い換えはunverifiedで欠落断定しない', async () => {
  const report = await buildSourceCoverageReport({
    fileName: 'script.txt', relativePath: null,
    text: 'はい\n彼女は封筒に手を伸ばした',
  }, makeDocument());
  assert.equal(report.source_units[0].status, 'ambiguous');
  assert.equal(report.source_units[1].status, 'unverified');
  assert.equal(report.summary.unverified, 1);
  assert.ok(!JSON.stringify(report).includes('missing'));
});

test('候補は32件までしかreportへ保持しないが総数は隠さない', async () => {
  const document = makeDocument();
  document.manga.pages[0].panels = Array.from({ length: 40 }, (_, index) => ({
    id: index + 1,
    shape: { type: 'rect', x: 0, y: 0, w: 10, h: 10 }, bg: 0,
    bubbles: [{ text: '同じ長い台詞を何度も繰り返す', speaker: '有栖' }], action: null,
  }));
  const report = await buildSourceCoverageReport({
    fileName: 'script.txt', relativePath: null, text: '同じ長い台詞を何度も繰り返す',
  }, document);
  assert.equal(report.source_units[0].candidate_target_ids.length, MAX_CANDIDATES_PER_UNIT);
  assert.equal(report.source_units[0].candidate_total, 40);
  assert.equal(report.source_units[0].status, 'ambiguous');
});

test('重複完全一致はsource unitごとに全target配列を再走査しない', async () => {
  const document = makeDocument();
  const duplicateText = '同じ完全一致候補を大量に並べる';
  document.manga.pages[0].panels = Array.from({ length: 200 }, (_, index) => ({
    id: index + 1,
    shape: { type: 'rect', x: 0, y: 0, w: 10, h: 10 }, bg: 0,
    bubbles: [], action: duplicateText,
  }));
  const originalFilter = Array.prototype.filter;
  Array.prototype.filter = function guardedExactBucketFilter(callback, thisArg) {
    if (this.length === 200 && this.every((entry) => entry?.match_key === duplicateText)) {
      throw new Error('full exact candidate bucket scan');
    }
    return originalFilter.call(this, callback, thisArg);
  };
  try {
    const report = await buildSourceCoverageReport({
      fileName: 'script.txt', relativePath: null,
      text: Array.from({ length: 100 }, () => duplicateText).join('\n'),
    }, document);
    assert.equal(report.source_units[0].candidate_total, 200);
    assert.equal(report.source_units[0].candidate_target_ids.length, MAX_CANDIDATES_PER_UNIT);
    assert.ok(report.source_units.every((unit) => unit.status === 'ambiguous'));
  } finally {
    Array.prototype.filter = originalFilter;
  }
});

test('一意内容のtarget IDはページ移動後も保ちlocatorだけが変わる', async () => {
  const beforeDocument = makeDocument();
  const before = await extractOmnyCoverageTargets(beforeDocument);
  const movedDocument = structuredClone(beforeDocument);
  const originalPage = movedDocument.manga.pages[0];
  movedDocument.manga.pages = [{
    page: 1, canvas: { w: 210, h: 297, unit: 'mm' },
    panels: [{ id: 1, shape: { type: 'rect', x: 0, y: 0, w: 20, h: 20 }, bg: 0, bubbles: [], action: '別の場面' }],
  }, { ...originalPage, page: 2 }];
  const after = await extractOmnyCoverageTargets(movedDocument);
  const beforeTarget = before.find((target) => target.value === '濡れた封筒を両手で開く');
  const afterTarget = after.find((target) => target.value === '濡れた封筒を両手で開く');
  assert.equal(beforeTarget?.target_id, afterTarget?.target_id);
  assert.notEqual(beforeTarget?.locator, afterTarget?.locator);
});

test('human decisionはsource/projection revisionへ結合され変更後はstaleになる', async () => {
  const source = { fileName: 'plot.txt', relativePath: null, text: '彼女は封筒に手を伸ばした' };
  const initial = await buildSourceCoverageReport(source, makeDocument());
  const decision = decisionForReport(initial, initial.source_units[0].source_unit_id, 'covered', '人が絵で確認');
  const current = await buildSourceCoverageReport(source, makeDocument(), { decisions: [decision] });
  assert.equal(current.human_decisions[0].stale, false);
  assert.equal(current.summary.unresolved_after_review, 0);
  const changedDocument = makeDocument();
  changedDocument.manga.pages[0].panels[0].action = '別の動作';
  const changed = await buildSourceCoverageReport(source, changedDocument, { decisions: [decision] });
  assert.equal(changed.human_decisions[0].stale, true);
  assert.equal(changed.summary.unresolved_after_review, 1);
});

test('human decisionはseries・episode・選択source identityが変わるとstaleになる', async () => {
  const source = { fileName: 'plot.txt', relativePath: 'origin_data/plot.txt', text: '未照合の原文' };
  const initialDocument = makeDocument();
  const initial = await buildSourceCoverageReport(source, initialDocument);
  const decision = decisionForReport(initial, initial.source_units[0].source_unit_id, 'not_applicable');

  const otherEpisodeDocument = makeDocument();
  otherEpisodeDocument.manga.meta.episode_id = 'episode-two';
  const otherEpisode = await buildSourceCoverageReport(source, otherEpisodeDocument, { decisions: [decision] });
  assert.equal(otherEpisode.human_decisions[0].stale, true);
  assert.equal(otherEpisode.summary.unresolved_after_review, 1);

  const movedSource = await buildSourceCoverageReport(
    { ...source, relativePath: 'origin_data/copied-plot.txt' },
    initialDocument,
    { decisions: [decision] },
  );
  assert.equal(movedSource.human_decisions[0].stale, true);
  assert.equal(movedSource.summary.unresolved_after_review, 1);
});

test('同じ入力ではreport、ID、順序が決定的で入力を変更しない', async () => {
  const source = { fileName: 'plot.md', relativePath: null, text: '# 雨の手紙\n有栖が古い手紙を見つける' };
  const document = makeDocument();
  const before = structuredClone(document);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network must not be used'); };
  try {
    const first = await buildSourceCoverageReport(source, document, { omnyYaml: 'stable omny' });
    const second = await buildSourceCoverageReport(source, document, { omnyYaml: 'stable omny' });
    assert.deepEqual(first, second);
    assert.deepEqual(document, before);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('strict schemaは全object定義でunknown fieldを拒否する', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/nyamuru-source-coverage-v1.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  const objectDefs = Object.values(schema.$defs).filter((entry) => entry?.type === 'object');
  assert.ok(objectDefs.length >= 7);
  assert.ok(objectDefs.every((entry) => entry.additionalProperties === false));
});
