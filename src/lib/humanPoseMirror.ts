import { Matrix4, Quaternion, Vector3 } from 'three';
import type { HumanPoseData, HumanPoseRig, HumanPoseTransform, PoseQuaternion, PoseVector } from './humanPoseTypes.ts';

const reflection = new Matrix4().makeScale(-1, 1, 1);
const opposite = (name: string) => name.endsWith('.L') ? name.slice(0, -2) + '.R' : name.endsWith('.R') ? name.slice(0, -2) + '.L' : name;
export function humanPoseMatrix(value: HumanPoseTransform): Matrix4 {
  for (const [key, length] of [['translation', 3], ['rotation', 4], ['scale', 3]] as const) {
    if (!Array.isArray(value?.[key]) || value[key].length !== length || !value[key].every(Number.isFinite)) throw new Error('姿勢の数値が不正です');
  }
  if (value.scale.some(v => Math.abs(v - 1) > 1e-4)
    || Math.abs(value.rotation.reduce((sum, v) => sum + v * v, 0) - 1) > 1e-4) throw new Error('姿勢の回転またはscaleが不正です');
  return new Matrix4().compose(new Vector3(...value.translation), new Quaternion(...value.rotation), new Vector3(...value.scale));
}
function transform(matrix: Matrix4): HumanPoseTransform {
  const p = new Vector3(), q = new Quaternion(), s = new Vector3();
  matrix.decompose(p, q, s);
  return { translation: p.toArray() as PoseVector, rotation: q.normalize().toArray() as PoseQuaternion, scale: [1, 1, 1] };
}

// bone名の左右対応とrestを使い、負scaleをモデルへ渡さず姿勢を反射する。
export function humanPoseWorldMatrices(rig: HumanPoseRig, pose?: HumanPoseData): Map<string, Matrix4> {
  const definitions = new Map(rig.bones.map(bone => [bone.name, bone]));
  if (!rig.bones.length || definitions.size !== rig.bones.length || rig.bones.length > 512) throw new Error('人体rigの一覧が不正です');
  if (pose && (Object.keys(pose.bones).length !== definitions.size || Object.keys(pose.bones).some(name => !definitions.has(name)))) throw new Error('全boneの姿勢が必要です');
  const result = new Map<string, Matrix4>(), visiting = new Set<string>();
  const root = pose ? humanPoseMatrix(pose.root) : new Matrix4();
  const visit = (name: string): Matrix4 => {
    const cached = result.get(name); if (cached) return cached;
    const bone = definitions.get(name);
    if (!bone || visiting.has(name)) throw new Error('人体rigの親子関係が不正です');
    visiting.add(name);
    const world = (bone.parent ? visit(bone.parent) : root).clone().multiply(humanPoseMatrix(pose ? pose.bones[name] : bone.rest));
    visiting.delete(name); result.set(name, world); return world;
  };
  for (const bone of rig.bones) visit(bone.name);
  return result;
}

function mirroredContact(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 3 && value.every(v => typeof v === 'number')) return [-value[0], value[1], value[2]];
    return value.map(mirroredContact);
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key === 'L' ? 'R' : key === 'R' ? 'L' : key, mirroredContact(entry)]));
  return value === 'L' ? 'R' : value === 'R' ? 'L' : value;
}

// 素材座標のX=0を鏡面とする。作品内の配置transformはこの処理の外へ置く。
export function mirrorHumanPoseBody(rig: HumanPoseRig, pose: HumanPoseData): HumanPoseData {
  if (pose.rig_signature !== rig.rig_signature || pose.base_glb_sha256 !== rig.base_glb_sha256
    || pose.transform_space !== 'absolute_parent_local') throw new Error('姿勢と共通素体が一致しません');
  const rest = humanPoseWorldMatrices(rig), original = humanPoseWorldMatrices(rig, pose), worlds = new Map<string, Matrix4>();
  for (const bone of rig.bones) {
    const source = opposite(bone.name);
    if (!rest.has(source)) throw new Error(`左右の対応boneがありません: ${bone.name}`);
    worlds.set(bone.name, reflection.clone().multiply(original.get(source)!).multiply(rest.get(source)!.clone().invert())
      .multiply(reflection).multiply(rest.get(bone.name)!));
  }
  // 頭の位置だけを体勢へ追従させ、顔の世界方向と表情の子boneは保持する。
  if (!original.has('head')) throw new Error('顔の向きを保持するhead boneがありません');
  const head = original.get('head')!, mirroredHead = head.clone().setPosition(new Vector3().setFromMatrixPosition(worlds.get('head')!));
  const moveHead = mirroredHead.clone().multiply(head.clone().invert());
  const parents = new Map(rig.bones.map(bone => [bone.name, bone.parent]));
  for (const bone of rig.bones) {
    let ancestor: string | null = bone.name;
    while (ancestor && ancestor !== 'head') ancestor = parents.get(ancestor) ?? null;
    if (ancestor === 'head') worlds.set(bone.name, moveHead.clone().multiply(original.get(bone.name)!));
  }
  const result = structuredClone(pose), root = reflection.clone().multiply(humanPoseMatrix(pose.root)).multiply(reflection);
  result.root = transform(root);
  for (const bone of rig.bones) {
    const parent = bone.parent ? worlds.get(bone.parent)! : root;
    result.bones[bone.name] = transform(parent.clone().invert().multiply(worlds.get(bone.name)!));
  }
  result.supports = pose.supports.map(support => ({ ...structuredClone(support), position: [-support.position[0], support.position[1], support.position[2]] }));
  result.contacts = mirroredContact(pose.contacts) as Record<string, unknown>;
  return result;
}
