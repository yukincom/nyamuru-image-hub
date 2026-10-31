import { currentLocalModelPreferences } from './localModelPreferences.ts';
import { serviceUrl } from './clientRuntime.ts';

const DEFAULT_SUPERVISOR_URL = 'http://127.0.0.1:8786';
const SUPERVISOR_SERVICE = 'nyamuru-image-hub-bridge-supervisor';
const SUPERVISOR_PROTOCOL_VERSION = 1;

export interface NewCreationBridgeSession {
  token: string;
  bridgeStarted: boolean;
  bridgeManaged: boolean;
}

function supervisorUrl(path: string): string {
  const gateway = serviceUrl('supervisor', path);
  if (gateway) return gateway;
  const configured = import.meta.env?.PUBLIC_NYAMURU_BRIDGE_SUPERVISOR_URL?.trim();
  return `${configured || DEFAULT_SUPERVISOR_URL}${path}`;
}

async function lifecycleRequest(
  path: string,
  body: object,
  fetchImpl: typeof fetch,
  timeoutMs = 25_000,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(supervisorUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `ローカル連携の起動管理に失敗しました（HTTP ${response.status}）`);
    }
    if (payload.service !== SUPERVISOR_SERVICE || payload.protocol_version !== SUPERVISOR_PROTOCOL_VERSION) {
      throw new Error('ローカル連携の起動管理が古いか別のアプリです');
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('ローカル連携の起動が時間内に完了しませんでした');
    }
    if (error instanceof TypeError) {
      throw new Error('ローカル連携を自動起動できません。Nyamuru Image Hubをローカル起動版で開き直してください');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function startNewCreationBridgeSession(
  fetchImpl: typeof fetch = fetch,
): Promise<NewCreationBridgeSession> {
  const payload = await lifecycleRequest('/api/new-creation/start', {}, fetchImpl);
  const token = typeof payload.lease_token === 'string' ? payload.lease_token : '';
  if (!token) throw new Error('ローカル連携の終了情報を受け取れませんでした');
  return {
    token,
    bridgeStarted: payload.bridge_started === true,
    bridgeManaged: payload.bridge_managed === true,
  };
}

export async function stopNewCreationBridgeSession(
  token: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 25_000,
  shutdown = false,
): Promise<{ released: boolean; stopped: boolean; llmReleased: boolean; llmStopped: boolean }> {
  if (!token) return { released: false, stopped: false, llmReleased: false, llmStopped: false };
  const payload = await lifecycleRequest('/api/new-creation/stop', { lease_token: token, ...(shutdown ? { shutdown: true } : {}) }, fetchImpl, timeoutMs);
  return {
    released: payload.released === true,
    stopped: payload.stopped === true,
    llmReleased: payload.llm_released === true,
    llmStopped: payload.llm_stopped === true,
  };
}

export async function submitImageGenerationRequest(token: string, payload: object, fetchImpl: typeof fetch = fetch) {
  return lifecycleRequest('/api/image-generation/submit', { lease_token: token, payload }, fetchImpl, 190_000);
}

/** One lease spans translation, image submission/completion, and restoration of the original server. */
export async function withImageGenerationServices<T, R>(
  translate: () => Promise<T>,
  generate: (translated: T, token: string) => Promise<R>,
  { onPhase = () => {}, isCurrent = () => true, llmModelAlias = currentLocalModelPreferences().llmAlias, requiresLlm = true }: {
    onPhase?: (phase: 'bridge' | 'llm' | 'translate' | 'suspend' | 'generate' | 'restore') => void;
    isCurrent?: () => boolean;
    llmModelAlias?: string;
    requiresLlm?: boolean;
  } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<R | undefined> {
  onPhase('bridge');
  const session = await startNewCreationBridgeSession(fetchImpl);
  let pageExited = false;
  const onExit = () => { pageExited = true; stopNewCreationBridgeSessionOnPageExit(session.token); };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onExit, { once: true });
  let prepared = false;
  let suspended = false;
  let failure: unknown;
  try {
    if (!isCurrent() || pageExited) return;
    if(requiresLlm){
      onPhase('llm');
      await lifecycleRequest('/api/panel-actions/prepare', {
        lease_token: session.token,
        llm_model_alias: llmModelAlias.trim() || currentLocalModelPreferences().llmAlias,
      }, fetchImpl, 135_000);
      prepared = true;
    }
    if (!isCurrent() || pageExited) return;
    onPhase('translate');
    const translated = await translate();
    if (!isCurrent() || pageExited) return;
    onPhase('suspend');
    const result = await lifecycleRequest('/api/image-generation/prepare', { lease_token: session.token, ...(!requiresLlm?{requires_llm:false}:{}) }, fetchImpl, 70_000);
    if (result.llm_stopped !== true) throw new Error('文章LLMの一時停止を確認できませんでした');
    suspended = true;
    if (!isCurrent() || pageExited) return;
    onPhase('generate');
    return await generate(translated, session.token);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      if (suspended && !pageExited) onPhase('restore');
      const result = await stopNewCreationBridgeSession(session.token, fetchImpl, 150_000, pageExited);
      if (prepared && !result.llmReleased) throw new Error('文章LLMの利用終了を確認できませんでした');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(failure ? `${failure instanceof Error ? failure.message : String(failure)}\n${message}` : message);
    } finally {
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onExit);
    }
  }
}

export async function withNewCreationBridgeSession<T>(
  task: () => Promise<T>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const session = await startNewCreationBridgeSession(fetchImpl);
  try {
    return await task();
  } finally {
    await stopNewCreationBridgeSession(session.token, fetchImpl).catch(() => undefined);
  }
}

export function stopNewCreationBridgeSessionOnPageExit(token: string): void {
  if (!token || typeof navigator === 'undefined') return;
  const body = JSON.stringify({ lease_token: token, shutdown: true });
  if (typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(supervisorUrl('/api/new-creation/stop'), new Blob([body], { type: 'text/plain' }));
    return;
  }
  void fetch(supervisorUrl('/api/new-creation/stop'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export async function withPanelActionServices<T>(
  task: () => Promise<T>,
  { onPhase = () => {}, isCurrent = () => true, llmModelAlias = currentLocalModelPreferences().llmAlias }: {
    onPhase?: (phase: 'bridge' | 'llm' | 'ready') => void;
    isCurrent?: () => boolean;
    llmModelAlias?: string;
  } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T | undefined> {
  onPhase('bridge');
  const session = await startNewCreationBridgeSession(fetchImpl);
  const onExit = () => stopNewCreationBridgeSessionOnPageExit(session.token);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onExit, { once: true });
  let taskCompleted = false;
  try {
    if (!isCurrent()) return;
    onPhase('llm');
    await lifecycleRequest('/api/panel-actions/prepare', {
      lease_token: session.token,
      llm_model_alias: llmModelAlias.trim() || currentLocalModelPreferences().llmAlias,
    }, fetchImpl, 135_000);
    if (!isCurrent()) return;
    onPhase('ready');
    const result = await task();
    taskCompleted = true;
    return result;
  } finally {
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onExit);
    try {
      const released = await stopNewCreationBridgeSession(session.token, fetchImpl);
      if (taskCompleted && !released.llmReleased) {
        throw new Error('文章LLMの利用終了を確認できませんでした');
      }
    } catch (error) {
      if (taskCompleted) {
        throw error instanceof Error ? error : new Error('文章LLMの終了を確認できませんでした');
      }
    }
  }
}
