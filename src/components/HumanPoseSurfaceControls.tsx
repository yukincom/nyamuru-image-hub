import { HUMAN_POSE_SURFACE_ANCHORS } from '../lib/humanPoseSurfacePlacement.ts';
import type { HumanPoseSurfaceAnchor, HumanPoseSurfacePlacement } from '../lib/humanPoseTypes.ts';

export type HumanPoseSurfacePickMode = 'surface' | 'facing' | null;
interface Props {
  anchor: HumanPoseSurfaceAnchor; surface?: HumanPoseSurfacePlacement; picking: HumanPoseSurfacePickMode;
  disabled: boolean; aligned: boolean;
  onAnchor: (anchor: HumanPoseSurfaceAnchor) => void; onPick: (mode: HumanPoseSurfacePickMode) => void;
  onAlign: (surface: HumanPoseSurfacePlacement) => void; onClear: () => void; onClearFacing: () => void;
}
export default function HumanPoseSurfaceControls({ anchor, surface, picking, disabled, aligned, onAnchor, onPick, onAlign, onClear, onClearFacing }: Props) {
  return <fieldset class="human-pose-surface" disabled={disabled}><legend>床・座面に合わせる</legend>
    <label>合わせる基準<select value={anchor} onChange={event => onAnchor(event.currentTarget.value as HumanPoseSurfaceAnchor)}>
      {HUMAN_POSE_SURFACE_ANCHORS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    <div class="human-pose-scene-buttons">
      <button type="button" class="secondary-button" aria-pressed={picking === 'surface'} onClick={() => onPick(picking === 'surface' ? null : 'surface')}>{anchor === 'hips' ? '座面を選んで配置' : '床を選んで配置'}</button>
      {surface && <button type="button" class="secondary-button" aria-pressed={picking === 'facing'} onClick={() => onPick(picking === 'facing' ? null : 'facing')}>身体の正面を指定</button>}
      {picking && <button type="button" class="secondary-button" onClick={() => onPick(null)}>面の選択をやめる</button>}
    </div>
    {picking && <p role="status">{picking === 'surface' ? '背景の床・座面をクリックしてください。' : 'オレンジの印から、身体を向けたい側をクリックしてください。'}</p>}
    {surface && <>
      <p class="field-note">選んだ面の高さ：{Number(surface.point[1].toFixed(4))}。{aligned ? '指定した位置に合っています。' : '位置・姿勢が変わっています。「もう一度合わせる」で合わせ直せます。'}</p>
      <label>高さの補正<input type="number" step="0.01" min="-1000" max="1000" value={surface.height_offset}
        onInput={event => { const height_offset = event.currentTarget.valueAsNumber; if (Number.isFinite(height_offset) && Math.abs(height_offset) <= 1000) onAlign({ ...surface, height_offset }); }} /></label>
      <div class="human-pose-scene-buttons">
        <button type="button" class="secondary-button" onClick={() => onAlign(surface)}>もう一度合わせる</button>
        {surface.facing_degrees !== undefined && <button type="button" class="secondary-button" onClick={onClearFacing}>正面の指定を解除</button>}
        <button type="button" class="secondary-button" onClick={onClear}>床・座面の指定を解除</button>
      </div>
    </>}
    <p class="field-note">止めた姿勢を、選んだ場所へ移します。モーションや関節を変えても自動では動かしません。高さの単位は背景の座標と同じです。</p>
    {anchor === 'hips' && <p class="field-note">座る姿勢を選んでから合わせます。腰の中心を目安にするため、座りの深さは高さの補正で、足の接地はマーカーで調整してください。</p>}
  </fieldset>;
}
