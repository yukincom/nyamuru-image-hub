export const AGENT_PREFERENCES_KEY = 'nyamuru.agent-preferences.v1';
export const MAX_AGENT_AVATAR_BYTES = 2 * 1024 * 1024;
export type VoiceInputMode = 'quick' | 'manual';
export const VOICE_SILENCE_OPTIONS = [500,1000,1500,2000,3000] as const;
export interface AgentPreferences { name:string; avatar:string; tone:string; voiceInputMode?:VoiceInputMode; voiceSilenceMs?:number }
export const DEFAULT_AGENT_PREFERENCES:Readonly<AgentPreferences> = Object.freeze({name:'エージェント',avatar:'',tone:'',voiceInputMode:'quick',voiceSilenceMs:1000});
export const normalizeVoiceInputMode = (value:unknown):VoiceInputMode => value==='manual'?'manual':'quick';
export const normalizeVoiceSilenceMs = (value:unknown):number => typeof value==='number'&&VOICE_SILENCE_OPTIONS.some(ms=>ms===value)?value:1000;

export function normalizeAgentPreferences(value:unknown):AgentPreferences {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('エージェント設定を読み取れません');
  const v=value as Record<string,unknown>;
  if(typeof v.name!=='string'||!v.name.trim()||v.name.trim().length>40)throw new Error('名前は1〜40文字にしてください');
  if(typeof v.tone!=='string'||v.tone.length>2000)throw new Error('口調・性格は2000文字以内にしてください');
  if(typeof v.avatar!=='string'||v.avatar.length>Math.ceil(MAX_AGENT_AVATAR_BYTES/3)*4+64||
    (v.avatar&&!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(v.avatar)))throw new Error('顔画像は2 MB以内のPNG・JPEG・GIF・WebPにしてください');
  return {name:v.name.trim(),avatar:v.avatar,tone:v.tone,voiceInputMode:normalizeVoiceInputMode(v.voiceInputMode),voiceSilenceMs:normalizeVoiceSilenceMs(v.voiceSilenceMs)};
}
export function loadAgentPreferences(storage?:Pick<Storage,'getItem'>):AgentPreferences {
  try{return normalizeAgentPreferences(JSON.parse(storage?.getItem(AGENT_PREFERENCES_KEY)||'null'));}
  catch{return {...DEFAULT_AGENT_PREFERENCES};}
}
export function saveAgentPreferences(storage:Pick<Storage,'setItem'>,value:AgentPreferences):AgentPreferences {
  const next=normalizeAgentPreferences(value);
  storage.setItem(AGENT_PREFERENCES_KEY,JSON.stringify(next));
  return next;
}

/** Keep the original animation bytes. Rounded cropping belongs to the displayed image. */
export async function readAgentAvatar(file:Blob):Promise<string> {
  if(!file.size||file.size>MAX_AGENT_AVATAR_BYTES)throw new Error('顔画像は2 MB以内にしてください');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const head=String.fromCharCode(...bytes.subarray(0,12));
  const mime=head.startsWith('GIF87a')||head.startsWith('GIF89a')?'image/gif':
    bytes[0]===137&&head.slice(1,4)==='PNG'?'image/png':
    bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':
    head.startsWith('RIFF')&&head.slice(8,12)==='WEBP'?'image/webp':null;
  if(!mime)throw new Error('PNG・JPEG・GIF・WebPを選んでください');
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
