import type { BBox, Bubble } from '../../types';
import type { QwenAdoption, QwenAgentRequest, QwenGenerationPlan, QwenLayerCandidate } from '../../lib/qwenGeneration';
import type { GenerationPoseEditorContext } from '../QwenGenerationDialog';
import type { workspaceHistory } from '../../lib/workspaceHistory';
import type { PaintOwner, PaintScene } from '../../lib/paintDocument';
import type { PaintImages } from '../../lib/paintRenderer';
import type { MangaDocument } from '../../types';
import type { CanvasTextTarget } from '../../lib/canvasText';
import type { PaintSessionSnapshot } from '../../lib/paintSession';

export interface MutableRef<T> { current: T }

export type MobileStoryboardPane = 'pages' | 'editor' | 'panel';

export interface WorkspacePaintSession {
  document: MangaDocument;
  pageIndex: number;
  panelIndex: number;
  overlay: boolean;
  scene: PaintScene;
  initialOwner?: string;
  title: string;
  resume?: PaintSessionSnapshot;
  images?: PaintImages;
}

export interface WorkspaceSnapshot {
  document: MangaDocument;
  textSelection?: CanvasTextTarget;
  paint?: Omit<WorkspacePaintSession, 'document' | 'scene' | 'resume' | 'images'> & {
    state: PaintSessionSnapshot;
  };
}

export type EditorTimeline = ReturnType<typeof workspaceHistory<WorkspaceSnapshot>>;

interface TextGenerationSource {
  target: CanvasTextTarget;
  position?: Bubble['text_position'];
}

export interface WorkspaceGeneration {
  id: string;
  plan: QwenGenerationPlan;
  poseEditorContext?: GenerationPoseEditorContext;
  layers: QwenLayerCandidate[];
  loadLayer: (id: string, correction: boolean, crop?: BBox, native?: boolean) => Promise<string>;
  document: MangaDocument;
  pageIndex: number;
  panelIndex: number;
  overlay: boolean;
  owner?: PaintOwner;
  agentRequest?: QwenAgentRequest;
  textSource?: TextGenerationSource;
}

export interface WorkspaceImageTarget {
  document: MangaDocument;
  pageIndex: number;
  panelIndex: number;
  scope: 'page' | 'panel' | 'page_overlay';
  figureIndex?: number;
  bubbleIndex?: number;
  box: BBox;
  generatedOwner?: PaintOwner;
  generatedAdoption?: QwenAdoption;
  generatedFolderId?: string;
  textSource?: TextGenerationSource;
  generationScope?: 'page' | 'panel';
}
