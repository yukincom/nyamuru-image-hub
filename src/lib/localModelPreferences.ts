export const LOCAL_MODEL_PREFERENCES_STORAGE_KEY = 'nyamuru.local-model-preferences.v1';

export interface LocalModelPreferences {
  llmAlias: string;
  vlmModelId: string;
  comfyuiUrl: string;
}

/** Existing product defaults. Changing a preference is always an explicit device-local action. */
export const DEFAULT_LOCAL_MODEL_PREFERENCES: Readonly<LocalModelPreferences> = Object.freeze({
  llmAlias: 'Qwen3.8-27B-8bit',
  vlmModelId: 'lmstudio-community/Qwen3-VL-8B-Instruct-MLX-4bit',
  comfyuiUrl: 'http://127.0.0.1:8188',
});

function normalizedLlmAlias(value: unknown): string {
  const alias = typeof value === 'string' ? value.trim() : '';
  if (!alias || alias.length > 120 || !/^[A-Za-z0-9._+-]+$/u.test(alias)) {
    throw new Error('LLMモデルは models.conf に登録したエイリアス名で指定してください');
  }
  return alias;
}

function normalizedVlmModelId(value: unknown): string {
  const modelId = typeof value === 'string' ? value.trim() : '';
  if (!modelId || modelId.length > 200 || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(modelId)) {
    throw new Error('VLMモデルはローカルに保存済みの Hugging Face モデルIDで指定してください');
  }
  return modelId;
}

export function normalizeComfyuiUrl(value: unknown): string {
  if (value === undefined || value === '') return '';
  const endpoint = typeof value === 'string' ? value.trim() : '';
  try {
    const url = new URL(endpoint);
    if (!endpoint || endpoint.length > 200 || /\s|\\/.test(endpoint) || url.protocol !== 'http:'
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port === '0'
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error('ComfyUI接続先はlocalhost上のHTTP URLとポートを指定してください');
  }
}

export function normalizeLocalModelPreferences(value: unknown): LocalModelPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ローカルモデル設定を読み取れません');
  }
  const record = value as Record<string, unknown>;
  return {
    llmAlias: normalizedLlmAlias(record.llmAlias),
    vlmModelId: normalizedVlmModelId(record.vlmModelId),
    comfyuiUrl: normalizeComfyuiUrl(record.comfyuiUrl) || DEFAULT_LOCAL_MODEL_PREFERENCES.comfyuiUrl,
  };
}

export function loadLocalModelPreferences(storage?: Pick<Storage, 'getItem'>): LocalModelPreferences {
  if (!storage) return { ...DEFAULT_LOCAL_MODEL_PREFERENCES };
  const raw = storage.getItem(LOCAL_MODEL_PREFERENCES_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_LOCAL_MODEL_PREFERENCES };
  try {
    return normalizeLocalModelPreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_LOCAL_MODEL_PREFERENCES };
  }
}

export function saveLocalModelPreferences(
  storage: Pick<Storage, 'setItem'>,
  value: LocalModelPreferences,
): LocalModelPreferences {
  const normalized = normalizeLocalModelPreferences(value);
  storage.setItem(LOCAL_MODEL_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function currentLocalModelPreferences(): LocalModelPreferences {
  try {
    return loadLocalModelPreferences(typeof window === 'undefined' ? undefined : window.localStorage);
  } catch {
    return { ...DEFAULT_LOCAL_MODEL_PREFERENCES };
  }
}
