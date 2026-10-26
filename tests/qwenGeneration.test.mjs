import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup.ts';
import {paintScene} from '../src/lib/paintDocument.ts';
import {buildQwenGenerationPlan,qwenGenerationPayload,qwenGenerationPrompt,qwenLayerCandidates,qwenLayerPaint,QWEN_GENERATION_PROFILE} from '../src/lib/qwenGeneration.ts';
import {setWorkStylePrompt,artworkSettingsFromSource,applyArtworkSettings} from '../src/lib/artworkRules.ts';
import {FIGURE_SIZE_LABELS,parseMangaYaml,parseOmayYaml,toStoredMangaYaml,validateManga} from '../src/lib/manga.ts';
import {confirmHumanPoseCameraPrompt} from '../src/lib/humanPoseScene.ts';
import {selectHumanPose} from '../src/lib/humanPoseSelection.ts';
function fixture(){
 const {manga}=createEmptyWorkspaceDocument();manga.meta.series_id='series';manga.meta.episode_id='episode';manga.meta.format='モノクロ漫画';
 manga.characters=[{localId:'person-id',name:'確認用',catalog_id:'catalog'}];
 manga.materials=[{type:'character',key:'全身資料',characterId:'person-id',source_image:{asset_id:'full-sheet'}}];
 manga.pages[0].panels=[{id:1,shape:{type:'rect',x:0,y:0,w:90,h:150},bg:1,background_description:'室内',action:null,bubbles:[],figures:[{name:'確認用',refId:'person-id',size:'full',action:'下を見る',bbox:{x:0,y:0,w:25,h:50}}]}];
 return manga;
}
function posePlan(mode='image'){
 const manga=fixture(),figure=manga.pages[0].panels[0].figures[0],digest='a'.repeat(64);
 const row=JSON.parse(readFileSync(new URL('../scripts/human_pose/data/curated-standing.json',import.meta.url)))[0];
 figure.human_pose=selectHumanPose({...row,template_revision:1,production_status:'ready',review:{status:'confirmed',user_confirmed:true},
   asset_files:{preview:{}},prompt_segments:[{id:'pose',text_ja:row.pose_text_ja,template_en:row.pose_template}]},digest);
 Object.assign(figure.human_pose,{input_mode:mode,edited_text_ja:'右腕を上げ、左膝を曲げる。',scene:{version:1,
   source:{base_sha256:digest,rig_sha256:digest,pose_sha256:digest,rig_signature:digest,pose_revision:1},
   placement:{position:[0,0,0],yaw_degrees:0},camera:{position:[3,2,5],target:[0,1,0],fov:40},projection:'perspective',up:[0,1,0],frame:{width:512,height:1024}}});
 figure.human_pose.camera_prompt=confirmHumanPoseCameraPrompt(figure.human_pose.scene,{centre:[0,1,0],world_facing_degrees:0});
 figure.human_pose.camera_prompt.overrides.angle_ja='左斜め前から少し見下ろす';
 figure.action='驚いた表情で左を見る';figure.size='bust-up';manga.characters[0].visual_prompt='細い眉と短い黒髪';
 return {manga,plan:buildQwenGenerationPlan(manga,0,0,false,paintScene(manga.pages[0].panels[0],100,[]).owners[1])};
}
test('pose, action, angle, framing and identity survive normal, sketch and correction prompts',()=>{
 for(const mode of ['prompt','image']){
  const {manga,plan}=posePlan(mode),before=structuredClone(manga);
  for(const prompt of [plan.prompt,plan.sketchPrompt,qwenGenerationPrompt(plan,{kind:'paint'}, {kind:'paint'})]){
   for(const text of ['確認用','驚いた表情で左を見る','左斜め前から少し見下ろす','細い眉と短い黒髪'])assert.ok(prompt.includes(text),text);
   assert.equal(prompt.includes('胸から上'),mode==='prompt');
   assert.ok(prompt.includes(mode==='image'?'3Dポーズ参照':'右腕を上げ、左膝を曲げる。'));
   if(mode==='image')assert.ok(!prompt.includes('右腕を上げ、左膝を曲げる。'));
  }
  assert.deepEqual(manga,before);
 }
});
test('image pose captures the panel outline while retaining the original figure reference frame',()=>{
 const {manga,plan}=posePlan();
 assert.deepEqual(plan.outputFrame,{type:'rect',x:0,y:0,w:90,h:150});
 assert.deepEqual(plan.referenceFrame,{x:0,y:0,w:25,h:50});
 assert.deepEqual(plan.humanPose.cutFrame.bounds,{x:0,y:0,w:3.6,h:3});
 assert.equal(plan.humanPose.aspect,.5);
 assert.ok(Math.abs(plan.width/plan.height-.6)<.002);
 const refs=[{label:'人物資料',characterKeys:['person-id'],image:'data:character'}];
 const payload=qwenGenerationPayload(plan,refs,undefined,undefined,undefined,'data:pose');
 assert.doesNotMatch(payload.references.at(-1).label,/胸から上/);
 assert.deepEqual(manga.pages[0].panels[0].figures[0].bbox,{x:0,y:0,w:25,h:50});
});
test('composition payload keeps individual character assignments and the authored dialogue',()=>{
 const plan={profile:'qwen-image-2.1-owner-v1',documentKey:'work',pageNumber:1,panelId:0,overlay:false,ownerKey:'page',label:'ページ全体',scope:'page',width:1024,height:1400,prompt:'Character 1とCharacter 2。台詞：こんにちは\n世界',literalText:['こんにちは\n世界'],characterKeys:['a','b'],candidates:[],compositionImage:'data:layout'};
 const refs=[{label:'人物A',characterKeys:['a'],image:'data:a'},{label:'人物B',characterKeys:['b'],image:'data:b'}];
 const payload=qwenGenerationPayload(plan,refs);
 assert.equal(payload.mode,'paint');assert.equal(payload.paint_image,'data:layout');assert.deepEqual(payload.references.map(r=>r.character_keys),[['a'],['b']]);assert.deepEqual(payload.literal_text,['こんにちは\n世界']);
 assert.throws(()=>qwenGenerationPayload({...plan,compositionImage:undefined},refs),/紙面/);
 assert.throws(()=>qwenGenerationPayload(plan,[refs[0]]),/参照資料/);
 assert.throws(()=>qwenGenerationPayload(plan,refs,'data:extra'),/単品レイヤー/);
});
test('3D image remains separate from identity sheets and cannot be omitted or sent in text mode',()=>{
 const {plan}=posePlan(),refs=[{label:'人物資料',characterKeys:['person-id'],image:'data:character'}];
 const value=qwenGenerationPayload(plan,refs,undefined,undefined,undefined,'data:pose');
 assert.equal(value.mode,'new');assert.equal(value.references.length,2);assert.deepEqual(value.references[1].character_keys,[]);assert.equal(value.references[1].image,'data:pose');
 assert.throws(()=>qwenGenerationPayload(plan,refs),/撮影画像を用意/);
 assert.throws(()=>qwenGenerationPayload(plan,[],undefined,undefined,undefined,'data:pose'),/登場人物の参照資料/);
 assert.throws(()=>qwenGenerationPayload(posePlan('prompt').plan,refs,undefined,undefined,undefined,'data:pose'),/ポーズ文/);
 assert.equal(qwenGenerationPayload(posePlan('prompt').plan,refs).references.length,1);
 assert.throws(()=>qwenGenerationPayload(plan,Array(9).fill(refs[0]),undefined,undefined,undefined,'data:pose'),/合計9枚/);
 assert.throws(()=>qwenGenerationPayload(plan,Array(8).fill(refs[0]),'data:source',undefined,'data:correction','data:pose'),/合計10枚/);
});
test('pose-directed drawing uses a reference instead of conflicting paint preservation and sketch images have exact roles',()=>{
 const {plan}=posePlan(),refs=[{label:'人物資料',characterKeys:['person-id'],image:'data:character'}, {label:'衣服の参考',characterKeys:[],image:'data:clothing'}];
 const paint=qwenGenerationPayload(plan,refs,'data:source',undefined,undefined,'data:pose');
 assert.equal(paint.mode,'new');assert.equal(paint.paint_image,undefined);assert.equal(paint.references[0].image,'data:source');
 const correction=qwenGenerationPayload(plan,refs,'data:source',undefined,'data:mask','data:pose');
 assert.equal(correction.mode,'paint');assert.equal(correction.paint_image,'data:source');
 const sketch=qwenGenerationPayload({...plan,prompt:plan.sketchPrompt},refs,undefined,'data:rough',undefined,'data:pose');
 assert.equal(sketch.mode,'sketch');assert.match(sketch.prompt,/<image2>：キャラクター設定画/);assert.match(sketch.prompt,/<image3>：衣服の参考/);assert.match(sketch.prompt,/<image4>：3Dポーズ参照/);
});
test('Qwen plans retain exact owner, stable character binding and whole-sheet references',()=>{
 const manga=fixture(),before=structuredClone(manga),scene=paintScene(manga.pages[0].panels[0],100,[]);
 const plan=buildQwenGenerationPlan(manga,0,0,false,scene.owners[1]);
 assert.equal(plan.ownerKey,'figure-0');assert.deepEqual(plan.characterKeys,['person-id']);
 assert.equal(plan.candidates[0].source.asset_id,'full-sheet');assert.match(plan.prompt,/下を見る/);assert.match(plan.prompt,/モノクロ漫画/);
 assert.equal(plan.width,scene.owners[1].paint.width);assert.deepEqual(manga,before);
 const background=buildQwenGenerationPlan(manga,0,0,false,scene.owners[0]);
 assert.deepEqual(background.characterKeys,[]);assert.equal(background.candidates.length,0);assert.match(background.prompt,/室内/);
});
test('whole-page background rules leave individual figure and background generation plans unchanged for every bg value',()=>{
 const standard=parseOmayYaml(readFileSync(new URL('../src/content/standard.omay.yaml',import.meta.url),'utf8'));
 for(const bg of [-1,0,1,2]){
  const manga=fixture(),panel=manga.pages[0].panels[0];panel.bg=bg;
  panel.background_description='薄い青の壁、背後に窓枠';panel.action='コマ全体の別の演出';
  const settings=artworkSettingsFromSource(standard);
  // Compare exactly the same common rules, with all integrated fragments absent versus present.
  const common=structuredClone(settings);
  common.groups=common.groups.filter(group=>group.scope==='common');
  common.fragments=common.fragments.filter(part=>common.groups.some(group=>group.id===part.groupId));
  applyArtworkSettings(manga,common);
  const scene=paintScene(panel,100,[]);
  const expected=scene.owners.map(owner=>buildQwenGenerationPlan(manga,0,0,false,owner));
  applyArtworkSettings(manga,settings);
  const before=structuredClone(manga);
  assert.equal(scene.owners.length,2);
  for(const [index,owner] of scene.owners.entries()){
   const actual=buildQwenGenerationPlan(manga,0,0,false,owner);
   assert.deepEqual(actual,expected[index],`bg:${bg}, owner:${owner.kind}`);
   assert.doesNotMatch(actual.prompt,/bg:-1|bg:1|プレースホルダー|コマ全体の別の演出/);
   if(owner.kind==='background')assert.ok(actual.prompt.includes(panel.background_description));
  }
  assert.deepEqual(manga,before);
 }
});
test('names do not silently resolve an unbound character',()=>{
 const manga=fixture();delete manga.pages[0].panels[0].figures[0].refId;
 const scene=paintScene(manga.pages[0].panels[0],100,[]);
 assert.throws(()=>buildQwenGenerationPlan(manga,0,0,false,scene.owners[1]),/登場人物を指定/);
});
test('registered references follow the character across panels, while job history follows the owner',()=>{
 const manga=fixture();
 manga.characters.push({localId:'other-id',name:'別人',catalog_id:'other-catalog'});
 manga.materials.push({type:'character',key:'別人の資料',characterId:'other-id',source_image:{asset_id:'other-sheet'}});
 const otherPanel=structuredClone(manga.pages[0].panels[0]);otherPanel.id=2;
 manga.pages[0].panels.push(otherPanel);
 const first=buildQwenGenerationPlan(manga,0,0,false,paintScene(manga.pages[0].panels[0],100,[]).owners[1]);
 const second=buildQwenGenerationPlan(manga,0,1,false,paintScene(otherPanel,100,[]).owners[1]);
 assert.deepEqual(first.candidates,second.candidates);assert.equal(first.candidates.length,1);
 assert.equal(first.candidates[0].source.asset_id,'full-sheet');assert.notEqual(first.panelId,second.panelId);
 otherPanel.figures[0].refId='other-id';
 const other=buildQwenGenerationPlan(manga,0,1,false,paintScene(otherPanel,100,[]).owners[1]);
 assert.deepEqual(other.candidates.map(item=>item.source.asset_id),['other-sheet']);
});
test('framing uses the visible body range, separately from output pixel size and pose',()=>{
 for(const [size,label] of Object.entries(FIGURE_SIZE_LABELS)){
  const manga=fixture();manga.pages[0].panels[0].figures[0].size=size;
  manga.pages[0].panels[0].figures[0].action='顔を右に向ける';
  manga.characters[0].visual_prompt='細い眉';
  const scene=paintScene(manga.pages[0].panels[0],100,[]);
  const plan=buildQwenGenerationPlan(manga,0,0,false,scene.owners[1]);
  assert.ok(plan.prompt.includes(`描写範囲は${label}。`));
  assert.ok(plan.prompt.includes('顔を右に向ける'));
  assert.doesNotMatch(plan.prompt,/画角：|Camera angle:|bust-up|waist-up/);
  assert.ok(plan.prompt.indexOf('描写範囲')<plan.prompt.indexOf('人物のビジュアル指定'));
  if(size==='bust-up')assert.ok(plan.prompt.includes('頭頂から胸までを画面に収めた構図で描く。'));
  const payload=qwenGenerationPayload(plan,[{label:'資料',characterKeys:['person-id'],image:'data:ref'}]);
  assert.equal(payload.width,scene.owners[1].paint.width);
  assert.equal(payload.height,scene.owners[1].paint.height);
 }
});
test('all framing values survive the existing document save and load path',()=>{
 for(const size of Object.keys(FIGURE_SIZE_LABELS)){
  const doc={manga:fixture()};doc.manga.pages[0].panels[0].figures[0].size=size;
  const restored=parseMangaYaml(toStoredMangaYaml(doc));
  assert.equal(restored.manga.pages[0].panels[0].figures[0].size,size);
  assert.equal(validateManga(restored).filter(issue=>issue.path.endsWith('.size')).length,0);
 }
});
test('only work style and the bound visual prompt reach English preparation; persona and other characters stay out', async t => {
 const manga=fixture(),style='黒い筆線。外周は太く、内側は細い。',profile='6.5〜7頭身。\n細い眉と小さな顎。';
 setWorkStylePrompt(manga,style);
 manga.characters[0].role='好奇心が強く、新技術を好む性格。';
 manga.characters[0].visual_prompt=profile;
 manga.characters.push({localId:'other',name:'別人',role:'陽気な性格',visual_prompt:'赤い帽子の巨人'});
 const scene=paintScene(manga.pages[0].panels[0],100,[]);
 const plan=buildQwenGenerationPlan(manga,0,0,false,scene.owners[1]);
 assert.ok(plan.prompt.includes(style));assert.ok(plan.prompt.includes(profile));
 assert.ok(!plan.prompt.includes(manga.characters[0].role));
 assert.ok(!plan.prompt.includes('人物像'));
 assert.ok(!plan.prompt.includes('赤い帽子の巨人'));
 const background=buildQwenGenerationPlan(manga,0,0,false,scene.owners[0]);
 assert.ok(background.prompt.includes(style));assert.ok(!background.prompt.includes(profile));
 const priorWindow=globalThis.window,priorFetch=globalThis.fetch;
 globalThis.window={setTimeout,clearTimeout};
 t.after(()=>{globalThis.window=priorWindow;globalThis.fetch=priorFetch;});
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';let preparedPrompt;
 globalThis.fetch=async(_url,options)=>{
   const body=options?.body?JSON.parse(options.body):null;
   if(body)preparedPrompt=body.prompt;
   return Response.json({service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3,protocol_version:1,
     ...(body?{profile:'qwen-image-2.1-owner-v1',job_id:id,status:'prepared',request_sha256:'a'.repeat(64),label:'人物',width:768,height:1376}:{})});
 };
 const {prepareQwenJob}=await import('../src/lib/localBridge.ts');
 await prepareQwenJob(id,qwenGenerationPayload(plan,[{label:'全身資料',characterKeys:['person-id'],image:'data:ref'}]));
 assert.equal(preparedPrompt,plan.prompt);
 manga.characters[0].visual_prompt='';
 const cleared=buildQwenGenerationPlan(manga,0,0,false,scene.owners[1]);
 assert.ok(!cleared.prompt.includes(profile));assert.ok(!cleared.prompt.includes(manga.characters[0].role));
 delete manga.characters[0].visual_prompt;
 assert.equal(buildQwenGenerationPlan(manga,0,0,false,scene.owners[1]).prompt,cleared.prompt);
});
test('layer choices are confined to the captured owner and export hidden layers without changing the document',()=>{
 const manga=fixture(),scene=paintScene(manga.pages[0].panels[0],100,[]),owner=scene.owners[1];
 const base=owner.paint.layers[0];
 owner.paint.layers=[{...base,id:'hidden',name:'非表示の絵',visible:false,locked:true,guide:false,
   strokes:[{tool:'pen',color:'#000000',size:2,points:[{x:1,y:2}]}]},
   {...base,id:'empty',name:'空',guide:false,strokes:[]},
   {...base,id:'zero',name:'濃度0',opacity:0,guide:true}];
 const before=structuredClone(scene),choices=qwenLayerCandidates(owner);
 assert.deepEqual(choices.map(x=>x.id),['zero','empty','hidden']);
 assert.equal(choices[0].empty,true);assert.equal(choices[1].empty,true);
 assert.equal(choices[2].hidden,true);assert.equal(choices[2].empty,false);
 const paint=qwenLayerPaint(owner,'hidden');
 assert.equal(paint.layers.length,1);assert.equal(paint.layers[0].visible,true);assert.equal(paint.layers[0].locked,true);
 assert.equal(paint.width,owner.paint.width);assert.deepEqual(paint.referenceFrame,owner.paint.referenceFrame);
 assert.throws(()=>qwenLayerPaint(owner,scene.owners[0].paint.layers[0].id),/このフォルダ/);
 assert.throws(()=>qwenLayerPaint(owner,'empty'),/空/);assert.throws(()=>qwenLayerPaint(owner,'zero'),/濃度/);
 assert.deepEqual(scene,before);
});
test('generation-marker-only layers are available only as correction inputs',()=>{
 const owner=paintScene(fixture().pages[0].panels[0],100,[]).owners[1];
 owner.paint.layers=[{...owner.paint.layers[0],id:'mask',guide:false,image:undefined,strokes:[],
   generationMask:{enabled:true,strokes:[{tool:'pen',color:'#ff0000',size:10,points:[{x:1,y:2}]}]}}];
 assert.equal(qwenLayerCandidates(owner)[0].empty,false);
 assert.throws(()=>qwenLayerPaint(owner,'mask'),/ピンポイント修正用/);
 assert.equal(qwenLayerPaint(owner,'mask',true).layers[0].id,'mask');
});
test('reference and correction are independently optional and character sheets share the ten-image limit',()=>{
 const manga=fixture(),owner=paintScene(manga.pages[0].panels[0],100,[]).owners[1],plan=buildQwenGenerationPlan(manga,0,0,false,owner);
 const refs=[{label:'設定画',characterKeys:['person-id'],image:'data:sheet'}];
 for(const reference of [undefined,'data:source'])for(const correction of [undefined,'data:correction']){
   const value=qwenGenerationPayload(plan,refs,reference,undefined,correction);
   assert.equal(value.mode,reference?'paint':'new');assert.equal(value.paint_image,reference);assert.equal(value.correction_image,correction);
   assert.equal(value.references[0].image,'data:sheet');
 }
 assert.equal(qwenGenerationPayload(plan,Array(8).fill(refs[0]),'data:source',undefined,'data:correction').references.length,8);
 assert.throws(()=>qwenGenerationPayload(plan,Array(9).fill(refs[0]),'data:source',undefined,'data:correction'),/合計10枚/);
 const sketch={id:'guide',kind:'sketch',image:'data:rough'},correction={id:'mask',kind:'paint',image:'data:mask'};
 assert.equal(qwenGenerationPrompt(plan),plan.prompt);assert.equal(qwenGenerationPrompt(plan,sketch),plan.sketchPrompt);
 assert.match(qwenGenerationPrompt(plan,sketch,correction),/修正対象以外/);
 assert.match(qwenGenerationPrompt(plan,undefined,correction),/書き込み付き画像/);
 assert.doesNotMatch(qwenGenerationPrompt(plan,sketch,correction),/新しい絵|描写範囲は/);
});
test('only explicit paint mode includes its image; identity mismatch and missing refs fail before submission',()=>{
 const manga=fixture(),scene=paintScene(manga.pages[0].panels[0],100,[]),plan=buildQwenGenerationPlan(manga,0,0,false,scene.owners[1]);
 const refs=[{label:'全身',characterKeys:['person-id'],image:'data:ref'}];
 const normal=qwenGenerationPayload(plan,refs);assert.equal(normal.mode,'new');assert.ok(!('paint_image' in normal));
 const paint=qwenGenerationPayload(plan,refs,'data:paint');assert.equal(paint.mode,'paint');assert.equal(paint.paint_image,'data:paint');assert.equal(paint.references[0].image,'data:ref');
 assert.throws(()=>qwenGenerationPayload(plan,[]),/参照資料/);
 assert.throws(()=>qwenGenerationPayload(plan,[{...refs[0],characterKeys:['other']}]),/人物|参照資料/);
 assert.throws(()=>qwenGenerationPayload(plan,Array(10).fill(refs[0])),/9枚/);
});

test('storyboard generation separates one rough pose from character sheets and keeps scene direction',()=>{
 const manga=fixture(),figure=manga.pages[0].panels[0].figures[0];
 figure.action='目線はつま先に向ける。険しい表情、冷や汗';
 figure.analogImport={schemaVersion:1,sourceRegionId:'region',assetId:'rough',sourceBBox:{x:0,y:0,w:1,h:1},detectionSource:'body',draft:true};
 const before=structuredClone(manga);
 const plan=buildQwenGenerationPlan(manga,0,0,false,paintScene(manga.pages[0].panels[0],100,[]).owners[1]);
 assert.match(plan.sketchPrompt,/つま先に向ける。険しい表情、冷や汗/);
 assert.match(plan.sketchPrompt,/見切れを保つ/);
 assert.doesNotMatch(plan.sketchPrompt,/背景.*透過/); // Alpha is a separate pass; it must not flatten the drawing.
 assert.doesNotMatch(plan.sketchPrompt,/描写範囲は全身|画面に収めた/);
 const refs=[{label:'全身資料',characterKeys:['person-id'],image:'data:sheet'}];
 const payload=qwenGenerationPayload({...plan,prompt:plan.sketchPrompt},refs,undefined,'data:rough');
 assert.equal(payload.mode,'sketch');assert.equal(payload.sketch_image,'data:rough');
 assert.deepEqual(payload.references,[{label:'全身資料',character_keys:['person-id'],image:'data:sheet'}]);
 assert.ok(!('paint_image' in payload));assert.deepEqual(manga,before);
 assert.throws(()=>qwenGenerationPayload(plan,refs,'data:paint','data:rough'),/同時/);
 const background=buildQwenGenerationPlan(manga,0,0,false,paintScene(manga.pages[0].panels[0],100,[]).owners[0]);
 assert.equal(background.sketchPrompt,undefined);
 assert.throws(()=>qwenGenerationPayload(background,[],undefined,'data:rough'),/登場人物/);
});


import {createHash} from 'node:crypto';
import {decodeQwenJob} from '../src/lib/localBridge.ts';
test('saved page jobs accept their original nonzero panel id without rewriting history',async()=>{
 const response={profile:QWEN_GENERATION_PROFILE,job_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',status:'prepared',request_sha256:'a'.repeat(64),label:'ページ',width:768,height:1024,
  document_key:'work',page_number:1,panel_id:1,overlay:false,owner_key:'page',created_at:42};
 for(const panelId of [0,1,3])assert.equal((await decodeQwenJob({...response,panel_id:panelId})).panelId,panelId);
 for(const patch of [{panel_id:-1},{panel_id:1.5},{overlay:true},{owner_key:'panel',panel_id:0}])await assert.rejects(decodeQwenJob({...response,...patch}));
});
test('Qwen PNG decoding accepts nonsquare output only with matching job, size and digest',async t=>{
 const prior=globalThis.window;globalThis.window={atob};t.after(()=>{globalThis.window=prior;});
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',raw=Buffer.alloc(33);
 Buffer.from([137,80,78,71,13,10,26,10]).copy(raw);raw.writeUInt32BE(768,16);raw.writeUInt32BE(1376,20);
 const response={profile:'qwen-image-2.1-owner-v1',job_id:id,status:'succeeded',request_sha256:'a'.repeat(64),label:'人物',width:768,height:1376,
   image:'data:image/png;base64,'+raw.toString('base64'),image_sha256:createHash('sha256').update(raw).digest('hex'),file_name:`qwen_${id}.png`};
 assert.equal((await decodeQwenJob(response,id)).image,response.image);
 await assert.rejects(decodeQwenJob({...response,width:1024},id));
 await assert.rejects(decodeQwenJob({...response,image_sha256:'0'.repeat(64)},id));
 await assert.rejects(decodeQwenJob(response,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
 await assert.rejects(decodeQwenJob(response,id,'b'.repeat(64)));
});

test('Qwen preparation persists English before a hash-bound supervisor submission', async t => {
  const {prepareQwenJob,submitQwenJob}=await import('../src/lib/localBridge.ts');
  const priorWindow=globalThis.window,priorFetch=globalThis.fetch;
  globalThis.window={setTimeout,clearTimeout};
  t.after(()=>{globalThis.window=priorWindow;globalThis.fetch=priorFetch;});
  const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',calls=[];
  const job={profile:'qwen-image-2.1-owner-v1',job_id:id,status:'prepared',request_sha256:'a'.repeat(64),label:'人物',width:768,height:1376};
  globalThis.fetch=async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):null;
    if(body)calls.push([new URL(url).pathname,body]);
    const supervisor=String(url).includes('8786');
    return Response.json({service:supervisor?'nyamuru-image-hub-bridge-supervisor':'nyamuru-image-hub-local-bridge',
      layout_protocol_version:3,protocol_version:1,...(body?{...job,status:supervisor?'queued':'prepared'}:{})});
  };
  const prepared=await prepareQwenJob(id,{prompt:'日本語の元入力'});
  await submitQwenJob(prepared,'prepared-session');
  assert.deepEqual(calls,[['/api/qwen-generation/prepare',{prompt:'日本語の元入力',job_id:id}],
    ['/api/image-generation/submit',{lease_token:'prepared-session',payload:{job_id:id,request_sha256:'a'.repeat(64)}}]]);
});

test('Qwen deletion binds every selected file to the work and verifies the complete response', async t => {
 const {deleteQwenJobs}=await import('../src/lib/localBridge.ts');
 const priorWindow=globalThis.window,priorFetch=globalThis.fetch;
 globalThis.window={setTimeout,clearTimeout};
 t.after(()=>{globalThis.window=priorWindow;globalThis.fetch=priorFetch;});
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',calls=[];
 const job={jobId:id,status:'succeeded',requestSha256:'a'.repeat(64),label:'人物',width:768,height:1376,documentKey:'work'};
 const plan={documentKey:'work'};
 let response={document_key:'work',deleted_job_ids:[id]};
 globalThis.fetch=async(url,options)=>{
  const body=options?.body?JSON.parse(options.body):null;
  if(body)calls.push([new URL(url).pathname,body]);
  return Response.json({service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3,...(body?response:{})});
 };
 await deleteQwenJobs(plan,[job]);
 assert.deepEqual(calls,[['/api/qwen-generation/delete',{document_key:'work',jobs:[{job_id:id,request_sha256:job.requestSha256}]}]]);
 await assert.rejects(deleteQwenJobs(plan,[{...job,documentKey:'other'}]),/作品/);
 assert.equal(calls.length,1);
 for(const invalid of [{deleted_job_ids:[]},{deleted_job_ids:[id,id]},{deleted_job_ids:['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']},{document_key:'other'}]){
  response={document_key:'work',deleted_job_ids:[id],...invalid};
  await assert.rejects(deleteQwenJobs(plan,[job]),/削除結果/);
 }
});

test('Qwen work history allows other owners only inside the selected work',async t=>{
 const {listQwenJobs}=await import('../src/lib/localBridge.ts');
 const priorWindow=globalThis.window,priorFetch=globalThis.fetch;
 globalThis.window={setTimeout,clearTimeout};
 t.after(()=>{globalThis.window=priorWindow;globalThis.fetch=priorFetch;});
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',calls=[];
 const plan={documentKey:'work',pageNumber:1,panelId:1,overlay:false,ownerKey:'figure-0'};
 let item={profile:'qwen-image-2.1-owner-v1',job_id:id,status:'succeeded',request_sha256:'a'.repeat(64),label:'別コマ',width:768,height:1376,
  document_key:'work',page_number:2,panel_id:3,overlay:false,owner_key:'figure-1',created_at:42,file_name:`qwen_${id}.png`};
 globalThis.fetch=async(_url,options)=>{
  const body=options?.body?JSON.parse(options.body):null;
  if(body)calls.push(body);
  return Response.json({service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3,...(body?{jobs:[item]}:{})});
 };
 const jobs=await listQwenJobs(plan,'work');
 assert.equal(jobs[0].pageNumber,2);assert.equal(jobs[0].panelId,3);assert.equal(jobs[0].fileName,`qwen_${id}.png`);
 assert.equal(calls[0].scope,'work');
 await assert.rejects(listQwenJobs(plan),/対象/);
 item={...item,document_key:'another-work'};
 await assert.rejects(listQwenJobs(plan,'work'),/対象/);
});
