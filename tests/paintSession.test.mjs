import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { paintCheckpoint } from '../src/lib/paintSession.ts';
import { paintScene } from '../src/lib/paintDocument.ts';
import { commitPaintStroke } from '../src/lib/paintGesture.ts';
import { paintOwnerLocked } from '../src/lib/paintLock.ts';

const initial=()=>paintScene({id:1,shape:{type:'rect',x:0,y:0,w:30,h:40},bg:0,action:null,bubbles:[],figures:[{name:'確認用',bbox:{x:2,y:3,w:10,h:20}}]},100,[]);
const add=(scene,index=0)=>{const o=scene.owners[index];return commitPaintStroke(scene,{ownerKey:o.key,layerId:o.paint.layers[0].id,stroke:{tool:'pen',color:'#000000',size:3,points:[{x:4,y:5,pressure:.7,time:1}]}});};

test('successive saves preserve both owners and undo after saving reaches the document',async()=>{
 const start=initial(),checkpoint=paintCheckpoint(start),calls=[];
 const a=add(start),b=add(a,1),c=add(b);
 const write=async owners=>calls.push(owners.map(o=>[o.key,o.paint.layers[0].strokes.length]));
 await checkpoint.flush(a,write);await checkpoint.flush(b,write);await checkpoint.flush(c,write);await checkpoint.flush(c,write);
 await checkpoint.flush(start,write);
 assert.deepEqual(calls,[[['background',1]],[['figure-0',1]],[['background',2]],[['background',0],['figure-0',0]]]);
 assert.equal(checkpoint.saved,start);
});

test('failed PNG/asset writes keep the save point and allow retry without dropping new strokes',async()=>{
 const start=initial(),checkpoint=paintCheckpoint(start),one=add(start),two=add(one,1);
 await assert.rejects(checkpoint.flush(one,async()=>{throw Error('disk failure');}),/disk failure/);
 assert.equal(checkpoint.saved,start);
 let written;await checkpoint.flush(two,async owners=>{written=owners;});
 assert.deepEqual(written.map(o=>o.paint.layers[0].strokes.length),[1,1]);
 assert.equal(checkpoint.saved,two);
});

test('overlapping flush requests serialize writes and deduplicate a shared scene',async()=>{
 const checkpoint=paintCheckpoint(initial()),one=add(checkpoint.saved),two=add(one,1),calls=[];
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const write=async owners=>{calls.push(owners.map(o=>o.key));if(calls.length===1)await gate;};
 const a=checkpoint.flush(one,write),b=checkpoint.flush(two,write),c=checkpoint.flush(two,write);
 await Promise.resolve();assert.equal(calls.length,1);release();await Promise.all([a,b,c]);
 assert.deepEqual(calls,[['background'],['figure-0']]);assert.equal(checkpoint.saved,two);
});

// Exercise the actual app save handler, including cancellation and failure, with no bridge or disk writes.
const source=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let expression;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='saveProject')expression=node.initializer.getText(ast);ts.forEachChild(node,visit);}
visit(ast);
const compiled=ts.transpileModule(`(${expression})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function appSave({cancel=false,fail=false}={}){
 const documentRef={current:{manga:{meta:{episode_id:'episode',series:''},paint:0}}};
 const paintSessionRef={current:{document:documentRef.current}},calls=[],notices=[];
 const context={Error,crypto,isLanClient:false,hasDocument:true,showNewDialog:false,projectOperation:{current:false},setProjectBusy:value=>calls.push(['busy',value]),documentRef,paintSessionRef,
  paintController:{current:{flush:async()=>{calls.push(['flush']);if(fail)throw Error('ink failure');documentRef.current={...documentRef.current,manga:{...documentRef.current.manga,paint:7}};paintSessionRef.current={document:documentRef.current};}}},
  boundEpisodeWorkspace:null,cloneDocument:structuredClone,setDocument:next=>{documentRef.current=next;},
  withNewCreationBridgeSession:async callback=>{calls.push(['bridge']);await callback();},
  selectEpisodeWorkspace:async()=>cancel?null:{token:'t',directory:'/fixture',folderName:'fixture'},savedWorkspaceRoot:()=>'',
  createProjectSnapshot:async doc=>{calls.push(['snapshot',doc.manga.paint]);return doc;},
  saveEpisodeProject:async(_token,snapshot)=>{assert.equal(snapshot.manga.paint,7);return 'revision';},rememberProjectBinding:()=>{},localStorage:{},
  applyPreparedSeriesIdentifiers:()=>{},setBoundEpisodeWorkspace:()=>{},setPaintSession:s=>{paintSessionRef.current=s;},setToast:message=>notices.push(message)};
 return {save:runInNewContext(compiled,context),calls,notices,context};
}
test('whole-project save waits for current paint before capturing the snapshot and retains painting',async()=>{
 const {save,calls,context}=appSave();await save();
 assert.deepEqual(calls,[['busy',true],['flush'],['bridge'],['snapshot',7],['busy',false]]);
 assert.equal(context.paintSessionRef.current.document,context.documentRef.current);
});
test('cancelling the folder picker retains ink in the document; paint failure prevents a partial project save',async()=>{
 const cancelled=appSave({cancel:true});await cancelled.save();assert.equal(cancelled.context.documentRef.current.manga.paint,7);assert.ok(!cancelled.calls.some(c=>c[0]==='snapshot'));
 const failed=appSave({fail:true});await failed.save();assert.ok(!failed.calls.some(c=>c[0]==='bridge'));assert.match(failed.notices[0],/ink failure/);assert.equal(failed.context.projectOperation.current,false);
});


test('first project save assigns identity without invalidating the active paint session',async()=>{
 const h=appSave();h.context.documentRef.current.manga.meta.episode_id='';await h.save();
 assert.ok(h.context.documentRef.current.manga.meta.episode_id);
 assert.equal(h.context.paintSessionRef.current.document,h.context.documentRef.current);
});

test('restoring an unwritten history snapshot compares against its materialized save point',async()=>{
 const saved=initial(),drawing=add(saved),restored=paintCheckpoint({...drawing},saved),calls=[];
 await restored.flush(drawing,async owners=>calls.push(owners.map(owner=>owner.key)));
 assert.deepEqual(calls,[['background']]);assert.equal(restored.saved,drawing);
});

function appQwenInsert({paint=false,locked=false,changed=false,wrongSession=false,fail=false}={}){
 let expression;
 function find(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='insertQwenImage')expression=node.initializer.getText(ast);ts.forEachChild(node,find);}
 find(ast);
 const compiled=ts.transpileModule(`(${expression})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const document={manga:{}},owner=initial().owners[1],calls=[];
 if(locked)owner.paint.layers[0].locked=true;
 const context={Error,qwenGeneration:{document,pageIndex:1,panelIndex:3,overlay:false,owner},documentRef:{current:changed?{}:document},projectOperation:{current:false},imageImportBusy:false,
  paintSessionRef:{current:paint?{pageIndex:1,panelIndex:wrongSession?2:3,overlay:false}:null},paintOwnerLocked,
  paintController:{current:{insertImage:async(file,key)=>{if(fail)throw Error('import failed');calls.push(['paint',file,key]);}}},
  importPlacedImage:async(file,target)=>{if(fail)throw Error('import failed');calls.push(['placed',file,target]);},
  setQwenGeneration:value=>calls.push(['dialog',value]),setToast:text=>calls.push(['toast',text])};
 return {insert:runInNewContext(compiled,context),calls,context};
}
test('generated artwork uses the captured destination and existing import path, then closes the dialog',async()=>{
 const file={name:'from-another-panel.png'};
 const placed=appQwenInsert();await placed.insert(file);
 const target=placed.calls[0][2];
 assert.equal(placed.calls[0][0],'placed');assert.equal(placed.calls[0][1],file);
 assert.equal(target.pageIndex,1);assert.equal(target.panelIndex,3);assert.equal(target.figureIndex,0);assert.equal(target.scope,'panel');
 assert.deepEqual({...target.box},placed.context.qwenGeneration.owner.frame);
 assert.deepEqual(placed.calls[1],['dialog',null]);
 const painting=appQwenInsert({paint:true});await painting.insert(file);
 assert.deepEqual(painting.calls[0],['paint',file,'figure-0']);assert.deepEqual(painting.calls[1],['dialog',null]);
});
test('generated-image insertion keeps the dialog and document when the destination changed, is locked or import fails',async()=>{
 for(const options of [{changed:true},{locked:true},{paint:true,wrongSession:true},{fail:true},{paint:true,fail:true}]){
  const h=appQwenInsert(options);await assert.rejects(h.insert({name:'output.png'}));assert.deepEqual(h.calls,[]);
 }
});
