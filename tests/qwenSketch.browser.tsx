/** Browser integration fixture: synthetic images and in-memory APIs only. */
import { render } from 'preact';
import { useState } from 'preact/hooks';
import QwenGenerationDialog, { qwenInputImage, qwenLayerImage } from '../src/components/QwenGenerationDialog';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { paintScene, insertGeneratedPaintImage } from '../src/lib/paintDocument';
import { buildQwenGenerationPlan, qwenLayerCandidates, QWEN_GENERATION_PROFILE } from '../src/lib/qwenGeneration';
import { imageSha256, prepareImageAsset } from '../src/lib/imagePlacement';
import { decodePaintImage, generationMaskBounds } from '../src/lib/paintRenderer';
import type { BBox, PaintLayer, PaintDocument } from '../src/types';
import { GENERATION_PREFERENCES_STORAGE_KEY, DEFAULT_GENERATION_PREFERENCES, saveGenerationPreferences } from '../src/lib/generationPreferences';
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
async function checkGenerationArea(){
 let checks=0;
 const check=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);checks++;};
 const fill=(x:number,y:number,w:number,h:number,tool:'fill'|'clear'='fill')=>({tool,color:'#ff0000',size:1,points:[{x,y,pressure:.5,time:0}],selection:[{x,y,w,h}]});
 const marker:PaintLayer={...base,id:'area',name:'文字の範囲',visible:true,guide:false,image:undefined,strokes:[],antialias:0,clip:{x:40,y:30,w:120,h:110},generationMask:{enabled:true,strokes:[fill(20,40,160,60),fill(40,40,30,60,'clear')]}};
 const paint:PaintDocument={...owner.paint,layers:[marker]},before=JSON.stringify(paint);
 const area=generationMaskBounds(paint)!;
 check(JSON.stringify(area)===JSON.stringify({x:70,y:40,w:90,h:60}),'消去とclipを反映した実画素範囲');
 for(const layer of [{...marker,visible:false},{...marker,opacity:0},{...marker,generationMask:{...marker.generationMask!,enabled:false}}])
  check(generationMaskBounds({...paint,layers:[layer]})===undefined,'非表示・無効・濃度0のマスクを使わない');
 check(generationMaskBounds({...paint,layers:[{...marker,folderId:'hidden'}],folders:[{id:'hidden',name:'非表示',position:0,visible:false}]})===undefined,'親フォルダーの目を尊重');
 check(generationMaskBounds({...paint,layers:[{...marker,generationMask:{enabled:true,strokes:[...marker.generationMask!.strokes,fill(0,0,320,224,'clear')]}}]})===undefined,'すべて消した範囲は未指定');
 const cropped=await qwenInputImage(sketchBlob,area);
 check(cropped.width===90&&cropped.height===60,'参照画像も同じ範囲へ切出し');
 const expected=document.createElement('canvas');expected.width=90;expected.height=60;
 expected.getContext('2d')!.drawImage(borrowed,70,40,90,60,0,0,90,60);
 check(cropped.image===expected.toDataURL('image/png'),'切出し画素一致');
 check((await qwenInputImage(sketchBlob)).image===clean,'修正用はキャンバス全体を保持');
 check(JSON.stringify(paint)===before&&borrowed.src===borrowedSrc,'元マスクと借用画像を保持');
 return `${checks}項目成功：範囲・消去・clip・目・濃度・参照画像の切り出し・原本保持`;
}
let jobId='',lastPayload:Record<string,unknown>={},requests:string[]=[],report=()=>{};
const supervisor={service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1};
const bridge={service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3};
const job=(status:string)=>({profile:QWEN_GENERATION_PROFILE,job_id:jobId,status,request_sha256:'a'.repeat(64),label:plan.label,width:320,height:224,
 document_key:plan.documentKey,page_number:1,panel_id:1,overlay:false,owner_key:lastPayload.owner_key??'figure-0',created_at:1,file_name:`qwen_${jobId}.png`,
 ...(status==='succeeded'?{image,image_sha256:digest}:{})});
window.fetch=async(input,options)=>{
 const url=new URL(String(input),location.href),body=options?.body?JSON.parse(String(options.body)):{};
 const apiPath=url.pathname.replace(/^\/__nyamuru\/(?:supervisor|bridge)/,'');
 requests.push(apiPath);report();
 if(apiPath==='/api/health')return Response.json(bridge);
 if(apiPath==='/api/new-creation/start')return Response.json({...supervisor,lease_token:'fixture'});
 if(apiPath==='/api/new-creation/stop')return Response.json({...supervisor,released:true,llm_released:true});
 if(apiPath==='/api/panel-actions/prepare')return Response.json(supervisor);
 if(apiPath==='/api/image-generation/prepare')return Response.json({...supervisor,llm_stopped:true});
 if(apiPath==='/api/series/character-images/load')return Response.json({...bridge,...body,found:true,image});
 if(apiPath==='/api/qwen-generation/prepare'){
   lastPayload=body;jobId=body.job_id;report();
   if(body.content_kind!=='handwritten'){
   if(body.mode==='sketch'&&(body.sketch_image!==sketch||body.correction_image))throw new Error('ラフ単独入力が変わりました');
   if(body.paint_image&&body.paint_image!==clean)throw new Error('参照画像にマーカーが混入しました');
   if(body.correction_image&&![marked,mask].includes(body.correction_image))throw new Error('修正画像が失われました');
   if(body.references.length!==1||body.references[0].character_keys[0]!=='person')throw new Error('キャラ資料の対応が変わりました');
   }
   return Response.json({...bridge,...job('prepared')});
 }
 if(apiPath==='/api/image-generation/submit')return Response.json({...supervisor,...job('succeeded')});
 throw new Error(`Unexpected fixture request: ${url.pathname}`);
};
async function checkLetteringDialog(){
 let checks=0;const check=(condition:boolean,label:string)=>{if(!condition)throw new Error(label);checks++;};
 const settle=async()=>{for(let i=0;i<4;i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));};
 const wait=async(test:()=>boolean,label:string)=>{for(let i=0;i<300&&!test();i++)await settle();check(test(),label);};
 const source=structuredClone(manga);source.pages[0].panels[0].bubbles=[{text:'かぁぁ',shape:'handwritten',speakerId:'person',bbox:{x:10,y:20,w:80,h:56}}];
 const letterOwner=paintScene(source.pages[0].panels[0],100,[]).owners.find(owner=>owner.kind==='bubble')!;
 const area:BBox={x:70,y:40,w:90,h:60},frame:BBox={x:27.5,y:30,w:22.5,h:15};
 letterOwner.paint={...letterOwner.paint,width:320,height:224,layers:[{...base,visible:true,guide:false,generationMask:undefined},
  {...base,id:'marker',name:'範囲マスク',visible:true,guide:false,image:undefined,antialias:0,generationMask:{enabled:true,strokes:[{tool:'fill',color:'#ff0000',size:1,points:[{x:70,y:40,pressure:.5,time:0}],selection:[area]}]}}]};
 const captured=JSON.stringify(letterOwner),letterPlan=buildQwenGenerationPlan(source,0,0,false,letterOwner,undefined,generationMaskBounds(letterOwner.paint));
 const host=document.createElement('div');document.body.append(host);
 const setting=localStorage.getItem(GENERATION_PREFERENCES_STORAGE_KEY);
 const anchorClick=HTMLAnchorElement.prototype.click,inputClick=HTMLInputElement.prototype.click;
 let downloads=0;
 HTMLAnchorElement.prototype.click=function(){if(this.download.startsWith('generation-'))downloads++;else anchorClick.call(this);};
 HTMLInputElement.prototype.click=function(){if(this.type==='file'&&this.hidden){const transfer=new DataTransfer();transfer.items.add(new File([blob],'result.png',{type:'image/png'}));this.files=transfer.files;this.dispatchEvent(new Event('change'));}else inputClick.call(this);};
 try{
  for(const cloud of [false,true])for(const repair of [false,true]){
   saveGenerationPreferences(localStorage,{...DEFAULT_GENERATION_PREFERENCES,execution:cloud?'cloud':'local'});
   let inserted:{file:File;target:typeof letterPlan}|undefined;
   render(<QwenGenerationDialog plan={letterPlan} layers={qwenLayerCandidates(letterOwner)}
    loadLayer={async(id,correction,crop)=>(await qwenInputImage(await qwenLayerImage(letterOwner,id,[roughAsset],live,correction),crop)).image}
    onClose={()=>{}} onInsert={async(file,target)=>{inserted={file,target};}}/>,host);await settle();
   const dialog=()=>document.querySelector<HTMLElement>('.qwen-generation-dialog')!;
   const button=(name:string)=>{const buttons=[...dialog().querySelectorAll<HTMLButtonElement>('button')],found=buttons.find(button=>button.textContent?.trim()===name);if(!found)throw new Error(`検証操作のボタンがありません：${name} / ${buttons.map(button=>button.textContent?.trim()).join(',')}`);return found;};
   const select=async(label:string,value:string)=>{const select=dialog().querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));await settle();await wait(()=>!button('閉じる').disabled,'選択完了');};
   await select('参照画像','rough');
   check(dialog().querySelector<HTMLImageElement>('.qwen-layer-input img')!.naturalWidth===90,'新規生成の参照はマスク範囲');
   await select('ピンポイント修正用','marker');
   check(dialog().querySelector<HTMLImageElement>('.qwen-layer-input img')!.naturalWidth===320,'修正への切替で参照画像も全体へ戻す');
   if(!repair){await select('ピンポイント修正用','');check(dialog().querySelector<HTMLImageElement>('.qwen-layer-input img')!.naturalWidth===90,'修正解除で参照画像を再切出し');}
   check(dialog().querySelector('output')!.textContent!.includes(`幅${repair?320:90} × 高さ${repair?224:60} px`),'表示寸法も選択に追従');
   button(cloud?'指示と参照画像を書き出す':'Qwenで実行').click();await settle();
   await wait(()=>!button('閉じる').disabled&&(cloud?downloads>Number(repair):!!dialog().querySelector('.qwen-result img')),'模擬生成完了');
   if(cloud){await select('ピンポイント修正用',repair?'':'marker');button('生成画像を読み込む').click();}
   else{
    check(lastPayload.width===(repair?320:90)&&lastPayload.height===(repair?224:60),'APIの寸法一致');
    check(JSON.stringify(lastPayload.literal_text)===JSON.stringify(['かぁぁ']),'選択文字1件だけを送信');
    check(String(lastPayload.prompt).includes(`幅${repair?320:90} × 高さ${repair?224:60} px`),'送信指示に寸法を含む');
    button('新規レイヤーとして追加').click();
   }
   await wait(()=>!!inserted,'差し込み先へ到達');
   const result=inserted!,bitmap=await createImageBitmap(result.file);
   check(bitmap.width===(repair?320:90)&&bitmap.height===(repair?224:60),'納品画像を指定pixel寸法で配置');bitmap.close();
   check(JSON.stringify(result.target.outputFrame)===JSON.stringify(repair?letterOwner.frame:frame),'生成時の配置枠を保持');
   const asset=await prepareImageAsset(result.file),added=insertGeneratedPaintImage(letterOwner,asset,'生成文字',result.target.outputFrame);
   check(JSON.stringify(added.layer.image!.bbox)===JSON.stringify(repair?{x:0,y:0,w:320,h:224}:area),'既存の追加経路でマスク矩形へ配置');
   check(JSON.stringify(letterOwner)===captured,'マスクと元レイヤーを保持');
   render(null,host);await settle();
  }
 }finally{render(null,host);host.remove();HTMLAnchorElement.prototype.click=anchorClick;HTMLInputElement.prototype.click=inputClick;if(setting===null)localStorage.removeItem(GENERATION_PREFERENCES_STORAGE_KEY);else localStorage.setItem(GENERATION_PREFERENCES_STORAGE_KEY,setting);}
 return `${checks}項目成功：新規/修正の参照・寸法・送信・配置、クラウド出力後の範囲変更と読み込み`;
}
function Fixture(){
 const [areaReport,setAreaReport]=useState('未実行'),[dialogReport,setDialogReport]=useState('未実行');
 const [open,setOpen]=useState(false),[summary,setSummary]=useState('描画チェック成功：単一レイヤー・マーカー分離・原本保持・仮想あたり'),[inserted,setInserted]=useState(false),[session,setSession]=useState(0);
 report=()=>setSummary(JSON.stringify({mode:lastPayload.mode,reference:Boolean(lastPayload.sketch_image||lastPayload.paint_image),correction:Boolean(lastPayload.correction_image),characterRefs:(lastPayload.references as unknown[]|undefined)?.length,prompt:lastPayload.prompt,requests},null,2));
 return <main style="padding:24px"><h1>レイヤー選択からQwen生成の検証</h1><p>合成画像のみ。モデル・作品保存・稼働サービスへのアクセスなし。</p>
   <button onClick={()=>void checkGenerationArea().then(setAreaReport,error=>setAreaReport(String(error)))}>生成範囲の画素を検証</button><output id="area-report">{areaReport}</output>
   <button onClick={()=>void checkLetteringDialog().then(setDialogReport,error=>setDialogReport(error instanceof Error?error.stack??error.message:String(error)))}>描き文字の範囲切替を検証</button><output id="lettering-dialog-report">{dialogReport}</output>
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
