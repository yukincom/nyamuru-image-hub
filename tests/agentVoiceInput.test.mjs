import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as jsxRuntime from 'preact/jsx-runtime';
import ts from 'typescript';
import * as preferences from '../src/lib/agentPreferences.ts';
import * as generationPreferences from '../src/lib/generationPreferences.ts';
import * as localModelPreferences from '../src/lib/localModelPreferences.ts';
import * as modelRouting from '../src/lib/modelRouting.ts';
import * as voiceCommands from '../src/lib/voiceCommands.ts';
import * as agentSession from '../src/lib/agentSession.ts';

function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];return [tree,...nodes(tree.props?.children)]}
function text(tree){if(Array.isArray(tree))return tree.map(text).join('');if(tree==null||typeof tree==='boolean')return '';return typeof tree==='object'?text(tree.props?.children):String(tree)}
function find(tree,predicate){const value=nodes(tree).find(predicate);assert.ok(value,'Expected UI element');return value}
const button=(tree,label)=>find(tree,n=>n.type==='button'&&(n.props['aria-label']===label||text(n)===label));
const select=(tree,label)=>find(tree,n=>n.type==='select'&&n.props['aria-label']===label);

function component(path,imports={}){
  let cursor=0;const slots=[],effects=[],exports={};
  const useRef=initial=>{const i=cursor++;return slots[i]??(slots[i]={current:initial})};
  const hooks={useRef,useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;
    return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},
    useEffect:(run,deps)=>{const i=cursor++,previous=slots[i];if(!previous||deps.some((v,j)=>v!==previous.deps[j])){slots[i]={deps};effects.push(()=>{previous?.cleanup?.();slots[i].cleanup=run()})}}};
  const modules={'preact/compat':{createPortal:tree=>tree},'preact/jsx-runtime':jsxRuntime,'preact/hooks':hooks,'../lib/agentPreferences':preferences,'../lib/generationPreferences':generationPreferences,'../lib/localModelPreferences':localModelPreferences,'../lib/modelRouting':modelRouting,'../lib/voiceCommands':voiceCommands,'../lib/agentSession':agentSession,
    '../lib/localBridge':{},'../lib/agentChat':{},'./AgentAvatar':{__esModule:true,default:'AgentAvatar'},'./Fields':{Field:'Field',SectionTitle:'SectionTitle'},
    'lucide-preact':new Proxy({},{get:(_,name)=>String(name)}),...imports};
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'preact'}}).outputText;
  runInNewContext(compiled,{exports,require:name=>{assert.ok(name in modules,name);return modules[name]},Error,Array,structuredClone,console});
  return {render(props){cursor=0;let tree=exports.default(props);const child=nodes(tree).find(n=>typeof n.type==='function'&&n.type.name==='AgentConversation');if(child)tree=child.type(child.props);while(effects.length)effects.shift()();return tree},
    dispose(){for(const slot of slots)slot?.cleanup?.()}};
}

function voiceFixture({request,revision=()=> 'r1',generation}={}){
  let capture,active=false,recordingEpoch=0,classified=0,applied=0;
  const recorder={
    get active(){return active},
    start(){active=true;capture.active(true);capture.status('録音中…')},
    stop(discard=false){active=false;if(discard)recordingEpoch++;capture.active(false)},
    dispose(){this.stop(true)},
  };
  const view=component('src/components/VoiceCommands.tsx',{'../lib/editorVoice':{createEditorDictation:options=>{capture=options;return recorder}}});
  let props={generation,profile:{...preferences.DEFAULT_AGENT_PREFERENCES},open:true,onToggle(){},onChangeProfile:value=>{props={...props,profile:preferences.saveAgentPreferences({setItem(){}},value)}},
    connection:async()=>({connected:false}),revision,apply:()=>{applied++;return '保存しました（検証）'},
    request:async(action,body)=>{assert.equal(action,'voice/classify');classified++;return request?request(action,body):{text:body.text,label:'save',confidence:1,model:'fixture',elapsed_ms:0}}};
  const render=()=>view.render(props);render();
  return {render,view,recorder,get capture(){return capture},get classified(){return classified},get applied(){return applied},get profile(){return props.profile},
    async utterance(value){const ticket=recordingEpoch;capture.processing(true);try{await capture.text(value,{mode:capture.settings().mode,isCurrent:()=>recordingEpoch===ticket})}finally{capture.processing(false)}},
  };
}

test('manual microphone keeps waiting dots and requires an explicit send after transcription',async()=>{
  const f=voiceFixture();let tree=f.render();
  button(tree,'手動入力を開始').props.onClick();tree=f.render();
  assert.equal(f.capture.settings().mode,'manual');assert.equal(f.profile.voiceInputMode,'manual');
  assert.match(text(tree),/じっくり入力中\.{9}/);assert.equal(button(tree,'軽量対話をオン（自動送信）').props.disabled,true);
  assert.equal(button(tree,'送信').props.disabled,true);assert.equal(button(tree,'手動入力を停止して文字起こし').props.disabled,false);
  const dots=find(tree,n=>n.props?.class==='agent-listening-dots');assert.equal(dots.props['aria-hidden'],'true');
  await f.utterance('保存して');tree=f.render();assert.equal(f.classified,0);assert.equal(f.applied,0);
  assert.equal(find(tree,n=>n.type==='textarea').props.value,'保存して');assert.equal(button(tree,'送信').props.disabled,true);
  button(tree,'手動入力を停止して文字起こし').props.onClick();f.capture.processing(true);tree=f.render();
  assert.equal(button(tree,'送信').props.disabled,true);assert.equal(button(tree,'手動入力を開始').props.disabled,true);
  f.capture.processing(false);tree=f.render();assert.equal(button(tree,'送信').props.disabled,false);
  await find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(f.classified,1);assert.equal(f.applied,1);f.view.dispose();
});

test('dedicated hands-free toggle automatically executes consecutive utterances without mixing a typed draft',async()=>{
  const inputs=[];const f=voiceFixture({request:async(_action,body)=>{inputs.push(body.text);return {text:body.text,label:'save',confidence:1,model:'fixture',elapsed_ms:0}}});
  let tree=f.render();find(tree,n=>n.type==='textarea').props.onInput({currentTarget:{value:'未送信のメモ'}});tree=f.render();
  button(tree,'軽量対話をオン（自動送信）').props.onClick();tree=f.render();
  assert.equal(f.capture.settings().mode,'quick');assert.equal(button(tree,'軽量対話をオフ').props['aria-pressed'],true);
  assert.equal(button(tree,'手動入力を開始').props.disabled,true);assert.equal(button(tree,'送信').props.disabled,true);
  await f.utterance('保存して');await f.utterance('保存して');tree=f.render();
  assert.deepEqual(inputs,['保存して','保存して']);assert.equal(f.applied,2);assert.equal(f.classified,2);assert.equal(f.recorder.active,true);
  assert.equal(find(tree,n=>n.type==='textarea').props.value,'未送信のメモ');assert.equal(button(tree,'軽量対話をオフ').props.disabled,false);
  assert.match(text(tree),/軽量対話オン.*自動送信/);f.view.dispose();
});

test('hands-free can be turned off during classification and its pending command never applies',async()=>{
  let resolve;const f=voiceFixture({request:(_action,body)=>new Promise(done=>{resolve=()=>done({text:body.text,label:'save',confidence:1,model:'fixture',elapsed_ms:0})})});
  button(f.render(),'軽量対話をオン（自動送信）').props.onClick();const pending=f.utterance('保存して');
  let tree=f.render();assert.equal(f.classified,1);assert.equal(button(tree,'軽量対話をオフ').props.disabled,false);
  button(tree,'軽量対話をオフ').props.onClick();assert.equal(f.recorder.active,false);resolve();await pending;tree=f.render();
  assert.equal(f.applied,0);assert.equal(button(tree,'軽量対話をオン（自動送信）').props.disabled,false);
  assert.doesNotMatch(text(tree),/考え中/);f.view.dispose();
});

test('closing the conversation or changing the manuscript cancels pending hands-free execution',async()=>{
  for(const cancel of ['close','revision']){
    let resolve,current='r1';const f=voiceFixture({revision:()=>current,request:(_action,body)=>new Promise(done=>{resolve=()=>done({text:body.text,label:'save',confidence:1,model:'fixture',elapsed_ms:0})})});
    button(f.render(),'軽量対話をオン（自動送信）').props.onClick();const pending=f.utterance('保存して');
    if(cancel==='close')f.view.dispose();else current='r2';resolve();await pending;assert.equal(f.applied,0);f.view.dispose();
  }
});

test('stored quick preference does not activate either microphone when the conversation opens',()=>{
  const f=voiceFixture(),tree=f.render();
  assert.equal(f.profile.voiceInputMode,'quick');assert.equal(f.recorder.active,false);
  assert.equal(button(tree,'軽量対話をオン（自動送信）').props['aria-pressed'],false);
  assert.equal(button(tree,'手動入力を開始').props['aria-pressed'],false);f.view.dispose();
});

test('agent settings omit voice help and silence controls while preserving stored voice preferences',()=>{
  const view=component('src/components/AgentSettings.tsx');
  let props={profile:{name:'ねこ先生',avatar:'',tone:'短く話す',voiceInputMode:'manual',voiceSilenceMs:2000},onChange:value=>{props={...props,profile:preferences.saveAgentPreferences({setItem(){}},value)}}};
  let tree=view.render(props);
  assert.doesNotMatch(text(tree),/音声入力|時計付きマイク|無音を待つ時間|次に軽量対話/);
  assert.equal(nodes(tree).some(n=>n.type==='select'),false);
  find(tree,n=>n.props?.['aria-label']==='エージェントの名前').props.onInput({currentTarget:{value:'ねこ'}});
  tree=view.render(props);find(tree,n=>n.props?.['aria-label']==='エージェントの名前').props.onBlur();
  assert.equal(props.profile.name,'ねこ');assert.equal(props.profile.voiceSilenceMs,2000);
  assert.equal(props.profile.voiceInputMode,'manual');assert.equal(props.profile.tone,'短く話す');view.dispose();
});

test('active generation conversation receives text and hands-free commands without a second classifier lease',async()=>{
 const sent=[];const generation={label:'1ページ・コマ1・小雪',busy:false,locked:false,phase:'',character:true,references:[],addFiles:async()=>{},send:async(text,isCurrent)=>{assert.equal(isCurrent(),true);sent.push(text);return '差し込みました'}};
 const f=voiceFixture({generation});let tree=f.render();
 find(tree,n=>n.type==='textarea').props.onInput({currentTarget:{value:'笑顔にする'}});tree=f.render();await find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});
 button(f.render(),'軽量対話をオン（自動送信）').props.onClick();await f.utterance('生成して');
 assert.deepEqual(sent,['笑顔にする','生成して']);assert.equal(f.classified,0);assert.equal(f.applied,0);assert.match(text(f.render()),/差し込みました/);f.view.dispose();
});
// 見込み: 生成の準備中も会話は受け付け、案内を通常の履歴へ戻せる。
// 合格: typed送信は1回、返答前の連打は0回追加、未準備案内と進捗を表示。範囲: 実UI処理と固定send応答。準備判定・LLMは別試験。
test('generation preparation accepts typed requests and retains conversation submission exclusion',async()=>{
 let resolve;const sent=[];
 const generation={label:'小雪',busy:true,locked:false,phase:'人物資料を読み込み中',send:(value,isCurrent)=>{
  assert.equal(isCurrent(),true);sent.push(value);return new Promise(done=>{resolve=done;});
 }};
 const f=voiceFixture({generation});let tree=f.render();
 assert.equal(find(tree,n=>n.type==='textarea').props.disabled,false);
 find(tree,n=>n.type==='textarea').props.onInput({currentTarget:{value:'生成して'}});tree=f.render();
 assert.equal(button(tree,'送信').props.disabled,false);
 const submit=()=>find(f.render(),n=>n.type==='form').props.onSubmit({preventDefault(){}});
 const pending=submit();tree=f.render();
 assert.equal(find(tree,n=>n.type==='textarea').props.disabled,true);
 assert.equal(button(tree,'送信').props.disabled,true);
 assert.equal(button(tree,'軽量対話をオン（自動送信）').props.disabled,true);
 find(tree,n=>n.type==='textarea').props.onInput({currentTarget:{value:'もう一度生成して'}});
 await submit();assert.deepEqual(sent,['生成して']);assert.match(text(f.render()),/人物資料を読み込み中/);
 resolve('準備が整っていません。人物資料を読み込み中です。');await pending;tree=f.render();
 const messages=nodes(tree).filter(n=>n.props?.class?.startsWith('agent-message is-')&&!n.props['data-generation-progress']);
 assert.deepEqual(messages.map(text),['生成して','準備が整っていません。人物資料を読み込み中です。']);
 assert.equal(find(tree,n=>n.type==='textarea').props.disabled,false);
 assert.equal(find(tree,n=>n.type==='textarea').props.value,'もう一度生成して');
 assert.equal(f.classified,0);assert.equal(f.applied,0);assert.deepEqual(sent,['生成して']);f.view.dispose();
});
// 見込み: 生成busy中も軽量対話を開始し、同じsenderから未準備案内を得る。
// 合格: 同時発話はsend1回、処理中も音声オフ可能。範囲: 実受付処理、録音・sendは模擬。実ASR/LLMは確認しない。
test('generation preparation accepts voice requests without overlapping conversation sends',async()=>{
 let resolve;const sent=[];
 const generation={label:'小雪',busy:true,locked:false,phase:'画像生成中',send:value=>{
  sent.push(value);return new Promise(done=>{resolve=done;});
 }};
 const f=voiceFixture({generation});let tree=f.render();
 assert.equal(button(tree,'手動入力を開始').props.disabled,false);
 assert.equal(button(tree,'軽量対話をオン（自動送信）').props.disabled,false);
 button(tree,'軽量対話をオン（自動送信）').props.onClick();
 const pending=f.utterance('生成して');await f.utterance('もう一度生成して');tree=f.render();
 assert.deepEqual(sent,['生成して']);assert.equal(button(tree,'軽量対話をオフ').props.disabled,false);
 assert.match(text(tree),/画像生成中/);
 resolve('準備が整っていません。現在の画像生成が終わるまでお待ちください。');await pending;
 assert.match(text(f.render()),/準備が整っていません。現在の画像生成が終わるまでお待ちください。/);
 button(f.render(),'軽量対話をオフ').props.onClick();assert.equal(f.recorder.active,false);
 assert.equal(f.classified,0);assert.equal(f.applied,0);assert.deepEqual(sent,['生成して']);f.view.dispose();
});
// 見込み: 生成の資料操作は左側に集約する。合格: 会話入力と送信はあり、資料用のselect/file/buttonはない。範囲: 生成時の実コンポーネント、音声機器なし。
test('generation conversation keeps its composer and has no parallel attachment controls',()=>{
 const f=voiceFixture({generation:{label:'小雪',busy:false,phase:'',send:async()=>''}}),tree=f.render();
 assert.ok(find(tree,n=>n.type==='textarea'&&n.props['aria-label']==='メッセージ'));assert.ok(button(tree,'送信'));
 assert.equal(nodes(tree).some(n=>n.type==='select'||n.type==='input'&&n.props.type==='file'||text(n)==='登録資料を使う'),false);f.view.dispose();
});

// 見込み: 会話から生成開始しても、状況確認は実行中の処理へ追加送信せず即答できる。
// 合格: typed/音声の追加入力に状況を返しsendは1回、完了も履歴へ1回。実受付処理、生成/録音は模擬。
test('a generation started from the composer accepts status queries while awaiting its result',async()=>{
 let resolve,working=false;const sent=[];
 const generation={label:'人物',busy:false,locked:false,phase:'',
  pendingStatus:()=>working?'準備が整っていません。ComfyUIを起動中です。':null,
  send:value=>{sent.push(value);working=true;return new Promise(done=>{resolve=done;});}};
 const f=voiceFixture({generation});
 const type=value=>{find(f.render(),n=>n.type==='textarea').props.onInput({currentTarget:{value}});};
 const submit=()=>find(f.render(),n=>n.type==='form').props.onSubmit({preventDefault(){}});
 type('生成して');const pending=submit();
 assert.equal(find(f.render(),n=>n.type==='textarea').props.disabled,false);
 type('いまどうなっている？');await submit();
 button(f.render(),'軽量対話をオン（自動送信）').props.onClick();await f.utterance('生成して');
 button(f.render(),'軽量対話をオフ').props.onClick();
 assert.deepEqual(sent,['生成して']);
 const messages=()=>nodes(f.render()).filter(n=>n.props?.class?.startsWith('agent-message is-')).map(text);
 assert.deepEqual(messages(),['生成して','いまどうなっている？','準備が整っていません。ComfyUIを起動中です。','生成して','準備が整っていません。ComfyUIを起動中です。']);
 working=false;resolve('候補を5枚生成しました');await pending;
 assert.equal(messages().at(-1),'候補を5枚生成しました');assert.equal(sent.length,1);f.view.dispose();
});
