import { serviceUrl, isLanClient } from '../clientRuntime.ts';
import { withNewCreationBridgeSession } from '../localBridgeLifecycle.ts';
import { LAYOUT_PROTOCOL_VERSION } from '../recognition/layoutResult.ts';

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787';
const REQUEST_TIMEOUT_MS = 210_000;

const BRIDGE_SERVICE_NAME = 'nyamuru-image-hub-local-bridge';

export const PANEL_DRAFT_MAX_PNG_BYTES = 20 * 1024 * 1024;

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

export function bridgeUrl(path: string): string {
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

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export async function verifiedPngSha256(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < PNG_SIGNATURE.length
    || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error('保存済みの人物資料画像がPNG形式ではありません');
  }
  if (!globalThis.crypto?.subtle) throw new Error('人物資料画像の整合性を確認できません');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function postJson(path: string, body: object, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  if (isLanClient) return withNewCreationBridgeSession(() => postBridgeJson(path, body, timeoutMs));
  return postBridgeJson(path, body, timeoutMs);
}

export async function postBridgeJson(path: string, body: object, timeoutMs: number): Promise<unknown> {
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
