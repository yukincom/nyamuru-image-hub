import type { Figure, PlacedImage, Bubble, Panel, PanelShape, MangaPage } from '../../types';
import { panelBounds } from '../canvasGeometry.ts';
import { materializeElementBoxes } from './elementBoxes.ts';
import { panelArtKeys, bubbleArtIndices } from '../panelLayers.ts';
import { appendBubbles } from '../bubbleConnections.ts';

export function mergeUnique(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  const merged = [...new Set([...(left ?? []), ...(right ?? [])])];
  return merged.length ? merged : undefined;
}

export function mergeAction(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right || left === right) return left;
  return `${left}\n${right}`;
}

export function mergeOptionalText(left: string | undefined, right: string | undefined): string | undefined {
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

export function mergeImages(left: PlacedImage[] | undefined, right: PlacedImage[] | undefined, bubbles:Bubble[]=[]): PlacedImage[] | undefined {
  const images = [...(left ?? [])];
  for (const image of right ?? []) {
    const linked=bubbles.find(bubble=>bubble.analogTextImport?.originalImageId===image.id);
    if (!linked&&images.some(other => other.splitOverlapId && other.splitOverlapId === image.splitOverlapId && JSON.stringify(other) === JSON.stringify(image))) continue;
    const copy = structuredClone(image);
    if (images.some(other => other.id === copy.id)) copy.id = crypto.randomUUID();
    if(linked)linked.analogTextImport!.originalImageId=copy.id;
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
  const textSequence = sources.some(source=>source.layer?.artOrder?.some(key=>key.startsWith('bubble:')))
    ? sources.map(source=>bubbleArtIndices(source).map(index=>source.bubbles[index])).reverse().flat()
    : null;
  if(textSequence){
    const ids=new Set<string>();
    for(const bubble of sources.flatMap(source=>source.bubbles)){
      if(!bubble.layerId||ids.has(bubble.layerId))bubble.layerId=crypto.randomUUID();
      ids.add(bubble.layerId);
    }
  }
  const merged = sources[0];
  merged.shape = mergedPanelShape(sources);
  merged.bg = Math.max(...sources.map((panel) => panel.bg)) as Panel['bg'];
  delete merged.bleed;

  for (const source of sources.slice(1)) {
    merged.figures = [...(merged.figures ?? []), ...(source.figures ?? [])];
    merged.images = mergeImages(merged.images, source.images, source.bubbles);
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
    merged.layer={...merged.layer,artOrder:[...artSequence.flatMap(item=>item==='background'?['background']:figures.includes(item)?[`figure:${item.layerId}`]:[]),...(textSequence??[]).map(item=>`bubble:${item.layerId}`)]};
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
