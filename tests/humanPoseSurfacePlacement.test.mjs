import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { alignHumanPoseSurface, humanPoseBodyFacing, humanPosePlacementScale, humanPoseSurfaceAligned, humanPoseSurfaceAnchor, keepHumanPoseHeadPosition, validateHumanPoseSurface } from '../src/lib/humanPoseSurfacePlacement.ts';

const points = () => {
  const result = new Map([['upperleg01.L', new Vector3(.1, .8, .1)], ['upperleg01.R', new Vector3(-.1, .82, .1)]]);
  for (const side of ['L', 'R']) for (let i = 0; i < 4; i++) for (const edge of ['a', 'b']) {
    result.set(`plate${i}${edge}.${side}`, new Vector3((side === 'L' ? .15 : -.15) + (edge === 'a' ? .03 : -.03), (side === 'L' ? .02 : .25) + (edge === 'a' ? 0 : -.02), i * .08));
  }
  return result;
};
const surface = (anchor = 'feet') => ({ version: 1, point: [2, .4, -3], normal: [0, 1, 0], surfaceMesh: 7, anchor, height_offset: 0 });
const scene = () => ({ placement: { position: [8, 2, 1], yaw_degrees: 37, scale: 2 }, stature_m: 1.57,
  background: { sourceId: 'stage-' + 'a'.repeat(64) }, camera: { position: [4, 3, 5], target: [0, 1, 0], fov: 40 },
  frame: { width: 1024, height: 768 }, body_mirror: 'mirrored', motion: { clip_id: 'ual1-jog-fwd-loop', phase: .45 }, joint_edits: { rotations: { 'wrist.L': [0, 0, 0, 1] } } });
const world = (p, s) => p.clone().multiplyScalar(humanPosePlacementScale(s, 1.4)).applyAxisAngle(new Vector3(0, 1, 0), s.placement.yaw_degrees * Math.PI / 180).add(new Vector3(...s.placement.position));
const close = (a, b) => assert.ok(a.distanceTo(b) < 1e-9, `${a.toArray()} != ${b.toArray()}`);

// 見込み: 新姿勢の頭へ身長・倍率・yawを適用した差分で配置を補正すれば、頭のworld位置を維持できる。
// 合格: 異なる頭の座標と連続切替でもworld位置が一致し、位置以外の設定・入力が不変。純粋な配置計算のみ、実描画はbrowser検証。
test('登録姿勢の切替は頭を基準に配置し、カメラと切取りを保つ', () => {
  const s = { ...scene(), framing: { size: 'bust-up', crop: { x: -.2, y: .1, w: 1.3, h: 1.3 } } }, before = structuredClone(s);
  const target = world(new Vector3(.2, 1.3, -.1), s);
  let next = s;
  for (const head of [new Vector3(-.3, .7, .5), new Vector3(.8, 1.1, -.4), new Vector3(.2, 1.3, -.1)]) {
    const headBefore = head.clone(), targetBefore = target.clone();
    next = keepHumanPoseHeadPosition(next, head, 1.4, target);
    close(world(head, next), target);
    assert.deepEqual({ ...next, placement: s.placement }, before);
    assert.equal(next.placement.yaw_degrees, s.placement.yaw_degrees); assert.equal(next.placement.scale, s.placement.scale);
    close(head, headBefore); close(target, targetBefore);
  }
  close(new Vector3(...next.placement.position), new Vector3(...s.placement.position));
  assert.deepEqual(s, before);
  assert.throws(() => keepHumanPoseHeadPosition(s, new Vector3(), 1.4, new Vector3(Infinity, 0, 0)), /座標範囲/);
});

test('両足の板端を床に合わせ、上がった足と身長・倍率・yawを保つ', () => {
  const p = points(), s = scene(), before = structuredClone(s), next = alignHumanPoseSurface(s, p, 1.4, 0, surface());
  const vertices = [...p].filter(([name]) => name.startsWith('plate')).map(([, v]) => world(v, next));
  assert.ok(Math.abs(Math.min(...vertices.map(v => v.y)) - .4) < 1e-9);
  assert.ok(world(p.get('plate0b.R'), next).y > .8);
  close(world(humanPoseSurfaceAnchor(p, 'feet'), next), new Vector3(2, .4, -3));
  for (const key of ['camera', 'frame', 'stature_m', 'motion', 'joint_edits', 'body_mirror']) assert.deepEqual(next[key], before[key]);
  assert.equal(next.placement.yaw_degrees, 37); assert.equal(next.show_supports, false); assert.deepEqual(s, before);
  assert.deepEqual(alignHumanPoseSurface(next, p, 1.4, 0), next); assert.equal(humanPoseSurfaceAligned(next, p, 1.4, 0), true);
});

test('支持脚を明示して片足だけ合わせ、足の左右を勝手に替えない', () => {
  const p = points();
  for (const [anchor, side] of [['left_foot', 'L'], ['right_foot', 'R']]) {
    const next = alignHumanPoseSurface(scene(), p, 1.4, 0, surface(anchor));
    close(world(humanPoseSurfaceAnchor(p, anchor), next), new Vector3(2, .4, -3));
    assert.ok(Math.abs(world(p.get(`plate0b.${side}`), next).y - .4) < 1e-9);
  }
});

test('座面は現在の股関節中点を使い、方向と高さ補正を同時に保存する', () => {
  const p = points(), target = { ...surface('hips'), facing_degrees: -150, height_offset: .06 };
  const next = alignHumanPoseSurface(scene(), p, 1.4, 25, target);
  assert.equal(next.placement.yaw_degrees, -175);
  close(world(humanPoseSurfaceAnchor(p, 'hips'), next), new Vector3(2, .46, -3));
  assert.deepEqual(next.background.surface, target);
  assert.equal(humanPoseSurfaceAligned(next, p, 1.4, 25), true);
  p.get('upperleg01.L').y += .05;
  assert.equal(humanPoseSurfaceAligned(next, p, 1.4, 25), false);
  assert.equal(humanPoseSurfaceAligned(alignHumanPoseSurface(next, p, 1.4, 25), p, 1.4, 25), true);
});

test('ほぼ水平な面でも全足板の面法線距離を確認し、yaw後の端の潜りを防ぐ', () => {
  const normal = new Vector3(.01, 1, -.005).normalize(), target = { ...surface(), normal: normal.toArray() };
  const p = points(), next = alignHumanPoseSurface(scene(), p, 1.4, 0, target);
  const distances = [...p].filter(([name]) => name.startsWith('plate')).map(([, v]) => world(v, next).sub(new Vector3(...target.point)).dot(normal));
  assert.ok(Math.abs(Math.min(...distances)) < 1e-9);
});

test('骨格の基準回転を差し引き、水平な正面を持たない姿勢へ向きを強制しない', () => {
  const rest = { translation: [0, 1, 0], rotation: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .3).toArray(), scale: [1, 1, 1] };
  const rig = { bones: [{ name: 'root', parent: null, rest }] };
  const pose = q => ({ root: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, bones: { root: { ...rest, rotation: q.multiply(new Quaternion(...rest.rotation)).toArray() } } });
  assert.ok(Math.abs(humanPoseBodyFacing(rig, pose(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .6))) - .6 * 180 / Math.PI) < 1e-8);
  assert.equal(humanPoseBodyFacing(rig, pose(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2))), undefined);
  const s = scene(), p = points(); assert.equal(alignHumanPoseSurface(s, p, 1.4, undefined, surface()).placement.yaw_degrees, s.placement.yaw_degrees);
  assert.throws(() => alignHumanPoseSurface(s, p, 1.4, undefined, { ...surface(), facing_degrees: 0 }), /正面/);
});

test('不正な設置面・向き・高さと背景なしの配置を拒否する', () => {
  validateHumanPoseSurface(surface());
  assert.throws(() => validateHumanPoseSurface({}));
  for (const bad of [null, { version: 2 }, { normal: [0, -1, 0] }, { normal: [0, 2, 0] }, { surfaceMesh: -1 }, { surfaceMesh: .5 }, { anchor: 'head' }, { point: [0, NaN, 0] }, { height_offset: Infinity }, { facing_degrees: 181 }]) {
    assert.throws(() => validateHumanPoseSurface(bad === null ? null : { ...surface(), ...bad }));
  }
  assert.throws(() => alignHumanPoseSurface({ ...scene(), background: undefined }, points(), 1.4, 0, surface()));
});
