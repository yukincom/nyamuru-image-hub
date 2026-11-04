import { DEFAULT_PANEL_GUTTERS, type PanelGutterSettings } from '../canvasGeometry.ts';
import {
  normalizeLayoutRecognition,
  type LayoutRecognitionResult,
  type BridgeLayoutResponse,
} from '../recognition/layoutResult.ts';
import { postJson } from './transport.ts';
import type { SourceCoverageReport } from '../sourceCoverage.ts';

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
