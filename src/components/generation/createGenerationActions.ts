import type { ProjectFilePicker } from '../../lib/projectFilePicker';
import { type QwenGenerationPlan, type QwenReference, type QwenLayerReference, type QwenAdoption, type QwenJob, qwenGenerationTarget, qwenGenerationPayload, qwenGenerationPrompt, executeQwenGeneration } from '../../lib/qwenGeneration.ts';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { ComfyWorkflowDefinition } from '../../lib/comfyWorkflows.ts';
import { type GenerationPreferences, currentGenerationPreferences } from '../../lib/generationPreferences.ts';
import { resolveGenerationRoute } from '../../lib/modelRouting.ts';
import type { LocalModelPreferences } from '../../lib/localModelPreferences.ts';
import { chooseBrowserFiles, downloadBrowserBlob } from '../../lib/browserFiles.ts';
import { requireHumanPoseGenerationReady } from '../../lib/humanPoseSelection.ts';
import { cloudModelAccess } from '../../lib/modelPrivacy.ts';
import { type AgentWorkflowYamlFile, deliverAgentWorkflowYamlFiles } from '../../lib/generationHandoff.ts';
import { prepareQwenJob, submitQwenJob, reconcileQwenJob } from '../../lib/localBridge.ts';
import { withImageGenerationServices } from '../../lib/localBridgeLifecycle.ts';
import { dataUrlToPngFile, prepareGeneratedInsertionFile } from '../../lib/generation/insertion.ts';

export interface CloudSingleGenerationStart {
  model: string;
  plan: QwenGenerationPlan;
  references: QwenReference[];
  reference?: QwenLayerReference;
  correction?: QwenLayerReference;
  poseImage?: string;
}

interface CreateGenerationActionsInputs {
  chooseFiles?: ProjectFilePicker;
  generatedTarget: Cell<{ jobId?: string; plan: QwenGenerationPlan; } | undefined>;
  plan: QwenGenerationPlan;
  draft: Cell<{ prompt: string; references: QwenReference[]; reference: QwenLayerReference | undefined; correction: QwenLayerReference | undefined; }>;
  onInsert: (file: File | File[], target: QwenGenerationPlan, adoption?: QwenAdoption) => Promise<void>;
  onStartCloudSingle?: (params: CloudSingleGenerationStart) => Promise<void>;
  onClose?: () => void;
  operation: <T>(task: () => Promise<T>, propagate?: boolean) => Promise<T | undefined>;
  attempted: Cell<string | null>;
  targetError: string;
  threeImages: boolean;
  usesPoseImage: boolean;
  generationAbort: Cell<AbortController | undefined>;
  alive: Cell<boolean>;
  setPhase: Dispatch<StateUpdater<string>>;
  posePending: Cell<Promise<string | undefined> | undefined>;
  workflow: ComfyWorkflowDefinition | null;
  cloud: boolean;
  execution: GenerationPreferences;
  adultContent: boolean;
  setNotice: Dispatch<StateUpdater<string>>;
  missingWorkflow: string;
  connection: LocalModelPreferences;
  defaultNegative: string | undefined;
  negative: string | undefined;
  defaultUpsampler?: boolean;
  usePromptUpsampler?: boolean;
  figureChroma: boolean;
  chromaKeyColor: string;
  ensureComfy: (endpoint?: string) => Promise<void>;
  submitted: Cell<boolean>;
  setAttempt: Dispatch<StateUpdater<string | null>>;
  setJob: Dispatch<StateUpdater<QwenJob | null>>;
  comfySession: Cell<string | null>;
  exportAgentYaml?: () => AgentWorkflowYamlFile[];
  saveAgentYaml?: (files: AgentWorkflowYamlFile[]) => Promise<string | null>;
}

export function createGenerationActions({ chooseFiles = chooseBrowserFiles, generatedTarget, plan, draft, onInsert, onStartCloudSingle, onClose, operation, attempted, targetError, threeImages, usesPoseImage, generationAbort, alive, setPhase, posePending, workflow, cloud, execution, adultContent, setNotice, missingWorkflow, connection, defaultNegative, negative, defaultUpsampler, usePromptUpsampler, figureChroma, chromaKeyColor, ensureComfy, submitted, setAttempt, setJob, comfySession, exportAgentYaml, saveAgentYaml }: CreateGenerationActionsInputs) {
  async function insertResult(result:QwenJob){
    if(!result.image||!result.fileName)throw new Error('差し込む画像がありません');
    await insertImage(dataUrlToPngFile(result.image,result.fileName),generatedTarget.current?.jobId===result.jobId?generatedTarget.current.plan:undefined,Boolean(result.workflowId));
  }
  async function insertImage(file:File|File[],capturedTarget?:QwenGenerationPlan,preserveAspect=false,adoption?:QwenAdoption){
    const target=capturedTarget??qwenGenerationTarget(plan,Boolean(draft.current.correction)),files=Array.isArray(file)?file:[file],prepared:File[]=[];
    for(const item of files)prepared.push(await prepareGeneratedInsertionFile(item,target,preserveAspect));
    await onInsert(Array.isArray(file)?prepared:prepared[0],target,adoption);
  }
  async function importGenerated(){
    const files=await chooseFiles('image/png,image/jpeg');
    if(files[0])await operation(()=>insertImage(files[0],generatedTarget.current?.plan));
  }
  async function generate(autoInsert=false,inputIsCurrent:()=>boolean=()=>true){return operation(async()=>{
    if(attempted.current)throw new Error('この生成は開始済みです');
    if(targetError)throw new Error(targetError);
    const route=resolveGenerationRoute(execution,connection,adultContent);
    if(route.kind==='unavailable')throw new Error(route.message);
    if(route.kind==='cloud-api'&&!onStartCloudSingle)throw new Error('クラウドAPI単画像生成が接続されていません');
    const capturedDraft=draft.current,{references,correction}=capturedDraft;
    if(plan.characterKeys?.length && (plan.promptlessTwoImages || route.kind==='cloud-api' ? !references.length : plan.characterKeys.some(key=>!references.some(ref=>ref.characterKeys.includes(key)))))throw new Error('人物に紐づく設定画を読み込めません');
    if(threeImages&&!usesPoseImage)throw new Error('image1で3Dモデルを調整してください');
    if(plan.humanPose)requireHumanPoseGenerationReady(plan.humanPose.selection);
    const abort=new AbortController();generationAbort.current=abort;
    const isCurrent=()=>alive.current&&!abort.signal.aborted&&inputIsCurrent();
    if(usesPoseImage)setPhase('3Dポーズの撮影を確認中');
    const capturedPose=usesPoseImage?await posePending.current:undefined;
    if(!isCurrent())throw new Error('生成を中止しました');
    const target=qwenGenerationTarget(plan,Boolean(correction));
    if(route.kind==='cloud-api'){
      if(!onStartCloudSingle)throw new Error('クラウドAPI単画像生成が接続されていません');
      const access=cloudModelAccess(currentGenerationPreferences(),adultContent);
      if(!access.allowed)throw new Error(access.reason==='adult-terms-required'?'環境設定でクラウドの成人向け利用条件を確認してください':'環境設定でクラウドを選んでください');
      await onStartCloudSingle({
        model:route.model,
        plan:target,
        references,
        reference:capturedDraft.reference,
        correction,
        poseImage:capturedPose,
      });
      onClose?.();
      return {inserted:false};
    }
    if(cloud){
      if(route.kind!=='external-agent')throw new Error('画像生成の実行先を確認してください');
      // A withdrawal during capture cancels handoff; it never selects a different destination.
      const access=cloudModelAccess(currentGenerationPreferences(),adultContent);
      if(!access.allowed)throw new Error(access.reason==='adult-terms-required'?'環境設定でクラウドの成人向け利用条件を確認してください':'環境設定でクラウドを選んでください');
      if(!exportAgentYaml)throw new Error('生成用JSONの書き出し先が接続されていません');
      const agent=route.label;
      const { folderName, fileNames }=await deliverAgentWorkflowYamlFiles(
        exportAgentYaml(),
        saveAgentYaml,
        file => downloadBrowserBlob(new Blob([file.yaml],{type:file.mimeType ?? 'application/json;charset=utf-8'}),file.fileName),
      );
      generatedTarget.current={plan:target};
      const destination = folderName ? `作品フォルダ（${folderName}）に` : `${agent}へ渡す`;
      setNotice(`${destination}生成用JSON（${fileNames.join('、')}）を書き出しました。標準ワークフローとキャラクター資料を使って生成し、完成したPNGを「生成画像を読み込む」で戻してください。生成が終わったらJSONは削除して問題ありません。`);
      return {inserted:false};
    }
    const payload=validateGenerationInputs(plan,capturedDraft,threeImages,workflow,capturedPose);
    if(!workflow)throw new Error(missingWorkflow||'ワークフローを確認しています');
    const workflowPayload={...payload,workflow_id:workflow.id,workflow_version:workflow.version,comfyui_url:connection.comfyuiUrl,
      ...(defaultNegative!==undefined?{negative_prompt:negative}:{}),
      ...(defaultUpsampler!==undefined?{use_prompt_upsampler:Boolean(usePromptUpsampler)}:{}),
      ...(figureChroma?{chroma_key_color:chromaKeyColor,candidate_cutout:true}:plan.ownerKey.startsWith('figure-')?{candidate_cutout:true}:{})};
    await ensureComfy();
    if(!isCurrent())return;
    const id=crypto.randomUUID();
    generatedTarget.current={jobId:id,plan:target};
    submitted.current=false;
    return executeQwenGeneration({id,payload:workflowPayload,plan:target,isCurrent,
      prepare:async(id,payload)=>{
        const prepared=await prepareQwenJob(id,payload);
        attempted.current=id;
        if(alive.current)setAttempt(id);
        return prepared;
      },
      submit:(prepared,token)=>{submitted.current=true;return submitQwenJob(prepared,token);},reconcile:reconcileQwenJob,
      onJob:current=>{if(alive.current)setJob(current);},
      ...(autoInsert?{insert:insertResult}:{}),
      services:(prepare,generate,options)=>withImageGenerationServices(prepare,generate,{...options,runtimeToken:comfySession.current??undefined,signal:abort.signal,requiresLlm:false,
        onPhase:value=>{
        if(alive.current)setPhase({bridge:'準備中',llm:'準備中',translate:'生成指示を保存中',suspend:'文章LLMを停止中',generate:'画像を生成中',restore:'生成後の復帰を確認中'}[value]);
      }}),
    });
  },autoInsert);}
  return { generate, insertImage, insertResult, importGenerated };
}

export type Cell<T> = { current: T };

/** Readiness and submission validate the same payload, without starting services. */
export function validateGenerationInputs(plan: QwenGenerationPlan, draft: CreateGenerationActionsInputs['draft']['current'],
  threeImages: boolean, workflow: ComfyWorkflowDefinition | null, poseImage?: string) {
  const {prompt,references,reference,correction}=draft;
  const sketch=!threeImages&&reference?.kind==='sketch'&&!correction;
  const effectivePlan = workflow?.binding.size_source === 'panel' && plan.panelSize
    ? { ...plan, width: plan.panelSize.width, height: plan.panelSize.height }
    : plan;
  const outputSize = workflow?.binding.fixed_size ?? (workflow?.binding.size_source === 'panel' && plan.panelSize
    ? [plan.panelSize.width, plan.panelSize.height] as const
    : undefined);
  const payload=qwenGenerationPayload({...effectivePlan,prompt,...(effectivePlan.handwrittenPrompt?{handwrittenPrompt:{...effectivePlan.handwrittenPrompt,confirmation:qwenGenerationPrompt(effectivePlan,reference,correction)}}:{})},references,sketch?undefined:reference?.image,sketch?reference?.image:undefined,correction?.image,poseImage,outputSize);
  const inputCount=payload.references.length+Number('paint_image' in payload)+Number('sketch_image' in payload)+Number('correction_image' in payload);
  if(workflow&&inputCount!==workflow.binding.images.length)throw new Error(`${workflow.name}は参照画像${workflow.binding.images.length}枚の定義です。現在は${inputCount}枚です。環境設定で対応する定義を選んでください`);
  return payload;
}
