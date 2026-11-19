// 見込み: 端末の用途別設定を解決し、未対応APIを別モデルへ流さず、開始後は設定を固定する。
// 範囲: 実reader/writer/route/会話service、StorageとHTTPは模擬。実モデル・API・作品保存は対象外。
import test from 'node:test';
import assert from 'node:assert/strict';
import {CONVERSATION_PREFERENCES_STORAGE_KEY,loadConversationPreferences,saveConversationPreferences} from '../src/lib/conversationPreferences.ts';
import {loadGenerationPreferences,saveGenerationPreferences,GENERATION_PREFERENCES_STORAGE_KEY} from '../src/lib/generationPreferences.ts';
import {loadLocalModelPreferences,saveLocalModelPreferences} from '../src/lib/localModelPreferences.ts';
import {resolveConversationRoute,resolveGenerationRoute} from '../src/lib/modelRouting.ts';
import {withAgentServices} from '../src/lib/bridge/editorServices.ts';
import {createGenerationActions} from '../src/components/generation/createGenerationActions.ts';

function storage() {
  const values=new Map();let failed=false;
  return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(failed)throw Error('quota');values.set(key,value);},fail:()=>{failed=true;}};
}

// 見込み/合格: 新規既定は会話local・確認省略OFF。読込0書込、会話更新は画像/解析設定のbyte不変、再読込一致。
test('conversation and generation preferences have independent device-local writers',()=>{
  const s=storage(),g=loadGenerationPreferences(s),c=loadConversationPreferences(s),local=loadLocalModelPreferences(s);
  assert.equal(c.execution,'local');assert.equal(g.skipTranslationConfirmation,false);assert.equal(s.values.size,0);
  saveGenerationPreferences(s,{...g,execution:'cloud',cloud:{...g.cloud,agent:'other',agentName:'Art agent'}});
  saveLocalModelPreferences(s,local);const before=new Map(s.values);
  const api={execution:'api',connectionId:'shared-connection',model:'multi-model'};
  assert.deepEqual(saveConversationPreferences(s,{...api,apiKey:'do-not-save',llmAlias:'do-not-duplicate'}),api);
  assert.deepEqual(loadConversationPreferences(s),api);
  for(const [key,value] of before)assert.equal(s.values.get(key),value);
  assert.deepEqual(Object.keys(JSON.parse(s.values.get(CONVERSATION_PREFERENCES_STORAGE_KEY))).sort(),['connectionId','execution','model','version']);
  s.fail();assert.throws(()=>saveConversationPreferences(s,{...c}),/quota/);assert.deepEqual(loadConversationPreferences(s),api);
});

// 見込み/合格: 不正/未知/読込拒否でAPIを有効にせず、書込時の検証失敗で値を残す。Storageのみ模擬。
test('invalid conversation values cannot select a connection or replace saved preferences',()=>{
  const s=storage(),base=loadConversationPreferences();saveConversationPreferences(s,base);
  const before=s.values.get(CONVERSATION_PREFERENCES_STORAGE_KEY);
  for(const value of [{...base,execution:'cloud'},{...base,connectionId:'https://user:secret@host'},{...base,model:'a\nb'}]) {
    assert.throws(()=>saveConversationPreferences(s,value));assert.equal(s.values.get(CONVERSATION_PREFERENCES_STORAGE_KEY),before);
    assert.deepEqual(loadConversationPreferences({getItem:()=>JSON.stringify({version:1,...value})}),base);
  }
  for(const raw of ['{','null','[]','{"version":99,"execution":"api"}'])assert.deepEqual(loadConversationPreferences({getItem:()=>raw}),base);
  assert.deepEqual(loadConversationPreferences({getItem:()=>{throw Error('denied');}}),base);
});

// 見込み/合格: 確認省略は既存画像writerにだけ保存、読込で副作用なし。実際の確認UIはP5で接続する。
test('translation review preference defaults off and round-trips through the image writer',()=>{
  const s=storage(),g=loadGenerationPreferences();
  saveGenerationPreferences(s,{...g,skipTranslationConfirmation:true});
  assert.equal(loadGenerationPreferences(s).skipTranslationConfirmation,true);
  assert.deepEqual([...s.values.keys()],[GENERATION_PREFERENCES_STORAGE_KEY]);
  assert.equal(loadGenerationPreferences({getItem:()=>JSON.stringify({...g,version:3,skipTranslationConfirmation:'true'})}).skipTranslationConfirmation,false);
});

// 見込み/合格: 会話API＋画像localでも同意が必要、同意後は未対応理由で停止。画像localはそのまま、逆の組合せも独立。
test('each purpose resolves independently while both cloud uses enforce the common content condition',()=>{
  const g=loadGenerationPreferences(),local=loadLocalModelPreferences(),c=loadConversationPreferences();
  const api={...c,execution:'api',connectionId:'same',model:'multi'};
  assert.equal(resolveConversationRoute(api,local,g.cloud,true).reason,'adult-terms-required');
  g.cloud.adultTermsConfirmed=true;
  assert.equal(resolveConversationRoute(api,local,g.cloud,true).reason,'api-unavailable');
  assert.equal(resolveGenerationRoute(g,local,true).kind,'local');
  g.execution='cloud';g.cloud.method='api';g.cloud.adultTermsConfirmed=false;
  assert.equal(resolveGenerationRoute(g,local,true).reason,'adult-terms-required');
  assert.deepEqual(resolveGenerationRoute(g,local,false),{kind:'cloud-api',model:'gemini-3.1-flash-image'});
  assert.deepEqual(resolveConversationRoute(c,local,g.cloud,true),{kind:'local',llmAlias:local.llmAlias});
  g.cloud.method='agent';g.cloud.adultTermsConfirmed=true;g.cloud.agent='other';g.cloud.agentName='External';
  assert.deepEqual(resolveGenerationRoute(g,local,true),{kind:'external-agent',agent:'other',label:'External'});
});

// 見込み/合格: 返却routeに可変設定の参照を持たず、後続の設定更新は次回だけ反映。純粋関数のみ。
test('resolved routes retain the selected models and workflow after settings change',()=>{
  const c=loadConversationPreferences(),g=loadGenerationPreferences(),local=loadLocalModelPreferences();
  const conversation=resolveConversationRoute(c,local,g.cloud),image=resolveGenerationRoute(g,local);
  const alias=local.llmAlias,workflow=g.local.workflowId;
  local.llmAlias='next-model';g.local.workflowId='next-workflow';local.comfyuiUrl='http://localhost:8199';
  assert.deepEqual(conversation,{kind:'local',llmAlias:alias});
  assert.deepEqual(image,{kind:'local',workflowId:workflow,comfyuiUrl:'http://127.0.0.1:8188'});
  assert.equal(resolveConversationRoute(c,local,g.cloud).llmAlias,'next-model');
});

// 見込み/合格: API設定でserviceを呼んでもHTTP/LLM/会話callbackは0回。実service入口、fetchは失敗する模擬。
test('unavailable conversation API never starts local services or runs the task',()=>{
  const previousWindow=globalThis.window,previousFetch=globalThis.fetch,s=storage();let requests=0;
  saveConversationPreferences(s,{execution:'api',connectionId:'future',model:'multi'});
  globalThis.window={localStorage:s};globalThis.fetch=async()=>{requests++;assert.fail('no request');};
  try {assert.throws(()=>withAgentServices(()=>assert.fail('no model task'),()=>true),/APIは未接続/);assert.equal(requests,0);}
  finally {globalThis.window=previousWindow;globalThis.fetch=previousFetch;}
});

// 見込み/合格: 画像API/翻訳APIの未接続はComfy起動・prepare前に拒否。実generate入口、保存値のみ模擬。
test('generation rejects unsupported image or translation routes before starting image services',async()=>{
  const previousWindow=globalThis.window,s=storage(),connection=loadLocalModelPreferences();
  globalThis.window={localStorage:s};
  try {
    for(const purpose of ['image','translation']) {
      const execution=loadGenerationPreferences();
      if(purpose==='image'){execution.execution='cloud';execution.cloud.method='api';}
      else saveConversationPreferences(s,{execution:'api',connectionId:'future',model:'multi'});
      const actions=createGenerationActions({operation:task=>task(),attempted:{current:null},targetError:'',
        execution,connection,adultContent:false,workflow:{binding:{prompt_mode:'qwen'}},plan:{},
        ensureComfy:()=>assert.fail('must not start ComfyUI')});
      await assert.rejects(actions.generate(), purpose === 'image' ? /クラウドAPI/ : /APIは未接続/);
    }
  } finally {globalThis.window=previousWindow;}
});

// 見込み/合格: 起動待ちに設定が変わっても初回aliasでprepareし、次回だけ新alias。実serviceとlifecycle、HTTPのみ模擬。
test('conversation lifecycle captures the local model before its first asynchronous request',async()=>{
  const previousWindow=globalThis.window,previousFetch=globalThis.fetch,s=storage(),models=[],local=loadLocalModelPreferences();
  saveLocalModelPreferences(s,{...local,llmAlias:'first-model'});
  globalThis.window={localStorage:s,addEventListener:()=>{},removeEventListener:()=>{}};
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);
    const response={service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1};
    if(String(url).endsWith('/start')) {saveLocalModelPreferences(s,{...local,llmAlias:'next-model'});response.lease_token='lease';}
    if(String(url).endsWith('/prepare'))models.push(body.llm_model_alias);
    if(String(url).endsWith('/stop'))response.llm_released=true;
    return {ok:true,json:async()=>response};
  };
  try {
    assert.equal(await withAgentServices(async()=> 'first',()=>true),'first');
    assert.equal(await withAgentServices(async()=> 'next',()=>true),'next');
    assert.deepEqual(models,['first-model','next-model']);
  } finally {globalThis.window=previousWindow;globalThis.fetch=previousFetch;}
});
