export const GENERATION_PREFERENCES_STORAGE_KEY = 'nyamuru.generation-preferences.v1';
export const LEGACY_CLOUD_MODEL_PREFERENCES_KEY = 'manga-name-studio.cloud-model-preferences.v1';

export interface GenerationPreferences {
  execution: 'local' | 'cloud';
  cloud: {
    adultTermsConfirmed: boolean;
    method: 'api' | 'agent';
    apiEndpoint: string;
    apiModel: string;
    agent: 'codex' | 'other';
    agentName: string;
  };
  local: { imageModel: 'qwen-image-2.1-turbo' };
}

export const DEFAULT_GENERATION_PREFERENCES: Readonly<GenerationPreferences> = Object.freeze({
  execution: 'local',
  cloud: Object.freeze({ adultTermsConfirmed: false, method: 'agent', apiEndpoint: '', apiModel: '', agent: 'codex', agentName: '' }),
  local: Object.freeze({ imageModel: 'qwen-image-2.1-turbo' }),
});

function defaults(): GenerationPreferences {
  return { ...DEFAULT_GENERATION_PREFERENCES, cloud: { ...DEFAULT_GENERATION_PREFERENCES.cloud }, local: { ...DEFAULT_GENERATION_PREFERENCES.local } };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

/** Only connection descriptions are stored here. Credentials belong to the chosen provider. */
function normalize(value: unknown): GenerationPreferences {
  const source = record(value), cloud = record(source.cloud);
  let apiEndpoint = text(cloud.apiEndpoint, 500);
  if (/[?#@]/u.test(apiEndpoint)) apiEndpoint = '';
  try {
    const url = new URL(apiEndpoint);
    if (url.username || url.password || url.search || url.hash) apiEndpoint = '';
  } catch { /* An unfinished endpoint can be retained while the user types. */ }
  return {
    execution: source.execution === 'cloud' ? 'cloud' : 'local',
    cloud: {
      adultTermsConfirmed: cloud.adultTermsConfirmed === true,
      method: cloud.method === 'api' ? 'api' : 'agent',
      apiEndpoint,
      apiModel: text(cloud.apiModel, 200),
      agent: cloud.agent === 'other' ? 'other' : 'codex',
      agentName: text(cloud.agentName, 120),
    },
    local: { imageModel: 'qwen-image-2.1-turbo' },
  };
}

export function loadGenerationPreferences(storage?: Pick<Storage, 'getItem'>): GenerationPreferences {
  if (!storage) return defaults();
  try {
    const raw = storage.getItem(GENERATION_PREFERENCES_STORAGE_KEY);
    const source = raw ? record(JSON.parse(raw)) : null;
    if (source?.version === 2) return normalize(source);
    if (source?.version !== undefined) return defaults();
    // Read the old two-key contract only. Conflicting/invalid settings must not enable cloud use.
    let legacy: Record<string, unknown> = {};
    try { legacy = record(JSON.parse(storage.getItem(LEGACY_CLOUD_MODEL_PREFERENCES_KEY) || 'null')); }
    catch { /* A missing or unreadable legacy grant is not consent. */ }
    const next = source ? normalize(source) : defaults();
    next.execution = legacy.enabled === true && (!source || source.execution === 'cloud') ? 'cloud' : 'local';
    next.cloud.adultTermsConfirmed = legacy.adultTermsConfirmed === true;
    return next;
  } catch { return defaults(); }
}

export function saveGenerationPreferences(storage: Pick<Storage, 'setItem'>, value: GenerationPreferences): GenerationPreferences {
  const normalized = normalize(value);
  if (normalized.cloud.apiEndpoint !== value.cloud.apiEndpoint) {
    throw new Error('API接続先には認証情報・クエリ・フラグメントを含めず、500文字以内で入力してください');
  }
  storage.setItem(GENERATION_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 2, ...normalized }));
  return normalized;
}

export function currentGenerationPreferences(): GenerationPreferences {
  try { return loadGenerationPreferences(typeof window === 'undefined' ? undefined : window.localStorage); }
  catch { return defaults(); }
}
