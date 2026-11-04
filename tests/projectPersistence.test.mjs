import { beginFigureCropImport } from '../src/lib/figureCropStore.ts';
import { isBrowserWorkspace } from '../src/lib/browserWorkspace.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseMangaYaml, cloneDocument, toSeparatedMangaYaml, omnyFileName } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { linkedTestDocument, PERSON_A } from './fixtures/emptyTestDocument.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sample = linkedTestDocument;
const binding = { token: 'test-token', directory: '/test/episode', folderName: 'episode', seriesDirectory: '/test', episodeId: 'episode-one' };

test('full project roundtrip retains story and style, unlike the distribution export', async () => {
  const original = sample();
  original.manga.meta.episode_id = 'episode-one';
  const snapshot = await createProjectSnapshot(original);
  const restored = await restoreProjectSnapshot(snapshot);
  assert.deepEqual(restored, original);
  assert.deepEqual(restored.manga.meta.style_notes, original.manga.meta.style_notes);
  assert.deepEqual(restored.manga.layout_spec, original.manga.layout_spec);
});

test('figure, text and overlay images are deduplicated, portable and restored with fresh IDs', async () => {
  const original = sample();
  const panel = original.manga.pages[0].panels[0];
  const meta = { schemaVersion: 1, assetId: 'crop', sourceRegionId: 'region', sourceBBox: { x: 0, y: 0, w: 1, h: 1 }, detectionSource: 'body', draft: true };
  panel.figures = [{ name: PERSON_A, analogImport: meta }];
  panel.bubbles[0].analogTextImport = { ...meta, recognitionEngine: 'Baberu OCR', needsReview: true, levelAdjusted: true };
  original.manga.pages[0].page_overlay = { figures: [{ name: PERSON_A, analogImport: structuredClone(meta) }], bubbles: [] };
  let loads = 0, restoredAssets;
  const snapshot = await createProjectSnapshot(original, async () => { loads++; return new Blob(['image bytes'], { type: 'image/png' }); });
  assert.equal(loads, 1);
  assert.equal(snapshot.assets.length, 1);
  const restored = await restoreProjectSnapshot(snapshot, async assets => { restoredAssets = assets; });
  assert.equal(restoredAssets.length, 1);
  assert.equal(await restoredAssets[0].blob.text(), 'image bytes');
  const restoredPanel = restored.manga.pages[0].panels[0];
  assert.notEqual(restoredPanel.figures[0].analogImport.assetId, 'crop');
  assert.equal(restoredPanel.figures[0].analogImport.assetId, restoredPanel.bubbles[0].analogTextImport.assetId);
  assert.equal(restored.manga.pages[0].page_overlay.figures[0].analogImport.assetId, restoredAssets[0].id);
  assert.equal(meta.assetId, 'crop');
  snapshot.assets = [];
  await assert.rejects(restoreProjectSnapshot(snapshot, async () => assert.fail('must not write incomplete data')), /不足/);
  await assert.rejects(createProjectSnapshot(original, async () => null), /保存を中止/);
});

import { separateBubbleOriginals } from '../src/lib/bubbleOriginals.ts';
const app = ['App.tsx', 'workspace/workspaceProjectFiles.ts', 'workspace/newProjectSessions.ts',
  'workspace/seriesCatalogActions.ts', 'workspace/workspaceCatalog.ts'].map(file => read('src/components/' + file)).join('\n');
const ast = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name, overrides = {}) {
  const original = sample();
  original.manga.meta.episode_id = 'episode-one';
  const calls = [], notices = [];
  const context = {
    endTextEdit: () => {},
    isLanClient: false, hasDocument: true, showNewDialog: false, projectOperation: { current: false },
    paintController: { current: null }, paintSessionRef: { current: null }, setPaintSession: () => {},
    documentRef: { current: original }, boundEpisodeWorkspace: { ...binding },
    // 作品を開く間は本体の画像取込保護を使う。フォルダへの入出力だけを模擬する。
    beginFigureCropImport, isBrowserWorkspace, structuredClone, crypto, Error, cloneDocument, createProjectSnapshot, restoreProjectSnapshot, separateBubbleOriginals,
    localStorage: {}, rememberProjectBinding: () => {},
    setProjectBusy: value => calls.push(['busy', value]),
    setToast: value => notices.push(value),
    withNewCreationBridgeSession: operation => operation(),
    savedWorkspaceRoot: () => '/test',
    selectEpisodeWorkspace: async () => { calls.push(['pick']); return binding; },
    saveEpisodeProject: async (token, snapshot, revision) => { calls.push(['save', token, snapshot, revision]); return 'saved-revision'; },
    persistSeriesCatalog: async value => value,
    setDocument: value => { context.documentRef.current = value; },
    setBoundEpisodeWorkspace: value => { context.boundEpisodeWorkspace = value; },
    loadEpisodeProject: async () => ({ snapshot: await createProjectSnapshot(original), revision: 'loaded-revision' }),
    replaceDocument: value => { calls.push(['replace']); context.documentRef.current = value; },
    setBoundSourceSnapshot: () => {}, setSourceCoverageDecisions: () => {},
    setActivePage: () => {}, setActivePanel: () => {}, setSelectedPanels: () => {}, setSelectedElement: () => {},
    setTab: () => {}, setMobileStoryboardPane: () => {}, confirm: () => true,
    ...overrides,
  };
  function compile(symbol) {
    let declaration;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === symbol) declaration = node;
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(declaration);
    const js = ts.transpileModule(`(${declaration.initializer.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return runInNewContext(js, context);
  }
  context.applyPreparedSeriesIdentifiers = compile('applyPreparedSeriesIdentifiers');
  return { run: compile(name), context, calls, notices, original };
}

test('actual Save handler uses New Creation binding directly; repeat save uses returned revision', async () => {
  const h = handler('saveProject');
  await h.run();
  assert.equal(h.calls.filter(x => x[0] === 'pick').length, 0);
  assert.equal(h.calls.find(x => x[0] === 'save')[1], binding.token);
  assert.equal(h.context.boundEpisodeWorkspace.projectRevision, 'saved-revision');
  assert.match(h.notices.at(-1), /episode に保存しました/);
  assert.doesNotMatch(h.notices.at(-1), /追加編集/);
  await h.run();
  assert.equal(h.calls.filter(x => x[0] === 'save').at(-1)[3], 'saved-revision');
});

test('the demand-time OMNY getter and Save use current native text after the paint flush',async()=>{
  let serialized=0;
  const getter=handler('getOmnySnapshot',{useCallback:callback=>callback,toSeparatedMangaYaml:document=>{serialized++;return toSeparatedMangaYaml(document);}});
  assert.equal(serialized,0);
  const bubble=getter.context.documentRef.current.manga.pages[0].panels[0].bubbles[0];
  bubble.text='生成時の最新本文';bubble.text_style={font:'游明朝',fontSize:40,fontWeight:700};bubble.text_position={x:1.3,y:-.7};
  let loaded=parseMangaYaml(getter.run()).manga.pages[0].panels[0].bubbles[0];
  assert.equal(serialized,1);assert.equal(loaded.text,bubble.text);assert.deepEqual(loaded.text_style,bubble.text_style);assert.deepEqual(loaded.text_position,bubble.text_position);
  bubble.text='確定後に大幅に書き直した本文';loaded=parseMangaYaml(getter.run()).manga.pages[0].panels[0].bubbles[0];
  assert.equal(serialized,2);assert.equal(loaded.text,bubble.text);
  const save=handler('saveProject');
  save.context.paintController.current={flush:async()=>{const current=cloneDocument(save.context.documentRef.current);current.manga.pages[0].panels[0].bubbles[0]={...current.manga.pages[0].panels[0].bubbles[0],text:'描画確定後の清書',text_style:{font:'游明朝',fontSize:21}};save.context.documentRef.current=current;}};
  await save.run();
  const snapshot=save.calls.find(call=>call[0]==='save')[2];
  assert.equal(snapshot.document.manga.pages[0].panels[0].bubbles[0].text,'描画確定後の清書');
  assert.equal(snapshot.document.manga.pages[0].panels[0].bubbles[0].text_style.fontSize,21);
});

test('legacy work without episode ID is assigned one and saved once; picker cancellation writes nothing', async () => {
  const h = handler('saveProject', { boundEpisodeWorkspace: null });
  h.original.manga.meta.episode_id = '';
  await h.run();
  const saved = h.calls.find(x => x[0] === 'save')[2];
  assert.ok(saved.document.manga.meta.episode_id);
  assert.equal(h.context.boundEpisodeWorkspace.episodeId, saved.document.manga.meta.episode_id);
  const cancel = handler('saveProject', { boundEpisodeWorkspace: null, selectEpisodeWorkspace: async () => null });
  await cancel.run();
  assert.equal(cancel.calls.filter(x => x[0] === 'save').length, 0);
  assert.equal(cancel.notices.length, 0);
});

test('failed Save preserves current work/binding and never reports success', async () => {
  const h = handler('saveProject', { saveEpisodeProject: async () => { throw new Error('disk full'); } });
  await h.run();
  assert.equal(h.context.documentRef.current, h.original);
  assert.equal(h.context.boundEpisodeWorkspace.projectRevision, undefined);
  assert.match(h.notices.at(-1), /保存できませんでした.*disk full/);
  assert.equal(h.context.projectOperation.current, false);
});

test('edits during saving remain in editor; concurrent Save is ignored', async () => {
  let finish;
  const h = handler('saveProject', { saveEpisodeProject: () => new Promise(resolve => { finish = resolve; }) });
  const pending = h.run();
  await new Promise(resolve => setImmediate(resolve));
  await h.run();
  const edited = structuredClone(h.original);
  edited.manga.meta.title = 'saved after this save began';
  h.context.documentRef.current = edited;
  finish('revision');
  await pending;
  assert.equal(h.context.documentRef.current, edited);
  assert.match(h.notices.at(-1), /追加編集は次回/);
});

test('legacy first-save title edits cannot lose the new episode ID or its saved folder binding', async () => {
  let finish;
  const h = handler('saveProject', { boundEpisodeWorkspace: null, saveEpisodeProject: () => new Promise(resolve => { finish = resolve; }) });
  h.original.manga.meta.episode_id = '';
  const pending = h.run();
  await new Promise(resolve => setImmediate(resolve));
  const episodeId = h.context.documentRef.current.manga.meta.episode_id;
  assert.ok(episodeId);
  const edited = structuredClone(h.context.documentRef.current);
  edited.manga.meta.title = '編集したサブタイトル';
  h.context.documentRef.current = edited;
  finish('first-revision');
  await pending;
  assert.equal(h.context.documentRef.current.manga.meta.episode_id, episodeId);
  assert.equal(h.context.documentRef.current.manga.meta.title, edited.manga.meta.title);
  assert.equal(h.context.boundEpisodeWorkspace.episodeId, episodeId);
  h.context.saveEpisodeProject = async (token, snapshot, revision) => {
    assert.equal(token, binding.token);
    assert.equal(revision, 'first-revision');
    assert.equal(snapshot.document.manga.meta.episode_id, episodeId);
    return 'second-revision';
  };
  h.context.selectEpisodeWorkspace = () => assert.fail('must keep the existing binding');
  await h.run();
  assert.equal(h.context.boundEpisodeWorkspace.projectRevision, 'second-revision');
});

test('actual Open handler restores folder snapshot and binding, cancellation/error leaves current work', async () => {
  const h = handler('openProject');
  await h.run();
  assert.equal(h.calls.filter(x => x[0] === 'replace').length, 1);
  assert.equal(h.context.boundEpisodeWorkspace.projectRevision, 'loaded-revision');
  assert.deepEqual(h.context.documentRef.current, h.original);
  for (const overrides of [{ confirm: () => false }, { loadEpisodeProject: async () => { throw new Error('invalid project'); } }]) {
    const failed = handler('openProject', overrides);
    await failed.run();
    assert.equal(failed.context.documentRef.current, failed.original);
    assert.equal(failed.calls.filter(x => x[0] === 'replace').length, 0);
  }
});

test('Header has no story copy/menu and keyboard shares exactly the same Save action', () => {
  const header = read('src/components/Header.tsx');
  assert.doesNotMatch(header, /ストーリーコピー|ストーリー保存|スタイル保存|download-menu|aria-haspopup|onCopy|onDownload/);
  assert.match(header, /onClick=\{onSave\}/);
  assert.match(app, /saveProjectAction.current = \(\) => saveProject\(\)/);
  const shortcut = app.slice(app.indexOf("key === 's'"), app.indexOf("if (key === 'escape'"));
  assert.match(shortcut, /saveProjectAction.current\(\)/);
  assert.doesNotMatch(shortcut, /localStorage/);
});


test('browser folder saves retain assigned series IDs across repeated saves and concurrent title edits', async () => {
  const persisted = [], written = [];
  let finish;
  const h = handler('saveBrowserProject', {
    isLanClient: true, boundEpisodeWorkspace: { ...binding, token: 'browser-folder:test' },
    browserWorkspaces: {
      saveTarget: async () => ({}),
      write: async () => new Promise(resolve => { finish = resolve; }),
    },
    persistSeriesCatalog: async source => {
      const prepared = structuredClone(source);
      prepared.manga.meta.series_id ||= `new-series-${persisted.length}`;
      persisted.push(prepared.manga.meta.series_id); return prepared;
    },
    createPortableProject: async source => { written.push(source); return source; },
    portableProjectBlob: value => value,
  });
  h.original.manga.meta.series = 'New series'; h.original.manga.meta.series_id = '';
  const pending = h.run(); await new Promise(resolve => setImmediate(resolve));
  const edited = structuredClone(h.original); edited.manga.meta.title = 'additional edit'; h.context.documentRef.current = edited;
  finish({ binding: { revision: 'r1' } }); await pending;
  assert.equal(h.context.documentRef.current.manga.meta.title, 'additional edit');
  assert.equal(h.context.documentRef.current.manga.meta.series_id, persisted[0]);
  assert.match(h.notices.at(-1), /追加編集は次回/);
  const second = h.run(); await new Promise(resolve => setImmediate(resolve));
  finish({ binding: { revision: 'r2' } }); await second;
  assert.deepEqual(persisted, ['new-series-0', 'new-series-0']);
  assert.notEqual(written[0].manga.meta.title, 'additional edit');
  assert.equal(written[1].manga.meta.title, 'additional edit');
});

test('LAN creation does not query or discard the Mac scanner recovery session', async () => {
  const h = handler('discardScannerSources', {
    isLanClient: true, scannerSessionRef: { current: null },
    cancelActiveScannerSession: () => assert.fail('must not change Mac scanner'),
    discardPendingScannerRecovery: () => assert.fail('must not change Mac recovery'),
  });
  await h.run();
});

test('LAN Save uses the bound client folder and remembers its returned revision', async () => {
  let folderWrites = 0;
  const workspace = { ...binding, token: 'browser-folder:fixture', projectRevision: 'before' };
  const h = handler('saveBrowserProject', {
    isLanClient: true, boundEpisodeWorkspace: workspace,
    browserWorkspaces: {
      chooseEpisode: () => assert.fail('bound save must not open a picker'),
      saveTarget: async value => { assert.equal(value.token, workspace.token); return {}; },
      write: async () => { folderWrites++; return { binding: { revision: 'after' } }; },
    },
    createPortableProject: async source => source, portableProjectBlob: value => value,
    rememberProjectBinding: () => assert.fail('must not persist a browser binding'),
  });
  await h.run();
  assert.equal(folderWrites, 1);
  assert.equal(folderWrites, 1);
  assert.equal(h.context.boundEpisodeWorkspace.projectRevision, 'after');
});

test('opening a browser folder replaces the episode binding with that selected folder', async () => {
  const workspace = { ...binding, token: 'browser-folder:selected' };

  const h = handler('openBrowserProject', {
    isLanClient: true,
    browserWorkspaces: {
      chooseEpisode: async () => workspace,
      open: async value => { assert.equal(value, workspace); return { file: { name: 'project.json' }, value: { parsed: true }, binding: { revision: 'loaded' } }; },
    },
    restorePortableProject: async value => { assert.deepEqual(value, { parsed: true }); return h.original; },
    rememberProjectBinding: () => assert.fail('must not persist a browser binding'), rememberBrowserCatalog: async () => {},
  });
  await h.run();
  assert.equal(h.calls.filter(call => call[0] === 'replace').length, 1);
  assert.equal(h.context.boundEpisodeWorkspace.token, workspace.token);
  assert.equal(h.context.boundEpisodeWorkspace.projectRevision, 'loaded');
  assert.match(h.notices.at(-1), /読み込みました/);
});

for (const unsupported of [false, true]) test(`folder ${unsupported ? 'unavailability' : 'cancellation'} cannot fall back to file open or save`, async () => {
  for (const name of ['saveBrowserProject', 'openBrowserProject']) {
    const h = handler(name, {
      isLanClient: true, boundEpisodeWorkspace: null,
      browserWorkspaces: { chooseEpisode: async () => { if (unsupported) throw Error('フォルダーを選べません'); return null; } },
    });
    await h.run();
    assert.equal(h.context.boundEpisodeWorkspace, null);
    assert.equal(h.context.documentRef.current, h.original);
    assert.equal(h.calls.filter(call => call[0] === 'replace').length, 0);
    assert.equal(h.context.projectOperation.current, false);
    if (unsupported) assert.match(h.notices.at(-1), /フォルダーを選べません/);
  }
});

test('an unbound LAN save must select a folder and persist only through that folder', async () => {
  const workspace = { ...binding, token: 'browser-folder:new' }, operations = [];
  const h = handler('saveBrowserProject', {
    isLanClient: true, boundEpisodeWorkspace: null,
    browserWorkspaces: {
      chooseEpisode: async (_start, _series, forNew) => { assert.equal(forNew, true); operations.push('folder'); return workspace; },
      saveTarget: async value => { assert.equal(value.token, workspace.token); operations.push('target'); return {}; },
      write: async () => { operations.push('write'); return { binding: { revision: 'saved' } }; },
    },
    createPortableProject: async value => value, portableProjectBlob: value => value,
  });
  await h.run();
  assert.deepEqual(operations, ['folder', 'target', 'write']);
  assert.equal(h.context.boundEpisodeWorkspace.token, workspace.token);
});

test('cancelling a different folder destination keeps the active binding untouched', async () => {
  const h = handler('saveBrowserProject', {
    isLanClient: true, boundEpisodeWorkspace: { ...binding, token: 'browser-folder:original' },
    browserWorkspaces: { chooseEpisode: async () => null, saveTarget: () => assert.fail('cancel must not save') },
  });
  assert.match(await h.run(true), /キャンセル/);
  assert.equal(h.context.boundEpisodeWorkspace.token, 'browser-folder:original');
  assert.equal(h.context.projectOperation.current, false);
});

test('OMNY export uses the story serializer and leaves the project binding and document unchanged', async () => {
  let exported;
  const h = handler('exportOmny', {
    Blob, toSeparatedMangaYaml, omnyFileName,
    downloadBrowserBlob: (blob, name) => { exported = { blob, name }; },
  });
  const original = structuredClone(h.original), workspace = h.context.boundEpisodeWorkspace;
  h.run();
  assert.equal(exported.name, omnyFileName(original.manga.meta.title));
  assert.equal(await exported.blob.text(), toSeparatedMangaYaml(original));
  assert.equal(h.context.boundEpisodeWorkspace, workspace);
  assert.deepEqual(h.context.documentRef.current, original);
  const value = await exported.blob.text();
  assert.doesNotMatch(value, /nyamuru-project|image_base64|artwork:/);
  exported = null; h.context.hasDocument = false; h.run();
  assert.equal(exported, null);
});

test('standalone project entry points are removed, including picker and download fallbacks', () => {
  const files = read('src/lib/browserFiles.ts');
  assert.doesNotMatch(app, /savePortable|openPortable|chooseProjectFile|chooseProjectSaveTarget|portableBinding|fileInput|const importFile/);
  assert.doesNotMatch(files, /chooseProjectFile|chooseProjectSaveTarget|projectFileName|showSaveFilePicker|showOpenFilePicker/);
  assert.doesNotMatch(read('src/components/Header.tsx'), /<details|onOpenFile|onExportFile|fileMode|folderMode/);
});

for(const isLanClient of [false,true]) test(`explicit ${isLanClient?'LAN series':'one-shot'} catalog Save uses the existing project-folder save`,async()=>{
  let saved=0;
  const original=sample();original.manga.meta.series=isLanClient?'series':'';
  const h=handler('saveCatalogFromEditor',{
    isLanClient,documentRef:{current:original},
    localStorage:{getItem:()=>assert.fail('no work storage'),setItem:()=>assert.fail('no browser save')},
    saveProjectAction:{current:async()=>{saved++;return 'saved';}},
    persistSeriesCatalog:()=>assert.fail('must use the project save route'),
  });
  await h.run('人物設定');assert.equal(saved,1);
});
