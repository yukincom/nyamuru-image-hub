import type { BBox } from '../types.ts';

/** Convert the existing frame, never the imported image's occupied pixels. */
export function artworkPixelSize(box: BBox, dpi: number) {
  if (![box.w, box.h, dpi].every(n => Number.isFinite(n) && n > 0)) throw new Error('枠のサイズまたは解像度が不正です');
  const width = Math.max(1, Math.round(box.w * dpi / 25.4));
  const height = Math.max(1, Math.round(box.h * dpi / 25.4));
  if (![width, height].every(Number.isSafeInteger)) throw new Error('画像サイズが大きすぎます');
  return { width, height, dpi };
}

export function artworkSizeText(box: BBox, dpi: number): string {
  const size = artworkPixelSize(box, dpi);
  return `${size.width} × ${size.height} px\n${Number(box.w.toFixed(3))} × ${Number(box.h.toFixed(3))} mm\n${dpi} dpi`;
}

export function blankArtworkPng(size: { width: number; height: number }): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    if (!canvas.getContext('2d')) { reject(new Error('サイズコピー用の画像を作れませんでした')); return; }
    // A transparent image lets paint apps create a canvas with exactly these dimensions.
    canvas.toBlob(blob => {
      canvas.width = 1; canvas.height = 1;
      blob ? resolve(blob) : reject(new Error('サイズコピー用の画像を作れませんでした'));
    }, 'image/png');
  });
}

export async function copyArtworkSize(box: BBox, dpi: number): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('このブラウザは画像のサイズコピーに対応していません');
  const size = artworkPixelSize(box, dpi);
  // Start write during the click; awaiting PNG encoding first loses activation in WebKit.
  const png = blankArtworkPng(size);
  void png.catch(() => undefined);
  await navigator.clipboard.write([new ClipboardItem({
    'image/png': png,
    'text/plain': new Blob([artworkSizeText(box, dpi)], { type: 'text/plain' }),
  })]);
}
