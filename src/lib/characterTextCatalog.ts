import type { Character, CharacterGender, CharacterRecognitionProfile, MangaDocument, Material } from '../types.ts';
import { cloneDocument } from './manga.ts';
import { newCatalogId, synchronizeCatalogReferences } from './catalogModel.ts';
import { isDetectedFigureCharacter, isSystemMobCharacter } from './systemCharacters.ts';
import { characterGenderLabel, parseCharacterGenderLabel } from './characterGender.ts';

export interface CharacterTextEntry {
  catalogId: string;
  name: string;
  role: string;
  gender?: CharacterGender;
  visualPrompt?: string;
  aliases: string[];
  headCount?: number;
  recognition?: CharacterRecognitionProfile;
}

export interface CharacterTextMergeResult {
  document: MangaDocument;
  added: number;
  updated: number;
}

const FIELD_LABELS: Array<{ key: keyof Omit<CharacterRecognitionProfile, 'analyzer'>; label: string }> = [
  { key: 'accessories', label: '装飾・固有マーク' },
  { key: 'hair', label: '髪型' },
  { key: 'face', label: '顔' },
  { key: 'silhouette', label: 'シルエット' },
  { key: 'outfit', label: '衣装' },
];

const MARKER_PATTERN = /^<!--\s*nyamuru-character\s+id="([A-Za-z0-9._-]{1,128})"\s*-->$/u;
const END_MARKER_PATTERN = /^<!--\s*\/nyamuru-character\s*-->$/u;
const CHARACTER_SECTION_NAMES = new Set([
  '登場人物設定', '登場人物', 'キャラクター', '人物設定', 'メインキャラクター', 'character', 'characters',
]);

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const cleaned = value.normalize('NFKC').trim();
    const key = cleaned.toLocaleLowerCase('ja-JP');
    if (!cleaned || seen.has(key)) return [];
    seen.add(key);
    return [cleaned];
  });
}

function lookup(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
}

function emptyRecognition(): CharacterRecognitionProfile {
  return {
    hair: { observed: [], inferred: [] },
    face: { observed: [], inferred: [] },
    silhouette: { observed: [], inferred: [] },
    outfit: { observed: [], inferred: [] },
    accessories: { observed: [], inferred: [] },
    ambiguous_design: { observed: [], inferred: [] },
  };
}

function cleanMarkdownLine(value: string): string {
  return value.trim()
    .replace(/^[-*+]\s+/u, '')
    .replace(/^\*\*(.*?)\*\*$/u, '$1')
    .trim();
}

function metadataValue(line: string, labels: readonly string[]): string {
  const normalized = cleanMarkdownLine(line);
  for (const label of labels) {
    const match = normalized.match(new RegExp(`^${label}\\s*[：:]\\s*(.+)$`, 'u'));
    if (match) return match[1].trim();
  }
  return '';
}

function characterStart(line: string): { name: string; legacy: boolean } | null {
  const heading = line.match(/^###\s+(.+?)(?:\s+#+)?$/u);
  if (heading) return { name: heading[1].trim(), legacy: false };
  const bold = line.match(/^\*\*([^*\n]{1,80})\*\*$/u);
  if (bold) return { name: bold[1].trim(), legacy: true };
  return null;
}

function isCharacterSectionHeading(value: string): boolean {
  return CHARACTER_SECTION_NAMES.has(value.normalize('NFKC').trim().toLocaleLowerCase('ja-JP'));
}

/** 人物設定Markdownを読み取る。標準見出しと、既存の「**人物名**」形式の両方を受け付ける。 */
export function parseCharacterText(source: string): CharacterTextEntry[] {
  const lines = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').split('\n');
  const entries: CharacterTextEntry[] = [];
  let current: CharacterTextEntry | null = null;
  let roleLines: string[] = [];
  let visualLines: string[] = [];
  let section = '';
  let pendingCatalogId = '';
  let insideCodeFence = false;
  let insideCharacterSection = true;

  const finish = () => {
    if (!current?.name.trim()) return;
    current.role = roleLines.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
    if (current.visualPrompt !== undefined) current.visualPrompt = visualLines.join('\n').trim();
    current.aliases = uniqueStrings(current.aliases);
    const hasRecognition = current.recognition && FIELD_LABELS.some(({ key }) => (
      current?.recognition?.[key].observed.length
    ));
    if (!hasRecognition) delete current.recognition;
    entries.push(current);
    current = null;
    roleLines = [];
    visualLines = [];
    section = '';
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^```/u.test(line)) {
      insideCodeFence = !insideCodeFence;
      continue;
    }
    if (insideCodeFence) continue;
    const marker = line.match(MARKER_PATTERN);
    if (marker) {
      pendingCatalogId = marker[1];
      continue;
    }
    if (END_MARKER_PATTERN.test(line)) {
      finish();
      pendingCatalogId = '';
      continue;
    }
    const containerHeading = line.match(/^(#{1,2})(?!#)\s+(.+?)(?:\s+#+)?$/u);
    if (containerHeading) {
      finish();
      insideCharacterSection = isCharacterSectionHeading(containerHeading[2]);
      continue;
    }
    const start = characterStart(line);
    if (start) {
      if (!insideCharacterSection && !pendingCatalogId) continue;
      finish();
      current = {
        catalogId: pendingCatalogId,
        name: start.name,
        role: '',
        aliases: [],
      };
      pendingCatalogId = '';
      section = start.legacy ? 'role' : '';
      continue;
    }
    if (!current) continue;

    const subheading = line.match(/^####\s+(.+?)(?:\s+#+)?$/u)?.[1]?.trim();
    if (subheading) {
      section = subheading;
      if (section === '画像生成用ビジュアルプロンプト') current.visualPrompt = '';
      continue;
    }
    if (section === '画像生成用ビジュアルプロンプト') {
      visualLines.push(rawLine);
      continue;
    }
    // 人物像からは推測せず、明示された性別欄だけを読む。
    const gender = cleanMarkdownLine(line).match(/^性別\s*[：:]\s*(.*)$/u);
    if (gender) {
      current.gender = parseCharacterGenderLabel(gender[1]);
      continue;
    }
    const aliases = metadataValue(line, ['別名', '呼び名']);
    if (aliases) {
      current.aliases.push(...aliases.split(/[、,]/u));
      continue;
    }
    const headCount = metadataValue(line, ['基準頭身', '等身']);
    if (headCount) {
      const value = Number(headCount.replace(/頭身$/u, '').trim());
      if (Number.isFinite(value) && value >= 1 && value <= 12) current.headCount = value;
      continue;
    }
    if (!line) {
      if ((section === '人物像' || section === 'role') && roleLines.at(-1) !== '') roleLines.push('');
      continue;
    }
    const recognitionField = FIELD_LABELS.find(({ label }) => section === label)?.key;
    if (recognitionField) {
      current.recognition ??= emptyRecognition();
      current.recognition[recognitionField].observed.push(cleanMarkdownLine(line));
      continue;
    }
    if (section === '人物像' || section === 'role' || !section) {
      roleLines.push(rawLine.trim());
    }
  }
  finish();
  return entries;
}

function mergeRecognition(current: CharacterRecognitionProfile | undefined, incoming: CharacterRecognitionProfile | undefined) {
  if (!incoming) return current ? structuredClone(current) : undefined;
  const merged = current ? structuredClone(current) : emptyRecognition();
  FIELD_LABELS.forEach(({ key }) => {
    merged[key].observed = uniqueStrings([...merged[key].observed, ...incoming[key].observed]);
  });
  return merged;
}

/** 参照テキストの人物を作業中OMNYへ統合する。既存人物はID、次に名前・別名で照合する。 */
export function mergeCharacterTextCatalog(source: MangaDocument, entries: readonly CharacterTextEntry[]): CharacterTextMergeResult {
  const next = cloneDocument(source);
  let added = 0;
  let updated = 0;
  for (const entry of entries) {
    const keys = new Set([entry.name, ...entry.aliases].map(lookup).filter(Boolean));
    const byId = entry.catalogId
      ? next.manga.characters.find((character) => character.catalog_id === entry.catalogId)
      : undefined;
    const byName = next.manga.characters.find((character) => (
      !isSystemMobCharacter(character)
      && [character.name, ...(character.aliases ?? [])].some((value) => keys.has(lookup(value)))
    ));
    const target = byId ?? byName;
    if (target) {
      if (entry.name) target.name = entry.name;
      if (entry.role) target.role = entry.role;
      if (entry.visualPrompt !== undefined) target.visual_prompt = entry.visualPrompt;
      if (entry.gender !== undefined) target.gender = entry.gender;
      if (entry.aliases.length) target.aliases = uniqueStrings([...(target.aliases ?? []), ...entry.aliases]);
      if (entry.headCount) target.default_proportion = { head_count: entry.headCount };
      target.recognition = mergeRecognition(target.recognition, entry.recognition);
      target.scope = 'series';
      target.catalog_id ||= entry.catalogId || newCatalogId('character');
      updated += 1;
      continue;
    }
    const character: Character = {
      localId: newCatalogId('person'),
      name: entry.name,
      role: entry.role,
      ...(entry.gender !== undefined ? { gender: entry.gender } : {}),
      ...(entry.visualPrompt !== undefined ? { visual_prompt: entry.visualPrompt } : {}),
      scope: 'series',
      catalog_id: entry.catalogId || newCatalogId('character'),
      ...(entry.aliases.length ? { aliases: [...entry.aliases] } : {}),
      ...(entry.headCount ? { default_proportion: { head_count: entry.headCount } } : {}),
      ...(entry.recognition ? { recognition: structuredClone(entry.recognition) } : {}),
    };
    next.manga.characters.push(character);
    added += 1;
  }
  synchronizeCatalogReferences(next);
  return { document: next, added, updated };
}

function markdownValue(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim();
}

function characterBlock(character: Character): string {
  const catalogId = character.catalog_id || newCatalogId('character');
  const lines = [
    `<!-- nyamuru-character id="${catalogId}" -->`,
    `### ${character.name.trim() || '名前未設定'}`,
  ];
  if (character.gender !== undefined) lines.push(`- 性別：${characterGenderLabel(character.gender)}`);
  if (character.aliases?.length) lines.push(`- 別名：${uniqueStrings(character.aliases).join('、')}`);
  if (character.default_proportion) lines.push(`- 基準頭身：${character.default_proportion.head_count}頭身`);
  lines.push('', '#### 人物像', '', markdownValue(character.role) || '未設定');
  if (character.visual_prompt !== undefined) lines.push('', '#### 画像生成用ビジュアルプロンプト', '', markdownValue(character.visual_prompt));
  FIELD_LABELS.forEach(({ key, label }) => {
    const values = character.recognition?.[key].observed ?? [];
    if (!values.length) return;
    lines.push('', `#### ${label}`, '', ...uniqueStrings(values).map((value) => `- ${value}`));
  });
  lines.push('', '<!-- /nyamuru-character -->');
  return lines.join('\n');
}

/** 双方向同期用の標準Markdown。システム人物とネーム検出用の一時人物は含めない。 */
export function toCharacterTextMarkdown(source: MangaDocument): string {
  const seriesId = source.manga.meta.series_id || '';
  const characters = source.manga.characters.filter((character) => (
    character.scope === 'series' && !isSystemMobCharacter(character) && !isDetectedFigureCharacter(character)
  ));
  const blocks = characters.map(characterBlock);
  return [
    `<!-- nyamuru-series-character-catalog v1 series-id="${seriesId}" -->`,
    '# 登場人物設定',
    '',
    '## キャラクター',
    '',
    ...blocks.flatMap((block, index) => index ? ['', block] : [block]),
    '<!-- /nyamuru-series-character-catalog -->',
    '',
  ].join('\n');
}

export function seriesCharacterCatalogIds(source: MangaDocument): string[] {
  return source.manga.characters.flatMap((character) => (
    character.scope === 'series' && character.catalog_id && !isSystemMobCharacter(character)
      ? [character.catalog_id]
      : []
  ));
}

/** 30日復元用に、対象人物と紐づくシリーズ資料だけを収めた最小文書を作る。 */
export function characterArchiveDocument(source: MangaDocument, characterCatalogId: string): MangaDocument {
  const next = cloneDocument(source);
  const owner = next.manga.characters.find((character) => character.catalog_id === characterCatalogId);
  const ownerLocalId = owner?.localId;
  next.manga.characters = owner ? [owner] : [];
  next.manga.materials = next.manga.materials.filter((material: Material) => (
    material.character_catalog_id === characterCatalogId || (ownerLocalId && material.characterId === ownerLocalId)
  ));
  next.manga.pages = [];
  next.manga.meta.page_count = 0;
  synchronizeCatalogReferences(next);
  return next;
}
