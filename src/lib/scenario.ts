import type { MangaDocument, ScenarioSource, Bubble } from '../types.ts';
import { type ScenarioDialogue, speakerKey, scenarioSimilarity, parseScenario, SCENARIO_MATCH_THRESHOLD, applyScenarioDialogue, scenarioOriginIds, scenarioBubbleNeedsReview, scenarioDialogues } from './scenario/dialogueParsing.ts';
import { synchronizeCatalogReferences } from './catalogModel.ts';

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

export {
  SCENARIO_MATCH_THRESHOLD,
  scenarioSourceParts,
  parseScenario,
  scenarioMatchKey,
  scenarioSimilarity,
  scenarioCharacter,
  scenarioDialogues,
  applyScenarioDialogue,
  scenarioBubbleNeedsReview,
  scenarioOriginIds,
} from './scenario/dialogueParsing.ts';
export type { ScenarioDialogue, ScenarioPanel, ScenarioScript } from './scenario/dialogueParsing.ts';
