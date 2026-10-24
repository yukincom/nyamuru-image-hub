import type { Bubble } from '../types.ts';

/**
 * フキダシを削除し、同じ配列内の結合参照を壊さないよう番号を詰める。
 * join_to は1始まりで、常に自分より前のフキダシだけを指す。
 */
export function removeBubbleAt(bubbles: Bubble[], index: number): Bubble | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= bubbles.length) return undefined;
  const removedNumber = index + 1;
  const [removed] = bubbles.splice(index, 1);
  bubbles.forEach((bubble) => {
    if (bubble.join_to === removedNumber) delete bubble.join_to;
    else if (typeof bubble.join_to === 'number' && bubble.join_to > removedNumber) bubble.join_to -= 1;
  });
  return removed;
}

/** 移動や読込後に、循環・範囲外の結合参照だけを外す。 */
export function normalizeBubbleConnections(bubbles: Bubble[]): void {
  bubbles.forEach((bubble, index) => {
    if (!Number.isInteger(bubble.join_to) || (bubble.join_to ?? 0) < 1 || (bubble.join_to ?? 0) > index) {
      delete bubble.join_to;
    }
  });
}

/** 別の配列を後ろへ連結し、配列内結合の番号も連結先へずらす。 */
export function appendBubbles(target: Bubble[], additions: readonly Bubble[]): void {
  const offset = target.length;
  additions.forEach((source) => {
    const bubble = structuredClone(source);
    if (bubble.join_to !== undefined) bubble.join_to += offset;
    target.push(bubble);
  });
}
