import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { STORAGE_KEY, toStoredMangaYaml } from '../src/lib/manga.ts';
import {
  createEmptyWorkspaceDocument,
  isUnstartedDocument,
  workspaceFromStored,
  removeBundledStoryStorage,
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

const archiveKey = `${STORAGE_KEY}.legacy-sample-archive`;
const memoryStorage = (saved) => {
  const values = new Map([[STORAGE_KEY, saved]]);
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
// Only migration identifiers: no bundled story, dialogue, layout or artwork.
const removedStoryMarker = () => {
  const doc = createEmptyWorkspaceDocument();
  doc.manga.meta.title = '押しかけ妖精にゃむるたん';
  doc.manga.characters = [{name:'にゃむるたん',role:''},{name:'ツクル',role:''}];
  return doc;
};

test('removed story identifiers clear only its startup save and dedicated archive', () => {
  for (const qa of [false,true]) {
    const doc=removedStoryMarker();
    if(qa){doc.manga.meta.title='画像配置の動作確認';doc.manga.meta.episode_id='placement-qa-20260926';}
    doc.manga.meta.author='EDITED_MARKER';
    const raw=toStoredMangaYaml(doc),storage=memoryStorage(raw);
    storage.setItem(archiveKey,JSON.stringify([raw]));
    storage.setItem('preference','keep');
    assert.equal(workspaceFromStored(raw).hasDocument,false);
    assert.equal('deferredSample' in workspaceFromStored(raw),false);
    removeBundledStoryStorage(storage);
    assert.equal(storage.getItem(STORAGE_KEY),null);
    assert.equal(storage.getItem(archiveKey),null);
    assert.equal(storage.getItem('preference'),'keep');
    removeBundledStoryStorage(storage);
  }
});

test('same title alone and a separately titled work are preserved byte for byte', () => {
  const sameTitle=createEmptyWorkspaceDocument();sameTitle.manga.meta.title='押しかけ妖精にゃむるたん';
  const own=removedStoryMarker();own.manga.meta.title='MY_WORK';
  for(const doc of [sameTitle,own]){
    const raw=toStoredMangaYaml(doc),storage=memoryStorage(raw);
    storage.setItem(archiveKey,'{broken');
    removeBundledStoryStorage(storage);
    assert.equal(storage.getItem(STORAGE_KEY),raw);
    assert.equal(storage.getItem(archiveKey),null);
    assert.equal(workspaceFromStored(raw).hasDocument,true);
  }
});

test('cleanup does not erase unknown malformed works or silently report a denied removal', () => {
  const storage=memoryStorage('{unknown'),removed=[];
  storage.setItem(archiveKey,'{broken');
  removeBundledStoryStorage(storage);
  assert.equal(storage.getItem(STORAGE_KEY),'{unknown');
  assert.equal(storage.getItem(archiveKey),null);
  assert.throws(()=>removeBundledStoryStorage({getItem:storage.getItem,removeItem:key=>{removed.push(key);throw Error('denied');}}),/denied/);
  assert.deepEqual(removed,[archiveKey]);
});

test('the actual App startup boundary removes the retired save before opening a document', () => {
  const source=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='initialWorkspace');
  const code=ts.transpileModule(declaration.getText(ast)+'\ninitialWorkspace();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const raw=toStoredMangaYaml(removedStoryMarker()),storage=memoryStorage(raw);
  storage.setItem(archiveKey,JSON.stringify([raw]));
  const startup=runInNewContext(code,{localStorage:storage,removeBundledStoryStorage,STORAGE_KEY,workspaceFromStored,reconcileSplitOverlapFlags:()=>{}});
  assert.equal(startup.hasDocument,false);
  assert.equal(storage.getItem(STORAGE_KEY),null);
  assert.equal(storage.getItem(archiveKey),null);
});

test('an untitled page containing only artwork is a started document', () => {
  const doc = createEmptyWorkspaceDocument();
  doc.manga.image_assets = [{id:'art',storageId:'original',sha256:'0'.repeat(64),mediaType:'image/png',originalName:'art.png',widthPx:1,heightPx:1,byteLength:1}];
  doc.manga.pages[0].images = [{id:'one',assetId:'art',bbox:{x:0,y:0,w:10,h:10},crop:{x:0,y:0,w:1,h:1},opacity:1,hidden:false,locked:false}];
  assert.equal(workspaceFromStored(toStoredMangaYaml(doc)).hasDocument, true);
});

test('ordinary saves avoid unchanged writes, retain failed-save protection and never archive', () => {
  const storage=memoryStorage(null),writes=[];
  let fail=false;
  const tracked={getItem:storage.getItem,setItem:(key,value)=>{if(fail)throw new Error('quota');writes.push(key);storage.setItem(key,value);}};
  const doc=createEmptyWorkspaceDocument();doc.manga.meta.title='原稿';
  let saved=storeWorkspaceDocument(tracked,doc);
  writes.length=0;
  assert.equal(storeWorkspaceDocument(tracked,doc,saved),saved);
  assert.equal(writes.length,0);
  const changed=structuredClone(doc);changed.manga.meta.title='編集後';
  saved=storeWorkspaceDocument(tracked,changed,saved);
  assert.equal(saved.document,changed);
  assert.deepEqual(writes,[STORAGE_KEY]);
  fail=true;assert.throws(()=>{saved=storeWorkspaceDocument(tracked,doc,saved);},/quota/);
  assert.equal(saved.document,changed);assert.equal(storage.getItem(STORAGE_KEY),saved.serialized);
  fail=false;storage.setItem(STORAGE_KEY,toStoredMangaYaml(removedStoryMarker()));
  storeWorkspaceDocument(tracked,doc,saved);
  assert.equal(storage.getItem(archiveKey),null);
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
    storeWorkspaceDocument,STORAGE_KEY,setToast:message=>toasts.push(message),
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
  storage.setItem(STORAGE_KEY,'externally-replaced');assert.equal(delayedReferences(),null,'external save after the async prune began must be protected');
  context.future=[];render();assert.equal(references.at(-1),null,'history-only change must not collect a closed tab\'s saved originals');
  storage.setItem(STORAGE_KEY,context.browserSave.current.serialized);
  context.localStorage.getItem=()=>{throw new Error('denied');};assert.equal(delayedReferences(),null);
});
