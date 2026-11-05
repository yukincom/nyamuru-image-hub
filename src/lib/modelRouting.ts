import type { ConversationPreferences } from './conversationPreferences.ts';
import type { GenerationPreferences } from './generationPreferences.ts';
import type { LocalModelPreferences } from './localModelPreferences.ts';
import { cloudContentAccess } from './modelPrivacy.ts';

type UnavailableRoute = { kind: 'unavailable'; reason: 'adult-terms-required' | 'api-unavailable'; message: string };
export type ConversationRoute = { kind: 'local'; llmAlias: string } | UnavailableRoute;
export type GenerationRoute = { kind: 'local'; workflowId: string; comfyuiUrl: string }
  | { kind: 'external-agent'; agent: 'codex' | 'other'; label: string } | UnavailableRoute;

function contentRestriction(cloud: GenerationPreferences['cloud'], adultContent: boolean): UnavailableRoute | undefined {
  if (!cloudContentAccess(cloud, adultContent).allowed) return {
    kind: 'unavailable', reason: 'adult-terms-required', message: '環境設定でクラウドの成人向け利用条件を確認してください',
  };
}

/** Pure snapshots: later setting edits cannot change an in-flight route. No automatic fallback. */
export function resolveConversationRoute(
  preferences: ConversationPreferences, local: LocalModelPreferences,
  cloud: GenerationPreferences['cloud'], adultContent = false,
): ConversationRoute {
  if (preferences.execution === 'local') return { kind: 'local', llmAlias: local.llmAlias };
  return contentRestriction(cloud, adultContent) ?? {
    kind: 'unavailable', reason: 'api-unavailable', message: '会話・翻訳のAPIは未接続です。環境設定でローカルを選んでください',
  };
}

export function resolveGenerationRoute(
  preferences: GenerationPreferences, local: LocalModelPreferences, adultContent = false,
): GenerationRoute {
  if (preferences.execution === 'local') return { kind: 'local', workflowId: preferences.local.workflowId, comfyuiUrl: local.comfyuiUrl };
  const restriction = contentRestriction(preferences.cloud, adultContent);
  if (restriction) return restriction;
  if (preferences.cloud.method === 'api') return {
    kind: 'unavailable', reason: 'api-unavailable', message: '画像生成のAPIは未接続です。環境設定でローカルまたは外部エージェントを選んでください',
  };
  return { kind: 'external-agent', agent: preferences.cloud.agent,
    label: preferences.cloud.agent === 'codex' ? 'Codex' : preferences.cloud.agentName || '指定のエージェント' };
}
