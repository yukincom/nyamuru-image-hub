import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type {QwenGenerationConversation,QwenReferenceRole} from '../lib/qwenGeneration';
import { ArrowUp, Clock, Mic, Square } from 'lucide-preact';
import { createEditorDictation } from '../lib/editorVoice';
import { connectAgentImageGeneration, getAgentConnection, getImageGenerationConnections, requestVoiceCommand,requestAgentReply,withAgentServices } from '../lib/localBridge';
import { runVoiceCommand, type VoiceCommand } from '../lib/voiceCommands';
import { createAgentSession, type AgentMessage } from '../lib/agentSession';
import { normalizeVoiceSilenceMs, type AgentPreferences, type VoiceInputMode } from '../lib/agentPreferences';
import {runAgentConversation} from '../lib/agentChat';
import type {AgentEditorSnapshot} from '../lib/agentTools';
import AgentAvatar from './AgentAvatar';

interface Props {
  profile:AgentPreferences; onChangeProfile:(profile:AgentPreferences)=>void; open:boolean; onToggle:()=>void;
  revision:()=>string; apply:(command:VoiceCommand,isCurrent?:()=>boolean)=>Promise<string>|string;
  request?:typeof requestVoiceCommand; connection?:typeof getAgentConnection;
  generation?:QwenGenerationConversation|null; portalTarget?:HTMLElement|null;
  inspect?:()=>AgentEditorSnapshot;edit?:(value:unknown)=>AgentEditorSnapshot;
}

function VoiceInputIcon({mode}:{mode:VoiceInputMode}){
  return <span class="agent-voice-icon" aria-hidden="true"><Mic size={16}/>{mode==='quick'&&<Clock class="agent-voice-clock" size={9}/>}</span>;
}

export default function VoiceCommands(props:Props){
  // Keep one portal and one conversation instance when the modal opens or closes.
  const [container]=useState(()=>typeof window==='undefined'?null:document.createElement('div'));
  useEffect(()=>{if(container)(props.portalTarget??document.body).appendChild(container);},[container,props.portalTarget]);
  useEffect(()=>()=>container?.remove(),[container]);
  const view=<aside class={`agent-popup ${props.open?'is-open':'is-collapsed'} ${props.portalTarget?'is-generation':''}`}  aria-label={props.profile.name} data-voice-command>
    <button type="button" class="agent-popup-heading" aria-expanded={props.open} aria-controls="agent-popup-body" title={props.open?'折りたたんで履歴を消去':'開く'} onClick={props.onToggle}>
      {!props.open&&<AgentAvatar profile={props.profile}/>}<strong>{props.profile.name}</strong><span class="agent-fold" aria-hidden="true">{props.open?'△':'▽'}</span>
    </button>
    {props.open&&<AgentConversation {...props}/>}
  </aside>;
  return container?createPortal(view,container):view;
}

function AgentConversation(props:Props){
  const latest=useRef(props);latest.current=props;
  const session=useRef(createAgentSession());
  const [messages,setMessages]=useState<AgentMessage[]>([]);
  const [text,setText]=useState(''),[status,setStatus]=useState('');
  const [referenceRole,setReferenceRole]=useState<QwenReferenceRole>('character');
  const [recording,setRecording]=useState(false),[processing,setProcessing]=useState(false),[busy,setBusy]=useState(false);
  const [model,setModel]=useState('接続を確認中…');
  const recordingMode=useRef<VoiceInputMode>('manual');
  const pending=useRef(false),dictation=useRef<ReturnType<typeof createEditorDictation>|null>(null),log=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    let active=true;
    void (latest.current.connection??getAgentConnection)().then(value=>{if(active)setModel(value.connected?value.model:'LLM未接続');}).catch(()=>{if(active)setModel('接続を確認できません');});
    dictation.current=createEditorDictation({
      text:async(value,context)=>{
        if(!active||!context.isCurrent())return;
        if(context.mode==='quick')await send(value,context.isCurrent);
        else setText(previous=>previous?`${previous}\n${value}`:value);
      },
      status:value=>{if(active)setStatus(value);},active:value=>{if(active)setRecording(value);},processing:value=>{if(active)setProcessing(value);},
      settings:()=>({mode:recordingMode.current,silenceMs:latest.current.profile.voiceSilenceMs}),
      request:(action,body)=>(latest.current.request??requestVoiceCommand)(action,body),
    });
    return ()=>{active=false;session.current.reset();dictation.current?.dispose();dictation.current=null;};
  },[]);
  useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight});},[messages,busy]);
  const silenceMs=normalizeVoiceSilenceMs(props.profile.voiceSilenceMs);
  const quickActive=recording&&recordingMode.current==='quick',manualActive=recording&&recordingMode.current==='manual';
  function toggleVoice(mode:VoiceInputMode){
    const recorder=dictation.current;if(!recorder)return;
    if(recorder.active){
      if(recordingMode.current===mode){recorder.stop(mode==='quick');if(mode==='quick')setStatus('軽量対話をオフにしました');}
      return;
    }
    if(pending.current||processing||latest.current.generation?.busy)return;
    try{
      latest.current.onChangeProfile({...latest.current.profile,voiceInputMode:mode});
      recordingMode.current=mode;void recorder.start();
    }catch(error){setStatus(error instanceof Error?error.message:'音声入力を開始できませんでした');}
  }
  async function submit(event:Event){
    event.preventDefault();if(pending.current||recording||processing||latest.current.generation?.busy||!text.trim())return;
    const original=text;setText('');await send(original);
  }
  async function send(original:string,inputIsCurrent:()=>boolean=()=>true){
    if(pending.current||!original.trim()||!inputIsCurrent())return;
    const ticket=session.current.ticket(),conversationIsCurrent=()=>session.current.isCurrent(ticket);
    const isCurrent=()=>conversationIsCurrent()&&inputIsCurrent();
    pending.current=true;setBusy(true);setStatus('');
    setMessages(session.current.append({role:'user',content:original}));
    let operation:Awaited<ReturnType<typeof runVoiceCommand>>|undefined;
    try{
      const generation=latest.current.generation;
      if(generation){
        const result=await generation.send(original,isCurrent);
        if(isCurrent())setMessages(session.current.append({role:'assistant',content:result}));
        return;
      }
      if(latest.current.inspect&&latest.current.edit){
        const result=await runAgentConversation({text:original,history:session.current.snapshot(),profile:latest.current.profile,
          revision:()=>latest.current.inspect!().revision,isCurrent,snapshot:()=>latest.current.inspect!(),
          classify:body=>(latest.current.request??requestVoiceCommand)('voice/classify',body),apply:command=>latest.current.apply(command,isCurrent),
          edit:value=>latest.current.edit!(value),reply:requestAgentReply,services:withAgentServices,
          modelConnections:()=>getImageGenerationConnections(undefined,true),
          imageGeneration:async action=>{
            if(action==='generate')return latest.current.apply({op:'generate_selected',kind:'selected'},isCurrent);
            await connectAgentImageGeneration(isCurrent);
            return 'Qwen Turboをエージェントの画像生成先に接続しました。生成する人物や吹き出しを選び「生成して」と送ってください。';
          }});
        if(!isCurrent())return;
        setMessages(session.current.append({role:'assistant',content:result.text}));
        void (latest.current.connection??getAgentConnection)().then(value=>{if(isCurrent())setModel(value.connected?value.model:'LLM未接続');}).catch(()=>{});
        return;
      }
      operation=await runVoiceCommand({text:original,revision:()=>latest.current.revision(),cancelled:()=>!isCurrent(),
        classify:body=>(latest.current.request??requestVoiceCommand)('voice/classify',body),apply:command=>latest.current.apply(command)});
      if(!isCurrent())return;
      setMessages(session.current.append({role:'assistant',content:operation.message}));
    }catch(error){
      if(isCurrent())setMessages(session.current.append({role:'assistant',content:[operation?.message,error instanceof Error?error.message:'応答できませんでした'].filter(Boolean).join('\n')}));
    }finally{pending.current=false;if(conversationIsCurrent())setBusy(false);}
  }
  async function attach(files:File[]){
    const generation=latest.current.generation;if(!generation||pending.current||!files.length)return;
    const ticket=session.current.ticket();pending.current=true;setBusy(true);setStatus('参照画像を準備中…');
    try{
      await generation.addFiles(files,generation.character?referenceRole:'drawing');
      if(session.current.isCurrent(ticket)){setStatus('');setMessages(session.current.append({role:'user',content:`参照画像を追加：${files.map(file=>file.name).join('、')}`}));}
    }catch(error){if(session.current.isCurrent(ticket))setStatus(error instanceof Error?error.message:'参照画像を追加できませんでした');}
    finally{pending.current=false;if(session.current.isCurrent(ticket)){setBusy(false);}}
  }
  const generationBusy=busy||Boolean(props.generation?.busy);
  return <div id="agent-popup-body" class="agent-popup-body">
    {props.generation&&<section class="agent-generation-context" aria-label="生成対象">
      <strong>{props.generation.label}</strong><p>画像を追加して「生成して」と送ると、このあたりへ差し込みます。</p>
      <fieldset disabled={generationBusy||props.generation.locked}>
        {props.generation.character&&props.generation.loadRegistered&&<button type="button" onClick={()=>{
          if(pending.current)return;pending.current=true;setBusy(true);
          void props.generation!.loadRegistered!().catch(error=>setStatus(error instanceof Error?error.message:'資料を読み込めません')).finally(()=>{pending.current=false;setBusy(false);});
        }}>登録資料を使う</button>}
        {props.generation.character&&<select aria-label="添付画像の用途" value={referenceRole} onChange={e=>setReferenceRole(e.currentTarget.value as QwenReferenceRole)}><option value="character">人物の設定画</option><option value="drawing">描画の参考</option></select>}
        <label class="qwen-file-label">参照画像を添付<input aria-label="会話に参照画像を添付" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={e=>{const files=Array.from(e.currentTarget.files??[]);e.currentTarget.value='';void attach(files);}}/></label>
      </fieldset>
      <div class="agent-reference-thumbnails">{props.generation.references.map(reference=><img src={reference.image} alt={`${reference.label}（${reference.characterKeys.length?'人物設定画':'描画参考'}）`}/>)}</div>
    </section>}
    {messages.length>0&&<div ref={log} class="agent-history" role="log" aria-label="会話履歴" aria-live="polite">
      {messages.map((message,index)=><p key={index} class={`agent-message is-${message.role}`}>{message.content}</p>)}
    </div>}
    <p class={`agent-voice-hint ${quickActive?'is-handsfree':''}`}>{quickActive?`軽量対話オン · 無音${silenceMs/1000}秒で自動送信`:manualActive?'手動入力 · 停止してから確認・送信':'軽量対話は自動送信 · 手動入力は確認して送信'}</p>
    <div class="agent-composer-row"><AgentAvatar profile={props.profile}/><form class="agent-composer" onSubmit={submit}>
      <textarea aria-label="メッセージ" rows={2} maxLength={4000} value={text} disabled={generationBusy} placeholder={props.generation?'追加の指示、または「生成して」':'話しかける…'} onInput={e=>setText(e.currentTarget.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void submit(e);}}}/>
      <div class="agent-composer-footer"><small class="agent-model" title={model}>{model}</small>
        <button type="button" class={`agent-mic agent-handsfree ${quickActive?'is-active':''}`} disabled={!quickActive&&(generationBusy||recording||processing)} aria-label={quickActive?'軽量対話をオフ':'軽量対話をオン（自動送信）'} title={quickActive?'軽量対話をオフ':'軽量対話をオン（自動送信）'} aria-pressed={quickActive} onClick={()=>toggleVoice('quick')}><VoiceInputIcon mode="quick"/></button>
        <button type="button" class={`agent-mic ${manualActive?'is-active':''}`} disabled={quickActive||generationBusy||(!manualActive&&processing)} aria-label={manualActive?'手動入力を停止して文字起こし':'手動入力を開始'} title={manualActive?'手動入力を停止して文字起こし':'手動入力を開始'} aria-pressed={manualActive} onClick={()=>toggleVoice('manual')}>{manualActive?<Square size={14}/>:<VoiceInputIcon mode="manual"/>}</button>
        <button type="submit" class="agent-send" aria-label="送信" title="送信" disabled={generationBusy||recording||processing||!text.trim()}><ArrowUp size={18}/></button>
      </div>
    </form></div>
    {(generationBusy||processing||recording||status)&&<p class="agent-status" role="status">{props.generation?.busy?(props.generation.phase||'生成を準備中…'):busy?'考え中…':recording&&recordingMode.current==='manual'&&status!=='マイクの使用を確認しています…'
      ?<>じっくり入力中<span class="agent-listening-dots" aria-hidden="true">{Array.from({length:9},(_,index)=><span key={index} style={{animationDelay:`${index*.13}s`}}>.</span>)}</span></>
      :processing?'文字起こし中…':recording?(status||'録音中…'):status}</p>}
  </div>;
}
