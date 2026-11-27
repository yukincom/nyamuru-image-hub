import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import type { BBox, ImageAsset, PaintDocument } from '../types';
import type { PaintScene } from '../lib/paintDocument';
import type { FinishBatch } from './MangaFinishDialog';
import { finishLayerKey } from '../lib/mangaFinishLayers';
import {
  applyLineTraceLayers, canTracePaintLayer, captureLineTraceLayer, tracedStrokesToVectorPaths,
  type LineTraceLayerResult,
} from '../lib/lineTraceLayers';
import { decodePaintImage, paintPreviewRenderer, type PaintImages } from '../lib/paintRenderer';
import { prepareImageAsset } from '../lib/imagePlacement';
import { blobDataUrl, dataUrlBlob } from '../lib/localBridge';
import { requestLineTrace } from '../lib/localBridgeLifecycle';
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

interface SelectedTraceLayer {
  owner: PaintScene['owners'][number];
  layer: PaintDocument['layers'][number];
  label: string;
}

interface CapturedTraceLayer extends SelectedTraceLayer {
  bbox: BBox;
  dataUrl: string;
}

interface CaptureCache {
  key: string;
  scene: PaintScene;
  images: PaintImages;
  entries: CapturedTraceLayer[];
}

function selectTraceLayers(scene: PaintScene, selectedKeys: string[]): SelectedTraceLayer[] {
  return scene.owners.flatMap(owner =>
    owner.paint.layers
      .filter(layer => selectedKeys.includes(finishLayerKey(owner.key, layer.id)) && canTracePaintLayer(layer))
      .map(layer => ({ owner, layer, label: `${owner.label} / ${layer.name}` })),
  );
}

function releaseOwnedImages(set: Set<HTMLImageElement>) {
  for (const image of set) image.src = '';
  set.clear();
}

export default function LineTraceDialog({ scene, images, assets, selectedKeys, loadError, onApply, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preprocess, setPreprocess] = useState<'ai4x' | 'ai2x'>('ai4x');
  const [threshold, setThreshold] = useState(180);
  const [tol, setTol] = useState(0.3);
  const [chainMode, setChainMode] = useState<'model' | 'none'>('model');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ batch: FinishBatch; entries: PreviewEntry[]; mode: 'ai4x' | 'ai2x' } | null>(null);
  const [index, setIndex] = useState(0);
  const current = useRef(true);
  const request = useRef<AbortController | null>(null);
  const runId = useRef(0);
  const hasRunOnce = useRef(false);
  const captureCache = useRef<CaptureCache | null>(null);
  const owned = useRef(new Set<HTMLImageElement>());

  const selected = selectTraceLayers(scene, selectedKeys);

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

  async function executeTrace(
    id: number,
    controller: AbortController,
    targets: SelectedTraceLayer[],
    runMode: 'ai4x' | 'ai2x',
  ): Promise<{ batch: FinishBatch; entries: PreviewEntry[]; batchOwned: Set<HTMLImageElement> } | null> {
    if (!images || !targets.length) return null;
    const batchOwned = new Set<HTMLImageElement>();
    const isStale = () => controller.signal.aborted || id !== runId.current || !current.current;

    try {
      const cacheKey = `${CAPTURE_EDGE}|${selectedKeys.join(',')}`;
      const cached = captureCache.current;
      let capturedEntries: CapturedTraceLayer[];

      if (cached && cached.key === cacheKey && cached.scene === scene && cached.images === images) {
        capturedEntries = cached.entries;
      } else {
        capturedEntries = [];
        for (const target of targets) {
          if (isStale()) {
            releaseOwnedImages(batchOwned);
            return null;
          }
          const { blob, bbox } = await captureLineTraceLayer(target.owner, target.layer, images, CAPTURE_EDGE);
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
      const results: LineTraceLayerResult[] = [];
      const entries: PreviewEntry[] = [];

      for (const { owner, layer, label, bbox, dataUrl } of capturedEntries) {
        if (isStale()) {
          releaseOwnedImages(batchOwned);
          return null;
        }
        const traced = await requestLineTrace(
          dataUrl,
          {
            threshold,
            tol,
            epsR: Math.max(0.08, Math.round(tol * 50) / 100),
            detectBeta: true,
            chainMode,
            preprocess: runMode,
          },
          controller.signal,
        );
        if (isStale()) {
          releaseOwnedImages(batchOwned);
          return null;
        }
        const paths = tracedStrokesToVectorPaths(traced.strokes, traced.width, traced.height, bbox);
        let betaAsset: ImageAsset | undefined;
        if (traced.betaPng) {
          const png = dataUrlBlob(traced.betaPng);
          if (png?.type === 'image/png') {
            const prepared = await prepareImageAsset(new File([png], 'ベタ塗り.png', { type: 'image/png' }));
            if (isStale()) {
              releaseOwnedImages(batchOwned);
              return null;
            }
            betaAsset = pending.get(prepared.id)?.asset ?? assets.find(item => item.id === prepared.id) ?? prepared;
            if (!map.has(betaAsset.id)) {
              const decoded = await decodePaintImage(png);
              if (isStale()) {
                decoded.src = '';
                releaseOwnedImages(batchOwned);
                return null;
              }
              batchOwned.add(decoded);
              map.set(betaAsset.id, decoded);
            }
            if (!pending.has(betaAsset.id)) pending.set(betaAsset.id, { asset: betaAsset, blob: png });
          }
        }
        if (!paths.length && !betaAsset) {
          throw new Error(`「${layer.name}」からトレースできる線が見つかりませんでした（しきい値を上げてください）`);
        }
        results.push({ owner, layer, bbox, paths, betaAsset });
        entries.push({
          label,
          bbox,
          width: traced.width,
          height: traced.height,
          after: owner.paint,
        });
      }

      const tracedScene = applyLineTraceLayers(scene, results);
      let focus: FinishBatch['focus'] | undefined;
      results.forEach(({ owner, layer }, i) => {
        const paint = tracedScene.owners.find(item => item.key === owner.key)!.paint;
        const folderId = paint.layers[paint.layers.findIndex(item => item.id === layer.id) + 1]?.folderId;
        if (!folderId) throw new Error('ベクター線画フォルダーが見つかりません');
        const children = paint.layers.filter(item => item.folderId === folderId);
        const vecId = children.find(item => item.kind === 'vector')?.id;
        if (!focus) focus = { ownerKey: owner.key, folderId: vecId ?? folderId };
        entries[i].after = { ...paint, folders: undefined, layers: children };
      });

      if (isStale() || !focus) {
        releaseOwnedImages(batchOwned);
        return null;
      }

      return {
        batch: { source: scene, scene: tracedScene, images: map, imports: [...pending.values()], focus },
        entries,
        batchOwned,
      };
    } catch (cause) {
      releaseOwnedImages(batchOwned);
      throw cause;
    }
  }

  async function runPreview(id: number, controller: AbortController, targets: SelectedTraceLayer[]) {
    setBusy(true);
    try {
      // プレビューは常に高速(ai2x)で即時表示し、「高品質(ai4x)」選択時は適用時のみ本変換する
      const out = await executeTrace(id, controller, targets, 'ai2x');
      if (!out) return;
      const previousOwned = owned.current;
      owned.current = out.batchOwned;
      releaseOwnedImages(previousOwned);
      setError('');
      setIndex(prev => Math.min(prev, Math.max(0, out.entries.length - 1)));
      setPreview({ batch: out.batch, entries: out.entries, mode: 'ai2x' });
    } catch (cause) {
      if (id === runId.current && current.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'ベクター変換に失敗しました');
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (current.current) setBusy(false);
      }
    }
  }

  useEffect(() => {
    const targets = selectTraceLayers(scene, selectedKeys);
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
  }, [scene, images, assets, selectedKeys, threshold, tol, chainMode]);

  async function apply() {
    if (!preview || applying) return;
    if (preprocess === preview.mode) {
      try {
        onApply(preview.batch);
        owned.current.clear();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'ベクター変換を適用できません');
      }
      return;
    }

    // 高品質(ai4x)選択時は適用押下時に本変換して適用
    const targets = selectTraceLayers(scene, selectedKeys);
    if (!images || !targets.length) return;
    setApplying(true);
    setBusy(true);
    runId.current += 1;
    const id = runId.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const out = await executeTrace(id, controller, targets, preprocess);
      if (!out) return;
      const previousOwned = owned.current;
      owned.current = out.batchOwned;
      releaseOwnedImages(previousOwned);
      onApply(out.batch);
      owned.current.clear();
    } catch (cause) {
      if (id === runId.current && current.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'ベクター変換を適用できません');
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
      aria-labelledby="line-trace-title"
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={event => event.stopPropagation()}
    >
      <header>
        <h2 id="line-trace-title">ベクター変換</h2>
        <button type="button" class="icon-button" aria-label="閉じる" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {!selected.length && (
        <p class="manga-finish-target">
          原稿でベクター変換したい画像・描画レイヤーを選んでください。
        </p>
      )}
      <div class="line-trace-controls">
        <label class="line-trace-row">
          <span>処理モード</span>
          <select
            value={preprocess}
            onChange={event => setPreprocess(event.currentTarget.value as 'ai4x' | 'ai2x')}
          >
            <option value="ai2x">高速</option>
            <option value="ai4x">高品質</option>
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
        <label class="line-trace-row">
          <span>間引き許容</span>
          <select
            value={String(tol)}
            onChange={event => setTol(Number(event.currentTarget.value))}
          >
            <option value="0.15">0.15 px（高精細）</option>
            <option value="0.3">0.3 px（標準・元絵忠実）</option>
            <option value="0.75">0.75 px（編集向け整理）</option>
          </select>
        </label>
        <label class="line-trace-row">
          <span>交点処理</span>
          <select
            value={chainMode}
            onChange={event => setChainMode(event.currentTarget.value as 'model' | 'none')}
          >
            <option value="model">連結</option>
            <option value="none">連結しない</option>
          </select>
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
      {(error || loadError) && <p role="alert">{error || loadError}</p>}
      <footer>
        <button type="button" class="primary-button" disabled={!preview || busy || applying} onClick={() => void apply()}>
          適用
        </button>
      </footer>
    </dialog>
  );
}
