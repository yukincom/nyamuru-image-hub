import type { HumanPoseTextSelection, HumanPoseSceneSettings, HumanPoseCameraSubject } from '../../lib/humanPoseTypes.ts';
import type { FigureSize, BackgroundStage, BackgroundCapture } from '../../types.ts';
import type { HumanPoseCutFrame } from '../../lib/humanPoseFraming.ts';
import type { HumanPosePanelContext } from '../../lib/humanPoseComposition.ts';

export interface Props {
  value: HumanPoseTextSelection;
  aspect?: number;
  framingLabel?: string;
  framingSize?: FigureSize;
  cutFrame?: HumanPoseCutFrame;
  panelContext?: HumanPosePanelContext;
  stages?: BackgroundStage[];
  backgroundCaptures?: Array<{ label: string; capture: BackgroundCapture }>;
  previewSize?: {width:number;height:number};
  onConfirm: (scene: HumanPoseSceneSettings, subject: HumanPoseCameraSubject, selection: HumanPoseTextSelection, previewPng?:string) => void | Promise<void>;
  onClose: () => void;
}

export type Camera = HumanPoseSceneSettings['camera'];

export type PoseSnapshot = { selection: HumanPoseTextSelection; scene: HumanPoseSceneSettings };
