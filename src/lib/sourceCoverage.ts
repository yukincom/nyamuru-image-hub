import { type ExtractedSourceUnit, type SourceCoverageTarget, MAX_CANDIDATES_PER_UNIT, codePointLength, MIN_SUBSTRING_CODEPOINTS, MAX_SUBSTRING_COMPARISONS, assertValidUnicode, utf8Bytes, type SourceCoverageDecision, type SourceCoverageSource, type SourceCoverageReport, canonicalizeSourceText, sha256Hex, stableJson, extractSourceUnits, type SourceCoverageUnit, type SourceCoverageStatus, SOURCE_COVERAGE_SCHEMA_NAME, SOURCE_COVERAGE_SCHEMA_VERSION, MAX_REPORT_BYTES, type SourceCoverageDecisionValue } from './coverage/sourceUnits.ts';
import type { MangaDocument } from '../types';
import { extractOmnyCoverageTargets } from './coverage/targets.ts';

function speakerMatches(unit: ExtractedSourceUnit, target: SourceCoverageTarget): boolean {
  return !unit.speakerHint || target.speaker_keys.includes(unit.speakerHint);
}

interface CandidateBucket {
  selected: SourceCoverageTarget[];
  total: number;
}

interface ExactTargetBucket {
  all: CandidateBucket;
  bySpeaker: Map<string, CandidateBucket>;
}

interface CoverageTargetIndex {
  storyboardSubstring: SourceCoverageTarget[];
  contextSubstring: SourceCoverageTarget[];
  storyboardExact: Map<string, ExactTargetBucket>;
  contextExact: Map<string, ExactTargetBucket>;
  substringEnabled: boolean;
}

function addCandidate(bucket: CandidateBucket, target: SourceCoverageTarget): void {
  bucket.total += 1;
  if (bucket.selected.length < MAX_CANDIDATES_PER_UNIT) bucket.selected.push(target);
}

function addExactTarget(index: Map<string, ExactTargetBucket>, target: SourceCoverageTarget): void {
  let entry = index.get(target.match_key);
  if (!entry) {
    entry = { all: { selected: [], total: 0 }, bySpeaker: new Map() };
    index.set(target.match_key, entry);
  }
  addCandidate(entry.all, target);
  new Set(target.speaker_keys).forEach((speaker) => {
    let bucket = entry!.bySpeaker.get(speaker);
    if (!bucket) {
      bucket = { selected: [], total: 0 };
      entry!.bySpeaker.set(speaker, bucket);
    }
    addCandidate(bucket, target);
  });
}

function buildCoverageTargetIndex(
  targets: readonly SourceCoverageTarget[],
  units: readonly ExtractedSourceUnit[],
): CoverageTargetIndex {
  const storyboardSubstring: SourceCoverageTarget[] = [];
  const contextSubstring: SourceCoverageTarget[] = [];
  const storyboardExact = new Map<string, ExactTargetBucket>();
  const contextExact = new Map<string, ExactTargetBucket>();
  targets.forEach((target) => {
    if (target.layer === 'storyboard_evidenced') {
      addExactTarget(storyboardExact, target);
      if (codePointLength(target.match_key) >= MIN_SUBSTRING_CODEPOINTS) storyboardSubstring.push(target);
    } else {
      addExactTarget(contextExact, target);
      if (codePointLength(target.match_key) >= MIN_SUBSTRING_CODEPOINTS) contextSubstring.push(target);
    }
  });
  const substringTargetCount = storyboardSubstring.length + contextSubstring.length;
  const substringSourceCount = units.filter((unit) => (
    unit.kind === 'content' && codePointLength(unit.matchKey) >= MIN_SUBSTRING_CODEPOINTS
  )).length;
  return {
    storyboardSubstring,
    contextSubstring,
    storyboardExact,
    contextExact,
    substringEnabled: substringSourceCount * substringTargetCount <= MAX_SUBSTRING_COMPARISONS,
  };
}

interface CoverageCandidates extends CandidateBucket {
  contextOnly: boolean;
  autoConfirm: boolean;
}

function substringCandidateBuckets(
  unit: ExtractedSourceUnit,
  targets: readonly SourceCoverageTarget[],
  checkSpeaker: boolean,
): { fullyRepresented: CandidateBucket; partialOnly: CandidateBucket } {
  const fullyRepresented: CandidateBucket = { selected: [], total: 0 };
  const partialOnly: CandidateBucket = { selected: [], total: 0 };
  targets.forEach((target) => {
    if (checkSpeaker && !speakerMatches(unit, target)) return;
    if (target.match_key.includes(unit.matchKey)) addCandidate(fullyRepresented, target);
    else if (unit.matchKey.includes(target.match_key)) addCandidate(partialOnly, target);
  });
  return { fullyRepresented, partialOnly };
}

function candidateTargets(unit: ExtractedSourceUnit, index: CoverageTargetIndex): CoverageCandidates {
  const empty = (): CoverageCandidates => ({ selected: [], total: 0, contextOnly: false, autoConfirm: false });
  if (unit.kind === 'excluded' || !unit.matchKey) return empty();
  const exactStoryboardEntry = index.storyboardExact.get(unit.matchKey);
  const exactStoryboard = unit.speakerHint
    ? exactStoryboardEntry?.bySpeaker.get(unit.speakerHint)
    : exactStoryboardEntry?.all;
  if (exactStoryboard?.total) return { ...exactStoryboard, contextOnly: false, autoConfirm: true };
  const exactContext = index.contextExact.get(unit.matchKey)?.all;
  if (exactContext?.total) return { ...exactContext, contextOnly: true, autoConfirm: false };
  if (!index.substringEnabled || codePointLength(unit.matchKey) < MIN_SUBSTRING_CODEPOINTS) {
    return empty();
  }
  const storyboard = substringCandidateBuckets(unit, index.storyboardSubstring, true);
  if (storyboard.fullyRepresented.total) {
    return { ...storyboard.fullyRepresented, contextOnly: false, autoConfirm: true };
  }
  if (storyboard.partialOnly.total) {
    return { ...storyboard.partialOnly, contextOnly: false, autoConfirm: false };
  }
  const context = substringCandidateBuckets(unit, index.contextSubstring, false);
  const contextCandidates = context.fullyRepresented.total ? context.fullyRepresented : context.partialOnly;
  return { ...contextCandidates, contextOnly: contextCandidates.total > 0, autoConfirm: false };
}

function checkedFileName(value: string): string {
  if (typeof value !== 'string') throw new Error('\u539f\u4f5c\u30fb\u53f0\u672c\u306e\u30d5\u30a1\u30a4\u30eb\u540d\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093');
  assertValidUnicode(value, '原作・台本のファイル名');
  const name = value.trim();
  if (!name || codePointLength(name) > 255 || /[\\/\0]/u.test(name) || name === '.' || name === '..') throw new Error('\u539f\u4f5c\u30fb\u53f0\u672c\u306e\u30d5\u30a1\u30a4\u30eb\u540d\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093');
  return name;
}

export function checkedSourceRelativePath(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('\u539f\u4f5c\u30fb\u53f0\u672c\u306e\u76f8\u5bfepath\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093');
  assertValidUnicode(value, '原作・台本の相対path');
  const normalized = value.trim();
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('\\') || normalized.includes('\\')
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')
    || utf8Bytes(normalized).byteLength > 1_024) {
    throw new Error('\u539f\u4f5c\u30fb\u53f0\u672c\u306e\u76f8\u5bfepath\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093');
  }
  return normalized;
}

function checkedDecision(value: SourceCoverageDecision): SourceCoverageDecision {
  if (!value || typeof value !== 'object'
    || typeof value.source_unit_id !== 'string'
    || typeof value.note !== 'string'
    || typeof value.source_revision_sha256 !== 'string'
    || typeof value.projection_sha256 !== 'string'
    || !/^source-[a-f0-9]{64}$/u.test(value.source_unit_id)
    || !['covered', 'not_covered', 'not_applicable'].includes(value.decision)
    || !/^[a-f0-9]{64}$/u.test(value.source_revision_sha256)
    || !/^[a-f0-9]{64}$/u.test(value.projection_sha256)) {
    throw new Error('\u4eba\u9593review\u306e\u8a18\u9332\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093');
  }
  assertValidUnicode(value.note, '人間reviewのメモ');
  const note = value.note.trim();
  if (codePointLength(note) > 1_000) throw new Error('人間reviewのメモが1,000文字を超えています');
  return { ...value, note };
}

export async function buildSourceCoverageReport(
  source: SourceCoverageSource,
  document: MangaDocument,
  options: { omnyYaml?: string; decisions?: readonly SourceCoverageDecision[] } = {},
): Promise<SourceCoverageReport> {
  const canonical = canonicalizeSourceText(source.text);
  const sourceFileName = checkedFileName(source.fileName);
  const sourceRelativePath = checkedSourceRelativePath(source.relativePath);
  const sourceTextSha = await sha256Hex(canonical);
  const sourceRevision = await sha256Hex(stableJson({
    file_name: sourceFileName,
    relative_path: sourceRelativePath,
    source_text_sha256: sourceTextSha,
  }));
  const targets = await extractOmnyCoverageTargets(document);
  const projection = targets.map(({ target_id: _targetId, locator: _locator, ...target }) => target);
  const projectionSha = await sha256Hex(stableJson({
    series_id: document.manga.meta.series_id,
    episode_id: document.manga.meta.episode_id,
    targets: projection,
  }));
  const omnyRevision = await sha256Hex(options.omnyYaml ?? stableJson(document));
  const extracted = extractSourceUnits(canonical);
  const targetIndex = buildCoverageTargetIndex(targets, extracted);
  const sourceOrdinals = new Map<string, number>();
  const sourceUnits: SourceCoverageUnit[] = [];
  for (const unit of extracted) {
    const duplicateKey = `${unit.kind}\0${unit.matchKey}`;
    const ordinal = (sourceOrdinals.get(duplicateKey) ?? 0) + 1;
    sourceOrdinals.set(duplicateKey, ordinal);
    const sourceUnitId = `source-${await sha256Hex(`${duplicateKey}\0${ordinal}`)}`;
    const candidates = candidateTargets(unit, targetIndex);
    const status: SourceCoverageStatus = unit.kind === 'excluded'
      ? 'excluded'
      : candidates.contextOnly || candidates.total === 0 || !candidates.autoConfirm
        ? 'unverified'
        : candidates.total === 1 ? 'confirmed' : 'ambiguous';
    sourceUnits.push({
      source_unit_id: sourceUnitId,
      kind: unit.kind,
      start_line: unit.line,
      end_line: unit.line,
      excerpt: unit.excerpt,
      match_text: unit.matchText,
      match_key: unit.matchKey,
      speaker_hint: unit.speakerHint,
      status,
      context_retained: candidates.contextOnly,
      candidate_target_ids: candidates.selected.map((target) => target.target_id),
      candidate_total: candidates.total,
    });
  }
  const knownSourceIds = new Set(sourceUnits.filter((unit) => unit.kind === 'content').map((unit) => unit.source_unit_id));
  const decisions = (options.decisions ?? []).map(checkedDecision).filter((decision, index, all) => (
    knownSourceIds.has(decision.source_unit_id)
    && all.findIndex((candidate) => candidate.source_unit_id === decision.source_unit_id) === index
  ));
  const humanDecisions = decisions.map((decision) => ({
    ...decision,
    stale: decision.source_revision_sha256 !== sourceRevision || decision.projection_sha256 !== projectionSha,
  }));
  const currentDecisionIds = new Set(humanDecisions.filter((decision) => !decision.stale).map((decision) => decision.source_unit_id));
  const counts = (status: SourceCoverageStatus) => sourceUnits.filter((unit) => unit.status === status).length;
  const unresolved = sourceUnits.filter((unit) => unit.kind === 'content'
    && unit.status !== 'confirmed'
    && !currentDecisionIds.has(unit.source_unit_id)).length;
  const currentNotCovered = humanDecisions.some((decision) => !decision.stale && decision.decision === 'not_covered');
  const verdict = unresolved > 0 ? 'review_required' : currentNotCovered ? 'reviewed_with_gaps' : 'no_review_required';
  const warnings = [
    !document.manga.meta.episode_id.trim() ? 'unstable_episode_identity' : '',
    /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(canonical) ? 'source_contains_control_or_bidi_characters' : '',
    sourceUnits.some((unit) => unit.context_retained) ? 'context_only_matches_require_storyboard_review' : '',
    !targetIndex.substringEnabled ? 'substring_matching_skipped_due_to_volume' : '',
  ].filter(Boolean);
  const analysisSha = await sha256Hex(stableJson({ source_revision_sha256: sourceRevision, projection_sha256: projectionSha, source_units: sourceUnits, targets }));
  const report: SourceCoverageReport = {
    schema_name: SOURCE_COVERAGE_SCHEMA_NAME,
    schema_version: SOURCE_COVERAGE_SCHEMA_VERSION,
    kind: 'source_coverage_report',
    episode: {
      series_id: document.manga.meta.series_id,
      episode_id: document.manga.meta.episode_id,
      title: document.manga.meta.title,
      episode_number: document.manga.meta.episode_number,
    },
    source: {
      file_name: sourceFileName,
      relative_path: sourceRelativePath,
      byte_size: utf8Bytes(canonical).byteLength,
      line_count: canonical.split('\n').length,
      source_text_sha256: sourceTextSha,
      source_revision_sha256: sourceRevision,
    },
    omny: { omny_revision_sha256: omnyRevision, projection_sha256: projectionSha },
    analysis_sha256: analysisSha,
    scan_complete: true,
    verdict,
    summary: {
      source_units: sourceUnits.length,
      confirmed: counts('confirmed'),
      ambiguous: counts('ambiguous'),
      unverified: counts('unverified'),
      excluded: counts('excluded'),
      context_only: sourceUnits.filter((unit) => unit.context_retained).length,
      current_decisions: humanDecisions.filter((decision) => !decision.stale).length,
      stale_decisions: humanDecisions.filter((decision) => decision.stale).length,
      unresolved_after_review: unresolved,
    },
    warnings,
    source_units: sourceUnits,
    targets,
    human_decisions: humanDecisions,
  };
  if (utf8Bytes(JSON.stringify(report)).byteLength > MAX_REPORT_BYTES) throw new Error('coverage report\u304c8MiB\u3092\u8d85\u3048\u3066\u3044\u307e\u3059');
  return report;
}

export function decisionForReport(
  report: SourceCoverageReport,
  sourceUnitId: string,
  decision: SourceCoverageDecisionValue,
  note = '',
): SourceCoverageDecision {
  if (!report.source_units.some((unit) => unit.source_unit_id === sourceUnitId && unit.kind === 'content')) {
    throw new Error('\u5bfe\u8c61\u306e\u539f\u6587\u884c\u304creport\u306b\u3042\u308a\u307e\u305b\u3093');
  }
  assertValidUnicode(note, '人間reviewのメモ');
  return {
    source_unit_id: sourceUnitId,
    decision,
    note: [...note.trim()].slice(0, 1_000).join(''),
    source_revision_sha256: report.source.source_revision_sha256,
    projection_sha256: report.omny.projection_sha256,
  };
}

export {
  SOURCE_COVERAGE_SCHEMA_NAME,
  SOURCE_COVERAGE_SCHEMA_VERSION,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_LINES,
  MAX_SOURCE_UNITS,
  MAX_TARGET_UNITS,
  MAX_PROJECTION_BYTES,
  MAX_CANDIDATES_PER_UNIT,
  MAX_REPORT_BYTES,
  MAX_ADJACENT_BUBBLES,
  MAX_SUBSTRING_COMPARISONS,
  canonicalizeSourceText,
  coverageMatchKey,
  extractSourceUnits,
  stableJson,
  sha256Hex,
} from './coverage/sourceUnits.ts';
export type {
  SourceCoverageStatus,
  SourceCoverageLayer,
  SourceCoverageDecisionValue,
  SourceCoverageSource,
  SourceCoverageDecision,
  SourceCoverageTarget,
  SourceCoverageUnit,
  SourceCoverageReport,
} from './coverage/sourceUnits.ts';
export { extractOmnyCoverageTargets } from './coverage/targets.ts';
