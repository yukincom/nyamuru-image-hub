import { type QwenGenerationPlan, qwenGenerationPayload } from './ownerPlan.ts';

export interface QwenJob {
  jobId: string; status: 'preparing'|'prepared'|'queued'|'running'|'succeeded'|'failed'|'outcome_unknown';
  requestSha256: string; label: string; phase?: string; error?: string;
  image?: string; fileName?: string; width: number; height: number;
  workflowId?:string; workflowName?:string; workflowVersion?:number; comfyuiUrl?:string; generationPrompt?:string; candidateSeeds?:number[];
  candidates?: {index:number;seed:number;image:string}[]; selectedCandidate?:number; requiresCutout?:boolean;
  candidateCutout?:boolean; selectedCandidates?:number[]; adopted?:boolean; candidatesDiscarded?:boolean;
  progress?:{candidate:number;total:number;clientId:string;promptId?:string;nodes:Record<string,string>};
  documentKey?: string; pageNumber?: number; panelId?: number; overlay?: boolean; ownerKey?: string; createdAt?: number;
}

export interface QwenAdoption { jobId:string; indices:number[] }

export type QwenHistoryScope = 'owner'|'work';

export function canDeleteQwenJob(job:QwenJob){return ['prepared','succeeded','failed'].includes(job.status);}

export function qwenJobLocation(job:QwenJob){return `${job.pageNumber??'?'}ページ · ${job.ownerKey==='page'?'ページ全体':job.overlay?'ページ前景':`コマ ${job.panelId??'?'}`} · ${job.label}`;}

export interface QwenAgentRequest {
  isCurrent:()=>boolean;
  resolve:(message:string)=>void;
  reject:(error:unknown)=>void;
}

export interface QwenGenerationConversation {
  label:string; busy:boolean; locked:boolean; phase:string;
  send:(text:string,isCurrent:()=>boolean)=>Promise<string>;
}

/** The dialog owns the ready controller; reuse it for a single agent request. */
export async function runQwenAgentRequest(request:QwenAgentRequest, load:()=>Promise<void>, send:(text:string,isCurrent:()=>boolean)=>Promise<string>) {
  try {
    if(!request.isCurrent())throw new Error('生成を中止しました');
    await load();
    if(!request.isCurrent())throw new Error('生成を中止しました');
    request.resolve(await send('生成して',request.isCurrent));
  } catch(error) { request.reject(error); }
}

/** Only an unambiguous complete command starts generation. Other text remains draft input. */
export function qwenConversationIntent(text:string):'generate'|'hold'|'help'|'instruction' {
  const value=text.normalize('NFKC').trim().replace(/[\s、,。.!！]/g,'');
  if(/^(?:まだ|ちょっと)?(?:やめて|止めて|ストップ|キャンセル|待って)(?:ください)?$/u.test(value)||/生成/u.test(value)&&/(?:やめ|止め|キャンセル|待って|まだ|しない|しなく|しません|せず|不要)/u.test(value))return 'hold';
  if(/^(?:(?:この|今の)(?:画像|設定|条件|内容|指示)で|これで|そのまま)?(?:画像を)?生成(?:して(?:ください)?|を開始(?:して(?:ください)?)?)$/u.test(value))return 'generate';
  if(!value||/[?？]/u.test(value)||/生成|ですか|ますか|できる|教えて|とは|どう|なぜ/u.test(value))return 'help';
  return 'instruction';
}

export function requireQwenInsertionTarget(job:QwenJob,plan:QwenGenerationPlan) {
  if(job.documentKey!==plan.documentKey||job.pageNumber!==plan.pageNumber||
    job.panelId!==plan.panelId||job.overlay!==plan.overlay||job.ownerKey!==plan.ownerKey)
    throw new Error('生成結果と差し込み先が一致しません。生成履歴を確認してください');
  if(job.status!=='succeeded'||!job.image||!job.fileName)throw new Error(job.error||'生成は完了していません。生成状況を確認してください');
}

/** Shared by the existing button and conversation; service restoration precedes insertion. */
export async function executeQwenGeneration({id,payload,plan,services,prepare,submit,reconcile,isCurrent,onJob,insert,wait}: {
  id:string;payload:ReturnType<typeof qwenGenerationPayload>;plan:QwenGenerationPlan;
  services:(prepare:()=>Promise<QwenJob>,generate:(prepared:QwenJob,token:string)=>Promise<QwenJob>,options:{isCurrent:()=>boolean})=>Promise<QwenJob|undefined>;
  prepare:(id:string,payload:ReturnType<typeof qwenGenerationPayload>)=>Promise<QwenJob>;
  submit:(prepared:QwenJob,token:string)=>Promise<QwenJob>;
  reconcile:(id:string,sha:string)=>Promise<QwenJob>;
  isCurrent:()=>boolean;onJob:(job:QwenJob)=>void;
  insert?:(job:QwenJob)=>Promise<void>;wait?:()=>Promise<void>;
}):Promise<{job?:QwenJob;inserted:boolean}> {
  const result=await services(()=>prepare(id,payload),async(prepared,token)=>{
    if(!isCurrent())return prepared;
    let current=await submit(prepared,token);onJob(current);
    while(isCurrent()&&['queued','running'].includes(current.status)){
      await (wait??(()=>new Promise(resolve=>setTimeout(resolve,2000))))();
      if(!isCurrent())break;
      current=await reconcile(id,prepared.requestSha256);onJob(current);
    }
    return current;
  },{isCurrent});
  if(insert&&isCurrent()&&result&&!result.candidates?.length){
    requireQwenInsertionTarget(result,plan);
    await insert(result);return {job:result,inserted:true};
  }
  return {job:result,inserted:false};
}
