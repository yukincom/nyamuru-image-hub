import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as jsxRuntime from 'preact/jsx-runtime';
import ts from 'typescript';
import * as preferences from '../src/lib/agentPreferences.ts';
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
  const modules={'preact/compat':{createPortal:tree=>tree},'preact/jsx-runtime':jsxRuntime,'preact/hooks':hooks,'../lib/agentPreferences':preferences,'../lib/voiceCommands':voiceCommands,'../lib/agentSession':agentSession,
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
test('generation busy state blocks typed submission but preserves the active hands-free off button',async()=>{
 const generation={label:'小雪',busy:false,locked:false,phase:'画像生成中',character:true,references:[],addFiles:async()=>{},send:async()=>''};
 const f=voiceFixture({generation});button(f.render(),'軽量対話をオン（自動送信）').props.onClick();generation.busy=true;
 let tree=f.render();assert.equal(button(tree,'送信').props.disabled,true);assert.equal(button(tree,'軽量対話をオフ').props.disabled,false);assert.match(text(tree),/画像生成中/);f.view.dispose();
});
// 見込み: 生成の資料操作は左側に集約する。合格: 会話入力と送信はあり、資料用のselect/file/buttonはない。範囲: 生成時の実コンポーネント、音声機器なし。
test('generation conversation keeps its composer and has no parallel attachment controls',()=>{
 const f=voiceFixture({generation:{label:'小雪',busy:false,phase:'',send:async()=>''}}),tree=f.render();
 assert.ok(find(tree,n=>n.type==='textarea'&&n.props['aria-label']==='メッセージ'));assert.ok(button(tree,'送信'));
 assert.equal(nodes(tree).some(n=>n.type==='select'||n.type==='input'&&n.props.type==='file'||text(n)==='登録資料を使う'),false);f.view.dispose();
});
