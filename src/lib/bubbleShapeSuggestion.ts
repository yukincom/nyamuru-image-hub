import type { Bubble, BubbleShape, Figure, Panel } from '../types.ts';
import { suggestBubbleShape } from './bubblePresentation.ts';

type BubbleShapeOwner = Pick<Panel, 'action' | 'figures'> | { action?: string | null; figures?: Figure[] };

export type BubbleShapeSuggestionPreparation =
  | { shape: BubbleShape; error?: never }
  | { shape?: never; error: string };

/** The visible "auto" action is deterministic and never starts the text LLM. */
export function prepareBubbleShapeSuggestion(
  owner: BubbleShapeOwner,
  bubble: Bubble,
): BubbleShapeSuggestionPreparation {
  if (!bubble.text.trim()) return { error: '先にセリフを入力してください。' };
  return { shape: suggestBubbleShape(owner, bubble) };
}
