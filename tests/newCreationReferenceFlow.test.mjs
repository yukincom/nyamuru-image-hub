import { beginFigureCropImport } from '../src/lib/figureCropStore.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { seriesTitleFromReferences } from '../src/lib/newProjectSettings.ts';
import { parseStoryReferenceText } from '../src/lib/settingTextImport.ts';
import { mergeCharacterTextCatalog, parseCharacterText, toCharacterTextMarkdown } from '../src/lib/characterTextCatalog.ts';
import { seriesReferenceConfirmationState } from '../src/lib/seriesReferenceCandidates.ts';
import { parseScenario, applyScenarioToNewDocument } from '../src/lib/scenario.ts';
import { cloneDocument, newPage, parseMangaYaml, toSeparatedMangaYaml, toSeriesCatalogMangaYaml } from '../src/lib/manga.ts';
import { mergeSeriesCatalog, prefillEpisodeSettingFromSeries } from '../src/lib/seriesCatalog.ts';
import { attachDetectedFiguresToPage, attachRecognizedTextToPage } from '../src/lib/localBridge.ts';
import { detectedFigureImport } from '../src/lib/analogFigureCrops.ts';
import { applyCharacterReadOutcomes, buildCharacterMatchCandidates, collectUnmatchedCharacterTargets } from '../src/lib/characterMatching.ts';
import { initializePanelBackgrounds } from '../src/lib/panelContext.ts';
import { initializeImportedBubbleLineBreaks } from '../src/lib/initialBubbleLineBreaks.ts';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { defaultPrintSetup, withPrintSetup } from '../src/lib/printSettings.ts';
import { resizePageCanvas } from '../src/lib/pageCanvas.ts';
import { innerFrameBounds } from '../src/lib/canvasGeometry.ts';
import { createSystemMobCharacter } from '../src/lib/systemCharacters.ts';
import { separateBubbleOriginals } from '../src/lib/bubbleOriginals.ts';
import { linkedTestDocument } from './fixtures/emptyTestDocument.ts';

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
  return runInNewContext(js, { isLanClient: false, beginFigureCropImport, ...context });
}

function stateSetters(state, names) {
  return Object.fromEntries(names.map(name => [`set${name}`, value => {
    state[name] = typeof value === 'function' ? value(state[name]) : value;
  }]));
}

// 見込み: 同じ操作世代でコマ解析→人物・表情読取→既存作成をつなぐと、一度の開始で編集へ到達する。
// 確認範囲: Appの実handler、実人物配置・結果反映を使用。画像の切り抜き、推論、ディスク書込は模擬で、実モデル精度は対象外。
function automaticImportFixture(sourceKind = 'manual') {
  const state = { ShowNewDialog: true }, tasks = [], progress = [], events = [];
  const draft = createEmptyWorkspaceDocument();
  draft.manga.characters = [{ localId: 'person', name: '人物', role: '', scope: 'episode' }];
  const region = { id: 'figure', source: 'body', sourcePanelId: 'panel', bbox: { x: .2, y: .2, w: .2, h: .4 } };
  const analysis = {
    detectedPanels: [{ type: 'rect', x: 10, y: 10, w: 180, h: 268 }], detectedPanelIds: ['panel'],
    detectedFigures: [region], ocrLines: [], sourceFrame: null,
  };
  const items = [{ id: 'page', file: { name: 'page.png' }, source: sourceKind, analysis: null, rotationOverride: 0 }];
  const context = {
    newLayoutTaskRef: { current: 'idle' }, newLayoutOperationGeneration: { current: 0 },
    newLayoutItemsRef: { current: items }, newPrintConfirmed: true, editingNewPrintSetup: false,
    newPrintSetup: defaultPrintSetup(), newLayoutRowGapMm: 5, newLayoutColumnGapMm: 5, newLayoutFrameLineWidthMm: 1,
    updateNewLayoutTask: task => { context.newLayoutTaskRef.current = task; tasks.push(task); },
    ...stateSetters(state, ['NewLayoutItems', 'NewLayoutMessage', 'NewLayoutActiveIndex', 'NewCharacterTextLink',
      'BoundEpisodeWorkspace', 'BoundSourceSnapshot', 'SourceCoverageDecisions', 'CharacterTextLink', 'ActivePage',
      'ActivePanel', 'SelectedPanels', 'SelectedElement', 'Tab', 'MobileStoryboardPane', 'ShowNewDialog', 'NewCharacterDocument', 'Toast']),
    setNewCharacterReadProgress: value => progress.push(value),
    newEpisodeWorkspace: { token: 'fixture', directory: '/fixture/episode' },
    newCharacterDocumentRef: { current: draft }, newSourceSnapshot: null, newCharacterTextLink: null,
    newWorkTitle: 'テスト', newSeriesName: '', newSeriesId: '', newEpisodeNumber: '',
    newWorkSetting: { location: '', time: '', weather: '', situation: '' },
    recognizePanelLayout: async () => { events.push('panels'); return analysis; },
    prepareEpisodeWorkspace: async () => events.push('prepare'),
    deleteFigureCropAssets: async () => {}, saveFigureCropAssets: async () => {}, persistAnalogAssets: false,
    commitActiveScannerSession: async () => events.push('commit-scan'),
    discardScannerSources: async () => events.push('discard-scan'),
    createEmptyWorkspaceDocument, newPage, withPrintSetup, resizePageCanvas, initializePanelBackgrounds,
    attachDetectedFiguresToPage, detectedFigureImport, collectUnmatchedCharacterTargets, buildCharacterMatchCandidates,
    detectedFigureCrops: async function* () {
      yield { regionId: region.id, original: async () => 'original-body', face: async () => 'original-face', forStorage: async () => ({}) };
    },
    mergeSavedSeriesCatalog: async document => ({ document, added: 0 }),
    analyzeFigureCharacterMatchWithLocalVlm: async (original, candidates, size, face) => {
      assert.equal(original, 'original-body');
      assert.equal(face, 'original-face');
      events.push('expression');
      return { candidateId: 'person', confidence: 'high', action: 'Half-lidded eyes and a straight closed mouth.',
        suggestedSize: 'bust-up', reason: '', expressionReading: { schemaVersion: 1, read_status: 'read', faces: [] } };
    },
    applyCharacterReadOutcomes, initializeImportedBubbleLineBreaks,
    separateBubbleOriginals: async document => document, commitNewCharacterDraft: async () => {},
    endNewCreationBridgeSession: async () => events.push('end-bridge'), lastHistoryPush: { current: 0 },
    replaceDocument: document => { state.document = document; events.push('editor'); },
    discardNewLayoutItems: () => {}, structuredClone, crypto, Error,
  };
  // Forward both handlers through the same context so task refs remain current across awaits.
  context.createNewDocument = (...args) => handler('createNewDocument', context)(...args);
  return { context, state, tasks, progress, events };
}

for (const sourceKind of ['manual', 'scanner']) {
  // 合格: 解析開始の1回で表情文が人物へ入り編集へ遷移。推論待ち中はcreating・進捗0/1、終了時1/1で、scanner確定は既存経路を通る。
  test(`${sourceKind}の解析開始だけで表情の完了を待ち、進捗を維持して編集へ進む`, async () => {
    const { context, state, tasks, progress, events } = automaticImportFixture(sourceKind);
    const infer = context.analyzeFigureCharacterMatchWithLocalVlm;
    let finishExpression;
    context.analyzeFigureCharacterMatchWithLocalVlm = (...args) => new Promise(resolve => {
      finishExpression = async () => resolve(await infer(...args));
    });
    const run = handler('analyzeNewLayouts', context);
    const completed = run();
    for (let attempt = 0; attempt < 100 && !finishExpression; attempt += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.ok(finishExpression, '既存の人物・表情読取へ到達すること');
    assert.equal(context.newLayoutTaskRef.current, 'creating');
    assert.equal(state.ShowNewDialog, true);
    assert.equal(state.document, undefined);
    assert.equal(progress.at(-1).completed, 0);
    assert.equal(progress.at(-1).total, 1);
    await run(); // A second click must not submit another analysis.
    assert.equal(events.filter(event => event === 'panels').length, 1);
    await finishExpression();
    await completed;
    assert.deepEqual(tasks, ['analyzing', 'creating', 'idle']);
    assert.equal(context.newLayoutOperationGeneration.current, 1);
    assert.equal(state.ShowNewDialog, false);
    assert.equal(state.Tab, 'storyboard');
    assert.equal(progress.at(-1).completed, 1);
    const figure = state.document.manga.pages[0].panels[0].figures[0];
    assert.equal(figure.action, 'Half-lidded eyes and a straight closed mouth.');
    assert.equal(figure.analogImport.expressionReading.read_status, 'read');
    assert.deepEqual(events, ['panels', 'prepare', 'expression', sourceKind === 'scanner' ? 'commit-scan' : 'discard-scan', 'end-bridge', 'editor']);
  });
}

// 合格: コマ未検出、API失敗、閉じた後の遅延応答では作成へ進まず、再試行できる状態や現在の操作を保つ。API応答のみ模擬。
test('コマ未検出・解析失敗・取消しでは自動遷移しない', async () => {
  for (const outcome of ['no-panels', 'error', 'cancelled']) {
    const { context, state, events } = automaticImportFixture();
    context.recognizePanelLayout = async () => {
      if (outcome === 'error') throw Error('解析失敗');
      if (outcome === 'cancelled') context.newLayoutOperationGeneration.current += 1;
      return { detectedPanels: [], ocrLines: [] };
    };
    await handler('analyzeNewLayouts', context)();
    assert.deepEqual(events, []);
    assert.equal(state.ShowNewDialog, true);
    assert.equal(state.document, undefined);
    if (outcome !== 'cancelled') assert.equal(context.newLayoutTaskRef.current, 'idle');
    if (outcome === 'error') assert.equal(context.newLayoutItemsRef.current[0].error, '解析失敗');
  }
});

// 合格: 古い世代の引継ぎは無視し、保存先準備の失敗は通知してidleへ戻す。既存作成handlerの入口とエラー処理を確認。
test('古い解析からの作成を拒否し、準備失敗では編集へ遷移しない', async () => {
  const { context, state, events } = automaticImportFixture();
  context.newLayoutTaskRef.current = 'analyzing';
  context.newLayoutOperationGeneration.current = 2;
  await context.createNewDocument([], false, 1);
  assert.deepEqual(events, []);
  context.newLayoutTaskRef.current = 'idle';
  context.prepareEpisodeWorkspace = async () => { throw Error('保存先の準備失敗'); };
  await handler('analyzeNewLayouts', context)();
  assert.equal(state.NewLayoutMessage, '保存先の準備失敗');
  assert.equal(context.newLayoutTaskRef.current, 'idle');
  assert.equal(state.ShowNewDialog, true);
  assert.equal(state.document, undefined);
});

test('手動のネーム画像は選択順によらずファイル名の数字順に並ぶ', () => {
  for (const [names, expected] of [
    [['スキャン 03.jpeg', 'スキャン 01.jpeg', 'スキャン 02.jpeg', 'スキャン 00.jpeg'],
      ['スキャン 00.jpeg', 'スキャン 01.jpeg', 'スキャン 02.jpeg', 'スキャン 03.jpeg']],
    [['page10.png', 'page2.png', 'page1.png'], ['page1.png', 'page2.png', 'page10.png']],
  ]) {
    const files = names.map(name => new File(['fixture'], name));
    const state = {};
    const itemsRef = { current: [] };
    const choose = handler('chooseNewLayoutImages', {
      newLayoutTask: 'idle', newLayoutOperationGeneration: { current: 0 },
      updateNewLayoutTask: () => {}, discardScannerSources: async () => {}, discardNewLayoutItems: () => {},
      crypto, URL: { createObjectURL: file => `blob:${file.name}` },
      newLayoutItemsRef: itemsRef, newLayoutImageInput: { current: null },
      ...stateSetters(state, ['NewLayoutItems', 'NewLayoutActiveIndex', 'NewLayoutMessage']),
    });
    choose(files);
    assert.deepEqual(Array.from(state.NewLayoutItems, item => item.file.name), expected);
    assert.equal(state.NewLayoutItems, itemsRef.current);
    assert.equal(state.NewLayoutActiveIndex, 0);
    assert.deepEqual(files.map(file => file.name), names);
  }
});

test('新規作成でも同じシリーズの人物画像を既存IDで引き継ぐ', async () => {
  const catalog = createEmptyWorkspaceDocument();
  catalog.manga.meta.series = '共通シリーズ';
  catalog.manga.meta.series_id = 'series-shared';
  catalog.manga.characters = [{
    localId: 'catalog-person', catalog_id: 'character-shared', name: '人物', role: '', scope: 'series',
    primary_material_catalog_id: 'material-shared',
  }];
  catalog.manga.materials = [{
    localId: 'catalog-material', catalog_id: 'material-shared', key: 'portrait.png', type: 'character',
    scope: 'series', keywords: [], characterId: 'catalog-person', character_catalog_id: 'character-shared',
    source_image: {
      schema_version: 1, asset_id: `image-${'a'.repeat(64)}`,
      file_name: `characters/character-shared/image-${'a'.repeat(64)}.png`, original_name: 'portrait.png',
      media_type: 'image/png', byte_size: 10, width_px: 1, height_px: 1, sha256: 'a'.repeat(64),
    },
  }];
  const mergeSavedSeriesCatalog = handler('mergeSavedSeriesCatalog', {
    cloneDocument, crypto, mergeSeriesCatalog, parseMangaYaml, structuredClone,
    emptyNewSeriesSetting: () => structuredClone(catalog.manga.series_setting),
    loadSeriesCatalog: async () => ({ found: true, seriesId: 'series-shared', omnyYaml: toSeriesCatalogMangaYaml(catalog) }),
  });
  const state = { NewWorkSetting: structuredClone(catalog.manga.setting) };
  const begin = handler('continueFromSeriesSelection', {
    newSeriesPreparing: false, newEpisodeWorkspace: { directory: '/fixture/episode-two' },
    newSeriesMode: 'new', newSeriesName: '共通シリーズ', newSeriesId: '', seriesCatalogs: [],
    crypto, mergeSavedSeriesCatalog, mergeCharacterTextCatalog, parseCharacterText, prefillEpisodeSettingFromSeries,
    newSeriesReferences: [{ text: toCharacterTextMarkdown(catalog) }], newSeriesReference: null,
    fillEmptySeriesSetting: value => value, seriesSettingFromImported: () => ({}), parseSeriesSettingText: () => ({}),
    createNewCharacterDraft: (name, id) => {
      const draft = createEmptyWorkspaceDocument();
      Object.assign(draft.manga.meta, { series: name, series_id: id, episode_id: 'episode-two' });
      return draft;
    },
    emptyNewSeriesSetting: () => structuredClone(catalog.manga.series_setting),
    beginSeriesCatalogDraft: async (_name, id) => { state.DraftSeriesId = id; return { token: 'draft' }; },
    newCharacterDraftSession: { current: null }, discardSeriesCatalogDraft: async () => {},
    ...stateSetters(state, ['NewSeriesPreparing', 'SeriesCatalogMessage', 'NewWorkSetting', 'NewSeriesName',
      'NewSeriesId', 'NewCharacterDocument', 'NewCharacterTextLink', 'NewCreationStep']),
  });
  await begin();
  assert.equal(state.SeriesCatalogMessage, '');
  assert.equal(state.NewCreationStep, 'characters');
  assert.equal(state.DraftSeriesId, 'series-shared');
  const restored = state.NewCharacterDocument;
  const owner = restored.manga.characters.find(c => c.catalog_id === 'character-shared');
  const image = restored.manga.materials.find(m => m.catalog_id === 'material-shared');
  assert.equal(image.source_image.sha256, 'a'.repeat(64));
  assert.equal(image.characterId, owner.localId);
  assert.equal(owner.primary_material_catalog_id, 'material-shared');
  assert.equal(restored.manga.materials.filter(m => m.source_image).length, 1);
});

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
  const characterDraft = linkedTestDocument();
  characterDraft.manga.characters = [{ name: 'ハル', aliases: ['春'], scope: 'episode', role: '', localId: 'haru' }];
  const reference = { source: { fileName: 'origin_name.md', text: '# シナリオ\n## page1\n### コマ1\n春「明日は**学校**へ行こう」\n春は窓を指す。', relativePath: 'text/origin_name.md' }, workspaceDirectory: '/fixture/episode' };
  const analysis = { detectedPanels: [{ type: 'rect', x: 10, y: 10, w: 80, h: 100 }], detectedPanelIds: ['p1'], detectedFigures: [], sourceFrame: null,
    ocrLines: [{ id: 'l1', text: '明日は学枚へ\n行こう', bbox: { x: .2, y: .2, w: .1, h: .2 }, sourcePanelId: 'p1', vertical: true, source: 'Baberu OCR', confidence: .5, needsReview: true }] };
  for (const paper of [{ w: 297, h: 210, dpi: 600 }, { w: 182, h: 257, dpi: 600 }, { w: 148, h: 210, dpi: 300 }]) for (const mode of ['scan', 'image', 'template', 'blank']) {
    const importedAnalysis = mode === 'scan' || mode === 'image'
      ? { ...analysis, detectedPanels: [{ type: 'rect', x: 15, y: 14.5, w: 180, h: 268 }] }
      : analysis;
    const state = {};
    const events = [];
    const progress = [];
    const create = handler('createNewDocument', {
      isLanClient: false, portableBinding: { current: null }, setPortableName: () => {},
      ...stateSetters(state, ['NewLayoutMessage', 'NewCharacterTextLink', 'BoundEpisodeWorkspace', 'BoundSourceSnapshot', 'SourceCoverageDecisions', 'CharacterTextLink', 'ActivePage', 'ActivePanel', 'SelectedPanels', 'SelectedElement', 'Tab', 'MobileStoryboardPane', 'ShowNewDialog', 'NewCharacterDocument', 'Toast']),
      newPrintConfirmed: true, editingNewPrintSetup: false, newPrintSetup: { ...defaultPrintSetup(), width_mm: paper.w, height_mm: paper.h, dpi: paper.dpi }, withPrintSetup, resizePageCanvas,
      newLayoutTaskRef: { current: 'idle' }, newLayoutOperationGeneration: { current: 0 }, updateNewLayoutTask: () => {},
      setNewCharacterReadProgress: value => { progress.push(value); }, initializePanelBackgrounds,
      newEpisodeWorkspace: { token: 'fixture', directory: '/fixture/episode' },
      prepareEpisodeWorkspace: async () => {}, newLayoutItemsRef: { current: mode === 'blank' ? [] : [{ id: 'img', file: { name: 'test.png' }, analysis: importedAnalysis, rotationOverride: 0 }] },
      newCharacterDocumentRef: { current: characterDraft }, newSourceSnapshot: reference,
      deleteFigureCropAssets: async () => {}, saveFigureCropAssets: async () => {}, prepareDetectedTextCrops: async () => [],
      persistAnalogAssets: false, discardScannerSources: async () => {}, commitActiveScannerSession: async () => {},
      createEmptyWorkspaceDocument, newPage, attachRecognizedTextToPage,
      newLayoutRowGapMm: 5, newLayoutColumnGapMm: 5, newLayoutFrameLineWidthMm: 1,
      newWorkTitle: 'テスト', newSeriesName: '', newSeriesId: '', newEpisodeNumber: '',
      newWorkSetting: { location: '', time: '', weather: '', situation: '' },
      inferPanelGutters: () => ({ rowGapMm: 5, columnGapMm: 5 }), DEFAULT_PANEL_GUTTERS: {},
      applyPanelTemplate: page => { page.panels = [{ id: 1, bg: 1, action: null, shape: { type: 'rect', ...innerFrameBounds(page.canvas) }, bubbles: [] }]; },
      mergeSavedSeriesCatalog: async document => { events.push('merge'); return { document, added: 0 }; },
      collectUnmatchedCharacterTargets: () => mode === 'scan' || mode === 'image' ? [{ sourceRegionId: 'f1', assetId: 'a1' }, { sourceRegionId: 'f2', assetId: 'a2' }] : [], buildCharacterMatchCandidates: () => [],
      loadFigureCropAsset: async () => ({}), analyzeFigureCharacterMatchWithLocalVlm: async () => {
        assert.equal(progress.at(-1).completed, progress.length - 1);
        assert.equal(progress.at(-1).total, 2);
        return { action: '正面を向く。' };
      },
      applyCharacterReadOutcomes: () => { events.push('people'); return { needsReview: 0 }; },
      applyScenarioToNewDocument: (document, source) => { events.push('scenario'); return applyScenarioToNewDocument(document, source); },
      initializeImportedBubbleLineBreaks: document => { events.push('linebreaks'); initializeImportedBubbleLineBreaks(document); },
      separateBubbleOriginals: async document => { events.push('separate-originals');return separateBubbleOriginals(document); },
      newCharacterTextLink: null, commitNewCharacterDraft: async () => {},
      buildSourceCoverageReport: () => assert.fail('scenario must not run legacy string audit'),
      saveSourceCoverageReport: () => assert.fail('scenario must not save legacy audit'),
      endNewCreationBridgeSession: async () => {}, lastHistoryPush: { current: 0 },
      replaceDocument: document => { state.document = document; events.push('replace'); },
      discardNewLayoutItems: () => {}, structuredClone, crypto, toSeparatedMangaYaml,
    });
    await create(mode === 'scan' || mode === 'image' ? [{ sourceItemId: 'img', analysis: importedAnalysis }] : mode === 'template' ? { id: 'test' } : undefined, mode === 'scan');
    assert.deepEqual(events, ['merge', 'people', 'scenario', 'linebreaks', 'separate-originals', 'replace']);
    assert.equal(state.document.manga.pages.length, mode === 'scan' || mode === 'image' ? 1 : 4);
    assert.ok(state.document.manga.pages.every(page => page.canvas.w === paper.w && page.canvas.h === paper.h));
    assert.equal(state.document.manga.finish_settings.width_mm, paper.w);
    assert.equal(state.document.manga.finish_settings.dpi, paper.dpi);
    assert.equal(state.document.manga.meta.bubble_line_width_mm, 0.5);
    assert.equal(state.document.manga.meta.panel_frame_width_mm, 1);
    if (mode === 'scan' || mode === 'image') {
      assert.equal(progress.at(-1).completed, progress.at(-1).total);
    }
    else assert.equal(progress.at(-1), null);
    assert.equal(state.document.manga.scenario.text, reference.source.text);
    assert.equal(state.document.manga.pages[0].panels[0].action, '春は窓を指す。');
    assert.equal(state.document.manga.meta.style_notes.length, 0);
    assert.equal(state.document.manga.layout_spec, '');
    if (mode !== 'blank') {
      // Detected layouts and templates with OCR must use the same inner-frame mapping,
      // including template pages without imported content. Output DPI does not affect mm.
      for (const page of state.document.manga.pages) {
        assert.deepEqual(page.panels[0].shape, { type: 'rect', ...innerFrameBounds(paper) }, `${mode}: ${paper.w}x${paper.h}`);
      }
      const bubble = state.document.manga.pages[0].panels[0].bubbles[0];
      assert.equal(bubble.text_style?.fontSize ?? 15, 15);
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
    newLayoutTask: 'idle', newLayoutTaskRef: { current: 'idle' }, newPrintConfirmed: true, editingNewPrintSetup: false,
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
