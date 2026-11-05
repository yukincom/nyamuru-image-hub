import type {AgentPreferences} from './agentPreferences.ts';
import type {AgentMessage} from './agentSession.ts';
import type {AgentRequest,AgentReply,AgentWireMessage} from './agentChat.ts';

export interface GenerationConversationContext {
  prompt:string; label:string; mode:string; status:string; editable:boolean;
  generatedPrompt?:string;
}
export interface GenerationConversationInput {
  history:AgentMessage[];
  profile:Pick<AgentPreferences,'name'|'tone'>;
}

/** Consultations share the local agent transport, but can only edit this dialog's draft. */
export async function runGenerationConversation(o:{
  text:string; input:GenerationConversationInput; isCurrent:()=>boolean;
  snapshot:()=>GenerationConversationContext;
  update:(prompt:string,expected:string)=>void;
  reply:(request:AgentRequest)=>Promise<AgentReply>;
  services:<T>(task:()=>Promise<T>,isCurrent:()=>boolean)=>Promise<T|undefined>;
}):Promise<string>{
  const initial=o.snapshot().prompt;
  let expected=initial,changed=false,lastError='';
  const guard=()=>{
    if(!o.isCurrent())throw Error('生成の会話を終了しました');
    if(o.snapshot().prompt!==expected)throw Error('相談中に生成指示が変わったため、操作を中止しました');
  };
  const messages:AgentWireMessage[]=o.input.history.slice(-15).map(m=>({...m}));
  while(messages.length&&messages[0].role!=='user')messages.shift();
  if(messages.at(-1)?.role!=='user'||messages.at(-1)?.content!==o.text)messages.push({role:'user',content:o.text});
  const result=await o.services(async()=>{
    for(let round=0;round<5;round++){
      guard();
      const reply=await o.reply({profile:{name:o.input.profile.name,tone:o.input.profile.tone},messages,context:{generation:o.snapshot()},allow_edits:true});
      guard();
      const response=reply.message,calls=response.tool_calls??[];
      if(!calls.length){
        if(lastError)return `${changed?'生成指示を変更しました。':''}適用できませんでした：${lastError}`;
        if(!response.content?.trim())throw Error('LLMから返答がありませんでした');
        return `${changed?'生成指示に反映しました。\n':''}${response.content}`;
      }
      if(calls.length!==1)throw Error('生成指示の変更は一度に一つずつ指定してください');
      messages.push(response);
      const call=calls[0];let result:object;
      try{
        if(call.function.name!=='generation_prompt_edit')throw Error('生成画面では生成指示の編集だけを利用できます');
        const args=JSON.parse(call.function.arguments);
        if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==1||
          typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>12000)throw Error('promptに1〜12000文字の生成指示全文を指定してください');
        if(!o.snapshot().editable)throw Error('実行中または結果未確定の生成指示は変更できません');
        guard();o.update(args.prompt,expected);expected=args.prompt;
        changed ||= expected!==initial;lastError='';
        result={ok:true,generation:o.snapshot()};
      }catch(error){lastError=error instanceof Error?error.message:String(error);result={ok:false,error:lastError};}
      guard();messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
    }
    throw Error(lastError||'生成指示の確認回数が上限に達しました');
  },o.isCurrent);
  if(!result)throw Error('生成の会話を終了しました');
  return result;
}
