import { createPortal } from 'preact/compat';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { loadHumanPoseScene } from '../lib/localBridge.ts';
import { withNewCreationBridgeSession } from '../lib/localBridgeLifecycle.ts';
import { dollyBackgroundCamera, shiftBackgroundCamera } from '../lib/background3dCamera.ts';
import { HumanPoseSceneRenderer, loadHumanPoseBackground } from '../lib/humanPoseSceneRenderer.ts';
import { humanPoseCameraParts, humanPoseSceneFrame, useHumanPoseBackgroundCamera } from '../lib/humanPoseScene.ts';
import { CUBE_STAGE_ID } from '../lib/background3d.ts';
import type { BackgroundCapture, BackgroundStage } from '../types.ts';
import type { HumanPoseCameraSubject, HumanPoseSceneSettings, HumanPoseSurfaceAnchor, HumanPoseSurfacePlacement, HumanPoseTextSelection, PoseVector } from '../lib/humanPoseTypes.ts';
import HumanPoseMotionControls from './HumanPoseMotionControls.tsx';
import HumanPoseSurfaceControls, { type HumanPoseSurfacePickMode } from './HumanPoseSurfaceControls.tsx';
import BackgroundCameraGizmo from './BackgroundCameraGizmo.tsx';
import './HumanPoseSceneDialog.css';
import { HUMAN_POSE_HANDLES, humanPoseJoint } from '../lib/humanPoseJoints.ts';

interface Props {
  value: HumanPoseTextSelection;
  aspect?: number;
  framingLabel?: string;
  stages?: BackgroundStage[];
  backgroundCaptures?: Array<{ label: string; capture: BackgroundCapture }>;
  onConfirm: (scene: HumanPoseSceneSettings, subject: HumanPoseCameraSubject) => void;
  onClose: () => void;
}
type Camera = HumanPoseSceneSettings['camera'];

export default function HumanPoseSceneDialog({ value, aspect = 1, framingLabel, stages = [], backgroundCaptures = [], onConfirm, onClose }: Props) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), host = useRef<HTMLDivElement>(null);
  const renderer = useRef<HumanPoseSceneRenderer | null>(null);
  const initial = useRef<HumanPoseSceneSettings | null>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; camera: Camera; moved: boolean } | null>(null);
  const jointDrag = useRef<{ pointer: number; scene: HumanPoseSceneSettings } | null>(null);
  const undo = useRef<HumanPoseSceneSettings[]>([]), redo = useRef<HumanPoseSceneSettings[]>([]);
  const [playing, setPlaying] = useState(false);
  const motionRun = useRef<number | null>(null), motionStart = useRef<HumanPoseSceneSettings | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selected, setSelected] = useState(''), [details, setDetails] = useState(true);
  const [handleMode, setHandleMode] = useState<'move' | 'rotate'>('move');
  const [surfacePicking, setSurfacePicking] = useState<HumanPoseSurfacePickMode>(null);
  const [surfaceAnchor, setSurfaceAnchor] = useState<HumanPoseSurfaceAnchor>('feet');
  const spaceHeld = useRef(false);
  const [spacePan, setSpacePan] = useState(false), [panning, setPanning] = useState(false);
  const [draft, setDraft] = useState<HumanPoseSceneSettings | null>(null);
  const [error, setError] = useState(''), [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  const [backgroundBusy, setBackgroundBusy] = useState(false), [detachBackground, setDetachBackground] = useState(false);
  const [previewBackground, setPreviewBackground] = useState(false);
  const backgroundRequest = useRef(0);
  const frame = draft?.frame ?? value.scene?.frame ?? humanPoseSceneFrame(aspect);

  const finishPan = () => {
    const active = drag.current; drag.current = null; setPanning(false);
    if (active && host.current?.hasPointerCapture(active.pointer)) host.current.releasePointerCapture(active.pointer);
  };
  const finishJoint = (cancel = false) => {
    const active = jointDrag.current; if (!active) return;
    jointDrag.current = null;
    const reverted = renderer.current?.endHandleDrag(cancel);
    if (reverted) { renderer.current?.apply(reverted); setDraft(reverted); setPreview(''); }
    else if (renderer.current && JSON.stringify(active.scene) !== JSON.stringify(renderer.current.snapshot())) {
      undo.current.push(active.scene); redo.current = []; setHistoryVersion(v => v + 1);
    }
    if (host.current?.hasPointerCapture(active.pointer)) host.current.releasePointerCapture(active.pointer);
  };
  const releaseSpace = () => { spaceHeld.current = false; setSpacePan(false); finishPan(); };
  const cancelInteraction = () => { stopMotion(); setSurfacePicking(null); releaseSpace(); finishJoint(true); };

  useEffect(() => { dialog.current?.showModal(); host.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    // キーを画面外で離した場合やアプリを切り替えた場合も、掴んだままにしない。
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' && spaceHeld.current) { event.preventDefault(); releaseSpace(); }
    };
    const hidden = () => { if (document.hidden) cancelInteraction(); };
    window.addEventListener('keyup', keyUp, true); window.addEventListener('blur', cancelInteraction);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keyup', keyUp, true); window.removeEventListener('blur', cancelInteraction);
      document.removeEventListener('visibilitychange', hidden); releaseSpace();
    };
  }, []);
  useEffect(() => {
    let cancelled = false, active: HumanPoseSceneRenderer | null = null;
    setLoading(true); setError(''); setDraft(null); setPreview('');
    void (async () => {
      try {
        const assets = await withNewCreationBridgeSession(() => loadHumanPoseScene(value.pose_id, value.catalog_sha256));
        if (cancelled || !host.current) return;
        const saved = value.scene && structuredClone(value.scene);
        if (saved && detachBackground) delete saved.background;
        const background = saved?.background && await loadHumanPoseBackground(saved.background.sourceId, stages);
        if (cancelled || !host.current) return;
        active = await HumanPoseSceneRenderer.create(host.current, assets, saved, aspect, background);
        if (cancelled) { active.dispose(); return; }
        renderer.current = active; initial.current = active.snapshot(); setDraft(active.snapshot());
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : '3D表示を開けませんでした'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; if (motionRun.current !== null) cancelAnimationFrame(motionRun.current); motionRun.current = null; motionStart.current = null; backgroundRequest.current++; drag.current = null; active?.dispose(); renderer.current = null; };
    // 開いた時点の保存値をdraftへ複製し、確定するまで親を書き換えない。
  }, [value.pose_id, value.catalog_sha256, attempt]);

  const update = (next: HumanPoseSceneSettings, remember = true) => {
    if (remember) stopMotion();
    try {
      const before = renderer.current?.snapshot();
      renderer.current?.apply(next);
      if (remember && before && JSON.stringify(before) !== JSON.stringify(next)) { undo.current.push(before); redo.current = []; setHistoryVersion(v => v + 1); } setDraft(structuredClone(next)); setPreview(''); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '撮影設定を変更できません'); }
  };
  const beginMotion = () => { motionStart.current ??= renderer.current?.snapshot() ?? null; };
  const endMotion = () => {
    const before = motionStart.current; motionStart.current = null;
    if (before && renderer.current && JSON.stringify(before) !== JSON.stringify(renderer.current.snapshot())) {
      undo.current.push(before); redo.current = []; setHistoryVersion(v => v + 1);
    }
  };
  const stopMotion = () => {
    if (motionRun.current !== null) cancelAnimationFrame(motionRun.current);
    motionRun.current = null; setPlaying(false); endMotion();
  };
  const scrubMotion = (phase: number) => {
    const active = renderer.current, scene = motionStart.current ?? active?.snapshot();
    if (!active || !scene?.motion) return;
    try { update(active.changeMotion(scene.motion.clip_id, phase, scene), false); }
    catch (cause) { stopMotion(); setError(cause instanceof Error ? cause.message : '動きを変更できません'); }
  };
  const playMotion = () => {
    stopMotion(); setSurfacePicking(null); const active = renderer.current, scene = active?.snapshot();
    if (!active || !scene?.motion) return;
    const clip = active.motionClips.find(item => item.id === scene.motion!.clip_id); if (!clip) return;
    beginMotion(); setPlaying(true); const start = performance.now(), phase = scene.motion.phase === 1 ? 0 : scene.motion.phase;
    const tick = (now: number) => {
      if (renderer.current !== active || !motionStart.current) return;
      scrubMotion((phase + (now - start) / (clip.duration * 1000)) % 1);
      if (motionStart.current) motionRun.current = requestAnimationFrame(tick);
    };
    motionRun.current = requestAnimationFrame(tick);
  };
  const changeMotion = (clipId: string) => {
    stopMotion(); setSurfacePicking(null);
    try { if (renderer.current) update(renderer.current.changeMotion(clipId, 0)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '動きを変更できません'); }
  };
  const changeJoint = (id: string, detail = details) => { setSelected(id); renderer.current?.selectJoint(id, detail); };
  const jointDefinition = humanPoseJoint(selected);
  const hinge = /^(lowerarm|lowerleg)/u.test(selected);
  const angles = draft && jointDefinition && renderer.current ? renderer.current.jointAngles(selected) : null;
  const changeAngle = (axis: number, value: number) => {
    if (!angles || !renderer.current || !Number.isFinite(value)) return;
    const next = [...angles] as PoseVector; next[axis] = value;
    update(renderer.current.rotateJoint(selected, next));
  };
  const stepHistory = (back: boolean) => {
    stopMotion(); setSurfacePicking(null);
    const stack = back ? undo.current : redo.current, next = stack.pop(); if (!next || !renderer.current) return;
    (back ? redo.current : undo.current).push(renderer.current.snapshot());
    void changeBackground(next); setHistoryVersion(v => v + 1);
  };
  const camera = (next: Camera) => { if (draft) update({ ...draft, camera: next }); };
  const flipBody = () => {
    if (draft) update({ ...draft, body_mirror: draft.body_mirror === 'mirrored' ? 'original' : 'mirrored' });
  };
  const description = draft && renderer.current ? humanPoseCameraParts(draft, renderer.current.cameraSubject()) : null;
  const capture = (includeBackground = false) => {
    stopMotion();
    try { setPreview(renderer.current?.capture(includeBackground) ?? ''); setPreviewBackground(includeBackground); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '撮影できませんでした'); }
  };
  const close = () => { cancelInteraction(); dialog.current?.close(); onClose(); };
  const changeBackground = async (next: HumanPoseSceneSettings) => {
    stopMotion(); setSurfacePicking(null);
    const active = renderer.current; if (!active) return;
    const token = ++backgroundRequest.current; releaseSpace(); setBackgroundBusy(true); setError('');
    try {
      const background = next.background && await loadHumanPoseBackground(next.background.sourceId, stages);
      if (token !== backgroundRequest.current) return;
      active.replaceBackground(background, next); setDraft(active.snapshot()); setPreview('');
    } catch (cause) { if (token === backgroundRequest.current) setError(cause instanceof Error ? cause.message : '背景を読み込めません'); }
    finally { if (token === backgroundRequest.current) setBackgroundBusy(false); }
  };
  const alignSurface = (surface: HumanPoseSurfacePlacement) => {
    stopMotion(); setSurfacePicking(null);
    try { if (renderer.current) update(renderer.current.alignSurface(surface)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '床・座面に合わせられません'); }
  };

  return createPortal(<dialog ref={dialog} role="dialog" class="human-pose-scene-dialog" aria-labelledby={`${id}-title`}
    onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => {
      if (event.target === event.currentTarget) { close(); return; }
      // マウスでボタンを使った後も、次のSpaceをボタンの再実行にしない。
      if (event.detail > 0 && event.target instanceof Element && event.target.closest('button') && dialog.current?.open) host.current?.focus({ preventScroll: true });
    }}>
    <div class="human-pose-scene-content">
      <header><h2 id={`${id}-title`}>{value.label_ja} — 3D配置と撮影</h2><button type="button" class="icon-button" aria-label="閉じる" onClick={close}>×</button></header>
      <p class="field-note">マーカーを掴んで姿勢を作り、「確定」で保存します。ポーズの説明文は自動では書き換わりません。</p>
      {loading && <p role="status">3D素材を読み込んでいます…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !draft && <><button type="button" class="secondary-button" onClick={() => setAttempt(v => v + 1)}>再読込</button>
        {value.scene?.background && !detachBackground && <button type="button" class="secondary-button" onClick={() => { setDetachBackground(true); setAttempt(v => v + 1); }}>背景との関連付けを外して開く</button>}</>}
      {backgroundBusy && <p role="status">背景を読み込んでいます…</p>}
      <div class="human-pose-scene-layout">
        <div>
          <div class="human-pose-scene-view" style={{ aspectRatio: `${frame.width} / ${frame.height}`, width: `min(100%, ${60 * frame.width / frame.height}vh)` }}
            onPointerDownCapture={event => {
              if (event.button === 0 && event.target instanceof Element && event.target.closest('.background3d-gizmo')) host.current?.focus({ preventScroll: true });
            }}
            onWheel={event => {
              if (!draft || backgroundBusy) return;
              event.preventDefault();
              if (!event.deltaY || drag.current || jointDrag.current) return;
              const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? event.currentTarget.clientHeight : 1;
              camera(dollyBackgroundCamera(draft.camera, Math.exp(Math.max(-1, Math.min(1, event.deltaY * unit * .001))), .02, 10000));
            }}>
            <div ref={host} class={`human-pose-scene-canvas${spacePan ? ' is-space-pan' : ''}${panning ? ' is-panning' : ''}${surfacePicking ? ' is-surface-picking' : ''}`}
              tabIndex={0} role="group" aria-label="人体ポーズの操作領域" aria-describedby={`${id}-controls`}
              onContextMenu={event => event.preventDefault()}
              onKeyDown={event => {
                if (event.code !== 'Space' || !draft || backgroundBusy) return;
                event.preventDefault(); spaceHeld.current = true; setSpacePan(true);
              }}
              onBlur={() => { releaseSpace(); finishJoint(true); }}
              onPointerDown={event => {
                if (!draft || backgroundBusy || event.button !== 0 || drag.current) return;
                event.preventDefault(); stopMotion(); event.currentTarget.focus({ preventScroll: true });
                if (surfacePicking && !spaceHeld.current) {
                  try {
                    const active = renderer.current;
                    if (active) update(surfacePicking === 'surface' ? active.placeOnSurface(event.clientX, event.clientY, draft.background?.surface?.anchor ?? surfaceAnchor) : active.pointSurfaceForward(event.clientX, event.clientY));
                    setSurfacePicking(null);
                  } catch (cause) { setError(cause instanceof Error ? cause.message : '背景の面を選べません'); }
                  return;
                }
                if (!spaceHeld.current) {
                  const joint = renderer.current?.beginHandleDrag(event.clientX, event.clientY, handleMode);
                  if (joint) { setSelected(joint); jointDrag.current = { pointer: event.pointerId, scene: structuredClone(draft) }; event.currentTarget.setPointerCapture(event.pointerId); }
                  return;
                }
                event.currentTarget.setPointerCapture(event.pointerId); setPanning(true);
                drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, camera: structuredClone(draft.camera), moved: false };
              }}
              onPointerMove={event => {
                if (jointDrag.current?.pointer === event.pointerId) {
                  try { const next = renderer.current?.dragHandle(event.clientX, event.clientY, event.shiftKey); if (next) update(next, false); }
                  catch (cause) { finishJoint(true); setError(cause instanceof Error ? cause.message : '関節を動かせません'); }
                  return;
                }
                const start = drag.current; if (!start || start.pointer !== event.pointerId) return;
                const dx = event.clientX - start.x, dy = event.clientY - start.y;
                if (!start.moved && !dx && !dy) return;
                start.moved = true;
                const next = shiftBackgroundCamera(start.camera, dx / Math.max(1, event.currentTarget.clientWidth), dy / Math.max(1, event.currentTarget.clientHeight));
                next.shift = next.shift!.map(v => Math.max(-2, Math.min(2, v))) as [number, number]; camera(next);
              }}
              onPointerUp={event => { if (jointDrag.current?.pointer === event.pointerId) finishJoint(); if (drag.current?.pointer === event.pointerId) finishPan(); }}
              onPointerCancel={cancelInteraction} onLostPointerCapture={() => { finishJoint(true); finishPan(); }} />
            {draft && <BackgroundCameraGizmo camera={draft.camera} disabled={loading || backgroundBusy} onChange={camera} />}
          </div>
          <p class="field-note" id={`${id}-controls`}>三方矢印：ドラッグで角度調整・クリックで軸方向へ ／ ホイール：近づく・離れる ／ Space＋ドラッグ：画面を掴んで移動。マーカー：姿勢を動かす ／ Shift＋ドラッグ：奥行き移動。床と操作マーカーは撮影に入りません。</p>
          {draft && <fieldset class="human-pose-body-choice" disabled={backgroundBusy}><legend>体勢の左右</legend>
            <div class="human-pose-scene-buttons">
              <button type="button" class="secondary-button" aria-pressed={draft.body_mirror === 'mirrored'} onClick={flipBody}>左右反転</button>
            </div>
            <p class="field-note" role="status">現在：{draft.body_mirror === 'mirrored' ? '左右反転した体勢' : '元の体勢'}。押すたびに切り替わります。</p>
            <p class="field-note">顔の向き・配置・カメラは変わりません。ポーズの説明文は自動で書き換えません。</p>
          </fieldset>}
          {preview && <figure class="human-pose-scene-preview"><img src={preview} alt={previewBackground ? '背景と人物を同じカメラで撮影したPNG' : '現在の設定で撮影した透過PNG'} /><figcaption>{previewBackground ? '背景と人物' : '人物のみ・透過PNG'}（{frame.width}×{frame.height}）。設定を変更すると再撮影が必要です。</figcaption></figure>}
        </div>
        {draft && <aside aria-label="配置・撮影設定">
          <HumanPoseMotionControls clips={renderer.current?.motionClips ?? []} value={draft.motion} playing={playing} disabled={backgroundBusy}
            onClip={changeMotion} onPhase={scrubMotion} onPlay={playMotion} onPause={stopMotion} onBegin={beginMotion} onEnd={endMotion} />
          <fieldset disabled={backgroundBusy}><legend>関節を動かす</legend>
            <div class="human-pose-scene-buttons">
              <button type="button" class="secondary-button" aria-pressed={handleMode === 'move'} onClick={() => setHandleMode('move')}>掴んで動かす</button>
              <button type="button" class="secondary-button" aria-pressed={handleMode === 'rotate'} onClick={() => setHandleMode('rotate')}>掴んで回す</button>
            </div>
            <p class="field-note">手・足を掴むと腕・脚が追従します。肘・膝は曲がる方向、頭は上体、腰は足を保てる範囲で動きます。</p>
            <label><input type="checkbox" checked={details} onChange={event => { const show = event.currentTarget.checked; setDetails(show); renderer.current?.selectJoint(selected, show); }} />手指のマーカーを表示</label>
            <p class="field-note">指先を掴むと指の関節が連動します。足先を掴むと、3枚の板と脚が追従します。</p>
            <label>選択中の関節<select value={selected} onChange={event => changeJoint(event.currentTarget.value)}><option value="">マーカーを選択</option>
              {HUMAN_POSE_HANDLES.filter(joint => !joint.detail || details).map(joint => <option value={joint.id} key={joint.id}>{joint.label}</option>)}
            </select></label>
            {selected && <button type="button" class="secondary-button" onClick={() => { if (renderer.current) update(renderer.current.focusJoint(selected)); }}>選んだ関節に近づく</button>}
            {jointDefinition && angles && <>
              {(hinge || /^foot(Arch|Ball)/u.test(selected) ? ['曲げ'] : ['曲げ', 'ひねり', '横倒し']).map((label, axis) => <label key={axis}>{label} {Math.round(angles[axis])}°<input type="range" min={hinge ? 2 : jointDefinition.limits[axis][0]} max={hinge ? (selected.startsWith('lowerarm') ? 150 : 155) : jointDefinition.limits[axis][1]} step="1" value={angles[axis]} onInput={event => changeAngle(axis, event.currentTarget.valueAsNumber)} /></label>)}
            </>}
            <p class="field-note">回転には作画用の目安となる制限があります。足は足首・土踏まず・つま先の付け根で曲がる板です。</p>
            <div class="human-pose-scene-buttons" data-history-version={historyVersion}>
              <button type="button" class="secondary-button" disabled={!undo.current.length} onClick={() => stepHistory(true)}>元に戻す</button>
              <button type="button" class="secondary-button" disabled={!redo.current.length} onClick={() => stepHistory(false)}>やり直す</button>
              <button type="button" class="secondary-button" disabled={!draft.joint_edits} onClick={() => update({ ...draft, joint_edits: undefined })}>微調整を戻す</button>
            </div>
          </fieldset>
          <fieldset disabled={backgroundBusy}><legend>一緒に表示する背景</legend>
            <label>3D舞台<select value={draft.background?.sourceId ?? ''} onChange={event => {
              const sourceId = event.currentTarget.value;
              void changeBackground({ ...draft, background: sourceId ? { sourceId } : undefined, ...(sourceId ? { show_supports: false } : {}) });
            }}><option value="">背景なし</option><option value={CUBE_STAGE_ID}>確認用キューブ</option>
              {stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            </select></label>
            {!stages.length && <p class="field-note">「背景」から3Dモデルを登録すると、ここで選べます。</p>}
            {draft.background && <>
              <label><input type="checkbox" checked={draft.background.cutaway?.enabled ?? false} onChange={event => update({ ...draft, background: { ...draft.background!, cutaway: { enabled: event.currentTarget.checked, depth: draft.background?.cutaway?.depth ?? .2 } } })} />手前の壁を隠す</label>
              <button type="button" class="secondary-button" onClick={() => { if (renderer.current) update(renderer.current.focusBackground()); }}>背景と人物を収める</button>
              {backgroundCaptures.filter(item => item.capture.sourceId === draft.background?.sourceId).map((item, index) => <button key={index} type="button" class="secondary-button" onClick={() => {
                try { update(useHumanPoseBackgroundCamera(draft, item.capture)); } catch (cause) { setError(cause instanceof Error ? cause.message : '背景カメラを取り込めません'); }
              }}>{item.label}のカメラ・表示を使う</button>)}
              <p class="field-note">背景と人物は同じカメラで表示します。元のコマの背景画像は、ここでの確定では変わりません。</p>
            </>}
          </fieldset>
          {draft.background && <HumanPoseSurfaceControls anchor={draft.background.surface?.anchor ?? surfaceAnchor} surface={draft.background.surface}
            picking={surfacePicking} disabled={backgroundBusy} aligned={renderer.current?.surfaceAligned() ?? false}
            onPick={mode => { stopMotion(); finishJoint(true); setSurfacePicking(mode); setError(''); }}
            onAnchor={anchor => { setSurfaceAnchor(anchor); setSurfacePicking(null); if (draft.background?.surface) update({ ...draft, background: { ...draft.background, surface: { ...draft.background.surface, anchor } } }); }}
            onAlign={alignSurface} onClear={() => { setSurfacePicking(null); update({ ...draft, background: { ...draft.background!, surface: undefined } }); }}
            onClearFacing={() => { setSurfacePicking(null); update({ ...draft, background: { ...draft.background!, surface: { ...draft.background!.surface!, facing_degrees: undefined } } }); }} />}
          <fieldset disabled={backgroundBusy}><legend>人物全体の配置</legend>
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
          <fieldset disabled={backgroundBusy}><legend>撮影カメラ</legend>
            <label>垂直画角 {draft.camera.fov}°<input type="range" min="10" max="100" step="1" value={draft.camera.fov}
              onInput={event => camera({ ...draft.camera, fov: event.currentTarget.valueAsNumber })} /></label>
            <div class="human-pose-scene-buttons">
              <button type="button" class="secondary-button" onClick={() => { if (renderer.current) update(renderer.current.focus()); }}>全体を収める</button>
            </div>
            <p>撮影寸法：{frame.width}×{frame.height}</p>
            <button type="button" class="secondary-button" onClick={() => update({ ...draft, frame: humanPoseSceneFrame(aspect) })}>現在の人物枠の縦横比に合わせる</button>
            <p class="field-note">描写範囲：{framingLabel || '未指定'}。自動切り取りは行いません。映り方は撮影プレビューで確認してください。</p>
          </fieldset>
          {description && <section class="human-pose-scene-description"><strong>撮影設定からの説明</strong>
            <p>アングル：{description.angle.ja || '判定できません'}</p><p>レンズ：{description.lens.ja}</p>
            <p lang="en">{[description.angle.en, description.lens.en].filter(Boolean).join(', ')}.</p>
            {description.azimuth === null && <p role="status" class="field-note">この姿勢・カメラ位置では身体に対する前後左右を確定できません。</p>}
            <p class="field-note">現在の骨盤の正面と人物の配置を基準にしています。顔と目線の指定は含みません。確定後、人物欄で文面を修正できます。</p></section>}
          <div class="human-pose-scene-buttons"><button type="button" class="secondary-button" disabled={backgroundBusy} onClick={() => { if (initial.current) void changeBackground(initial.current); }}>開いた時の設定に戻す</button>
            <button type="button" class="primary-button" disabled={backgroundBusy} onClick={() => capture()}>撮影プレビュー</button>
            {draft.background && <button type="button" class="secondary-button" disabled={backgroundBusy} onClick={() => capture(true)}>背景と一緒に撮影</button>}</div>
        </aside>}
      </div>
      <footer><p class="field-note">動きの位置・微調整・配置・撮影設定を保存します。PNGの保存と画像生成への反映は次の工程です。</p>
        <button type="button" class="secondary-button" onClick={close}>取消</button>
        <button type="button" class="primary-button" disabled={!draft || loading || backgroundBusy} onClick={() => { if (renderer.current) { stopMotion(); onConfirm(renderer.current.snapshot(), renderer.current.cameraSubject()); close(); } }}>確定</button></footer>
    </div>
  </dialog>, document.body);
}
