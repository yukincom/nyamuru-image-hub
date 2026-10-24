export const PRODUCTION_PACKAGE_SCHEMA_VERSION = 1 as const;
export const PRODUCTION_PACKAGE_PLAN_KIND = 'nyamuru-production-package-plan' as const;
export const PRODUCTION_PACKAGE_HASH_ALGORITHMS = ['sha256', 'sha512'] as const;
export const PRODUCTION_PACKAGE_MANAGED_DIRECTORIES = [
  'name_data',
  'draft_data',
  'manuscript_data',
] as const;

export type ProductionPackageManagedDirectory = typeof PRODUCTION_PACKAGE_MANAGED_DIRECTORIES[number];
export type ProductionPackageRole =
  | 'story_omny'
  | 'style_omay'
  | 'editable_psd'
  | 'reference_asset'
  | 'coverage_report'
  | 'workspace_payload';

export interface ProductionPackageCandidate {
  relativePath: string;
  role: ProductionPackageRole;
  mediaType: string;
  byteSize: number;
  sha256: string;
  sha512: string;
}

export interface ProductionPackagePlan {
  schemaVersion: typeof PRODUCTION_PACKAGE_SCHEMA_VERSION;
  kind: typeof PRODUCTION_PACKAGE_PLAN_KIND;
  bagitAvailable: boolean;
  algorithms: typeof PRODUCTION_PACKAGE_HASH_ALGORITHMS;
  managedDirectories: typeof PRODUCTION_PACKAGE_MANAGED_DIRECTORIES;
  missingDirectories: ProductionPackageManagedDirectory[];
  candidates: ProductionPackageCandidate[];
  planRevision: string;
}

/** Wire shape consumed by the isolated Python exporter. */
export interface ProductionPackageSelection {
  relative_path: string;
  sha256: string;
  sha512: string;
}

const ROLES = new Set<ProductionPackageRole>([
  'story_omny',
  'style_omay',
  'editable_psd',
  'reference_asset',
  'coverage_report',
  'workspace_payload',
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SHA512_PATTERN = /^[0-9a-f]{128}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const SURROGATE_PATTERN = /[\uD800-\uDFFF]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function packageTypeError(message: string): TypeError {
  return new TypeError(`production package plan: ${message}`);
}

export function isSafeProductionPackageRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')) return false;
  if (CONTROL_PATTERN.test(value) || SURROGATE_PATTERN.test(value)) return false;
  const parts = value.split('/');
  if (parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..')) return false;
  return PRODUCTION_PACKAGE_MANAGED_DIRECTORIES.includes(parts[0] as ProductionPackageManagedDirectory);
}

function compareUnicodeScalarValues(left: string, right: string): number {
  const leftValues = left[Symbol.iterator]();
  const rightValues = right[Symbol.iterator]();
  while (true) {
    const leftValue = leftValues.next();
    const rightValue = rightValues.next();
    if (leftValue.done || rightValue.done) {
      if (leftValue.done && rightValue.done) return 0;
      return leftValue.done ? -1 : 1;
    }
    const difference = leftValue.value.codePointAt(0)! - rightValue.value.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
}

function normalizedCandidate(value: unknown): ProductionPackageCandidate {
  if (!isRecord(value) || !hasExactKeys(value, [
    'relative_path',
    'role',
    'media_type',
    'byte_size',
    'sha256',
    'sha512',
  ])) {
    throw packageTypeError('candidate fieldsがv1 contractと一致しません');
  }
  if (!isSafeProductionPackageRelativePath(value.relative_path)) {
    throw packageTypeError('candidate.relative_pathが管理対象の安全な相対pathではありません');
  }
  if (typeof value.role !== 'string' || !ROLES.has(value.role as ProductionPackageRole)) {
    throw packageTypeError('candidate.roleが不正です');
  }
  if (typeof value.media_type !== 'string' || !value.media_type || value.media_type.length > 255) {
    throw packageTypeError('candidate.media_typeが不正です');
  }
  if (!Number.isSafeInteger(value.byte_size) || (value.byte_size as number) < 0) {
    throw packageTypeError('candidate.byte_sizeが0以上の安全な整数ではありません');
  }
  if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
    throw packageTypeError('candidate.sha256が不正です');
  }
  if (typeof value.sha512 !== 'string' || !SHA512_PATTERN.test(value.sha512)) {
    throw packageTypeError('candidate.sha512が不正です');
  }
  return {
    relativePath: value.relative_path,
    role: value.role as ProductionPackageRole,
    mediaType: value.media_type,
    byteSize: value.byte_size as number,
    sha256: value.sha256,
    sha512: value.sha512,
  };
}

/** Validate the complete Python plan response before any UI can select files. */
export function normalizeProductionPackagePlan(value: unknown): ProductionPackagePlan {
  const rootKeys = [
    'schema_version',
    'kind',
    'bagit_available',
    'algorithms',
    'managed_directories',
    'missing_directories',
    'candidates',
    'plan_revision',
  ] as const;
  if (!isRecord(value) || !hasExactKeys(value, rootKeys)) {
    throw packageTypeError('root fieldsがv1 contractと一致しません');
  }
  if (value.schema_version !== PRODUCTION_PACKAGE_SCHEMA_VERSION || value.kind !== PRODUCTION_PACKAGE_PLAN_KIND) {
    throw packageTypeError('schema_versionまたはkindが不正です');
  }
  if (typeof value.bagit_available !== 'boolean') {
    throw packageTypeError('bagit_availableがbooleanではありません');
  }
  if (!Array.isArray(value.algorithms)
    || value.algorithms.length !== PRODUCTION_PACKAGE_HASH_ALGORITHMS.length
    || value.algorithms.some((algorithm, index) => algorithm !== PRODUCTION_PACKAGE_HASH_ALGORITHMS[index])) {
    throw packageTypeError('algorithmsはsha256/sha512である必要があります');
  }
  if (!Array.isArray(value.managed_directories)
    || value.managed_directories.length !== PRODUCTION_PACKAGE_MANAGED_DIRECTORIES.length
    || value.managed_directories.some((directory, index) => directory !== PRODUCTION_PACKAGE_MANAGED_DIRECTORIES[index])) {
    throw packageTypeError('managed_directoriesが固定contractと一致しません');
  }
  if (!Array.isArray(value.missing_directories)) {
    throw packageTypeError('missing_directoriesが配列ではありません');
  }
  const missingDirectories: ProductionPackageManagedDirectory[] = [];
  const seenMissing = new Set<string>();
  for (const directory of value.missing_directories) {
    if (typeof directory !== 'string'
      || !PRODUCTION_PACKAGE_MANAGED_DIRECTORIES.includes(directory as ProductionPackageManagedDirectory)
      || seenMissing.has(directory)) {
      throw packageTypeError('missing_directoriesに未知または重複した値があります');
    }
    seenMissing.add(directory);
    missingDirectories.push(directory as ProductionPackageManagedDirectory);
  }
  if (!Array.isArray(value.candidates)) {
    throw packageTypeError('candidatesが配列ではありません');
  }
  const candidates = value.candidates.map(normalizedCandidate);
  const paths = candidates.map((candidate) => candidate.relativePath);
  if (new Set(paths).size !== paths.length) throw packageTypeError('candidate pathが重複しています');
  if (paths.some((path, index) => (
    index > 0 && compareUnicodeScalarValues(paths[index - 1]!, path) > 0
  ))) {
    throw packageTypeError('candidatesがrelative_path順ではありません');
  }
  if (typeof value.plan_revision !== 'string' || !SHA256_PATTERN.test(value.plan_revision)) {
    throw packageTypeError('plan_revisionがSHA-256ではありません');
  }

  return {
    schemaVersion: PRODUCTION_PACKAGE_SCHEMA_VERSION,
    kind: PRODUCTION_PACKAGE_PLAN_KIND,
    bagitAvailable: value.bagit_available,
    algorithms: PRODUCTION_PACKAGE_HASH_ALGORITHMS,
    managedDirectories: PRODUCTION_PACKAGE_MANAGED_DIRECTORIES,
    missingDirectories,
    candidates,
    planRevision: value.plan_revision,
  };
}

/** Build a hash-pinned selection in deterministic plan order. */
export function buildProductionPackageSelection(
  plan: ProductionPackagePlan,
  selectedRelativePaths: readonly string[],
): ProductionPackageSelection[] {
  const selected = new Set<string>();
  for (const relativePath of selectedRelativePaths) {
    if (!isSafeProductionPackageRelativePath(relativePath)) {
      throw packageTypeError(`選択pathが不正です: ${String(relativePath)}`);
    }
    if (selected.has(relativePath)) throw packageTypeError(`選択pathが重複しています: ${relativePath}`);
    selected.add(relativePath);
  }
  const candidates = new Map(plan.candidates.map((candidate) => [candidate.relativePath, candidate]));
  for (const relativePath of selected) {
    if (!candidates.has(relativePath)) throw packageTypeError(`planにないpathが選択されています: ${relativePath}`);
  }
  return plan.candidates.flatMap((candidate) => (
    selected.has(candidate.relativePath)
      ? [{
        relative_path: candidate.relativePath,
        sha256: candidate.sha256,
        sha512: candidate.sha512,
      }]
      : []
  ));
}
