import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import type { BBox, ImageAsset, PaintDocument } from '../types';
import type { PaintScene } from '../lib/paintDocument';
import type { FinishBatch } from './MangaFinishDialog';
import { finishLayerKey } from '../lib/mangaFinishLayers';
import {
  applyRasterUpscaleLayers, canUpscalePaintLayer, captureRasterUpscaleLayer,
  type RasterUpscaleLayerResult,
} from '../lib/rasterUpscaleLayers';
import { decodePaintImage, paintPreviewRenderer, type PaintImages } from '../lib/paintRenderer';
import { prepareImageAsset } from '../lib/imagePlacement';
import { blobDataUrl, dataUrlBlob } from '../lib/localBridge';
import { requestRasterUpscale } from '../lib/localBridgeLifecycle';
import './MangaFinishDialog.css';

const CAPTURE_EDGE = 1536;

interface PreviewEntry {
  label: string;
  after: PaintDocument;
  bbox: BBox;
  width: number;
  height: number;
}

interface Props {
  scene: PaintScene;
  images: PaintImages | null;
  assets: ImageAsset[];
  panel: number;
  selectedKeys: string[];
  loadError: string;
  onApply: (batch: FinishBatch) => void;
  onClose: () => void;
}

function Preview({ paint, images, bbox, width, height }: { paint: PaintDocument; images: PaintImages; bbox: BBox; width: number; height: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = Math.min(1, 560 / Math.max(width, height));
  useLayoutEffect(() => {
    const renderer = paintPreviewRenderer();
    try {
      renderer.draw(canvas.current!, paint, images, undefined, undefined, false, bbox);
    } finally {
      renderer.dispose();
    }
  }, [paint, images, bbox, width, height]);
  return <canvas ref={canvas} width={Math.max(1, Math.round(width * scale))} height={Math.max(1, Math.round(height * scale))} />;
}

interface SelectedUpscaleLayer {
  owner: PaintScene['owners'][number];
  layer: PaintDocument['layers'][number];
  label: string;
}

interface CapturedUpscaleLayer extends SelectedUpscaleLayer {
  bbox: BBox;
  dataUrl: string;
}

interface CaptureCache {
  key: string;
  scene: PaintScene;
  images: PaintImages;
  entries: CapturedUpscaleLayer[];
}

function selectUpscaleLayers(scene: PaintScene, selectedKeys: string[]): SelectedUpscaleLayer[] {
  return scene.owners.flatMap(owner =>
    owner.paint.layers
      .filter(layer => selectedKeys.includes(finishLayerKey(owner.key, layer.id)) && canUpscalePaintLayer(layer))
      .map(layer => ({ owner, layer, label: `${owner.label} / ${layer.name}` })),
  );
}

function releaseOwnedImages(set: Set<HTMLImageElement>) {
  for (const image of set) image.src = '';
  set.clear();
}

export default function RasterUpscaleDialog({ scene, images, assets, selectedKeys, loadError, onApply, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'ai2x' | 'ai4x'>('ai2x');
  const [threshold, setThreshold] = useState(180);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [fallbackNotice, setFallbackNotice] = useState(false);
  const [preview, setPreview] = useState<{ batch: FinishBatch; entries: PreviewEntry[]; mode: 'ai2x' | 'ai4x' } | null>(null);
  const [index, setIndex] = useState(0);
  const current = useRef(true);
  const request = useRef<AbortController | null>(null);
  const runId = useRef(0);
  const hasRunOnce = useRef(false);
  const captureCache = useRef<CaptureCache | null>(null);
  const owned = useRef(new Set<HTMLImageElement>());

  const selected = selectUpscaleLayers(scene, selectedKeys);

  useEffect(() => {
    current.current = true;
    dialog.current?.showModal();
    return () => {
      current.current = false;
      runId.current += 1;
      request.current?.abort();
      captureCache.current = null;
      releaseOwnedImages(owned.current);
    };
  }, []);

  async function executeUpscale(
    id: number,
    controller: AbortController,
    targets: SelectedUpscaleLayer[],
    runMode: 'ai2x' | 'ai4x',
  ): Promise<{ batch: FinishBatch; entries: PreviewEntry[]; batchOwned: Set<HTMLImageElement>; usedFallback: boolean } | null> {
    if (!images || !targets.length) return null;
    const batchOwned = new Set<HTMLImageElement>();
    const isStale = () => controller.signal.aborted || id !== runId.current || !current.current;

    try {
      const cacheKey = `${CAPTURE_EDGE}|${selectedKeys.join(',')}`;
      const cached = captureCache.current;
      let capturedEntries: CapturedUpscaleLayer[];

      if (cached && cached.key === cacheKey && cached.scene === scene && cached.images === images) {
        capturedEntries = cached.entries;
      } else {
        capturedEntries = [];
        for (const target of targets) {
          if (isStale()) {
            releaseOwnedImages(batchOwned);
            return null;
          }
          const { blob, bbox } = await captureRasterUpscaleLayer(target.owner, target.layer, images, CAPTURE_EDGE);
          if (isStale()) {
            releaseOwnedImages(batchOwned);
            return null;
          }
          const dataUrl = await blobDataUrl(blob);
          if (isStale()) {
            releaseOwnedImages(batchOwned);
            return null;
          }
          capturedEntries.push({ ...target, bbox, dataUrl });
        }
        captureCache.current = { key: cacheKey, scene, images, entries: capturedEntries };
      }

      const map = new Map(images);
      const pending = new Map<string, { asset: ImageAsset; blob: Blob }>();
      const results: RasterUpscaleLayerResult[] = [];
      const entries: PreviewEntry[] = [];
      let usedFallback = false;

      for (const { owner, layer, label, bbox, dataUrl } of capturedEntries) {
        if (isStale()) {
          releaseOwnedImages(batchOwned);
          return null;
        }
        const upscaled = await requestRasterUpscale(
          dataUrl,
          {
            mode: runMode,
            maxEdge: 4096,
            preserveAlpha: true,
            outputMode: 'monochrome',
            threshold,
          },
          controller.signal,
        );
        if (isStale()) {
          releaseOwnedImages(batchOwned);
          return null;
        }
        if (upscaled.modeUsed === 'lanczos2x') usedFallback = true;

        const png = dataUrlBlob(upscaled.image);
        if (png?.type !== 'image/png') {
          throw new Error(`「${layer.name}」の高精細化画像を読み込めませんでした`);
        }
        const prepared = await prepareImageAsset(new File([png], `${layer.name}（高精細）.png`, { type: 'image/png' }));
        if (isStale()) {
          releaseOwnedImages(batchOwned);
          return null;
        }
        const asset = pending.get(prepared.id)?.asset ?? assets.find(item => item.id === prepared.id) ?? prepared;
        if (!map.has(asset.id)) {
          const decoded = await decodePaintImage(png);
          if (isStale()) {
            decoded.src = '';
            releaseOwnedImages(batchOwned);
            return null;
          }
          batchOwned.add(decoded);
          map.set(asset.id, decoded);
        }
        if (!pending.has(asset.id)) pending.set(asset.id, { asset, blob: png });

        results.push({ owner, layer, bbox, asset, outputMode: 'monochrome' });
        entries.push({
          label,
          bbox,
          width: upscaled.width,
          height: upscaled.height,
          after: owner.paint,
        });
      }

      const nextScene = applyRasterUpscaleLayers(scene, results);
      let focus: FinishBatch['focus'] | undefined;
      results.forEach(({ owner, layer }, i) => {
        const paint = nextScene.owners.find(item => item.key === owner.key)!.paint;
        const created = paint.layers[paint.layers.findIndex(item => item.id === layer.id) + 1];
        if (!created) throw new Error('高精細化レイヤーが見つかりません');
        if (!focus) focus = { ownerKey: owner.key, folderId: created.id };
        entries[i].after = { ...paint, folders: undefined, layers: [created] };
      });

      if (isStale() || !focus) {
        releaseOwnedImages(batchOwned);
        return null;
      }

      return {
        batch: { source: scene, scene: nextScene, images: map, imports: [...pending.values()], focus },
        entries,
        batchOwned,
        usedFallback,
      };
    } catch (cause) {
      releaseOwnedImages(batchOwned);
      throw cause;
    }
  }

  async function runPreview(id: number, controller: AbortController, targets: SelectedUpscaleLayer[]) {
    setBusy(true);
    try {
      // プレビューは高速(ai2x)で即時表示し、「高品質(ai4x)」選択時は適用時のみ本変換する
      const out = await executeUpscale(id, controller, targets, 'ai2x');
      if (!out) return;
      const previousOwned = owned.current;
      owned.current = out.batchOwned;
      releaseOwnedImages(previousOwned);
      setError('');
      setFallbackNotice(out.usedFallback);
      setIndex(prev => Math.min(prev, Math.max(0, out.entries.length - 1)));
      setPreview({ batch: out.batch, entries: out.entries, mode: 'ai2x' });
    } catch (cause) {
      if (id === runId.current && current.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '高精細化に失敗しました');
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (current.current) setBusy(false);
      }
    }
  }

  useEffect(() => {
    const targets = selectUpscaleLayers(scene, selectedKeys);
    if (!images || !targets.length) {
      runId.current += 1;
      request.current?.abort();
      request.current = null;
      setBusy(false);
      return;
    }

    runId.current += 1;
    const id = runId.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;

    const delay = hasRunOnce.current ? 120 : 0;
    hasRunOnce.current = true;
    const timer = window.setTimeout(() => {
      void runPreview(id, controller, targets);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [scene, images, assets, selectedKeys, threshold]);

  async function apply() {
    if (!preview || applying) return;
    if (mode === preview.mode) {
      try {
        onApply(preview.batch);
        owned.current.clear();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '高精細化を適用できません');
      }
      return;
    }

    // 高品質(ai4x)選択時は適用押下時に本変換して適用
    const targets = selectUpscaleLayers(scene, selectedKeys);
    if (!images || !targets.length) return;
    setApplying(true);
    setBusy(true);
    runId.current += 1;
    const id = runId.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const out = await executeUpscale(id, controller, targets, mode);
      if (!out) return;
      const previousOwned = owned.current;
      owned.current = out.batchOwned;
      releaseOwnedImages(previousOwned);
      onApply(out.batch);
      owned.current.clear();
    } catch (cause) {
      if (id === runId.current && current.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '高精細化を適用できません');
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
      }
      if (current.current) {
        setApplying(false);
        setBusy(false);
      }
    }
  }

  const shown = preview?.entries[index];
  return (
    <dialog
      class="image-export-dialog manga-finish-dialog line-trace-dialog"
      ref={dialog}
      aria-labelledby="raster-upscale-title"
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={event => event.stopPropagation()}
    >
      <header>
        <h2 id="raster-upscale-title">高精細化</h2>
        <button type="button" class="icon-button" aria-label="閉じる" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {!selected.length && (
        <p class="manga-finish-target">
          原稿で高精細化したい画像・描画レイヤーを選んでください。
        </p>
      )}
      <div class="line-trace-controls">
        <label class="line-trace-row">
          <span>処理モード</span>
          <select
            value={mode}
            onChange={event => setMode(event.currentTarget.value as 'ai2x' | 'ai4x')}
          >
            <option value="ai2x">高速（2倍）</option>
            <option value="ai4x">高品質（4倍）</option>
          </select>
        </label>
        <label class="line-trace-row">
          <span>二値化しきい値（{threshold}）</span>
          <input
            type="range"
            min="60"
            max="240"
            step="5"
            value={threshold}
            onInput={event => setThreshold(Number(event.currentTarget.value))}
          />
        </label>
      </div>
      {preview && shown && (
        <section class="manga-finish-comparison line-trace-preview-single">
          {preview.entries.length > 1 && (
            <select aria-label="プレビューするレイヤー" value={index} onChange={e => setIndex(Number(e.currentTarget.value))}>
              {preview.entries.map((item, i) => (
                <option value={i}>{item.label}</option>
              ))}
            </select>
          )}
          <div>
            <figure>
              <Preview paint={shown.after} images={preview.batch.images} bbox={shown.bbox} width={shown.width} height={shown.height} />
            </figure>
          </div>
        </section>
      )}
      {fallbackNotice && (
        <p role="status">
          JaNai モデル未導入のため Lanczos 拡大で処理しました（npm run setup:vision で導入できます）
        </p>
      )}
      {(error || loadError) && <p role="alert">{error || loadError}</p>}
      <footer>
        <button type="button" class="primary-button" disabled={!preview || busy || applying} onClick={() => void apply()}>
          適用
        </button>
      </footer>
    </dialog>
  );
}
