import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Group, Quaternion, Vector3 } from 'three';
import { describeHumanPoseCamera, humanPoseSceneFrame, humanPoseSceneForPreset, sameHumanPoseSource, validateHumanPoseScene, useHumanPoseBackgroundCamera } from '../src/lib/humanPoseScene.ts';
import { defaultBackgroundCapture } from '../src/lib/background3d.ts';
import { decodeHumanPoseScene } from '../src/lib/humanPoseSceneAssets.ts';
import { loadHumanPoseRuntime } from '../src/lib/humanPoseRuntime.ts';
import { confirmHumanPoseCameraPrompt, humanPoseCameraFacing, humanPoseCameraParts, humanPoseCameraPromptCurrent, humanPoseCameraPromptText, validateHumanPoseCameraPrompt } from '../src/lib/humanPoseScene.ts';

const digest = 'a'.repeat(64), hash = raw => createHash('sha256').update(raw).digest('hex');
const trs = (x = 0) => ({ translation: [x, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
const scene = () => ({ version: 1, source: { base_sha256: digest, rig_sha256: digest, pose_sha256: digest, rig_signature: digest, pose_revision: 1 },
  placement: { position: [0, 0, 0], yaw_degrees: 0 }, camera: { position: [0, 0, 5], target: [0, 0, 0], fov: 40 },
  projection: 'perspective', up: [0, 1, 0], frame: { width: 1024, height: 1024 } });

// 見込み: 明示的な登録ポーズ変更だけで素材と身体の基準を切り替えれば、カメラ・配置を保って新しい姿勢から編集できる。
// 合格: 新sourceへ交換、関節微調整/motionは除去、他の全設定と元入力を保持し、返値の変更も元へ伝わらない。
// 範囲: 切替時の設定作成。実素材の姿勢・頭位置/撮影枠の保持・Undo/確定/取消はbrowser fixtureで確認。
test('preset change keeps staging and camera while clearing edits based on the previous body pose',()=>{
 const old={...scene(),stature_m:1.7,body_mirror:'mirrored',joint_edits:{version:1,rotations:{root:[0,0,0,1]}},motion:{clip_id:'walk',phase:.4},
  background:{sourceId:'builtin:cube'},framing:{size:'waist-up',crop:{x:.1,y:.2,w:.6,h:.7}}};
 const before=structuredClone(old),source={...old.source,pose_sha256:'b'.repeat(64),pose_revision:2};
 const next=humanPoseSceneForPreset(old,source),expected={...before,source};delete expected.joint_edits;delete expected.motion;
 assert.deepEqual(next,expected);assert.deepEqual(old,before);next.camera.position[0]++;next.placement.position[1]++;next.source.pose_revision++;
 assert.deepEqual(old,before);assert.equal(source.pose_revision,2);
});

test('骨盤の現在yawと配置yawを合成し、横寝・仰向け・倒立では人物の左右を断定しない', () => {
  const rest = { ...trs(), rotation: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .3).toArray() };
  const rig = { bones: [{ name: 'root', parent: null, rest }] };
  const pose = q => ({ root: trs(), bones: { root: { ...rest, rotation: q.multiply(new Quaternion(...rest.rotation)).toArray() } } });
  for (const [local, placement, expected] of [[90, -90, 0], [135, 90, -135], [-90, 45, -45]]) {
    const facing = humanPoseCameraFacing(rig, pose(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), local * Math.PI / 180)), placement);
    assert.ok(Math.abs(facing - expected) < 1e-9);
  }
  for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 0, 1)]) {
    for (const degrees of [45.01, 90, 180, -90]) assert.equal(humanPoseCameraFacing(rig, pose(new Quaternion().setFromAxisAngle(axis, degrees * Math.PI / 180)), 0), null);
    assert.notEqual(humanPoseCameraFacing(rig, pose(new Quaternion().setFromAxisAngle(axis, 44.99 * Math.PI / 180)), 0), null);
  }
  const parts = humanPoseCameraParts(scene(), { centre: [0, 0, 0], world_facing_degrees: 90 });
  assert.match(parts.angle.ja, /人物の右側面/);
});

test('真上・真下・正面不明のときに前後左右を捏造せず、身体中心との一致も区別する', () => {
  for (const scale of [.001, 1, 100]) {
    for (const sign of [-1, 1]) {
      const s = scene(); s.camera.position = [1e-9 * scale, sign * scale, 0]; s.camera.target = [0, 0, -2];
      const parts = humanPoseCameraParts(s, { centre: [0, 0, 0], world_facing_degrees: 0 });
      assert.equal(parts.azimuth, null); assert.equal(parts.angle.ja, sign === 1 ? '俯瞰' : 'あおり');
      assert.doesNotMatch(parts.angle.en, /front|rear|left|right/);
    }
  }
  const unknown = humanPoseCameraParts(scene(), { centre: [0, 0, 0], world_facing_degrees: null });
  assert.equal(unknown.angle.ja, '水平に近い角度'); assert.equal(unknown.azimuth, null);
  const coincident = humanPoseCameraParts(scene(), { centre: [0, 0, 5], world_facing_degrees: 0 });
  assert.equal(coincident.elevation, null); assert.equal(coincident.angle.ja, '');
});

test('撮影記録は描画と素材の変更を検出し、背景表示やobject順序では古い記録にならない', () => {
  const s = scene(), subject = { centre: [0, 0, 0], world_facing_degrees: 0 };
  const saved = confirmHumanPoseCameraPrompt(s, subject);
  const reordered = Object.fromEntries(Object.entries(s).reverse());
  reordered.camera = Object.fromEntries(Object.entries(s.camera).reverse());
  assert.equal(humanPoseCameraPromptCurrent(saved, reordered), true);
  const background = { ...s, background: { sourceId: 'builtin:cube' }, show_supports: false };
  assert.equal(humanPoseCameraPromptCurrent(saved, background), true);
  assert.equal(confirmHumanPoseCameraPrompt(background, subject).scene.background, undefined);
  for (const mutate of [v => v.camera.position[0]++, v => v.camera.target[1]++, v => v.camera.fov++, v => v.camera.shift = [.2, 0],
    v => v.placement.yaw_degrees++, v => v.placement.position[0]++, v => v.frame.width = 512, v => v.stature_m = 1.7,
    v => v.source.pose_revision++, v => v.body_model = 'bodychan-female', v => v.body_mirror = 'mirrored', v => v.joint_edits = { version: 1, rotations: { root: [0, 0, 0, 1] } }]) {
    const changed = structuredClone(s); mutate(changed); assert.equal(humanPoseCameraPromptCurrent(saved, changed), false);
  }
  assert.equal(humanPoseCameraPromptCurrent(saved), false);
  s.camera.fov = 60; subject.centre[0] = 4;
  assert.equal(saved.scene.camera.fov, 40); assert.equal(saved.subject.centre[0], 0);
});

test('自動文を再利用し、日本語修正は保持するが対応する英語を捏造しない', () => {
  const s = scene(), subject = { centre: [0, 0, 0], world_facing_degrees: 0 };
  const saved = confirmHumanPoseCameraPrompt(s, subject);
  const original = humanPoseCameraPromptText(saved);
  assert.deepEqual({ ja: original.ja, en: original.en }, describeHumanPoseCamera(s, subject.centre));
  saved.overrides.angle_ja = '身体を右へ向けた横顔';
  assert.equal(humanPoseCameraPromptText(saved).en, null);
  assert.equal(confirmHumanPoseCameraPrompt(s, subject, saved).review_required, false);
  const changed = confirmHumanPoseCameraPrompt({ ...s, camera: { ...s.camera, fov: 60 } }, subject, saved);
  assert.equal(changed.overrides.angle_ja, saved.overrides.angle_ja); assert.equal(changed.review_required, true);
  assert.equal(confirmHumanPoseCameraPrompt(changed.scene, changed.subject, changed).review_required, true);
  assert.equal(confirmHumanPoseCameraPrompt(s, { ...subject, world_facing_degrees: 90 }, saved).review_required, true);
  changed.overrides.angle_ja = ''; assert.equal(humanPoseCameraPromptText(changed).ja, humanPoseCameraPromptText(changed).automatic.lens.ja);
  changed.overrides = {}; assert.notEqual(humanPoseCameraPromptText(changed).en, null);
  assert.equal(confirmHumanPoseCameraPrompt(s, subject, changed).review_required, false);
});

test('撮影説明の破損した保存値を表示前に拒否する', () => {
  const saved = confirmHumanPoseCameraPrompt(scene(), { centre: [0, 0, 0], world_facing_degrees: null });
  validateHumanPoseCameraPrompt(saved);
  for (const mutate of [v => v.version = 2, v => v.subject.centre[0] = Infinity, v => delete v.subject.world_facing_degrees,
    v => v.subject.world_facing_degrees = 181, v => v.overrides = [], v => v.overrides.lens_ja = 3, v => v.overrides.angle_ja = 'a'.repeat(2001),
    v => v.overrides.extra = '', v => v.review_required = 'yes', v => v.scene.camera.fov = 0]) {
    const bad = structuredClone(saved); mutate(bad); assert.throws(() => validateHumanPoseCameraPrompt(bad));
  }
});

test('撮影設定は不正な数値・投影・素材識別子を補正せず拒否する', () => {
  validateHumanPoseScene(scene());
  for (const mutate of [s => s.source.pose_revision = 0, s => s.source.pose_sha256 = 'unknown', s => s.camera.position[0] = NaN,
    s => s.camera.fov = 0, s => s.camera.position = [0, 0, 0], s => s.camera.shift = [3, 0], s => s.up = [0, -1, 0],
    s => s.projection = 'fisheye', s => s.placement.yaw_degrees = Infinity, s => s.frame.width = 8192, s => s.frame.height = 128.5,
    s => s.body_mirror = true, s => s.body_mirror = null, s => s.body_mirror = ['mirrored'], s => s.body_mirror = 'left']) {
    const bad = scene(); mutate(bad); assert.throws(() => validateHumanPoseScene(bad));
  }
  assert.equal(sameHumanPoseSource(scene().source, { ...scene().source, pose_revision: 2 }), false);
  assert.equal(sameHumanPoseSource(scene().source, { ...scene().source, rig_sha256: 'b'.repeat(64) }), false);
});

test('反転値のない既存保存を変更せず、反転だけでカメラの左右を入れ替えない', () => {
  const legacy = scene(), before = structuredClone(legacy);
  validateHumanPoseScene(legacy); assert.deepEqual(legacy, before);
  for (const body_mirror of ['original', 'mirrored']) {
    const selected = { ...legacy, body_mirror }; validateHumanPoseScene(selected);
    assert.deepEqual(describeHumanPoseCamera(selected, [0, 0, 0]), describeHumanPoseCamera(legacy, [0, 0, 0]));
    assert.deepEqual(selected.source, before.source); assert.deepEqual(selected.placement, before.placement);
  }
});

test('人物枠から作るPNG寸法は整数で上限内に収まる', () => {
  assert.deepEqual(humanPoseSceneFrame(.5), { width: 512, height: 1024 });
  assert.deepEqual(humanPoseSceneFrame(2), { width: 1024, height: 512 });
  assert.deepEqual(humanPoseSceneFrame(0), { width: 1024, height: 1024 });
  assert.deepEqual(humanPoseSceneFrame(100), { width: 1024, height: 128 });
});

test('背景と大きさは省略可能で、不正な舞台・倍率・表示設定を補正せず拒否する', () => {
  const valid = scene(); valid.placement.scale = 100; valid.show_supports = false;
  valid.background = { sourceId: `stage-${digest}`, cutaway: { enabled: true, depth: .2 }, objectVisibility: [{ mesh: 4, mode: 'hide' }] };
  validateHumanPoseScene(valid);
  for (const mutate of [s => s.placement.scale = 0, s => s.placement.scale = -1, s => s.placement.scale = Infinity,
    s => s.placement.scale = 1001, s => s.show_supports = 'false', s => s.background = null,
    s => s.background.sourceId = '../other.glb', s => s.background.cutaway.depth = 0,
    s => s.background.objectVisibility[0].mesh = -1, s => s.background.objectVisibility.push({ mesh: 4, mode: 'show' })]) {
    const bad = structuredClone(valid); mutate(bad); assert.throws(() => validateHumanPoseScene(bad));
  }
});

test('背景カメラ取込は同じ舞台に限定し、画角・shift・縦横比を共有して姿勢を保持する', () => {
  const original = scene(); original.background = { sourceId: `stage-${digest}` }; original.placement.scale = 100; original.body_mirror = 'mirrored';
  const before = structuredClone(original), capture = defaultBackgroundCapture({ x: 1, y: 2, w: 80, h: 40 });
  capture.sourceId = original.background.sourceId; capture.camera.shift = [.1, -.2]; capture.cutaway = { enabled: true, depth: .25 };
  capture.objectVisibility = [{ mesh: 2, mode: 'hide' }];
  const next = useHumanPoseBackgroundCamera(original, capture);
  assert.deepEqual(next.camera, capture.camera); assert.deepEqual(next.frame, { width: 1024, height: 512 });
  assert.deepEqual(next.placement, original.placement); assert.equal(next.body_mirror, 'mirrored'); assert.deepEqual(original, before);
  next.background.objectVisibility[0].mode = 'show'; assert.equal(capture.objectVisibility[0].mode, 'hide');
  assert.throws(() => useHumanPoseBackgroundCamera(original, { ...capture, sourceId: 'builtin:cube' }), /舞台が異なり/);
  assert.throws(() => useHumanPoseBackgroundCamera(original, { ...capture, camera: { ...capture.camera, fov: 140 } }), /撮影設定/);
});

test('方位・左右・背面の分類境界を日英で揃える', () => {
  const sample = scene();
  for (const [degrees, ja, en] of [[0, '正面', 'front view'], [22.49, '正面', 'front view'], [22.51, '人物の左斜め前', "subject's left"],
    [67.49, '人物の左斜め前', 'front three-quarter'], [67.51, '人物の左側面', 'side view'], [112.51, '人物の左斜め後ろ', 'rear three-quarter'],
    [157.51, '背面', 'rear view'], [-45, '人物の右斜め前', "subject's right"], [-90, '人物の右側面', 'side view'], [-135, '人物の右斜め後ろ', 'rear three-quarter'], [180, '背面', 'rear view']]) {
    const radians = degrees * Math.PI / 180; sample.camera.position = [Math.sin(radians) * 5, 0, Math.cos(radians) * 5];
    const description = describeHumanPoseCamera(sample, [0, 0, 0]); assert.ok(description.ja.startsWith(ja)); assert.ok(description.en.includes(en));
  }
  sample.placement = { position: [8, 2, 1], yaw_degrees: 90 }; sample.camera.position = [13, 2, 1];
  assert.ok(describeHumanPoseCamera(sample, [8, 2, 1]).ja.startsWith('正面'));
  sample.camera.shift = [.5, -.2];
  assert.ok(describeHumanPoseCamera(sample, [8, 2, 1]).ja.startsWith('正面'));
});

test('上下15度と垂直FOV30/60度の境界を明示し、顔やフレーミングは推測しない', () => {
  const sample = scene();
  for (const [angle, ja] of [[14.99, '水平に近い'], [15.01, '俯瞰'], [-14.99, '水平に近い'], [-15.01, 'あおり']]) {
    sample.camera.position = [0, Math.tan(angle * Math.PI / 180) * 5, 5];
    assert.ok(describeHumanPoseCamera(sample, [0, 0, 0]).ja.includes(ja));
  }
  for (const [fov, ja, en] of [[30, '望遠寄り', 'narrow-angle'], [31, '標準', 'standard'], [59, '標準', 'standard'], [60, '広角', 'wide-angle']]) {
    sample.camera.fov = fov; const description = describeHumanPoseCamera(sample, [0, 0, 0]);
    assert.ok(description.ja.includes(ja)); assert.ok(description.en.includes(en)); assert.doesNotMatch(description.en, /gaze|full.body|fisheye/);
  }
});

// 小さなskinned triangle。node名の「.L/.R」がloaderで変わる場合も元の名前で適用する。
function fixture() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const joints = new Uint16Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const binary = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(joints.buffer), Buffer.from(weights.buffer)]);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'human_rig', children: [1, 6] }, { name: 'root', children: [2, 3, 4] }, { name: 'hand.L' }, { name: 'hand.R' },
      { name: 'head', children: [5] }, { name: 'jaw' }, { mesh: 0, skin: 0 }],
    skins: [{ joints: [1, 2, 3, 4, 5] }], meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
    buffers: [{ byteLength: binary.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }, { buffer: 0, byteOffset: 60, byteLength: 48 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'VEC4' }, { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' }] };
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
  const raw = Buffer.alloc(28 + text.length + binary.length);
  raw.write('glTF'); raw.writeUInt32LE(2, 4); raw.writeUInt32LE(raw.length, 8);
  raw.writeUInt32LE(text.length, 12); raw.writeUInt32LE(0x4e4f534a, 16); text.copy(raw, 20);
  raw.writeUInt32LE(binary.length, 20 + text.length); raw.writeUInt32LE(0x004e4942, 24 + text.length); binary.copy(raw, 28 + text.length);
  const rig = { rig_signature: digest, base_glb_sha256: hash(raw), placement_root: 'human_rig',
    bones: ['root', 'hand.L', 'hand.R', 'head', 'jaw'].map(name => ({ name, parent: name === 'root' ? null : name === 'jaw' ? 'head' : 'root', rest: trs() })) };
  const pose = { schema_version: 1, pose_id: 'pose-test', revision: 1, rig_signature: digest, base_glb_sha256: hash(raw), transform_space: 'absolute_parent_local', user_confirmed: true,
    root: trs(3), bones: { root: trs(), 'hand.L': trs(1), 'hand.R': trs(),
      head: { ...trs(), rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .6).toArray() },
      jaw: { ...trs(), rotation: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .2).toArray() } },
    supports: [{ id: 'seat', kind: 'box', position: [2, .4, .1], size: [1, .2, 1] }],
    contacts: { foot: { side: 'L', point: [2, 0, .1] } } };
  const record = (kind, bytes) => ({ kind, pose_id: kind === 'pose' ? pose.pose_id : null, catalog_sha256: digest,
    mime_type: kind === 'base' ? 'model/gltf-binary' : 'application/json', usage: 'pose_asset', byte_size: bytes.length, sha256: hash(bytes), data: bytes.toString('base64') });
  return { pose_id: pose.pose_id, catalog_sha256: digest, base: record('base', raw), rig: record('rig', Buffer.from(JSON.stringify(rig))), pose: record('pose', Buffer.from(JSON.stringify(pose))) };
}

// 見込み: 表示素材を別に検証すれば、catalogの素体識別子を保って別の女性骨格を読める。
// 合格: 指定ID・GLB/rigのhashと対応を照合し、欠損/差替え/未要求素材を拒否。合成GLBの応答検証で、実モデルの見た目はbrowser対象。
test('女性モデルの表示応答を独立に検証し、元のpose sourceを変えない', async () => {
  const payload = fixture(), before = structuredClone(payload);
  const raw = Buffer.from(payload.base.data, 'base64'), rig = JSON.parse(Buffer.from(payload.rig.data, 'base64'));
  rig.head_length_m = .2;
  const record = (kind, bytes) => ({ kind, pose_id: null, catalog_sha256: digest, usage: 'pose_asset',
    mime_type: kind === 'body_base' ? 'model/gltf-binary' : 'application/json', sha256: hash(bytes), byte_size: bytes.length, data: bytes.toString('base64') });
  payload.body_model = { id: 'bodychan-female', base: record('body_base', raw), rig: record('body_rig', Buffer.from(JSON.stringify(rig))) };
  const result = await decodeHumanPoseScene(payload, 'pose-test', digest, 'bodychan-female');
  assert.equal(result.body.id, 'bodychan-female'); assert.equal(result.body.rig.head_length_m, .2);
  assert.equal(result.source.base_sha256, before.base.sha256); assert.deepEqual(result.pose, JSON.parse(Buffer.from(before.pose.data, 'base64')));
  await assert.rejects(decodeHumanPoseScene(payload, 'pose-test', digest), /表示モデル/);
  for (const mutate of [v => v.body_model.id = 'other', v => delete v.body_model.base, v => v.body_model.base.sha256 = 'b'.repeat(64),
    v => v.body_model.rig.data = 'AAAA']) {
    const bad = structuredClone(payload); mutate(bad); await assert.rejects(decodeHumanPoseScene(bad, 'pose-test', digest, 'bodychan-female'));
  }
  for (const mutate of [v => v.base_glb_sha256 = 'b'.repeat(64), v => delete v.head_length_m, v => v.head_length_m = NaN,
    v => v.bones = v.bones.filter(bone => bone.name !== 'jaw')]) {
    const bad = structuredClone(payload), changed = structuredClone(rig); mutate(changed);
    bad.body_model.rig = record('body_rig', Buffer.from(JSON.stringify(changed)));
    await assert.rejects(decodeHumanPoseScene(bad, 'pose-test', digest, 'bodychan-female'));
  }
  const sceneValue = { ...scene(), body_model: 'bodychan-female' }; validateHumanPoseScene(sceneValue);
  for (const model of ['male', '', {}, null, 1]) assert.throws(() => validateHumanPoseScene({ ...sceneValue, body_model: model }));
});

test('素材の取り違え・内容差し替え・壊れた全bone指定を表示前に拒否する', async () => {
  const payload = fixture();
  const assets = await decodeHumanPoseScene(payload, 'pose-test', digest);
  assert.equal(assets.source.pose_sha256, payload.pose.sha256);
  for (const mutate of [p => p.catalog_sha256 = 'b'.repeat(64), p => p.base.byte_size++, p => p.base.data = p.base.data.slice(4), p => p.rig.pose_id = 'pose-test',
    p => p.pose.sha256 = 'b'.repeat(64), p => p.pose.usage = 'comparison_only']) {
    const bad = structuredClone(payload); mutate(bad); await assert.rejects(decodeHumanPoseScene(bad, 'pose-test', digest));
  }
  const bad = structuredClone(payload), pose = JSON.parse(Buffer.from(bad.pose.data, 'base64'));
  delete pose.bones['hand.R']; const raw = Buffer.from(JSON.stringify(pose));
  bad.pose = { ...bad.pose, sha256: hash(raw), data: raw.toString('base64'), byte_size: raw.length };
  await assert.rejects(decodeHumanPoseScene(bad, 'pose-test', digest), /全bone/);
});

test('共通runtimeが配置rootと.L boneを適用し、次のposeでは前の変形を残さない', async () => {
  const assets = await decodeHumanPoseScene(fixture(), 'pose-test', digest);
  const runtime = await loadHumanPoseRuntime(assets.base, assets.rig);
  try {
    const original = structuredClone(assets.pose); runtime.applyPose(assets.pose);
    const mesh = runtime.meshes[0], vertex = new Vector3();
    mesh.getVertexPosition(0, vertex).applyMatrix4(mesh.matrixWorld); assert.deepEqual(vertex.toArray(), [4, 0, 0]);
    assert.deepEqual(assets.pose, original);
    const reset = structuredClone(assets.pose); reset.root = trs(); reset.bones['hand.L'] = trs(); runtime.applyPose(reset);
    mesh.getVertexPosition(0, vertex).applyMatrix4(mesh.matrixWorld); assert.deepEqual(vertex.toArray(), [0, 0, 0]);
  } finally { runtime.dispose(); }
});

test('同じruntimeで反転を選び直してもtoggleせず、顔方向・外側配置と基準素材を保持する', async () => {
  const assets = await decodeHumanPoseScene(fixture(), 'pose-test', digest), original = structuredClone(assets.pose);
  const runtime = await loadHumanPoseRuntime(assets.base, assets.rig), placement = new Group();
  placement.position.set(5, .5, -2); placement.rotation.y = Math.PI / 6;
  placement.add(runtime.scene); placement.updateMatrixWorld(true);
  const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${v} != ${b[i]}`));
  const vertex = () => runtime.meshes[0].getVertexPosition(0, new Vector3()).applyMatrix4(runtime.meshes[0].matrixWorld).toArray();
  const face = () => runtime.meshes[0].skeleton.bones.filter(b => ['head', 'jaw'].includes(b.name))
    .map(b => b.getWorldQuaternion(new Quaternion()).toArray());
  try {
    runtime.applyPose(assets.pose);
    const before = vertex(), directions = face(), outer = placement.matrix.toArray();
    assert.equal(directions.length, 2);
    for (let repeat = 0; repeat < 2; repeat++) {
      const applied = runtime.applyPose(assets.pose, 'mirrored');
      near(vertex(), new Vector3(-3, 0, 0).applyMatrix4(placement.matrixWorld).toArray());
      face().forEach((q, i) => near(q, directions[i]));
      assert.deepEqual(applied.supports, [{ id: 'seat', kind: 'box', position: [-2, .4, .1], size: [1, .2, 1] }]);
      assert.deepEqual(applied.contacts.foot, { side: 'R', point: [-2, 0, .1] });
      assert.deepEqual(placement.matrix.toArray(), outer); assert.deepEqual(assets.pose, original);
    }
    runtime.applyPose(assets.pose, 'original'); near(vertex(), before);
    face().forEach((q, i) => near(q, directions[i]));
    assert.throws(() => runtime.applyPose(assets.pose, 'left'), /左右指定/);
    near(vertex(), before);
  } finally { runtime.dispose(); }
});

test('線骨格の応答はGLBなしでも同一素材を照合し、base識別子の差し替えを拒否する', async () => {
  const payload = fixture(), baseHash = payload.base.sha256;
  delete payload.base; payload.representation = 'skeleton'; payload.base_sha256 = baseHash;
  const assets = await decodeHumanPoseScene(payload, 'pose-test', digest);
  assert.equal(assets.base, undefined); assert.equal(assets.source.base_sha256, baseHash);
  for (const mutate of [p => p.base_sha256 = 'f'.repeat(64), p => delete p.representation, p => delete p.base_sha256, p => p.base = fixture().base]) {
    const bad = structuredClone(payload); mutate(bad); await assert.rejects(decodeHumanPoseScene(bad, 'pose-test', digest));
  }
});

test('モーションの保存値を検証し、省略された既存sceneも受け入れる', () => {
  const valid = scene(); valid.motion = { version: 1, library_sha256: digest, clip_id: 'ual1-jog-fwd-loop', phase: .45 };
  validateHumanPoseScene(valid); validateHumanPoseScene(scene());
  for (const motion of [null, {}, { ...valid.motion, phase: Infinity }, { ...valid.motion, phase: 2 }, { ...valid.motion, library_sha256: 'bad' }]) assert.throws(() => validateHumanPoseScene({ ...valid, motion }));
});

test('設置面を検証し、同じ背景のカメラ取込でも設置先を保持する', () => {
  const valid = scene(); valid.background = { sourceId: `stage-${digest}`, surface: {
    version: 1, point: [.2, .47, -.6], normal: [0, 1, 0], surfaceMesh: 2, anchor: 'hips', height_offset: .03, facing_degrees: 90,
  } };
  validateHumanPoseScene(valid);
  for (const surface of [null, {}, { ...valid.background.surface, normal: [1, 0, 0] }, { ...valid.background.surface, height_offset: NaN }]) {
    assert.throws(() => validateHumanPoseScene({ ...valid, background: { ...valid.background, surface } }));
  }
  const capture = defaultBackgroundCapture({ x: 0, y: 0, w: 800, h: 600 }); capture.sourceId = valid.background.sourceId;
  const next = useHumanPoseBackgroundCamera(valid, capture);
  assert.deepEqual(next.background.surface, valid.background.surface);
  next.background.surface.point[0] = 9; assert.equal(valid.background.surface.point[0], .2);
});
