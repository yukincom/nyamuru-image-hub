import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as preferences from '../src/lib/agentPreferences.ts';

const source=readFileSync(new URL('../src/lib/editorVoice.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const flush=async()=>{await new Promise(setImmediate);await new Promise(setImmediate)};

function fixture({settings,permission,deferStop=false,onText}={}){
  let now=0,level=0,timerId=0,trackStops=0,closes=0;
  const timers=new Map(),recorders=[],requests=[],texts=[],statuses=[],active=[],processing=[],stopEvents=[];
  const stream={getTracks:()=>[{stop:()=>{trackStops++}}]};
  class Recorder{
    onstop;ondataavailable;
    static isTypeSupported(){return true}
    constructor(_stream,options){this.mimeType=options.mimeType;this.state='inactive';recorders.push(this)}
    start(){this.state='recording'}
    stop(){assert.equal(this.state,'recording');this.state='inactive';const finish=()=>{this.ondataavailable?.({data:new Blob(['encoded-audio'])});this.onstop?.()};if(deferStop)stopEvents.push(finish);else queueMicrotask(finish)}
  }
  class Context{
    resume(){return Promise.resolve()}
    close(){closes++;return Promise.resolve()}
    createAnalyser(){return {fftSize:0,getFloatTimeDomainData:values=>values.fill(level),disconnect(){}}}
    createMediaStreamSource(){return {connect(){},disconnect(){}}}
  }
  const exports={};
  runInNewContext(compiled,{exports,require:name=>name==='./agentPreferences.ts'?preferences:{requestVoiceCommand:()=>{throw Error('Unexpected external request')}},
    navigator:{mediaDevices:{getUserMedia:()=>permission?permission.then(()=>stream):Promise.resolve(stream)}},MediaRecorder:Recorder,AudioContext:Context,
    Error,Blob,Uint8Array,Float32Array,btoa,Date:{now:()=>now},setInterval:fn=>{timers.set(++timerId,fn);return timerId},clearInterval:id=>timers.delete(id)});
  const dictation=exports.createEditorDictation({settings,text:(value,context)=>{texts.push(value);return onText?.(value,context)},status:value=>statuses.push(value),active:value=>active.push(value),processing:value=>processing.push(value),
    request:(action,body)=>new Promise((resolve,reject)=>requests.push({action,body,resolve,reject}))});
  return {dictation,recorders,requests,texts,statuses,active,processing,get trackStops(){return trackStops},get closes(){return closes},
    async finishStop(){assert.ok(stopEvents.length);stopEvents.shift()();await flush()},
    async tick(ms,voice=false){level=voice?0.05:0;for(let elapsed=0;elapsed<ms;elapsed+=100){now+=100;for(const [id,fn] of [...timers])if(timers.has(id))fn();await flush()}},
  };
}

test('hands-free input sends each utterance once and resumes listening after its handler completes',async()=>{
  let finish;const f=fixture({onText:()=>new Promise(resolve=>{finish=resolve})});await f.dictation.start();await f.tick(300,true);await f.tick(900);
  assert.equal(f.dictation.active,true);assert.equal(f.requests.length,0);
  await f.tick(100);
  assert.equal(f.dictation.active,true);assert.equal(f.active.at(-1),true);assert.equal(f.recorders.length,1);
  assert.equal(f.trackStops,0);assert.equal(f.closes,0);assert.equal(f.requests.length,1);assert.equal(f.requests[0].action,'voice/transcribe');
  assert.equal(f.processing.at(-1),true);assert.deepEqual(f.texts,[]);
  f.requests[0].resolve({text:'保存して'});await flush();
  assert.deepEqual(f.texts,['保存して']);assert.equal(f.processing.at(-1),true);
  await f.tick(2000,true);assert.equal(f.recorders.length,1);assert.equal(f.requests.length,1);
  finish();await flush();assert.equal(f.processing.at(-1),false);assert.equal(f.recorders.length,2);
  await f.tick(300,true);await f.tick(1000);assert.equal(f.requests.length,2);
  f.requests[1].resolve({text:'次のページ'});await flush();finish();await flush();
  assert.deepEqual(f.texts,['保存して','次のページ']);assert.equal(f.recorders.length,3);assert.equal(f.dictation.active,true);
  f.dictation.stop(true);await flush();assert.equal(f.trackStops,1);assert.equal(f.closes,1);
});

test('quick pause uses the selected duration and continuing speech resets its countdown',async()=>{
  const f=fixture({settings:()=>({mode:'quick',silenceMs:2000})});await f.dictation.start();
  await f.tick(300,true);await f.tick(1500);await f.tick(100,true);await f.tick(1900);
  assert.equal(f.dictation.active,true);assert.equal(f.requests.length,0);await f.tick(100);assert.equal(f.dictation.active,true);
  assert.equal(f.requests.length,1);f.requests[0].resolve({text:'次のページ'});await flush();assert.equal(f.processing.at(-1),false);
  f.dictation.dispose();await flush();
});

test('manual input keeps recording through pauses and ends only when explicitly stopped',async()=>{
  const f=fixture({settings:()=>({mode:'manual',silenceMs:1000})});await f.dictation.start();
  await f.tick(300,true);await f.tick(1000);assert.equal(f.dictation.active,true);assert.equal(f.trackStops,0);assert.equal(f.recorders.length,2);
  assert.equal(f.requests.length,1);f.requests[0].resolve({text:'じっくり考えています'});await flush();
  assert.equal(f.processing.at(-1),false);assert.equal(f.dictation.active,true);
  await f.tick(300,true);f.dictation.stop();await flush();
  assert.equal(f.dictation.active,false);assert.equal(f.trackStops,1);assert.equal(f.requests.length,2);
  f.requests[1].resolve({text:'続きを入力'});await flush();assert.deepEqual(f.texts,['じっくり考えています','続きを入力']);assert.equal(f.processing.at(-1),false);
});

test('a manual stop keeps the final utterance and rejects a restart until transcription completes',async()=>{
  const f=fixture({settings:()=>({mode:'manual'})});await f.dictation.start();await f.tick(300,true);f.dictation.stop();await flush();
  await f.dictation.start();assert.equal(f.dictation.active,false);assert.equal(f.recorders.length,1);assert.equal(f.requests.length,1);
  f.requests[0].resolve({text:'途中まで話した文'});await flush();assert.deepEqual(f.texts,['途中まで話した文']);
  await f.dictation.start();assert.equal(f.dictation.active,true);assert.equal(f.recorders.length,2);f.dictation.dispose();await flush();
});

test('stopping between recorder inactivity and its final event still waits for the final transcript',async()=>{
  const f=fixture({settings:()=>({mode:'manual'}),deferStop:true});await f.dictation.start();await f.tick(300,true);await f.tick(800);
  assert.equal(f.recorders[0].state,'inactive');assert.equal(f.requests.length,0);
  f.dictation.stop();assert.equal(f.processing.at(-1),true);assert.equal(f.trackStops,0);
  await f.dictation.start();assert.equal(f.dictation.active,false);assert.equal(f.recorders.length,1);
  await f.finishStop();assert.equal(f.trackStops,1);assert.equal(f.requests.length,1);assert.equal(f.processing.at(-1),true);
  f.requests[0].resolve({text:'最後の言葉'});await flush();assert.deepEqual(f.texts,['最後の言葉']);assert.equal(f.processing.at(-1),false);
});

test('mode changes take effect on the next recording and keep the active manual session intact',async()=>{
  let settings={mode:'manual',silenceMs:1000};const f=fixture({settings:()=>settings});await f.dictation.start();
  settings={mode:'quick',silenceMs:500};await f.tick(300,true);await f.tick(1000);assert.equal(f.dictation.active,true);
  f.dictation.stop();await flush();f.requests[0].resolve({text:'手動の入力'});await flush();
  await f.dictation.start();await f.tick(300,true);await f.tick(400);assert.equal(f.dictation.active,true);await f.tick(100);
  assert.equal(f.dictation.active,true);assert.equal(f.requests.length,2);f.requests[1].resolve({text:'軽量の入力'});await flush();f.dictation.dispose();await flush();
});

test('closing during microphone permission or transcription never inserts late text',async()=>{
  let allow;const pending=fixture({permission:new Promise(resolve=>{allow=resolve})});const start=pending.dictation.start();pending.dictation.dispose();allow();await start;
  assert.equal(pending.trackStops,1);assert.equal(pending.recorders.length,0);
  const f=fixture();await f.dictation.start();await f.tick(300,true);await f.tick(1000);f.dictation.dispose();
  f.requests[0].resolve({text:'閉じた後の文'});await flush();assert.deepEqual(f.texts,[]);assert.equal(f.processing.at(-1),false);assert.equal(f.trackStops,1);
});

test('hands-free input keeps waiting through silence and segments long speech without turning off',async()=>{
  const silent=fixture();await silent.dictation.start();await silent.tick(60000);
  assert.equal(silent.dictation.active,true);assert.equal(silent.requests.length,0);assert.equal(silent.recorders.length,3);assert.equal(silent.trackStops,0);
  silent.dictation.dispose();await flush();assert.equal(silent.trackStops,1);
  const speaking=fixture();await speaking.dictation.start();await speaking.tick(30000,true);
  assert.equal(speaking.dictation.active,true);assert.equal(speaking.requests.length,1);assert.equal(speaking.recorders.length,1);
  speaking.requests[0].resolve({text:'長い入力'});await flush();assert.equal(speaking.recorders.length,2);speaking.dictation.dispose();await flush();
});

test('short noise and empty recognition keep hands-free listening without delivering a command',async()=>{
  const f=fixture();await f.dictation.start();await f.tick(100,true);await f.tick(1000);
  assert.equal(f.dictation.active,true);assert.equal(f.trackStops,0);assert.equal(f.requests.length,0);assert.equal(f.recorders.length,2);
  await f.tick(300,true);await f.tick(1000);f.requests[0].resolve({text:'  '});await flush();
  assert.deepEqual(f.texts,[]);assert.equal(f.recorders.length,3);f.dictation.dispose();await flush();
});

test('turning hands-free off during transcription discards late text and never restarts recording',async()=>{
  const f=fixture();await f.dictation.start();await f.tick(300,true);await f.tick(1000);
  f.dictation.stop(true);assert.equal(f.dictation.active,false);assert.equal(f.trackStops,1);
  f.requests[0].resolve({text:'実行しない'});await flush();
  assert.deepEqual(f.texts,[]);assert.equal(f.recorders.length,1);assert.equal(f.processing.at(-1),false);
});

test('turning hands-free off invalidates a running handler and final recorder events',async()=>{
  let context,finish;const f=fixture({onText:(_value,state)=>{context=state;return new Promise(resolve=>{finish=resolve})}});
  await f.dictation.start();await f.tick(300,true);await f.tick(1000);f.requests[0].resolve({text:'保存して'});await flush();
  assert.equal(context.isCurrent(),true);f.dictation.stop(true);assert.equal(context.isCurrent(),false);finish();await flush();
  assert.equal(f.recorders.length,1);assert.equal(f.processing.at(-1),false);assert.equal(f.trackStops,1);
  const delayed=fixture({deferStop:true});await delayed.dictation.start();await delayed.tick(300,true);await delayed.tick(1000);
  delayed.dictation.stop(true);await delayed.finishStop();assert.equal(delayed.requests.length,0);assert.equal(delayed.trackStops,1);
});

test('a failed transcription leaves the microphone off and makes retry available',async()=>{
  const f=fixture();await f.dictation.start();await f.tick(300,true);await f.tick(1000);f.requests[0].reject(new Error('認識に失敗しました'));await flush();
  assert.equal(f.dictation.active,false);assert.equal(f.processing.at(-1),false);assert.equal(f.statuses.at(-1),'認識に失敗しました');
  await f.dictation.start();assert.equal(f.dictation.active,true);f.dictation.dispose();await flush();
});
