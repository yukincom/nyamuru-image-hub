import { loadHumanPoseScene } from './localBridge.ts';
import { withNewCreationBridgeSession } from './localBridgeLifecycle.ts';
import { HumanPoseSceneRenderer, loadHumanPoseBackground } from './humanPoseSceneRenderer.ts';
import { requireHumanPoseGenerationReady } from './humanPoseSelection.ts';
import type { BackgroundStage, FigureSize } from '../types.ts';
import type { HumanPoseTextSelection } from './humanPoseTypes.ts';
import type { HumanPoseCutFrame } from './humanPoseFraming.ts';

/** Reuse the editor's renderer; only the generated PNG is temporary. */
export async function captureHumanPoseReference(value: HumanPoseTextSelection, size: FigureSize, aspect: number, cut?: HumanPoseCutFrame, previewSize?: {width:number;height:number}, stages: BackgroundStage[] = []): Promise<string> {
  requireHumanPoseGenerationReady(value);
  if (!value.scene || value.input_mode !== 'image') throw new Error('撮影画像で送るポーズを選んでください');
  const bodyModel = value.scene.body_model;
  const assets = await withNewCreationBridgeSession(() => loadHumanPoseScene(value.pose_id, value.catalog_sha256, bodyModel));
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:512px;height:512px;pointer-events:none';
  document.body.append(host);
  let renderer: HumanPoseSceneRenderer | undefined;
  try {
    // Image3 uses the preview camera and stage. Other pose references are person-only.
    const scene = structuredClone(value.scene);
    const background = previewSize && scene.background ? await loadHumanPoseBackground(scene.background.sourceId, stages) : undefined;
    if (!previewSize) delete scene.background;
    renderer = await HumanPoseSceneRenderer.create(host, assets, scene, aspect, background);
    if (scene.framing?.size !== size || Math.abs(scene.frame.width / scene.frame.height / aspect - 1) > .01) renderer.apply(renderer.frameFor(size, aspect));
    return renderer.capture(Boolean(previewSize), cut, previewSize);
  } finally { renderer?.dispose(); host.remove(); }
}
