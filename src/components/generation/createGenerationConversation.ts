import {
  runGenerationConversation,
  type GenerationConversationContext,
  type GenerationConversationInput,
} from '../../lib/generationConversation.ts';
import { requestAgentReply, withAgentServices } from '../../lib/localBridge.ts';
import { qwenConversationIntent } from '../../lib/qwenGeneration.ts';
import type { createGenerationActions } from './createGenerationActions.ts';
import { generationReadinessMessage, type GenerationReadiness } from '../../lib/generation/readiness.ts';

interface GenerationConversationOptions {
  isAlive: () => boolean;
  isCurrent: () => boolean;
  isWorking: () => boolean;
  readiness: () => GenerationReadiness;
  snapshot: () => GenerationConversationContext;
  update: (value: string, expected: string) => void;
  operation: <T>(task: () => Promise<T>, propagate?: boolean) => Promise<T | undefined>;
  generate: ReturnType<typeof createGenerationActions>['generate'];
  cloud: boolean;
  label: string;
}

/** Connect the existing dialog operation and generation paths to agent conversation. */
export function createGenerationConversation(options: GenerationConversationOptions) {
  return async function conversationSend(
    text: string,
    isCurrent: () => boolean,
    input?: GenerationConversationInput,
  ): Promise<string> {
    if (!options.isAlive() || !options.isCurrent() || !isCurrent()) return '生成の会話を終了しました';
    const readiness = options.readiness();
    // Image execution owns the model lease. Report facts without another LLM or generation request.
    if (options.isWorking()) return generationReadinessMessage(readiness);
    const intent = qwenConversationIntent(text);
    if (intent !== 'generate' || !readiness.ready) {
      return (await options.operation(() => runGenerationConversation({
        text,
        input: input ?? { history: [], profile: { name: 'にゃむる', tone: '' } },
        isCurrent: () => options.isCurrent() && isCurrent(),
        snapshot: options.snapshot,
        update: options.update,
        reply: requestAgentReply,
        services: withAgentServices,
        ...(intent === 'generate' ? { notice: readiness } : {}),
      }), true))!;
    }
    const result = await options.generate(true, isCurrent);
    if (options.cloud) return '指示と参照画像のZIPを保存しました。指定のエージェントへ渡し、完成したPNGをこの画面で読み込んでください。';
    if (result?.job?.candidates?.length) {
      if (result.job.status === 'succeeded' && result.job.candidates.length === 5) {
        return `${options.label}の候補を5枚生成しました。画面で採用する画像を選んでください。`;
      }
      return `候補${result.job.candidates.length}枚を保持しています。${result.job.error || '生成は完了していません。状態を自動で確認しています。'}`;
    }
    return result?.inserted
      ? `${options.label}を生成し、新規レイヤーとして追加しました。元に戻す操作も使えます。`
      : '自動差し込みは中止しました。';
  };
}
