import { PANEL_DRAFT_PROFILE, MANGA_BASE_PALETTE, type PanelDraftPlan } from '../panelDraft.ts';
import { PANEL_DRAFT_MAX_PNG_BYTES, PNG_SIGNATURE, postJson } from './transport.ts';

const PANEL_DRAFT_UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

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
