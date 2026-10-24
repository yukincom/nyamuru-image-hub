import type { HumanPoseCatalogEntry, HumanPoseTag, HumanPoseTextSelection } from './humanPoseTypes.ts';
import { renderHumanPoseTemplate } from './humanPoseTemplate.ts';
import { humanPoseCameraPromptCurrent, validateHumanPoseCameraPrompt, validateHumanPoseScene } from './humanPoseScene.ts';

const POSE_ID = /^pose-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const HUMAN_POSE_SHA256 = /^[a-f0-9]{64}$/u;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// catalogが無くても編集文を残し、不正値を既定値へ丸めない。
export function validateHumanPoseSelection(value: unknown): asserts value is HumanPoseTextSelection {
  if (!object(value) || !text(value.pose_id) || !POSE_ID.test(value.pose_id)
    || !text(value.catalog_sha256) || !HUMAN_POSE_SHA256.test(value.catalog_sha256)
    || !text(value.label_ja) || !Number.isSafeInteger(value.template_revision) || Number(value.template_revision) < 1
    || typeof value.input_mode !== 'string' || !['prompt', 'image'].includes(value.input_mode)
    || typeof value.edited_text_ja !== 'string' || value.edited_text_ja.length > 20_000
    || (value.display_number !== undefined && (!Number.isSafeInteger(value.display_number) || Number(value.display_number) < 1))
    || !Array.isArray(value.baseline_segments) || !value.baseline_segments.length || value.baseline_segments.length > 100) {
    throw new Error('保存された人体ポーズの指定が不正です');
  }
  const ids = new Set<string>();
  for (const segment of value.baseline_segments) {
    if (!object(segment) || !text(segment.id) || ids.has(segment.id)
      || !text(segment.text_ja) || segment.text_ja.length > 20_000
      || !text(segment.template_en) || segment.template_en.length > 20_000) {
      throw new Error('人体ポーズの基準文が不正です');
    }
    renderHumanPoseTemplate(segment.template_en);
    ids.add(segment.id);
  }
  if (value.scene !== undefined) validateHumanPoseScene(value.scene);
  if (value.camera_prompt !== undefined) validateHumanPoseCameraPrompt(value.camera_prompt);
}

export function humanPoseSelectable(pose: HumanPoseCatalogEntry): boolean {
  return pose.production_status === 'ready' && pose.review.status === 'confirmed'
    && pose.review.user_confirmed && Boolean(pose.asset_files.preview);
}

// 確定時だけ基準文を複製し、検索や仮選択では人物を更新しない。
export function selectHumanPose(pose: HumanPoseCatalogEntry, digest: string): HumanPoseTextSelection {
  if (!humanPoseSelectable(pose)) throw new Error('このポーズはまだ選択できません');
  const selection: HumanPoseTextSelection = {
    pose_id: pose.id, catalog_sha256: digest, label_ja: pose.label_ja,
    ...(pose.display_number === undefined ? {} : { display_number: pose.display_number }),
    template_revision: pose.template_revision, input_mode: 'prompt',
    baseline_segments: structuredClone(pose.prompt_segments), edited_text_ja: pose.pose_text_ja,
  };
  validateHumanPoseSelection(selection);
  return selection;
}

// 保存内容を捨てず、未確定の撮影説明や画像を送信しない。
export function requireHumanPoseGenerationReady(value?: HumanPoseTextSelection): void {
  if (!value) return;
  validateHumanPoseSelection(value);
  if (value.input_mode === 'prompt' && !value.edited_text_ja.trim()) throw new Error('ポーズの説明を入力するか、撮影画像で送る方法を選んでください');
  if (value.input_mode === 'image' && !value.scene) throw new Error('3Dでポーズ・アングルを調整して確定してください');
  if (value.scene && (!value.camera_prompt || !humanPoseCameraPromptCurrent(value.camera_prompt, value.scene))) throw new Error('3D画面で撮影設定を確定し直してください。ポーズを解除する必要はありません');
  if (value.camera_prompt?.review_required) throw new Error('撮影設定の手修正文を確認してください');
}

// UIで使う配列と識別子は受信時にも確認する。
export function parseHumanPoseCatalog(payload: unknown): { catalog_sha256: string; tags: HumanPoseTag[]; poses: HumanPoseCatalogEntry[] } {
  if (!object(payload) || !text(payload.catalog_sha256) || !HUMAN_POSE_SHA256.test(payload.catalog_sha256)
    || !object(payload.catalog) || !Array.isArray(payload.catalog.poses) || !Array.isArray(payload.catalog.tags)
    || payload.catalog.poses.length > 200) throw new Error('人体ポーズ一覧の応答が不正です');
  const tags = payload.catalog.tags;
  if (!tags.every(tag => object(tag) && text(tag.id) && text(tag.label_ja)
    && Array.isArray(tag.aliases) && tag.aliases.every(text))) throw new Error('人体ポーズの検索語彙が不正です');
  const ids = new Set<string>();
  for (const pose of payload.catalog.poses) {
    if (!object(pose) || !text(pose.id) || !POSE_ID.test(pose.id) || ids.has(pose.id)
      || !['category', 'label_ja', 'label_en', 'pose_text_ja', 'pose_template', 'pose_normalized_text'].every(key => text(pose[key]))
      || !['tags', 'search_aliases'].every(key => Array.isArray(pose[key]) && (pose[key] as unknown[]).every(text))
      || !Array.isArray(pose.prompt_segments) || !object(pose.review) || typeof pose.review.user_confirmed !== 'boolean'
      || !text(pose.review.status) || typeof pose.production_status !== 'string'
      || !['unmade', 'in_progress', 'ready'].includes(pose.production_status)
      || !object(pose.asset_files)) throw new Error('人体ポーズの項目が不正です');
    validateHumanPoseSelection({ pose_id: pose.id, catalog_sha256: payload.catalog_sha256, label_ja: pose.label_ja,
      display_number: pose.display_number, template_revision: pose.template_revision, input_mode: 'prompt',
      baseline_segments: pose.prompt_segments, edited_text_ja: pose.pose_text_ja });
    if (pose.prompt_segments.map(s => s.text_ja).join('') !== pose.pose_text_ja
      || pose.prompt_segments.map(s => s.template_en).join(' ') !== pose.pose_template) throw new Error('人体ポーズの基準文が一致しません');
    const preview = pose.asset_files.preview;
    if (preview !== undefined && (!object(preview) || preview.path !== `poses/${pose.id}/preview.png`
      || !text(preview.sha256) || !HUMAN_POSE_SHA256.test(preview.sha256)
      || !Number.isSafeInteger(preview.byte_size) || Number(preview.byte_size) <= 0)) throw new Error('人体ポーズの一覧画像が不正です');
    if (pose.prompt_validation !== undefined && (!object(pose.prompt_validation)
      || !text(pose.prompt_validation.status) || !text(pose.prompt_validation.note))) throw new Error('ポーズ文の確認記録が不正です');
    ids.add(pose.id);
  }
  return { catalog_sha256: payload.catalog_sha256, tags: tags as HumanPoseTag[],
    poses: payload.catalog.poses as unknown as HumanPoseCatalogEntry[] };
}
