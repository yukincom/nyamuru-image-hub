import { requestVoiceCommand } from './localBridge.ts';
import { normalizeVoiceInputMode, normalizeVoiceSilenceMs, type VoiceInputMode } from './agentPreferences.ts';

async function audioBase64(blob:Blob):Promise<string>{
 const data=new Uint8Array(await blob.arrayBuffer());let binary='';
 for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));
 return btoa(binary);
}

/** Quick input waits for its utterance handler before listening again; manual input keeps a draft. */
export function createEditorDictation(options:{text:(text:string,context:{mode:VoiceInputMode;isCurrent:()=>boolean})=>void|Promise<void>;status:(message:string)=>void;active:(active:boolean)=>void;processing?:(active:boolean)=>void;settings?:()=>{mode?:VoiceInputMode;silenceMs?:number};request?:(action:'voice/transcribe',body:object)=>Promise<unknown>}){
 let wanted=false,epoch=0,startId=0,queue:Blob[]=[],working=false;
 let capture:{stream:MediaStream;context:AudioContext;mode:VoiceInputMode;silenceMs:number;recorder?:MediaRecorder;recorderComplete:boolean;timer?:ReturnType<typeof setInterval>;ended:boolean;released:boolean}|undefined;
 const release=(session:NonNullable<typeof capture>)=>{
  if(session.released)return;session.released=true;clearInterval(session.timer);session.stream.getTracks().forEach(track=>track.stop());void session.context.close().catch(()=>{});
  if(capture===session)capture=undefined;
  options.processing?.(working||queue.length>0||Boolean(capture?.ended));
 };
 async function drain(ticket:number,session:NonNullable<typeof capture>){
  if(working)return;working=true;options.processing?.(true);
  const isCurrent=()=>ticket===epoch&&(session.mode==='manual'||(wanted&&!session.ended));
  try{while(queue.length&&ticket===epoch){
   const blob=queue.shift()!;options.status('音声を文字にしています…');
   try{
    const result=await (options.request??requestVoiceCommand)('voice/transcribe',{audio:await audioBase64(blob),mime_type:blob.type}) as {text?:unknown};
    if(!isCurrent())return;
    if(typeof result.text!=='string')throw new Error('音声認識の応答が不正です');
    if(result.text.trim())await options.text(result.text,{mode:session.mode,isCurrent});
    if(!isCurrent())return;
    options.status(session.mode==='quick'?'軽量対話オン · 次の発話を待っています':wanted?'録音中… 停止ボタンで終了できます':result.text.trim()?'音声を入力欄に追加しました。確認して送信できます':'音声を聞き取れませんでした。もう一度入力してください');
   }catch(error){if(ticket===epoch){if(session.mode==='quick')stop(true);options.status(error instanceof Error?error.message:'音声を認識できませんでした');}}
  }}finally{working=false;if(queue.length)void drain(epoch,session);else options.processing?.(Boolean(capture?.ended));}
 }
 function segment(session:NonNullable<typeof capture>,ticket:number){
  if(session.ended||ticket!==epoch)return;
  try{
  const preferred=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
  const current=new MediaRecorder(session.stream,preferred?{mimeType:preferred}:undefined);session.recorder=current;session.recorderComplete=false;
  const chunks:Blob[]=[];let speechMs=0,lastVoice=0;const started=Date.now();
  const analyser=session.context.createAnalyser();analyser.fftSize=1024;
  const source=session.context.createMediaStreamSource(session.stream);source.connect(analyser);const samples=new Float32Array(analyser.fftSize);
  current.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
  current.onerror=()=>{if(capture===session&&session.recorder===current&&!session.ended){stop(session.mode==='quick');options.status('マイク録音を継続できませんでした');}};
  current.onstop=()=>{
   session.recorderComplete=true;
   clearInterval(session.timer);source.disconnect();analyser.disconnect();
   let processed:Promise<void>|undefined;
   if(ticket===epoch&&speechMs>=250&&chunks.length){
    const blob=new Blob(chunks,{type:current.mimeType});
    if(blob.size>6*1024*1024){if(session.mode==='quick')stop(true);options.status('録音が長すぎます。短く区切って話してください');}
    else {queue.push(blob);processed=drain(ticket,session);if(queue.length>=3){stop();options.status('入力した音声を処理するため録音を停止しました。少し待ってから再開してください');}}
   }
   const resume=()=>{if(!session.ended&&ticket===epoch)segment(session,ticket);else release(session);};
   if(session.mode==='quick'&&processed)void processed.then(resume);else resume();
  };
  current.start();
  session.timer=setInterval(()=>{
   analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,n)=>sum+n*n,0)/samples.length),now=Date.now();
   if(rms>.012){speechMs+=100;lastVoice=now;}
   const pauseMs=session.mode==='quick'?session.silenceMs:750;
   const heardVoice=session.mode==='quick'?speechMs>0:speechMs>=250;
   if(current.state==='recording'&&(now-started>=30000||(heardVoice&&now-lastVoice>=pauseMs))){clearInterval(session.timer);current.stop();}
  },100);
  }catch(error){if(capture===session)stop();release(session);options.status(error instanceof Error?error.message:'マイク録音を継続できませんでした');}
 }
 async function start(){
  if(wanted)return;if(capture||working||queue.length){options.status('文字起こしが終わってから録音を再開できます');return;}
  const settings=options.settings?.(),mode=normalizeVoiceInputMode(settings?.mode),silenceMs=normalizeVoiceSilenceMs(settings?.silenceMs);
  wanted=true;const ticket=epoch,request=++startId;options.active(true);options.status('マイクの使用を確認しています…');
  try{
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('このブラウザーは音声入力に対応していません');
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(!wanted||request!==startId||ticket!==epoch){stream.getTracks().forEach(track=>track.stop());return;}
   let audioContext:AudioContext;try{audioContext=new AudioContext();}catch(error){stream.getTracks().forEach(track=>track.stop());throw error;}
   const session={stream,context:audioContext,mode,silenceMs,recorderComplete:true,ended:false,released:false};capture=session;await session.context.resume();
   if(!wanted||request!==startId||ticket!==epoch){release(session);return;}
   segment(session,ticket);if(!session.ended)options.status(mode==='quick'?`軽量対話オン · 無音${silenceMs/1000}秒で自動送信`:'録音中… 停止ボタンで終了できます');
  }catch(error){if(request===startId&&ticket===epoch){stop(true);options.status(error instanceof Error?error.message:'マイクを使用できませんでした');}}
 }
 function stop(discard=false){
  wanted=false;startId++;options.active(false);
  if(discard){epoch++;queue=[];}
  const session=capture;
  if(session){
   session.ended=true;clearInterval(session.timer);
   // MediaRecorder becomes inactive before its final data/stop events arrive.
   if(session.recorder&&!session.recorderComplete){options.processing?.(true);if(session.recorder.state==='recording')session.recorder.stop();}
   else release(session);
  }
  options.status(discard?'':'音声入力を停止しました');
 }
 return {start,stop,toggle(){if(wanted)stop(capture?.mode==='quick');else void start();},dispose(){stop(true);},get active(){return wanted;}};
}
