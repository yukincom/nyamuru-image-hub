import {paintLayerVisible} from './paintLock';
import type { BBox, ImageAsset, Panel } from '../types.ts';
import { panelBounds } from './canvasGeometry.ts';
import { paintScene, paintReferenceBox, paintGuideView, figurePaintVisible, type PaintOwner } from './paintDocument.ts';
import { prepareGuideLayer } from './paintGuide.ts';
import { decodePaintImage, loadPaintImages, renderPaintPng } from './paintRenderer.ts';
import { captureHumanPoseReference } from './humanPoseGeneration.ts';
import { humanPoseFigureFrame, humanPosePanelCutFrame } from './humanPoseFraming.ts';
import { humanPoseSceneFrame } from './humanPoseScene.ts';

export interface HumanPosePanelContext {
  panel: Panel;
  selectedIndex: number;
  assets: ImageAsset[];
  dpi: number;
  guides?: Record<string, boolean>;
}

/** Reuse the paint renderer and the current native/scanned guide, without saving new assets. */
export async function humanPoseOwnerImage(owner: PaintOwner, assets: ImageAsset[], guide?: boolean, integratedGuide?: boolean): Promise<Blob> {
  const paint = paintGuideView(owner, guide, integratedGuide);
  const preparedAssets = [...assets], pending = new Map<string, Blob>();
  paint.layers = paint.layers.filter(layer => paintLayerVisible(paint,layer) && layer.opacity > 0);
  for (let index = 0; index < paint.layers.length; index++) {
    const layer = paint.layers[index];
    if (!layer.guide || layer.image) continue;
    const prepared = await prepareGuideLayer({ ...owner, paint }, layer);
    paint.layers[index] = prepared.layer; preparedAssets.push(prepared.asset); pending.set(prepared.asset.id, prepared.blob);
  }
  const images = await loadPaintImages([paint], preparedAssets, pending);
  try { return await renderPaintPng(paint, images); }
  finally { images.forEach(image => { image.src = ''; }); }
}

export async function humanPoseFigureImage(owner: PaintOwner, panel: Panel, assets: ImageAsset[], guide?: boolean): Promise<{ image: string; frame: BBox }> {
  const pose = owner.figure?.human_pose;
  if (pose?.input_mode === 'image' && pose.scene) {
    const reference = owner.paint.referenceFrame ? paintReferenceBox(owner.paint, owner.frame) : humanPoseFigureFrame({ ...owner.figure!, bbox: owner.frame }, owner.frame);
    const cut = humanPosePanelCutFrame(panel, reference);
    return { image: await captureHumanPoseReference(pose, owner.figure?.size ?? 'bust-up', cut.aspect, cut), frame: panelBounds(panel) };
  }
  const blob = await humanPoseOwnerImage(owner, assets, guide);
  return { image: await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('人物の仮表示を読み込めません')); reader.readAsDataURL(blob);
  }), frame: owner.frame };
}

export async function drawHumanPoseImage(context: CanvasRenderingContext2D, image: string | Blob, frame: BBox, viewport: BBox): Promise<void> {
  const bitmap = typeof image === 'string' ? new Image() : await decodePaintImage(image);
  if (typeof image === 'string') { bitmap.src = image; await bitmap.decode(); }
  try {
    context.drawImage(bitmap, (frame.x - viewport.x) / viewport.w * context.canvas.width, (frame.y - viewport.y) / viewport.h * context.canvas.height,
      frame.w / viewport.w * context.canvas.width, frame.h / viewport.h * context.canvas.height);
  } finally { bitmap.src = ''; }
}

/** Keep the selected 3D canvas between the same foreground/background figures as the page. */
export async function captureHumanPoseCompanions(input: HumanPosePanelContext): Promise<{ behind: string; ahead: string }> {
  const bounds = panelBounds(input.panel), size = humanPoseSceneFrame(bounds.w / bounds.h);
  const canvases = [document.createElement('canvas'), document.createElement('canvas')];
  canvases.forEach(canvas => { canvas.width = size.width; canvas.height = size.height; });
  const owners = paintScene(input.panel, input.dpi, input.assets).owners.filter(owner => owner.kind === 'figure');
  let ahead = false;
  for (const owner of owners) {
    if (owner.index === input.selectedIndex) { ahead = true; continue; }
    if (!figurePaintVisible(owner.figure, input.guides?.[owner.key])) continue;
    const view = await humanPoseFigureImage(owner, input.panel, input.assets, input.guides?.[owner.key]);
    const context = canvases[Number(ahead)].getContext('2d'); if (!context) throw new Error('相方の表示を作れません');
    await drawHumanPoseImage(context, view.image, view.frame, bounds);
  }
  return { behind: canvases[0].toDataURL('image/png'), ahead: canvases[1].toDataURL('image/png') };
}
