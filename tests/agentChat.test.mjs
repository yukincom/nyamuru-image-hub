import assert from 'node:assert/strict';
import test from 'node:test';
import {runAgentConversation} from '../src/lib/agentChat.ts';
const tool=(name,args={},id='call')=>({message:{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:typeof args==='string'?args:JSON.stringify(args)}}]},model:'fixture'});
const final=text=>({message:{role:'assistant',content:text},model:'fixture'});

test('agent can inspect saved model connections without generating or editing', async () => {
  const f = setup(); let n = 0, inspected = 0;
  f.options.modelConnections = async () => { inspected++; return { qwen: { available: false }, comfyui: { status: 'unavailable' } }; };
  f.options.reply = async () => [tool('model_connections'), final('接続できませんでした。')][n++];
  const result = await runAgentConversation(f.options);
  assert.equal(inspected, 1); assert.equal(f.edits, 0); assert.equal(f.applied, 0);
  assert.match(result.text, /モデルファイルを確認できません/);
  assert.match(result.text, /ComfyUIサーバーには接続できません/);
  assert.deepEqual(f.results[0], { name: 'model_connections', result: { ok: true, qwen: { available: false }, comfyui: { status: 'unavailable' } } });
});

test('agent cannot override a saved endpoint or submit jobs through model inspection', async () => {
  const f = setup(); let n = 0;
  f.options.modelConnections = async () => assert.fail('invalid arguments must not reach a service');
  f.options.reply = async () => [tool('model_connections', { endpoint: 'http://other.test', submit: true }), final('確認しました')][n++];
  await runAgentConversation(f.options);
  assert.equal(f.results[0].result.ok, false); assert.equal(f.edits, 0); assert.equal(f.applied, 0);
});

test('successful connection retry clears only connection errors and preserves edit failures', async () => {
  for (const editFailure of [false, true]) {
    const f = setup(); let round = 0, probes = 0;
    f.options.modelConnections = async () => { if (++probes === 1) throw Error('一時的な接続失敗'); return { comfyui: { status: 'connected' } }; };
    f.options.edit = () => { throw Error('原稿の編集失敗'); };
    const replies = [tool('model_connections'), ...(editFailure ? [tool('editor_bubble_edit', {})] : []), tool('model_connections'), final('接続を確認できました。')];
    f.options.reply = async () => replies[round++];
    const result = await runAgentConversation(f.options);
    if (editFailure) assert.match(result.text, /原稿の編集失敗/);
    else assert.match(result.text, /ComfyUIサーバーにも接続できました/);
    assert.doesNotMatch(result.text, /一時的な接続失敗/); assert.equal(f.edits, 0);
  }
});

test('failed connection inspection cannot become a success claim from the model', async () => {
  const f = setup(); let round = 0;
  f.options.modelConnections = async () => { throw Error('接続サービスに到達できません'); };
  f.options.reply = async () => [tool('model_connections'), final('接続できました。')][round++];
  const result = await runAgentConversation(f.options);
  assert.match(result.text, /接続確認に失敗/); assert.doesNotMatch(result.text, /未変更|接続できました/);
});

test('generation runs the existing handler and reports its result without conversation inference',async()=>{
  for(const text of ['このキャラクターを生成してください','1コマ目の小雪を生成してください']){
    const f=setup();f.options.text=text;f.options.classify=async()=>({text,label:'generate_request',confidence:1,model:'fixture',elapsed_ms:0});
    let applied=0;f.options.apply=command=>{applied++;assert.equal(command.op,'generate_selected');return '生成して元のあたりに差し込みました';};
    f.options.services=async()=>{throw Error('画像生成の前に会話サービスを起動してはいけません');};
    const result=await runAgentConversation(f.options);assert.equal(result.text,'生成して元のあたりに差し込みました');assert.equal(applied,1);
    f.options.apply=()=>{throw Error('生成する人物を選択してください');};
    assert.equal((await runAgentConversation(f.options)).text,'生成する人物を選択してください');
  }
});
function setup(){
  let revision='r1',current=true,edits=0,applied=0;
  const seen=[],results=[];
  const options={text:'この吹き出しの上側を丸くして',history:[{role:'user',content:'この吹き出しの上側を丸くして'}],
    profile:{name:'ねこ先生',tone:'穏やかに話す。',avatar:'do-not-send'},revision:()=>revision,isCurrent:()=>current,
    snapshot:()=>({revision,selected_bubble:{target:{pageIndex:0,panelIndex:0,index:0,overlay:false,kind:'bubble'}}}),
    classify:async({text})=>({text,label:'bubble_set',confidence:1,model:'fixture',elapsed_ms:0}),
    apply:()=>{applied++;return '元に戻しました';},edit:()=>{edits++;revision=`r${edits+1}`;return options.snapshot();},
    services:async task=>task(),onTool:(name,result)=>results.push({name,result}),
    reply:async body=>{seen.push(structuredClone(body));return final('終わりました');}};
  return {options,seen,results,get edits(){return edits},get applied(){return applied},cancel:()=>{current=false},change:()=>{revision='changed'}};
}
test('material window uses the classifier fast path without LLM services or manuscript edits',async()=>{
  const f=setup();f.options.text='吹き出しの素材ウィンドウを表示して';
  f.options.classify=async({text})=>({text,label:'view_change',confidence:1,model:'fixture',elapsed_ms:0});
  f.options.services=async()=>{throw Error('LLM must not be called')};
  f.options.apply=command=>{assert.deepEqual(command,{op:'open_bubble_materials'});return '吹き出し素材を開きました';};
  const result=await runAgentConversation(f.options);assert.equal(result.edits,0);assert.equal(f.edits,0);assert.equal(result.text,'吹き出し素材を開きました');
  f.options.classify=async({text})=>({text,label:'out_of_scope_request',confidence:.94,model:'fixture',elapsed_ms:0});
  f.options.apply=()=>{throw Error('Must not apply')};
  assert.match((await runAgentConversation(f.options)).text,/確定できません/);
});
test('classification falls through to an inspect/edit/inspect loop and preserves the original utterance',async()=>{
  const f=setup();let n=0;
  f.options.reply=async body=>{f.seen.push(structuredClone(body));return [tool('editor_inspect'),tool('editor_bubble_edit',{revision:'r1'}),tool('editor_inspect'),final('上側を丸くしました。')][n++];};
  const result=await runAgentConversation(f.options);
  assert.equal(f.edits,1);assert.equal(f.applied,0);assert.equal(result.text,'上側を丸くしました。');
  assert.equal(f.seen[0].messages[0].content,f.options.text);assert.deepEqual(f.seen[0].profile,{name:'ねこ先生',tone:'穏やかに話す。'});
  assert.equal(f.results[2].result.revision,'r2');
  assert.ok(f.seen[3].messages.some(m=>m.role==='tool'&&JSON.parse(m.content).after?.revision==='r2'));
});
test('closing or changing selection while the model responds prevents tool execution',async()=>{
  for(const change of ['cancel','change']){const f=setup();f.options.reply=async()=>{f[change]();return tool('editor_bubble_edit',{});};await assert.rejects(runAgentConversation(f.options),/終了|変わった/);assert.equal(f.edits,0);}
});
test('already executed deterministic operation cannot be repeated as a model edit',async()=>{
  const f=setup();f.options.text='アンドゥして';f.options.history=[{role:'user',content:'アンドゥして'}];
  f.options.classify=async({text})=>({text,label:'undo',confidence:1,model:'fixture',elapsed_ms:0});
  let n=0;f.options.reply=async body=>{f.seen.push(body);return n++?final('元に戻しました。'):tool('editor_bubble_edit',{});};
  const result=await runAgentConversation(f.options);assert.equal(result.text,'元に戻しました');assert.equal(f.applied,1);assert.equal(f.edits,0);assert.equal(f.seen[0].allow_edits,false);
  assert.equal(f.seen[0].context.operation.message,'元に戻しました');assert.equal(f.results[0].result.ok,false);
});

test('save and bare next-page commands report the actual handler result without LLM services',async()=>{
  for(const [text,label,command,message] of [
    ['保存して','save',{op:'save'},'検証原稿 に保存しました'],
    ['次のページ','page_navigate',{op:'page',target:'next'},'2ページを表示しました'],
  ]){
    const f=setup();f.options.text=text;let applied=0;
    f.options.classify=async({text})=>({text,label,confidence:1,model:'nyamuru-voice-v04-seed43',elapsed_ms:0});
    f.options.apply=value=>{assert.deepEqual(value,command);applied++;return message};
    f.options.services=async()=>{throw Error('LLM services must not start')};
    f.options.reply=async()=>{throw Error('No LLM reply needed')};
    const result=await runAgentConversation(f.options);
    assert.equal(result.text,message);assert.equal(result.model,'nyamuru-voice-v04-seed43');assert.equal(applied,1);assert.equal(f.edits,0);
  }
});

test('save cancellation and page boundaries return local results even with the LLM unavailable',async()=>{
  for(const [text,label,apply,message] of [
    ['保存して','save',()=> '保存をキャンセルしました','保存をキャンセルしました'],
    ['次のページ','page_navigate',()=>{throw Error('指定されたページがありません')},'指定されたページがありません'],
  ]){
    const f=setup();f.options.text=text;
    f.options.classify=async({text})=>({text,label,confidence:1,model:'fixture',elapsed_ms:0});
    f.options.apply=apply;f.options.services=async()=>{throw Error('Must not start')};
    assert.equal((await runAgentConversation(f.options)).text,message);assert.equal(f.edits,0);
  }
});

test('deterministic operation failure cannot become a model success claim',async()=>{
  const f=setup();f.options.text='保存して';f.options.history=[{role:'user',content:'保存して'}];
  f.options.classify=async({text})=>({text,label:'save',confidence:1,model:'fixture',elapsed_ms:0});
  f.options.apply=()=>{throw Error('保存できませんでした');};f.options.reply=async()=>final('保存しました。');
  assert.equal((await runAgentConversation(f.options)).text,'保存できませんでした');
});
test('invalid tool arguments return an error for correction without applying anything',async()=>{
  const f=setup();let n=0;f.options.reply=async()=>[tool('editor_bubble_edit','{'),tool('unknown',{}),final('指定を確認します。')][n++];
  await runAgentConversation(f.options);assert.equal(f.edits,0);assert.equal(f.results.length,2);assert.ok(f.results.every(r=>r.result.ok===false));
});
test('unknown tool failure remains visible if the model claims success afterward',async()=>{
  const f=setup();let n=0;f.options.reply=async()=>n++?final('変更しました。'):tool('editor_bubble_edti',{});
  const result=await runAgentConversation(f.options);assert.equal(f.edits,0);assert.match(result.text,/未変更.*使えません/);
});
test('repeated invalid tools stop without repeated mutations or a false success message',async()=>{
  const f=setup();let calls=0;f.options.reply=async()=>{calls++;return tool('unknown',{});};
  await assert.rejects(runAgentConversation(f.options),/同じ指定エラー.*使えません/);assert.equal(calls,3);assert.equal(f.edits,0);
});
test('classifier failure does not prevent conversation; model failure retains completed operation evidence',async()=>{
  const f=setup();f.options.classify=async()=>{throw Error('分類が利用できません');};await runAgentConversation(f.options);
  assert.equal(f.seen[0].context.classification_error,'分類が利用できません');
  f.options.text='アンドゥして';f.options.classify=async({text})=>({text,label:'undo',confidence:1,model:'fixture',elapsed_ms:0});
  f.options.reply=async()=>{throw Error('LLM未接続');};await assert.rejects(runAgentConversation(f.options),/元に戻しました\nLLM未接続/);assert.equal(f.applied,1);
});

test('failed edit cannot be disguised by a model success sentence and no-op edits are not counted',async()=>{
  const failed=setup();failed.options.edit=()=>{throw Error('対象はロック中です');};let n=0;
  failed.options.reply=async()=>n++?final('上側を丸くしました。'):tool('editor_bubble_edit',{});
  const result=await runAgentConversation(failed.options);assert.equal(result.edits,0);assert.equal(result.text,'未変更：対象はロック中です');
  const noop=setup();noop.options.edit=()=>noop.options.snapshot();n=0;
  noop.options.reply=async()=>n++?final('上側を丸くしました。'):tool('editor_bubble_edit',{});
  const unchanged=await runAgentConversation(noop.options);assert.equal(unchanged.edits,0);assert.match(unchanged.text,/変更はありません/);
});


test('unavailable connection data overrides an invented LLM success',async()=>{
  const f=setup();let round=0;
  f.options.modelConnections=async()=>({qwen:{available:false},comfyui:{status:'unavailable'}});
  f.options.reply=async()=>[tool('model_connections'),final('接続できました。')][round++];
  const result=await runAgentConversation(f.options);
  assert.match(result.text,/確認できません/);assert.doesNotMatch(result.text,/接続できました/);
});
test('agent image actions execute once only after the conversation service lease is released',async()=>{
  for(const action of ['connect','generate']){
    const f=setup(),events=[];let leased=false;
    f.options.text=action==='connect'?'画像生成をつないで':'生成して';
    f.options.reply=async()=>{events.push('tool');return tool('image_generation',{action});};
    f.options.services=async task=>{leased=true;try{return await task();}finally{leased=false;events.push('release');}};
    f.options.imageGeneration=async actual=>{assert.equal(actual,action);assert.equal(leased,false);events.push(action);return '実行結果';};
    assert.equal((await runAgentConversation(f.options)).text,'実行結果');
    assert.deepEqual(events,['tool','release',action]);
  }
});
test('cancelled, changed or unsuccessfully released conversation cannot start image actions',async()=>{
  for(const end of ['cancel','change','release failure']){
    const f=setup();f.options.text='生成して';f.options.reply=async()=>tool('image_generation',{action:'generate'});
    f.options.services=async task=>{const result=await task();if(end==='release failure')throw Error('復帰を確認できません');f[end]();return result;};
    f.options.imageGeneration=async()=>assert.fail('must not execute');
    await assert.rejects(runAgentConversation(f.options));
  }
});
test('image generation failures are final results, never retried or rewritten by another LLM call',async()=>{
  const f=setup();let requests=0;f.options.text='生成して';
  f.options.reply=async()=>{requests++;return tool('image_generation',{action:'generate'});};
  f.options.imageGeneration=async()=>{throw Error('人物資料がありません');};
  await assert.rejects(runAgentConversation(f.options),/人物資料/);assert.equal(requests,1);
});
test('generation questions, negative requests and mixed tool calls do not start image generation',async()=>{
  for(const text of ['生成できますか','生成しないで','生成して']){
    const f=setup();let round=0;f.options.text=text;
    const request=tool('image_generation',{action:'generate'});
    if(text==='生成して')request.message.tool_calls.push({...tool('editor_bubble_edit').message.tool_calls[0],id:'other'});
    f.options.reply=async()=>round++?final('完了しました'):request;
    f.options.imageGeneration=async()=>assert.fail('must not execute');
    if(text==='生成して'){await assert.rejects(runAgentConversation(f.options),/一つずつ/);assert.equal(f.edits,0);}
    else {const result=await runAgentConversation(f.options);assert.match(result.text,/未変更|適用できません/);}
  }
});
