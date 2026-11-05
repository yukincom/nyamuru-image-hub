import { useState } from 'preact/hooks';
import { DEFAULT_LOCAL_MODEL_PREFERENCES, loadLocalModelPreferences, saveLocalModelPreferences, type LocalModelPreferences } from '../../lib/localModelPreferences';
import { loadGenerationPreferences, saveGenerationPreferences, type GenerationPreferences } from '../../lib/generationPreferences';

// Called by EnvironmentSettings so preference state survives every tab change.
export function useModelSettings() {
  const [localModelPreferences, setLocalModelPreferences] = useState<LocalModelPreferences>(() => {
    try { return loadLocalModelPreferences(window.localStorage); } catch { return { ...DEFAULT_LOCAL_MODEL_PREFERENCES }; }
  });
  const [generationPreferences, setGenerationPreferences] = useState(() => {
    try { return loadGenerationPreferences(window.localStorage); } catch { return loadGenerationPreferences(); }
  });
  const [modelSettingsError, setModelSettingsError] = useState('');
  const [localModelError, setLocalModelError] = useState('');
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
    const next = { ...localModelPreferences, ...patch };
    setLocalModelPreferences(next);
    try {
      saveLocalModelPreferences(window.localStorage, next);
      setLocalModelError('');
    } catch (error) {
      setLocalModelError(error instanceof Error ? error.message : 'ローカルモデル設定を保存できませんでした');
    }
  };
  return { localModelPreferences, generationPreferences, modelSettingsError, localModelError,
    updateGenerationPreferences, updateLocalModelPreferences };
}
