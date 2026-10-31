import type { HumanPoseCameraPrompt, HumanPoseCameraSubject, HumanPoseData, HumanPoseRig, HumanPoseSceneSettings, PoseVector } from './humanPoseTypes.ts';
import type { BackgroundCapture } from '../types.ts';
import { CUBE_STAGE_ID, defaultBackgroundCapture, validateBackgroundCapture } from './background3d.ts';
import { validateHumanPoseMotion } from './humanPoseMotion.ts';
import { validateHumanPoseJointEdits } from './humanPoseJoints.ts';
import { humanPoseBodyFacing, validateHumanPoseSurface, wrapHumanPoseDegrees } from './humanPoseSurfacePlacement.ts';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const vector = (value: unknown, length = 3, limit = 10_000): value is number[] => Array.isArray(value) && value.length === length && value.every(v => finite(v, -limit, limit));
const hashes = ['base_sha256', 'rig_sha256', 'pose_sha256', 'rig_signature'] as const;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

export function validateHumanPoseScene(value: unknown): asserts value is HumanPoseSceneSettings {
  if (!object(value) || value.version !== 1 || !object(value.source) || !object(value.placement)
    || !object(value.camera) || !object(value.frame)) throw new Error('人体ポーズの配置・撮影設定が不正です');
  const { source, placement, camera, frame } = value;
  if (!hashes.every(key => hash(source[key])) || !Number.isSafeInteger(source.pose_revision) || Number(source.pose_revision) < 1
    || (value.body_mirror !== undefined && value.body_mirror !== 'original' && value.body_mirror !== 'mirrored')
    || (value.body_model !== undefined && value.body_model !== 'bodychan-female')
    || (value.stature_m !== undefined && !finite(value.stature_m, .3, 3))
    || !vector(placement.position) || !finite(placement.yaw_degrees, -180, 180)
    || (placement.scale !== undefined && !finite(placement.scale, .001, 1000))
    || (value.show_supports !== undefined && typeof value.show_supports !== 'boolean')
    || !vector(camera.position) || !vector(camera.target) || !finite(camera.fov, 10, 100)
    || (camera.shift !== undefined && !vector(camera.shift, 2, 2))
    || value.projection !== 'perspective' || !vector(value.up) || value.up.some((v, i) => v !== [0, 1, 0][i])
    || !Number.isInteger(frame.width) || !Number.isInteger(frame.height)
    || !finite(frame.width, 128, 2048) || !finite(frame.height, 128, 2048)) {
    throw new Error('人体ポーズの配置・撮影設定が不正です');
  }
  if (value.motion !== undefined) validateHumanPoseMotion(value.motion);
  if (value.framing !== undefined) {
    const framing = value.framing;
    if (!object(framing) || typeof framing.size !== 'string' || !['long', 'full', 'knee-up', 'waist-up', 'bust-up', 'shoulder-up', 'face', 'face-detail', 'hand', 'foot', 'part'].includes(framing.size)
      || !object(framing.crop) || !finite(framing.crop.x, -100, 100) || !finite(framing.crop.y, -100, 100)
      || !finite(framing.crop.w, .0001, 100) || !finite(framing.crop.h, .0001, 100)
      || Math.abs(framing.crop.w / framing.crop.h - 1) > .00001) throw new Error('人体ポーズの切り取り範囲が不正です');
  }
  if (value.joint_edits !== undefined) validateHumanPoseJointEdits(value.joint_edits);
  const target = camera.target;
  const distance = Math.hypot(...camera.position.map((v, i) => v - target[i]));
  if (distance < .01 || distance > 10_000) throw new Error('撮影カメラの距離が不正です');
  if (value.background !== undefined) {
    const background = value.background;
    if (!object(background) || typeof background.sourceId !== 'string'
      || (background.sourceId !== CUBE_STAGE_ID && !/^stage-[a-f0-9]{64}$/u.test(background.sourceId))) throw new Error('人体ポーズの背景指定が不正です');
    validateBackgroundCapture({ ...defaultBackgroundCapture({ x: 0, y: 0, w: 1, h: 1 }),
      sourceId: background.sourceId, cutaway: background.cutaway as BackgroundCapture['cutaway'], objectVisibility: background.objectVisibility as BackgroundCapture['objectVisibility'] });
    if (background.surface !== undefined) validateHumanPoseSurface(background.surface);
  }
}

/** 背景の保存カメラを明示的に取り込む。背景と人物を1つのcamera/frameで描く。 */
export function useHumanPoseBackgroundCamera(scene: HumanPoseSceneSettings, capture: BackgroundCapture): HumanPoseSceneSettings {
  validateBackgroundCapture(capture);
  if (scene.background?.sourceId !== capture.sourceId) throw new Error('選択中の舞台と背景カメラの舞台が異なります');
  const next = { ...structuredClone(scene), framing: undefined, camera: structuredClone(capture.camera), frame: humanPoseSceneFrame(capture.frame.w / capture.frame.h),
    background: { ...structuredClone(scene.background), sourceId: capture.sourceId, cutaway: structuredClone(capture.cutaway), objectVisibility: structuredClone(capture.objectVisibility) } };
  validateHumanPoseScene(next);
  return next;
}

export function humanPoseSceneFrame(aspect = 1): HumanPoseSceneSettings['frame'] {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? Math.min(8, Math.max(.125, aspect)) : 1;
  return ratio >= 1 ? { width: 1024, height: Math.max(128, Math.round(1024 / ratio)) }
    : { width: Math.max(128, Math.round(1024 * ratio)), height: 1024 };
}

export function sameHumanPoseSource(a: HumanPoseSceneSettings['source'], b: HumanPoseSceneSettings['source']): boolean {
  return hashes.every(key => a[key] === b[key]) && a.pose_revision === b.pose_revision;
}

/** An explicit preset change keeps staging and camera, and starts from the new registered body pose. */
export function humanPoseSceneForPreset(scene: HumanPoseSceneSettings, source: HumanPoseSceneSettings['source']): HumanPoseSceneSettings {
  const next = structuredClone(scene);
  next.source = { ...source };
  delete next.joint_edits;
  delete next.motion;
  return next;
}

/** Y-up、現在姿勢の骨盤正面を基準にする。顔/目線や動作を推測しない。 */
export function humanPoseCameraFacing(rig: HumanPoseRig, pose: HumanPoseData, placementYaw: number): number | null {
  const local = humanPoseBodyFacing(rig, pose, true);
  return local === undefined ? null : wrapHumanPoseDegrees(local + placementYaw);
}

export function humanPoseCameraParts(scene: HumanPoseSceneSettings, subject: HumanPoseCameraSubject) {
  validateHumanPoseScene(scene);
  validateCameraSubject(subject);
  const [x, y, z] = scene.camera.position.map((v, i) => v - subject.centre[i]);
  const horizontal = Math.hypot(x, z), distance = Math.hypot(x, y, z);
  const yaw = (subject.world_facing_degrees ?? 0) * Math.PI / 180;
  const azimuth = subject.world_facing_degrees === null || horizontal < 1e-6 * Math.max(1, distance) ? null
    : Math.atan2(x * Math.cos(yaw) - z * Math.sin(yaw), x * Math.sin(yaw) + z * Math.cos(yaw)) * 180 / Math.PI;
  const elevation = distance < 1e-6 ? null : Math.atan2(y, horizontal) * 180 / Math.PI;
  const angle = azimuth ?? 0;
  const absolute = Math.abs(angle), sideJa = angle >= 0 ? '人物の左' : '人物の右', sideEn = angle >= 0 ? "subject's left" : "subject's right";
  const direction = absolute < 22.5 ? ['正面', 'front view']
    : absolute < 67.5 ? [`${sideJa}斜め前`, `front three-quarter view from the ${sideEn}`]
    : absolute < 112.5 ? [`${sideJa}側面`, `side view from the ${sideEn}`]
    : absolute < 157.5 ? [`${sideJa}斜め後ろ`, `rear three-quarter view from the ${sideEn}`] : ['背面', 'rear view'];
  const height = elevation === null ? null : elevation >= 15 ? ['俯瞰', 'high angle'] : elevation <= -15 ? ['あおり', 'low angle'] : ['水平に近い角度', 'near-level angle'];
  const lens = scene.camera.fov >= 60 ? ['広角', 'wide-angle perspective'] : scene.camera.fov <= 30 ? ['望遠寄り', 'narrow-angle perspective'] : ['標準', 'standard perspective'];
  const angleJa = [azimuth === null ? null : direction[0], height?.[0]].filter(Boolean).join('・');
  const angleEn = [azimuth === null ? null : direction[1], height?.[1]].filter(Boolean).join(', ');
  return { azimuth, elevation, angle: { ja: angleJa, en: angleEn },
    lens: { ja: `${lens[0]}（垂直画角${scene.camera.fov}°）`, en: `${lens[1]} (vertical field of view ${scene.camera.fov} degrees)` } };
}

// 既存呼出しは素材正面を基準に維持。描画中のUIは実測したsubjectを渡す。
export function describeHumanPoseCamera(scene: HumanPoseSceneSettings, centre: PoseVector, worldFacing = scene.placement.yaw_degrees): { ja: string; en: string } {
  const parts = humanPoseCameraParts(scene, { centre, world_facing_degrees: worldFacing });
  return { ja: [parts.angle.ja, parts.lens.ja].filter(Boolean).join('・'), en: [parts.angle.en, parts.lens.en].filter(Boolean).join(', ') + '.' };
}

function validateCameraSubject(value: unknown): asserts value is HumanPoseCameraSubject {
  if (!object(value) || !vector(value.centre, 3, 1e8)
    || (value.world_facing_degrees !== null && !finite(value.world_facing_degrees, -180, 180))) throw new Error('撮影説明の身体基準が不正です');
}

export function validateHumanPoseCameraPrompt(value: unknown): asserts value is HumanPoseCameraPrompt {
  if (!object(value) || value.version !== 1 || !object(value.overrides) || typeof value.review_required !== 'boolean') throw new Error('撮影説明の保存値が不正です');
  validateHumanPoseScene(value.scene); validateCameraSubject(value.subject);
  for (const [key, entry] of Object.entries(value.overrides)) {
    if (!['angle_ja', 'lens_ja'].includes(key) || typeof entry !== 'string' || entry.length > 2000) throw new Error('撮影説明の修正値が不正です');
  }
}

function cameraPromptScene(scene: HumanPoseSceneSettings): HumanPoseSceneSettings {
  const copy = structuredClone(scene); delete copy.background; delete copy.show_supports; return copy;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function humanPoseCameraPromptCurrent(prompt: HumanPoseCameraPrompt, scene?: HumanPoseSceneSettings): boolean {
  return Boolean(scene && stable(cameraPromptScene(prompt.scene)) === stable(cameraPromptScene(scene)));
}

export function confirmHumanPoseCameraPrompt(scene: HumanPoseSceneSettings, subject: HumanPoseCameraSubject, previous?: HumanPoseCameraPrompt): HumanPoseCameraPrompt {
  validateHumanPoseScene(scene); validateCameraSubject(subject);
  if (previous) validateHumanPoseCameraPrompt(previous);
  const changed = previous && (!humanPoseCameraPromptCurrent(previous, scene) || stable(previous.subject) !== stable(subject));
  return { version: 1, scene: cameraPromptScene(scene), subject: structuredClone(subject), overrides: structuredClone(previous?.overrides ?? {}),
    review_required: Boolean(previous && Object.keys(previous.overrides).length && (previous.review_required || changed)) };
}

export function humanPoseCameraPromptText(prompt: HumanPoseCameraPrompt) {
  validateHumanPoseCameraPrompt(prompt);
  const automatic = humanPoseCameraParts(prompt.scene, prompt.subject);
  const angle = prompt.overrides.angle_ja ?? automatic.angle.ja, lens = prompt.overrides.lens_ja ?? automatic.lens.ja;
  const edited = angle !== automatic.angle.ja || lens !== automatic.lens.ja;
  return { automatic, edited, ja: [angle.trim(), lens.trim()].filter(Boolean).join('・'),
    en: edited ? null : [automatic.angle.en, automatic.lens.en].filter(Boolean).join(', ') + '.' };
}
