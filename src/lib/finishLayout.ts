import type { FinishSettings, Manga } from '../types.ts';
import { artworkNumberControls, getArtworkSettings } from './artworkRules.ts';
import { toEnglishMangaFormat } from './artworkEnglish.ts';

export const DEFAULT_FINISH_SETTINGS: FinishSettings = { width_mm: 210, height_mm: 297, dpi: 350, bleed_mm: 0 };

export const OUTPUT_FORMAT_OPTIONS = [
  { value: 'カラー漫画', label: 'カラー' },
  { value: 'グレースケール漫画', label: 'グレースケール' },
  { value: 'モノクロ漫画', label: 'モノクロ' },
] as const;

export function validateFinishSettings(settings: FinishSettings): FinishSettings {
  if (!settings || !Number.isFinite(settings.width_mm) || settings.width_mm <= 0 || !Number.isFinite(settings.height_mm) || settings.height_mm <= 0
    || !Number.isInteger(settings.dpi) || settings.dpi < 1 || !Number.isFinite(settings.bleed_mm) || settings.bleed_mm < 0) throw new Error('仕上がりサイズ・解像度は正の数、塗り足しは0以上で入力してください');
  const pixels = [settings.width_mm, settings.height_mm, settings.width_mm + 2 * settings.bleed_mm, settings.height_mm + 2 * settings.bleed_mm].map(mm => Math.round(mm * settings.dpi / 25.4));
  if (pixels.some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('書き出しサイズが1px以上の有効な大きさになるように入力してください');
  return { width_mm: settings.width_mm, height_mm: settings.height_mm, dpi: settings.dpi, bleed_mm: settings.bleed_mm };
}

export function getFinishSettings(manga: Manga): FinishSettings {
  const canvas = manga.pages[0]?.canvas;
  return validateFinishSettings(manga.finish_settings ?? {
    ...DEFAULT_FINISH_SETTINGS, width_mm: canvas?.w ?? 210, height_mm: canvas?.h ?? 297,
  });
}

export const FINISH_NUMBER_IDS = ['header', 'footer', 'footerOffset', 'emphasisMin', 'emphasisMax'] as const;

/** キャラクター単品にも渡す完成原稿の出力条件。ページ合成指示は含めない。 */
export function getOutputSettings(manga: Manga) {
  const size = getFinishSettings(manga);
  return {
    ...size,
    trim_pixels: { width: Math.round(size.width_mm * size.dpi / 25.4), height: Math.round(size.height_mm * size.dpi / 25.4) },
    bleed_pixels: { width: Math.round((size.width_mm + size.bleed_mm * 2) * size.dpi / 25.4), height: Math.round((size.height_mm + size.bleed_mm * 2) * size.dpi / 25.4) },
    format: toEnglishMangaFormat(manga.meta.format),
  };
}

/** 生成方法と独立した書き出し契約。画像・印刷・PSDの出力側で同じ値を参照する。 */
export function getFinishLayout(manga: Manga) {
  const size = getOutputSettings(manga);
  const settings = getArtworkSettings(manga);
  const typographyGroups = settings.groups.filter(group => group.id === 'page' || group.enabled).flatMap(group => {
    const controls = artworkNumberControls(settings, group.id).filter(control => FINISH_NUMBER_IDS.some(id => id === control.id));
    return controls.length ? [{ group_id: group.id, values: Object.fromEntries(controls.map(control => [control.id, control.value])) }] : [];
  });
  return {
    ...size,
    text: { font: manga.meta.font, reading_direction: manga.meta.reading_direction, orientation: manga.meta.text_orientation, typography_groups: typographyGroups },
    panels: { frame_width_mm: manga.meta.panel_frame_width_mm, bubble_line_width_mm: manga.meta.bubble_line_width_mm, row_gap_mm: manga.meta.panel_gutter_row_mm, column_gap_mm: manga.meta.panel_gutter_column_mm },
    // 編集用の座標と最終の物理サイズを混同しない。文字・線の太さは最終mmで扱う。
    page_transforms: manga.pages.map(page => ({
      page: page.page, source_width_mm: page.canvas.w, source_height_mm: page.canvas.h,
      scale_x: size.width_mm / page.canvas.w, scale_y: size.height_mm / page.canvas.h,
      bleed_offset_mm: size.bleed_mm,
    })),
  };
}

export function finishLayoutInstruction(): string {
  return '[const] 最終原稿のサイズ・解像度・塗り足し・文字・コマ枠は finish_layout を正本とする。画像サイズに関する他の既定値より優先する。ネームの座標は各ページの source_width_mm / source_height_mm を基準とし、最終原稿へ配置するときだけ page_transforms で換算する。線幅・文字寸法は最終原稿上のmmとし、二重に拡縮しない。塗り足しは仕上がり線の外側へ描き足す余白であり、コマのタチキリ指定とは別である。';
}
