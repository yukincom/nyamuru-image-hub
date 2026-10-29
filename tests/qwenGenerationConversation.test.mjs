import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {runQwenAgentRequest,qwenConversationIntent,executeQwenGeneration,qwenGenerationPayload,qwenGenerationTarget,requireQwenInsertionTarget} from '../src/lib/qwenGeneration.ts';
import {loadGenerationPreferences,saveGenerationPreferences} from '../src/lib/generationPreferences.ts';
import {cloudModelAccess} from '../src/lib/modelPrivacy.ts';

const plan={profile:'qwen-image-2.1-owner-v1',documentKey:'work',pageNumber:2,panelId:3,overlay:false,ownerKey:'figure-1',label:'小雪',width:320,height:480,prompt:'人物を描く',characterKeys:['koyuki'],candidates:[]};
function fixture({status='succeeded',change={},cancelAt='',failRestore=false}={}){
 const calls=[];let current=true;
 const prepared={...plan,jobId:'job',requestSha256:'a'.repeat(64),status:'prepared'};
 const result={...prepared,status,image:'data:image/png;base64,AA==',fileName:'result.png',...change};
 const options={id:'job',plan,payload:qwenGenerationPayload(plan,[{label:'資料',characterKeys:['koyuki'],image:'data:ref'}]),
  prepare:async()=>{calls.push('prepare');return prepared},submit:async()=>{calls.push('submit');if(cancelAt==='submit')current=false;return result},
  reconcile:async()=>{calls.push('reconcile');return {...result,status:'succeeded'}},onJob:()=>calls.push('job'),isCurrent:()=>current,
  wait:async()=>{calls.push('wait');if(cancelAt==='wait')current=false},insert:async()=>calls.push('insert'),
  services:async(prepare,generate,{isCurrent})=>{const job=await prepare();if(cancelAt==='prepare')current=false;let result;
   try{if(isCurrent())result=await generate(job,'lease')}finally{calls.push('restore');if(cancelAt==='restore')current=false;if(failRestore)throw Error('restore failed')}
   return result;
  }};
 return {calls,options,result};
}
test('only complete affirmative generation commands execute; holds, quotes and questions cannot execute',()=>{
 for(const text of ['生成して','生成してください。','この画像で生成して','今の条件で生成してください','これで画像を生成して','そのまま生成を開始して'])assert.equal(qwenConversationIntent(text),'generate',text);
 for(const text of ['生成しないで','まだ生成してほしくない','生成せず待って','生成して、いややめて'])assert.equal(qwenConversationIntent(text),'hold',text);
 for(const text of ['「生成して」と言えばいい？','生成してくださいと言われた','生成できますか','この画像を説明して？'])assert.equal(qwenConversationIntent(text),'help',text);
 for(const text of ['顔は笑顔で、右を見る','背景は不要です','笑顔にはしないでください','別人の顔にしないで','目に「星」を入れて','待っている姿'])assert.equal(qwenConversationIntent(text),'instruction',text);
});
test('conversation executes once and inserts after service restoration into the captured owner',async()=>{
 const f=fixture();const result=await executeQwenGeneration(f.options);
 assert.equal(result.inserted,true);assert.deepEqual(f.calls,['prepare','submit','job','restore','insert']);
});
test('queued generation polls using the prepared job and inserts only the succeeded result',async()=>{
 const f=fixture({status:'queued'});f.options.reconcile=async(id,sha)=>{assert.equal(id,'job');assert.equal(sha,'a'.repeat(64));f.calls.push('reconcile');return {...f.result,status:'succeeded'}};
 assert.equal((await executeQwenGeneration(f.options)).inserted,true);
 assert.deepEqual(f.calls,['prepare','submit','job','wait','reconcile','job','restore','insert']);
});
test('button generation shares the pipeline while leaving insertion to its existing button',async()=>{
 const f=fixture();delete f.options.insert;assert.equal((await executeQwenGeneration(f.options)).inserted,false);assert.ok(!f.calls.includes('insert'));
});
test('cancellation before submission, during generation, or after restoration prevents insertion',async()=>{
 for(const cancelAt of ['prepare','submit','wait','restore']){
  const f=fixture({status:cancelAt==='wait'?'running':'succeeded',cancelAt});assert.equal((await executeQwenGeneration(f.options)).inserted,false);
  assert.ok(!f.calls.includes('insert'));assert.ok(f.calls.includes('restore'));if(cancelAt==='prepare')assert.ok(!f.calls.includes('submit'));
 }
});
test('failed, unknown and mismatched jobs never insert or automatically submit again',async()=>{
 for(const option of [{status:'failed'},{status:'outcome_unknown'},...Object.entries({jobId:'other',requestSha256:'b'.repeat(64),documentKey:'other',pageNumber:9,panelId:9,overlay:true,ownerKey:'figure-2'}).map(([key,value])=>({change:{[key]:value}}))]){
  const f=fixture(option);await assert.rejects(executeQwenGeneration(f.options));assert.equal(f.calls.filter(x=>x==='submit').length,1);assert.ok(!f.calls.includes('insert'));
 }
});
test('restoration failure leaves the result available but never inserts',async()=>{
 const f=fixture({failRestore:true});await assert.rejects(executeQwenGeneration(f.options),/restore failed/);assert.ok(!f.calls.includes('insert'));assert.ok(f.calls.includes('job'));
});
test('character reference and drawing reference roles remain separate in the existing payload',()=>{
 const refs=[{label:'設定画',characterKeys:['koyuki'],image:'data:character'},{label:'服の参考',characterKeys:[],image:'data:drawing'}];
 assert.deepEqual(qwenGenerationPayload(plan,refs).references.map(r=>r.character_keys),[['koyuki'],[]]);
 assert.throws(()=>qwenGenerationPayload(plan,[refs[1]]),/参照資料を選んで/);
 assert.throws(()=>requireQwenInsertionTarget({...fixture().result,image:undefined},plan,'job','a'.repeat(64)),/完了していません/);
});


test('agent handoff loads registered references then uses the same generator and insertion pipeline',async()=>{
 const f=fixture(),events=[];let resolved;
 await runQwenAgentRequest({isCurrent:()=>true,resolve:value=>{resolved=value;},reject:assert.fail},
   async()=>events.push('references'),async(text,isCurrent)=>{assert.equal(text,'生成して');assert.equal(isCurrent(),true);events.push('generate');return (await executeQwenGeneration(f.options)).inserted?'差し込みました':'中止';});
 assert.deepEqual(events,['references','generate']);assert.equal(resolved,'差し込みました');
 assert.deepEqual(f.calls,['prepare','submit','job','restore','insert']);
});
test('missing registered references or cancelled handoff never submits an image job',async()=>{
 for(const condition of ['missing','cancelled','cancel-after-load']){
   let current=condition!=='cancelled',rejected;
   await runQwenAgentRequest({isCurrent:()=>current,resolve:assert.fail,reject:error=>{rejected=error;}},
     async()=>{if(condition==='missing')throw Error('登録済みの人物資料がありません');current=false;},async()=>assert.fail('must not generate'));
   assert.match(rejected.message,/資料|中止/);
 }
});


function appFunction(name,context,file='App.tsx'){
 const ast=ts.createSourceFile(file,readFileSync(new URL('../src/components/'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let expression;
 const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)expression=node.initializer.getText(ast);
   if(ts.isFunctionDeclaration(node)&&node.name?.getText(ast)===name)expression=node.getText(ast);ts.forEachChild(node,visit);};visit(ast);
 assert.ok(expression);return runInNewContext(ts.transpileModule(`(${expression})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{Error,...context});
}
// 見込み: 撮影待ちの間にクラウド設定・同意が撤回されたら送信資料を作らない。合格: 許可時だけZIPとdownload各1回、撤回時は両方0回。範囲: 実generate関数と模擬撮影待ち、生成範囲helperは実装を使用。
test('cloud handoff rechecks current execution and adult consent after pending capture, before ZIP creation',async()=>{
 for(const revoked of ['none','execution','consent']){
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const execution=loadGenerationPreferences(storage);execution.execution='cloud';execution.cloud.adultTermsConfirmed=true;
  saveGenerationPreferences(storage,execution);
  let finishCapture;const calls=[];
  const context={operation:task=>task(),attempted:{current:null},draft:{current:{prompt:plan.prompt,references:[{label:'資料',characterKeys:['koyuki'],image:'data:reference'}]}},
   alive:{current:true},usesPoseImage:true,setPhase:()=>{},posePending:{current:new Promise(resolve=>{finishCapture=resolve;})},plan,qwenGenerationPayload,qwenGenerationTarget,generatedTarget:{current:undefined},
   cloud:true,execution,adultContent:true,currentGenerationPreferences:()=>loadGenerationPreferences(storage),cloudModelAccess,
   generationHandoff:()=>{calls.push('zip');return 'archive';},downloadBrowserBlob:()=>calls.push('download'),setNotice:()=>{}};
  const pending=appFunction('generate',context,'QwenGenerationDialog.tsx')();
  const current=loadGenerationPreferences(storage);
  if(revoked==='execution')current.execution='local';
  if(revoked==='consent')current.cloud.adultTermsConfirmed=false;
  saveGenerationPreferences(storage,current);finishCapture(undefined);
  if(revoked==='none'){assert.equal((await pending).inserted,false);assert.deepEqual(calls,['zip','download']);}
  else {await assert.rejects(pending,/環境設定でクラウド/);assert.deepEqual(calls,[]);}
 }
});
test('App awaits actual generation and aborts if selection or another generation changes during preflight',async()=>{
 for(const change of ['none','selection','document','other-generation']){
   let finishProbe,revision='initial',opened=0;
   const document={manga:{}},context={hasDocument:true,showNewDialog:false,projectOperation:{current:false},layerSwitch:{current:false},imageImportBusy:false,qwenGeneration:null,
     paintController:{current:null},paintSessionRef:{current:null},documentRef:{current:document},activePage:0,activePanel:0,selectedElement:null,environmentOpen:false,
     latestVoiceRevision:{current:()=>revision},resolveVoiceGenerationTarget:()=>({kind:'figure',index:0,overlay:false,panelIndex:0,pageIndex:0}),
     connectAgentImageGeneration:()=>new Promise(resolve=>{finishProbe=resolve;}),
     requestOwnerGeneration:async(key,overlay,panel,page,request)=>{opened++;assert.equal(key,'figure-0');request.resolve('生成して差し込みました');return true;}};
   const result=appFunction('applyVoiceCommand',context)({op:'generate_selected',kind:'selected'});
   if(change==='document')context.documentRef.current={manga:{}};
   else if(change!=='none')revision=change;
   finishProbe();
   if(change==='none'){assert.equal(await result,'生成して差し込みました');assert.equal(opened,1);}
   else {await assert.rejects(result,/変更/);assert.equal(opened,0);}
 }
});
test('generation entry reads the live session ref instead of an old render closure',async()=>{
 const request=appFunction('requestOwnerGeneration',{selectedElement:null,activePanel:0,activePage:0,qwenGeneration:null,
   qwenGenerationRef:{current:{id:'other-session'}}});
 assert.equal(await request('figure-0'),undefined);
});

test('composition planning reads guide visibility from the document saved when paint closes',async()=>{
 const before={manga:{pages:[{panels:[{figures:[{}],bubbles:[]}]}]}},after=structuredClone(before),calls=[];
 const context={documentRef:{current:before},qwenGenerationRef:{current:null},qwenPreparing:{current:false},imageImportBusy:false,projectOperation:{current:false},
   paintSessionRef:{current:{}},paintController:{current:{close:async()=>{context.documentRef.current=after;}}},
   artworkGuideVisible:(key,panel,page,overlay,current)=>{assert.equal(current,after);calls.push(key);return false;},
   buildQwenCompositionPlan:(manga,page,panel,scope,guides)=>{assert.equal(manga,after.manga);assert.equal(guides['0:figure-0'],false);return {scope};},
   captureQwenComposition:async()=> 'data:composite',crypto:{randomUUID:()=> 'job'},setToast:()=>{},setVoiceOpen:()=>{},setQwenGeneration:value=>calls.push(value)};
 await appFunction('requestCompositionGeneration',context)('page',-1,0);
 assert.equal(calls.at(-1).document,after);assert.equal(calls.at(-1).plan.compositionImage,'data:composite');assert.equal(context.qwenPreparing.current,false);
});
