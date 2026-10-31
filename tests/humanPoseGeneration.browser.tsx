/** Actual installed skeleton + renderer; synthetic character sheet and in-memory generation APIs. */
import { render } from 'preact';
import { useState } from 'preact/hooks';
import MangaCanvas from '../src/components/MangaCanvas';
import { humanPosePanelCutFrame } from '../src/lib/humanPoseFraming';
import { buildQwenCompositionPlan, captureQwenComposition, captureQwenCompositionCanvas } from '../src/lib/qwenComposition';
import FigureHumanPoseEditor from '../src/components/FigureHumanPoseEditor';
import FigureSizePicker from '../src/components/FigureSizePicker';
import QwenGenerationDialog from '../src/components/QwenGenerationDialog';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { paintScene } from '../src/lib/paintDocument';
import { buildQwenGenerationPlan, QWEN_GENERATION_PROFILE, type QwenGenerationPlan } from '../src/lib/qwenGeneration';
import { decodeHumanPoseScene } from '../src/lib/humanPoseSceneAssets';
import { HumanPoseSceneRenderer } from '../src/lib/humanPoseSceneRenderer';
import { captureHumanPoseReference } from '../src/lib/humanPoseGeneration';
import { confirmHumanPoseCameraPrompt } from '../src/lib/humanPoseScene';
import { selectHumanPose, humanPoseSelectable, requireHumanPoseGenerationReady } from '../src/lib/humanPoseSelection';
import type {HumanPoseTextSelection, HumanPoseCatalogEntry} from '../src/lib/humanPoseTypes';
import { FIGURE_SIZE_LABELS, parseMangaYaml, toStoredMangaYaml } from '../src/lib/manga';
import { imageSha256, prepareImageAsset, createFrameArtwork } from '../src/lib/imagePlacement';
import { saveFigureCropAssets, deleteFigureCropAssets } from '../src/lib/figureCropStore';
import {panelBounds} from '../src/lib/canvasGeometry';
import type { FigureSize, ImageAsset, BBox } from '../src/types';
import '../src/styles/global.css';

const fixture = await (await fetch('/pose-fixture')).json();
const fixtureFetch=window.fetch.bind(window);
if (fixture.error) throw new Error(fixture.error);
const assets = await decodeHumanPoseScene(fixture.scene, fixture.scene.pose_id, fixture.scene.catalog_sha256);
const entry = fixture.catalog.catalog.poses.find((p: {id:string}) => p.id === fixture.scene.pose_id);
const canvas = document.createElement('canvas'); canvas.width=512;canvas.height=1024;
const context=canvas.getContext('2d')!;
context.fillStyle='white';context.fillRect(0,0,512,1024);context.strokeStyle='black';context.lineWidth=10;
context.beginPath();context.ellipse(256,180,90,110,0,0,Math.PI*2);context.stroke();
context.beginPath();context.moveTo(170,145);context.quadraticCurveTo(180,40,280,70);context.lineTo(345,160);context.fillStyle='black';context.fill();
context.beginPath();context.moveTo(210,165);context.lineTo(235,160);context.moveTo(280,160);context.lineTo(305,165);context.stroke();
context.beginPath();context.moveTo(170,320);context.lineTo(340,320);context.lineTo(355,670);context.lineTo(160,670);context.closePath();context.stroke();
context.beginPath();context.moveTo(175,670);context.lineTo(165,930);context.moveTo(320,670);context.lineTo(340,930);context.stroke();
const image=canvas.toDataURL('image/png'),blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png')),digest=await imageSha256(blob),assetId=`image-${digest}`;
const initial=createEmptyWorkspaceDocument();initial.manga.meta.series_id='pose-fixture';initial.manga.meta.episode_id='fixture';initial.manga.meta.format='モノクロ漫画';
initial.manga.characters=[{localId:'person',scope:'series',catalog_id:'catalog',name:'検証用人物',visual_prompt:'細い眉と短い黒髪',default_proportion:{head_count:7}} as typeof initial.manga.characters[number]];
initial.manga.materials=[{type:'character',scope:'series',key:'検証用の人物資料',characterId:'person',character_catalog_id:'catalog',source_image:{schema_version:1,asset_id:assetId,file_name:`characters/catalog/${assetId}.png`,media_type:'image/png',byte_size:blob.size,width_px:512,height_px:1024,sha256:digest}} as typeof initial.manga.materials[number]];
initial.manga.pages[0].panels=[{id:1,shape:{type:'polygon',points:[[8,12],[95,22],[90,155],[8,148]]},bg:0,action:null,bubbles:[],figures:[{name:'検証用人物',refId:'person',size:'bust-up',action:'驚いた表情で左を見る',bbox:{x:10,y:25,w:40,h:80}}]}];
initial.manga.pages[0].canvas={...initial.manga.pages[0].canvas,w:110,h:180};
initial.manga.pages[0].panels[0].figures!.push({name:'相方',refId:'person',size:'full',action:'右手を振る',bbox:{x:57,y:55,w:25,h:70}});
initial.manga.pages[0].panels[0].bubbles.push({text:'こんにちは！',speaker:'検証用人物',shape:'normal',bbox:{x:62,y:25,w:24,h:27}});
// 見込み: コマ全体の白地を持つ相方でも、仮表示を初期OFFにすればモデルと操作マーカーを隠さない。
// 合格: 初回/再度開いた時は仮表示OFF、ON/OFFで画像だけ切替。カメラ/関節を操作でき、仮表示切替で単品撮影PNGは変わらない。
// 範囲: 実3D素材/renderer/編集UIと合成原画。画像保存は専用originのfixture、APIは模擬。実作品・モデル生成は対象外。
if(new URLSearchParams(location.search).has('opaque-companion')){
  const asset=await prepareImageAsset(new File([blob],'opaque-companion.png',{type:'image/png'}));
  await saveFigureCropAssets([{id:asset.storageId,blob}]);initial.manga.image_assets=[asset];
  const panel=initial.manga.pages[0].panels[0],companion=panel.figures![1];companion.bbox=panelBounds(panel);
  companion.artwork=createFrameArtwork(asset,companion.bbox);
}
const supervisor={service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1},bridge={service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3};
let lastPayload:Record<string,any>={},report=()=>{},requests=0;
const poseSources=new Map<string,string>();
const job=(status:string)=>({profile:QWEN_GENERATION_PROFILE,job_id:lastPayload.job_id,status,request_sha256:'a'.repeat(64),label:'検証用人物',width:512,height:1024,
  document_key:lastPayload.document_key,page_number:lastPayload.page_number,panel_id:lastPayload.panel_id,overlay:false,owner_key:lastPayload.owner_key,created_at:Date.now(),
  ...(status==='succeeded'?{file_name:`qwen_${lastPayload.job_id}.png`,image,image_sha256:digest}:{})});
window.fetch=async(input,options)=>{
  const path=new URL(String(input),location.href).pathname,body=options?.body?JSON.parse(String(options.body)):{};
  if(path==='/api/health')return Response.json(bridge);
  if(path==='/api/new-creation/start')return Response.json({...supervisor,lease_token:'fixture'});
  if(path==='/api/new-creation/stop')return Response.json({...supervisor,released:true,llm_released:true});
  if(path==='/api/panel-actions/prepare')return Response.json(supervisor);
  if(path==='/api/image-generation/prepare')return Response.json({...supervisor,llm_stopped:true});
  if(path==='/api/human-pose/catalog')return Response.json({...bridge,...fixture.catalog});
  if(path==='/api/human-pose/scene'){
    const selected=body.pose_id===fixture.scene.pose_id&&!body.body_model?fixture:await (await fixtureFetch(`/pose-fixture?pose=${encodeURIComponent(body.pose_id)}${body.body_model?`&body=${encodeURIComponent(body.body_model)}`:''}`)).json();
    poseSources.set(body.pose_id,selected.scene.pose.sha256);
    return Response.json({...bridge,...selected.scene});
  }
  if(path==='/api/series/character-images/load')return Response.json({...bridge,...body,found:true,image});
  if(path==='/api/qwen-generation/prepare'){
    lastPayload=body;requests++;report();
    const sentPose=body.references.find((r:{label:string})=>r.label.startsWith('3Dポーズ参照'));
    const preview=document.querySelector<HTMLImageElement>('img[alt="描写範囲に合わせた3Dポーズ参照"]');
    if(sentPose&&sentPose.image!==preview?.src)throw new Error('プレビューと送信画像が異なります');
    if(!body.references.some((r:{character_keys:string[]})=>r.character_keys.includes(body.character_keys[0])))throw new Error('人物資料がありません');
    if(!body.prompt.includes('驚いた表情で左を見る'))throw new Error('動作がありません');
    if(sentPose&&body.prompt.includes('描写範囲は'))throw new Error('画像モードの範囲文が重複しています');
    return Response.json({...bridge,...job('prepared')});
  }
  if(path==='/api/image-generation/submit')return Response.json({...supervisor,...job('succeeded')});
  throw new Error(`Fixture blocked unexpected request: ${path}`);
};
// 見込み: 既存カタログと選択処理をdialog draftへ接続すれば、登録姿勢を3Dへ反映し確定/取消で作品との境界を保てる。
// 合格: 一覧位置/番号検索、実姿勢切替、頭のworld位置/カメラ/切取り/canvas/スクロール保持、同値選択、Undo/Redo、取消・保存往復が一致。
// 範囲: 実FigureHumanPoseEditor/3D rendererとインストール済み素材。APIは同じローカル素材のfixture、作品はメモリ内。生成未実行。
async function verifyPosePresets(){
 const host=document.createElement('div');document.body.append(host);let checks=0,changes=0;
 let activeRenderer:HumanPoseSceneRenderer|undefined,creates=0;
 const errors:unknown[][]=[],logError=console.error;
 console.error=(...args:unknown[])=>{errors.push(args);logError(...args);};
 const createRenderer=HumanPoseSceneRenderer.create;
 HumanPoseSceneRenderer.create=async(...args:Parameters<typeof createRenderer>)=>{creates++;activeRenderer=await createRenderer(...args);return activeRenderer;};
 const head=()=>activeRenderer!.focusJoint('head').camera.target;
 const sameHead=(expected:number[])=>head().every((coordinate,index)=>Math.abs(coordinate-expected[index])<1e-9);
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks++;};
 const settle=async()=>{for(let i=0;i<4;i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));};
 const wait=async(test:()=>boolean,label:string)=>{const deadline=performance.now()+15000;while(!test()&&performance.now()<deadline)await settle();check(test(),label);};
 const poses=(fixture.catalog.catalog.poses as HumanPoseCatalogEntry[]).filter(humanPoseSelectable),first=poses.find(pose=>pose.display_number===30)!,second=poses.find(pose=>pose.display_number===50)!;
 let value:HumanPoseTextSelection|undefined={...selectHumanPose(entry,fixture.scene.catalog_sha256),edited_text_ja:'元の手修正文を保持',input_mode:'image'};
 const before=JSON.stringify(value);
 const draw=()=>render(<FigureHumanPoseEditor value={value} aspect={.5} framingSize="bust-up" onChange={next=>{value=next;changes++;draw();}}/>,host);
 const dialog=()=>document.querySelector<HTMLElement>('.human-pose-scene-dialog')!;
 const button=(name:string)=>{const found=[...dialog().querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()===name);if(!found)throw Error(`ボタンなし：${name}`);return found;};
 const loaded=()=>!!dialog()?.querySelector('canvas')&&!dialog()?.querySelector<HTMLFieldSetElement>('.human-pose-presets')?.disabled;
 const open=async()=>{host.querySelector<HTMLButtonElement>('.figure-human-pose-edit')!.click();await wait(loaded,'実3Dの読込完了');};
 const choose=async(pose:HumanPoseCatalogEntry)=>{dialog().querySelector<HTMLButtonElement>(`[data-pose-id="${pose.id}"]`)!.click();await settle();await wait(()=>loaded()&&dialog().querySelector('h2')?.textContent?.includes(pose.label_ja)===true,`${pose.display_number}番の姿勢を反映`);};
 const capture=async()=>{button('撮影プレビュー').click();await settle();return dialog().querySelector<HTMLImageElement>('.human-pose-scene-preview img')!.src;};
 try{
  draw();await open();await wait(()=>dialog().querySelectorAll('.human-pose-card').length===poses.length,'全登録ポーズを表示');
  const aside=dialog().querySelector('aside')!,legends=[...aside.querySelectorAll('legend')].map(item=>item.textContent);
  check(legends[0]==='登録ポーズ'&&legends[1]==='モーションサポーター','一覧をモーションサポーターの直上に配置');
  const search=dialog().querySelector<HTMLInputElement>('input[type=search]')!;search.value='23';search.dispatchEvent(new Event('input',{bubbles:true}));await settle();
  check(dialog().querySelectorAll('.human-pose-card').length===1&&dialog().querySelector('.human-pose-card')!.textContent!.includes('23'),'既存の番号検索を利用');
  search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));await settle();
  button('左右反転').click();await settle();
  const numbers=[...dialog().querySelectorAll<HTMLInputElement>('input[type=number]')];
  for(const [index,value] of ['0.15','0.07','-0.1','168','1.1'].entries()){
    numbers[index].value=value;numbers[index].dispatchEvent(new Event('input',{bubbles:true}));await settle();
  }
  const yaw=[...dialog().querySelectorAll<HTMLInputElement>('input[type=range]')].find(input=>input.closest('label')?.textContent?.startsWith('人物の向き'))!;
  yaw.value='31';yaw.dispatchEvent(new Event('input',{bubbles:true}));await settle();
  dialog().querySelector('.human-pose-scene-view')!.dispatchEvent(new WheelEvent('wheel',{deltaY:-70,bubbles:true,cancelable:true}));await settle();
  const baseline=await capture(),sceneBefore=activeRenderer!.snapshot(),headBefore=head(),canvasBefore=dialog().querySelector('canvas');
  const grid=dialog().querySelector<HTMLElement>('.human-pose-grid')!;grid.scrollTop=160;await settle();const scrollBefore=grid.scrollTop;
  await choose(first);check(changes===0&&JSON.stringify(value)===before,'選択段階では作品の値を変えない');
  check(sameHead(headBefore),'頭のworld位置を基準に登録姿勢を交換');
  const after=activeRenderer!.snapshot();
  check(['camera','frame','framing','stature_m','body_mirror','background'].every(key=>JSON.stringify(after[key as keyof typeof after])===JSON.stringify(sceneBefore[key as keyof typeof sceneBefore])),'カメラ・撮影枠・身長・反転・背景を保持');
  check(after.placement.yaw_degrees===31&&after.placement.scale===1.1,'向きと倍率を保持');
  check(creates===1&&dialog().querySelector('canvas')===canvasBefore,'同じcanvasとWebGL表示を使い続ける');
  check(dialog().querySelector('.human-pose-grid')===grid&&grid.scrollTop===scrollBefore,'登録一覧のDOMとスクロール位置を保持');
  const firstImage=await capture();check(firstImage!==baseline,'実素材の切替で撮影画像も変わる');
  const version=dialog().querySelector('[data-history-version]')!.getAttribute('data-history-version');await choose(first);
  check(dialog().querySelector('[data-history-version]')!.getAttribute('data-history-version')===version,'同じ登録ポーズの再選択はUndoを増やさない');
  button('元に戻す').click();await settle();await wait(()=>loaded()&&dialog().querySelector('h2')?.textContent?.includes(entry.label_ja)===true,'Undoで元の登録姿勢へ戻る');
  check(await capture()===baseline,'Undoはカメラと切取りを含む元画像を再現');
  button('やり直す').click();await settle();await wait(()=>loaded()&&dialog().querySelector('h2')?.textContent?.includes(first.label_ja)===true,'Redoで選び直した登録姿勢を再現');
  check(await capture()===firstImage,'Redoは同じ3D撮影画像を再現');
  await choose(second);check(sameHead(headBefore)&&dialog().querySelector('canvas')===canvasBefore&&creates===1,'連続切替でも頭の位置と表示を保持');
  button('取消').click();await settle();check(!dialog()&&changes===0&&JSON.stringify(value)===before,'別のポーズまで選んでも取消は作品を変えない');
  await open();await choose(first);button('確定').click();await settle();
  check(changes===1&&value?.pose_id===first.id&&value?.label_ja===first.label_ja,'確定したポーズのIDと名前を保存');
  check(value?.edited_text_ja===first.pose_text_ja&&JSON.stringify(value?.baseline_segments)===JSON.stringify(first.prompt_segments)&&value?.input_mode==='image','ポーズの基準文・編集文・送り方を対応させる');
  check(value?.scene?.source.pose_sha256===poseSources.get(first.id),'選んだIDと実際の3D素材hashが一致');
  requireHumanPoseGenerationReady(value);
  const stored=structuredClone(initial);stored.manga.pages[0].panels[0].figures![0].human_pose=value;
  check(JSON.stringify(parseMangaYaml(toStoredMangaYaml(stored)).manga.pages[0].panels[0].figures![0].human_pose)===JSON.stringify(value),'OMNY往復で選択・撮影設定・本文を保持');
  await open();check(dialog().querySelector<HTMLButtonElement>(`[data-pose-id="${first.id}"]`)?.getAttribute('aria-pressed')==='true','開き直した一覧で保存ポーズを選択表示');
  button('開いた時の設定に戻す').click();await settle();check(button('元に戻す').disabled,'同じ初期設定への復帰ではUndoを増やさない');
  button('取消').click();await settle();
  check(errors.length===0,'姿勢の交換・履歴復元・終了でconsole errorを出さない');
  return `${checks}項目成功：番号付き一覧・検索・実3D切替・頭位置/カメラ/撮影枠/canvas/スクロール保持・Undo/Redo・取消・確定・保存往復`;
 }finally{render(null,host);host.remove();HumanPoseSceneRenderer.create=createRenderer;console.error=logError;}
}
// 見込み: 女性モデルのnative骨格へ同じポーズを移し、既存編集と保存へ接続すれば、体形を保って手指を動かせる。
// 合格: 同一canvasでモデル交換・頭/カメラ保持、指編集のPNG変化と他部位不変、Undo/Redo完全一致、姿勢・動き・OMNY・再撮影を確認。
// 範囲: 実GLB/骨格/編集UIとメモリ内作品。APIはローカル素材fixture。生成モデル・実作品のディスク保存は含まない。
async function verifyFemaleBody(){
 const host=document.createElement('div');document.body.append(host);let active:HumanPoseSceneRenderer|undefined,creates=0,changes=0;
 const originalCreate=HumanPoseSceneRenderer.create,errors:unknown[][]=[],logError=console.error,checks:string[]=[];
 HumanPoseSceneRenderer.create=async(...args:Parameters<typeof originalCreate>)=>{creates++;active=await originalCreate(...args);return active;};
 console.error=(...args:unknown[])=>{errors.push(args);logError(...args);};
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const settle=async()=>{for(let i=0;i<4;i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));};
 const wait=async(test:()=>boolean,label:string)=>{const deadline=performance.now()+20000;while(!test()&&performance.now()<deadline)await settle();check(test(),label);};
 let value:HumanPoseTextSelection|undefined={...selectHumanPose(entry,fixture.scene.catalog_sha256),input_mode:'image'};
 const originalValue=JSON.stringify(value);
 const draw=()=>render(<FigureHumanPoseEditor value={value} aspect={.5} framingSize="full" onChange={next=>{value=next;changes++;draw();}}/>,host);
 const dialog=()=>document.querySelector<HTMLElement>('.human-pose-scene-dialog')!;
 const button=(name:string)=>[...dialog().querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()===name)!;
 const loaded=()=>!!dialog()?.querySelector('canvas')&&!dialog()?.querySelector<HTMLFieldSetElement>('.human-pose-presets')?.disabled;
 const open=async()=>{host.querySelector<HTMLButtonElement>('.figure-human-pose-edit')!.click();await wait(loaded,'3D読込');};
 const head=()=>active!.focusJoint('head').camera.target;
 const equalPoint=(a:number[],b:number[])=>a.every((v,i)=>Math.abs(v-b[i])<1e-8);
 const chooseModel=async(id:string)=>{const select=dialog().querySelector<HTMLSelectElement>('select[aria-label="表示モデル"]')!;select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));await settle();await wait(()=>loaded()&&(active!.snapshot().body_model??'')===id,`モデル交換：${id||'軽量'}`);};
 const capture=async()=>{button('撮影プレビュー').click();await settle();return dialog().querySelector<HTMLImageElement>('.human-pose-scene-preview img')!.src;};
 try{
  draw();await open();const originalCanvas=dialog().querySelector('canvas'),originalScene=active!.snapshot(),originalHead=head(),lightImage=await capture();
  await chooseModel('bodychan-female');
  check(creates===1&&dialog().querySelector('canvas')===originalCanvas,'表示キャンバスを交換せず女性モデルを使う');
  check(equalPoint(head(),originalHead),'モデル交換でも頭のworld位置を保持');
  check(JSON.stringify(active!.snapshot().camera)===JSON.stringify(originalScene.camera)&&JSON.stringify(active!.snapshot().framing)===JSON.stringify(originalScene.framing),'カメラと切取りを保持');
  check(JSON.stringify(active!.snapshot().source)===JSON.stringify(originalScene.source),'catalogの素体とポーズのsourceを保持');
  const femaleImage=await capture();check(femaleImage!==lightImage,'撮影にも女性モデルの面を反映');
  check(changes===0&&JSON.stringify(value)===originalValue,'モデル交換は確定まで作品へ書かない');
  check(active!.snapshot().joint_edits===undefined,'無編集のモデル交換では関節編集を作らない');
  await chooseModel('');check(await capture()===lightImage,'無編集で軽量表示へ戻すと元のPNGへ完全一致');
  await chooseModel('bodychan-female');check(await capture()===femaleImage,'無編集で女性モデルへ戻してもPNG完全一致');
  const angle=async(id:string,value:string)=>{
    const joints=[...dialog().querySelectorAll<HTMLSelectElement>('select')].find(select=>select.closest('label')?.textContent?.startsWith('選択中の関節'))!;
    joints.value=id;joints.dispatchEvent(new Event('change',{bubbles:true}));await settle();
    const bend=[...dialog().querySelectorAll<HTMLInputElement>('input[type=range]')].find(input=>input.closest('label')?.textContent?.startsWith('曲げ'))!;
    bend.value=value;bend.dispatchEvent(new Event('input',{bubbles:true}));await settle();
  };
  await angle('footBall.L','40');check(await capture()!==femaleImage,'足先の曲げも実メッシュと撮影PNGに反映');
  button('元に戻す').click();await settle();await wait(loaded,'足編集Undo');check(await capture()===femaleImage,'足の曲げを解除すると元のPNGへ完全一致');
  const wristBefore=active!.focusJoint('wrist.L').camera.target,rightFingerBefore=active!.focusJoint('finger2-tip.R').camera.target;
  await angle('finger2-1.L','45');
  const fingerImage=await capture();check(fingerImage!==femaleImage&&!!active!.snapshot().joint_edits?.rotations['finger2-1.L'],'指の編集で実メッシュと撮影PNGが変わる');
  check(equalPoint(wristBefore,active!.focusJoint('wrist.L').camera.target)&&equalPoint(rightFingerBefore,active!.focusJoint('finger2-tip.R').camera.target),'左指だけの編集で手首と右指を動かさない');
  button('元に戻す').click();await settle();await wait(loaded,'指編集Undo');check(await capture()===femaleImage,'指編集Undoで撮影PNG完全一致');
  button('やり直す').click();await settle();await wait(loaded,'指編集Redo');check(await capture()===fingerImage,'指編集Redoで撮影PNG完全一致');
  await chooseModel('');check(dialog().querySelector('canvas')===originalCanvas,'軽量表示へ戻ってもcanvasを保持');
  button('元に戻す').click();await settle();await wait(()=>loaded()&&active!.snapshot().body_model==='bodychan-female','モデル交換Undo');
  check(await capture()===fingerImage,'モデル交換Undoで指編集込みの女性PNGを復元');
  const beforePreset=active!.snapshot(),headBeforePreset=head();
  dialog().querySelector<HTMLButtonElement>('[data-pose-id="pose-mh-sit01"]')!.click();await settle();await wait(()=>loaded()&&dialog().querySelector('h2')?.textContent?.includes('床に座る')===true,'女性モデルで座る');
  check(active!.snapshot().body_model==='bodychan-female'&&equalPoint(head(),headBeforePreset),'姿勢変更でも女性モデルと頭の位置を保持');
  check(JSON.stringify(active!.snapshot().camera)===JSON.stringify(beforePreset.camera)&&dialog().querySelector('canvas')===originalCanvas,'姿勢変更でもカメラとcanvasを保持');
  check(await capture()!==fingerImage,'座る姿勢を実メッシュへ反映');
  button('元に戻す').click();await settle();await wait(()=>loaded()&&dialog().querySelector('h2')?.textContent?.includes(entry.label_ja)===true,'女性姿勢Undo');check(await capture()===fingerImage,'姿勢Undoで指編集込みの女性PNGを復元');
  const motions=dialog().querySelector<HTMLSelectElement>('.human-pose-motion select')!;motions.value=active!.motionClips[0].id;motions.dispatchEvent(new Event('change',{bubbles:true}));await settle();
  const phase=dialog().querySelector<HTMLInputElement>('.human-pose-motion input[type=range]')!;phase.value='500';phase.dispatchEvent(new Event('input',{bubbles:true}));phase.dispatchEvent(new Event('blur'));await settle();
  check(active!.snapshot().motion?.phase===.5&&active!.snapshot().body_model==='bodychan-female','女性モデルでモーションの時点を編集');
  const savedImage=await capture();button('確定').click();await settle();check(changes===1&&value?.scene?.body_model==='bodychan-female','女性モデルと動き・姿勢を確定');
  const stored=structuredClone(initial);stored.manga.pages[0].panels[0].figures![0].human_pose=value;
  check(JSON.stringify(parseMangaYaml(toStoredMangaYaml(stored)).manga.pages[0].panels[0].figures![0].human_pose)===JSON.stringify(value),'OMNY往復で表示モデルと全編集を保持');
  HumanPoseSceneRenderer.create=originalCreate;
  check(await captureHumanPoseReference(value!,'full',.5)===savedImage,'生成参照の再撮影も同じ女性PNGになる');
  HumanPoseSceneRenderer.create=async(...args:Parameters<typeof originalCreate>)=>{creates++;active=await originalCreate(...args);return active;};
  await open();check(dialog().querySelector<HTMLSelectElement>('select[aria-label="表示モデル"]')!.value==='bodychan-female'&&await capture()===savedImage,'開き直して同じ女性モデル・撮影画像を復元');
  button('取消').click();await settle();check(changes===1,'取消で保存済み作品へ追加変更を出さない');
  check(errors.length===0,'モデル交換・手指・動き・履歴・終了でconsole errorなし');
  return `PASS ${checks.length}項目\n${checks.join('\n')}`;
 }finally{render(null,host);host.remove();HumanPoseSceneRenderer.create=originalCreate;console.error=logError;}
}
function Fixture(){
  const [active,setActive]=useState(0),[selection,setSelection]=useState<any>(null);
  const [doc,setDoc]=useState(initial),[plan,setPlan]=useState<QwenGenerationPlan|null>(null),[summary,setSummary]=useState('未実行'),[shots,setShots]=useState<Array<{label:string;image:string}>>([]),[error,setError]=useState('');
  const [presetReport,setPresetReport]=useState('未実行');
  const [bodyReport,setBodyReport]=useState('未実行');
  const figure=doc.manga.pages[0].panels[0].figures![0];
  report=()=>setSummary(JSON.stringify({requests,mode:lastPayload.mode,referenceRoles:lastPayload.references?.map((r:any)=>({label:r.label,characters:r.character_keys})),prompt:lastPayload.prompt},null,2));
  const compare=async()=>{
    const host=document.createElement('div');host.style.cssText='position:fixed;left:-10000px;width:512px;height:1024px';document.body.append(host);
    let renderer:HumanPoseSceneRenderer|undefined;
    try{
      renderer=await HumanPoseSceneRenderer.create(host,assets,undefined,.5);
      const baseline=renderer.snapshot(),pictures=[];
      for(const size of ['full','knee-up','waist-up','bust-up','shoulder-up','face'] as FigureSize[]){renderer.apply(baseline);renderer.apply(renderer.frameFor(size,.5));const before=JSON.stringify(renderer.snapshot());pictures.push({label:FIGURE_SIZE_LABELS[size],image:renderer.capture()});if(before!==JSON.stringify(renderer.snapshot()))throw new Error('撮影が保存値を変更しました');}
      renderer.apply(baseline);renderer.apply(renderer.frameFor('bust-up',.25));pictures.push({label:'胸から上・細長い枠',image:renderer.capture()});
      renderer.apply(baseline);renderer.apply(renderer.frameFor('bust-up',.5));
      const next=structuredClone(doc);next.manga.pages[0].panels[0].figures![0].human_pose={...selectHumanPose(entry,fixture.scene.catalog_sha256),input_mode:'image',scene:renderer.snapshot(),camera_prompt:confirmHumanPoseCameraPrompt(renderer.snapshot(),renderer.cameraSubject())};
      setDoc(next);setShots(pictures);setSummary('7種類の実PNGを撮影・保存値の不変を確認');
    }catch(cause){setError(String(cause));}finally{renderer?.dispose();host.remove();}
  };
  const openComposition=async(scope:'page'|'panel',index:number)=>{try{const next=buildQwenCompositionPlan(doc.manga,0,index,scope);next.compositionImage=await captureQwenComposition(doc.manga,0,index,scope);setPlan(next);setError('');}catch(cause){setError(String(cause));}};
  const verifyExport=async()=>{
    const stored:string[]=[],checks:string[]=[],canvases:HTMLCanvasElement[]=[];
    const check=(ok:boolean,label:string)=>{if(!ok)throw new Error(label);checks.push(label);};
    const source=async(width:number,height:number,draw:(ctx:CanvasRenderingContext2D)=>void):Promise<ImageAsset>=>{
      const c=document.createElement('canvas');canvases.push(c);c.width=width;c.height=height;draw(c.getContext('2d')!);
      const blob=await new Promise<Blob>(resolve=>c.toBlob(value=>resolve(value!),'image/png'));
      const asset=await prepareImageAsset(new File([blob],'synthetic-export.png',{type:'image/png'}));
      await saveFigureCropAssets([{id:asset.storageId,blob}]);stored.push(asset.storageId);return asset;
    };
    try{
      const stripes=await source(2048,64,ctx=>{ctx.fillStyle='#fff';ctx.fillRect(0,0,2048,64);ctx.fillStyle='#000';for(let x=0;x<2048;x+=2)ctx.fillRect(x,0,1,64);});
      const sharp=createEmptyWorkspaceDocument(),frame:BBox={x:0,y:0,w:2048/600*25.4,h:64/600*25.4};
      sharp.manga.pages[0].canvas={w:frame.w,h:frame.h,unit:'mm'};sharp.manga.pages[0].panels=[];
      sharp.manga.image_assets=[stripes];sharp.manga.pages[0].images=[createFrameArtwork(stripes,frame)];
      const sharpImage=await captureQwenCompositionCanvas(sharp.manga,0,0,'page',undefined,{width:2048,height:64,includeGenerated:true});canvases.push(sharpImage);
      const row=sharpImage.getContext('2d')!.getImageData(100,32,2,1).data;
      check(row[0]<10&&row[4]>245,'600dpi書き出しは2048px原本の1px白黒線を保持');
      const red=await source(32,32,ctx=>{ctx.fillStyle='#f00';ctx.fillRect(0,0,32,32);});
      const blue=await source(32,32,ctx=>{ctx.fillStyle='#00f';ctx.fillRect(0,0,32,32);});
      const green=await source(8,8,ctx=>{ctx.fillStyle='#0f0';ctx.fillRect(0,0,8,8);});
      const layered=createEmptyWorkspaceDocument(),full={x:0,y:0,w:25.4,h:25.4};
      layered.manga.image_assets=[red,blue,green];layered.manga.pages[0].canvas={w:25.4,h:25.4,unit:'mm'};
      layered.manga.pages[0].panels=[{id:1,shape:{type:'rect',...full},bg:0,action:null,bubbles:[{text:'文字',shape:'square',bbox:{x:4,y:4,w:16,h:16}}],
        images:[{...createFrameArtwork(red,full),generationScope:'panel'},{...createFrameArtwork(green,{x:11,y:11,w:2,h:2}),bubbleOriginal:{sourceRegionId:'export-fixture',name:'検証原本'}}]}];
      const capture=async()=>{const c=await captureQwenCompositionCanvas(layered.manga,0,0,'page',undefined,{width:600,height:600,includeGenerated:true});canvases.push(c);return c;};
      const pixel=(c:HTMLCanvasElement,x:number,y:number)=>c.getContext('2d')!.getImageData(Math.round(x/25.4*600),Math.round(y/25.4*600),1,1).data;
      let composite=await capture(),p=pixel(composite,8,8);
      check(p[0]===255&&p[1]===0&&p[2]===0,'コマ生成画像は編集可能な吹き出し・文字より上');
      layered.manga.pages[0].images=[{...createFrameArtwork(blue,full),generationScope:'page'}];
      composite=await capture();p=pixel(composite,8,8);
      check(p[0]===0&&p[1]===0&&p[2]===255,'ページ生成画像はコマ生成画像より上');
      p=pixel(composite,12,12);check(p[0]===0&&p[1]===255&&p[2]===0,'原本切り出しは生成画像より上');
      const compact=await captureQwenComposition(layered.manga,0,0,'page');
      check(compact.startsWith('data:image/png;base64,'),'生成入力の既存PNG経路を維持');
      layered.manga.pages[0].images=[];layered.manga.pages[0].panels=[];
      layered.manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',screen_text:[{text:'TEST',orientation:'horizontal',text_style:{fontSize:12},bbox:{x:2,y:2,w:20,h:15}}]};
      composite=await capture();const pixels=composite.getContext('2d')!.getImageData(0,0,600,600).data;
      check(pixels.some((v,i)=>i%4===0&&v<100&&pixels[i+3]===255),'ページ前景の通常文字も書き出す');
      setSummary(`画像書き出し画素検証 PASS (${checks.length})\n${checks.join('\n')}`);setError('');
    }catch(cause){setError(String(cause));setSummary(`画像書き出し画素検証 FAIL\n${checks.join('\n')}`);}
    finally{await deleteFigureCropAssets(stored);canvases.forEach(c=>{c.width=c.height=1;});}
  };
  const noChange=()=>{};
  const currentPanel=doc.manga.pages[0].panels[0];
  return <main style="padding:24px;max-width:1000px;margin:auto"><h1>3Dポーズから生成までの検証</h1><p>実際のポーズ素材を使用。生成APIは模擬応答で、作品・生成履歴・稼働サービスを変更しません。</p>
    <button onClick={()=>void verifyPosePresets().then(setPresetReport,error=>setPresetReport(error instanceof Error?error.stack??error.message:String(error)))}>登録ポーズの切替を検証</button><output id="pose-preset-report">{presetReport}</output>
    <button onClick={()=>void verifyFemaleBody().then(setBodyReport,error=>setBodyReport(error instanceof Error?error.stack??error.message:String(error)))}>女性モデルを検証</button><output id="body-model-report" style="white-space:pre-wrap;display:block">{bodyReport}</output>
    <button onClick={()=>void compare()}>切り取り比較を描画</button>
    <button onClick={()=>void verifyExport()}>画像書き出しの画素を検証</button>
    <button onClick={()=>{const next=parseMangaYaml(toStoredMangaYaml(doc));if(JSON.stringify(next.manga.pages[0].panels[0].figures![0].human_pose)!==JSON.stringify(figure.human_pose))throw new Error('保存値が変わりました');setDoc(next);setSummary('OMNY保存と再読込でポーズ・撮影範囲・編集文を保持');}}>保存して再読込</button>
    <div aria-label="人物設定の撮影範囲"><label>撮影範囲</label><FigureSizePicker value={figure.size??'bust-up'} onChange={size=>{const next=structuredClone(doc);next.manga.pages[0].panels[0].figures![0].size=size;setDoc(next);}}/></div>
    <FigureHumanPoseEditor value={figure.human_pose} aspect={.5} framingSize={figure.size} framingLabel={FIGURE_SIZE_LABELS[figure.size!]} cutFrame={humanPosePanelCutFrame(currentPanel,figure.bbox!)} panelContext={{panel:currentPanel,selectedIndex:0,assets:doc.manga.image_assets??[],dpi:100}}
      onChange={(value,confirmedFramingSize)=>{const next=structuredClone(doc),figure=next.manga.pages[0].panels[0].figures![0];figure.human_pose=value;if(confirmedFramingSize)figure.size=confirmedFramingSize;setDoc(next);}}/>
    <div style="height:500px;display:grid;grid-template-rows:minmax(0,1fr);position:relative;border:1px solid #aaa;margin:12px 0;">
      <MangaCanvas title="生成対象の検証" author="" page={doc.manga.pages[0]} pageCount={1} zoomPercent={null} onZoomPercentChange={noChange}
        activePanel={active} selectedPanels={[active]} selectedElement={selection} showGuides={true} innerFrameSnap={false} panelGapSnap={false} panelSync={false}
        panelGutters={{rowGapMm:5,columnGapMm:3}} frameLineWidthMm={.6} bubbleLineWidthMm={.3} defaultBubbleFont={doc.manga.meta.font}
        guideVisible={()=>true} onToggleGuide={noChange} onGenerateComposition={(scope,index)=>void openComposition(scope,index)}
        onGenerateArtwork={(key,index)=>{try{const owner=paintScene(doc.manga.pages[0].panels[index],100,[]).owners.find(owner=>owner.key===key)!;setPlan(buildQwenGenerationPlan(doc.manga,0,index,false,owner));setError('');}catch(cause){setError(String(cause));}}}
        onSelectPanel={setActive} onSelectElement={setSelection} onChangeElementBBox={noChange} onChangeBubbleTail={noChange} onMovePanel={noChange}
        onResizePanel={noChange} onMoveVertex={noChange} onMovePanelEdge={noChange}/>
    </div>
    <button onClick={()=>{try{setPlan(buildQwenGenerationPlan(doc.manga,0,0,false,paintScene(doc.manga.pages[0].panels[0],100,[]).owners[1]));setError('');}catch(cause){setError(String(cause));}}}>生成画面を開く</button>
    <pre aria-label="検証結果" style="white-space:pre-wrap">{summary}</pre>{error&&<p role="alert">{error}</p>}
    <div style="display:flex;flex-wrap:wrap;gap:12px">{shots.map(shot=><figure style="width:180px"><img src={shot.image} alt={shot.label} style="width:100%;background:#ddd"/><figcaption>{shot.label}</figcaption></figure>)}</div>
    {plan&&<QwenGenerationDialog plan={plan} onClose={()=>setPlan(null)} onInsert={async()=>{setSummary('模擬生成画像を差し込み');setPlan(null);}}/>}
  </main>;
}
render(<Fixture/>,document.getElementById('test-root')!);
