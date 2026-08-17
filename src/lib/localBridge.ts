import type { PanelTemplate } from './panelTemplates';

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';
const REQUEST_TIMEOUT_MS = 180_000;

export interface LayoutRecognitionResult {
  templateId: string | null;
  confidence: number;
  reason: string;
}

interface BridgeLayoutResponse {
  template_id?: unknown;
  confidence?: unknown;
  reason?: unknown;
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
  return { templateId, confidence, reason };
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
      throw new Error('VLMの応答が時間内に返りませんでした');
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

export async function openMacScanner(): Promise<void> {
  await postJson('/api/scanner/open', {}, 10_000);
}
