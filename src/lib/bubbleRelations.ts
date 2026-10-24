import type { Bubble, Figure } from '../types.ts';
import { isPropPlacement } from './catalogModel.ts';
import { DETECTED_FIGURE_NAME } from './systemCharacters.ts';

export { DETECTED_FIGURE_NAME } from './systemCharacters.ts';

/**
 * フキダシの話者を、同じコマにある一意な人物配置へ解決する。
 * 解析直後の「人物あたり」や同名人物が複数いる曖昧な状態では結び付けない。
 */
export function resolveBubbleSpeakerFigureIndex(owner: { figures?: Figure[] }, bubble: Bubble): number | null {
  const speaker = bubble.speaker?.trim();
  if (!speaker || speaker === DETECTED_FIGURE_NAME) return null;
  const matches = (owner.figures ?? []).flatMap((figure, index) => (
    !isPropPlacement(figure) && figure.name === speaker ? [index] : []
  ));
  return matches.length === 1 ? matches[0] : null;
}
