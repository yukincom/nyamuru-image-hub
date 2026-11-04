import type { VisualEvidence, CharacterRecognitionProfile, CharacterReferenceSourceImage } from '../../types';

const CHARACTER_RECOGNITION_FIELDS = ['hair', 'face', 'silhouette', 'outfit', 'accessories', 'ambiguous_design'] as const;

export const CHARACTER_REFERENCE_VIEW_VALUES = ['turnaround', 'front', 'three-quarter', 'side', 'back', 'expression', 'costume', 'other'] as const;

const CHARACTER_REFERENCE_ASSET_PATTERN = /^image-[a-f0-9]{64}$/u;

const CHARACTER_REFERENCE_PATH_PATTERN = /^characters\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/(image-[a-f0-9]{64})\.png$/u;

export function normalizedUniqueStrings(value: unknown, limit = 16): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const keys = new Set<string>();
  value.forEach((item) => {
    if (typeof item !== 'string' || result.length >= limit) return;
    const text = item.normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, 300);
    const key = text.toLocaleLowerCase('ja-JP');
    if (!text || keys.has(key)) return;
    keys.add(key);
    result.push(text);
  });
  return result;
}

function normalizedEvidence(value: unknown): VisualEvidence {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    observed: normalizedUniqueStrings(record.observed),
    inferred: normalizedUniqueStrings(record.inferred),
  };
}

export function normalizedRecognition(value: unknown): CharacterRecognitionProfile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const normalized = Object.fromEntries(
    CHARACTER_RECOGNITION_FIELDS.map((field) => [field, normalizedEvidence(record[field])]),
  ) as unknown as CharacterRecognitionProfile;
  const analyzer = record.analyzer && typeof record.analyzer === 'object' && !Array.isArray(record.analyzer)
    ? record.analyzer as Record<string, unknown>
    : null;
  if (analyzer?.provider === 'local' && analyzer.runtime === 'mlx-vlm') {
    normalized.analyzer = {
      provider: 'local',
      runtime: 'mlx-vlm',
      model: typeof analyzer.model === 'string' ? analyzer.model.slice(0, 300) : '',
      prompt_version: typeof analyzer.prompt_version === 'string' ? analyzer.prompt_version.slice(0, 100) : '',
      analyzed_at: typeof analyzer.analyzed_at === 'string' ? analyzer.analyzed_at.slice(0, 100) : '',
    };
  }
  return normalized;
}

export function normalizedCharacterSourceImage(value: unknown): CharacterReferenceSourceImage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const assetId = typeof record.asset_id === 'string' ? record.asset_id.trim() : '';
  const fileName = typeof record.file_name === 'string' ? record.file_name.trim() : '';
  const originalName = typeof record.original_name === 'string' ? record.original_name.trim().slice(0, 255) : '';
  const sha256 = typeof record.sha256 === 'string' ? record.sha256.trim() : '';
  const pathMatch = fileName.match(CHARACTER_REFERENCE_PATH_PATTERN);
  const byteSize = Number(record.byte_size);
  const width = Number(record.width_px);
  const height = Number(record.height_px);
  if (record.schema_version !== 1
    || record.media_type !== 'image/png'
    || !CHARACTER_REFERENCE_ASSET_PATTERN.test(assetId)
    || !/^[a-f0-9]{64}$/u.test(sha256)
    || assetId !== `image-${sha256}`
    || pathMatch?.[1] !== assetId
    || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > 40 * 1024 * 1024
    || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > 12000 || height > 12000 || width * height > 60_000_000) {
    return undefined;
  }
  return {
    schema_version: 1,
    asset_id: assetId,
    file_name: fileName,
    ...(originalName && !/[\\/]/u.test(originalName) ? { original_name: originalName } : {}),
    media_type: 'image/png',
    byte_size: byteSize,
    width_px: width,
    height_px: height,
    sha256,
  };
}
