import type { BBox, Bubble, BubbleTextPosition, Panel } from '../types.ts';

/** Text layout stays relative to the complete bubble; the owning panel clips presentation. */
export function bubbleTextFrame(box: BBox, _panel: Panel, _bubble: Bubble): BBox {
  return box;
}

/** Text stays relative to the original bbox even when the outline extends beyond it. */
export function bubbleTextPosition(bubble: Pick<Bubble,'text_position'>): BubbleTextPosition {
  const source=bubble.text_position;
  return {x:Number.isFinite(source?.x)?source!.x:.5,y:Number.isFinite(source?.y)?source!.y:.5};
}

/** Connectors in the same owner always share that owner's clipping boundary. */
export function compatibleBubbleClips(_first: Bubble, _second: Bubble): boolean {
  return true;
}
