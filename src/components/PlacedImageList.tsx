import type { ImageAsset, PlacedImage } from '../types';
import { SectionTitle } from './Fields';
import PlacedImageInspector from './PlacedImageInspector';

interface Props {
  title: string;
  images?: PlacedImage[];
  assets?: ImageAsset[];
  selectedIndex?: number;
  busy: boolean;
  onAdd?: () => void;
  onSelect: (index: number | null) => void;
  onChange: (images: PlacedImage[]) => void;
  onMoveToPanel?: (index: number) => void;
}
export default function PlacedImageList({ title, images = [], assets = [], selectedIndex, busy, onAdd, onSelect, onChange, onMoveToPanel }: Props) {
  return <section class="editor-section" aria-label={title}>
    <SectionTitle title={title} action={onAdd && <button class="inline-add" disabled={busy} onClick={onAdd}>画像を追加…</button>} />
    <div class="nested-list">
      {images.map((image, index) => {
        const asset = assets.find(item => item.id === image.assetId);
        const selected = index === selectedIndex;
        return <div class={`nested-card selectable-card ${selected ? 'is-selected' : ''}`} key={image.id}>
          <button class="image-owner-select" onClick={() => onSelect(index)}>{asset?.originalName ?? '画像'}{image.hidden ? '（非表示）' : ''}{image.locked ? '（固定）' : ''}</button>
          {selected && asset && <><PlacedImageInspector image={image} asset={asset}
            onChange={next => onChange(images.map((item, i) => i === index ? next : item))}
            onDelete={() => { onChange(images.filter((_, i) => i !== index)); onSelect(null); }}
            onDuplicate={() => { const copy = structuredClone(image); copy.id = crypto.randomUUID(); copy.locked = false; copy.hidden = false; delete copy.splitOverlap; delete copy.splitOverlapId; onChange([...images, copy]); onSelect(images.length); }}
            onOrder={delta => { const to = Math.max(0, Math.min(images.length - 1, index + delta)); if (to === index) return; const next = [...images]; next.splice(to, 0, next.splice(index, 1)[0]); onChange(next); onSelect(to); }} />
            {onMoveToPanel && <button disabled={image.locked} onClick={() => onMoveToPanel(index)}>選択中のコマへ移す</button>}
          </>}
        </div>;
      })}
    </div>
  </section>;
}
