import { paintAssetIds, validatePaintDocument } from './paintDocument.ts';
import { CUBE_STAGE_ID, validateBackgroundStages } from './background3d.ts';
import type { BBox, Figure, ImageAsset, ImageContent, MangaDocument, PlacedImage } from '../types.ts';
import type { InteractionGeometry } from './canvasGeometry.ts';

export function fitImageBox(source: { w: number; h: number }, target: BBox): BBox {
  const scale = Math.min(target.w / source.w, target.h / source.h);
  const w = source.w * scale, h = source.h * scale;
  return { x: target.x + (target.w - w) / 2, y: target.y + (target.h - h) / 2, w, h };
}

export function imageCrop(asset: ImageAsset): BBox {
  return { x: 0, y: 0, w: asset.widthPx, h: asset.heightPx };
}

export async function imageSha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}

/** Only decode for display dimensions. Store and hash the untouched file bytes. */
export async function prepareImageAsset(file: File): Promise<ImageAsset> {
  if (!file.size || file.size > 48 * 1024 * 1024) throw new Error('画像は48MiB以下のPNG/JPEGを選んでください');
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => head[i] === n);
  const jpeg = head[0] === 255 && head[1] === 216 && head[2] === 255;
  if (!png && !jpeg) throw new Error('PNG/JPEG画像を選んでください');
  const mediaType = png ? 'image/png' : 'image/jpeg';
  const url = URL.createObjectURL(file);
  try {
    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('画像を読み込めませんでした'));
      img.src = url;
    });
    if (!size.width || !size.height) throw new Error('画像のサイズを読み込めませんでした');
    const sha256 = await imageSha256(file);
    return { id: `image-${sha256}`, storageId: `original-${crypto.randomUUID()}`, sha256, mediaType,
      originalName: file.name, widthPx: size.width, heightPx: size.height, byteLength: file.size };
  } finally { URL.revokeObjectURL(url); }
}

export function createImagePlacement(asset: ImageAsset, target: BBox): PlacedImage {
  const crop = imageCrop(asset);
  return { id: crypto.randomUUID(), assetId: asset.id, bbox: fitImageBox(crop, target), crop,
    opacity: 1, hidden: false, locked: false };
}

/** Replace the contents of an existing frame without changing that frame. */
export function createFrameArtwork(asset: ImageAsset, box: BBox): PlacedImage {
  return { ...createImagePlacement(asset, box), bbox: { ...box } };
}

/** Change the visible source region without moving or rescaling the original. */
export function changeImageCrop(image: PlacedImage, crop: BBox): PlacedImage {
  const scale = image.bbox.w / image.crop.w;
  return { ...image, crop, bbox: {
    x: image.bbox.x + (crop.x - image.crop.x) * scale,
    y: image.bbox.y + (crop.y - image.crop.y) * scale,
    w: crop.w * scale, h: crop.h * scale,
  } };
}

export function validImageBox(box: BBox): boolean {
  return Boolean(box && [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.w > 0 && box.h > 0);
}
export function validImageCrop(crop: BBox, asset: ImageAsset): boolean {
  return validImageBox(crop) && crop.x >= 0 && crop.y >= 0
    && crop.x + crop.w <= asset.widthPx && crop.y + crop.h <= asset.heightPx;
}

export function validateImagePlacements(document: MangaDocument): void {
  validateBackgroundStages(document.manga.background_stages);
  const stageIds=new Set([CUBE_STAGE_ID,...(document.manga.background_stages??[]).map(stage=>stage.id)]);
  for(const material of document.manga.materials??[])if(material.source_stage_id!==undefined&&material.source_stage_id!==null&&(material.type!=='background'||!stageIds.has(material.source_stage_id)||material.source_stage_id===CUBE_STAGE_ID))throw new Error('背景資料の3Dモデルが見つかりません');
  const assets = document.manga.image_assets ?? [];
  if (!Array.isArray(assets)) throw new Error('配置画像の原本情報が不正です');
  const byId = new Map<string, ImageAsset>();
  for (const asset of assets) {
    if (!asset || typeof asset.id !== 'string' || !asset.id || byId.has(asset.id)
      || typeof asset.storageId !== 'string' || !asset.storageId || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || !['image/png', 'image/jpeg'].includes(asset.mediaType) || typeof asset.originalName !== 'string'
      || ![asset.widthPx, asset.heightPx, asset.byteLength].every(n => Number.isSafeInteger(n) && n > 0)) {
      throw new Error('配置画像の原本情報が不正です');
    }
    byId.set(asset.id, asset);
  }
  const validate = (item: ImageContent, bbox: BBox | undefined) => {
    const asset = item && byId.get(item.assetId);
    if (!asset || !bbox || !validImageBox(bbox) || !validImageCrop(item.crop, asset)
      || !Number.isFinite(item.opacity) || item.opacity < 0 || item.opacity > 1
      || typeof item.hidden !== 'boolean' || typeof item.locked !== 'boolean') throw new Error('画像の配置情報または原本が不正です');
    if (item.paint) {
      validatePaintDocument(item.paint, assets);
      if(item.paint.background3d&&!stageIds.has(item.paint.background3d.sourceId))throw new Error('3D背景の元の舞台が見つかりません');
      if (item.paint.width !== asset.widthPx || item.paint.height !== asset.heightPx) throw new Error('ペイントと合成画像のサイズが一致しません');
    }
  };
  const validateCollection = (items?: PlacedImage[]) => {
    if (items !== undefined && !Array.isArray(items)) throw new Error('画像の配置情報が不正です');
    const ids = new Set<string>();
    for (const item of items ?? []) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('画像の配置情報が不正です');
      ids.add(item.id);
      validate(item, item.bbox);
    }
  };
  for (const page of document.manga.pages) {
    validateCollection(page.images);
    for (const panel of page.panels) { validateCollection(panel.images); validateCollection(panel.background_images); }
    for (const owner of [...page.panels, page.page_overlay]) {
      for (const figure of owner?.figures ?? []) {
        if (figure.artwork !== undefined) validate(figure.artwork, figure.bbox);
        if (figure.human_pose?.scene?.background && !stageIds.has(figure.human_pose.scene.background.sourceId)) throw new Error('人体ポーズの元の3D舞台が見つかりません');
      }
      for (const bubble of owner?.bubbles ?? []) if (bubble.paint_overlay !== undefined) validate(bubble.paint_overlay, bubble.bbox);
    }
  }
}

/** All original references, regardless of their editing owner. */
export function imageContents(document: MangaDocument): ImageContent[] {
  return document.manga.pages.flatMap(page => [
    ...(page.images ?? []), ...page.panels.flatMap(panel => [...(panel.images ?? []), ...(panel.background_images ?? [])]),
    ...[...page.panels, page.page_overlay].flatMap(owner => [
      ...(owner?.figures?.flatMap(figure => figure.artwork ? [figure.artwork] : []) ?? []),
      ...(owner?.bubbles?.flatMap(bubble => bubble.paint_overlay ? [bubble.paint_overlay] : []) ?? []),
    ]),
  ]);
}

export function imageAssetIds(document: MangaDocument): Set<string> {
  return new Set(imageContents(document).flatMap(image => [image.assetId, ...paintAssetIds(image.paint)]));
}

export function figureArtwork(figure: Figure): PlacedImage | undefined {
  return figure.artwork && figure.bbox ? { ...figure.artwork, id: 'figure-artwork', bbox: figure.bbox } : undefined;
}

/** Keep the character, action and single placement rectangle when adopting art. */
export function setFigureArtwork(figure: Figure, image: PlacedImage): void {
  const { assetId, crop, opacity, hidden, locked, paint } = image;
  figure.artwork = { assetId, crop, opacity, hidden, locked, ...(paint ? { paint } : {}) };
  figure.bbox = { ...image.bbox };
}

export async function verifyOriginal(asset: ImageAsset, blob: Blob): Promise<void> {
  if (blob.size !== asset.byteLength || blob.type !== asset.mediaType || await imageSha256(blob) !== asset.sha256) {
    throw new Error(`画像「${asset.originalName}」の原本が保存情報と一致しません`);
  }
}

/** Panel clipping does not constrain artwork to the panel's interior. */
export function artworkInteractionBounds(box: BBox, canvas: { w: number; h: number }): BBox {
  const x = Math.min(0, box.x), y = Math.min(0, box.y);
  return { x, y, w: Math.max(canvas.w, box.x + box.w) - x, h: Math.max(canvas.h, box.y + box.h) - y };
}

/** Corner resizing keeps the opposite corner fixed and preserves aspect ratio. */
export function resizeImageBox(interaction: InteractionGeometry, clientX: number, clientY: number): BBox {
  const { startBox: box, bounds, mode, paperRect, canvas } = interaction;
  if (!canvas) return { ...box };
  const dx = (clientX - interaction.startClientX) * canvas.w / paperRect.width;
  const dy = (clientY - interaction.startClientY) * canvas.h / paperRect.height;
  if (dx === 0 && dy === 0) return { ...box };
  if (mode === 'move') return { ...box,
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.w - box.w, box.x + dx)),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.h - box.h, box.y + dy)) };
  const west = mode.includes('w'), north = mode.includes('n');
  const anchorX = west ? box.x + box.w : box.x, anchorY = north ? box.y + box.h : box.y;
  const sx = (west ? -dx : dx) / box.w, sy = (north ? -dy : dy) / box.h;
  const desired = 1 + (Math.abs(sx) > Math.abs(sy) ? sx : sy);
  const availableW = west ? anchorX - bounds.x : bounds.x + bounds.w - anchorX;
  const availableH = north ? anchorY - bounds.y : bounds.y + bounds.h - anchorY;
  const maxScale = Math.min(availableW / box.w, availableH / box.h);
  const scale = Math.max(Math.min(1 / Math.max(box.w, box.h), maxScale), Math.min(maxScale, desired));
  const w = box.w * scale, h = box.h * scale;
  return { x: west ? anchorX - w : anchorX, y: north ? anchorY - h : anchorY, w, h };
}
