import type { BBox, Anchor, Panel, CanvasElementType } from '../../types';
import { panelBounds, MIN_SIZE_MM, clamp, roundMm } from './canvasBounds.ts';

// アンカー種別が指すコマ内の位置（mm）。端寄せは枠から少し内側に取る
export function anchorPoint(bounds: BBox, anchor: Anchor): { x: number; y: number } {
  const insetX = Math.min(6, bounds.w * .15);
  const insetY = Math.min(6, bounds.h * .15);
  const x = anchor.includes('left') ? bounds.x + insetX : anchor.includes('right') ? bounds.x + bounds.w - insetX : bounds.x + bounds.w / 2;
  const y = anchor.startsWith('top') ? bounds.y + insetY : anchor.startsWith('bottom') ? bounds.y + bounds.h - insetY : bounds.y + bounds.h / 2;
  return { x, y };
}

export const ANCHORS: Anchor[] = ['center', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

export function nearestAnchor(bounds: BBox, box: BBox): Anchor {
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  let best: Anchor = 'center';
  let bestDistance = Infinity;
  for (const anchor of ANCHORS) {
    const point = anchorPoint(bounds, anchor);
    const distance = (point.x - centerX) ** 2 + (point.y - centerY) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = anchor; }
  }
  return best;
}

export function fallbackBox(panel: Panel, type: CanvasElementType, index: number): BBox {
  const bounds = panelBounds(panel);
  // 画面内文字（screen_text）は横組みが既定なので横長bboxを既定にする
  if (type === 'screen_text') {
    const width = Math.min(46, Math.max(MIN_SIZE_MM, bounds.w * .4));
    const height = Math.min(18, Math.max(MIN_SIZE_MM, bounds.h * .2));
    return {
      x: clamp(bounds.x + (bounds.w - width) / 2, bounds.x, bounds.x + bounds.w - width),
      y: clamp(bounds.y + bounds.h / 2 - height / 2 + index * 4, bounds.y, bounds.y + bounds.h - height),
      w: roundMm(width),
      h: roundMm(height),
    };
  }
  let width = Math.min(type === 'figure' ? 42 : 40, Math.max(MIN_SIZE_MM, bounds.w * .35));
  const height = Math.min(type === 'figure' ? 55 : 50, Math.max(MIN_SIZE_MM, bounds.h * .45));
  // 縦書きフキダシは縦長bbox（通常サイズの目安 w40×h50）を保つ
  if (type === 'bubble') width = Math.max(MIN_SIZE_MM, Math.min(width, height * .8));
  const inset = 4 + index * 3;
  return {
    x: clamp(bounds.x + (type === 'bubble' ? bounds.w - width - inset : inset), bounds.x, bounds.x + bounds.w - width),
    y: clamp(bounds.y + inset, bounds.y, bounds.y + bounds.h - height),
    w: width,
    h: height,
  };
}

export function pointInPanel(panel: Panel, x: number, y: number): boolean {
  if (panel.shape.type === 'rect') {
    const { shape } = panel;
    return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
  }
  // レイキャスティング法による多角形の内外判定
  const { points } = panel.shape;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Context menus must also hit figures inside passive panels, whose guides ignore pointer events. */
export function panelFigureAt(panel: Panel, x: number, y: number, showGuides = true): number | undefined {
  if (!pointInPanel(panel, x, y)) return undefined;
  for (let index = (panel.figures?.length ?? 0) - 1; index >= 0; index--) {
    const figure = panel.figures![index];
    if (figure.artwork?.hidden || (!showGuides && !figure.artwork)) continue;
    const box = figure.bbox ?? fallbackBox(panel, 'figure', index);
    if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return index;
  }
  return undefined;
}

export function panelHasElementAt(panel: Panel, x: number, y: number): boolean {
  const boxes: BBox[] = [
    ...(panel.images ?? []).filter(image => !image.hidden).map(image => image.bbox),
    ...(panel.figures ?? []).flatMap((figure, index) => figure.artwork?.hidden ? [] : [figure.bbox ?? fallbackBox(panel, 'figure', index)]),
    ...panel.bubbles.flatMap((bubble, index) => bubble.hidden===true?[]:[bubble.bbox ?? fallbackBox(panel, 'bubble', index)]),
    ...(panel.screen_text ?? []).flatMap((screenText, index) => screenText.hidden===true?[]:[screenText.bbox ?? fallbackBox(panel, 'screen_text', index)]),
  ];
  return boxes.some((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
}

// パネルが重なった位置のクリック先を決める。重ね順は配列順で固定（先頭のパネル1が最奥）。
// 最前面のパネルのクリック位置にエレメント（人物・フキダシ・画面内文字）があればそのパネルを選び、
// なければクリックは空白部分を貫通する:
// - 選択中のパネルが重なりに含まれるときは一段ずつ奥へ送る（最奥まで行ったら最前面へ戻る）
// - 含まれないときはエレメントがある最前面のパネル、どこにもなければ最奥のパネルを選ぶ
export function resolveOverlapClick(panels: Panel[], clickedIndex: number, activeIndex: number, x: number, y: number, hasElement=(panel:Panel,_index:number)=>panelHasElementAt(panel,x,y)): number {
  const stack = panels.map((_, index) => index).filter((index) => pointInPanel(panels[index], x, y)).reverse();
  if (stack.length < 2 || !stack.includes(clickedIndex)) return clickedIndex;
  if (hasElement(panels[stack[0]],stack[0])) return stack[0];
  const activePosition = stack.indexOf(activeIndex);
  if (activePosition !== -1) return stack[(activePosition + 1) % stack.length];
  return stack.find((index) => hasElement(panels[index],index)) ?? stack[stack.length - 1];
}
