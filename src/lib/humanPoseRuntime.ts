import { MathUtils, Matrix4, Quaternion, Vector3, type Object3D, type SkinnedMesh } from 'three';
import { humanPoseWorldMatrices } from './humanPoseMirror.ts';
import { disposeThreeObject, loadEmbeddedGlb } from './threeSceneResources.ts';
import { editedHumanPose, humanPoseFootPoints, posePoint, worldRotation } from './humanPoseJoints.ts';
import type { HumanPoseBodyMirror, HumanPoseData, HumanPoseRig } from './humanPoseTypes.ts';

/** Use the native toe joints for the editor's virtual forefoot bends. */
function skinFootBends(rig: HumanPoseRig, pose: HumanPoseData): HumanPoseData {
  if (!pose.foot_bends || !Object.values(pose.foot_bends).some(values => values.some(value => Math.abs(value) > 1e-8))) return pose;
  const next = structuredClone(pose), worlds = humanPoseWorldMatrices(rig, pose), rest = humanPoseWorldMatrices(rig);
  for (const side of ['L', 'R'] as const) {
    const bends = pose.foot_bends[side]; if (!bends || !bends.some(value => Math.abs(value) > 1e-8)) continue;
    const base = humanPoseFootPoints(rig, { ...pose, foot_bends: undefined }, side, worlds), bent = humanPoseFootPoints(rig, pose, side, worlds);
    const axis = new Vector3(1, 0, 0).transformDirection(rest.get(`foot.${side}`)!.clone().invert()).transformDirection(worlds.get(`foot.${side}`)!);
    const turn = new Quaternion().setFromUnitVectors(base[3].clone().sub(base[2]).normalize(), bent[3].clone().sub(bent[2]).normalize());
    for (let finger = 1; finger <= 5; finger++) {
      const name = `toe${finger}-1.${side}`, definition = rig.bones.find(bone => bone.name === name); if (!definition) continue;
      const offset = posePoint(worlds, name).sub(base[2]).applyAxisAngle(axis, MathUtils.degToRad(bends[0]));
      const target = new Matrix4().compose(bent[2].clone().add(offset), turn.clone().multiply(worldRotation(worlds.get(name)!)), new Vector3(1, 1, 1));
      const parent = definition.parent ? worlds.get(definition.parent)! : new Matrix4();
      const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
      parent.clone().invert().multiply(target).decompose(position, rotation, scale);
      next.bones[name] = { translation: position.toArray(), rotation: rotation.normalize().toArray(), scale: [1, 1, 1] };
    }
  }
  return next;
}

/** Web画面とBlender照合scriptで同じbone名・TRS適用を使う。 */
export async function loadHumanPoseRuntime(buffer: ArrayBuffer, rig: HumanPoseRig) {
  humanPoseWorldMatrices(rig);
  const loaded = await loadEmbeddedGlb(buffer);
  try {
    const mapping = new Map<string, Object3D>();
    // getObjectByNameではGLTFLoaderが除去する「.L/.R」を復元できない。
    for (const [index, node] of loaded.parser.json.nodes.entries()) {
      if (typeof node.name !== 'string') continue;
      if (mapping.has(node.name)) throw new Error('人体素体に同名のnodeがあります');
      mapping.set(node.name, await loaded.parser.getDependency('node', index));
    }
    for (const name of [rig.placement_root, ...rig.bones.map(bone => bone.name)]) {
      if (!mapping.has(name)) throw new Error(`人体素体にboneがありません: ${name}`);
    }
    const meshes: SkinnedMesh[] = [];
    loaded.scene.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh); });
    if (!meshes.length) throw new Error('人体素体にskinned meshがありません');
    return {
      scene: loaded.scene, meshes,
      applyPose(pose: HumanPoseData, bodyMirror: HumanPoseBodyMirror = 'original') {
        if (bodyMirror !== 'original' && bodyMirror !== 'mirrored') throw new Error('体勢の左右指定が不正です');
        if (pose.rig_signature !== rig.rig_signature || pose.base_glb_sha256 !== rig.base_glb_sha256
          || pose.transform_space !== 'absolute_parent_local') throw new Error('姿勢と共通素体が一致しません');
        // 現在の表示をtoggleせず、毎回基準poseから選択した体勢を作る。
        const applied = skinFootBends(rig, bodyMirror === 'mirrored' ? editedHumanPose(rig, pose, { body_mirror: bodyMirror }) : pose);
        humanPoseWorldMatrices(rig, applied);
        for (const [name, value] of [[rig.placement_root, applied.root], ...Object.entries(applied.bones)] as const) {
          const node = mapping.get(name)!;
          node.position.fromArray(value.translation);
          node.quaternion.fromArray(value.rotation);
          node.scale.fromArray(value.scale);
          node.updateMatrix();
        }
        loaded.scene.updateMatrixWorld(true);
        for (const mesh of meshes) { mesh.skeleton.update(); mesh.computeBoundingBox(); mesh.computeBoundingSphere(); }
        return applied;
      },
      dispose() { disposeThreeObject(loaded.scene); },
    };
  } catch (error) { disposeThreeObject(loaded.scene); throw error; }
}
export type HumanPoseRuntime = Awaited<ReturnType<typeof loadHumanPoseRuntime>>;
