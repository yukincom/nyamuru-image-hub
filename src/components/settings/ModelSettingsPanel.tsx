import { Image, MessageSquareText, ShieldCheck } from 'lucide-preact';
import AgentSettings from '../AgentSettings';
import LocalImageModelSettings from '../LocalImageModelSettings';
import { Field, SectionTitle } from '../Fields';
import type { EnvironmentSettingsProps } from '../environmentSettingsTypes';
import type { useModelSettings } from './useModelSettings';

type Props = Pick<EnvironmentSettingsProps, 'onOpenAgent' | 'agentProfile' | 'onChangeAgentProfile'> & {
  settings: ReturnType<typeof useModelSettings>;
};

export default function ModelSettingsPanel({ settings, onOpenAgent, agentProfile, onChangeAgentProfile }: Props) {
  const { localModelPreferences, localModelDraft, conversationPreferences, generationPreferences,
    conversationSettingsError, modelSettingsError, localModelError,
    updateConversationPreferences, updateGenerationPreferences, updateLocalModelPreferences } = settings;
  const isCloud = generationPreferences.execution === 'cloud';
  const executionValue = isCloud ? 'agent' : 'local';
  return <>
    <section aria-label="実行先の切り替え">
      <fieldset class="artwork-mode-options">
        <legend>画像生成の実行先</legend>
        {([{ value: 'local', label: 'ローカル' }, { value: 'agent', label: 'クラウドエージェント' }] as const).map(option => <label class="artwork-mode-option" key={option.value}>
          <input type="radio" name="generation-execution" value={option.value} checked={executionValue === option.value}
            onChange={event => {
              if (!event.currentTarget.checked) return;
              updateGenerationPreferences({ ...generationPreferences, execution: option.value === 'local' ? 'local' : 'cloud',
                cloud: { ...generationPreferences.cloud, ...(option.value === 'agent' ? { method: 'agent' } : {}) } });
            }} />
          <span><strong>{option.label}</strong></span>
        </label>)}
      </fieldset>
    </section>
    {isCloud ? <section aria-label="クラウドエージェント設定">
      <SectionTitle title="クラウドエージェント" />
      <div class="environment-setting-list">
        <label class="environment-setting-row">
          <span class="environment-setting-icon"><Image size={20} /></span>
          <span><strong>背景を含める</strong></span>
          <input aria-label="背景を含める" type="checkbox" checked={generationPreferences.cloud.includeBackground}
            onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, includeBackground: event.currentTarget.checked } })} />
        </label>
        <label class="environment-setting-row">
          <span class="environment-setting-icon"><MessageSquareText size={20} /></span>
          <span><strong>吹き出しを含める</strong></span>
          <input aria-label="吹き出しを含める" type="checkbox" checked={generationPreferences.cloud.includeBubbles}
            onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, includeBubbles: event.currentTarget.checked } })} />
        </label>
        <label class="environment-setting-row">
          <span class="environment-setting-icon"><Image size={20} /></span>
          <span><strong>画像参照を使う</strong></span>
          <input aria-label="画像参照を使う" type="checkbox" checked={generationPreferences.cloud.exportReferenceImages}
            onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, exportReferenceImages: event.currentTarget.checked } })} />
        </label>
      </div>
    </section> : <>
      {agentProfile && onChangeAgentProfile && <AgentSettings profile={agentProfile} onChange={onChangeAgentProfile} />}
      <section aria-label="ローカルモデル設定">
        <LocalImageModelSettings onOpenAgent={onOpenAgent} endpoint={localModelDraft.comfyuiUrl}
          workflowId={generationPreferences.local.workflowId}
          onWorkflowChange={workflowId => updateGenerationPreferences({ ...generationPreferences, local: { ...generationPreferences.local, workflowId } })}
          onChange={comfyuiUrl => updateLocalModelPreferences({ comfyuiUrl })} />
      </section>
      <section aria-label="言語モデル設定">
        <SectionTitle title="言語モデル" />
        {conversationPreferences.execution === 'local' ? <div class="field-grid">
          <Field label="LLM接続先" wide>
            <input aria-label="LLM接続先" value={localModelDraft.llmUrl} placeholder="http://127.0.0.1:8080" spellcheck={false} onInput={event => updateLocalModelPreferences({ llmUrl: event.currentTarget.value })} />
            <small>その時点で起動している言語モデルを使用します。</small>
          </Field>
        </div> : <>
          <p class="environment-settings-note">会話・翻訳のAPIは未接続です。利用するにはローカルを選んでください。</p>
          <div class="paint-entry-actions"><button type="button" class="secondary-button" onClick={() => updateConversationPreferences({ ...conversationPreferences, execution: 'local' })}>ローカルを使う</button></div>
        </>}
        {conversationSettingsError && <p role="alert">言語モデルの設定を保存できませんでした。{conversationSettingsError}</p>}
      </section>
    </>}
    {(generationPreferences.execution === 'cloud' || conversationPreferences.execution === 'api') && <label class="environment-setting-row">
      <span class="environment-setting-icon"><ShieldCheck size={20} /></span>
      <span><strong>成人指定作品での利用規約を確認済み</strong><small>成人指定作品をクラウドへ渡す場合に必要です。会話と画像生成で共用します。</small></span>
      <input aria-label="成人指定作品での利用規約を確認済み" type="checkbox" checked={generationPreferences.cloud.adultTermsConfirmed}
        onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, adultTermsConfirmed: event.currentTarget.checked } })} />
    </label>}
    <div class="field-grid">
      <Field label="画像VLM" hint="保存済みのHugging FaceモデルID" wide>
        <input aria-label="画像VLM" value={localModelDraft.vlmModelId} spellcheck={false} onInput={event => updateLocalModelPreferences({ vlmModelId: event.currentTarget.value })} />
        <small>人物資料や演技の画像解析に使います。会話の実行先を切り替えても、この設定は変わりません。</small>
      </Field>
    </div>
    {localModelError && <p role="alert">入力を確認してください。直前の有効な設定を保持しています。{localModelError}</p>}
    {modelSettingsError && <p role="alert">設定を保存できませんでした。{modelSettingsError}</p>}
  </>;
}
