import { type StageShape, loadStageShape } from './background3dRenderer.ts';
import type { BackgroundStage } from '../types.ts';
import { CUBE_STAGE_ID } from './background3d.ts';
import { loadBackgroundStage } from './backgroundStageStore.ts';
import type { HumanPoseData, HumanPoseSceneAssets } from './humanPoseTypes.ts';
import { Mesh, Group, MeshStandardMaterial, BoxGeometry, CylinderGeometry, DoubleSide, BufferGeometry, Float32BufferAttribute } from 'three';
import { disposeThreeObject } from './threeSceneResources.ts';
import { HumanPoseMotionRetarget } from './humanPoseMotionRetarget.ts';

export interface HumanPoseBackground { sourceId: string; shape: StageShape }

export async function loadHumanPoseBackground(sourceId: string, stages: BackgroundStage[]): Promise<HumanPoseBackground> {
  if (sourceId === CUBE_STAGE_ID) return { sourceId, shape: await loadStageShape() };
  const stage = stages.find(item => item.id === sourceId);
  if (!stage) throw new Error('保存した3D舞台が見つかりません。舞台を含む作品を開き直してください');
  return { sourceId, shape: await loadStageShape(stage, await loadBackgroundStage(stage)) };
}

export function poseSupports(pose: HumanPoseData): Mesh[] {
  const group = new Group(), material = new MeshStandardMaterial({ color: '#b3b3b3', roughness: .9 });
  try {
    for (const support of pose.supports) {
      if (!support.position?.every(Number.isFinite) || support.position.length !== 3) throw new Error('支持物の位置が不正です');
      let geometry;
      if (support.kind === 'box' && support.size.length === 3 && support.size.every(v => Number.isFinite(v) && v > 0 && v <= 100)) geometry = new BoxGeometry(...support.size);
      else if (support.kind === 'cylinder' && Number.isFinite(support.radius) && support.radius > 0 && support.radius <= 100
        && Number.isFinite(support.height) && support.height > 0 && support.height <= 100) geometry = new CylinderGeometry(support.radius, support.radius, support.height, 24);
      else throw new Error('支持物の形状が不正です');
      const mesh = new Mesh(geometry, material); mesh.position.fromArray(support.position); group.add(mesh);
    }
    if (!group.children.length) material.dispose();
    return [...group.children] as Mesh[];
  } catch (error) { if (!group.children.length) material.dispose(); disposeThreeObject(group); throw error; }
}

export function poseBackgroundGroup(background?: HumanPoseBackground): Group {
  const group = new Group();
  try {
    if (background) {
      const material = new MeshStandardMaterial({ color: '#ccd5d4', roughness: 1, side: DoubleSide });
      for (const mesh of background.shape.meshes) {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3)); geometry.setIndex(mesh.indices); geometry.computeVertexNormals();
        group.add(new Mesh(geometry, material));
      }
      if (!group.children.length) material.dispose();
    }
    return group;
  } catch (error) { disposeThreeObject(group); throw error; }
}

export function bodyPose(assets: HumanPoseSceneAssets, source: HumanPoseData, retarget?: HumanPoseMotionRetarget): HumanPoseData {
  return retarget ? retarget.pose(source, { ...source, rig_signature: assets.body!.rig.rig_signature, base_glb_sha256: assets.body!.rig.base_glb_sha256 }) : source;
}
