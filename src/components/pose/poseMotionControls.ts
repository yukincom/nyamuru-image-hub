import type { HumanPoseSceneSettings } from '../../lib/humanPoseTypes.ts';
import { HumanPoseSceneRenderer } from '../../lib/humanPoseSceneRenderer.ts';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { HumanPoseSurfacePickMode } from '../HumanPoseSurfaceControls.tsx';

interface CreatePoseMotionControlsInputs {
  motionStart: Cell<HumanPoseSceneSettings | null>;
  renderer: Cell<HumanPoseSceneRenderer | null>;
  remember: (scene: HumanPoseSceneSettings) => void;
  motionRun: Cell<number | null>;
  setPlaying: Dispatch<StateUpdater<boolean>>;
  update: (next: HumanPoseSceneSettings, remember?: boolean) => void;
  setError: Dispatch<StateUpdater<string>>;
  setSurfacePicking: Dispatch<StateUpdater<HumanPoseSurfacePickMode>>;
}

export function createPoseMotionControls({ motionStart, renderer, remember, motionRun, setPlaying, update, setError, setSurfacePicking }: CreatePoseMotionControlsInputs) {
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
  return { stopMotion, changeMotion, scrubMotion, playMotion, beginMotion, endMotion };
}

type Cell<T> = { current: T };
