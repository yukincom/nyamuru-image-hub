import { humanPoseWorldMatrices } from './humanPoseMirror.ts';
import type { HumanPoseData, HumanPoseRig, HumanPoseSceneAssets } from './humanPoseTypes.ts';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
async function decode(record: unknown, kind: string, poseId: string | null, digest: string, limit: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; sha256: string }> {
  if (!object(record) || record.kind !== kind || record.pose_id !== poseId || record.catalog_sha256 !== digest
    || record.usage !== 'pose_asset' || record.mime_type !== (kind === 'base' ? 'model/gltf-binary' : 'application/json')
    || !hash(record.sha256) || !Number.isSafeInteger(record.byte_size) || Number(record.byte_size) <= 0 || Number(record.byte_size) > limit
    || typeof record.data !== 'string' || record.data.length > Math.ceil(limit / 3) * 4) throw new Error('人体ポーズ素材の応答が不正です');
  const bytes = Uint8Array.from(atob(record.data), c => c.charCodeAt(0));
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (bytes.length !== record.byte_size || actual !== record.sha256) throw new Error('人体ポーズ素材のサイズまたはhashが一致しません');
  return { bytes, sha256: actual };
}

/** 同じcatalog snapshotを検証する。線骨格ではbody meshの転送・読込を省く。 */
export async function decodeHumanPoseScene(payload: unknown, poseId: string, digest: string): Promise<HumanPoseSceneAssets> {
  if (!object(payload) || payload.pose_id !== poseId || payload.catalog_sha256 !== digest || !hash(digest)) throw new Error('選択時と人体ポーズの版が一致しません');
  const skeleton = payload.representation === 'skeleton';
  if (skeleton && (!hash(payload.base_sha256) || payload.base !== undefined)) throw new Error('線骨格の素材識別子が不正です');
  const [base, rigFile, poseFile] = await Promise.all([
    skeleton ? null : decode(payload.base, 'base', null, digest, 64 * 1024 * 1024),
    decode(payload.rig, 'rig', null, digest, 16 * 1024 * 1024),
    decode(payload.pose, 'pose', poseId, digest, 16 * 1024 * 1024),
  ]);
  if (base) {
    const header = new DataView(base.bytes.buffer);
    if (base.bytes.length < 20 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2
      || header.getUint32(8, true) !== base.bytes.length) throw new Error('人体素体がGLB形式ではありません');
  }
  const baseHash = base?.sha256 ?? payload.base_sha256 as string;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const rig = JSON.parse(decoder.decode(rigFile.bytes)) as HumanPoseRig;
  const pose = JSON.parse(decoder.decode(poseFile.bytes)) as HumanPoseData;
  if (!rig || !pose || !hash(rig.rig_signature) || typeof rig.placement_root !== 'string' || !rig.placement_root
    || !Array.isArray(rig.bones) || rig.base_glb_sha256 !== baseHash || pose.base_glb_sha256 !== baseHash
    || pose.rig_signature !== rig.rig_signature || pose.schema_version !== 1 || pose.pose_id !== poseId
    || !Number.isSafeInteger(pose.revision) || pose.revision < 1 || pose.user_confirmed !== true
    || pose.transform_space !== 'absolute_parent_local' || !Array.isArray(pose.supports)) throw new Error('人体素体と姿勢の対応が不正です');
  humanPoseWorldMatrices(rig);
  humanPoseWorldMatrices(rig, pose);
  return { catalog_sha256: digest, ...(base ? { base: base.bytes.buffer } : {}), rig, pose,
    source: { base_sha256: baseHash, rig_sha256: rigFile.sha256, pose_sha256: poseFile.sha256,
      rig_signature: rig.rig_signature, pose_revision: pose.revision } };
}
