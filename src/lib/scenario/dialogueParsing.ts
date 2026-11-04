import type { BubbleShape, Character, ScenarioSource, Bubble } from '../../types.ts';
import { vectorShape, defaultVectorStyle } from '../vectorGeometry.ts';
import { createBubbleBezier } from '../bubbleBezier.ts';

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

export function speakerKey(value: string): string { return value.normalize('NFKC').trim().toLocaleLowerCase('ja-JP'); }

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
