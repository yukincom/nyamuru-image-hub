import { type PanelGutterSettings, DEFAULT_PANEL_GUTTERS } from '../canvasGeometry.ts';

export const STORAGE_KEY = 'manga-name-studio.document.v1';

export const NDM_SCHEMA_NAME = 'Nyamuru Data Model' as const;

export const CURRENT_NDM_SCHEMA_VERSION = 10.33;

export const OMAY_SPEC_NAME = 'Open Manga Artwork YAML' as const;

export const LEGACY_OMNY_SCHEMA_NAME = 'Open Manga Name YAML';

export const BUBBLE_SHAPES = ['normal', 'thought', 'square', 'caption', 'flash', 'uniflash', 'wobbly', 'whisper', 'handwritten', 'typeset', 'critical', 'tense', 'toge', 'announce', 'toge_natural'] as const;

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

export function normalizedFrameLineWidth(value: number): number {
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

export function normalizedPanelGutters(settings: PanelGutterSettings): PanelGutterSettings {
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

export function withoutLegacyPanelSettingNotes(notes: readonly string[]): string[] {
  return notes.filter((note) => (
    !note.startsWith(PANEL_FRAME_STYLE_NOTE_PREFIX)
    && !note.startsWith(PANEL_GUTTER_STYLE_NOTE_PREFIX)
    && !note.includes('通常の辺(bleed なし)')
  ));
}

export function migrateLegacyStyleNotes(notes: readonly string[]): string[] {
  return notes.map((note) => {
    if (note.startsWith('[const] セリフはOMNY記載どおりの日本語を使用し、全て縦書き')) return TEXT_FLOW_STYLE_NOTE;
    if (note.startsWith('[const] ページは右綴じ、コマは右上→左下の順')) return READING_STYLE_NOTE;
    if (note.startsWith('[style] カラー漫画。線画＋ベタ塗り')) return FORMAT_STYLE_NOTE;
    if (/アンチック体.*漢字[=＝]明朝体.*(?:かな|ひらがな・カタカナ)[=＝]ゴシック体/.test(note)) return FONT_STYLE_NOTE;
    return note;
  });
}

export function migrateLegacyLayoutSpec(source: string): string {
  return source.replace(
    /^\s*- \[style\] 通常の辺\(bleed なし\): 外周に約2〜3mmの白マージンを取り、太さ約1mmの黒い枠線を描く。隣接コマの枠線は共有せず独立して描く\s*$/mu,
    PANEL_LAYOUT_STYLE_LINE,
  );
}
