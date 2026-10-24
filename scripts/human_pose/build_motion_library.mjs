import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Quaternion } from 'three';
import { sampleHumanPoseMotion } from '../../src/lib/humanPoseMotion.ts';
import { HumanPoseMotionRetarget, motionFloorOffset } from '../../src/lib/humanPoseMotionRetarget.ts';

export const selectedClips = [
  ['Jog_Fwd_Loop', 'ジョギング', '走る'], ['Sprint_Loop', 'スプリント', '走る'],
  ['Walk_Loop', '歩く', '歩く'], ['Walk_Formal_Loop', 'きちんと歩く', '歩く'],
  ['Crouch_Fwd_Loop', 'しゃがんで進む', 'しゃがむ'], ['Crouch_Idle_Loop', 'しゃがんで待つ', 'しゃがむ'],
  ['Sitting_Enter', '座る', '座る'], ['Sitting_Idle_Loop', '座って待つ', '座る'], ['Sitting_Exit', '立ち上がる', '座る'],
  ['Punch_Jab', 'ジャブ', 'パンチ'], ['Punch_Cross', 'クロスパンチ', 'パンチ'], ['Roll', '前転', '転がる'],
  ['Swim_Fwd_Loop', '泳いで進む', '泳ぐ'], ['Swim_Idle_Loop', '泳いで待つ', '泳ぐ'],
  ['Sword_Attack', '剣で攻撃', '剣'], ['Sword_Idle', '剣を構える', '剣'], ['Death01', '倒れる', '倒れる'],
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Read only the embedded skeleton and animation tracks, never load materials or textures. */
export function readMotionGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error('Expected glTF 2 GLB');
  let gltf, binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4), chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) gltf = JSON.parse(chunk.toString());
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  if (!gltf || !binary) throw new Error('Missing embedded GLB data');
  const parents = new Map(); gltf.nodes.forEach((n, i) => n.children?.forEach(child => parents.set(child, i)));
  const rig = { rig_signature: sha(bytes), base_glb_sha256: sha(bytes), placement_root: 'Armature',
    bones: gltf.nodes.map((n, i) => ({ name: n.name, parent: parents.has(i) ? gltf.nodes[parents.get(i)].name : null,
      rest: { translation: n.translation ?? [0, 0, 0], rotation: new Quaternion(...(n.rotation ?? [0, 0, 0, 1])).normalize().toArray(), scale: [1, 1, 1] } })) };
  const accessor = id => {
    const a = gltf.accessors[id], v = gltf.bufferViews[a.bufferView], width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    if (a.componentType !== 5126 || a.sparse || !width || v.buffer !== 0) throw new Error('Unsupported animation accessor');
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? width * 4;
    return Array.from({ length: a.count }, (_, i) => Array.from({ length: width }, (_, j) => binary.readFloatLE(start + i * stride + j * 4)));
  };
  const animations = gltf.animations.map(a => ({ name: a.name, tracks: a.channels.map(c => {
    const s = a.samplers[c.sampler]; if (s.interpolation && s.interpolation !== 'LINEAR') throw new Error('Unsupported interpolation');
    return { bone: gltf.nodes[c.target.node].name, path: c.target.path, times: accessor(s.input).flat(), values: accessor(s.output) };
  }) }));
  return { rig, animations };
}
export function sourcePoseAt(rig, animation, time) {
  const pose = { bones: Object.fromEntries(rig.bones.map(b => [b.name, structuredClone(b.rest)])), root: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } };
  for (const track of animation.tracks) {
    let b = track.times.findIndex(t => t >= time); if (b < 0) b = track.times.length - 1;
    const a = Math.max(0, b - 1), f = a === b ? 0 : Math.max(0, Math.min(1, (time - track.times[a]) / (track.times[b] - track.times[a])));
    if (track.path === 'scale') continue; // Exporter scales are rounding noise around 1.
    pose.bones[track.bone][track.path] = track.path === 'rotation'
      ? new Quaternion(...track.values[a]).normalize().slerp(new Quaternion(...track.values[b]).normalize(), f).toArray()
      : track.values[a].map((v, i) => v + (track.values[b][i] - v) * f);
  }
  return pose;
}
export async function buildLibrary(input, rigPath, output) {
  const bytes = await readFile(input), targetBytes = await readFile(rigPath), target = JSON.parse(targetBytes);
  const { rig, animations } = readMotionGlb(bytes), retarget = new HumanPoseMotionRetarget(rig, target);
  const template = { schema_version: 1, pose_id: 'motion', revision: 1, rig_signature: target.rig_signature, base_glb_sha256: target.base_glb_sha256,
    transform_space: 'absolute_parent_local', user_confirmed: false, supports: [], contacts: {} };
  const clips = [];
  for (const [source_name, label_ja, group] of selectedClips) {
    const animation = animations.find(a => a.name === source_name); if (!animation) throw new Error(`Missing ${source_name}`);
    const duration = Math.max(...animation.tracks.map(t => t.times.at(-1))), intervals = Math.ceil(duration * 30);
    const poses = Array.from({ length: intervals + 1 }, (_, i) => retarget.pose(sourcePoseAt(rig, animation, duration * i / intervals), template));
    const stride = retarget.boneNames.length * 8 + 16, data = Buffer.alloc(poses.length * stride);
    poses.forEach((pose, frame) => {
      let pos = frame * stride;
      for (const name of retarget.boneNames) for (const q of pose.bones[name].rotation) { data.writeInt16LE(Math.round(q * 32767), pos); pos += 2; }
      for (const v of pose.root.translation) { data.writeFloatLE(v, pos); pos += 4; }
      for (const side of ['L', 'R']) { data.writeInt16LE(Math.round(pose.foot_bends[side][1] * 100), pos); pos += 2; }
    });
    const clip = { id: `ual1-${source_name.toLowerCase().replaceAll('_', '-')}`, label_ja, group, source_name, duration, loop: source_name.endsWith('_Loop') || source_name === 'Sword_Idle', frames: poses.length, data: data.toString('base64') };
    const temporary = { version: 1, sha256: '0'.repeat(64), rig_signature: target.rig_signature, bone_names: retarget.boneNames, clips: [clip] };
    // Evaluate the *runtime* interpolation after quantization, whose path differs from source interpolation.
    const swimming = source_name.startsWith('Swim_');
    const samples = Array.from({ length: intervals * 8 + 1 }, (_, i) => sampleHumanPoseMotion(temporary, target, template,
      { version: 1, library_sha256: temporary.sha256, clip_id: clip.id, phase: i / (intervals * 8) }));
    const offset = motionFloorOffset(target, samples, swimming) + (swimming ? 0 : .0005);
    for (let frame = 0; frame < poses.length; frame++) {
      const index = frame * stride + retarget.boneNames.length * 8 + 4;
      data.writeFloatLE(data.readFloatLE(index) + offset, index);
    }
    clip.data = data.toString('base64'); clips.push(clip);
  }
  const content = { version: 1, rig_signature: target.rig_signature, bone_names: retarget.boneNames, clips };
  const library = { ...content, sha256: sha(JSON.stringify(content)) };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(library) + '\n');
  const provenance = { license: 'CC0-1.0', author: 'Quaternius', source_url: 'https://quaternius.itch.io/universal-animation-library', source_file: 'Universal Animation Library[Standard].zip / Unreal-Godot/UAL1_Standard.glb',
    source_glb_sha256: sha(bytes), target_rig_sha256: sha(targetBytes), rig_signature: target.rig_signature, library_sha256: library.sha256,
    converter: 'scripts/human_pose/build_motion_library.mjs', encoding: '30 fps; little-endian Int16 quaternion / 32767, Float32 root xyz, Int16 footBall degrees / 100; slerp between frames',
    root_motion: 'disabled source variant; pelvis motion retained; constant clip floor offset from packed runtime interpolation sampled at 240 fps with 0.5 mm margin (swim: centre Y=0.7 m)', excluded: ['Sitting_Talking_Loop'], clips: clips.map(({ data, ...clip }) => clip) };
  await writeFile(resolve(dirname(output), 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  console.log(`${clips.length} clips, ${retarget.boneNames.length} bones, ${(await readFile(output)).length} bytes; ${library.sha256}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildLibrary(process.argv[2] ?? '.human_pose/motions/quaternius/ual1-UAL1_Standard.glb', process.argv[3] ?? '.human_pose/models/human_base.rig.json', process.argv[4] ?? 'src/assets/human-pose-motions/quaternius-standard.json');
}
