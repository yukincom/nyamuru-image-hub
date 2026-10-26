import type { BBox, Bubble, BubbleTextPosition, Panel } from '../types.ts';

/** Text layout stays relative to the complete bubble; the owning panel clips presentation. */
export function bubbleTextFrame(box: BBox, _panel: Panel, _bubble: Bubble): BBox {
  return box;
}

/** The text starts centered and can be moved independently inside its bubble. */
export function bubbleTextPosition(bubble: Pick<Bubble,'text_position'>): BubbleTextPosition {
  const source=bubble.text_position;
  return {x:Math.max(0,Math.min(1,Number.isFinite(source?.x)?source!.x:.5)),y:Math.max(0,Math.min(1,Number.isFinite(source?.y)?source!.y:.5))};
}

/** Connectors in the same owner always share that owner's clipping boundary. */
export function compatibleBubbleClips(_first: Bubble, _second: Bubble): boolean {
  return true;
}
