// 見込み: 生成済みでもLLM相談と指示編集を受け付ける。合格: 会話は無変更、編集は全文置換し失敗/取消しは適用しない。
// 範囲: 実会話コントローラーと模擬LLM/状態。実モデルの理解・画質・ブラウザー接続は別確認。
import test from 'node:test';
import assert from 'node:assert/strict';
import {runGenerationConversation} from '../src/lib/generationConversation.ts';
const answer=content=>({model:'fixture',message:{role:'assistant',content}});
const tool=(args,name='generation_prompt_edit')=>({model:'fixture',message:{role:'assistant',content:null,tool_calls:[{id:'edit',type:'function',function:{name,arguments:JSON.stringify(args)}}]}});
function setup(replies){
  const state={prompt:'黒髪の人物。緑背景。',label:'人物',mode:'qwen',status:'succeeded',editable:true,generatedPrompt:'Old prompt'};
  let current=true,updates=0;const requests=[];
  return {state,requests,get updates(){return updates;},cancel(){current=false;},options:{text:'表情を柔らかくして英訳して',input:{history:[],profile:{name:'猫',tone:'簡潔に'}},isCurrent:()=>current,
    snapshot:()=>({...state}),update:(value,expected)=>{assert.equal(state.prompt,expected);state.prompt=value;updates++;},services:async task=>task(),
    reply:async request=>{requests.push(structuredClone(request));return replies.shift();}}};
}
// 見込み/合格: 両workflowで同じ現行指示をLLMへ送り、英訳全文だけ反映。応答は固定で翻訳品質は判定しない。
test('post-generation editing and translation use the current draft for normal and three-image modes',async()=>{
  for(const mode of ['qwen','qwen-three-images']){
    const translated='Black-haired person with a gentle expression. Green background.';
    const f=setup([tool({prompt:translated}),answer('表情を整え、英訳しました。')]);f.state.mode=mode;
    assert.match(await runGenerationConversation(f.options),/反映しました/);
    assert.equal(f.state.prompt,translated);assert.equal(f.updates,1);
    assert.equal(f.requests[0].context.generation.prompt,'黒髪の人物。緑背景。');
    assert.equal(f.requests[0].context.generation.mode,mode);
    assert.equal(f.requests[1].context.generation.prompt,translated);
    assert.equal(JSON.parse(f.requests[1].messages.at(-1).content).ok,true);
  }
});
// 見込み/合格: 結果が不満という相談は候補/指示を変えない。確認範囲: 模擬応答を使う会話処理。
test('consultation after generation preserves the draft and passes conversation history',async()=>{
  const f=setup([answer('表情の強さを下げる案があります。')]);f.options.input.history=[{role:'user',content:'目が強すぎる'},{role:'assistant',content:'表情を調整できます。'}];
  await runGenerationConversation(f.options);assert.equal(f.updates,0);assert.equal(f.requests[0].messages[0].content,'目が強すぎる');
});
// 見込み/合格: 曖昧な実行状態でも相談でき、編集ツールは失敗を返す。範囲: 状態/応答は模擬。
test('unresolved generation allows discussion but refuses mutations and false success',async()=>{
  const f=setup([tool({prompt:'new'}),answer('成功しました')]);f.state.editable=false;f.state.status='outcome_unknown';
  assert.match(await runGenerationConversation(f.options),/適用できませんでした/);assert.equal(f.updates,0);
});
// 見込み/合格: 閉じる/手動変更後の遅延応答は反映しない。範囲: 非同期応答直前に状態を変更。
test('late replies cannot edit a closed dialog or overwrite a changed prompt',async()=>{
  for(const cancel of [true,false]){
    const f=setup([]);f.options.reply=async()=>{if(cancel)f.cancel();else f.state.prompt='手動変更';return tool({prompt:'stale'});};
    await assert.rejects(runGenerationConversation(f.options),/終了|変わった/);assert.equal(f.updates,0);
  }
});
// 見込み/合格: 生成/原稿のツールや不正引数を拒否し変更0件。範囲: ツール実行制御、モデルの選択精度は対象外。
test('unsupported tools and malformed prompt arguments cannot mutate',async()=>{
  for(const reply of [tool({action:'generate'},'image_generation'),tool({prompt:''}),tool({prompt:'a'.repeat(12001)}),tool({prompt:'valid',extra:true})]){
    const f=setup([reply,answer('変更できました')]);assert.match(await runGenerationConversation(f.options),/適用できませんでした/);assert.equal(f.updates,0);
  }
});
