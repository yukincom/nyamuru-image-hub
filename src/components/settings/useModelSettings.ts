import { useState } from 'preact/hooks';
import { DEFAULT_LOCAL_MODEL_PREFERENCES, loadLocalModelPreferences, saveLocalModelPreferences, type LocalModelPreferences } from '../../lib/localModelPreferences';
import { loadGenerationPreferences, saveGenerationPreferences, type GenerationPreferences } from '../../lib/generationPreferences';
import { loadConversationPreferences, saveConversationPreferences, type ConversationPreferences } from '../../lib/conversationPreferences';

// Called by EnvironmentSettings so preference state survives every tab change.
export function useModelSettings() {
  const [localModelPreferences, setLocalModelPreferences] = useState<LocalModelPreferences>(() => {
    try { return loadLocalModelPreferences(window.localStorage); } catch { return { ...DEFAULT_LOCAL_MODEL_PREFERENCES }; }
  });
  const [generationPreferences, setGenerationPreferences] = useState(() => {
    try { return loadGenerationPreferences(window.localStorage); } catch { return loadGenerationPreferences(); }
  });
  const [conversationPreferences, setConversationPreferences] = useState(() => {
    try { return loadConversationPreferences(window.localStorage); } catch { return loadConversationPreferences(); }
  });
  const [localModelDraft, setLocalModelDraft] = useState(localModelPreferences);
  const [conversationSettingsError, setConversationSettingsError] = useState('');
  const [modelSettingsError, setModelSettingsError] = useState('');
  const [localModelError, setLocalModelError] = useState('');
  const updateConversationPreferences = (next: ConversationPreferences) => {
    try {
      setConversationPreferences(saveConversationPreferences(window.localStorage, next));
      setConversationSettingsError('');
    } catch (error) {
      setConversationPreferences(current => ({ ...current }));
      // 旧: 会話・翻訳の設定 -> 新: 会話の設定（英訳機能は廃止）。
      setConversationSettingsError(error instanceof Error ? error.message : '会話・翻訳の設定を保存できませんでした');
    }
  };
  const updateGenerationPreferences = (next: GenerationPreferences) => {
    try {
      setGenerationPreferences(saveGenerationPreferences(window.localStorage, next));
      setModelSettingsError('');
    } catch (error) {
      // Reapply the last saved values even when a repeated failure has the same error text.
      setGenerationPreferences(current => ({ ...current }));
      setModelSettingsError(error instanceof Error ? error.message : 'モデル設定を保存できませんでした');
    }
  };
  const updateLocalModelPreferences = (patch: Partial<LocalModelPreferences>) => {
    const next = { ...localModelDraft, ...patch };
    setLocalModelDraft(next);
    try {
      const saved = saveLocalModelPreferences(window.localStorage, next);
      setLocalModelPreferences(saved);
      setLocalModelDraft(saved);
      setLocalModelError('');
    } catch (error) {
      setLocalModelError(error instanceof Error ? error.message : 'ローカルモデル設定を保存できませんでした');
    }
  };
  return { localModelPreferences, localModelDraft, conversationPreferences, generationPreferences,
    conversationSettingsError, modelSettingsError, localModelError,
    updateConversationPreferences, updateGenerationPreferences, updateLocalModelPreferences };
}
