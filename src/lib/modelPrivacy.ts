export const CLOUD_MODEL_PREFERENCES_KEY = 'manga-name-studio.cloud-model-preferences.v1';

export interface CloudModelPreferences {
  enabled: boolean;
  adultTermsConfirmed: boolean;
}

export interface CloudModelAccess {
  allowed: boolean;
  reason: 'disabled' | 'adult-terms-required' | 'allowed';
}

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const DEFAULT_CLOUD_MODEL_PREFERENCES: CloudModelPreferences = {
  enabled: false,
  adultTermsConfirmed: false,
};

export function loadCloudModelPreferences(storage: PreferenceStorage): CloudModelPreferences {
  try {
    const value = JSON.parse(storage.getItem(CLOUD_MODEL_PREFERENCES_KEY) || 'null') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_CLOUD_MODEL_PREFERENCES };
    const record = value as Record<string, unknown>;
    return {
      enabled: record.enabled === true,
      adultTermsConfirmed: record.adultTermsConfirmed === true,
    };
  } catch {
    return { ...DEFAULT_CLOUD_MODEL_PREFERENCES };
  }
}

export function saveCloudModelPreferences(storage: PreferenceStorage, preferences: CloudModelPreferences): void {
  storage.setItem(CLOUD_MODEL_PREFERENCES_KEY, JSON.stringify({
    enabled: preferences.enabled === true,
    adultTermsConfirmed: preferences.adultTermsConfirmed === true,
  }));
}

/** 人物素材をクラウドへ渡せるかを、端末設定と作品の成人指定から決定する。 */
export function cloudModelAccess(
  preferences: CloudModelPreferences,
  adultContent: boolean,
): CloudModelAccess {
  if (!preferences.enabled) return { allowed: false, reason: 'disabled' };
  if (adultContent && !preferences.adultTermsConfirmed) {
    return { allowed: false, reason: 'adult-terms-required' };
  }
  return { allowed: true, reason: 'allowed' };
}
