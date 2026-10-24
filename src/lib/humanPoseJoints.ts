import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { humanPoseWorldMatrices, mirrorHumanPoseBody } from './humanPoseMirror.ts';
import type { HumanPoseData, HumanPoseJointEdits, HumanPoseRig, HumanPoseSceneSettings, PoseQuaternion, PoseVector } from './humanPoseTypes.ts';

type Range = [number, number];
export interface HumanPoseJoint { id: string; label: string; detail?: boolean; limits: [Range, Range, Range] }
const joint = (id: string, label: string, limits: [Range, Range, Range], detail = false): HumanPoseJoint => ({ id, label, limits, detail });
export const HUMAN_POSE_JOINTS: HumanPoseJoint[] = [
  joint('head', '頭', [[-50, 60], [-75, 75], [-45, 45]]),
  joint('neck01', '首', [[-35, 35], [-40, 40], [-30, 30]]),
  joint('spine04', '腰', [[-35, 55], [-40, 40], [-30, 30]]),
  joint('spine02', '胸', [[-30, 35], [-35, 35], [-25, 25]]),
  ...(['L', 'R'] as const).flatMap(side => {
    const s = side === 'L' ? '左' : '右';
    return [
      joint(`upperarm01.${side}`, `${s}肩`, [[-170, 170], [-95, 95], [-170, 170]]),
      joint(`lowerarm01.${side}`, `${s}肘`, [[-150, 150], [-85, 85], [-150, 150]]),
      joint(`wrist.${side}`, `${s}手首`, [[-75, 80], [-80, 80], [-25, 35]]),
      joint(`upperleg01.${side}`, `${s}股関節`, [[-125, 125], [-60, 60], [-60, 60]]),
      joint(`lowerleg01.${side}`, `${s}膝`, [[-150, 150], [-10, 10], [-10, 10]]),
      joint(`foot.${side}`, `${s}足首`, [[-45, 30], [-20, 20], [-25, 25]]),
      joint(`footArch.${side}`, `${s}足・土踏まず`, [[-15, 25], [0, 0], [0, 0]]),
      joint(`footBall.${side}`, `${s}足・つま先の付け根`, [[-65, 60], [0, 0], [0, 0]]),
      ...Array.from({ length: 5 }, (_, f) => [
        ...Array.from({ length: 3 }, (_, k) => joint(`finger${f + 1}-${k + 1}.${side}`, `${s}${['親指', '人差指', '中指', '薬指', '小指'][f]}・${['付け根', '中間', '先端'][k]}`, [[-15, f === 0 ? 80 : 110], [-15, 15], k === 0 ? [-30, 30] : [-5, 5]], true)),
      ]).flat(),
    ];
  }),
];
export const humanPoseJoint = (id: string) => HUMAN_POSE_JOINTS.find(value => value.id === id);
export const HUMAN_POSE_HANDLES = [...HUMAN_POSE_JOINTS, ...(['L', 'R'] as const).flatMap(side => [
  { id: `foot-tip.${side}`, label: `${side === 'L' ? '左' : '右'}足先`, detail: false },
  ...Array.from({ length: 5 }, (_, f) => ({ id: `finger${f + 1}-tip.${side}`, label: `${side === 'L' ? '左' : '右'}${['親指', '人差指', '中指', '薬指', '小指'][f]}の先`, detail: true })),
])];
const virtualFoot = (id: string) => /^foot(Arch|Ball)\.[LR]$/u.test(id);
const swapFeet = (bends: HumanPoseJointEdits['foot_bends']) => bends && ({ ...(bends.R ? { L: [...bends.R] as [number, number] } : {}), ...(bends.L ? { R: [...bends.L] as [number, number] } : {}) });

export function validateHumanPoseJointEdits(value: unknown): asserts value is HumanPoseJointEdits {
  const data = value as HumanPoseJointEdits;
  if (!data || typeof data !== 'object' || data.version !== 1 || !data.rotations || typeof data.rotations !== 'object' || Array.isArray(data.rotations)
    || Object.entries(data.rotations).some(([name, q]) => !humanPoseJoint(name) || virtualFoot(name) || !Array.isArray(q) || q.length !== 4 || !q.every(Number.isFinite) || Math.abs(q.reduce((s, v) => s + v * v, 0) - 1) > 1e-4)
    || (data.foot_bends !== undefined && (!data.foot_bends || typeof data.foot_bends !== 'object' || Array.isArray(data.foot_bends) || Object.entries(data.foot_bends).some(([side, values]) => !['L', 'R'].includes(side) || !Array.isArray(values) || values.length !== 2 || values.some((v, i) => !Number.isFinite(v) || v < (i ? -65 : -15) || v > (i ? 60 : 25)))))
    || (data.motion_foot_offsets !== undefined && (!data.motion_foot_offsets || typeof data.motion_foot_offsets !== 'object' || Array.isArray(data.motion_foot_offsets) || Object.entries(data.motion_foot_offsets).some(([side, values]) => !['L', 'R'].includes(side) || !data.foot_bends?.[side as 'L' | 'R'] || !Array.isArray(values) || values.length !== 2 || values.some((v, i) => !Number.isFinite(v) || Math.abs(v) > (i ? 125 : 40)))))
    || (data.root_offset !== undefined && (!Array.isArray(data.root_offset) || data.root_offset.length !== 3 || !data.root_offset.every(v => Number.isFinite(v) && Math.abs(v) <= 10)))) throw new Error('関節の編集値が不正です');
}

export function editedHumanPose(rig: HumanPoseRig, base: HumanPoseData, scene: Pick<HumanPoseSceneSettings, 'joint_edits' | 'body_mirror'>): HumanPoseData {
  const pose = structuredClone(base), edits = scene.joint_edits;
  if (edits) {
    validateHumanPoseJointEdits(edits);
    for (const [name, q] of Object.entries(edits.rotations)) {
      if (!pose.bones[name]) throw new Error(`関節が素材にありません: ${name}`);
      pose.bones[name].rotation = [...q];
    }
    if (edits.root_offset) pose.root.translation = pose.root.translation.map((v, i) => v + edits.root_offset![i]) as PoseVector;
    if (edits.foot_bends) pose.foot_bends = structuredClone(edits.foot_bends);
  }
  if (scene.body_mirror !== 'mirrored') return pose;
  const mirrored = mirrorHumanPoseBody(rig, pose);
  if (pose.foot_bends) mirrored.foot_bends = swapFeet(pose.foot_bends);
  return mirrored;
}

/** 表示中の左右で編集し、保存時だけ反転前の座標へ戻す。元の素材は変更しない。 */
export function humanPoseEdits(rig: HumanPoseRig, base: HumanPoseData, displayed: HumanPoseData, mirrored = false, previous?: HumanPoseJointEdits): HumanPoseJointEdits {
  const pose = mirrored ? mirrorHumanPoseBody(rig, displayed) : displayed;
  const rotations: Record<string, PoseQuaternion> = {};
  for (const { id } of HUMAN_POSE_JOINTS) {
    if (!pose.bones[id] || !base.bones[id]) continue;
    const q = new Quaternion(...pose.bones[id].rotation).normalize(), original = new Quaternion(...base.bones[id].rotation).normalize();
    if (1 - Math.abs(q.dot(original)) > 1e-12) rotations[id] = q.toArray() as PoseQuaternion;
  }
  const offset = pose.root.translation.map((v, i) => v - base.root.translation[i]) as PoseVector;
  const result: HumanPoseJointEdits = { version: 1, rotations, ...(Math.hypot(...offset) > 1e-8 ? { root_offset: offset } : {}) };
  if (displayed.foot_bends) result.foot_bends = mirrored ? swapFeet(displayed.foot_bends) : structuredClone(displayed.foot_bends);
  // Keep unclamped motion offsets for feet that this manual operation did not change.
  for (const side of ['L', 'R'] as const) {
    const offset = previous?.motion_foot_offsets?.[side], values = result.foot_bends?.[side];
    if (offset && values?.every((v, i) => Math.abs(v - (previous?.foot_bends?.[side]?.[i] ?? Infinity)) < 1e-8)) {
      result.motion_foot_offsets ??= {}; result.motion_foot_offsets[side] = [...offset];
    }
  }
  validateHumanPoseJointEdits(result); return result;
}

export const posePoint = (worlds: Map<string, Matrix4>, id: string): Vector3 => {
  const matrix = worlds.get(id); if (!matrix) throw new Error(`関節が素材にありません: ${id}`);
  return new Vector3().setFromMatrixPosition(matrix);
};
export const worldRotation = (matrix: Matrix4) => new Quaternion().setFromRotationMatrix(matrix).normalize();

const restPoints = new WeakMap<HumanPoseRig, Map<string, Matrix4>>();
const restWorlds = (rig: HumanPoseRig) => { let worlds = restPoints.get(rig); if (!worlds) { worlds = humanPoseWorldMatrices(rig); restPoints.set(rig, worlds); } return worlds; };
export function humanPoseFingerTip(rig: HumanPoseRig, pose: HumanPoseData | undefined, id: string, worlds = humanPoseWorldMatrices(rig, pose)): Vector3 {
  const last = id.replace('-tip.', '-3.'), prior = id.replace('-tip.', '-2.'), rest = restWorlds(rig);
  return new Vector3(0, posePoint(rest, last).distanceTo(posePoint(rest, prior)) * .85, 0).applyMatrix4(worlds.get(last)!);
}

/** 足指は表示せず、踵→土踏まず→つま先の付け根→先端の3枚に置き換える。 */
export function humanPoseFootPoints(rig: HumanPoseRig, pose: HumanPoseData | undefined, side: 'L' | 'R', worlds = humanPoseWorldMatrices(rig, pose)): Vector3[] {
  const rest = restWorlds(rig), ankle = posePoint(rest, `foot.${side}`), inverse = rest.get(`foot.${side}`)!.clone().invert();
  const ball = new Vector3(), tip = new Vector3();
  for (let f = 1; f <= 5; f++) {
    ball.add(posePoint(rest, `toe${f}-1.${side}`));
    tip.add(new Vector3(0, .012, 0).applyMatrix4(rest.get(`toe${f}-${f === 1 ? 2 : 3}.${side}`)!));
  }
  ball.multiplyScalar(.2); tip.multiplyScalar(.2);
  const heel = new Vector3(ankle.x, .014, ankle.z - .027), arch = heel.clone().lerp(ball, .5);
  const points = [heel, arch, ball, tip].map(p => p.applyMatrix4(inverse));
  const axis = new Vector3(1, 0, 0).transformDirection(inverse), bends = pose?.foot_bends?.[side] ?? [0, 0];
  for (let i = 0; i < 2; i++) for (let j = i + 2; j < 4; j++) points[j].sub(points[i + 1]).applyAxisAngle(axis, MathUtils.degToRad(bends[i])).add(points[i + 1]);
  return points.map(p => p.applyMatrix4(worlds.get(`foot.${side}`)!));
}

// 手は手のひらに沿う軸へ補正する。X=曲げ、Y=ひねり、Z=横倒し。
const jointFrames = new WeakMap<HumanPoseRig, Map<string, Quaternion>>();
function jointFrame(rig: HumanPoseRig, id: string): Quaternion {
  if (!/^(wrist|finger)/u.test(id)) return new Quaternion();
  let cache = jointFrames.get(rig); if (!cache) { cache = new Map(); jointFrames.set(rig, cache); }
  const cached = cache.get(id); if (cached) return cached.clone();
  const side = id.slice(-1), worlds = humanPoseWorldMatrices(rig);
  const wrist = posePoint(worlds, `wrist.${side}`);
  const forward = posePoint(worlds, `finger3-1.${side}`).sub(wrist).normalize();
  const normal = posePoint(worlds, `finger2-1.${side}`).sub(wrist).cross(posePoint(worlds, `finger5-1.${side}`).sub(wrist)).normalize().multiplyScalar(side === 'L' ? 1 : -1);
  const x = forward.clone().cross(normal).normalize(), z = x.clone().cross(forward).normalize();
  const frame = worldRotation(new Matrix4().makeBasis(x, forward, z));
  const result = worldRotation(worlds.get(id)!).invert().multiply(frame); cache.set(id, result.clone()); return result;
}

export function humanPoseJointAngles(rig: HumanPoseRig, pose: HumanPoseData, id: string): PoseVector {
  if (virtualFoot(id)) return [pose.foot_bends?.[id.slice(-1) as 'L' | 'R']?.[id.startsWith('footArch') ? 0 : 1] ?? 0, 0, 0];
  const rest = rig.bones.find(bone => bone.name === id);
  if (!rest || !humanPoseJoint(id)) throw new Error('操作する関節がありません');
  const frame = jointFrame(rig, id);
  const q = frame.clone().invert().multiply(new Quaternion(...rest.rest.rotation).invert()).multiply(new Quaternion(...pose.bones[id].rotation)).multiply(frame);
  const angles = new Euler().setFromQuaternion(q, 'XYZ');
  return [angles.x, angles.y, angles.z].map(MathUtils.radToDeg) as PoseVector;
}

export function setHumanPoseJointAngles(rig: HumanPoseRig, pose: HumanPoseData, id: string, angles: PoseVector, initial?: PoseVector): void {
  const def = humanPoseJoint(id), rest = rig.bones.find(bone => bone.name === id);
  if (virtualFoot(id) && def && angles.every(Number.isFinite)) {
    const side = id.slice(-1) as 'L' | 'R', index = id.startsWith('footArch') ? 0 : 1;
    pose.foot_bends ??= {}; const bends = [...(pose.foot_bends[side] ?? [0, 0])] as [number, number];
    bends[index] = MathUtils.clamp(angles[0], ...def.limits[0]); pose.foot_bends[side] = bends; return;
  }
  if (!def || !rest || !angles.every(Number.isFinite)) throw new Error('関節の角度が不正です');
  const clamped = angles.map((v, i) => MathUtils.degToRad(MathUtils.clamp(v, Math.min(def.limits[i][0], initial?.[i] ?? Infinity), Math.max(def.limits[i][1], initial?.[i] ?? -Infinity))));
  const frame = jointFrame(rig, id);
  pose.bones[id].rotation = new Quaternion(...rest.rest.rotation).multiply(frame).multiply(new Quaternion().setFromEuler(new Euler(...clamped as [number, number, number], 'XYZ'))).multiply(frame.invert()).normalize().toArray() as PoseQuaternion;
}
