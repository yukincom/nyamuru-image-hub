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
import { confirmHumanPoseCameraPrompt } from '../src/lib/humanPoseScene';
import { selectHumanPose } from '../src/lib/humanPoseSelection';
import { FIGURE_SIZE_LABELS, parseMangaYaml, toStoredMangaYaml } from '../src/lib/manga';
import { imageSha256, prepareImageAsset, createFrameArtwork } from '../src/lib/imagePlacement';
import { saveFigureCropAssets, deleteFigureCropAssets } from '../src/lib/figureCropStore';
import {panelBounds} from '../src/lib/canvasGeometry';
import type { FigureSize, ImageAsset, BBox } from '../src/types';
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
  if(path==='/api/human-pose/scene')return Response.json({...bridge,...fixture.scene});
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
function Fixture(){
  const [active,setActive]=useState(0),[selection,setSelection]=useState<any>(null);
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
