import type { PanelTemplate } from './panelTemplates';
import { clamp, nearestAnchor, panelBounds, pointInPanel, roundMm } from './canvasGeometry.ts';
import type { BBox, MangaPage, Panel } from '../types';

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';
const REQUEST_TIMEOUT_MS = 180_000;

export interface LayoutRecognitionResult {
  templateId: string | null;
  confidence: number;
  reason: string;
  rotationDegrees: 0 | 90 | 180 | 270;
  detectedPanelCount: number;
  structureEngine: string;
  ocrEngine: string;
  ocrLines: RecognizedTextLine[];
  qwenMode: 'off' | 'auto' | 'compare';
  qwenOrientationUsed: boolean;
  qwenLayoutUsed: boolean;
  qwenLayoutAgreed: boolean | null;
  qwenOcrUsed: boolean;
  qwenOcrChanged: number;
}

export interface RecognizedTextLine {
  id: string;
  text: string;
  bbox: BBox;
  confidence: number;
  vertical: boolean;
  source: string;
  needsReview: boolean;
  qwenText?: string;
}

interface BridgeLayoutResponse {
  template_id?: unknown;
  confidence?: unknown;
  reason?: unknown;
  rotation_degrees?: unknown;
  detected_panel_count?: unknown;
  structure?: unknown;
  ocr?: unknown;
  qwen?: unknown;
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

export interface ResumedScannerSession {
  session: ScannerSession;
  files: ScannedImage[];
}

function bridgeUrl(path: string): string {
  const configured = import.meta.env.PUBLIC_NYAMURU_BRIDGE_URL?.trim();
  return `${configured || DEFAULT_BRIDGE_URL}${path}`;
}

export function normalizeLayoutRecognition(
  payload: BridgeLayoutResponse,
  validTemplateIds: readonly string[],
): LayoutRecognitionResult {
  const rawId = typeof payload.template_id === 'string' ? payload.template_id.trim().toUpperCase() : '';
  const templateId = validTemplateIds.includes(rawId) ? rawId : null;
  const rawConfidence = typeof payload.confidence === 'number' ? payload.confidence : Number(payload.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0;
  const reason = typeof payload.reason === 'string' && payload.reason.trim()
    ? payload.reason.trim()
    : templateId ? '画像内のコマ枠配置に最も近い候補です。' : '近いコマ割りを特定できませんでした。';
  const rawRotation = Number(payload.rotation_degrees);
  const rotationDegrees = ([0, 90, 180, 270] as const).find((value) => value === rawRotation) ?? 0;
  const detectedPanelCount = Math.max(0, Math.round(Number(payload.detected_panel_count) || 0));
  const structure = payload.structure && typeof payload.structure === 'object'
    ? payload.structure as Record<string, unknown>
    : {};
  const ocr = payload.ocr && typeof payload.ocr === 'object'
    ? payload.ocr as Record<string, unknown>
    : {};
  const qwen = payload.qwen && typeof payload.qwen === 'object'
    ? payload.qwen as Record<string, unknown>
    : {};
  const qwenLayout = qwen.layout && typeof qwen.layout === 'object'
    ? qwen.layout as Record<string, unknown>
    : {};
  const qwenMode = qwen.mode === 'off' || qwen.mode === 'compare' ? qwen.mode : 'auto';
  const ocrLines = (Array.isArray(ocr.lines) ? ocr.lines : []).flatMap((entry, index): RecognizedTextLine[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const rawBox = Array.isArray(item.bbox) ? item.bbox.map(Number) : [];
    if (rawBox.length !== 4 || rawBox.some((value) => !Number.isFinite(value))) return [];
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) return [];
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
      source: typeof item.source === 'string' ? item.source : 'ndlocr',
      needsReview: item.needs_review !== false,
      ...(typeof item.qwen_text === 'string' && item.qwen_text.trim() ? { qwenText: item.qwen_text.trim() } : {}),
    }];
  });
  return {
    templateId,
    confidence,
    reason,
    rotationDegrees,
    detectedPanelCount,
    structureEngine: typeof structure.engine === 'string' ? structure.engine : '',
    ocrEngine: typeof ocr.engine === 'string' ? ocr.engine : '',
    ocrLines,
    qwenMode,
    qwenOrientationUsed: qwen.orientation_used === true,
    qwenLayoutUsed: qwenLayout.used === true,
    qwenLayoutAgreed: typeof qwenLayout.agreed === 'boolean' ? qwenLayout.agreed : null,
    qwenOcrUsed: qwen.ocr_used === true,
    qwenOcrChanged: Math.max(0, Math.round(Number(qwen.ocr_changed) || 0)),
  };
}

function nearestPanel(panels: Panel[], x: number, y: number): Panel | undefined {
  return panels.find((panel) => pointInPanel(panel, x, y)) ?? [...panels].sort((left, right) => {
    const distance = (panel: Panel) => {
      const bounds = panelBounds(panel);
      const nearestX = clamp(x, bounds.x, bounds.x + bounds.w);
      const nearestY = clamp(y, bounds.y, bounds.y + bounds.h);
      return (x - nearestX) ** 2 + (y - nearestY) ** 2;
    };
    return distance(left) - distance(right);
  })[0];
}

/** OCR領域を紙面座標へ変換し、中心が入る（または最も近い）コマへ編集可能なフキダシとして追加する。 */
export function attachRecognizedTextToPage(
  page: MangaPage,
  lines: readonly RecognizedTextLine[],
): { added: number; needsReview: number } {
  let added = 0;
  let needsReview = 0;
  for (const line of lines) {
    if (!line.text.trim() || !page.panels.length) continue;
    const sourceBox = {
      x: line.bbox.x * page.canvas.w,
      y: line.bbox.y * page.canvas.h,
      w: line.bbox.w * page.canvas.w,
      h: line.bbox.h * page.canvas.h,
    };
    const centerX = sourceBox.x + sourceBox.w / 2;
    const centerY = sourceBox.y + sourceBox.h / 2;
    const panel = nearestPanel(page.panels, centerX, centerY);
    if (!panel) continue;
    const bounds = panelBounds(panel);
    const width = Math.min(bounds.w, Math.max(6, sourceBox.w));
    const height = Math.min(bounds.h, Math.max(6, sourceBox.h));
    const bbox: BBox = {
      x: roundMm(clamp(sourceBox.x, bounds.x, bounds.x + bounds.w - width)),
      y: roundMm(clamp(sourceBox.y, bounds.y, bounds.y + bounds.h - height)),
      w: roundMm(width),
      h: roundMm(height),
    };
    panel.bubbles.push({
      text: line.text.trim(),
      shape: 'normal',
      bbox,
      anchor: nearestAnchor(bounds, bbox),
    });
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

async function postJson(path: string, body: object, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(bridgeUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as { error?: unknown };
    if (!response.ok) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `ローカル連携に失敗しました（HTTP ${response.status}）`);
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('ローカル画像解析の応答が時間内に返りませんでした');
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
  templates: readonly PanelTemplate[],
): Promise<LayoutRecognitionResult> {
  const payload = await postJson('/api/layout/analyze', {
    filename: file.name,
    image: await imageDataUrl(file),
    candidates: templates.map(({ id, name, usage, shapes }) => ({ id, name, usage, shapes })),
  }) as BridgeLayoutResponse;
  return normalizeLayoutRecognition(payload, templates.map((template) => template.id));
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
