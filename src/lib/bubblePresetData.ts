import source from '../assets/materials/bubbles/paths.json' with { type: 'json' };
import type { Bubble, BubbleShape } from '../types.ts';

export const BUBBLE_PRESET_LAYERS = ['critical', 'nomal', 'tense', 'toge', 'announce', 'toge_natural'] as const;
export interface BubblePreset {
  id: string;
  layer: string;
  label: string;
  asset: string;
  bezier: NonNullable<Bubble['bezier']>;
  shape: BubbleShape;
}

/** Preserve the author's classes; do not turn them into a fixed emotion table. */
export function bubblePresetShape(layer: string): BubbleShape {
  if (layer === 'nomal') return 'normal';
  if (BUBBLE_PRESET_LAYERS.includes(layer as typeof BUBBLE_PRESET_LAYERS[number])) return layer as BubbleShape;
  throw new Error(`Unknown bubble preset layer: ${layer}`);
}

export const BUBBLE_MATERIALS: readonly BubblePreset[] = source.map(preset => ({ ...preset, shape: bubblePresetShape(preset.layer) }));

/** Material replacement changes the vector outline alone, retaining the author's text and proportions. */
export function replaceBubbleMaterial(bubble: Bubble, id: string): void {
  const preset=BUBBLE_MATERIALS.find(item=>item.id===id);
  if(!preset)throw Error('吹き出し素材が見つかりません');
  bubble.bezier=structuredClone(preset.bezier);
}
export const BUBBLE_MATERIAL_DRAG_TYPE='application/x-nyamuru-bubble-material';

/** A shape-only OMNY can use the first author outline; an explicit outline always wins. */
export function materialBubbleBezier(shape?: BubbleShape): Bubble['bezier'] {
  return BUBBLE_MATERIALS.find(preset => preset.layer === shape)?.bezier;
}

export function setBubbleShape(bubble: Bubble, shape: BubbleShape): void {
  bubble.shape = shape;
  const outline = materialBubbleBezier(shape);
  if (outline) bubble.bezier = structuredClone(outline);
  else delete bubble.bezier;
}
