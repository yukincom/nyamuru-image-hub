import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { humanPoseMatrix, humanPoseWorldMatrices, mirrorHumanPoseBody } from '../src/lib/humanPoseMirror.ts';

const trs = (translation = [0, 0, 0], axis = [0, 1, 0], angle = 0) => ({
  translation, rotation: new Quaternion().setFromAxisAngle(new Vector3(...axis), angle).toArray(), scale: [1, 1, 1],
});
const near = (a, b) => a.forEach((value, index) => assert.ok(Math.abs(value - b[index]) < 1e-9, `${value} != ${b[index]}`));
const point = matrix => new Vector3().setFromMatrixPosition(matrix).toArray();
const orientation = matrix => matrix.clone().setPosition(0, 0, 0).elements;

// 左右の腕と、独立して向く頭・顎を持つ小さなrigで不変条件を検証する。
function fixture() {
  const bones = [
    ['root', null, [0, 0, 0]], ['neck', 'root', [0, 1, 0]], ['head', 'neck', [0, 0.2, 0]],
    ['jaw', 'head', [0, 0.05, 0.1]], ['arm.L', 'root', [0.3, 0.8, 0]], ['arm.R', 'root', [-0.3, 0.8, 0]],
    ['hand.L', 'arm.L', [0.3, 0, 0]], ['hand.R', 'arm.R', [-0.3, 0, 0]],
  ].map(([name, parent, translation]) => ({ name, parent, rest: trs(translation) }));
  const rig = { rig_signature: 'fixture', base_glb_sha256: 'fixture-base', placement_root: 'placement', bones };
  const camera = { projection: 'orthographic', position: [0, 1, 4], target: [0, 1, 0], up: [0, 1, 0], orthographic_scale: 2, aspect: 1 };
  const pose = { schema_version: 1, pose_id: 'pose-fixture', revision: 1, rig_signature: rig.rig_signature,
    base_glb_sha256: rig.base_glb_sha256, transform_space: 'absolute_parent_local', user_confirmed: false,
    root: trs([0.15, 0, 0], [0, 1, 0], 0.2), bones: Object.fromEntries(bones.map(b => [b.name, structuredClone(b.rest)])),
    supports: [{ id: 'pole', kind: 'cylinder', position: [0.5, 0.6, 0.1], radius: 0.02, height: 1.2 }],
    contacts: { hand: { side: 'L', point: [0.5, 0.8, 0.1] }, feet: { L: [0.1, 0, 0], R: [-0.2, 0, 0.1] }, supporting_foot: 'R' },
    preview_camera: camera, comparison_camera: structuredClone(camera) };
  pose.bones['arm.L'] = trs([0.3, 0.8, 0], [0, 0, 1], 0.7);
  pose.bones['arm.R'] = trs([-0.3, 0.8, 0], [0, 0, 1], 0.1);
  pose.bones.neck = trs([0, 1, 0], [0, 0, 1], 0.1);
  pose.bones.head = trs([0, 0.2, 0], [0, 1, 0], 0.5);
  pose.bones.jaw = trs([0, 0.05, 0.1], [1, 0, 0], 0.15);
  return { rig, pose };
}

test('体勢の左右の関節を鏡映し、顔と顎の世界方向を保つ', () => {
  const { rig, pose } = fixture();
  const before = humanPoseWorldMatrices(rig, pose), after = humanPoseWorldMatrices(rig, mirrorHumanPoseBody(rig, pose));
  for (const [target, source] of [['root', 'root'], ['neck', 'neck'], ['head', 'head'], ['arm.L', 'arm.R'], ['hand.R', 'hand.L']]) {
    const expected = point(before.get(source)); expected[0] *= -1;
    near(point(after.get(target)), expected);
  }
  for (const name of ['head', 'jaw']) near(orientation(after.get(name)), orientation(before.get(name)));
  const shift = new Vector3(...point(after.get('head'))).sub(new Vector3(...point(before.get('head'))));
  near(point(after.get('jaw')), new Vector3(...point(before.get('jaw'))).add(shift).toArray());
});

test('2回の反転で全boneが戻り、元データ・cameraを変更せず負scaleを作らない', () => {
  const { rig, pose } = fixture(), original = structuredClone(pose);
  const once = mirrorHumanPoseBody(rig, pose), twice = mirrorHumanPoseBody(rig, once);
  const before = humanPoseWorldMatrices(rig, pose), after = humanPoseWorldMatrices(rig, twice);
  for (const [name, matrix] of before) near(matrix.elements, after.get(name).elements);
  assert.deepEqual(pose, original);
  assert.deepEqual(once.preview_camera, pose.preview_camera);
  assert.deepEqual(once.comparison_camera, pose.comparison_camera);
  for (const transform of [once.root, ...Object.values(once.bones)]) assert.deepEqual(transform.scale, [1, 1, 1]);
  assert.notEqual(once.bones.head, pose.bones.head);
});

test('支持物と接触点の位置・左右を体勢と一緒に入れ替える', () => {
  const { rig, pose } = fixture(), result = mirrorHumanPoseBody(rig, pose);
  near(result.supports[0].position, [-0.5, 0.6, 0.1]);
  assert.equal(result.supports[0].radius, 0.02);
  assert.equal(result.contacts.hand.side, 'R');
  near(result.contacts.hand.point, [-0.5, 0.8, 0.1]);
  near(result.contacts.feet.L, [0.2, 0, 0.1]);
  assert.equal(result.contacts.supporting_foot, 'L');
});

// 不整合な骨格を黙って部分適用しない。
test('異なるbase、欠落・余分なbone、循環、左右相手の欠落を拒否する', () => {
  const { rig, pose } = fixture();
  assert.throws(() => mirrorHumanPoseBody(rig, { ...pose, base_glb_sha256: 'other' }));
  const missing = structuredClone(pose); delete missing.bones.jaw;
  assert.throws(() => mirrorHumanPoseBody(rig, missing));
  assert.throws(() => mirrorHumanPoseBody(rig, { ...pose, bones: { ...pose.bones, extra: trs() } }));
  const cyclic = structuredClone(rig); cyclic.bones[0].parent = 'head';
  assert.throws(() => mirrorHumanPoseBody(cyclic, pose));
  const unpaired = structuredClone(rig); unpaired.bones = unpaired.bones.filter(b => b.name !== 'hand.R');
  const partial = structuredClone(pose); delete partial.bones['hand.R'];
  assert.throws(() => mirrorHumanPoseBody(unpaired, partial));
  assert.throws(() => humanPoseMatrix({ ...trs(), scale: [-1, 1, 1] }));
  assert.throws(() => humanPoseMatrix({ ...trs(), rotation: [0, 0, 0, 0] }));
});
