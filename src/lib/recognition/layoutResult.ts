import type { PanelShape, BBox, Panel } from '../../types';
import { DEFAULT_PANEL_GUTTERS, roundMm, clamp, type PanelGutterSettings } from '../canvasGeometry.ts';
import {
  normalizedPanelBox,
  boxIntersectionOverUnion,
  normalizedBoxToPanelShape,
  overlapArea,
  detectedPanelIndexesToKeep,
  detectedSourceFrame,
  sourceFrameBoxToCanvas,
  nearestPanel,
  belongsToPageOverlay,
  straightenNearRectShape,
  sourceFrameShapeToInnerFrame,
} from './panelGeometry.ts';
import { normalizeDetectedPanelGeometry } from './panelGutters.ts';

export const LAYOUT_PROTOCOL_VERSION = 3;

export interface LayoutRecognitionResult {
  detectedPanels: PanelShape[];
  /** detectedPanelsと同じ順序で保たれる、bridge由来の安定ID。 */
  detectedPanelIds: string[];
  detectedFigures: DetectedFigureRegion[];
  /** 検出原稿上のコマ群外枠。全検出物を同じ座標変換で内枠へ対応させる。 */
  sourceFrame: BBox | null;
  reason: string;
  detectedPanelCount: number;
  structureEngine: string;
  excludedNonPanelCount: number;
  detectedTextRegionCount: number;
  detectedFaceRegionCount: number;
  detectedBodyRegionCount: number;
  ocrEngine: string;
  ocrLines: RecognizedTextLine[];
}

export interface RecognizedTextLine {
  id: string;
  text: string;
  bbox: BBox;
  confidence: number;
  vertical: boolean;
  source: string;
  needsReview: boolean;
  unreadable?: boolean;
  groupId?: string;
  /** 編集用の整形後も変わらない、検出時点の所属コマID。 */
  sourcePanelId?: string;
  /** 特定コマへ閉じ込めず、コマ枠より上のページ前景へ置く。 */
  pageOverlay?: true;
}

export interface DetectedFigureRegion {
  id: string;
  bbox: BBox;
  /** 原稿全体に対する、一意に対応した顔の範囲。 */
  faceBBox?: BBox;
  source: 'body' | 'face';
  confidence?: number;
  /** 編集用の整形後も変わらない、検出時点の所属コマID。 */
  sourcePanelId?: string;
  /** 特定コマへ閉じ込めず、コマ枠より上のページ前景へ置く。 */
  pageOverlay?: true;
}

/** OCRグループ名が別コマで再利用されても、切り抜き・配置用IDを衝突させない。 */
export function recognizedTextOwnerKey(line: Pick<RecognizedTextLine, 'id' | 'groupId' | 'sourcePanelId' | 'pageOverlay'>): string {
  const lineKey = line.groupId ?? line.id;
  return line.pageOverlay ? `page-overlay/${lineKey}` : line.sourcePanelId ? `${line.sourcePanelId}/${lineKey}` : lineKey;
}

export interface BridgeLayoutResponse {
  layout_protocol_version?: unknown;
  panels?: unknown;
  reason?: unknown;
  structure?: unknown;
  people?: unknown;
  ocr?: unknown;
}

export function groupRecognizedTextLines(lines: readonly RecognizedTextLine[]): RecognizedTextLine[] {
  const groups: { key: string; lines: RecognizedTextLine[] }[] = [];
  const byKey = new Map<string, { key: string; lines: RecognizedTextLine[] }>();
  lines.forEach((line, index) => {
    // 同じOCRグループ名でも、所属コマが異なる行は一つのフキダシへ混ぜない。
    const key = line.groupId ? `group:${recognizedTextOwnerKey(line)}` : `line:${index}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, lines: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.lines.push(line);
  });
  return groups.map((group) => {
    if (group.lines.length === 1) return group.lines[0];
    const vertical = group.lines.filter((line) => line.vertical).length * 2 >= group.lines.length;
    const ordered = [...group.lines].sort((left, right) => vertical
      ? (right.bbox.x + right.bbox.w / 2) - (left.bbox.x + left.bbox.w / 2) || left.bbox.y - right.bbox.y
      : (left.bbox.y + left.bbox.h / 2) - (right.bbox.y + right.bbox.h / 2) || left.bbox.x - right.bbox.x);
    const left = Math.min(...ordered.map((line) => line.bbox.x));
    const top = Math.min(...ordered.map((line) => line.bbox.y));
    const right = Math.max(...ordered.map((line) => line.bbox.x + line.bbox.w));
    const bottom = Math.max(...ordered.map((line) => line.bbox.y + line.bbox.h));
    return {
      ...ordered[0],
      text: ordered.map((line) => line.text.trim()).filter(Boolean).join('\n'),
      bbox: { x: left, y: top, w: right - left, h: bottom - top },
      confidence: ordered.reduce((sum, line) => sum + line.confidence, 0) / ordered.length,
      vertical,
      source: [...new Set(ordered.map((line) => line.source))].join('+'),
      needsReview: ordered.some((line) => line.needsReview),
      ...(ordered.every((line) => line.unreadable || !line.text.trim()) ? { unreadable: true } : {}),
      groupId: ordered[0].groupId,
      ...(ordered[0].pageOverlay ? { pageOverlay: true as const } : {}),
      ...(ordered[0].sourcePanelId ? { sourcePanelId: ordered[0].sourcePanelId } : {}),
    };
  });
}

export function normalizeLayoutRecognition(
  payload: BridgeLayoutResponse,
  gutterSettings: PanelGutterSettings = DEFAULT_PANEL_GUTTERS,
): LayoutRecognitionResult {
  if (payload.layout_protocol_version !== LAYOUT_PROTOCOL_VERSION || !Array.isArray(payload.panels)) {
    throw new Error('ローカルbridgeが古いか別のアプリです。起動中のbridgeを停止し、このリポジトリで npm run bridge を再起動してください。');
  }
  const seenPanelIds = new Set<string>();
  const rawPanelRegions = payload.panels.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`ローカルbridgeのコマ${index + 1}の形式が正しくありません。bridgeを再起動してください。`);
    }
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const detectorBox = normalizedPanelBox(item.detector_box);
    if (!id || seenPanelIds.has(id) || !detectorBox) {
      throw new Error(`ローカルbridgeのコマ${index + 1}のIDまたは検出枠が正しくありません。bridgeを再起動してください。`);
    }
    seenPanelIds.add(id);
    if (!item.shape || typeof item.shape !== 'object' || Array.isArray(item.shape)) {
      throw new Error(`ローカルbridgeのコマ${index + 1}に編集形状がありません。bridgeを再起動してください。`);
    }
    const rawShape = item.shape as Record<string, unknown>;
    let shape: PanelShape;
    if (rawShape.type === 'polygon' && Array.isArray(rawShape.points)) {
      const rawPoints = rawShape.points.flatMap((point): Array<[number, number]> => {
        if (!Array.isArray(point) || point.length !== 2) return [];
        const x = Number(point[0]), y = Number(point[1]);
        return Number.isFinite(x) && Number.isFinite(y) ? [[x, y]] : [];
      });
      if (rawPoints.length < 3) {
        throw new Error(`ローカルbridgeのコマ${index + 1}の多角形が壊れています。bridgeを再起動してください。`);
      }
      const left = Math.min(...rawPoints.map((point) => point[0]));
      const right = Math.max(...rawPoints.map((point) => point[0]));
      const top = Math.min(...rawPoints.map((point) => point[1]));
      const bottom = Math.max(...rawPoints.map((point) => point[1]));
      if (right - left < 0.005 || bottom - top < 0.005) {
        throw new Error(`ローカルbridgeのコマ${index + 1}の多角形が小さすぎます。bridgeを再起動してください。`);
      }
      const polygonBox = { x: left, y: top, w: right - left, h: bottom - top };
      // 枠線追跡が人物・背景線へ逸れた場合だけ、同じpanelレコード内のRT-DETR矩形へ戻す。
      shape = boxIntersectionOverUnion(polygonBox, detectorBox) < 0.72
        ? normalizedBoxToPanelShape(detectorBox)
        : {
            type: 'polygon',
            points: rawPoints.map(([x, y]) => [roundMm(clamp(x, 0, 1) * 210), roundMm(clamp(y, 0, 1) * 297)]),
          };
    } else if (rawShape.type === 'rect') {
      const rect = normalizedPanelBox([rawShape.x, rawShape.y, rawShape.w, rawShape.h]);
      if (!rect) throw new Error(`ローカルbridgeのコマ${index + 1}の矩形が壊れています。bridgeを再起動してください。`);
      shape = normalizedBoxToPanelShape(rect);
    } else {
      throw new Error(`ローカルbridgeのコマ${index + 1}の形状種別が正しくありません。bridgeを再起動してください。`);
    }
    return { id, shape };
  });
  const structure = payload.structure && typeof payload.structure === 'object'
    ? payload.structure as Record<string, unknown>
    : {};
  const ocr = payload.ocr && typeof payload.ocr === 'object'
    ? payload.ocr as Record<string, unknown>
    : {};
  const people = payload.people && typeof payload.people === 'object'
    ? payload.people as Record<string, unknown>
    : {};
  const ocrLines = (Array.isArray(ocr.lines) ? ocr.lines : []).flatMap((entry, index): RecognizedTextLine[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const rawBox = Array.isArray(item.bbox) ? item.bbox.map(Number) : [];
    if (rawBox.length !== 4 || rawBox.some((value) => !Number.isFinite(value))) return [];
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    const unreadable = item.unreadable === true;
    if (!text && !unreadable) return [];
    const [x, y, w, h] = rawBox;
    const rawLineConfidence = Number(item.confidence);
    return [{
      id: typeof item.id === 'string' && item.id ? item.id : `ocr-${index}`,
      text,
      bbox: {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
        w: Math.min(1, Math.max(0, w)),
        h: Math.min(1, Math.max(0, h)),
      },
      confidence: Number.isFinite(rawLineConfidence) ? Math.min(1, Math.max(0, rawLineConfidence)) : 0,
      vertical: item.vertical === true,
      source: typeof item.source === 'string' ? item.source : 'rtdetr-text',
      needsReview: item.needs_review !== false,
      ...(unreadable ? { unreadable: true } : {}),
      ...(typeof item.group_id === 'string' && item.group_id.trim() ? { groupId: item.group_id.trim() } : {}),
    }];
  });
  const normalizedFigureRegions = (Array.isArray(people.regions) ? people.regions : []).flatMap((entry): DetectedFigureRegion[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const source = item.source === 'face' ? 'face' : item.source === 'body' ? 'body' : null;
    const regionBox = normalizedPanelBox(item.bbox);
    if (!source || !regionBox) return [];
    const faceBBox = source === 'body' ? normalizedPanelBox(item.face_bbox, 0) : null;
    const rawConfidence = Number(item.confidence ?? item.score);
    return [{
      id: typeof item.id === 'string' ? item.id.trim() : '',
      source,
      bbox: { x: Number(regionBox.x.toFixed(6)), y: Number(regionBox.y.toFixed(6)),
        w: Number(regionBox.w.toFixed(6)), h: Number(regionBox.h.toFixed(6)) },
      ...(faceBBox ? { faceBBox } : {}),
      ...(Number.isFinite(rawConfidence) ? { confidence: clamp(rawConfidence, 0, 1) } : {}),
    }];
  }).sort((left, right) => Number(left.source === 'face') - Number(right.source === 'face')
    || left.bbox.y - right.bbox.y || right.bbox.x - left.bbox.x);
  const uniqueFigureRegions = normalizedFigureRegions.filter((candidate, index) => !normalizedFigureRegions.slice(0, index).some((kept) => {
    const intersection = overlapArea(candidate.bbox, kept.bbox);
    const candidateArea = candidate.bbox.w * candidate.bbox.h;
    const keptArea = kept.bbox.w * kept.bbox.h;
    const union = candidateArea + keptArea - intersection;
    const smaller = Math.min(candidateArea, keptArea);
    return smaller > 0 && (intersection / smaller >= 0.88 || (union > 0 && intersection / union >= 0.58));
  })).map((region, index) => ({
    ...region,
    id: region.id || `figure-${String(index + 1).padStart(3, '0')}`,
  }));
  const indexesToKeep = detectedPanelIndexesToKeep(rawPanelRegions.map((region) => region.shape));
  const keptPanelRegions = indexesToKeep.map((index) => rawPanelRegions[index]);
  const sourceFrame = detectedSourceFrame(keptPanelRegions.map((region) => region.shape));
  // 所属は直線化・内枠対応・溝調整より前の検出形状で固定する。
  const ownershipPanels: Panel[] = keptPanelRegions.map((region, index) => ({
    id: index + 1,
    shape: structuredClone(region.shape),
    bg: 0,
    bubbles: [],
    action: null,
  }));
  const sourceOwnerForBox = (box: BBox, confidence: number, allowPageOverlay: boolean, allowOutsidePanels: boolean): { sourcePanelId?: string; pageOverlay?: true } => {
    if (!ownershipPanels.length) return {};
    const canvasBox = sourceFrameBoxToCanvas(box, null, 210, 297);
    const owner = nearestPanel(
      ownershipPanels,
      canvasBox.x + canvasBox.w / 2,
      canvasBox.y + canvasBox.h / 2,
    );
    if (allowPageOverlay && belongsToPageOverlay(ownershipPanels, canvasBox, confidence, allowOutsidePanels, owner)) return { pageOverlay: true };
    const ownerIndex = owner ? ownershipPanels.indexOf(owner) : -1;
    return ownerIndex >= 0 ? { sourcePanelId: keptPanelRegions[ownerIndex].id } : {};
  };
  const ownedOcrLines = ocrLines.map((line) => {
    // OCRの文字bboxは斜めコマ境界をまたぎやすい。外形検出なしでページ前景へ昇格させない。
    const owner = sourceOwnerForBox(line.bbox, line.confidence, false, false);
    return { ...line, ...owner };
  });
  const detectedFigures = uniqueFigureRegions.map((region) => {
    const owner = sourceOwnerForBox(region.bbox, region.confidence ?? 0, true, true);
    return { ...region, ...owner };
  });
  const editingShapes = keptPanelRegions.map((region) => straightenNearRectShape(region.shape));
  const calibratedPanels = sourceFrame
    ? editingShapes.map((shape) => sourceFrameShapeToInnerFrame(shape, sourceFrame))
    : editingShapes;
  // Independently framed strips have their own printed margins. Apply gutter
  // adjustments inside each story without treating the two strips as one row.
  const separateStrips = structure.independent_four_panel_strips === true
    && rawPanelRegions.length === 8 && calibratedPanels.length === 8;
  const detectedPanels = separateStrips
    ? [calibratedPanels.slice(0, 4), calibratedPanels.slice(4)].flatMap(strip => normalizeDetectedPanelGeometry(strip, gutterSettings))
    : normalizeDetectedPanelGeometry(calibratedPanels, gutterSettings);
  const detectedPanelIds = keptPanelRegions.map((region) => region.id);
  const removedPanelCount = rawPanelRegions.length - detectedPanels.length;
  const baseReason = removedPanelCount > 0
    ? `重複する候補を${removedPanelCount}個除外し、${detectedPanels.length}個のコマ領域を編集開始位置として使用します。`
    : typeof payload.reason === 'string' && payload.reason.trim()
      ? payload.reason.trim()
      : detectedPanels.length ? '検出したコマ領域を編集開始位置として使用できます。' : '読み取れるコマ領域を特定できませんでした。';
  const reason = detectedPanels.length
    ? separateStrips
      ? `${baseReason} 右列4コマ、左列4コマの順です。列の間は原稿の余白を保ち、列内の上下間隔を${roundMm(clamp(gutterSettings.rowGapMm, 0, 20))}mmに整えています。`
      : `${baseReason} ${sourceFrame ? '検出原稿の外枠を内枠へ対応させ、' : '内枠内へ収め、'}4mm以内の辺を整列し、コマ間は上下${roundMm(clamp(gutterSettings.rowGapMm, 0, 20))}mm・左右${roundMm(clamp(gutterSettings.columnGapMm, 0, 20))}mmに整えています。`
    : baseReason;
  const detectedPanelCount = detectedPanels.length;
  return {
    detectedPanels,
    detectedPanelIds,
    detectedFigures,
    sourceFrame,
    reason,
    detectedPanelCount,
    structureEngine: typeof structure.engine === 'string' ? structure.engine : '',
    excludedNonPanelCount: Math.max(0, Math.round(
      (Number(structure.excluded_as_text_count) || 0)
      + (Number(structure.excluded_as_face_count) || 0)
      + (Number(structure.excluded_as_body_count) || 0)
      + (Number(structure.excluded_as_header_count) || 0),
    )) + Math.max(0, removedPanelCount),
    detectedTextRegionCount: Math.max(0, Math.round(Number(structure.text_region_count) || 0)),
    detectedFaceRegionCount: Math.max(0, Math.round(Number(structure.face_region_count) || 0)),
    detectedBodyRegionCount: Math.max(0, Math.round(Number(structure.body_region_count) || 0)),
    ocrEngine: typeof ocr.engine === 'string' ? ocr.engine : '',
    ocrLines: ownedOcrLines,
  };
}
