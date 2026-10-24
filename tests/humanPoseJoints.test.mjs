import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { humanPoseWorldMatrices } from '../src/lib/humanPoseMirror.ts';
import { editedHumanPose, humanPoseEdits, humanPoseFingerTip, humanPoseFootPoints, humanPoseJointAngles, posePoint, setHumanPoseJointAngles, validateHumanPoseJointEdits } from '../src/lib/humanPoseJoints.ts';
import { moveHumanPoseHandle, humanPoseLimb, humanPoseLimbFlex, setHumanPoseLimbFlex } from '../src/lib/humanPoseIk.ts';
import { HumanPoseSkeleton, humanPoseSkeletonPoints } from '../src/lib/humanPoseSkeleton.ts';

function fixture() {
  const bones = [], positions = new Map();
  const add = (name, parent, position) => {
    const p = new Vector3(...position); positions.set(name, p);
    bones.push({ name, parent, rest: { translation: p.clone().sub(positions.get(parent) ?? new Vector3()).toArray(), rotation: [0, 0, 0, 1], scale: [1, 1, 1] } });
  };
  add('root', null, [0, .8, 0]); add('spine04', 'root', [0, .86, 0]); add('spine02', 'spine04', [0, 1.1, 0]); add('neck01', 'spine02', [0, 1.3, 0]); add('head', 'neck01', [0, 1.4, 0]);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    add(`upperarm01.${side}`, 'spine02', [s * .18, 1.25, 0]); add(`lowerarm01.${side}`, `upperarm01.${side}`, [s * .26, 1.0, .04]); add(`wrist.${side}`, `lowerarm01.${side}`, [s * .27, .77, .09]);
    add(`upperleg01.${side}`, 'root', [s * .1, .8, 0]); add(`lowerleg01.${side}`, `upperleg01.${side}`, [s * .11, .44, .03]); add(`foot.${side}`, `lowerleg01.${side}`, [s * .11, .07, 0]);
    for (let f = 1; f <= 5; f++) {
      for (let k = 1; k <= 3; k++) add(`finger${f}-${k}.${side}`, k === 1 ? `wrist.${side}` : `finger${f}-${k - 1}.${side}`, [s * (.235 + f * .014), .72 - k * .024, .09 + (f === 1 ? .028 : 0)]);
      for (let k = 1; k <= (f === 1 ? 2 : 3); k++) add(`toe${f}-${k}.${side}`, k === 1 ? `foot.${side}` : `toe${f}-${k - 1}.${side}`, [s * (.075 + f * .012), .02, .07 + k * .025]);
    }
  }
  const rig = { rig_signature: 'a'.repeat(64), base_glb_sha256: 'b'.repeat(64), placement_root: 'human_rig', bones };
  const pose = { schema_version: 1, pose_id: 'test', revision: 1, rig_signature: rig.rig_signature, base_glb_sha256: rig.base_glb_sha256,
    transform_space: 'absolute_parent_local', user_confirmed: true, root: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, bones: Object.fromEntries(bones.map(b => [b.name, structuredClone(b.rest)])), supports: [], contacts: {} };
  return { rig, pose };
}
const point = (rig, pose, id) => posePoint(humanPoseWorldMatrices(rig, pose), id);
const close = (a, b, tolerance = 1e-6) => assert.ok(a.distanceTo(b) < tolerance, `${a.toArray()} != ${b.toArray()}`);

test('指の曲げと手首・腰・足首の回転範囲を制限し、元の素材を保持する', () => {
  const { rig, pose } = fixture(), before = structuredClone(pose);
  for (const id of ['finger2-2.L', 'finger2-2.R', 'wrist.L', 'foot.L', 'spine04']) {
    const copy = structuredClone(pose); setHumanPoseJointAngles(rig, copy, id, [900, 0, 0]);
    const angles = humanPoseJointAngles(rig, copy, id); assert.ok(angles[0] <= 110.00001);
    assert.deepEqual(copy.bones[id].translation, pose.bones[id].translation);
  }
  assert.deepEqual(pose, before);
  for (const bad of [{ version: 1, rotations: { head: [0, 0, 0, 0] } }, { version: 1, rotations: { missing: [0, 0, 0, 1] } }, { version: 1, rotations: {}, root_offset: [0, Infinity, 0] }]) assert.throws(() => validateHumanPoseJointEdits(bad));
});

test('到達不能な手足の移動でも長さと有限値を保ち、伸び切りを避ける', () => {
  const { rig, pose } = fixture();
  for (const id of ['wrist.L', 'wrist.R', 'foot.L', 'foot.R']) {
    const chain = humanPoseLimb(id), moved = moveHumanPoseHandle(rig, pose, id, new Vector3(8, 5, -3));
    for (let i = 0; i < 2; i++) assert.ok(Math.abs(point(rig, moved, chain[i]).distanceTo(point(rig, moved, chain[i + 1])) - point(rig, pose, chain[i]).distanceTo(point(rig, pose, chain[i + 1]))) < 1e-6);
    for (const value of Object.values(moved.bones)) assert.ok(value.rotation.every(Number.isFinite));
    for (const id of Object.keys(pose.bones)) assert.deepEqual(moved.bones[id].translation, pose.bones[id].translation);
  }
});

test('手の到達点と肘の曲げ方向を独立に操作する', () => {
  const { rig, pose } = fixture(), target = point(rig, pose, 'wrist.L').add(new Vector3(.06, .1, .1));
  const moved = moveHumanPoseHandle(rig, pose, 'wrist.L', target); close(point(rig, moved, 'wrist.L'), target);
  const redirected = moveHumanPoseHandle(rig, moved, 'lowerarm01.L', point(rig, moved, 'lowerarm01.L').add(new Vector3(0, 0, -.2)));
  close(point(rig, redirected, 'wrist.L'), target);
  assert.ok(point(rig, redirected, 'lowerarm01.L').distanceTo(point(rig, moved, 'lowerarm01.L')) > .01);
});

test('腰を下げても足を保ち、頭の操作では背骨と首が動く', () => {
  const { rig, pose } = fixture(), lowered = moveHumanPoseHandle(rig, pose, 'spine04', point(rig, pose, 'spine04').add(new Vector3(0, -.15, 0)));
  for (const side of ['L', 'R']) close(point(rig, lowered, `foot.${side}`), point(rig, pose, `foot.${side}`));
  assert.ok(lowered.root.translation[1] < -.1);
  const target = point(rig, pose, 'head').add(new Vector3(.1, -.04, .1)), head = moveHumanPoseHandle(rig, pose, 'head', target);
  assert.ok(point(rig, head, 'head').distanceTo(target) < point(rig, pose, 'head').distanceTo(target));
  close(point(rig, head, 'upperleg01.L'), point(rig, pose, 'upperleg01.L'));
});

test('編集と反転を保存・再適用しても指と頭と全関節が同じ位置に戻る', () => {
  const { rig, pose } = fixture();
  for (const body_mirror of ['original', 'mirrored']) {
    const displayed = editedHumanPose(rig, pose, { body_mirror });
    setHumanPoseJointAngles(rig, displayed, 'finger3-2.L', [55, 0, 0]); setHumanPoseJointAngles(rig, displayed, 'head', [10, 30, 5]);
    const moved = moveHumanPoseHandle(rig, displayed, 'wrist.R', point(rig, displayed, 'wrist.R').add(new Vector3(.04, .13, .1)));
    const edits = humanPoseEdits(rig, pose, moved, body_mirror === 'mirrored');
    const restored = editedHumanPose(rig, pose, { body_mirror, joint_edits: JSON.parse(JSON.stringify(edits)) });
    for (const bone of rig.bones) {
      close(point(rig, restored, bone.name), point(rig, moved, bone.name));
      assert.ok(new Quaternion(...restored.bones[bone.name].rotation).angleTo(new Quaternion(...moved.bones[bone.name].rotation)) < 1e-6);
    }
  }
});

test('線骨格はmesh読込なしで頭の球・全指節・踵と土踏まずを持つ', () => {
  const { rig, pose } = fixture(), points = humanPoseSkeletonPoints(rig, pose), skeleton = new HumanPoseSkeleton(rig);
  try {
    skeleton.applyPose(pose); assert.ok(skeleton.nativeHeight > 1.4 && skeleton.nativeHeight < 1.8);
    for (const id of ['headCentre', 'heel.L', 'footArch.R', 'finger5-3.R', 'finger2-tip.L', 'foot-tip.R']) assert.ok(points.get(id).toArray().every(Number.isFinite));
    assert.ok(skeleton.bounds().getSize(new Vector3()).y > 1);
    let vertices = 0; skeleton.scene.traverse(object => { if (object.isMesh) vertices += object.geometry.attributes.position.count; });
    assert.ok(vertices < 5000);
  } finally { skeleton.dispose(); }
});


test('肘と膝の直接回転は逆曲げ・過屈曲を許さず、操作していない上腕・大腿を保つ', () => {
  const { rig, pose } = fixture();
  for (const id of ['lowerarm01.L', 'lowerarm01.R', 'lowerleg01.L', 'lowerleg01.R']) {
    const chain = humanPoseLimb(id);
    for (const requested of [-999, 80, 999]) {
      const moved = structuredClone(pose); setHumanPoseLimbFlex(rig, moved, id, requested);
      const flex = humanPoseLimbFlex(rig, moved, id);
      assert.ok(flex >= 2 - 1e-5 && flex <= (id.startsWith('lowerarm') ? 150 : 155) + 1e-5);
      close(point(rig, moved, chain[0]), point(rig, pose, chain[0]));
      close(point(rig, moved, chain[1]), point(rig, pose, chain[1]));
      assert.deepEqual(moved.bones[chain[0]], pose.bones[chain[0]]);
    }
  }
});

test('登録ポーズの回転が目安の範囲外でも、ゼロ移動や別軸の変更で跳ねない', () => {
  const { rig, pose } = fixture();
  pose.bones['foot.R'].rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.5).toArray();
  const same = moveHumanPoseHandle(rig, pose, 'foot.R', point(rig, pose, 'foot.R'));
  assert.deepEqual(same, pose);
  const angles = humanPoseJointAngles(rig, pose, 'foot.R'), modified = structuredClone(pose);
  setHumanPoseJointAngles(rig, modified, 'foot.R', [angles[0], 10, angles[2]], angles);
  assert.ok(Math.abs(humanPoseJointAngles(rig, modified, 'foot.R')[0] - angles[0]) < 1e-6);
});

test('肩・股関節の上限に達する極端な到達点でも肘・膝の屈曲範囲を保つ', () => {
  const { rig, pose } = fixture();
  for (const id of ['wrist.L', 'wrist.R', 'foot.L', 'foot.R']) {
    const chain = humanPoseLimb(id), root = point(rig, pose, chain[0]);
    for (const distance of [.002, 2]) for (let i = 0; i < 60; i++) {
      const y = 1 - 2 * (i + .5) / 60, radial = Math.sqrt(1 - y * y), angle = i * 2.399963;
      const target = root.clone().add(new Vector3(Math.cos(angle) * radial, y, Math.sin(angle) * radial).multiplyScalar(distance));
      const moved = moveHumanPoseHandle(rig, pose, id, target), flex = humanPoseLimbFlex(rig, moved, chain[1]);
      assert.ok(flex >= 2 - 1e-5 && flex <= (id.startsWith('wrist') ? 150 : 155) + 1e-5, `${id}: ${flex}`);
    }
  }
});


test('指先の移動で指節が連動し、手首と指の長さを保つ', () => {
  const { rig, pose } = fixture(), desired = structuredClone(pose), id = 'finger2-tip.L';
  for (const k of [1, 2, 3]) setHumanPoseJointAngles(rig, desired, `finger2-${k}.L`, [40, 0, 0]);
  const target = humanPoseFingerTip(rig, desired, id), moved = moveHumanPoseHandle(rig, pose, id, target);
  assert.ok(humanPoseFingerTip(rig, moved, id).distanceTo(target) < humanPoseFingerTip(rig, pose, id).distanceTo(target) * .2);
  assert.ok([1, 2, 3].filter(k => Math.abs(humanPoseJointAngles(rig, moved, `finger2-${k}.L`)[0]) > 1).length >= 2);
  close(point(rig, moved, 'wrist.L'), point(rig, pose, 'wrist.L'));
  for (const bone of rig.bones) assert.deepEqual(moved.bones[bone.name].translation, pose.bones[bone.name].translation);
  assert.deepEqual(moveHumanPoseHandle(rig, pose, id, humanPoseFingerTip(rig, pose, id)), pose);
});

test('足は3枚の板を長さ固定で曲げ、反転・保存を経ても同じ形を保つ', () => {
  const { rig, pose } = fixture();
  for (const body_mirror of ['original', 'mirrored']) {
    const displayed = editedHumanPose(rig, pose, { body_mirror }), before = humanPoseFootPoints(rig, displayed, 'L');
    setHumanPoseJointAngles(rig, displayed, 'footArch.L', [18, 0, 0]);
    setHumanPoseJointAngles(rig, displayed, 'footBall.L', [45, 0, 0]);
    const after = humanPoseFootPoints(rig, displayed, 'L');
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(before[i].distanceTo(before[i + 1]) - after[i].distanceTo(after[i + 1])) < 1e-6);
    assert.ok(after[3].distanceTo(before[3]) > .01);
    const edits = humanPoseEdits(rig, pose, displayed, body_mirror === 'mirrored');
    const restored = editedHumanPose(rig, pose, { body_mirror, joint_edits: JSON.parse(JSON.stringify(edits)) });
    humanPoseFootPoints(rig, restored, 'L').forEach((p, i) => close(p, after[i]));
    assert.ok(![...humanPoseSkeletonPoints(rig, restored).keys()].some(name => name.startsWith('toe')));
    const target = after[3].clone().add(new Vector3(.03, .06, .04));
    const moved = moveHumanPoseHandle(rig, displayed, 'foot-tip.L', target);
    assert.ok(humanPoseFootPoints(rig, moved, 'L')[3].distanceTo(target) < .01);
  }
  for (const foot_bends of [{ L: [30, 0] }, { R: [0, Infinity] }, { X: [0, 0] }]) assert.throws(() => validateHumanPoseJointEdits({ version: 1, rotations: {}, foot_bends }));
});
