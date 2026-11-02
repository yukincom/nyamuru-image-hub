import { handwrittenStylePrompt } from './handwrittenStyle.ts';
import {paintLayerVisible} from './paintLock.ts';
import type { Manga, CharacterReferenceSourceImage, AnalogFigureImport, FigureSize, BBox } from '../types.ts';
import type { PaintOwner } from './paintDocument.ts';
import { compileArtworkRules, getArtworkSettings, type ArtworkSource } from './artworkRules.ts';
import { isPropPlacement } from './catalogModel.ts';
import { CHARACTER_RECOGNITION_FIELDS } from './characterReferences.ts';
import { FIGURE_SIZE_LABELS } from './manga.ts';
import { requireHumanPoseGenerationReady } from './humanPoseSelection.ts';
import { humanPoseCameraPromptText } from './humanPoseScene.ts';
import type { ComfyWorkflowDefinition } from './comfyWorkflows.ts';
import type { HumanPoseTextSelection } from './humanPoseTypes.ts';
import { paintReferenceBox } from './paintDocument.ts';
import { panelBounds } from './canvasGeometry.ts';
import { humanPoseFigureFrame, humanPosePanelCutFrame, threeImageFigureTarget, type HumanPoseCutFrame } from './humanPoseFraming.ts';
import { humanPoseSceneFrame } from './humanPoseScene.ts';
import { getPrintSetup } from './printSettings.ts';
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
  threeImageTarget?: NonNullable<ReturnType<typeof threeImageFigureTarget>> & { referenceFrame:BBox };
  threeImages?: boolean;
  dpi?: number;
  artworkStyle?: string[];
  figureAction?: string;
  characterAppearance?: string;
  expressionSource?: Pick<AnalogFigureImport,'assetId'|'persistentAsset'>;
  figureFraming?: FigureSize;
  sketchPrompt?: string;
  humanPose?: { selection: HumanPoseTextSelection; framing: FigureSize; aspect?: number; cutFrame?: HumanPoseCutFrame };
  scope?: 'page'|'panel';
  literalText?: string[];
  contentKind?: 'handwritten'|'typeset';
  letteringContext?: string;
  handwrittenPrompt?: { confirmation:string; description?:string };
  compositionImage?: string;
  outputFrame?: BBox;
  referenceFrame?: BBox;
  generationArea?: BBox;
  folderId?: string;
  poseContext?: string;
}
export interface QwenReference { label: string; characterKeys: string[]; image: string }
export interface QwenLayerCandidate { id:string; label:string; kind:'paint'|'sketch'; hidden:boolean; empty:boolean }
export interface QwenLayerReference extends QwenLayerCandidate { image:string }
export function canGeneratePaintOwner(owner: Pick<PaintOwner,'kind'|'bubble'>): boolean {
  return owner.kind==='figure'||owner.kind==='background'||owner.kind==='bubble'&&Boolean(owner.bubble&&['handwritten','typeset'].includes(owner.bubble.shape??''));
}
export function qwenLayerCandidates(owner:PaintOwner):QwenLayerCandidate[] {
  return [...owner.paint.layers].reverse().map(layer=>({id:layer.id,label:layer.name,
    kind:layer.guide&&owner.figure?.analogImport?'sketch' as const:'paint' as const,hidden:!paintLayerVisible(owner.paint,layer),
    empty:layer.opacity<=0||!(layer.guide||layer.image||layer.strokes.length||layer.paths?.length||layer.tone?.enabled&&layer.tone.fill)}));
}
/** Select only inside the captured owner; the export copy can reveal the chosen layer. */
export function qwenLayerPaint(owner:PaintOwner,id:string,includeGeneration=false) {
  const candidate=qwenLayerCandidates(owner).find(layer=>layer.id===id);
  if(!candidate)throw new Error('選択したレイヤーがこのフォルダにありません');
  if(candidate.empty)throw new Error('空または濃度0%のレイヤーは参照できません');
  const layer=owner.paint.layers.find(layer=>layer.id===id)!;
  if(layer.generationMask){
    if(!includeGeneration)throw new Error('生成マスクは、ピンポイント修正用に選んでください');
    return {...owner.paint,folders:undefined,layers:[...owner.paint.layers.filter(item=>!item.generationMask).map(item=>({...item,folderId:undefined,visible:paintLayerVisible(owner.paint,item)})),{...layer,folderId:undefined,visible:true}]};
  }
  return {...owner.paint,folders:undefined,layers:[{...layer,folderId:undefined,visible:true}]};
}
export function qwenGenerationPrompt(plan:QwenGenerationPlan,reference?:QwenLayerReference,correction?:QwenLayerReference) {
  if(correction)return [
    '修正用レイヤーの印・塗り・書き込みが示す箇所を、今回の修正指示に従って編集してください。',
    reference?'参照画像の構図と、修正対象以外の内容を保ってください。':'書き込み付き画像の構図と、修正対象以外の内容を保ってください。',
    plan.characterKeys.length?'キャラクター設定画は、同じ人物の外見と画風を保つための資料です。':'',
    '修正を指示する印・塗り・文字は、完成画像には残さないでください。',
    plan.poseContext ? `以下は修正部分の人物・ポーズの指定です。修正対象以外は保ってください。\n${plan.poseContext}` : '',
    !plan.poseContext ? plan.characterAppearance : '',
    plan.letteringContext ?? '',
  ].filter(Boolean).join('\n\n');
  if(reference?.kind==='paint'&&plan.humanPose)return `${plan.prompt}\n\n描画レイヤー参照は描き方の参考に使い、ポーズ・アングル・描写範囲は今回の指定を優先してください。`;
  return reference?.kind==='sketch'?(plan.sketchPrompt??plan.prompt):plan.prompt;
}

/** A correction keeps the full captured canvas; a new lettering image uses its marker bounds. */
export function qwenGenerationTarget(plan:QwenGenerationPlan,correction=false):QwenGenerationPlan {
  const area=Boolean(plan.contentKind)&&!correction?plan.generationArea:undefined,frame=plan.outputFrame;
  if(!area||!frame)return plan;
  return {...plan,generationArea:undefined,width:area.w,height:area.h,outputFrame:{
    x:frame.x+area.x*frame.w/plan.width,y:frame.y+area.y*frame.h/plan.height,
    w:area.w*frame.w/plan.width,h:area.h*frame.h/plan.height,
  }};
}
/** Update only the preset’s two background instructions, leaving authored character colors alone. */
export function figureBackgroundPrompt(prompt:string,color:string):string {
  const chroma:Record<string,[string,string]>={'#00FF00':['green','0, 255, 0'],'#0000FF':['blue','0, 0, 255'],'#FF00FF':['magenta','255, 0, 255']};
  if(!chroma[color])return prompt;
  const [name,rgb]=chroma[color];
  for(const [hex,[previous,oldRgb]] of Object.entries(chroma)){
    prompt=prompt.replace(`solid chroma ${previous} (${hex}, RGB ${oldRgb}) background.`,`solid chroma ${name} (${color}, RGB ${rgb}) background.`)
      .replace(`with solid bright chroma ${previous} (${hex}) right up`,`with solid bright chroma ${name} (${color}) right up`);
  }
  return prompt;
}
export function qwenPlanForWorkflow(plan:QwenGenerationPlan,workflow:ComfyWorkflowDefinition|null):QwenGenerationPlan {
  if(workflow?.binding.prompt_mode!=='qwen-three-images')return plan;
  const slot=workflow.binding.prompt[0];
  // The colour selector supplies this last line; keep the artwork text editable.
  const base=String(workflow.graph[slot.node].inputs[slot.input]).replace(/\nUniform solid #(00FF00|0000FF|FF00FF) background\.$/,'');
  const style=plan.artworkStyle?.filter(Boolean).join('\n');
  const prompt=[base,
    plan.characterAppearance && `Character & Design (from <image2>):\n${plan.characterAppearance}`,
    plan.figureAction && `Expression and acting (from <image3>):\n${plan.figureAction}`,
    style && `Character Inking & Pen Touch (character only, matching <image2>):\nApply these techniques only to features and clothing present in this character's design.\n${style}`,
  ].filter(Boolean).join('\n\n');
  if(!plan.threeImageTarget)return {...plan,prompt};
  const {width,height,dpi,referenceFrame,outputFrame,cutFrame}=plan.threeImageTarget;
  return {...plan,threeImages:true,width,height,dpi,referenceFrame,outputFrame,prompt,...(plan.humanPose?{humanPose:{...plan.humanPose,cutFrame}}:{})};
}
export function qwenGenerationSizePrompt(plan:QwenGenerationPlan,correction=false,outputSize?:readonly [number,number]):string {
  if(!plan.contentKind)return '';
  const target=qwenGenerationTarget(plan,correction),frame=target.outputFrame;
  return `出力キャンバス：幅${outputSize?.[0]??target.width} × 高さ${outputSize?.[1]??target.height} px。${frame?`原稿上の配置サイズ：幅${Number(frame.w.toFixed(2))} × 高さ${Number(frame.h.toFixed(2))} mm。`:''}文字全体をこの縦横比の範囲内に収めてください。`;
}
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

/** The owner is resolved by the editor, never inferred from a name or a filename. */
export function buildQwenGenerationPlan(manga:Manga, pageIndex:number, panelIndex:number, overlay:boolean, owner:PaintOwner, standardArtwork?:ArtworkSource,generationArea?:BBox,editPoseInDialog=false):QwenGenerationPlan {
  const page=manga.pages[pageIndex], panel=page?.panels[panelIndex];
  if(!page||(!overlay&&!panel))throw new Error('生成対象が見つかりません');
  if(!canGeneratePaintOwner(owner))throw new Error('単品生成は人物・小道具・背景・描き文字・写植文字が対象です');
  const lettering=owner.kind==='bubble'?owner.bubble:undefined;
  if(lettering){
    const current=(overlay?page.page_overlay:panel)?.bubbles?.[owner.index];
    if(!current||!['handwritten','typeset'].includes(current.shape??'')||current.shape!==lettering.shape||current.text!==lettering.text||JSON.stringify(current.text_style)!==JSON.stringify(lettering.text_style)||handwrittenStylePrompt(current)!==handwrittenStylePrompt(lettering))throw new Error('描き文字が変更されました。生成対象を選び直してください');
    if(!lettering.text.trim()||lettering.text.length>500)throw new Error('文字の本文を1〜500文字で入力してください');
  }
  const pose = owner.figure?.human_pose;
  if(owner.kind==='figure' && JSON.stringify(pose) !== JSON.stringify((overlay?page.page_overlay:panel)?.figures?.[owner.index]?.human_pose)) throw new Error('人体ポーズが変更されました。生成対象を選び直してください');
  if(!editPoseInDialog)requireHumanPoseGenerationReady(pose);
  const person=owner.figure&&!isPropPlacement(owner.figure);
  const character=person&&owner.figure?.refId?manga.characters.find(c=>c.localId===owner.figure!.refId):undefined;
  if(person&&!character)throw new Error('この人物あたりの登場人物を指定してから生成してください');
  const characterKeys=character?.localId?[character.localId]:[];
  const observed=Array.from(new Set(CHARACTER_RECOGNITION_FIELDS.flatMap(({key})=>
    character?.recognition?.[key]?.observed.map(value=>value.trim()).filter(Boolean)??[])));
  const characterAppearance=[
    character?.visual_prompt?.trim(),
    observed.length ? `Observed features: ${observed.join('; ')}` : '',
  ].filter(Boolean).join('\n');
  const candidates:QwenReferenceCandidate[]=character?.catalog_id&&manga.meta.series_id
    ? manga.materials.filter(m=>m.type==='character'&&m.source_image&&(
      m.characterId ? m.characterId===character.localId : m.character_catalog_id===character.catalog_id))
      .sort((a,b)=>Number(b.catalog_id===character.primary_material_catalog_id)-Number(a.catalog_id===character.primary_material_catalog_id))
      .map(m=>({label:m.key,seriesId:manga.meta.series_id,characterCatalogId:character.catalog_id!,source:m.source_image!,characterKeys})) : [];
  const artwork=compileArtworkRules(getArtworkSettings(manga),lettering?'handwritten':'character',standardArtwork);
  const style=artwork.style_notes;
  const letteringContext=lettering?[
    lettering.shape==='typeset'?'描く対象：写植文字（shape=typeset）。':'描く対象：描き文字（shape=handwritten）。',
    `文字の組み方向：${textStyleOf(lettering,'bubble').orientation==='vertical'?'縦書き':'横書き'}`,
    `読み方向：${manga.meta.reading_direction==='right-to-left'?'右から左':'左から右'}`,
    `text:\n${lettering.text}`,
    ...(lettering.shape==='typeset'?[`書体：${textStyleOf(lettering,'bubble').font??manga.meta.font??'アンチック体'}`,`文字の太さ：${textStyleOf(lettering,'bubble').fontWeight??600}`]:[]),
    handwrittenStylePrompt(lettering,undefined,'ja'),
    ...style,lettering.shape==='handwritten'?artwork.layout_spec:'',
    lettering.shape==='typeset'?'指定した本文だけを写植文字として描いてください。指定した書体と太さに従い、文字の外側は透明にしてください。':'上記の本文の描き文字だけを描いてください。文字以外の絵は加えず、文字の外側は透明にしてください。文字の形・線・勢い・質感は、選択したペンと表現に従ってください。',
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
    characterAppearance ? `人物のビジュアル指定：${characterAppearance}` : '',
    character?.default_proportion ? `体型：${character.default_proportion.head_count}頭身を保つ。` : '',
    ...style,
  ].filter(Boolean).join('\n\n') : undefined;
  const prompt=[
    '漫画用の独立した画像を1枚描いてください。参照資料の画風と形を尊重してください。',
    `出力形式：${manga.meta.format}。`,
    owner.kind==='background'?`背景のみ。人物や吹き出しは描かない。背景指示：${owner.description||panel?.background_description||manga.setting.location||'無地'}`
      :lettering?letteringContext
      :`${person?'人物':'小道具'}：${owner.figure?.name||owner.label}。\n文字・吹き出し・背景の風景は加えない。`,
    pose?.input_mode!=='image'&&(owner.figure?.size || pose) ? `描写範囲は${FIGURE_SIZE_LABELS[framing]}。${framing==='bust-up'?'頭頂から胸までを画面に収めた構図で描く。':'指定した範囲を画面に収めた構図で描く。'}`:'',
    owner.figure?.action?`動作・表情・視線：${owner.figure.action}`:'',
    poseInstructions,
    characterAppearance ? `人物のビジュアル指定：${characterAppearance}` : '',
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
    characterAppearance ? `人物のビジュアル指定：${characterAppearance}` : '',
    character?.default_proportion?`体型：${character.default_proportion.head_count}頭身を保つ。`:'',
    ...style,
    '人物は1人だけ。画面外の手足を描き足さず、別の人物・資料集の別アングル・コマ枠・文字を加えない。',
  ].filter(Boolean).join('\n\n'):undefined;
  const referenceFrame=owner.paint.referenceFrame?paintReferenceBox(owner.paint,owner.frame):owner.figure?humanPoseFigureFrame({...owner.figure,bbox:owner.frame},owner.frame):owner.frame;
  const cutFrame=pose?.input_mode==='image'&&!overlay?humanPosePanelCutFrame(panel,referenceFrame):undefined;
  const outputFrame=lettering?{...owner.frame}:cutFrame?panelBounds(panel):undefined;
  const dimensions=cutFrame?humanPoseSceneFrame(outputFrame!.w/outputFrame!.h):{width:owner.paint.width,height:owner.paint.height};
  const figureTarget=person?threeImageFigureTarget(owner,referenceFrame,overlay?undefined:panel,generationArea,getPrintSetup(manga).dpi):undefined;
  if(generationArea&&((!lettering&&!figureTarget)||![generationArea.x,generationArea.y,generationArea.w,generationArea.h].every(Number.isSafeInteger)||generationArea.x<0||generationArea.y<0||generationArea.w<1||generationArea.h<1||generationArea.x+generationArea.w>owner.paint.width||generationArea.y+generationArea.h>owner.paint.height))throw new Error('生成マスクの範囲が不正です');
  return {profile:QWEN_GENERATION_PROFILE,documentKey:JSON.stringify([manga.meta.series_id,manga.meta.episode_id]),
    pageNumber:page.page,panelId:overlay?0:panel.id,overlay,ownerKey:owner.key,label:owner.label,
    ...dimensions,prompt,characterKeys,candidates,
    ...(characterAppearance?{characterAppearance}:{}),
    ...(lettering?{contentKind:lettering.shape as 'handwritten'|'typeset',literalText:[lettering.text],letteringContext,handwrittenPrompt:{confirmation:prompt}}:{}),
    ...(outputFrame?{outputFrame,referenceFrame}:{}),
    ...(person?{figureFraming:framing,figureAction:owner.figure?.action?.trim()}:{}),
    ...(person&&owner.figure?.analogImport?{expressionSource:{assetId:owner.figure.analogImport.assetId,persistentAsset:owner.figure.analogImport.persistentAsset}}:{}),
    ...(figureTarget?{artworkStyle:style,threeImageTarget:{...figureTarget,referenceFrame}}:{}),
    ...(lettering&&generationArea?{generationArea:{...generationArea}}:{}),
    ...(sketchPrompt?{sketchPrompt}:{}), ...(pose ? {humanPose:{selection:structuredClone(pose),framing,aspect:referenceFrame.w/referenceFrame.h,...(cutFrame?{cutFrame}:{})},poseContext} : {})};
}

export function qwenGenerationPayload(plan:QwenGenerationPlan,references:QwenReference[],paintImage?:string,sketchImage?:string,correctionImage?:string,poseImage?:string,outputSize?:readonly [number,number]){
  if(!plan.prompt.trim())throw new Error('生成指示を入力してください');
  const sizePrompt=qwenGenerationSizePrompt(plan,Boolean(correctionImage),outputSize);
  plan={...qwenGenerationTarget(plan,Boolean(correctionImage)),prompt:[plan.prompt,sizePrompt].filter(Boolean).join('\n\n')};
  if(plan.ownerKey.startsWith('bubble-')&&(!plan.contentKind||plan.literalText?.length!==1||!plan.literalText[0].trim()))throw new Error('吹き出し単品は生成できません。描き文字を選択してください');
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
  if(plan.threeImages && (!paintImage||!poseImage||sketchImage||correctionImage||references.length!==1||
    plan.characterKeys.length!==1||!references[0].characterKeys.includes(plan.characterKeys[0])))
    throw new Error('ネーム・人物設定画1枚・3Dポーズを指定してください');
  // A pose directive owns the new composition. Paint editing would force the source pose.
  const drawingReference = plan.humanPose && paintImage && !correctionImage ? paintImage : undefined;
  const sourcePaint = drawingReference ? undefined : paintImage;
  const poseRef=poseImage?{label:plan.threeImages?'3Dの詳細ポーズ':'3Dポーズ参照：身体の姿勢・アングル・切り取りのみ。人物の外見と画風はキャラクター設定画を使う。',characterKeys:[],image:poseImage}:undefined;
  const drawingRef=drawingReference?{label:plan.threeImages?'ネームの表情・感情':'描画レイヤー参照：描き方の参考。ポーズ・アングル・描写範囲は今回の指定を優先する。',characterKeys:[],image:drawingReference}:undefined;
  const allReferences=(plan.threeImages?[poseRef,...references,drawingRef]:[drawingRef,...references,poseRef])
    .filter((ref):ref is QwenReference=>ref!==undefined);
  if(sketchImage&&(!plan.ownerKey.startsWith('figure-')||!plan.characterKeys.length))throw new Error('ネームのラフ生成には登場人物の指定が必要です');
  if(allReferences.length>9)throw new Error(usesPoseImage?'3Dポーズ画像と参照資料は合計9枚までです':'参照資料は9枚までです');
  if(allReferences.length+Number(Boolean(sourcePaint||sketchImage))+Number(Boolean(correctionImage))>10)throw new Error('設定画・3Dポーズ画像・選択レイヤーは合計10枚までです');
  if(plan.characterKeys.some(key=>!references.some(r=>r.characterKeys.includes(key))))throw new Error('指定した登場人物の参照資料を選んでください');
  if(references.some(r=>r.characterKeys.some(key=>!plan.characterKeys.includes(key))))throw new Error('参照資料と生成する人物が一致しません');
  const offset=Number(Boolean(sourcePaint||sketchImage))+Number(Boolean(correctionImage));
  const roles=plan.humanPose&&sketchImage?allReferences.map((ref,index)=>`<image${offset+index+1}>：${ref.characterKeys.length?'キャラクター設定画（人物の外見・画風）':ref.label}。`).join('\n'):'';
  const cut=plan.threeImages?plan.humanPose?.cutFrame:undefined;
  return {candidate_count:5,profile:plan.profile,document_key:plan.documentKey,page_number:plan.pageNumber,panel_id:plan.panelId,
    overlay:plan.overlay,owner_key:plan.ownerKey,label:plan.label,width:plan.width,height:plan.height,
    ...(cut?{dpi:plan.dpi,clip_polygon:cut.points.map(([x,y])=>[(x-cut.bounds.x)/cut.bounds.w,(y-cut.bounds.y)/cut.bounds.h])}:{}),
    ...(plan.scope||plan.contentKind?{literal_text:plan.literalText??[]}:{}),
    ...(plan.contentKind?{content_kind:plan.contentKind}:{}),
    ...(plan.contentKind&&plan.handwrittenPrompt?{handwritten_prompt:{...plan.handwrittenPrompt,confirmation:[plan.handwrittenPrompt.confirmation,sizePrompt].filter(Boolean).join('\n\n')}}:{}),
    prompt:roles?`${plan.prompt}\n\n添付画像の役割：\n${roles}`:plan.prompt,character_keys:plan.characterKeys,
    mode:sketchImage?'sketch':sourcePaint?'paint':'new',...(sourcePaint?{paint_image:sourcePaint}:{}),...(sketchImage?{sketch_image:sketchImage}:{}),
    ...(correctionImage?{correction_image:correctionImage}:{}),
    references:allReferences.map(r=>({label:r.label,character_keys:r.characterKeys,image:r.image}))};
}


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
