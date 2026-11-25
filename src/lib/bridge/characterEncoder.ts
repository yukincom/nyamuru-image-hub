import type { CharacterReferenceView, FigureSize } from '../../types';
import { blobDataUrl, postJson } from './transport.ts';

export interface LightweightCharacterMatchCandidate {
  id: string;
  referenceImages: Blob[];
}

export interface LightweightCharacterMatchResult {
  candidateId: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  score: number;
  margin: number;
  recommendedView: CharacterReferenceView;
  suggestedSize: FigureSize;
  rankings: Array<{ id: string; score: number }>;
}

export interface ReferenceViewRecommendation {
  assetId: string;
  matchedView: CharacterReferenceView;
  recommendedView: CharacterReferenceView;
  suggestedSize: FigureSize;
  confidence: number;
}

/** M1+M2: 共有軽量画像エンコーダでキャラクター照合と設定画アングル推薦を行う。 */
export async function matchCharacterWithLightweightEncoder(
  figureCrop: Blob,
  candidates: readonly LightweightCharacterMatchCandidate[],
  currentSize: FigureSize = 'bust-up',
): Promise<LightweightCharacterMatchResult> {
  const encodedCandidates = await Promise.all(candidates.map(async (candidate) => ({
    id: candidate.id,
    reference_images: await Promise.all(candidate.referenceImages.map((blob) => blobDataUrl(blob))),
  })));
  const payload = await postJson('/api/character-match/lightweight', {
    image: await blobDataUrl(figureCrop),
    candidates: encodedCandidates,
    current_size: currentSize,
  }, 60_000) as Record<string, unknown>;
  const confidenceValues = new Set(['high', 'medium', 'low', 'none']);
  const confidence = typeof payload.confidence === 'string' && confidenceValues.has(payload.confidence)
    ? payload.confidence as LightweightCharacterMatchResult['confidence']
    : 'none';
  return {
    candidateId: confidence === 'none' || typeof payload.candidate_id !== 'string' ? '' : payload.candidate_id,
    confidence,
    score: typeof payload.score === 'number' ? payload.score : 0,
    margin: typeof payload.margin === 'number' ? payload.margin : 0,
    recommendedView: typeof payload.recommended_view === 'string'
      ? payload.recommended_view as CharacterReferenceView
      : 'other',
    suggestedSize: typeof payload.suggested_size === 'string'
      ? payload.suggested_size as FigureSize
      : currentSize,
    rankings: Array.isArray(payload.rankings)
      ? payload.rankings
        .filter((r): r is { id: string; score: number } => Boolean(r && typeof r === 'object' && typeof (r as Record<string, unknown>).id === 'string'))
        .map((r) => ({ id: r.id, score: Number(r.score) || 0 }))
      : [],
  };
}

/** M2: 人物あたり画像から最適な登録設定画（アングル）を推薦する。 */
export async function recommendCharacterReferenceView(
  figureCrop: Blob,
  availableAssets: ReadonlyArray<{ assetId: string; view?: CharacterReferenceView }>,
  currentSize: FigureSize = 'bust-up',
): Promise<ReferenceViewRecommendation> {
  const payload = await postJson('/api/figure-reference/recommend-view', {
    image: await blobDataUrl(figureCrop),
    available_assets: availableAssets.map((item) => ({ asset_id: item.assetId, view: item.view ?? 'other' })),
    current_size: currentSize,
  }, 30_000) as Record<string, unknown>;
  return {
    assetId: typeof payload.asset_id === 'string' ? payload.asset_id : '',
    matchedView: typeof payload.matched_view === 'string' ? payload.matched_view as CharacterReferenceView : 'other',
    recommendedView: typeof payload.recommended_view === 'string' ? payload.recommended_view as CharacterReferenceView : 'other',
    suggestedSize: typeof payload.suggested_size === 'string' ? payload.suggested_size as FigureSize : currentSize,
    confidence: typeof payload.confidence === 'number' ? payload.confidence : 0,
  };
}
