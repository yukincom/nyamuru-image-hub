import type { Bubble, BubbleShape, Figure, Panel } from '../types.ts';
import { isPropPlacement } from './catalogModel.ts';

export const DEFAULT_BUBBLE_LINE_WIDTH_MM = 0.5;

export const BUBBLE_SHAPE_LABELS: Record<BubbleShape, string> = {
  normal: 'ふつう',
  thought: 'モノローグ',
  square: '四角',
  caption: 'キャプション',
  flash: 'フラッシュ',
  uniflash: 'ウニフラッシュ',
  wobbly: '震え',
  whisper: 'ささやき',
  handwritten: '手書き',
  critical: 'critical',
  tense: 'tense',
  toge: 'toge',
  announce: 'announce',
  toge_natural: 'toge_natural',
};

const NO_TAIL_BY_DEFAULT = new Set<BubbleShape>([
  'square',
  'caption',
  'flash',
  'uniflash',
  'handwritten',
]);

export function normalizedBubbleLineWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BUBBLE_LINE_WIDTH_MM;
  return Math.round(Math.min(2, Math.max(0.1, value)) * 10) / 10;
}

export function bubbleShapeHasTailByDefault(shape: BubbleShape | undefined): boolean {
  return !NO_TAIL_BY_DEFAULT.has(shape ?? 'normal');
}

export function bubbleTailIsEnabled(bubble: Pick<Bubble, 'tail' | 'offscreen' | 'shape'>): boolean {
  if (bubble.offscreen === true || bubble.tail === false) return false;
  if (bubble.tail && typeof bubble.tail === 'object') return true;
  return bubbleShapeHasTailByDefault(bubble.shape);
}

/** フキダシの形だけで、通常の三角しっぽとモノローグ用の数珠しっぽを切り替える。 */
export function bubbleUsesMonologueTail(bubble: Pick<Bubble, 'shape'>): boolean {
  return bubble.shape === 'thought';
}

export function setBubbleTailEnabled(bubble: Bubble, enabled: boolean): void {
  if (!enabled) {
    bubble.tail = false;
    return;
  }
  delete bubble.offscreen;
  if (bubbleShapeHasTailByDefault(bubble.shape)) delete bubble.tail;
  else bubble.tail = { x: 0.5, y: 0.5 };
}

export function normalizedEmphasis(value: string): string {
  return [...new Set(value.split(/[,，、]/).map((phrase) => phrase.trim()).filter(Boolean))].join(', ');
}

function figureCenter(figure: Figure): { x: number; y: number } | null {
  if (!figure.bbox) return null;
  return { x: figure.bbox.x + figure.bbox.w / 2, y: figure.bbox.y + figure.bbox.h / 2 };
}

function nearestPerson(panel: Pick<Panel, 'figures'>, bubble: Bubble): Figure | undefined {
  const people = (panel.figures ?? []).filter((figure) => !isPropPlacement(figure));
  const exact = bubble.speaker?.trim()
    ? people.find((figure) => figure.name === bubble.speaker?.trim())
    : undefined;
  if (exact || !bubble.bbox) return exact ?? people[0];
  const bubbleCenter = {
    x: bubble.bbox.x + bubble.bbox.w / 2,
    y: bubble.bbox.y + bubble.bbox.h / 2,
  };
  return people.reduce<Figure | undefined>((nearest, figure) => {
    const point = figureCenter(figure);
    const nearestPoint = nearest ? figureCenter(nearest) : null;
    if (!point) return nearest;
    if (!nearestPoint) return figure;
    const distance = Math.hypot(point.x - bubbleCenter.x, point.y - bubbleCenter.y);
    const nearestDistance = Math.hypot(nearestPoint.x - bubbleCenter.x, nearestPoint.y - bubbleCenter.y);
    return distance < nearestDistance ? figure : nearest;
  }, undefined);
}

/**
 * 人間が確定しやすい演出だけを選ぶ、保守的な形状候補。
 * ト書き・セリフ・人物の描写範囲・フキダシと人物の位置関係を使用する。
 */
export function suggestBubbleShape(panel: { action?: string | null; figures?: Figure[] }, bubble: Bubble): BubbleShape {
  const text = bubble.text.trim();
  const context = `${panel.action ?? ''}\n${text}`;
  const speaker = bubble.speaker?.normalize('NFKC').trim() ?? '';
  if (bubble.monologue || /心の声|モノローグ|胸中|脳内|独白/.test(context)) return 'thought';
  if (/^(?:ナレーション|語り|地の文|caption)$/iu.test(speaker)) return 'caption';
  // Scenario import records explicit narration as square. Missing speaker alone is not narration.
  if (!speaker && (bubble.shape === 'square' || bubble.shape === 'caption')) return bubble.shape;
  if (bubble.shape === 'handwritten' || /効果音|書き文字/.test(panel.action ?? '')) return 'handwritten';
  if (/ささや|囁|ひそひそ|小声|耳打ち/.test(context)) return 'whisper';
  if (/震え|怯え|おびえ|不安|恐怖|動揺|うろたえ|泣き/.test(context)) return 'wobbly';

  const person = nearestPerson(panel, bubble);
  const closeUp = person?.size === 'face' || person?.size === 'face-detail' || person?.size === 'part';
  const exclamations = (text.match(/[!！]/g) ?? []).length;
  if (/叫|怒鳴|絶叫|大声|激怒|衝撃/.test(context) || exclamations >= 2 || (closeUp && exclamations >= 1)) return 'flash';
  if (!speaker && /^(?:翌朝|翌日|その後|同時刻|数日後|数時間後|しばらくして|一方(?:、|,)?|その頃)(?:[、,。]|$)/u.test(text)) return 'caption';

  return 'normal';
}
