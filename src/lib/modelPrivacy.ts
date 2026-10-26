import type { GenerationPreferences } from './generationPreferences.ts';

export interface CloudModelAccess {
  allowed: boolean;
  reason: 'disabled' | 'adult-terms-required' | 'allowed';
}

/** 実行先と成人指定作品への同意は別条件。永続化の正本はgenerationPreferences。 */
export function cloudModelAccess(
  preferences: Pick<GenerationPreferences, 'execution'> & { cloud: Pick<GenerationPreferences['cloud'], 'adultTermsConfirmed'> },
  adultContent: boolean,
): CloudModelAccess {
  if (preferences.execution !== 'cloud') return { allowed: false, reason: 'disabled' };
  if (adultContent && !preferences.cloud.adultTermsConfirmed) {
    return { allowed: false, reason: 'adult-terms-required' };
  }
  return { allowed: true, reason: 'allowed' };
}
