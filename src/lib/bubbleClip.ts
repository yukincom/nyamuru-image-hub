import type { BBox, Bubble, Panel } from '../types.ts';

/** Keep text in the visible rectangular portion without changing the outline. */
export function bubbleTextFrame(box: BBox, panel: Panel, bubble: Bubble): BBox {
  if (!bubble.clip_to_panel || panel.shape.type !== 'rect') return box;
  const shape = panel.shape;
  const x = Math.max(box.x, shape.x), y = Math.max(box.y, shape.y);
  return { x, y, w: Math.max(0, Math.min(box.x + box.w, shape.x + shape.w) - x),
    h: Math.max(0, Math.min(box.y + box.h, shape.y + shape.h) - y) };
}

/** A shared connector must have the same clipping behavior at both ends. */
export function compatibleBubbleClips(first: Bubble, second: Bubble): boolean {
  return Boolean(first.clip_to_panel) === Boolean(second.clip_to_panel);
}
