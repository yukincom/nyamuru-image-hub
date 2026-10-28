import assert from 'node:assert/strict';
import test from 'node:test';
import {parseVoicePrediction,resolveVoiceCommand,resolveVoiceGenerationTarget,runVoiceCommand} from '../src/lib/voiceCommands.ts';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup.ts';

const prediction=(text,label='save',confidence=.99)=>({text,label,confidence,model:'fixture',elapsed_ms:1});
test('single operations resolve arguments only within the classified intent',()=>{
  for(const [text,label,expected] of [
    ['保存して','save',{op:'save'}],['保存してください','save',{op:'save'}],['元に戻して','undo',{op:'undo'}],['やり直して','redo',{op:'redo'}],
    ['次のページ','page_navigate',{op:'page',target:'next'}],['前のページ','page_navigate',{op:'page',target:'previous'}],
    ['次のページへ移動して','page_navigate',{op:'page',target:'next'}],['三ページに移動して','page_navigate',{op:'page',target:3}],
    ['内枠スナップをオフにして','inner_frame_snap_set',{op:'setting',key:'inner_frame_snap',enabled:false}],
    ['コマシンクロをオンにして','panel_sync_set',{op:'setting',key:'panel_sync',enabled:true}],
    ['下書き生成に切り替えて','artwork_mode_set',{op:'artwork',mode:'draft'}],
    ['ベクターペンに変えて','paint_tool_set',{op:'paint_tool',tool:'vector-pen'}],
    ['この吹き出しを四角にして','bubble_set',{op:'bubble_shape',shape:'square'}],
    ['この吹き出しに「保存して、次のページへ！　」と入れて','bubble_set',{op:'bubble_text',text:'保存して、次のページへ！　'}],
  ])assert.deepEqual(resolveVoiceCommand(prediction(text,label)).command,expected,text);
  assert.equal(resolveVoiceCommand(prediction('元に戻して','redo')).command,undefined);
});
test('even high confidence cannot execute deferred, cancelled, quoted or compound commands',()=>{
  for(const text of ['保存は確認が終わるまで待ってて','そろそろ保存する時間かなあ','保存して、いや、まだ保存しないで',
    '保存してから次のページに進んで','この状態を保存したら、最後のページを表示して','「保存して」と言った','まだ保存しないで'])
    assert.equal(resolveVoiceCommand(prediction(text)).command,undefined,text);
  assert.equal(resolveVoiceCommand(prediction('コマスナップをオンにしないで','panel_gap_snap_set')).command,undefined);
  assert.equal(resolveVoiceCommand(prediction('保存して','save',.7)).command,undefined);
  assert.equal(resolveVoiceCommand(prediction('保存して','not_command')).command,undefined);
  for(const text of ['次のページには行かないで','次のページ、いや戻って','保存して次のページ','「次のページ」と言った','次のページの内容を教えて'])
    assert.equal(resolveVoiceCommand(prediction(text,'page_navigate')).command,undefined,text);
  assert.equal(resolveVoiceCommand(prediction('次のページ','page_navigate',.89)).command,undefined);
  assert.equal(resolveVoiceCommand(prediction('次のページ','save')).command,undefined);
});
test('classification cannot apply against changed state or after close',async()=>{
  let revision='a',applied=0;
  const opts={text:'保存して',revision:()=>revision,cancelled:()=>false,
    classify:async()=>{revision='b';return prediction('保存して');},apply:()=>{applied++;return 'saved';}};
  await assert.rejects(runVoiceCommand(opts),/待機中/);assert.equal(applied,0);
  await assert.rejects(runVoiceCommand({...opts,cancelled:()=>true}),/待機中/);assert.equal(applied,0);
  await runVoiceCommand({...opts,classify:async()=>prediction('保存して')});assert.equal(applied,1);
});
test('unrecognized results and deferred labels never reach application',async()=>{
  assert.throws(()=>parseVoicePrediction(prediction('別の入力'),'保存して'),/一致/);
  for(const label of ['compound_request','needs_reasoning','out_of_scope_request','text_frames_align','needs_clarification']){
    let applied=false;
    const result=await runVoiceCommand({text:'保存して',revision:()=>'',cancelled:()=>false,
      classify:async()=>prediction('保存して',label),apply:()=>{applied=true;return 'wrong';}});
    assert.equal(applied,false);assert.equal(result.executed,false);assert.ok(result.message);
  }
});
test('quoted dialogue is one balanced span, never two independent changes',()=>{
  const compound='この吹き出しに「こんにちは」と入れて、次の吹き出しに「さようなら」と入れて';
  assert.equal(resolveVoiceCommand(prediction(compound,'bubble_set')).command,undefined);
  assert.deepEqual(resolveVoiceCommand(prediction('この吹き出しに「彼が「保存して」と言った」と入れて','bubble_set')).command,
    {op:'bubble_text',text:'彼が「保存して」と言った'});
});
test('generation retains the requested kind and never aliases background',()=>{
  assert.equal(resolveVoiceCommand(prediction('選択中の吹き出しを生成して','generate_request')).command,undefined);
  assert.deepEqual(resolveVoiceCommand(prediction('選択中の描き文字を生成して','generate_request')).command,{op:'generate_selected',kind:'bubble'});
  assert.deepEqual(resolveVoiceCommand(prediction('選択中の人物を生成して','generate_request')).command,{op:'generate_selected',kind:'figure'});
  assert.deepEqual(resolveVoiceCommand(prediction('これを生成して','generate_request')).command,{op:'generate_selected',kind:'selected'});
  assert.equal(resolveVoiceCommand(prediction('選択中の背景を生成して','generate_request')).command,undefined);
});

test('character requests keep selection wording or an explicit panel and name',()=>{
  for(const text of ['このキャラクターを生成してください','今選択しているキャラクターを生成して','選択中のキャラを画像生成して','この人物を生成してください'])
    assert.deepEqual(resolveVoiceCommand(prediction(text,'generate_request')).command,{op:'generate_selected',kind:'figure'},text);
  for(const text of ['1コマ目の小雪を生成してください','一コマ目の小雪を生成して'])
    assert.deepEqual(resolveVoiceCommand(prediction(text,'generate_request')).command,{op:'generate_selected',kind:'figure',locator:{panel:1,name:'小雪'}},text);
  for(const text of ['このキャラクターを生成しないで','後でこのキャラクターを生成して','「このキャラクターを生成して」と言った',
    'このキャラクターを生成してから保存して','1コマ目の小雪を生成しないで','1コマ目の小雪を生成して、いや待って'])
    assert.equal(resolveVoiceCommand(prediction(text,'generate_request')).command,undefined,text);
  for(const [label,confidence] of [['not_command',1],['generate_request',.89],['needs_clarification',1]])
    assert.equal(resolveVoiceCommand(prediction('このキャラクターを生成してください',label,confidence)).command,undefined);
});

function generationFixture(){
  const document=createEmptyWorkspaceDocument();
  document.manga.characters=[{localId:'koyuki',name:'小雪',aliases:['こゆき'],role:'主人公',scope:'episode'}];
  document.manga.pages[0].panels=[1,2].map(id=>({id,shape:{type:'rect',x:20,y:20,w:80,h:80},bg:0,action:'',bubbles:[],figures:[{name:'小雪',refId:'koyuki'}]}));
  document.manga.pages[0].page_overlay={figures:[{name:'小雪',refId:'koyuki'}],bubbles:[]};
  return document;
}
test('generation resolves the selected owner and explicit panel independently',()=>{
  const document=generationFixture(),before=structuredClone(document),command={op:'generate_selected',kind:'figure'};
  assert.deepEqual(resolveVoiceGenerationTarget(document,0,1,{type:'figure',index:0},command),{pageIndex:0,panelIndex:1,index:0,kind:'figure',overlay:false});
  assert.deepEqual(resolveVoiceGenerationTarget(document,0,1,{type:'figure',index:0,scope:'page_overlay'},command),{pageIndex:0,panelIndex:0,index:0,kind:'figure',overlay:true});
  assert.deepEqual(resolveVoiceGenerationTarget(document,0,1,null,{...command,locator:{panel:1,name:'こゆき'}}),{pageIndex:0,panelIndex:0,index:0,kind:'figure',overlay:false});
  assert.deepEqual(document,before);
});
test('generation never substitutes a missing, ambiguous, hidden or mismatched target',()=>{
  const document=generationFixture(),command={op:'generate_selected',kind:'figure'},selected={type:'figure',index:0};
  const resolve=(selection=selected,cmd=command)=>resolveVoiceGenerationTarget(document,0,0,selection,cmd);
  assert.throws(()=>resolve(null),/選択/);assert.throws(()=>resolve({type:'bubble',index:0}),/一致/);
  assert.throws(()=>resolve({type:'figure',index:5}),/見つかりません/);
  assert.throws(()=>resolve(null,{...command,locator:{panel:3,name:'小雪'}}),/3コマ目はありません/);
  assert.throws(()=>resolve(null,{...command,locator:{panel:1,name:'春'}}),/人物配置が見つかりません/);
  document.manga.pages[0].panels[0].figures.push({name:'小雪',refId:'koyuki'});
  assert.throws(()=>resolve(null,{...command,locator:{panel:1,name:'小雪'}}),/複数/);
  assert.equal(resolve().index,0);
  document.manga.pages[0].panels[0].figures[0].artwork={locked:true};assert.equal(resolve().index,0);assert.equal(document.manga.pages[0].panels[0].figures[0].artwork.locked,true);
  document.manga.pages[0].panels[0].figures[0].artwork={hidden:true};assert.throws(()=>resolve(),/非表示/);
  delete document.manga.pages[0].panels[0].figures[0].artwork;
  document.manga.pages[0].panels[0].layer={hidden:true};assert.throws(()=>resolve(),/非表示/);
  delete document.manga.pages[0].panels[0].layer;
  document.manga.pages[0].panels[0].figures[0].kind='prop';assert.throws(()=>resolve(),/小道具/);
});

test('material window requires view_change and a whole, positive request',()=>{
  for(const text of ['吹き出しの素材ウィンドウを表示して','素材ウィンドウを開いて','フキダシ素材一覧を見せてください'])
    assert.deepEqual(resolveVoiceCommand(prediction(text,'view_change')).command,{op:'open_bubble_materials'});
  for(const text of ['吹き出し素材を開かないで','吹き出し素材を開いてから保存して','「吹き出し素材を開いて」と言った','後で吹き出し素材を開いて'])
    assert.equal(resolveVoiceCommand(prediction(text,'view_change')).command,undefined);
  for(const [label,confidence] of [['out_of_scope_request',1],['view_change',.7],['not_command',1]])
    assert.equal(resolveVoiceCommand(prediction('吹き出し素材を開いて',label,confidence)).command,undefined);
});


test('generic voice generation rejects balloons and resolves handwritten lettering in both scopes',()=>{
  const document=generationFixture(),page=document.manga.pages[0],command={op:'generate_selected',kind:'selected'};
  page.panels[0].bubbles=[{text:'台詞',shape:'normal'},{text:'ドン！',shape:'handwritten',locked:true}];
  page.page_overlay.bubbles=[{text:'さらり',shape:'handwritten'}];
  assert.throws(()=>resolveVoiceGenerationTarget(document,0,0,{type:'bubble',index:0},command),/吹き出し単品/);
  assert.equal(resolveVoiceGenerationTarget(document,0,0,{type:'bubble',index:1},command).index,1);
  assert.equal(page.panels[0].bubbles[1].locked,true);
  assert.equal(resolveVoiceGenerationTarget(document,0,0,{type:'bubble',index:0,scope:'page_overlay'},command).overlay,true);
});
