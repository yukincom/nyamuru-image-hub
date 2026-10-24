import type { HumanPoseMotionSelection } from './humanPoseMotion.ts';
import type { BackgroundCapture, CharacterGender } from '../types.ts';

// ポーズ素材と検索・生成で共有する値。
export type HumanPoseInputMode = 'prompt' | 'image';
export type HumanPoseGender = CharacterGender;

export interface HumanPoseTag {
  id: string;
  label_ja: string;
  aliases: string[];
}

export interface HumanPoseSearchEntry {
  id: string;
  category: string;
  label_ja: string;
  label_en: string;
  tags: string[];
  search_aliases: string[];
  pose_normalized_text: string;
}

export interface HumanPoseSegment {
  id: string;
  text_ja: string;
  template_en: string;
}

// 文の編集値は画像モードでも保持し、送信対象と分ける。
export interface HumanPoseTextSelection {
  pose_id: string;
  catalog_sha256: string;
  label_ja: string;
  display_number?: number;
  template_revision: number;
  input_mode: HumanPoseInputMode;
  baseline_segments: HumanPoseSegment[];
  edited_text_ja: string;
  scene?: HumanPoseSceneSettings;
  camera_prompt?: HumanPoseCameraPrompt;
}

export interface HumanPoseCameraSubject {
  centre: PoseVector;
  world_facing_degrees: number | null;
}
// 確定時の記録。手修正文を自動文や現在のsceneと分けて保持する。
export interface HumanPoseCameraPrompt {
  version: 1;
  scene: HumanPoseSceneSettings;
  subject: HumanPoseCameraSubject;
  overrides: { angle_ja?: string; lens_ja?: string };
  review_required: boolean;
}

// 作品内の配置と撮影設定。素材のbone transform・一覧画像とは独立に保存する。
export type HumanPoseBodyMirror = 'original' | 'mirrored';
export interface HumanPoseJointEdits {
  version: 1;
  rotations: Record<string, PoseQuaternion>;
  root_offset?: PoseVector;
  foot_bends?: Partial<Record<'L' | 'R', [number, number]>>;
  motion_foot_offsets?: Partial<Record<'L' | 'R', [number, number]>>;
}
export type HumanPoseSurfaceAnchor = 'feet' | 'left_foot' | 'right_foot' | 'hips';
export interface HumanPoseSurfacePlacement {
  version: 1;
  point: PoseVector;
  normal: PoseVector;
  surfaceMesh: number;
  anchor: HumanPoseSurfaceAnchor;
  height_offset: number;
  facing_degrees?: number;
}
export interface HumanPoseSceneSettings {
  version: 1;
  source: { base_sha256: string; rig_sha256: string; pose_sha256: string; rig_signature: string; pose_revision: number };
  body_mirror?: HumanPoseBodyMirror;
  joint_edits?: HumanPoseJointEdits;
  motion?: HumanPoseMotionSelection;
  stature_m?: number;
  placement: { position: PoseVector; yaw_degrees: number; scale?: number };
  background?: Pick<BackgroundCapture, 'sourceId' | 'cutaway' | 'objectVisibility'> & { surface?: HumanPoseSurfacePlacement };
  show_supports?: boolean;
  camera: BackgroundCapture['camera'];
  projection: 'perspective';
  up: [0, 1, 0];
  frame: { width: number; height: number };
}
export interface HumanPoseSceneAssets {
  catalog_sha256: string;
  base?: ArrayBuffer;
  rig: HumanPoseRig;
  pose: HumanPoseData;
  source: HumanPoseSceneSettings['source'];
}

// 一覧の情報と表示用URLは、人物に保存する選択値から分ける。
export interface HumanPoseCatalogEntry extends HumanPoseSearchEntry {
  display_number?: number;
  template_revision: number;
  pose_text_ja: string;
  pose_template: string;
  prompt_segments: HumanPoseSegment[];
  production_status: 'unmade' | 'in_progress' | 'ready';
  review: { status: string; user_confirmed: boolean };
  asset_files: { preview?: { path: string; sha256: string; byte_size: number } };
  prompt_validation?: { status: string; note: string };
}
export interface HumanPoseCatalog {
  catalog_sha256: string;
  tags: HumanPoseTag[];
  poses: HumanPoseCatalogEntry[];
  previews: Record<string, string>;
}

// 反転も正scaleの骨transformで表し、顔の向きは別に保持する。
export type PoseVector = [number, number, number];
export type PoseQuaternion = [number, number, number, number];
export interface HumanPoseTransform { translation: PoseVector; rotation: PoseQuaternion; scale: PoseVector }
export interface HumanPoseRig {
  rig_signature: string;
  base_glb_sha256: string;
  placement_root: string;
  bones: { name: string; parent: string | null; rest: HumanPoseTransform }[];
}
export interface HumanPoseCamera {
  projection: 'orthographic'; position: PoseVector; target: PoseVector; up: PoseVector;
  orthographic_scale: number; aspect: number;
}
export type HumanPoseSupport = { id: string; position: PoseVector } &
  ({ kind: 'box'; size: PoseVector } | { kind: 'cylinder'; radius: number; height: number });
export interface HumanPoseData {
  foot_bends?: HumanPoseJointEdits['foot_bends'];
  schema_version: 1; pose_id: string; revision: number; rig_signature: string; base_glb_sha256: string;
  transform_space: 'absolute_parent_local'; user_confirmed: boolean;
  root: HumanPoseTransform; bones: Record<string, HumanPoseTransform>;
  supports: HumanPoseSupport[]; contacts: Record<string, unknown>;
  preview_camera: HumanPoseCamera; comparison_camera: HumanPoseCamera;
}
