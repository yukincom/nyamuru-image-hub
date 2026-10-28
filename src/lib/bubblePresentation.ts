import type { Bubble, BubbleShape, BubbleTailStyle } from '../types.ts';

export const DEFAULT_BUBBLE_LINE_WIDTH_MM = 0.5;

export function isHandwrittenText(bubble: Pick<Bubble, 'shape'> | undefined): boolean {
  return bubble?.shape === 'handwritten';
}

export function isBalloonText(bubble: Pick<Bubble, 'shape'|'text'>): boolean {
  return bubble.shape !== 'handwritten' && bubble.shape !== 'typeset';
}

export function letteringGuideVisible(bubble: Pick<Bubble, 'shape' | 'lettering_guide_hidden'>): boolean {
  return !isHandwrittenText(bubble) || bubble.lettering_guide_hidden !== true;
}

const NO_TAIL_BY_DEFAULT = new Set<BubbleShape>([
  'square',
  'caption',
  'flash',
  'uniflash',
  'handwritten',
  'typeset',
]);

export function normalizedBubbleLineWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BUBBLE_LINE_WIDTH_MM;
  return Math.round(Math.min(2, Math.max(0.1, value)) * 10) / 10;
}

/** Individual widths keep the pen palette's precision and range. */
export function bubbleStrokeWidthMm(bubble: Pick<Bubble, 'line_width_mm'>, defaultWidth = DEFAULT_BUBBLE_LINE_WIDTH_MM): number {
  const width = bubble.line_width_mm;
  return typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : normalizedBubbleLineWidth(defaultWidth);
}

export function bubbleShapeHasTailByDefault(shape: BubbleShape | undefined): boolean {
  return !NO_TAIL_BY_DEFAULT.has(shape ?? 'normal');
}

export function bubbleTailIsEnabled(bubble: Pick<Bubble, 'tail' | 'offscreen' | 'shape'>): boolean {
  if (bubble.shape === 'typeset') return false;
  if (bubble.offscreen === true || bubble.tail === false) return false;
  if (bubble.tail && typeof bubble.tail === 'object') return true;
  return bubbleShapeHasTailByDefault(bubble.shape);
}

/** 明示設定を優先し、旧データだけ形状からthinkingしっぽを補完する。 */
export function bubbleUsesMonologueTail(bubble: Pick<Bubble, 'shape'|'tail_style'>): boolean {
  return bubble.tail_style?bubble.tail_style==='thinking':bubble.shape === 'thought';
}

export function bubbleTailStyle(bubble:Pick<Bubble,'tail'|'offscreen'|'shape'|'tail_style'>):'none'|BubbleTailStyle{
  if(!bubbleTailIsEnabled(bubble))return 'none';
  return bubbleUsesMonologueTail(bubble)?'thinking':'normal';
}

export function setBubbleTailStyle(bubble:Bubble,style:'none'|BubbleTailStyle):void{
  if(style==='none'){
    bubble.tail=false;delete bubble.tail_style;return;
  }
  delete bubble.offscreen;bubble.tail_style=style;
  if(bubble.tail===false){
    if(bubbleShapeHasTailByDefault(bubble.shape))delete bubble.tail;
    else bubble.tail={x:.5,y:.5};
  }else if(!bubbleShapeHasTailByDefault(bubble.shape)&&bubble.tail===undefined)bubble.tail={x:.5,y:.5};
}

export function setBubbleTailEnabled(bubble: Bubble, enabled: boolean): void {
  setBubbleTailStyle(bubble,enabled?(bubbleUsesMonologueTail(bubble)?'thinking':'normal'):'none');
}
