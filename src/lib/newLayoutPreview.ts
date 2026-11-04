import type { LayoutRecognitionResult } from './localBridge.ts';

export type NewLayoutTask = 'idle' | 'scanner' | 'analyzing' | 'creating';

type NewLayoutSource = 'manual' | 'scanner';
export type RightAngle = 0 | 90 | 180 | 270;

export interface NewLayoutItem {
  id: string;
  file: File;
  source: NewLayoutSource;
  analysis: LayoutRecognitionResult | null;
  analyzing: boolean;
  rotationOverride: RightAngle;
  error?: string;
}

export interface DetectedPageLayout {
  sourceItemId: string;
  analysis: LayoutRecognitionResult;
}

export const NEW_LAYOUT_SPREAD_ORDER = [1, 0, 3, 2, 5, 4, 7, 6, 9, 8] as const;

export function displayedLayoutRotation(item: NewLayoutItem): RightAngle {
  return item.rotationOverride;
}

export function layoutPreviewImageStyle(rotation: RightAngle) {
  if (rotation % 180 === 0) return { transform: `rotate(${rotation}deg)` };
  return {
    width: '141.4214%',
    height: '70.7107%',
    transform: `rotate(${rotation}deg)`,
  };
}

export function nextLayoutIndexFromArrow(current: number, key: string, length: number): number {
  if (key === 'ArrowLeft' && current % 2 === 0 && current + 1 < length) return current + 1;
  if (key === 'ArrowRight' && current % 2 === 1) return current - 1;
  if (key === 'ArrowUp' && current >= 2) return current - 2;
  if (key === 'ArrowDown' && current + 2 < length) return current + 2;
  return current;
}
