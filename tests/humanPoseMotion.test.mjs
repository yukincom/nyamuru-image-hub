import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Quaternion, Vector3 } from 'three';
import { changeHumanPoseMotion, sampleHumanPoseMotion, rebaseHumanPoseMotionEdits, validateHumanPoseMotion } from '../src/lib/humanPoseMotion.ts';
import { editedHumanPose, humanPoseEdits, validateHumanPoseJointEdits } from '../src/lib/humanPoseJoints.ts';
import { HumanPoseMotionRetarget } from '../src/lib/humanPoseMotionRetarget.ts';
import { humanPoseWorldMatrices } from '../src/lib/humanPoseMirror.ts';
const library = JSON.parse(readFileSync(new URL('../src/assets/human-pose-motions/quaternius-standard.json', import.meta.url)));
const rig = { rig_signature: library.rig_signature, bones: library.bone_names.map(name => ({ name, parent: null,
  rest: { translation: [0, .1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } })) };
const template = { bones: {}, root: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, supports: [{ id: 'chair' }], contacts: { chair: true } };
const selection = (clip = library.clips[0], phase = .5) => ({ version: 1, library_sha256: library.sha256, clip_id: clip.id, phase });
const sample = (clip, phase) => sampleHumanPoseMotion(library, rig, template, selection(clip, phase));

// 見込み: 編集のworld回転差分だけを移せば、補助骨へ余計な編集を追加せずnative骨格の体形を保てる。
// 合格: 無編集はundefined、編集骨集合/他の手/入力不変、異なる軸と長さの骨格を往復して角度・腰・足の編集が一致。
// 範囲: 合成の全身骨格を使うretarget/編集保存。実GLB変形とUIはbrowser fixtureで確認。
test('モデル間の編集差分は無編集骨を増やさず、異なる骨格を往復できる', () => {
  const names = [...library.bone_names, 'toe3-1.L', 'toe3-1.R'];
  const parent = name => {
    const centre = { root: null, spine04: 'root', spine03: 'spine04', spine02: 'spine03', spine01: 'spine02', neck01: 'spine01', neck02: 'neck01', neck03: 'neck02', head: 'neck03' };
    if (name in centre) return centre[name];
    const side = name.slice(-1), base = name.slice(0, -2), finger = /^finger(\d)-(\d)$/u.exec(base);
    if (finger) return +finger[2] === 1 ? `wrist.${side}` : `finger${finger[1]}-${+finger[2] - 1}.${side}`;
    return ({ clavicle: 'spine01', shoulder01: `clavicle.${side}`, upperarm01: `shoulder01.${side}`, upperarm02: `upperarm01.${side}`, lowerarm01: `upperarm02.${side}`, lowerarm02: `lowerarm01.${side}`, wrist: `lowerarm02.${side}`, upperleg01: 'root', upperleg02: `upperleg01.${side}`, lowerleg01: `upperleg02.${side}`, lowerleg02: `lowerleg01.${side}`, foot: `lowerleg02.${side}`, 'toe3-1': `foot.${side}` })[base];
  };
  const position = name => {
    const centre = { root: .8, spine04: .9, spine03: .99, spine02: 1.1, spine01: 1.2, neck01: 1.3, neck02: 1.33, neck03: 1.36, head: 1.4 };
    if (name in centre) return new Vector3(0, centre[name], 0);
    const side = name.endsWith('.L') ? 1 : -1, base = name.slice(0, -2), finger = /^finger(\d)-(\d)$/u.exec(base);
    if (finger) return new Vector3(side * (.235 + +finger[1] * .014), .72 - +finger[2] * .024, .09 + (+finger[1] === 1 ? .028 : 0));
    const xyz = { clavicle: [.03, 1.25, 0], shoulder01: [.09, 1.25, 0], upperarm01: [.17, 1.25, 0], upperarm02: [.21, 1.13, .02], lowerarm01: [.26, 1, .04], lowerarm02: [.265, .88, .06], wrist: [.27, .77, .09], upperleg01: [.1, .8, 0], upperleg02: [.105, .62, .015], lowerleg01: [.11, .44, .03], lowerleg02: [.11, .25, .015], foot: [.11, .07, 0], 'toe3-1': [.11, .02, .1] }[base];
    return new Vector3(side * xyz[0], xyz[1], xyz[2]);
  };
  const makeRig = (scale, twist) => {
    const worldQ = name => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), name.startsWith('wrist.') ? twist : 0);
    return { rig_signature: 'a'.repeat(64), base_glb_sha256: 'b'.repeat(64), placement_root: 'human_rig', bones: names.map(name => {
      const p = parent(name), q = p ? worldQ(p) : new Quaternion();
      return { name, parent: p, rest: { translation: position(name).sub(p ? position(p) : new Vector3()).multiplyScalar(scale).applyQuaternion(q.clone().invert()).toArray(), rotation: q.invert().multiply(worldQ(name)).toArray(), scale: [1, 1, 1] } };
    }) };
  };
  const source = makeRig(1, 0), target = makeRig(1.2, .4);
  const restPose = rig => ({ schema_version: 1, pose_id: 'pose-test', revision: 1, rig_signature: rig.rig_signature, base_glb_sha256: rig.base_glb_sha256, transform_space: 'absolute_parent_local', user_confirmed: true,
    root: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, bones: Object.fromEntries(rig.bones.map(bone => [bone.name, structuredClone(bone.rest)])), supports: [], contacts: {} });
  const before = restPose(source), transfer = new HumanPoseMotionRetarget(source, target, true), after = transfer.pose(before, restPose(target));
  assert.equal(transfer.rebaseEdits(undefined, before, after), undefined);
  const edits = { version: 1, rotations: { 'wrist.L': new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .3).toArray(), 'finger2-1.L': new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .2).toArray() }, root_offset: [.1, .2, .3], foot_bends: { L: [5, 10] } };
  const original = structuredClone(edits), next = transfer.rebaseEdits(edits, before, after);
  assert.deepEqual(Object.keys(next.rotations).sort(), Object.keys(edits.rotations).sort());
  assert.deepEqual(next.foot_bends, edits.foot_bends); assert.deepEqual(next.root_offset, edits.root_offset.map(v => v * 1.2));
  const restored = new HumanPoseMotionRetarget(target, source, true).rebaseEdits(next, after, before);
  for (const name of Object.keys(edits.rotations)) assert.ok(new Quaternion(...restored.rotations[name]).angleTo(new Quaternion(...edits.rotations[name])) < 1e-7);
  restored.root_offset.forEach((v, i) => assert.ok(Math.abs(v - edits.root_offset[i]) < 1e-9));
  assert.deepEqual(edits, original);
  for (const bone of target.bones) assert.deepEqual(after.bones[bone.name].translation, bone.rest.translation);
  const changed = humanPoseWorldMatrices(target, editedHumanPose(target, after, { joint_edits: { ...next, root_offset: undefined } }));
  assert.deepEqual(changed.get('wrist.R').elements, humanPoseWorldMatrices(target, after).get('wrist.R').elements);
});

test('指定された9系統17本が同梱され、Sitting Talkingと移動重複版を含めない', () => {
  const { sha256, ...content } = library;
  assert.equal(createHash('sha256').update(JSON.stringify(content)).digest('hex'), sha256);
  assert.equal(library.clips.length, 17); assert.equal(new Set(library.clips.map(c => c.group)).size, 9);
  assert.equal(new Set(library.clips.map(c => c.id)).size, 17);
  assert.equal(library.clips.some(c => /Talking|_RM/u.test(c.source_name)), false);
  assert.ok(JSON.stringify(library).length < 650000);
});

test('全clipの両端と中間で骨長・有限値・正規化・足指範囲を保つ', () => {
  const before = structuredClone(template);
  for (const clip of library.clips) for (const phase of [0, .123, .5, .999, 1]) {
    const pose = sample(clip, phase);
    for (const bone of rig.bones) {
      assert.deepEqual(pose.bones[bone.name].translation, bone.rest.translation);
      assert.ok(Math.abs(new Quaternion(...pose.bones[bone.name].rotation).length() - 1) < 1e-10);
    }
    assert.ok(pose.root.translation.every(Number.isFinite));
    validateHumanPoseJointEdits({ version: 1, rotations: {}, foot_bends: pose.foot_bends });
    assert.deepEqual(pose.supports, []); assert.deepEqual(pose.contacts, {});
  }
  assert.deepEqual(template, before);
});

test('単発動作の100%は最終姿勢を保ち、0%へ巻き戻さない', () => {
  const death = library.clips.find(c => c.source_name === 'Death01');
  assert.equal(death.loop, false); assert.notDeepEqual(sample(death, 0).bones, sample(death, 1).bones);
  const end = sample(death, 1), near = sample(death, .99999);
  assert.ok(new Quaternion(...end.bones.root.rotation).angleTo(new Quaternion(...near.bones.root.rotation)) < .01);
});

test('時点を移すと微調整の相対角度と腰オフセットを保ち、カメラ・配置・反転を変えない', () => {
  const clip = library.clips[0], start = sample(clip, .2), end = sample(clip, .6);
  const delta = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .2);
  const edits = { version: 1, rotations: { 'wrist.L': new Quaternion(...start.bones['wrist.L'].rotation).multiply(delta).toArray() }, root_offset: [.1, .2, 0], foot_bends: { L: [8, start.foot_bends.L[1] + 4] } };
  const scene = { motion: selection(clip, .2), joint_edits: edits, body_mirror: 'mirrored', camera: { fov: 50 }, placement: { position: [3, 2, 1] } };
  const next = changeHumanPoseMotion(library, rig, template, scene, clip.id, .6);
  const actual = new Quaternion(...end.bones['wrist.L'].rotation).invert().multiply(new Quaternion(...next.joint_edits.rotations['wrist.L']));
  assert.ok(actual.angleTo(delta) < 1e-7);
  assert.deepEqual(next.joint_edits.root_offset, edits.root_offset);
  assert.ok(Math.abs(next.joint_edits.foot_bends.L[1] - end.foot_bends.L[1] - 4) < 1e-7);
  for (const key of ['camera', 'placement', 'body_mirror']) assert.deepEqual(next[key], scene[key]);
  assert.deepEqual(scene.motion, selection(clip, .2));
  assert.equal(changeHumanPoseMotion(library, rig, template, next, library.clips[1].id, 0).joint_edits, undefined);
  const reset = changeHumanPoseMotion(library, rig, template, next, '', 0);
  assert.equal(reset.motion, undefined); assert.equal(reset.joint_edits, undefined);
});

test('停止姿勢の関節編集を保存し直しても腰・指・つま先が再現する', () => {
  const base = sample(library.clips[5], .6), pose = structuredClone(base);
  pose.bones['finger2-2.L'].rotation = new Quaternion(...pose.bones['finger2-2.L'].rotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .4)).toArray();
  pose.root.translation[1] += .1; pose.foot_bends.L[1] = -60;
  const edits = humanPoseEdits(rig, base, pose), restored = editedHumanPose(rig, base, { joint_edits: JSON.parse(JSON.stringify(edits)) });
  for (const bone of rig.bones) assert.ok(new Quaternion(...pose.bones[bone.name].rotation).angleTo(new Quaternion(...restored.bones[bone.name].rotation)) < 1e-7);
  assert.deepEqual(restored.root, pose.root); assert.deepEqual(restored.foot_bends, pose.foot_bends);
  assert.equal(rebaseHumanPoseMotionEdits(undefined, base, pose), undefined);
});

test('不正な時点・未知素材・版違い・壊れたframe長を拒否する', () => {
  for (const change of [{ phase: -1 }, { phase: 1.01 }, { phase: NaN }, { phase: '0' }, { clip_id: '../bad' }, { version: 2 }, { library_sha256: [] }]) assert.throws(() => validateHumanPoseMotion({ ...selection(), ...change }));
  assert.throws(() => sampleHumanPoseMotion(library, rig, template, { ...selection(), library_sha256: 'b'.repeat(64) }), /版/);
  assert.throws(() => sampleHumanPoseMotion(library, rig, template, { ...selection(), clip_id: 'ual1-missing' }), /見つかりません/);
  assert.throws(() => sampleHumanPoseMotion(library, { ...rig, rig_signature: 'x' }, template, selection()), /骨格/);
  assert.throws(() => sampleHumanPoseMotion({ ...library, clips: [{ ...library.clips[0], data: 'AAAA' }] }, rig, template, selection()), /データ/);
});

test('足の微調整が制限値に達しても時点往復と他関節の編集で相対補正を失わない', () => {
  const clip = library.clips.find(c => c.source_name === 'Crouch_Idle_Loop');
  const start = { motion: selection(clip, .04), joint_edits: { version: 1, rotations: {}, foot_bends: { R: [0, -64] } } };
  const middle = changeHumanPoseMotion(library, rig, template, start, clip.id, .54);
  assert.equal(middle.joint_edits.foot_bends.R[1], -65);
  const base = sample(clip, .54), displayed = editedHumanPose(rig, base, middle);
  displayed.bones['wrist.L'].rotation = [0, 0, 0, 1];
  middle.joint_edits = humanPoseEdits(rig, base, displayed, false, middle.joint_edits);
  const restored = changeHumanPoseMotion(library, rig, template, middle, clip.id, .04);
  assert.ok(Math.abs(restored.joint_edits.foot_bends.R[1] + 64) < 1e-7);
  const changedFoot = editedHumanPose(rig, base, middle); changedFoot.foot_bends.R[1] = -40;
  const edited = humanPoseEdits(rig, base, changedFoot, false, middle.joint_edits);
  assert.equal(edited.motion_foot_offsets?.R, undefined);
});
