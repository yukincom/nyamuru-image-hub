import { loadHumanPoseScene } from './localBridge.ts';
import { withNewCreationBridgeSession } from './localBridgeLifecycle.ts';
import { HumanPoseSceneRenderer } from './humanPoseSceneRenderer.ts';
import { requireHumanPoseGenerationReady } from './humanPoseSelection.ts';
import type { FigureSize } from '../types.ts';
import type { HumanPoseTextSelection } from './humanPoseTypes.ts';
import type { HumanPoseCutFrame } from './humanPoseFraming.ts';

/** Reuse the editor's renderer; only the generated PNG is temporary. */
export async function captureHumanPoseReference(value: HumanPoseTextSelection, size: FigureSize, aspect: number, cut?: HumanPoseCutFrame): Promise<string> {
  requireHumanPoseGenerationReady(value);
  if (!value.scene || value.input_mode !== 'image') throw new Error('撮影画像で送るポーズを選んでください');
  const assets = await withNewCreationBridgeSession(() => loadHumanPoseScene(value.pose_id, value.catalog_sha256));
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:512px;height:512px;pointer-events:none';
  document.body.append(host);
  let renderer: HumanPoseSceneRenderer | undefined;
  try {
    // Placement is already world-space. Stage geometry is not needed for a person-only capture.
    // Retain the complete stored settings in value; detach only this rendering copy.
    const scene = structuredClone(value.scene); delete scene.background;
    renderer = await HumanPoseSceneRenderer.create(host, assets, scene, aspect);
    if (scene.framing?.size !== size || Math.abs(scene.frame.width / scene.frame.height / aspect - 1) > .01) renderer.apply(renderer.frameFor(size, aspect));
    return renderer.capture(false, cut);
  } finally { renderer?.dispose(); host.remove(); }
}
