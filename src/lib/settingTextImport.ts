import { scenarioSourceParts } from './scenario.ts';

export interface ImportedStorySetting {
  location: string;
  time: string;
  weather: string;
  situation: string;
}

export interface ImportedStoryReference {
  seriesTitle: string;
  subtitle: string;
  episodeNumber: string;
  setting: ImportedStorySetting;
}

export interface ImportedSeriesSetting extends ImportedStorySetting {
  genre: string;
  targetAudience: string;
  adultContent: boolean;
}

type SettingKey = keyof ImportedStorySetting;

const LABELS: Record<SettingKey, readonly string[]> = {
  location: ['場所', '舞台', 'ロケーション'],
  time: ['時間帯', '時間', '時代'],
  weather: ['天候', '天気'],
  situation: ['あらすじ', 'ストーリーライン', 'ストーリー', '概要', 'プロット'],
};

function cleanLabel(value: string): string {
  return value.normalize('NFKC')
    .replace(/^\s{0,3}#{1,6}\s*/u, '')
    .replace(/[＊*_`~＃#「」『』【】\[\]()（）\s]/gu, '')
    .replace(/[：:]$/u, '');
}

function settingKeyForLabel(value: string): SettingKey | null {
  const normalized = cleanLabel(value);
  for (const [key, labels] of Object.entries(LABELS) as [SettingKey, readonly string[]][]) {
    if (labels.includes(normalized)) return key;
  }
  return null;
}

function cleanContentLine(value: string): string {
  return value
    .replace(/^\s*(?:[-*+]\s+|>\s*)/u, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`~]/gu, '')
    .trim();
}

function append<Key extends string>(target: Record<Key, string[]>, key: Key, value: string): void {
  const cleaned = cleanContentLine(value);
  if (cleaned) target[key].push(cleaned);
}

/**
 * Markdownまたは単純なテキストから舞台設定を決定的に抽出する。
 * 見出しや「項目: 内容」を優先し、あらすじ見出しが無ければ本文全体をあらすじへ残す。
 */
export function parseSettingText(source: string): ImportedStorySetting {
  const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').trim();
  const collected: Record<SettingKey, string[]> = { location: [], time: [], weather: [], situation: [] };
  if (!normalized) return { location: '', time: '', weather: '', situation: '' };

  let activeKey: SettingKey | null = null;
  let insideCodeFence = false;
  for (const rawLine of normalized.split('\n')) {
    const trimmed = rawLine.trim();
    if (/^```/u.test(trimmed)) {
      insideCodeFence = !insideCodeFence;
      continue;
    }
    if (insideCodeFence) continue;

    const heading = trimmed.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/u);
    if (heading) {
      const headingValue = heading[1].trim();
      const inline = headingValue.match(/^(.{1,24}?)[：:]\s*(.+)$/u);
      if (inline) {
        const key = settingKeyForLabel(inline[1]);
        activeKey = key;
        if (key) append(collected, key, inline[2]);
      } else {
        activeKey = settingKeyForLabel(headingValue);
      }
      continue;
    }

    const labeled = trimmed.match(/^(?:[-*+]\s*)?(?:\*\*|__)?(.{1,24}?)(?:\*\*|__)?(?:\s*[：:]\s*|\s{2,}|　+)(.+)$/u);
    if (labeled) {
      const key = settingKeyForLabel(labeled[1]);
      if (key) {
        append(collected, key, labeled[2]);
        continue;
      }
    }

    const standaloneKey = settingKeyForLabel(trimmed);
    if (standaloneKey) {
      activeKey = standaloneKey;
      continue;
    }
    if (activeKey && trimmed) append(collected, activeKey, trimmed);
  }

  const plainText = normalized.split('\n')
    .map((line) => cleanContentLine(line.replace(/^\s{0,3}#{1,6}\s*/u, '')))
    .filter((line) => line && !/^---+$/u.test(line) && !/^```/u.test(line))
    .join('\n')
    .trim();

  return {
    location: collected.location.join('\n').trim(),
    time: collected.time.join('\n').trim(),
    weather: collected.weather.join('\n').trim(),
    situation: collected.situation.join('\n').trim() || plainText,
  };
}

type SeriesSettingKey = SettingKey | 'genre' | 'targetAudience' | 'adultContent';

const SERIES_SETTING_LABELS: Record<SeriesSettingKey, readonly string[]> = {
  location: ['基本の場所', '主な場所', 'シリーズの場所'],
  time: ['基本の時間帯', 'シリーズの時間帯'],
  weather: ['基本の天候', 'シリーズの天候'],
  genre: ['ジャンル', '作品ジャンル'],
  targetAudience: ['対象読者', '読者層', '想定読者'],
  adultContent: ['成人指定', '成人向け', 'R18', 'R-18', '18禁'],
  situation: ['シリーズの舞台', '世界観', 'シリーズ設定'],
};

function seriesSettingKeyForLabel(value: string, insideSeriesSection: boolean): SeriesSettingKey | null {
  const normalized = cleanLabel(value);
  for (const [key, labels] of Object.entries(SERIES_SETTING_LABELS) as [SeriesSettingKey, readonly string[]][]) {
    if (labels.includes(normalized)) return key;
  }
  return insideSeriesSection ? settingKeyForLabel(value) : null;
}

function adultContentValue(value: string): boolean {
  const normalized = cleanContentLine(value).normalize('NFKC').replace(/[\s_]/gu, '').toLocaleLowerCase('ja-JP');
  return ['あり', '有', 'true', 'yes', '1', '成人向け', 'r18', 'r-18', '18禁', '指定あり', '対象'].includes(normalized);
}

/** シリーズ資料から、明示された作品分類・世界観・各話の初期値を抽出する。本文全体を世界観として推定しない。 */
export function parseSeriesSettingText(source: string): ImportedSeriesSetting {
  const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').trim();
  const collected: Record<SeriesSettingKey, string[]> = {
    location: [], time: [], weather: [], situation: [], genre: [], targetAudience: [], adultContent: [],
  };
  if (!normalized) return {
    location: '', time: '', weather: '', situation: '', genre: '', targetAudience: '', adultContent: false,
  };

  let activeKey: SeriesSettingKey | null = null;
  let insideSeriesSection = false;
  let seriesSectionLevel = 0;
  let insideCodeFence = false;
  for (const rawLine of normalized.split('\n')) {
    const trimmed = rawLine.trim();
    if (/^```/u.test(trimmed)) {
      insideCodeFence = !insideCodeFence;
      continue;
    }
    if (insideCodeFence) continue;

    const heading = trimmed.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/u);
    if (heading) {
      const level = heading[1].length;
      const label = heading[2].trim();
      const explicitKey = seriesSettingKeyForLabel(label, false);
      const isSeriesContainer = ['シリーズ共通', 'シリーズ資料', 'シリーズ基本設定'].includes(cleanLabel(label));
      if (isSeriesContainer) {
        insideSeriesSection = true;
        seriesSectionLevel = level;
        activeKey = null;
        continue;
      }
      if (insideSeriesSection && level <= seriesSectionLevel) insideSeriesSection = false;
      activeKey = explicitKey ?? seriesSettingKeyForLabel(label, insideSeriesSection);
      continue;
    }

    const labeled = trimmed.match(/^(?:[-*+]\s*)?(?:\*\*|__)?(.{1,24}?)(?:\*\*|__)?(?:\s*[：:]\s*|\s{2,}|　+)(.+)$/u);
    if (labeled) {
      const key = seriesSettingKeyForLabel(labeled[1], insideSeriesSection);
      if (key) {
        append(collected, key, labeled[2]);
        activeKey = key;
        continue;
      }
    }
    if (activeKey && trimmed) append(collected, activeKey, trimmed);
  }

  return {
    location: collected.location.join('\n').trim(),
    time: collected.time.join('\n').trim(),
    weather: collected.weather.join('\n').trim(),
    situation: collected.situation.join('\n').trim(),
    genre: collected.genre.join('・').trim(),
    targetAudience: collected.targetAudience.join('・').trim(),
    adultContent: adultContentValue(collected.adultContent.at(-1) ?? ''),
  };
}

type ReferenceMetaKey = 'seriesTitle' | 'subtitle' | 'episodeNumber';

function unquote(value: string): string {
  return value.trim().replace(/^[「『“"]\s*/u, '').replace(/\s*[」』”"]$/u, '').trim();
}

/** シリーズ資料の明示名を優先し、汎用の設定見出しや人物名は作品名にしない。 */
export function parseSeriesTitleText(source: string, allowDocumentTitle = true): string {
  const titleLabels = ['シリーズ名', 'シリーズ', '作品タイトル', 'タイトル'];
  const sectionLabels = new Set([
    ...titleLabels, 'シリーズ設定', 'シリーズ資料', 'シリーズ共通', 'シリーズ基本設定',
    '設定', '基本情報', '人物設定', '登場人物', '登場人物設定', 'キャラクター設定',
    ...Object.values(SERIES_SETTING_LABELS).flat(), ...Object.values(LABELS).flat(),
  ]);
  let documentTitle = '';
  let awaitingTitle = false;
  let fence = '';
  for (const raw of source.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = raw.trim();
    const marker = line.match(/^(`{3,}|~{3,})/u)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = '';
      continue;
    }
    if (fence || !line) continue;
    const heading = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/u);
    const content = cleanContentLine(heading ? heading[2] : line);
    if (sectionLabels.has(cleanLabel(content)) && !titleLabels.includes(cleanLabel(content))) {
      awaitingTitle = false;
      continue;
    }
    const explicit = content.match(/^(?:シリーズ名|シリーズ|作品タイトル|タイトル)(?:\s*[：:]\s*|\s+|(?=[「『“"]))(.+)$/u);
    if (explicit) return unquote(explicit[1]);
    if (titleLabels.includes(cleanLabel(content))) {
      awaitingTitle = true;
      continue;
    }
    const labeledKey = content.match(/^(.{1,24}?)[：:]/u)?.[1];
    if (awaitingTitle && !heading && (!labeledKey || !sectionLabels.has(cleanLabel(labeledKey)))) return unquote(content);
    awaitingTitle = false;
    if (allowDocumentTitle && heading?.[1] === '#' && !sectionLabels.has(cleanLabel(content))) {
      documentTitle ||= unquote(content);
    }
  }
  return documentTitle;
}

function referenceMeta(value: string): { key: ReferenceMetaKey; value: string } | null {
  const cleaned = cleanContentLine(value).normalize('NFKC').trim();
  const labels: [ReferenceMetaKey, RegExp][] = [
    ['seriesTitle', /^(?:シリーズ名|シリーズ|作品タイトル|タイトル)\s*(?:[：:]\s*)?(.+)$/u],
    ['subtitle', /^(?:サブタイトル|話タイトル|エピソードタイトル)\s*(?:[：:]\s*)?(.+)$/u],
    ['episodeNumber', /^(?:話数|エピソード番号)\s*(?:[：:]\s*)?(.+)$/u],
  ];
  for (const [key, pattern] of labels) {
    const match = cleaned.match(pattern);
    if (match) return { key, value: unquote(match[1]) };
  }
  if (/^第?\s*[0-9]+(?:\.[0-9]+)?\s*話$/u.test(cleaned)) {
    return { key: 'episodeNumber', value: cleaned.replace(/\s+/gu, '') };
  }
  return null;
}

/**
 * 新規作成時の参照文書から作品名・サブタイトル・話数と舞台設定をまとめて抽出する。
 * 一般的なH1タイトルと「項目: 値」を優先し、旧来の「シリーズ『…』」見出しも受け付ける。
 */
export function parseStoryReferenceText(source: string): ImportedStoryReference {
  const normalized = scenarioSourceParts(source).metadata.trim();
  const metadata: Record<ReferenceMetaKey, string> = { seriesTitle: '', subtitle: '', episodeNumber: '' };
  let insideCodeFence = false;

  for (const rawLine of normalized.split('\n')) {
    const trimmed = rawLine.trim();
    if (/^```/u.test(trimmed)) {
      insideCodeFence = !insideCodeFence;
      continue;
    }
    if (insideCodeFence || !trimmed) continue;

    const heading = trimmed.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/u);
    const content = heading ? heading[2] : trimmed;
    const explicit = referenceMeta(content);
    if (explicit) {
      metadata[explicit.key] ||= explicit.value;
      continue;
    }

    // H1はMarkdown文書の標準的な作品名として扱う。設定項目の見出しは除外する。
    if (heading?.[1] === '#' && !settingKeyForLabel(content)) {
      metadata.seriesTitle ||= unquote(cleanContentLine(content));
    }
  }

  return {
    ...metadata,
    setting: parseSettingText(normalized),
  };
}
