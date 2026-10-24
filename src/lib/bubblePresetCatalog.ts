import { BUBBLE_MATERIALS, type BubblePreset } from './bubblePresetData.ts';
export { BUBBLE_PRESET_LAYERS, type BubblePreset } from './bubblePresetData.ts';

const previews = import.meta.glob('../assets/materials/bubbles/**/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const BUBBLE_PRESETS: BubblePreset[] = BUBBLE_MATERIALS.map(preset => {
  const asset = `../assets/materials/bubbles/${preset.asset}`;
  if (!previews[asset]) throw new Error(`Missing bubble preset SVG: ${preset.asset}`);
  return { ...preset, asset: previews[asset] };
});
