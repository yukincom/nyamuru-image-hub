import type { MangaPage, Panel, PanelShape, BleedEdge, BBox, Bubble, MangaDocument } from '../../types';
import { roundMm, panelBounds, nearestAnchor } from '../canvasGeometry.ts';
import { materializeElementBoxes } from './elementBoxes.ts';

export type PanelSplitDirection = 'vertical' | 'horizontal';

let splitOverlapSequence = 0;

function nextSplitOverlapBase(page: MangaPage, panel: Panel): string {
  splitOverlapSequence += 1;
  return `split-${page.page}-${panel.id}-${Date.now().toString(36)}-${splitOverlapSequence}`;
}

function clippedPolygon(
  points: readonly [number, number][],
  axis: 0 | 1,
  limit: number,
  keepLower: boolean,
): [number, number][] {
  if (!points.length) return [];
  const inside = (point: [number, number]) => keepLower ? point[axis] <= limit + 1e-7 : point[axis] >= limit - 1e-7;
  const intersection = (start: [number, number], end: [number, number]): [number, number] => {
    const distance = end[axis] - start[axis];
    const ratio = Math.abs(distance) < 1e-9 ? 0 : (limit - start[axis]) / distance;
    const point: [number, number] = [
      start[0] + (end[0] - start[0]) * ratio,
      start[1] + (end[1] - start[1]) * ratio,
    ];
    point[axis] = limit;
    return [roundMm(point[0]), roundMm(point[1])];
  };
  const output: [number, number][] = [];
  let previous = points.at(-1)!;
  for (const current of points) {
    const previousInside = inside(previous);
    const currentInside = inside(current);
    if (currentInside !== previousInside) output.push(intersection(previous, current));
    if (currentInside) output.push([roundMm(current[0]), roundMm(current[1])]);
    previous = current;
  }
  return output.filter((point, index) => {
    const previousPoint = output[(index + output.length - 1) % output.length];
    return !previousPoint || Math.hypot(point[0] - previousPoint[0], point[1] - previousPoint[1]) > 1e-7;
  });
}

function splitPanelShapes(
  shape: PanelShape,
  direction: PanelSplitDirection,
  gapMm: number,
): [PanelShape, PanelShape] | null {
  const bounds = panelBounds({ id: 0, shape, bg: 0, bubbles: [], action: null });
  const gap = Math.max(0, gapMm);
  const vertical = direction === 'vertical';
  const extent = vertical ? bounds.w : bounds.h;
  if (extent - gap < 16) return null;
  const divider = vertical ? bounds.x + bounds.w / 2 : bounds.y + bounds.h / 2;
  const nearLimit = roundMm(divider - gap / 2);
  const farLimit = roundMm(divider + gap / 2);

  if (shape.type === 'rect') {
    if (vertical) return [
      { type: 'rect', x: farLimit, y: shape.y, w: roundMm(shape.x + shape.w - farLimit), h: shape.h },
      { type: 'rect', x: shape.x, y: shape.y, w: roundMm(nearLimit - shape.x), h: shape.h },
    ];
    return [
      { type: 'rect', x: shape.x, y: shape.y, w: shape.w, h: roundMm(nearLimit - shape.y) },
      { type: 'rect', x: shape.x, y: farLimit, w: shape.w, h: roundMm(shape.y + shape.h - farLimit) },
    ];
  }

  const firstPoints = vertical
    ? clippedPolygon(shape.points, 0, farLimit, false)
    : clippedPolygon(shape.points, 1, nearLimit, true);
  const secondPoints = vertical
    ? clippedPolygon(shape.points, 0, nearLimit, true)
    : clippedPolygon(shape.points, 1, farLimit, false);
  if (firstPoints.length < 3 || secondPoints.length < 3) return null;
  return [
    { type: 'polygon', points: firstPoints },
    { type: 'polygon', points: secondPoints },
  ];
}

function splitBleed(edges: readonly BleedEdge[] | undefined, direction: PanelSplitDirection, first: boolean): BleedEdge[] | undefined {
  const kept = (edges ?? []).filter((edge) => {
    if (direction === 'vertical') return first ? edge !== 'left' : edge !== 'right';
    return first ? edge !== 'bottom' : edge !== 'top';
  });
  return kept.length ? kept : undefined;
}

function elementBelongsToFirst(box: BBox | undefined, direction: PanelSplitDirection, divider: number): boolean {
  if (!box) return true;
  return direction === 'vertical'
    ? box.x + box.w / 2 >= divider
    : box.y + box.h / 2 <= divider;
}

function elementCrossesDivider(box: BBox | undefined, direction: PanelSplitDirection, divider: number): boolean {
  if (!box) return false;
  return direction === 'vertical'
    ? box.x < divider && box.x + box.w > divider
    : box.y < divider && box.y + box.h > divider;
}

function distributePanelElements(source: Panel, first: Panel, second: Panel, direction: PanelSplitDirection, divider: number, overlapBase: string): void {
  const assign = <T extends { bbox?: BBox; splitOverlap?: true; splitOverlapId?: string }>(items: readonly T[] | undefined, kind: string): [T[], T[]] => {
    const firstItems: T[] = [], secondItems: T[] = [];
    for (const [index, item] of (items ?? []).entries()) {
      if (elementCrossesDivider(item.bbox, direction, divider)) {
        const splitOverlapId = `${overlapBase}-${kind}-${index}`;
        firstItems.push({ ...structuredClone(item), splitOverlap: true, splitOverlapId });
        secondItems.push({ ...structuredClone(item), splitOverlap: true, splitOverlapId });
      } else {
        const copy = structuredClone(item);
        delete copy.splitOverlap;
        delete copy.splitOverlapId;
        (elementBelongsToFirst(item.bbox, direction, divider) ? firstItems : secondItems).push(copy);
      }
    }
    return [firstItems, secondItems];
  };
  const assignBubbles = (): [Bubble[], Bubble[]] => {
    const sides: Bubble[][] = [[], []];
    const sourceNumberMaps = [new Map<number, number>(), new Map<number, number>()];
    const pending: Array<Array<{ bubble: Bubble; sourceJoinTo?: number }>> = [[], []];
    source.bubbles.forEach((item, sourceIndex) => {
      const targetSides = elementCrossesDivider(item.bbox, direction, divider)
        ? [0, 1]
        : [elementBelongsToFirst(item.bbox, direction, divider) ? 0 : 1];
      targetSides.forEach((side) => {
        const copy = structuredClone(item);
        if (targetSides.length === 2) {
          copy.splitOverlap = true;
          copy.splitOverlapId = `${overlapBase}-bubble-${sourceIndex}`;
        } else {
          delete copy.splitOverlap;
          delete copy.splitOverlapId;
        }
        const sourceJoinTo = copy.join_to;
        delete copy.join_to;
        sides[side].push(copy);
        sourceNumberMaps[side].set(sourceIndex + 1, sides[side].length);
        pending[side].push({ bubble: copy, sourceJoinTo });
      });
    });
    pending.forEach((entries, side) => entries.forEach(({ bubble, sourceJoinTo }) => {
      const remapped = sourceJoinTo === undefined ? undefined : sourceNumberMaps[side].get(sourceJoinTo);
      if (remapped !== undefined) bubble.join_to = remapped;
    }));
    return sides as [Bubble[], Bubble[]];
  };
  [first.bubbles, second.bubbles] = assignBubbles();
  const [firstBackground, secondBackground] = assign(source.background_images, 'background');
  firstBackground.length ? first.background_images = firstBackground : delete first.background_images;
  secondBackground.length ? second.background_images = secondBackground : delete second.background_images;
  const linked=new Set(source.bubbles.map(bubble=>bubble.analogTextImport?.originalImageId).filter(Boolean));
  const [firstImages, secondImages] = assign(source.images?.filter(image=>!linked.has(image.id)), 'image');
  for(const [child,images] of [[first,firstImages],[second,secondImages]] as const){
    for(const bubble of child.bubbles){
      const image=source.images?.find(image=>image.id===bubble.analogTextImport?.originalImageId);
      if(image)images.push(structuredClone(image));
    }
  }
  firstImages.length ? first.images = firstImages : delete first.images;
  secondImages.length ? second.images = secondImages : delete second.images;
  const [firstFigures, secondFigures] = assign(source.figures, 'figure');
  firstFigures.length ? first.figures = firstFigures : delete first.figures;
  secondFigures.length ? second.figures = secondFigures : delete second.figures;
  const [firstScreenText, secondScreenText] = assign(source.screen_text, 'screen-text');
  firstScreenText.length ? first.screen_text = firstScreenText : delete first.screen_text;
  secondScreenText.length ? second.screen_text = secondScreenText : delete second.screen_text;

  for (const child of [first, second]) {
    const bounds = panelBounds(child);
    child.figures?.forEach((figure) => { if (figure.bbox) figure.anchor = nearestAnchor(bounds, figure.bbox); });
    child.bubbles.forEach((bubble) => { if (bubble.bbox && bubble.anchor) bubble.anchor = nearestAnchor(bounds, bubble.bbox); });
    if (child.figures?.length) delete child.no_figures;
  }
}

/**
 * 選択コマを中央で二分する。タテ分割は右→左、ヨコ分割は上→下の読み順で挿入し、
 * 人物・フキダシ・画面内文字はbbox中心がある側へ移す。
 */
export function splitPanel(
  page: MangaPage,
  panelIndex: number,
  direction: PanelSplitDirection,
  gaps: { rowGapMm: number; columnGapMm: number },
): [number, number] | null {
  if (!Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex >= page.panels.length) return null;
  const source = structuredClone(page.panels[panelIndex]);
  materializeElementBoxes(source);
  const gap = direction === 'vertical' ? gaps.columnGapMm : gaps.rowGapMm;
  const shapes = splitPanelShapes(source.shape, direction, gap);
  if (!shapes) return null;
  const bounds = panelBounds(source);
  const divider = direction === 'vertical' ? bounds.x + bounds.w / 2 : bounds.y + bounds.h / 2;
  const overlapBase = nextSplitOverlapBase(page, source);
  const first = structuredClone(source), second = structuredClone(source);
  first.shape = shapes[0];
  second.shape = shapes[1];
  first.bleed = splitBleed(source.bleed, direction, true);
  second.bleed = splitBleed(source.bleed, direction, false);
  if (!first.bleed) delete first.bleed;
  if (!second.bleed) delete second.bleed;
  // 同じ演出文を二重出力しない。読み順先頭のコマへ元の記述を残す。
  second.action = null;
  distributePanelElements(source, first, second, direction, divider, overlapBase);
  page.panels.splice(panelIndex, 1, first, second);
  page.panels.forEach((panel, index) => { panel.id = index + 1; });
  return [panelIndex, panelIndex + 1];
}

type SplitOverlapElement = { splitOverlap?: true; splitOverlapId?: string };

function reconcileElementOverlapGroups(elements: SplitOverlapElement[], contentSignature?: (element: SplitOverlapElement) => string): void {
  const groups = new Map<string, SplitOverlapElement[]>();
  elements.forEach((element) => {
    if (!element.splitOverlapId) {
      delete element.splitOverlap;
      return;
    }
    const group = groups.get(element.splitOverlapId) ?? [];
    group.push(element);
    groups.set(element.splitOverlapId, group);
  });
  groups.forEach((group) => {
    const sameContent = !contentSignature || new Set(group.map(contentSignature)).size === 1;
    if (group.length >= 2 && sameContent) {
      group.forEach((element) => { element.splitOverlap = true; });
      return;
    }
    group.forEach((element) => {
      delete element.splitOverlap;
      delete element.splitOverlapId;
    });
  });
}

/**
 * 分割時の確認フラグを実データの状態に同期する。
 * 片方が削除された要素は重複ではないため通常表示へ戻す。
 */
export function reconcileSplitOverlapFlags(document: MangaDocument): void {
  document.manga.pages.forEach((page) => {
    const elements: SplitOverlapElement[] = [];
    const bubbles: Bubble[] = [];
    page.panels.forEach((panel) => {
      elements.push(...(panel.figures ?? []), ...(panel.screen_text ?? []), ...(panel.images ?? []), ...(panel.background_images ?? []));
      bubbles.push(...panel.bubbles);
    });
    elements.push(...(page.page_overlay?.figures ?? []));
    elements.push(...(page.page_overlay?.screen_text ?? []));
    bubbles.push(...(page.page_overlay?.bubbles ?? []));
    reconcileElementOverlapGroups(elements);
    // 分割後に片方の本文を編集したフキダシは、同じ複製ではなく別の内容として確定する。
    reconcileElementOverlapGroups(bubbles, (element) => (element as Bubble).text);

  });
}
