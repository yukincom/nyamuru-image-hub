import type { BBox, BackgroundCapture } from './page.ts';

export interface PaintPoint { x: number; y: number; pressure: number; time: number }

export type PaintBrush = 'round' | 'rough-hatching';

export interface PaintStroke {
  tool: 'pen' | 'eraser' | 'line' | 'rectangle' | 'ellipse' | 'fill' | 'clear';
  color: string | null;
  /** Frozen selection mask for this edit. Empty means no pixels affected. */
  selection?: BBox[];
  /** Closed shape fill; absent or null keeps existing outline-only artwork. */
  fill?: string | null;
  /** Fixed for the whole stroke so preview, Undo and saved artwork share the same marks. */
  brush?: { kind: 'rough-hatching'; seed: number };
  size: number;
  points: PaintPoint[];
}

export interface VectorPoint { x:number; y:number }

export interface VectorNode extends VectorPoint { handleIn?:VectorPoint; handleOut?:VectorPoint }

export interface VectorStyle {
  stroke:string|null; fill:string|null; width:number;
  cap:'butt'|'round'|'square'; join:'miter'|'round'|'bevel'; miterLimit:number;
  dash:number[]; dashOffset:number; alignment:'center'|'inside'|'outside';
  arrowStart:'none'|'triangle'|'open'|'circle'; arrowEnd:'none'|'triangle'|'open'|'circle';
  profile:'uniform'|'taper'|'spindle';
}

export interface VectorPath { id:string; nodes:VectorNode[]; closed:boolean; style:VectorStyle }

export interface PaintMask {
  enabled: boolean;
  /** Unpainted mask pixels reveal the layer when true. Ink reveals; erasing hides. */
  reveal: boolean;
  strokes: PaintStroke[];
}

export interface PaintTone {
  enabled: boolean;
  lpi: number;
  mode: 'image'|'fixed';
  density: number;
  /** Independent solid tone, covered by its own editable mask. */
  fill?: boolean;
  /** Dot angle in degrees. Missing values use 45 degrees. */
  angle?: number;
  /** Pattern origin in document pixels, retained when the canvas gains padding. */
  origin?: {x:number;y:number};
}

export type PaintColorMode = 'color'|'grayscale'|'monochrome';

export interface PaintFolder {
  id: string;
  name: string;
  /** Direct parent within this paint document. Omit at the root. */
  parentFolderId?: string;
  visible?: boolean;
  locked?: boolean;
  /** Index of the first descendant layer, or the insertion boundary for an empty folder. */
  position: number;
  /** Inside a text folder, this folder is in front of its native text. */
  aboveNative?: boolean;
}

export interface PaintLayer {
  /** Provenance used to recognize a retried candidate adoption independently of its editable name. */
  generation?: {jobId:string;candidateIndex:number};
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: 'normal' | 'multiply';
  image?: { assetId: string; crop: BBox; bbox: BBox };
  clip?: BBox;
  strokes: PaintStroke[];
  kind?: 'raster'|'vector';
  paths?: VectorPath[];
  /** Missing values retain the original full-color rendering. */
  colorMode?: PaintColorMode;
  /** Edge coverage levels: none, weak, medium, strong. No blur. */
  antialias?: 0|1|2|3;
  mask?: PaintMask;
  guide?: boolean;
  /** An independent region-marker layer, omitted from normal artwork export. */
  generationMask?: boolean;
  tone?: PaintTone;
  /** Optional user-created palette folder. This never changes rendering by itself. */
  folderId?: string;
  /** Inside a text folder, this layer is in front of its native text. */
  aboveNative?: boolean;
}

export interface PaintDocument {
  version: 1;
  width: number;
  height: number;
  dpi: number;
  /** The original guide has become an editable layer; an empty initialized document suppresses its recreation. */
  guideInitialized?: boolean;
  /** Original guide region in document pixels. Canvas padding does not stretch the guide. */
  referenceFrame?: BBox;
  /** Last 3D camera and source; generated layers remain ordinary editable artwork. */
  background3d?: BackgroundCapture;
  /** Bottom to top. Pixel coordinates belong to this document, not the page. */
  layers: PaintLayer[];
  /** Optional user-created groups for organizing layers without flattening artwork. */
  folders?: PaintFolder[];
}
