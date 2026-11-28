import type { AnalogFigureImport, BBox, MangaPage, PanelShape } from '../types.ts';
import type { DetectedFigureRegion, FigureFaceInput } from './localBridge.ts';
import { INNER_FRAME_BOUNDS } from './canvasGeometry.ts';
import { extractPanelBackgroundWithCutout, type PixelCrop } from './cloudPageSplit.ts';
import { shapeBounds } from './recognition/panelGeometry.ts';

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

/** ネームの保存用PNGは縦横60%。人物の読み取り用は原寸を指定する。 */
export async function analogCropPng(
  source: HTMLCanvasElement,
  bounds: BBox,
  label: '人物切り抜き' | '原字参照',
  scale = 0.6,
): Promise<Blob> {
  const crop = document.createElement('canvas');
  crop.width = Math.max(1, Math.round(bounds.w * scale));
  crop.height = Math.max(1, Math.round(bounds.h * scale));
  const context = crop.getContext('2d');
  if (!context) throw new Error(`${label}用の画像処理を開始できませんでした`);
  context.drawImage(source, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, crop.width, crop.height);
  try {
    return await new Promise<Blob>((resolve, reject) => crop.toBlob(
      blob => blob ? resolve(blob) : reject(new Error(`${label}画像を作成できませんでした`)),
      'image/png',
    ));
  } finally {
    crop.width = crop.height = 1;
  }
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
      yield {
        regionId: region.id,
        original: () => analogCropPng(page, bounds, '人物切り抜き', 1),
        face: async (): Promise<FigureFaceInput | undefined> => {
          if (region.source === 'face') return { bbox: [0, 0, 1, 1] };
          if (!region.faceBBox) return undefined;
          const face = cropPixelBounds(region.faceBBox, page.width, page.height);
          if (face.x === bounds.x && face.y === bounds.y && face.w === bounds.w && face.h === bounds.h) {
            return { bbox: [0, 0, 1, 1] };
          }
          const left = Math.max(0, (face.x - bounds.x) / bounds.w);
          const top = Math.max(0, (face.y - bounds.y) / bounds.h);
          const right = Math.min(1, (face.x + face.w - bounds.x) / bounds.w);
          const bottom = Math.min(1, (face.y + face.h - bounds.y) / bounds.h);
          if (left >= right || top >= bottom) return undefined;
          return { bbox: [left, top, right, bottom], image: await analogCropPng(page, face, '人物切り抜き', 1) };
        },
        forStorage: () => analogCropPng(page, bounds, '人物切り抜き'),
      };
    }
  } finally {
    if (upright) {
      upright.width = 1;
      upright.height = 1;
    }
    decoded.dispose();
  }
}

function panelBoundsToNormalized(shape: PanelShape, sourceFrame: BBox | null): BBox {
  const bounds = shapeBounds(shape);
  if (!sourceFrame || sourceFrame.w <= 0 || sourceFrame.h <= 0) {
    return {
      x: bounds.x / 210,
      y: bounds.y / 297,
      w: bounds.w / 210,
      h: bounds.h / 297,
    };
  }
  return {
    x: sourceFrame.x + ((bounds.x - INNER_FRAME_BOUNDS.x) / INNER_FRAME_BOUNDS.w) * sourceFrame.w,
    y: sourceFrame.y + ((bounds.y - INNER_FRAME_BOUNDS.y) / INNER_FRAME_BOUNDS.h) * sourceFrame.h,
    w: (bounds.w / INNER_FRAME_BOUNDS.w) * sourceFrame.w,
    h: (bounds.h / INNER_FRAME_BOUNDS.h) * sourceFrame.h,
  };
}

/** ネーム原画の各コマから人物領域を白抜きし、背景が描かれているコマだけ背景画像を切り出す。 */
export async function extractDetectedPanelBackgrounds(
  file: File,
  rotation: 0 | 90 | 180 | 270,
  analysis: {
    detectedPanels: readonly PanelShape[];
    detectedPanelIds?: readonly string[];
    detectedFigures: readonly DetectedFigureRegion[];
    sourceFrame: BBox | null;
  },
  page: MangaPage,
): Promise<Array<{ panelIndex: number; blob: Blob }>> {
  if (!analysis.detectedPanels.length) return [];
  const decoded = await decodeImage(file);
  let upright: HTMLCanvasElement | null = null;
  try {
    const canvas = uprightCanvas(decoded, rotation);
    upright = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    const results: Array<{ panelIndex: number; blob: Blob }> = [];

    for (let panelIndex = 0; panelIndex < analysis.detectedPanels.length; panelIndex++) {
      const panelShape = analysis.detectedPanels[panelIndex];
      const pagePanel = page.panels[panelIndex];
      if (!panelShape || !pagePanel) continue;
      const panelPx = cropPixelBounds(panelBoundsToNormalized(panelShape, analysis.sourceFrame), canvas.width, canvas.height);
      if (panelPx.w < 4 || panelPx.h < 4) continue;

      const sourcePanelId = analysis.detectedPanelIds?.[panelIndex];
      const cutoutRects: PixelCrop[] = [];
      for (const region of analysis.detectedFigures) {
        if (region.pageOverlay) continue;
        const figPx = cropPixelBounds(region.bbox, canvas.width, canvas.height);
        const ix0 = Math.max(panelPx.x, figPx.x);
        const iy0 = Math.max(panelPx.y, figPx.y);
        const ix1 = Math.min(panelPx.x + panelPx.w, figPx.x + figPx.w);
        const iy1 = Math.min(panelPx.y + panelPx.h, figPx.y + figPx.h);
        if (ix1 <= ix0 || iy1 <= iy0) continue;
        if (sourcePanelId && region.sourcePanelId && region.sourcePanelId !== sourcePanelId) continue;
        cutoutRects.push({
          x: ix0 - panelPx.x,
          y: iy0 - panelPx.y,
          w: ix1 - ix0,
          h: iy1 - iy0,
        });
      }

      const raw = ctx.getImageData(panelPx.x, panelPx.y, panelPx.w, panelPx.h);
      const { rgba, hasBackground } = extractPanelBackgroundWithCutout(raw.data, panelPx.w, panelPx.h, cutoutRects, pagePanel);
      if (!hasBackground) continue;

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = panelPx.w;
      srcCanvas.height = panelPx.h;
      const sctx = srcCanvas.getContext('2d');
      if (!sctx) continue;
      const imgData = sctx.createImageData(panelPx.w, panelPx.h);
      imgData.data.set(rgba);
      sctx.putImageData(imgData, 0, 0);

      const scale = Math.min(1, 1536 / Math.max(panelPx.w, panelPx.h));
      const outW = Math.max(1, Math.round(panelPx.w * scale));
      const outH = Math.max(1, Math.round(panelPx.h * scale));
      const outCanvas = document.createElement('canvas');
      outCanvas.width = outW;
      outCanvas.height = outH;
      const octx = outCanvas.getContext('2d');
      try {
        if (!octx) continue;
        octx.fillStyle = '#ffffff';
        octx.fillRect(0, 0, outW, outH);
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = 'high';
        octx.drawImage(srcCanvas, 0, 0, outW, outH);
        const blob = await new Promise<Blob>((resolve, reject) =>
          outCanvas.toBlob(result => (result ? resolve(result) : reject(new Error('背景切り出し画像を作成できませんでした'))), 'image/png'),
        );
        results.push({ panelIndex, blob });
      } finally {
        srcCanvas.width = srcCanvas.height = 1;
        outCanvas.width = outCanvas.height = 1;
      }
    }
    return results;
  } finally {
    if (upright) {
      upright.width = 1;
      upright.height = 1;
    }
    decoded.dispose();
  }
}
