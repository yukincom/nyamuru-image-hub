import { useRef, useState } from 'preact/hooks';
import type { BackgroundStage } from '../types';

interface Props {stageId?:string|null;stages:BackgroundStage[];disabled?:boolean;seriesShared?:boolean;onSelect:(id:string)=>void;onImport:(file:File)=>Promise<void>}
export default function BackgroundModelPicker({stageId,stages,disabled=false,seriesShared=false,onSelect,onImport}:Props){
  const input=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const selected=stages.find(stage=>stage.id===stageId);
  async function read(file?:File){
    if(!file)return;setBusy(true);setError('');
    try{await onImport(file);}catch(error){setError(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);if(input.current)input.current.value='';}
  }
  return <div class="background-model-picker">
    <label>この背景の3Dモデル<select aria-label="背景の3Dモデル" value={stageId??''} disabled={busy||disabled} onChange={event=>{setError('');onSelect(event.currentTarget.value);}}>
      <option value="">未登録</option>{stages.map(stage=><option key={stage.id} value={stage.id}>{stage.name}</option>)}
    </select></label>
    <button type="button" class="secondary-button" disabled={busy||disabled} onClick={()=>input.current?.click()}>{busy?'読み込み中…':selected?'3Dモデルを差し替え':'3Dモデルを登録'}</button>
    <input hidden ref={input} type="file" accept=".glb,.fbx" aria-label="背景に登録する3Dモデル" onChange={event=>void read(event.currentTarget.files?.[0])}/>
    <small>GLB／FBXの原本を管理領域へコピーして紐づけます。元ファイルが別の場所にあっても、移動・取り外し後も利用できます。</small>
    {seriesShared&&<small>「舞台設定を保存」すると、同じシリーズの別エピソードでもこの管理コピーを再利用できます。</small>}
    {selected&&<span class="background-model-file">{selected.name} · {selected.byteLength<1024*1024?`${Math.max(1,Math.round(selected.byteLength/1024))} KB`:`${(selected.byteLength/1024/1024).toLocaleString('ja-JP',{maximumFractionDigits:1})} MB`}</span>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
