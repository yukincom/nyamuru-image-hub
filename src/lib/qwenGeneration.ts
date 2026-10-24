import type { Manga, CharacterReferenceSourceImage } from '../types.ts';
import type { PaintOwner } from './paintDocument.ts';
import { compileArtworkRules, getArtworkSettings } from './artworkRules.ts';
import { isPropPlacement } from './catalogModel.ts';
import { FIGURE_SIZE_LABELS } from './manga.ts';
import { requireHumanPoseGenerationReady } from './humanPoseSelection.ts';
export interface QwenReferenceCandidate {
  label: string; seriesId: string; characterCatalogId: string; source: CharacterReferenceSourceImage;
}

export const QWEN_GENERATION_PROFILE = 'qwen-image-2.1-owner-v1' as const;
export interface QwenGenerationPlan {
  profile: typeof QWEN_GENERATION_PROFILE;
  documentKey: string; pageNumber: number; panelId: number; overlay: boolean;
  ownerKey: string; label: string; width: number; height: number;
  prompt: string; characterKeys: string[]; candidates: QwenReferenceCandidate[];
  sketchPrompt?: string;
}
export interface QwenReference { label: string; characterKeys: string[]; image: string }
export interface QwenLayerCandidate { id:string; label:string; kind:'paint'|'sketch'; hidden:boolean; empty:boolean }
export interface QwenLayerReference extends QwenLayerCandidate { image:string }
export function qwenLayerCandidates(owner:PaintOwner):QwenLayerCandidate[] {
  return [...owner.paint.layers].reverse().map(layer=>({id:layer.id,label:layer.name,
    kind:layer.guide&&owner.figure?.analogImport?'sketch':'paint',hidden:!layer.visible,
    empty:layer.opacity<=0||!(layer.guide||layer.image||layer.strokes.length||layer.paths?.length||layer.tone?.enabled&&layer.tone.fill||layer.generationMask?.enabled&&layer.generationMask.strokes.length)}));
}
/** Select only inside the captured owner; visibility changes affect this export copy only. */
export function qwenLayerPaint(owner:PaintOwner,id:string,includeGeneration=false) {
  const candidate=qwenLayerCandidates(owner).find(layer=>layer.id===id);
  if(!candidate)throw new Error('選択したレイヤーがこのフォルダにありません');
  if(candidate.empty)throw new Error('空または濃度0%のレイヤーは参照できません');
  const layer=owner.paint.layers.find(layer=>layer.id===id)!;
  if(!includeGeneration&&!(layer.guide||layer.image||layer.strokes.length||layer.paths?.length||layer.tone?.enabled&&layer.tone.fill))
    throw new Error('生成マーカーだけのレイヤーは、ピンポイント修正用に選んでください');
  return {...owner.paint,layers:[{...layer,visible:true}]};
}
export function qwenGenerationPrompt(plan:QwenGenerationPlan,reference?:QwenLayerReference,correction?:QwenLayerReference) {
  if(correction)return [
    '修正用レイヤーの印・塗り・書き込みが示す箇所を、今回の修正指示に従って編集してください。',
    reference?'参照画像の構図と、修正対象以外の内容を保ってください。':'書き込み付き画像の構図と、修正対象以外の内容を保ってください。',
    plan.characterKeys.length?'キャラクター設定画は、同じ人物の外見と画風を保つための資料です。':'',
    '修正を指示する印・塗り・文字は、完成画像には残さないでください。',
  ].filter(Boolean).join('\n\n');
  return reference?.kind==='sketch'?(plan.sketchPrompt??plan.prompt):plan.prompt;
}
export interface QwenJob {
  jobId: string; status: 'preparing'|'prepared'|'queued'|'running'|'succeeded'|'failed'|'outcome_unknown';
  requestSha256: string; label: string; phase?: string; error?: string;
  image?: string; fileName?: string; width: number; height: number;
  documentKey?: string; pageNumber?: number; panelId?: number; overlay?: boolean; ownerKey?: string; createdAt?: number;
}
export type QwenHistoryScope = 'owner'|'work';
export function canDeleteQwenJob(job:QwenJob){return ['prepared','succeeded','failed'].includes(job.status);}
export function qwenJobLocation(job:QwenJob){return `${job.pageNumber??'?'}ページ · ${job.overlay?'ページ前景':`コマ ${job.panelId??'?'}`} · ${job.label}`;}

/** The owner is resolved by the editor, never inferred from a name or a filename. */
export function buildQwenGenerationPlan(manga:Manga, pageIndex:number, panelIndex:number, overlay:boolean, owner:PaintOwner):QwenGenerationPlan {
  const page=manga.pages[pageIndex], panel=page?.panels[panelIndex];
  if(!page||(!overlay&&!panel))throw new Error('生成対象が見つかりません');
  requireHumanPoseGenerationReady(owner.figure?.human_pose);
  if(owner.kind==='figure')requireHumanPoseGenerationReady((overlay?page.page_overlay:panel)?.figures?.[owner.index]?.human_pose);
  const person=owner.figure&&!isPropPlacement(owner.figure);
  const character=person&&owner.figure?.refId?manga.characters.find(c=>c.localId===owner.figure!.refId):undefined;
  if(person&&!character)throw new Error('この人物あたりの登場人物を指定してから生成してください');
  const characterKeys=character?.localId?[character.localId]:[];
  const candidates:QwenReferenceCandidate[]=character?.catalog_id&&manga.meta.series_id
    ? manga.materials.filter(m=>m.type==='character'&&m.source_image&&(
      m.characterId===character.localId||m.character_catalog_id===character.catalog_id))
      .sort((a,b)=>Number(b.catalog_id===character.primary_material_catalog_id)-Number(a.catalog_id===character.primary_material_catalog_id))
      .map(m=>({label:m.key,seriesId:manga.meta.series_id,characterCatalogId:character.catalog_id!,source:m.source_image!})) : [];
  const style=compileArtworkRules(getArtworkSettings(manga),'character').style_notes;
  const prompt=[
    '漫画用の独立した画像を1枚描いてください。参照資料の画風と形を尊重してください。',
    `出力形式：${manga.meta.format}。`,
    owner.kind==='background'?`背景のみ。人物や吹き出しは描かない。背景指示：${owner.description||panel?.background_description||manga.setting.location||'無地'}`
      :owner.kind==='bubble'?'吹き出しの外形だけを描く。文字は加えない。'
      :`${person?'人物':'小道具'}：${owner.figure?.name||owner.label}。\n背景・文字・吹き出しは加えず、外側は透明にする。`,
    owner.figure?.size?`描写範囲は${FIGURE_SIZE_LABELS[owner.figure.size]}。${owner.figure.size==='bust-up'?'頭頂から胸までを画面に収めた構図で描く。':'指定した範囲を画面に収めた構図で描く。'}`:'',
    owner.figure?.action?`動作・表情・視線：${owner.figure.action}`:'',
    character?.visual_prompt?.trim()?`人物のビジュアル指定：${character.visual_prompt}`:'',
    character?.default_proportion?`体型：${character.default_proportion.head_count}頭身を保つ。`:'',
    ...style,
    '新しい絵を1枚描く。資料集・コラージュ・コマ枠・署名・透かしは加えない。',
  ].filter(Boolean).join('\n\n');
  const sketchPrompt=person?[
    `<image1>を、${owner.figure?.name||owner.label}の完成した漫画イラスト1枚に描き替えてください。`,
    `出力形式：${manga.meta.format}。`,
    '<image1>は1人だけを切り出したネームの人物ラフで、ポーズと構図を指定しています。体の回転、傾き、手足の曲げ方、手の位置とジェスチャー、カメラの視点、構図、意図した見切れを保つ。逆さの人物は逆さのままにする。',
    `ラフの人物を、<image2>以降の人物資料に描かれた${owner.figure?.name||owner.label}へ置き換える。顔立ち、髪型、装飾品、服装、体型、画風を人物資料から使う。資料の複数の向きは同じ1人の人物を示す。`,
    'ラフの手は、人間の手として描き起こす。開いているか握っているか、手の向きは保つ。線のゆらぎ、線幅、ベタ、ハッチングなど、人物資料の描き方を保つ。',
    '指定がなければラフの顔の向きと表情を保つ。今回の動作・表情・視線の指定は、ラフや人物資料・人物設定の標準的な表情より優先する。目線に合わせて目や顔の向きを調整し、体のポーズと服装は保つ。',
    owner.figure?.action?`今回の動作・表情・視線：${owner.figure.action}`:'',
    character?.visual_prompt?.trim()?`人物の外見・画風の指定：${character.visual_prompt}`:'',
    character?.default_proportion?`体型：${character.default_proportion.head_count}頭身を保つ。`:'',
    ...style,
    '人物は1人だけ。画面外の手足を描き足さず、別の人物・資料集の別アングル・コマ枠・文字を加えない。',
  ].filter(Boolean).join('\n\n'):undefined;
  return {profile:QWEN_GENERATION_PROFILE,documentKey:JSON.stringify([manga.meta.series_id,manga.meta.episode_id]),
    pageNumber:page.page,panelId:overlay?0:panel.id,overlay,ownerKey:owner.key,label:owner.label,
    width:owner.paint.width,height:owner.paint.height,prompt,characterKeys,candidates,
    ...(sketchPrompt?{sketchPrompt}:{})};
}

export function qwenGenerationPayload(plan:QwenGenerationPlan,references:QwenReference[],paintImage?:string,sketchImage?:string,correctionImage?:string){
  if(paintImage&&sketchImage)throw new Error('描画画像とネームのラフを同時には指定できません');
  if(sketchImage&&(!plan.ownerKey.startsWith('figure-')||!plan.characterKeys.length))throw new Error('ネームのラフ生成には登場人物の指定が必要です');
  if(references.length>9)throw new Error('参照資料は9枚までです');
  if(references.length+Number(Boolean(paintImage||sketchImage))+Number(Boolean(correctionImage))>10)throw new Error('設定画と選択レイヤーは合計10枚までです');
  if(plan.characterKeys.some(key=>!references.some(r=>r.characterKeys.includes(key))))throw new Error('指定した登場人物の参照資料を選んでください');
  if(references.some(r=>r.characterKeys.some(key=>!plan.characterKeys.includes(key))))throw new Error('参照資料と生成する人物が一致しません');
  if(!plan.prompt.trim())throw new Error('生成指示を入力してください');
  return {profile:plan.profile,document_key:plan.documentKey,page_number:plan.pageNumber,panel_id:plan.panelId,
    overlay:plan.overlay,owner_key:plan.ownerKey,label:plan.label,width:plan.width,height:plan.height,
    prompt:plan.prompt,character_keys:plan.characterKeys,
    mode:sketchImage?'sketch':paintImage?'paint':'new',...(paintImage?{paint_image:paintImage}:{}),...(sketchImage?{sketch_image:sketchImage}:{}),
    ...(correctionImage?{correction_image:correctionImage}:{}),
    references:references.map(r=>({label:r.label,character_keys:r.characterKeys,image:r.image}))};
}


export type QwenReferenceRole = 'character'|'drawing';
export interface QwenAgentRequest {
  isCurrent:()=>boolean;
  resolve:(message:string)=>void;
  reject:(error:unknown)=>void;
}
export interface QwenGenerationConversation {
  label:string; busy:boolean; locked:boolean; phase:string;
  references:QwenReference[]; character:boolean;
  addFiles:(files:File[],role:QwenReferenceRole)=>Promise<void>;
  loadRegistered?:()=>Promise<void>;
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

export function requireQwenInsertionTarget(job:QwenJob,plan:QwenGenerationPlan,id:string,sha:string) {
  if(job.jobId!==id||job.requestSha256!==sha||job.documentKey!==plan.documentKey||job.pageNumber!==plan.pageNumber||
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
  let expected:QwenJob|undefined;
  const result=await services(async()=>expected=await prepare(id,payload),async(prepared,token)=>{
    if(!isCurrent())return prepared;
    let current=await submit(prepared,token);onJob(current);
    while(isCurrent()&&['queued','running'].includes(current.status)){
      await (wait??(()=>new Promise(resolve=>setTimeout(resolve,2000))))();
      if(!isCurrent())break;
      current=await reconcile(id,prepared.requestSha256);onJob(current);
    }
    return current;
  },{isCurrent});
  if(insert&&isCurrent()&&result&&expected){
    requireQwenInsertionTarget(result,plan,id,expected.requestSha256);
    await insert(result);return {job:result,inserted:true};
  }
  return {job:result,inserted:false};
}
