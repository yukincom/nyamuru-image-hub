import type { Panel } from '../../types';
import { fallbackBox } from '../canvasGeometry.ts';

export function materializeElementBoxes(panel: Panel): void {
  panel.figures?.forEach((figure, index) => {
    figure.bbox ??= fallbackBox(panel, 'figure', index);
  });
  panel.bubbles.forEach((bubble, index) => {
    bubble.bbox ??= fallbackBox(panel, 'bubble', index);
  });
  panel.screen_text?.forEach((screenText, index) => {
    screenText.bbox ??= fallbackBox(panel, 'screen_text', index);
  });
}
