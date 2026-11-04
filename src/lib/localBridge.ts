import { PANEL_DRAFT_PROFILE, MANGA_BASE_PALETTE, type PanelDraftPlan } from './panelDraft.ts';
import type {
  FigureSize,
  CharacterRecognitionProfile,
  LocalVlmAnalyzer,
  CharacterReferenceView,
  FigureExpressionReading,
  CharacterReferenceSourceImage,
  ReadExpressionFace,
  VisualEvidence,
  AnalogAssetKind,
  PersistentAnalogAssetRef,
} from '../types';
import { serviceUrl, isLanClient } from './clientRuntime.ts';
import { withNewCreationBridgeSession, withPanelActionServices } from './localBridgeLifecycle.ts';
import {
  LAYOUT_PROTOCOL_VERSION,
  normalizeLayoutRecognition,
  type LayoutRecognitionResult,
  type BridgeLayoutResponse,
} from './recognition/layoutResult.ts';
import { currentLocalModelPreferences, normalizeComfyuiUrl } from './localModelPreferences.ts';
import { decodeImageGenerationConnections } from './modelConnections.ts';
import { currentGenerationPreferences } from './generationPreferences.ts';
import type { HumanPoseCatalog } from './humanPoseTypes.ts';
import { parseHumanPoseCatalog, humanPoseSelectable } from './humanPoseSelection.ts';
import { decodeHumanPoseScene } from './humanPoseSceneAssets.ts';
import { FIGURE_SIZES } from './manga.ts';
import type { CharacterMatchCandidate } from './characterMatching.ts';
import type { PanelActionSuggestionRequest, PanelActionSuggestionResponse } from './panelActions.ts';
import { DEFAULT_PANEL_GUTTERS, type PanelGutterSettings } from './canvasGeometry.ts';
import type { SourceCoverageReport } from './sourceCoverage.ts';
import {
  listBrowserCatalogs,
  loadBrowserCatalog,
  saveBrowserCatalog,
  characterImageCacheId,
} from './browserCatalog.ts';
import { checkCharacterReferenceSize } from './characterReferences.ts';
import type { BackgroundStage } from '../types.ts';
import { verifyBackgroundStage, stageMediaType } from './background3d.ts';
import type { AgentRequest, AgentReply } from './agentChat.ts';

export { DETECTED_FIGURE_NAME } from './bubbleRelations.ts';
export {
  recognizedTextOwnerKey,
  groupRecognizedTextLines,
  normalizeLayoutRecognition,
  type LayoutRecognitionResult,
  type RecognizedTextLine,
  type DetectedFigureRegion,
} from './recognition/layoutResult.ts';
export { ensureDetectedPanelGutters } from './recognition/panelGutters.ts';
export { attachDetectedFiguresToPage, attachRecognizedTextToPage } from './recognition/pageElements.ts';

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';
const REQUEST_TIMEOUT_MS = 210_000;

const BRIDGE_SERVICE_NAME = 'nyamuru-image-hub-local-bridge';
const PANEL_DRAFT_UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PANEL_DRAFT_MAX_PNG_BYTES = 20 * 1024 * 1024;
const GENERATION_CACHE_ID_PATTERN = /^[a-f0-9]{64}$/;

export interface GenerationCacheOwnerSummary {
  kind: 'series' | 'one-shot';
  id: string;
  label: string;
  entryCount: number;
  byteSize: number;
  lastUsedAt: string;
  expiresAt: string | null;
  expired: boolean;
}

export interface GenerationCacheProfileSummary {
  profileId: string;
  label: string;
  entryCount: number;
  byteSize: number;
  owners: GenerationCacheOwnerSummary[];
}

export interface GenerationCacheSummary {
  root: string;
  profiles: GenerationCacheProfileSummary[];
  invalidEntryCount: number;
}

export interface PanelDraftResult {
  imageDataUrl: string;
  promptId: string;
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  status: 'succeeded';
  review: PanelDraftReview;
  artifacts: Record<string, PanelDraftArtifact>;
  auditEvents: PanelDraftAuditEvent[];
  verifiedArtifactSha256: string;
  fileName: string;
  sourceFileName: string;
  subfolder: string;
  profile: typeof PANEL_DRAFT_PROFILE;
  palette: typeof MANGA_BASE_PALETTE;
  checkpoint: string;
  seed: number;
}

export type PanelDraftAttemptStatus = 'created' | 'queued' | 'succeeded' | 'failed' | 'outcome_unknown';
export type PanelDraftReviewDecision = 'unreviewed' | 'accepted' | 'rejected';
export type PanelDraftReviewAction = Exclude<PanelDraftReviewDecision, 'unreviewed'>;

export interface PanelDraftArtifact {
  sha256: string;
  byteSize: number;
  mediaType: string;
  workspaceRelativePath: string;
}

export interface PanelDraftReview {
  decision: PanelDraftReviewDecision;
  note: string;
  reviewedAt: string | null;
  revision: number;
  reviewEventId: number | null;
  requestNonce: string | null;
  artifactSha256: string | null;
}

export interface PanelDraftAuditEvent {
  eventId: number;
  status: PanelDraftAttemptStatus;
  recordedAt: string;
  detail: Record<string, unknown>;
  errorMessage: string;
  provenanceSha256: string;
  provenance: PanelDraftArtifact;
  provenanceVerified: true;
}

export interface PanelDraftAttemptSummary {
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  retryOfAttemptId: string | null;
  promptId: string;
  status: PanelDraftAttemptStatus;
  pageNumber: number;
  panelId: number;
  createdAt: string;
  submittedAt: string | null;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
  review: PanelDraftReview;
  artifacts: Record<string, PanelDraftArtifact>;
  auditEvents: PanelDraftAuditEvent[];
}

export interface PanelDraftGenerationContext {
  workspaceToken: string;
  seriesId: string;
  episodeId: string;
  omnySnapshot: string;
  jobId: string;
  attemptId: string;
  retryOfAttemptId?: string;
}

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

export interface SavedCharacterReferenceImage {
  sourceImage: CharacterReferenceSourceImage;
  /** この要求で新しく作られた場合だけtrue。中断時の安全な整理に使う。 */
  created: boolean;
}

export interface ScannerSession {
  id: string;
  startedAt: string;
  expiresInSeconds: number;
  maxFiles: number;
  directory: string;
}

export interface ScannedImage {
  id: string;
  file: File;
  modifiedAt: string;
}

export interface ScannerCollection {
  files: ScannedImage[];
  complete: boolean;
  remainingSeconds: number;
  total: number;
}

export interface PendingScannerSession {
  startedAt: string;
  directory: string;
  count: number;
}

export interface EpisodeWorkspace {
  token: string;
  directory: string;
  folderName: string;
  seriesDirectory: string;
}

export interface EpisodeWorkspaceTextSelection {
  file: File;
  relativePath: string | null;
  byteSize: number;
  sha256: string;
}

export interface SourceCoverageSaveResult {
  relativePath: string;
  sha256: string;
  byteSize: number;
  created: boolean;
}

export interface ReferenceTextSuggestion {
  relativePath: string;
  fileName: string;
  text: string;
  selectedBy: 'rules' | 'local-llm';
  confidence: 'high' | 'medium';
}

export interface ReferenceTextSuggestionResult {
  candidateCount: number;
  ambiguous: boolean;
  suggestion: ReferenceTextSuggestion | null;
}

export interface SeriesReferenceTextCandidate {
  relativePath: string;
  fileName: string;
  text: string;
  kind: 'characters' | 'series-setting' | 'series-reference';
  confidence: 'high' | 'medium';
  recommended: boolean;
}

export interface SeriesDirectorySelection extends ReferenceTextSuggestionResult {
  seriesDirectory: string;
  candidates: SeriesReferenceTextCandidate[];
}

export interface ResumedScannerSession {
  session: ScannerSession;
  files: ScannedImage[];
}

export function isLoopbackBridgeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:'
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && (parsed.pathname === '' || parsed.pathname === '/')
      && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function bridgeUrl(path: string): string {
  const gateway = serviceUrl('bridge', path);
  if (gateway) return gateway;
  const configured = import.meta.env?.PUBLIC_NYAMURU_BRIDGE_URL?.trim();
  const base = configured || DEFAULT_BRIDGE_URL;
  if (!isLoopbackBridgeUrl(base)) {
    throw new Error('ローカルbridge URLはloopbackのHTTP URLだけを使用できます');
  }
  if (!path.startsWith('/')) throw new Error('ローカルbridgeのpathが正しくありません');
  return `${base.replace(/\/$/, '')}${path}`;
}

async function imageDataUrl(file: File): Promise<string> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      const longest = Math.max(bitmap.width, bitmap.height);
      const scale = Math.min(1, 1800 / Math.max(longest, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('画像変換用キャンバスを作成できませんでした');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return canvas.toDataURL('image/jpeg', 0.94);
    } catch {
      // HEICなどブラウザで展開できない形式は、元データをbridgeへ渡してPillow側で試す。
    }
  }

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('画像を読み込めませんでした'));
    reader.onerror = () => reject(new Error('画像を読み込めませんでした'));
    reader.readAsDataURL(file);
  });
}

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('原画参照画像を読み込めませんでした'));
    reader.onerror = () => reject(new Error('原画参照画像を読み込めませんでした'));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlBlob(value: unknown): Blob | null {
  if (typeof value !== 'string' || !value.startsWith('data:image/') || !value.includes(',')) return null;
  const [header, encoded] = value.split(',', 2);
  const mimeType = header.slice(5).split(';', 1)[0] || 'image/png';
  try {
    const binary = window.atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
  } catch {
    return null;
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

async function verifiedPngSha256(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < PNG_SIGNATURE.length
    || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error('保存済みの人物資料画像がPNG形式ではありません');
  }
  if (!globalThis.crypto?.subtle) throw new Error('人物資料画像の整合性を確認できません');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function postJson(path: string, body: object, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  if (isLanClient) return withNewCreationBridgeSession(() => postBridgeJson(path, body, timeoutMs));
  return postBridgeJson(path, body, timeoutMs);
}

/** The local helper returns a native .clip; no project save is performed. */
export async function requestClipExport(page:import('./clipExport.ts').ClipExportPage):Promise<Blob> {
  return withNewCreationBridgeSession(async()=>{
    const value=await postBridgeJson('/api/export/clip',page,270_000) as Record<string,unknown>;
    if(value.profile!=='nyamuru-clip-v1'||typeof value.clip_data!=='string')throw new Error('CLIP書き出しの応答を確認できませんでした');
    const binary=atob(value.clip_data);
    if(!binary.startsWith('CSFCHUNK')||binary.length!==value.byte_length)throw new Error('CLIP書き出しデータが不完全です');
    return new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:'application/octet-stream'});
  });
}

async function postBridgeJson(path: string, body: object, timeoutMs: number): Promise<unknown> {
  await verifyBridgeIdentity(Math.min(timeoutMs, 10_000));
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(bridgeUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as { error?: unknown; service?: unknown; layout_protocol_version?: unknown };
    if (!response.ok) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `ローカル連携に失敗しました（HTTP ${response.status}）`);
    }
    if (payload.service !== BRIDGE_SERVICE_NAME || payload.layout_protocol_version !== LAYOUT_PROTOCOL_VERSION) {
      throw new Error('ローカルbridgeが古いか別のアプリです。起動中のbridgeを停止し、このリポジトリで npm run bridge を再起動してください。');
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('ローカル処理の応答が時間内に返りませんでした');
    }
    if (error instanceof TypeError) {
      throw new Error('ローカル連携が起動していません。ターミナルで npm run bridge を実行してください。');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function getImageGenerationConnections(comfyuiUrl = currentLocalModelPreferences().comfyuiUrl, checkComfyui = false) {
  const endpoint = normalizeComfyuiUrl(comfyuiUrl);
  return withNewCreationBridgeSession(async () => decodeImageGenerationConnections(await postBridgeJson('/api/image-generation/connections', {
    comfyui_url: endpoint, check_comfyui: checkComfyui, workflow_id: currentGenerationPreferences().local.workflowId,
  }, 15_000)));
}

/** Verify the selected definition without creating another device setting. */
export async function connectAgentImageGeneration(isCurrent: () => boolean = () => true) {
  if (!currentGenerationPreferences().local.workflowId) throw new Error('環境設定 → モデルで、使用するComfyUIワークフローを選んでください');
  const result = await getImageGenerationConnections(undefined, true);
  if (!isCurrent()) throw new Error('接続を中止しました');
  if (!result.workflow?.available) throw new Error(result.workflow?.message || result.comfyui.message);
  return result;
}

export function requestComfyWorkflows(action: 'list' | 'save' | 'delete' | 'check' | 'info', body: object = {}): Promise<unknown> {
  return withNewCreationBridgeSession(() => postBridgeJson(`/api/comfy-workflows/${action}`, body, 30_000));
}

/** 一度検証したsnapshotから一覧とPNGを読み、原本に変更があれば表示しない。 */
export async function loadHumanPoseCatalog(): Promise<HumanPoseCatalog> {
  const payload = await postJson('/api/human-pose/catalog', {}) as Record<string, unknown>;
  const catalog = parseHumanPoseCatalog(payload);
  const previews: Record<string, string> = {};
  if (!payload.previews || typeof payload.previews !== 'object' || Array.isArray(payload.previews)) {
    throw new Error('人体ポーズの一覧画像がありません');
  }
  const received = payload.previews as Record<string, unknown>;
  await Promise.all(catalog.poses.filter(humanPoseSelectable).map(async pose => {
    const encoded = received[pose.id], record = pose.asset_files.preview!;
    if (typeof encoded !== 'string' || encoded.length > 12 * 1024 * 1024) throw new Error('人体ポーズの一覧画像が不正です');
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    if (bytes.length !== record.byte_size || await verifiedPngSha256(blob) !== record.sha256) {
      throw new Error('人体ポーズの一覧画像とカタログが一致しません');
    }
    previews[pose.id] = `data:image/png;base64,${encoded}`;
  }));
  return { ...catalog, previews };
}

export async function loadHumanPoseScene(poseId: string, catalogSha256: string, bodyModel?: import('./humanPoseTypes.ts').HumanPoseBodyModel) {
  const payload = await postJson('/api/human-pose/scene', { pose_id: poseId, catalog_sha256: catalogSha256, include_base: false, ...(bodyModel ? { body_model: bodyModel } : {}) });
  return decodeHumanPoseScene(payload, poseId, catalogSha256, bodyModel);
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

function panelDraftArtifacts(value: unknown): Record<string, PanelDraftArtifact> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([role, raw]) => {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(role) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const artifact = raw as Record<string, unknown>;
    const sha256 = typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/.test(artifact.sha256) ? artifact.sha256 : '';
    const byteSize = Number(artifact.byte_size);
    const mediaType = typeof artifact.media_type === 'string' ? artifact.media_type : '';
    const workspaceRelativePath = typeof artifact.workspace_relative_path === 'string' ? artifact.workspace_relative_path : '';
    if (!sha256 || !Number.isSafeInteger(byteSize) || byteSize < 1 || !mediaType
      || !workspaceRelativePath || workspaceRelativePath.startsWith('/') || workspaceRelativePath.includes('\\')
      || workspaceRelativePath.split('/').includes('..')) return [];
    return [[role, { sha256, byteSize, mediaType, workspaceRelativePath } satisfies PanelDraftArtifact]];
  }));
}

function panelDraftReview(value: unknown): PanelDraftReview {
  const review = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (review.decision !== 'unreviewed' && review.decision !== 'accepted' && review.decision !== 'rejected') {
    throw new Error('制作reviewの形式が正しくありません');
  }
  const decision = review.decision;
  const revision = Number(review.revision ?? 0);
  const reviewEventId = review.review_event_id === null || review.review_event_id === undefined
    ? null : Number(review.review_event_id);
  const requestNonce = typeof review.request_nonce === 'string' && PANEL_DRAFT_UUID_PATTERN.test(review.request_nonce)
    ? review.request_nonce : null;
  const artifactSha256 = typeof review.artifact_sha256 === 'string' && /^[a-f0-9]{64}$/.test(review.artifact_sha256)
    ? review.artifact_sha256 : null;
  if (!Number.isSafeInteger(revision) || revision < 0
    || (decision === 'unreviewed' && (revision !== 0 || reviewEventId !== null || requestNonce !== null || artifactSha256 !== null))
    || (decision !== 'unreviewed' && (revision < 1 || reviewEventId === null || !Number.isSafeInteger(reviewEventId) || reviewEventId < 1
      || !requestNonce || !artifactSha256 || typeof review.reviewed_at !== 'string' || !review.reviewed_at))) {
    throw new Error('制作reviewの形式が正しくありません');
  }
  return {
    decision,
    note: typeof review.note === 'string' ? review.note.slice(0, 2000) : '',
    reviewedAt: typeof review.reviewed_at === 'string' ? review.reviewed_at : null,
    revision,
    reviewEventId,
    requestNonce,
    artifactSha256,
  };
}

function panelDraftAuditEvents(value: unknown): PanelDraftAuditEvent[] {
  if (!Array.isArray(value)) throw new Error('制作audit履歴を読み取れませんでした');
  const statusValues = new Set<PanelDraftAttemptStatus>(['created', 'queued', 'succeeded', 'failed', 'outcome_unknown']);
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('制作audit eventの形式が正しくありません');
    const event = raw as Record<string, unknown>;
    const eventId = Number(event.event_id);
    const status = typeof event.status === 'string' && statusValues.has(event.status as PanelDraftAttemptStatus)
      ? event.status as PanelDraftAttemptStatus : null;
    const provenanceSha256 = typeof event.provenance_sha256 === 'string' && /^[a-f0-9]{64}$/.test(event.provenance_sha256)
      ? event.provenance_sha256 : '';
    const provenance = panelDraftArtifacts({ provenance: event.provenance }).provenance;
    const detail = event.detail && typeof event.detail === 'object' && !Array.isArray(event.detail)
      ? event.detail as Record<string, unknown> : null;
    if (!Number.isSafeInteger(eventId) || eventId < 1 || !status
      || typeof event.recorded_at !== 'string' || !event.recorded_at
      || typeof event.error_message !== 'string' || !provenanceSha256 || !provenance
      || provenance.sha256 !== provenanceSha256 || event.provenance_verified !== true || !detail) {
      throw new Error('制作audit eventの形式が正しくありません');
    }
    return {
      eventId,
      status,
      recordedAt: event.recorded_at,
      detail,
      errorMessage: event.error_message,
      provenanceSha256,
      provenance,
      provenanceVerified: true,
    };
  });
}

function panelDraftAttempt(value: unknown): PanelDraftAttemptSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('制作attemptを読み取れませんでした');
  const attempt = value as Record<string, unknown>;
  const statusValues = new Set<PanelDraftAttemptStatus>(['created', 'queued', 'succeeded', 'failed', 'outcome_unknown']);
  const status = typeof attempt.status === 'string' && statusValues.has(attempt.status as PanelDraftAttemptStatus)
    ? attempt.status as PanelDraftAttemptStatus : null;
  const jobId = typeof attempt.job_id === 'string' && PANEL_DRAFT_UUID_PATTERN.test(attempt.job_id) ? attempt.job_id : '';
  const attemptId = typeof attempt.attempt_id === 'string' && PANEL_DRAFT_UUID_PATTERN.test(attempt.attempt_id) ? attempt.attempt_id : '';
  const promptId = typeof attempt.prompt_id === 'string' ? attempt.prompt_id : '';
  const attemptNumber = Number(attempt.attempt_number);
  const pageNumber = Number(attempt.page_number);
  const panelId = Number(attempt.panel_id);
  if (!jobId || !attemptId || promptId !== attemptId || !status
    || !Number.isSafeInteger(attemptNumber) || attemptNumber < 1
    || !Number.isSafeInteger(pageNumber) || pageNumber < 1
    || !Number.isSafeInteger(panelId) || panelId < 1) {
    throw new Error('制作attemptの形式が正しくありません');
  }
  const errorValue = attempt.error && typeof attempt.error === 'object' && !Array.isArray(attempt.error)
    ? attempt.error as Record<string, unknown> : null;
  const auditEvents = panelDraftAuditEvents(attempt.audit_events);
  if (!auditEvents.length || auditEvents[auditEvents.length - 1].status !== status
    || auditEvents.some((event, index) => index > 0 && event.eventId <= auditEvents[index - 1].eventId)) {
    throw new Error('制作audit履歴がattemptの最新状態と一致しません');
  }
  return {
    jobId,
    attemptId,
    attemptNumber,
    retryOfAttemptId: typeof attempt.retry_of_attempt_id === 'string' && PANEL_DRAFT_UUID_PATTERN.test(attempt.retry_of_attempt_id)
      ? attempt.retry_of_attempt_id : null,
    promptId,
    status,
    pageNumber,
    panelId,
    createdAt: typeof attempt.created_at === 'string' ? attempt.created_at : '',
    submittedAt: typeof attempt.submitted_at === 'string' ? attempt.submitted_at : null,
    finishedAt: typeof attempt.finished_at === 'string' ? attempt.finished_at : null,
    error: errorValue && typeof errorValue.code === 'string' && typeof errorValue.message === 'string'
      ? { code: errorValue.code, message: errorValue.message } : null,
    review: panelDraftReview(attempt.review),
    artifacts: panelDraftArtifacts(attempt.artifacts),
    auditEvents,
  };
}

async function verifiedPanelDraftDataUrl(value: unknown, artifact: PanelDraftArtifact): Promise<string> {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) {
    throw new Error('ComfyUIの生成画像を読み取れませんでした');
  }
  const encoded = value.slice('data:image/png;base64,'.length);
  if (artifact.byteSize > PANEL_DRAFT_MAX_PNG_BYTES
    || encoded.length > Math.ceil(PANEL_DRAFT_MAX_PNG_BYTES / 3) * 4
    || !encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('作画用4値画像のbase64が正しくありません');
  }
  let binary: string;
  try {
    binary = globalThis.atob(encoded);
  } catch {
    throw new Error('作画用4値画像のbase64をdecodeできません');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.length !== artifact.byteSize
    || bytes.length < PNG_SIGNATURE.length
    || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('作画用4値画像のサイズまたはPNG signatureがartifact台帳と一致しません');
  }
  if (!globalThis.crypto?.subtle) throw new Error('作画用4値画像のSHA-256を確認できません');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (sha256 !== artifact.sha256) throw new Error('作画用4値画像のSHA-256がartifact台帳と一致しません');
  return value;
}

async function panelDraftResult(payload: Record<string, unknown>, plan?: PanelDraftPlan): Promise<PanelDraftResult> {
  if (typeof payload.image !== 'string' || !/^data:image\/png;base64,/.test(payload.image)) {
    throw new Error('ComfyUIの生成画像を読み取れませんでした');
  }
  const jobId = typeof payload.job_id === 'string' && PANEL_DRAFT_UUID_PATTERN.test(payload.job_id) ? payload.job_id : '';
  const attemptId = typeof payload.attempt_id === 'string' && PANEL_DRAFT_UUID_PATTERN.test(payload.attempt_id) ? payload.attempt_id : '';
  if (!jobId || !attemptId || payload.prompt_id !== attemptId) throw new Error('制作jobまたはattempt IDを読み取れませんでした');
  const attemptNumber = Number(payload.attempt_number);
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1 || payload.status !== 'succeeded') {
    throw new Error('制作attemptの完了状態を読み取れませんでした');
  }
  if (typeof payload.file_name !== 'string' || !payload.file_name.trim()) {
    throw new Error('ComfyUIの生成ファイル名を読み取れませんでした');
  }
  if (typeof payload.download_name !== 'string' || !/^manga-base_[A-Za-z0-9_.-]+\.png$/.test(payload.download_name)) {
    throw new Error('作画用4値画像の保存名を読み取れませんでした');
  }
  const palette = payload.palette as Record<string, unknown> | undefined;
  const checkpoint = typeof payload.checkpoint === 'string' ? payload.checkpoint : '';
  const seed = Number(payload.seed);
  const hasMangaBasePalette = palette?.ink === MANGA_BASE_PALETTE.ink
    && palette?.dense_tone === MANGA_BASE_PALETTE.denseTone
    && palette?.light_tone === MANGA_BASE_PALETTE.lightTone
    && palette?.paper === MANGA_BASE_PALETTE.paper;
  if (typeof payload.subfolder !== 'string' || (plan && payload.profile !== plan.profile) || !hasMangaBasePalette
    || !checkpoint || (plan && checkpoint !== plan.checkpoint)
    || !Number.isSafeInteger(seed) || (plan && seed !== plan.seed)) {
    throw new Error('ComfyUIの生成結果形式が正しくありません');
  }
  const artifacts = panelDraftArtifacts(payload.artifacts);
  if (!artifacts.manga_base_composite || artifacts.manga_base_composite.mediaType !== 'image/png') {
    throw new Error('自動保存した作画用4値artifactを読み取れませんでした');
  }
  const imageDataUrl = await verifiedPanelDraftDataUrl(payload.image, artifacts.manga_base_composite);
  return {
    imageDataUrl,
    promptId: attemptId,
    jobId,
    attemptId,
    attemptNumber,
    status: 'succeeded',
    review: panelDraftReview(payload.review),
    artifacts,
    auditEvents: panelDraftAuditEvents(payload.audit_events),
    verifiedArtifactSha256: artifacts.manga_base_composite.sha256,
    fileName: payload.download_name,
    sourceFileName: payload.file_name,
    subfolder: payload.subfolder,
    profile: PANEL_DRAFT_PROFILE,
    palette: MANGA_BASE_PALETTE,
    checkpoint,
    seed,
  };
}

/** 確認済みの1コマ計画をComfyUIへ明示submitし、episode台帳へ自動保存する。 */
export async function generatePanelDraftWithComfyUI(
  plan: PanelDraftPlan,
  context: PanelDraftGenerationContext,
): Promise<PanelDraftResult> {
  const payload = await postJson('/api/panel-draft/generate', {
    workspace_token: context.workspaceToken,
    job_id: context.jobId,
    attempt_id: context.attemptId,
    retry_of_attempt_id: context.retryOfAttemptId ?? null,
    series_id: context.seriesId,
    episode_id: context.episodeId,
    omny_snapshot: context.omnySnapshot,
    page_number: plan.pageNumber,
    panel_id: plan.panelId,
    profile: plan.profile,
    positive_prompt: plan.positivePrompt,
    negative_prompt: plan.negativePrompt,
    checkpoint: plan.checkpoint,
    width: plan.width,
    height: plan.height,
    steps: plan.steps,
    cfg: plan.cfg,
    seed: plan.seed,
  }, 420_000) as Record<string, unknown>;
  return await panelDraftResult(payload, plan);
}

export async function listPanelDraftAttempts(
  workspaceToken: string,
  pageNumber: number,
  panelId: number,
): Promise<PanelDraftAttemptSummary[]> {
  const payload = await postJson('/api/panel-draft/list', {
    workspace_token: workspaceToken, page_number: pageNumber, panel_id: panelId,
  }, 30_000) as Record<string, unknown>;
  if (!Array.isArray(payload.attempts)) throw new Error('制作履歴を読み取れませんでした');
  return payload.attempts.map(panelDraftAttempt);
}

function generationCacheCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function generationCacheDate(value: unknown) {
  return typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value)) ? value : null;
}

export function decodeGenerationCacheSummary(input: unknown): GenerationCacheSummary {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('生成キャッシュの応答形式が不正です');
  const payload = input as Record<string, unknown>;
  const invalidEntryCount = generationCacheCount(payload.invalid_entry_count);
  if (typeof payload.root !== 'string' || !payload.root || payload.root.length > 4096
    || !Array.isArray(payload.profiles) || invalidEntryCount === null) {
    throw new Error('生成キャッシュの一覧を確認できません');
  }
  const profiles = payload.profiles.map(rawProfile => {
    if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) throw new Error('生成モデル設定の応答形式が不正です');
    const profile = rawProfile as Record<string, unknown>;
    const entryCount = generationCacheCount(profile.entry_count);
    const byteSize = generationCacheCount(profile.byte_size);
    if (typeof profile.profile_id !== 'string' || !GENERATION_CACHE_ID_PATTERN.test(profile.profile_id)
      || typeof profile.label !== 'string' || !profile.label.trim() || profile.label.length > 500
      || entryCount === null || byteSize === null || !Array.isArray(profile.owners)) {
      throw new Error('生成モデル設定の一覧を確認できません');
    }
    const owners = profile.owners.map(rawOwner => {
      if (!rawOwner || typeof rawOwner !== 'object' || Array.isArray(rawOwner)) throw new Error('作品キャッシュの応答形式が不正です');
      const owner = rawOwner as Record<string, unknown>;
      const ownerEntryCount = generationCacheCount(owner.entry_count);
      const ownerByteSize = generationCacheCount(owner.byte_size);
      const lastUsedAt = generationCacheDate(owner.last_used_at);
      const expiresAt = owner.expires_at === null ? null : generationCacheDate(owner.expires_at);
      if (!['series', 'one-shot'].includes(String(owner.kind)) || typeof owner.id !== 'string'
        || !/^[^\u0000-\u001f\u007f]{1,200}$/u.test(owner.id) || !owner.id.trim()
        || typeof owner.label !== 'string' || !owner.label.trim() || owner.label.length > 500
        || ownerEntryCount === null || ownerByteSize === null || !lastUsedAt
        || typeof owner.expired !== 'boolean'
        || (owner.kind === 'series' && (expiresAt !== null || owner.expired))
        || (owner.kind === 'one-shot' && expiresAt === null)) {
        throw new Error('作品キャッシュの一覧を確認できません');
      }
      return {
        kind: owner.kind as GenerationCacheOwnerSummary['kind'], id: owner.id, label: owner.label,
        entryCount: ownerEntryCount, byteSize: ownerByteSize, lastUsedAt, expiresAt, expired: owner.expired,
      };
    });
    if (owners.reduce((sum, owner) => sum + owner.entryCount, 0) !== entryCount
      || owners.reduce((sum, owner) => sum + owner.byteSize, 0) !== byteSize) {
      throw new Error('生成モデル設定の集計が一致しません');
    }
    return { profileId: profile.profile_id, label: profile.label, entryCount, byteSize, owners };
  });
  return { root: payload.root, profiles, invalidEntryCount };
}

export async function listGenerationCaches() {
  return decodeGenerationCacheSummary(await postJson('/api/layer-generation/cache/list', {}, 30_000));
}

export async function deleteGenerationCache(target:
  | { scope: 'owner'; ownerKind: GenerationCacheOwnerSummary['kind']; ownerId: string }
  | { scope: 'profile'; profileId: string }) {
  const body = target.scope === 'owner'
    ? { scope: target.scope, owner_kind: target.ownerKind, owner_id: target.ownerId }
    : { scope: target.scope, profile_id: target.profileId };
  const payload = await postJson('/api/layer-generation/cache/delete', body, 30_000) as Record<string, unknown>;
  if (!payload || payload.ok !== true || typeof payload.deleted !== 'boolean') throw new Error('生成キャッシュの削除結果を確認できません');
  return { deleted: payload.deleted, summary: decodeGenerationCacheSummary(payload.summary) };
}

export async function reconcilePanelDraftAttempt(
  workspaceToken: string,
  attemptId: string,
): Promise<PanelDraftResult | PanelDraftAttemptSummary> {
  const payload = await postJson('/api/panel-draft/reconcile', {
    workspace_token: workspaceToken, attempt_id: attemptId,
  }, 60_000) as Record<string, unknown>;
  return typeof payload.image === 'string' ? await panelDraftResult(payload) : panelDraftAttempt(payload.attempt);
}

export async function reviewPanelDraftAttempt(
  workspaceToken: string,
  attemptId: string,
  decision: PanelDraftReviewAction,
  expectedRevision: number,
  artifactSha256: string,
  requestNonce: string,
  note = '',
): Promise<PanelDraftAttemptSummary> {
  const payload = await postJson('/api/panel-draft/review', {
    workspace_token: workspaceToken,
    attempt_id: attemptId,
    decision,
    expected_revision: expectedRevision,
    artifact_sha256: artifactSha256,
    request_nonce: requestNonce,
    note,
  }, 30_000) as Record<string, unknown>;
  const reviewed = panelDraftAttempt(payload.attempt);
  if (reviewed.attemptId !== attemptId
    || reviewed.review.requestNonce !== requestNonce
    || reviewed.review.artifactSha256 !== artifactSha256
    || reviewed.review.revision !== expectedRevision + 1
    || reviewed.review.decision !== decision) {
    throw new Error('review応答が要求したattempt・nonce・revisionと一致しません');
  }
  return reviewed;
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


async function verifyBridgeIdentity(timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(bridgeUrl('/api/health'), {
      method: 'GET',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: unknown;
      service?: unknown;
      layout_protocol_version?: unknown;
    };
    if (!response.ok) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `ローカル連携に失敗しました（HTTP ${response.status}）`);
    }
    if (payload.service !== BRIDGE_SERVICE_NAME || payload.layout_protocol_version !== LAYOUT_PROTOCOL_VERSION) {
      throw new Error('ローカルbridgeが古いか別のアプリです。起動中のbridgeを停止し、このリポジトリで npm run bridge を再起動してください。');
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('ローカルbridgeの確認が時間内に完了しませんでした');
    }
    if (error instanceof TypeError) {
      throw new Error('ローカル連携が起動していません。ターミナルで npm run bridge を実行してください。');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function recognizePanelLayout(
  file: File,
  rotationOverride: 0 | 90 | 180 | 270,
  gutterSettings: PanelGutterSettings = DEFAULT_PANEL_GUTTERS,
): Promise<LayoutRecognitionResult> {
  const payload = await postJson('/api/layout/analyze', {
    filename: file.name,
    image: await imageDataUrl(file),
    rotation_override_degrees: rotationOverride,
  }) as BridgeLayoutResponse;
  return normalizeLayoutRecognition(payload, gutterSettings);
}

function dataUrlFile(dataUrl: unknown, filename: unknown): File {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || !dataUrl.includes(',')) {
    throw new Error('スキャン画像の形式が正しくありません');
  }
  const [header, encoded] = dataUrl.split(',', 2);
  const mimeType = header.slice(5).split(';', 1)[0] || 'image/jpeg';
  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const safeName = typeof filename === 'string' && filename.trim() ? filename.trim() : 'scan.jpg';
  return new File([bytes], safeName, { type: mimeType });
}

export async function selectEpisodeWorkspace(defaultDirectory = ''): Promise<EpisodeWorkspace | null> {
  const payload = await postJson('/api/episode-workspace/select', {
    default_directory: defaultDirectory,
  }, 5 * 60_000) as Record<string, unknown>;
  if (payload.cancelled === true) return null;
  const token = typeof payload.workspace_token === 'string' ? payload.workspace_token : '';
  const directory = typeof payload.directory === 'string' ? payload.directory : '';
  const folderName = typeof payload.folder_name === 'string' ? payload.folder_name : '';
  const seriesDirectory = typeof payload.series_directory === 'string' ? payload.series_directory : '';
  if (!token || !directory || !folderName || !seriesDirectory) {
    throw new Error('エピソード保存先を受け取れませんでした');
  }
  return { token, directory, folderName, seriesDirectory };
}

export async function saveEpisodeProject(token: string, snapshot: unknown, expectedRevision: string | null): Promise<string> {
  const payload = await postJson('/api/episode-workspace/project/save', {
    workspace_token: token, snapshot, expected_revision: expectedRevision,
  }) as Record<string, unknown>;
  if (typeof payload.revision !== 'string') throw new Error('作品の保存結果を確認できませんでした');
  return payload.revision;
}

export async function loadEpisodeProject(token: string): Promise<{ snapshot: unknown; revision: string }> {
  const payload = await postJson('/api/episode-workspace/project/load', { workspace_token: token }) as Record<string, unknown>;
  if (typeof payload.revision !== 'string') throw new Error('作品の読み込み結果を確認できませんでした');
  return { snapshot: payload.snapshot, revision: payload.revision };
}

function referenceTextSuggestionResult(payload: Record<string, unknown>): ReferenceTextSuggestionResult {
  const candidateCount = Math.max(0, Number(payload.candidate_count) || 0);
  const rawSuggestion = payload.suggestion;
  if (!rawSuggestion || typeof rawSuggestion !== 'object') {
    return { candidateCount, ambiguous: payload.ambiguous === true, suggestion: null };
  }
  const suggestion = rawSuggestion as Record<string, unknown>;
  const relativePath = typeof suggestion.relative_path === 'string' ? suggestion.relative_path : '';
  const fileName = typeof suggestion.file_name === 'string' ? suggestion.file_name : '';
  const text = typeof suggestion.text === 'string' ? suggestion.text : '';
  const selectedBy = suggestion.selected_by === 'local-llm' ? 'local-llm' : 'rules';
  const confidence = suggestion.confidence === 'high' ? 'high' : 'medium';
  if (!relativePath || !fileName) return { candidateCount, ambiguous: true, suggestion: null };
  return { candidateCount, ambiguous: false, suggestion: { relativePath, fileName, text, selectedBy, confidence } };
}

export async function chooseSeriesDirectory(defaultDirectory = ''): Promise<SeriesDirectorySelection | null> {
  const payload = await postJson('/api/series/directory/choose', {
    default_directory: defaultDirectory,
  }, 5 * 60_000) as Record<string, unknown>;
  if (payload.cancelled === true) return null;
  const seriesDirectory = typeof payload.series_directory === 'string' ? payload.series_directory : '';
  if (!seriesDirectory) throw new Error('シリーズフォルダを受け取れませんでした');
  const reference = (payload.reference ?? {}) as Record<string, unknown>;
  const candidates: SeriesReferenceTextCandidate[] = Array.isArray(reference.candidates) ? reference.candidates.flatMap<SeriesReferenceTextCandidate>((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const relativePath = typeof item.relative_path === 'string' ? item.relative_path : '';
    const fileName = typeof item.file_name === 'string' ? item.file_name : '';
    const text = typeof item.text === 'string' ? item.text : '';
    const kind = item.kind === 'characters' || item.kind === 'series-setting' ? item.kind : 'series-reference';
    const confidence = item.confidence === 'high' ? 'high' : 'medium';
    if (!relativePath || !fileName) return [];
    return [{ relativePath, fileName, text, kind, confidence, recommended: item.recommended === true }];
  }) : [];
  return { seriesDirectory, candidates, ...referenceTextSuggestionResult(reference) };
}

export async function suggestEpisodeWorkspaceText(token: string): Promise<ReferenceTextSuggestionResult> {
  const payload = await postJson('/api/episode-workspace/reference-suggest', {
    workspace_token: token,
  }, 15_000) as Record<string, unknown>;
  return referenceTextSuggestionResult(payload);
}

export async function prepareEpisodeWorkspace(token: string): Promise<string[]> {
  const payload = await postJson('/api/episode-workspace/prepare', {
    workspace_token: token,
  }, 15_000) as Record<string, unknown>;
  if (payload.ok !== true || !Array.isArray(payload.managed_directories)
    || payload.managed_directories.some((entry) => typeof entry !== 'string')) {
    throw new Error('制作フォルダを準備できませんでした');
  }
  return payload.managed_directories as string[];
}

export async function chooseEpisodeWorkspaceSource(token: string): Promise<EpisodeWorkspaceTextSelection | null> {
  const payload = await postJson('/api/episode-workspace/choose-text', {
    workspace_token: token,
  }, 5 * 60_000) as Record<string, unknown>;
  if (payload.cancelled === true) return null;
  const byteSize = Number(payload.byte_size);
  const relativePath = payload.relative_path;
  if (typeof payload.filename !== 'string' || !payload.filename.trim() || /[\\/\0]/u.test(payload.filename)
    || typeof payload.text !== 'string'
    || !Number.isInteger(byteSize) || byteSize < 0 || byteSize > 5 * 1024 * 1024
    || typeof payload.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(payload.sha256)
    || (relativePath !== null && (typeof relativePath !== 'string' || !relativePath
      || relativePath.startsWith('/') || relativePath.includes('\\')
      || relativePath.split('/').some((part) => !part || part === '.' || part === '..')))) {
    throw new Error('選択した文章を読み込めませんでした');
  }
  const lowerName = payload.filename.toLowerCase();
  const mediaType = lowerName.endsWith('.md') || lowerName.endsWith('.markdown') ? 'text/markdown' : 'text/plain';
  return {
    file: new File([payload.text], payload.filename, { type: mediaType }),
    relativePath: relativePath as string | null,
    byteSize,
    sha256: payload.sha256,
  };
}

/** 従来の呼び出しとの互換用。source identityが必要な新規処理は上のAPIを使う。 */
export async function chooseEpisodeWorkspaceText(token: string): Promise<File | null> {
  return (await chooseEpisodeWorkspaceSource(token))?.file ?? null;
}

export async function saveSourceCoverageReport(
  token: string,
  episodeId: string,
  report: SourceCoverageReport,
): Promise<SourceCoverageSaveResult> {
  if (!episodeId.trim()) throw new Error('coverage reportのエピソードIDがありません');
  const payload = await postJson('/api/episode-workspace/source-coverage/save', {
    workspace_token: token,
    episode_id: episodeId,
    report,
  }, 30_000) as Record<string, unknown>;
  const relativePath = typeof payload.relative_path === 'string' ? payload.relative_path : '';
  const sha256 = typeof payload.sha256 === 'string' ? payload.sha256 : '';
  const byteSize = Number(payload.byte_size);
  if (payload.ok !== true
    || !/^name_data\/coverage\/source-coverage-[a-f0-9]{64}\.json$/u.test(relativePath)
    || !/^[a-f0-9]{64}$/u.test(sha256)
    || !relativePath.endsWith(`${sha256}.json`)
    || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > 8 * 1024 * 1024
    || typeof payload.created !== 'boolean') {
    throw new Error('coverage reportの保存応答が正しくありません');
  }
  return { relativePath, sha256, byteSize, created: payload.created };
}

export async function chooseEpisodeWorkspaceImages(token: string, maxFiles: number): Promise<File[]> {
  const payload = await postJson('/api/episode-workspace/choose-images', {
    workspace_token: token,
    max_files: maxFiles,
  }, 5 * 60_000) as Record<string, unknown>;
  if (payload.cancelled === true) return [];
  if (!Array.isArray(payload.files)) throw new Error('選択した画像を読み込めませんでした');
  return payload.files.slice(0, Math.min(12, Math.max(1, maxFiles))).map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('選択した画像の形式が正しくありません');
    const item = entry as Record<string, unknown>;
    return dataUrlFile(item.image, item.filename);
  });
}

function scannerSessionFromPayload(payload: Record<string, unknown>): ScannerSession {
  if (typeof payload.session_id !== 'string' || typeof payload.started_at !== 'string') {
    throw new Error('スキャン待機を開始できませんでした');
  }
  return {
    id: payload.session_id,
    startedAt: payload.started_at,
    expiresInSeconds: Math.max(1, Number(payload.expires_in_seconds) || 300),
    maxFiles: Math.min(10, Math.max(1, Number(payload.max_files) || 10)),
    directory: typeof payload.directory === 'string' ? payload.directory : '',
  };
}

function scannerFilesFromPayload(payload: Record<string, unknown>): ScannedImage[] {
  const rawFiles = Array.isArray(payload.files) ? payload.files.slice(0, 10) : [];
  return rawFiles.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string') return [];
    try {
      return [{
        id: item.id,
        file: dataUrlFile(item.image, item.filename),
        modifiedAt: typeof item.modified_at === 'string' ? item.modified_at : '',
      }];
    } catch {
      return [];
    }
  });
}

export async function openMacScanner(): Promise<ScannerSession> {
  const payload = await postJson('/api/scanner/open', {}, 10_000) as Record<string, unknown>;
  return scannerSessionFromPayload(payload);
}

export async function collectScannerImages(sessionId: string): Promise<ScannerCollection> {
  const payload = await postJson('/api/scanner/collect', { session_id: sessionId }, 15_000) as Record<string, unknown>;
  const files = scannerFilesFromPayload(payload);
  return {
    files,
    complete: payload.complete === true,
    remainingSeconds: Math.max(0, Number(payload.remaining_seconds) || 0),
    total: Math.min(10, Math.max(files.length, Number(payload.total) || 0)),
  };
}

export async function commitScannerSession(sessionId: string): Promise<void> {
  const payload = await postJson('/api/scanner/commit', { session_id: sessionId }, 15_000) as { errors?: unknown };
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`スキャン元を削除できませんでした: ${payload.errors.join(', ')}`);
  }
}

export async function finishScannerSession(sessionId: string): Promise<void> {
  await postJson('/api/scanner/finish', { session_id: sessionId }, 10_000);
}

export async function cancelScannerSession(sessionId: string): Promise<void> {
  const payload = await postJson('/api/scanner/cancel', { session_id: sessionId }, 15_000) as { errors?: unknown };
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`スキャン元を削除できませんでした: ${payload.errors.join(', ')}`);
  }
}

export async function getPendingScannerSession(): Promise<PendingScannerSession | null> {
  const payload = await postJson('/api/scanner/pending', {}, 10_000) as Record<string, unknown>;
  if (payload.pending !== true) return null;
  return {
    startedAt: typeof payload.started_at === 'string' ? payload.started_at : '',
    directory: typeof payload.directory === 'string' ? payload.directory : '',
    count: Math.min(10, Math.max(1, Number(payload.count) || 1)),
  };
}

export async function resumePendingScannerSession(): Promise<ResumedScannerSession> {
  const payload = await postJson('/api/scanner/resume', {}, 30_000) as Record<string, unknown>;
  return { session: scannerSessionFromPayload(payload), files: scannerFilesFromPayload(payload) };
}

export async function discardPendingScannerSession(): Promise<void> {
  const payload = await postJson('/api/scanner/discard-pending', {}, 15_000) as { errors?: unknown };
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`残っているスキャン元を削除できませんでした: ${payload.errors.join(', ')}`);
  }
}

export interface SeriesCatalogLoadResult {
  found: boolean;
  seriesId: string;
  seriesName: string;
  omnyYaml: string;
  revision: string;
}

export interface SeriesCatalogSummary {
  seriesId: string;
  seriesName: string;
  updatedAt: string;
  seriesDirectory: string;
  seriesTextFileName: string;
}

export interface SeriesReferenceTextSelection {
  seriesDirectory: string;
  relativePath: string;
  fileName: string;
  text: string;
  kind?: SeriesReferenceTextCandidate['kind'];
}

export interface DeletedSeriesCharacter {
  deletionId: string;
  characterCatalogId: string;
  characterName: string;
  deletedAt: string;
  expiresAt: string;
}

export interface SeriesCharacterTextLink {
  linked: boolean;
  needsRelink: boolean;
  seriesId: string;
  seriesDirectory: string;
  relativePath: string;
  fileName: string;
  text: string;
  deletedCharacters: DeletedSeriesCharacter[];
}

function deletedSeriesCharacters(value: unknown): DeletedSeriesCharacter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.deletion_id !== 'string' || !/^deleted-[A-Za-z0-9-]{1,100}$/u.test(item.deletion_id)
      || typeof item.character_catalog_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(item.character_catalog_id)) return [];
    return [{
      deletionId: item.deletion_id,
      characterCatalogId: item.character_catalog_id,
      characterName: typeof item.character_name === 'string' && item.character_name.trim() ? item.character_name.trim() : '削除した人物',
      deletedAt: typeof item.deleted_at === 'string' ? item.deleted_at : '',
      expiresAt: typeof item.expires_at === 'string' ? item.expires_at : '',
    }];
  });
}

function seriesCharacterTextLink(payload: Record<string, unknown>, fallbackSeriesId: string): SeriesCharacterTextLink {
  const seriesId = typeof payload.series_id === 'string' ? payload.series_id : fallbackSeriesId;
  if (seriesId !== fallbackSeriesId) throw new Error('人物参照テキストのシリーズが一致しません');
  return {
    linked: payload.linked === true,
    needsRelink: payload.needs_relink === true,
    seriesId,
    seriesDirectory: typeof payload.series_directory === 'string' ? payload.series_directory : '',
    relativePath: typeof payload.relative_path === 'string' ? payload.relative_path : '',
    fileName: typeof payload.file_name === 'string' ? payload.file_name : '',
    text: typeof payload.text === 'string' ? payload.text : '',
    deletedCharacters: deletedSeriesCharacters(payload.deleted_characters),
  };
}

export async function listSeriesCatalogs(): Promise<SeriesCatalogSummary[]> {
  if (isLanClient) return (await listBrowserCatalogs()).map(item => ({ ...item, seriesDirectory: '', seriesTextFileName: '' }));
  const payload = await postJson('/api/series/list', {}, 10_000) as Record<string, unknown>;
  const entries = Array.isArray(payload.series) ? payload.series : [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.series_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(item.series_id)
      || typeof item.series_name !== 'string' || !item.series_name.trim()) return [];
    return [{
      seriesId: item.series_id,
      seriesName: item.series_name,
      updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
      seriesDirectory: typeof item.series_directory === 'string' ? item.series_directory : '',
      seriesTextFileName: typeof item.series_text_file_name === 'string' ? item.series_text_file_name : '',
    }];
  });
}

export async function chooseSeriesReferenceText(
  seriesId: string,
  defaultDirectory = '',
): Promise<SeriesReferenceTextSelection | null> {
  const payload = await postJson('/api/series/reference-text/choose', {
    series_id: seriesId,
    default_directory: defaultDirectory,
  }, 5 * 60_000) as Record<string, unknown>;
  if (payload.cancelled === true) return null;
  const seriesDirectory = typeof payload.series_directory === 'string' ? payload.series_directory : '';
  const relativePath = typeof payload.relative_path === 'string' ? payload.relative_path : '';
  const fileName = typeof payload.file_name === 'string' ? payload.file_name : '';
  const text = typeof payload.text === 'string' ? payload.text : '';
  if (!seriesDirectory || !relativePath || !fileName) {
    throw new Error('シリーズ資料テキストを受け取れませんでした');
  }
  return { seriesDirectory, relativePath, fileName, text };
}

export async function getSeriesCharacterTextStatus(seriesId: string): Promise<SeriesCharacterTextLink> {
  const payload = await postJson('/api/series/character-text/status', {
    series_id: seriesId,
  }, 10_000) as Record<string, unknown>;
  return seriesCharacterTextLink(payload, seriesId);
}

export async function linkSeriesCharacterText(
  seriesName: string,
  seriesId: string,
  defaultDirectory = '',
): Promise<SeriesCharacterTextLink | null> {
  const payload = await postJson('/api/series/character-text/link', {
    series_name: seriesName,
    series_id: seriesId,
    default_directory: defaultDirectory,
  }, 5 * 60_000) as Record<string, unknown>;
  if (payload.cancelled === true) return null;
  const result = seriesCharacterTextLink(payload, seriesId);
  if (!result.linked || !result.fileName || !result.relativePath) {
    throw new Error('人物の参照テキストを紐づけられませんでした');
  }
  return result;
}

export async function syncSeriesCharacterText(
  seriesId: string,
  markdown: string,
  activeCharacterIds: readonly string[],
  archive?: { characterCatalogId: string; characterName: string; omnyYaml: string },
): Promise<SeriesCharacterTextLink> {
  const payload = await postJson('/api/series/character-text/sync', {
    series_id: seriesId,
    markdown,
    active_character_ids: activeCharacterIds,
    ...(archive ? { archive: {
      character_catalog_id: archive.characterCatalogId,
      character_name: archive.characterName,
      omny_yaml: archive.omnyYaml,
    } } : {}),
  }, 20_000) as Record<string, unknown>;
  if (payload.ok !== true) throw new Error('人物の参照テキストを同期できませんでした');
  return seriesCharacterTextLink(payload, seriesId);
}

export async function restoreSeriesCharacterText(
  seriesId: string,
  deletionId: string,
): Promise<{ found: boolean; characterName: string; omnyYaml: string }> {
  const payload = await postJson('/api/series/character-text/restore', {
    series_id: seriesId,
    deletion_id: deletionId,
  }, 10_000) as Record<string, unknown>;
  if (payload.series_id !== seriesId || payload.deletion_id !== deletionId || (payload.found !== true && payload.found !== false)) {
    throw new Error('人物の復元データの応答形式が正しくありません');
  }
  if (!payload.found) return { found: false, characterName: '', omnyYaml: '' };
  if (typeof payload.omny_yaml !== 'string' || !payload.omny_yaml.trim()) {
    throw new Error('人物の復元データを読み込めませんでした');
  }
  return {
    found: true,
    characterName: typeof payload.character_name === 'string' ? payload.character_name : '削除した人物',
    omnyYaml: payload.omny_yaml,
  };
}

export async function loadSeriesCatalog(seriesName: string, seriesId = ''): Promise<SeriesCatalogLoadResult> {
  if (isLanClient) return loadBrowserCatalog(seriesName, seriesId);
  const payload = await postJson('/api/series/load', {
    series_name: seriesName,
    series_id: seriesId,
  }, 10_000) as Record<string, unknown>;
  const found = payload.found === true;
  const returnedSeriesId = typeof payload.series_id === 'string' ? payload.series_id : '';
  const returnedSeriesName = typeof payload.series_name === 'string' ? payload.series_name : '';
  const omnyYaml = typeof payload.omny_yaml === 'string' ? payload.omny_yaml : '';
  const revision = typeof payload.revision === 'string' && /^[a-f0-9]{64}$/.test(payload.revision) ? payload.revision : '';
  if (payload.found !== true && payload.found !== false) throw new Error('シリーズ共通カタログの応答形式が正しくありません');
  if (returnedSeriesId && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(returnedSeriesId)) {
    throw new Error('シリーズ共通カタログの内部IDが正しくありません');
  }
  if (found && (!returnedSeriesId || !returnedSeriesName.trim() || !omnyYaml.trim() || !revision)) {
    throw new Error('シリーズ共通カタログの応答形式が正しくありません');
  }
  return {
    found,
    seriesId: returnedSeriesId,
    seriesName: returnedSeriesName || seriesName,
    omnyYaml,
    revision,
  };
}

export async function saveSeriesCatalog(
  seriesName: string,
  seriesId: string,
  omnyYaml: string,
  expectedRevision: string,
  options: {
    seriesDirectory?: string;
    seriesTextRelativePath?: string;
  } = {},
): Promise<{ seriesId: string; directory: string; revision: string }> {
  if (isLanClient) return saveBrowserCatalog(seriesName, seriesId, omnyYaml, expectedRevision);
  const payload = await postJson('/api/series/save', {
    series_name: seriesName,
    series_id: seriesId,
    omny_yaml: omnyYaml,
    expected_revision: expectedRevision,
    series_directory: options.seriesDirectory ?? '',
    series_text_relative_path: options.seriesTextRelativePath ?? '',
  }, 10_000) as Record<string, unknown>;
  if (payload.ok !== true
    || typeof payload.series_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(payload.series_id)
    || typeof payload.revision !== 'string' || !/^[a-f0-9]{64}$/.test(payload.revision)) {
    throw new Error('シリーズ共通カタログを保存できませんでした');
  }
  return {
    seriesId: payload.series_id,
    directory: typeof payload.directory === 'string' ? payload.directory : '',
    revision: payload.revision,
  };
}

export interface SeriesCatalogDraftSession {
  token: string;
  seriesId: string;
  episodeId: string;
}

export async function beginSeriesCatalogDraft(
  seriesName: string,
  seriesId: string,
  episodeId: string,
): Promise<SeriesCatalogDraftSession> {
  const payload = await postJson('/api/series/draft/begin', {
    series_name: seriesName,
    series_id: seriesId,
    episode_id: episodeId,
  }, 30_000) as Record<string, unknown>;
  if (payload.ok !== true
    || typeof payload.draft_token !== 'string' || !/^[a-f0-9]{32}$/.test(payload.draft_token)
    || payload.series_id !== seriesId || payload.episode_id !== episodeId) {
    throw new Error('新規作成の仮保存を準備できませんでした');
  }
  return { token: payload.draft_token, seriesId, episodeId };
}

export async function discardSeriesCatalogDraft(token: string): Promise<boolean> {
  const payload = await postJson('/api/series/draft/discard', { draft_token: token }, 30_000) as Record<string, unknown>;
  if (payload.ok !== true || payload.draft_token !== token
    || (payload.discarded !== true && payload.discarded !== false)) {
    throw new Error('保存していない人物データを破棄できませんでした');
  }
  return payload.discarded;
}

export async function commitSeriesCatalogDraft(token: string): Promise<boolean> {
  const payload = await postJson('/api/series/draft/commit', { draft_token: token }, 30_000) as Record<string, unknown>;
  if (payload.ok !== true || payload.draft_token !== token
    || (payload.committed !== true && payload.committed !== false)) {
    throw new Error('人物データの保存を確定できませんでした');
  }
  return payload.committed;
}

/** 再読み込みやウィンドウ終了時も、仮保存の破棄要求だけは送る。 */
export function discardSeriesCatalogDraftOnPageExit(token: string): void {
  if (!token || typeof fetch !== 'function') return;
  void fetch(bridgeUrl('/api/series/draft/discard'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft_token: token }),
    keepalive: true,
  }).catch(() => undefined);
}

export async function discardUnsavedSeriesCatalog(
  seriesName: string,
  seriesId: string,
  episodeId: string,
): Promise<boolean> {
  const payload = await postJson('/api/series/discard-unsaved', {
    series_name: seriesName,
    series_id: seriesId,
    episode_id: episodeId,
  }, 10_000) as Record<string, unknown>;
  if (payload.ok !== true || (payload.deleted !== true && payload.deleted !== false) || payload.series_id !== seriesId) {
    throw new Error('保存していないシリーズの内部データを破棄できませんでした');
  }
  return payload.deleted;
}

export async function saveCharacterReferenceImage(
  blob: Blob,
  originalName: string,
  seriesId: string,
  characterCatalogId: string,
): Promise<SavedCharacterReferenceImage> {
  const uploadedSha256 = await verifiedPngSha256(blob);
  if (isLanClient) {
    const { loadFigureCropAsset, saveFigureCropAssets } = await import('./figureCropStore.ts');
    const id = `image-${uploadedSha256}`, key = characterImageCacheId(seriesId, characterCatalogId, id);
    const bytes = new DataView(await blob.arrayBuffer());
    const width = bytes.byteLength >= 24 ? bytes.getUint32(16) : 0, height = bytes.byteLength >= 24 ? bytes.getUint32(20) : 0;
    checkCharacterReferenceSize(width, height);
    if (blob.size > 40 * 1024 * 1024) throw new Error('人物資料画像は40MB以内にしてください');
    const created = !await loadFigureCropAsset(key);
    await saveFigureCropAssets([{ id: key, blob }]);
    return { created, sourceImage: { schema_version: 1, asset_id: id, file_name: `characters/${characterCatalogId}/${id}.png`,
      original_name: originalName.replace(/[\\/]/g, '_').slice(0, 255) || 'image.png', media_type: 'image/png', byte_size: blob.size,
      width_px: width, height_px: height, sha256: uploadedSha256 } };
  }
  const payload = await postJson('/api/series/character-images/save', {
    series_id: seriesId,
    character_catalog_id: characterCatalogId,
    original_name: originalName,
    image: await blobDataUrl(blob),
  }, 60_000) as Record<string, unknown>;
  const source = payload.source_image && typeof payload.source_image === 'object' && !Array.isArray(payload.source_image)
    ? payload.source_image as Record<string, unknown>
    : null;
  const assetId = typeof source?.asset_id === 'string' ? source.asset_id : '';
  const fileName = typeof source?.file_name === 'string' ? source.file_name : '';
  const responseOriginalName = typeof source?.original_name === 'string' ? source.original_name.trim() : '';
  const sha256 = typeof source?.sha256 === 'string' ? source.sha256 : '';
  const byteSize = source?.byte_size;
  const width = source?.width_px;
  const height = source?.height_px;
  if (payload.ok !== true || typeof payload.created !== 'boolean'
    || source?.schema_version !== 1 || source?.media_type !== 'image/png'
    || payload.series_id !== seriesId || payload.character_catalog_id !== characterCatalogId
    || !/^image-[a-f0-9]{64}$/.test(assetId) || !/^[a-f0-9]{64}$/.test(sha256)
    || sha256 !== uploadedSha256 || byteSize !== blob.size
    || assetId !== `image-${sha256}`
    || fileName !== `characters/${characterCatalogId}/${assetId}.png`
    || !responseOriginalName || responseOriginalName.length > 255 || /[\\/]/.test(responseOriginalName)
    || typeof byteSize !== 'number' || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > 40 * 1024 * 1024
    || typeof width !== 'number' || typeof height !== 'number'
    || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > 12000 || height > 12000 || width * height > 60_000_000) {
    throw new Error('人物資料画像の保存結果が正しくありません');
  }
  return {
    created: payload.created,
    sourceImage: {
      schema_version: 1,
      asset_id: assetId,
      file_name: fileName,
      original_name: responseOriginalName,
      media_type: 'image/png',
      byte_size: byteSize,
      width_px: width,
      height_px: height,
      sha256,
    },
  };
}

export async function loadCharacterReferenceImage(
  seriesId: string,
  characterCatalogId: string,
  assetId: string,
): Promise<Blob | null> {
  const cached = await (await import('./figureCropStore.ts')).loadFigureCropAsset(characterImageCacheId(seriesId, characterCatalogId, assetId));
  if (cached) {
    if (assetId !== `image-${await verifiedPngSha256(cached)}`) throw new Error('人物資料画像の整合性を確認できません');
    return cached;
  }
  if (isLanClient) return null;
  const payload = await postJson('/api/series/character-images/load', {
    series_id: seriesId,
    character_catalog_id: characterCatalogId,
    asset_id: assetId,
  }, 20_000) as Record<string, unknown>;
  if (payload.series_id !== seriesId || payload.character_catalog_id !== characterCatalogId || payload.asset_id !== assetId) {
    throw new Error('保存済みの人物資料画像の応答形式が正しくありません');
  }
  if (payload.found !== true && payload.found !== false) {
    throw new Error('保存済みの人物資料画像の応答形式が正しくありません');
  }
  if (!payload.found) return null;
  const blob = dataUrlBlob(payload.image);
  if (!blob || blob.type !== 'image/png' || blob.size < 1 || blob.size > 40 * 1024 * 1024) {
    throw new Error('保存済みの人物資料画像を読み込めませんでした');
  }
  const sha256 = await verifiedPngSha256(blob);
  if (assetId !== `image-${sha256}`) throw new Error('保存済みの人物資料画像の整合性を確認できません');
  return blob;
}

export async function deleteCharacterReferenceImage(
  seriesId: string,
  characterCatalogId: string,
  assetId: string,
): Promise<void> {
  // Browser originals can still be referenced by Undo or another work; retain the cached blob.
  if (isLanClient) return;
  const payload = await postJson('/api/series/character-images/delete', {
    series_id: seriesId,
    character_catalog_id: characterCatalogId,
    asset_id: assetId,
  }, 20_000) as Record<string, unknown>;
  if (payload.ok !== true || payload.series_id !== seriesId
    || payload.character_catalog_id !== characterCatalogId || payload.asset_id !== assetId) {
    throw new Error('人物資料画像の削除結果が正しくありません');
  }
}

export async function persistAnalogAsset(
  blob: Blob,
  episodeId: string,
  workTitle: string,
  kind: AnalogAssetKind,
  assetId: string,
): Promise<PersistentAnalogAssetRef> {
  const payload = await postJson('/api/analog-assets/save', {
    episode_id: episodeId,
    work_title: workTitle,
    kind,
    asset_id: assetId,
    image: await blobDataUrl(blob),
  }, 30_000) as Record<string, unknown>;
  if (typeof payload.work_key !== 'string' || typeof payload.file_name !== 'string' || payload.kind !== kind) {
    throw new Error('原画参照画像の保存結果が正しくありません');
  }
  return {
    schemaVersion: 1,
    workKey: payload.work_key,
    kind,
    fileName: payload.file_name,
  };
}

export async function loadPersistedAnalogAsset(reference: PersistentAnalogAssetRef): Promise<Blob | null> {
  const payload = await postJson('/api/analog-assets/load', {
    work_key: reference.workKey,
    kind: reference.kind,
    file_name: reference.fileName,
  }, 15_000) as Record<string, unknown>;
  if (payload.found !== true) return null;
  const blob = dataUrlBlob(payload.image);
  if (!blob) throw new Error('保存済みの原画参照画像を読み込めませんでした');
  return blob;
}

export async function decodeQwenJob(raw:unknown,jobId?:string,requestSha256?:string):Promise<import('./qwenGeneration.ts').QwenJob>{
  const value=raw as Record<string,unknown>;
  const selectedWorkflow=Boolean(value&&typeof value.workflow_id==='string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.workflow_id)
    && (value.candidate_cutout===true||value.status==='succeeded'&&Number.isInteger(value.selected_candidate)&&Number(value.selected_candidate)>=1&&Number(value.selected_candidate)<=5));
  const minSize=selectedWorkflow?1:32,maxSize=selectedWorkflow?16384:4096;
  if(!value||value.profile!=='qwen-image-2.1-owner-v1'||typeof value.job_id!=='string'||!/^[-a-f0-9]{36}$/.test(value.job_id)
    ||(jobId&&value.job_id!==jobId)||typeof value.request_sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.request_sha256)
    ||(requestSha256&&value.request_sha256!==requestSha256)||typeof value.label!=='string'
    ||!['preparing','prepared','queued','running','succeeded','failed','outcome_unknown'].includes(String(value.status))
    ||![value.width,value.height].every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=minSize&&n<=maxSize)
    ||Number(value.width)*Number(value.height)>100_000_000)throw new Error('Qwen生成結果の対応を確認できません');
  const job:import('./qwenGeneration.ts').QwenJob={jobId:value.job_id,status:value.status as import('./qwenGeneration.ts').QwenJob['status'],
    requestSha256:value.request_sha256,label:value.label,width:value.width as number,height:value.height as number,error:typeof value.error==='string'?value.error:undefined};
  if(value.document_key!==undefined){
    if(typeof value.document_key!=='string'||typeof value.page_number!=='number'||!Number.isInteger(value.page_number)||value.page_number<1
      ||typeof value.panel_id!=='number'||!Number.isInteger(value.panel_id)||typeof value.overlay!=='boolean'||(value.owner_key==='page'?value.panel_id<0||value.overlay:value.overlay?value.panel_id!==0:value.panel_id<1)
      ||typeof value.owner_key!=='string'||!/^(background|figure-\d+|bubble-\d+|panel|page)$/.test(value.owner_key)||value.owner_key==='panel'&&value.overlay
      ||typeof value.created_at!=='number'||!Number.isFinite(value.created_at)||value.created_at<0)throw new Error('生成履歴の所属を確認できません');
    Object.assign(job,{documentKey:value.document_key,pageNumber:value.page_number,panelId:value.panel_id,overlay:value.overlay,ownerKey:value.owner_key,createdAt:value.created_at});
  }
  if(value.file_name!==undefined){
    if(value.file_name!==`qwen_${job.jobId}.png`)throw new Error('生成画像のファイル名が一致しません');
    job.fileName=value.file_name as string;
  }
  if(value.image!==undefined){
    if(job.status!=='succeeded'||typeof value.image!=='string'||!value.image.startsWith('data:image/png;base64,')
      ||value.image.length>Math.ceil(PANEL_DRAFT_MAX_PNG_BYTES/3)*4+100||value.file_name!==`qwen_${job.jobId}.png`)throw new Error('Qwen生成画像の形式が不正です');
    job.image=value.image;job.fileName=value.file_name as string;
  }
  if(Array.isArray(value.candidates)){
    job.candidates=value.candidates.map((raw:unknown)=>{
      const item=raw as {index:number;seed:number;image:string};
      if(!Number.isInteger(item.index)||item.index<1||item.index>5||!Number.isSafeInteger(item.seed)||typeof item.image!=='string'||!item.image.startsWith('data:image/png;base64,'))throw new Error('生成候補の形式が不正です');
      return {index:item.index,seed:item.seed,image:item.image};
    });
  }
  if(typeof value.selected_candidate==='number')job.selectedCandidate=value.selected_candidate;
  job.requiresCutout=value.requires_cutout===true;
  job.candidateCutout=value.candidate_cutout===true;
  if(value.selected_candidates!==undefined){
    if(!Array.isArray(value.selected_candidates)||!value.selected_candidates.length||value.selected_candidates.some(i=>!Number.isInteger(i)||i<1||i>5)||new Set(value.selected_candidates).size!==value.selected_candidates.length)throw new Error('採用する候補の形式が不正です');
    job.selectedCandidates=value.selected_candidates as number[];
  }
  job.adopted=value.adopted===true;job.candidatesDiscarded=value.candidates_discarded===true;
  if(typeof value.workflow_name==='string')job.workflowName=value.workflow_name;
  if(typeof value.workflow_id==='string')job.workflowId=value.workflow_id;
  if(typeof value.workflow_version==='number')job.workflowVersion=value.workflow_version;
  if(typeof value.comfyui_url==='string')job.comfyuiUrl=value.comfyui_url;
  if(typeof value.generation_prompt==='string')job.generationPrompt=value.generation_prompt;
  if(value.progress!==undefined){
    const p=value.progress as Record<string,unknown>;
    if(!p||!Number.isInteger(p.candidate)||!Number.isInteger(p.total)||Number(p.candidate)<1||Number(p.candidate)>Number(p.total)||Number(p.total)>5
      ||typeof p.client_id!=='string'||!/^[a-f0-9-]{36}$/iu.test(p.client_id)||p.prompt_id!=null&&typeof p.prompt_id!=='string'
      ||!p.nodes||typeof p.nodes!=='object'||Array.isArray(p.nodes)||Object.values(p.nodes).some(name=>typeof name!=='string'||name.length>200))throw new Error('生成工程の形式が不正です');
    job.progress={candidate:Number(p.candidate),total:Number(p.total),clientId:p.client_id,...(typeof p.prompt_id==='string'?{promptId:p.prompt_id}:{}),nodes:p.nodes as Record<string,string>};
  }
  if(Array.isArray(value.candidate_seeds)&&value.candidate_seeds.every(Number.isSafeInteger))job.candidateSeeds=value.candidate_seeds as number[];
  return job;
}
export async function prepareQwenJob(jobId:string,payload:ReturnType<typeof import('./qwenGeneration.ts').qwenGenerationPayload>){
  const job=await decodeQwenJob(await postJson('/api/qwen-generation/prepare',{
    workflow_id:currentGenerationPreferences().local.workflowId,comfyui_url:currentLocalModelPreferences().comfyuiUrl,
    ...payload,job_id:jobId},320_000),jobId);
  if(job.status!=='prepared')throw new Error(job.error||'英訳の保存を確認できません。生成履歴を確認してください');
  return job;
}
export async function submitQwenJob(prepared:import('./qwenGeneration.ts').QwenJob,token:string){
  return decodeQwenJob(await (await import('./localBridgeLifecycle.ts')).submitImageGenerationRequest(token,{job_id:prepared.jobId,request_sha256:prepared.requestSha256}),prepared.jobId,prepared.requestSha256);
}
export async function reconcileQwenJob(jobId:string,requestSha256?:string){
  return decodeQwenJob(await postJson('/api/qwen-generation/reconcile',{job_id:jobId},30_000),jobId,requestSha256);
}
export async function cancelQwenJob(jobId:string){
  return withNewCreationBridgeSession(async()=>decodeQwenJob(await postJson('/api/qwen-generation/cancel',{job_id:jobId},30_000),jobId));
}
export async function selectQwenCandidate(job:import('./qwenGeneration.ts').QwenJob,index:number|number[],adopted=false){
  const result=await decodeQwenJob(await postJson('/api/qwen-generation/select',{job_id:job.jobId,...(Array.isArray(index)?{candidate_indices:index,adopted}:{candidate_index:index})},30_000),job.jobId,job.requestSha256);
  if(Array.isArray(index)&&(JSON.stringify(result.selectedCandidates)!==JSON.stringify([...index].sort((a,b)=>a-b))||adopted&&!result.candidatesDiscarded))throw new Error('候補の採用・削除結果を確認できません');
  return result;
}
export async function deleteQwenJobs(plan:import('./qwenGeneration.ts').QwenGenerationPlan,jobs:import('./qwenGeneration.ts').QwenJob[]){
  if(!jobs.length||jobs.some(job=>job.documentKey!==plan.documentKey))throw new Error('削除する生成履歴の作品が一致しません');
  const ids=jobs.map(job=>job.jobId);
  const result=await postJson('/api/qwen-generation/delete',{document_key:plan.documentKey,jobs:jobs.map(job=>({job_id:job.jobId,request_sha256:job.requestSha256}))},30_000) as {document_key?:unknown;deleted_job_ids?:unknown};
  if(result.document_key!==plan.documentKey||!Array.isArray(result.deleted_job_ids)||result.deleted_job_ids.length!==ids.length
    ||new Set(result.deleted_job_ids).size!==ids.length||result.deleted_job_ids.some(id=>!ids.includes(id)))throw new Error('生成履歴の削除結果を確認できません。履歴を読み直してください');
}
export async function listQwenJobs(plan:import('./qwenGeneration.ts').QwenGenerationPlan,scope:import('./qwenGeneration.ts').QwenHistoryScope='owner'){
  const payload=await postJson('/api/qwen-generation/list',{document_key:plan.documentKey,page_number:plan.pageNumber,panel_id:plan.panelId,overlay:plan.overlay,owner_key:plan.ownerKey,scope}) as {jobs?:unknown[]};
  if(!Array.isArray(payload.jobs))throw new Error('Qwen生成履歴を確認できません');
  const jobs=await Promise.all(payload.jobs.map(raw=>decodeQwenJob(raw)));
  if(jobs.some(job=>job.documentKey!==plan.documentKey||(scope==='owner'&&(job.pageNumber!==plan.pageNumber||job.panelId!==plan.panelId||job.overlay!==plan.overlay||job.ownerKey!==plan.ownerKey))))throw new Error('生成履歴の対象が一致しません');
  return jobs;
}

export async function saveSeriesBackgroundModel(seriesId:string,stage:BackgroundStage,blob:Blob):Promise<void> {
  await verifyBackgroundStage(stage,blob);
  const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  const payload=await postJson('/api/series/background-models/save',{series_id:seriesId,stage,model_data:btoa(binary)},60_000) as Record<string,unknown>;
  if(payload.ok!==true||payload.series_id!==seriesId||payload.stage_id!==stage.id||typeof payload.created!=='boolean')throw new Error('シリーズ背景の3Dモデルを保存できませんでした');
}

export async function loadSeriesBackgroundModel(seriesId:string,stage:BackgroundStage):Promise<Blob|null> {
  const payload=await postJson('/api/series/background-models/load',{series_id:seriesId,stage_id:stage.id,format:stage.format},60_000) as Record<string,unknown>;
  if(payload.series_id!==seriesId||payload.stage_id!==stage.id||payload.format!==stage.format||typeof payload.found!=='boolean')throw new Error('シリーズ背景の3Dモデルの応答形式が正しくありません');
  if(!payload.found)return null;
  if(typeof payload.model_data!=='string')throw new Error('シリーズ背景の3Dモデルが空です');
  const binary=atob(payload.model_data),blob=new Blob([Uint8Array.from(binary,char=>char.charCodeAt(0))],{type:stageMediaType(stage)});
  await verifyBackgroundStage(stage,blob);return blob;
}

/** The server verifies the immutable original without returning its model bytes. */
export async function hasSeriesBackgroundModel(seriesId:string,stage:BackgroundStage):Promise<boolean> {
  const payload=await postJson('/api/series/background-models/load',{series_id:seriesId,stage_id:stage.id,format:stage.format,verify_only:true},60_000) as Record<string,unknown>;
  if(payload.series_id!==seriesId||payload.stage_id!==stage.id||payload.format!==stage.format||typeof payload.found!=='boolean'||payload.found&&payload.byte_length!==stage.byteLength)throw new Error('シリーズ背景の3Dモデルの保存状態を確認できませんでした');
  return payload.found;
}

/** Voice and typed commands share the existing local bridge identity check. */
export function requestVoiceCommand(action:'voice/transcribe'|'voice/classify',body:object):Promise<unknown>{
  return withNewCreationBridgeSession(()=>postJson(`/api/${action}`,body,action==='voice/transcribe'?90_000:70_000));
}

export async function getAgentConnection():Promise<{connected:boolean;model:string}>{
  const value=await withNewCreationBridgeSession(()=>postJson('/api/agent/status',{},8_000)) as Record<string,unknown>;
  if(typeof value.connected!=='boolean'||typeof value.model!=='string')throw new Error('LLMの接続を確認できません');
  return {connected:value.connected,model:value.model};
}

export function withAgentServices<T>(task:()=>Promise<T>,isCurrent:()=>boolean){return withPanelActionServices(task,{isCurrent});}
export async function requestAgentReply(body:AgentRequest):Promise<AgentReply>{
  const value=await postJson('/api/agent/chat',body,210_000) as AgentReply;
  if(!value?.message||value.message.role!=='assistant'||typeof value.model!=='string'||
    (value.message.content!==null&&typeof value.message.content!=='string')||
    (value.message.tool_calls!==undefined&&(!Array.isArray(value.message.tool_calls)||value.message.tool_calls.some(c=>!c||c.type!=='function'||typeof c.id!=='string'||typeof c.function?.name!=='string'||typeof c.function?.arguments!=='string'))))throw Error('エージェントの応答形式を確認できません');
  return value;
}
