import { stageMediaType, verifyBackgroundStage } from './background3d.ts';
import type { BackgroundStage } from '../types.ts';
import { clamp, DEFAULT_PANEL_GUTTERS, INNER_FRAME_BOUNDS, nearestAnchor, panelBounds, pointInPanel, roundMm, type PanelGutterSettings } from './canvasGeometry.ts';
import type { AnalogAssetKind, AnalogFigureImport, AnalogTextImport, BBox, Bubble, CharacterRecognitionProfile, CharacterReferenceSourceImage, CharacterReferenceView, FigureSize, LocalVlmAnalyzer, MangaPage, Panel, PanelShape, PersistentAnalogAssetRef, VisualEvidence } from '../types';
import { DETECTED_FIGURE_NAME } from './bubbleRelations.ts';
import type { PanelActionSuggestionRequest, PanelActionSuggestionResponse } from './panelActions.ts';
import { MANGA_BASE_PALETTE, PANEL_DRAFT_PROFILE, type PanelDraftPlan } from './panelDraft.ts';
import type { SourceCoverageReport } from './sourceCoverage.ts';
import { currentLocalModelPreferences, normalizeComfyuiUrl } from './localModelPreferences.ts';
import { decodeImageGenerationConnections } from './modelConnections.ts';
import { currentGenerationPreferences } from './generationPreferences.ts';
import { FIGURE_SIZES } from './manga.ts';
import { humanPoseSelectable, parseHumanPoseCatalog } from './humanPoseSelection.ts';
import { withNewCreationBridgeSession,withPanelActionServices } from './localBridgeLifecycle.ts';
import { isLanClient, serviceUrl } from './clientRuntime.ts';
import { characterImageCacheId, listBrowserCatalogs, loadBrowserCatalog, saveBrowserCatalog } from './browserCatalog.ts';
import type {AgentRequest,AgentReply} from './agentChat.ts';
import type { HumanPoseCatalog } from './humanPoseTypes.ts';
import { decodeHumanPoseScene } from './humanPoseSceneAssets.ts';

export { DETECTED_FIGURE_NAME };

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';
const REQUEST_TIMEOUT_MS = 210_000;
const LAYOUT_PROTOCOL_VERSION = 3;
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

export interface CharacterMatchCandidateRequest {
  id: string;
  name: string;
  aliases: string[];
  observedTraits: string[];
}

export interface CharacterMatchSuggestion {
  candidateId: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  observed: string[];
  reason: string;
  action: string;
  suggestedSize: FigureSize;
  analysis: Record<string, unknown>;
  analyzer: LocalVlmAnalyzer;
}

export interface SavedCharacterReferenceImage {
  sourceImage: CharacterReferenceSourceImage;
  /** この要求で新しく作られた場合だけtrue。中断時の安全な整理に使う。 */
  created: boolean;
}

export interface LayoutRecognitionResult {
  detectedPanels: PanelShape[];
  /** detectedPanelsと同じ順序で保たれる、bridge由来の安定ID。 */
  detectedPanelIds: string[];
  detectedFigures: DetectedFigureRegion[];
  /** 検出原稿上のコマ群外枠。全検出物を同じ座標変換で内枠へ対応させる。 */
  sourceFrame: BBox | null;
  reason: string;
  detectedPanelCount: number;
  structureEngine: string;
  excludedNonPanelCount: number;
  detectedTextRegionCount: number;
  detectedFaceRegionCount: number;
  detectedBodyRegionCount: number;
  ocrEngine: string;
  ocrLines: RecognizedTextLine[];
}

export interface RecognizedTextLine {
  id: string;
  text: string;
  bbox: BBox;
  confidence: number;
  vertical: boolean;
  source: string;
  needsReview: boolean;
  unreadable?: boolean;
  groupId?: string;
  /** 編集用の整形後も変わらない、検出時点の所属コマID。 */
  sourcePanelId?: string;
  /** 特定コマへ閉じ込めず、コマ枠より上のページ前景へ置く。 */
  pageOverlay?: true;
}

export interface DetectedFigureRegion {
  id: string;
  bbox: BBox;
  source: 'body' | 'face';
  confidence?: number;
  /** 編集用の整形後も変わらない、検出時点の所属コマID。 */
  sourcePanelId?: string;
  /** 特定コマへ閉じ込めず、コマ枠より上のページ前景へ置く。 */
  pageOverlay?: true;
}

/** OCRグループ名が別コマで再利用されても、切り抜き・配置用IDを衝突させない。 */
export function recognizedTextOwnerKey(line: Pick<RecognizedTextLine, 'id' | 'groupId' | 'sourcePanelId' | 'pageOverlay'>): string {
  const lineKey = line.groupId ?? line.id;
  return line.pageOverlay ? `page-overlay/${lineKey}` : line.sourcePanelId ? `${line.sourcePanelId}/${lineKey}` : lineKey;
}

interface BridgeLayoutResponse {
  layout_protocol_version?: unknown;
  panels?: unknown;
  reason?: unknown;
  structure?: unknown;
  people?: unknown;
  ocr?: unknown;
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

function shapeBounds(shape: PanelShape): BBox {
  return panelBounds({ id: 0, shape, bg: 0, bubbles: [], action: null });
}

function detectedSourceFrame(shapes: readonly PanelShape[]): BBox | null {
  if (!shapes.length) return null;
  const bounds = shapes.map(shapeBounds);
  const left = Math.min(...bounds.map((box) => box.x));
  const top = Math.min(...bounds.map((box) => box.y));
  const right = Math.max(...bounds.map((box) => box.x + box.w));
  const bottom = Math.max(...bounds.map((box) => box.y + box.h));
  const normalized = {
    x: Number((left / 210).toFixed(6)),
    y: Number((top / 297).toFixed(6)),
    w: Number(((right - left) / 210).toFixed(6)),
    h: Number(((bottom - top) / 297).toFixed(6)),
  };
  // 一部のコマしか検出できなかった場合、それをページ全体まで拡大しない。
  return normalized.w >= 0.72 && normalized.h >= 0.72 ? normalized : null;
}

function sourceFrameBoxToCanvas(box: BBox, sourceFrame: BBox | null, canvasWidth: number, canvasHeight: number): BBox {
  if (!sourceFrame) return {
    x: box.x * canvasWidth,
    y: box.y * canvasHeight,
    w: box.w * canvasWidth,
    h: box.h * canvasHeight,
  };
  const scaleX = INNER_FRAME_BOUNDS.w / sourceFrame.w;
  const scaleY = INNER_FRAME_BOUNDS.h / sourceFrame.h;
  return {
    x: INNER_FRAME_BOUNDS.x + (box.x - sourceFrame.x) * scaleX,
    y: INNER_FRAME_BOUNDS.y + (box.y - sourceFrame.y) * scaleY,
    w: box.w * scaleX,
    h: box.h * scaleY,
  };
}

function sourceFrameShapeToInnerFrame(shape: PanelShape, sourceFrame: BBox): PanelShape {
  const transformPoint = ([x, y]: [number, number]): [number, number] => [
    roundMm(INNER_FRAME_BOUNDS.x + ((x / 210) - sourceFrame.x) * (INNER_FRAME_BOUNDS.w / sourceFrame.w)),
    roundMm(INNER_FRAME_BOUNDS.y + ((y / 297) - sourceFrame.y) * (INNER_FRAME_BOUNDS.h / sourceFrame.h)),
  ];
  if (shape.type === 'polygon') return { type: 'polygon', points: shape.points.map(transformPoint) };
  const [left, top] = transformPoint([shape.x, shape.y]);
  const [right, bottom] = transformPoint([shape.x + shape.w, shape.y + shape.h]);
  return { type: 'rect', x: left, y: top, w: roundMm(right - left), h: roundMm(bottom - top) };
}

function normalizedPanelBox(entry: unknown): BBox | null {
  const values = Array.isArray(entry) ? entry.map(Number) : [];
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [rawX, rawY, rawWidth, rawHeight] = values;
  const left = clamp(rawX, 0, 1);
  const top = clamp(rawY, 0, 1);
  const right = clamp(rawX + rawWidth, 0, 1);
  const bottom = clamp(rawY + rawHeight, 0, 1);
  if (right - left < 0.005 || bottom - top < 0.005) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function normalizedBoxToPanelShape(box: BBox): PanelShape {
  return {
    type: 'rect',
    x: roundMm(box.x * 210),
    y: roundMm(box.y * 297),
    w: roundMm(box.w * 210),
    h: roundMm(box.h * 297),
  };
}

function boxIntersectionOverUnion(left: BBox, right: BBox): number {
  const intersection = overlapArea(left, right);
  const union = left.w * left.h + right.w * right.h - intersection;
  return union > 0 ? intersection / union : 0;
}

type QuadPoints = [[number, number], [number, number], [number, number], [number, number]];

function canonicalQuadPoints(shape: PanelShape): QuadPoints | null {
  if (shape.type === 'rect') return [
    [shape.x, shape.y],
    [shape.x + shape.w, shape.y],
    [shape.x + shape.w, shape.y + shape.h],
    [shape.x, shape.y + shape.h],
  ];
  if (shape.points.length !== 4) return null;
  const orderedByY = [...shape.points].sort((left, right) => left[1] - right[1] || left[0] - right[0]);
  const top = orderedByY.slice(0, 2).sort((left, right) => left[0] - right[0]);
  const bottom = orderedByY.slice(2).sort((left, right) => right[0] - left[0]);
  return [top[0], top[1], bottom[0], bottom[1]].map(([x, y]) => [x, y]) as QuadPoints;
}

/** 5°以内のスキャン由来の傾きは手振れとして扱い、編集しやすい矩形へ戻す。 */
function straightenNearRectShape(shape: PanelShape, thresholdDegrees = 5): PanelShape {
  if (shape.type === 'rect') return structuredClone(shape);
  const points = canonicalQuadPoints(shape);
  if (!points) return structuredClone(shape);
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  const horizontalDeviation = (start: [number, number], end: [number, number]) => (
    Math.atan2(Math.abs(end[1] - start[1]), Math.abs(end[0] - start[0])) * 180 / Math.PI
  );
  const verticalDeviation = (start: [number, number], end: [number, number]) => (
    Math.atan2(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1])) * 180 / Math.PI
  );
  const nearRect = horizontalDeviation(topLeft, topRight) <= thresholdDegrees
    && horizontalDeviation(bottomLeft, bottomRight) <= thresholdDegrees
    && verticalDeviation(topLeft, bottomLeft) <= thresholdDegrees
    && verticalDeviation(topRight, bottomRight) <= thresholdDegrees;
  if (!nearRect) return { type: 'polygon', points };
  const left = Math.min(...points.map((point) => point[0]));
  const right = Math.max(...points.map((point) => point[0]));
  const top = Math.min(...points.map((point) => point[1]));
  const bottom = Math.max(...points.map((point) => point[1]));
  return { type: 'rect', x: roundMm(left), y: roundMm(top), w: roundMm(right - left), h: roundMm(bottom - top) };
}

function overlapArea(left: BBox, right: BBox): number {
  return Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x))
    * Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y));
}

/**
 * 1つの検出領域が複数コマの絵として使われているかを、検出時点のコマ形状で判定する。
 * 形状整形後の溝やスナップ位置は所属判定へ混ぜない。
 */
function belongsToPageOverlay(
  panels: readonly Panel[],
  box: BBox,
  confidence: number,
  allowOutsidePanels: boolean,
  preferredPanel?: Panel,
): boolean {
  const area = box.w * box.h;
  if (!panels.length || area <= 0) return false;
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  // 斜め小コマの外接矩形は上下のコマと重なる。人物領域が最小の
  // 内包コマへほぼ完全に収まるなら、矩形同士の重なりだけで
  // 「複数コマをまたぐ人物」へ昇格させない。
  if (preferredPanel && pointInPanel(preferredPanel, centerX, centerY)
    && overlapArea(box, panelBounds(preferredPanel)) / area >= 0.90) return false;
  const coverage = panels
    .map((panel) => overlapArea(box, panelBounds(panel)) / area)
    .sort((left, right) => right - left);
  const materialOverlaps = coverage.filter((ratio) => ratio >= 0.12);
  if (materialOverlaps.length >= 2 && materialOverlaps[0] + materialOverlaps[1] >= 0.55) return true;

  // コマ外へ置かれた大きな人物も救う。小さな誤検出やOCR領域には適用しない。
  if (!allowOutsidePanels || confidence < 0.35 || area < 210 * 297 * 0.025) return false;
  return !panels.some((panel) => pointInPanel(panel, centerX, centerY)) && (coverage[0] ?? 0) < 0.45;
}

function detectedPanelIndexesToKeep(shapes: readonly PanelShape[]): number[] {
  const bounds = shapes.map(shapeBounds);
  const bySmallestArea = bounds.map((box, index) => ({ index, area: box.w * box.h })).sort((left, right) => left.area - right.area);
  const kept = new Set<number>();
  for (const candidate of bySmallestArea) {
    const candidateBox = bounds[candidate.index];
    const duplicate = [...kept].some((keptIndex) => {
      const keptBox = bounds[keptIndex];
      const intersection = overlapArea(candidateBox, keptBox);
      const candidateArea = candidateBox.w * candidateBox.h;
      const keptArea = keptBox.w * keptBox.h;
      const smaller = Math.min(candidateArea, keptArea);
      const larger = Math.max(candidateArea, keptArea);
      const union = candidateArea + keptArea - intersection;
      return smaller > 0 && larger > 0
        && smaller / larger >= 0.68
        && (intersection / smaller >= 0.9 || (union > 0 && intersection / union >= 0.72));
    });
    if (duplicate) continue;
    const containedParts = [...kept].flatMap((keptIndex) => {
      const keptBox = bounds[keptIndex];
      const keptArea = keptBox.w * keptBox.h;
      const intersection = overlapArea(candidateBox, keptBox);
      const centerX = keptBox.x + keptBox.w / 2;
      const centerY = keptBox.y + keptBox.h / 2;
      const centerInside = centerX >= candidateBox.x && centerX <= candidateBox.x + candidateBox.w
        && centerY >= candidateBox.y && centerY <= candidateBox.y + candidateBox.h;
      return keptArea > 0 && centerInside && intersection / keptArea >= 0.8 ? [{ intersection }] : [];
    });
    const candidateArea = candidateBox.w * candidateBox.h;
    const splitArtifact = shapes[candidate.index].type === 'rect'
      && containedParts.length >= 2
      && containedParts.reduce((sum, part) => sum + part.intersection, 0) / candidateArea >= 0.72;
    if (!splitArtifact) kept.add(candidate.index);
  }
  return shapes.flatMap((_, index) => kept.has(index) ? [index] : []);
}

type MutableRectEdges = { left: number; right: number; top: number; bottom: number };

function constrainDetectedPanelsToInnerFrame(shapes: readonly PanelShape[]): PanelShape[] {
  const innerRight = INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w;
  const innerBottom = INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h;
  return shapes.map((shape) => {
    if (shape.type === 'polygon') return {
      type: 'polygon',
      points: shape.points.map(([x, y]) => [
        roundMm(clamp(x, INNER_FRAME_BOUNDS.x, innerRight)),
        roundMm(clamp(y, INNER_FRAME_BOUNDS.y, innerBottom)),
      ]),
    };
    const left = clamp(shape.x, INNER_FRAME_BOUNDS.x, innerRight - 8);
    const top = clamp(shape.y, INNER_FRAME_BOUNDS.y, innerBottom - 8);
    const right = clamp(shape.x + shape.w, left + 8, innerRight);
    const bottom = clamp(shape.y + shape.h, top + 8, innerBottom);
    return {
      type: 'rect',
      x: roundMm(left),
      y: roundMm(top),
      w: roundMm(right - left),
      h: roundMm(bottom - top),
    };
  });
}

function alignNearRectEdges(shapes: readonly PanelShape[], threshold = 4): PanelShape[] {
  const next = shapes.map((shape) => structuredClone(shape));
  const rects = next.flatMap((shape, index): Array<{ index: number; edges: MutableRectEdges }> => shape.type === 'rect' ? [{
    index,
    edges: { left: shape.x, right: shape.x + shape.w, top: shape.y, bottom: shape.y + shape.h },
  }] : []);
  const alignAxis = (
    start: 'left' | 'top',
    end: 'right' | 'bottom',
    minimum: number,
    maximum: number,
  ) => {
    const references = rects.flatMap((rect) => ([
      { rect, edge: start, value: rect.edges[start] },
      { rect, edge: end, value: rect.edges[end] },
    ]));
    const sorted = references.sort((left, right) => left.value - right.value);
    for (let cursor = 0; cursor < sorted.length;) {
      let endCursor = cursor + 1;
      while (endCursor < sorted.length && sorted[endCursor].value - sorted[cursor].value <= threshold) endCursor += 1;
      const cluster = sorted.slice(cursor, endCursor);
      const boundaryTarget = cluster.some((reference) => Math.abs(reference.value - minimum) <= threshold) ? minimum
        : cluster.some((reference) => Math.abs(reference.value - maximum) <= threshold) ? maximum
          : null;
      if (boundaryTarget !== null || new Set(cluster.map((reference) => reference.rect.index)).size >= 2) {
        const target = boundaryTarget ?? roundMm(cluster.reduce((sum, reference) => sum + reference.value, 0) / cluster.length);
        cluster.forEach((reference) => { reference.rect.edges[reference.edge] = target; });
      }
      cursor = endCursor;
    }
  };
  alignAxis('left', 'right', INNER_FRAME_BOUNDS.x, INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w);
  alignAxis('top', 'bottom', INNER_FRAME_BOUNDS.y, INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h);
  rects.forEach(({ index, edges }) => {
    const shape = next[index];
    if (shape.type !== 'rect') return;
    shape.x = roundMm(edges.left);
    shape.y = roundMm(edges.top);
    shape.w = roundMm(Math.max(8, edges.right - edges.left));
    shape.h = roundMm(Math.max(8, edges.bottom - edges.top));
  });
  return next;
}

/** 隣接する検出矩形の外端を保ったまま、上下・左右それぞれのコマ間隔へ整える。 */
export function ensureDetectedPanelGutters(
  shapes: readonly PanelShape[],
  settings: PanelGutterSettings = DEFAULT_PANEL_GUTTERS,
): PanelShape[] {
  const source = shapes.map((shape) => structuredClone(shape));
  const next = shapes.map((shape) => structuredClone(shape));
  const rowGap = roundMm(clamp(settings.rowGapMm, 0, 20));
  const columnGap = roundMm(clamp(settings.columnGapMm, 0, 20));
  const hasInterveningPanel = (firstIndex: number, secondIndex: number, axis: 'row' | 'column') => {
    const first = source[firstIndex], second = source[secondIndex];
    if (first.type !== 'rect' || second.type !== 'rect') return false;
    const firstCenter = axis === 'row' ? first.y + first.h / 2 : first.x + first.w / 2;
    const secondCenter = axis === 'row' ? second.y + second.h / 2 : second.x + second.w / 2;
    const minimum = Math.min(firstCenter, secondCenter), maximum = Math.max(firstCenter, secondCenter);
    return source.some((candidate, candidateIndex) => {
      if (candidateIndex === firstIndex || candidateIndex === secondIndex || candidate.type !== 'rect') return false;
      const center = axis === 'row' ? candidate.y + candidate.h / 2 : candidate.x + candidate.w / 2;
      if (center <= minimum || center >= maximum) return false;
      if (axis === 'row') {
        const overlapFirst = Math.max(0, Math.min(first.x + first.w, candidate.x + candidate.w) - Math.max(first.x, candidate.x));
        const overlapSecond = Math.max(0, Math.min(second.x + second.w, candidate.x + candidate.w) - Math.max(second.x, candidate.x));
        return overlapFirst >= Math.min(first.w, candidate.w) * 0.2
          && overlapSecond >= Math.min(second.w, candidate.w) * 0.2;
      }
      const overlapFirst = Math.max(0, Math.min(first.y + first.h, candidate.y + candidate.h) - Math.max(first.y, candidate.y));
      const overlapSecond = Math.max(0, Math.min(second.y + second.h, candidate.y + candidate.h) - Math.max(second.y, candidate.y));
      return overlapFirst >= Math.min(first.h, candidate.h) * 0.2
        && overlapSecond >= Math.min(second.h, candidate.h) * 0.2;
    });
  };

  type GutterPair = { beforeIndex: number; afterIndex: number; boundary: number };
  const rowPairs: GutterPair[] = [];
  const columnPairs: GutterPair[] = [];
  for (let leftIndex = 0; leftIndex < source.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < source.length; rightIndex += 1) {
      const first = source[leftIndex];
      const second = source[rightIndex];
      if (first.type !== 'rect' || second.type !== 'rect') continue;
      const horizontalOverlap = Math.max(0, Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x));
      const verticalOverlap = Math.max(0, Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y));
      const normalizedHorizontalDistance = Math.abs((first.x + first.w / 2) - (second.x + second.w / 2)) / Math.max(1, (first.w + second.w) / 2);
      const normalizedVerticalDistance = Math.abs((first.y + first.h / 2) - (second.y + second.h / 2)) / Math.max(1, (first.h + second.h) / 2);

      if (normalizedVerticalDistance >= normalizedHorizontalDistance && horizontalOverlap >= Math.min(first.w, second.w) * 0.25) {
        const [upperIndex, lowerIndex] = first.y + first.h / 2 <= second.y + second.h / 2
          ? [leftIndex, rightIndex]
          : [rightIndex, leftIndex];
        if (hasInterveningPanel(leftIndex, rightIndex, 'row')) continue;
        const upper = source[upperIndex], lower = source[lowerIndex];
        if (upper.type !== 'rect' || lower.type !== 'rect') continue;
        const currentGap = lower.y - (upper.y + upper.h);
        if (currentGap > Math.max(12, rowGap + 4)) continue;
        rowPairs.push({ beforeIndex: upperIndex, afterIndex: lowerIndex, boundary: ((upper.y + upper.h) + lower.y) / 2 });
      } else if (verticalOverlap >= Math.min(first.h, second.h) * 0.25) {
        const [leftPanelIndex, rightPanelIndex] = first.x + first.w / 2 <= second.x + second.w / 2
          ? [leftIndex, rightIndex]
          : [rightIndex, leftIndex];
        if (hasInterveningPanel(leftIndex, rightIndex, 'column')) continue;
        const left = source[leftPanelIndex], right = source[rightPanelIndex];
        if (left.type !== 'rect' || right.type !== 'rect') continue;
        const currentGap = right.x - (left.x + left.w);
        if (currentGap > Math.max(12, columnGap + 4)) continue;
        columnPairs.push({ beforeIndex: leftPanelIndex, afterIndex: rightPanelIndex, boundary: ((left.x + left.w) + right.x) / 2 });
      }
    }
  }

  type EdgeTargets = { left: number[]; right: number[]; top: number[]; bottom: number[] };
  const targets = new Map<number, EdgeTargets>();
  const addTarget = (index: number, edge: keyof EdgeTargets, value: number) => {
    const existing = targets.get(index) ?? { left: [], right: [], top: [], bottom: [] };
    existing[edge].push(value);
    targets.set(index, existing);
  };
  const applyPairGroups = (pairs: GutterPair[], axis: 'row' | 'column', gap: number) => {
    const remaining = new Set(pairs.map((_, index) => index));
    while (remaining.size) {
      const seed = remaining.values().next().value;
      if (seed === undefined) break;
      remaining.delete(seed);
      const group = [pairs[seed]];
      for (let cursor = 0; cursor < group.length; cursor += 1) {
        const current = group[cursor];
        for (const candidateIndex of [...remaining]) {
          const candidate = pairs[candidateIndex];
          const sharesSameEdge = current.beforeIndex === candidate.beforeIndex
            || current.afterIndex === candidate.afterIndex;
          if (!sharesSameEdge && Math.abs(current.boundary - candidate.boundary) > 4) continue;
          remaining.delete(candidateIndex);
          group.push(candidate);
        }
      }
      const boundary = roundMm(group.reduce((sum, pair) => sum + pair.boundary, 0) / group.length);
      for (const pair of group) {
        if (axis === 'row') {
          addTarget(pair.beforeIndex, 'bottom', boundary - gap / 2);
          addTarget(pair.afterIndex, 'top', boundary + gap / 2);
        } else {
          addTarget(pair.beforeIndex, 'right', boundary - gap / 2);
          addTarget(pair.afterIndex, 'left', boundary + gap / 2);
        }
      }
    }
  };
  applyPairGroups(rowPairs, 'row', rowGap);
  applyPairGroups(columnPairs, 'column', columnGap);

  targets.forEach((edges, index) => {
    const original = source[index], shape = next[index];
    if (original.type !== 'rect' || shape.type !== 'rect') return;
    const average = (values: number[], fallback: number) => values.length
      ? roundMm(values.reduce((sum, value) => sum + value, 0) / values.length)
      : fallback;
    const left = average(edges.left, original.x);
    const right = average(edges.right, original.x + original.w);
    const top = average(edges.top, original.y);
    const bottom = average(edges.bottom, original.y + original.h);
    if (right - left >= 8) {
      shape.x = left;
      shape.w = roundMm(right - left);
    }
    if (bottom - top >= 8) {
      shape.y = top;
      shape.h = roundMm(bottom - top);
    }
  });
  return next;
}

function ensureDetectedPolygonGridGutters(
  shapes: readonly PanelShape[],
  settings: PanelGutterSettings,
): PanelShape[] {
  type QuadEntry = { index: number; points: QuadPoints; bounds: BBox };
  type GutterPair = {
    beforeIndex: number;
    afterIndex: number;
    boundary: number;
    spanStart: number;
    spanEnd: number;
  };
  const entries = shapes.flatMap((shape, index): QuadEntry[] => {
    const points = canonicalQuadPoints(shape);
    return points ? [{ index, points, bounds: shapeBounds({ type: 'polygon', points }) }] : [];
  });
  if (entries.length !== shapes.length) return shapes.map((shape) => structuredClone(shape));
  const rowGap = roundMm(clamp(settings.rowGapMm, 0, 20));
  const columnGap = roundMm(clamp(settings.columnGapMm, 0, 20));
  const sourceByIndex = new Map(entries.map((entry) => [entry.index, entry]));
  const mutableByIndex = new Map(entries.map((entry) => [entry.index, structuredClone(entry.points)]));
  const hasInterveningPanel = (first: QuadEntry, second: QuadEntry, axis: 'row' | 'column') => {
    const firstCenter = axis === 'row'
      ? first.bounds.y + first.bounds.h / 2
      : first.bounds.x + first.bounds.w / 2;
    const secondCenter = axis === 'row'
      ? second.bounds.y + second.bounds.h / 2
      : second.bounds.x + second.bounds.w / 2;
    const minimum = Math.min(firstCenter, secondCenter);
    const maximum = Math.max(firstCenter, secondCenter);
    return entries.some((candidate) => {
      if (candidate.index === first.index || candidate.index === second.index) return false;
      const center = axis === 'row'
        ? candidate.bounds.y + candidate.bounds.h / 2
        : candidate.bounds.x + candidate.bounds.w / 2;
      if (center <= minimum || center >= maximum) return false;
      if (axis === 'row') {
        const firstOverlap = Math.max(0, Math.min(first.bounds.x + first.bounds.w, candidate.bounds.x + candidate.bounds.w) - Math.max(first.bounds.x, candidate.bounds.x));
        const secondOverlap = Math.max(0, Math.min(second.bounds.x + second.bounds.w, candidate.bounds.x + candidate.bounds.w) - Math.max(second.bounds.x, candidate.bounds.x));
        return firstOverlap >= Math.min(first.bounds.w, candidate.bounds.w) * 0.2
          && secondOverlap >= Math.min(second.bounds.w, candidate.bounds.w) * 0.2;
      }
      const firstOverlap = Math.max(0, Math.min(first.bounds.y + first.bounds.h, candidate.bounds.y + candidate.bounds.h) - Math.max(first.bounds.y, candidate.bounds.y));
      const secondOverlap = Math.max(0, Math.min(second.bounds.y + second.bounds.h, candidate.bounds.y + candidate.bounds.h) - Math.max(second.bounds.y, candidate.bounds.y));
      return firstOverlap >= Math.min(first.bounds.h, candidate.bounds.h) * 0.2
        && secondOverlap >= Math.min(second.bounds.h, candidate.bounds.h) * 0.2;
    });
  };

  const rowPairs: GutterPair[] = [];
  const columnPairs: GutterPair[] = [];
  for (let firstIndex = 0; firstIndex < entries.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < entries.length; secondIndex += 1) {
      const first = entries[firstIndex], second = entries[secondIndex];
      const firstBounds = first.bounds, secondBounds = second.bounds;
      const horizontalOverlap = Math.max(0, Math.min(firstBounds.x + firstBounds.w, secondBounds.x + secondBounds.w) - Math.max(firstBounds.x, secondBounds.x));
      const verticalOverlap = Math.max(0, Math.min(firstBounds.y + firstBounds.h, secondBounds.y + secondBounds.h) - Math.max(firstBounds.y, secondBounds.y));
      const normalizedHorizontalDistance = Math.abs((firstBounds.x + firstBounds.w / 2) - (secondBounds.x + secondBounds.w / 2)) / Math.max(1, (firstBounds.w + secondBounds.w) / 2);
      const normalizedVerticalDistance = Math.abs((firstBounds.y + firstBounds.h / 2) - (secondBounds.y + secondBounds.h / 2)) / Math.max(1, (firstBounds.h + secondBounds.h) / 2);

      if (normalizedVerticalDistance >= normalizedHorizontalDistance && horizontalOverlap >= Math.min(firstBounds.w, secondBounds.w) * 0.25) {
        const [upper, lower] = firstBounds.y + firstBounds.h / 2 <= secondBounds.y + secondBounds.h / 2
          ? [first, second]
          : [second, first];
        if (hasInterveningPanel(first, second, 'row')) continue;
        const currentGap = lower.bounds.y - (upper.bounds.y + upper.bounds.h);
        if (currentGap > Math.max(12, rowGap + 4)) continue;
        rowPairs.push({
          beforeIndex: upper.index,
          afterIndex: lower.index,
          boundary: ((upper.bounds.y + upper.bounds.h) + lower.bounds.y) / 2,
          spanStart: Math.max(upper.bounds.x, lower.bounds.x),
          spanEnd: Math.min(upper.bounds.x + upper.bounds.w, lower.bounds.x + lower.bounds.w),
        });
      } else if (verticalOverlap >= Math.min(firstBounds.h, secondBounds.h) * 0.25) {
        const [left, right] = firstBounds.x + firstBounds.w / 2 <= secondBounds.x + secondBounds.w / 2
          ? [first, second]
          : [second, first];
        if (hasInterveningPanel(first, second, 'column')) continue;
        const currentGap = right.bounds.x - (left.bounds.x + left.bounds.w);
        if (currentGap > Math.max(12, columnGap + 4)) continue;
        columnPairs.push({
          beforeIndex: left.index,
          afterIndex: right.index,
          boundary: ((left.bounds.x + left.bounds.w) + right.bounds.x) / 2,
          spanStart: Math.max(left.bounds.y, right.bounds.y),
          spanEnd: Math.min(left.bounds.y + left.bounds.h, right.bounds.y + right.bounds.h),
        });
      }
    }
  }

  const groupedPairs = (pairs: readonly GutterPair[]) => {
    const remaining = new Set(pairs.map((_, index) => index));
    const groups: GutterPair[][] = [];
    while (remaining.size) {
      const seedIndex = remaining.values().next().value;
      if (seedIndex === undefined) break;
      remaining.delete(seedIndex);
      const group = [pairs[seedIndex]];
      for (let cursor = 0; cursor < group.length; cursor += 1) {
        const current = group[cursor];
        for (const candidateIndex of [...remaining]) {
          const candidate = pairs[candidateIndex];
          const sharesPanelEdge = current.beforeIndex === candidate.beforeIndex
            || current.afterIndex === candidate.afterIndex;
          const spansTouch = Math.min(current.spanEnd, candidate.spanEnd) >= Math.max(current.spanStart, candidate.spanStart) - 4;
          if (!sharesPanelEdge && !(spansTouch && Math.abs(current.boundary - candidate.boundary) <= 4)) continue;
          remaining.delete(candidateIndex);
          group.push(candidate);
        }
      }
      groups.push(group);
    }
    return groups;
  };
  const fit = (points: readonly [number, number][], dependentAxis: 0 | 1) => {
    const independentAxis = dependentAxis === 0 ? 1 : 0;
    const independentMean = points.reduce((sum, point) => sum + point[independentAxis], 0) / points.length;
    const dependentMean = points.reduce((sum, point) => sum + point[dependentAxis], 0) / points.length;
    const denominator = points.reduce((sum, point) => sum + (point[independentAxis] - independentMean) ** 2, 0);
    const slope = denominator < 1e-9 ? 0 : points.reduce((sum, point) => (
      sum + (point[independentAxis] - independentMean) * (point[dependentAxis] - dependentMean)
    ), 0) / denominator;
    return { slope, intercept: dependentMean - slope * independentMean };
  };

  for (const group of groupedPairs(rowPairs)) {
    const points = group.flatMap((pair): [number, number][] => {
      const upper = sourceByIndex.get(pair.beforeIndex)!.points;
      const lower = sourceByIndex.get(pair.afterIndex)!.points;
      return [upper[2], upper[3], lower[0], lower[1]];
    });
    const line = fit(points, 1);
    for (const index of new Set(group.map((pair) => pair.beforeIndex))) {
      const mutable = mutableByIndex.get(index)!;
      mutable[2][1] = line.slope * mutable[2][0] + line.intercept - rowGap / 2;
      mutable[3][1] = line.slope * mutable[3][0] + line.intercept - rowGap / 2;
    }
    for (const index of new Set(group.map((pair) => pair.afterIndex))) {
      const mutable = mutableByIndex.get(index)!;
      mutable[0][1] = line.slope * mutable[0][0] + line.intercept + rowGap / 2;
      mutable[1][1] = line.slope * mutable[1][0] + line.intercept + rowGap / 2;
    }
  }
  for (const group of groupedPairs(columnPairs)) {
    const points = group.flatMap((pair): [number, number][] => {
      const left = sourceByIndex.get(pair.beforeIndex)!.points;
      const right = sourceByIndex.get(pair.afterIndex)!.points;
      return [left[1], left[2], right[0], right[3]];
    });
    const line = fit(points, 0);
    for (const index of new Set(group.map((pair) => pair.beforeIndex))) {
      const mutable = mutableByIndex.get(index)!;
      mutable[1][0] = line.slope * mutable[1][1] + line.intercept - columnGap / 2;
      mutable[2][0] = line.slope * mutable[2][1] + line.intercept - columnGap / 2;
    }
    for (const index of new Set(group.map((pair) => pair.afterIndex))) {
      const mutable = mutableByIndex.get(index)!;
      mutable[0][0] = line.slope * mutable[0][1] + line.intercept + columnGap / 2;
      mutable[3][0] = line.slope * mutable[3][1] + line.intercept + columnGap / 2;
    }
  }

  return entries.map((entry) => straightenNearRectShape({
    type: 'polygon',
    points: mutableByIndex.get(entry.index)!.map(([x, y]) => [
      roundMm(clamp(x, INNER_FRAME_BOUNDS.x, INNER_FRAME_BOUNDS.x + INNER_FRAME_BOUNDS.w)),
      roundMm(clamp(y, INNER_FRAME_BOUNDS.y, INNER_FRAME_BOUNDS.y + INNER_FRAME_BOUNDS.h)),
    ]),
  }));
}

/** コマ形状はOCR結果から独立して整形する。文字のないコマも実在するため削除しない。 */
function normalizeDetectedPanelGeometry(
  shapes: readonly PanelShape[],
  gutterSettings: PanelGutterSettings,
): PanelShape[] {
  const constrained = constrainDetectedPanelsToInnerFrame(shapes);
  return constrained.some((shape) => shape.type === 'polygon')
    ? ensureDetectedPolygonGridGutters(constrained, gutterSettings)
    : ensureDetectedPanelGutters(alignNearRectEdges(constrained), gutterSettings);
}

export function groupRecognizedTextLines(lines: readonly RecognizedTextLine[]): RecognizedTextLine[] {
  const groups: { key: string; lines: RecognizedTextLine[] }[] = [];
  const byKey = new Map<string, { key: string; lines: RecognizedTextLine[] }>();
  lines.forEach((line, index) => {
    // 同じOCRグループ名でも、所属コマが異なる行は一つのフキダシへ混ぜない。
    const key = line.groupId ? `group:${recognizedTextOwnerKey(line)}` : `line:${index}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, lines: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.lines.push(line);
  });
  return groups.map((group) => {
    if (group.lines.length === 1) return group.lines[0];
    const vertical = group.lines.filter((line) => line.vertical).length * 2 >= group.lines.length;
    const ordered = [...group.lines].sort((left, right) => vertical
      ? (right.bbox.x + right.bbox.w / 2) - (left.bbox.x + left.bbox.w / 2) || left.bbox.y - right.bbox.y
      : (left.bbox.y + left.bbox.h / 2) - (right.bbox.y + right.bbox.h / 2) || left.bbox.x - right.bbox.x);
    const left = Math.min(...ordered.map((line) => line.bbox.x));
    const top = Math.min(...ordered.map((line) => line.bbox.y));
    const right = Math.max(...ordered.map((line) => line.bbox.x + line.bbox.w));
    const bottom = Math.max(...ordered.map((line) => line.bbox.y + line.bbox.h));
    return {
      ...ordered[0],
      text: ordered.map((line) => line.text.trim()).filter(Boolean).join('\n'),
      bbox: { x: left, y: top, w: right - left, h: bottom - top },
      confidence: ordered.reduce((sum, line) => sum + line.confidence, 0) / ordered.length,
      vertical,
      source: [...new Set(ordered.map((line) => line.source))].join('+'),
      needsReview: ordered.some((line) => line.needsReview),
      ...(ordered.every((line) => line.unreadable || !line.text.trim()) ? { unreadable: true } : {}),
      groupId: ordered[0].groupId,
      ...(ordered[0].pageOverlay ? { pageOverlay: true as const } : {}),
      ...(ordered[0].sourcePanelId ? { sourcePanelId: ordered[0].sourcePanelId } : {}),
    };
  });
}

export function normalizeLayoutRecognition(
  payload: BridgeLayoutResponse,
  gutterSettings: PanelGutterSettings = DEFAULT_PANEL_GUTTERS,
): LayoutRecognitionResult {
  if (payload.layout_protocol_version !== LAYOUT_PROTOCOL_VERSION || !Array.isArray(payload.panels)) {
    throw new Error('ローカルbridgeが古いか別のアプリです。起動中のbridgeを停止し、このリポジトリで npm run bridge を再起動してください。');
  }
  const seenPanelIds = new Set<string>();
  const rawPanelRegions = payload.panels.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`ローカルbridgeのコマ${index + 1}の形式が正しくありません。bridgeを再起動してください。`);
    }
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const detectorBox = normalizedPanelBox(item.detector_box);
    if (!id || seenPanelIds.has(id) || !detectorBox) {
      throw new Error(`ローカルbridgeのコマ${index + 1}のIDまたは検出枠が正しくありません。bridgeを再起動してください。`);
    }
    seenPanelIds.add(id);
    if (!item.shape || typeof item.shape !== 'object' || Array.isArray(item.shape)) {
      throw new Error(`ローカルbridgeのコマ${index + 1}に編集形状がありません。bridgeを再起動してください。`);
    }
    const rawShape = item.shape as Record<string, unknown>;
    let shape: PanelShape;
    if (rawShape.type === 'polygon' && Array.isArray(rawShape.points)) {
      const rawPoints = rawShape.points.flatMap((point): Array<[number, number]> => {
        if (!Array.isArray(point) || point.length !== 2) return [];
        const x = Number(point[0]), y = Number(point[1]);
        return Number.isFinite(x) && Number.isFinite(y) ? [[x, y]] : [];
      });
      if (rawPoints.length < 3) {
        throw new Error(`ローカルbridgeのコマ${index + 1}の多角形が壊れています。bridgeを再起動してください。`);
      }
      const left = Math.min(...rawPoints.map((point) => point[0]));
      const right = Math.max(...rawPoints.map((point) => point[0]));
      const top = Math.min(...rawPoints.map((point) => point[1]));
      const bottom = Math.max(...rawPoints.map((point) => point[1]));
      if (right - left < 0.005 || bottom - top < 0.005) {
        throw new Error(`ローカルbridgeのコマ${index + 1}の多角形が小さすぎます。bridgeを再起動してください。`);
      }
      const polygonBox = { x: left, y: top, w: right - left, h: bottom - top };
      // 枠線追跡が人物・背景線へ逸れた場合だけ、同じpanelレコード内のRT-DETR矩形へ戻す。
      shape = boxIntersectionOverUnion(polygonBox, detectorBox) < 0.72
        ? normalizedBoxToPanelShape(detectorBox)
        : {
            type: 'polygon',
            points: rawPoints.map(([x, y]) => [roundMm(clamp(x, 0, 1) * 210), roundMm(clamp(y, 0, 1) * 297)]),
          };
    } else if (rawShape.type === 'rect') {
      const rect = normalizedPanelBox([rawShape.x, rawShape.y, rawShape.w, rawShape.h]);
      if (!rect) throw new Error(`ローカルbridgeのコマ${index + 1}の矩形が壊れています。bridgeを再起動してください。`);
      shape = normalizedBoxToPanelShape(rect);
    } else {
      throw new Error(`ローカルbridgeのコマ${index + 1}の形状種別が正しくありません。bridgeを再起動してください。`);
    }
    return { id, shape };
  });
  const structure = payload.structure && typeof payload.structure === 'object'
    ? payload.structure as Record<string, unknown>
    : {};
  const ocr = payload.ocr && typeof payload.ocr === 'object'
    ? payload.ocr as Record<string, unknown>
    : {};
  const people = payload.people && typeof payload.people === 'object'
    ? payload.people as Record<string, unknown>
    : {};
  const ocrLines = (Array.isArray(ocr.lines) ? ocr.lines : []).flatMap((entry, index): RecognizedTextLine[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const rawBox = Array.isArray(item.bbox) ? item.bbox.map(Number) : [];
    if (rawBox.length !== 4 || rawBox.some((value) => !Number.isFinite(value))) return [];
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    const unreadable = item.unreadable === true;
    if (!text && !unreadable) return [];
    const [x, y, w, h] = rawBox;
    const rawLineConfidence = Number(item.confidence);
    return [{
      id: typeof item.id === 'string' && item.id ? item.id : `ocr-${index}`,
      text,
      bbox: {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
        w: Math.min(1, Math.max(0, w)),
        h: Math.min(1, Math.max(0, h)),
      },
      confidence: Number.isFinite(rawLineConfidence) ? Math.min(1, Math.max(0, rawLineConfidence)) : 0,
      vertical: item.vertical === true,
      source: typeof item.source === 'string' ? item.source : 'rtdetr-text',
      needsReview: item.needs_review !== false,
      ...(unreadable ? { unreadable: true } : {}),
      ...(typeof item.group_id === 'string' && item.group_id.trim() ? { groupId: item.group_id.trim() } : {}),
    }];
  });
  const normalizedFigureRegions = (Array.isArray(people.regions) ? people.regions : []).flatMap((entry): DetectedFigureRegion[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const source = item.source === 'face' ? 'face' : item.source === 'body' ? 'body' : null;
    const rawBox = Array.isArray(item.bbox) ? item.bbox.map(Number) : [];
    if (!source || rawBox.length !== 4 || rawBox.some((value) => !Number.isFinite(value))) return [];
    const [rawX, rawY, rawWidth, rawHeight] = rawBox;
    const left = clamp(rawX, 0, 1);
    const top = clamp(rawY, 0, 1);
    const right = clamp(rawX + rawWidth, 0, 1);
    const bottom = clamp(rawY + rawHeight, 0, 1);
    if (right - left < 0.005 || bottom - top < 0.005) return [];
    const rawConfidence = Number(item.confidence ?? item.score);
    return [{
      id: typeof item.id === 'string' ? item.id.trim() : '',
      source,
      bbox: {
        x: Number(left.toFixed(6)),
        y: Number(top.toFixed(6)),
        w: Number((right - left).toFixed(6)),
        h: Number((bottom - top).toFixed(6)),
      },
      ...(Number.isFinite(rawConfidence) ? { confidence: clamp(rawConfidence, 0, 1) } : {}),
    }];
  }).sort((left, right) => Number(left.source === 'face') - Number(right.source === 'face')
    || left.bbox.y - right.bbox.y || right.bbox.x - left.bbox.x);
  const uniqueFigureRegions = normalizedFigureRegions.filter((candidate, index) => !normalizedFigureRegions.slice(0, index).some((kept) => {
    const intersection = overlapArea(candidate.bbox, kept.bbox);
    const candidateArea = candidate.bbox.w * candidate.bbox.h;
    const keptArea = kept.bbox.w * kept.bbox.h;
    const union = candidateArea + keptArea - intersection;
    const smaller = Math.min(candidateArea, keptArea);
    return smaller > 0 && (intersection / smaller >= 0.88 || (union > 0 && intersection / union >= 0.58));
  })).map((region, index) => ({
    ...region,
    id: region.id || `figure-${String(index + 1).padStart(3, '0')}`,
  }));
  const indexesToKeep = detectedPanelIndexesToKeep(rawPanelRegions.map((region) => region.shape));
  const keptPanelRegions = indexesToKeep.map((index) => rawPanelRegions[index]);
  const sourceFrame = detectedSourceFrame(keptPanelRegions.map((region) => region.shape));
  // 所属は直線化・内枠対応・溝調整より前の検出形状で固定する。
  const ownershipPanels: Panel[] = keptPanelRegions.map((region, index) => ({
    id: index + 1,
    shape: structuredClone(region.shape),
    bg: 0,
    bubbles: [],
    action: null,
  }));
  const sourceOwnerForBox = (box: BBox, confidence: number, allowPageOverlay: boolean, allowOutsidePanels: boolean): { sourcePanelId?: string; pageOverlay?: true } => {
    if (!ownershipPanels.length) return {};
    const canvasBox = sourceFrameBoxToCanvas(box, null, 210, 297);
    const owner = nearestPanel(
      ownershipPanels,
      canvasBox.x + canvasBox.w / 2,
      canvasBox.y + canvasBox.h / 2,
    );
    if (allowPageOverlay && belongsToPageOverlay(ownershipPanels, canvasBox, confidence, allowOutsidePanels, owner)) return { pageOverlay: true };
    const ownerIndex = owner ? ownershipPanels.indexOf(owner) : -1;
    return ownerIndex >= 0 ? { sourcePanelId: keptPanelRegions[ownerIndex].id } : {};
  };
  const ownedOcrLines = ocrLines.map((line) => {
    // OCRの文字bboxは斜めコマ境界をまたぎやすい。外形検出なしでページ前景へ昇格させない。
    const owner = sourceOwnerForBox(line.bbox, line.confidence, false, false);
    return { ...line, ...owner };
  });
  const detectedFigures = uniqueFigureRegions.map((region) => {
    const owner = sourceOwnerForBox(region.bbox, region.confidence ?? 0, true, true);
    return { ...region, ...owner };
  });
  const editingShapes = keptPanelRegions.map((region) => straightenNearRectShape(region.shape));
  const calibratedPanels = sourceFrame
    ? editingShapes.map((shape) => sourceFrameShapeToInnerFrame(shape, sourceFrame))
    : editingShapes;
  const detectedPanels = normalizeDetectedPanelGeometry(calibratedPanels, gutterSettings);
  const detectedPanelIds = keptPanelRegions.map((region) => region.id);
  const removedPanelCount = rawPanelRegions.length - detectedPanels.length;
  const baseReason = removedPanelCount > 0
    ? `重複する候補を${removedPanelCount}個除外し、${detectedPanels.length}個のコマ領域を編集開始位置として使用します。`
    : typeof payload.reason === 'string' && payload.reason.trim()
      ? payload.reason.trim()
      : detectedPanels.length ? '検出したコマ領域を編集開始位置として使用できます。' : '読み取れるコマ領域を特定できませんでした。';
  const reason = detectedPanels.length
    ? `${baseReason} ${sourceFrame ? '検出原稿の外枠を内枠へ対応させ、' : '内枠内へ収め、'}4mm以内の辺を整列し、コマ間は上下${roundMm(clamp(gutterSettings.rowGapMm, 0, 20))}mm・左右${roundMm(clamp(gutterSettings.columnGapMm, 0, 20))}mmに整えています。`
    : baseReason;
  const detectedPanelCount = detectedPanels.length;
  return {
    detectedPanels,
    detectedPanelIds,
    detectedFigures,
    sourceFrame,
    reason,
    detectedPanelCount,
    structureEngine: typeof structure.engine === 'string' ? structure.engine : '',
    excludedNonPanelCount: Math.max(0, Math.round(
      (Number(structure.excluded_as_text_count) || 0)
      + (Number(structure.excluded_as_face_count) || 0)
      + (Number(structure.excluded_as_body_count) || 0)
      + (Number(structure.excluded_as_header_count) || 0),
    )) + Math.max(0, removedPanelCount),
    detectedTextRegionCount: Math.max(0, Math.round(Number(structure.text_region_count) || 0)),
    detectedFaceRegionCount: Math.max(0, Math.round(Number(structure.face_region_count) || 0)),
    detectedBodyRegionCount: Math.max(0, Math.round(Number(structure.body_region_count) || 0)),
    ocrEngine: typeof ocr.engine === 'string' ? ocr.engine : '',
    ocrLines: ownedOcrLines,
  };
}

function nearestPanel(panels: Panel[], x: number, y: number): Panel | undefined {
  const containing = panels.filter((panel) => pointInPanel(panel, x, y)).sort((left, right) => {
    const leftBounds = panelBounds(left);
    const rightBounds = panelBounds(right);
    return leftBounds.w * leftBounds.h - rightBounds.w * rightBounds.h;
  });
  return containing[0] ?? [...panels].sort((left, right) => {
    const distance = (panel: Panel) => {
      const bounds = panelBounds(panel);
      const nearestX = clamp(x, bounds.x, bounds.x + bounds.w);
      const nearestY = clamp(y, bounds.y, bounds.y + bounds.h);
      return (x - nearestX) ** 2 + (y - nearestY) ** 2;
    };
    return distance(left) - distance(right);
  })[0];
}

function ensurePageOverlay(page: MangaPage) {
  return page.page_overlay ??= { frame: false, layer: 'above_panel_frames' };
}

/** 人物検出領域を紙面座標へ変換し、所属コマまたはページ前景へ編集可能な人物あたりとして追加する。 */
export function attachDetectedFiguresToPage(
  page: MangaPage,
  regions: readonly DetectedFigureRegion[],
  analogImports?: ReadonlyMap<string, AnalogFigureImport>,
  sourceFrame: BBox | null = null,
  ownerPanels?: ReadonlyMap<string, Panel>,
): { added: number } {
  let added = 0;
  for (const region of regions) {
    if (!page.panels.length) continue;
    const sourceBox = sourceFrameBoxToCanvas(region.bbox, sourceFrame, page.canvas.w, page.canvas.h);
    const centerX = sourceBox.x + sourceBox.w / 2;
    const centerY = sourceBox.y + sourceBox.h / 2;
    const panel = !region.pageOverlay && region.sourcePanelId && ownerPanels
      ? ownerPanels.get(region.sourcePanelId) ?? nearestPanel(page.panels, centerX, centerY)
      : region.pageOverlay ? undefined : nearestPanel(page.panels, centerX, centerY);
    if (!panel && !region.pageOverlay) continue;
    const bounds = panel ? panelBounds(panel) : { x: 0, y: 0, w: page.canvas.w, h: page.canvas.h };
    const width = Math.min(page.canvas.w, Math.max(6, sourceBox.w));
    const height = Math.min(page.canvas.h, Math.max(6, sourceBox.h));
    const bbox: BBox = {
      x: roundMm(clamp(sourceBox.x, 0, page.canvas.w - width)),
      y: roundMm(clamp(sourceBox.y, 0, page.canvas.h - height)),
      w: roundMm(width),
      h: roundMm(height),
    };
    const targetFigures = region.pageOverlay ? (ensurePageOverlay(page).figures ??= []) : (panel!.figures ??= []);
    const duplicate = targetFigures.some((figure) => {
      if (!figure.bbox) return false;
      const intersection = overlapArea(bbox, figure.bbox);
      const smaller = Math.min(bbox.w * bbox.h, figure.bbox.w * figure.bbox.h);
      return smaller > 0 && intersection / smaller >= 0.78;
    });
    if (duplicate) continue;
    const analogImport = analogImports?.get(region.id);
    targetFigures.push({
      name: DETECTED_FIGURE_NAME,
      bbox,
      role: 'main',
      ...(panel ? { anchor: nearestAnchor(bounds, bbox) } : {}),
      size: region.source === 'face' ? 'face' : 'bust-up',
      ...(analogImport ? { analogImport: structuredClone(analogImport) } : {}),
    });
    if (panel) delete panel.no_figures;
    added += 1;
  }
  return { added };
}

/** OCR領域を紙面座標へ変換し、所属コマまたはページ前景へ編集可能なフキダシとして追加する。 */
export function attachRecognizedTextToPage(
  page: MangaPage,
  lines: readonly RecognizedTextLine[],
  analogImports?: ReadonlyMap<string, AnalogTextImport>,
  sourceFrame: BBox | null = null,
  ownerPanels?: ReadonlyMap<string, Panel>,
): { added: number; needsReview: number } {
  let added = 0;
  let needsReview = 0;
  for (const line of groupRecognizedTextLines(lines)) {
    if ((!line.text.trim() && !line.unreadable) || !page.panels.length) continue;
    const sourceBox = sourceFrameBoxToCanvas(line.bbox, sourceFrame, page.canvas.w, page.canvas.h);
    const centerX = sourceBox.x + sourceBox.w / 2;
    const centerY = sourceBox.y + sourceBox.h / 2;
    const panel = !line.pageOverlay && line.sourcePanelId && ownerPanels
      ? ownerPanels.get(line.sourcePanelId) ?? nearestPanel(page.panels, centerX, centerY)
      : line.pageOverlay ? undefined : nearestPanel(page.panels, centerX, centerY);
    if (!panel && !line.pageOverlay) continue;
    const width = Math.min(page.canvas.w, Math.max(6, sourceBox.w));
    const height = Math.min(page.canvas.h, Math.max(6, sourceBox.h));
    const bbox: BBox = {
      x: roundMm(clamp(sourceBox.x, 0, page.canvas.w - width)),
      y: roundMm(clamp(sourceBox.y, 0, page.canvas.h - height)),
      w: roundMm(width),
      h: roundMm(height),
    };
    const analogImport = analogImports?.get(recognizedTextOwnerKey(line));
    const targetBubbles = line.pageOverlay ? (ensurePageOverlay(page).bubbles ??= []) : panel!.bubbles;
    const bubble: Bubble = {
      text: line.text.trim(),
      shape: 'normal',
      bbox,
      ...(analogImport ? { analogTextImport: structuredClone(analogImport) } : {}),
    };
    targetBubbles.push(bubble);
    added += 1;
    if (line.needsReview) needsReview += 1;
  }
  return { added, needsReview };
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

function dataUrlBlob(value: unknown): Blob | null {
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

/** 明示操作時だけ、保存済みの人物切り抜き1枚をlocalhostのVLMへ渡す。 */
export async function analyzeFigurePerformanceWithLocalVlm(
  blob: Blob,
  currentSize: FigureSize,
): Promise<FigurePerformanceSuggestion> {
  const payload = await postJson('/api/figure-performance/analyze', {
    image: await blobDataUrl(blob),
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
  if (!action || action.length > 800 || !analysis || !analyzer
    || analyzer.provider !== 'local' || analyzer.runtime !== 'mlx-vlm') {
    throw new Error('人物演技の解析結果形式が正しくありません');
  }
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
  candidates: readonly CharacterMatchCandidateRequest[],
  currentSize: FigureSize,
): Promise<CharacterMatchSuggestion> {
  const payload = await postJson('/api/character-match/analyze', {
    image: await blobDataUrl(blob),
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      aliases: candidate.aliases,
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
  if (!action || action.length > 800 || !analysis) {
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
    if (blob.size > 40 * 1024 * 1024 || width < 1 || height < 1 || width > 12000 || height > 12000 || width * height > 60_000_000) throw new Error('人物資料画像の寸法・容量が上限を超えています');
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
  const selectedWorkflow=Boolean(value&&value.status==='succeeded'&&typeof value.workflow_id==='string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.workflow_id)
    && Number.isInteger(value.selected_candidate)&&Number(value.selected_candidate)>=1&&Number(value.selected_candidate)<=5);
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
  if(typeof value.workflow_name==='string')job.workflowName=value.workflow_name;
  if(typeof value.workflow_id==='string')job.workflowId=value.workflow_id;
  if(typeof value.workflow_version==='number')job.workflowVersion=value.workflow_version;
  if(typeof value.comfyui_url==='string')job.comfyuiUrl=value.comfyui_url;
  if(typeof value.generation_prompt==='string')job.generationPrompt=value.generation_prompt;
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
export async function selectQwenCandidate(job:import('./qwenGeneration.ts').QwenJob,index:number){
  return decodeQwenJob(await postJson('/api/qwen-generation/select',{job_id:job.jobId,candidate_index:index},30_000),job.jobId,job.requestSha256);
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
