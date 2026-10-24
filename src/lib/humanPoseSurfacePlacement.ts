import { Vector3 } from 'three';
import { humanPoseWorldMatrices } from './humanPoseMirror.ts';
import { worldRotation } from './humanPoseJoints.ts';
import type { HumanPoseData, HumanPoseRig, HumanPoseSceneSettings, HumanPoseSurfaceAnchor, HumanPoseSurfacePlacement } from './humanPoseTypes.ts';

export const HUMAN_POSE_SURFACE_ANCHORS: Array<{ id: HumanPoseSurfaceAnchor; label: string }> = [
  { id: 'feet', label: '両足の下端' }, { id: 'left_foot', label: '左足の下端' },
  { id: 'right_foot', label: '右足の下端' }, { id: 'hips', label: '腰の中心（座面）' },
];
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const vector = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(n => number(n, -10000, 10000));
const horizontal = Math.cos(Math.PI / 180); // Flat floors and seats; slopes need a different placement model.
export function validateHumanPoseSurface(value: unknown): asserts value is HumanPoseSurfacePlacement {
  const s = value as HumanPoseSurfacePlacement;
  if (!s || typeof s !== 'object' || s.version !== 1 || !vector(s.point) || !vector(s.normal)
    || Math.abs(Math.hypot(...s.normal) - 1) > 1e-5 || s.normal[1] < horizontal
    || !Number.isSafeInteger(s.surfaceMesh) || s.surfaceMesh < 0 || s.surfaceMesh > 1000000
    || !HUMAN_POSE_SURFACE_ANCHORS.some(a => a.id === s.anchor) || !number(s.height_offset, -1000, 1000)
    || (s.facing_degrees !== undefined && !number(s.facing_degrees, -180, 180))) throw new Error('床・座面の配置指定が不正です');
}
export function humanPoseSurfaceFromHit(hit: { point: Vector3; normal: Vector3; surfaceMesh: number }, anchor: HumanPoseSurfaceAnchor): HumanPoseSurfacePlacement {
  if (hit.normal.y < horizontal) throw new Error('床や座面の、水平な上側の面を選んでください');
  const result: HumanPoseSurfacePlacement = { version: 1, point: hit.point.toArray(), normal: hit.normal.toArray(), surfaceMesh: hit.surfaceMesh, anchor, height_offset: 0 };
  validateHumanPoseSurface(result); return result;
}
function footVertices(points: Map<string, Vector3>, anchor: HumanPoseSurfaceAnchor): Vector3[] {
  const sides = anchor === 'left_foot' ? ['L'] : anchor === 'right_foot' ? ['R'] : ['L', 'R'];
  return sides.flatMap(side => Array.from({ length: 4 }, (_, i) => ['a', 'b'].map(edge => {
    const p = points.get(`plate${i}${edge}.${side}`); if (!p) throw new Error('設置に使う足の基準点がありません'); return p;
  })).flat());
}
export function humanPoseSurfaceAnchor(points: Map<string, Vector3>, anchor: HumanPoseSurfaceAnchor): Vector3 {
  const get = (id: string) => { const p = points.get(id); if (!p) throw new Error('設置に使う身体の基準点がありません'); return p; };
  if (anchor === 'hips') return get('upperleg01.L').clone().add(get('upperleg01.R')).multiplyScalar(.5);
  const vertices = footVertices(points, anchor);
  const centre = vertices.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / vertices.length);
  centre.y = Math.min(...vertices.map(p => p.y)); return centre;
}
export function humanPosePlacementScale(scene: HumanPoseSceneSettings, nativeHeight: number): number {
  return (scene.placement.scale ?? 1) * (scene.stature_m ? scene.stature_m / nativeHeight : 1);
}
export const wrapHumanPoseDegrees = (degrees: number): number => ((degrees + 180) % 360 + 360) % 360 - 180;
/** The pelvis, rather than gaze or shoulder twist, defines the body's facing direction. */
export function humanPoseBodyFacing(rig: HumanPoseRig, pose: HumanPoseData, requireUpright = false): number | undefined {
  const rest = humanPoseWorldMatrices(rig).get('root'), current = humanPoseWorldMatrices(rig, pose).get('root');
  if (!rest || !current) return;
  const rotation = worldRotation(current).multiply(worldRotation(rest).invert());
  // 水平方位を人物の左右と呼べる範囲に限定する。床配置の正面指定は従来どおり。
  if (requireUpright && new Vector3(0, 1, 0).applyQuaternion(rotation).y < Math.SQRT1_2) return;
  const forward = new Vector3(0, 0, 1).applyQuaternion(rotation);
  return Math.hypot(forward.x, forward.z) < .1 ? undefined : Math.atan2(forward.x, forward.z) * 180 / Math.PI;
}
export function alignHumanPoseSurface(scene: HumanPoseSceneSettings, points: Map<string, Vector3>, nativeHeight: number, bodyFacing: number | undefined,
  surface = scene.background?.surface): HumanPoseSceneSettings {
  if (!scene.background || !surface) throw new Error('先に背景の床・座面を選んでください');
  validateHumanPoseSurface(surface);
  if (surface.facing_degrees !== undefined && bodyFacing === undefined) throw new Error('この姿勢では水平な正面を決められません。向きの指定を解除するか、姿勢を調整してください');
  const next = structuredClone(scene), yaw = surface.facing_degrees === undefined ? scene.placement.yaw_degrees : wrapHumanPoseDegrees(surface.facing_degrees - bodyFacing!);
  const transform = (p: Vector3) => p.clone().multiplyScalar(humanPosePlacementScale(scene, nativeHeight)).applyAxisAngle(new Vector3(0, 1, 0), yaw * Math.PI / 180);
  const anchor = transform(humanPoseSurfaceAnchor(points, surface.anchor));
  if (surface.anchor !== 'hips') {
    const [nx, ny, nz] = surface.normal;
    anchor.y = Math.min(...footVertices(points, surface.anchor).map(p => {
      const v = transform(p); return v.y + (nx * (v.x - anchor.x) + nz * (v.z - anchor.z)) / ny;
    }));
  }
  const target = new Vector3(...surface.point); target.y += surface.height_offset;
  next.placement = { ...next.placement, yaw_degrees: yaw, position: target.sub(anchor).toArray() };
  if (!vector(next.placement.position)) throw new Error('配置が扱える座標範囲を超えます。人物の大きさを確認してください');
  next.background!.surface = structuredClone(surface); next.show_supports = false; return next;
}
export function humanPoseSurfaceAligned(scene: HumanPoseSceneSettings, points: Map<string, Vector3>, nativeHeight: number, bodyFacing: number | undefined): boolean {
  const surface = scene.background?.surface; if (!surface) return false;
  try {
    const next = alignHumanPoseSurface(scene, points, nativeHeight, bodyFacing);
    const tolerance = .001 * humanPosePlacementScale(scene, nativeHeight);
    return new Vector3(...next.placement.position).distanceTo(new Vector3(...scene.placement.position)) <= tolerance
      && Math.abs(wrapHumanPoseDegrees(next.placement.yaw_degrees - scene.placement.yaw_degrees)) < .1;
  } catch { return false; }
}
