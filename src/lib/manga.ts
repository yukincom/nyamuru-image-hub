import { backgroundMaterialStages } from './background3d.ts';
import { validateHumanPoseSelection } from './humanPoseSelection.ts';
import { validateImagePlacements } from './imagePlacement.ts';
import { parse, stringify } from 'yaml';
import { validatePrintData } from './printSettings.ts';
import type { Bubble, CharacterRecognitionProfile, CharacterReferenceSourceImage, Manga, MangaDocument, MangaPage, Panel, ValidationIssue, VisualEvidence } from '../types';
import { DEFAULT_BUBBLE_LINE_WIDTH_MM, normalizedBubbleLineWidth } from './bubblePresentation.ts';
import { detachResolvedScenarioLinks, restoreProvisionalScenarioText, validateScenarioSource } from './scenario.ts';
import { initializePanelBackgrounds } from './panelContext.ts';
import { isBubbleBezier } from './bubbleBezier.ts';
import {validTextStyle,validTextWeights} from './textStyle.ts';
import { materialBubbleBezier } from './bubblePresetData.ts';
import { normalizeBubbleConnections } from './bubbleConnections.ts';
import { normalizePanelLayer } from './panelLayers.ts';
import { ensureSystemMobCharacter, isDetectedFigureCharacter } from './systemCharacters.ts';
import { isCharacterGender } from './characterGender.ts';
import { DEFAULT_CANVAS, innerFrameBounds, DEFAULT_PANEL_GUTTERS, type CanvasSize, type PanelGutterSettings } from './canvasGeometry.ts';
import { isPropPlacement, synchronizeCatalogReferences, toOmnyCatalogDocument } from './catalogModel.ts';
import { applyArtworkSettings, compileArtworkForMode, compileArtworkRules, getArtworkMode, getArtworkSettings, parseArtworkSettings, type ArtworkTarget } from './artworkRules.ts';
import { finishLayoutInstruction, getFinishLayout, getOutputSettings, validateFinishSettings } from './finishLayout.ts';
import { toEditableArtworkText, toEditableMangaFormat, toEnglishArtworkText, toEnglishMangaFormat } from './artworkEnglish.ts';

export const STORAGE_KEY = 'manga-name-studio.document.v1';
export const NDM_SCHEMA_NAME = 'Nyamuru Data Model' as const;
export const CURRENT_NDM_SCHEMA_VERSION = 10.33;
export const OMAY_SPEC_NAME = 'Open Manga Artwork YAML' as const;
const LEGACY_OMNY_SCHEMA_NAME = 'Open Manga Name YAML';
export const BUBBLE_SHAPES = ['normal', 'thought', 'square', 'caption', 'flash', 'uniflash', 'wobbly', 'whisper', 'handwritten', 'critical', 'tense', 'toge', 'announce', 'toge_natural'] as const;
export const ANCHORS = ['right', 'left', 'center', 'top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;
export const ANCHOR_LABELS: Record<(typeof ANCHORS)[number], string> = {
  right: '右',
  left: '左',
  center: '中央',
  'top-right': '右上',
  'top-left': '左上',
  'bottom-right': '右下',
  'bottom-left': '左下',
};
export const FIGURE_SIZES = ['long', 'full', 'knee-up', 'waist-up', 'bust-up', 'shoulder-up', 'face', 'face-detail', 'hand', 'foot', 'part'] as const;
export const FIGURE_SIZE_LABELS: Record<(typeof FIGURE_SIZES)[number], string> = {
  long: 'ロングショット',
  full: '全身',
  'knee-up': '膝から上',
  'waist-up': '腰から上',
  'bust-up': '胸から上',
  'shoulder-up': '肩から上',
  face: '顔',
  'face-detail': '大アップ',
  hand: '手',
  foot: '足',
  part: '身体の一部',
};
export const FIGURE_ROLES = ['main', 'sub'] as const;
export const FIGURE_ROLE_LABELS: Record<(typeof FIGURE_ROLES)[number], string> = { main: 'メイン', sub: 'サブ' };
export const MATERIAL_SCOPES = ['episode', 'series'] as const;
export const BLEED_EDGES = ['left', 'right', 'top', 'bottom'] as const;
export const SCREEN_TEXT_ORIENTATIONS = ['horizontal', 'vertical'] as const;
export const MAX_PANELS_PER_PAGE = 10;
export const DEFAULT_PANEL_FRAME_LINE_WIDTH_MM = 1;
const PANEL_FRAME_STYLE_NOTE_PREFIX = '[style] コマ枠線幅:';
const PANEL_GUTTER_STYLE_NOTE_PREFIX = '[layout] コマ間隔:';
const TEXT_FLOW_STYLE_NOTE = '[const] セリフはOMNY記載どおりの日本語を使用する。文字の組み方向はOMNYの meta.text_orientation、ページとコマの読み方向は meta.reading_direction に従う';
const READING_STYLE_NOTE = '[const] コマはOMNYの meta.reading_direction と id 番号の昇順に従って読む。right-to-left の場合、同一行では右端のコマを最小の id とし、右上→左下の順を崩さない';
const FORMAT_STYLE_NOTE = '[style] 作品の出力形式はOMNYの meta.format に従う。カラー漫画は線画＋ベタ塗り（必要に応じてグラデーション）、モノクロ漫画は白黒線画＋ベタ・スクリーントーン、グレースケール漫画は灰色階調で描く';
const FONT_STYLE_NOTE = '[style] 本文、心の声、キャプションのフォントはOMNYの meta.font に従う。meta.font が『アンチック体』の場合は、漢字＝ゴシック体、ひらがな・カタカナ＝明朝体の混植として描く';
const PANEL_LAYOUT_STYLE_LINE = '- [style] 通常の辺(bleed なし): コマ枠線の太さはOMNYの meta.panel_frame_width_mm、隣接コマの上下・左右間隔は meta.panel_gutter_row_mm / meta.panel_gutter_column_mm に従う。隣接コマの枠線は共有せず独立して描く';

function normalizedFrameLineWidth(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.min(5, Math.max(0.1, value)) * 10) / 10;
}

/** 旧OMNYの枠線幅を読み取るために残している移行用ヘルパー。 */
export function withPanelFrameLineWidthStyleNote(notes: readonly string[], widthMm: number): string[] {
  const width = normalizedFrameLineWidth(widthMm);
  const frameNote = `${PANEL_FRAME_STYLE_NOTE_PREFIX} ${width}mm。通常の辺(bleed なし): 外周に約2〜3mmの白マージンを取り、太さ約${width}mmの黒い枠線を描く。隣接コマの枠線は共有せず独立して描く`;
  let replaced = false;
  const next = notes.flatMap((note) => {
    if (!note.startsWith(PANEL_FRAME_STYLE_NOTE_PREFIX) && !note.includes('通常の辺(bleed なし)')) return [note];
    if (replaced) return [];
    replaced = true;
    return [frameNote];
  });
  return replaced ? next : [...next, frameNote];
}

/** 専用の作画指定が無い既存作品は、従来の編集画面表示幅を維持する。 */
export function panelFrameLineWidthFromStyleNotes(
  notes: readonly string[],
  fallback = DEFAULT_PANEL_FRAME_LINE_WIDTH_MM,
): number {
  const note = notes.find((item) => item.startsWith(PANEL_FRAME_STYLE_NOTE_PREFIX));
  const match = note?.slice(PANEL_FRAME_STYLE_NOTE_PREFIX.length).match(/\s*([0-9]+(?:\.[0-9]+)?)\s*mm/i);
  return match ? normalizedFrameLineWidth(Number(match[1])) : fallback;
}

function normalizedPanelGutters(settings: PanelGutterSettings): PanelGutterSettings {
  const normalize = (value: number, fallback: number) => Number.isFinite(value)
    ? Math.round(Math.min(20, Math.max(0, value)) * 10) / 10
    : fallback;
  return {
    rowGapMm: normalize(settings.rowGapMm, DEFAULT_PANEL_GUTTERS.rowGapMm),
    columnGapMm: normalize(settings.columnGapMm, DEFAULT_PANEL_GUTTERS.columnGapMm),
  };
}

/** 旧OMNYのコマ間隔を読み取るために残している移行用ヘルパー。 */
export function withPanelGutterStyleNote(notes: readonly string[], settings: PanelGutterSettings): string[] {
  const gutters = normalizedPanelGutters(settings);
  const gutterNote = `${PANEL_GUTTER_STYLE_NOTE_PREFIX} 上下${gutters.rowGapMm}mm・左右${gutters.columnGapMm}mm`;
  let replaced = false;
  const next = notes.flatMap((note) => {
    if (!note.startsWith(PANEL_GUTTER_STYLE_NOTE_PREFIX)) return [note];
    if (replaced) return [];
    replaced = true;
    return [gutterNote];
  });
  return replaced ? next : [...next, gutterNote];
}

/** 保存値がない既存作品では、現在のコマ座標から推定した間隔をフォールバックに使う。 */
export function panelGuttersFromStyleNotes(
  notes: readonly string[],
  fallback: PanelGutterSettings = DEFAULT_PANEL_GUTTERS,
): PanelGutterSettings {
  const note = notes.find((item) => item.startsWith(PANEL_GUTTER_STYLE_NOTE_PREFIX));
  const match = note?.slice(PANEL_GUTTER_STYLE_NOTE_PREFIX.length).match(/上下\s*([0-9]+(?:\.[0-9]+)?)\s*mm・左右\s*([0-9]+(?:\.[0-9]+)?)\s*mm/i);
  return match
    ? normalizedPanelGutters({ rowGapMm: Number(match[1]), columnGapMm: Number(match[2]) })
    : normalizedPanelGutters(fallback);
}

function withoutLegacyPanelSettingNotes(notes: readonly string[]): string[] {
  return notes.filter((note) => (
    !note.startsWith(PANEL_FRAME_STYLE_NOTE_PREFIX)
    && !note.startsWith(PANEL_GUTTER_STYLE_NOTE_PREFIX)
    && !note.includes('通常の辺(bleed なし)')
  ));
}

function migrateLegacyStyleNotes(notes: readonly string[]): string[] {
  return notes.map((note) => {
    if (note.startsWith('[const] セリフはOMNY記載どおりの日本語を使用し、全て縦書き')) return TEXT_FLOW_STYLE_NOTE;
    if (note.startsWith('[const] ページは右綴じ、コマは右上→左下の順')) return READING_STYLE_NOTE;
    if (note.startsWith('[style] カラー漫画。線画＋ベタ塗り')) return FORMAT_STYLE_NOTE;
    if (/アンチック体.*漢字[=＝]明朝体.*(?:かな|ひらがな・カタカナ)[=＝]ゴシック体/.test(note)) return FONT_STYLE_NOTE;
    return note;
  });
}

function migrateLegacyLayoutSpec(source: string): string {
  return source.replace(
    /^\s*- \[style\] 通常の辺\(bleed なし\): 外周に約2〜3mmの白マージンを取り、太さ約1mmの黒い枠線を描く。隣接コマの枠線は共有せず独立して描く\s*$/mu,
    PANEL_LAYOUT_STYLE_LINE,
  );
}

const CHARACTER_RECOGNITION_FIELDS = ['hair', 'face', 'silhouette', 'outfit', 'accessories', 'ambiguous_design'] as const;
const CHARACTER_REFERENCE_VIEW_VALUES = ['turnaround', 'front', 'three-quarter', 'side', 'back', 'expression', 'costume', 'other'] as const;
const CHARACTER_REFERENCE_ASSET_PATTERN = /^image-[a-f0-9]{64}$/u;
const CHARACTER_REFERENCE_PATH_PATTERN = /^characters\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/(image-[a-f0-9]{64})\.png$/u;

function normalizedUniqueStrings(value: unknown, limit = 16): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const keys = new Set<string>();
  value.forEach((item) => {
    if (typeof item !== 'string' || result.length >= limit) return;
    const text = item.normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, 300);
    const key = text.toLocaleLowerCase('ja-JP');
    if (!text || keys.has(key)) return;
    keys.add(key);
    result.push(text);
  });
  return result;
}

function normalizedEvidence(value: unknown): VisualEvidence {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    observed: normalizedUniqueStrings(record.observed),
    inferred: normalizedUniqueStrings(record.inferred),
  };
}

function normalizedRecognition(value: unknown): CharacterRecognitionProfile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const normalized = Object.fromEntries(
    CHARACTER_RECOGNITION_FIELDS.map((field) => [field, normalizedEvidence(record[field])]),
  ) as unknown as CharacterRecognitionProfile;
  const analyzer = record.analyzer && typeof record.analyzer === 'object' && !Array.isArray(record.analyzer)
    ? record.analyzer as Record<string, unknown>
    : null;
  if (analyzer?.provider === 'local' && analyzer.runtime === 'mlx-vlm') {
    normalized.analyzer = {
      provider: 'local',
      runtime: 'mlx-vlm',
      model: typeof analyzer.model === 'string' ? analyzer.model.slice(0, 300) : '',
      prompt_version: typeof analyzer.prompt_version === 'string' ? analyzer.prompt_version.slice(0, 100) : '',
      analyzed_at: typeof analyzer.analyzed_at === 'string' ? analyzer.analyzed_at.slice(0, 100) : '',
    };
  }
  return normalized;
}

function normalizedCharacterSourceImage(value: unknown): CharacterReferenceSourceImage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const assetId = typeof record.asset_id === 'string' ? record.asset_id.trim() : '';
  const fileName = typeof record.file_name === 'string' ? record.file_name.trim() : '';
  const originalName = typeof record.original_name === 'string' ? record.original_name.trim().slice(0, 255) : '';
  const sha256 = typeof record.sha256 === 'string' ? record.sha256.trim() : '';
  const pathMatch = fileName.match(CHARACTER_REFERENCE_PATH_PATTERN);
  const byteSize = Number(record.byte_size);
  const width = Number(record.width_px);
  const height = Number(record.height_px);
  if (record.schema_version !== 1
    || record.media_type !== 'image/png'
    || !CHARACTER_REFERENCE_ASSET_PATTERN.test(assetId)
    || !/^[a-f0-9]{64}$/u.test(sha256)
    || assetId !== `image-${sha256}`
    || pathMatch?.[1] !== assetId
    || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > 40 * 1024 * 1024
    || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > 12000 || height > 12000 || width * height > 60_000_000) {
    return undefined;
  }
  return {
    schema_version: 1,
    asset_id: assetId,
    file_name: fileName,
    ...(originalName && !/[\\/]/u.test(originalName) ? { original_name: originalName } : {}),
    media_type: 'image/png',
    byte_size: byteSize,
    width_px: width,
    height_px: height,
    sha256,
  };
}

export function parseMangaYaml(source: string): MangaDocument {
  const value = parse(source) as MangaDocument;
  if (!value || typeof value !== 'object' || !value.manga) throw new Error('ルートに manga がありません');
  return normalizeDocument(value);
}

function stringifyMangaDocument(document: MangaDocument): string {
  return stringify(document, { indent: 2, lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' });
}

function withoutLocalAnalogImports(document: MangaDocument): MangaDocument {
  const next = cloneDocument(document);
  delete next.manga.scenario;
  next.manga.pages.forEach((page) => {
    page.panels.forEach((panel) => {
      // v1.13.2の短期間だけ保存されていた背景重複情報と旧コマ別書体を出力しない。
      const legacyPanel = panel as Panel & { font?: string; splitOverlapBackground?: true; splitOverlapBackgroundId?: string };
      delete legacyPanel.font;
      delete legacyPanel.splitOverlapBackground;
      delete legacyPanel.splitOverlapBackgroundId;
      panel.figures?.forEach((figure) => { delete figure.analogImport; delete figure.splitOverlap; delete figure.splitOverlapId; });
      panel.bubbles.forEach((bubble) => { delete bubble.scenarioMatch; delete bubble.analogTextImport; delete bubble.splitOverlap; delete bubble.splitOverlapId; delete bubble.anchor; });
      panel.screen_text?.forEach((screenText) => { delete screenText.splitOverlap; delete screenText.splitOverlapId; });
    });
    page.page_overlay?.figures?.forEach((figure) => { delete figure.analogImport; delete figure.splitOverlap; delete figure.splitOverlapId; });
    page.page_overlay?.bubbles?.forEach((bubble) => { delete bubble.scenarioMatch; delete bubble.analogTextImport; delete bubble.splitOverlap; delete bubble.splitOverlapId; delete bubble.anchor; });
    page.page_overlay?.screen_text?.forEach((screenText) => { delete screenText.splitOverlap; delete screenText.splitOverlapId; });
  });
  return next;
}

/** コピー・ダウンロード用OMNY。ローカル画像への参照は含めない。 */
export function toMangaYaml(document: MangaDocument): string {
  return stringifyMangaDocument(mangaExportDocument(document, true));
}

function mangaExportDocument(document: MangaDocument, includeArtwork: boolean): MangaDocument {
  const next = toOmnyCatalogDocument(document);
  restoreProvisionalScenarioText(next);
  initializePanelBackgrounds(next);
  delete (next.manga as Manga & { finish_layout?: unknown }).finish_layout;
  if (next.manga.artwork_settings) applyArtworkSettings(next.manga, next.manga.artwork_settings);
  const exported = { manga: { ...next.manga, finish_layout: getFinishLayout(next.manga) } };
  if (includeArtwork && next.manga.finish_settings) exported.manga.meta.style_notes = [...exported.manga.meta.style_notes.filter(note => note !== finishLayoutInstruction()), finishLayoutInstruction()];
  exported.manga.meta.format = toEnglishMangaFormat(exported.manga.meta.format);
  if (includeArtwork) {
    exported.manga.meta.style_notes = exported.manga.meta.style_notes.map(toEnglishArtworkText);
    exported.manga.layout_spec = toEnglishArtworkText(exported.manga.layout_spec);
  } else {
    delete (exported.manga.meta as Partial<Manga['meta']>).style_notes;
    delete (exported.manga as Partial<Manga>).layout_spec;
  }
  delete exported.manga.artwork_settings;
  return withoutLocalAnalogImports(exported);
}

/** ブラウザの自動保存専用。IndexedDBの切り抜き画像へ再接続するメタデータも保持する。 */
export function toStoredMangaYaml(document: MangaDocument): string {
  const next = cloneDocument(document);
  detachResolvedScenarioLinks(next);
  restoreProvisionalScenarioText(next);
  initializePanelBackgrounds(next);
  if (next.manga.artwork_settings) applyArtworkSettings(next.manga, next.manga.artwork_settings);
  synchronizeCatalogReferences(next);
  return stringifyMangaDocument(next);
}

// ストーリーOMNY：作画・演出ルール（style_notes）とレイアウト仕様（layout_spec）を含まないネームデータ
export function toSeparatedMangaYaml(document: MangaDocument): string {
  return stringifyMangaDocument(mangaExportDocument(document, false));
}

/** シリーズ共通人物・素材・作品分類・世界観を収めた、再利用可能なOMNYカタログ。 */
export function toSeriesCatalogMangaYaml(
  document: MangaDocument,
  options: { seriesSetting?: Manga['series_setting'] } = {},
): string {
  const next = toOmnyCatalogDocument(document, { includeSeriesImages: true });
  next.manga.meta.document_type = 'series-catalog';
  next.manga.meta.title = next.manga.meta.series.trim() || next.manga.meta.title;
  next.manga.meta.author = '';
  next.manga.meta.page_count = 0;
  next.manga.meta.style_notes = [];
  next.manga.layout_spec = '';
  delete next.manga.artwork_settings;
  next.manga.series_setting = structuredClone(options.seriesSetting ?? document.manga.series_setting);
  delete next.manga.finish_settings;
  delete next.manga.print_settings;
  delete (next.manga as Manga & { finish_layout?: unknown }).finish_layout;
  next.manga.setting = { location: '', time: '', weather: '', situation: '' };
  next.manga.characters = next.manga.characters.filter((character) => character.scope === 'series');
  next.manga.materials = next.manga.materials.filter((material) => material.scope === 'series');
  next.manga.background_stages=backgroundMaterialStages(document,'series').map(stage=>({...stage,seriesId:document.manga.meta.series_id}));
  if(!next.manga.background_stages.length)delete next.manga.background_stages;
  next.manga.pages = [];
  return stringifyMangaDocument(withoutLocalAnalogImports(next));
}

// 画像生成指示ファイル OMAY（Open Manga Artwork YAML）
export interface OmayDocument {
  spec_name: string;
  spec_version?: number | string;
  style_notes: string[];
  layout_spec: string;
  artwork_settings?: Manga['artwork_settings'];
}

export function parseOmayYaml(source: string): OmayDocument {
  const value = parse(source) as Partial<OmayDocument> | null;
  if (!value || typeof value !== 'object') throw new Error('作画設定のYAMLとして解釈できません');
  if (!Array.isArray(value.style_notes) || typeof value.layout_spec !== 'string') {
    throw new Error('style_notes（配列）と layout_spec（複数行テキスト）が必要です');
  }
  return {
    spec_name: typeof value.spec_name === 'string' ? value.spec_name : OMAY_SPEC_NAME,
    spec_version: typeof value.spec_version === 'number' || typeof value.spec_version === 'string' ? value.spec_version : undefined,
    style_notes: value.style_notes.map(note => toEditableArtworkText(String(note))),
    layout_spec: toEditableArtworkText(value.layout_spec),
    ...(value.artwork_settings !== undefined ? { artwork_settings: parseArtworkSettings(value.artwork_settings) } : {}),
  };
}

// OMAYの版数はOMNYのschema_versionと独立して管理するため、書き出しには刻印しない
export function toOmayYaml(document: MangaDocument, target?: ArtworkTarget): string {
  const settings = getArtworkSettings(document.manga);
  const mode = getArtworkMode(settings);
  const rules = target ? compileArtworkRules(settings, target) : compileArtworkForMode(settings, mode);
  const notes = target === 'character'
    ? [...rules.style_notes, '[const] Use finish_layout.format for the final color treatment and finish_layout.dpi for final placement. Its physical dimensions and trim_pixels / bleed_pixels describe the final page, not a full-page character image. Generate only the requested character; do not add page borders or text. Native model resolution is separate from the final print resolution.']
    : document.manga.finish_settings
      ? [...rules.style_notes.filter(note => note !== finishLayoutInstruction()), finishLayoutInstruction()]
      : rules.style_notes;
  return stringify({
    spec_name: OMAY_SPEC_NAME,
    style_notes: notes.map(toEnglishArtworkText),
    layout_spec: toEnglishArtworkText(rules.layout_spec),
    finish_layout: target === 'character' ? getOutputSettings(document.manga) : getFinishLayout(document.manga),
    ...(settings.mode ? { generation_mode: target ?? mode } : {}),
  }, { indent: 2, lineWidth: 0 });
}

/** 再編集用の控え。生成用OMAYとは分け、OFFの原本も保存する。 */
export function toArtworkSettingsYaml(document: MangaDocument): string {
  const settings = getArtworkSettings(document.manga);
  return stringify({ spec_name: OMAY_SPEC_NAME, ...compileArtworkRules(settings, 'integrated'), artwork_settings: settings }, { indent: 2, lineWidth: 0 });
}

export function cloneDocument(document: MangaDocument): MangaDocument {
  return structuredClone(document);
}

export function newPanel(id: number, offset = 0, canvas: CanvasSize = DEFAULT_CANVAS): Panel {
  const inner = innerFrameBounds(canvas);
  const height = Math.min(55, inner.h);
  return {
    id,
    shape: { type: 'rect', x: inner.x, y: inner.y + Math.max(0, Math.min(offset, inner.h - height)), w: inner.w, h: height },
    bg: 1,
    bubbles: [{ text: '新しいセリフ', shape: 'normal' }],
    action: null,
  };
}

export function newPage(pageNumber: number, canvas: CanvasSize = DEFAULT_CANVAS): MangaPage {
  return { page: pageNumber, canvas: { ...canvas, unit: 'mm' }, panels: [newPanel(1, 0, canvas)] };
}

export function normalizeDocument(document: MangaDocument): MangaDocument {
  const next = cloneDocument(document);
  const manga = next.manga;
  // 書き出し時の派生値を編集用原本として残さない。次の書き出しで正本から再計算する。
  delete (manga as Manga & { finish_layout?: unknown }).finish_layout;
  if (!manga.schema_name || manga.schema_name === LEGACY_OMNY_SCHEMA_NAME) manga.schema_name = NDM_SCHEMA_NAME;
  manga.pages ??= [];
  manga.characters ??= [];
  manga.materials ??= [];
  // 「人物あたり」は検出枠が使うシステム名であり、ユーザーの人物台帳には保存しない。
  manga.characters = manga.characters.filter((character) => !isDetectedFigureCharacter(character));
  ensureSystemMobCharacter(manga.characters);
  manga.characters.forEach((character) => {
    // 性別は未設定も不正値もそのまま保ち、検証で入力誤りを示す。
    character.scope = character.scope === 'series' ? 'series' : 'episode';
    character.aliases = normalizedUniqueStrings(character.aliases, 24);
    const rawHeadCount = Number(character.default_proportion?.head_count);
    if (Number.isFinite(rawHeadCount)) {
      character.default_proportion = {
        head_count: rawHeadCount,
      };
    } else {
      delete character.default_proportion;
    }
    character.recognition = normalizedRecognition(character.recognition);
    if (!character.recognition) delete character.recognition;
    if (character.scope !== 'series') {
      delete character.catalog_id;
      delete character.primary_material_catalog_id;
    }
  });
  manga.materials.forEach((material) => {
    material.scope ??= 'episode';
    if (!CHARACTER_REFERENCE_VIEW_VALUES.includes(material.view as (typeof CHARACTER_REFERENCE_VIEW_VALUES)[number])) delete material.view;
    material.source_image = normalizedCharacterSourceImage(material.source_image);
    if (!material.source_image) delete material.source_image;
  });
  manga.meta.series ??= '';
  if (manga.scenario) manga.scenario = validateScenarioSource(manga.scenario);
  const legacySeriesCatalog = manga.meta.document_type === undefined && manga.meta.format === 'series-catalog';
  manga.meta.document_type = manga.meta.document_type === 'series-catalog' || legacySeriesCatalog ? 'series-catalog' : 'story';
  if (legacySeriesCatalog) manga.meta.format = 'カラー漫画';
  manga.meta.format = toEditableMangaFormat(manga.meta.format);
  manga.meta.series_id ??= '';
  manga.meta.episode_number ??= '';
  manga.meta.episode_id ??= '';
  manga.meta.author ??= '';
  manga.meta.style_notes ??= [];
  manga.meta.style_notes = manga.meta.style_notes.map(toEditableArtworkText).filter(note => note !== finishLayoutInstruction());
  manga.meta.bubble_line_width_mm = normalizedBubbleLineWidth(Number(manga.meta.bubble_line_width_mm ?? DEFAULT_BUBBLE_LINE_WIDTH_MM));
  const legacyFrameWidth = panelFrameLineWidthFromStyleNotes(manga.meta.style_notes, DEFAULT_PANEL_FRAME_LINE_WIDTH_MM);
  const legacyGutters = panelGuttersFromStyleNotes(manga.meta.style_notes, DEFAULT_PANEL_GUTTERS);
  manga.meta.panel_frame_width_mm = normalizedFrameLineWidth(Number(manga.meta.panel_frame_width_mm ?? legacyFrameWidth));
  manga.meta.panel_gutter_row_mm = normalizedPanelGutters({
    rowGapMm: Number(manga.meta.panel_gutter_row_mm ?? legacyGutters.rowGapMm),
    columnGapMm: Number(manga.meta.panel_gutter_column_mm ?? legacyGutters.columnGapMm),
  }).rowGapMm;
  manga.meta.panel_gutter_column_mm = normalizedPanelGutters({
    rowGapMm: Number(manga.meta.panel_gutter_row_mm),
    columnGapMm: Number(manga.meta.panel_gutter_column_mm ?? legacyGutters.columnGapMm),
  }).columnGapMm;
  manga.meta.style_notes = migrateLegacyStyleNotes(withoutLegacyPanelSettingNotes(manga.meta.style_notes));
  manga.layout_spec = migrateLegacyLayoutSpec(toEditableArtworkText(manga.layout_spec ?? ''));
  if (manga.finish_settings) manga.finish_settings = validateFinishSettings(manga.finish_settings);
  if (manga.print_settings) manga.print_settings = validatePrintData(manga.print_settings);
  if (manga.artwork_settings) applyArtworkSettings(manga, manga.artwork_settings);
  manga.series_setting ??= {
    genre: '', target_audience: '', adult_content: false, situation: '', location: '', time: '', weather: '',
  };
  manga.series_setting.genre ??= '';
  manga.series_setting.target_audience ??= '';
  manga.series_setting.adult_content = manga.series_setting.adult_content === true;
  manga.series_setting.situation ??= '';
  manga.series_setting.location ??= '';
  manga.series_setting.time ??= '';
  manga.series_setting.weather ??= '';
  manga.setting ??= { location: '', time: '', weather: '', situation: '' };
  manga.setting.location ??= '';
  manga.setting.time ??= '';
  manga.setting.weather ??= '';
  manga.setting.situation ??= '';
  const settingWithMaterialLists = manga.setting as Manga['setting'] & { background?: unknown; props?: unknown };
  const materialKeys = new Set(manga.materials.map((material) => material.key));
  const collectSettingMaterials = (values: unknown, type: 'background' | 'prop') => {
    if (!Array.isArray(values)) return;
    values.map(String).map((value) => value.trim()).filter(Boolean).forEach((key) => {
      if (materialKeys.has(key)) return;
      manga.materials.push({ key, type, scope: 'episode', keywords: [key], note: '' });
      materialKeys.add(key);
    });
  };
  collectSettingMaterials(settingWithMaterialLists.background, 'background');
  collectSettingMaterials(settingWithMaterialLists.props, 'prop');
  delete settingWithMaterialLists.background;
  delete settingWithMaterialLists.props;
  manga.pages.forEach((page, pageIndex) => {
    page.page ??= pageIndex + 1;
    page.canvas ??= { w: 210, h: 297, unit: 'mm' };
    page.panels ??= [];
    if(page.layer?.directLocked===true)page.layer={directLocked:true};
    else delete page.layer;
    page.panels.forEach((panel, panelIndex) => {
      if(panel.layer !== undefined)panel.layer=normalizePanelLayer(panel.layer);
      // IDは読み順そのもの。重複や飛び番を受け入れず配列順で必ず自動採番する。
      panel.id = panelIndex + 1;
      panel.bubbles ??= [];
      const legacyPanel = panel as Panel & { font?: string; splitOverlapBackground?: true; splitOverlapBackgroundId?: string };
      delete legacyPanel.font;
      delete legacyPanel.splitOverlapBackground;
      delete legacyPanel.splitOverlapBackgroundId;
      panel.figures?.forEach((figure) => {
        if (figure.human_pose !== undefined) validateHumanPoseSelection(figure.human_pose);
        if (isPropPlacement(figure)) {
          delete figure.size;
          delete figure.role;
          return;
        }
        figure.size ??= 'bust-up';
        figure.role ??= 'main';
      });
      panel.bubbles.forEach((bubble) => { delete (bubble as Bubble & { delivery?: unknown }).delivery; if(bubble.hidden!==true)delete bubble.hidden; const material=materialBubbleBezier(bubble.shape); if(bubble.bezier===undefined&&material)bubble.bezier=structuredClone(material); });
      normalizeBubbleConnections(panel.bubbles);
      panel.action ??= null;
      const backgroundDescription = panel.background_description;
      if (panel.bg === -1 || typeof backgroundDescription !== 'string') {
        delete panel.background_description;
      } else {
        panel.background_description = backgroundDescription.trim();
      }
    });
    if (page.page_overlay) {
      page.page_overlay.frame = false;
      page.page_overlay.layer = 'above_panel_frames';
      page.page_overlay.figures ??= [];
      page.page_overlay.bubbles ??= [];
      page.page_overlay.figures.forEach((figure) => {
        if (figure.human_pose !== undefined) validateHumanPoseSelection(figure.human_pose);
        if (isPropPlacement(figure)) {
          delete figure.size;
          delete figure.role;
          return;
        }
        figure.size ??= 'bust-up';
        figure.role ??= 'main';
      });
      page.page_overlay.bubbles.forEach((bubble) => { delete (bubble as Bubble & { delivery?: unknown }).delivery; if(bubble.hidden!==true)delete bubble.hidden; const material=materialBubbleBezier(bubble.shape); if(bubble.bezier===undefined&&material)bubble.bezier=structuredClone(material); });
      normalizeBubbleConnections(page.page_overlay.bubbles);
      page.page_overlay.screen_text?.forEach((screenText) => { if(screenText.orientation===undefined)screenText.orientation='horizontal'; });
    }
  });
  validateImagePlacements(next);
  synchronizeCatalogReferences(next);
  detachResolvedScenarioLinks(next);
  restoreProvisionalScenarioText(next);
  initializePanelBackgrounds(next);
  return next;
}

export function validateManga(document: MangaDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const manga = document?.manga;
  if (!manga) return [{ level: 'error', path: 'manga', message: 'manga ルートが必要です' }];
  if (manga.schema_name !== NDM_SCHEMA_NAME) issues.push({ level: 'error', path: 'manga.schema_name', message: `固定値「${NDM_SCHEMA_NAME}」にしてください` });
  if (manga.schema_version !== CURRENT_NDM_SCHEMA_VERSION) issues.push({ level: 'warning', path: 'manga.schema_version', message: `NDMスキーマは v${CURRENT_NDM_SCHEMA_VERSION} です（現在 v${manga.schema_version ?? '不明'}）` });
  if (manga.meta?.page_count !== manga.pages?.length) issues.push({ level: 'error', path: 'manga.meta.page_count', message: `pages の実数 ${manga.pages?.length ?? 0} と一致しません` });
  if (!['story', 'series-catalog'].includes(manga.meta?.document_type)) {
    issues.push({ level: 'error', path: 'manga.meta.document_type', message: '文書種別は story / series-catalog のいずれかが必須です' });
  }
  const fixed = [['reading_direction', 'right-to-left'], ['text_orientation', 'vertical']] as const;
  fixed.forEach(([key, value]) => {
    if (manga.meta?.[key] !== value) issues.push({ level: 'error', path: `manga.meta.${key}`, message: `固定値「${value}」にしてください` });
  });
  if (!manga.meta?.font?.trim()) issues.push({ level: 'error', path: 'manga.meta.font', message: '作品全体の既定フォントを指定してください' });
  if (!Number.isFinite(manga.meta?.bubble_line_width_mm) || manga.meta.bubble_line_width_mm < 0.1 || manga.meta.bubble_line_width_mm > 2) {
    issues.push({ level: 'error', path: 'manga.meta.bubble_line_width_mm', message: 'フキダシ線幅は0.1〜2mmで指定してください' });
  }
  const materialKeys = new Set((manga.materials ?? []).map((item) => item.key));
  const materialsByKey = new Map((manga.materials ?? []).map((item) => [item.key, item]));
  const characterNames = new Set((manga.characters ?? []).map((item) => item.name));
  const validateTextStyle = (item:Pick<Bubble,'text'|'text_style'|'text_weights'>,path:string) => {
    if(item.text_style!==undefined&&!validTextStyle(item.text_style))issues.push({level:'error',path:`${path}.text_style`,message:'文字設定は方向・書体・サイズ（4〜144 pt）・太さ（100〜900）を指定してください'});
    if(item.text_weights!==undefined&&!validTextWeights(item.text_weights,item.text??''))issues.push({level:'error',path:`${path}.text_weights`,message:'文字の太さの範囲が本文と一致していません'});
  };
  const validateBubbleTail = (bubble: Bubble, path: string) => {
    validateTextStyle(bubble,path);
    if (bubble.clip_to_panel !== undefined && typeof bubble.clip_to_panel !== 'boolean') {
      issues.push({ level: 'error', path: `${path}.clip_to_panel`, message: 'コマ枠での切り取りは true / false で指定してください' });
    }
    if (bubble.text_position !== undefined && (!Number.isFinite(bubble.text_position?.x) || !Number.isFinite(bubble.text_position?.y))) {
      issues.push({ level: 'error', path: `${path}.text_position`, message: '本文位置はフキダシbboxを基準とした有限の相対座標 x / y で指定してください。枠外の値も使えます' });
    }
    if (bubble.bezier !== undefined && !isBubbleBezier(bubble.bezier)) {
      issues.push({ level: 'error', path: `${path}.bezier`, message: 'ベジェ輪郭は3〜128点で、点とハンドルを有限の座標で指定してください' });
    }
    if (bubble.tail_root !== undefined && (!Number.isFinite(bubble.tail_root.x) || !Number.isFinite(bubble.tail_root.y))) {
      issues.push({ level: 'error', path: `${path}.tail_root`, message: 'しっぽ根元はフキダシ枠を基準とした有限の相対座標 x / y で指定してください。枠外の値も使えます' });
    }
    if (bubble.tail_style !== undefined && !['normal','thinking'].includes(bubble.tail_style)) {
      issues.push({level:'error',path:`${path}.tail_style`,message:'しっぽの種類は normal または thinking を指定してください'});
    }
    if (bubble.tail === undefined || bubble.tail === false) return;
    if (!bubble.tail || typeof bubble.tail !== 'object' || !Number.isFinite(bubble.tail.x) || !Number.isFinite(bubble.tail.y)) {
      issues.push({ level: 'error', path: `${path}.tail`, message: 'しっぽ先端は人物枠を基準とした有限の相対座標 x / y で指定してください。枠外の値も使えます' });
    }
    if (!bubble.speaker?.trim()) {
      issues.push({ level: 'warning', path: `${path}.tail`, message: 'しっぽ先端を使うフキダシには話者を指定してください' });
    }
  };
  const validateBubbleConnection = (bubble: Bubble, bubbleIndex: number, path: string) => {
    if (bubble.join_to === undefined) return;
    if (!Number.isInteger(bubble.join_to) || bubble.join_to < 1 || bubble.join_to > bubbleIndex) {
      issues.push({ level: 'error', path: `${path}.join_to`, message: '結合相手は同じ一覧で自分より前にあるフキダシ番号を指定してください' });
    }
  };
  const duplicateCharacterNames = new Set<string>();
  const seenCharacterNames = new Set<string>();
  const characterCatalogIds = new Set<string>();
  (manga.characters ?? []).forEach((character, index) => {
    if (character.gender !== undefined && !isCharacterGender(character.gender)) {
      issues.push({ level: 'error', path: `manga.characters[${index}].gender`, message: '性別は female / male / neutral のいずれかで指定してください' });
    }
    const key = character.name.normalize('NFKC').trim();
    if (key) {
      if (seenCharacterNames.has(key)) duplicateCharacterNames.add(key);
      seenCharacterNames.add(key);
      if (duplicateCharacterNames.has(key)) issues.push({ level: 'error', path: `manga.characters[${index}].name`, message: `人物名「${character.name}」が重複しています` });
    }
    if (!MATERIAL_SCOPES.includes(character.scope)) issues.push({ level: 'error', path: `manga.characters[${index}].scope`, message: '人物の区分は episode / series のいずれかが必須です' });
    if (character.catalog_id) {
      if (characterCatalogIds.has(character.catalog_id)) issues.push({ level: 'error', path: `manga.characters[${index}].catalog_id`, message: 'シリーズ人物の内部IDが重複しています' });
      characterCatalogIds.add(character.catalog_id);
    }
    if (character.scope === 'series' && !character.catalog_id) issues.push({ level: 'warning', path: `manga.characters[${index}].catalog_id`, message: 'シリーズ共通人物は保存時に安定IDが必要です' });
    const headCount = character.default_proportion?.head_count;
    if (headCount !== undefined && (!Number.isFinite(headCount) || headCount < 1)) {
      issues.push({ level: 'error', path: `manga.characters[${index}].default_proportion.head_count`, message: '基準頭身は1以上の数値で指定してください' });
    }
  });
  const seenMaterialKeys = new Set<string>();
  const catalogIds = new Set<string>();
  (manga.materials ?? []).forEach((material, index) => {
    const key = material.key.normalize('NFKC').trim();
    if (key && seenMaterialKeys.has(key)) issues.push({ level: 'error', path: `manga.materials[${index}].key`, message: `素材名「${material.key}」が重複しています` });
    if (key) seenMaterialKeys.add(key);
    if (!MATERIAL_SCOPES.includes(material.scope)) issues.push({ level: 'error', path: `manga.materials[${index}].scope`, message: '素材の区分は episode / series のいずれかが必須です' });
    if (material.catalog_id) {
      if (catalogIds.has(material.catalog_id)) issues.push({ level: 'error', path: `manga.materials[${index}].catalog_id`, message: 'シリーズ素材の内部IDが重複しています' });
      catalogIds.add(material.catalog_id);
    }
    if (material.source_image) {
      if (material.type !== 'character' || material.scope !== 'series') issues.push({ level: 'error', path: `manga.materials[${index}].source_image`, message: '人物資料画像はシリーズ共通の人物資料にだけ保存できます' });
      if (material.source_image.file_name.startsWith('/') || material.source_image.file_name.includes('..') || material.source_image.file_name.includes('\\')) {
        issues.push({ level: 'error', path: `manga.materials[${index}].source_image.file_name`, message: '人物資料画像はシリーズ内の相対パスで指定してください' });
      }
      if (!material.character_catalog_id || !characterCatalogIds.has(material.character_catalog_id)) {
        issues.push({ level: 'error', path: `manga.materials[${index}].character_catalog_id`, message: '人物資料画像は対応するシリーズ人物の安定IDへ接続してください' });
      } else {
        const expectedPath = `characters/${material.character_catalog_id}/${material.source_image.asset_id}.png`;
        if (material.source_image.file_name !== expectedPath) {
          issues.push({ level: 'error', path: `manga.materials[${index}].source_image.file_name`, message: '人物資料画像の保存先と対応人物の安定IDが一致しません' });
        }
      }
    }
    if (material.scope === 'series' && material.type === 'character' && material.characterId) {
      const owner = manga.characters.find((character) => character.localId === material.characterId);
      if (owner && owner.scope !== 'series') issues.push({ level: 'error', path: `manga.materials[${index}].scope`, message: 'シリーズ人物資料の対応人物もシリーズ共通にしてください' });
    }
  });
  (manga.pages ?? []).forEach((page, pageIndex) => {
    const base = `manga.pages[${pageIndex}]`;
    if (page.page !== pageIndex + 1) issues.push({ level: 'warning', path: `${base}.page`, message: `配列順に合わせて ${pageIndex + 1} を推奨します` });
    if (!Number.isFinite(page.canvas?.w) || !Number.isFinite(page.canvas?.h) || page.canvas.w <= 0 || page.canvas.h <= 0 || page.canvas.unit !== 'mm') issues.push({ level: 'error', path: `${base}.canvas`, message: '用紙サイズはmm単位の正の数にしてください' });
    if ((page.panels?.length ?? 0) > MAX_PANELS_PER_PAGE) issues.push({ level: 'error', path: `${base}.panels`, message: `1ページは最大${MAX_PANELS_PER_PAGE}コマです` });
    if (page.page_overlay) {
      const overlayPath = `${base}.page_overlay`;
      if (page.page_overlay.frame !== false) issues.push({ level: 'error', path: `${overlayPath}.frame`, message: 'ページ前景は枠線を持たないため false 固定です' });
      if (page.page_overlay.layer !== 'above_panel_frames') issues.push({ level: 'error', path: `${overlayPath}.layer`, message: 'ページ前景の layer は above_panel_frames 固定です' });
      (page.page_overlay.figures ?? []).forEach((figure, index) => {
        if (isPropPlacement(figure)) {
          if (!materialKeys.has(figure.name)) issues.push({ level: 'warning', path: `${overlayPath}.figures[${index}].name`, message: `物「${figure.name}」が materials にありません` });
          else if (materialsByKey.get(figure.name)?.type !== 'prop') issues.push({ level: 'warning', path: `${overlayPath}.figures[${index}].name`, message: `配置済みの物「${figure.name}」は materials で小道具にしてください` });
        } else if (!isDetectedFigureCharacter(figure) && !characterNames.has(figure.name)) {
          issues.push({ level: 'warning', path: `${overlayPath}.figures[${index}].name`, message: `人物「${figure.name}」が characters にありません` });
        }
      });
      (page.page_overlay.bubbles ?? []).forEach((bubble, index) => {
        const bubblePath = `${overlayPath}.bubbles[${index}]`;
        if (!bubble.text?.trim()) issues.push({ level: 'error', path: `${bubblePath}.text`, message: 'フキダシ本文は必須です' });
        if (bubble.shape && !BUBBLE_SHAPES.includes(bubble.shape)) issues.push({ level: 'error', path: `${bubblePath}.shape`, message: '定義済みのフキダシ形状から選んでください' });
        if (bubble.speaker && !characterNames.has(bubble.speaker)) issues.push({ level: 'warning', path: `${bubblePath}.speaker`, message: `話者「${bubble.speaker}」が characters にありません` });
        validateBubbleConnection(bubble, index, bubblePath);
        validateBubbleTail(bubble, bubblePath);
      });
      (page.page_overlay.screen_text ?? []).forEach((screenText,index)=>{
        const screenTextPath=`${overlayPath}.screen_text[${index}]`;
        validateTextStyle(screenText,screenTextPath);
        if(screenText.hidden!==undefined&&typeof screenText.hidden!=='boolean')issues.push({level:'error',path:`${screenTextPath}.hidden`,message:'hidden は真偽値で指定してください'});
        if(!screenText.text?.trim())issues.push({level:'error',path:`${screenTextPath}.text`,message:'通常文字の本文は必須です'});
        if(screenText.orientation&&!SCREEN_TEXT_ORIENTATIONS.includes(screenText.orientation))issues.push({level:'error',path:`${screenTextPath}.orientation`,message:'orientation は horizontal / vertical から選んでください'});
      });
    }
    const bg2 = (page.panels ?? []).filter((panel) => panel.bg === 2).length;
    if (bg2 > 2) issues.push({ level: 'error', path: `${base}.panels`, message: `bg: 2 は1ページ2コマまでです（現在 ${bg2}）` });
    (page.panels ?? []).forEach((panel, panelIndex) => {
      const panelPath = `${base}.panels[${panelIndex}]`;
      if (panel.id !== panelIndex + 1) issues.push({ level: 'warning', path: `${panelPath}.id`, message: `読み順に合わせて ${panelIndex + 1} を推奨します` });
      if (![-1, 0, 1, 2].includes(panel.bg)) issues.push({ level: 'error', path: `${panelPath}.bg`, message: '-1 / 0 / 1 / 2 のいずれかが必須です' });
      if (typeof panel.background_description === 'string' && panel.background_description.length > 4000) issues.push({ level: 'error', path: `${panelPath}.background_description`, message: '背景情報は4000文字以内にしてください' });
      if (panel.bg === -1 && panel.background_description?.trim()) issues.push({ level: 'warning', path: `${panelPath}.background_description`, message: '描写なしのコマでは背景情報を使用しません' });
      if (!panel.shape || !['rect', 'polygon'].includes(panel.shape.type)) issues.push({ level: 'error', path: `${panelPath}.shape`, message: 'rect または polygon が必要です' });
      if (panel.bleed?.length) {
        if (panel.shape?.type !== 'rect') {
          issues.push({ level: 'error', path: `${panelPath}.bleed`, message: 'bleed（タチキリ）は rect コマにのみ指定できます' });
        } else {
          const { x, y, w, h } = panel.shape;
          panel.bleed.forEach((edge) => {
            if (!BLEED_EDGES.includes(edge)) issues.push({ level: 'error', path: `${panelPath}.bleed`, message: `断ち切れる辺は left / right / top / bottom です（「${edge}」は不可）` });
            else if (edge === 'left' && x !== 0) issues.push({ level: 'error', path: `${panelPath}.bleed`, message: 'bleed: left のコマは x: 0（紙の左端）にしてください' });
            else if (edge === 'right' && Math.abs(x + w - page.canvas.w) > 0.001) issues.push({ level: 'error', path: `${panelPath}.bleed`, message: `bleed: right のコマは x + w = ${page.canvas.w}（紙の右端）にしてください` });
            else if (edge === 'top' && y !== 0) issues.push({ level: 'error', path: `${panelPath}.bleed`, message: 'bleed: top のコマは y: 0（紙の上端）にしてください' });
            else if (edge === 'bottom' && Math.abs(y + h - page.canvas.h) > 0.001) issues.push({ level: 'error', path: `${panelPath}.bleed`, message: `bleed: bottom のコマは y + h = ${page.canvas.h}（紙の下端）にしてください` });
          });
        }
      }
      // figures は人物専用ではない——object: true の figure は物（小道具等）の配置、無ければ人物
      const personCount = (panel.figures ?? []).filter((figure) => !isPropPlacement(figure)).length;
      if (panel.no_figures && personCount > 0) issues.push({ level: 'error', path: `${panelPath}.no_figures`, message: '意図的な無人コマ（no_figures: true）に人物の figure は書けません（物の配置は書けます）' });
      const hasSpokenBubble = (panel.bubbles ?? []).some((bubble) => bubble.speaker);
      if (!panel.no_figures && personCount === 0 && !hasSpokenBubble) issues.push({ level: 'warning', path: `${panelPath}.figures`, message: '人物も話者もいないコマです。意図的な無人コマなら no_figures: true を宣言してください' });
      (panel.assets ?? []).forEach((key) => {
        if (!materialKeys.has(key)) issues.push({ level: 'warning', path: `${panelPath}.assets`, message: `素材「${key}」が materials にありません` });
      });
      (panel.figures ?? []).forEach((figure, index) => {
        if (isPropPlacement(figure)) {
          if (characterNames.has(figure.name)) issues.push({ level: 'warning', path: `${panelPath}.figures[${index}].object`, message: `物（object: true）の名前「${figure.name}」が characters の人物と一致しています` });
          else if (!materialKeys.has(figure.name)) issues.push({ level: 'warning', path: `${panelPath}.figures[${index}].name`, message: `物「${figure.name}」が materials にありません` });
          else if (materialsByKey.get(figure.name)?.type !== 'prop') issues.push({ level: 'warning', path: `${panelPath}.figures[${index}].name`, message: `配置済みの物「${figure.name}」は materials で小道具にしてください` });
          if (figure.size || figure.role) issues.push({ level: 'warning', path: `${panelPath}.figures[${index}]`, message: 'size / role は人物向けの語彙です（物の figure には付けません）' });
          return;
        }
        if (!isDetectedFigureCharacter(figure) && !characterNames.has(figure.name)) {
          if (materialKeys.has(figure.name)) issues.push({ level: 'warning', path: `${panelPath}.figures[${index}].object`, message: `「${figure.name}」は materials の物と一致します。物の配置なら object: true を付けてください` });
          else issues.push({ level: 'warning', path: `${panelPath}.figures[${index}].name`, message: `人物「${figure.name}」が characters にありません` });
        }
        if (figure.size && !FIGURE_SIZES.includes(figure.size)) issues.push({ level: 'error', path: `${panelPath}.figures[${index}].size`, message: `size は ${FIGURE_SIZES.join(' / ')} から選んでください` });
        if (figure.role && !FIGURE_ROLES.includes(figure.role)) issues.push({ level: 'error', path: `${panelPath}.figures[${index}].role`, message: 'role は main / sub から選んでください' });
      });
      const figureNames = new Set((panel.figures ?? []).filter((figure) => !isPropPlacement(figure)).map((figure) => figure.name));
      (panel.bubbles ?? []).forEach((bubble, bubbleIndex) => {
        const bubblePath = `${panelPath}.bubbles[${bubbleIndex}]`;
        if (!bubble.text?.trim()) issues.push({ level: 'error', path: `${bubblePath}.text`, message: 'フキダシ本文は必須です' });
        if (bubble.shape && !BUBBLE_SHAPES.includes(bubble.shape)) issues.push({ level: 'error', path: `${bubblePath}.shape`, message: '定義済みのフキダシ形状から選んでください' });
        if (bubble.speaker && !characterNames.has(bubble.speaker)) issues.push({ level: 'warning', path: `${bubblePath}.speaker`, message: `話者「${bubble.speaker}」が characters にありません` });
        if (bubble.offscreen && !bubble.speaker) issues.push({ level: 'warning', path: `${bubblePath}.offscreen`, message: 'コマ外の声（offscreen）には話者（speaker）を明記してください' });
        if (bubble.offscreen && bubble.speaker && figureNames.has(bubble.speaker)) issues.push({ level: 'warning', path: `${bubblePath}.offscreen`, message: `話者「${bubble.speaker}」が figures にいます。コマ内にいる話者に offscreen は付けません` });
        validateBubbleConnection(bubble, bubbleIndex, bubblePath);
        validateBubbleTail(bubble, bubblePath);
      });
      (panel.screen_text ?? []).forEach((screenText, screenTextIndex) => {
        const screenTextPath = `${panelPath}.screen_text[${screenTextIndex}]`;
        validateTextStyle(screenText,screenTextPath);
        if(screenText.hidden!==undefined&&typeof screenText.hidden!=='boolean')issues.push({level:'error',path:`${screenTextPath}.hidden`,message:'hidden は真偽値で指定してください'});
        if (!screenText.text?.trim()) issues.push({ level: 'error', path: `${screenTextPath}.text`, message: '画面内文字の本文は必須です' });
        if (screenText.orientation && !SCREEN_TEXT_ORIENTATIONS.includes(screenText.orientation)) issues.push({ level: 'error', path: `${screenTextPath}.orientation`, message: 'orientation は horizontal / vertical から選んでください' });
      });
    });
  });
  return issues;
}

function safeBaseName(title: string): string {
  return title.trim().replace(/[\\/:*?\"<>|]/g, '_') || 'manga-name';
}

// エディター内部文書（ルール込み）
export function safeFileName(title: string): string {
  return `${safeBaseName(title)}.yaml`;
}

// ストーリーOMNY（作品情報・素材・ネーム）
export function omnyFileName(title: string): string {
  return safeFileName(title);
}

export function omayFileName(title: string, purpose: 'settings' | 'generation' = 'generation'): string {
  return `${safeBaseName(title)}-${purpose}.yaml`;
}
