import type { AnalogFigureImport, BBox } from '../types.ts';
import type { DetectedFigureRegion } from './localBridge.ts';

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

function normalizedBox(box: BBox): BBox {
  const left = Math.min(1, Math.max(0, box.x));
  const top = Math.min(1, Math.max(0, box.y));
  const right = Math.min(1, Math.max(left, box.x + box.w));
  const bottom = Math.min(1, Math.max(top, box.y + box.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function cropPixelBounds(box: BBox, imageWidth: number, imageHeight: number): BBox {
  const normalized = normalizedBox(box);
  const left = Math.max(0, Math.floor(normalized.x * imageWidth));
  const top = Math.max(0, Math.floor(normalized.y * imageHeight));
  const right = Math.min(imageWidth, Math.ceil((normalized.x + normalized.w) * imageWidth));
  const bottom = Math.min(imageHeight, Math.ceil((normalized.y + normalized.h) * imageHeight));
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch {
      // HEICなどはブラウザごとにcreateImageBitmapとimgの対応範囲が異なるため、imgでも試す。
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
  if (!context) throw new Error('人物切り抜き用の画像処理を開始できませんでした');
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

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('人物切り抜き画像を作成できませんでした')),
    'image/png',
  ));
}

export function detectedFigureImport(sourceItemId: string, region: DetectedFigureRegion): AnalogFigureImport {
  const sourceRegionId = `${sourceItemId}:${region.id}`;
  return {
    schemaVersion: 1,
    sourceRegionId,
    assetId: `analog-figure:${sourceRegionId}`,
    sourceBBox: structuredClone(region.bbox),
    detectionSource: region.source,
    ...(region.confidence === undefined ? {} : { confidence: region.confidence }),
    draft: true,
  };
}

/** 原画を1ページずつ開き、同じ領域から解析用と保存用のPNGを必要な順に作る。 */
export async function* detectedFigureCrops(
  file: File,
  rotation: 0 | 90 | 180 | 270,
  regions: readonly DetectedFigureRegion[],
) {
  const decoded = await decodeImage(file);
  let upright: HTMLCanvasElement | null = null;
  try {
    const page = uprightCanvas(decoded, rotation);
    upright = page;
    for (const region of regions) {
      const bounds = cropPixelBounds(region.bbox, page.width, page.height);
      const png = async (scale: number) => {
        const crop = document.createElement('canvas');
        crop.width = Math.max(1, Math.round(bounds.w * scale));
        crop.height = Math.max(1, Math.round(bounds.h * scale));
        const context = crop.getContext('2d');
        if (!context) throw new Error('人物切り抜き用の画像処理を開始できませんでした');
        context.drawImage(page, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, crop.width, crop.height);
        try {
          return await canvasBlob(crop);
        } finally {
          crop.width = crop.height = 1;
        }
      };
      yield { regionId: region.id, original: () => png(1), forStorage: () => png(0.6) };
    }
  } finally {
    if (upright) {
      upright.width = 1;
      upright.height = 1;
    }
    decoded.dispose();
  }
}
