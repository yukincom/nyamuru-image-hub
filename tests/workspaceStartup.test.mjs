import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseMangaYaml, STORAGE_KEY, toStoredMangaYaml } from '../src/lib/manga.ts';
import {
  createEmptyWorkspaceDocument,
  isUnstartedDocument,
  workspaceFromStored,
  LEGACY_SAMPLE_ARCHIVE_KEY,
  preserveLegacySample,
  storeWorkspaceDocument,
} from '../src/lib/workspaceStartup.ts';

test('保存作品がない起動時はキャンバスを開かない', () => {
  const startup = workspaceFromStored(null);
  assert.equal(startup.hasDocument, false);
  assert.equal(startup.document.manga.pages.length, 1);
  assert.deepEqual(startup.document.manga.pages[0].panels, []);
});

test('内部の空データだけが残っていても未開始として扱う', () => {
  const empty = createEmptyWorkspaceDocument();
  const startup = workspaceFromStored(toStoredMangaYaml(empty));
  assert.equal(isUnstartedDocument(empty), true);
  assert.equal(startup.hasDocument, false);
});

test('舞台情報またはコマがある作品は起動時に復元する', () => {
  const storyOnly = createEmptyWorkspaceDocument();
  storyOnly.manga.setting.situation = '駅前で二人が再会する。';
  assert.equal(workspaceFromStored(toStoredMangaYaml(storyOnly)).hasDocument, true);

  const panelOnly = createEmptyWorkspaceDocument();
  panelOnly.manga.pages[0].panels.push({
    id: 1,
    shape: { type: 'rect', x: 10, y: 10, w: 190, h: 277 },
    bg: 1,
    bubbles: [],
    action: null,
  });
  assert.equal(workspaceFromStored(toStoredMangaYaml(panelOnly)).hasDocument, true);
});

test('システム人物だけでは開始扱いにせず、ユーザー人物は作品として復元する', () => {
  const document = createEmptyWorkspaceDocument();
  document.manga.characters.unshift({ name: '主人公', role: '主人公', scope: 'episode' });
  assert.equal(isUnstartedDocument(document), false);
  assert.equal(workspaceFromStored(toStoredMangaYaml(document)).hasDocument, true);
});

const bundledSample = readFileSync(new URL('../src/content/sample.omny.yaml', import.meta.url), 'utf8');
const memoryStorage = (saved) => {
  const values = new Map([[STORAGE_KEY, saved]]);
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('以前のサンプルを自動表示せず、元の保存文字列を復旧用に残す', () => {
  const startup = workspaceFromStored(bundledSample);
  assert.equal(startup.hasDocument, false);
  assert.equal(startup.document.manga.meta.title, '');
  assert.equal(startup.deferredSample, bundledSample);
  const edited = parseMangaYaml(bundledSample);
  edited.manga.pages[0].panels[0].bubbles[0].text = '利用者が編集した台詞';
  const editedRaw = toStoredMangaYaml(edited);
  assert.equal(workspaceFromStored(editedRaw).deferredSample, editedRaw);
});

test('同名のオリジナル作品や別タイトルに発展させた作品は通常復元する', () => {
  const original = createEmptyWorkspaceDocument();
  original.manga.meta.title = '押しかけ妖精にゃむるたん';
  assert.equal(workspaceFromStored(toStoredMangaYaml(original)).hasDocument, true);
  const changed = parseMangaYaml(bundledSample);
  changed.manga.meta.title = '私の新作';
  assert.equal(workspaceFromStored(toStoredMangaYaml(changed)).hasDocument, true);
});

test('新規作品を保存する前に編集済みサンプルを原文のまま保管し、重複しない', () => {
  const storage = memoryStorage(bundledSample);
  assert.deepEqual(preserveLegacySample(storage), [bundledSample]);
  assert.deepEqual(preserveLegacySample(storage), [bundledSample]);
  assert.equal(storage.getItem(STORAGE_KEY), bundledSample);
  const editedRaw = bundledSample.replace('休日の昼下がり。', '夕方に変更した台詞。');
  storage.setItem(STORAGE_KEY, editedRaw);
  const next = createEmptyWorkspaceDocument();
  storeWorkspaceDocument(storage, next);
  assert.equal(storage.getItem(STORAGE_KEY), toStoredMangaYaml(next));
  assert.deepEqual(JSON.parse(storage.getItem(LEGACY_SAMPLE_ARCHIVE_KEY)), [bundledSample, editedRaw]);
});

test('容量不足や保管データ破損時は元の作品を上書きしない', () => {
  const storage = memoryStorage(bundledSample);
  const next = createEmptyWorkspaceDocument();
  const failArchive = { getItem: storage.getItem, setItem: (key, value) => {
    if (key === LEGACY_SAMPLE_ARCHIVE_KEY) throw new Error('quota');
    storage.setItem(key, value);
  } };
  assert.throws(() => storeWorkspaceDocument(failArchive, next), /quota/);
  assert.equal(storage.getItem(STORAGE_KEY), bundledSample);
  storage.setItem(LEGACY_SAMPLE_ARCHIVE_KEY, '{broken');
  assert.throws(() => storeWorkspaceDocument(storage, next));
  assert.equal(storage.getItem(STORAGE_KEY), bundledSample);
});

test('復旧サンプルの継続編集では全文の保管履歴を増やさない', () => {
  const storage = memoryStorage(bundledSample);
  preserveLegacySample(storage);
  for (let index = 0; index < 5; index++) {
    const changed = bundledSample.replace('休日の昼下がり。', `利用者の編集${index}。`);
    storeWorkspaceDocument(storage, parseMangaYaml(changed));
    assert.equal(parseMangaYaml(storage.getItem(STORAGE_KEY)).manga.pages[0].panels[0].bubbles[0].text, parseMangaYaml(changed).manga.pages[0].panels[0].bubbles[0].text);
  }
  assert.deepEqual(JSON.parse(storage.getItem(LEGACY_SAMPLE_ARCHIVE_KEY)), [bundledSample]);
});


test('assistant placement QA is archived with edits and never auto-opens the foreign cast', () => {
  const doc = parseMangaYaml(bundledSample);
  doc.manga.meta.title = '画像配置の動作確認';
  doc.manga.meta.episode_id = 'placement-qa-20260926';
  doc.manga.pages[0].panels[0].figures[0].bbox.x = 90.79;
  const raw = toStoredMangaYaml(doc), storage = memoryStorage(raw);
  assert.equal(workspaceFromStored(raw).hasDocument, false);
  assert.equal(workspaceFromStored(raw).deferredSample, raw);
  assert.deepEqual(preserveLegacySample(storage), [raw]);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  doc.manga.meta.episode_id = 'my-own-work';
  assert.equal(workspaceFromStored(toStoredMangaYaml(doc)).hasDocument, true);
});

test('an untitled page containing only artwork is a started document', () => {
  const doc = createEmptyWorkspaceDocument();
  doc.manga.image_assets = [{id:'art',storageId:'original',sha256:'0'.repeat(64),mediaType:'image/png',originalName:'art.png',widthPx:1,heightPx:1,byteLength:1}];
  doc.manga.pages[0].images = [{id:'one',assetId:'art',bbox:{x:0,y:0,w:10,h:10},crop:{x:0,y:0,w:1,h:1},opacity:1,hidden:false,locked:false}];
  assert.equal(workspaceFromStored(toStoredMangaYaml(doc)).hasDocument, true);
});

test('ordinary saves reuse known document metadata; external samples and failed writes retain protection', () => {
  const storage=memoryStorage(null), reads=[], writes=[];
  let fail=false;
  const tracked={getItem:key=>{reads.push(key);return storage.getItem(key);},setItem:(key,value)=>{if(fail)throw new Error('quota');writes.push(key);storage.setItem(key,value);}};
  const doc=createEmptyWorkspaceDocument();doc.manga.meta.title='原稿';
  let saved=storeWorkspaceDocument(tracked,doc);
  reads.length=0;writes.length=0;
  assert.equal(storeWorkspaceDocument(tracked,doc,saved),saved);
  assert.equal(writes.length,0);
  const changed=structuredClone(doc);changed.manga.meta.title='編集後';
  saved=storeWorkspaceDocument(tracked,changed,saved);
  assert.equal(saved.document,changed);assert.equal(reads.includes(LEGACY_SAMPLE_ARCHIVE_KEY),false);
  assert.deepEqual(writes,[STORAGE_KEY]);
  fail=true;assert.throws(()=>{saved=storeWorkspaceDocument(tracked,doc,saved);},/quota/);
  assert.equal(saved.document,changed);assert.equal(storage.getItem(STORAGE_KEY),saved.serialized);
  fail=false;storage.setItem(STORAGE_KEY,bundledSample);
  saved=storeWorkspaceDocument(tracked,doc,saved);
  assert.deepEqual(JSON.parse(storage.getItem(LEGACY_SAMPLE_ARCHIVE_KEY)),[bundledSample]);
  const sample=parseMangaYaml(bundledSample);sample.manga.pages[0].panels[0].bubbles[0].text='復旧後の追加編集';
  saved=storeWorkspaceDocument(tracked,sample,saved);
  const sampleRaw=saved.serialized;
  storeWorkspaceDocument(tracked,doc,saved);
  assert.deepEqual(JSON.parse(storage.getItem(LEGACY_SAMPLE_ARCHIVE_KEY)),[bundledSample,sampleRaw]);
});

test('actual autosave effect ignores history-only changes and protects the last saved originals after failure', () => {
  const source=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const editor=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='EditorApp');
  const statements=editor.body.statements.filter(node=>{
    const text=node.getText(ast);
    return text.startsWith('const prunePaintAssets =') || (text.startsWith('useEffect(')&&(text.includes('storeWorkspaceDocument(')||text.includes('try { prunePaintAssets(); }')));
  });
  assert.equal(statements.length,3);
  const code=ts.transpileModule(statements.map(node=>node.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const storage=memoryStorage(null),timers=new Map(),effects=[],references=[],toasts=[];
  let sequence=0,writes=0,fail=false,delayedReferences;
  const doc=createEmptyWorkspaceDocument();doc.manga.meta.title='saved-original';
  const context={document:doc,hasDocument:true,past:[],future:[],saveTimer:{current:undefined},browserSave:{current:undefined},pendingPaintAssets:{current:new Set(['pending-original'])},timeline:{current:{past:[],future:[]}},
    localStorage:{getItem:storage.getItem,setItem:(key,value)=>{if(fail)throw new Error('quota');writes++;storage.setItem(key,value);}},
    storeWorkspaceDocument,STORAGE_KEY,LEGACY_SAMPLE_ARCHIVE_KEY,setToast:message=>toasts.push(message),
    collectFigureCropAssetIds:document=>[document.manga.meta.title],workspaceSnapshot:()=>({document:context.document,paint:{state:{imports:[{asset:{storageId:'live-paint'}}]}}}),
    paintAssets:{prune:read=>{delayedReferences=read;references.push(read());return Promise.resolve();}},window:{clearTimeout:id=>timers.delete(id),setTimeout:fn=>{timers.set(++sequence,fn);return sequence;}}};
  const render=()=>{let index=0;runInNewContext(code,{...context,useEffect:(run,deps)=>{const slot=index++,previous=effects[slot];if(previous&&deps.every((dep,i)=>dep===previous.deps[i]))return;previous?.cleanup?.();effects[slot]={deps,cleanup:run()};}});};
  const flush=()=>{const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());};
  render();assert.equal(references.length,0);flush();assert.equal(writes,1);
  context.timeline.current.past=context.past=[{document:{manga:{meta:{title:'undo-original'}}}}];render();flush();
  assert.equal(writes,1);assert.ok(references.at(-1).includes('undo-original'));
  render();flush();assert.equal(writes,1,'a preference-only render must not save the document');
  context.document=structuredClone(doc);context.document.manga.meta.title='unsaved-original';fail=true;
  render();flush();assert.equal(writes,1);assert.equal(toasts.length,1);assert.equal(context.browserSave.current.document,doc);
  context.timeline.current.past=context.past=[];render();flush();
  for(const id of ['saved-original','unsaved-original','pending-original','live-paint'])assert.ok(references.at(-1).includes(id),id);
  fail=false;context.document=structuredClone(context.document);render();flush();assert.equal(writes,2);
  assert.equal(workspaceFromStored(storage.getItem(STORAGE_KEY)).document.manga.meta.title,'unsaved-original');
  assert.equal(references.at(-1).includes('saved-original'),false);
  storage.setItem(STORAGE_KEY,bundledSample);assert.equal(delayedReferences(),null,'external save after the async prune began must be protected');
  context.future=[];render();assert.equal(references.at(-1),null,'history-only change must not collect a closed tab\'s saved originals');
  storage.setItem(STORAGE_KEY,context.browserSave.current.serialized);storage.setItem(LEGACY_SAMPLE_ARCHIVE_KEY,'[]');
  context.future=[];render();assert.equal(references.at(-1),null);
  context.localStorage.getItem=()=>{throw new Error('denied');};assert.equal(delayedReferences(),null);
});
