import type { Bubble, BubbleShape, Character, MangaDocument, ScenarioSource } from '../types.ts';
import { synchronizeCatalogReferences } from './catalogModel.ts';
import { createBubbleBezier } from './bubbleBezier.ts';
import { defaultVectorStyle, vectorShape } from './vectorGeometry.ts';

export const SCENARIO_MATCH_THRESHOLD = 0.7;

export interface ScenarioDialogue {
  id: string;
  speaker: string;
  text: string;
  emphasis: string;
  shape?: BubbleShape;
  monologue?: boolean;
}
export interface ScenarioPanel {
  page: number;
  panel: number;
  action: string;
  dialogues: ScenarioDialogue[];
}
export interface ScenarioScript {
  panels: ScenarioPanel[];
  warnings: string[];
}

/** Only headings are NFKC-normalized. Authoritative prose is never normalized. */
function heading(line: string): { level: number; title: string } | null {
  const match = line.normalize('NFKC').trim().match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/u);
  return match ? { level: match[1].length, title: match[2].trim() } : null;
}

export function scenarioSourceParts(source: string): { metadata: string; scenario: string } {
  const lines = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').split('\n');
  let start = -1;
  let end = lines.length;
  let level = 0;
  let fence = '';
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i].trim().match(/^(`{3,}|~{3,})/u)?.[1]?.[0];
    if (marker) { fence = !fence ? marker : fence === marker ? '' : fence; continue; }
    if (fence) continue;
    const h = heading(lines[i]);
    if (!h) continue;
    if (start < 0 && h.title === 'シナリオ') { start = i; level = h.level; }
    else if (start >= 0 && h.level <= level) { end = i; break; }
  }
  return start < 0 ? { metadata: lines.join('\n'), scenario: '' }
    : { metadata: [...lines.slice(0, start), ...lines.slice(end)].join('\n'), scenario: lines.slice(start, end).join('\n') };
}

function emphasizedText(raw: string): { text: string; emphasis: string } {
  const phrases: string[] = [];
  const text = raw.replace(/\*\*([\s\S]+?)\*\*/gu, (_, phrase: string) => {
    phrases.push(phrase);
    return phrase;
  });
  return { text, emphasis: [...new Set(phrases)].join(', ') };
}

const NARRATION_LABEL = /^(?:ナレーション|語り|地の文)$/iu;
const MONOLOGUE_LABEL = /^(?:独白|モノローグ|心の声)$/u;

function dialogueSpeaker(label: string): Pick<ScenarioDialogue, 'speaker' | 'shape' | 'monologue'> {
  if (NARRATION_LABEL.test(label)) return { speaker: '', shape: 'square' };
  if (MONOLOGUE_LABEL.test(label)) return { speaker: '', monologue: true };
  const annotated = label.match(/^(.+?)[（(](独白|モノローグ|心の声)[）)]$/u);
  return annotated ? { speaker: annotated[1].trim(), monologue: true } : { speaker: label };
}

/** A whole dialogue line: 名前「本文」「続き」. Quoted prose with a narrative suffix stays prose. */
function dialogueLine(line: string): Omit<ScenarioDialogue, 'id'>[] | null {
  const plainNarration = line.match(/^([^：:\n]{1,40})[：:]\s*(.+)$/su);
  if (plainNarration && !plainNarration[2].trimStart().startsWith('「')) {
    const role = dialogueSpeaker(plainNarration[1].trim());
    if (role.shape || role.monologue) return [{ ...role, ...emphasizedText(plainNarration[2].trim()) }];
  }
  const result: Omit<ScenarioDialogue, 'id'>[] = [];
  let cursor = 0;
  let speaker = '';
  while (cursor < line.length) {
    const open = line.indexOf('「', cursor);
    if (open < 0) return line.slice(cursor).trim() ? null : result;
    const prefix = line.slice(cursor, open).trim().replace(/[：:]\s*$/u, '').trim();
    if (prefix) speaker = prefix;
    if (!speaker || speaker.length > 40 || /[。！？\n]/u.test(speaker)) return null;
    let depth = 1;
    let close = open + 1;
    for (; close < line.length && depth; close++) {
      if (line[close] === '「') depth++;
      if (line[close] === '」') depth--;
    }
    if (depth) return null;
    result.push({ ...dialogueSpeaker(speaker), ...emphasizedText(line.slice(open + 1, close - 1)) });
    cursor = close;
  }
  return result.length ? result : null;
}

export function parseScenario(source: string): ScenarioScript | null {
  const section = scenarioSourceParts(source).scenario;
  if (!section) return null;
  const panels: ScenarioPanel[] = [];
  const warnings: string[] = [];
  let page = 0;
  let panel: ScenarioPanel | null = null;
  let fence = '';
  const lines = section.split('\n');
  for (let i = 1; i < lines.length; i++) {
    let line = lines[i].trim();
    const marker = line.match(/^(`{3,}|~{3,})/u)?.[1]?.[0];
    if (marker) { fence = !fence ? marker : fence === marker ? '' : fence; continue; }
    if (fence || !line || /^---+$/u.test(line)) continue;
    const h = heading(line);
    if (h) {
      const p = h.title.match(/^(?:page\s*|p\s*)(\d+)$/iu) ?? h.title.match(/^(\d+)\s*ページ$/u);
      const c = h.title.match(/^コマ\s*(\d+)$/u);
      if (p) { page = Number(p[1]); panel = null; }
      else if (c && page > 0 && Number(c[1]) > 0) {
        const number = Number(c[1]);
        if (panels.some(entry => entry.page === page && entry.panel === number)) {
          warnings.push(`${page}ページ・コマ${number}の見出しが重複しています。`);
          panel = null;
        } else { panel = { page, panel: number, action: '', dialogues: [] }; panels.push(panel); }
      } else { warnings.push(`見出し「${h.title}」のページ・コマを確認してください。`); panel = null; }
      continue;
    }
    if (!panel) { warnings.push(`ページ・コマの指定がない文章：${line.slice(0, 60)}`); continue; }
    // Support a literal newline inside a quoted utterance, without swallowing a following heading.
    while ((line.match(/「/gu)?.length ?? 0) > (line.match(/」/gu)?.length ?? 0)
      && i + 1 < lines.length && !heading(lines[i + 1])) line += `\n${lines[++i].trim()}`;
    const dialogues = dialogueLine(line);
    if (dialogues) {
      for (const dialogue of dialogues) panel.dialogues.push({
        ...dialogue, id: `p${panel.page}-c${panel.panel}-d${panel.dialogues.length + 1}`,
      });
    } else panel.action += `${panel.action ? '\n' : ''}${line}`;
  }
  return { panels, warnings };
}

/** Formatting is ignored only for lookup; punctuation-only utterances (… / ?) keep their identity. */
export function scenarioMatchKey(value: string): string {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('ja-JP')
    .replace(/[…⋯]/gu, '...').replace(/[・･]{2,}/gu, '...').replace(/\s+/gu, '');
  return normalized.replace(/[。、,.「」『』“”"'!?！？]/gu, '') || normalized;
}

/** Normalized Levenshtein similarity, not a probability or semantic confidence. */
export function scenarioSimilarity(left: string, right: string): number {
  const a = [...scenarioMatchKey(left)];
  const b = [...scenarioMatchKey(right)];
  if (!a.length || !b.length) return 0;
  if (a.join('') === b.join('')) return 1;
  // A malformed, extremely long OCR region remains reviewable without blocking the UI.
  if (a.length > 2000 || b.length > 2000) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(
      previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
    );
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function speakerKey(value: string): string { return value.normalize('NFKC').trim().toLocaleLowerCase('ja-JP'); }

export function scenarioCharacter(characters: readonly Character[], name: string): Character | undefined {
  const matches = characters.filter(character => [character.name, ...(character.aliases ?? [])]
    .some(alias => speakerKey(alias) === speakerKey(name)));
  return matches.length === 1 ? matches[0] : undefined;
}

export function scenarioDialogues(source: ScenarioSource): ScenarioDialogue[] {
  return parseScenario(source.text)?.panels.flatMap(panel => panel.dialogues) ?? [];
}

export function applyScenarioDialogue(bubble: Bubble, dialogues: readonly ScenarioDialogue[], characters: readonly Character[], score: number, confirmed = false, initialPlacement = false): void {
  const ocrText = bubble.scenarioMatch?.ocrText ?? bubble.text;
  bubble.text = dialogues.map(dialogue => dialogue.text).join('\n');
  const emphasis = dialogues.map(dialogue => dialogue.emphasis).filter(Boolean).join(', ');
  if (emphasis) bubble.emphasis = emphasis; else delete bubble.emphasis;
  const speaker = dialogues[0]?.speaker ?? '';
  const character = scenarioCharacter(characters, speaker);
  if (character?.name || speaker) bubble.speaker = character?.name ?? speaker; else delete bubble.speaker;
  if (character?.localId) bubble.speakerId = character.localId; else delete bubble.speakerId;
  if (dialogues[0]?.monologue) bubble.monologue = true; else delete bubble.monologue;
  // Shape defaults belong to initial placement, never to later source relinking.
  if (initialPlacement) {
    const narration = dialogues[0]?.shape === 'square';
    bubble.shape = narration ? 'square' : 'normal';
    bubble.bezier = narration
      ? { nodes: vectorShape('rectangle', { x: 0, y: 0 }, { x: 100, y: 100 }, defaultVectorStyle()).nodes }
      : createBubbleBezier('ellipse');
    if (narration) bubble.tail = false;
  }
  bubble.scenarioMatch = { sourceIds: [], resolvedSourceIds: dialogues.map(dialogue => dialogue.id), ocrText, score, status: confirmed ? 'confirmed' : 'automatic' };
  if (bubble.analogTextImport) {
    bubble.analogTextImport.needsReview = false;
  }
}

/** Use one review state for the canvas, inline candidates and scenario overview. */
export function scenarioBubbleNeedsReview(bubble: Bubble): boolean {
  if (bubble.scenarioMatch) return bubble.scenarioMatch.status === 'review';
  return bubble.analogTextImport?.needsReview === true;
}

/** Read-only provenance: these ids must never be used to resynchronize settled text. */
export function scenarioOriginIds(bubble: Bubble): readonly string[] {
  return bubble.scenarioMatch?.resolvedSourceIds ?? bubble.scenarioMatch?.sourceIds ?? [];
}

/** Detach older saved correspondences without changing authored text or roles. */
export function detachResolvedScenarioLinks(document: MangaDocument): boolean {
  let changed = false;
  for (const { bubble } of scenarioBubbleEntries(document)) {
    const match = bubble.scenarioMatch;
    if (!match || match.status === 'review' || !match.sourceIds?.length) continue;
    match.resolvedSourceIds = [...new Set([...(match.resolvedSourceIds ?? []), ...match.sourceIds])];
    match.sourceIds = [];
    changed = true;
  }
  return changed;
}

export interface ScenarioCandidate { dialogues: ScenarioDialogue[]; score: number; contextScore?: number; neighborScore?: number }

export function scenarioCandidates(ocrText: string, dialogues: readonly ScenarioDialogue[]): ScenarioCandidate[] {
  const candidates: ScenarioCandidate[] = [];
  for (let start = 0; start < dialogues.length; start++) {
    for (let length = 1; length <= 4 && start + length <= dialogues.length; length++) {
      const group = dialogues.slice(start, start + length);
      if (group.some(dialogue => speakerKey(dialogue.speaker) !== speakerKey(group[0].speaker)
        || dialogue.shape !== group[0].shape || dialogue.monologue !== group[0].monologue)) break;
      candidates.push({ dialogues: group, score: scenarioSimilarity(ocrText, group.map(dialogue => dialogue.text).join('')) });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

/** New-creation only: never rerun this over a user's edited document. One source utterance is used once. */
export function applyScenarioToNewDocument(document: MangaDocument, source: ScenarioSource): { matched: number; review: number; actions: number } {
  const script = parseScenario(source.text);
  if (!script) return { matched: 0, review: 0, actions: 0 };
  document.manga.scenario = structuredClone(source);
  synchronizeCatalogReferences(document);
  let matched = 0;
  let review = 0;
  let actions = 0;
  for (const page of document.manga.pages) {
    for (const panel of page.panels) {
      const original = script.panels.find(entry => entry.page === page.page && entry.panel === panel.id);
      if (original?.action) { panel.action = original.action; actions++; }
      const candidates = panel.bubbles.map(bubble => scenarioCandidates(bubble.text, original?.dialogues ?? []));
      const used = new Set<string>();
      const assigned = new Set<number>();
      // Accept only a unique, mutually best correspondence. Ordering cannot force a weak match.
      for (let pass = 0; pass < panel.bubbles.length; pass++) {
        const available = candidates.map(list => list.filter(candidate => !candidate.dialogues.some(d => used.has(d.id))));
        let progress = false;
        for (let i = 0; i < panel.bubbles.length; i++) {
          if (assigned.has(i)) continue;
          const best = available[i][0];
          if (!best || best.score <= SCENARIO_MATCH_THRESHOLD || best.score === available[i][1]?.score) continue;
          if (best.dialogues.some(d => used.has(d.id))) continue;
          const competed = available.some((list, j) => j !== i && !assigned.has(j) && list.some(other =>
            other.score >= best.score && other.dialogues.some(d => best.dialogues.some(target => target.id === d.id))));
          if (competed) continue;
          applyScenarioDialogue(panel.bubbles[i], best.dialogues, document.manga.characters, best.score, false, true);
          best.dialogues.forEach(d => used.add(d.id));
          assigned.add(i); matched++; progress = true;
        }
        if (!progress) break;
      }
      panel.bubbles.forEach((bubble, i) => {
        if (assigned.has(i)) return;
        bubble.scenarioMatch = { sourceIds: [], ocrText: bubble.text, score: candidates[i][0]?.score ?? 0, status: 'review', provisionalText: true };
        if (bubble.analogTextImport) bubble.analogTextImport.needsReview = true;
        review++;
      });
    }
    // The source specifies panel ownership; never guess an overlay's panel from text alone.
    for (const bubble of page.page_overlay?.bubbles ?? []) {
      bubble.scenarioMatch = { sourceIds: [], ocrText: bubble.text, score: 0, status: 'review', provisionalText: true };
      if (bubble.analogTextImport) bubble.analogTextImport.needsReview = true;
      review++;
    }
  }
  return { matched, review, actions };
}

export function validateScenarioSource(value: ScenarioSource): ScenarioSource {
  if (value?.version !== 1 || typeof value.fileName !== 'string' || typeof value.text !== 'string'
    || value.text.length > 5 * 1024 * 1024 || !parseScenario(value.text)) throw new Error('シナリオの保存データを読み込めませんでした');
  return { version: 1, fileName: value.fileName, text: value.text };
}

export interface ScenarioBubbleLocation {
  pageIndex: number;
  panelIndex: number;
  bubbleIndex: number;
  overlay?: boolean;
}
export function scenarioBubbleEntries(document: MangaDocument): Array<ScenarioBubbleLocation & { bubble: Bubble }> {
  return document.manga.pages.flatMap((page, pageIndex) => [
    ...page.panels.flatMap((panel, panelIndex) => panel.bubbles.map((bubble, bubbleIndex) => ({ pageIndex, panelIndex, bubbleIndex, bubble }))),
    ...(page.page_overlay?.bubbles ?? []).map((bubble, bubbleIndex) => ({ pageIndex, panelIndex: 0, bubbleIndex, bubble, overlay: true })),
  ]);
}

export function availableScenarioCandidates(document: MangaDocument, location: ScenarioBubbleLocation): ScenarioCandidate[] {
  const page = document.manga.pages[location.pageIndex];
  const bubble = location.overlay ? page?.page_overlay?.bubbles?.[location.bubbleIndex] : page?.panels[location.panelIndex]?.bubbles[location.bubbleIndex];
  if (!bubble || !document.manga.scenario) return [];
  const used = new Set(scenarioBubbleEntries(document).filter(entry => entry.bubble !== bubble)
    .flatMap(entry => [...scenarioOriginIds(entry.bubble)]));
  const scriptPanels = parseScenario(document.manga.scenario.text)?.panels ?? [];
  const sourceLines = scriptPanels.flatMap(panel => panel.dialogues);
  const sourcePosition = new Map(sourceLines.map((line, index) => [line.id, index]));
  // Bubble array order is the imported/authored reading order. Explicit extra
  // dialogue has no source row, so it does not consume a position between anchors.
  const sequence = (location.overlay ? page.page_overlay?.bubbles ?? []
    : document.manga.pages.flatMap(entry => entry.panels.flatMap(panel => panel.bubbles)))
    .filter(entry => entry === bubble || !(entry.scenarioMatch?.status === 'unmatched'
      || entry.scenarioMatch?.status === 'manual' && !scenarioOriginIds(entry).length));
  const targetIndex = sequence.indexOf(bubble);
  const anchor = (direction: -1 | 1) => {
    for (let i = targetIndex + direction; i >= 0 && i < sequence.length; i += direction) {
      if (scenarioBubbleNeedsReview(sequence[i])) continue;
      const positions = scenarioOriginIds(sequence[i]).map(id => sourcePosition.get(id)).filter((value): value is number => value !== undefined);
      if (positions.length) return { position: direction < 0 ? Math.max(...positions) : Math.min(...positions), distance: Math.abs(i - targetIndex) };
    }
    return undefined;
  };
  const before = anchor(-1), after = anchor(1);
  const neighborScore = (candidate: ScenarioCandidate): number | undefined => {
    const start = sourcePosition.get(candidate.dialogues[0].id)!;
    const end = sourcePosition.get(candidate.dialogues[candidate.dialogues.length - 1].id)!;
    const scores: number[] = [];
    if (before) scores.push(start <= before.position ? 0 : 1 / (1 + Math.abs(start - before.position - before.distance)));
    else if (sequence[targetIndex - 1]?.text && sourceLines[start - 1]) scores.push(scenarioSimilarity(sequence[targetIndex - 1].text, sourceLines[start - 1].text));
    if (after) scores.push(end >= after.position ? 0 : 1 / (1 + Math.abs(after.position - end - after.distance)));
    else if (sequence[targetIndex + 1]?.text && sourceLines[end + 1]) scores.push(scenarioSimilarity(sequence[targetIndex + 1].text, sourceLines[end + 1].text));
    return scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : undefined;
  };
  const actualPanels = document.manga.pages.flatMap((entry, pageIndex) => entry.panels.map((panel, panelIndex) => ({ pageIndex, panelIndex, panel })));
  const actualIndex = actualPanels.findIndex(entry => entry.pageIndex === location.pageIndex && entry.panelIndex === location.panelIndex);
  const sourceIndex = scriptPanels.findIndex(panel => panel.page === page.page && panel.panel === page.panels[location.panelIndex]?.id);
  const sourceIndexes = !location.overlay && sourceIndex >= 0 ? [sourceIndex - 1, sourceIndex, sourceIndex + 1].filter(index => scriptPanels[index])
    : scriptPanels.map((panel, index) => panel.page === page.page ? index : -1).filter(index => index >= 0);
  const actualText = (index: number) => actualPanels[index]?.panel.bubbles.map(entry => entry.text).filter(Boolean).join('\n') ?? '';
  const sourceText = (index: number) => scriptPanels[index]?.dialogues.map(dialogue => dialogue.text).join('\n') ?? '';
  const previousText = actualText(actualIndex - 1);
  const nextText = actualText(actualIndex + 1);
  const ranked = sourceIndexes.flatMap(index => {
    const scores = location.overlay ? [] : [
      previousText && sourceText(index - 1) ? scenarioSimilarity(previousText, sourceText(index - 1)) : undefined,
      nextText && sourceText(index + 1) ? scenarioSimilarity(nextText, sourceText(index + 1)) : undefined,
    ].filter((score): score is number => score !== undefined);
    const contextScore = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : undefined;
    return scenarioCandidates(bubble.scenarioMatch?.ocrText ?? bubble.text, scriptPanels[index].dialogues).map(candidate => {
      const nearby = neighborScore(candidate);
      const context = nearby ?? contextScore;
      const rank = candidate.score > SCENARIO_MATCH_THRESHOLD ? 1 + candidate.score
        : context === undefined ? candidate.score : candidate.score * .35 + context * .65;
      return { ...candidate, ...(contextScore !== undefined ? { contextScore } : {}),
        ...(nearby !== undefined ? { neighborScore: nearby } : {}),
        // A source line is normally one utterance. Keep strong grouped matches,
        // but prefer one-line suggestions when OCR is weak.
        rank: rank - (candidate.score <= SCENARIO_MATCH_THRESHOLD ? .12 * (candidate.dialogues.length - 1) : 0) };
    });
  });
  // Generate before filtering, so an already-used middle utterance cannot join nonadjacent ones.
  return ranked.filter(candidate => !candidate.dialogues.some(dialogue => used.has(dialogue.id)))
    .sort((a, b) => b.rank - a.rank || b.score - a.score || a.dialogues.length - b.dialogues.length)
    .map(({ rank: _rank, ...candidate }) => candidate);
}

/** Restore only blanks produced by the first scenario importer; never replace edited text. */
export function restoreProvisionalScenarioText(document: MangaDocument): boolean {
  let changed = false;
  for (const { bubble } of scenarioBubbleEntries(document)) {
    const match = bubble.scenarioMatch;
    if (match?.status !== 'review' || match.provisionalText) continue;
    if (!bubble.text && match.ocrText) {
      bubble.text = match.ocrText;
    }
    match.provisionalText = true;
    changed = true;
  }
  return changed;
}

/** Edited dialogue is independent; keep only inert import history and OCR. */
export function useScenarioBubbleText(bubble: Bubble, text = bubble.text): void {
  const origin = [...scenarioOriginIds(bubble)];
  bubble.scenarioMatch = { ocrText: bubble.text, score: 0, ...bubble.scenarioMatch, sourceIds: [],
    ...(origin.length ? { resolvedSourceIds: origin } : {}), status: 'manual', provisionalText: true };
  bubble.text = text;
  if (bubble.analogTextImport) bubble.analogTextImport.needsReview = false;
}

/** No source row applies: retain the current text and release any source allocation. */
export function rejectScenarioCorrespondence(bubble: Bubble): void {
  useScenarioBubbleText(bubble);
  bubble.scenarioMatch!.status = 'unmatched';
  delete bubble.scenarioMatch!.resolvedSourceIds;
}

export function confirmScenarioCorrespondence(document: MangaDocument, location: ScenarioBubbleLocation, sourceIds: readonly string[]): void {
  const candidate = availableScenarioCandidates(document, location)
    .find(entry => entry.dialogues.map(dialogue => dialogue.id).join('|') === sourceIds.join('|'));
  if (!candidate) throw new Error('このセリフは別の吹き出しで使用中か、対象のページ・コマが異なります。');
  const page = document.manga.pages[location.pageIndex];
  const bubble = location.overlay ? page.page_overlay!.bubbles![location.bubbleIndex] : page.panels[location.panelIndex].bubbles[location.bubbleIndex];
  applyScenarioDialogue(bubble, candidate.dialogues, document.manga.characters, candidate.score, true);
}

/** Release only the link; retain the text and geometry while the user chooses a replacement. */
export function releaseScenarioCorrespondence(document: MangaDocument, location: ScenarioBubbleLocation): void {
  const page = document.manga.pages[location.pageIndex];
  const bubble = location.overlay ? page?.page_overlay?.bubbles?.[location.bubbleIndex] : page?.panels[location.panelIndex]?.bubbles[location.bubbleIndex];
  if (!bubble?.scenarioMatch) return;
  bubble.scenarioMatch.sourceIds = [];
  delete bubble.scenarioMatch.resolvedSourceIds;
  bubble.scenarioMatch.status = 'review';
  bubble.scenarioMatch.provisionalText = true;
}

/** Register an alias for future imports, never rewrite already resolved dialogue. */
export function linkScenarioSpeaker(document: MangaDocument, sourceName: string, characterId: string): void {
  const character = document.manga.characters.find(entry => entry.localId === characterId);
  if (!character || !document.manga.scenario) throw new Error('対応する登場人物を選択してください。');
  if (document.manga.characters.some(entry => entry !== character && [entry.name, ...(entry.aliases ?? [])]
    .some(name => speakerKey(name) === speakerKey(sourceName)))) throw new Error('この名前は別の登場人物に登録されています。登場人物の別名を確認してください。');
  if (![character.name, ...(character.aliases ?? [])].some(name => speakerKey(name) === speakerKey(sourceName))) {
    character.aliases = [...(character.aliases ?? []), sourceName];
  }
  const ids = new Set(scenarioDialogues(document.manga.scenario).filter(dialogue => speakerKey(dialogue.speaker) === speakerKey(sourceName)).map(dialogue => dialogue.id));
  for (const { bubble } of scenarioBubbleEntries(document)) {
    if (bubble.scenarioMatch?.status === 'review' && bubble.scenarioMatch.sourceIds.some(id => ids.has(id))) { bubble.speaker = character.name; bubble.speakerId = character.localId; }
  }
}
