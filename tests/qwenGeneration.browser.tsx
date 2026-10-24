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
import { QWEN_GENERATION_PROFILE, type QwenGenerationPlan } from '../src/lib/qwenGeneration';
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
window.fetch=async(input,options)=>{
  const url=new URL(String(input),location.href),body=options?.body?JSON.parse(String(options.body)):{};
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
render(<Fixture/>,document.getElementById('test-root')!);
