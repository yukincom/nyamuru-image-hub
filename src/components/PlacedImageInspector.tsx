import type { BBox, ImageAsset, PlacedImage } from '../types';
import { changeImageCrop, imageCrop, validImageBox, validImageCrop } from '../lib/imagePlacement';
import { Field, SectionTitle } from './Fields';

interface Props {
  image: PlacedImage;
  asset: ImageAsset;
  onChange: (image: PlacedImage) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  onOrder?: (delta: number) => void;
  deleteLabel?: string;
}
export default function PlacedImageInspector({ image, asset, onChange, onDelete, onDuplicate, onOrder, deleteLabel = '配置を削除' }: Props) {
  const updateBox = (key: keyof BBox, value: number) => {
    const box = { ...image.bbox, [key]: value };
    if (key === 'w') box.h = value * image.crop.h / image.crop.w;
    if (key === 'h') box.w = value * image.crop.w / image.crop.h;
    if (validImageBox(box)) onChange({ ...image, bbox: box });
  };
  const updateCrop = (key: keyof BBox, value: number) => {
    const crop = { ...image.crop, [key]: value };
    if (validImageCrop(crop, asset)) onChange(changeImageCrop(image, crop));
  };
  return <section class="placed-image-inspector">
    <SectionTitle title="配置画像" description={asset.originalName} />
    <p>{asset.widthPx} × {asset.heightPx} px ・ {(asset.byteLength / 1024 / 1024).toFixed(1)} MiB</p>
    <p>原本は変更せず、縦横比を保って配置します。</p>
    <div><p>位置・サイズ（mm）</p><div class="bbox-editor">
      {(['x', 'y', 'w', 'h'] as const).map(key => <label key={key}><span>{key.toUpperCase()}</span><input aria-label={`画像 ${key.toUpperCase()} mm`} type="number" step="0.1" disabled={image.locked} value={Number(image.bbox[key].toFixed(2))} onChange={event => updateBox(key, event.currentTarget.valueAsNumber)} /></label>)}
    </div></div>
    <div><p>切り抜き範囲（原画像のpx）</p><div class="bbox-editor">
      {(['x', 'y', 'w', 'h'] as const).map(key => <label key={key}><span>{key.toUpperCase()}</span><input aria-label={`切り抜き ${key.toUpperCase()} px`} type="number" min={key === 'w' || key === 'h' ? 1 : 0} step="1" disabled={image.locked} value={image.crop[key]} onChange={event => updateCrop(key, event.currentTarget.valueAsNumber)} /></label>)}
    </div></div>
    <button disabled={image.locked} onClick={() => { const crop = imageCrop(asset); onChange(changeImageCrop(image, crop)); }}>切り抜きを解除</button>
    <Field label="不透明度"><input type="range" min="0" max="1" step="0.01" value={image.opacity} disabled={image.locked} onInput={event => onChange({ ...image, opacity: event.currentTarget.valueAsNumber })} /></Field>
    <label><input type="checkbox" checked={image.hidden} onChange={event => onChange({ ...image, hidden: event.currentTarget.checked })} />非表示</label>
    <label><input type="checkbox" checked={image.locked} onChange={event => onChange({ ...image, locked: event.currentTarget.checked })} />位置・切り抜きを固定</label>
    <div class="placed-image-actions">{onOrder && <><button onClick={() => onOrder(-1)}>画像の背面へ</button><button onClick={() => onOrder(1)}>画像の前面へ</button></>}{onDuplicate && <button onClick={onDuplicate}>複製</button>}<button disabled={image.locked} onClick={onDelete}>{deleteLabel}</button></div>
  </section>;
}
