export const CONVERSATION_PREFERENCES_STORAGE_KEY = 'nyamuru.conversation-preferences.v1';

/** Connection references only. The shared local LLM alias stays in localModelPreferences. */
export interface ConversationPreferences {
  execution: 'local' | 'api';
  connectionId: string;
  model: string;
}

export const DEFAULT_CONVERSATION_PREFERENCES: Readonly<ConversationPreferences> = Object.freeze({
  execution: 'local', connectionId: '', model: '',
});

function normalize(value: unknown): ConversationPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('会話・翻訳の設定を読み取れません');
  const source = value as Record<string, unknown>;
  if (source.execution !== 'local' && source.execution !== 'api') throw new Error('会話・翻訳の実行先を選択してください');
  if (typeof source.connectionId !== 'string' || !/^[A-Za-z0-9_-]{0,120}$/u.test(source.connectionId)) {
    throw new Error('登録済みの接続を選択してください');
  }
  if (typeof source.model !== 'string' || source.model.length > 200 || /[\u0000-\u001f]/u.test(source.model)) {
    throw new Error('会話・翻訳のモデル名を確認してください');
  }
  return { execution: source.execution as ConversationPreferences['execution'], connectionId: source.connectionId, model: source.model };
}

export function loadConversationPreferences(storage?: Pick<Storage, 'getItem'>): ConversationPreferences {
  try {
    const source = JSON.parse(storage?.getItem(CONVERSATION_PREFERENCES_STORAGE_KEY) || 'null');
    if (source?.version === 1) return normalize(source);
  } catch { /* Invalid device settings never enable an API. */ }
  return { ...DEFAULT_CONVERSATION_PREFERENCES };
}

export function saveConversationPreferences(storage: Pick<Storage, 'setItem'>, value: ConversationPreferences): ConversationPreferences {
  const normalized = normalize(value);
  storage.setItem(CONVERSATION_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, ...normalized }));
  return normalized;
}

export function currentConversationPreferences(): ConversationPreferences {
  try { return loadConversationPreferences(typeof window === 'undefined' ? undefined : window.localStorage); }
  catch { return { ...DEFAULT_CONVERSATION_PREFERENCES }; }
}
