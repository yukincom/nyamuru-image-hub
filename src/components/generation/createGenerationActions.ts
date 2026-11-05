import { type QwenGenerationPlan, type QwenReference, type QwenLayerReference, type QwenAdoption, type QwenJob, qwenGenerationTarget, qwenGenerationPayload, qwenGenerationPrompt, executeQwenGeneration } from '../../lib/qwenGeneration.ts';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { ComfyWorkflowDefinition } from '../../lib/comfyWorkflows.ts';
import { type GenerationPreferences, currentGenerationPreferences } from '../../lib/generationPreferences.ts';
import type { LocalModelPreferences } from '../../lib/localModelPreferences.ts';
import { chooseBrowserFiles, downloadBrowserBlob } from '../../lib/browserFiles.ts';
import { requireHumanPoseGenerationReady } from '../../lib/humanPoseSelection.ts';
import { cloudModelAccess } from '../../lib/modelPrivacy.ts';
import { generationHandoff } from '../../lib/generationHandoff.ts';
import { prepareQwenJob, submitQwenJob, reconcileQwenJob } from '../../lib/localBridge.ts';
import { withImageGenerationServices } from '../../lib/localBridgeLifecycle.ts';

interface CreateGenerationActionsInputs {
  generatedTarget: Cell<{ jobId?: string; plan: QwenGenerationPlan; } | undefined>;
  plan: QwenGenerationPlan;
  draft: Cell<{ prompt: string; references: QwenReference[]; reference: QwenLayerReference | undefined; correction: QwenLayerReference | undefined; }>;
  onInsert: (file: File | File[], target: QwenGenerationPlan, adoption?: QwenAdoption) => Promise<void>;
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
  figureChroma: boolean;
  chromaKeyColor: string;
  ensureComfy: (endpoint?: string) => Promise<void>;
  submitted: Cell<boolean>;
  setAttempt: Dispatch<StateUpdater<string | null>>;
  setJob: Dispatch<StateUpdater<QwenJob | null>>;
  comfySession: Cell<string | null>;
}

export function createGenerationActions({ generatedTarget, plan, draft, onInsert, operation, attempted, targetError, threeImages, usesPoseImage, generationAbort, alive, setPhase, posePending, workflow, cloud, execution, adultContent, setNotice, missingWorkflow, connection, defaultNegative, negative, figureChroma, chromaKeyColor, ensureComfy, submitted, setAttempt, setJob, comfySession }: CreateGenerationActionsInputs) {
  async function insertResult(result:QwenJob){
    if(!result.image||!result.fileName)throw new Error('差し込む画像がありません');
    const bytes=Uint8Array.from(atob(result.image.split(',')[1]),char=>char.charCodeAt(0));
    await insertImage(new File([bytes],result.fileName,{type:'image/png'}),generatedTarget.current?.jobId===result.jobId?generatedTarget.current.plan:undefined,Boolean(result.workflowId));
  }
  async function insertionFile(file:File,target:QwenGenerationPlan,preserveAspect=false):Promise<File>{
    if(!target.outputFrame)return file;
    const bitmap=await createImageBitmap(file);
    try{
      if(target.threeImages && preserveAspect){
        if(bitmap.width!==target.width || bitmap.height!==target.height)throw new Error('生成画像の寸法がコマと一致しません');
        return file; // Preserve the print DPI and pixels of the adopted PNG.
      }
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
      return new File([blob],file.name,{type:'image/png'});
    }finally{bitmap.close();}
  }
  async function insertImage(file:File|File[],capturedTarget?:QwenGenerationPlan,preserveAspect=false,adoption?:QwenAdoption){
    const target=capturedTarget??qwenGenerationTarget(plan,Boolean(draft.current.correction)),files=Array.isArray(file)?file:[file],prepared:File[]=[];
    for(const item of files)prepared.push(await insertionFile(item,target,preserveAspect));
    await onInsert(Array.isArray(file)?prepared:prepared[0],target,adoption);
  }
  async function importGenerated(){
    const files=await chooseBrowserFiles('image/png,image/jpeg');
    if(files[0])await operation(()=>insertImage(files[0],generatedTarget.current?.plan));
  }
  async function generate(autoInsert=false,inputIsCurrent:()=>boolean=()=>true){return operation(async()=>{
    if(attempted.current)throw new Error('この生成は開始済みです');
    if(targetError)throw new Error(targetError);
    const {prompt,references,reference,correction}=draft.current;
    if(plan.characterKeys?.length && plan.characterKeys.some(key=>!references.some(ref=>ref.characterKeys.includes(key))))throw new Error('人物に紐づく設定画を読み込めません');
    if(threeImages&&!usesPoseImage)throw new Error('image1で3Dモデルを調整してください');
    if(plan.humanPose)requireHumanPoseGenerationReady(plan.humanPose.selection);
    const abort=new AbortController();generationAbort.current=abort;
    const isCurrent=()=>alive.current&&!abort.signal.aborted&&inputIsCurrent();
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
    if(!workflow)throw new Error(missingWorkflow||'ワークフローを確認しています');
    const inputCount=payload.references.length+Number('paint_image' in payload)+Number('sketch_image' in payload)+Number('correction_image' in payload);
    if(inputCount!==workflow.binding.images.length)throw new Error(`${workflow.name}は参照画像${workflow.binding.images.length}枚の定義です。現在は${inputCount}枚です。環境設定で対応する定義を選んでください`);
    const workflowPayload={...payload,workflow_id:workflow.id,workflow_version:workflow.version,comfyui_url:connection.comfyuiUrl,
      ...(defaultNegative!==undefined?{negative_prompt:negative}:{}),
      ...(figureChroma?{chroma_key_color:chromaKeyColor,candidate_cutout:true}:{})};
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
      services:(prepare,generate,options)=>withImageGenerationServices(prepare,generate,{...options,runtimeToken:comfySession.current??undefined,signal:abort.signal,requiresLlm:workflow.binding.prompt_mode==='qwen'&&!plan.contentKind,onPhase:value=>{
        if(alive.current)setPhase({bridge:'準備中',llm:'英訳の準備中',translate:Boolean(plan.contentKind)?'生成指示を保存中':'英訳を保存中',suspend:'文章LLMを停止中',generate:'5枚の画像を生成中',restore:'生成後の復帰を確認中'}[value]);
      }}),
    });
  },autoInsert);}
  return { generate, insertImage, insertResult, importGenerated };
}

export type Cell<T> = { current: T };
