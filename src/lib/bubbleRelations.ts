import type { Bubble, Figure } from '../types.ts';
import { isPropPlacement } from './catalogModel.ts';
import { DETECTED_FIGURE_NAME } from './systemCharacters.ts';

export { DETECTED_FIGURE_NAME } from './systemCharacters.ts';

/**
 * フキダシの話者を、同じコマにある一意な人物配置へ解決する。
 * 解析直後の「人物あたり」や同名人物が複数いる曖昧な状態では結び付けない。
 */
export function resolveBubbleSpeakerFigureIndex(owner: { figures?: Figure[] }, bubble: Bubble): number | null {
  if (bubble.speakerId) {
    const matches = (owner.figures ?? []).flatMap((figure, index) => (
      !isPropPlacement(figure) && figure.refId === bubble.speakerId ? [index] : []
    ));
    if (matches.length) return matches.length === 1 ? matches[0] : null;
  }
  const speaker = bubble.speaker?.trim();
  if (!speaker || speaker === DETECTED_FIGURE_NAME) return null;
  const matches = (owner.figures ?? []).flatMap((figure, index) => (
    !isPropPlacement(figure) && (!bubble.speakerId || !figure.refId) && figure.name === speaker ? [index] : []
  ));
  return matches.length === 1 ? matches[0] : null;
}

/** Both sides of the character use one association, without a second stored order. */
export function letteringFigureIndex(owner: { figures?: Figure[] }, bubble: Bubble): number | null {
  return bubble.shape === 'handwritten' ? resolveBubbleSpeakerFigureIndex(owner, bubble) : null;
}

/** Layer-list coordinates are top to bottom: below means behind. */
export function letteringLayerMove(owner: { figures?: Figure[]; bubbles?: Bubble[] }, key:string, target:string, below:boolean): {index:number;depth:'front'|'behind'} | null {
  const movingText=key.startsWith('bubble-'),textKey=movingText?key:target,figureKey=movingText?target:key;
  if(!/^bubble-\d+$/.test(textKey)||!/^figure-\d+$/.test(figureKey))return null;
  const index=Number(textKey.slice(7)),bubble=owner.bubbles?.[index];
  if(!bubble||letteringFigureIndex(owner,bubble)!==Number(figureKey.slice(7)))return null;
  return {index,depth:(movingText?below:!below)?'behind':'front'};
}
