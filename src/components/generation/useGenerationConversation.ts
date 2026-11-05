import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { QwenGenerationConversation } from '../../lib/qwenGeneration.ts';
import { createGenerationConversation } from './createGenerationConversation.ts';
import { generationReadinessMessage } from '../../lib/generation/readiness.ts';

/** Published send functions always read the current dialog, even before the next effect. */
export function useGenerationConversation(
  view: Omit<QwenGenerationConversation, 'send' | 'pendingStatus'>,
  onConversation: ((value: QwenGenerationConversation | null) => void) | undefined,
  options: Parameters<typeof createGenerationConversation>[0],
) {
  const latest = useRef(options);
  latest.current = options;
  const send = useCallback<QwenGenerationConversation['send']>(
    (...args) => createGenerationConversation(latest.current)(...args), [],
  );
  const pendingStatus = useCallback(() => {
    const current = latest.current;
    return current.isAlive() && current.isCurrent() && current.isWorking()
      ? generationReadinessMessage(current.readiness()) : null;
  }, []);
  const { label, busy, locked, phase } = view;
  useEffect(() => {
    onConversation?.({ label, busy, locked, phase, send, pendingStatus });
  }, [onConversation, label, busy, locked, phase, send, pendingStatus]);
  useEffect(() => () => onConversation?.(null), [onConversation]);
  return send;
}
