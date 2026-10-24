import {parseVoicePrediction,resolveVoiceCommand,type VoiceCommand,type VoicePrediction} from './voiceCommands.ts';
import type {AgentPreferences} from './agentPreferences.ts';
import type {AgentMessage} from './agentSession.ts';
import type {AgentEditorSnapshot} from './agentTools.ts';
import {imageConnectionSummary} from './modelConnections.ts';
import {qwenConversationIntent} from './qwenGeneration.ts';

export interface AgentToolCall {id:string;type:'function';function:{name:string;arguments:string}}
export type AgentWireMessage={role:'user'|'assistant';content:string|null;tool_calls?:AgentToolCall[]}|{role:'tool';tool_call_id:string;content:string};
export interface AgentReply {message:{role:'assistant';content:string|null;tool_calls?:AgentToolCall[]};model:string}
export interface AgentRequest {profile:Pick<AgentPreferences,'name'|'tone'>;messages:AgentWireMessage[];context:object;allow_edits:boolean}
interface Options {
  text:string;history:AgentMessage[];profile:AgentPreferences;
  revision:()=>string;isCurrent:()=>boolean;snapshot:()=>AgentEditorSnapshot;
  classify:(body:{text:string})=>Promise<unknown>;apply:(command:VoiceCommand)=>Promise<string>|string;
  edit:(value:unknown)=>Promise<AgentEditorSnapshot>|AgentEditorSnapshot;
  reply:(request:AgentRequest)=>Promise<AgentReply>;
  services:<T>(task:()=>Promise<T>,isCurrent:()=>boolean)=>Promise<T|undefined>;
  modelConnections?:()=>Promise<object>;
  imageGeneration?:(action:'connect'|'generate')=>Promise<string>;
  onTool?:(name:string,result:object)=>void;
}
const errorText=(error:unknown)=>error instanceof Error?error.message:'応答を取得できませんでした';
const flush=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

/** Existing deterministic commands remain the fast path; all other requests can use native tools. */
export async function runAgentConversation(o:Options):Promise<{text:string;model:string;edits:number}>{
  let expected=o.revision(),prediction:VoicePrediction|undefined,classificationError:string|undefined;
  const guard=()=>{if(!o.isCurrent())throw Error('会話を終了しました');if(o.revision()!==expected)throw Error('待機中に原稿や選択が変わったため、操作を中止しました');};
  try{prediction=parseVoicePrediction(await o.classify({text:o.text}),o.text);}
  catch(error){classificationError=errorText(error);}
  guard();
  const resolution=prediction?resolveVoiceCommand(prediction):undefined;
  if(resolution?.localOnly&&!resolution.command)return {text:resolution.message,model:prediction!.model,edits:0};
  let operation:{executed:boolean;message:string}|undefined,edits=0,editAttempted=false,lastEditError:string|null=null,repeatedError=0;
  let connectionError:string|null=null,connectionFailures=0,connectionMessage:string|null=null;
  if(resolution?.command){
    try{operation={executed:true,message:await o.apply(resolution.command)};}
    catch(error){operation={executed:false,message:errorText(error)};}
    await flush();expected=o.revision();
    // These handlers already return the actual result, including cancellation or failure.
    if(['open_bubble_materials','save','page','generate_selected'].includes(resolution.command.op))return {text:operation.message,model:prediction!.model,edits:0};
  }
  guard();
  const allowEdits=!resolution?.command;
  const messages:AgentWireMessage[]=o.history.slice(-23).map(m=>({...m}));
  // Start on a user boundary when pruning a previous turn; keep the current utterance byte-exact.
  while(messages.length&&messages[0].role!=='user')messages.shift();
  if(messages.at(-1)?.role!=='user'||messages.at(-1)?.content!==o.text)messages.push({role:'user',content:o.text});
  const currentUtterance=messages.at(-1);
  const context={editor:o.snapshot(),classification:prediction?{label:prediction.label,confidence:prediction.confidence}:null,
    classification_error:classificationError??null,operation:operation??null};
  try{
    const result=await o.services(async()=>{
      for(let round=0;round<8;round++){
        guard();
        while(messages.length>48&&messages[0]!==currentUtterance){
          messages.shift();while(messages.length&&messages[0].role!=='user')messages.shift();
        }
        const reply=await o.reply({profile:{name:o.profile.name,tone:o.profile.tone},messages,context,allow_edits:allowEdits});
        guard();
        const response=reply.message,calls=response.tool_calls??[];
        if(calls.length>4)throw Error('一度に指定された編集ツールが多すぎます');
        if(calls.length>1&&calls.some(call=>call.function.name==='image_generation'))throw Error('画像生成の接続・実行は、ほかの操作と分けて一つずつ指定してください');
        if(!calls.length){
          if(!response.content?.trim())throw Error('LLMから返答がありませんでした');
          const text=operation?operation.message:lastEditError?(edits?`変更を${edits}回適用しました。次の変更は適用できませんでした：${lastEditError}`:`未変更：${lastEditError}`)
            :connectionError?`${edits?`変更を${edits}回適用しました。`:''}接続確認に失敗しました：${connectionError}`
            :connectionMessage??(editAttempted&&!edits?'指定された状態と同じため、変更はありません。':response.content);
          return {text,model:reply.model,edits};
        }
        messages.push(response);
        const tooManyEdits=calls.filter(c=>c.function.name==='editor_bubble_edit').length>1;
        for(const call of calls){
          guard();
          let result:object;
          try{
            const args=JSON.parse(call.function.arguments);
            if(call.function.name==='editor_inspect'){
              if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)throw Error('editor_inspectに引数は不要です');
              result={ok:true,...o.snapshot()};
            }else if(call.function.name==='model_connections'){
              if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)throw Error('model_connectionsに引数は不要です');
              if(!o.modelConnections)throw Error('モデルの接続確認を利用できません');
              const status=await o.modelConnections();
              result={ok:true,...status};connectionMessage=imageConnectionSummary(status);
              connectionError=null;connectionFailures=0;
            }else if(call.function.name==='image_generation'){
              if(!allowEdits||calls.length!==1||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==1||!['connect','generate'].includes(args.action))throw Error('画像生成は接続または実行を一つずつ指定してください');
              if(!o.imageGeneration)throw Error('画像生成の接続を利用できません');
              if(args.action==='generate'&&qwenConversationIntent(o.text)!=='generate')throw Error('生成対象を選び「生成して」と送ってください');
              // Return the intent, release the conversation LLM lease, then run the existing executor.
              return {text:'',model:reply.model,edits,imageAction:args.action as 'connect'|'generate'};
            }else if(call.function.name==='editor_bubble_edit'){
              editAttempted=true;
              if(!allowEdits)throw Error('この入力の操作は処理済みです。重ねて編集しません');
              if(tooManyEdits)throw Error('一度に一つの編集だけを指定してください');
              const before=o.snapshot().revision,after=await o.edit(args),changed=after.revision!==before;
              if(changed)edits++;lastEditError=null;repeatedError=0;expected=o.revision();
              await flush();
              result={ok:true,changed,after};
            }else throw Error('この編集ツールは使えません');
          }catch(error){
            const message=errorText(error);result={ok:false,error:message};
            if(call.function.name==='model_connections'){connectionFailures=message===connectionError?connectionFailures+1:1;connectionError=message;}
            else {repeatedError=message===lastEditError?repeatedError+1:1;lastEditError=message;if(call.function.name==='editor_bubble_edit')editAttempted=true;}
          }
          guard();
          o.onTool?.(call.function.name,result);
          if(repeatedError>=3)throw Error(`同じ指定エラーが続いたため停止しました：${lastEditError}`);
          if(connectionFailures>=3)throw Error(`接続確認の同じエラーが続いたため停止しました：${connectionError}`);
          messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
        }
      }
      throw Error(lastEditError?`編集を適用できませんでした：${lastEditError}`:'編集の確認回数が上限に達しました');
    },o.isCurrent);
    if(!result)throw Error('会話を終了しました');
    if(result.imageAction){
      guard();
      return {text:await o.imageGeneration!(result.imageAction),model:result.model,edits};
    }
    return result;
  }catch(error){
    const evidence=operation?.executed?operation.message:edits?`フキダシの変更を${edits}回適用しました。`:operation?.message;
    throw Error([evidence,errorText(error)].filter(Boolean).join('\n'));
  }
}
