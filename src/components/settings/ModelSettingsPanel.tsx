import { useEffect, useState } from 'preact/hooks';
import { Image, MessageSquareText, ShieldCheck } from 'lucide-preact';
import AgentSettings from '../AgentSettings';
import LocalImageModelSettings from '../LocalImageModelSettings';
import { Field, SectionTitle } from '../Fields';
import { getGeminiApiKeyStatus, listGeminiVisionModels, saveGeminiApiKey } from '../../lib/localBridge';
import { DEFAULT_CLOUD_VISION_MODEL } from '../../lib/generationPreferences';
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
  const executionValue = isCloud ? (generationPreferences.cloud.method === 'api' ? 'api' : 'agent') : 'local';
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState<{ configured: boolean; source: 'env' | 'local' | 'none' } | null>(null);
  const [apiKeyMessage, setApiKeyMessage] = useState('');
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [geminiModels, setGeminiModels] = useState<Array<{ id: string; label: string }>>([]);
  const [geminiVisionModels, setGeminiVisionModels] = useState<Array<{ id: string; label: string }>>([]);
  const visionCloudActive = generationPreferences.vision.enabled && generationPreferences.vision.execution === 'cloud';

  useEffect(() => {
    if (executionValue !== 'api' && !visionCloudActive) return;
    let active = true;
    void getGeminiApiKeyStatus()
      .then(status => {
        if (!active) return;
        setApiKeyStatus(status);
        setGeminiModels(status.models);
        if (status.configured && visionCloudActive) {
          void listGeminiVisionModels()
            .then(models => { if (active) setGeminiVisionModels(models); })
            .catch(() => undefined);
        }
      })
      .catch(err => {
        if (!active) return;
        setApiKeyStatus(null);
        setApiKeyMessage(err instanceof Error ? err.message : 'ローカル連携に接続できません');
      });
    return () => { active = false; };
  }, [executionValue, visionCloudActive]);

  const handleSaveApiKey = async () => {
    if (apiKeySaving) return;
    setApiKeySaving(true);
    setApiKeyMessage('');
    try {
      const nextStatus = await saveGeminiApiKey(apiKeyDraft);
      setApiKeyStatus(nextStatus);
      setGeminiModels(nextStatus.models);
      setApiKeyDraft('');
      setApiKeyMessage(nextStatus.configured ? 'APIキーをローカルに保存しました' : '保存済みAPIキーを削除しました');
    } catch (err) {
      setApiKeyMessage(err instanceof Error ? err.message : 'APIキーを保存できませんでした');
    } finally {
      setApiKeySaving(false);
    }
  };

  return <>
    <section aria-label="実行先の切り替え">
      <fieldset class="artwork-mode-options">
        <legend>画像生成の実行先</legend>
        {([{ value: 'local', label: 'ローカル' }, { value: 'agent', label: 'クラウドエージェント' }, { value: 'api', label: 'クラウドAPI' }] as const).map(option => <label class="artwork-mode-option" key={option.value}>
          <input type="radio" name="generation-execution" value={option.value} checked={executionValue === option.value}
            onChange={event => {
              if (!event.currentTarget.checked) return;
              updateGenerationPreferences({ ...generationPreferences, execution: option.value === 'local' ? 'local' : 'cloud',
                cloud: { ...generationPreferences.cloud, ...(option.value !== 'local' ? { method: option.value } : {}) } });
            }} />
          <span><strong>{option.label}</strong></span>
        </label>)}
      </fieldset>
    </section>
    {isCloud ? <section aria-label="クラウド設定">
      <SectionTitle title={executionValue === 'api' ? 'クラウドAPI' : 'クラウドエージェント'} />
      {executionValue === 'api' && (
        <div class="field-grid" style={{ marginBottom: '12px' }}>
          <Field label="モデル名" hint="自由入力（候補からも選択できます）">
            <input
              type="text"
              list="gemini-image-models"
              value={generationPreferences.cloud.apiModel}
              placeholder="例：gemini-3.1-flash-image"
              onInput={event => updateGenerationPreferences({
                ...generationPreferences,
                cloud: { ...generationPreferences.cloud, apiModel: event.currentTarget.value },
              })}
            />
            <datalist id="gemini-image-models">
              {(geminiModels.length > 0 ? geminiModels : [
                { id: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1' },
                { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2' },
                { id: 'gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite' },
              ]).map(model => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </datalist>
          </Field>
          <Field
            label="APIキー"
            hint={apiKeyStatus?.configured ? '設定済み（ローカルに保存されます）' : '未設定（ローカルに保存されます）'}
            wide
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="password"
                value={apiKeyDraft}
                placeholder={apiKeyStatus?.configured ? '更新する場合のみ新しいキーを入力' : 'APIキーを入力'}
                onInput={event => setApiKeyDraft(event.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <button type="button" class="secondary-button" disabled={apiKeySaving} onClick={() => void handleSaveApiKey()}>
                {apiKeySaving ? '保存中…' : '保存'}
              </button>
            </div>
            {apiKeyMessage && <p class="environment-settings-note">{apiKeyMessage}</p>}
          </Field>
        </div>
      )}
      <div class="environment-setting-list">
        <label class="environment-setting-row">
          <span class="environment-setting-icon"><Image size={20} /></span>
          <span><strong>背景を含める</strong></span>
          <input aria-label="背景を含める" type="checkbox" checked={generationPreferences.cloud.includeBackground}
            onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, includeBackground: event.currentTarget.checked } })} />
        </label>
        <label class="environment-setting-row">
          <span class="environment-setting-icon"><MessageSquareText size={20} /></span>
          <span><strong>フキダシを含める</strong></span>
          <input aria-label="フキダシを含める" type="checkbox" checked={generationPreferences.cloud.includeBubbles}
            onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, includeBubbles: event.currentTarget.checked } })} />
        </label>
        <label class="environment-setting-row">
          <span class="environment-setting-icon"><MessageSquareText size={20} /></span>
          <span><strong>描き文字を含める</strong></span>
          <input aria-label="描き文字を含める" type="checkbox" checked={generationPreferences.cloud.includeHandwritten}
            onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, includeHandwritten: event.currentTarget.checked } })} />
        </label>
        <label class="environment-setting-row">
          <span class="environment-setting-icon"><MessageSquareText size={20} /></span>
          <span><strong>写植文字を含める</strong></span>
          <input aria-label="写植文字を含める" type="checkbox" checked={generationPreferences.cloud.includeScreenText}
            onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, includeScreenText: event.currentTarget.checked } })} />
        </label>
        <label class="environment-setting-row">
          <span class="environment-setting-icon"><Image size={20} /></span>
          <span><strong>枠線を生成する</strong></span>
          <input aria-label="枠線を生成する" type="checkbox" checked={generationPreferences.cloud.includePanelBorders}
            onChange={event => updateGenerationPreferences({ ...generationPreferences, cloud: { ...generationPreferences.cloud, includePanelBorders: event.currentTarget.checked } })} />
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
          <p class="environment-settings-note">会話のAPIは未接続です。利用するにはローカルを選んでください。</p>
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
    <section aria-label="キャラ照合（ビジョン）設定">
      <SectionTitle title="キャラ照合（ビジョン）" />
      <label class="environment-setting-row">
        <span class="environment-setting-icon"><Image size={20} /></span>
        <span><strong>キャラ照合（ビジョン）を使う</strong><small>オフのときはキャラクター設定画の登録・管理のみ有効になり、特徴入力欄はグレーアウトします。</small></span>
        <input aria-label="キャラ照合（ビジョン）を使う" type="checkbox" checked={generationPreferences.vision.enabled}
          onChange={event => updateGenerationPreferences({
            ...generationPreferences,
            vision: { ...generationPreferences.vision, enabled: event.currentTarget.checked },
          })} />
      </label>
      {generationPreferences.vision.enabled && <div class="field-grid">
        <Field label="照合の実行先" wide>
          <select aria-label="キャラ照合の実行先" value={generationPreferences.vision.execution}
            onChange={event => updateGenerationPreferences({
              ...generationPreferences,
              vision: { ...generationPreferences.vision, execution: event.currentTarget.value === 'local' ? 'local' : 'cloud' },
            })}>
            <option value="cloud">クラウドAPI（Gemini Vision）</option>
            <option value="local">ローカルVLM</option>
          </select>
        </Field>
        {generationPreferences.vision.execution === 'cloud' ? (
          <Field label="Visionモデル" hint="画像生成と共通のクラウドAPIキーを使用（Flash-Lite系推奨）" wide>
            {geminiVisionModels.length > 0 ? (
              <select aria-label="Visionモデル" value={generationPreferences.vision.cloudModel || DEFAULT_CLOUD_VISION_MODEL}
                onChange={event => updateGenerationPreferences({
                  ...generationPreferences,
                  vision: { ...generationPreferences.vision, cloudModel: event.currentTarget.value },
                })}>
                {!geminiVisionModels.some(m => m.id === (generationPreferences.vision.cloudModel || DEFAULT_CLOUD_VISION_MODEL)) && (
                  <option value={generationPreferences.vision.cloudModel || DEFAULT_CLOUD_VISION_MODEL}>{generationPreferences.vision.cloudModel || DEFAULT_CLOUD_VISION_MODEL}</option>
                )}
                {geminiVisionModels.map(m => <option key={m.id} value={m.id}>{m.label} ({m.id})</option>)}
              </select>
            ) : (
              <input aria-label="Visionモデル" value={generationPreferences.vision.cloudModel || DEFAULT_CLOUD_VISION_MODEL} spellcheck={false}
                placeholder={DEFAULT_CLOUD_VISION_MODEL}
                onInput={event => updateGenerationPreferences({
                  ...generationPreferences,
                  vision: { ...generationPreferences.vision, cloudModel: event.currentTarget.value },
                })} />
            )}
          </Field>
        ) : (
          <Field label="ローカルVLM" hint="保存済みのHugging FaceモデルID" wide>
            <input aria-label="画像VLM" value={localModelDraft.vlmModelId} spellcheck={false} onInput={event => updateLocalModelPreferences({ vlmModelId: event.currentTarget.value })} />
            <small>ローカルVLMでキャラ照合や特徴抽出を行います。</small>
          </Field>
        )}
      </div>}
    </section>
    {localModelError && <p role="alert">入力を確認してください。直前の有効な設定を保持しています。{localModelError}</p>}
    {modelSettingsError && <p role="alert">設定を保存できませんでした。{modelSettingsError}</p>}
  </>;
}
