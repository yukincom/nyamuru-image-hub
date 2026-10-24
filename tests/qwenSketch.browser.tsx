/** Browser integration fixture: synthetic images and in-memory APIs only. */
import { render } from 'preact';
import { useState } from 'preact/hooks';
import QwenGenerationDialog, { qwenInputImage, qwenLayerImage } from '../src/components/QwenGenerationDialog';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { paintScene } from '../src/lib/paintDocument';
import { buildQwenGenerationPlan, qwenLayerCandidates, QWEN_GENERATION_PROFILE } from '../src/lib/qwenGeneration';
import { imageSha256, prepareImageAsset } from '../src/lib/imagePlacement';
import { decodePaintImage } from '../src/lib/paintRenderer';
import type { PaintLayer } from '../src/types';
import '../src/styles/global.css';

const canvas=document.createElement('canvas');canvas.width=320;canvas.height=224;
const ctx=canvas.getContext('2d')!;
const png=()=>new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
ctx.fillStyle='white';ctx.fillRect(0,0,320,224);ctx.strokeStyle='black';ctx.lineWidth=4;
ctx.beginPath();ctx.arc(95,72,27,0,Math.PI*2);ctx.moveTo(95,100);ctx.lineTo(135,165);ctx.lineTo(250,165);ctx.moveTo(115,126);ctx.lineTo(190,95);ctx.stroke();
const sketchBlob=await png(),sketch=canvas.toDataURL('image/png');
const roughAsset=await prepareImageAsset(new File([sketchBlob],'rough.png',{type:'image/png'}));
ctx.clearRect(0,0,320,224);ctx.fillStyle='#101010';ctx.fillRect(70,30,60,80);ctx.fillStyle='white';ctx.fillRect(72,110,58,70);ctx.strokeRect(72,110,58,70);
const image=canvas.toDataURL('image/png'),blob=await png(),digest=await imageSha256(blob),assetId=`image-${digest}`;
const {manga}=createEmptyWorkspaceDocument();manga.meta.series_id='sketch-fixture';manga.meta.episode_id='episode';manga.meta.format='モノクロ漫画';
manga.characters=[{localId:'person',name:'確認用の人物',catalog_id:'catalog',role:'',scope:'series'}];
manga.materials=[{type:'character',key:'全身のキャラ資料',characterId:'person',source_image:{asset_id:assetId} } as typeof manga.materials[number]];
manga.pages[0].panels=[{id:1,shape:{type:'rect',x:0,y:0,w:90,h:150},bg:0,action:null,bubbles:[],figures:[{name:'確認用の人物',refId:'person',bbox:{x:0,y:0,w:25,h:50},size:'full',action:'目線はつま先に向ける。険しい表情、冷や汗',analogImport:{schemaVersion:1,sourceRegionId:'synthetic',assetId:'unused',sourceBBox:{x:0,y:0,w:1,h:1},detectionSource:'body',draft:true}}]}];
const owner=paintScene(manga.pages[0].panels[0],100,[]).owners[1];
const base:PaintLayer={id:'rough',name:'人物ラフ',visible:false,locked:true,opacity:1,blend:'normal',strokes:[],guide:true,
 image:{assetId:roughAsset.id,crop:{x:0,y:0,w:320,h:224},bbox:{x:0,y:0,w:320,h:224}},
 generationMask:{enabled:true,strokes:[{tool:'rectangle',color:'#ff0000',size:10,points:[{x:180,y:80,pressure:.5,time:0},{x:220,y:120,pressure:.5,time:1}]}]}};
owner.paint={...owner.paint,width:320,height:224,referenceFrame:{x:0,y:0,w:320,h:224},layers:[base,
 {...base,id:'mask',name:'修正の書き込み',guide:false,image:undefined},
 {...base,id:'empty',name:'空のレイヤー',guide:false,image:undefined,generationMask:undefined}]};
const plan=buildQwenGenerationPlan(manga,0,0,false,owner),before=JSON.stringify(owner);
const borrowed=await decodePaintImage(sketchBlob),borrowedSrc=borrowed.src,live=new Map([[roughAsset.id,borrowed]]);
const layerImage=async(id:string,correction:boolean)=>(await qwenInputImage(await qwenLayerImage(owner,id,[roughAsset],live,correction))).image;
const clean=await layerImage('rough',false),marked=await layerImage('rough',true),mask=await layerImage('mask',true);
if(clean!==sketch||marked===clean||mask===marked||borrowed.src!==borrowedSrc||JSON.stringify(owner)!==before)throw new Error('レイヤー分離・マーカー・借用画像・原本保持の検証に失敗');
try{await layerImage('different-owner-layer',false);throw new Error('対象外レイヤーを許可しました');}catch(error){if(!String(error).includes('このフォルダ'))throw error;}
const native=structuredClone(owner);delete native.figure!.analogImport;native.paint.layers=[{...base,image:undefined,generationMask:undefined}];
await qwenLayerImage(native,'rough',[]); // Virtual guide uses the existing materialization path.
let jobId='',lastPayload:Record<string,unknown>={},requests:string[]=[],report=()=>{};
const supervisor={service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1};
const bridge={service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3};
const job=(status:string)=>({profile:QWEN_GENERATION_PROFILE,job_id:jobId,status,request_sha256:'a'.repeat(64),label:plan.label,width:320,height:224,
 document_key:plan.documentKey,page_number:1,panel_id:1,overlay:false,owner_key:'figure-0',created_at:1,file_name:`qwen_${jobId}.png`,
 ...(status==='succeeded'?{image,image_sha256:digest}:{})});
window.fetch=async(input,options)=>{
 const url=new URL(String(input),location.href),body=options?.body?JSON.parse(String(options.body)):{};
 requests.push(url.pathname);report();
 if(url.pathname==='/api/health')return Response.json(bridge);
 if(url.pathname==='/api/new-creation/start')return Response.json({...supervisor,lease_token:'fixture'});
 if(url.pathname==='/api/new-creation/stop')return Response.json({...supervisor,released:true,llm_released:true});
 if(url.pathname==='/api/panel-actions/prepare')return Response.json(supervisor);
 if(url.pathname==='/api/image-generation/prepare')return Response.json({...supervisor,llm_stopped:true});
 if(url.pathname==='/api/series/character-images/load')return Response.json({...bridge,...body,found:true,image});
 if(url.pathname==='/api/qwen-generation/prepare'){
   lastPayload=body;jobId=body.job_id;report();
   if(body.mode==='sketch'&&(body.sketch_image!==sketch||body.correction_image))throw new Error('ラフ単独入力が変わりました');
   if(body.paint_image&&body.paint_image!==clean)throw new Error('参照画像にマーカーが混入しました');
   if(body.correction_image&&![marked,mask].includes(body.correction_image))throw new Error('修正画像が失われました');
   if(body.references.length!==1||body.references[0].character_keys[0]!=='person')throw new Error('キャラ資料の対応が変わりました');
   return Response.json({...bridge,...job('prepared')});
 }
 if(url.pathname==='/api/image-generation/submit')return Response.json({...supervisor,...job('succeeded')});
 throw new Error(`Unexpected fixture request: ${url.pathname}`);
};
function Fixture(){
 const [open,setOpen]=useState(false),[summary,setSummary]=useState('描画チェック成功：単一レイヤー・マーカー分離・原本保持・仮想あたり'),[inserted,setInserted]=useState(false),[session,setSession]=useState(0);
 report=()=>setSummary(JSON.stringify({mode:lastPayload.mode,reference:Boolean(lastPayload.sketch_image||lastPayload.paint_image),correction:Boolean(lastPayload.correction_image),characterRefs:(lastPayload.references as unknown[]|undefined)?.length,prompt:lastPayload.prompt,requests},null,2));
 return <main style="padding:24px"><h1>レイヤー選択からQwen生成の検証</h1><p>合成画像のみ。モデル・作品保存・稼働サービスへのアクセスなし。</p>
   <button onClick={()=>{setSession(value=>value+1);setOpen(true);}}>生成画面を開く</button>
   <pre aria-label="検証結果">{summary}</pre>
   {inserted&&<section class="qwen-result"><p>差し込み済み・透過PNGのSHA一致</p><img src={image} alt="差し込み後の透過画像"/></section>}
   {open&&<QwenGenerationDialog key={session} plan={plan} layers={qwenLayerCandidates(owner)} loadLayer={layerImage} onClose={()=>setOpen(false)} onInsert={async file=>{
     if(await imageSha256(file)!==digest)throw new Error('差し込みでPNGが変更されました');
     setInserted(true);setOpen(false);
   }}/>}
 </main>;
}
render(<Fixture/>,document.getElementById('test-root')!);
