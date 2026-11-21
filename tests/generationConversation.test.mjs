// 見込み: 生成済みでもLLM相談と指示編集を受け付ける。合格: 会話は無変更、編集は全文置換し失敗/取消しは適用しない。
// 範囲: 実会話コントローラーと模擬LLM/状態。実モデルの理解・画質・ブラウザー接続は別確認。
import test from 'node:test';
import assert from 'node:assert/strict';
import {runGenerationConversation} from '../src/lib/generationConversation.ts';
import {generationReadinessMessage} from '../src/lib/generation/readiness.ts';
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
  for(const mode of ['qwen','promptless-two-images']){
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

// 見込み/合格: 未準備の生成依頼はコードの理由をLLMへ渡し、編集権限なしで案内を返す。応答は固定、実LLMの表現は別確認。
test('not-ready generation forwards authoritative blockers to the agent without edit tools',async()=>{
  const notice={ready:false,message:'準備が整っていません',blockers:[{code:'workflow',label:'ワークフロー',state:'waiting',detail:'一覧を読み込んでいます'}]};
  const f=setup([answer('準備が整っていません。ワークフローの一覧を読み込んでいます。完了後にもう一度依頼してください。')]);
  f.options.text='生成して';f.options.notice=notice;
  const result=await runGenerationConversation(f.options);
  assert.match(result,/ワークフロー/);assert.equal(f.updates,0);assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].allow_edits,false);
  assert.deepEqual(f.requests[0].context.generation.readiness,notice);
  assert.equal(f.requests[0].context.generation.requestAccepted,false);
  assert.equal(f.requests[0].context.generation.editable,false);
  assert.equal(f.requests[0].messages.at(-1).content,'生成して');
});

// 見込み/合格: 案内でLLMが編集を要求/失敗しても状態説明を返し変更0件。終了後の遅延応答は成功にしない。応答/失敗は模擬。
test('not-ready notice falls back to code facts on tools or model failure and respects closure',async()=>{
  const notice={ready:false,message:'準備が整っていません',blockers:[{code:'characters',label:'設定画',state:'action_required',detail:'設定画が見つかりません'}]};
  for(const mode of ['tool','unavailable','empty','closed']){
    const f=setup([tool({prompt:'should not be applied'})]);f.options.notice=notice;
    if(mode==='unavailable')f.options.reply=async()=>{throw Error('LLM未接続');};
    if(mode==='empty')f.options.reply=async()=>answer('');
    if(mode==='closed')f.options.reply=async()=>{f.cancel();return answer('遅延した案内');};
    if(mode==='closed')await assert.rejects(runGenerationConversation(f.options),/終了/);
    else assert.equal(await runGenerationConversation(f.options),generationReadinessMessage(notice));
    assert.equal(f.updates,0);
  }
});
