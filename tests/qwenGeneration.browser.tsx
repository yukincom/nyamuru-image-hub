import graph from '../examples/comfyui/qwen-turbo-0-refs.api.json';
import binding from '../examples/comfyui/qwen-turbo-0-refs.binding.json';
import {currentGenerationPreferences,saveGenerationPreferences} from '../src/lib/generationPreferences';
const workflow={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'文字生成の模擬登録',version:1,graph,binding};
const preferences=currentGenerationPreferences();preferences.execution='local';preferences.local.workflowId=workflow.id;saveGenerationPreferences(localStorage,preferences);
/** Serve the companion HTML temporarily from public/qwen-generation-test.html.
 * All API responses are in-memory fixtures. No models, user jobs or project storage are accessed. */
import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import QwenGenerationDialog from '../src/components/QwenGenerationDialog';
import PaintEditor, { PaintLayers } from '../src/components/PaintEditor';
import { PaintOwnerPreview } from '../src/components/PaintSceneView';
import { usePaintWorkspace } from '../src/lib/paintWorkspace';
import { paintScene } from '../src/lib/paintDocument';
import type { PaintController } from '../src/lib/paintSession';
import { imageSha256 } from '../src/lib/imagePlacement';
import { QWEN_GENERATION_PROFILE, buildQwenGenerationPlan, type QwenGenerationPlan } from '../src/lib/qwenGeneration';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import '../src/styles/global.css';

const canvas=document.createElement('canvas');canvas.width=160;canvas.height=224;
const ctx=canvas.getContext('2d')!;ctx.fillStyle='#207fbd';ctx.fillRect(25,30,110,150);ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('TEST',45,100);
const image=canvas.toDataURL('image/png');
const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png'));
const digest=await imageSha256(blob);
const scene=paintScene({id:1,shape:{type:'rect',x:0,y:0,w:80,h:80},bg:0,action:null,bubbles:[],figures:[{name:'差し込み先',bbox:{x:0,y:0,w:40,h:56}}]},100,[]);
const plan:QwenGenerationPlan={profile:QWEN_GENERATION_PROFILE,documentKey:'fixture-work',pageNumber:1,panelId:1,overlay:false,ownerKey:'figure-0',label:'差し込み先',width:160,height:224,prompt:'合成画像による動作確認',characterKeys:[],candidates:[]};
const ids=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
const jobs=ids.map((id,index)=>({profile:QWEN_GENERATION_PROFILE,job_id:id,status:'succeeded',request_sha256:'a'.repeat(64),label:index?'別コマの人物':'現在の人物',width:160,height:224,
  document_key:plan.documentKey,page_number:index?2:1,panel_id:index?3:1,overlay:false,owner_key:'figure-0',created_at:index+1,file_name:`qwen_${id}.png`,image,image_sha256:digest}));
let deleted:string[]=[],deletions=0,updateSummary=()=>{};
const letteringChecks=new URLSearchParams(location.search).has('lettering-check');
if(letteringChecks&&location.origin!=='http://127.0.0.1:4341')throw Error('Dedicated lettering QA origin required');
let letteringRequest:Record<string,unknown>|undefined;
const letteringEvents:string[]=[];
let letteringJob:Record<string,unknown>={};
window.fetch=async(input,options)=>{
  const url=new URL(String(input),location.href),body=options?.body?JSON.parse(String(options.body)):{};
  url.pathname=url.pathname.replace(/^\/__nyamuru\/(?:bridge|supervisor)/,'');
  if(letteringChecks){
    const path=url.pathname;letteringEvents.push(path);
    const supervisor={service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1};
    if(path==='/api/comfy-workflows/list')return Response.json({service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3,workflows:[workflow]});
    if(path==='/api/qwen-generation/select')return Response.json({...letteringJob,service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3,status:'succeeded',selected_candidate:body.candidate_index,image,file_name:`qwen_${letteringJob.job_id}.png`});
    if(path==='/api/health')return Response.json({service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3});
    if(path==='/api/panel-actions/prepare')throw Error('Lettering must never start Gemma');
    if(path==='/api/new-creation/start')return Response.json({...supervisor,lease_token:'lettering-fixture'});
    if(path==='/api/new-creation/stop')return Response.json({...supervisor,released:true});
    if(path==='/api/image-generation/prepare')return Response.json({...supervisor,llm_stopped:true});
    if(path==='/api/qwen-generation/prepare'){
      letteringRequest=body;letteringJob={profile:QWEN_GENERATION_PROFILE,job_id:body.job_id,request_sha256:'a'.repeat(64),label:body.label,width:160,height:224,status:'prepared'};
      return Response.json({service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3,...letteringJob});
    }
    if(path==='/api/image-generation/submit')return Response.json({...supervisor,...letteringJob,status:'succeeded',candidates:Array.from({length:5},(_,i)=>({index:i+1,seed:260921+i,image})),file_name:`qwen_${letteringJob.job_id}.png`});
    throw Error(`Lettering fixture blocked unexpected request: ${path}`);
  }
  if(url.pathname.startsWith('/api/new-creation/'))return Response.json({service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1,lease_token:'fixture',released:true});
  const common={service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3};
  if(url.pathname==='/api/health')return Response.json(common);
  if(url.pathname==='/api/qwen-generation/list')return Response.json({...common,jobs:jobs.filter(job=>!deleted.includes(job.job_id)&&(body.scope==='work'||job.page_number===body.page_number&&job.panel_id===body.panel_id)).map(({image:_image,image_sha256:_sha,...job})=>job)});
  if(url.pathname==='/api/qwen-generation/reconcile')return Response.json({...common,...jobs.find(job=>job.job_id===body.job_id&&!deleted.includes(job.job_id))});
  if(url.pathname==='/api/qwen-generation/delete'){
    const selection=body.jobs.map((job:{job_id:string})=>job.job_id);deleted.push(...selection);deletions++;updateSummary();
    return Response.json({...common,document_key:plan.documentKey,deleted_job_ids:selection});
  }
  throw new Error(`Fixture blocked unexpected request: ${url.pathname}`);
};
function PaintState(){
  const state=usePaintWorkspace();
  return <><button disabled={!state?.canUndo} onClick={()=>state?.undo()}>差し込みを元に戻す</button><button disabled={!state?.canRedo} onClick={()=>state?.redo()}>差し込みをやり直す</button><output aria-label="配置された画像">{state?.scene.owners[1].paint.layers.map(layer=>layer.image?layer.name:'画像なし').join(', ')}</output></>;
}
function Fixture(){
  const controller=useRef<PaintController|null>(null),[open,setOpen]=useState(false),[ready,setReady]=useState(false),[inserted,setInserted]=useState('未差し込み'),[summary,setSummary]=useState('削除リクエスト 0件 / 残り2件');
  updateSummary=()=>setSummary(`削除リクエスト ${deletions}件 / 残り${jobs.length-deleted.length}件`);
  return <><style>{`body{padding:24px}h1{font-size:20px}.fixture-paper{position:relative;width:400px;height:560px;background:white;border:1px solid #888;margin:20px 0}.fixture-grid{display:flex;gap:30px}output{display:block;margin:12px 0}`}</style>
    <h1>生成履歴の検証（合成画像・ユーザーデータ不使用）</h1><p>現在の差し込み先：1ページ・コマ1。別の生成画像：2ページ・コマ3。</p>
    <output>{summary}</output><output>{inserted}</output><button disabled={!ready} onClick={()=>setOpen(true)}>生成画面を開く</button><button onClick={()=>{deleted=[];deletions=0;updateSummary();}}>履歴のテストデータをリセット</button>
    <PaintEditor initial={scene} initialOwner="figure-0" assets={[]} title="テスト" page={1} panelIndex={0} overlay={false} suspended={open} controller={controller} onReady={()=>setReady(true)} onApply={async()=>{}} onClose={()=>{}}>
      <PaintState/><div class="fixture-grid"><div class="fixture-paper"><PaintOwnerPreview ownerKey="figure-0" container={{x:0,y:0,w:40,h:56}} inkOnly/></div><PaintLayers/></div>
    </PaintEditor>
    {open&&<QwenGenerationDialog plan={plan} onClose={()=>setOpen(false)} onInsert={async file=>{
      if(await imageSha256(file)!==digest)throw new Error('PNG bytes changed');
      await controller.current!.insertImage(file,'figure-0');setInserted(`差し込み済み：${file.name}（元PNGとSHA一致）`);setOpen(false);
    }}/>}
  </>;
}
if(!letteringChecks)render(<Fixture/>,document.getElementById('test-root')!);
else{
  // 見込み: 既存確認画面は日本語の定型/自由入力を示し、描き文字の準備でLLMを起動しない。
  // 合格: ペン/複数表現が日本語1行、自由入力保持、生成完了までLLM APIゼロ。範囲: 実Dialog/実lifecycle＋模擬bridgeとPNG。登録1件、5候補から3番採用。英文組立/実モデルは別確認。
  const {manga}=createEmptyWorkspaceDocument();
  manga.pages[0].panels=[{id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:0,action:null,bubbles:[{text:'かぁぁ',shape:'handwritten',bbox:{x:10,y:10,w:40,h:25},lettering_pen:'fineliner-01',lettering_expressions:['freehand','energetic'],lettering_description:'細く、柔らかく'}]}];
  const owner=paintScene(manga.pages[0].panels[0],100,[]).owners.find(o=>o.kind==='bubble')!;
  const letteringPlan=buildQwenGenerationPlan(manga,0,0,false,owner);
  render(<QwenGenerationDialog plan={letteringPlan} onClose={()=>{}} onInsert={async()=>{}}/>,document.getElementById('test-root')!);
  const report=document.createElement('output');report.setAttribute('aria-label','描き文字生成の検証結果');report.style.cssText='position:fixed;bottom:8px;left:8px;z-index:99999;background:white;color:black;padding:8px;max-width:80vw';document.body.append(report);
  const tick=()=>new Promise(resolve=>setTimeout(resolve,40)),checks:string[]=[];
  const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
  const wait=async(test:()=>boolean,label:string)=>{for(let i=0;i<100&&!test();i++)await tick();if(!test())throw Error(label);};
  void (async()=>{
    await wait(()=>!!document.querySelector('.qwen-prompt textarea')&&!document.querySelector<HTMLTextAreaElement>('.qwen-prompt textarea')?.disabled,'確認画面');
    const textarea=document.querySelector<HTMLTextAreaElement>('.qwen-prompt textarea')!;
    check(textarea.value.includes('ペン：ミリペン　0.1')&&textarea.value.includes('表現：フリーハンド、いきおい'),'ペン・表現を日本語で確認');
    check(!textarea.value.includes('Lettering expression:')&&!textarea.value.includes('Lettering style:'),'英語の表現指定を表示しない');
    check(textarea.value.includes('かぁぁ')&&!textarea.value.includes('描き方：細く、柔らかく'),'本文を確認し旧描き方は表示しない');
    textarea.value+='\n\n余韻を残す';textarea.dispatchEvent(new Event('input',{bubbles:true}));await tick();
    const generate=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button=>button.textContent?.trim()==='5枚を生成する')!;
    if(!generate||generate.disabled)throw Error('生成開始ボタン');generate.click();
    await wait(()=>document.querySelectorAll('.qwen-candidate').length===5,'5候補');
    document.querySelectorAll<HTMLButtonElement>('.qwen-candidate')[2].click();await tick();
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()==='選んだ1枚を採用する')!.click();
    await wait(()=>!!document.querySelector('.qwen-result > img'),'模擬生成完了');
    check(letteringRequest?.content_kind==='handwritten'&&String(letteringRequest.prompt).includes('余韻を残す'),'追記を保持して描き文字として準備');
    check(!letteringEvents.includes('/api/panel-actions/prepare')&&letteringEvents.includes('/api/image-generation/submit'),'Gemmaを起動せず画像生成へ送る');
    await wait(()=>letteringEvents.includes('/api/new-creation/stop'),'lease解放');
    check(true,'生成後の終了処理を完了');
    report.textContent=`描き文字生成 PASS ${checks.length}：${checks.join(' / ')}`;
  })().catch(error=>{report.textContent=`描き文字生成 FAIL：${String(error)}（${checks.join(' / ')}）`;});
}
