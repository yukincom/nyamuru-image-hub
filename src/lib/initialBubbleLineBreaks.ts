import type { BBox, MangaDocument } from '../types.ts';

// Basic JLREQ kinsoku, not a full Japanese typesetting engine. Word segmentation
// and these conservative suffix rules are layout hints, not semantic analysis.
const NO_START = /^[、。，．・：；？！!?‼⁉）〕］｝〉》」』】〙〗〟’”｠»ー々〻ゝゞヽヾぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ,.:;)\]}]/u;
const NO_END = /[（〔［｛〈《「『【〘〖〝‘“｟«(\[{]$/u;
const ATTACHED = new Set('は が を に へ と で も の から まで より だけ ほど など ね よ ぞ さ か です ます でした ました だ だった ない なかっ た て し さん くん 君 様 ちゃん'.split(' '));
const SENTENCE_END = /[、。，．！？!?」』）)]$/u;
const PHRASE_END = new Set('は が を に へ と で も から まで より けど ので'.split(' '));

/** Insert newlines only; preserve all original characters and explicit layout. */
export function initialBubbleLineBreaks(text: string, box?: Pick<BBox, 'w' | 'h'>, names: readonly string[] = []): string {
  // Explicit layout wins. Do not interpret '/' as a script marker in generic text.
  // Bound the quadratic planner; long prose remains editable with normal CSS wrap.
  if (text.length > 512 || /[\r\n\u2028\u2029\u3000\u00a0\t]/u.test(text) || typeof Intl.Segmenter !== 'function') return text;
  const graphemes = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)];
  const count = graphemes.length;
  if (count < 6) return text;
  const offsets = new Map(graphemes.map((part, index) => [part.index, index]));
  offsets.set(text.length, count);
  const protectedRanges: [number, number][] = [];
  for (const name of new Set(names.filter(name => name.trim().length > 0))) {
    for (let start = text.indexOf(name); start !== -1; start = text.indexOf(name, start + 1)) {
      protectedRanges.push([start, start + name.length]);
    }
  }
  // Keep URLs, ASCII identifiers and punctuation sequences together (including /).
  for (const match of text.matchAll(/https?:\/\/[^\s「」『』（）<>]+|[A-Za-z0-9][A-Za-z0-9_./:@%+?#=&~-]*|[\p{Script=Katakana}ー]+|[.…‥—―!?！？]+/gu)) {
    protectedRanges.push([match.index, match.index + match[0].length]);
  }
  const boundaries = [0];
  const phraseBoundaries = new Set<number>();
  let previousWord = '';
  for (const part of new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)) {
    const at = part.index;
    const before = previousWord;
    previousWord = part.segment;
    if (!at || !offsets.has(at) || ATTACHED.has(part.segment)) continue;
    // ICU can split inflections (くだ|さい, しな|け|れ|ば). Prefer fewer
    // columns over inventing breaks within kana chains or kanji + okurigana.
    if (/^\p{Script=Hiragana}/u.test(part.segment)
      && (/\p{Script=Han}$/u.test(before)
        || (/\p{Script=Hiragana}$/u.test(before) && !PHRASE_END.has(before)))) continue;
    if (NO_START.test(text.slice(at)) || NO_END.test(text.slice(0, at)) || /^\s/u.test(part.segment)) continue;
    if (protectedRanges.some(([start, end]) => start < at && at < end)) continue;
    boundaries.push(at);
    if (PHRASE_END.has(before)) phraseBoundaries.add(at);
  }
  boundaries.push(text.length);
  const aspect = box && Number.isFinite(box.h) && Number.isFinite(box.w) && box.w > 0 && box.h > 0
    ? Math.max(0.35, Math.min(6, box.h / box.w)) : 1.6;
  // N glyphs in K vertical columns: text height/width is approximately N/K².
  // Geometric heuristic only, NOT a statistically learned manga character count.
  const columns = Math.min(12, Math.floor(count / 3), Math.max(1, Math.round(Math.sqrt(count / aspect))));
  const end = boundaries.length - 1;
  let bestCost = Infinity;
  let bestText = text;
  for (let lines = Math.min(columns, end); lines >= 1; lines--) {
    const target = count / lines;
    const costs = Array.from({ length: lines + 1 }, () => Array<number>(end + 1).fill(Infinity));
    const previous = Array.from({ length: lines + 1 }, () => Array<number>(end + 1).fill(-1));
    costs[0][0] = 0;
    for (let line = 1; line <= lines; line++) for (let to = line; to <= end; to++) {
      for (let from = line - 1; from < to; from++) {
        const length = offsets.get(boundaries[to])! - offsets.get(boundaries[from])!;
        if (length < 2 || !Number.isFinite(costs[line - 1][from])) continue;
        const phrase = text.slice(boundaries[from], boundaries[to]);
        const boundaryCost = to === end || SENTENCE_END.test(phrase) || phraseBoundaries.has(boundaries[to]) ? 0 : 0.5;
        const cost = costs[line - 1][from] + ((length - target) / target) ** 2 + boundaryCost;
        if (cost < costs[line][to]) { costs[line][to] = cost; previous[line][to] = from; }
      }
    }
    if (!Number.isFinite(costs[lines][end])) continue;
    // Geometry proposes a column count, not a quota: allow fewer columns when
    // keeping phrases together otherwise produces very uneven line lengths.
    const cost = costs[lines][end] / lines + 0.3 * (columns - lines) ** 2;
    if (cost >= bestCost) continue;
    bestCost = cost;
    const result: string[] = [];
    let to = end;
    for (let line = lines; line > 0; line--) {
      const from = previous[line][to];
      result.unshift(text.slice(boundaries[from], boundaries[to]));
      to = from;
    }
    bestText = result.join('\n');
  }
  return bestText;
}

/** Call ONLY on the fresh creation draft, after OCR and authoritative scenario matching. */
export function initializeImportedBubbleLineBreaks(document: MangaDocument): void {
  if (document.manga.meta.text_orientation !== 'vertical') return;
  const names = document.manga.characters.flatMap(character => [character.name, ...(character.aliases ?? [])]);
  for (const page of document.manga.pages) {
    const bubbles = [...page.panels.flatMap(panel => panel.bubbles), ...(page.page_overlay?.bubbles ?? [])];
    for (const bubble of bubbles) bubble.text = initialBubbleLineBreaks(bubble.text, bubble.bbox, names);
  }
}
