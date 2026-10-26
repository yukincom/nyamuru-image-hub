import { h, render } from 'preact';
import { Box } from 'lucide-preact';
import type { BBox, ImageAsset, PaintLayer } from '../types.ts';
import type { PaintOwner } from './paintDocument.ts';
import { loadFigureCropAsset } from './figureCropStore.ts';
import { fitImageBox, imageCrop, prepareImageAsset } from './imagePlacement.ts';
import { decodePaintImage } from './paintRenderer.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_PAINT_PROPERTIES = [
  'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'paint-order', 'vector-effect', 'clip-rule',
];

function guideFrame(owner: PaintOwner): BBox {
  const frame = owner.paint.referenceFrame ?? { x: 0, y: 0, w: owner.paint.width, h: owner.paint.height };
  if (![frame.x, frame.y, frame.w, frame.h].every(Number.isFinite) || frame.w <= 0 || frame.h <= 0) {
    throw new Error('あたりの描画範囲が不正です');
  }
  return { ...frame };
}

function guideCanvas(width: number, height: number): HTMLCanvasElement {
  width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
  if (![width, height].every(Number.isSafeInteger) || width > 16384 || height > 16384 || width * height > 100_000_000) {
    throw new Error('あたり画像は各辺16384px・合計1億px以内です');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('あたり画像の描画領域を作れませんでした');
  return ctx;
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('あたり画像を作成できませんでした')), 'image/png',
  ));
}

/** Resolve the same CSS as the visible guide without capturing labels or controls. */
function guideHost(className: string, width: number, height: number): HTMLDivElement {
  const host = document.createElement('div');
  host.className = className;
  Object.assign(host.style, {
    position: 'fixed', left: '-100000px', top: '0', width: `${width}px`, height: `${height}px`,
    visibility: 'hidden', pointerEvents: 'none', border: '0', padding: '0', overflow: 'hidden',
  });
  document.body.appendChild(host);
  return host;
}

function backgroundSvg(value: string): Blob | undefined {
  if (!value || value === 'none') return undefined;
  const url = /^url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)$/.exec(value.trim());
  const source = (url?.[1] ?? url?.[2] ?? url?.[3] ?? '').trim();
  // Background presets are bundled data SVGs; never fetch an external URL here.
  const data = /^data:image\/svg\+xml((?:;[^,]*)?),([\s\S]*)$/i.exec(source);
  if (!data) throw new Error('背景あたりの画像形式を読み取れませんでした');
  return /;base64(?:;|$)/i.test(data[1])
    ? new Blob([Uint8Array.from(atob(data[2]), character => character.charCodeAt(0))], { type: 'image/svg+xml' })
    : new Blob([decodeURIComponent(data[2])], { type: 'image/svg+xml' });
}

async function renderBackground(owner: PaintOwner, canvas: HTMLCanvasElement): Promise<void> {
  const level = owner.backgroundLevel === -1 ? 'n1' : owner.backgroundLevel ?? 1;
  const host = guideHost('paint-original paint-background-original', canvas.width, canvas.height);
  let color: string, source: Blob | undefined;
  try {
    host.style.backgroundColor = `var(--panel-bg-${level}-color)`;
    host.style.backgroundImage = `var(--panel-bg-${level}-image, none)`;
    const style = getComputedStyle(host);
    color = style.backgroundColor; source = backgroundSvg(style.backgroundImage);
  } finally { host.remove(); }
  const ctx = context(canvas);
  ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!source) return;
  const image = await decodePaintImage(source);
  try {
    // Match background-size: cover; background-position: center.
    const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  } finally { image.src = ''; }
}

async function figureSvg(owner: PaintOwner, width: number, height: number): Promise<Blob> {
  const figure = owner.figure;
  if (!figure) throw new Error('人物あたりが見つかりません');
  const component = figure.kind === 'prop'
    ? h(Box, { class: 'paint-prop-original' })
    : h((await import('../components/FigureSizeSvg')).default, { size: figure.size ?? 'bust-up' });
  const host = guideHost('paint-original paint-figure-original', width, height);
  try {
    render(component, host);
    const svg = host.querySelector('svg');
    if (!svg) throw new Error('人物あたりの図形を作成できませんでした');
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const originals = [svg, ...svg.querySelectorAll<SVGElement>('*')];
    const copies = [clone, ...clone.querySelectorAll<SVGElement>('*')];
    originals.forEach((element, index) => {
      const style = getComputedStyle(element);
      for (const property of SVG_PAINT_PROPERTIES) copies[index].style.setProperty(property, style.getPropertyValue(property));
      copies[index].removeAttribute('class');
    });
    const bounds = svg.getBoundingClientRect(), container = host.getBoundingClientRect();
    clone.setAttribute('x', String(bounds.x - container.x)); clone.setAttribute('y', String(bounds.y - container.y));
    clone.setAttribute('width', String(bounds.width)); clone.setAttribute('height', String(bounds.height));
    const root = document.createElementNS(SVG_NS, 'svg');
    root.setAttribute('width', String(width)); root.setAttribute('height', String(height));
    root.setAttribute('viewBox', `0 0 ${width} ${height}`);
    root.appendChild(clone);
    return new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' });
  } finally { render(null, host); host.remove(); }
}

async function nativeGuidePng(owner: PaintOwner, frame: BBox): Promise<Blob> {
  const canvas = guideCanvas(frame.w, frame.h);
  try {
    if (owner.kind === 'background') await renderBackground(owner, canvas);
    else {
      const image = await decodePaintImage(await figureSvg(owner, canvas.width, canvas.height));
      try { context(canvas).drawImage(image, 0, 0, canvas.width, canvas.height); }
      finally { image.src = ''; }
    }
    return await canvasPng(canvas);
  } finally { canvas.width = canvas.height = 1; }
}

async function originalImage(blob: Blob): Promise<{ blob: Blob; type: 'image/png' | 'image/jpeg' }> {
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => head[index] === value);
  const jpeg = head[0] === 255 && head[1] === 216 && head[2] === 255;
  if (png || jpeg) {
    const type = png ? 'image/png' : 'image/jpeg';
    return { blob: blob.type === type ? blob : blob.slice(0, blob.size, type), type };
  }
  const image = await decodePaintImage(blob);
  let canvas: HTMLCanvasElement | undefined;
  try {
    canvas = guideCanvas(image.naturalWidth, image.naturalHeight);
    context(canvas).drawImage(image, 0, 0);
    return { blob: await canvasPng(canvas), type: 'image/png' };
  } finally { image.src = ''; if (canvas) canvas.width = canvas.height = 1; }
}

/** Materialize an editable guide image; the caller owns persistence and history. */
export async function prepareGuideLayer(owner: PaintOwner, layer: PaintLayer): Promise<{ layer: PaintLayer; asset: ImageAsset; blob: Blob }> {
  if (owner.kind !== 'background' && owner.kind !== 'figure' && owner.kind !== 'bubble') throw new Error('背景・人物・吹き出しの原画だけを画像レイヤーへ変換できます');
  const frame = guideFrame(owner), analog = owner.figure?.analogImport??owner.bubble?.analogTextImport;
  let source: Blob;
  if ((owner.kind === 'figure'||owner.kind==='bubble') && analog) {
    const original = await loadFigureCropAsset(analog.assetId, analog.persistentAsset);
    if (!original) throw new Error('原画を読み込めません。作品フォルダから開き直してください');
    source = original;
  } else if(owner.kind==='bubble')throw new Error('吹き出しの原画が見つかりません');
  else source = await nativeGuidePng(owner, frame);
  const { blob, type } = await originalImage(source);
  const file = new File([blob], `${layer.name || 'あたり'}.${type === 'image/jpeg' ? 'jpg' : 'png'}`, { type });
  const asset = await prepareImageAsset(file), crop = imageCrop(asset);
  return { layer: { ...layer, ...(owner.kind==='bubble'?{guide:undefined}:{}), locked: false, image: { assetId: asset.id, crop, bbox: fitImageBox(crop, frame) } }, asset, blob: file };
}
