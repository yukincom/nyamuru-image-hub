import type { HumanPoseMotionClip, HumanPoseMotionSelection } from '../lib/humanPoseMotion.ts';
interface Props {
  clips: HumanPoseMotionClip[]; value?: HumanPoseMotionSelection; playing: boolean; disabled: boolean;
  onClip: (id: string) => void; onPhase: (phase: number) => void; onPlay: () => void; onPause: () => void;
  onBegin: () => void; onEnd: () => void;
}
export default function HumanPoseMotionControls({ clips, value, playing, disabled, onClip, onPhase, onPlay, onPause, onBegin, onEnd }: Props) {
  const clip = clips.find(item => item.id === value?.clip_id), phase = value?.phase ?? 0;
  return <fieldset class="human-pose-motion" disabled={disabled}><legend>モーションサポーター</legend>
    <label>動き<select value={value?.clip_id ?? ''} onChange={event => onClip(event.currentTarget.value)}>
      <option value="">登録ポーズを使う</option>
      {[...new Set(clips.map(item => item.group))].map(group => <optgroup key={group} label={group}>
        {clips.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.label_ja} / {item.source_name}</option>)}
      </optgroup>)}
    </select></label>
    {clip && <>
      <label>動きの位置 {Math.round(phase * 100)}%<input aria-label="動きの位置" type="range" min="0" max="1000" step="1" value={Math.round(phase * 1000)}
        onPointerDown={event => { onPause(); onBegin(); event.currentTarget.setPointerCapture(event.pointerId); }}
        onInput={event => { onBegin(); onPhase(event.currentTarget.valueAsNumber / 1000); }}
        onPointerUp={onEnd} onPointerCancel={onEnd} onLostPointerCapture={onEnd}
        onKeyDown={() => { onPause(); onBegin(); }} onKeyUp={onEnd} onBlur={onEnd} /></label>
      <div class="human-pose-scene-buttons"><button type="button" class="secondary-button" onClick={playing ? onPause : onPlay}>{playing ? '一時停止' : '再生'}</button>
        <output aria-live="off">{(phase * clip.duration).toFixed(2)} / {clip.duration.toFixed(2)} 秒</output></div>
      <p class="field-note">{clip.loop ? 'ループ動作' : '一連の動作（再生時は終端で先頭に戻ります）'}</p>
    </>}
    <p class="field-note">スライダーで姿勢を選び、マーカーとカメラで調整できます。微調整は同じ動きの中では保持されます。動きを切り替えると微調整はリセットされます。</p>
  </fieldset>;
}
