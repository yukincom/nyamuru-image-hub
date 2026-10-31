import { Matrix4, Quaternion, Vector3 } from 'three';
import { humanPoseWorldMatrices } from './humanPoseMirror.ts';
import { editedHumanPose, posePoint, validateHumanPoseJointEdits, worldRotation } from './humanPoseJoints.ts';
import { humanPoseSkeletonPoints } from './humanPoseSkeleton.ts';
import type { HumanPoseData, HumanPoseJointEdits, HumanPoseRig } from './humanPoseTypes.ts';

// Build-time retargeting. Each anatomical segment can contain several target bones.
// They receive one world-space turn, so the intermediate bones do not double it.
interface Segment { source: string; target: string[]; sourceEnd?: string; targetEnd?: string; palm?: 'L' | 'R' }
const segments: Segment[] = [
  { source: 'pelvis', target: ['root'] },
  { source: 'spine_01', target: ['spine04', 'spine03'], sourceEnd: 'spine_02', targetEnd: 'spine02' },
  { source: 'spine_02', target: ['spine02'], sourceEnd: 'spine_03', targetEnd: 'spine01' },
  { source: 'spine_03', target: ['spine01'], sourceEnd: 'neck_01', targetEnd: 'neck01' },
  { source: 'neck_01', target: ['neck01', 'neck02', 'neck03'], sourceEnd: 'Head', targetEnd: 'head' },
  { source: 'Head', target: ['head'] },
  ...(['L', 'R'] as const).flatMap(side => {
    const s = side.toLowerCase();
    return [
      { source: `clavicle_${s}`, target: [`clavicle.${side}`, `shoulder01.${side}`], sourceEnd: `upperarm_${s}`, targetEnd: `upperarm01.${side}` },
      { source: `upperarm_${s}`, target: [`upperarm01.${side}`, `upperarm02.${side}`], sourceEnd: `lowerarm_${s}`, targetEnd: `lowerarm01.${side}` },
      { source: `lowerarm_${s}`, target: [`lowerarm01.${side}`, `lowerarm02.${side}`], sourceEnd: `hand_${s}`, targetEnd: `wrist.${side}` },
      { source: `hand_${s}`, target: [`wrist.${side}`], sourceEnd: `middle_01_${s}`, targetEnd: `finger3-1.${side}`, palm: side },
      { source: `thigh_${s}`, target: [`upperleg01.${side}`, `upperleg02.${side}`], sourceEnd: `calf_${s}`, targetEnd: `lowerleg01.${side}` },
      { source: `calf_${s}`, target: [`lowerleg01.${side}`, `lowerleg02.${side}`], sourceEnd: `foot_${s}`, targetEnd: `foot.${side}` },
      { source: `foot_${s}`, target: [`foot.${side}`], sourceEnd: `ball_${s}`, targetEnd: `toe3-1.${side}` },
      ...['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap((finger, f) => Array.from({ length: 3 }, (_, k) => ({
        source: `${finger}_0${k + 1}_${s}`, target: [`finger${f + 1}-${k + 1}.${side}`],
        sourceEnd: `${finger}_0${k + 2}${k === 2 ? '_leaf' : ''}_${s}`,
        targetEnd: k < 2 ? `finger${f + 1}-${k + 2}.${side}` : undefined, palm: side,
      }))),
    ];
  }),
];

function palmNormal(worlds: Map<string, Matrix4>, side: 'L' | 'R', source: boolean): Vector3 {
  const s = side.toLowerCase();
  const wrist = posePoint(worlds, source ? `hand_${s}` : `wrist.${side}`);
  return posePoint(worlds, source ? `index_01_${s}` : `finger2-1.${side}`).sub(wrist)
    .cross(posePoint(worlds, source ? `pinky_01_${s}` : `finger5-1.${side}`).sub(wrist)).normalize().multiplyScalar(side === 'L' ? 1 : -1);
}
function segmentFrame(worlds: Map<string, Matrix4>, start: string, end: string | undefined, normal: Vector3): Quaternion {
  const matrix = worlds.get(start); if (!matrix) throw new Error(`モーションの対応骨がありません: ${start}`);
  const y = end ? posePoint(worlds, end).sub(posePoint(worlds, start)).normalize() : new Vector3(0, 1, 0).transformDirection(matrix);
  let z = normal.clone().addScaledVector(y, -normal.dot(y));
  if (z.lengthSq() < 1e-10) z = new Vector3(1, 0, 0).addScaledVector(y, -y.x);
  z.normalize(); const x = y.clone().cross(z).normalize(); z = x.clone().cross(y).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

export class HumanPoseMotionRetarget {
  readonly boneNames: string[];
  private source: HumanPoseRig;
  private target: HumanPoseRig;
  private sourceRest: Map<string, Matrix4>;
  private targetRest: Map<string, Matrix4>;
  private corrections = new Map<string, { source: string; after: Quaternion }>();
  private lengthScale: number;
  private canonical: boolean;

  constructor(source: HumanPoseRig, target: HumanPoseRig, canonical = false) {
    this.canonical = canonical;
    this.source = source; this.target = target;
    this.sourceRest = humanPoseWorldMatrices(source); this.targetRest = humanPoseWorldMatrices(target);
    const groups = canonical ? segments.map(group => ({ ...group, source: group.target[0], sourceEnd: group.targetEnd })) : segments;
    for (const group of groups) {
      let alignment = new Quaternion();
      if (group.sourceEnd) {
        const normalS = group.palm ? palmNormal(this.sourceRest, group.palm, !canonical) : new Vector3(0, 0, 1);
        const normalT = group.palm ? palmNormal(this.targetRest, group.palm, false) : new Vector3(0, 0, 1);
        alignment = segmentFrame(this.sourceRest, group.source, group.sourceEnd, normalS)
          .multiply(segmentFrame(this.targetRest, group.target[0], group.targetEnd, normalT).invert());
      }
      for (const name of group.target) {
        if (!this.targetRest.has(name)) throw new Error(`人体の対応骨がありません: ${name}`);
        this.corrections.set(name, { source: group.source,
          after: worldRotation(this.sourceRest.get(group.source)!).invert().multiply(alignment).multiply(worldRotation(this.targetRest.get(name)!)) });
      }
    }
    this.boneNames = [...this.corrections.keys()];
    const distance = (worlds: Map<string, Matrix4>, a: string, b: string) => posePoint(worlds, a).distanceTo(posePoint(worlds, b));
    this.lengthScale = (distance(this.targetRest, 'upperleg01.L', 'lowerleg01.L') + distance(this.targetRest, 'lowerleg01.L', 'foot.L'))
      / (canonical ? distance(this.sourceRest, 'upperleg01.L', 'lowerleg01.L') + distance(this.sourceRest, 'lowerleg01.L', 'foot.L')
        : distance(this.sourceRest, 'thigh_l', 'calf_l') + distance(this.sourceRest, 'calf_l', 'foot_l'));
  }

  pose(sourcePose: HumanPoseData, template: HumanPoseData): HumanPoseData {
    const sourceWorlds = humanPoseWorldMatrices(this.source, sourcePose), pose = structuredClone(template);
    pose.bones = Object.fromEntries(this.target.bones.map(bone => [bone.name, structuredClone(bone.rest)]));
    pose.root = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
    pose.supports = this.canonical ? sourcePose.supports.map(support => ({ ...structuredClone(support), position: support.position.map(v => v * this.lengthScale) as [number, number, number],
      ...(support.kind === 'box' ? { size: support.size.map(v => v * this.lengthScale) as [number, number, number] } : { radius: support.radius * this.lengthScale, height: support.height * this.lengthScale }) })) : [];
    pose.contacts = this.canonical ? structuredClone(sourcePose.contacts) : {}; delete pose.foot_bends;
    const targetBones = new Map(this.target.bones.map(bone => [bone.name, bone]));
    const worldQuats = new Map<string, Quaternion>();
    const visit = (name: string): Quaternion => {
      const found = worldQuats.get(name); if (found) return found;
      const bone = targetBones.get(name)!;
      const parent = bone.parent ? visit(bone.parent) : new Quaternion();
      const correction = this.corrections.get(name);
      const world = correction ? worldRotation(sourceWorlds.get(correction.source)!).multiply(correction.after)
        : parent.clone().multiply(new Quaternion(...bone.rest.rotation).normalize());
      pose.bones[name].rotation = parent.clone().invert().multiply(world).normalize().toArray();
      pose.bones[name].scale = [1, 1, 1]; worldQuats.set(name, world); return world;
    };
    for (const bone of this.target.bones) visit(bone.name);
    const pelvis = this.canonical ? 'root' : 'pelvis';
    pose.root.translation = posePoint(sourceWorlds, pelvis).sub(posePoint(this.sourceRest, pelvis)).multiplyScalar(this.lengthScale).toArray();
    if (this.canonical) {
      if (sourcePose.foot_bends) pose.foot_bends = structuredClone(sourcePose.foot_bends);
      return pose;
    }
    pose.foot_bends = {};
    for (const side of ['L', 'R'] as const) {
      const s = side.toLowerCase(), name = `ball_${s}`;
      const rest = this.source.bones.find(bone => bone.name === name)!;
      const delta = new Quaternion(...rest.rest.rotation).invert().multiply(new Quaternion(...sourcePose.bones[name].rotation));
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
      // The source toe's local +X points to world -X in bind; toe lift is negative in the editor.
      const angle = -2 * Math.atan2(delta.x, delta.w) * 180 / Math.PI;
      pose.foot_bends[side] = [0, Math.max(-65, Math.min(60, angle))];
    }
    return pose;
  }

  /** Transfer only explicit editing deltas; untouched helper bones keep the target baseline. */
  rebaseEdits(edits: HumanPoseJointEdits | undefined, before: HumanPoseData, after: HumanPoseData): HumanPoseJointEdits | undefined {
    if (!edits) return undefined;
    validateHumanPoseJointEdits(edits);
    const sourceBase = humanPoseWorldMatrices(this.source, before);
    const sourceEdited = humanPoseWorldMatrices(this.source, editedHumanPose(this.source, before, { joint_edits: edits }));
    const targetBase = humanPoseWorldMatrices(this.target, after), definitions = new Map(this.target.bones.map(bone => [bone.name, bone]));
    const next = structuredClone(edits), quaternions = new Map<string, Quaternion>(); next.rotations = {};
    const visit = (name: string): Quaternion => {
      const found = quaternions.get(name); if (found) return found;
      const definition = definitions.get(name)!;
      const parent = definition.parent ? visit(definition.parent) : new Quaternion(...after.root.rotation);
      let world = parent.clone().multiply(new Quaternion(...after.bones[name].rotation));
      if (edits.rotations[name]) {
        world = worldRotation(sourceEdited.get(name)!).multiply(worldRotation(sourceBase.get(name)!).invert()).multiply(worldRotation(targetBase.get(name)!));
        next.rotations[name] = parent.clone().invert().multiply(world).normalize().toArray();
      }
      quaternions.set(name, world); return world;
    };
    for (const name of definitions.keys()) visit(name);
    if (next.root_offset) next.root_offset = next.root_offset.map(value => value * this.lengthScale) as [number, number, number];
    validateHumanPoseJointEdits(next); return next;
  }
}

/** Constant clip offset only: never snap individual running/airborne frames onto the floor. */
export function motionFloorOffset(rig: HumanPoseRig, poses: HumanPoseData[], swimming: boolean): number {
  let minimum = Infinity, maximum = -Infinity;
  for (const pose of poses) {
    const skeleton = humanPoseSkeletonPoints(rig, pose), points = [...skeleton.values()];
    const centre = skeleton.get('headCentre')!, radius = centre.distanceTo(skeleton.get('headTop')!);
    points.push(centre.clone().add(new Vector3(0, radius, 0)), centre.clone().sub(new Vector3(0, radius, 0)));
    for (const point of points) { minimum = Math.min(minimum, point.y); maximum = Math.max(maximum, point.y); }
  }
  return swimming ? .7 - (minimum + maximum) / 2 : -minimum;
}
