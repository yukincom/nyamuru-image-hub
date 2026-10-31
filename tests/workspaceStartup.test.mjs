import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { STORAGE_KEY, toStoredMangaYaml } from '../src/lib/manga.ts';
import { createEmptyWorkspaceDocument, createInitialWorkspace, isUnstartedDocument } from '../src/lib/workspaceStartup.ts';

const source=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);

test('startup always opens an empty workspace, with no shared mutable document', () => {
  const startup=createInitialWorkspace();
  assert.equal(startup.hasDocument,false);
  assert.equal(isUnstartedDocument(startup.document),true);
  assert.deepEqual(startup.document.manga.pages[0].panels,[]);
  startup.document.manga.meta.title='unsaved';
  assert.equal(createInitialWorkspace().document.manga.meta.title,'');
});

test('the actual App startup does not read, restore, rewrite or delete a previous browser work', () => {
  const previous=createEmptyWorkspaceDocument();previous.manga.meta.title='previous work';
  const values=new Map([[STORAGE_KEY,toStoredMangaYaml(previous)]]),before=values.get(STORAGE_KEY);
  const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='initialWorkspace');
  const code=ts.transpileModule(declaration.getText(ast)+'\ninitialWorkspace();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const localStorage={getItem:()=>assert.fail('must not read saved work'),setItem:()=>assert.fail('must not autosave'),removeItem:()=>assert.fail('must not delete existing data')};
  const startup=runInNewContext(code,{localStorage,createInitialWorkspace,reconcileSplitOverlapFlags:()=>{}});
  assert.equal(startup.hasDocument,false);
  assert.equal(startup.document.manga.meta.title,'');
  assert.equal(values.get(STORAGE_KEY),before);
});

test('artwork-only and character-only documents still count as edited work', () => {
  const doc=createEmptyWorkspaceDocument();
  doc.manga.pages[0].images=[{id:'art',assetId:'original'}];
  assert.equal(isUnstartedDocument(doc),false);
  const character=createEmptyWorkspaceDocument();
  character.manga.characters.unshift({name:'test character',role:'',scope:'episode'});
  assert.equal(isUnstartedDocument(character),false);
});

// 見込み: 回収は常に最新の作品・履歴・未確定描画・資料を読む。合格: 参照集合に必要IDだけを含み、終了通知でも再回収する。範囲: 実Appの関数・effectを抽出、保存先と画面は模擬。
test('editing and Undo/Redo collect only memory assets without saving or consulting browser storage', () => {
  const editor=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='EditorApp');
  const statements=editor.body.statements.filter(node=>{
    const text=node.getText(ast);
    return text.startsWith('const prunePaintAssets =') || (text.startsWith('useEffect(')&&(text.includes('prunePaintAssets();')||text.includes('onFigureCropAssetsChanged')));
  });
  const code=ts.transpileModule(statements.map(node=>node.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const doc=createEmptyWorkspaceDocument();doc.manga.meta.title='current';
  const effects=[],references=[];
  let deferred,settled;
  const context={document:doc,hasDocument:true,past:[],future:[],newCharacterDocument:null,newCharacterDocumentRef:{current:null},paintSession:null,seriesCatalogSaving:false,pendingPaintAssets:{current:new Set(['pending-original'])},timeline:{current:{past:[],future:[]}},
    localStorage:{getItem:()=>assert.fail('no saved work read'),setItem:()=>assert.fail('no autosave')},
    collectFigureCropAssetIds:(document,extra=[])=>[document.manga.meta.title,...extra],paintAssetIds:paint=>paint.ids,
    browserCatalogImageIds:()=>['library-image'],onFigureCropAssetsChanged:callback=>{settled=callback;return()=>{};},
    workspaceSnapshot:()=>({document:context.document,paint:{state:{scene:{owners:[{paint:{ids:['unflushed-original']}}]},imports:[{asset:{storageId:'live-paint'}}],stageImports:[{stage:{storageId:'live-stage'}}]}}}),
    pruneFigureCropAssets:(_,read)=>{deferred=read;references.push(read());return Promise.resolve();}};
  const render=()=>{let index=0;runInNewContext(code,{...context,useEffect:(run,deps)=>{const slot=index++,previous=effects[slot];if(previous&&deps.every((dep,i)=>dep===previous[i]))return;effects[slot]=deps;run();}});};
  render();assert.ok(references.length);
  context.timeline.current.past=context.past=[{document:{manga:{meta:{title:'undo-original'}}}}];
  context.timeline.current.future=context.future=[{document:{manga:{meta:{title:'redo-original'}}}}];render();
  for(const id of ['current','undo-original','redo-original','pending-original','live-paint','live-stage','unflushed-original','library-image'])assert.ok(references.at(-1).includes(id),id);
  context.document=structuredClone(doc);context.document.manga.meta.title='new-edit';render();
  assert.ok(deferred().includes('new-edit'));
  assert.equal(deferred().includes('current'),false);
  context.newCharacterDocumentRef.current=context.newCharacterDocument={manga:{meta:{title:'new-draft'}}};render();assert.ok(references.at(-1).includes('new-draft'));
  const before=references.length;settled();assert.equal(references.length,before+1);assert.ok(references.at(-1).includes('new-edit'));
  context.newCharacterDocumentRef.current=context.newCharacterDocument=null;render();assert.equal(references.at(-1).includes('new-draft'),false);
});

test('work autosave and restoration entry points have been removed', () => {
  assert.doesNotMatch(source,/storeWorkspaceDocument|workspaceFromStored|readProjectBinding|rememberProjectBinding|browserSave|saveTimer/);
});
