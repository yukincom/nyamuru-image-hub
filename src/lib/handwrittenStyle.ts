import catalog from '../content/handwritten-styles.json' with { type: 'json' };
import type { Bubble } from '../types.ts';

export const LETTERING_PENS = catalog.pens;
export const LETTERING_EXPRESSIONS = catalog.expressions;
export type HandwrittenStylePatch = Pick<Bubble, 'lettering_pen'|'lettering_expressions'>;

/** Canonical option order keeps selection, saved values and generation consistent. */
export function handwrittenStyleExpressions(ids: readonly string[] = []): string[] {
  return LETTERING_EXPRESSIONS.filter(option => ids.includes(option.id)).map(option => option.id);
}

/** Fixed, complete lines can bypass free-prose translation through the existing splitter. */
export function handwrittenStylePrompt(bubble: Bubble, target?: { panelId?: number; text: number }): string {
  if (bubble.shape !== 'handwritten') return '';
  const scope = target ? ` for ${target.panelId === undefined ? 'page foreground' : `panel ${target.panelId}`}, text ${target.text}` : '';
  const pen = LETTERING_PENS.find(option => option.id === bubble.lettering_pen);
  return [pen ? `Lettering pen${scope}: ${pen.en}.` : '',
    ...LETTERING_EXPRESSIONS.filter(option => bubble.lettering_expressions?.includes(option.id))
      .map(option => `Lettering expression${scope}: ${option.en}.`)].filter(Boolean).join('\n');
}
