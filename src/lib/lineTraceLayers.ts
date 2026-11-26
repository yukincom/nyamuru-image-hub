import type { BBox, ImageAsset, PaintLayer, VectorNode, VectorPath } from '../types.ts';
import { imageCrop } from './imagePlacement.ts';
import type { LineTraceResponse, LineTraceStroke } from './localBridgeLifecycle.ts';
import { canFinishPaintLayer, captureMangaFinishLayer } from './mangaFinishLayers.ts';
import { newPaintLayer, paintLayerTree, withPaintLayerTree, type PaintLayerTreeEntry, type PaintOwner, type PaintScene } from './paintDocument.ts';
import type { PaintImages } from './paintRenderer.ts';
import { defaultVectorStyle } from './vectorGeometry.ts';

export { canFinishPaintLayer as canTracePaintLayer, captureMangaFinishLayer as captureLineTraceLayer };

export interface LineTraceLayerResult {
  owner: PaintOwner;
  layer: PaintLayer;
  bbox: BBox;
  paths: VectorPath[];
  betaAsset?: ImageAsset;
}

/** Convert a traced CSP-compatible Catmull-Rom stroke into a smooth editable `VectorPath` in owner pixel coordinates. */
export function tracedStrokesToVectorPaths(
  strokes: readonly LineTraceStroke[],
  tracedWidth: number,
  tracedHeight: number,
  bbox: BBox,
  strokeColor = '#000000',
): VectorPath[] {
  if (tracedWidth <= 0 || tracedHeight <= 0 || bbox.w <= 0 || bbox.h <= 0) return [];
  const sx = bbox.w / tracedWidth;
  const sy = bbox.h / tracedHeight;
  const rScale = Math.sqrt(Math.abs(sx * sy));
  const baseStyle = defaultVectorStyle();
  const out: VectorPath[] = [];

  for (const stroke of strokes) {
    const pts = stroke.points;
    if (!pts.length) continue;
    const cornerSet = new Set(stroke.corners ?? []);
    const mapped = pts.map(([x, y, r]) => ({
      x: bbox.x + x * sx,
      y: bbox.y + y * sy,
      r: Math.max(0.15, r * rScale),
    }));
    let rMax = 0.15;
    for (const p of mapped) if (p.r > rMax) rMax = p.r;

    const n = mapped.length;
    const nodes: VectorNode[] = mapped.map((p, i) => {
      const width = Math.max(0.02, Math.min(1, p.r / rMax));
      const isCorner = cornerSet.has(i) || (!stroke.closed && (i === 0 || i === n - 1));
      if (n < 3 || isCorner) {
        return { x: p.x, y: p.y, width, ...(cornerSet.has(i) ? { corner: true } : {}) };
      }
      const prev = mapped[(i + n - 1) % n];
      const next = mapped[(i + 1) % n];
      const hx = (next.x - prev.x) / 6;
      const hy = (next.y - prev.y) / 6;
      return {
        x: p.x,
        y: p.y,
        width,
        handleIn: { x: -hx, y: -hy },
        handleOut: { x: hx, y: hy },
      };
    });

    out.push({
      id: crypto.randomUUID(),
      closed: Boolean(stroke.closed),
      nodes,
      style: {
        ...baseStyle,
        stroke: strokeColor,
        fill: null,
        width: Math.max(0.3, rMax * 2),
        cap: 'round',
        join: 'round',
        profile: 'variable',
      },
    });
  }
  return out;
}

function lineTraceFolder({ layer, bbox, paths, betaAsset }: LineTraceLayerResult): Extract<PaintLayerTreeEntry, { kind: 'folder' }> {
  const children: PaintLayerTreeEntry[] = [];
  if (betaAsset) {
    const betaLayer: PaintLayer = {
      ...newPaintLayer('ベタ塗り'),
      blend: layer.blend,
      antialias: 0,
      image: { assetId: betaAsset.id, crop: imageCrop(betaAsset), bbox: { ...bbox } },
    };
    children.push({ kind: 'layer', layer: betaLayer });
  }
  const vecLayer: PaintLayer = {
    ...newPaintLayer('線画', 'vector'),
    blend: layer.blend,
    antialias: 0,
    kind: 'vector',
    paths: [...paths],
  };
  children.push({ kind: 'layer', layer: vecLayer });
  return {
    kind: 'folder',
    folder: {
      id: crypto.randomUUID(),
      name: 'ベクター線画✨',
      position: 0,
      aboveNative: layer.aboveNative,
      visible: layer.visible,
    },
    children,
  };
}

export function applyLineTraceLayers(scene: PaintScene, results: readonly LineTraceLayerResult[]): PaintScene {
  if (!results.length) return scene;
  const grouped = new Map<PaintOwner, Map<PaintLayer, LineTraceLayerResult>>();
  for (const result of results) {
    if (!scene.owners.includes(result.owner) || !result.owner.paint.layers.includes(result.layer)) {
      throw new Error('変換中に対象レイヤーが変更されました。選び直してください');
    }
    const group = grouped.get(result.owner) ?? new Map<PaintLayer, LineTraceLayerResult>();
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
        const folder = lineTraceFolder(result);
        added += folder.children.length;
        entries.splice(i, 1, { kind: 'layer', layer: { ...entry.layer, visible: false } }, folder);
      }
    }
    insert(tree);
    if (paint.layers.length + added > 64 || (paint.folders?.length ?? 0) + group.size > 64) {
      throw new Error('ベクター線画を追加するとレイヤーまたはフォルダーの上限（64）を超えます');
    }
    return { ...owner, paint: withPaintLayerTree(paint, tree) };
  });
  return { ...scene, owners };
}

export async function buildLineTracePreview(
  owner: PaintOwner,
  layer: PaintLayer,
  images: PaintImages,
  longEdge: number,
  runTrace: (dataUrl: string) => Promise<LineTraceResponse>,
): Promise<{ bbox: BBox; response: LineTraceResponse; paths: VectorPath[]; beforeBlob: Blob }> {
  const { blob, bbox } = await captureMangaFinishLayer(owner, layer, images, longEdge);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('レイヤー画像の読み取りに失敗しました'));
    reader.readAsDataURL(blob);
  });
  const response = await runTrace(dataUrl);
  const paths = tracedStrokesToVectorPaths(response.strokes, response.width, response.height, bbox);
  return { bbox, response, paths, beforeBlob: blob };
}
