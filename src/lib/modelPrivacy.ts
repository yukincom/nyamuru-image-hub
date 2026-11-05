import type { GenerationPreferences } from './generationPreferences.ts';

export interface CloudModelAccess {
  allowed: boolean;
  reason: 'disabled' | 'adult-terms-required' | 'allowed';
}

/** 共通の作品条件。用途ごとの実行先は呼び出し側で判定する。 */
export function cloudContentAccess(
  preferences: Pick<GenerationPreferences['cloud'], 'adultTermsConfirmed'>,
  adultContent: boolean,
): CloudModelAccess {
  if (adultContent && !preferences.adultTermsConfirmed) return { allowed: false, reason: 'adult-terms-required' };
  return { allowed: true, reason: 'allowed' };
}

/** 画像生成用の既存入口。会話の実行先には流用しない。 */
export function cloudModelAccess(
  preferences: Pick<GenerationPreferences, 'execution'> & { cloud: Pick<GenerationPreferences['cloud'], 'adultTermsConfirmed'> },
  adultContent: boolean,
): CloudModelAccess {
  if (preferences.execution !== 'cloud') return { allowed: false, reason: 'disabled' };
  return cloudContentAccess(preferences.cloud, adultContent);
}
