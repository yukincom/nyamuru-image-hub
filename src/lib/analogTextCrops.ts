import type { AnalogTextImport, BBox } from '../types.ts';
import { cropPixelBounds } from './analogFigureCrops.ts';
import type { FigureCropAsset } from './figureCropStore.ts';
import { groupRecognizedTextLines, recognizedTextOwnerKey, type RecognizedTextLine } from './localBridge.ts';

export interface PreparedTextCrop {
  lineId: string;
  metadata: AnalogTextImport;
  asset: FigureCropAsset;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

export interface LevelCorrectionRange {
  blackPoint: number;
  whitePoint: number;
}

/** 紙色とゴミの影響を抑えつつ、鉛筆線を残すための決定的なレベル範囲。 */
export function levelCorrectionRange(values: ArrayLike<number>): LevelCorrectionRange {
  const histogram = new Uint32Array(256);
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = Math.max(0, Math.min(255, Math.round(Number(values[index]) || 0)));
    histogram[value] += 1;
    count += 1;
  }
  if (!count) return { blackPoint: 0, whitePoint: 255 };
  const percentile = (ratio: number) => {
    const target = Math.max(1, Math.ceil(count * ratio));
    let seen = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      seen += histogram[value];
      if (seen >= target) return value;
    }
    return 255;
  };
  let blackPoint = percentile(0.06);
  const whitePoint = Math.max(blackPoint + 1, percentile(0.93));
  if (whitePoint - blackPoint < 40) blackPoint = Math.max(0, whitePoint - 80);
  return { blackPoint, whitePoint };
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch {
      // createImageBitmap非対応形式はimgで再試行する。
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    dispose: () => URL.revokeObjectURL(url),
  };
}

function uprightCanvas(image: DecodedImage, rotation: 0 | 90 | 180 | 270): HTMLCanvasElement {
  const swapAxes = rotation === 90 || rotation === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swapAxes ? image.height : image.width;
  canvas.height = swapAxes ? image.width : image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('原字参照用の画像処理を開始できませんでした');
  if (rotation === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(image.source, 0, 0);
  return canvas;
}

function levelCorrect(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('原字参照のレベル補正を開始できませんでした');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const luminance = new Uint8Array(canvas.width * canvas.height);
  for (let source = 0, target = 0; source < image.data.length; source += 4, target += 1) {
    luminance[target] = Math.round(
      image.data[source] * 0.2126
      + image.data[source + 1] * 0.7152
      + image.data[source + 2] * 0.0722,
    );
  }
  const { blackPoint, whitePoint } = levelCorrectionRange(luminance);
  const span = Math.max(1, whitePoint - blackPoint);
  for (let source = 0, target = 0; source < image.data.length; source += 4, target += 1) {
    const raw = luminance[target];
    const corrected = raw >= whitePoint
      ? 255
      : Math.max(0, Math.min(255, Math.round(((raw - blackPoint) / span) * 255)));
    image.data[source] = corrected;
    image.data[source + 1] = corrected;
    image.data[source + 2] = corrected;
    image.data[source + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('原字参照画像を作成できませんでした')),
    'image/png',
  ));
}

/** RT-DETRの文字領域を正確な位置のまま切り出し、レベル補正だけを適用する。 */
export async function prepareDetectedTextCrops(
  file: File,
  rotation: 0 | 90 | 180 | 270,
  sourceItemId: string,
  lines: readonly RecognizedTextLine[],
): Promise<PreparedTextCrop[]> {
  const grouped = groupRecognizedTextLines(lines);
  if (!grouped.length) return [];
  const decoded = await decodeImage(file);
  let upright: HTMLCanvasElement | null = null;
  try {
    upright = uprightCanvas(decoded, rotation);
    const prepared: PreparedTextCrop[] = [];
    for (const line of grouped) {
      const bounds = cropPixelBounds(line.bbox, upright.width, upright.height);
      const crop = document.createElement('canvas');
      crop.width = bounds.w;
      crop.height = bounds.h;
      const context = crop.getContext('2d');
      if (!context) throw new Error('原字参照用の画像処理を開始できませんでした');
      context.drawImage(upright, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
      levelCorrect(crop);
      const lineId = recognizedTextOwnerKey(line);
      const sourceRegionId = `${sourceItemId}:${lineId}`;
      const assetId = `analog-text:${sourceRegionId}`;
      prepared.push({
        lineId,
        metadata: {
          schemaVersion: 1,
          sourceRegionId,
          assetId,
          sourceBBox: structuredClone(line.bbox) as BBox,
          detectionSource: line.source,
          recognitionEngine: 'Baberu OCR',
          confidence: line.confidence,
          needsReview: line.needsReview,
          ...(line.unreadable ? { unreadable: true } : {}),
          levelAdjusted: true,
        },
        asset: { id: assetId, blob: await canvasBlob(crop) },
      });
      crop.width = 1;
      crop.height = 1;
    }
    return prepared;
  } finally {
    if (upright) {
      upright.width = 1;
      upright.height = 1;
    }
    decoded.dispose();
  }
}
