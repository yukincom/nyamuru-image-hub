import { postJson, PANEL_DRAFT_MAX_PNG_BYTES } from './transport.ts';
import { currentGenerationPreferences } from '../generationPreferences.ts';
import { currentLocalModelPreferences } from '../localModelPreferences.ts';
import { withNewCreationBridgeSession } from '../localBridgeLifecycle.ts';

const GENERATION_CACHE_ID_PATTERN = /^[a-f0-9]{64}$/;

export interface GenerationCacheOwnerSummary {
  kind: 'series' | 'one-shot';
  id: string;
  label: string;
  entryCount: number;
  byteSize: number;
  lastUsedAt: string;
  expiresAt: string | null;
  expired: boolean;
}

export interface GenerationCacheProfileSummary {
  profileId: string;
  label: string;
  entryCount: number;
  byteSize: number;
  owners: GenerationCacheOwnerSummary[];
}

export interface GenerationCacheSummary {
  root: string;
  profiles: GenerationCacheProfileSummary[];
  invalidEntryCount: number;
}

function generationCacheCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function generationCacheDate(value: unknown) {
  return typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value)) ? value : null;
}

export function decodeGenerationCacheSummary(input: unknown): GenerationCacheSummary {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('生成キャッシュの応答形式が不正です');
  const payload = input as Record<string, unknown>;
  const invalidEntryCount = generationCacheCount(payload.invalid_entry_count);
  if (typeof payload.root !== 'string' || !payload.root || payload.root.length > 4096
    || !Array.isArray(payload.profiles) || invalidEntryCount === null) {
    throw new Error('生成キャッシュの一覧を確認できません');
  }
  const profiles = payload.profiles.map(rawProfile => {
    if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) throw new Error('生成モデル設定の応答形式が不正です');
    const profile = rawProfile as Record<string, unknown>;
    const entryCount = generationCacheCount(profile.entry_count);
    const byteSize = generationCacheCount(profile.byte_size);
    if (typeof profile.profile_id !== 'string' || !GENERATION_CACHE_ID_PATTERN.test(profile.profile_id)
      || typeof profile.label !== 'string' || !profile.label.trim() || profile.label.length > 500
      || entryCount === null || byteSize === null || !Array.isArray(profile.owners)) {
      throw new Error('生成モデル設定の一覧を確認できません');
    }
    const owners = profile.owners.map(rawOwner => {
      if (!rawOwner || typeof rawOwner !== 'object' || Array.isArray(rawOwner)) throw new Error('作品キャッシュの応答形式が不正です');
      const owner = rawOwner as Record<string, unknown>;
      const ownerEntryCount = generationCacheCount(owner.entry_count);
      const ownerByteSize = generationCacheCount(owner.byte_size);
      const lastUsedAt = generationCacheDate(owner.last_used_at);
      const expiresAt = owner.expires_at === null ? null : generationCacheDate(owner.expires_at);
      if (!['series', 'one-shot'].includes(String(owner.kind)) || typeof owner.id !== 'string'
        || !/^[^\u0000-\u001f\u007f]{1,200}$/u.test(owner.id) || !owner.id.trim()
        || typeof owner.label !== 'string' || !owner.label.trim() || owner.label.length > 500
        || ownerEntryCount === null || ownerByteSize === null || !lastUsedAt
        || typeof owner.expired !== 'boolean'
        || (owner.kind === 'series' && (expiresAt !== null || owner.expired))
        || (owner.kind === 'one-shot' && expiresAt === null)) {
        throw new Error('作品キャッシュの一覧を確認できません');
      }
      return {
        kind: owner.kind as GenerationCacheOwnerSummary['kind'], id: owner.id, label: owner.label,
        entryCount: ownerEntryCount, byteSize: ownerByteSize, lastUsedAt, expiresAt, expired: owner.expired,
      };
    });
    if (owners.reduce((sum, owner) => sum + owner.entryCount, 0) !== entryCount
      || owners.reduce((sum, owner) => sum + owner.byteSize, 0) !== byteSize) {
      throw new Error('生成モデル設定の集計が一致しません');
    }
    return { profileId: profile.profile_id, label: profile.label, entryCount, byteSize, owners };
  });
  return { root: payload.root, profiles, invalidEntryCount };
}

export async function listGenerationCaches() {
  return decodeGenerationCacheSummary(await postJson('/api/layer-generation/cache/list', {}, 30_000));
}

export async function deleteGenerationCache(target:
  | { scope: 'owner'; ownerKind: GenerationCacheOwnerSummary['kind']; ownerId: string }
  | { scope: 'profile'; profileId: string }) {
  const body = target.scope === 'owner'
    ? { scope: target.scope, owner_kind: target.ownerKind, owner_id: target.ownerId }
    : { scope: target.scope, profile_id: target.profileId };
  const payload = await postJson('/api/layer-generation/cache/delete', body, 30_000) as Record<string, unknown>;
  if (!payload || payload.ok !== true || typeof payload.deleted !== 'boolean') throw new Error('生成キャッシュの削除結果を確認できません');
  return { deleted: payload.deleted, summary: decodeGenerationCacheSummary(payload.summary) };
}

export async function decodeQwenJob(raw:unknown,jobId?:string,requestSha256?:string):Promise<import('../qwenGeneration.ts').QwenJob>{
  const value=raw as Record<string,unknown>;
  const selectedWorkflow=Boolean(value&&typeof value.workflow_id==='string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.workflow_id)
    && (value.candidate_cutout===true||value.status==='succeeded'&&Number.isInteger(value.selected_candidate)&&Number(value.selected_candidate)>=1&&Number(value.selected_candidate)<=5));
  const minSize=selectedWorkflow?1:32,maxSize=selectedWorkflow?16384:4096;
  if(!value||value.profile!=='qwen-image-2.1-owner-v1'||typeof value.job_id!=='string'||!/^[-a-f0-9]{36}$/.test(value.job_id)
    ||(jobId&&value.job_id!==jobId)||typeof value.request_sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.request_sha256)
    ||(requestSha256&&value.request_sha256!==requestSha256)||typeof value.label!=='string'
    ||!['preparing','prepared','queued','running','succeeded','failed','outcome_unknown'].includes(String(value.status))
    ||![value.width,value.height].every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=minSize&&n<=maxSize)
    ||Number(value.width)*Number(value.height)>100_000_000)throw new Error('Qwen生成結果の対応を確認できません');
  const job:import('../qwenGeneration.ts').QwenJob={jobId:value.job_id,status:value.status as import('../qwenGeneration.ts').QwenJob['status'],
    requestSha256:value.request_sha256,label:value.label,width:value.width as number,height:value.height as number,error:typeof value.error==='string'?value.error:undefined};
  if(value.document_key!==undefined){
    if(typeof value.document_key!=='string'||typeof value.page_number!=='number'||!Number.isInteger(value.page_number)||value.page_number<1
      ||typeof value.panel_id!=='number'||!Number.isInteger(value.panel_id)||typeof value.overlay!=='boolean'||(value.owner_key==='page'?value.panel_id<0||value.overlay:value.overlay?value.panel_id!==0:value.panel_id<1)
      ||typeof value.owner_key!=='string'||!/^(background|figure-\d+|bubble-\d+|panel|page)$/.test(value.owner_key)||value.owner_key==='panel'&&value.overlay
      ||typeof value.created_at!=='number'||!Number.isFinite(value.created_at)||value.created_at<0)throw new Error('生成履歴の所属を確認できません');
    Object.assign(job,{documentKey:value.document_key,pageNumber:value.page_number,panelId:value.panel_id,overlay:value.overlay,ownerKey:value.owner_key,createdAt:value.created_at});
  }
  if(value.file_name!==undefined){
    if(value.file_name!==`qwen_${job.jobId}.png`)throw new Error('生成画像のファイル名が一致しません');
    job.fileName=value.file_name as string;
  }
  if(value.image!==undefined){
    if(job.status!=='succeeded'||typeof value.image!=='string'||!value.image.startsWith('data:image/png;base64,')
      ||value.image.length>Math.ceil(PANEL_DRAFT_MAX_PNG_BYTES/3)*4+100||value.file_name!==`qwen_${job.jobId}.png`)throw new Error('Qwen生成画像の形式が不正です');
    job.image=value.image;job.fileName=value.file_name as string;
  }
  if(Array.isArray(value.candidates)){
    job.candidates=value.candidates.map((raw:unknown)=>{
      const item=raw as {index:number;seed:number;image:string};
      if(!Number.isInteger(item.index)||item.index<1||item.index>5||!Number.isSafeInteger(item.seed)||typeof item.image!=='string'||!item.image.startsWith('data:image/png;base64,'))throw new Error('生成候補の形式が不正です');
      return {index:item.index,seed:item.seed,image:item.image};
    });
  }
  if(typeof value.selected_candidate==='number')job.selectedCandidate=value.selected_candidate;
  job.requiresCutout=value.requires_cutout===true;
  job.candidateCutout=value.candidate_cutout===true;
  if(value.selected_candidates!==undefined){
    if(!Array.isArray(value.selected_candidates)||!value.selected_candidates.length||value.selected_candidates.some(i=>!Number.isInteger(i)||i<1||i>5)||new Set(value.selected_candidates).size!==value.selected_candidates.length)throw new Error('採用する候補の形式が不正です');
    job.selectedCandidates=value.selected_candidates as number[];
  }
  job.adopted=value.adopted===true;job.candidatesDiscarded=value.candidates_discarded===true;
  if(typeof value.workflow_name==='string')job.workflowName=value.workflow_name;
  if(typeof value.workflow_id==='string')job.workflowId=value.workflow_id;
  if(typeof value.workflow_version==='number')job.workflowVersion=value.workflow_version;
  if(typeof value.comfyui_url==='string')job.comfyuiUrl=value.comfyui_url;
  if(typeof value.generation_prompt==='string')job.generationPrompt=value.generation_prompt;
  if(value.progress!==undefined){
    const p=value.progress as Record<string,unknown>;
    if(!p||!Number.isInteger(p.candidate)||!Number.isInteger(p.total)||Number(p.candidate)<1||Number(p.candidate)>Number(p.total)||Number(p.total)>5
      ||typeof p.client_id!=='string'||!/^[a-f0-9-]{36}$/iu.test(p.client_id)||p.prompt_id!=null&&typeof p.prompt_id!=='string'
      ||!p.nodes||typeof p.nodes!=='object'||Array.isArray(p.nodes)||Object.values(p.nodes).some(name=>typeof name!=='string'||name.length>200))throw new Error('生成工程の形式が不正です');
    job.progress={candidate:Number(p.candidate),total:Number(p.total),clientId:p.client_id,...(typeof p.prompt_id==='string'?{promptId:p.prompt_id}:{}),nodes:p.nodes as Record<string,string>};
  }
  if(Array.isArray(value.candidate_seeds)&&value.candidate_seeds.every(Number.isSafeInteger))job.candidateSeeds=value.candidate_seeds as number[];
  return job;
}
export async function prepareQwenJob(jobId:string,payload:ReturnType<typeof import('../qwenGeneration.ts').qwenGenerationPayload>){
  const job=await decodeQwenJob(await postJson('/api/qwen-generation/prepare',{
    workflow_id:currentGenerationPreferences().local.workflowId,comfyui_url:currentLocalModelPreferences().comfyuiUrl,
    ...payload,job_id:jobId},320_000),jobId);
  if(job.status!=='prepared')throw new Error(job.error||'英訳の保存を確認できません。生成履歴を確認してください');
  return job;
}
export async function submitQwenJob(prepared:import('../qwenGeneration.ts').QwenJob,token:string){
  return decodeQwenJob(await (await import('../localBridgeLifecycle.ts')).submitImageGenerationRequest(token,{job_id:prepared.jobId,request_sha256:prepared.requestSha256}),prepared.jobId,prepared.requestSha256);
}
export async function reconcileQwenJob(jobId:string,requestSha256?:string){
  return decodeQwenJob(await postJson('/api/qwen-generation/reconcile',{job_id:jobId},30_000),jobId,requestSha256);
}
export async function cancelQwenJob(jobId:string){
  return withNewCreationBridgeSession(async()=>decodeQwenJob(await postJson('/api/qwen-generation/cancel',{job_id:jobId},30_000),jobId));
}
export async function selectQwenCandidate(job:import('../qwenGeneration.ts').QwenJob,index:number|number[],adopted=false){
  const result=await decodeQwenJob(await postJson('/api/qwen-generation/select',{job_id:job.jobId,...(Array.isArray(index)?{candidate_indices:index,adopted}:{candidate_index:index})},30_000),job.jobId,job.requestSha256);
  if(Array.isArray(index)&&(JSON.stringify(result.selectedCandidates)!==JSON.stringify([...index].sort((a,b)=>a-b))||adopted&&!result.candidatesDiscarded))throw new Error('候補の採用・削除結果を確認できません');
  return result;
}
export async function deleteQwenJobs(plan:import('../qwenGeneration.ts').QwenGenerationPlan,jobs:import('../qwenGeneration.ts').QwenJob[]){
  if(!jobs.length||jobs.some(job=>job.documentKey!==plan.documentKey))throw new Error('削除する生成履歴の作品が一致しません');
  const ids=jobs.map(job=>job.jobId);
  const result=await postJson('/api/qwen-generation/delete',{document_key:plan.documentKey,jobs:jobs.map(job=>({job_id:job.jobId,request_sha256:job.requestSha256}))},30_000) as {document_key?:unknown;deleted_job_ids?:unknown};
  if(result.document_key!==plan.documentKey||!Array.isArray(result.deleted_job_ids)||result.deleted_job_ids.length!==ids.length
    ||new Set(result.deleted_job_ids).size!==ids.length||result.deleted_job_ids.some(id=>!ids.includes(id)))throw new Error('生成履歴の削除結果を確認できません。履歴を読み直してください');
}
export async function listQwenJobs(plan:import('../qwenGeneration.ts').QwenGenerationPlan,scope:import('../qwenGeneration.ts').QwenHistoryScope='owner'){
  const payload=await postJson('/api/qwen-generation/list',{document_key:plan.documentKey,page_number:plan.pageNumber,panel_id:plan.panelId,overlay:plan.overlay,owner_key:plan.ownerKey,scope}) as {jobs?:unknown[]};
  if(!Array.isArray(payload.jobs))throw new Error('Qwen生成履歴を確認できません');
  const jobs=await Promise.all(payload.jobs.map(raw=>decodeQwenJob(raw)));
  if(jobs.some(job=>job.documentKey!==plan.documentKey||(scope==='owner'&&(job.pageNumber!==plan.pageNumber||job.panelId!==plan.panelId||job.overlay!==plan.overlay||job.ownerKey!==plan.ownerKey))))throw new Error('生成履歴の対象が一致しません');
  return jobs;
}
