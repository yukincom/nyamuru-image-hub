import { useEffect, useRef, useState } from 'preact/hooks';
import { connectAgentImageGeneration, getImageGenerationConnections } from '../lib/localBridge';
import {connectedImageModel, type ImageGenerationConnections } from '../lib/modelConnections';
import { Field, SectionTitle } from './Fields';

interface Props {
  endpoint: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onOpenAgent?: () => void;
}
const modelRoles = { generation: '画像生成本体（Turbo）', text_encoder: '補助：指示文・参照画像のエンコーダー', vae: '補助：画像へ変換するVAE' };

export default function LocalImageModelSettings({ endpoint, onChange, onCommit, onOpenAgent }: Props) {
  const [connections, setConnections] = useState<ImageGenerationConnections | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const revision = useRef(0);
  const [connected,setConnected]=useState(()=>{try{return Boolean(connectedImageModel(window.localStorage));}catch{return false;}});
  useEffect(() => {
    const update=()=>{try{setConnected(Boolean(connectedImageModel(window.localStorage)));}catch{setConnected(false);}};
    window.addEventListener('nyamuru:image-generation-connected',update);
    return()=>{revision.current++;window.removeEventListener('nyamuru:image-generation-connected',update);};
  }, []);
  const refresh = async (checkComfyui: boolean) => {
    const ticket = ++revision.current;
    setBusy(true); setError(''); setConnections(null);
    try {
      const result = await getImageGenerationConnections(endpoint, checkComfyui);
      if (ticket === revision.current) setConnections(result);
    } catch (error) {
      if (ticket === revision.current) setError(error instanceof Error ? error.message : '実行環境を確認できませんでした');
    } finally { if (ticket === revision.current) setBusy(false); }
  };
  const connect=async()=>{
    const ticket=++revision.current;setBusy(true);setError('');
    try {
      const result=await connectAgentImageGeneration(()=>ticket===revision.current);
      if(ticket===revision.current){setConnections(result);setConnected(true);}
    }catch(error){if(ticket===revision.current){setError(error instanceof Error?error.message:'接続できませんでした');setConnected(false);}}
    finally{if(ticket===revision.current)setBusy(false);}
  };
  return <section class="local-image-model-settings" aria-label="ローカル画像生成">
    <SectionTitle title="ローカル画像生成" />
    <p class="environment-settings-note">Qwen Turboをエージェントの画像生成先として使います。ComfyUIの処理を内蔵しており、生成は設定済みのローカル環境で実行します。</p>
    <div class="paint-entry-actions"><button type="button" class="primary-button" disabled={busy} onClick={() => void connect()}>エージェントに接続</button>
      <button type="button" class="secondary-button" onClick={onOpenAgent}>エージェントに話す</button></div>
    <p class="environment-settings-note">{connected?'生成先：Qwen Turbo（保存済み）。':'エージェントに「画像生成をつないで」と話しかけても設定できます。'} 作品の人物や吹き出しを選び「生成して」と送ると、登録資料を読み込んで生成し、元のあたりへ差し込みます。</p>
    {connections && <div class="model-connection-result" role="status">
      <strong>{connections.qwen.label} · {connections.qwen.runtime}</strong>
      <p>{connections.qwen.message}。</p>
      <span>{connections.qwen.steps}ステップ · 基準解像度 {connections.qwen.resolution}px</span>
      <details class="environment-settings-details"><summary>生成本体と補助モデル</summary><ul>{connections.qwen.models.map(model => <li key={model.role}><strong>{modelRoles[model.role]}</strong><br /><code>{model.file.split('/').at(-1)}</code></li>)}</ul></details>
    </div>}
    <details class="environment-settings-details">
      <summary>別に起動したComfyUIへの接続</summary>
      <p class="environment-settings-note">処理するMac上の接続先です。空欄ならサーバーの設定を使います。この接続確認では、通常のQwen生成先は変わりません。</p>
      <Field label="ComfyUI接続先" wide><input aria-label="ComfyUI接続先" value={endpoint} placeholder="http://127.0.0.1:8188" spellcheck={false}
        onInput={event => { revision.current++; setBusy(false); setConnections(null); setError(''); onChange(event.currentTarget.value); }} onBlur={onCommit} /></Field>
      <button type="button" class="secondary-button" disabled={busy} onClick={() => void refresh(true)}>接続を確認</button>
      {connections && <p role="status">{connections.comfyui.message}{connections.comfyui.version && `（${connections.comfyui.version}）`}<br /><code>{connections.comfyui.endpoint}</code></p>}
    </details>
    {busy && <p role="status">確認しています…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
