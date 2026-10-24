import { useEffect, useRef, useState } from 'preact/hooks';
import { readAgentAvatar, type AgentPreferences } from '../lib/agentPreferences';
import { Field, SectionTitle } from './Fields';
import AgentAvatar from './AgentAvatar';

export default function AgentSettings({profile,onChange}:{profile:AgentPreferences;onChange:(profile:AgentPreferences)=>void}) {
  const [draft,setDraft]=useState(profile),[error,setError]=useState('');
  const upload=useRef(0),latest=useRef(draft),committed=useRef(JSON.stringify(profile));latest.current=draft;
  useEffect(()=>{const value=JSON.stringify(profile);if(value!==committed.current){committed.current=value;latest.current=profile;setDraft(profile);}},[profile]);
  useEffect(()=>()=>{upload.current++;},[]);
  function commit(next:AgentPreferences){try{const normalized={...next,name:next.name.trim()};onChange(normalized);committed.current=JSON.stringify(normalized);latest.current=normalized;setDraft(normalized);setError('');}catch(e){setError(e instanceof Error?e.message:'保存できませんでした');}}
  async function selectAvatar(file?:File){
    const ticket=++upload.current;if(!file)return;
    try{
      const avatar=await readAgentAvatar(file),image=new Image();image.src=avatar;
      await image.decode();
      if(ticket===upload.current)commit({...latest.current,avatar});
    }
    catch(e){if(ticket===upload.current)setError(e instanceof Error?e.message:'画像を読み込めませんでした');}
  }
  return <section class="agent-settings" aria-label="エージェント設定">
    <SectionTitle title="エージェント"/>
    <div class="agent-settings-avatar"><AgentAvatar profile={draft}/><div>
      <label class="secondary-button agent-avatar-upload">顔画像を選ぶ<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="エージェントの顔画像" onChange={e=>{void selectAvatar(e.currentTarget.files?.[0]);e.currentTarget.value='';}}/></label>
      {draft.avatar&&<button type="button" class="text-button" onClick={()=>{upload.current++;commit({...draft,avatar:''});}}>🐱に戻す</button>}
      <small>GIF・WebP・APNGのアニメーション対応 · 2 MBまで</small>
    </div></div>
    <div class="field-grid">
      <Field label="名前" wide><input aria-label="エージェントの名前" value={draft.name} maxLength={40} onInput={e=>setDraft({...draft,name:e.currentTarget.value})} onBlur={()=>commit(draft)}/></Field>
      <Field label="口調・性格" wide><textarea aria-label="エージェントの口調・性格" rows={3} value={draft.tone} maxLength={2000} placeholder="例：落ち着いた口調で、短く話す" onInput={e=>setDraft({...draft,tone:e.currentTarget.value})} onBlur={()=>commit(draft)}/></Field>
    </div>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
