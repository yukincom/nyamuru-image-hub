import type { VectorOverlayState } from '../components/VectorOverlay';
import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { BBox, VectorPoint } from '../types';
import type { PaintOwner, PaintScene } from './paintDocument';
import type { PaintImages } from './paintRenderer';
import type { PendingPaintStroke } from './paintGesture';
import type { PaintCursorMode } from './paintPreferences';

export type PaintPointerEvent = PointerEvent & {currentTarget: HTMLDivElement};
export interface PaintWorkspaceState {
  displayOnly?: boolean;
  background3d?: {ownerKey:string;frame:BBox;setHost:(host:HTMLDivElement|null)=>void;selectedKey:string|null;select:(key:string)=>void;beginMove:(key:string)=>boolean;move:(dx:number,dy:number)=>void;endMove:(keep?:boolean)=>void};
  page: number;
  panelIndex: number;
  overlay: boolean;
  scene: PaintScene;
  owner: PaintOwner;
  images: PaintImages | null;
  /** Not appended to scene layers; consumed once by the renderer's cached live route. */
  live?:PendingPaintStroke;
  guideVisible: (key:string)=>boolean;
  onContextMenu: (event:MouseEvent,key:string)=>void;
  undo:()=>void; redo:()=>void; canUndo:boolean; canRedo:boolean;
  selectionTool?:boolean;
  maskPreview?: {ownerKey:string;layerId:string};
  selection?:{boxes:BBox[];width:number;height:number};
  lasso?:VectorPoint[];
  vector?:VectorOverlayState;
  penCursor?:'pen'|'resume'|'close'|'join';
  cursor?: {mode:PaintCursorMode;size:number;eraserSize:number};
  events: {
    onPointerDown: (event:PaintPointerEvent)=>void;
    onPointerMove: (event:PaintPointerEvent)=>void;
    onPointerLeave?: (event:PaintPointerEvent)=>void;
    onPointerUp: (event:PaintPointerEvent)=>void;
    onPointerCancel: (event:PaintPointerEvent)=>void;
    onLostPointerCapture: (event:PaintPointerEvent)=>void;
  };
  tools: ComponentChildren;
  layers: ComponentChildren;
  status: ComponentChildren;
}
export const PaintGeometryContext = createContext<PaintScene|null>(null);
/** Layout-side direct selection remains available while no paint scene is open. */
export type BubblePathToolMode = false|'node';
export const BubblePathToolContext = createContext<BubblePathToolMode>(false);
/** Synchronous, shared with native capture-phase pan/pinch handlers. */
export const PaintInputActivityContext = createContext<{current:boolean}|null>(null);
export const paintPaletteScope=(page:number,panel:number,overlay=false)=>`${page}/${overlay?'page':`panel-${panel}`}`;
export interface PaintPaletteControls {
  controls:ComponentChildren;
  folded:Record<string,boolean>;
  setFolded:(key:string,value:boolean)=>void;
}
export const PaintLayerControlsContext = createContext<PaintPaletteControls>({controls:null,folded:{},setFolded:()=>{}});
export const PaintDetailsContext = createContext<ComponentChildren>(null);
export const PaintToolsContext = createContext<ComponentChildren>(null);
export const PaintWorkspaceContext = createContext<PaintWorkspaceState|null>(null);
export const usePaintWorkspace = () => useContext(PaintWorkspaceContext);
