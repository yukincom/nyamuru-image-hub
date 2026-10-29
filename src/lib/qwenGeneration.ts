import {paintLayerVisible} from './paintLock.ts';
import type { Manga, CharacterReferenceSourceImage, FigureSize, BBox } from '../types.ts';
import type { PaintOwner } from './paintDocument.ts';
import { compileArtworkRules, getArtworkSettings, type ArtworkSource } from './artworkRules.ts';
import { isPropPlacement } from './catalogModel.ts';
import { FIGURE_SIZE_LABELS } from './manga.ts';
import { requireHumanPoseGenerationReady } from './humanPoseSelection.ts';
import { humanPoseCameraPromptText } from './humanPoseScene.ts';
import type { HumanPoseTextSelection } from './humanPoseTypes.ts';
import { paintReferenceBox } from './paintDocument.ts';
import { panelBounds } from './canvasGeometry.ts';
import { humanPoseFigureFrame, humanPosePanelCutFrame, type HumanPoseCutFrame } from './humanPoseFraming.ts';
import { humanPoseSceneFrame } from './humanPoseScene.ts';
import { isHandwrittenText } from './bubblePresentation.ts';
import { textStyleOf } from './textStyle.ts';
export interface QwenReferenceCandidate {
  label: string; seriesId: string; characterCatalogId: string; source: CharacterReferenceSourceImage;
  characterKeys?: string[];
}

export const QWEN_GENERATION_PROFILE = 'qwen-image-2.1-owner-v1' as const;
export interface QwenGenerationPlan {
  profile: typeof QWEN_GENERATION_PROFILE;
  documentKey: string; pageNumber: number; panelId: number; overlay: boolean;
  ownerKey: string; label: string; width: number; height: number;
  prompt: string; characterKeys: string[]; candidates: QwenReferenceCandidate[];
  sketchPrompt?: string;
  humanPose?: { selection: HumanPoseTextSelection; framing: FigureSize; aspect?: number; cutFrame?: HumanPoseCutFrame };
  scope?: 'page'|'panel';
  literalText?: string[];
  contentKind?: 'handwritten';
  letteringContext?: string;
  compositionImage?: string;
  outputFrame?: BBox;
  referenceFrame?: BBox;
  generationArea?: BBox;
  poseContext?: string;
}
export interface QwenReference { label: string; characterKeys: string[]; image: string }
export interface QwenLayerCandidate { id:string; label:string; kind:'paint'|'sketch'; hidden:boolean; empty:boolean }
export interface QwenLayerReference extends QwenLayerCandidate { image:string }
export function canGeneratePaintOwner(owner: Pick<PaintOwner,'kind'|'bubble'>): boolean {
  return owner.kind==='figure'||owner.kind==='background'||owner.kind==='bubble'&&isHandwrittenText(owner.bubble);
}
export const QWEN_GENERATION_MASK_ID='generation-mask';
export function qwenLayerCandidates(owner:PaintOwner):QwenLayerCandidate[] {
  const mask=owner.paint.generationMask;
  return [...(mask?[{id:QWEN_GENERATION_MASK_ID,label:'生成マスク',kind:'paint' as const,hidden:!mask.enabled,empty:!mask.strokes.length}]:[]),
    ...[...owner.paint.layers].reverse().map(layer=>({id:layer.id,label:layer.name,
    kind:layer.guide&&owner.figure?.analogImport?'sketch' as const:'paint' as const,hidden:!paintLayerVisible(owner.paint,layer),
    empty:layer.opacity<=0||!(layer.guide||layer.image||layer.strokes.length||layer.paths?.length||layer.tone?.enabled&&layer.tone.fill)}))];
}
/** Select only inside the captured owner; visibility changes affect this export copy only. */
export function qwenLayerPaint(owner:PaintOwner,id:string,includeGeneration=false) {
  const candidate=qwenLayerCandidates(owner).find(layer=>layer.id===id);
  if(!candidate)throw new Error('選択したレイヤーがこのフォルダにありません');
  if(candidate.empty)throw new Error('空または濃度0%のレイヤーは参照できません');
  if(id===QWEN_GENERATION_MASK_ID){
    if(!includeGeneration)throw new Error('生成マスクは、ピンポイント修正用に選んでください');
    return {...owner.paint,generationMask:{...owner.paint.generationMask!,enabled:true}};
  }
  const layer=owner.paint.layers.find(layer=>layer.id===id)!;
  return {...owner.paint,folders:undefined,generationMask:includeGeneration?owner.paint.generationMask:undefined,layers:[{...layer,folderId:undefined,visible:true}]};
}
export function qwenGenerationPrompt(plan:QwenGenerationPlan,reference?:QwenLayerReference,correction?:QwenLayerReference) {
  if(correction)return [
    '修正用レイヤーの印・塗り・書き込みが示す箇所を、今回の修正指示に従って編集してください。',
    reference?'参照画像の構図と、修正対象以外の内容を保ってください。':'書き込み付き画像の構図と、修正対象以外の内容を保ってください。',
    plan.characterKeys.length?'キャラクター設定画は、同じ人物の外見と画風を保つための資料です。':'',
    '修正を指示する印・塗り・文字は、完成画像には残さないでください。',
    plan.poseContext ? `以下は修正部分の人物・ポーズの指定です。修正対象以外は保ってください。\n${plan.poseContext}` : '',
    plan.letteringContext ?? '',
  ].filter(Boolean).join('\n\n');
  if(reference?.kind==='paint'&&plan.humanPose)return `${plan.prompt}\n\n描画レイヤー参照は描き方の参考に使い、ポーズ・アングル・描写範囲は今回の指定を優先してください。`;
  return reference?.kind==='sketch'?(plan.sketchPrompt??plan.prompt):plan.prompt;
}

/** A correction keeps the full captured canvas; a new lettering image uses its marker bounds. */
export function qwenGenerationTarget(plan:QwenGenerationPlan,correction=false):QwenGenerationPlan {
  const area=plan.contentKind==='handwritten'&&!correction?plan.generationArea:undefined,frame=plan.outputFrame;
  if(!area||!frame)return plan;
  return {...plan,generationArea:undefined,width:area.w,height:area.h,outputFrame:{
    x:frame.x+area.x*frame.w/plan.width,y:frame.y+area.y*frame.h/plan.height,
    w:area.w*frame.w/plan.width,h:area.h*frame.h/plan.height,
  }};
}
export function qwenGenerationSizePrompt(plan:QwenGenerationPlan,correction=false):string {
  if(plan.contentKind!=='handwritten')return '';
  const target=qwenGenerationTarget(plan,correction),frame=target.outputFrame;
  return `出力キャンバス：幅${target.width} × 高さ${target.height} px。${frame?`原稿上の配置サイズ：幅${Number(frame.w.toFixed(2))} × 高さ${Number(frame.h.toFixed(2))} mm。`:''}文字全体をこの縦横比の範囲内に収めてください。`;
}
export interface QwenJob {
  jobId: string; status: 'preparing'|'prepared'|'queued'|'running'|'succeeded'|'failed'|'outcome_unknown';
  requestSha256: string; label: string; phase?: string; error?: string;
  image?: string; fileName?: string; width: number; height: number;
  documentKey?: string; pageNumber?: number; panelId?: number; overlay?: boolean; ownerKey?: string; createdAt?: number;
}
export type QwenHistoryScope = 'owner'|'work';
export function canDeleteQwenJob(job:QwenJob){return ['prepared','succeeded','failed'].includes(job.status);}
export function qwenJobLocation(job:QwenJob){return `${job.pageNumber??'?'}ページ · ${job.ownerKey==='page'?'ページ全体':job.overlay?'ページ前景':`コマ ${job.panelId??'?'}`} · ${job.label}`;}

/** The owner is resolved by the editor, never inferred from a name or a filename. */
export function buildQwenGenerationPlan(manga:Manga, pageIndex:number, panelIndex:number, overlay:boolean, owner:PaintOwner, standardArtwork?:ArtworkSource,generationArea?:BBox):QwenGenerationPlan {
  const page=manga.pages[pageIndex], panel=page?.panels[panelIndex];
  if(!page||(!overlay&&!panel))throw new Error('生成対象が見つかりません');
  if(!canGeneratePaintOwner(owner))throw new Error('単品生成は人物・小道具・背景・描き文字が対象です');
  const lettering=owner.kind==='bubble'?owner.bubble:undefined;
  if(lettering){
    const current=(overlay?page.page_overlay:panel)?.bubbles?.[owner.index];
    if(!isHandwrittenText(current)||current?.text!==lettering.text||current?.lettering_description!==lettering.lettering_description)throw new Error('描き文字が変更されました。生成対象を選び直してください');
    if(!lettering.text.trim()||lettering.text.length>500)throw new Error('描き文字の本文を1〜500文字で入力してください');
  }
  const pose = owner.figure?.human_pose;
  if(owner.kind==='figure' && JSON.stringify(pose) !== JSON.stringify((overlay?page.page_overlay:panel)?.figures?.[owner.index]?.human_pose)) throw new Error('人体ポーズが変更されました。生成対象を選び直してください');
  requireHumanPoseGenerationReady(pose);
  const person=owner.figure&&!isPropPlacement(owner.figure);
  const character=person&&owner.figure?.refId?manga.characters.find(c=>c.localId===owner.figure!.refId):undefined;
  if(person&&!character)throw new Error('この人物あたりの登場人物を指定してから生成してください');
  const characterKeys=character?.localId?[character.localId]:[];
  const candidates:QwenReferenceCandidate[]=character?.catalog_id&&manga.meta.series_id
    ? manga.materials.filter(m=>m.type==='character'&&m.source_image&&(
      m.characterId ? m.characterId===character.localId : m.character_catalog_id===character.catalog_id))
      .sort((a,b)=>Number(b.catalog_id===character.primary_material_catalog_id)-Number(a.catalog_id===character.primary_material_catalog_id))
      .map(m=>({label:m.key,seriesId:manga.meta.series_id,characterCatalogId:character.catalog_id!,source:m.source_image!,characterKeys})) : [];
  const artwork=compileArtworkRules(getArtworkSettings(manga),lettering?'handwritten':'character',standardArtwork);
  const style=artwork.style_notes;
  const letteringContext=lettering?[
    '描く対象：描き文字（shape=handwritten）。',
    `meta.text_orientation=${textStyleOf(lettering,'bubble').orientation}`,
    `meta.reading_direction=${manga.meta.reading_direction}`,
    `text:\n${lettering.text}`,
    lettering.lettering_description?`描き方：${lettering.lettering_description}`:'',
    ...style,artwork.layout_spec,
    '上記の本文の描き文字だけを描いてください。文字以外の絵は加えず、文字の外側は透明にしてください。文字の形・線・勢い・質感は、明示された「描き方」に従ってください。',
  ].filter(Boolean).join('\n\n'):undefined;
  const framing = owner.figure?.size ?? 'bust-up';
  const poseInstructions = pose ? [
    pose.input_mode === 'image'
      ? '3Dポーズ参照は、身体の姿勢・手足の位置・カメラの視点・切り取り範囲を指定する画像です。この姿勢と見切れを保ち、画面外の身体を描き足さない。線骨格・関節マーカー・素体の色は完成画に残さない。'
      : `ポーズの説明：${pose.edited_text_ja}`,
    pose.camera_prompt ? `アングル・レンズの説明：${humanPoseCameraPromptText(pose.camera_prompt).ja}` : '',
    '人物資料は顔立ち・髪型・服装・体型・画風に使い、人物資料のポーズや撮影角度へ置き換えない。動作・表情・視線は今回の指定に合わせる。',
  ].filter(Boolean).join('\n\n') : '';
  const poseContext = pose ? [
    `人物：${owner.figure?.name || owner.label}。`,
    pose.input_mode==='prompt' ? `描写範囲は${FIGURE_SIZE_LABELS[framing]}。` : '',
    owner.figure?.action ? `動作・表情・視線：${owner.figure.action}` : '',
    poseInstructions,
    character?.visual_prompt?.trim() ? `人物のビジュアル指定：${character.visual_prompt}` : '',
    character?.default_proportion ? `体型：${character.default_proportion.head_count}頭身を保つ。` : '',
    ...style,
  ].filter(Boolean).join('\n\n') : undefined;
  const prompt=[
    '漫画用の独立した画像を1枚描いてください。参照資料の画風と形を尊重してください。',
    `出力形式：${manga.meta.format}。`,
    owner.kind==='background'?`背景のみ。人物や吹き出しは描かない。背景指示：${owner.description||panel?.background_description||manga.setting.location||'無地'}`
      :lettering?letteringContext
      :`${person?'人物':'小道具'}：${owner.figure?.name||owner.label}。\n背景・文字・吹き出しは加えず、外側は透明にする。`,
    pose?.input_mode!=='image'&&(owner.figure?.size || pose) ? `描写範囲は${FIGURE_SIZE_LABELS[framing]}。${framing==='bust-up'?'頭頂から胸までを画面に収めた構図で描く。':'指定した範囲を画面に収めた構図で描く。'}`:'',
    owner.figure?.action?`動作・表情・視線：${owner.figure.action}`:'',
    poseInstructions,
    character?.visual_prompt?.trim()?`人物のビジュアル指定：${character.visual_prompt}`:'',
    character?.default_proportion?`体型：${character.default_proportion.head_count}頭身を保つ。`:'',
    ...(lettering?[]:style),
    '新しい絵を1枚描く。資料集・コラージュ・コマ枠・署名・透かしは加えない。',
  ].filter(Boolean).join('\n\n');
  const sketchPrompt=person && pose ? [
    '<image1>の人物ラフを、指定した登場人物の漫画イラスト1枚に描き替えてください。',
    `出力形式：${manga.meta.format}。`,
    '人物の外見と画風にはキャラクター設定画を使います。ポーズ・アングル・描写範囲は以下の指定を優先してください。',
    poseContext,
    '人物は1人だけ。別の人物・資料集の別アングル・コマ枠・文字を加えない。',
  ].filter(Boolean).join('\n\n') : person?[
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
  const referenceFrame=owner.paint.referenceFrame?paintReferenceBox(owner.paint,owner.frame):owner.figure?humanPoseFigureFrame({...owner.figure,bbox:owner.frame},owner.frame):owner.frame;
  const cutFrame=pose?.input_mode==='image'&&!overlay?humanPosePanelCutFrame(panel,referenceFrame):undefined;
  const outputFrame=lettering?{...owner.frame}:cutFrame?panelBounds(panel):undefined;
  const dimensions=cutFrame?humanPoseSceneFrame(outputFrame!.w/outputFrame!.h):{width:owner.paint.width,height:owner.paint.height};
  if(generationArea&&(!lettering||![generationArea.x,generationArea.y,generationArea.w,generationArea.h].every(Number.isSafeInteger)||generationArea.x<0||generationArea.y<0||generationArea.w<1||generationArea.h<1||generationArea.x+generationArea.w>owner.paint.width||generationArea.y+generationArea.h>owner.paint.height))throw new Error('生成マスクの範囲が不正です');
  return {profile:QWEN_GENERATION_PROFILE,documentKey:JSON.stringify([manga.meta.series_id,manga.meta.episode_id]),
    pageNumber:page.page,panelId:overlay?0:panel.id,overlay,ownerKey:owner.key,label:owner.label,
    ...dimensions,prompt,characterKeys,candidates,
    ...(lettering?{contentKind:'handwritten' as const,literalText:[lettering.text],letteringContext}:{}),
    ...(outputFrame?{outputFrame,referenceFrame}:{}),
    ...(generationArea?{generationArea:{...generationArea}}:{}),
    ...(sketchPrompt?{sketchPrompt}:{}), ...(pose ? {humanPose:{selection:structuredClone(pose),framing,aspect:referenceFrame.w/referenceFrame.h,...(cutFrame?{cutFrame}:{})},poseContext} : {})};
}

export function qwenGenerationPayload(plan:QwenGenerationPlan,references:QwenReference[],paintImage?:string,sketchImage?:string,correctionImage?:string,poseImage?:string){
  if(!plan.prompt.trim())throw new Error('生成指示を入力してください');
  const sizePrompt=qwenGenerationSizePrompt(plan,Boolean(correctionImage));
  plan={...qwenGenerationTarget(plan,Boolean(correctionImage)),prompt:[plan.prompt,sizePrompt].filter(Boolean).join('\n\n')};
  if(plan.ownerKey.startsWith('bubble-')&&(plan.contentKind!=='handwritten'||plan.literalText?.length!==1||!plan.literalText[0].trim()))throw new Error('吹き出し単品は生成できません。描き文字を選択してください');
  if(plan.contentKind&&(!plan.ownerKey.startsWith('bubble-')||plan.scope))throw new Error('描き文字の生成対象が不正です');
  if(plan.scope){
    if(!plan.compositionImage)throw new Error('紙面の参照画像を用意してから生成してください');
    if(paintImage||sketchImage||correctionImage||poseImage)throw new Error('全体生成の紙面参照に単品レイヤーは追加できません');
    paintImage=plan.compositionImage;
  }
  const usesPoseImage = plan.humanPose?.selection.input_mode === 'image';
  if(usesPoseImage&&!poseImage)throw new Error('3Dポーズの撮影画像を用意してから生成してください');
  if(poseImage&&!usesPoseImage)throw new Error('ポーズ文で送る場合は3D画像を送信できません');
  if(paintImage&&sketchImage)throw new Error('描画画像とネームのラフを同時には指定できません');
  // A pose directive owns the new composition. Paint editing would force the source pose.
  const drawingReference = plan.humanPose && paintImage && !correctionImage ? paintImage : undefined;
  const sourcePaint = drawingReference ? undefined : paintImage;
  const allReferences = [...(drawingReference ? [{label:'描画レイヤー参照：描き方の参考。ポーズ・アングル・描写範囲は今回の指定を優先する。',characterKeys:[],image:drawingReference}] : []),...references,
    ...(poseImage ? [{label:'3Dポーズ参照：身体の姿勢・アングル・切り取りのみ。人物の外見と画風はキャラクター設定画を使う。',characterKeys:[],image:poseImage}] : [])];
  if(sketchImage&&(!plan.ownerKey.startsWith('figure-')||!plan.characterKeys.length))throw new Error('ネームのラフ生成には登場人物の指定が必要です');
  if(allReferences.length>9)throw new Error(usesPoseImage?'3Dポーズ画像と参照資料は合計9枚までです':'参照資料は9枚までです');
  if(allReferences.length+Number(Boolean(sourcePaint||sketchImage))+Number(Boolean(correctionImage))>10)throw new Error('設定画・3Dポーズ画像・選択レイヤーは合計10枚までです');
  if(plan.characterKeys.some(key=>!references.some(r=>r.characterKeys.includes(key))))throw new Error('指定した登場人物の参照資料を選んでください');
  if(references.some(r=>r.characterKeys.some(key=>!plan.characterKeys.includes(key))))throw new Error('参照資料と生成する人物が一致しません');
  const offset=Number(Boolean(sourcePaint||sketchImage))+Number(Boolean(correctionImage));
  const roles=plan.humanPose&&sketchImage?allReferences.map((ref,index)=>`<image${offset+index+1}>：${ref.characterKeys.length?'キャラクター設定画（人物の外見・画風）':ref.label}。`).join('\n'):'';
  return {profile:plan.profile,document_key:plan.documentKey,page_number:plan.pageNumber,panel_id:plan.panelId,
    overlay:plan.overlay,owner_key:plan.ownerKey,label:plan.label,width:plan.width,height:plan.height,
    ...(plan.scope||plan.contentKind==='handwritten'?{literal_text:plan.literalText??[]}:{}),
    ...(plan.contentKind?{content_kind:plan.contentKind}:{}),
    prompt:roles?`${plan.prompt}\n\n添付画像の役割：\n${roles}`:plan.prompt,character_keys:plan.characterKeys,
    mode:sketchImage?'sketch':sourcePaint?'paint':'new',...(sourcePaint?{paint_image:sourcePaint}:{}),...(sketchImage?{sketch_image:sketchImage}:{}),
    ...(correctionImage?{correction_image:correctionImage}:{}),
    references:allReferences.map(r=>({label:r.label,character_keys:r.characterKeys,image:r.image}))};
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
