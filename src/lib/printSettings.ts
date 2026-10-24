import type { FinishSettings, Manga, MangaDocument, PrintSettingsData } from '../types.ts';
import { getFinishSettings, validateFinishSettings } from './finishLayout.ts';
import { toEditableMangaFormat } from './artworkEnglish.ts';
import { resizePageCanvas } from './pageCanvas.ts';
import { getPrinterPreset, PRINTER_PRESETS, printerDpi } from './printerPresets.ts';
export { printerDpi } from './printerPresets.ts';

export type PrintUnit = PrintSettingsData['unit'];
export interface PrintSetup extends PrintSettingsData, FinishSettings { format: string; body_pages: number }
export const PRINT_PREFERENCES_KEY = 'nyamuru.print-preferences.v1';
export const PAPER_SIZES = [
  { id: 'B5', label: 'B5', width: 182, height: 257 },
  { id: 'B6', label: 'B6', width: 128, height: 182 },
  { id: 'A4', label: 'A4', width: 210, height: 297 },
  { id: 'A5', label: 'A5', width: 148, height: 210 },
  { id: 'B4', label: 'B4', width: 257, height: 364 },
  { id: 'A6', label: 'A6', width: 105, height: 148 },
  { id: 'postcard', label: 'ポストカード', width: 100, height: 148 },
] as const;
export const PRINTER_NAMES = PRINTER_PRESETS.map(preset => preset.name);
export function paperSizesForPrinter(printer = '') {
  const overrides = getPrinterPreset(printer)?.paperOverrides;
  return PAPER_SIZES.map(paper => ({ ...paper, ...overrides?.[paper.id] }));
}
/** 明示的な印刷所選択時だけ適用。再表示・保存値の読込では再適用しない。 */
export function applyPrinterPreset(setup: PrintSetup, printer: string, paper = paperSizeId(setup)): PrintSetup {
  const preset = getPrinterPreset(printer);
  const next = { ...setup, printer, product: '' };
  if (!preset) return next;
  const size = paperSizesForPrinter(printer).find(candidate => candidate.id === paper);
  const landscape = setup.width_mm > setup.height_mm;
  return {
    ...next,
    ...(size ? { width_mm: landscape ? size.height : size.width, height_mm: landscape ? size.width : size.height } : {}),
    bleed_mm: preset.bleedMm,
    dpi: printerDpi(printer, setup.format, 'body') ?? setup.dpi,
    cover: { ...setup.cover, dpi: printerDpi(printer, setup.cover.format, 'cover') ?? setup.cover.dpi },
  };
}
export const DEFAULT_PRINT_DATA: PrintSettingsData = {
  version: 1, purpose: 'manga', unit: 'mm', printer: '', product: '', binding: 'right', binding_style: 'unspecified',
  tone_lpi: 60, safe_margin_mm: 5, crop_marks: true,
  folio: { enabled: false, hidden: false, start: 1, position: 'outside', font: '', size_pt: 8 },
  cover: { enabled: false, format: 'カラー漫画', dpi: 350, layout: 'spread', spine_mm: 0 },
};
export function defaultPrintSetup(): PrintSetup {
  return { ...structuredClone(DEFAULT_PRINT_DATA), width_mm: 182, height_mm: 257, dpi: 600, bleed_mm: 3, format: 'モノクロ漫画', body_pages: 4 };
}
const positive = (value: number, label: string, allowZero = false) => {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${label}を${allowZero ? '0以上' : '0より大きい数'}で入力してください`);
  return value;
};
const choice = <T extends string>(value: T, values: readonly string[], label: string): T => {
  if (!values.includes(value)) throw new Error(`${label}を選択してください`);
  return value;
};
const nonempty = (value: string, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}を選択してください`);
  return value;
};
export function validatePrintData(data: PrintSettingsData): PrintSettingsData {
  if (!data || data.version !== 1 || !data.cover || !data.folio) throw new Error('印刷設定の形式を確認してください');
  if (typeof data.printer !== 'string' || typeof data.product !== 'string' || typeof data.folio.font !== 'string') throw new Error('印刷設定の文字項目を確認してください');
  const coverDpi = positive(data.cover.dpi, '表紙の解像度');
  if (!Number.isInteger(coverDpi) || !Number.isInteger(data.folio.start) || data.folio.start < 0) throw new Error('解像度・開始番号は整数で入力してください');
  return {
    version: 1, purpose: choice(data.purpose, ['manga', 'illustration'], '用途'), unit: choice(data.unit, ['mm', 'cm', 'in', 'px', 'pt'], '単位'),
    printer: data.printer.trim(), product: data.product.trim(), binding: choice(data.binding, ['right', 'left'], '綴じ方向'),
    binding_style: choice(data.binding_style, ['unspecified', 'perfect', 'saddle'], '製本方法'),
    tone_lpi: positive(data.tone_lpi, '基本線数'), safe_margin_mm: positive(data.safe_margin_mm, '安全余白', true), crop_marks: data.crop_marks === true,
    folio: { enabled: data.folio.enabled === true, hidden: data.folio.hidden === true, start: data.folio.start, position: choice(data.folio.position, ['outside', 'center', 'inside'], 'ノンブルの位置'), font: data.folio.font, size_pt: positive(data.folio.size_pt, 'ノンブルのサイズ') },
    cover: { enabled: data.cover.enabled === true, format: nonempty(data.cover.format, '表紙の表現色'), dpi: coverDpi, layout: choice(data.cover.layout, ['separate', 'spread'], '表紙の構成'), spine_mm: positive(data.cover.spine_mm, '背幅', true) },
  };
}
export function validatePrintSetup(setup: PrintSetup): PrintSetup {
  const finish = validateFinishSettings(setup);
  const data = validatePrintData(setup);
  if (!Number.isSafeInteger(setup.body_pages) || setup.body_pages < 1 || setup.body_pages > 1000) throw new Error('本文ページ数は1〜1000で入力してください');
  if (data.safe_margin_mm * 2 >= Math.min(finish.width_mm, finish.height_mm)) throw new Error('安全余白が用紙より大きくなっています');
  return { ...data, ...finish, format: nonempty(setup.format, '表現色'), body_pages: setup.body_pages };
}
export function getPrintSetup(manga: Manga): PrintSetup {
  return { ...structuredClone(manga.print_settings ?? DEFAULT_PRINT_DATA), ...getFinishSettings(manga), format: toEditableMangaFormat(manga.meta.format), body_pages: manga.pages.length || 1 };
}
/** 用紙変更は各ページへ反映し、配置済みの内容は縦横比を保って収める。 */
export function withPrintSetup(document: MangaDocument, setup: PrintSetup): MangaDocument {
  const valid = validatePrintSetup(setup);
  const next = structuredClone(document);
  next.manga.finish_settings = validateFinishSettings(valid);
  next.manga.print_settings = validatePrintData(valid);
  next.manga.meta.format = valid.format;
  next.manga.pages.forEach(page => resizePageCanvas(page, { w: valid.width_mm, h: valid.height_mm }));
  return next;
}
interface ReadStorage { getItem(key: string): string | null }
interface WriteStorage { setItem(key: string, value: string): void }
export function loadPrintPreferences(storage: ReadStorage): PrintSetup | null {
  try {
    const source = storage.getItem(PRINT_PREFERENCES_KEY);
    if (!source) return null;
    const data = JSON.parse(source);
    return validatePrintSetup({ ...data, body_pages: data.purpose === 'illustration' ? 1 : 4, cover: { ...data.cover, spine_mm: 0 } });
  } catch { return null; }
}
/** 確定操作からだけ呼ぶ。作品名・ページ数・背幅は次作へ引き継がない。 */
export function savePrintPreferences(storage: WriteStorage, setup: PrintSetup): void {
  const { body_pages: _pages, ...valid } = validatePrintSetup(setup);
  storage.setItem(PRINT_PREFERENCES_KEY, JSON.stringify({ ...valid, cover: { ...valid.cover, spine_mm: 0 } }));
}
export function mmToUnit(mm: number, unit: PrintUnit, dpi: number): number {
  return mm * ({ mm: 1, cm: 0.1, in: 1 / 25.4, px: dpi / 25.4, pt: 72 / 25.4 }[unit]);
}
export function unitToMm(value: number, unit: PrintUnit, dpi: number): number {
  return value / mmToUnit(1, unit, dpi);
}
export function paperSizeId(setup: Pick<PrintSetup, 'width_mm' | 'height_mm'> & { printer?: string }): string {
  return paperSizesForPrinter(setup.printer).find(p => (p.width === setup.width_mm && p.height === setup.height_mm) || (p.height === setup.width_mm && p.width === setup.height_mm))?.id ?? 'custom';
}
export function printSummary(setup: PrintSetup): string {
  const paper = PAPER_SIZES.find(p => p.id === paperSizeId(setup));
  return `${paper?.label ?? `${Number(setup.width_mm.toFixed(2))}×${Number(setup.height_mm.toFixed(2))}mm`}／${setup.format.replace('漫画', '')} ${setup.dpi}dpi／塗り足し${setup.bleed_mm}mm`;
}
export function pageCountAdvice(setup: PrintSetup): string {
  if (setup.purpose !== 'manga') return '';
  const total = setup.body_pages + (setup.cover.enabled ? 4 : 0);
  if (setup.binding_style === 'saddle' && total % 4) return '中綴じは通常4の倍数です。印刷所の商品に合わせて調整してください。';
  if (setup.binding_style === 'perfect' && setup.body_pages % 2) return '無線綴じは通常2ページ単位です。印刷所の商品に合わせて調整してください。';
  return '';
}
