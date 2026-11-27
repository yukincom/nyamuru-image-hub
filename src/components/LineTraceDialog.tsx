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

interface Comparison {
  label: string;
  before: Blob;
  after: PaintDocument;
  bbox: BBox;
  width: number;
  height: number;
  strokes: number;
  points: number;
  betaRegions: number;
  elapsedMs: number;
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

function Original({ blob }: { blob: Blob }) {
  const image = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const url = URL.createObjectURL(blob);
    image.current!.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return <img ref={image} alt="ベクター線画化に渡した元画像" />;
}

function Preview({ paint, images, bbox, width, height }: { paint: PaintDocument; images: PaintImages; bbox: BBox; width: number; height: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = Math.min(1, 512 / Math.max(width, height));
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
  blob: Blob;
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
  const [edge, setEdge] = useState(1536);
  const [preprocess, setPreprocess] = useState<'ai2x' | 'lanczos2x' | 'none'>('ai2x');
  const [threshold, setThreshold] = useState(180);
  const [tol, setTol] = useState(0.3);
  const [detectBeta, setDetectBeta] = useState(true);
  const [chainMode, setChainMode] = useState<'model' | 'heuristic' | 'none'>('model');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ batch: FinishBatch; comparisons: Comparison[] } | null>(null);
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

  async function runTrace(id: number, controller: AbortController, targets: SelectedTraceLayer[]) {
    if (!images || !targets.length) return;
    setBusy(true);
    const batchOwned = new Set<HTMLImageElement>();
    const isStale = () => controller.signal.aborted || id !== runId.current || !current.current;

    try {
      const cacheKey = `${edge}|${selectedKeys.join(',')}`;
      const cached = captureCache.current;
      let capturedEntries: CapturedTraceLayer[];

      if (cached && cached.key === cacheKey && cached.scene === scene && cached.images === images) {
        capturedEntries = cached.entries;
      } else {
        capturedEntries = [];
        for (const target of targets) {
          if (isStale()) {
            releaseOwnedImages(batchOwned);
            return;
          }
          const { blob, bbox } = await captureLineTraceLayer(target.owner, target.layer, images, edge);
          if (isStale()) {
            releaseOwnedImages(batchOwned);
            return;
          }
          const dataUrl = await blobDataUrl(blob);
          if (isStale()) {
            releaseOwnedImages(batchOwned);
            return;
          }
          capturedEntries.push({ ...target, blob, bbox, dataUrl });
        }
        captureCache.current = { key: cacheKey, scene, images, entries: capturedEntries };
      }

      const map = new Map(images);
      const pending = new Map<string, { asset: ImageAsset; blob: Blob }>();
      const results: LineTraceLayerResult[] = [];
      const comparisons: Comparison[] = [];

      for (const { owner, layer, label, blob, bbox, dataUrl } of capturedEntries) {
        if (isStale()) {
          releaseOwnedImages(batchOwned);
          return;
        }
        const traced = await requestLineTrace(
          dataUrl,
          {
            threshold,
            tol,
            epsR: Math.max(0.08, Math.round(tol * 50) / 100),
            detectBeta,
            chainMode,
            preprocess,
          },
          controller.signal,
        );
        if (isStale()) {
          releaseOwnedImages(batchOwned);
          return;
        }
        const paths = tracedStrokesToVectorPaths(traced.strokes, traced.width, traced.height, bbox);
        let betaAsset: ImageAsset | undefined;
        if (traced.betaPng) {
          const png = dataUrlBlob(traced.betaPng);
          if (png?.type === 'image/png') {
            const prepared = await prepareImageAsset(new File([png], 'ベタ塗り.png', { type: 'image/png' }));
            if (isStale()) {
              releaseOwnedImages(batchOwned);
              return;
            }
            betaAsset = pending.get(prepared.id)?.asset ?? assets.find(item => item.id === prepared.id) ?? prepared;
            if (!map.has(betaAsset.id)) {
              const decoded = await decodePaintImage(png);
              if (isStale()) {
                decoded.src = '';
                releaseOwnedImages(batchOwned);
                return;
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
        comparisons.push({
          label,
          bbox,
          width: traced.width,
          height: traced.height,
          before: blob,
          after: owner.paint,
          strokes: paths.length,
          points: traced.stats?.final_points ?? paths.reduce((sum, p) => sum + p.nodes.length, 0),
          betaRegions: traced.stats?.beta_regions ?? (betaAsset ? 1 : 0),
          elapsedMs: Math.round(traced.stats?.timings?.total_ms ?? 0),
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
        comparisons[i].after = { ...paint, folders: undefined, layers: children };
      });

      if (isStale() || !focus) {
        releaseOwnedImages(batchOwned);
        return;
      }

      const previousOwned = owned.current;
      owned.current = batchOwned;
      releaseOwnedImages(previousOwned);
      setError('');
      setIndex(prev => Math.min(prev, Math.max(0, comparisons.length - 1)));
      setPreview({
        batch: { source: scene, scene: tracedScene, images: map, imports: [...pending.values()], focus },
        comparisons,
      });
    } catch (cause) {
      releaseOwnedImages(batchOwned);
      if (id === runId.current && current.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'ベクター線画化に失敗しました');
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
      void runTrace(id, controller, targets);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [scene, images, assets, selectedKeys, edge, preprocess, threshold, tol, detectBeta, chainMode]);

  function apply() {
    if (!preview) return;
    try {
      onApply(preview.batch);
      owned.current.clear();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ベクター線画を適用できません');
    }
  }

  const shown = preview?.comparisons[index];
  return (
    <dialog
      class="image-export-dialog manga-finish-dialog"
      ref={dialog}
      aria-labelledby="line-trace-title"
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={event => event.stopPropagation()}
    >
      <header>
        <h2 id="line-trace-title">ベクター線画化</h2>
        <button type="button" class="icon-button" aria-label="閉じる" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <p class="manga-finish-target">
        {selected.length ? selected.map(item => item.label).join('、') : '原稿でベクター線画にしたい画像・描画レイヤーを選んでください。'}
      </p>
      <label class="manga-finish-size">
        解析の長辺
        <select
          value={edge}
          onChange={event => setEdge(Number(event.currentTarget.value))}
        >
          {[512, 1024, 1536, 2048].map(s => (
            <option key={s} value={s}>{s} px</option>
          ))}
        </select>
      </label>
      <label class="manga-finish-size">
        高精細化（縦横サイズ固定）
        <select
          value={preprocess}
          onChange={event => setPreprocess(event.currentTarget.value as 'ai2x' | 'lanczos2x' | 'none')}
        >
          <option value="ai2x">AIくっきり 2x（JaNai V3 SPAN・おすすめ）</option>
          <option value="lanczos2x">2x 高精細（Lanczos・AIなし）</option>
          <option value="none">原寸（前処理なし）</option>
        </select>
      </label>
      <label class="manga-finish-size">
        二値化しきい値（{threshold}）
        <input
          type="range"
          min="60"
          max="240"
          step="5"
          value={threshold}
          onInput={event => setThreshold(Number(event.currentTarget.value))}
        />
      </label>
      <label class="manga-finish-size">
        線の滑らかさ（間引き許容）
        <select
          value={String(tol)}
          onChange={event => setTol(Number(event.currentTarget.value))}
        >
          <option value="0.15">0.15 px（高精細）</option>
          <option value="0.3">0.3 px（標準・元絵忠実）</option>
          <option value="0.75">0.75 px（編集向け整理）</option>
          <option value="1.5">1.5 px（なめらか補正）</option>
          <option value="2.5">2.5 px（強め平滑化）</option>
        </select>
      </label>
      <label class="manga-finish-size">
        交差点の連結
        <select
          value={chainMode}
          onChange={event => setChainMode(event.currentTarget.value as 'model' | 'heuristic' | 'none')}
        >
          <option value="model">AIモデル（X字・Y分裂・T字判定）</option>
          <option value="heuristic">角度ルール（従来方式）</option>
          <option value="none">連結しない（交点で分割）</option>
        </select>
      </label>
      <label class="manga-finish-size">
        <span>黒ベタ領域を分離して「ベタ塗り」レイヤーを同梱</span>
        <input
          type="checkbox"
          checked={detectBeta}
          onChange={event => setDetectBeta(event.currentTarget.checked)}
        />
      </label>
      {preview && shown && (
        <section class="manga-finish-comparison">
          {preview.comparisons.length > 1 ? (
            <select aria-label="比較するレイヤー" value={index} onChange={e => setIndex(Number(e.currentTarget.value))}>
              {preview.comparisons.map((item, i) => (
                <option value={i}>{item.label}</option>
              ))}
            </select>
          ) : (
            <strong>{shown.label}</strong>
          )}
          <div>
            <figure>
              <figcaption>元画像</figcaption>
              <Original blob={shown.before} />
            </figure>
            <figure>
              <figcaption>ベクター線画{shown.betaRegions > 0 ? '＋ベタ塗り' : ''}</figcaption>
              <Preview paint={shown.after} images={preview.batch.images} bbox={shown.bbox} width={shown.width} height={shown.height} />
            </figure>
          </div>
          <small>
            {shown.strokes.toLocaleString()} ストローク · {shown.points.toLocaleString()} 制御点
            {shown.betaRegions > 0 ? ` · ベタ ${shown.betaRegions} 領域` : ''}
            {shown.elapsedMs > 0 ? ` · ${shown.elapsedMs} ms` : ''}（CLIP書き出し時はネイティブスプライン＋線幅保持）
          </small>
        </section>
      )}
      {(error || loadError) && <p role="alert">{error || loadError}</p>}
      <footer>
        <button type="button" class="primary-button" disabled={!preview || busy} onClick={apply}>
          原稿に適用
        </button>
      </footer>
    </dialog>
  );
}
