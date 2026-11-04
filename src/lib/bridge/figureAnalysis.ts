import type {
  FigureSize,
  CharacterRecognitionProfile,
  LocalVlmAnalyzer,
  CharacterReferenceView,
  FigureExpressionReading,
  ReadExpressionFace,
  VisualEvidence,
} from '../../types';
import { blobDataUrl, postJson } from './transport.ts';
import { currentLocalModelPreferences } from '../localModelPreferences.ts';
import { FIGURE_SIZES } from '../manga.ts';
import { isLanClient } from '../clientRuntime.ts';
import { loadCharacterReferenceImage } from './assetStorage.ts';
import type { CharacterMatchCandidate } from '../characterMatching.ts';
import type { PanelActionSuggestionRequest, PanelActionSuggestionResponse } from '../panelActions.ts';

export interface FigurePerformanceSuggestion {
  action: string;
  suggestedSize: FigureSize;
  analysis: Record<string, unknown>;
  analyzer: {
    provider: 'local';
    runtime: 'mlx-vlm';
    model: string;
    promptVersion: string;
    analyzedAt: string;
  };
}

export interface CharacterReferenceSuggestion {
  recognition: CharacterRecognitionProfile;
  analyzer: LocalVlmAnalyzer;
  referenceView: CharacterReferenceView;
}

export interface CharacterReferenceSetSuggestion extends Omit<CharacterReferenceSuggestion, 'referenceView'> {
  referenceViews: Array<{
    assetId: string;
    referenceView: CharacterReferenceView;
    confidence: 'high' | 'medium' | 'low';
  }>;
}


export interface CharacterMatchSuggestion {
  candidateId: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  observed: string[];
  reason: string;
  action: string;
  suggestedSize: FigureSize;
  analysis: Record<string, unknown>;
  expressionReading: FigureExpressionReading;
  analyzer: LocalVlmAnalyzer;
}

// The local worker validates parts against its pinned catalog. Keep just that record
// in the project; auxiliary tagger hints, model paths and unrelated pose data stay out.
function expressionReadingFromAnalysis(analysis: Record<string, unknown> | null): FigureExpressionReading {
  const reading = analysis?.expression as Partial<FigureExpressionReading> | undefined;
  if (!reading || !reading.read_status || !['read', 'unreadable', 'no_face', 'ambiguous'].includes(reading.read_status)
    || typeof reading.catalog_version !== 'string' || !reading.catalog_version
    || typeof reading.catalog_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(reading.catalog_sha256)
    || !Array.isArray(reading.faces) || !reading.faces.every(face =>
      face && typeof face.face_id === 'string' && face.parts_mapping && Array.isArray(face.parts_mapping.extras))
    || (reading.target_face_id !== null && !reading.faces.some(face => face.face_id === reading.target_face_id))) {
    throw new Error('人物表情の解析結果形式が正しくありません');
  }
  return {
    read_status: reading.read_status,
    catalog_version: reading.catalog_version, catalog_sha256: reading.catalog_sha256,
    target_face_id: reading.target_face_id ?? null, target_evidence_en: reading.target_evidence_en ?? null,
    faces: reading.faces.map(({ face_id, bbox, confidence, parts_mapping, selected_tags, qwen_image21_prompt_en }: ReadExpressionFace) =>
      ({ face_id, bbox, confidence, parts_mapping, ...(selected_tags && { selected_tags }), qwen_image21_prompt_en })),
  };
}

export interface FigureFaceInput {
  bbox: [number, number, number, number]; // xyxy in the original figure crop
  image?: Blob; // absent when the figure crop is itself the detected face
}

async function figureImagePayload(figure: Blob, face?: FigureFaceInput) {
  return {
    image: await blobDataUrl(figure),
    ...(face && {face_bbox: face.bbox}),
    ...(face?.image && {face_image: await blobDataUrl(face.image)}),
  };
}

/** 明示操作時だけ、保存済みの人物切り抜き1枚をlocalhostのVLMへ渡す。 */
export async function analyzeFigurePerformanceWithLocalVlm(
  blob: Blob,
  currentSize: FigureSize,
  face?: FigureFaceInput,
): Promise<FigurePerformanceSuggestion> {
  const payload = await postJson('/api/figure-performance/analyze', {
    ...await figureImagePayload(blob, face),
    current_size: currentSize,
    vlm_model: currentLocalModelPreferences().vlmModelId,
  }, 650_000) as Record<string, unknown>;
  const figureSizes = new Set<FigureSize>(FIGURE_SIZES);
  const action = typeof payload.action === 'string' ? payload.action.trim() : '';
  const suggestedSize = typeof payload.suggested_size === 'string' && figureSizes.has(payload.suggested_size as FigureSize)
    ? payload.suggested_size as FigureSize
    : currentSize;
  const analysis = payload.analysis && typeof payload.analysis === 'object' && !Array.isArray(payload.analysis)
    ? payload.analysis as Record<string, unknown>
    : null;
  const analyzer = payload.analyzer && typeof payload.analyzer === 'object' && !Array.isArray(payload.analyzer)
    ? payload.analyzer as Record<string, unknown>
    : null;
  if (typeof payload.action !== 'string' || action.length > 800 || !analysis || !analyzer
    || analyzer.provider !== 'local' || analyzer.runtime !== 'mlx-vlm') {
    throw new Error('人物演技の解析結果形式が正しくありません');
  }
  if (!action) expressionReadingFromAnalysis(analysis);
  return {
    action,
    suggestedSize,
    analysis,
    analyzer: {
      provider: 'local',
      runtime: 'mlx-vlm',
      model: typeof analyzer.model === 'string' ? analyzer.model : '',
      promptVersion: typeof analyzer.prompt_version === 'string' ? analyzer.prompt_version : '',
      analyzedAt: typeof analyzer.analyzed_at === 'string' ? analyzer.analyzed_at : '',
    },
  };
}

const CHARACTER_RECOGNITION_FIELDS = ['hair', 'face', 'silhouette', 'outfit', 'accessories', 'ambiguous_design'] as const;

function normalizedEvidence(value: unknown): VisualEvidence {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const strings = (raw: unknown) => Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 16)
    : [];
  return { observed: strings(record.observed), inferred: strings(record.inferred) };
}

/** 明示操作時だけ、保存済みの人物資料1枚をlocalhostのVLMへ渡す。 */
export async function analyzeCharacterReferenceWithLocalVlm(
  blob: Blob,
  targetCharacter: string,
): Promise<CharacterReferenceSuggestion> {
  const payload = await postJson('/api/character-reference/analyze', {
    image: await blobDataUrl(blob),
    target_character: targetCharacter.trim(),
    vlm_model: currentLocalModelPreferences().vlmModelId,
  }, 650_000) as Record<string, unknown>;
  const rawRecognition = payload.recognition && typeof payload.recognition === 'object' && !Array.isArray(payload.recognition)
    ? payload.recognition as Record<string, unknown>
    : null;
  const analyzer = payload.analyzer && typeof payload.analyzer === 'object' && !Array.isArray(payload.analyzer)
    ? payload.analyzer as Record<string, unknown>
    : null;
  const referenceViews = new Set<CharacterReferenceView>(['turnaround', 'front', 'three-quarter', 'side', 'back', 'expression', 'costume', 'other']);
  const referenceView = typeof payload.reference_view === 'string' && referenceViews.has(payload.reference_view as CharacterReferenceView)
    ? payload.reference_view as CharacterReferenceView
    : 'other';
  if (!rawRecognition || !analyzer || analyzer.provider !== 'local' || analyzer.runtime !== 'mlx-vlm') {
    throw new Error('人物資料の照合特徴形式が正しくありません');
  }
  const recognition = Object.fromEntries(
    CHARACTER_RECOGNITION_FIELDS.map((field) => [field, normalizedEvidence(rawRecognition[field])]),
  ) as unknown as CharacterRecognitionProfile;
  const normalizedAnalyzer: LocalVlmAnalyzer = {
    provider: 'local',
    runtime: 'mlx-vlm',
    model: typeof analyzer.model === 'string' ? analyzer.model : '',
    prompt_version: typeof analyzer.prompt_version === 'string' ? analyzer.prompt_version : '',
    analyzed_at: typeof analyzer.analyzed_at === 'string' ? analyzer.analyzed_at : '',
  };
  recognition.analyzer = normalizedAnalyzer;
  return { recognition, analyzer: normalizedAnalyzer, referenceView };
}

/** 登録済みの人物資料群を同時に比較し、安定特徴と各画像の用途を抽出する。 */
export async function analyzeCharacterReferenceSetWithLocalVlm(
  seriesId: string,
  characterCatalogId: string,
  assetIds: readonly string[],
  targetCharacter: string,
): Promise<CharacterReferenceSetSuggestion> {
  const uniqueAssetIds = [...new Set(assetIds)];
  if (!seriesId || !characterCatalogId || !uniqueAssetIds.length || uniqueAssetIds.length > 12
    || uniqueAssetIds.some((assetId) => !/^image-[a-f0-9]{64}$/.test(assetId))) {
    throw new Error('一括解析する人物資料画像が正しくありません');
  }
  const payload = await postJson('/api/character-reference/analyze-set', {
    series_id: seriesId,
    character_catalog_id: characterCatalogId,
    asset_ids: uniqueAssetIds,
    ...(isLanClient ? { images: await Promise.all(uniqueAssetIds.map(async assetId => {
      const blob = await loadCharacterReferenceImage(seriesId, characterCatalogId, assetId);
      if (!blob) throw new Error('一括解析する人物資料画像がこのPCに見つかりません');
      return blobDataUrl(blob);
    })) } : {}),
    target_character: targetCharacter.trim(),
    vlm_model: currentLocalModelPreferences().vlmModelId,
  }, 950_000) as Record<string, unknown>;
  const rawRecognition = payload.recognition && typeof payload.recognition === 'object' && !Array.isArray(payload.recognition)
    ? payload.recognition as Record<string, unknown>
    : null;
  const analyzer = payload.analyzer && typeof payload.analyzer === 'object' && !Array.isArray(payload.analyzer)
    ? payload.analyzer as Record<string, unknown>
    : null;
  const rawViews = Array.isArray(payload.reference_views) ? payload.reference_views : [];
  const referenceViewValues = new Set<CharacterReferenceView>(['turnaround', 'front', 'three-quarter', 'side', 'back', 'expression', 'costume', 'other']);
  const referenceViews = rawViews.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.asset_id !== 'string' || !uniqueAssetIds.includes(record.asset_id)
      || typeof record.view !== 'string' || !referenceViewValues.has(record.view as CharacterReferenceView)) return [];
    const confidence: 'high' | 'medium' | 'low' = record.confidence === 'high' || record.confidence === 'medium' || record.confidence === 'low'
      ? record.confidence
      : 'low';
    return [{ assetId: record.asset_id, referenceView: record.view as CharacterReferenceView, confidence }];
  });
  if (!rawRecognition || !analyzer || analyzer.provider !== 'local' || analyzer.runtime !== 'mlx-vlm'
    || referenceViews.length !== uniqueAssetIds.length
    || new Set(referenceViews.map((entry) => entry.assetId)).size !== uniqueAssetIds.length) {
    throw new Error('人物資料の一括解析結果形式が正しくありません');
  }
  const recognition = Object.fromEntries(
    CHARACTER_RECOGNITION_FIELDS.map((field) => [field, normalizedEvidence(rawRecognition[field])]),
  ) as unknown as CharacterRecognitionProfile;
  const normalizedAnalyzer: LocalVlmAnalyzer = {
    provider: 'local',
    runtime: 'mlx-vlm',
    model: typeof analyzer.model === 'string' ? analyzer.model : '',
    prompt_version: typeof analyzer.prompt_version === 'string' ? analyzer.prompt_version : '',
    analyzed_at: typeof analyzer.analyzed_at === 'string' ? analyzer.analyzed_at : '',
  };
  recognition.analyzer = normalizedAnalyzer;
  return { recognition, analyzer: normalizedAnalyzer, referenceViews };
}

/** 明示操作時だけ、ネームから切り抜いた人物1人をlocalhostのVLMへ渡して登録人物と照合する。 */
export async function analyzeFigureCharacterMatchWithLocalVlm(
  blob: Blob,
  candidates: readonly CharacterMatchCandidate[],
  currentSize: FigureSize,
  face?: FigureFaceInput,
): Promise<CharacterMatchSuggestion> {
  const payload = await postJson('/api/character-match/analyze', {
    ...await figureImagePayload(blob, face),
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      observed_traits: candidate.observedTraits,
    })),
    current_size: currentSize,
    vlm_model: currentLocalModelPreferences().vlmModelId,
  }, 650_000) as Record<string, unknown>;
  const confidenceValues = new Set(['high', 'medium', 'low', 'none']);
  const confidence = typeof payload.confidence === 'string' && confidenceValues.has(payload.confidence)
    ? payload.confidence as CharacterMatchSuggestion['confidence']
    : 'none';
  const analyzer = payload.analyzer && typeof payload.analyzer === 'object' && !Array.isArray(payload.analyzer)
    ? payload.analyzer as Record<string, unknown>
    : null;
  if (!analyzer || analyzer.provider !== 'local' || analyzer.runtime !== 'mlx-vlm') {
    throw new Error('人物照合の解析結果形式が正しくありません');
  }
  const figureSizes = new Set<FigureSize>(FIGURE_SIZES);
  const action = typeof payload.action === 'string' ? payload.action.trim() : '';
  const suggestedSize = typeof payload.suggested_size === 'string' && figureSizes.has(payload.suggested_size as FigureSize)
    ? payload.suggested_size as FigureSize
    : currentSize;
  const analysis = payload.analysis && typeof payload.analysis === 'object' && !Array.isArray(payload.analysis)
    ? payload.analysis as Record<string, unknown>
    : null;
  if (typeof payload.action !== 'string' || action.length > 800 || !analysis) {
    throw new Error('人物演技の解析結果形式が正しくありません');
  }
  const candidateId = typeof payload.candidate_id === 'string' ? payload.candidate_id : '';
  return {
    candidateId: confidence === 'none' ? '' : candidateId,
    confidence,
    observed: Array.isArray(payload.observed)
      ? payload.observed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 12)
      : [],
    reason: typeof payload.reason === 'string' ? payload.reason.trim() : '',
    action,
    suggestedSize,
    analysis,
    expressionReading: expressionReadingFromAnalysis(analysis),
    analyzer: {
      provider: 'local',
      runtime: 'mlx-vlm',
      model: typeof analyzer.model === 'string' ? analyzer.model : '',
      prompt_version: typeof analyzer.prompt_version === 'string' ? analyzer.prompt_version : '',
      analyzed_at: typeof analyzer.analyzed_at === 'string' ? analyzer.analyzed_at : '',
    },
  };
}

export async function suggestPanelFigureActions(
  request: PanelActionSuggestionRequest,
): Promise<PanelActionSuggestionResponse> {
  const mapPanel = (panel: PanelActionSuggestionRequest['currentPanel']) => ({
    page_number: panel.pageNumber,
    panel_id: panel.panelId,
    panel_action: panel.panelAction,
    people: panel.people,
    dialogues: panel.dialogues,
  });
  const payload = await postJson('/api/panel-actions/suggest', {
    action_mode: 'reconcile',
    work: {
      series_title: request.work.seriesTitle,
      subtitle: request.work.subtitle,
      episode_number: request.work.episodeNumber,
      synopsis: request.work.synopsis,
      setting: {
        location: request.work.location,
        time: request.work.time,
        weather: request.work.weather,
      },
    },
    characters: request.characters,
    current_panel: mapPanel(request.currentPanel),
    ...(request.previousPanel ? { previous_panel: mapPanel(request.previousPanel) } : {}),
    ...(request.nextPanel ? { next_panel: mapPanel(request.nextPanel) } : {}),
    figures: request.figures.map((figure) => ({
      id: figure.id,
      name: figure.name,
      description: figure.description,
      current_action: figure.currentAction,
      size: figure.size,
      role: figure.role,
    })),
  }, 180_000) as Record<string, unknown>;
  if (payload.action_mode !== 'reconcile') throw new Error('アクション統合の応答形式が一致しないため変更しませんでした。画面を再読み込みして再実行してください。');
  if (!Array.isArray(payload.actions)) throw new Error('人物アクションの応答形式が正しくありません');
  const knownIds = new Set(request.figures.map((figure) => figure.id));
  const seen = new Set<string>();
  const actions = payload.actions.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('人物アクションの応答形式が正しくありません');
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.action !== 'string') throw new Error('人物アクションの応答形式が正しくありません');
    if (!knownIds.has(item.id) || seen.has(item.id)) throw new Error('人物アクションのIDが入力人物と一致しません');
    const action = item.action.trim();
    if (item.action.length > 4000) throw new Error('統合後のアクションが4000文字を超えています');
    seen.add(item.id);
    return { id: item.id, action };
  });
  if (seen.size !== knownIds.size) throw new Error('対象人物のアクションが不足しています');
  return {
    actions,
    model: typeof payload.model === 'string' ? payload.model : undefined,
  };
}
