import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseSeriesTitleText, parseStoryReferenceText } from '../src/lib/settingTextImport.ts';
import { parseCharacterText } from '../src/lib/characterTextCatalog.ts';
import { seriesReferenceConfirmationState } from '../src/lib/seriesReferenceCandidates.ts';
import { parseScenario, applyScenarioToNewDocument } from '../src/lib/scenario.ts';
import { parseMangaYaml, newPage, toSeparatedMangaYaml } from '../src/lib/manga.ts';
import { attachRecognizedTextToPage } from '../src/lib/localBridge.ts';
import { initializePanelBackgrounds } from '../src/lib/panelContext.ts';
import { initializeImportedBubbleLineBreaks } from '../src/lib/initialBubbleLineBreaks.ts';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { defaultPrintSetup, withPrintSetup } from '../src/lib/printSettings.ts';
import { createSystemMobCharacter } from '../src/lib/systemCharacters.ts';

const source = readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Exercise the actual handlers with state setters and bridge calls substituted;
// this test must not open a folder picker or write a series catalog.
function handler(name, context) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(initializer, name);
  const js = ts.transpileModule(`(${initializer.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return runInNewContext(js, { isLanClient: false, ...context });
}

function stateSetters(state, names) {
  return Object.fromEntries(names.map(name => [`set${name}`, value => {
    state[name] = typeof value === 'function' ? value(state[name]) : value;
  }]));
}

test('フォルダの選択だけではシリーズ名を入力せず、反映済みの名称も保つ', async () => {
  for (const initial of ['', '反映済みのシリーズ名']) {
    const state = { NewSeriesName: initial };
    const choose = handler('chooseNewSeriesDirectory', {
      ...stateSetters(state, ['NewSeriesName', 'NewSeriesDirectorySelecting', 'NewSeriesDirectoryMessage',
        'NewSeriesDirectory', 'NewSeriesReference', 'NewSeriesReferences',
        'NewSeriesReferenceCandidates', 'NewSelectedSeriesReferencePaths', 'NewSeriesReferenceMessage']),
      newSeriesDirectorySelecting: false, newSeriesMode: 'new', newSeriesName: initial,
      newSeriesDirectory: '', newEpisodeWorkspace: null,
      chooseSeriesDirectory: async () => ({ seriesDirectory: '/fixture/folder-name', candidates: [] }),
      savedWorkspaceRoot: () => '', workspaceRootKey: () => 'fixture', rememberWorkspaceRoot: () => {},
      seriesReferenceConfirmationState,
    });
    await choose();
    assert.equal(state.NewSeriesDirectory, '/fixture/folder-name');
    assert.equal(state.NewSeriesName, initial);
    assert.equal(state.NewSeriesDirectoryMessage, '');
  }
});

const episodeText = '# 星の喫茶室\n\n- サブタイトル：雨の日\n- 話数：第2話\n- 場所：喫茶店\n- 時間帯：夕方\n- 天候：雨\n\n## あらすじ\n主人公が友人を待っている。';
const seriesTitleFromReferences = handler('seriesTitleFromReferences', {
  parseSeriesTitleText, detectedSeriesReferenceKind: reference => reference.kind,
});

async function readEpisode(mode, text = episodeText, references = []) {
  const state = {
    NewSeriesName: mode === 'existing' ? '登録済みシリーズ' : '', NewWorkTitle: '',
    NewWorkSetting: { location: '', time: '', weather: '', situation: '' },
  };
  const read = handler('readNewReferenceFile', {
    ...stateSetters(state, ['NewSourceSnapshot', 'NewReferenceFileName', 'NewSuggestedEpisodeReference',
      'NewReferenceMessage', 'NewSeriesName', 'NewWorkTitle', 'NewEpisodeNumber', 'NewWorkSetting', 'NewSettingMessage']),
    newSeriesMode: mode, newEpisodeWorkspace: { directory: '/fixture/no.2' }, parseStoryReferenceText, parseScenario,
    newSeriesReferences: references, seriesTitleFromReferences,
  });
  await read({ file: new File([text], 'origin_name.md'), relativePath: 'text/origin_name.md', byteSize: new TextEncoder().encode(text).length, sha256: null });
  return state;
}

test('原稿の明示反映で本文のシリーズ名・各話情報と読み込み結果を揃える', async () => {
  const state = await readEpisode('new');
  assert.equal(state.NewSeriesName, '星の喫茶室');
  assert.equal(state.NewWorkTitle, '雨の日');
  assert.equal(state.NewEpisodeNumber, '第2話');
  assert.equal(state.NewWorkSetting.location, '喫茶店');
  assert.equal(state.NewWorkSetting.situation, '主人公が友人を待っている。');
  assert.equal(state.NewReferenceMessage, 'origin_name.mdからタイトル・サブタイトル・話数・舞台設定を読み込みました。');
  assert.equal(state.NewSourceSnapshot.source.text, episodeText);
  assert.equal(state.NewSuggestedEpisodeReference, null);
});

function applySeries(references, { mode = 'new', initial = '', episodeSource = null, lan = false } = {}) {
  const state = { NewSeriesName: initial };
  const apply = handler('applyNewSeriesReferenceSelections', {
    isLanClient: lan, newSeriesName: initial,
    ...stateSetters(state, ['NewSeriesName', 'NewSeriesDirectory', 'NewSeriesReference', 'NewSeriesReferences',
      'NewSeriesReferenceCandidates', 'NewSelectedSeriesReferencePaths', 'NewSeriesReferenceMessage']),
    newSeriesMode: mode, newSourceSnapshot: episodeSource ? { source: { text: episodeSource } } : null,
    seriesTitleFromReferences, parseStoryReferenceText, parseCharacterText,
    detectedSeriesReferenceKind: reference => reference.kind,
    rememberWorkspaceRoot: () => {}, workspaceRootKey: () => 'fixture',
  });
  apply(references);
  return state;
}

const namedSeries = [{ kind: 'series-setting', seriesDirectory: '/fixture', relativePath: 'series_setting.md',
  fileName: 'series_setting.md', text: '# シリーズ設定\nシリーズ名：共通の作品名\nジャンル：SF' }];

test('シリーズ資料の明示反映でもシリーズ名を読み込み、両資料の順序によらず共通名を優先する', async () => {
  const series = applySeries(namedSeries);
  assert.equal(series.NewSeriesName, '共通の作品名');
  assert.match(series.NewSeriesReferenceMessage, /シリーズ名/);
  assert.equal((await readEpisode('new', episodeText, namedSeries)).NewSeriesName, '共通の作品名');
  assert.equal(applySeries(namedSeries, { initial: '星の喫茶室', episodeSource: episodeText }).NewSeriesName, '共通の作品名');
  assert.equal(applySeries(namedSeries, { mode: 'existing', initial: '保存済みの作品名' }).NewSeriesName, '保存済みの作品名');
});

test('タイトルのないシリーズ資料は設定という仮名を作らず、反映済み原稿があれば補完する', () => {
  const unnamed = [{ ...namedSeries[0], text: '# シリーズ設定\n## ジャンル\n現代SF' }];
  assert.equal(applySeries(unnamed, { initial: '差替え前の名前' }).NewSeriesName, '');
  assert.equal(applySeries(unnamed, { episodeSource: episodeText }).NewSeriesName, '星の喫茶室');
});

test('既存シリーズの名前は変更せず、読み切りは各話タイトルを作品名にする', async () => {
  const existing = await readEpisode('existing');
  assert.equal(existing.NewSeriesName, '登録済みシリーズ');
  assert.equal(existing.NewWorkTitle, '雨の日');
  const oneShot = await readEpisode('none');
  assert.equal(oneShot.NewSeriesName, '');
  assert.equal(oneShot.NewWorkTitle, '雨の日');
});

test('本文にないタイトル・話数を読み込んだと通知しない', async () => {
  const state = await readEpisode('new', '## あらすじ\n友人と再会する。');
  assert.equal(state.NewSeriesName, '');
  assert.equal(state.NewReferenceMessage, 'origin_name.mdから舞台設定を読み込みました。');
});

test('新規作成の実handlerはシナリオだけでも読み込み、作品名やあらすじに混ぜない', async () => {
  const text = '# シナリオ\n## page1\n### コマ1\n春「**またね**」\n春は振り向く。';
  const state = await readEpisode('new', text);
  assert.equal(state.NewSeriesName, '');
  assert.equal(state.NewWorkSetting.situation, '');
  assert.equal(state.NewSourceSnapshot.source.text, text);
  assert.equal(state.NewReferenceMessage, 'origin_name.mdからシナリオ（1コマ・セリフ1件）を読み込みました。');
});

test('新規作成の人物ドラフトはサンプル作品の作画指定を引き継がない', () => {
  const draft = handler('createNewCharacterDraft', {
    createEmptyWorkspaceDocument, createSystemMobCharacter, crypto, structuredClone,
    newWorkTitle: '新しい話', newEpisodeNumber: '第1話',
    newLayoutFrameLineWidthMm: 1, newLayoutRowGapMm: 5, newLayoutColumnGapMm: 3,
    emptyNewSeriesSetting: () => ({ genre: '', target_audience: '', adult_content: false, location: '', time: '', weather: '', situation: '' }),
    emptyNewWorkSetting: () => ({ location: '', time: '', weather: '', situation: '' }),
    newPage,
  })('新しいシリーズ', 'series-new');
  assert.equal(draft.manga.meta.title, '新しい話');
  assert.equal(draft.manga.meta.series, '新しいシリーズ');
  assert.equal(draft.manga.meta.style_notes.length, 0);
  assert.equal(draft.manga.layout_spec, '');
});

test('作成の実handlerはOCR配置と人物統合の後に正本を反映し、旧文字列監査は実行しない', async () => {
  const sampleYaml = readFileSync(new URL('../src/content/sample.omny.yaml', import.meta.url), 'utf8');
  const characterDraft = parseMangaYaml(sampleYaml);
  characterDraft.manga.characters = [{ name: 'ハル', aliases: ['春'], scope: 'episode', role: '', localId: 'haru' }];
  const reference = { source: { fileName: 'origin_name.md', text: '# シナリオ\n## page1\n### コマ1\n春「明日は**学校**へ行こう」\n春は窓を指す。', relativePath: 'text/origin_name.md' }, workspaceDirectory: '/fixture/episode' };
  const analysis = { detectedPanels: [{ type: 'rect', x: 10, y: 10, w: 80, h: 100 }], detectedPanelIds: ['p1'], detectedFigures: [], sourceFrame: null,
    ocrLines: [{ id: 'l1', text: '明日は学枚へ\n行こう', bbox: { x: .2, y: .2, w: .1, h: .2 }, sourcePanelId: 'p1', vertical: true, source: 'Baberu OCR', confidence: .5, needsReview: true }] };
  for (const mode of ['scan', 'template', 'blank']) {
    const state = {};
    const events = [];
    const progress = [];
    const create = handler('createNewDocument', {
      isLanClient: false, portableBinding: { current: null }, setPortableName: () => {},
      ...stateSetters(state, ['NewLayoutMessage', 'NewCharacterTextLink', 'BoundEpisodeWorkspace', 'BoundSourceSnapshot', 'SourceCoverageDecisions', 'CharacterTextLink', 'ActivePage', 'ActivePanel', 'SelectedPanels', 'SelectedElement', 'Tab', 'MobileStoryboardPane', 'ShowNewDialog', 'NewCharacterDocument', 'Toast']),
      newPrintConfirmed: true, editingNewPrintSetup: false, newPrintSetup: { ...defaultPrintSetup(), width_mm: 297, height_mm: 210 }, withPrintSetup,
      newLayoutTask: 'idle', newLayoutOperationGeneration: { current: 0 }, updateNewLayoutTask: () => {},
      setNewCharacterReadProgress: value => { progress.push(value); }, initializePanelBackgrounds,
      newEpisodeWorkspace: { token: 'fixture', directory: '/fixture/episode' },
      prepareEpisodeWorkspace: async () => {}, newLayoutItemsRef: { current: mode === 'blank' ? [] : [{ id: 'img', file: { name: 'test.png' }, analysis, rotationOverride: 0 }] },
      newCharacterDocumentRef: { current: characterDraft }, newSourceSnapshot: reference,
      deleteFigureCropAssets: async () => {}, saveFigureCropAssets: async () => {}, prepareDetectedTextCrops: async () => [],
      persistAnalogAssets: false, discardScannerSources: async () => {}, commitActiveScannerSession: async () => {},
      createEmptyWorkspaceDocument, newPage, attachRecognizedTextToPage,
      newLayoutRowGapMm: 5, newLayoutColumnGapMm: 5, newLayoutFrameLineWidthMm: 1,
      newWorkTitle: 'テスト', newSeriesName: '', newSeriesId: '', newEpisodeNumber: '',
      newWorkSetting: { location: '', time: '', weather: '', situation: '' },
      inferPanelGutters: () => ({ rowGapMm: 5, columnGapMm: 5 }), DEFAULT_PANEL_GUTTERS: {},
      applyPanelTemplate: page => { page.panels = [{ id: 1, bg: 1, action: null, shape: analysis.detectedPanels[0], bubbles: [] }]; },
      mergeSavedSeriesCatalog: async document => { events.push('merge'); return { document, added: 0 }; },
      collectUnmatchedCharacterTargets: () => mode === 'scan' ? [{ sourceRegionId: 'f1', assetId: 'a1' }, { sourceRegionId: 'f2', assetId: 'a2' }] : [], buildCharacterMatchCandidates: () => [],
      loadFigureCropAsset: async () => ({}), analyzeFigureCharacterMatchWithLocalVlm: async () => {
        assert.equal(progress.at(-1).completed, progress.length - 1);
        assert.equal(progress.at(-1).total, 2);
        return { action: '正面を向く。' };
      },
      applyCharacterReadOutcomes: () => { events.push('people'); return { needsReview: 0 }; },
      applyScenarioToNewDocument: (document, source) => { events.push('scenario'); return applyScenarioToNewDocument(document, source); },
      initializeImportedBubbleLineBreaks: document => { events.push('linebreaks'); initializeImportedBubbleLineBreaks(document); },
      newCharacterTextLink: null, commitNewCharacterDraft: async () => {},
      buildSourceCoverageReport: () => assert.fail('scenario must not run legacy string audit'),
      saveSourceCoverageReport: () => assert.fail('scenario must not save legacy audit'),
      endNewCreationBridgeSession: async () => {}, lastHistoryPush: { current: 0 },
      replaceDocument: document => { state.document = document; events.push('replace'); },
      discardNewLayoutItems: () => {}, structuredClone, crypto, toSeparatedMangaYaml,
    });
    await create(mode === 'scan' ? [{ sourceItemId: 'img', analysis }] : mode === 'template' ? { id: 'test' } : undefined);
    assert.deepEqual(events, ['merge', 'people', 'scenario', 'linebreaks', 'replace']);
    assert.equal(state.document.manga.pages.length, mode === 'scan' ? 1 : 4);
    assert.ok(state.document.manga.pages.every(page => page.canvas.w === 297 && page.canvas.h === 210));
    assert.equal(state.document.manga.finish_settings.width_mm, 297);
    if (mode === 'scan') assert.equal(progress.at(-1).completed, progress.at(-1).total);
    else assert.equal(progress.at(-1), null);
    assert.equal(state.document.manga.scenario.text, reference.source.text);
    assert.equal(state.document.manga.pages[0].panels[0].action, '春は窓を指す。');
    assert.equal(state.document.manga.meta.style_notes.length, 0);
    assert.equal(state.document.manga.layout_spec, '');
    if (mode !== 'blank') {
      const bubble = state.document.manga.pages[0].panels[0].bubbles[0];
      assert.equal(bubble.text.replaceAll('\n', ''), '明日は学校へ行こう');
      assert.match(bubble.text, /\n/);
      assert.equal(bubble.emphasis, '学校');
      assert.equal(bubble.speakerId, 'haru');
      assert.doesNotMatch(state.Toast, /文字要確認/);
    }
  }
});

test('LAN series material import retains a manually entered name when the file has no title', () => {
  const unnamed = [{ kind: 'series-setting', seriesDirectory: '', relativePath: 'setting.txt', fileName: 'setting.txt', text: 'ジャンル：SF' }];
  assert.equal(applySeries(unnamed, { initial: '手入力のシリーズ', lan: true }).NewSeriesName, '手入力のシリーズ');
});

for (const isLanClient of [false, true]) test(`new creation requires an episode folder in ${isLanClient ? 'LAN' : 'native'} mode`, async () => {
  const messages = [], tasks = [];
  const context = {
    isLanClient, newEpisodeWorkspace: null, newSeriesPreparing: false,
    newLayoutTask: 'idle', newPrintConfirmed: true, editingNewPrintSetup: false,
    newLayoutOperationGeneration: { current: 0 },
    updateNewLayoutTask: value => tasks.push(value),
    setNewLayoutMessage: value => messages.push(value),
    setNewWorkspaceMessage: value => messages.push(value),
  };
  await handler('continueFromSeriesSelection', context)();
  await handler('createNewDocument', context)();
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => /保存先/.test(message)));
  assert.equal(tasks.at(-1), 'idle');
});

function removeSeriesReferences({ applied = [], candidates = [], selected = [], busy = '' }) {
  const state = { NewSeriesReferences: applied, NewSeriesReferenceCandidates: candidates,
    NewSeriesReference: applied.find(item => item.kind === 'characters') ?? null,
    NewSelectedSeriesReferencePaths: selected, NewCharacterTextLink: { linked: true }, NewSeriesName: '手入力の作品名', NewSeriesReferenceMessage: undefined };
  const context = {
    newSeriesReferences: applied, newSeriesReferenceCandidates: candidates,
    newSeriesReference: state.NewSeriesReference, newSelectedSeriesReferencePaths: selected,
    newSeriesReferenceSelecting: false, newSeriesDirectorySelecting: false, newSeriesPreparing: false, newWorkspaceSelecting: false,
    detectedSeriesReferenceKind: reference => reference.kind,
    ...stateSetters(state, ['NewSeriesReferences', 'NewSeriesReferenceCandidates', 'NewSeriesReference',
      'NewSelectedSeriesReferencePaths', 'NewCharacterTextLink', 'NewSeriesReferenceMessage']),
  };
  if (busy) context[busy] = true;
  handler('removeSelectedNewSeriesReferences', context)();
  return state;
}
const referenceRows = [
  { relativePath: '人物A.txt', kind: 'characters' },
  { relativePath: '人物B.txt', kind: 'characters' },
  { relativePath: '舞台.txt', kind: 'series-setting' },
];

test('registered references can be removed together without resurrecting the character fallback or changing the title', () => {
  const state = removeSeriesReferences({ applied: referenceRows, selected: ['人物A.txt', '舞台.txt'] });
  assert.deepEqual(state.NewSeriesReferences.map(item => item.relativePath), ['人物B.txt']);
  assert.equal(state.NewSeriesReference.relativePath, '人物B.txt');
  assert.equal(state.NewCharacterTextLink, null);
  assert.equal(state.NewSeriesName, '手入力の作品名');
  assert.equal(state.NewSelectedSeriesReferencePaths.length, 0);
  assert.match(state.NewSeriesReferenceMessage, /2件/);
  const empty = removeSeriesReferences({ applied: state.NewSeriesReferences, selected: ['人物B.txt'] });
  assert.equal(empty.NewSeriesReference, null);
  assert.equal(empty.NewSeriesReferences.length, 0);
});

test('removing pending references also removes their applied versions and preserves unchecked files', () => {
  const added = { relativePath: '新しい資料.txt', kind: 'series-reference' };
  const state = removeSeriesReferences({ applied: referenceRows, candidates: [...referenceRows, added], selected: ['人物A.txt', added.relativePath, '存在しない.txt'] });
  assert.deepEqual(state.NewSeriesReferenceCandidates.map(item => item.relativePath), ['人物B.txt', '舞台.txt']);
  assert.deepEqual(state.NewSeriesReferences.map(item => item.relativePath), ['人物B.txt', '舞台.txt']);
  assert.match(state.NewSeriesReferenceMessage, /2件/);
  const replacement = removeSeriesReferences({ applied: referenceRows, candidates: [added, ...referenceRows.slice(1)], selected: [added.relativePath] });
  assert.deepEqual(replacement.NewSeriesReferences.map(item => item.relativePath), ['人物B.txt', '舞台.txt']);
  assert.equal(replacement.NewSeriesReference.relativePath, '人物B.txt');
  const empty = removeSeriesReferences({ applied: [referenceRows[0]], candidates: [added], selected: [added.relativePath] });
  assert.equal(empty.NewSeriesReferenceCandidates.length, 0);
  assert.equal(empty.NewSeriesReferences.length, 0);
  assert.equal(empty.NewSeriesReference, null);
});

test('reference removal does nothing without a matching selection or during file operations', () => {
  for (const busy of ['', 'newSeriesReferenceSelecting', 'newSeriesDirectorySelecting', 'newSeriesPreparing', 'newWorkspaceSelecting']) {
    const state = removeSeriesReferences({ applied: referenceRows, selected: busy ? ['人物A.txt'] : ['存在しない.txt'], busy });
    assert.equal(state.NewSeriesReferences, referenceRows);
    assert.equal(state.NewSeriesReferenceMessage, undefined);
  }
});
