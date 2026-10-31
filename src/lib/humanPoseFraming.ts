import { PerspectiveCamera, Vector3 } from 'three';
import type { BBox, Figure, FigureSize, Panel } from '../types.ts';
import type { HumanPoseFraming, HumanPoseSceneSettings } from './humanPoseTypes.ts';
import { panelBounds, panelShapePoints } from './canvasGeometry.ts';
import { paintReferenceBox, type PaintOwner } from './paintDocument.ts';
import { artworkPixelSize } from './artworkClipboard.ts';

export function humanPoseFigureFrame(figure: Figure, fallback: BBox): BBox {
  return paintReferenceBox(figure.artwork?.paint, figure.bbox ?? fallback, figure.artwork?.crop);
}

/** Inverse of paintReferenceBox: adopting a panel-sized image keeps the original guide in place. */
export function humanPoseReferencePixels(reference: BBox, frame: BBox, width: number, height: number): BBox {
  const scale = Math.min(frame.w / width, frame.h / height);
  const x = frame.x + (frame.w - width * scale) / 2, y = frame.y + (frame.h - height * scale) / 2;
  return { x: (reference.x - x) / scale, y: (reference.y - y) / scale, w: reference.w / scale, h: reference.h / scale };
}

/** The source frame is the figure's reference frame, not the panel's bounding box. */
export interface HumanPoseCutFrame { aspect: number; points: [number, number][]; bounds: BBox }
export const HUMAN_POSE_PREVIEW_MARGIN = .08;

/** Reuse the manuscript outline; its placement is supplied by the editing owner. */
function poseCutFrame(frame: BBox, bounds: BBox, outline: [number, number][]): HumanPoseCutFrame {
  return { aspect: frame.w / frame.h,
    bounds: { x: (bounds.x - frame.x) / frame.w, y: (bounds.y - frame.y) / frame.h, w: bounds.w / frame.w, h: bounds.h / frame.h },
    points: outline.map(([x, y]) => [(x - frame.x) / frame.w, (y - frame.y) / frame.h]) };
}

export function humanPosePanelCutFrame(panel: Panel, frame: BBox = panelBounds(panel)): HumanPoseCutFrame {
  return poseCutFrame(frame, panelBounds(panel), panelShapePoints(panel));
}

/** Capture the same part of the original camera view that the adopted layer will occupy. */
export function threeImageFigureTarget(owner: PaintOwner, referenceFrame: BBox, panel?: Panel, mask?: BBox) {
  if (!mask && !panel) return;
  if (mask && (![mask.x, mask.y, mask.w, mask.h].every(Number.isSafeInteger)
      || mask.x < 0 || mask.y < 0 || mask.w < 1 || mask.h < 1
      || mask.x + mask.w > owner.paint.width || mask.y + mask.h > owner.paint.height)) {
    throw new Error('生成マスクの範囲が不正です');
  }
  // Use the inverse of insertGeneratedPaintImage's manuscript-to-layer transform.
  const sx = owner.frame.w / owner.paint.width, sy = owner.frame.h / owner.paint.height;
  const outputFrame = mask ? { x: owner.frame.x + mask.x*sx, y: owner.frame.y + mask.y*sy,
    w: mask.w*sx, h: mask.h*sy } : panelBounds(panel!);
  const { x, y, w, h } = outputFrame;
  const outline: [number, number][] = panel ? panelShapePoints(panel) : [[x, y], [x+w, y], [x+w, y+h], [x, y+h]];
  const { width, height } = mask ? { width: mask.w, height: mask.h } : artworkPixelSize(outputFrame, owner.paint.dpi);
  return { outputFrame, width, height, cutFrame: poseCutFrame(referenceFrame, outputFrame, outline) };
}

export function humanPosePreviewWindow(cut?: HumanPoseCutFrame, margin = HUMAN_POSE_PREVIEW_MARGIN): BBox {
  const box = cut?.bounds ?? { x: 0, y: 0, w: 1, h: 1 }, scale = 1 / (1 - 2 * margin);
  return { x: box.x - box.w * scale * margin, y: box.y - box.h * scale * margin, w: box.w * scale, h: box.h * scale };
}

export function humanPoseCutOutline(cut?: HumanPoseCutFrame, margin = HUMAN_POSE_PREVIEW_MARGIN): string {
  const points = cut?.points ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
  const view = humanPosePreviewWindow(cut, margin);
  return `M${points.map(([x, y]) => `${(x - view.x) / view.w} ${(y - view.y) / view.h}`).join('L')}Z`;
}

export const MANUAL_HUMAN_POSE_FRAMING: FigureSize[] = ['face-detail', 'hand', 'foot', 'part'];

/** Project the posed anatomy, rather than taking a fixed percentage of a standing figure. */
export function humanPoseFraming(points: Map<string, Vector3>, camera: PerspectiveCamera, size: FigureSize): HumanPoseFraming {
  if (MANUAL_HUMAN_POSE_FRAMING.includes(size)) return { size, crop: { x: 0, y: 0, w: 1, h: 1 } };
  const names = size === 'full' || size === 'long' ? [...points.keys()] : size === 'face' ? []
    : ['head', 'neck01', 'upperarm01.L', 'upperarm01.R',
      ...(['bust-up', 'waist-up', 'knee-up'].includes(size) ? ['spine02'] : []),
      ...(['waist-up', 'knee-up'].includes(size) ? ['spine04', 'upperleg01.L', 'upperleg01.R'] : []),
      ...(size === 'knee-up' ? ['lowerleg01.L', 'lowerleg01.R'] : [])];
  const centre = points.get('headCentre'), top = points.get('headTop');
  if (!centre || !top) throw new Error('撮影範囲を決める頭の位置がありません');
  const radius = top.distanceTo(centre);
  const samples = names.flatMap(name => points.has(name) ? [points.get(name)!.clone()] : []);
  // The rendered head is a sphere. Its bounding cube includes its width at every angle.
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) samples.push(centre.clone().add(new Vector3(x, y, z).multiplyScalar(radius)));
  camera.updateMatrixWorld(true);
  const projected = samples.map(point => {
    if (point.clone().applyMatrix4(camera.matrixWorldInverse).z >= -camera.near) throw new Error('人物がカメラに近すぎます。3D画面で撮影位置を調整してください');
    const p = point.project(camera);
    if (![p.x, p.y].every(Number.isFinite)) throw new Error('撮影範囲を決められません');
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  });
  const minX = Math.min(...projected.map(p => p.x)), maxX = Math.max(...projected.map(p => p.x));
  const minY = Math.min(...projected.map(p => p.y)), maxY = Math.max(...projected.map(p => p.y));
  // A square in normalized coordinates preserves the current frame's aspect ratio.
  // Face and full-body presets contain their complete bounds, including in a narrow frame.
  // Torso shots keep their anatomical cutoff; only those presets may crop the sides.
  const extent = (['long', 'full', 'face'].includes(size) ? Math.max(maxX - minX, maxY - minY) : maxY - minY) * (size === 'long' ? 1.7 : 1.08);
  if (!Number.isFinite(extent) || extent < .0001 || extent > 100) throw new Error('撮影範囲が極端です。3D画面でカメラを調整してください');
  return { size, crop: { x: (minX + maxX - extent) / 2, y: (minY + maxY - extent) / 2, w: extent, h: extent } };
}

/** This is an image crop in projection space: camera position, direction and FOV stay intact. */
export function applyHumanPoseFraming(camera: PerspectiveCamera, scene: HumanPoseSceneSettings, view?: BBox): void {
  if (!scene.framing && !view) return;
  const crop = scene.framing?.crop ?? { x: 0, y: 0, w: 1, h: 1 }, { width, height } = scene.frame;
  const window = view ?? { x: 0, y: 0, w: 1, h: 1 };
  const w = crop.w * window.w, h = crop.h * window.h, x = crop.x + crop.w * window.x, y = crop.y + crop.h * window.y;
  const [sx, sy] = scene.camera.shift ?? [0, 0];
  camera.setViewOffset(width, height, (x - sx) * width, (y - sy) * height, w * width, h * height);
}
