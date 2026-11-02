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
  assert.deepEqual([payload.width,payload.height,payload.candidate_count,payload.mode,payload.dpi],[300,400,5,'new',254]);
  assert.equal(payload.prompt+'\nUniform solid #00FF00 background.',workflow.graph['6'].inputs.prompt);assert.ok(!('sketch_image' in payload));
  assert.deepEqual(payload.references.map(r=>[r.image,r.character_keys]),[['pose',[]],['identity',['id']],['expression',[]]]);
  assert.throws(()=>qwenGenerationPayload(plan,[ref],undefined,'expression',undefined,'pose'),/ネーム/);
  assert.throws(()=>qwenGenerationPayload(plan,[ref,ref],'expression',undefined,undefined,'pose'),/設定画1枚/);
  assert.throws(()=>qwenGenerationPayload(plan,[ref],'expression',undefined,undefined,undefined),/3D/);
});
