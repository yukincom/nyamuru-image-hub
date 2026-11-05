export { qwenInputImage, qwenLayerImage } from './generation/inputImages.ts';
import type { ComponentProps } from 'preact';
import FigureHumanPoseEditor from './FigureHumanPoseEditor';
import type { HumanPoseTextSelection } from '../lib/humanPoseTypes.ts';
import type { FigureSize, BBox } from '../types.ts';
import { type QwenGenerationPlan, type QwenAgentRequest, type QwenLayerCandidate, type QwenAdoption, type QwenGenerationConversation, type QwenLayerReference, type QwenReference, qwenPlanForWorkflow, figureBackgroundPrompt, type QwenJob, type QwenHistoryScope, qwenConversationIntent, runQwenAgentRequest, canDeleteQwenJob, qwenGenerationSizePrompt, qwenJobLocation } from '../lib/qwenGeneration.ts';
import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import { currentGenerationPreferences } from '../lib/generationPreferences.ts';
import { currentLocalModelPreferences } from '../lib/localModelPreferences.ts';
import { type ComfyWorkflowDefinition, parseComfyWorkflowList, QWEN_FIGURE_WORKFLOW, standardQwenWorkflowId, workflowNegativePrompt } from '../lib/comfyWorkflows.ts';
import { requestComfyWorkflows, cancelQwenJob, blobDataUrl, reconcileQwenJob, listQwenJobs, deleteQwenJobs, selectQwenCandidate } from '../lib/localBridge.ts';
import { stopImageGenerationSessionOnPageExit, startImageGenerationSession, stopImageGenerationSession, imageGenerationProgress, withNewCreationBridgeSession } from '../lib/localBridgeLifecycle.ts';
import { loadFigureCropAsset } from '../lib/figureCropStore.ts';
import { posePreviewSize } from '../lib/humanPoseFraming.ts';
import { useGenerationReferences } from './generation/useGenerationReferences.ts';
import { createGenerationActions } from './generation/createGenerationActions.ts';
import { createPortal } from 'preact/compat';

export type GenerationPoseEditorContext=Pick<ComponentProps<typeof FigureHumanPoseEditor>,'panelContext'|'stages'|'backgroundCaptures'> & {
  onConfirmed?: (value: HumanPoseTextSelection, framing: FigureSize) => void;
};

interface Props { poseEditorContext?:GenerationPoseEditorContext; onOpenSettings?:()=>void; plan:QwenGenerationPlan; adultContent?:boolean; agentRequest?:QwenAgentRequest; layers?:QwenLayerCandidate[]; loadLayer?:(id:string,correction:boolean,crop?:BBox,native?:boolean)=>Promise<string>; onClose:()=>void; onInsert:(file:File|File[],target:QwenGenerationPlan,adoption?:QwenAdoption)=>Promise<void>; onConversation?:(value:QwenGenerationConversation|null)=>void; onConversationHost?:(host:HTMLElement|null)=>void }

const statusLabel={preparing:'入力を準備中',prepared:'生成準備済み',queued:'生成待ち',running:'生成中',succeeded:'生成完了',failed:'失敗',outcome_unknown:'結果未確定'};

export default function ImageGenerationDialog({poseEditorContext,onOpenSettings,plan:sourcePlan,adultContent=false,agentRequest,layers=[],loadLayer,onClose,onInsert,onConversation,onConversationHost}:Props){
  const [execution]=useState(currentGenerationPreferences);
  const cloud=execution.execution==='cloud';
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
  const person=sourcePlan.ownerKey.startsWith('figure-')&&sourcePlan.characterKeys.length===1;
  const [repair,setRepair]=useState(false);
  const automatic=chosen?.id===QWEN_FIGURE_WORKFLOW;
  const threeImages=chosen?.binding.prompt_mode==='qwen-three-images'&&(!automatic||person&&!repair);
  const [poseDraft,setPoseDraft]=useState<{selection:HumanPoseTextSelection;framing:FigureSize}>();
  const [reference,setReference]=useState<QwenLayerReference>(),[correction,setCorrection]=useState<QwenLayerReference>();
  const [linked,setLinked]=useState<QwenReference[]>([]),[extra,setExtra]=useState<QwenReference[]>([]);
  const [sourceErrors,setSourceErrors]=useState({expression:'',character:''});
  const [expressionRetry,retryExpression]=useState(0),[characterRetry,retryCharacter]=useState(0);
  const [characterLoading,setCharacterLoading]=useState(Boolean(sourcePlan.characterKeys.length));
  const [sketchLoading,setSketchLoading]=useState(false);
  const references=useMemo(()=>[...linked,...extra],[linked,extra]);
  const basePlan=useMemo(()=>{
    if(!threeImages)return sourcePlan;
    const selection=poseDraft?.selection??sourcePlan.humanPose?.selection;
    return {...sourcePlan,humanPose:selection?{selection:{...selection,input_mode:'image' as const},
      framing:poseDraft?.framing??sourcePlan.figureFraming??sourcePlan.humanPose?.framing??'bust-up',
      aspect:sourcePlan.threeImageTarget?.cutFrame.aspect}:undefined};
  },[sourcePlan,threeImages,poseDraft]);
  const usesPoseImage=basePlan.humanPose?.selection.input_mode==='image';
  const expectedInputs=references.length+Number(Boolean(reference))+Number(Boolean(correction))+Number(usesPoseImage)+Number(Boolean(sourcePlan.compositionImage));
  const workflow=automatic&&!threeImages?registry.find(item=>item.id===standardQwenWorkflowId(expectedInputs))??null:chosen??null;
  const missingWorkflow=workflowError || (chosen&&!workflow?'この参照枚数に対応する通常Qwen定義がありません':'');
  const [outputScale,setOutputScale]=useState(0.6);
  const plan=useMemo(()=>qwenPlanForWorkflow(basePlan,workflow,outputScale),[basePlan,workflow,outputScale]);
  const targetError=threeImages&&!plan.threeImages?'人物3枚参照には対象のコマまたは生成マスクを指定してください':'';
  const waitingForWorkflow=!cloud&&!chosen;
  const figureChroma=plan.ownerKey.startsWith('figure-')&&(threeImages||workflow?.binding.prompt_mode==='qwen');
  const [editedPrompt,setPrompt]=useState<string>(),[editedNegative,setNegative]=useState<string>();
  const defaultNegative=workflowNegativePrompt(workflow),negative=editedNegative??defaultNegative;
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
  const observing=busy&&phase==='5枚の画像を生成中';
  useEffect(()=>{
    const progress=job?.progress,token=comfySession.current;
    if(!observing||!progress||!token){setComfyPhase('');return;}
    let active=true,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{
        const node=await imageGenerationProgress(token,progress);
        if(active)setComfyPhase(`候補 ${progress.candidate}/${progress.total}：${node&&progress.nodes[node]||'ComfyUIの実行工程を確認中'}`);
      }catch{if(active)setComfyPhase(`候補 ${progress.candidate}/${progress.total}：ComfyUIの接続を確認中`);}
      if(active)timer=setTimeout(poll,500);
    };
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[observing,job?.progress?.clientId,job?.progress?.promptId]);
  useEffect(()=>{
    setPoseImage('');setPoseError('');posePending.current=undefined;
    if(!usesPoseImage||!plan.humanPose?.selection.scene||targetError||waitingForWorkflow)return;
    let cancelled=false;
    const {selection,framing,aspect,cutFrame}=plan.humanPose;
    const capture = async () => {
      const saved = threeImages && selection.preview;
      if (saved) {
        const blob = await loadFigureCropAsset(saved.assetId);
        if (!blob) throw new Error('確定した3Dプレビューを読み込めません');
        return blobDataUrl(blob);
      }
      const {captureHumanPoseReference} = await import('../lib/humanPoseGeneration.ts');
      return captureHumanPoseReference(selection,framing,aspect??plan.width/plan.height,cutFrame,threeImages&&basePlan.threeImageTarget?posePreviewSize(basePlan.threeImageTarget):undefined,poseEditorContext?.stages);
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
  const { selectLayer, addFiles } = useGenerationReferences({ setLinked, setCharacterLoading, sourcePlan, setSourceErrors, threeImages, characterRetry, setSketchLoading, setReference, expressionRetry, operation, attempted, draft, referenceLimit, usesPoseImage, alive, setExtra, layers, loadLayer, reference, correction, plan, prompt, setPrompt, setCorrection });
  const { generate, insertImage, insertResult, importGenerated } = createGenerationActions({ generatedTarget, plan, draft, onInsert, operation, attempted, targetError, threeImages, usesPoseImage, generationAbort, alive, setPhase, posePending, workflow, cloud, execution, adultContent, setNotice, missingWorkflow, connection, defaultNegative, negative, figureChroma, chromaKeyColor, ensureComfy, submitted, setAttempt, setJob, comfySession });
  async function conversationSend(text:string,isCurrent:()=>boolean){
    if(!alive.current||!isCurrent())return '生成の会話を終了しました';
    const intent=qwenConversationIntent(text);
    if(intent==='hold')return '新しい生成は開始していません。指示を整えてから「生成して」と送ってください。';
    if(intent==='help')return '追加の指示を送れます。「生成して」と送ると、シードを変えた5枚を表示します。画面で採用する画像を選んでください。';
    if(intent==='instruction'){
      if(working.current)throw new Error('処理が終わるまでお待ちください');
      if(attempted.current)throw new Error('この生成は開始済みです');
      if(draft.current.prompt.length+text.length>12000)throw new Error('追加の指示が長すぎます。生成指示を整理してください');
      updatePrompt(`${draft.current.prompt}\n\n${text.trim()}`);
      return '追加の指示を生成指示に反映しました。「生成して」で5枚を生成します。採用する画像は画面で選んでください。';
    }
    const result=await generate(true,isCurrent);
    if(cloud)return '指示と参照画像のZIPを保存しました。指定のエージェントへ渡し、完成したPNGをこの画面で読み込んでください。';
    if(result?.job?.candidates?.length){
      if(result.job.status==='succeeded'&&result.job.candidates.length===5)return `${plan.label}の候補を5枚生成しました。画面で採用する画像を選んでください。`;
      return `候補${result.job.candidates.length}枚を保持しています。${result.job.error||'生成は完了していません。状態を自動で確認しています。'}`;
    }
    return result?.inserted?`${plan.label}を生成し、新規レイヤーとして追加しました。元に戻す操作も使えます。`:'自動差し込みは中止しました。';
  }
  useEffect(()=>{
    onConversation?.({label:`${plan.pageNumber}ページ・${plan.overlay?'ページ前景':`コマ ${plan.panelId}`}・${plan.label}`,
      busy:busy||characterLoading||sketchLoading,locked:Boolean(attempt),phase:comfyPhase||phase,send:conversationSend});
  },[onConversation,busy,attempt,phase,comfyPhase,prompt,references,reference,correction,job,workflow,workflowError,chromaKeyColor,negative,characterLoading,sketchLoading,poseImage,plan]);
  useEffect(()=>()=>onConversation?.(null),[onConversation]);
  const agentStarted=useRef(false);
  useEffect(()=>{
    if(!agentRequest||agentStarted.current)return;
    if(!cloud&&!workflow){
      if(workflowError){agentStarted.current=true;agentRequest.reject(new Error(workflowError));}
      return;
    }
    if(characterLoading||sketchLoading||threeImages&&sourcePlan.expressionSource&&!reference&&!sourceErrors.expression)return;
    agentStarted.current=true;
    void runQwenAgentRequest(agentRequest,async()=>{},conversationSend);
  },[agentRequest,workflow,workflowError,characterLoading,sketchLoading,threeImages,reference,sourceErrors]);
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
      if(current)timer=setTimeout(poll,2000);
    };
    timer=setTimeout(poll,2000);
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
          const files=indices.map(index=>{
            const image=result.candidates?.find(candidate=>candidate.index===index)?.image;
            if(!image)throw new Error('採用する候補を読み込めません');
            return new File([Uint8Array.from(atob(image.split(',')[1]),char=>char.charCodeAt(0))],`qwen_${job.jobId}_${index}.png`,{type:'image/png'});
          });
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
      <header><div><h2 id="qwen-generation-title">生成</h2><p>{cloud?'クラウドへ渡す画像と指示':workflow?.name??'ComfyUIワークフロー'} · {plan.scope==='page'?'ページ全体':plan.overlay?'ページ前景':`コマ ${plan.panelId}`} · {plan.label}</p></div><button ref={close} onClick={()=>void closeDialog()}>閉じる</button></header>
      <div class="qwen-conversation-layout"><div class="qwen-generation-controls">
      {!cloud&&<div class="qwen-output-size">
        {workflow?<p>ワークフロー：{workflow.name} · 版{workflow.version} · 参照画像{workflow.binding.images.length}枚
          {workflow.binding.fixed_size&&` · 固定寸法 ${workflow.binding.fixed_size[0]} × ${workflow.binding.fixed_size[1]} px（原稿には縦横比を保って配置）`}</p>
          :<p role={missingWorkflow?'alert':'status'}>{missingWorkflow||'ワークフローを確認しています…'}</p>}
        {onOpenSettings&&<button disabled={busy} onClick={onOpenSettings}>環境設定を開く</button>}
      </div>}
      {plan.threeImages&&!workflow?.binding.fixed_size&&<label>生成サイズ<select aria-label="3枚参照の生成サイズ" value={outputScale} disabled={busy||Boolean(attempt)} onChange={event=>setOutputScale(Number(event.currentTarget.value))}>
        {[0.4,0.5,0.6].map(scale=><option key={scale} value={scale}>原稿の{Math.round(scale*100)}%</option>)}
      </select> {plan.width} × {plan.height} px</label>}
      {targetError&&<p role="alert">{targetError}</p>}
      {!cloud&&figureChroma&&<label>透過用の背景色
        <select aria-label="透過用の背景色" value={chromaKeyColor} disabled={busy||Boolean(attempt)} onChange={event=>{const color=event.currentTarget.value;setChromaKeyColor(color);if(threeImages&&editedPrompt!==undefined)setPrompt(figureBackgroundPrompt(editedPrompt,color));}}>
          <option value="#00FF00">緑</option><option value="#0000FF">青</option><option value="#FF00FF">マゼンタ</option>
        </select>
      </label>}
      {plan.compositionImage&&<fieldset><legend>送信する紙面</legend><figure class="qwen-paint-reference"><img src={plan.compositionImage} alt={`${plan.label}の参照画像`}/><figcaption>人物配置・コマ形状・フキダシと文字の参照</figcaption></figure></fieldset>}
      {automatic&&person&&<label>生成方法<select value={repair?'repair':'figure'} disabled={busy||Boolean(attempt)} onChange={e=>{
        setRepair(e.currentTarget.value==='repair');setReference(undefined);setCorrection(undefined);setExtra([]);setPrompt(undefined);setNegative(undefined);
      }}><option value="figure">人物3枚参照</option><option value="repair">ピンポイント修正</option></select></label>}
      {(threeImages||usesPoseImage)&&<fieldset disabled={busy||Boolean(attempt)}><legend>{threeImages?'image1 · 3Dモデル調整':'送信する3Dポーズ'}</legend>
        {threeImages&&person&&<FigureHumanPoseEditor imageSlot {...poseEditorContext} previewSize={sourcePlan.threeImageTarget} value={plan.humanPose?.selection}
          framingSize={plan.humanPose?.framing??sourcePlan.figureFraming} aspect={sourcePlan.threeImageTarget?.cutFrame.aspect} cutFrame={sourcePlan.threeImageTarget?.cutFrame}
          onChange={(value,framing)=>{
            if (!value) return;
            const selection = {...value, input_mode:'image' as const};
            const size = framing ?? plan.humanPose?.framing ?? sourcePlan.figureFraming ?? 'bust-up';
            poseEditorContext?.onConfirmed?.(value, size);
            setPoseDraft({selection, framing:size});
          }}/>}
        {poseImage?<figure class="qwen-paint-reference"><img src={poseImage} alt={threeImages?'image1 3Dポーズ':'描写範囲に合わせた3Dポーズ参照'}/></figure>
          :poseError?<><p role="alert">{poseError}</p><button onClick={()=>setPoseAttempt(value=>value+1)}>撮影を再試行</button></>:null}
      </fieldset>}
      {!plan.scope&&!threeImages&&<fieldset disabled={busy||Boolean(attempt)}><legend>「{plan.label}」フォルダのレイヤー</legend>
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
      {plan.characterKeys.length>0&&<fieldset disabled={busy||Boolean(attempt)}><legend>{threeImages?'image2 · キャラクター設定画':'キャラクター設定画'}</legend>
        {sourceErrors.character&&<><p role="alert">{sourceErrors.character}</p><button onClick={()=>retryCharacter(x=>x+1)}>設定画の読み込みを再試行</button></>}
        <div class="qwen-reference-list">{linked.map(ref=><figure key={ref.characterKeys.join()}><img src={ref.image} alt={threeImages?`image2 キャラクター設定画：${ref.label}`:ref.label}/><figcaption>{ref.label}</figcaption></figure>)}</div>
        {!threeImages&&<><label class="qwen-file-label">参考画像を追加<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e=>{const files=Array.from(e.currentTarget.files??[]);e.currentTarget.value='';void addFiles(files);}}/></label>
          {extra.map((ref,index)=><figure class="qwen-paint-reference"><img src={ref.image} alt={ref.label}/><button onClick={()=>setExtra(previous=>previous.filter((_,i)=>i!==index))}>外す</button></figure>)}</>}
      </fieldset>}
      {threeImages&&<fieldset disabled={busy||Boolean(attempt)}><legend>image3 · ネームの表情</legend>
        {reference&&<figure class="qwen-paint-reference"><img src={reference.image} alt="image3 ネームの表情"/></figure>}
        {sourceErrors.expression&&<p role="alert">{sourceErrors.expression}</p>}
        {(!sourcePlan.expressionSource||sourceErrors.expression)&&<label>ネームのレイヤー<select aria-label="ネームのレイヤー" value={reference?.id??''} onChange={e=>void selectLayer('reference',e.currentTarget.value)}>
          <option value="">選択してください</option>{layers.filter(layer=>!layer.empty).map(layer=><option value={layer.id}>{layer.label}</option>)}</select></label>}
        {sourceErrors.expression&&<button onClick={()=>retryExpression(x=>x+1)}>読み込みを再試行</button>}
      </fieldset>}
      {Boolean(plan.contentKind)&&<div class="qwen-output-size"><output>{qwenGenerationSizePrompt(plan,Boolean(correction),workflow?.binding.fixed_size??undefined)}</output><div>生成範囲：{plan.generationArea&&!correction?'生成マスクの外接矩形':'フォルダーのキャンバス全体'} · 生成解像度：{cloud?'指定サイズ':workflow?.binding.fixed_size?workflow.binding.fixed_size.join(' × '):'縦横比に合わせて調整'}</div></div>}
      {threeImages&&plan.threeImages&&<output>{plan.width} × {plan.height} px · {plan.dpi} dpi</output>}
      <label class="qwen-prompt">{defaultNegative!==undefined?'ポジティブプロンプト':'生成指示'}<textarea rows={8} value={waitingForWorkflow?'':prompt} disabled={busy||!canPrepareNewGeneration||waitingForWorkflow} onInput={e=>updatePrompt(e.currentTarget.value)}/></label>
      {threeImages&&<output class="qwen-prompt">Uniform solid {chromaKeyColor} background.</output>}
      {defaultNegative!==undefined&&<label class="qwen-prompt">ネガティブプロンプト<textarea rows={3} maxLength={12000} value={negative} disabled={busy||!canPrepareNewGeneration} onInput={e=>{if(attempted.current)prepareNewGeneration();setNegative(e.currentTarget.value);}}/></label>}
      <div class="paint-entry-actions">
        <button class="primary-button" disabled={busy||Boolean(attempt)||characterLoading||Boolean(sourceErrors.character)||usesPoseImage&&!poseImage||!cloud&&!workflow||threeImages&&(!!targetError||!reference||!poseImage||references.length!==1)} onClick={()=>void generate()}>{cloud?'指示と参照画像を書き出す':'5枚を生成する'}</button>
        {cloud&&<button disabled={busy} onClick={()=>void importGenerated()}>生成画像を読み込む</button>}
        {!cloud&&<><button disabled={busy} aria-pressed={historyScope==='owner'} onClick={()=>void loadHistory('owner')}>生成履歴</button>
        <button disabled={busy} aria-pressed={historyScope==='work'} onClick={()=>void loadHistory('work')}>作品の生成履歴</button></>}
      </div>
      {!cloud&&(busy||job&&['queued','running','outcome_unknown'].includes(job.status))&&<button onClick={()=>void cancelGeneration()}>この生成を取り消す</button>}
      {notice&&<p role="status">{notice}</p>}
      {attempt&&!busy&&!job&&canPrepareNewGeneration&&<button onClick={prepareNewGeneration}>新しい生成を準備</button>}
      {error&&<p role="alert">{error}{attempt&&((submitted.current&&!job)||job?.status==='outcome_unknown')?' 送信済みの可能性があるため、自動で照合しています。':''}</p>}
      {job&&<section class="qwen-result" aria-live="polite"><strong>{statusLabel[job.status]}</strong>{job.error&&<p>{job.error}</p>}
        {job.workflowName&&<p>{job.workflowName} · 版{job.workflowVersion} · {job.width} × {job.height} px</p>}
        {job.generationPrompt&&<details><summary>送信した指示とシード</summary><pre style={{whiteSpace:'pre-wrap'}}>{job.generationPrompt}</pre><p>{job.candidateSeeds?.join(', ')}</p></details>}
        {job.documentKey&&<small>{qwenJobLocation(job)}</small>}
        {job.candidates?.length&&!job.image&&<>
          <div class="qwen-candidates" role="group" aria-label="生成候補">
            {job.candidates.map(candidate=><button type="button" class="qwen-candidate" disabled={busy} aria-pressed={job.candidateCutout?(job.selectedCandidates??selectedCandidates).includes(candidate.index):selectedCandidate===candidate.index} onClick={()=>chooseCandidate(candidate.index)} key={candidate.index}>
              <img src={candidate.image} alt={`候補${candidate.index}・シード${candidate.seed}`}/><span>候補{candidate.index} · seed {candidate.seed}</span>
            </button>)}
          </div>
          {selectedCandidate!==null&&<img class="qwen-candidate-preview" src={job.candidates.find(candidate=>candidate.index===selectedCandidate)?.image} alt={`選択中の候補${selectedCandidate}`}/>}
          <button class="primary-button" disabled={busy||job.status!=='succeeded'||(job.candidateCutout?!(job.selectedCandidates??selectedCandidates).length||job.candidates.length!==5&&!job.selectedCandidates:selectedCandidate===null)} onClick={()=>void selectCandidate()}>{job.candidateCutout?(insertedBatch.current===job.jobId?'未採用画像の削除を再試行':`選択した${(job.selectedCandidates??selectedCandidates).length}枚を追加`):job.requiresCutout?'選んだ1枚の背景を透過する':'選んだ1枚を採用する'}</button>
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
