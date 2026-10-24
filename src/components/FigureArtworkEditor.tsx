import type { Figure } from '../types';

interface Props {
  figure: Figure;
  showGuide:boolean; onToggleGuide:()=>void;
  onChange: (figure: Figure) => void;
}
export default function FigureArtworkEditor({ figure, showGuide, onToggleGuide, onChange }: Props) {
  return <div class="figure-artwork-editor" onClick={event => event.stopPropagation()}>
    <label class="check-row guide-display-control"><input type="checkbox" checked={showGuide} onChange={onToggleGuide}/><span>あたり画像表示</span></label>
    {figure.artwork && <>
      <label class="check-row"><input type="checkbox" checked={figure.artwork.locked} onChange={event => onChange({ ...figure, artwork: { ...figure.artwork!, locked: event.currentTarget.checked } })} /><span>位置・サイズを固定</span></label>
    </>}
  </div>;
}
