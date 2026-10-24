import { panelArtKeys } from './panelLayers.ts';
import type { PlacedImage, BBox, BleedEdge, Bubble, Figure, MangaDocument, MangaPage, Panel, PanelShape } from '../types';
import { appendBubbles, removeBubbleAt } from './bubbleConnections.ts';
import { innerFrameBounds, fallbackBox, nearestAnchor, panelBounds, resizePanelToBounds, roundMm } from './canvasGeometry.ts';

export interface PanelTemplate {
  id: string;
  name: string;
  usage: string;
  shapes: PanelShape[];
  /** タチキリ（断ち切り）辺の宣言。shapes と同じ添字のコマに bleed を付与する */
  bleeds?: Partial<Record<number, BleedEdge[]>>;
}

export type PanelSplitDirection = 'vertical' | 'horizontal';
export type BubbleOwner = number | 'page_overlay';

let splitOverlapSequence = 0;

function nextSplitOverlapBase(page: MangaPage, panel: Panel): string {
  splitOverlapSequence += 1;
  return `split-${page.page}-${panel.id}-${Date.now().toString(36)}-${splitOverlapSequence}`;
}

const rect = (x: number, y: number, w: number, h: number): PanelShape => ({ type: 'rect', x, y, w, h });
const polygon = (points: [number, number][]): PanelShape => ({ type: 'polygon', points });

/** NDM v10で定義したコマ割りパターンA〜Uと追加パターン。 */
export const PANEL_TEMPLATES: PanelTemplate[] = [
  {
    id: 'A', name: '3コマ縦積み', usage: '落ち着いた会話・ナレーション',
    shapes: [rect(10, 10, 190, 85), rect(10, 100, 190, 85), rect(10, 190, 190, 95)],
  },
  {
    id: 'B', name: '少年誌ベーシック6コマ', usage: '標準的な展開',
    shapes: [
      rect(10, 10, 190, 80),
      polygon([[200, 95], [200, 170], [105, 170], [115, 95]]),
      polygon([[115, 95], [105, 170], [10, 170], [10, 95]]),
      rect(10, 175, 190, 40), rect(85, 220, 115, 67), rect(10, 220, 70, 67),
    ],
  },
  {
    id: 'C', name: 'スプラッシュ', usage: '最大の見せ場',
    shapes: [rect(10, 10, 190, 277)],
  },
  {
    id: 'D', name: '4コマ等分', usage: 'テンポの良い掛け合い',
    shapes: [rect(10, 10, 190, 65), rect(10, 80, 190, 65), rect(10, 150, 190, 65), rect(10, 220, 190, 67)],
  },
  {
    id: 'E', name: '対角アクション', usage: '動き・驚き・事件発生',
    shapes: [
      polygon([[10, 10], [200, 10], [200, 65], [10, 90]]),
      polygon([[200, 70], [200, 150], [112, 150], [122, 80]]),
      polygon([[117, 81], [107, 150], [10, 150], [10, 95]]),
      polygon([[200, 155], [200, 287], [82, 287], [100, 155]]),
      polygon([[95, 155], [77, 287], [10, 287], [10, 155]]),
    ],
  },
  {
    id: 'F', name: 'ため→ドン', usage: '感動・告白・再会',
    shapes: [rect(110, 10, 90, 55), rect(10, 10, 95, 55), rect(10, 70, 190, 40), rect(10, 115, 190, 172)],
  },
  {
    id: 'G', name: '図解ワイド', usage: '解説・説明シーン',
    shapes: [rect(10, 10, 190, 60), rect(75, 75, 125, 120), rect(10, 75, 60, 120), rect(10, 200, 190, 87)],
  },
  {
    id: 'H', name: '会話ラリー6コマ', usage: '掛け合い・畳みかけ→オチ',
    shapes: [rect(110, 10, 90, 62), rect(10, 10, 95, 62), rect(122, 78, 78, 62), rect(10, 78, 107, 62), rect(10, 146, 190, 64), rect(10, 216, 190, 71)],
  },
  {
    id: 'I', name: '縦長見得切り', usage: '登場・変身・決めポーズ',
    shapes: [rect(90, 10, 110, 277), rect(10, 10, 75, 88), rect(10, 103, 75, 88), rect(10, 196, 75, 91)],
  },
  {
    id: 'J', name: 'じわヒキ3段', usage: '日常→不穏・ページ末のヒキ',
    shapes: [rect(10, 10, 190, 80), rect(104, 96, 96, 88), rect(10, 96, 89, 88), rect(86, 190, 114, 97), rect(10, 190, 71, 97)],
  },
  {
    id: 'K', name: '縦3列モンタージュ', usage: '時間経過・同時進行',
    shapes: [rect(10, 10, 190, 58), rect(140, 74, 60, 132), rect(75, 74, 60, 132), rect(10, 74, 60, 132), rect(10, 212, 190, 75)],
  },
  {
    id: 'L', name: 'メクリ受けドン', usage: '前ページのヒキを解放',
    shapes: [rect(10, 10, 190, 182), rect(104, 198, 96, 89), rect(10, 198, 89, 89)],
  },
  {
    id: 'M', name: 'タチキリ・スプラッシュ', usage: '紙端まで使う最大の見せ場',
    shapes: [rect(0, 10, 210, 287)],
    bleeds: { 0: ['left', 'right', 'bottom'] },
  },
  {
    id: 'N', name: 'タチキリ見得切り', usage: '登場・変身を右下断ち切りで抜く',
    shapes: [rect(90, 10, 120, 287), rect(10, 10, 75, 88), rect(10, 103, 75, 88), rect(10, 196, 75, 91)],
    bleeds: { 0: ['right', 'bottom'] },
  },
  {
    id: 'O', name: 'タチキリ受けドン', usage: 'メクリ受けを左右断ち切りで最大化',
    shapes: [rect(0, 10, 210, 182), rect(104, 198, 96, 89), rect(10, 198, 89, 89)],
    bleeds: { 0: ['left', 'right'] },
  },
  {
    id: 'P', name: 'タチキリ・ヒキ3段', usage: 'ページ末のヒキを断ち切りで強調',
    shapes: [rect(10, 10, 190, 80), rect(104, 96, 96, 88), rect(10, 96, 89, 88), rect(0, 190, 210, 107)],
    bleeds: { 3: ['left', 'right', 'bottom'] },
  },
  {
    id: 'Q', name: 'タチキリ登場ワイド', usage: '冒頭の登場を横断ち切りで見せる',
    shapes: [rect(0, 10, 210, 120), rect(10, 135, 190, 70), rect(108, 210, 92, 77), rect(10, 210, 93, 77)],
    bleeds: { 0: ['left', 'right'] },
  },
  {
    id: 'R', name: '斜め4段タタミカケ', usage: '追走・焦り・加速する展開',
    shapes: [
      polygon([[10, 10], [200, 10], [200, 70], [10, 85]]),
      polygon([[10, 90], [200, 75], [200, 140], [10, 150]]),
      polygon([[10, 155], [200, 145], [200, 215], [10, 205]]),
      polygon([[10, 210], [200, 220], [200, 287], [10, 287]]),
    ],
  },
  {
    id: 'S', name: '対決ツイン', usage: '対峙・にらみ合い・対決の火花',
    shapes: [
      rect(10, 10, 190, 60),
      polygon([[200, 75], [200, 230], [85, 230], [125, 75]]),
      polygon([[120, 75], [80, 230], [10, 230], [10, 75]]),
      rect(10, 235, 190, 52),
    ],
  },
  {
    id: 'T', name: 'クサビ畳みかけ', usage: 'パニック・混乱・畳みかけ',
    shapes: [
      rect(10, 10, 190, 55),
      polygon([[200, 70], [200, 210], [152, 210], [120, 70]]),
      polygon([[115, 70], [147, 210], [57, 210], [85, 70]]),
      polygon([[80, 70], [52, 210], [10, 210], [10, 70]]),
      rect(10, 215, 190, 72),
    ],
  },
  {
    id: 'U', name: '斜めメクリドン', usage: '衝撃の受け・急展開を勢いで見せる',
    shapes: [
      polygon([[10, 10], [200, 10], [200, 200], [10, 170]]),
      polygon([[200, 205], [200, 287], [103, 287], [113, 192]]),
      polygon([[108, 192], [98, 287], [10, 287], [10, 175]]),
    ],
  },
  // V〜Y は不規則コマ割り——余白とコマの重なりで語る詩的レイアウト。
  // 重なるレイアウトでは配列順（id昇順）で奥→手前に重ねる（1コマ目が一番奥）
  {
    id: 'V', name: '漂流', usage: '不規則・詩的な余白・回想・エピローグ（斜めの小コマ3つ）',
    shapes: [
      polygon([[128.6, 21.8], [192.9, 17.3], [196.9, 74.2], [132.6, 78.7]]),
      polygon([[78, 116.9], [142.4, 120.2], [139.5, 177.1], [75.1, 173.8]]),
      polygon([[18.1, 216.2], [82.5, 212.9], [85.4, 269.8], [21, 273.1]]),
    ],
  },
  {
    id: 'W', name: '音波', usage: '不規則・静かなモンタージュ・音の余韻（高さ違いの縦4本）',
    shapes: [rect(160.5, 34.5, 34.5, 138), rect(112.5, 79.5, 34.5, 168), rect(64.5, 49.5, 34.5, 111), rect(16.5, 105, 34.5, 162)],
  },
  {
    id: 'X', name: '鼓動', usage: '不規則・心の芯と断片（縦大に小コマが重なる・後のコマほど手前）',
    shapes: [rect(76.5, 19.5, 64.5, 258), rect(118.5, 72, 57, 46.5), rect(37.5, 141, 57, 46.5), rect(118.5, 210, 57, 46.5)],
  },
  {
    id: 'Y', name: '呼吸', usage: '不規則・記憶の束・夢うつつ（傾き重ねの4コマ・後のコマほど手前）',
    shapes: [
      polygon([[102, 50.6], [181.2, 57.5], [175.6, 121.8], [96.4, 114.9]]),
      polygon([[52.6, 82.7], [135.8, 71], [145.4, 139.3], [62.2, 151]]),
      polygon([[44.4, 138.3], [123.7, 143.8], [119.2, 208.1], [39.9, 202.6]]),
      polygon([[88.1, 172.6], [171.7, 163.8], [178.9, 232.4], [95.3, 241.2]]),
    ],
  },
  {
    id: 'Z', name: '受けから三連', usage: '大きな導入と受けのあと、下段3コマで畳みかける',
    shapes: [
      rect(10, 10, 190, 105),
      rect(10, 120, 190, 95),
      rect(105, 220, 95, 67),
      rect(65, 220, 35, 67),
      rect(10, 220, 50, 67),
    ],
  },
];

export function findPanelTemplate(id: string): PanelTemplate | undefined {
  return PANEL_TEMPLATES.find((template) => template.id === id);
}

function emptyPanel(id: number, shape: PanelShape): Panel {
  return { id, shape: structuredClone(shape), bg: 1, bubbles: [], action: null };
}

function materializeElementBoxes(panel: Panel): void {
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

function movePanelContent(panel: Panel, shape: PanelShape): Panel {
  const moved = structuredClone(panel);
  materializeElementBoxes(moved);
  resizePanelToBounds(moved, panelBounds({ ...moved, shape }));
  moved.shape = structuredClone(shape);
  return moved;
}

function mergeUnique(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  const merged = [...new Set([...(left ?? []), ...(right ?? [])])];
  return merged.length ? merged : undefined;
}

function mergeAction(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right || left === right) return left;
  return `${left}\n${right}`;
}

function mergeOptionalText(left: string | undefined, right: string | undefined): string | undefined {
  const normalizedLeft = left?.trim();
  const normalizedRight = right?.trim();
  if (!normalizedLeft) return normalizedRight || undefined;
  if (!normalizedRight || normalizedLeft === normalizedRight) return normalizedLeft;
  return `${normalizedLeft}\n${normalizedRight}`;
}

function figureOverlap(left: Figure, right: Figure): { smallerCoverage: number; iou: number } {
  if (!left.bbox || !right.bbox) return { smallerCoverage: 0, iou: 0 };
  const width = Math.max(0, Math.min(left.bbox.x + left.bbox.w, right.bbox.x + right.bbox.w) - Math.max(left.bbox.x, right.bbox.x));
  const height = Math.max(0, Math.min(left.bbox.y + left.bbox.h, right.bbox.y + right.bbox.h) - Math.max(left.bbox.y, right.bbox.y));
  const intersection = width * height;
  const leftArea = left.bbox.w * left.bbox.h;
  const rightArea = right.bbox.w * right.bbox.h;
  const smaller = Math.min(leftArea, rightArea);
  const union = leftArea + rightArea - intersection;
  return {
    smallerCoverage: smaller > 0 ? intersection / smaller : 0,
    iou: union > 0 ? intersection / union : 0,
  };
}

function sameFigureSource(left: Figure, right: Figure): boolean {
  if (JSON.stringify(left.human_pose) !== JSON.stringify(right.human_pose)) return false;
  if (left.artwork || right.artwork) {
    return Boolean(left.splitOverlapId && left.splitOverlapId === right.splitOverlapId
      && JSON.stringify(left.artwork) === JSON.stringify(right.artwork)
      && JSON.stringify(left.bbox) === JSON.stringify(right.bbox)
      && left.name === right.name && left.refId === right.refId && left.action === right.action);
  }
  const leftId = left.analogImport?.sourceRegionId;
  const rightId = right.analogImport?.sourceRegionId;
  if (leftId || rightId) return Boolean(leftId && rightId && leftId === rightId);
  if (left.name !== right.name) return false;
  const overlap = figureOverlap(left, right);
  return overlap.smallerCoverage >= 0.94 && overlap.iou >= 0.8;
}

function preferFigure(candidate: Figure, current: Figure): boolean {
  const candidateImport = candidate.analogImport;
  const currentImport = current.analogImport;
  if (Boolean(candidateImport?.userEdited) !== Boolean(currentImport?.userEdited)) return Boolean(candidateImport?.userEdited);
  if (candidateImport?.detectionSource !== currentImport?.detectionSource) return candidateImport?.detectionSource === 'body';
  const candidateConfidence = candidateImport?.confidence ?? -1;
  const currentConfidence = currentImport?.confidence ?? -1;
  if (candidateConfidence !== currentConfidence) return candidateConfidence > currentConfidence;
  const candidateId = candidateImport?.sourceRegionId ?? '';
  const currentId = currentImport?.sourceRegionId ?? '';
  return candidateId.localeCompare(currentId, undefined, { numeric: true }) < 0;
}

export function deduplicateFigures(figures: readonly Figure[]): Figure[] {
  const kept: Figure[] = [];
  for (const figure of figures) {
    const duplicateIndex = kept.findIndex((candidate) => sameFigureSource(candidate, figure));
    if (duplicateIndex < 0) kept.push(figure);
    else if (preferFigure(figure, kept[duplicateIndex])) kept[duplicateIndex] = figure;
  }
  return kept;
}

function mergeImages(left: PlacedImage[] | undefined, right: PlacedImage[] | undefined): PlacedImage[] | undefined {
  const images = [...(left ?? [])];
  for (const image of right ?? []) {
    if (images.some(other => other.splitOverlapId && other.splitOverlapId === image.splitOverlapId && JSON.stringify(other) === JSON.stringify(image))) continue;
    const copy = structuredClone(image);
    if (images.some(other => other.id === copy.id)) copy.id = crypto.randomUUID();
    images.push(copy);
  }
  return images.length ? images : undefined;
}

function convexHull(points: readonly [number, number][]): [number, number][] {
  const unique = [...new Map(points.map(([x, y]) => [`${x}:${y}`, [x, y] as [number, number]])).values()]
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  if (unique.length <= 2) return unique;
  const cross = (origin: [number, number], left: [number, number], right: [number, number]) => (
    (left[0] - origin[0]) * (right[1] - origin[1]) - (left[1] - origin[1]) * (right[0] - origin[0])
  );
  const lower: [number, number][] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: [number, number][] = [];
  for (const point of [...unique].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function mergedPanelShape(sources: readonly Panel[]): PanelShape {
  const polygonSources = sources.filter((panel) => panel.shape.type === 'polygon');
  if (polygonSources.length === 1) return structuredClone(polygonSources[0].shape);
  if (polygonSources.length > 1) {
    const hull = convexHull(polygonSources.flatMap((panel) => panel.shape.type === 'polygon' ? panel.shape.points : []));
    if (hull.length >= 3) return { type: 'polygon', points: hull };
  }
  const bounds = sources.map(panelBounds);
  const left = Math.min(...bounds.map((box) => box.x));
  const top = Math.min(...bounds.map((box) => box.y));
  const right = Math.max(...bounds.map((box) => box.x + box.w));
  const bottom = Math.max(...bounds.map((box) => box.y + box.h));
  return { type: 'rect', x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * 選択したコマをひとつへ合体する。多角形が含まれる場合は矩形より優先し、
 * 人物・フキダシ等のbboxは用紙上の絶対座標のまま読み順でまとめる。
 * 戻り値は合体後のコマ添字。2コマ未満なら null。
 */
export function mergeSelectedPanels(page: MangaPage, selectedIndices: readonly number[]): number | null {
  const indices = [...new Set(selectedIndices)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < page.panels.length)
    .sort((left, right) => left - right);
  if (indices.length < 2) return null;

  const selectedSet = new Set(indices);
  const sources = indices.map((index) => structuredClone(page.panels[index]));
  sources.forEach(materializeElementBoxes);
  // Keep object references before concatenation and deduplication. Array order is reading order.
  const artSequence = sources.some(p=>p.layer?.artOrder?.length)
    ? sources.flatMap((source,i)=>panelArtKeys(source).flatMap<Figure|'background'>(key=>
      key==='background'?(i===0?['background']:[]):[source.figures![Number(key.slice(7))]]))
    : null;
  const merged = sources[0];
  merged.shape = mergedPanelShape(sources);
  merged.bg = Math.max(...sources.map((panel) => panel.bg)) as Panel['bg'];
  delete merged.bleed;

  for (const source of sources.slice(1)) {
    merged.figures = [...(merged.figures ?? []), ...(source.figures ?? [])];
    merged.images = mergeImages(merged.images, source.images);
    merged.background_images = mergeImages(merged.background_images, source.background_images);
    appendBubbles(merged.bubbles, source.bubbles);
    const screenText = [...(merged.screen_text ?? []), ...(source.screen_text ?? [])];
    screenText.length ? merged.screen_text = screenText : delete merged.screen_text;
    merged.assets = mergeUnique(merged.assets, source.assets);
    merged.action = mergeAction(merged.action, source.action);
    merged.background_description = mergeOptionalText(merged.background_description, source.background_description);
  }
  if (merged.figures?.length) merged.figures = deduplicateFigures(merged.figures);
  if(artSequence){
    const figures=merged.figures??[],ids=new Set<string>();
    for(const figure of figures){if(!figure.layerId||ids.has(figure.layerId))figure.layerId=crypto.randomUUID();ids.add(figure.layerId);}
    merged.layer={...merged.layer,artOrder:artSequence.flatMap(item=>item==='background'?['background']:figures.includes(item)?[`figure:${item.layerId}`]:[])};
  }
  if (merged.figures?.length) delete merged.no_figures;
  else if (sources.every((panel) => panel.no_figures)) merged.no_figures = true;
  else delete merged.no_figures;

  const insertAt = indices[0];
  page.panels = page.panels.flatMap((panel, index) => {
    if (index === insertAt) return [merged];
    return selectedSet.has(index) ? [] : [panel];
  });
  page.panels.forEach((panel, index) => { panel.id = index + 1; });
  return insertAt;
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
  const [firstImages, secondImages] = assign(source.images, 'image');
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
    bubbles.push(...(page.page_overlay?.bubbles ?? []));
    reconcileElementOverlapGroups(elements);
    // 分割後に片方の本文を編集したフキダシは、同じ複製ではなく別の内容として確定する。
    reconcileElementOverlapGroups(bubbles, (element) => (element as Bubble).text);

  });
}

/** フキダシをコマ間、またはコマ枠より上のページ前景へ移す。 */
export function moveBubbleToOwner(
  page: MangaPage,
  sourceOwner: BubbleOwner,
  bubbleIndex: number,
  targetOwner: BubbleOwner,
): { owner: BubbleOwner; index: number } | null {
  if (sourceOwner === targetOwner) return { owner: targetOwner, index: bubbleIndex };
  const sourceBubbles: Bubble[] | undefined = sourceOwner === 'page_overlay'
    ? page.page_overlay?.bubbles
    : page.panels[sourceOwner]?.bubbles;
  if (!sourceBubbles || bubbleIndex < 0 || bubbleIndex >= sourceBubbles.length) return null;
  if (targetOwner !== 'page_overlay' && (!Number.isInteger(targetOwner) || targetOwner < 0 || targetOwner >= page.panels.length)) return null;
  const bubble = removeBubbleAt(sourceBubbles, bubbleIndex);
  if (!bubble) return null;
  // 結合先は所属配列内の番号なので、別のコマへ移動した時点で解除する。
  delete bubble.join_to;
  if (targetOwner === 'page_overlay') delete bubble.clip_to_panel;
  const targetBubbles = targetOwner === 'page_overlay'
    ? (page.page_overlay ??= { frame: false, layer: 'above_panel_frames' }).bubbles ??= []
    : page.panels[targetOwner].bubbles;
  targetBubbles.push(bubble);
  if (sourceOwner === 'page_overlay' && page.page_overlay && !(page.page_overlay.bubbles?.length) && !(page.page_overlay.figures?.length)) {
    delete page.page_overlay;
  }
  return { owner: targetOwner, index: targetBubbles.length - 1 };
}

/**
 * 現在のコマと中身を読み順でテンプレートへ再配置する。
 * bbox は旧コマ内の比率を新コマの外接矩形へ写し、A4上の絶対mm座標として保存する。
 * コマ数を減らす場合も内容は破棄せず、同じ割当先になったコマへ統合する。
 */
export function applyPanelTemplate(page: MangaPage, template: PanelTemplate): void {
  const sources = structuredClone(page.panels);
  const targetCount = template.shapes.length;
  const groups: Panel[][] = Array.from({ length: targetCount }, () => []);

  sources.forEach((panel, sourceIndex) => {
    const targetIndex = sources.length <= targetCount
      ? sourceIndex
      : Math.min(targetCount - 1, Math.floor(sourceIndex * targetCount / sources.length));
    groups[targetIndex].push(panel);
  });

  const inner = innerFrameBounds(page.canvas);
  // Keep the inner margins and full-bleed edges when adapting an A4 template.
  const coordinate = (value: number, source: number, target: number, margin: number) => {
    if (value <= 10) return value / 10 * margin;
    if (value >= source - 10) return target - (source - value) / 10 * margin;
    return margin + (value - 10) / (source - 20) * (target - margin * 2);
  };
  const x = (value: number) => coordinate(value, 210, page.canvas.w, inner.x);
  const y = (value: number) => coordinate(value, 297, page.canvas.h, inner.y);
  page.panels = template.shapes.map((sourceShape, targetIndex) => {
    const shape: PanelShape = sourceShape.type === 'rect'
      ? { type: 'rect', x: x(sourceShape.x), y: y(sourceShape.y), w: x(sourceShape.x + sourceShape.w) - x(sourceShape.x), h: y(sourceShape.y + sourceShape.h) - y(sourceShape.y) }
      : { type: 'polygon', points: sourceShape.points.map(([px, py]) => [x(px), y(py)]) };
    const group = groups[targetIndex];
    const bleed = template.bleeds?.[targetIndex];
    if (!group.length) {
      const empty = emptyPanel(targetIndex + 1, shape);
      if (bleed) empty.bleed = [...bleed];
      return empty;
    }

    const merged = movePanelContent(group[0], shape);
    merged.bg = Math.max(...group.map((panel) => panel.bg)) as Panel['bg'];
    for (const source of group.slice(1)) {
      const moved = movePanelContent(source, shape);
      merged.figures = [...(merged.figures ?? []), ...(moved.figures ?? [])];
      merged.images = mergeImages(merged.images, moved.images);
      merged.background_images = mergeImages(merged.background_images, moved.background_images);
      appendBubbles(merged.bubbles, moved.bubbles);
      const mergedScreenText = [...(merged.screen_text ?? []), ...(moved.screen_text ?? [])];
      mergedScreenText.length ? merged.screen_text = mergedScreenText : delete merged.screen_text;
      merged.assets = mergeUnique(merged.assets, moved.assets);
      merged.action = mergeAction(merged.action, moved.action);
      merged.background_description = mergeOptionalText(merged.background_description, moved.background_description);
    }
    if (merged.bg === -1) delete merged.background_description;
    if (merged.figures?.length) merged.figures = deduplicateFigures(merged.figures);
    if (merged.figures?.length) delete merged.no_figures;
    merged.id = targetIndex + 1;
    merged.shape = structuredClone(shape);
    // タチキリはテンプレート側の宣言で上書きする（移動元の bleed は座標が変わるため引き継がない）
    bleed ? merged.bleed = [...bleed] : delete merged.bleed;
    return merged;
  });
}
