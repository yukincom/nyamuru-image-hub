import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { HumanPoseCatalog, HumanPoseCatalogEntry, HumanPoseTextSelection, HumanPoseSceneSettings, PoseVector } from '../../lib/humanPoseTypes.ts';
import { HUMAN_POSE_PREVIEW_ART } from '../../lib/humanPosePreviewArt.ts';
import { HumanPoseSceneRenderer } from '../../lib/humanPoseSceneRenderer.ts';
import type { FigureSize } from '../../types.ts';
import type { Camera } from './poseDialogTypes.ts';
import { type HumanPoseCutFrame, MANUAL_HUMAN_POSE_FRAMING } from '../../lib/humanPoseFraming.ts';
import FigureSizePicker from '../FigureSizePicker.tsx';
import { FIGURE_SIZE_LABELS } from '../../lib/manga.ts';

interface RenderPoseCatalogProps {
  loading: boolean;
  backgroundBusy: boolean;
  id: string;
  query: string;
  setQuery: Dispatch<StateUpdater<string>>;
  catalogError: string;
  setCatalogAttempt: Dispatch<StateUpdater<number>>;
  catalog: HumanPoseCatalog | null;
  matches: HumanPoseCatalogEntry[];
  ready: HumanPoseCatalogEntry[];
  poseValue: HumanPoseTextSelection;
  choosePose: (pose: HumanPoseCatalogEntry) => void;
}

export function renderPoseCatalog({ loading, backgroundBusy, id, query, setQuery, catalogError, setCatalogAttempt, catalog, matches, ready, poseValue, choosePose }: RenderPoseCatalogProps) {
  return <fieldset class="human-pose-presets" disabled={loading || backgroundBusy}><legend>登録ポーズ</legend>
            <label for={`${id}-search`}>番号・ポーズ・動作で検索</label>
            <input id={`${id}-search`} type="search" value={query} onInput={event => setQuery(event.currentTarget.value)} />
            {catalogError && <div role="alert">{catalogError}<button type="button" onClick={() => setCatalogAttempt(v => v + 1)}>再読込</button></div>}
            {catalog && <><output>{matches.length}件 / {ready.length}件</output>
              {matches.length === 0 && <p>条件に合うポーズがありません。</p>}
              <div class="human-pose-grid" aria-label="ポーズ候補">
                {matches.map(pose => <button key={pose.id} type="button" data-pose-id={pose.id} class={`human-pose-card ${poseValue.pose_id === pose.id ? 'is-selected' : ''}`}
                  aria-pressed={poseValue.pose_id === pose.id} onClick={() => choosePose(pose)}>
                  {HUMAN_POSE_PREVIEW_ART[pose.id] && <img src={HUMAN_POSE_PREVIEW_ART[pose.id]} alt="" width={100} height={100} loading="lazy" />}
                  <span>{pose.display_number} {pose.label_ja}</span>
                </button>)}
              </div></>}
          </fieldset>
}

interface RenderBodyPlacementProps {
  loading: boolean;
  backgroundBusy: boolean;
  draft: HumanPoseSceneSettings;
  update: (next: HumanPoseSceneSettings, remember?: boolean) => void;
  renderer: { current: HumanPoseSceneRenderer | null };
}

export function renderBodyPlacement({ loading, backgroundBusy, draft, update, renderer }: RenderBodyPlacementProps) {
  return <fieldset disabled={loading || backgroundBusy}><legend>人物全体の配置</legend>
            <p class="field-note">{draft.background ? '背景の座標に合わせて位置と大きさを調整します。' : '位置の単位はm。'}Yが高さ、素材の正面は＋Zです。</p>
            <div class="human-pose-scene-coordinates">{['X', 'Y', 'Z'].map((axis, index) => <label key={axis}>{axis}
              <input type="number" step="0.05" min="-10000" max="10000" value={draft.placement.position[index]} onInput={event => {
                const number = event.currentTarget.valueAsNumber; if (!Number.isFinite(number) || Math.abs(number) > 10000) return;
                const position = [...draft.placement.position] as PoseVector; position[index] = number;
                update({ ...draft, placement: { ...draft.placement, position } });
              }} /></label>)}</div>
            <label>人物の向き {draft.placement.yaw_degrees}°<input type="range" min="-180" max="180" step="1" value={draft.placement.yaw_degrees}
              onInput={event => update({ ...draft, placement: { ...draft.placement, yaw_degrees: event.currentTarget.valueAsNumber } })} /></label>
            <label>基準身長（cm）<input type="number" min="30" max="300" step="1" value={draft.stature_m ? Math.round(draft.stature_m * 100) : ''} placeholder="素材の身長" onInput={event => {
              const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value) && value >= 30 && value <= 300) update({ ...draft, stature_m: value / 100 });
            }} /></label>
            <label>人物の大きさ（倍率）<input type="number" min="0.001" max="1000" step="0.1" value={draft.placement.scale ?? 1} onInput={event => {
              const scale = event.currentTarget.valueAsNumber; if (Number.isFinite(scale) && scale >= .001 && scale <= 1000) update({ ...draft, placement: { ...draft.placement, scale } });
            }} /></label>
            {draft.background && <><p class="field-note">倍率1では素体の1mが背景の1単位に対応します。背景の寸法が合わない場合は倍率を調整してください。</p>
              <button type="button" class="secondary-button" onClick={() => { if (renderer.current) update(renderer.current.placeAtBackgroundCentre()); }}>背景の中央へ移動（高さは維持）</button></>}
            <label><input type="checkbox" disabled={Boolean(draft.motion)} checked={!draft.motion && draft.show_supports !== false} onChange={event => update({ ...draft, show_supports: event.currentTarget.checked })} />ポーズ付属の台・椅子を表示</label>
          </fieldset>
}

interface RenderCameraSettingsProps {
  loading: boolean;
  backgroundBusy: boolean;
  framingSize: FigureSize;
  renderer: { current: HumanPoseSceneRenderer | null };
  update: (next: HumanPoseSceneSettings, remember?: boolean) => void;
  aspect: number;
  draft: HumanPoseSceneSettings;
  camera: (next: Camera) => void;
  outputFrame: { width: number; height: number; };
  cutFrame: HumanPoseCutFrame | undefined;
}

export function renderCameraSettings({ loading, backgroundBusy, framingSize, renderer, update, aspect, draft, camera, outputFrame, cutFrame }: RenderCameraSettingsProps) {
  return <fieldset disabled={loading || backgroundBusy}><legend>撮影カメラ</legend>
            <label>撮影範囲プリセット</label>
            <FigureSizePicker value={framingSize} onChange={size => { if (renderer.current) update(renderer.current.frameFor(size, aspect)); }} />
            <p class="field-note">プリセットで最初の範囲を合わせ、画面を見ながら移動・拡大で調整できます。画像で送る場合は、最後に確定した構図を使います。</p>
            <label>垂直画角 {draft.camera.fov}°<input type="range" min="10" max="100" step="1" value={draft.camera.fov}
              onInput={event => camera({ ...draft.camera, fov: event.currentTarget.valueAsNumber })} /></label>
            <div class="human-pose-scene-buttons">
              <button type="button" class="secondary-button" onClick={() => { if (renderer.current) update(renderer.current.focus()); }}>全体を収める</button>
            </div>
            <p>撮影寸法：{outputFrame.width}×{outputFrame.height}</p>
            <button type="button" class="secondary-button" onClick={() => { if (renderer.current) update(renderer.current.frameFor(framingSize, aspect)); }}>{cutFrame ? '描写範囲とコマ枠に合わせる' : '描写範囲と人物枠に合わせる'}</button>
            <p class="field-note">プリセット：{FIGURE_SIZE_LABELS[framingSize]}。{MANUAL_HUMAN_POSE_FRAMING.includes(framingSize) ? '使いたい部位を選び、拡大と移動で撮影範囲を調整してください。' : 'カメラの角度を保って切り取り、移動・拡大で映り方を調整できます。'}</p>
          </fieldset>
}
