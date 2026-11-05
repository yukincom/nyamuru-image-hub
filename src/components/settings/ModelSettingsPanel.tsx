import { Languages, ShieldCheck } from 'lucide-preact';
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
  const imageExecution = generationPreferences.execution === 'local' ? 'local' : generationPreferences.cloud.method;
  const conversationLabel = conversationPreferences.execution === 'local' ? `ローカル・${localModelPreferences.llmAlias}` : 'API（未接続）';
  const imageLabel = imageExecution === 'local' ? 'ローカル' : imageExecution === 'api' ? 'API（未接続）'
    : `外部エージェント・${generationPreferences.cloud.agent === 'codex' ? 'Codex' : generationPreferences.cloud.agentName || 'その他'}`;
  return <>
    <p class="environment-settings-note">設定は変更するとこの端末に自動保存され、次の依頼から使われます。</p>
    <p aria-label="モデル設定の組み合わせ">会話：{conversationLabel} ／ 画像生成：{imageLabel}</p>
    <section aria-label="会話・翻訳のモデル設定">
      <SectionTitle title="会話・翻訳" />
      <fieldset class="artwork-mode-options">
        <legend>会話・翻訳の実行先</legend>
        {([{ value: 'local', label: 'ローカル' }, { value: 'api', label: 'API（未接続）' }] as const).map(option => <label class="artwork-mode-option" key={option.value}>
          <input type="radio" name="conversation-execution" value={option.value} disabled={option.value === 'api'}
            checked={conversationPreferences.execution === option.value}
            onChange={event => { if (event.currentTarget.checked && option.value === 'local') updateConversationPreferences({ ...conversationPreferences, execution: option.value }); }} />
          <span><strong>{option.label}</strong></span>
        </label>)}
      </fieldset>
      {conversationPreferences.execution === 'local' ? <div class="field-grid">
        <Field label="文章LLM" hint="登録済みのモデル名" wide>
          <input aria-label="文章LLM" value={localModelDraft.llmAlias} spellcheck={false} onInput={event => updateLocalModelPreferences({ llmAlias: event.currentTarget.value })} />
          <small>起動済みのLLMを共用します。未起動なら必要な間だけ起動します。このローカルモデル設定は人物アクションの統合でも共用します。</small>
        </Field>
      </div> : <p class="environment-settings-note">会話・翻訳のAPIは未接続です。利用するにはローカルを選んでください。</p>}
      {agentProfile && onChangeAgentProfile && <AgentSettings profile={agentProfile} onChange={onChangeAgentProfile} />}
      {conversationSettingsError && <p role="alert">会話・翻訳の設定を保存できませんでした。{conversationSettingsError}</p>}
    </section>
    <section aria-label="画像生成のモデル設定">
      <SectionTitle title="画像生成" />
      <fieldset class="artwork-mode-options">
        <legend>画像生成の実行先</legend>
        {([{ value: 'local', label: 'ローカル' }, { value: 'api', label: 'API（未接続）' },
          { value: 'agent', label: '外部エージェント' }] as const).map(option => <label class="artwork-mode-option" key={option.value}>
          <input type="radio" name="generation-execution" value={option.value} disabled={option.value === 'api'} checked={imageExecution === option.value}
            onChange={event => {
              if (!event.currentTarget.checked || option.value === 'api') return;
              updateGenerationPreferences({ ...generationPreferences, execution: option.value === 'local' ? 'local' : 'cloud',
                cloud: { ...generationPreferences.cloud, ...(option.value === 'agent' ? { method: 'agent' } : {}) } });
            }} />
          <span><strong>{option.label}</strong></span>
        </label>)}
      </fieldset>
      {imageExecution === 'local' ? <section aria-label="ローカルモデル設定">
        <LocalImageModelSettings onOpenAgent={onOpenAgent} endpoint={localModelDraft.comfyuiUrl}
          workflowId={generationPreferences.local.workflowId}
          onWorkflowChange={workflowId => updateGenerationPreferences({ ...generationPreferences, local: { ...generationPreferences.local, workflowId } })}
          onChange={comfyuiUrl => updateLocalModelPreferences({ comfyuiUrl })} />
      </section> : imageExecution === 'api' ? <p class="environment-settings-note">画像生成のAPIは未接続です。利用するにはローカルまたは外部エージェントを選んでください。</p>
        : <section aria-label="外部エージェント設定" class="field-grid">
          <Field label="エージェント" wide><select aria-label="クラウドエージェント" value={generationPreferences.cloud.agent}
            onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, agent: event.currentTarget.value === 'other' ? 'other' : 'codex' } })}>
            <option value="codex">Codex</option><option value="other">その他</option>
          </select></Field>
          {generationPreferences.cloud.agent === 'other' && <Field label="エージェント名" wide><input aria-label="エージェント名" maxLength={120} value={generationPreferences.cloud.agentName}
            onInput={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, agentName: event.currentTarget.value } })} /></Field>}
          <p class="environment-settings-note">生成指示と参照画像を書き出して選んだエージェントへ渡し、生成画像を読み込んで戻します。利用アカウントはエージェント側で設定します。</p>
        </section>}
      <p class="environment-settings-note">日本語の生成指示は「会話・翻訳」のモデルで英訳します。全生成方式への英訳と確認画面の接続は準備中です。</p>
      <label class="environment-setting-row">
        <span class="environment-setting-icon"><Languages size={20} /></span>
        <span><strong>英訳後の確認を省略して生成する</strong><small>確認画面は準備中のため、この設定はまだ利用できません。</small></span>
        <input aria-label="英訳後の確認を省略して生成する" type="checkbox" disabled checked={generationPreferences.skipTranslationConfirmation} />
      </label>
    </section>
    {(generationPreferences.execution === 'cloud' || conversationPreferences.execution === 'api') && <label class="environment-setting-row">
      <span class="environment-setting-icon"><ShieldCheck size={20} /></span>
      <span><strong>成人指定作品での利用規約を確認済み</strong><small>成人指定作品をクラウドへ渡す場合に必要です。会話と画像生成で共用します。</small></span>
      <input aria-label="成人指定作品での利用規約を確認済み" type="checkbox" checked={generationPreferences.cloud.adultTermsConfirmed}
        onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, adultTermsConfirmed: event.currentTarget.checked } })} />
    </label>}
    <details class="environment-settings-details">
      <summary>詳細設定</summary>
      <div class="field-grid">
        <Field label="画像VLM" hint="保存済みのHugging FaceモデルID" wide>
          <input aria-label="画像VLM" value={localModelDraft.vlmModelId} spellcheck={false} onInput={event => updateLocalModelPreferences({ vlmModelId: event.currentTarget.value })} />
          <small>人物資料や演技の画像解析に使います。会話の実行先を切り替えても、この設定は変わりません。</small>
        </Field>
      </div>
    </details>
    {localModelError && <p role="alert">入力を確認してください。直前の有効な設定を保持しています。{localModelError}</p>}
    {modelSettingsError && <p role="alert">設定を保存できませんでした。{modelSettingsError}</p>}
  </>;
}
