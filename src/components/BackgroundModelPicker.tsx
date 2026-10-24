import { useRef, useState } from 'preact/hooks';
import type { BackgroundStage } from '../types';

interface Props {stageId?:string|null;stages:BackgroundStage[];disabled?:boolean;onSelect:(id:string)=>void;onImport:(file:File)=>Promise<void>}
export default function BackgroundModelPicker({stageId,stages,disabled=false,onSelect,onImport}:Props){
  const input=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const selected=stages.find(stage=>stage.id===stageId);
  async function read(file?:File){
    if(!file)return;setBusy(true);setError('');
    try{await onImport(file);}catch(error){setError(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);if(input.current)input.current.value='';}
  }
  return <div class="background-model-picker">
    <label>3Dモデル<select aria-label="背景の3Dモデル" value={stageId??''} disabled={busy||disabled} onChange={event=>{setError('');onSelect(event.currentTarget.value);}}>
      <option value="">未登録</option>{stages.map(stage=><option key={stage.id} value={stage.id}>{stage.name}</option>)}
    </select></label>
    <button type="button" class="secondary-button" disabled={busy||disabled} onClick={()=>input.current?.click()}>{busy?'読み込み中…':selected?'3Dモデルを差し替え':'3Dモデルを登録'}</button>
    <input hidden ref={input} type="file" accept=".glb,.fbx" aria-label="背景に登録する3Dモデル" onChange={event=>void read(event.currentTarget.files?.[0])}/>
    <small>Blenderから書き出したGLB／FBXを登録できます。</small>
    {selected&&<span class="background-model-file">{selected.name} · {selected.byteLength<1024*1024?`${Math.max(1,Math.round(selected.byteLength/1024))} KB`:`${(selected.byteLength/1024/1024).toLocaleString('ja-JP',{maximumFractionDigits:1})} MB`}</span>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
