export const SOURCE_COVERAGE_SCHEMA_NAME = 'nyamuru-source-coverage';

export const SOURCE_COVERAGE_SCHEMA_VERSION = 1;

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

export const MAX_SOURCE_LINES = 50_000;

export const MAX_SOURCE_UNITS = 10_000;

export const MAX_TARGET_UNITS = 50_000;

export const MAX_PROJECTION_BYTES = 5 * 1024 * 1024;

export const MAX_CANDIDATES_PER_UNIT = 32;

export const MAX_REPORT_BYTES = 8 * 1024 * 1024;

export const MAX_ADJACENT_BUBBLES = 4;

export const MAX_SUBSTRING_COMPARISONS = 10_000_000;

export const MIN_SUBSTRING_CODEPOINTS = 12;

const MAX_SOURCE_UNIT_CODEPOINTS = 2_000;

export const MAX_TARGET_VALUE_CODEPOINTS = 5_000;

export type SourceCoverageStatus = 'confirmed' | 'ambiguous' | 'unverified' | 'excluded';

export type SourceCoverageLayer = 'context_retained' | 'storyboard_evidenced';

export type SourceCoverageDecisionValue = 'covered' | 'not_covered' | 'not_applicable';

export interface SourceCoverageSource {
  fileName: string;
  relativePath: string | null;
  text: string;
}

export interface SourceCoverageDecision {
  source_unit_id: string;
  decision: SourceCoverageDecisionValue;
  note: string;
  source_revision_sha256: string;
  projection_sha256: string;
}

export interface SourceCoverageTarget {
  target_id: string;
  layer: SourceCoverageLayer;
  kind: string;
  locator: string;
  value: string;
  match_key: string;
  speaker_keys: string[];
}

export interface SourceCoverageUnit {
  source_unit_id: string;
  kind: 'content' | 'excluded';
  start_line: number;
  end_line: number;
  excerpt: string;
  match_text: string;
  match_key: string;
  speaker_hint: string | null;
  status: SourceCoverageStatus;
  context_retained: boolean;
  candidate_target_ids: string[];
  candidate_total: number;
}

export interface SourceCoverageReport {
  schema_name: typeof SOURCE_COVERAGE_SCHEMA_NAME;
  schema_version: typeof SOURCE_COVERAGE_SCHEMA_VERSION;
  kind: 'source_coverage_report';
  episode: {
    series_id: string;
    episode_id: string;
    title: string;
    episode_number: string;
  };
  source: {
    file_name: string;
    relative_path: string | null;
    byte_size: number;
    line_count: number;
    source_text_sha256: string;
    source_revision_sha256: string;
  };
  omny: {
    omny_revision_sha256: string;
    projection_sha256: string;
  };
  analysis_sha256: string;
  scan_complete: true;
  verdict: 'no_review_required' | 'review_required' | 'reviewed_with_gaps';
  summary: {
    source_units: number;
    confirmed: number;
    ambiguous: number;
    unverified: number;
    excluded: number;
    context_only: number;
    current_decisions: number;
    stale_decisions: number;
    unresolved_after_review: number;
  };
  warnings: string[];
  source_units: SourceCoverageUnit[];
  targets: SourceCoverageTarget[];
  human_decisions: Array<SourceCoverageDecision & { stale: boolean }>;
}

export interface TargetDraft {
  layer: SourceCoverageLayer;
  kind: string;
  locator: string;
  value: string;
  matchKey: string;
  speakerKeys: string[];
}

export interface ExtractedSourceUnit {
  kind: 'content' | 'excluded';
  line: number;
  excerpt: string;
  matchText: string;
  matchKey: string;
  speakerHint: string | null;
}

export function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function assertValidUnicode(value: string, label: string): void {
  if (value.includes('\0')) throw new Error(`${label}\u306bNUL\u6587\u5b57\u304c\u542b\u307e\u308c\u3066\u3044\u307e\u3059`);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) throw new Error(`${label}\u306b\u4e0d\u6b63\u306aUnicode surrogate\u304c\u542b\u307e\u308c\u3066\u3044\u307e\u3059`);
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      throw new Error(`${label}\u306b\u4e0d\u6b63\u306aUnicode surrogate\u304c\u542b\u307e\u308c\u3066\u3044\u307e\u3059`);
    }
  }
}

export function canonicalizeSourceText(source: string): string {
  if (typeof source !== 'string') throw new Error('\u539f\u4f5c\u30fb\u53f0\u672c\u306f\u6587\u5b57\u5217\u3067\u6307\u5b9a\u3057\u3066\u304f\u3060\u3055\u3044');
  assertValidUnicode(source, '\u539f\u4f5c\u30fb\u53f0\u672c');
  const normalized = (source.startsWith('\uFEFF') ? source.slice(1) : source).replace(/\r\n?/gu, '\n');
  if (utf8Bytes(normalized).byteLength > MAX_SOURCE_BYTES) throw new Error('\u539f\u4f5c\u30fb\u53f0\u672c\u304c5MiB\u3092\u8d85\u3048\u3066\u3044\u307e\u3059');
  const lineCount = normalized.split('\n').length;
  if (lineCount > MAX_SOURCE_LINES) throw new Error(`\u539f\u4f5c\u30fb\u53f0\u672c\u304c${MAX_SOURCE_LINES.toLocaleString()}\u884c\u3092\u8d85\u3048\u3066\u3044\u307e\u3059`);
  return normalized;
}

export function coverageMatchKey(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ja-JP');
}

function stripMarkdownOuter(value: string): string {
  let result = value.trim();
  result = result.replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d{1,6}[.)]\s+)/u, '');
  result = result.replace(/^\s*\[(?: |x|X)\]\s*/u, '');
  for (let count = 0; count < 2; count += 1) {
    const stripped = result.replace(/^(?:\*\*|__|~~|`)([\s\S]*?)(?:\*\*|__|~~|`)$/u, '$1').trim();
    if (stripped === result) break;
    result = stripped;
  }
  return result;
}

const KNOWN_LABEL = /^(?:\u4f5c\u54c1\u540d|\u30bf\u30a4\u30c8\u30eb|\u30b7\u30ea\u30fc\u30ba(?:\u540d)?|\u30b5\u30d6\u30bf\u30a4\u30c8\u30eb|\u8a71\u6570|\u5834\u6240|\u6642\u9593\u5e2f?|\u5929\u5019|\u5929\u6c17|\u3042\u3089\u3059\u3058|\u6982\u8981|\u80cc\u666f|\u30c8\u66f8\u304d|action|background|synopsis|episode|title)\s*[:\uff1a]\s*/iu;

function sourceMatchParts(raw: string): { matchText: string; speakerHint: string | null } {
  const visible = stripMarkdownOuter(raw);
  const known = visible.match(KNOWN_LABEL);
  if (known) return { matchText: visible.slice(known[0].length).trim(), speakerHint: null };
  const speaker = visible.match(/^([^:\uff1a\n]{1,40})\s*[:\uff1a]\s*(.+)$/u);
  if (speaker && !/^https?$/iu.test(speaker[1].trim())) {
    return { matchText: speaker[2].trim(), speakerHint: coverageMatchKey(speaker[1]) || null };
  }
  return { matchText: visible, speakerHint: null };
}

export function extractSourceUnits(source: string): ExtractedSourceUnit[] {
  const canonical = canonicalizeSourceText(source);
  const units: ExtractedSourceUnit[] = [];
  let fenced = false;
  canonical.split('\n').forEach((rawLine, index) => {
    const visible = rawLine.trim();
    if (!visible) return;
    const fenceMarker = /^\s{0,3}(?:`{3,}|~{3,})/u.test(rawLine);
    const separator = /^\s{0,3}(?:(?:[-*_]\s*){3,}|\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?)\s*$/u.test(rawLine);
    const excluded = fenced || fenceMarker || separator;
    const parts = sourceMatchParts(rawLine);
    if (codePointLength(rawLine) > MAX_SOURCE_UNIT_CODEPOINTS
      || codePointLength(parts.matchText) > MAX_SOURCE_UNIT_CODEPOINTS) {
      throw new Error(`原作・台本の${index + 1}行目が${MAX_SOURCE_UNIT_CODEPOINTS.toLocaleString()}文字を超えています`);
    }
    units.push({
      kind: excluded ? 'excluded' : 'content',
      line: index + 1,
      excerpt: rawLine,
      matchText: parts.matchText,
      matchKey: excluded ? '' : coverageMatchKey(parts.matchText),
      speakerHint: excluded ? null : parts.speakerHint,
    });
    if (fenceMarker) fenced = !fenced;
  });
  if (units.length > MAX_SOURCE_UNITS) throw new Error(`\u76e3\u67fb\u5bfe\u8c61\u306e\u975e\u7a7a\u884c\u304c${MAX_SOURCE_UNITS.toLocaleString()}\u4ef6\u3092\u8d85\u3048\u3066\u3044\u307e\u3059`);
  if (!units.some((unit) => unit.kind === 'content')) throw new Error('原作・台本に監査できる本文行がありません');
  return units;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? utf8Bytes(value) : value;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((entry) => entry.toString(16).padStart(2, '0')).join('');
}

export function codePointLength(value: string): number {
  return [...value].length;
}
