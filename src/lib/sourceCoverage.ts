import type { MangaDocument } from '../types';

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
const MIN_SUBSTRING_CODEPOINTS = 12;
const MAX_SOURCE_UNIT_CODEPOINTS = 2_000;
const MAX_TARGET_VALUE_CODEPOINTS = 5_000;

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

interface TargetDraft {
  layer: SourceCoverageLayer;
  kind: string;
  locator: string;
  value: string;
  matchKey: string;
  speakerKeys: string[];
}

interface ExtractedSourceUnit {
  kind: 'content' | 'excluded';
  line: number;
  excerpt: string;
  matchText: string;
  matchKey: string;
  speakerHint: string | null;
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function assertValidUnicode(value: string, label: string): void {
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

function addTarget(drafts: TargetDraft[], target: Omit<TargetDraft, 'matchKey'>): void {
  const value = target.value.trim();
  if (!value) return;
  assertValidUnicode(value, 'OMNYの照合対象');
  const matchKey = coverageMatchKey(value);
  if (!matchKey) return;
  if (codePointLength(value) > MAX_TARGET_VALUE_CODEPOINTS
    || codePointLength(matchKey) > MAX_TARGET_VALUE_CODEPOINTS) {
    throw new Error(`OMNYの照合対象が${MAX_TARGET_VALUE_CODEPOINTS.toLocaleString()}文字を超えています`);
  }
  drafts.push({ ...target, value, matchKey });
  if (drafts.length > MAX_TARGET_UNITS) throw new Error(`OMNY\u306e\u7167\u5408\u5bfe\u8c61\u304c${MAX_TARGET_UNITS.toLocaleString()}\u4ef6\u3092\u8d85\u3048\u3066\u3044\u307e\u3059`);
}

function pointerSegment(value: string | number): string {
  return String(value).replace(/~/gu, '~0').replace(/\//gu, '~1');
}

function bubbleSpeakerKeys(document: MangaDocument, speaker: string | undefined): string[] {
  const speakerKey = coverageMatchKey(speaker ?? '');
  if (!speakerKey) return [];
  const character = document.manga.characters.find((entry) => [entry.name, ...(entry.aliases ?? [])]
    .some((candidate) => coverageMatchKey(candidate) === speakerKey));
  return [...new Set([speaker, character?.name, ...(character?.aliases ?? [])]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(coverageMatchKey))].sort();
}

function addBubbleTargets(
  drafts: TargetDraft[],
  document: MangaDocument,
  bubbles: readonly { text: string; speaker?: string }[],
  baseLocator: string,
): void {
  bubbles.forEach((bubble, index) => addTarget(drafts, {
    layer: 'storyboard_evidenced',
    kind: 'bubble',
    locator: `${baseLocator}/${index}/text`,
    value: bubble.text,
    speakerKeys: bubbleSpeakerKeys(document, bubble.speaker),
  }));
  for (let start = 0; start < bubbles.length; start += 1) {
    for (let length = 2; length <= MAX_ADJACENT_BUBBLES && start + length <= bubbles.length; length += 1) {
      const sequence = bubbles.slice(start, start + length);
      const speakerSets = sequence.map((bubble) => new Set(bubbleSpeakerKeys(document, bubble.speaker)));
      const sharedSpeakers = speakerSets[0]
        ? [...speakerSets[0]].filter((speaker) => speakerSets.every((entries) => entries.has(speaker))).sort()
        : [];
      for (const separator of ['', ' ']) addTarget(drafts, {
        layer: 'storyboard_evidenced',
        kind: 'bubble_sequence',
        locator: `${baseLocator}/${start}-${start + length - 1}`,
        value: sequence.map((bubble) => bubble.text.trim()).join(separator),
        speakerKeys: sharedSpeakers,
      });
    }
  }
}

export async function extractOmnyCoverageTargets(document: MangaDocument): Promise<SourceCoverageTarget[]> {
  const drafts: TargetDraft[] = [];
  const context = (kind: string, locator: string, value: string) => addTarget(drafts, {
    layer: 'context_retained', kind, locator, value, speakerKeys: [],
  });
  const storyboard = (kind: string, locator: string, value: string, speakerKeys: string[] = []) => addTarget(drafts, {
    layer: 'storyboard_evidenced', kind, locator, value, speakerKeys,
  });
  const { manga } = document;
  context('meta_title', '/manga/meta/title', manga.meta.title);
  context('meta_series', '/manga/meta/series', manga.meta.series);
  context('meta_episode_number', '/manga/meta/episode_number', manga.meta.episode_number);
  context('setting_location', '/manga/setting/location', manga.setting.location);
  context('setting_time', '/manga/setting/time', manga.setting.time);
  context('setting_weather', '/manga/setting/weather', manga.setting.weather);
  context('setting_situation', '/manga/setting/situation', manga.setting.situation);
  context('series_genre', '/manga/series_setting/genre', manga.series_setting.genre ?? '');
  context('series_target_audience', '/manga/series_setting/target_audience', manga.series_setting.target_audience ?? '');
  context('series_situation', '/manga/series_setting/situation', manga.series_setting.situation);
  manga.characters.forEach((character, characterIndex) => {
    const base = `/manga/characters/${characterIndex}`;
    context('character_name', `${base}/name`, character.name);
    context('character_role', `${base}/role`, character.role);
    character.aliases?.forEach((alias, aliasIndex) => context('character_alias', `${base}/aliases/${aliasIndex}`, alias));
  });
  manga.materials.forEach((material, materialIndex) => {
    const base = `/manga/materials/${materialIndex}`;
    context('material_key', `${base}/key`, material.key);
    material.keywords.forEach((keyword, keywordIndex) => context('material_keyword', `${base}/keywords/${keywordIndex}`, keyword));
    context('material_note', `${base}/note`, material.note ?? '');
  });
  manga.pages.forEach((page, pageIndex) => {
    page.panels.forEach((panel, panelIndex) => {
      const base = `/manga/pages/${pageIndex}/panels/${panelIndex}`;
      storyboard('panel_action', `${base}/action`, panel.action ?? '');
      storyboard('panel_background', `${base}/background_description`, panel.background_description ?? '');
      panel.figures?.forEach((figure, figureIndex) => {
        storyboard('figure_name', `${base}/figures/${figureIndex}/name`, figure.name);
        storyboard('figure_action', `${base}/figures/${figureIndex}/action`, figure.action ?? '');
      });
      addBubbleTargets(drafts, document, panel.bubbles, `${base}/bubbles`);
      panel.screen_text?.forEach((screenText, textIndex) => storyboard(
        'screen_text', `${base}/screen_text/${textIndex}/text`, screenText.text,
      ));
    });
    const overlay = page.page_overlay;
    if (!overlay) return;
    const base = `/manga/pages/${pageIndex}/page_overlay`;
    overlay.figures?.forEach((figure, figureIndex) => {
      storyboard('overlay_figure_name', `${base}/figures/${figureIndex}/name`, figure.name);
      storyboard('overlay_figure_action', `${base}/figures/${figureIndex}/action`, figure.action ?? '');
    });
    addBubbleTargets(drafts, document, overlay.bubbles ?? [], `${base}/bubbles`);
  });
  const projectionBytes = utf8Bytes(stableJson(drafts.map(({ layer, kind, value, matchKey, speakerKeys }) => ({
    layer, kind, value, match_key: matchKey, speaker_keys: speakerKeys,
  }))));
  if (projectionBytes.byteLength > MAX_PROJECTION_BYTES) throw new Error('OMNY\u306e\u76e3\u67fbprojection\u304c5MiB\u3092\u8d85\u3048\u3066\u3044\u307e\u3059');
  const episodeIdentity = manga.meta.episode_id.trim() || await sha256Hex(projectionBytes);
  const ordinals = new Map<string, number>();
  return Promise.all(drafts.map(async (draft) => {
    const duplicateKey = `${draft.layer}\0${draft.kind}\0${draft.matchKey}\0${draft.speakerKeys.join('\0')}`;
    const ordinal = (ordinals.get(duplicateKey) ?? 0) + 1;
    ordinals.set(duplicateKey, ordinal);
    return {
      target_id: `target-${await sha256Hex(`${episodeIdentity}\0${duplicateKey}\0${ordinal}`)}`,
      layer: draft.layer,
      kind: draft.kind,
      locator: draft.locator.split('/').map((part, index) => index === 0 ? '' : pointerSegment(part)).join('/'),
      value: draft.value,
      match_key: draft.matchKey,
      speaker_keys: draft.speakerKeys,
    } satisfies SourceCoverageTarget;
  }));
}

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

function codePointLength(value: string): number {
  return [...value].length;
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
