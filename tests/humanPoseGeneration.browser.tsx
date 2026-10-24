/** Actual installed skeleton + renderer; synthetic character sheet and in-memory generation APIs. */
import { render } from 'preact';
import { useState } from 'preact/hooks';
import FigureHumanPoseEditor from '../src/components/FigureHumanPoseEditor';
import QwenGenerationDialog from '../src/components/QwenGenerationDialog';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { paintScene } from '../src/lib/paintDocument';
import { buildQwenGenerationPlan, QWEN_GENERATION_PROFILE, type QwenGenerationPlan } from '../src/lib/qwenGeneration';
import { decodeHumanPoseScene } from '../src/lib/humanPoseSceneAssets';
import { HumanPoseSceneRenderer } from '../src/lib/humanPoseSceneRenderer';
import { confirmHumanPoseCameraPrompt } from '../src/lib/humanPoseScene';
import { selectHumanPose } from '../src/lib/humanPoseSelection';
import { FIGURE_SIZE_LABELS, parseMangaYaml, toStoredMangaYaml } from '../src/lib/manga';
import { imageSha256 } from '../src/lib/imagePlacement';
import type { FigureSize } from '../src/types';
import '../src/styles/global.css';

const fixture = await (await fetch('/pose-fixture')).json();
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
initial.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:0,y:0,w:90,h:150},bg:0,action:null,bubbles:[],figures:[{name:'検証用人物',refId:'person',size:'bust-up',action:'驚いた表情で左を見る',bbox:{x:0,y:0,w:40,h:80}}]}];
const supervisor={service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1},bridge={service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3};
let lastPayload:Record<string,any>={},report=()=>{},requests=0;
const job=(status:string)=>({profile:QWEN_GENERATION_PROFILE,job_id:lastPayload.job_id,status,request_sha256:'a'.repeat(64),label:'検証用人物',width:512,height:1024,
  document_key:lastPayload.document_key,page_number:1,panel_id:1,overlay:false,owner_key:lastPayload.owner_key,created_at:Date.now(),
  ...(status==='succeeded'?{file_name:`qwen_${lastPayload.job_id}.png`,image,image_sha256:digest}:{})});
window.fetch=async(input,options)=>{
  const path=new URL(String(input),location.href).pathname,body=options?.body?JSON.parse(String(options.body)):{};
  if(path==='/api/health')return Response.json(bridge);
  if(path==='/api/new-creation/start')return Response.json({...supervisor,lease_token:'fixture'});
  if(path==='/api/new-creation/stop')return Response.json({...supervisor,released:true,llm_released:true});
  if(path==='/api/panel-actions/prepare')return Response.json(supervisor);
  if(path==='/api/image-generation/prepare')return Response.json({...supervisor,llm_stopped:true});
  if(path==='/api/human-pose/catalog')return Response.json({...bridge,...fixture.catalog});
  if(path==='/api/human-pose/scene')return Response.json({...bridge,...fixture.scene});
  if(path==='/api/series/character-images/load')return Response.json({...bridge,...body,found:true,image});
  if(path==='/api/qwen-generation/prepare'){
    lastPayload=body;requests++;report();
    const sentPose=body.references.find((r:{label:string})=>r.label.startsWith('3Dポーズ参照'));
    const preview=document.querySelector<HTMLImageElement>('img[alt="描写範囲に合わせた3Dポーズ参照"]');
    if(sentPose&&sentPose.image!==preview?.src)throw new Error('プレビューと送信画像が異なります');
    if(!body.references.some((r:{character_keys:string[]})=>r.character_keys.includes(body.character_keys[0])))throw new Error('人物資料がありません');
    if(!body.prompt.includes('驚いた表情で左を見る')||!body.prompt.includes('描写範囲は'))throw new Error('動作または描写範囲がありません');
    return Response.json({...bridge,...job('prepared')});
  }
  if(path==='/api/image-generation/submit')return Response.json({...supervisor,...job('succeeded')});
  throw new Error(`Fixture blocked unexpected request: ${path}`);
};
function Fixture(){
  const [doc,setDoc]=useState(initial),[plan,setPlan]=useState<QwenGenerationPlan|null>(null),[summary,setSummary]=useState('未実行'),[shots,setShots]=useState<Array<{label:string;image:string}>>([]),[error,setError]=useState('');
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
  return <main style="padding:24px;max-width:1000px;margin:auto"><h1>3Dポーズから生成までの検証</h1><p>実際のポーズ素材を使用。生成APIは模擬応答で、作品・生成履歴・稼働サービスを変更しません。</p>
    <button onClick={()=>void compare()}>切り取り比較を描画</button>
    <button onClick={()=>{const next=parseMangaYaml(toStoredMangaYaml(doc));if(JSON.stringify(next.manga.pages[0].panels[0].figures![0].human_pose)!==JSON.stringify(figure.human_pose))throw new Error('保存値が変わりました');setDoc(next);setSummary('OMNY保存と再読込でポーズ・撮影範囲・編集文を保持');}}>保存して再読込</button>
    <label>描写範囲<select value={figure.size} onChange={event=>{const next=structuredClone(doc);next.manga.pages[0].panels[0].figures![0].size=event.currentTarget.value as FigureSize;setDoc(next);}}>{Object.entries(FIGURE_SIZE_LABELS).map(([value,label])=><option value={value}>{label}</option>)}</select></label>
    <FigureHumanPoseEditor value={figure.human_pose} aspect={.5} framingSize={figure.size} framingLabel={FIGURE_SIZE_LABELS[figure.size!]} onChange={value=>{const next=structuredClone(doc);next.manga.pages[0].panels[0].figures![0].human_pose=value;setDoc(next);}}/>
    <button onClick={()=>{try{setPlan(buildQwenGenerationPlan(doc.manga,0,0,false,paintScene(doc.manga.pages[0].panels[0],100,[]).owners[1]));setError('');}catch(cause){setError(String(cause));}}}>生成画面を開く</button>
    <pre aria-label="検証結果" style="white-space:pre-wrap">{summary}</pre>{error&&<p role="alert">{error}</p>}
    <div style="display:flex;flex-wrap:wrap;gap:12px">{shots.map(shot=><figure style="width:180px"><img src={shot.image} alt={shot.label} style="width:100%;background:#ddd"/><figcaption>{shot.label}</figcaption></figure>)}</div>
    {plan&&<QwenGenerationDialog plan={plan} onClose={()=>setPlan(null)} onInsert={async()=>{setSummary('模擬生成画像を差し込み');setPlan(null);}}/>}
  </main>;
}
render(<Fixture/>,document.getElementById('test-root')!);
