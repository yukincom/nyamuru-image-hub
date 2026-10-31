import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { requestComfyWorkflows, cancelQwenJob, selectQwenCandidate, deleteQwenJobs, loadCharacterReferenceImage, prepareQwenJob, listQwenJobs, reconcileQwenJob, submitQwenJob } from '../lib/localBridge.ts';
import { withNewCreationBridgeSession, withImageGenerationServices } from '../lib/localBridgeLifecycle.ts';
import { canDeleteQwenJob, qwenGenerationPayload, qwenPlanForWorkflow, qwenGenerationPrompt, qwenGenerationTarget, qwenGenerationSizePrompt, qwenLayerPaint, qwenJobLocation, type QwenGenerationPlan, type QwenLayerCandidate, type QwenLayerReference, type QwenHistoryScope, type QwenReference, type QwenJob, type QwenGenerationConversation, type QwenReferenceRole, qwenConversationIntent, executeQwenGeneration } from '../lib/qwenGeneration.ts';
import { validatePaintDocument, type PaintOwner } from '../lib/paintDocument.ts';
import { decodePaintImage, loadPaintImages, renderPaintPng, type PaintImages } from '../lib/paintRenderer.ts';
import { prepareGuideLayer } from '../lib/paintGuide.ts';
import type { BBox, ImageAsset, PaintDocument } from '../types.ts';
import { currentGenerationPreferences } from '../lib/generationPreferences.ts';
import { currentLocalModelPreferences } from '../lib/localModelPreferences.ts';
import { parseComfyWorkflowList, type ComfyWorkflowDefinition } from '../lib/comfyWorkflows.ts';
import { cloudModelAccess } from '../lib/modelPrivacy.ts';
import { generationHandoff } from '../lib/generationHandoff.ts';
import { chooseBrowserFiles, downloadBrowserBlob } from '../lib/browserFiles.ts';
import {runQwenAgentRequest,type QwenAgentRequest} from '../lib/qwenGeneration.ts';

interface Props { onOpenSettings?:()=>void; plan:QwenGenerationPlan; adultContent?:boolean; agentRequest?:QwenAgentRequest; layers?:QwenLayerCandidate[]; loadLayer?:(id:string,correction:boolean,crop?:BBox)=>Promise<string>; onClose:()=>void; onInsert:(file:File,target:QwenGenerationPlan)=>Promise<void>; onConversation?:(value:QwenGenerationConversation|null)=>void; onConversationHost?:(host:HTMLElement|null)=>void }
const statusLabel={preparing:'入力を準備中',prepared:'生成準備済み',queued:'生成待ち',running:'生成中',succeeded:'生成完了',failed:'失敗',outcome_unknown:'結果未確定'};

/** Full reference sheets stay separate. Only the input copy is proportionally resized. */
export async function qwenInputImage(blob:Blob,crop?:BBox):Promise<{image:string;width:number;height:number}> {
  if(!blob.type.startsWith('image/')||blob.size>40*1024*1024)throw new Error('40MiB以内の画像を選んでください');
  const bitmap=await createImageBitmap(blob);
  try{
    const source=crop??{x:0,y:0,w:bitmap.width,h:bitmap.height};
    if(![source.x,source.y,source.w,source.h].every(Number.isFinite)||source.x<0||source.y<0||source.w<=0||source.h<=0||source.x+source.w>bitmap.width||source.y+source.h>bitmap.height)throw new Error('参照画像の切り出し範囲が不正です');
    const scale=Math.min(1,2048/Math.max(source.w,source.h));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(source.w*scale));canvas.height=Math.max(1,Math.round(source.h*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('参照画像を用意できません');
    context.drawImage(bitmap,source.x,source.y,source.w,source.h,0,0,canvas.width,canvas.height);
    return {image:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
  }finally{bitmap.close();}
}

/** Export a single captured owner layer using the editor's existing renderer. */
export async function qwenLayerImage(owner:PaintOwner,id:string,assets:ImageAsset[],liveImages?:PaintImages,includeGeneration=false):Promise<Blob> {
  let paint:PaintDocument=qwenLayerPaint(owner,id,includeGeneration);
  const owned:HTMLImageElement[]=[];
  let images=liveImages;
  try {
    for(const layer of paint.layers.filter(layer=>layer.guide&&!layer.image)){
      const prepared=await prepareGuideLayer(owner,layer);
      paint={...paint,layers:paint.layers.map(item=>item===layer?prepared.layer:item)};assets=[...assets,prepared.asset];
      images=new Map(images);
      const image=await decodePaintImage(prepared.blob);owned.push(image);images.set(prepared.asset.id,image);
    }
    validatePaintDocument(paint,assets);
    const retained=images??new Map(),loaded=await loadPaintImages([paint],assets,new Map(),retained);
    loaded.forEach((image,id)=>{if(image!==retained.get(id))owned.push(image);});images=loaded;
    return await renderPaintPng(paint,images,includeGeneration);
  } finally { owned.forEach(image=>{image.src='';}); }
}

export default function QwenGenerationDialog({onOpenSettings,plan:sourcePlan,adultContent=false,agentRequest,layers=[],loadLayer,onClose,onInsert,onConversation,onConversationHost}:Props){
  const [execution]=useState(currentGenerationPreferences);
  const cloud=execution.execution==='cloud';
  const [connection]=useState(currentLocalModelPreferences);
  const [workflow,setWorkflow]=useState<ComfyWorkflowDefinition|null>(null),[workflowError,setWorkflowError]=useState('');
  const [chromaKeyColor,setChromaKeyColor]=useState('#00FF00');
  useEffect(()=>{
    if(cloud)return;
    let current=true;
    if(!execution.local.workflowId){setWorkflowError('環境設定 → モデルで、使用するワークフローを選んでください');return;}
    requestComfyWorkflows('list').then(raw=>{
      if(!current)return;
      const selected=parseComfyWorkflowList(raw).find(item=>item.id===execution.local.workflowId);
      if(!selected)throw new Error('選択したワークフローの登録がありません。環境設定を確認してください');
      setWorkflow(selected);
    }).catch(cause=>{if(current)setWorkflowError(cause instanceof Error?cause.message:'ワークフローを読み込めません');});
    return()=>{current=false;};
  },[]);
  const threeImages=workflow?.binding.prompt_mode==='qwen-three-images';
  const plan=useMemo(()=>qwenPlanForWorkflow(sourcePlan,workflow),[sourcePlan,workflow]);
  const targetError=threeImages&&!plan.threeImages?'人物3枚参照には、3Dポーズを画像で送る人物と、対象のコマまたは生成マスクを指定してください':'';
  const waitingForWorkflow=!cloud&&!workflow;
  const figureChroma=plan.ownerKey.startsWith('figure-')&&(threeImages||workflow?.binding.prompt_mode==='qwen');
  const [referenceCharacter,setReferenceCharacter]=useState(plan.characterKeys[0]??'');
  const [reference,setReference]=useState<QwenLayerReference>(),[correction,setCorrection]=useState<QwenLayerReference>();
  const [editedPrompt,setPrompt]=useState<string>(),[references,setReferences]=useState<QwenReference[]>([]);
  const prompt=editedPrompt??plan.prompt;
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[job,setJob]=useState<QwenJob|null>(null);
  const [history,setHistory]=useState<QwenJob[]>([]),[attempt,setAttempt]=useState<string|null>(null);
  const [historyScope,setHistoryScope]=useState<QwenHistoryScope|null>(null),[selectedJobs,setSelectedJobs]=useState<string[]>([]);
  const [phase,setPhase]=useState(''),[notice,setNotice]=useState('');
  const [selectedCandidate,setSelectedCandidate]=useState<number|null>(null);
  const [poseImage,setPoseImage]=useState(''),[poseError,setPoseError]=useState(''),[poseAttempt,setPoseAttempt]=useState(0);
  const posePending=useRef<Promise<string|undefined>>();
  const usesPoseImage=plan.humanPose?.selection.input_mode==='image';
  const referenceLimit=threeImages?1:usesPoseImage?8:9;
  const submitted=useRef(false);
  const generatedTarget=useRef<{jobId?:string;plan:QwenGenerationPlan}>();
  const alive=useRef(true),working=useRef(false),close=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLElement>(null);
  useEffect(()=>{alive.current=true;const before=document.activeElement;close.current?.focus();return()=>{alive.current=false;if(before instanceof HTMLElement)before.focus();};},[]);
  useEffect(()=>{
    if(!usesPoseImage||!plan.humanPose||targetError||(!cloud&&!workflow))return;
    let cancelled=false;setPoseImage('');setPoseError('');
    const {selection,framing,aspect,cutFrame}=plan.humanPose;
    posePending.current=import('../lib/humanPoseGeneration.ts').then(({captureHumanPoseReference})=>captureHumanPoseReference(selection,framing,aspect??plan.width/plan.height,cutFrame)).then(image=>{
      if(!cancelled){setPoseImage(image);return image;}
    }).catch(cause=>{if(!cancelled)setPoseError(cause instanceof Error?cause.message:'3Dポーズを撮影できませんでした');return undefined;});
    return()=>{cancelled=true;};
  },[plan,workflow,poseAttempt]);
  const draft=useRef({prompt,references,reference,correction});draft.current={prompt,references,reference,correction};
  const attempted=useRef<string|null>(null);attempted.current=attempt;
  const canPrepareNewGeneration=!attempt||(job?['prepared','succeeded','failed','outcome_unknown'].includes(job.status):!submitted.current);
  function prepareNewGeneration(){
    attempted.current=null;submitted.current=false;setAttempt(null);setJob(null);setSelectedCandidate(null);setError('');setNotice('');
  }
  const updateReferences=(value:QwenReference[])=>{draft.current.references=value;setReferences(value);};
  const updatePrompt=(value:string)=>{
    if(working.current||!canPrepareNewGeneration||draft.current.prompt===value)return;
    if(attempted.current)prepareNewGeneration();
    draft.current.prompt=value;setPrompt(value);
  };
  async function operation<T>(task:()=>Promise<T>,propagate=false):Promise<T|undefined>{
    if(working.current){if(propagate)throw new Error('処理が終わるまでお待ちください');return;}working.current=true;setBusy(true);setError('');setNotice('');
    try{return await task();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'処理できませんでした');if(propagate)throw e;}
    finally{working.current=false;if(alive.current){setBusy(false);setPhase('');}}
  }
  async function loadRegistered(propagate=false){await operation(async()=>{
    if(attempted.current)throw new Error('生成を開始した資料は変更できません');
    if(!plan.candidates.length)throw new Error('登録済みの人物資料がありません。資料画像を追加してください');
    const candidates=threeImages?plan.candidates.slice(0,1):plan.candidates;
    if(candidates.length>referenceLimit)throw new Error(`登録資料が${referenceLimit}枚を超えています。使う資料を画像から選んで追加してください`);
    const loaded=await withNewCreationBridgeSession(async()=>{
      const result:QwenReference[]=[];
      for(const candidate of candidates){
        const blob=await loadCharacterReferenceImage(candidate.seriesId,candidate.characterCatalogId,candidate.source.asset_id);
        if(!blob)throw new Error(`${candidate.label}の原本が見つかりません`);
        result.push({label:candidate.label,characterKeys:candidate.characterKeys??plan.characterKeys,image:(await qwenInputImage(blob)).image});
      }
      return result;
    });
    if(alive.current)updateReferences(loaded);
  },propagate);}
  async function addFiles(files:File[],role:QwenReferenceRole='character',propagate=false){await operation(async()=>{
    if(attempted.current)throw new Error('生成を開始した資料は変更できません');
    if(draft.current.references.length+files.length>referenceLimit)throw new Error(`参照資料は最大${referenceLimit}枚です${usesPoseImage?'（3Dポーズ画像を別に1枚送ります）':''}`);
    const loaded:QwenReference[]=[];
    for(const file of files)loaded.push({label:file.name,characterKeys:role==='character'?[referenceCharacter].filter(Boolean):[],image:(await qwenInputImage(file)).image});
    if(alive.current)updateReferences([...draft.current.references,...loaded]);
  },propagate);}
  async function selectLayer(slot:'reference'|'correction',id:string){await operation(async()=>{
    const candidate=id?layers.find(layer=>layer.id===id):undefined;
    if(id&&(!candidate||candidate.empty||!loadLayer))throw new Error('参照できるレイヤーを選んでください');
    const referenceCandidate=slot==='reference'?candidate:reference,correctionCandidate=slot==='correction'?candidate:correction;
    const crop=Boolean(plan.contentKind)&&!correctionCandidate?plan.generationArea:undefined;
    const nextReference=referenceCandidate?{...referenceCandidate,image:await loadLayer!(referenceCandidate.id,false,crop)}:undefined;
    const nextCorrection=correctionCandidate?{...correctionCandidate,image:await loadLayer!(correctionCandidate.id,true)}:undefined;
    if(!alive.current)return;
    const nextPrompt=!threeImages&&draft.current.prompt===qwenGenerationPrompt(plan,reference,correction)
      ? qwenGenerationPrompt(plan,nextReference,nextCorrection):draft.current.prompt;
    draft.current={...draft.current,prompt:nextPrompt,reference:nextReference,correction:nextCorrection};
    if(nextPrompt!==prompt)setPrompt(nextPrompt);setReference(nextReference);setCorrection(nextCorrection);
  });}
  async function insertResult(result:QwenJob){
    if(!result.image||!result.fileName)throw new Error('差し込む画像がありません');
    const bytes=Uint8Array.from(atob(result.image.split(',')[1]),char=>char.charCodeAt(0));
    await insertImage(new File([bytes],result.fileName,{type:'image/png'}),generatedTarget.current?.jobId===result.jobId?generatedTarget.current.plan:undefined,Boolean(result.workflowId));
  }
  async function insertImage(file:File,capturedTarget?:QwenGenerationPlan,preserveAspect=false){
    const target=capturedTarget??qwenGenerationTarget(plan,Boolean(draft.current.correction));
    if(!target.outputFrame){await onInsert(file,target);return;}
    const bitmap=await createImageBitmap(file);
    try{
      const canvas=document.createElement('canvas');canvas.width=target.width;canvas.height=target.height;
      const context=canvas.getContext('2d');if(!context)throw new Error('生成画像を配置できません');
      const cut=target.humanPose?.cutFrame;
      if(cut){context.beginPath();cut.points.forEach(([x,y],index)=>{const px=(x-cut.bounds.x)/cut.bounds.w*canvas.width,py=(y-cut.bounds.y)/cut.bounds.h*canvas.height;if(index)context.lineTo(px,py);else context.moveTo(px,py);});context.closePath();context.clip();}
      if(plan.scope){context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);}
      if(preserveAspect){
        const scale=Math.min(canvas.width/bitmap.width,canvas.height/bitmap.height);
        const width=bitmap.width*scale,height=bitmap.height*scale;
        context.drawImage(bitmap,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
      }else context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('生成画像を保存できません')),'image/png'));
      await onInsert(new File([blob],file.name,{type:'image/png'}),target);
    }finally{bitmap.close();}
  }
  async function importGenerated(){
    const files=await chooseBrowserFiles('image/png,image/jpeg');
    if(files[0])await operation(()=>insertImage(files[0],generatedTarget.current?.plan));
  }
  async function generate(autoInsert=false,inputIsCurrent:()=>boolean=()=>true){return operation(async()=>{
    if(attempted.current)throw new Error('この生成は開始済みです。生成状況を確認してください');
    if(targetError)throw new Error(targetError);
    const {prompt,references,reference,correction}=draft.current;
    const isCurrent=()=>alive.current&&inputIsCurrent();
    if(usesPoseImage)setPhase('3Dポーズの撮影を確認中');
    const capturedPose=usesPoseImage?await posePending.current:undefined;
    if(!isCurrent())throw new Error('生成を中止しました');
    const sketch=!threeImages&&reference?.kind==='sketch'&&!correction;
    const target=qwenGenerationTarget(plan,Boolean(correction));
    const payload=qwenGenerationPayload({...plan,prompt,...(plan.handwrittenPrompt?{handwrittenPrompt:{...plan.handwrittenPrompt,confirmation:qwenGenerationPrompt(plan,reference,correction)}}:{})},references,sketch?undefined:reference?.image,sketch?reference?.image:undefined,correction?.image,capturedPose,workflow?.binding.fixed_size??undefined);
    if(cloud){
      if(execution.cloud.method!=='agent')throw new Error('API実行は未接続です。環境設定でエージェントを選んでください');
      const access=cloudModelAccess(currentGenerationPreferences(),adultContent);
      if(!access.allowed)throw new Error(access.reason==='adult-terms-required'?'環境設定でクラウドの成人向け利用条件を確認してください':'環境設定でクラウドを選んでください');
      const agent=execution.cloud.agent==='codex'?'Codex':execution.cloud.agentName||'指定のエージェント';
      downloadBrowserBlob(generationHandoff(target,payload,agent),`generation-${plan.pageNumber}-${plan.ownerKey}.zip`);
      generatedTarget.current={plan:target};
      setNotice(`${agent}へ渡す指示と参照画像を保存しました。生成したPNGを「生成画像を読み込む」で戻せます。`);
      return {inserted:false};
    }
    if(!workflow)throw new Error(workflowError||'ワークフローを確認しています');
    const inputCount=payload.references.length+Number('paint_image' in payload)+Number('sketch_image' in payload)+Number('correction_image' in payload);
    if(inputCount!==workflow.binding.images.length)throw new Error(`${workflow.name}は参照画像${workflow.binding.images.length}枚の定義です。現在は${inputCount}枚です。環境設定で対応する定義を選んでください`);
    const workflowPayload={...payload,workflow_id:workflow.id,workflow_version:workflow.version,comfyui_url:connection.comfyuiUrl,
      ...(figureChroma?{chroma_key_color:chromaKeyColor}:{})};
    const id=crypto.randomUUID();
    generatedTarget.current={jobId:id,plan:target};
    submitted.current=false;
    return executeQwenGeneration({id,payload:workflowPayload,plan:target,isCurrent,
      prepare:(id,payload)=>{attempted.current=id;setAttempt(id);return prepareQwenJob(id,payload);},
      submit:(prepared,token)=>{submitted.current=true;return submitQwenJob(prepared,token);},reconcile:reconcileQwenJob,
      onJob:current=>{if(alive.current)setJob(current);},
      ...(autoInsert?{insert:insertResult}:{}),
      services:(prepare,generate,options)=>withImageGenerationServices(prepare,generate,{...options,requiresLlm:workflow.binding.prompt_mode==='qwen'&&!plan.contentKind,onPhase:value=>{
        if(alive.current)setPhase({bridge:'準備中',llm:'英訳の準備中',translate:Boolean(plan.contentKind)?'生成指示を保存中':'英訳を保存中',suspend:'文章LLMを停止中',generate:'5枚の画像を生成中',restore:'生成後の復帰を確認中'}[value]);
      }}),
    });
  },autoInsert);}
  async function conversationSend(text:string,isCurrent:()=>boolean){
    if(!alive.current||!isCurrent())return '生成の会話を終了しました';
    const intent=qwenConversationIntent(text);
    if(intent==='hold')return '新しい生成は開始していません。指示を整えてから「生成して」と送ってください。';
    if(intent==='help')return '参照画像を追加して、追加の指示を送れます。「生成して」と送ると、シードを変えた5枚を表示します。画面で採用する1枚を選んでください。';
    if(intent==='instruction'){
      if(working.current)throw new Error('処理が終わるまでお待ちください');
      if(attempted.current)throw new Error('この生成は開始済みです。生成状況を確認してください');
      if(draft.current.prompt.length+text.length>12000)throw new Error('追加の指示が長すぎます。生成指示を整理してください');
      updatePrompt(`${draft.current.prompt}\n\n${text.trim()}`);
      return '追加の指示を生成指示に反映しました。「生成して」で5枚を生成します。採用する1枚は画面で選んでください。';
    }
    const result=await generate(true,isCurrent);
    if(cloud)return '指示と参照画像のZIPを保存しました。指定のエージェントへ渡し、完成したPNGをこの画面で読み込んでください。';
    if(result?.job?.candidates?.length){
      if(result.job.status==='succeeded'&&result.job.candidates.length===5)return `${plan.label}の候補を5枚生成しました。画面で採用する1枚を選んでください。`;
      return `候補${result.job.candidates.length}枚を保持しています。${result.job.error||'生成は完了していません。生成状況を確認してください。'}`;
    }
    return result?.inserted?`${plan.label}を生成し、新規レイヤーとして追加しました。元に戻す操作も使えます。`:'自動差し込みは中止しました。開始済みの生成は生成状況から確認できます。';
  }
  useEffect(()=>{
    onConversation?.({label:`${plan.pageNumber}ページ・${plan.overlay?'ページ前景':`コマ ${plan.panelId}`}・${plan.label}`,
      busy,locked:Boolean(attempt),phase,references,character:plan.characterKeys.length>0,
      addFiles:(files,role)=>addFiles(files,role,true),loadRegistered:()=>loadRegistered(true),send:conversationSend});
  },[onConversation,busy,attempt,phase,prompt,references,reference,correction,job,referenceCharacter,workflow,workflowError,chromaKeyColor]);
  useEffect(()=>()=>onConversation?.(null),[onConversation]);
  const agentStarted=useRef(false);
  useEffect(()=>{
    if(!agentRequest||agentStarted.current)return;
    if(!cloud&&!workflow){
      if(workflowError){agentStarted.current=true;agentRequest.reject(new Error(workflowError));}
      return;
    }
    agentStarted.current=true;
    void runQwenAgentRequest(agentRequest,async()=>{if(plan.characterKeys.length)await loadRegistered(true);},conversationSend);
  },[agentRequest,workflow,workflowError]);
  async function check(id:string){await operation(async()=>{
    const expected=job?.jobId===id?job:history.find(item=>item.jobId===id);
    const result=await withNewCreationBridgeSession(()=>reconcileQwenJob(id,expected?.requestSha256));
    if(alive.current){setJob(result);setAttempt(id);setSelectedCandidate(result.selectedCandidate??null);}
  });}
  async function loadHistory(scope:QwenHistoryScope){await operation(async()=>{
    const jobs=await withNewCreationBridgeSession(()=>listQwenJobs(plan,scope));
    if(alive.current){setHistory(jobs);setHistoryScope(scope);setSelectedJobs([]);}
  });}
  async function remove(jobs:QwenJob[]){
    if(working.current||!jobs.length||jobs.some(item=>!canDeleteQwenJob(item)))return;
    if(!window.confirm(`本当に削除しますか？\n\n${jobs.length}件の生成画像・中間データ・履歴をすべて削除します。この操作は取り消せません。`))return;
    await operation(async()=>{
      await withNewCreationBridgeSession(()=>deleteQwenJobs(plan,jobs));
      if(!alive.current)return;
      const ids=new Set(jobs.map(item=>item.jobId));
      setHistory(items=>items.filter(item=>!ids.has(item.jobId)));setSelectedJobs(items=>items.filter(id=>!ids.has(id)));
      if(job&&ids.has(job.jobId)){
        prepareNewGeneration();
      }
      setNotice(`${jobs.length}件の生成画像・中間データ・履歴を削除しました。`);
    });
  }
  async function selectCandidate(){
    if(!job||selectedCandidate===null)return;
    await operation(async()=>{
      setPhase(job.requiresCutout?'選んだ画像の背景を透過中':'選んだ画像を準備中');
      const result=await withNewCreationBridgeSession(()=>selectQwenCandidate(job,selectedCandidate));
      if(alive.current)setJob(result);
    });
  }
  async function insert(){if(job)await operation(()=>insertResult(job));}
  function keydown(event:KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)onClose();}
    if(event.key==='Tab'){
      const items=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')??[]).filter(el=>!el.hidden);
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }
  return createPortal(<div class="layer-generation-backdrop" onKeyDown={keydown}>
    <section ref={dialog} class="layer-generation-dialog qwen-generation-dialog qwen-with-conversation" role="dialog" aria-modal="true" aria-labelledby="qwen-generation-title">
      <header><div><h2 id="qwen-generation-title">生成</h2><p>{cloud?'クラウドへ渡す画像と指示':workflow?.name??'ComfyUIワークフロー'} · {plan.scope==='page'?'ページ全体':plan.overlay?'ページ前景':`コマ ${plan.panelId}`} · {plan.label}</p></div><button ref={close} disabled={busy} onClick={onClose}>閉じる</button></header>
      <div class="qwen-conversation-layout"><div class="qwen-generation-controls">
      {!cloud&&<div class="qwen-output-size">
        {workflow?<p>ワークフロー：{workflow.name} · 版{workflow.version} · 参照画像{workflow.binding.images.length}枚
          {workflow.binding.fixed_size&&` · 固定寸法 ${workflow.binding.fixed_size[0]} × ${workflow.binding.fixed_size[1]} px（原稿には縦横比を保って配置）`}</p>
          :<p role={workflowError?'alert':'status'}>{workflowError||'ワークフローを確認しています…'}</p>}
        {onOpenSettings&&<button disabled={busy} onClick={onOpenSettings}>環境設定を開く</button>}
      </div>}
      {targetError&&<p role="alert">{targetError}</p>}
      {!cloud&&figureChroma&&<label>透過用の背景色
        <select aria-label="透過用の背景色" value={chromaKeyColor} disabled={busy||Boolean(attempt)} onChange={event=>setChromaKeyColor(event.currentTarget.value)}>
          <option value="#00FF00">緑</option><option value="#0000FF">青</option><option value="#FF00FF">マゼンタ</option>
        </select>
      </label>}
      {plan.compositionImage&&<fieldset><legend>送信する紙面</legend><figure class="qwen-paint-reference"><img src={plan.compositionImage} alt={`${plan.label}の参照画像`}/><figcaption>人物配置・コマ形状・フキダシと文字の参照</figcaption></figure></fieldset>}
      {usesPoseImage&&<fieldset><legend>送信する3Dポーズ</legend>
        {poseImage?<figure class="qwen-paint-reference"><img src={poseImage} alt="描写範囲に合わせた3Dポーズ参照"/><figcaption>姿勢・アングル・切り取り範囲の参照</figcaption></figure>
          :poseError?<><p role="alert">{poseError}</p><button disabled={busy||Boolean(attempt)} onClick={()=>setPoseAttempt(value=>value+1)}>撮影を再試行</button></>:<p role="status">保存した3Dポーズを撮影しています…</p>}
        <p>人物の外見と画風には、下のキャラクター設定画を使います。</p>
      </fieldset>}
      {!plan.scope&&<fieldset disabled={busy||Boolean(attempt)||waitingForWorkflow}><legend>「{plan.label}」フォルダのレイヤー</legend>
        {!threeImages&&<p>参照画像とピンポイント修正用を、それぞれ1枚まで選べます。どちらも任意です。</p>}
        <div class="qwen-layer-inputs">{(['reference','correction'] as const).filter(slot=>!threeImages||slot==='reference').map(slot=>{
          const selected=slot==='reference'?reference:correction;
          const label=slot==='reference'?(threeImages?'ネーム（表情・感情）':'参照画像'):'ピンポイント修正用';
          return <div class="qwen-layer-input"><label>{label}<select aria-label={label} value={selected?.id??''} onChange={e=>void selectLayer(slot,e.currentTarget.value)}>
            <option value="">{threeImages?'選択してください':'使わない'}</option>{layers.map(layer=><option value={layer.id} disabled={layer.empty}>{layer.label}{layer.empty?'（空・濃度0%）':layer.hidden?'（非表示）':''}</option>)}
          </select></label>{selected&&<figure class="qwen-paint-reference"><img src={selected.image} alt={`${label}：${selected.label}`}/><figcaption>{selected.label}</figcaption></figure>}</div>;
        })}</div>
        {!layers.length&&<p>このフォルダには参照できるレイヤーがありません。</p>}
        {!threeImages&&<p>修正用には、直したい場所を囲んだ画像、書き込み、マスクを選びます。修正内容は下の生成指示に入力できます。</p>}
        {correction&&!reference&&<p>参照画像を使わない場合は、元の絵に書き込みを加えたレイヤーを選んでください。マスクだけの場合は参照画像も必要です。</p>}
      </fieldset>}
      {plan.characterKeys.length>0&&<fieldset disabled={busy||Boolean(attempt)||waitingForWorkflow}><legend>キャラクター設定画</legend>
        {plan.characterKeys.length>1&&<label>追加する設定画の人物<select aria-label="設定画の人物" value={referenceCharacter} onChange={e=>setReferenceCharacter(e.currentTarget.value)}>{plan.characterKeys.map((key,index)=><option value={key}>Character {index+1} · {plan.candidates.find(candidate=>candidate.characterKeys?.includes(key))?.label??key}</option>)}</select></label>}
        <div class="paint-entry-actions"><button onClick={()=>void loadRegistered()} disabled={!plan.candidates.length}>登録資料を読み込む</button><label class="qwen-file-label">設定画を追加<input type="file" accept="image/png,image/jpeg,image/webp" multiple={!threeImages} onChange={e=>{const files=Array.from(e.currentTarget.files??[]);e.currentTarget.value='';void addFiles(files);}}/></label></div>
        <p>設定画は人物の外見と画風の参照に使います。「設定画を追加」は今回の生成だけに使い、人物資料には登録しません。</p>
        <div class="qwen-reference-list">{references.map((reference,index)=><figure><img src={reference.image} alt={reference.label}/><figcaption>{reference.label} · {reference.characterKeys.length?'人物設定画':'描画参考'}</figcaption><button onClick={()=>updateReferences(references.filter((_,i)=>i!==index))}>外す</button></figure>)}</div>
      </fieldset>}
      {Boolean(plan.contentKind)&&<div class="qwen-output-size"><output>{qwenGenerationSizePrompt(plan,Boolean(correction),workflow?.binding.fixed_size??undefined)}</output><div>生成範囲：{plan.generationArea&&!correction?'生成マスクの外接矩形':'フォルダーのキャンバス全体'} · 生成解像度：{cloud?'指定サイズ':workflow?.binding.fixed_size?workflow.binding.fixed_size.join(' × '):'縦横比に合わせて調整'}</div></div>}
      <label class="qwen-prompt">生成指示<textarea rows={8} value={waitingForWorkflow?'':prompt} disabled={busy||!canPrepareNewGeneration||waitingForWorkflow} onInput={e=>updatePrompt(e.currentTarget.value)}/></label>
      <div class="paint-entry-actions">
        <button class="primary-button" disabled={busy||Boolean(attempt)||usesPoseImage&&!poseImage||!cloud&&!workflow||threeImages&&(!!targetError||!reference||references.length!==1)} onClick={()=>void generate()}>{cloud?'指示と参照画像を書き出す':'5枚を生成する'}</button>
        {cloud&&<button disabled={busy} onClick={()=>void importGenerated()}>生成画像を読み込む</button>}
        {!cloud&&attempt&&<button disabled={busy} onClick={()=>void check(attempt)}>生成状況を確認</button>}
        {!cloud&&<><button disabled={busy} aria-pressed={historyScope==='owner'} onClick={()=>void loadHistory('owner')}>生成履歴</button>
        <button disabled={busy} aria-pressed={historyScope==='work'} onClick={()=>void loadHistory('work')}>作品の生成履歴</button></>}
      </div>
      {busy&&phase&&<p role="status">{phase}</p>}
      {!cloud&&attempt&&job&&['queued','running','outcome_unknown'].includes(job.status)&&<button onClick={()=>void cancelQwenJob(attempt).then(result=>{if(alive.current){setJob(result);setNotice('取消しを要求しました。実行状況とモデル解放を確認しています');}}).catch(cause=>{if(alive.current)setError(String(cause));})}>この生成を取り消す</button>}
      {notice&&<p role="status">{notice}</p>}
      {attempt&&!busy&&!job&&canPrepareNewGeneration&&<button onClick={prepareNewGeneration}>新しい生成を準備</button>}
      {error&&<p role="alert">{error}{attempt?' 送信済みの可能性があるため、生成状況を確認してください。':''}</p>}
      {job&&<section class="qwen-result" aria-live="polite"><strong>{statusLabel[job.status]}</strong>{job.error&&<p>{job.error}</p>}
        {job.workflowName&&<p>{job.workflowName} · 版{job.workflowVersion} · {job.width} × {job.height} px</p>}
        {job.generationPrompt&&<details><summary>送信した指示とシード</summary><pre style={{whiteSpace:'pre-wrap'}}>{job.generationPrompt}</pre><p>{job.candidateSeeds?.join(', ')}</p></details>}
        {job.documentKey&&<small>{qwenJobLocation(job)}</small>}
        {job.candidates?.length&&!job.image&&<>
          <div class="qwen-candidates" role="group" aria-label="生成候補">
            {job.candidates.map(candidate=><button type="button" class="qwen-candidate" disabled={busy} aria-pressed={selectedCandidate===candidate.index} onClick={()=>setSelectedCandidate(candidate.index)} key={candidate.index}>
              <img src={candidate.image} alt={`候補${candidate.index}・シード${candidate.seed}`}/><span>候補{candidate.index} · seed {candidate.seed}</span>
            </button>)}
          </div>
          {selectedCandidate!==null&&<img class="qwen-candidate-preview" src={job.candidates.find(candidate=>candidate.index===selectedCandidate)?.image} alt={`選択中の候補${selectedCandidate}`}/>}
          <button class="primary-button" disabled={busy||selectedCandidate===null||job.status!=='succeeded'} onClick={()=>void selectCandidate()}>{job.requiresCutout?'選んだ1枚の背景を透過する':'選んだ1枚を採用する'}</button>
        </>}
        {job.image&&<><img src={job.image} alt={`${job.label}の生成結果`}/><div class="paint-entry-actions"><a href={job.image} download={job.fileName}>生成画像を保存</a><button disabled={busy} onClick={()=>void insert()}>新規レイヤーとして追加</button><button disabled={busy} onClick={()=>void remove([job])}>破棄する</button></div></>}
        {canPrepareNewGeneration&&<button disabled={busy} onClick={prepareNewGeneration}>新しい生成を準備</button>}
      </section>}
      {historyScope&&<section class="qwen-history" aria-label={historyScope==='work'?'作品の生成履歴':'生成履歴'}>
        <h3>{historyScope==='work'?'作品の生成履歴':'生成履歴'}</h3>
        <p>{historyScope==='work'?'作品内の全ページ・全コマの生成画像です。ファイル名を押すと画像を確認し、現在の対象へ新規レイヤーとして追加できます。':'現在のあたりで生成した画像です。'} チェックした履歴は「削除」でまとめて消せます。</p>
        {history.length===0?<p>生成履歴はありません。</p>:<>
          <div class="paint-entry-actions"><label><input type="checkbox" disabled={busy||!history.some(canDeleteQwenJob)} checked={history.filter(canDeleteQwenJob).length>0&&history.filter(canDeleteQwenJob).every(item=>selectedJobs.includes(item.jobId))} onChange={e=>setSelectedJobs(e.currentTarget.checked?history.filter(canDeleteQwenJob).map(item=>item.jobId):[])}/> 全て選択</label><button disabled={busy||selectedJobs.length===0} onClick={()=>void remove(history.filter(item=>selectedJobs.includes(item.jobId)))}>削除</button><span>{selectedJobs.length}件を選択</span></div>
          <ul>{history.map(item=><li key={item.jobId}>
            <input type="checkbox" aria-label={`${item.fileName??item.jobId}を削除対象に選ぶ`} disabled={busy||!canDeleteQwenJob(item)} checked={selectedJobs.includes(item.jobId)} onChange={e=>setSelectedJobs(ids=>e.currentTarget.checked?[...ids,item.jobId]:ids.filter(id=>id!==item.jobId))}/>
            <div><button class="qwen-history-file" disabled={busy} onClick={()=>void check(item.jobId)}>{item.fileName??item.jobId}</button><small>{qwenJobLocation(item)} · {statusLabel[item.status]}</small></div>
          </li>)}</ul>
        </>}
      </section>}
      </div><aside class="qwen-conversation-host" aria-label="生成の会話" ref={onConversationHost}/></div>
    </section>
  </div>,document.body);
}
