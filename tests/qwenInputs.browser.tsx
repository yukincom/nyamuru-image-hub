// 見込み: 人物を開くだけで、その人物の原画と優先設定画がimage3/2になり、image1で3Dを確定できる。
// 合格: image2用の採用特徴が初期文と送信に残り、旧自由文は入らない。3画像の画素・順序と手動編集も確認。実UI/3D素材、HTTPは模擬、実推論なし。
import {render} from 'preact';
import {useState} from 'preact/hooks';
import QwenGenerationDialog from '../src/components/QwenGenerationDialog';
import VoiceCommands from '../src/components/VoiceCommands';
import {loadAgentPreferences} from '../src/lib/agentPreferences';
import {paintScene} from '../src/lib/paintDocument';
import {buildQwenGenerationPlan,type QwenGenerationConversation} from '../src/lib/qwenGeneration';
import {QWEN_FIGURE_WORKFLOW} from '../src/lib/comfyWorkflows';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {saveFigureCropAssets} from '../src/lib/figureCropStore';
import {createProjectSnapshot,restoreProjectSnapshot} from '../src/lib/projectPersistence';
import {imageSha256} from '../src/lib/imagePlacement';
import {characterImageCacheId} from '../src/lib/browserCatalog';
import graph from '../examples/comfyui/nyamuru_qwen_turbo_3images.api.json';
import binding from '../examples/comfyui/nyamuru_qwen_turbo_3images.binding.json';
import '../src/styles/global.css';
const report=document.querySelector('output')!;
async function run(){
 if(location.origin!=='http://127.0.0.1:4344')throw Error('専用の検証画面で実行してください');
 const nativeFetch=window.fetch.bind(window),fixture=await (await nativeFetch('/pose-fixture')).json();
 const mk=async(color:string,width=64)=>{const c=document.createElement('canvas');c.width=width;c.height=64;const g=c.getContext('2d')!;g.fillStyle=color;g.fillRect(0,0,c.width,c.height);return await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!)));};
 const rough=await mk('red'),sheet=await mk('blue',2101),hash=await imageSha256(sheet),id='image-'+hash;
 const work=createEmptyWorkspaceDocument(),m=work.manga; m.meta.series_id='fixture';m.meta.episode_id='test';
 m.characters=[{
   localId:'who',catalog_id:'catalog',name:'テスト人物',role:'主人公',scope:'series',primary_material_catalog_id:'primary',
   visual_prompt:'obsolete visual prompt',
   recognition:{
     hair:{observed:[],inferred:[]},face:{observed:[],inferred:[]},silhouette:{observed:[],inferred:[]},ambiguous_design:{observed:[],inferred:[]},
     accessories:{observed:['wide solid black headband'],inferred:[]},
     outfit:{observed:['white sleeveless V-neck dress'],inferred:[]},
   },
 }];
 const mat={keywords:[],type:'character' as const,scope:'series' as const,key:'青い設定画',catalog_id:'primary',characterId:'who',character_catalog_id:'catalog',source_image:{schema_version:1 as const,asset_id:id,file_name:'characters/catalog/'+id+'.png',media_type:'image/png' as const,byte_size:sheet.size,width_px:2101,height_px:64,sha256:hash}};
 m.materials=[{...mat,catalog_id:'other',key:'非優先',source_image:{...mat.source_image,asset_id:'unavailable'}},mat];
 m.pages[0].panels=[{id:1,shape:{type:'rect',x:1,y:1,w:25,h:40},bg:0,action:null,bubbles:[],figures:[{refId:'who',name:'テスト人物',size:'full',bbox:{x:4,y:4,w:12,h:25},analogImport:{schemaVersion:1,assetId:'rough',sourceRegionId:'r',sourceBBox:{x:0,y:0,w:64,h:64},detectionSource:'body',draft:true}}]}];
 await saveFigureCropAssets([{id:'rough',blob:rough},{id:characterImageCacheId('fixture','catalog',id),blob:sheet}]);
 const owner=paintScene(m.pages[0].panels[0],144,[]).owners.find(o=>o.key==='figure-0')!;
 let plan=buildQwenGenerationPlan(m,0,0,false,owner);
 const common={service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3},supervisor={service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1};
 let submitted:Record<string,any>|undefined;
 window.fetch=async(input,options)=>{
   const url=new URL(String(input),location.href),path=url.pathname,body=JSON.parse(String(options?.body||'{}'));
   if(url.origin===location.origin&&!path.startsWith('/api/'))return nativeFetch(input,options);
   if(path==='/api/image-generation/start')return Response.json({...supervisor,session_token:body.session_token,comfy_ready:true});
   if(path==='/api/image-generation/stop')return Response.json({...supervisor,comfy_released:true,comfy_stopped:true});
   if(path==='/api/image-generation/prepare')return Response.json({...supervisor,llm_stopped:true});
   if(path==='/api/new-creation/start')return Response.json({...supervisor,lease_token:'fixture'});
   if(path==='/api/new-creation/stop')return Response.json({...supervisor,released:true});
   if(path==='/api/health')return Response.json(common);
   if(path==='/api/agent/status')return Response.json({...common,connected:false});
   if(path==='/api/comfy-workflows/list')return Response.json({...common,workflows:[{id:QWEN_FIGURE_WORKFLOW,name:'nyamuru_qwen_turbo_3images',version:1,graph,binding}]});
   if(path==='/api/human-pose/catalog')return Response.json({...common,...fixture.catalog});
   if(path==='/api/human-pose/scene')return Response.json({...common,...fixture.scene});
   if(path==='/api/qwen-generation/prepare'){submitted=body;return Response.json({error:'モデル解放確認拡張がありません'},{status:400});}
   throw Error('検証対象外: '+path);
 };
 function Room(){const [conversation,setConversation]=useState<QwenGenerationConversation|null>(null),[host,setHost]=useState<HTMLElement|null>(null);
   return <><QwenGenerationDialog plan={plan} poseEditorContext={{onConfirmed:(value,size)=>{
     const figure=m.pages[0].panels[0].figures![0];figure.human_pose=value;figure.size=size;
   }}} onClose={()=>{}} onInsert={async()=>{}} onConversation={setConversation} onConversationHost={setHost}/>
     <VoiceCommands profile={loadAgentPreferences()} onChangeProfile={()=>{}} open onToggle={()=>{}} revision={()=>'fixture'} apply={()=>''} generation={conversation} portalTarget={host}/></>;}
 render(<Room/>,document.querySelector('#test-root')!);
 const wait=async<T,>(check:()=>T|null|undefined|false,label:string)=>{for(let i=0;i<300;i++){const result=check();if(result)return result;await new Promise(r=>setTimeout(r,50));}throw Error(label+' / '+(document.querySelector('[role=alert]')?.textContent||''));};
 const img=(n:number)=>document.querySelector<HTMLImageElement>(`img[alt^="image${n} "]`);
 const button=(label:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()===label&&!b.disabled);
 const third=await wait(()=>img(3),'image3'),second=await wait(()=>img(2),'image2');
 const addr=(image:HTMLImageElement)=>image.getAttribute('src');
 const color=async(image:HTMLImageElement)=>{await image.decode();const c=document.createElement('canvas');const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return Array.from(ctx.getImageData(0,0,1,1).data).join(',');};
 if(await color(third)!=='255,0,0,255'||await color(second)!=='0,0,255,255')throw Error('人物の原画と優先資料の取り違え');
 if(!document.querySelector('.agent-popup.is-generation textarea')||document.querySelector('.agent-popup input[type=file],.agent-popup select'))throw Error('会話の入力欄');
 const legends=Array.from(document.querySelectorAll('legend')).map(e=>e.textContent?.slice(0,6)).filter(x=>x?.startsWith('image'));
 if(legends.join()!=='image1,image2,image3')throw Error('表示の順序');
 report.textContent='image3・image2 自動表示、会話欄、表示順 OK';
 (await wait(()=>button('3D編集'),'3D編集の入口')).click();
 (await wait(()=>button('撮影プレビュー'),'3D編集を開く')).click();
 const preview=await wait(()=>document.querySelector<HTMLImageElement>('img[alt="image1の撮影プレビュー"]'),'不透明なプレビュー');
 await preview.decode();
 const previewPng=addr(preview);
 (await wait(()=>button('確定'),'撮影を確定')).click();
 const first=await wait(()=>img(1),'image1の3D撮影');
 await first.decode();await second.decode();
 if(addr(first)!==previewPng||second.naturalWidth!==2101||third.naturalWidth!==64)throw Error('プレビュー実体または原寸が変化');
 if(first.naturalWidth!==Math.max(1,Math.round(plan.threeImageTarget!.width*.2))||first.naturalHeight!==Math.max(1,Math.round(plan.threeImageTarget!.height*.2))||!(await color(first)).endsWith(',255'))throw Error('不透明な20%プレビュー');
 // 保存・再読込後にも、同じPNGをimage1に使えることを確認する。
 const snapshot=await createProjectSnapshot(work);
 const reopened=await restoreProjectSnapshot(snapshot);
 const figureFrame = reopened.manga.pages[0].panels[0].figures![0].bbox!;
 if(figureFrame.x!==4||figureFrame.y!==4||figureFrame.w!==12||figureFrame.h!==25)throw Error('コマ内の人物配置が変化');
 const storedOwner=paintScene(reopened.manga.pages[0].panels[0],144,[]).owners.find(o=>o.key==='figure-0')!;
 plan=buildQwenGenerationPlan(reopened.manga,0,0,false,storedOwner);
 render(null,document.querySelector('#test-root')!);
 render(<Room/>,document.querySelector('#test-root')!);
 const restored=await wait(()=>img(1),'作品を開き直したimage1');
 if(addr(restored)!==previewPng)throw Error('作品保存後のimage1が確定PNGと異なる');
 const edit=(label:string,value:string)=>{const input=Array.from(document.querySelectorAll('.qwen-prompt')).find(item=>item.textContent?.startsWith(label))?.querySelector('textarea');if(!input)throw Error(label);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
 const initialPrompt=document.querySelector<HTMLTextAreaElement>('.qwen-prompt textarea')!.value;
 if(!initialPrompt.includes('Character & Design (from <image2>):')||!initialPrompt.includes('wide solid black headband')||!initialPrompt.includes('white sleeveless V-neck dress')||initialPrompt.includes('obsolete visual prompt'))throw Error('image2の特徴が編集欄から届いていません');
 const editedPrompt=initialPrompt+'\npositive test';
 edit('ポジティブ',editedPrompt);edit('ネガティブ','negative test');
 (await wait(()=>button('5枚を生成する'),'生成ボタン')).click();
 const req=await wait(()=>submitted,'送信内容');
 if(req.prompt!==editedPrompt||req.negative_prompt!=='negative test'||req.workflow_id!==QWEN_FIGURE_WORKFLOW||req.comfyui_url!=='http://127.0.0.1:8188')throw Error('接続・正負の送信');
 if(JSON.stringify(req.references.map((x:{image:string})=>x.image))!==JSON.stringify([addr(first),addr(second),addr(third)]))throw Error('送信画像の役割');
 // 見込み: 準備で拒否されれば生成は未送信。合格: 再実行可・照合ボタンなし・原因だけを表示。HTTPは模擬。
 await wait(()=>button('5枚を生成する')&&document.querySelector('.qwen-generation-dialog [role=alert]'),'準備失敗後の再試行');
 const alert=document.querySelector('.qwen-generation-dialog [role=alert]')!.textContent;
 if(!alert?.includes('モデル解放確認拡張')||alert.includes('送信済み')||button('生成状況を確認'))throw Error('送信前に受付済みと誤表示');
 report.textContent='PASS：人物3画像の順序、3D撮影、正負入力、送信前のエラーと再試行';
}
void run().catch(error=>{report.textContent='FAIL：'+String(error);});
