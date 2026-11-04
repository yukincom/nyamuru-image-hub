import type { PaintScene } from '../../lib/paintDocument';
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
