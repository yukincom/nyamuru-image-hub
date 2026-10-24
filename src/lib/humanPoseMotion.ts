import { Quaternion } from 'three';
import { humanPoseJoint, validateHumanPoseJointEdits } from './humanPoseJoints.ts';
import type { HumanPoseData, HumanPoseJointEdits, HumanPoseRig, HumanPoseSceneSettings } from './humanPoseTypes.ts';

export interface HumanPoseMotionClip {
  id: string; label_ja: string; group: string; source_name: string; duration: number; loop: boolean; frames: number; data: string;
}
export interface HumanPoseMotionLibrary {
  version: 1; sha256: string; rig_signature: string; bone_names: string[]; clips: HumanPoseMotionClip[];
}
export type HumanPoseMotionSelection = { version: 1; library_sha256: string; clip_id: string; phase: number };
const decoded = new WeakMap<HumanPoseMotionClip, DataView>();

export function validateHumanPoseMotion(value: unknown): asserts value is HumanPoseMotionSelection {
  const m = value as HumanPoseMotionSelection;
  if (!m || typeof m !== 'object' || m.version !== 1 || typeof m.library_sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(m.library_sha256)
    || typeof m.clip_id !== 'string' || !/^ual1-[a-z0-9-]{1,80}$/u.test(m.clip_id)
    || !Number.isFinite(m.phase) || m.phase < 0 || m.phase > 1) throw new Error('モーションの保存値が不正です');
}
export function motionClip(library: HumanPoseMotionLibrary, selection: HumanPoseMotionSelection): HumanPoseMotionClip {
  validateHumanPoseMotion(selection);
  if (selection.library_sha256 !== library.sha256) throw new Error('保存したモーションと素材の版が異なります');
  const clip = library.clips.find(item => item.id === selection.clip_id);
  if (!clip) throw new Error('保存したモーションが見つかりません');
  return clip;
}
export function sampleHumanPoseMotion(library: HumanPoseMotionLibrary, rig: HumanPoseRig, template: HumanPoseData, selection: HumanPoseMotionSelection): HumanPoseData {
  if (library.version !== 1 || library.rig_signature !== rig.rig_signature) throw new Error('モーションと人体の骨格が一致しません');
  const clip = motionClip(library, selection), stride = library.bone_names.length * 8 + 16;
  let view = decoded.get(clip);
  if (!view) {
    const bytes = Uint8Array.from(atob(clip.data), char => char.charCodeAt(0));
    if (!Number.isInteger(clip.frames) || clip.frames < 2 || clip.frames > 10000 || bytes.length !== stride * clip.frames
      || !Number.isFinite(clip.duration) || clip.duration <= 0) throw new Error('モーションのデータが不正です');
    view = new DataView(bytes.buffer); decoded.set(clip, view);
  }
  const t = selection.phase * (clip.frames - 1), a = Math.floor(t), b = Math.min(clip.frames - 1, a + 1), f = t - a;
  const pose = structuredClone(template);
  pose.bones = Object.fromEntries(rig.bones.map(bone => [bone.name, { ...structuredClone(bone.rest), scale: [1, 1, 1] }]));
  pose.root = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }; pose.supports = []; pose.contacts = {};
  let offset = 0;
  const quaternion = (frame: number) => new Quaternion(...[0, 2, 4, 6].map(i => view!.getInt16(frame * stride + offset + i, true) / 32767)).normalize();
  for (const name of library.bone_names) {
    if (!pose.bones[name]) throw new Error(`モーションの関節がありません: ${name}`);
    pose.bones[name].rotation = quaternion(a).slerp(quaternion(b), f).toArray(); offset += 8;
  }
  const interpolate = (float: boolean) => {
    const read = (frame: number) => float ? view!.getFloat32(frame * stride + offset, true) : view!.getInt16(frame * stride + offset, true) / 100;
    const v = read(a) * (1 - f) + read(b) * f; offset += float ? 4 : 2; return v;
  };
  pose.root.translation = [interpolate(true), interpolate(true), interpolate(true)];
  pose.foot_bends = { L: [0, interpolate(false)], R: [0, interpolate(false)] };
  return pose;
}

/** Keep the user's local rotation offsets when moving to another point of the same clip. */
export function rebaseHumanPoseMotionEdits(edits: HumanPoseJointEdits | undefined, before: HumanPoseData, after: HumanPoseData): HumanPoseJointEdits | undefined {
  if (!edits) return undefined;
  validateHumanPoseJointEdits(edits);
  const next = structuredClone(edits);
  for (const [name, q] of Object.entries(edits.rotations)) {
    const delta = new Quaternion(...before.bones[name].rotation).invert().multiply(new Quaternion(...q));
    next.rotations[name] = new Quaternion(...after.bones[name].rotation).multiply(delta).normalize().toArray();
  }
  if (next.foot_bends) for (const side of ['L', 'R'] as const) {
    const values = next.foot_bends[side]; if (!values) continue;
    const offsets = edits.motion_foot_offsets?.[side] ?? values.map((v, i) => v - (before.foot_bends?.[side]?.[i] ?? 0)) as [number, number];
    next.motion_foot_offsets ??= {}; next.motion_foot_offsets[side] = [...offsets];
    for (const i of [0, 1]) {
      const limits = humanPoseJoint(`${i ? 'footBall' : 'footArch'}.${side}`)!.limits[0];
      values[i] = Math.max(limits[0], Math.min(limits[1], offsets[i] + (after.foot_bends?.[side]?.[i] ?? 0)));
    }
  }
  validateHumanPoseJointEdits(next); return next;
}
export function changeHumanPoseMotion(library: HumanPoseMotionLibrary, rig: HumanPoseRig, template: HumanPoseData, scene: HumanPoseSceneSettings, clipId: string, phase: number): HumanPoseSceneSettings {
  const next = structuredClone(scene);
  if (!clipId) { delete next.motion; delete next.joint_edits; return next; }
  const selection: HumanPoseMotionSelection = { version: 1, library_sha256: library.sha256, clip_id: clipId, phase };
  const after = sampleHumanPoseMotion(library, rig, template, selection);
  next.joint_edits = scene.motion?.clip_id === clipId
    ? rebaseHumanPoseMotionEdits(scene.joint_edits, sampleHumanPoseMotion(library, rig, template, scene.motion), after) : undefined;
  next.motion = selection; return next;
}
