import { ShieldCheck } from 'lucide-preact';
import AgentSettings from '../AgentSettings';
import LocalImageModelSettings from '../LocalImageModelSettings';
import { Field, SectionTitle } from '../Fields';
import type { EnvironmentSettingsProps } from '../environmentSettingsTypes';
import type { useModelSettings } from './useModelSettings';

type Props = Pick<EnvironmentSettingsProps, 'onOpenAgent' | 'agentProfile' | 'onChangeAgentProfile'> & {
  settings: ReturnType<typeof useModelSettings>;
};

export default function ModelSettingsPanel({ settings, onOpenAgent, agentProfile, onChangeAgentProfile }: Props) {
  const { localModelPreferences, generationPreferences, modelSettingsError, localModelError,
    updateGenerationPreferences, updateLocalModelPreferences } = settings;
  return <>
    <SectionTitle title="生成に使うモデル" />
    <p class="environment-settings-note">設定は変更するとこの端末に自動保存されます。生成する場所はキャンバスの右クリックから選びます。</p>
    <fieldset class="artwork-mode-options">
      <legend>実行する場所</legend>
      {([{ value: 'cloud', label: 'クラウド', description: 'APIまたはCodexなどのエージェントを利用します。' },
        { value: 'local', label: 'ローカル', description: 'この環境に用意したモデルを利用します。' }] as const).map(option => <label class="artwork-mode-option" key={option.value}>
        <input type="radio" name="generation-execution" value={option.value} checked={generationPreferences.execution === option.value}
          onChange={event => { if (event.currentTarget.checked) updateGenerationPreferences({ ...generationPreferences, execution: option.value }); }} />
        <span><strong>{option.label}</strong><small>{option.description}</small></span>
      </label>)}
    </fieldset>
    {generationPreferences.execution === 'local' ? <section aria-label="ローカルモデル設定">
      <LocalImageModelSettings onOpenAgent={onOpenAgent} endpoint={localModelPreferences.comfyuiUrl}
        workflowId={generationPreferences.local.workflowId}
        onWorkflowChange={workflowId => updateGenerationPreferences({ ...generationPreferences, local: { ...generationPreferences.local, workflowId } })}
        onChange={comfyuiUrl => updateLocalModelPreferences({ comfyuiUrl })} />
      <details class="environment-settings-details">
        <summary>文章・画像解析のモデル</summary>
        <div class="field-grid">
          <Field label="文章LLM" hint="登録済みのモデル名" wide>
            <input aria-label="文章LLM" value={localModelPreferences.llmAlias} spellcheck={false} onInput={event => updateLocalModelPreferences({ llmAlias: event.currentTarget.value })} />
            <small>起動済みのLLMを共用します。起動していないときは、このモデルを必要な間だけ起動します。</small>
          </Field>
          <Field label="画像VLM" hint="保存済みのHugging FaceモデルID" wide>
            <input aria-label="画像VLM" value={localModelPreferences.vlmModelId} spellcheck={false} onInput={event => updateLocalModelPreferences({ vlmModelId: event.currentTarget.value })} />
            <small>人物資料や演技の画像解析に使います。</small>
          </Field>
        </div>
      </details>
      {localModelError && <p role="alert">入力を確認してください。直前の有効な設定を保持しています。{localModelError}</p>}
      {agentProfile&&onChangeAgentProfile&&<AgentSettings profile={agentProfile} onChange={onChangeAgentProfile}/>}
    </section> : <section aria-label="クラウドモデル設定">
      <fieldset class="artwork-mode-options">
        <legend>利用方法</legend>
        {([{ value: 'api', label: 'API' }, { value: 'agent', label: 'エージェント' }] as const).map(option => <label class="artwork-mode-option" key={option.value}>
          <input type="radio" name="cloud-generation-method" value={option.value} checked={generationPreferences.cloud.method === option.value}
            onChange={event => { if (event.currentTarget.checked) updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, method: option.value } }); }} />
          <span><strong>{option.label}</strong></span>
        </label>)}
      </fieldset>
      {generationPreferences.cloud.method === 'api' ? <div class="field-grid">
        <Field label="API接続先" wide><input aria-label="API接続先" type="url" maxLength={500} value={generationPreferences.cloud.apiEndpoint} placeholder="https://…" spellcheck={false}
          onInput={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, apiEndpoint: event.currentTarget.value } })} /></Field>
        <Field label="APIモデル" wide><input aria-label="APIモデル" maxLength={200} value={generationPreferences.cloud.apiModel} spellcheck={false}
          onInput={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, apiModel: event.currentTarget.value } })} /></Field>
        <p class="environment-settings-note">APIは現在未接続です。接続先とモデル名を保存できます。認証情報は利用先で管理します。</p>
      </div> : <div class="field-grid">
        <Field label="エージェント" wide><select aria-label="クラウドエージェント" value={generationPreferences.cloud.agent}
          onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, agent: event.currentTarget.value === 'other' ? 'other' : 'codex' } })}>
          <option value="codex">Codex</option><option value="other">その他</option>
        </select></Field>
        {generationPreferences.cloud.agent === 'other' && <Field label="エージェント名" wide><input aria-label="エージェント名" maxLength={120} value={generationPreferences.cloud.agentName}
          onInput={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, agentName: event.currentTarget.value } })} /></Field>}
        <p class="environment-settings-note">生成指示と参照画像を書き出し、選んだエージェントへ渡します。利用するアカウントはエージェント側で設定します。</p>
      </div>}
      <label class="environment-setting-row">
        <span class="environment-setting-icon"><ShieldCheck size={20} /></span>
        <span><strong>成人指定作品での利用規約を確認済み</strong><small>成人指定作品でもクラウドモデルを使う場合に必要です。この端末では一度だけ確認します。</small></span>
        <input type="checkbox" checked={generationPreferences.cloud.adultTermsConfirmed} onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, adultTermsConfirmed: event.currentTarget.checked } })} />
      </label>
    </section>}
    {modelSettingsError && <p role="alert">設定を保存できませんでした。{modelSettingsError}</p>}
  </>;
}
