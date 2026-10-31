import { createPortal } from 'preact/compat';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { loadHumanPoseCatalog, loadHumanPoseScene } from '../lib/localBridge.ts';
import { withNewCreationBridgeSession } from '../lib/localBridgeLifecycle.ts';
import { dollyBackgroundCamera, shiftBackgroundCamera } from '../lib/background3dCamera.ts';
import { HumanPoseSceneRenderer, loadHumanPoseBackground } from '../lib/humanPoseSceneRenderer.ts';
import { humanPoseCameraParts, humanPoseSceneFrame, humanPoseSceneForPreset, useHumanPoseBackgroundCamera } from '../lib/humanPoseScene.ts';
import { humanPoseSelectable, selectHumanPose } from '../lib/humanPoseSelection.ts';
import { searchHumanPoses } from '../lib/humanPoseSearch.ts';
import { HUMAN_POSE_PREVIEW_ART } from '../lib/humanPosePreviewArt.ts';
import { CUBE_STAGE_ID } from '../lib/background3d.ts';
import type { BackgroundCapture, BackgroundStage, FigureSize } from '../types.ts';
import { HUMAN_POSE_PREVIEW_MARGIN, humanPoseCutOutline, humanPosePreviewWindow, MANUAL_HUMAN_POSE_FRAMING, type HumanPoseCutFrame } from '../lib/humanPoseFraming.ts';
import type { HumanPosePanelContext } from '../lib/humanPoseComposition.ts';
import type { HumanPoseBodyModel, HumanPoseCameraSubject, HumanPoseCatalog, HumanPoseCatalogEntry, HumanPoseSceneSettings, HumanPoseSurfaceAnchor, HumanPoseSurfacePlacement, HumanPoseTextSelection, PoseVector } from '../lib/humanPoseTypes.ts';
import HumanPoseMotionControls from './HumanPoseMotionControls.tsx';
import HumanPoseSurfaceControls, { type HumanPoseSurfacePickMode } from './HumanPoseSurfaceControls.tsx';
import BackgroundCameraGizmo from './BackgroundCameraGizmo.tsx';
import FigureSizePicker from './FigureSizePicker.tsx';
import { FIGURE_SIZE_LABELS } from '../lib/manga.ts';
import './HumanPoseSceneDialog.css';
import { HUMAN_POSE_HANDLES, humanPoseJoint } from '../lib/humanPoseJoints.ts';

interface Props {
  value: HumanPoseTextSelection;
  aspect?: number;
  framingLabel?: string;
  framingSize?: FigureSize;
  cutFrame?: HumanPoseCutFrame;
  panelContext?: HumanPosePanelContext;
  stages?: BackgroundStage[];
  backgroundCaptures?: Array<{ label: string; capture: BackgroundCapture }>;
  onConfirm: (scene: HumanPoseSceneSettings, subject: HumanPoseCameraSubject, selection: HumanPoseTextSelection) => void;
  onClose: () => void;
}
type Camera = HumanPoseSceneSettings['camera'];
type PoseSnapshot = { selection: HumanPoseTextSelection; scene: HumanPoseSceneSettings };

export default function HumanPoseSceneDialog({ value, aspect: figureAspect = 1, framingSize: initialFramingSize = 'bust-up', cutFrame, panelContext, stages = [], backgroundCaptures = [], onConfirm, onClose }: Props) {
  const aspect = cutFrame?.aspect ?? figureAspect;
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), host = useRef<HTMLDivElement>(null);
  const renderer = useRef<HumanPoseSceneRenderer | null>(null);
  const initial = useRef<PoseSnapshot | null>(null);
  const [poseValue, setPoseValue] = useState(() => structuredClone(value));
  const poseRef = useRef(poseValue); poseRef.current = poseValue;
  const presetScene = useRef<HumanPoseSceneSettings>();
  const bodyChange = useRef(false);
  const exactScene = useRef(false), poseLoading = useRef(true);
  const [catalog, setCatalog] = useState<HumanPoseCatalog | null>(null), [query, setQuery] = useState('');
  const [catalogError, setCatalogError] = useState(''), [catalogAttempt, setCatalogAttempt] = useState(0);
  const ready = catalog?.poses.filter(humanPoseSelectable) ?? [];
  const matches = catalog ? searchHumanPoses(ready, catalog.tags, query) : [];
  const drag = useRef<{ pointer: number; x: number; y: number; camera: Camera; moved: boolean } | null>(null);
  const jointDrag = useRef<{ pointer: number; scene: HumanPoseSceneSettings } | null>(null);
  const undo = useRef<PoseSnapshot[]>([]), redo = useRef<PoseSnapshot[]>([]);
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
  const [companions, setCompanions] = useState<{ behind: string; ahead: string }>();
  const [showCompanions, setShowCompanions] = useState(false);
  const [companionError, setCompanionError] = useState('');
  const [backgroundBusy, setBackgroundBusy] = useState(false), [detachBackground, setDetachBackground] = useState(false);
  const [previewBackground, setPreviewBackground] = useState(false);
  const backgroundRequest = useRef(0);
  const frame = draft?.frame ?? poseValue.scene?.frame ?? humanPoseSceneFrame(aspect);
  const framingSize = draft?.framing?.size ?? initialFramingSize;
  const outputFrame = cutFrame ? humanPoseSceneFrame(cutFrame.aspect * cutFrame.bounds.w / cutFrame.bounds.h) : frame;
  const previewWindow = humanPosePreviewWindow(cutFrame);
  const snapshot = (scene = renderer.current?.snapshot()): PoseSnapshot | null => scene
    ? { selection: structuredClone(poseRef.current), scene: structuredClone(scene) } : null;
  const remember = (scene: HumanPoseSceneSettings) => {
    undo.current.push(snapshot(scene)!); redo.current = []; setHistoryVersion(v => v + 1);
  };

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
      remember(active.scene);
    }
    if (host.current?.hasPointerCapture(active.pointer)) host.current.releasePointerCapture(active.pointer);
  };
  const releaseSpace = () => { spaceHeld.current = false; setSpacePan(false); finishPan(); };
  const cancelInteraction = () => { stopMotion(); setSurfacePicking(null); releaseSpace(); finishJoint(true); };

  useEffect(() => { dialog.current?.showModal(); host.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    let cancelled = false; setCatalogError('');
    void withNewCreationBridgeSession(loadHumanPoseCatalog).then(next => { if (!cancelled) setCatalog(next); })
      .catch(cause => { if (!cancelled) setCatalogError(cause instanceof Error ? cause.message : '人体ポーズを読み込めませんでした'); });
    return () => { cancelled = true; };
  }, [catalogAttempt]);
  useEffect(() => {
    let cancelled = false;
    if (panelContext) void import('../lib/humanPoseComposition.ts').then(({ captureHumanPoseCompanions }) => captureHumanPoseCompanions(panelContext))
      .then(value => { if (!cancelled) setCompanions(value); }).catch(cause => { if (!cancelled) setCompanionError(cause instanceof Error ? cause.message : '相方を仮表示できません'); });
    return () => { cancelled = true; };
  }, []);
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
    let cancelled = false;
    poseLoading.current = true; setLoading(true); setError(''); setPreview('');
    void (async () => {
      try {
        const bodyModel = (presetScene.current ?? poseValue.scene)?.body_model;
        const assets = await withNewCreationBridgeSession(() => loadHumanPoseScene(poseValue.pose_id, poseValue.catalog_sha256, bodyModel));
        if (cancelled || !host.current) return;
        const changingPreset = Boolean(presetScene.current);
        const saved = presetScene.current ? humanPoseSceneForPreset(presetScene.current, assets.source) : poseValue.scene && structuredClone(poseValue.scene);
        if (saved && detachBackground) delete saved.background;
        const existing = renderer.current;
        const background = saved?.background && (!existing || existing.snapshot().background?.sourceId !== saved.background.sourceId)
          ? await loadHumanPoseBackground(saved.background.sourceId, stages) : undefined;
        if (cancelled || !host.current) return;
        let active = existing;
        if (active && saved) { await active.replacePose(assets, saved, changingPreset || bodyChange.current, background, bodyChange.current); if (cancelled) return; }
        else {
          active = await HumanPoseSceneRenderer.create(host.current, assets, saved, aspect, background);
          if (cancelled) { active.dispose(); return; }
          if (!exactScene.current && (saved?.framing?.size !== framingSize || Math.abs(active.snapshot().frame.width / active.snapshot().frame.height / aspect - 1) > .01)) active.apply(active.frameFor(framingSize, aspect));
        }
        active.setPreviewMargin(HUMAN_POSE_PREVIEW_MARGIN, cutFrame);
        active.selectJoint('', details);
        renderer.current = active; presetScene.current = undefined; exactScene.current = false; bodyChange.current = false;
        initial.current ??= snapshot(active.snapshot()); setDraft(active.snapshot());
      } catch (cause) { if (!cancelled) { setDraft(null); setError(cause instanceof Error ? cause.message : '3D表示を開けませんでした'); } }
      finally { if (!cancelled) { poseLoading.current = false; setLoading(false); } }
    })();
    return () => { cancelled = true; if (motionRun.current !== null) cancelAnimationFrame(motionRun.current); motionRun.current = null; motionStart.current = null; backgroundRequest.current++; drag.current = null; };
    // 開いた時点の保存値をdraftへ複製し、確定するまで親を書き換えない。
  }, [poseValue.pose_id, poseValue.catalog_sha256, poseValue.scene?.body_model, attempt]);
  useEffect(() => () => { renderer.current?.dispose(); renderer.current = null; }, []);

  const update = (next: HumanPoseSceneSettings, remember = true) => {
    if (remember) stopMotion();
    try {
      const before = renderer.current?.snapshot();
      renderer.current?.apply(next);
      if (remember && before && JSON.stringify(before) !== JSON.stringify(next)) { undo.current.push(snapshot(before)!); redo.current = []; setHistoryVersion(v => v + 1); } setDraft(structuredClone(next)); setPreview(''); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '撮影設定を変更できません'); }
  };
  const beginMotion = () => { motionStart.current ??= renderer.current?.snapshot() ?? null; };
  const endMotion = () => {
    const before = motionStart.current; motionStart.current = null;
    if (before && renderer.current && JSON.stringify(before) !== JSON.stringify(renderer.current.snapshot())) {
      remember(before);
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
    const stack = back ? undo.current : redo.current, next = stack.pop(); if (!next) return;
    const current = snapshot(); if (current) (back ? redo.current : undo.current).push(current);
    restoreSnapshot(next); setHistoryVersion(v => v + 1);
  };
  const restoreSnapshot = (next: PoseSnapshot) => {
    cancelInteraction(); presetScene.current = undefined; exactScene.current = true; bodyChange.current = false;
    const samePose = next.selection.pose_id === poseRef.current.pose_id && next.selection.catalog_sha256 === poseRef.current.catalog_sha256;
    const sameModel = next.scene.body_model === renderer.current?.snapshot().body_model;
    const selection = { ...structuredClone(next.selection), scene: structuredClone(next.scene) };
    poseRef.current = selection; setPoseValue(selection);
    if (samePose && sameModel && renderer.current) void changeBackground(next.scene);
    else { poseLoading.current = true; setLoading(true); setSelected(''); if (samePose) setAttempt(v => v + 1); }
  };
  const choosePose = (pose: HumanPoseCatalogEntry) => {
    if (!catalog || poseLoading.current || backgroundBusy || pose.id === poseRef.current.pose_id && catalog.catalog_sha256 === poseRef.current.catalog_sha256) return;
    cancelInteraction();
    const before = snapshot(); if (before) remember(before.scene);
    const next = { ...selectHumanPose(pose, catalog.catalog_sha256), input_mode: poseRef.current.input_mode };
    presetScene.current = before?.scene; exactScene.current = false; poseLoading.current = true;
    poseRef.current = next; setPoseValue(next); setLoading(true); setSelected(''); setDetachBackground(false);
  };
  const chooseBodyModel = (model?: HumanPoseBodyModel) => {
    if (poseLoading.current || backgroundBusy || !renderer.current || renderer.current.snapshot().body_model === model) return;
    cancelInteraction();
    const before = snapshot()!; remember(before.scene);
    const next = { ...structuredClone(poseRef.current), scene: { ...before.scene, body_model: model } };
    presetScene.current = undefined; bodyChange.current = true; exactScene.current = false; poseLoading.current = true;
    poseRef.current = next; setPoseValue(next); setAttempt(v => v + 1); setLoading(true); setSelected(''); setDetachBackground(false);
  };
  const camera = (next: Camera) => { if (draft) update({ ...draft, camera: next }); };
  const flipBody = () => {
    if (draft) update({ ...draft, body_mirror: draft.body_mirror === 'mirrored' ? 'original' : 'mirrored' });
  };
  const description = draft && renderer.current ? humanPoseCameraParts(draft, renderer.current.cameraSubject()) : null;
  const capture = (includeBackground = false) => {
    stopMotion();
    try {
      if (renderer.current && !renderer.current.snapshot().framing) update(renderer.current.frameFor(framingSize, aspect));
      setPreview(renderer.current?.capture(includeBackground, cutFrame) ?? ''); setPreviewBackground(includeBackground); setError(''); }
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
      <header><h2 id={`${id}-title`}>{poseValue.label_ja} — 3D配置と撮影</h2><button type="button" class="icon-button" aria-label="閉じる" onClick={close}>×</button></header>
      <p class="field-note">マーカーを掴んで姿勢を作り、「確定」で保存します。ポーズの説明文は自動では書き換わりません。</p>
      {loading && !draft && <p role="status">3D素材を読み込んでいます…</p>}
      {error && <p role="alert">{error}</p>}
      {showCompanions && companionError && <p role="alert">{companionError}</p>}
      {!loading && !draft && <><button type="button" class="secondary-button" onClick={() => setAttempt(v => v + 1)}>再読込</button>
        {undo.current.length > 0 && <button type="button" class="secondary-button" onClick={() => stepHistory(true)}>元に戻す</button>}
        {poseValue.scene?.background && !detachBackground && <button type="button" class="secondary-button" onClick={() => { setDetachBackground(true); setAttempt(v => v + 1); }}>背景との関連付けを外して開く</button>}</>}
      {backgroundBusy && <p role="status">背景を読み込んでいます…</p>}
      <div class="human-pose-scene-layout">
        <div>
          <div class="human-pose-scene-view" style={{ aspectRatio: `${outputFrame.width} / ${outputFrame.height}`, width: `min(100%, ${60 * outputFrame.width / outputFrame.height}vh)` }}
            onPointerDownCapture={event => {
              if (event.button === 0 && event.target instanceof Element && event.target.closest('.background3d-gizmo')) host.current?.focus({ preventScroll: true });
            }}
            onWheel={event => {
              if (!draft || loading || backgroundBusy) return;
              event.preventDefault();
              if (!event.deltaY || drag.current || jointDrag.current) return;
              const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? event.currentTarget.clientHeight : 1;
              camera(dollyBackgroundCamera(draft.camera, Math.exp(Math.max(-1, Math.min(1, event.deltaY * unit * .001))), .02, 10000));
            }}>
            {showCompanions && companions && <img class="human-pose-companions" src={companions.behind} alt="後ろの人物の仮表示" />}
            <div ref={host} class={`human-pose-scene-canvas${spacePan ? ' is-space-pan' : ''}${panning ? ' is-panning' : ''}${surfacePicking ? ' is-surface-picking' : ''}`}
              tabIndex={0} role="group" aria-label="人体ポーズの操作領域" aria-describedby={`${id}-controls`}
              onContextMenu={event => event.preventDefault()}
              onKeyDown={event => {
                if (event.code !== 'Space' || !draft || loading || backgroundBusy) return;
                event.preventDefault(); spaceHeld.current = true; setSpacePan(true);
              }}
              onBlur={() => { releaseSpace(); finishJoint(true); }}
              onPointerDown={event => {
                if (!draft || loading || backgroundBusy || event.button !== 0 || drag.current) return;
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
                const next = shiftBackgroundCamera(start.camera, dx / Math.max(1, event.currentTarget.clientWidth) * (draft?.framing?.crop.w ?? 1) * previewWindow.w, dy / Math.max(1, event.currentTarget.clientHeight) * (draft?.framing?.crop.h ?? 1) * previewWindow.h);
                next.shift = next.shift!.map(v => Math.max(-2, Math.min(2, v))) as [number, number]; camera(next);
              }}
              onPointerUp={event => { if (jointDrag.current?.pointer === event.pointerId) finishJoint(); if (drag.current?.pointer === event.pointerId) finishPan(); }}
              onPointerCancel={cancelInteraction} onLostPointerCapture={() => { finishJoint(true); finishPan(); }} />
            {showCompanions && companions && <img class="human-pose-companions" src={companions.ahead} alt="前の人物の仮表示" />}
            <svg class="human-pose-cut-frame" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label={cutFrame ? 'コマの撮影枠・枠外を30%暗く表示' : '撮影枠・枠外を30%暗く表示'}>
              <path class="human-pose-cut-shade" d={`M0 0H1V1H0Z ${humanPoseCutOutline(cutFrame)}`} fill-rule="evenodd" />
              <path class="human-pose-cut-border" d={humanPoseCutOutline(cutFrame)} vector-effect="non-scaling-stroke" />
            </svg>
            {draft && <BackgroundCameraGizmo camera={draft.camera} disabled={loading || backgroundBusy} onChange={camera} />}
          </div>
          <p class="field-note" id={`${id}-controls`}>三方矢印：ドラッグで角度調整・クリックで軸方向へ ／ ホイール：近づく・離れる ／ Space＋ドラッグ：画面を掴んで移動。マーカー：姿勢を動かす ／ Shift＋ドラッグ：奥行き移動。暗い部分は撮影範囲外です。枠線・暗幕・床・操作マーカーは撮影に入りません。</p>
          {draft && <fieldset disabled={loading || backgroundBusy}><legend>表示モデル</legend>
            <select aria-label="表示モデル" value={draft.body_model ?? ''} onChange={event => chooseBodyModel(event.currentTarget.value === 'bodychan-female' ? 'bodychan-female' : undefined)}>
              <option value="">軽量表示</option><option value="bodychan-female">女性モデル</option>
            </select>
          </fieldset>}
          {draft && <fieldset class="human-pose-body-choice" disabled={loading || backgroundBusy}><legend>体勢の左右</legend>
            <div class="human-pose-scene-buttons">
              <button type="button" class="secondary-button" aria-pressed={draft.body_mirror === 'mirrored'} onClick={flipBody}>左右反転</button>
            </div>
            <p class="field-note" role="status">現在：{draft.body_mirror === 'mirrored' ? '左右反転した体勢' : '元の体勢'}。押すたびに切り替わります。</p>
            <p class="field-note">顔の向き・配置・カメラは変わりません。ポーズの説明文は自動で書き換えません。</p>
          </fieldset>}
          {panelContext && <><label><input type="checkbox" checked={showCompanions} onChange={event => setShowCompanions(event.currentTarget.checked)} />相方を仮表示</label>
            {showCompanions && <p class="field-note">相方は現在の配置で仮表示しています。人物単品の撮影・生成には含めず、コマ・ページの生成では一緒に送ります。</p>}</>}
          {preview && <figure class="human-pose-scene-preview"><img src={preview} alt={previewBackground ? '背景と人物を同じカメラで撮影したPNG' : '現在の設定で撮影した透過PNG'} /><figcaption>{previewBackground ? '背景と人物' : '人物のみ・透過PNG'}（{outputFrame.width}×{outputFrame.height}）。設定を変更すると再撮影が必要です。</figcaption></figure>}
        </div>
        <aside aria-label="配置・撮影設定">
          <fieldset class="human-pose-presets" disabled={loading || backgroundBusy}><legend>登録ポーズ</legend>
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
          {draft && <>
          <HumanPoseMotionControls clips={renderer.current?.motionClips ?? []} value={draft.motion} playing={playing} disabled={loading || backgroundBusy}
            onClip={changeMotion} onPhase={scrubMotion} onPlay={playMotion} onPause={stopMotion} onBegin={beginMotion} onEnd={endMotion} />
          <fieldset disabled={loading || backgroundBusy}><legend>関節を動かす</legend>
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
              <button type="button" class="secondary-button" disabled={loading || backgroundBusy || !undo.current.length} onClick={() => stepHistory(true)}>元に戻す</button>
              <button type="button" class="secondary-button" disabled={loading || backgroundBusy || !redo.current.length} onClick={() => stepHistory(false)}>やり直す</button>
              <button type="button" class="secondary-button" disabled={loading || backgroundBusy || !draft.joint_edits} onClick={() => update({ ...draft, joint_edits: undefined })}>微調整を戻す</button>
            </div>
          </fieldset>
          <fieldset disabled={loading || backgroundBusy}><legend>一緒に表示する背景</legend>
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
            picking={surfacePicking} disabled={loading || backgroundBusy} aligned={renderer.current?.surfaceAligned() ?? false}
            onPick={mode => { stopMotion(); finishJoint(true); setSurfacePicking(mode); setError(''); }}
            onAnchor={anchor => { setSurfaceAnchor(anchor); setSurfacePicking(null); if (draft.background?.surface) update({ ...draft, background: { ...draft.background, surface: { ...draft.background.surface, anchor } } }); }}
            onAlign={alignSurface} onClear={() => { setSurfacePicking(null); update({ ...draft, background: { ...draft.background!, surface: undefined } }); }}
            onClearFacing={() => { setSurfacePicking(null); update({ ...draft, background: { ...draft.background!, surface: { ...draft.background!.surface!, facing_degrees: undefined } } }); }} />}
          <fieldset disabled={loading || backgroundBusy}><legend>人物全体の配置</legend>
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
          <fieldset disabled={loading || backgroundBusy}><legend>撮影カメラ</legend>
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
          {description && <section class="human-pose-scene-description"><strong>撮影設定からの説明</strong>
            <p>アングル：{description.angle.ja || '判定できません'}</p><p>レンズ：{description.lens.ja}</p>
            <p lang="en">{[description.angle.en, description.lens.en].filter(Boolean).join(', ')}.</p>
            {description.azimuth === null && <p role="status" class="field-note">この姿勢・カメラ位置では身体に対する前後左右を確定できません。</p>}
            <p class="field-note">現在の骨盤の正面と人物の配置を基準にしています。顔と目線の指定は含みません。確定後、人物欄で文面を修正できます。</p></section>}
          <div class="human-pose-scene-buttons"><button type="button" class="secondary-button" disabled={loading || backgroundBusy} onClick={() => { if (initial.current && (poseValue.pose_id !== initial.current.selection.pose_id || JSON.stringify(draft) !== JSON.stringify(initial.current.scene))) { remember(draft); restoreSnapshot(initial.current); } }}>開いた時の設定に戻す</button>
            <button type="button" class="primary-button" disabled={loading || backgroundBusy} onClick={() => capture()}>撮影プレビュー</button>
            {draft.background && <button type="button" class="secondary-button" disabled={loading || backgroundBusy} onClick={() => capture(true)}>背景と一緒に撮影</button>}</div>
        </>}
        </aside>
      </div>
      <footer><p class="field-note">姿勢・配置・撮影範囲を保存します。撮影画像で送る場合は、この範囲をポーズ参照に使います。</p>
        <button type="button" class="secondary-button" onClick={close}>取消</button>
        <button type="button" class="primary-button" disabled={!draft || loading || backgroundBusy} onClick={() => {
          if (!renderer.current) return;
          try { stopMotion(); if (!renderer.current.snapshot().framing) update(renderer.current.frameFor(framingSize, aspect)); renderer.current.capture(false, cutFrame); onConfirm(renderer.current.snapshot(), renderer.current.cameraSubject(), poseRef.current); close(); }
          catch (cause) { setError(cause instanceof Error ? cause.message : '撮影範囲を確認してください'); }
        }}>確定</button></footer>
    </div>
  </dialog>, document.body);
}
