import ProjectFileInput, { useProjectFilePicker } from './ProjectFileInput';
export { qwenInputImage, qwenLayerImage } from './generation/inputImages.ts';
import type { ComponentProps } from 'preact';
import FigureHumanPoseEditor from './FigureHumanPoseEditor';
import type { HumanPoseTextSelection } from '../lib/humanPoseTypes.ts';
import type { FigureSize, BBox } from '../types.ts';
import { type QwenGenerationPlan, type QwenAgentRequest, type QwenLayerCandidate, type QwenAdoption, type QwenGenerationConversation, type QwenLayerReference, type QwenReference, qwenPlanForWorkflow, figureBackgroundPrompt, type QwenJob, type QwenHistoryScope, runQwenAgentRequest, canDeleteQwenJob, qwenGenerationSizePrompt, qwenJobLocation } from '../lib/qwenGeneration.ts';
import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { currentGenerationPreferences } from '../lib/generationPreferences.ts';
import { currentLocalModelPreferences } from '../lib/localModelPreferences.ts';
import { type ComfyWorkflowDefinition, parseComfyWorkflowList, workflowNegativePrompt, workflowPromptUpsampler } from '../lib/comfyWorkflows.ts';
import { requestComfyWorkflows, cancelQwenJob, blobDataUrl, reconcileQwenJob, listQwenJobs, deleteQwenJobs, selectQwenCandidate } from '../lib/localBridge.ts';
import { stopImageGenerationSessionOnPageExit, startImageGenerationSession, stopImageGenerationSession, imageGenerationProgress, withNewCreationBridgeSession } from '../lib/localBridgeLifecycle.ts';
import { loadFigureCropAsset } from '../lib/figureCropStore.ts';
import { posePreviewSize } from '../lib/humanPoseFraming.ts';
import { useGenerationReferences } from './generation/useGenerationReferences.ts';
import { type CloudSingleGenerationStart, createGenerationActions, validateGenerationInputs } from './generation/createGenerationActions.ts';
import { candidateFilesFromJob } from '../lib/generation/insertion.ts';
import { useGenerationConversation } from './generation/useGenerationConversation.ts';
import { generationReadiness } from '../lib/generation/readiness.ts';
import { CHARACTER_REFERENCE_VIEWS } from '../lib/characterReferences.ts';
import type { AgentWorkflowYamlFile } from '../lib/generationHandoff.ts';
import GenerationCandidates, { generationStatusLabel } from './generation/GenerationCandidates.tsx';
import { createPortal } from 'preact/compat';

export type GenerationPoseEditorContext=Pick<ComponentProps<typeof FigureHumanPoseEditor>,'panelContext'|'stages'|'backgroundCaptures'> & {
  onConfirmed?: (value: HumanPoseTextSelection, framing: FigureSize) => void;
};

interface Props { poseEditorContext?:GenerationPoseEditorContext; onOpenSettings?:()=>void; onExportAgentYaml?:()=>AgentWorkflowYamlFile[]; onSaveAgentYaml?:(files:AgentWorkflowYamlFile[])=>Promise<string|null>; onStartCloudSingle?:(params:CloudSingleGenerationStart)=>Promise<void>; plan:QwenGenerationPlan; adultContent?:boolean; agentRequest?:QwenAgentRequest; layers?:QwenLayerCandidate[]; loadLayer?:(id:string,correction:boolean,crop?:BBox,native?:boolean)=>Promise<string>; onClose:()=>void; onInsert:(file:File|File[],target:QwenGenerationPlan,adoption?:QwenAdoption)=>Promise<void>; onConversation?:(value:QwenGenerationConversation|null)=>void; onConversationHost?:(host:HTMLElement|null)=>void }

export default function ImageGenerationDialog({poseEditorContext,onOpenSettings,onExportAgentYaml,onSaveAgentYaml,onStartCloudSingle,plan:sourcePlan,adultContent=false,agentRequest,layers=[],loadLayer,onClose,onInsert,onConversation,onConversationHost}:Props){
  const [execution]=useState(currentGenerationPreferences);
  const cloud=execution.execution==='cloud';
  const cloudApi=cloud&&execution.cloud.method==='api';
  const cloudAgent=cloud&&!cloudApi;
  const [connection]=useState(currentLocalModelPreferences);
  const [registry,setRegistry]=useState<ComfyWorkflowDefinition[]>([]),[workflowError,setWorkflowError]=useState('');
  const [chromaKeyColor,setChromaKeyColor]=useState('#00FF00');
  useEffect(()=>{
    if(cloud)return;
    let current=true;
    if(!execution.local.workflowId){setWorkflowError('環境設定 → モデルで、使用するワークフローを選んでください');return;}
    requestComfyWorkflows('list').then(raw=>{
      if(!current)return;
      const list=parseComfyWorkflowList(raw);
      const selected=list.find(item=>item.id===execution.local.workflowId);
      if(!selected)throw new Error('選択したワークフローの登録がありません。環境設定を確認してください');
      setRegistry(list);
    }).catch(cause=>{if(current)setWorkflowError(cause instanceof Error?cause.message:'ワークフローを読み込めません');});
    return()=>{current=false;};
  },[]);
  const chosen=registry.find(item=>item.id===execution.local.workflowId);
  const threeImages=false;
  const twoImagesPromptless=!cloud&&chosen?.binding.prompt_mode==='promptless-two-images';
  const [selectedCharacterAssetId,setSelectedCharacterAssetId]=useState('');
  const [reference,setReference]=useState<QwenLayerReference>(),[correction,setCorrection]=useState<QwenLayerReference>();
  const [linked,setLinked]=useState<QwenReference[]>([]),[extra,setExtra]=useState<QwenReference[]>([]);
  const [sourceErrors,setSourceErrors]=useState({expression:'',character:''});
  const [expressionRetry,retryExpression]=useState(0),[characterRetry,retryCharacter]=useState(0);
  const [characterLoading,setCharacterLoading]=useState(Boolean(sourcePlan.characterKeys.length));
  const [sketchLoading,setSketchLoading]=useState(false);
  const references=useMemo(()=>[...linked,...extra],[linked,extra]);
  const basePlan=sourcePlan;
  const usesPoseImage=basePlan.humanPose?.selection.input_mode==='image';
  const workflow=chosen??null;
  const missingWorkflow=workflowError;
  const plan=useMemo(()=>qwenPlanForWorkflow(basePlan,workflow),[basePlan,workflow]);
  const targetError='';
  const waitingForWorkflow=!cloud&&!chosen;
  const figureChroma=plan.ownerKey.startsWith('figure-')&&workflow?.binding.prompt_mode==='qwen';
  const [editedPrompt,setPrompt]=useState<string>(),[editedNegative,setNegative]=useState<string>(),[editedUpsampler,setUpsampler]=useState<boolean>();
  const defaultNegative=workflowNegativePrompt(workflow),negative=editedNegative??defaultNegative;
  const defaultUpsampler=workflowPromptUpsampler(workflow),usePromptUpsampler=editedUpsampler??defaultUpsampler;
  const prompt=editedPrompt??(threeImages?figureBackgroundPrompt(plan.prompt,chromaKeyColor):plan.prompt);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[job,setJob]=useState<QwenJob|null>(null);
  const [history,setHistory]=useState<QwenJob[]>([]),[attempt,setAttempt]=useState<string|null>(null);
  const [historyScope,setHistoryScope]=useState<QwenHistoryScope|null>(null),[selectedJobs,setSelectedJobs]=useState<string[]>([]);
  const [phase,setPhase]=useState(''),[notice,setNotice]=useState('');
  const [comfyPhase,setComfyPhase]=useState('');
  const generationAbort=useRef<AbortController>();
  const closing=useRef(false);
  const [selectedCandidate,setSelectedCandidate]=useState<number|null>(null);
  const [selectedCandidates,setSelectedCandidates]=useState<number[]>([]);
  const insertedBatch=useRef<string|null>(null);
  const [poseImage,setPoseImage]=useState(''),[poseError,setPoseError]=useState(''),[poseAttempt,setPoseAttempt]=useState(0);
  const posePending=useRef<Promise<string|undefined>>();
  const referenceLimit=threeImages?1:usesPoseImage?8:9;
  const submitted=useRef(false);
  const generatedTarget=useRef<{jobId?:string;plan:QwenGenerationPlan}>();
  const comfySession=useRef<string|null>(null);
  const alive=useRef(true),working=useRef(false),close=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLElement>(null);
  useEffect(()=>{
    alive.current=true;const before=document.activeElement;close.current?.focus();
    const release=()=>{if(comfySession.current)stopImageGenerationSessionOnPageExit(comfySession.current);};
    window.addEventListener('pagehide',release);
    return()=>{alive.current=false;generationAbort.current?.abort();window.removeEventListener('pagehide',release);release();if(before instanceof HTMLElement)before.focus();};
  },[]);
  async function ensureComfy(endpoint=connection.comfyuiUrl){
    const token=comfySession.current??crypto.randomUUID();comfySession.current=token;
    setPhase('ComfyUIを起動中');
    await startImageGenerationSession(token,endpoint);
  }
  async function releaseComfy(){
    const token=comfySession.current;if(!token)return;
    await stopImageGenerationSession(token);if(comfySession.current===token)comfySession.current=null;
  }
  async function closeDialog(){
    if(closing.current)return;closing.current=true;generationAbort.current?.abort();
    try{await releaseComfy();onClose();}
    catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:String(cause));}
    finally{closing.current=false;}
  }
  async function cancelGeneration(){
    generationAbort.current?.abort();setPhase('生成の取消しと終了を確認中');
    try{
      if(attempted.current)await cancelQwenJob(attempted.current);
    }catch(cause){if(alive.current)setError(String(cause));}
    finally{await releaseComfy().catch(cause=>{if(alive.current)setError(String(cause));});}
  }
  const observing=busy&&phase==='画像を生成中';
  useEffect(()=>{
    const progress=job?.progress,token=comfySession.current;
    if(!observing||!progress||!token){setComfyPhase('');return;}
    let active=true,pollTimer:ReturnType<typeof setTimeout>,elapsedTimer:ReturnType<typeof setInterval>;
    let samplerReached=false;
    const startedAt=Date.now();
    const formatElapsed=()=>{
      const secs=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
      return `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`;
    };
    const updateSamplerPhase=()=>{
      if(active)setComfyPhase(`候補 ${progress.candidate}/${progress.total}：サンプラー実行中（経過 ${formatElapsed()}）`);
    };
    elapsedTimer=setInterval(()=>{
      if(active&&samplerReached)updateSamplerPhase();
    },1000);
    const poll=async()=>{
      if(!active||samplerReached)return;
      try{
        const node=await imageGenerationProgress(token,progress);
        const nodeName=node&&progress.nodes[node]||'';
        if(nodeName&&/サンプラー|sampler/i.test(nodeName)){
          samplerReached=true;
          updateSamplerPhase();
          return;
        }
        if(active)setComfyPhase(`候補 ${progress.candidate}/${progress.total}：${nodeName||'ComfyUIの実行工程を確認中'}（経過 ${formatElapsed()}）`);
      }catch{if(active)setComfyPhase(`候補 ${progress.candidate}/${progress.total}：ComfyUIの接続を確認中`);}
      if(active&&!samplerReached)pollTimer=setTimeout(poll,1500);
    };
    void poll();
    return()=>{active=false;clearTimeout(pollTimer);clearInterval(elapsedTimer);};
  },[observing,job?.progress?.clientId,job?.progress?.promptId]);
  useEffect(()=>{
    setPoseImage('');setPoseError('');posePending.current=undefined;
    if(!usesPoseImage||!plan.humanPose?.selection.scene||targetError||waitingForWorkflow)return;
    let cancelled=false;
    const {selection,framing,aspect,cutFrame}=plan.humanPose;
    const capture = async () => {
      const {captureHumanPoseReference} = await import('../lib/humanPoseGeneration.ts');
      return captureHumanPoseReference(selection,framing,aspect??plan.width/plan.height,cutFrame,undefined,poseEditorContext?.stages);
    };
    posePending.current=capture().then(image=>{
      if(!cancelled){setPoseImage(image);return image;}
    }).catch(cause=>{if(!cancelled)setPoseError(cause instanceof Error?cause.message:'3Dポーズを撮影できませんでした');return undefined;});
    return()=>{cancelled=true;};
  },[basePlan,workflow,threeImages,waitingForWorkflow,poseAttempt,poseEditorContext?.stages]);
  const draft=useRef({prompt,references,reference,correction});draft.current={prompt,references,reference,correction};
  const attempted=useRef<string|null>(null);attempted.current=attempt;
  const canPrepareNewGeneration=!attempt||(job?['prepared','succeeded','failed','outcome_unknown'].includes(job.status):!submitted.current);
  function prepareNewGeneration(){
    attempted.current=null;submitted.current=false;setAttempt(null);setJob(null);setSelectedCandidate(null);setSelectedCandidates([]);insertedBatch.current=null;setError('');setNotice('');
  }
  function applyPrompt(value:string){
    if(draft.current.prompt===value)return;
    if(attempted.current)prepareNewGeneration();
    draft.current.prompt=value;setPrompt(value);
  }
  const updatePrompt=(value:string)=>{
    if(working.current||!canPrepareNewGeneration)return;
    applyPrompt(value);
  };
  async function operation<T>(task:()=>Promise<T>,propagate=false):Promise<T|undefined>{
    if(working.current){if(propagate)throw new Error('処理が終わるまでお待ちください');return;}working.current=true;setBusy(true);setError('');setNotice('');
    try{return await task();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'処理できませんでした');if(propagate)throw e;}
    finally{working.current=false;if(alive.current){setBusy(false);setPhase('');}}
  }
  const { selectLayer, addFiles } = useGenerationReferences({ setLinked, setCharacterLoading, sourcePlan, setSourceErrors, threeImages, twoImagesPromptless, cloudApi, waitingForWorkflow, selectedCharacterAssetId, characterRetry, setSketchLoading, setReference, expressionRetry, operation, attempted, draft, referenceLimit, usesPoseImage, alive, setExtra, layers, loadLayer, reference, correction, plan, prompt, setPrompt, setCorrection });
  const chooseFiles = useProjectFilePicker();
  const { generate, insertImage, insertResult, importGenerated } = createGenerationActions({ chooseFiles, generatedTarget, plan, draft, onInsert, onStartCloudSingle, onClose, operation, attempted, targetError, threeImages, usesPoseImage, generationAbort, alive, setPhase, posePending, workflow, cloud, execution, adultContent, setNotice, missingWorkflow, connection, defaultNegative, negative, defaultUpsampler, usePromptUpsampler, figureChroma, chromaKeyColor, ensureComfy, submitted, setAttempt, setJob, comfySession, exportAgentYaml: onExportAgentYaml, saveAgentYaml: onSaveAgentYaml });
  const getReadiness = () => generationReadiness({
    working: working.current, phase: comfyPhase || phase, attempted: Boolean(attempted.current),
    cloud, cloudApi, hasWorkflow: Boolean(workflow), workflowError: missingWorkflow, plan, threeImages,
    usesPoseImage, targetError, poseImage, poseError, characterLoading, sketchLoading, sourceErrors,
    references: draft.current.references, reference: draft.current.reference,
    validateInputs: () => cloudApi
      ? (plan.scope && !plan.compositionImage ? (() => { throw new Error('紙面の参照画像を用意してから生成してください'); })() : null)
      : validateGenerationInputs(plan, draft.current, threeImages, cloud ? null : workflow, poseImage || undefined),
  });
  const readiness = getReadiness();
  const conversationSend = useGenerationConversation({
    label: `${plan.pageNumber}ページ・${plan.overlay ? 'ページ前景' : `コマ ${plan.panelId}`}・${plan.label}`,
    busy: busy || characterLoading || sketchLoading, locked: Boolean(attempt), phase: comfyPhase || phase,
  }, onConversation, {
    isAlive: () => alive.current,
    isCurrent: () => alive.current && !closing.current,
    isWorking: () => working.current, readiness: getReadiness,
    snapshot: () => ({
      prompt: draft.current.prompt, label: plan.label, mode: cloud ? 'cloud' : workflow?.binding.prompt_mode ?? 'pending',
      status: job?.status ?? 'draft', editable: canPrepareNewGeneration && job?.status !== 'outcome_unknown',
      generatedPrompt: job?.generationPrompt, readiness: getReadiness(),
    }),
    update: (value, expected) => {
      if (draft.current.prompt !== expected) throw new Error('生成指示が変わりました');
      if (value === expected) return;
      if (!canPrepareNewGeneration || job?.status === 'outcome_unknown') throw new Error('生成の終了を確認してから変更してください');
      applyPrompt(value);
    },
    operation, generate, cloud, label: plan.label,
  });
  const agentStarted=useRef(false);
  useEffect(()=>{
    if(!agentRequest||agentStarted.current)return;
    agentStarted.current=true;
    void runQwenAgentRequest(agentRequest,async()=>{},conversationSend);
  },[agentRequest,conversationSend]);
  async function check(id:string){await operation(async()=>{
    const expected=job?.jobId===id?job:history.find(item=>item.jobId===id);
    const result=await withNewCreationBridgeSession(()=>reconcileQwenJob(id,expected?.requestSha256));
    if(alive.current){setJob(result);setAttempt(id);setSelectedCandidate(result.selectedCandidate??result.selectedCandidates?.[0]??null);setSelectedCandidates(result.selectedCandidates??[]);if(insertedBatch.current!==id)insertedBatch.current=null;}
  });}
  useEffect(()=>{
    if(busy||!job||!['queued','running','outcome_unknown'].includes(job.status)||!attempt)return;
    let current=true,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{
        const value=await withNewCreationBridgeSession(()=>reconcileQwenJob(attempt,job.requestSha256));
        if(current)setJob(value);
      }catch(cause){if(current)setError(String(cause));}
      if(current)timer=setTimeout(poll,5000);
    };
    timer=setTimeout(poll,5000);
    return()=>{current=false;clearTimeout(timer);};
  },[busy,job?.jobId,job?.status,job?.requestSha256,attempt]);
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
    if(!job)return;
    if(job.candidateCutout){
      const indices=job.selectedCandidates??[...selectedCandidates].sort((a,b)=>a-b);
      if(!indices.length)return;
      await operation(async()=>{
        await ensureComfy(job.comfyuiUrl??connection.comfyuiUrl);
        const result=job.selectedCandidates?job:await withNewCreationBridgeSession(()=>selectQwenCandidate(job,indices));
        if(alive.current)setJob(result);
        if(insertedBatch.current!==job.jobId){
          const files=candidateFilesFromJob(result,indices);
          await insertImage(files,generatedTarget.current?.jobId===job.jobId?generatedTarget.current.plan:undefined,true,{jobId:job.jobId,indices});
          insertedBatch.current=job.jobId;
        }
        setPhase('未採用画像を削除中');
        const finished=await withNewCreationBridgeSession(()=>selectQwenCandidate(result,indices,true));
        if(alive.current){setJob(finished);await releaseComfy();onClose();}
      });
      return;
    }
    if(selectedCandidate===null)return;
    await operation(async()=>{
      setPhase(job.requiresCutout?'選んだ画像の背景を透過中':'選んだ画像を準備中');
      const result=await withNewCreationBridgeSession(()=>selectQwenCandidate(job,selectedCandidate));
      if(alive.current)setJob(result);
    });
  }
  function chooseCandidate(index:number){
    setSelectedCandidate(index);
    if(!job?.candidateCutout||job.selectedCandidates)return;
    setSelectedCandidates(previous=>previous.includes(index)?previous.filter(item=>item!==index):[...previous,index]);
  }
  async function insert(){if(job)await operation(()=>insertResult(job));}
  function keydown(event:KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();void closeDialog();}
    if(event.key==='Tab'){
      const items=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')??[]).filter(el=>!el.hidden);
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }
  return createPortal(<div class="layer-generation-backdrop" onKeyDown={keydown}>
    <section ref={dialog} class="layer-generation-dialog qwen-generation-dialog qwen-with-conversation" role="dialog" aria-modal="true" aria-labelledby="qwen-generation-title">
      <header><div><h2 id="qwen-generation-title">生成</h2><p>{cloudApi?`クラウドAPI（${execution.cloud.apiModel.trim()||'gemini-3.1-flash-image'}）`:cloud?'外部エージェント（JSON）で生成':workflow?.name??'ComfyUIワークフロー'} · {plan.scope==='page'?'ページ全体':plan.overlay?'ページ前景':`コマ ${plan.panelId}`} · {plan.label}</p></div><button ref={close} onClick={()=>void closeDialog()}>閉じる</button></header>
      <div class="qwen-conversation-layout"><div class="qwen-generation-controls">
      {!cloud&&<div class="qwen-output-size">
        {workflow?<p>ワークフロー：{workflow.name} · 版{workflow.version} · 参照画像{workflow.binding.images.length}枚
          {workflow.binding.fixed_size&&` · 固定寸法 ${workflow.binding.fixed_size[0]} × ${workflow.binding.fixed_size[1]} px（原稿には縦横比を保って配置）`}</p>
          :<p role={missingWorkflow?'alert':'status'}>{missingWorkflow||'ワークフローを確認しています…'}</p>}
        {onOpenSettings&&<button disabled={busy} onClick={onOpenSettings}>環境設定を開く</button>}
      </div>}
      {plan.compositionImage&&<fieldset><legend>送信する紙面</legend><figure class="qwen-paint-reference"><img src={plan.compositionImage} alt={`${plan.label}の参照画像`}/><figcaption>人物配置・コマ形状・フキダシと文字の参照</figcaption></figure></fieldset>}
      {usesPoseImage&&<fieldset disabled={busy||Boolean(attempt)}><legend>送信する3Dポーズ</legend>
        {poseImage?<figure class="qwen-paint-reference"><img src={poseImage} alt="描写範囲に合わせた3Dポーズ参照"/></figure>
          :poseError?<><p role="alert">{poseError}</p><button onClick={()=>setPoseAttempt(value=>value+1)}>撮影を再試行</button></>:null}
      </fieldset>}
      {!plan.scope&&!threeImages&&!twoImagesPromptless&&!cloudApi&&<fieldset disabled={busy||Boolean(attempt)}><legend>「{plan.label}」フォルダのレイヤー</legend>
        <p>参照画像とピンポイント修正用を、それぞれ1枚まで選べます。どちらも任意です。</p>
        <div class="qwen-layer-inputs">{(['reference','correction'] as const).map(slot=>{
          const selected=slot==='reference'?reference:correction;
          const label=slot==='reference'?'参照画像':'ピンポイント修正用';
          return <div class="qwen-layer-input"><label>{label}<select aria-label={label} value={selected?.id??''} onChange={e=>void selectLayer(slot,e.currentTarget.value)}>
            <option value="">使わない</option>{layers.map(layer=><option value={layer.id} disabled={layer.empty}>{layer.label}{layer.empty?'（空・濃度0%）':layer.hidden?'（非表示）':''}</option>)}
          </select></label>{selected&&<figure class="qwen-paint-reference"><img src={selected.image} alt={`${label}：${selected.label}`}/><figcaption>{selected.label}</figcaption></figure>}</div>;
        })}</div>
        {!layers.length&&<p>このフォルダには参照できるレイヤーがありません。</p>}
        <p>修正用には、直したい場所を囲んだ画像、書き込み、マスクを選びます。修正内容は下の生成指示に入力できます。</p>
        {correction&&!reference&&<p>参照画像を使わない場合は、元の絵に書き込みを加えたレイヤーを選んでください。マスクだけの場合は参照画像も必要です。</p>}
      </fieldset>}
      {(twoImagesPromptless||cloudApi)&&<>
        {(twoImagesPromptless||plan.characterKeys.length>0)&&<fieldset disabled={busy||Boolean(attempt)}><legend>{twoImagesPromptless?'image_1 (edited) · キャラクター設定画':'キャラクター設定画'}</legend>
          {sourceErrors.character&&<><p role="alert">{sourceErrors.character}</p><button onClick={()=>retryCharacter(x=>x+1)}>設定画の読み込みを再試行</button></>}
          {plan.candidates.length>0&&<label>使用する設定画<select aria-label="使用するキャラクター設定画" value={selectedCharacterAssetId||plan.candidates[0].source.asset_id}
            onChange={e=>setSelectedCharacterAssetId(e.currentTarget.value)}>
            {plan.candidates.map(candidate=>{
              const viewLabel=CHARACTER_REFERENCE_VIEWS.find(v=>v.value===candidate.view)?.label;
              return <option key={candidate.source.asset_id} value={candidate.source.asset_id}>{candidate.label}{viewLabel?`（${viewLabel}）`:''}</option>;
            })}
          </select></label>}
          <div class="qwen-reference-list">{linked.map(ref=><figure key={ref.characterKeys.join()+ref.label}><img src={ref.image} alt={`キャラクター設定画：${ref.label}`}/><figcaption>{ref.label}</figcaption></figure>)}</div>
          {!plan.candidates.length&&<label class="qwen-file-label">{twoImagesPromptless?'image_1 を選択':'設定画を選択'}<ProjectFileInput accept="image/png,image/jpeg,image/webp" onFiles={addFiles}/></label>}
        </fieldset>}
        {!plan.scope&&<fieldset disabled={busy||Boolean(attempt)}><legend>{twoImagesPromptless?'image_2 (reference) · ポーズ / レイヤー参照':'参照画像（あたり / レイヤー）'}</legend>
          <div class="qwen-layer-inputs"><div class="qwen-layer-input"><label>参照レイヤー<select aria-label="参照画像" value={reference?.id??''} onChange={e=>void selectLayer('reference',e.currentTarget.value)}>
            <option value="">使わない</option>{layers.map(layer=><option value={layer.id} disabled={layer.empty}>{layer.label}{layer.empty?'（空・濃度0%）':layer.hidden?'（非表示）':''}</option>)}
          </select></label>{reference&&<figure class="qwen-paint-reference"><img src={reference.image} alt={`参照画像：${reference.label}`}/><figcaption>{reference.label}</figcaption></figure>}</div></div>
          <label class="qwen-file-label">参照画像ファイルを追加<ProjectFileInput accept="image/png,image/jpeg,image/webp" onFiles={addFiles}/></label>
          {extra.map((ref,index)=><figure key={index} class="qwen-paint-reference"><img src={ref.image} alt={ref.label}/><button onClick={()=>setExtra(previous=>previous.filter((_,i)=>i!==index))}>外す</button></figure>)}
        </fieldset>}
      </>}
      {!twoImagesPromptless&&!cloudApi&&plan.characterKeys.length>0&&<fieldset disabled={busy||Boolean(attempt)}><legend>{threeImages?'image2 · キャラクター設定画':'キャラクター設定画'}</legend>
        {sourceErrors.character&&<><p role="alert">{sourceErrors.character}</p><button onClick={()=>retryCharacter(x=>x+1)}>設定画の読み込みを再試行</button></>}
        <div class="qwen-reference-list">{linked.map(ref=><figure key={ref.characterKeys.join()}><img src={ref.image} alt={threeImages?`image2 キャラクター設定画：${ref.label}`:ref.label}/><figcaption>{ref.label}</figcaption></figure>)}</div>
        {!threeImages&&<><label class="qwen-file-label">参考画像を追加<ProjectFileInput accept="image/png,image/jpeg,image/webp" multiple onFiles={addFiles}/></label>
          {extra.map((ref,index)=><figure class="qwen-paint-reference"><img src={ref.image} alt={ref.label}/><button onClick={()=>setExtra(previous=>previous.filter((_,i)=>i!==index))}>外す</button></figure>)}</>}
      </fieldset>}
      {Boolean(plan.contentKind)&&<div class="qwen-output-size"><output>{qwenGenerationSizePrompt(plan,Boolean(correction),workflow?.binding.fixed_size??undefined)}</output><div>生成範囲：{plan.generationArea&&!correction?'生成マスクの外接矩形':'フォルダーのキャンバス全体'} · 生成解像度：{cloud?'指定サイズ':workflow?.binding.fixed_size?workflow.binding.fixed_size.join(' × '):'縦横比に合わせて調整'}</div></div>}
      {!cloud&&!twoImagesPromptless&&<label class="qwen-prompt">{defaultNegative!==undefined?'ポジティブプロンプト':'生成指示'}<textarea rows={8} value={waitingForWorkflow?'':prompt} disabled={busy||!canPrepareNewGeneration||waitingForWorkflow} onInput={e=>updatePrompt(e.currentTarget.value)}/></label>}
      {twoImagesPromptless&&<p class="environment-settings-note">このワークフローはにゃむる側からプロンプトを送信しません（ワークフロー内の固定指示を使用します）。</p>}
      {!cloud&&defaultUpsampler!==undefined&&<label class="qwen-checkbox"><input type="checkbox" checked={Boolean(usePromptUpsampler)} disabled={busy||!canPrepareNewGeneration} onChange={e=>{if(attempted.current)prepareNewGeneration();setUpsampler(e.currentTarget.checked);}}/>プロンプト自動補強（Prompt Upsampler）を使う（負荷が増えます）</label>}
      {threeImages&&<output class="qwen-prompt">Uniform solid {chromaKeyColor} background.</output>}
      {!cloud&&!twoImagesPromptless&&defaultNegative!==undefined&&<label class="qwen-prompt">ネガティブプロンプト<textarea rows={3} maxLength={12000} value={negative} disabled={busy||!canPrepareNewGeneration} onInput={e=>{if(attempted.current)prepareNewGeneration();setNegative(e.currentTarget.value);}}/></label>}
      <div class="paint-entry-actions">
        <button class="primary-button" disabled={!readiness.ready} onClick={()=>void generate()}>{cloudAgent?'生成用JSONを書き出す':'生成'}</button>
        {cloudAgent&&<button disabled={busy} onClick={()=>void importGenerated()}>生成画像を読み込む</button>}
        {!cloud&&<><button disabled={busy} aria-pressed={historyScope==='owner'} onClick={()=>void loadHistory('owner')}>生成履歴</button>
        <button disabled={busy} aria-pressed={historyScope==='work'} onClick={()=>void loadHistory('work')}>作品の生成履歴</button></>}
      </div>
      {!cloud&&(busy||job&&['queued','running','outcome_unknown'].includes(job.status))&&<button onClick={()=>void cancelGeneration()}>この生成を取り消す</button>}
      {notice&&<p role="status">{notice}</p>}
      {attempt&&!busy&&!job&&canPrepareNewGeneration&&<button onClick={prepareNewGeneration}>新しい生成を準備</button>}
      {error&&<p role="alert">{error}{attempt&&((submitted.current&&!job)||job?.status==='outcome_unknown')?' 送信済みの可能性があるため、自動で照合しています。':''}</p>}
      {job && <GenerationCandidates
        job={job} busy={busy} selectedCandidate={selectedCandidate} selectedCandidates={selectedCandidates}
        inserted={insertedBatch.current === job.jobId} canPrepareNewGeneration={canPrepareNewGeneration}
        onChoose={chooseCandidate} onSelect={selectCandidate} onInsert={insert}
        onRemove={() => remove([job])} onPrepare={prepareNewGeneration}
      />}
      {historyScope&&<section class="qwen-history" aria-label={historyScope==='work'?'作品の生成履歴':'生成履歴'}>
        <h3>{historyScope==='work'?'作品の生成履歴':'生成履歴'}</h3>
        <p>{historyScope==='work'?'作品内の全ページ・全コマの生成画像です。ファイル名を押すと画像を確認し、現在の対象へ新規レイヤーとして追加できます。':'現在のあたりで生成した画像です。'} チェックした履歴は「削除」でまとめて消せます。</p>
        {history.length===0?<p>生成履歴はありません。</p>:<>
          <div class="paint-entry-actions"><label><input type="checkbox" disabled={busy||!history.some(canDeleteQwenJob)} checked={history.filter(canDeleteQwenJob).length>0&&history.filter(canDeleteQwenJob).every(item=>selectedJobs.includes(item.jobId))} onChange={e=>setSelectedJobs(e.currentTarget.checked?history.filter(canDeleteQwenJob).map(item=>item.jobId):[])}/> 全て選択</label><button disabled={busy||selectedJobs.length===0} onClick={()=>void remove(history.filter(item=>selectedJobs.includes(item.jobId)))}>削除</button><span>{selectedJobs.length}件を選択</span></div>
          <ul>{history.map(item=><li key={item.jobId}>
            <input type="checkbox" aria-label={`${item.fileName??item.jobId}を削除対象に選ぶ`} disabled={busy||!canDeleteQwenJob(item)} checked={selectedJobs.includes(item.jobId)} onChange={e=>setSelectedJobs(ids=>e.currentTarget.checked?[...ids,item.jobId]:ids.filter(id=>id!==item.jobId))}/>
            <div><button class="qwen-history-file" disabled={busy} onClick={()=>void check(item.jobId)}>{item.fileName??item.jobId}</button><small>{qwenJobLocation(item)} · {generationStatusLabel[item.status]}</small></div>
          </li>)}</ul>
        </>}
      </section>}
      </div><aside class="qwen-conversation-host" aria-label="生成の会話" ref={onConversationHost}/></div>
    </section>
  </div>,document.body);
}
