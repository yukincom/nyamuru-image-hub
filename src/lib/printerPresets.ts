import { PRINTER_PRESETS } from './printPresetCatalog.ts';
export { PRINTER_PRESETS } from './printPresetCatalog.ts';

/** 2026-09-25の公式資料調査から採用した通常冊子用の初期値。
 * 出典・範囲・商品例外: docs/PRINTER_REQUIREMENTS_2026-09-25.md
 * 受付範囲からの代表値を含む。全商品の必須条件・入稿適合判定ではない。
 */
export type PrintColor = 'モノクロ漫画' | 'グレースケール漫画' | 'カラー漫画';
export interface PrinterPreset {
  name: string;
  bleedMm: number;
  bodyDpi: Partial<Record<PrintColor, number>>;
  coverDpi: Partial<Record<PrintColor, number>>;
  paperOverrides?: Record<string, { width: number; height: number }>;
  checkedAt: string;
  sources: readonly string[];
  note?: string;
}


export function getPrinterPreset(name: string): PrinterPreset | undefined {
  return PRINTER_PRESETS.find(preset => preset.name === name);
}

export function printerDpi(name: string, format: string, part: 'body' | 'cover'): number | undefined {
  const preset = getPrinterPreset(name);
  const dpi = preset?.[part === 'body' ? 'bodyDpi' : 'coverDpi'][format as PrintColor];
  return typeof dpi === 'number' ? dpi : undefined;
}
