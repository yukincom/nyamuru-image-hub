/** 見込み: 未準備の依頼には理由を案内し、明示再送だけ生成する。生成後の相談・英訳も維持。
 * 合格: 読込前/起動中の追加生成0件、古いsenderも最新状態を使用、5候補保持→英訳→再生成→編集会話。
 * 範囲: 実UI/bridge/lifecycle、HTTP/PNG/LLMは模擬。実モデルの案内品質・起動は対象外。 */
import {render} from 'preact';
import {useCallback,useState} from 'preact/hooks';
import ImageGenerationDialog from '../src/components/ImageGenerationDialog';
import VoiceCommands from '../src/components/VoiceCommands';
import {DEFAULT_AGENT_PREFERENCES} from '../src/lib/agentPreferences';
import {DEFAULT_GENERATION_PREFERENCES,saveGenerationPreferences} from '../src/lib/generationPreferences';
import {QWEN_GENERATION_PROFILE,type QwenGenerationConversation} from '../src/lib/qwenGeneration';
import {agentEditorSnapshot} from '../src/lib/agentTools';
import '../src/styles/global.css';
const data=new Map<string,string>();
const storage:Storage={get length(){return data.size;},getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);},removeItem:k=>{data.delete(k);},clear:()=>data.clear(),key:i=>[...data.keys()][i]??null};
Object.defineProperty(window,'localStorage',{value:storage,configurable:true});
const workflow={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'会話検証',version:1,graph:{text:{class_type:'Text',inputs:{text:'fixture'}},sampler:{class_type:'Sampler',inputs:{seed:1}},output:{class_type:'SaveImage',inputs:{images:['sampler',0]}}},binding:{prompt:[{node:'text',input:'text'}],seed:[{node:'sampler',input:'seed'}],width:[],height:[],images:[],output:{node:'output',index:0},prompt_mode:'qwen',fixed_size:[160,224]}};
saveGenerationPreferences(storage,{...DEFAULT_GENERATION_PREFERENCES,local:{...DEFAULT_GENERATION_PREFERENCES.local,workflowId:workflow.id}});
const canvas=document.createElement('canvas');canvas.width=160;canvas.height=224;canvas.getContext('2d')!.fillRect(0,0,160,224);const image=canvas.toDataURL();
const bridge={service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3},supervisor={service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1};
let job:any,submits=0,editorChats=0,chatCount=0,noticeChats=0,runtimeStarts=0,prepares=0;
let releaseWorkflow!:()=>void,releaseComfy!:()=>void;
const workflowGate=new Promise<void>(resolve=>{releaseWorkflow=resolve;});
const comfyGate=new Promise<void>(resolve=>{releaseComfy=resolve;});
const translated='A person with a gentle expression against a green background.';
window.fetch=async(input,options)=>{
  const path=new URL(String(input),location.href).pathname.replace(/^\/__nyamuru\/(?:bridge|supervisor)/,'');
  const body=options?.body?JSON.parse(String(options.body)):{};
  if(path==='/api/health')return Response.json(bridge);
  if(path==='/api/new-creation/start')return Response.json({...supervisor,lease_token:'conversation-fixture'});
  if(path==='/api/new-creation/stop')return Response.json({...supervisor,released:true,llm_released:true});
  if(path==='/api/panel-actions/prepare')return Response.json({...supervisor,ready:true});
  if(path==='/api/image-generation/start'){
    runtimeStarts++;await comfyGate;
    return Response.json({...supervisor,session_token:body.session_token,comfy_ready:true,comfy_started:true,comfy_managed:true});
  }
  if(path==='/api/image-generation/stop')return Response.json({...supervisor,comfy_released:true,comfy_stopped:true});
  if(path==='/api/image-generation/prepare')return Response.json({...supervisor,llm_stopped:true});
  if(path==='/api/comfy-workflows/list'){
    await workflowGate;return Response.json({...bridge,workflows:[workflow]});
  }
  if(path==='/api/agent/status')return Response.json({...bridge,connected:true,model:'模擬LLM'});
  if(path==='/api/voice/classify')return Response.json({...bridge,text:body.text,label:'other_request',confidence:1,model:'fixture',elapsed_ms:0});
  if(path==='/api/qwen-generation/prepare'){
    prepares++;
    if(submits===1&&!body.prompt.includes(translated))throw Error('英訳が次の生成へ渡っていない');
    job={...body,request_sha256:'a'.repeat(64),status:'prepared',created_at:1,workflow_name:workflow.name};return Response.json({...bridge,...job});
  }
  if(path==='/api/image-generation/submit'){
    submits++;job={...job,status:'succeeded',candidates:Array.from({length:5},(_,i)=>({image,index:i+1,seed:i+1}))};return Response.json({...supervisor,...job});
  }
  if(path==='/api/agent/chat'){
    if(body.context.generation?.requestAccepted===false){
      noticeChats++;
      check(body.allow_edits===false&&body.context.generation.editable===false,'未準備案内は編集権限なし');
      check(body.context.generation.mode==='pending','ワークフロー読込中をクラウドと誤認しない');
      check(body.context.generation.readiness.ready===false&&body.context.generation.readiness.message==='準備が整っていません', 'コードの未準備判定をLLMへ渡す');
      check(body.context.generation.readiness.blockers.some((item:any)=>item.code==='workflow'&&item.state==='waiting'&&item.detail.includes('読み込んでいます')),'ワークフロー読込待ちの理由を渡す');
      return Response.json({...bridge,message:{role:'assistant',content:'準備が整っていません。ワークフローを読み込んでいます。準備後に改めて「生成して」と送ってください。'},model:'fixture'});
    }
    chatCount++;
    if(!body.context.generation){editorChats++;return Response.json({...bridge,message:{role:'assistant',content:'編集画面で相談できます。'},model:'fixture'});}
    const user=body.messages.filter((m:any)=>m.role==='user').at(-1).content;
    if(user.includes('英訳')&&body.messages.at(-1).role!=='tool')return Response.json({...bridge,message:{role:'assistant',content:null,tool_calls:[{id:'edit',type:'function',function:{name:'generation_prompt_edit',arguments:JSON.stringify({prompt:translated})}}]},model:'fixture'});
    return Response.json({...bridge,message:{role:'assistant',content:user.includes('英訳')?'英訳しました。':'表情を弱める案があります。'},model:'fixture'});
  }
  throw Error(`unexpected request: ${path}`);
};
Object.defineProperty(navigator,'sendBeacon',{configurable:true,value:()=>true});
let conversation:QwenGenerationConversation|null=null;
const plan={profile:QWEN_GENERATION_PROFILE,documentKey:'conversation-fixture',pageNumber:1,panelId:1,overlay:false,ownerKey:'figure-0',label:'検証人物',width:160,height:224,prompt:'人物を描く',characterKeys:[],candidates:[]};
function Room(){
  const [show,setShow]=useState(true),[view,setView]=useState<QwenGenerationConversation|null>(null),[host,setHost]=useState<HTMLElement|null>(null);
  const update=useCallback((value:QwenGenerationConversation|null)=>{conversation=value;setView(value);},[]);
  return <>{show&&<ImageGenerationDialog plan={plan} onClose={()=>setShow(false)} onInsert={async()=>{throw Error('採用は未依頼');}} onConversation={update} onConversationHost={setHost}/>}
    <VoiceCommands profile={DEFAULT_AGENT_PREFERENCES} onChangeProfile={()=>{}} open onToggle={()=>{}} revision={()=>'r1'} apply={()=>''} inspect={()=>agentEditorSnapshot(null,'r1',0,null)} edit={()=>{throw Error('編集は未依頼');}} generation={view} portalTarget={host}/></>;
}
const report=document.createElement('output');report.setAttribute('aria-label','検証結果');report.style.cssText='position:fixed;top:0;left:0;z-index:999999;background:white;color:black';document.body.append(report);
const tick=()=>new Promise(r=>setTimeout(r,40));
async function wait(check:()=>boolean){for(let i=0;i<150;i++){if(check())return;await tick();}throw Error('待機失敗');}
function check(value:unknown,label:string){if(!value)throw Error(label);}
async function send(text:string){
  await wait(()=>!document.querySelector<HTMLTextAreaElement>('[aria-label="メッセージ"]')?.disabled);
  const input=document.querySelector<HTMLTextAreaElement>('[aria-label="メッセージ"]')!;input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));await tick();
  document.querySelector<HTMLFormElement>('.agent-composer')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();
  await wait(()=>!document.querySelector<HTMLTextAreaElement>('[aria-label="メッセージ"]')?.disabled);
}
async function run(){
  render(<Room/>,document.getElementById('test-root')!);await wait(()=>Boolean(conversation)&&!conversation!.busy);
  // 見込み/合格: 一覧応答を止めた未準備状態ではLLMへ理由だけ渡し、生成起動/準備/送信は0回。実HTTPは模擬。
  const earlySend=conversation!.send;
  await send('生成して');
  check(noticeChats===1&&submits===0&&runtimeStarts===0&&prepares===0,'未準備案内だけで画像処理を開始しない');
  check(document.querySelector('[aria-label="会話履歴"]')?.textContent?.includes('準備が整っていません。ワークフロー'),'案内を既存のassistant履歴へ表示');
  releaseWorkflow();await wait(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.qwen-generation-dialog button')).some(button=>button.textContent==='生成'&&!button.disabled));
  check(submits===0&&runtimeStarts===0&&prepares===0,'準備完了だけでは再実行しない');
  // 見込み/合格: 会話UIから明示再送でき、古いsenderも最新工程を読む。Comfy起動中の別依頼はLLMも追加生成も0回。
  await send('生成して');
  await wait(()=>runtimeStarts===1&&conversation?.phase==='ComfyUIを起動中');
  check((await earlySend('いまどうなっている？',()=>true)).includes('ComfyUIを起動中'),'古いsenderも最新工程を参照');
  await send('いまどうなっている？');
  await send('生成して');
  check(noticeChats===1&&chatCount===0&&runtimeStarts===1&&prepares===0&&submits===0,'Comfy起動中の依頼はLLM/追加生成を呼ばない');
  check(document.querySelector('[aria-label="会話履歴"]')?.textContent?.includes('ComfyUI：ComfyUIを起動中'),'起動中の箇所をassistant履歴へ表示');
  releaseComfy();
  await wait(()=>!conversation?.busy&&document.querySelectorAll('.qwen-candidate').length===5);
  await wait(()=>document.querySelector('[aria-label="会話履歴"]')?.textContent?.includes('画像を生成しました')??false);
  check(submits===1&&prepares===1,'起動完了後も未準備時の依頼を再送しない');
  await send('表情が強すぎるのですが、どう直す？');check(chatCount===1&&document.querySelectorAll('.qwen-candidate').length===5,'相談は候補を保持');
  await send('表情を柔らかくして英訳して');check(chatCount===3&&document.querySelectorAll('.qwen-candidate').length===0,'英訳で次の生成を準備');
  check(Array.from(document.querySelectorAll('textarea')).some(el=>el.value===translated),'指示欄へ英訳反映');
  await send('生成して');check(submits===2&&document.querySelectorAll('.qwen-candidate').length===5,'英訳後の再生成');
  Array.from(document.querySelectorAll<HTMLButtonElement>('.qwen-generation-dialog button')).find(b=>b.textContent?.trim()==='閉じる')!.click();await wait(()=>!conversation);
  check(await earlySend('生成して',()=>true)==='生成の会話を終了しました'&&submits===2,'閉じたあとの古いsenderから生成しない');
  await send('編集画面で相談したい');check(editorChats===1,'閉じた後は編集会話');
  report.textContent='PASS: 未準備理由の案内・ComfyUI起動中の追加依頼・明示再送・古いsender・生成後相談・候補保持・英訳反映・再生成・編集画面への復帰（HTTP/LLM模擬）';
}
void run().catch(error=>{report.textContent=`FAIL: ${error}`;});
