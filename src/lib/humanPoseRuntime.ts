import type { Object3D, SkinnedMesh } from 'three';
import { humanPoseWorldMatrices, mirrorHumanPoseBody } from './humanPoseMirror.ts';
import { disposeThreeObject, loadEmbeddedGlb } from './threeSceneResources.ts';
import type { HumanPoseBodyMirror, HumanPoseData, HumanPoseRig } from './humanPoseTypes.ts';

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
        const applied = bodyMirror === 'mirrored' ? mirrorHumanPoseBody(rig, pose) : pose;
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
