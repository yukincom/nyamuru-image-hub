import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { deleteQwenJobs, loadCharacterReferenceImage, prepareQwenJob, listQwenJobs, reconcileQwenJob, submitQwenJob } from '../lib/localBridge.ts';
import { withNewCreationBridgeSession, withImageGenerationServices } from '../lib/localBridgeLifecycle.ts';
import { canDeleteQwenJob, qwenGenerationPayload, qwenGenerationPrompt, qwenGenerationTarget, qwenGenerationSizePrompt, qwenLayerPaint, qwenJobLocation, type QwenGenerationPlan, type QwenLayerCandidate, type QwenLayerReference, type QwenHistoryScope, type QwenReference, type QwenJob, type QwenGenerationConversation, type QwenReferenceRole, qwenConversationIntent, executeQwenGeneration } from '../lib/qwenGeneration.ts';
import { validatePaintDocument, type PaintOwner } from '../lib/paintDocument.ts';
import { decodePaintImage, loadPaintImages, renderPaintPng, type PaintImages } from '../lib/paintRenderer.ts';
import { prepareGuideLayer } from '../lib/paintGuide.ts';
import type { BBox, ImageAsset, PaintDocument } from '../types.ts';
import { currentGenerationPreferences } from '../lib/generationPreferences.ts';
import { cloudModelAccess } from '../lib/modelPrivacy.ts';
import { generationHandoff } from '../lib/generationHandoff.ts';
import { chooseBrowserFiles, downloadBrowserBlob } from '../lib/browserFiles.ts';
import {runQwenAgentRequest,type QwenAgentRequest} from '../lib/qwenGeneration.ts';

interface Props { plan:QwenGenerationPlan; adultContent?:boolean; agentRequest?:QwenAgentRequest; layers?:QwenLayerCandidate[]; loadLayer?:(id:string,correction:boolean,crop?:BBox)=>Promise<string>; onClose:()=>void; onInsert:(file:File,target:QwenGenerationPlan)=>Promise<void>; onConversation?:(value:QwenGenerationConversation|null)=>void; onConversationHost?:(host:HTMLElement|null)=>void }
const statusLabel={preparing:'英訳を保存中',prepared:'英訳保存済み',queued:'生成待ち',running:'生成中',succeeded:'生成完了',failed:'失敗',outcome_unknown:'結果未確定'};

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

export default function QwenGenerationDialog({plan,adultContent=false,agentRequest,layers=[],loadLayer,onClose,onInsert,onConversation,onConversationHost}:Props){
  const [execution]=useState(currentGenerationPreferences);
  const cloud=execution.execution==='cloud';
  const [referenceCharacter,setReferenceCharacter]=useState(plan.characterKeys[0]??'');
  const [reference,setReference]=useState<QwenLayerReference>(),[correction,setCorrection]=useState<QwenLayerReference>();
  const [prompt,setPrompt]=useState(plan.prompt),[references,setReferences]=useState<QwenReference[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[job,setJob]=useState<QwenJob|null>(null);
  const [history,setHistory]=useState<QwenJob[]>([]),[attempt,setAttempt]=useState<string|null>(null);
  const [historyScope,setHistoryScope]=useState<QwenHistoryScope|null>(null),[selectedJobs,setSelectedJobs]=useState<string[]>([]);
  const [phase,setPhase]=useState(''),[notice,setNotice]=useState('');
  const [poseImage,setPoseImage]=useState(''),[poseError,setPoseError]=useState(''),[poseAttempt,setPoseAttempt]=useState(0);
  const posePending=useRef<Promise<string|undefined>>();
  const usesPoseImage=plan.humanPose?.selection.input_mode==='image';
  const referenceLimit=usesPoseImage?8:9;
  const submitted=useRef(false);
  const generatedTarget=useRef<{jobId?:string;plan:QwenGenerationPlan}>();
  const alive=useRef(true),working=useRef(false),close=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLElement>(null);
  useEffect(()=>{alive.current=true;const before=document.activeElement;close.current?.focus();return()=>{alive.current=false;if(before instanceof HTMLElement)before.focus();};},[]);
  useEffect(()=>{
    if(!usesPoseImage||!plan.humanPose)return;
    let cancelled=false;setPoseImage('');setPoseError('');
    const {selection,framing,aspect,cutFrame}=plan.humanPose;
    posePending.current=import('../lib/humanPoseGeneration.ts').then(({captureHumanPoseReference})=>captureHumanPoseReference(selection,framing,aspect??plan.width/plan.height,cutFrame)).then(image=>{
      if(!cancelled){setPoseImage(image);return image;}
    }).catch(cause=>{if(!cancelled)setPoseError(cause instanceof Error?cause.message:'3Dポーズを撮影できませんでした');return undefined;});
    return()=>{cancelled=true;};
  },[plan,poseAttempt]);
  const draft=useRef({prompt,references,reference,correction});draft.current={prompt,references,reference,correction};
  const attempted=useRef<string|null>(null);attempted.current=attempt;
  const canPrepareNewGeneration=!attempt||(job?['prepared','succeeded','failed','outcome_unknown'].includes(job.status):!submitted.current);
  function prepareNewGeneration(){
    attempted.current=null;submitted.current=false;setAttempt(null);setJob(null);setError('');setNotice('');
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
    if(plan.candidates.length>referenceLimit)throw new Error(`登録資料が${referenceLimit}枚を超えています。使う資料を画像から選んで追加してください`);
    const loaded=await withNewCreationBridgeSession(async()=>{
      const result:QwenReference[]=[];
      for(const candidate of plan.candidates){
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
    const crop=plan.contentKind==='handwritten'&&!correctionCandidate?plan.generationArea:undefined;
    const nextReference=referenceCandidate?{...referenceCandidate,image:await loadLayer!(referenceCandidate.id,false,crop)}:undefined;
    const nextCorrection=correctionCandidate?{...correctionCandidate,image:await loadLayer!(correctionCandidate.id,true)}:undefined;
    if(!alive.current)return;
    const nextPrompt=draft.current.prompt===qwenGenerationPrompt(plan,reference,correction)
      ? qwenGenerationPrompt(plan,nextReference,nextCorrection):draft.current.prompt;
    draft.current={...draft.current,prompt:nextPrompt,reference:nextReference,correction:nextCorrection};
    setPrompt(nextPrompt);setReference(nextReference);setCorrection(nextCorrection);
  });}
  async function insertResult(result:QwenJob){
    if(!result.image||!result.fileName)throw new Error('差し込む画像がありません');
    const bytes=Uint8Array.from(atob(result.image.split(',')[1]),char=>char.charCodeAt(0));
    await insertImage(new File([bytes],result.fileName,{type:'image/png'}),generatedTarget.current?.jobId===result.jobId?generatedTarget.current.plan:undefined);
  }
  async function insertImage(file:File,capturedTarget?:QwenGenerationPlan){
    const target=capturedTarget??qwenGenerationTarget(plan,Boolean(draft.current.correction));
    if(!target.outputFrame){await onInsert(file,target);return;}
    const bitmap=await createImageBitmap(file);
    try{
      const canvas=document.createElement('canvas');canvas.width=target.width;canvas.height=target.height;
      const context=canvas.getContext('2d');if(!context)throw new Error('生成画像を配置できません');
      const cut=plan.humanPose?.cutFrame;
      if(cut){context.beginPath();cut.points.forEach(([x,y],index)=>{const px=(x-cut.bounds.x)/cut.bounds.w*canvas.width,py=(y-cut.bounds.y)/cut.bounds.h*canvas.height;if(index)context.lineTo(px,py);else context.moveTo(px,py);});context.closePath();context.clip();}
      if(plan.scope){context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);}
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
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
    const {prompt,references,reference,correction}=draft.current;
    const isCurrent=()=>alive.current&&inputIsCurrent();
    if(usesPoseImage)setPhase('3Dポーズの撮影を確認中');
    const capturedPose=usesPoseImage?await posePending.current:undefined;
    if(!isCurrent())throw new Error('生成を中止しました');
    const sketch=reference?.kind==='sketch'&&!correction;
    const target=qwenGenerationTarget(plan,Boolean(correction));
    const payload=qwenGenerationPayload({...plan,prompt},references,sketch?undefined:reference?.image,sketch?reference?.image:undefined,correction?.image,capturedPose);
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
    const id=crypto.randomUUID();
    generatedTarget.current={jobId:id,plan:target};
    submitted.current=false;
    return executeQwenGeneration({id,payload,plan:target,isCurrent,
      prepare:(id,payload)=>{attempted.current=id;setAttempt(id);return prepareQwenJob(id,payload);},
      submit:(prepared,token)=>{submitted.current=true;return submitQwenJob(prepared,token);},reconcile:reconcileQwenJob,
      onJob:current=>{if(alive.current)setJob(current);},
      ...(autoInsert?{insert:insertResult}:{}),
      services:(prepare,generate,options)=>withImageGenerationServices(prepare,generate,{...options,onPhase:value=>{
        if(alive.current)setPhase({bridge:'準備中',llm:'英訳の準備中',translate:'英訳を保存中',suspend:'文章LLMを停止中',generate:'画像生成中',restore:'生成後の復帰を確認中'}[value]);
      }}),
    });
  },autoInsert);}
  async function conversationSend(text:string,isCurrent:()=>boolean){
    if(!alive.current||!isCurrent())return '生成の会話を終了しました';
    const intent=qwenConversationIntent(text);
    if(intent==='hold')return '新しい生成は開始していません。指示を整えてから「生成して」と送ってください。';
    if(intent==='help')return '参照画像を追加して、追加の指示を送れます。「生成して」と送ると、生成後に新規レイヤーとして追加します。';
    if(working.current)throw new Error('処理が終わるまでお待ちください');
    if(attempted.current)throw new Error('この生成は開始済みです。生成状況を確認してください');
    if(intent==='instruction'){
      if(draft.current.prompt.length+text.length>12000)throw new Error('追加の指示が長すぎます。生成指示を整理してください');
      updatePrompt(`${draft.current.prompt}\n\n${text.trim()}`);
      return '追加の指示を生成指示に反映しました。「生成して」で生成し、新規レイヤーとして追加します。';
    }
    const result=await generate(true,isCurrent);
    if(cloud)return '指示と参照画像のZIPを保存しました。指定のエージェントへ渡し、完成したPNGをこの画面で読み込んでください。';
    return result?.inserted?`${plan.label}を生成し、新規レイヤーとして追加しました。元に戻す操作も使えます。`:'自動差し込みは中止しました。開始済みの生成は生成状況から確認できます。';
  }
  useEffect(()=>{
    onConversation?.({label:`${plan.pageNumber}ページ・${plan.overlay?'ページ前景':`コマ ${plan.panelId}`}・${plan.label}`,
      busy,locked:Boolean(attempt),phase,references,character:plan.characterKeys.length>0,
      addFiles:(files,role)=>addFiles(files,role,true),loadRegistered:()=>loadRegistered(true),send:conversationSend});
  },[onConversation,busy,attempt,phase,prompt,references,reference,correction,job,referenceCharacter]);
  useEffect(()=>()=>onConversation?.(null),[onConversation]);
  const agentStarted=useRef(false);
  useEffect(()=>{
    if(!agentRequest||agentStarted.current)return;
    agentStarted.current=true;
    void runQwenAgentRequest(agentRequest,async()=>{if(plan.characterKeys.length)await loadRegistered(true);},conversationSend);
  },[agentRequest]);
  async function check(id:string){await operation(async()=>{
    const expected=job?.jobId===id?job:history.find(item=>item.jobId===id);
    const result=await withNewCreationBridgeSession(()=>reconcileQwenJob(id,expected?.requestSha256));
    if(result.documentKey!==plan.documentKey)throw new Error('生成履歴の作品が一致しません');
    if(alive.current){setJob(result);setAttempt(id);}
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
      <header><div><h2 id="qwen-generation-title">生成</h2><p>{cloud?'クラウドへ渡す画像と指示':'Qwen-Image-2.1 Turbo'} · {plan.scope==='page'?'ページ全体':plan.overlay?'ページ前景':`コマ ${plan.panelId}`} · {plan.label}</p></div><button ref={close} disabled={busy} onClick={onClose}>閉じる</button></header>
      <div class="qwen-conversation-layout"><div class="qwen-generation-controls">
      {plan.compositionImage&&<fieldset><legend>送信する紙面</legend><figure class="qwen-paint-reference"><img src={plan.compositionImage} alt={`${plan.label}の参照画像`}/><figcaption>人物配置・コマ形状・フキダシと文字の参照</figcaption></figure></fieldset>}
      {usesPoseImage&&<fieldset><legend>送信する3Dポーズ</legend>
        {poseImage?<figure class="qwen-paint-reference"><img src={poseImage} alt="描写範囲に合わせた3Dポーズ参照"/><figcaption>姿勢・アングル・切り取り範囲の参照</figcaption></figure>
          :poseError?<><p role="alert">{poseError}</p><button disabled={busy||Boolean(attempt)} onClick={()=>setPoseAttempt(value=>value+1)}>撮影を再試行</button></>:<p role="status">保存した3Dポーズを撮影しています…</p>}
        <p>人物の外見と画風には、下のキャラクター設定画を使います。</p>
      </fieldset>}
      {!plan.scope&&<fieldset disabled={busy||Boolean(attempt)}><legend>「{plan.label}」フォルダのレイヤー</legend>
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
      {plan.characterKeys.length>0&&<fieldset disabled={busy||Boolean(attempt)}><legend>キャラクター設定画</legend>
        {plan.characterKeys.length>1&&<label>追加する設定画の人物<select aria-label="設定画の人物" value={referenceCharacter} onChange={e=>setReferenceCharacter(e.currentTarget.value)}>{plan.characterKeys.map((key,index)=><option value={key}>Character {index+1} · {plan.candidates.find(candidate=>candidate.characterKeys?.includes(key))?.label??key}</option>)}</select></label>}
        <div class="paint-entry-actions"><button onClick={()=>void loadRegistered()} disabled={!plan.candidates.length}>登録資料を読み込む</button><label class="qwen-file-label">設定画を追加<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e=>{const files=Array.from(e.currentTarget.files??[]);e.currentTarget.value='';void addFiles(files);}}/></label></div>
        <p>設定画は人物の外見と画風の参照に使います。「設定画を追加」は今回の生成だけに使い、人物資料には登録しません。</p>
        <div class="qwen-reference-list">{references.map((reference,index)=><figure><img src={reference.image} alt={reference.label}/><figcaption>{reference.label} · {reference.characterKeys.length?'人物設定画':'描画参考'}</figcaption><button onClick={()=>updateReferences(references.filter((_,i)=>i!==index))}>外す</button></figure>)}</div>
      </fieldset>}
      {plan.contentKind==='handwritten'&&<div class="qwen-output-size"><output>{qwenGenerationSizePrompt(plan,Boolean(correction))}</output><div>生成範囲：{plan.generationArea&&!correction?'生成マスクの外接矩形':'フォルダーのキャンバス全体'} · 生成解像度：{cloud?'指定サイズ':'Qwenが縦横比に合わせて調整'}</div></div>}
      <label class="qwen-prompt">生成指示<textarea rows={8} value={prompt} disabled={busy||!canPrepareNewGeneration} onInput={e=>updatePrompt(e.currentTarget.value)}/></label>
      <div class="paint-entry-actions">
        <button class="primary-button" disabled={busy||Boolean(attempt)||usesPoseImage&&!poseImage} onClick={()=>void generate()}>{cloud?'指示と参照画像を書き出す':'Qwenで実行'}</button>
        {cloud&&<button disabled={busy} onClick={()=>void importGenerated()}>生成画像を読み込む</button>}
        {!cloud&&attempt&&<button disabled={busy} onClick={()=>void check(attempt)}>生成状況を確認</button>}
        {!cloud&&<><button disabled={busy} aria-pressed={historyScope==='owner'} onClick={()=>void loadHistory('owner')}>生成履歴</button>
        <button disabled={busy} aria-pressed={historyScope==='work'} onClick={()=>void loadHistory('work')}>作品の生成履歴</button></>}
      </div>
      {busy&&phase&&<p role="status">{phase}</p>}
      {notice&&<p role="status">{notice}</p>}
      {attempt&&!busy&&!job&&canPrepareNewGeneration&&<button onClick={prepareNewGeneration}>新しい生成を準備</button>}
      {error&&<p role="alert">{error}{attempt?' 送信済みの可能性があるため、生成状況を確認してください。':''}</p>}
      {job&&<section class="qwen-result" aria-live="polite"><strong>{statusLabel[job.status]}</strong>{job.error&&<p>{job.error}</p>}
        {job.documentKey&&<small>{qwenJobLocation(job)}</small>}
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
