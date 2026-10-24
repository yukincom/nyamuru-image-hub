export const BUBBLE_FONT_PRESETS = [
  'アンチック体',
  '明朝体',
  'ゴシック体',
  'BIZ UDP明朝',
  'BIZ UDPゴシック',
  'Noto Serif JP',
  'Noto Sans JP',
] as const;

const SEMANTIC_FAMILIES: Record<string, string> = {
  'アンチック体': '"FOT-アンチックStd B", "A-OTF アンチックStd B", "Yu Mincho", "Hiragino Mincho ProN", serif',
  '明朝体': '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif',
  'ゴシック体': '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif',
  'BIZ UDP明朝': '"BIZ UDPMincho", "BIZ UDP明朝", "Yu Mincho", serif',
  'BIZ UDPゴシック': '"BIZ UDPGothic", "BIZ UDPゴシック", "Yu Gothic", sans-serif',
  'Noto Serif JP': '"Noto Serif JP", "Yu Mincho", serif',
  'Noto Sans JP': '"Noto Sans JP", "Yu Gothic", sans-serif',
};

/** 端末にある任意の書体名も、そのままCSSプレビューへ使用する。 */
export function bubbleCssFontFamily(font: string | undefined): string {
  const name = font?.trim() || 'アンチック体';
  return SEMANTIC_FAMILIES[name] ?? `"${name.replaceAll('"', '\\"')}", "Yu Mincho", serif`;
}
