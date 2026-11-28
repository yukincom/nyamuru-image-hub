import type { BBox, ImageAsset, PaintLayer } from '../types.ts';
import { imageCrop } from './imagePlacement.ts';
import { canFinishPaintLayer, captureMangaFinishLayer } from './mangaFinishLayers.ts';
import { newPaintLayer, paintLayerTree, withPaintLayerTree, type PaintLayerTreeEntry, type PaintOwner, type PaintScene } from './paintDocument.ts';

export { canFinishPaintLayer as canUpscalePaintLayer, captureMangaFinishLayer as captureRasterUpscaleLayer };

export interface RasterUpscaleLayerResult {
  owner: PaintOwner;
  layer: PaintLayer;
  bbox: BBox;
  asset: ImageAsset;
  outputMode: 'color' | 'monochrome';
}

/** Insert upscaled raster layers non-destructively above hidden source layers. */
export function applyRasterUpscaleLayers(scene: PaintScene, results: readonly RasterUpscaleLayerResult[]): PaintScene {
  if (!results.length) return scene;
  const grouped = new Map<PaintOwner, Map<PaintLayer, RasterUpscaleLayerResult>>();
  for (const result of results) {
    if (!scene.owners.includes(result.owner) || !result.owner.paint.layers.includes(result.layer)) {
      throw new Error('高精細化中に対象レイヤーが変更されました。選び直してください');
    }
    const group = grouped.get(result.owner) ?? new Map<PaintLayer, RasterUpscaleLayerResult>();
    if (group.has(result.layer)) throw new Error('同じレイヤーが複数選択されています');
    group.set(result.layer, result);
    grouped.set(result.owner, group);
  }

  const owners = scene.owners.map(owner => {
    const group = grouped.get(owner);
    if (!group) return owner;
    const paint = owner.paint;
    const tree = paintLayerTree(paint);
    let added = 0;

    function insert(entries: PaintLayerTreeEntry[]) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.kind === 'folder') {
          insert(entry.children);
          continue;
        }
        const result = group!.get(entry.layer);
        if (!result) continue;
        // renderPaintLayerCrop already bakes layer.opacity into the exported PNG.
        const upscaledLayer: PaintLayer = {
          ...newPaintLayer(`${entry.layer.name}（高精細）`),
          blend: entry.layer.blend,
          aboveNative: entry.layer.aboveNative,
          visible: entry.layer.visible,
          antialias: result.outputMode === 'monochrome' ? 0 : (entry.layer.antialias ?? 3),
          image: { assetId: result.asset.id, crop: imageCrop(result.asset), bbox: { ...result.bbox } },
        };
        added += 1;
        entries.splice(i, 1, { kind: 'layer', layer: { ...entry.layer, visible: false } }, { kind: 'layer', layer: upscaledLayer });
      }
    }

    insert(tree);
    if (paint.layers.length + added > 64) {
      throw new Error('高精細化レイヤーを追加するとレイヤーの上限（64）を超えます');
    }
    return { ...owner, paint: withPaintLayerTree(paint, tree) };
  });

  return { ...scene, owners };
}
