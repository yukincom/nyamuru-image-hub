/** 見込み: 原稿の寸法と人物カメラの基準を保てば、採用レイヤーと3Dの切り取りが対応する。
 * 合格: コマのDPI換算、偏ったマスクのpx/mmと投影範囲が一致する。幾何計算のみ、描画と実推論は対象外。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { insertGeneratedPaintImage } from '../src/lib/paintDocument.ts';
import { threeImageFigureTarget } from '../src/lib/humanPoseFraming.ts';

const owner = { frame: { x: 0, y: 0, w: 50, h: 30 }, paint: { width: 200, height: 150, dpi: 254 } };
const camera = { x: 10, y: 0, w: 20, h: 20 };
const panel = { shape: { type: 'polygon', points: [[0, 0], [30, 0], [0, 40]] } };

// 見込み: マスクがなければ三角コマの外接枠とDPIで出力を決める。合格: 300×400px、30×40mm、撮影輪郭は三角。合成座標で確認。
test('panel uses its print dimensions and projected outline', () => {
  const target = threeImageFigureTarget(owner, camera, panel);
  assert.deepEqual([target.width, target.height], [300, 400]);
  assert.deepEqual(target.outputFrame, { x: 0, y: 0, w: 30, h: 40 });
  assert.deepEqual(target.cutFrame.points, [[-.5, 0], [1, 0], [-.5, 2]]);
  assert.deepEqual(target.cutFrame.bounds, { x: -.5, y: 0, w: 1.5, h: 2 });
});

// 見込み: マスクやレイヤー密度より原稿dpiとコマを優先。合格: 508dpiでコマ全体、ページ前景だけはマスクを使う。幾何と実レイヤー配置で確認。
test('panel and manuscript DPI win over the figure mask and layer DPI', () => {
  const mask = { x: 10, y: 25, w: 50, h: 20 };
  const target = threeImageFigureTarget(owner,camera,panel,mask,508);
  assert.deepEqual([target.width,target.height,target.dpi],[600,800,508]);
  assert.deepEqual(target.outputFrame,{x:0,y:0,w:30,h:40});
  const overlay = threeImageFigureTarget(owner,camera,undefined,mask,508);
  assert.deepEqual(overlay.outputFrame,{x:2.5,y:5,w:12.5,h:4});
  assert.deepEqual([overlay.width,overlay.height],[250,80]);
  const added=insertGeneratedPaintImage({...owner,kind:'figure',paint:{...owner.paint,layers:[]}},
    {id:'final',widthPx:target.width,heightPx:target.height},'候補',target.outputFrame);
  assert.deepEqual(added.layer.image.bbox,{x:0,y:0,w:120,h:200});
  assert.equal(threeImageFigureTarget(owner,camera),undefined);
});

import {readFileSync} from 'node:fs';
import {buildQwenGenerationPlan,figureBackgroundPrompt,qwenPlanForWorkflow,qwenGenerationPayload} from '../src/lib/qwenGeneration.ts';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup.ts';
import {setWorkStylePrompt} from '../src/lib/artworkRules.ts';
import {paintScene} from '../src/lib/paintDocument.ts';
import framingPrompts from '../src/content/figure-framing.json' with {type:'json'};

function appearanceFixture(){
  const {manga}=createEmptyWorkspaceDocument();
  manga.characters=[{localId:'who',name:'人物',recognition:{
    hair:{observed:['chin-length white bob'],inferred:[]},
    face:{observed:['large rounded eyes','two eyes high near the top of the head'],inferred:[]},
    accessories:{observed:['wide black headband','gold bracelet at the wrist','silver belt at the waist'],inferred:[]},
    silhouette:{observed:['flared A-line silhouette over dark sleeves and legs','narrow shoulders','slender full figure'],inferred:[]},
    outfit:{observed:['black high-neck long-sleeved shirt','a white sleeveless V-neck dress','high collar',
      'solid black opaque tights','solid black low-heeled shoes','white gloves on the hands'],inferred:[]},
  }}];
  const panel={id:1,shape:{type:'rect',x:0,y:0,w:40,h:30},bg:0,bubbles:[],
    figures:[{refId:'who',name:'人物',size:'face',bbox:{x:2,y:2,w:20,h:20}}]};
  manga.pages[0].panels=[panel];
  const build=size=>{panel.figures[0].size=size;return buildQwenGenerationPlan(manga,0,0,false,paintScene(panel,144,[]).owners.find(o=>o.key==='figure-0'));};
  const example=ext=>JSON.parse(readFileSync(new URL('../examples/comfyui/nyamuru_qwen_turbo_3images.'+ext+'.json',import.meta.url)));
  return {manga,build,flow:{graph:example('api'),binding:example('binding')}};
}

// 見込み: 生成用の派生文だけを選別すれば、顔アップに全身衣装を指示せず元の特徴を保持できる。
// 合格: 顔/髪/頭飾りだけ送信し、衣装・脚・靴・複合シルエットは除外。全身へ戻すと復帰し原本不変。実plan/payload、推論なし。
test('face generation filters body traits without editing or losing the reviewed character features',()=>{
  const {manga,build,flow}=appearanceFixture(),recognition=structuredClone(manga.characters[0].recognition);
  const source={...build('face'),humanPose:{framing:'face',selection:{input_mode:'image'}}},before=structuredClone(source),face=qwenPlanForWorkflow(source,flow);
  const payload=qwenGenerationPayload(face,[{label:'設定',characterKeys:['who'],image:'identity'}],'sketch',undefined,undefined,'pose');
  for(const text of ['chin-length white bob','large rounded eyes','wide black headband','two eyes high near the top of the head'])assert.ok(payload.prompt.includes(text));
  for(const text of ['shirt','dress','tights','shoes','bracelet','belt','A-line'])assert.ok(!payload.prompt.includes(text),text);
  assert.ok(payload.prompt.includes(`Framing (from <image1>): ${framingPrompts.face}`));
  assert.match(payload.prompt,/Match the crop, subject scale, camera angle and visible body region of <image1>/);
  assert.deepEqual(payload.references.map(ref=>ref.image),['pose','identity','sketch']);
  assert.deepEqual(source,before);assert.deepEqual(manga.characters[0].recognition,recognition);
  const full=qwenPlanForWorkflow({...source,humanPose:{framing:'full',selection:{input_mode:'image'}}},flow);
  assert.match(full.prompt,/full-body shot/);assert.match(full.prompt,/solid black low-heeled shoes/);
  assert.equal(full.characterFeatures,source.characterFeatures);
});

// 見込み: 既存の撮影範囲が同じ固定英文と特徴選択に届けば、部分撮影でも全身説明を引き戻さない。
// 合格: 11種類すべての英文と代表的な内外部位を照合。手/足は対応する特徴、任意の部分は画像に委ねる。実plan、推論なし。
test('all declared framings select visible design features using the shared shot dictionary',()=>{
  const {build,flow}=appearanceFixture();
  const cases=[
    ['long','solid black low-heeled shoes',null],['full','solid black low-heeled shoes',null],
    ['knee-up','solid black opaque tights','solid black low-heeled shoes'],
    ['waist-up','black high-neck long-sleeved shirt','solid black opaque tights'],
    ['bust-up','black high-neck long-sleeved shirt','white gloves on the hands'],
    ['shoulder-up','high collar','black high-neck long-sleeved shirt'],
    ['face','large rounded eyes','high collar'],['face-detail','large rounded eyes','a white sleeveless V-neck dress'],
    ['hand','white gloves on the hands','large rounded eyes'],['foot','solid black low-heeled shoes','chin-length white bob'],
    ['part',null,'Observed features:'],
  ];
  for(const [size,kept,removed] of cases){
    const plan=qwenPlanForWorkflow(build(size),flow);
    assert.ok(plan.prompt.includes(`Framing (from <image1>): ${framingPrompts[size]}`),size);
    if(kept)assert.ok(plan.prompt.includes(kept),`${size}: ${kept}`);
    if(removed)assert.ok(!plan.prompt.includes(removed),`${size}: ${removed}`);
    // 全身の体型を上半身の特徴として残さず、見える肩幅だけを保持する。
    if(['waist-up','bust-up'].includes(size)){
      assert.ok(plan.prompt.includes('narrow shoulders'),size);
      assert.ok(!plan.prompt.includes('slender full figure'),size);
    }
  }
});

// 見込み: 人物IDで登録設定を引けば、同名の別人や未確認の特徴を混ぜずに生成できる。
// 合格: 3枚参照のimage2指示へ本人のobservedだけが入り、旧自由文と他人の特徴を除外。設定変更・手動編集後の送信も検査。実推論なし。
test('three-image positive defaults use only the linked character’s saved appearance',()=>{
  const {manga}=createEmptyWorkspaceDocument();
  manga.characters=[{localId:'other',name:'人物',visual_prompt:'別人の衣装'},
    {localId:'who',name:'人物',visual_prompt:'使わない旧ビジュアル文',recognition:{
      face:{observed:['細い眉'],inferred:[]},
      hair:{observed:['前髪あり'],inferred:['推測の髪色']},accessories:{observed:['黒いリボン','前髪あり'],inferred:[]},
      ambiguous_design:{observed:['形不明'],inferred:[]}}}];
  const p={id:1,shape:{type:'rect',x:0,y:0,w:40,h:50},bg:0,bubbles:[],
    figures:[{refId:'who',name:'人物',action:'A tired smile.',bbox:{x:2,y:2,w:20,h:30}}]};
  manga.pages[0].panels=[p];setWorkStylePrompt(manga,'Fine pen lines.');
  const who=paintScene(p,144,[]).owners.find(o=>o.key==='figure-0');
  const build=()=>buildQwenGenerationPlan(manga,0,0,false,who);
  const example=ext=>JSON.parse(readFileSync(new URL('../examples/comfyui/nyamuru_qwen_turbo_3images.'+ext+'.json',import.meta.url)));
  const flow={graph:example('api'),binding:example('binding')},source=build();
  const plan=qwenPlanForWorkflow({...source,humanPose:{selection:{input_mode:'image'}}},flow);
  for(const text of [source.prompt,source.sketchPrompt,plan.prompt]){
    assert.match(text,/細い眉/);assert.match(text,/黒いリボン/);assert.equal(text.split('前髪あり').length,2);
    assert.doesNotMatch(text,/別人の衣装|推測の髪色|形不明|使わない旧ビジュアル文/);
  }
  assert.match(plan.prompt,/Expression and acting \(from <image3>\):\nA tired smile\./);
  assert.match(plan.prompt,/Character Inking & Pen Touch[\s\S]*Fine pen lines\./);
  setWorkStylePrompt(manga,'Dry brush strokes.');p.figures[0].action='Eyes wide open.';
  const revised=qwenPlanForWorkflow(build(),flow).prompt;
  assert.match(revised,/Dry brush strokes\./);assert.match(revised,/Eyes wide open\./);
  assert.doesNotMatch(revised,/Fine pen lines|A tired smile/);
  const blue=figureBackgroundPrompt(plan.prompt,'#0000FF');
  assert.match(blue,/chroma blue \(#0000FF, RGB 0, 0, 255\)/);assert.doesNotMatch(blue,/#00FF00/);
  assert.equal(figureBackgroundPrompt(blue,'#00FF00'),plan.prompt);
  const ref={image:'identity',characterKeys:['who'],label:'設定'};
  const send=prompt=>qwenGenerationPayload({...plan,prompt},[ref],'storyboard',undefined,undefined,'pose');
  assert.equal(send(plan.prompt).prompt,plan.prompt);
  assert.equal(send('今回だけの指示').prompt,'今回だけの指示');
  assert.deepEqual(send(plan.prompt).references.map(r=>r.image),['pose','identity','storyboard']);
  delete manga.characters[1].recognition;delete manga.characters[1].visual_prompt;
  assert.doesNotMatch(qwenPlanForWorkflow(build(),flow).prompt,/Character & Design|Observed features|黒いリボン/);
});

// 見込み: 3枚専用の登録だけに役割と寸法を適用すれば、ネームの比率・人物名・一般向け生成指示は混ざらない。
// 合格: 3スロットがポーズ/設定/表情順、元のカメラを保持、指定寸法と登録英文が一致。不足・役割誤りは拒否。範囲: UI直下の実送信値、画像は識別用文字列。
test('only the dedicated workflow sends the sketch as expression reference at panel dimensions',()=>{
  const example=ext=>JSON.parse(readFileSync(new URL('../examples/comfyui/nyamuru_qwen_turbo_3images.'+ext+'.json',import.meta.url)));
  const workflow={graph:example('api'),binding:example('binding')},mask={x:10,y:25,w:50,h:20};
  const source={ownerKey:'figure-0',label:'人物名',width:200,height:150,prompt:'人物名や頭身',characterKeys:['id'],
    humanPose:{selection:{input_mode:'image'},aspect:1},threeImageTarget:{...threeImageFigureTarget(owner,camera,panel,mask),referenceFrame:camera}};
  const plan=qwenPlanForWorkflow(source,workflow),ref={image:'identity',characterKeys:['id'],label:'設定'};
  assert.equal(qwenPlanForWorkflow(source,null),source);
  assert.equal(qwenPlanForWorkflow(source,{...workflow,binding:{...workflow.binding,prompt_mode:'qwen'}}),source);
  assert.equal(plan.humanPose.selection,source.humanPose.selection);assert.deepEqual(plan.referenceFrame,camera);
  assert.deepEqual(plan.outputFrame,{x:0,y:0,w:30,h:40});
  const payload=qwenGenerationPayload(plan,[ref],'expression',undefined,undefined,'pose');
  assert.deepEqual([payload.width,payload.height,payload.candidate_count,payload.mode,payload.dpi],[180,240,5,'new',254]);
  assert.equal(payload.prompt+'\nUniform solid #00FF00 background.',workflow.graph['6'].inputs.prompt);assert.ok(!('sketch_image' in payload));
  assert.deepEqual(payload.references.map(r=>[r.image,r.character_keys]),[['pose',[]],['identity',['id']],['expression',[]]]);
  assert.throws(()=>qwenGenerationPayload(plan,[ref],undefined,'expression',undefined,'pose'),/ネーム/);
  assert.throws(()=>qwenGenerationPayload(plan,[ref,ref],'expression',undefined,undefined,'pose'),/設定画1枚/);
  assert.throws(()=>qwenGenerationPayload(plan,[ref],'expression',undefined,undefined,undefined),/3D/);
});

// 見込み: 出力だけ60%へ変えれば、20%の撮影資料と紙面の配置枠を保ったまま低解像度画像を採用できる。
// 合格: 原稿1793×880→送信1076×528、元の撮影寸法とmm枠は不変。実plan/payload/配置、画像は識別用。
test('sixty-percent output keeps the manuscript placement and twenty-percent pose target',()=>{
  const example=ext=>JSON.parse(readFileSync(new URL('../examples/comfyui/nyamuru_qwen_turbo_3images.'+ext+'.json',import.meta.url)));
  const frame={x:5,y:7,w:75.9036666667,h:37.2533333333};
  const source={ownerKey:'figure-0',label:'人物',width:200,height:150,prompt:'',characterKeys:['id'],humanPose:{selection:{input_mode:'image'}},
    threeImageTarget:{width:1793,height:880,dpi:600,outputFrame:frame,referenceFrame:camera,cutFrame:{bounds:{x:0,y:0,w:1,h:1},points:[[0,0],[1,0],[1,1],[0,1]]}}};
  const plan=qwenPlanForWorkflow(source,{graph:example('api'),binding:example('binding')});
  const sent=qwenGenerationPayload(plan,[{image:'identity',characterKeys:['id'],label:'設定'}],'expression',undefined,undefined,'pose');
  assert.deepEqual([sent.width,sent.height],[1076,528]);
  assert.deepEqual([source.threeImageTarget.width,source.threeImageTarget.height],[1793,880]);
  assert.deepEqual(plan.outputFrame,frame);
  const placed=insertGeneratedPaintImage({...owner,kind:'figure',paint:{...owner.paint,layers:[]}},
    {id:'result',widthPx:1076,heightPx:528},'候補',frame);
  const bbox=placed.layer.image.bbox;
  const original=insertGeneratedPaintImage({...owner,kind:'figure',paint:{...owner.paint,layers:[]}},
    {id:'full',widthPx:1793,heightPx:880},'原寸',frame).layer.image.bbox;
  assert.ok(Math.abs(bbox.w-original.w)<1 && Math.abs(bbox.h-original.h)<1);
});
