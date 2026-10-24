import { PerspectiveCamera, Vector3 } from 'three';
import type { FigureSize } from '../types.ts';
import type { HumanPoseFraming, HumanPoseSceneSettings } from './humanPoseTypes.ts';

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
  // Torso shots keep their anatomical cutoff even in a narrow frame; the sides may be cropped.
  const extent = (['long', 'full'].includes(size) ? Math.max(maxX - minX, maxY - minY) : maxY - minY) * (size === 'long' ? 1.7 : 1.08);
  if (!Number.isFinite(extent) || extent < .0001 || extent > 100) throw new Error('撮影範囲が極端です。3D画面でカメラを調整してください');
  return { size, crop: { x: (minX + maxX - extent) / 2, y: (minY + maxY - extent) / 2, w: extent, h: extent } };
}

/** This is an image crop in projection space: camera position, direction and FOV stay intact. */
export function applyHumanPoseFraming(camera: PerspectiveCamera, scene: HumanPoseSceneSettings): void {
  if (!scene.framing) return;
  const { x, y, w, h } = scene.framing.crop, { width, height } = scene.frame;
  const [sx, sy] = scene.camera.shift ?? [0, 0];
  camera.setViewOffset(width, height, (x - sx) * width, (y - sy) * height, w * width, h * height);
}
