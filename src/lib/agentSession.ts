export interface AgentMessage {role:'user'|'assistant';content:string}

/** A window-local conversation. No browser or project persistence. */
export function createAgentSession(){
  let generation=0;
  let messages:AgentMessage[]=[];
  const snapshot=()=>messages.map(message=>({...message}));
  return {
    ticket:()=>generation,
    isCurrent:(ticket:number)=>ticket===generation,
    snapshot,
    append(message:AgentMessage){messages=[...messages,{...message}].slice(-24);return snapshot();},
    reset(){generation++;messages=[];},
  };
}
