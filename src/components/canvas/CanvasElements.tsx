import type {
  CanvasElementSelection, TextStyle, ImageAsset, MangaPage, BBox, BubbleTailTarget, BubbleTailRoot,
  BubbleTextPosition, Bubble, Panel, PersistentAnalogAssetRef, TextStyleRange,
} from '../../types';
import {
  type TextStylePatch, type TextSelection, textStyleCss, textStyleSegments, textInlineStyleCss,
} from '../../lib/textStyle';
import type { CanvasTextTarget } from '../../lib/canvasText';
import type { BubbleTextTarget } from '../../lib/panelLayers';
import { type PcFontFamily, bubbleCssFontFamily } from '../../lib/bubbleFonts';
import {
  type PanelGutterSettings, type PanelEdgeReference, type InteractionGeometry, type CanvasSize,
  panelBounds, panelShapePoints,
} from '../../lib/canvasGeometry';
import { type BubbleBezier, isBubbleBezier, createBubbleBezier } from '../../lib/bubbleBezier.ts';
import { materialBubbleBezier } from '../../lib/bubblePresetData';
import { useRef, useLayoutEffect, useState, useEffect } from 'preact/hooks';
import { loadFigureCropAsset } from '../../lib/figureCropStore';

export interface MangaCanvasProps {
  agentWorkTarget?:{panelIndex:number;selection:CanvasElementSelection};
  zoomTool?:boolean;
  textTool?:boolean;
  textToolStyle?:TextStyle;
  onTextToolStyle?:(patch:TextStylePatch)=>void;
  textSettingsOwner?:boolean;
  pageIndex?:number;
  onTextStyle?:(target:CanvasTextTarget,patch:TextStylePatch,selection?:TextSelection)=>void;
  onBubbleMaterial?:(target:CanvasTextTarget,id:string)=>void;
  onOpenBubbleMaterials?:()=>void;
  editingText?:CanvasTextTarget|null;
  onEditScreenText?:(panelIndex:number,index:number,overlay?:boolean)=>void;
  onEditBubble?:(target:Omit<BubbleTextTarget,'pageIndex'>)=>void;
  onCreateScreenTextAt?:(panelIndex:number|null,point:{x:number;y:number})=>void;
  onWrapScreenText?:(target:CanvasTextTarget,materialId:string)=>void;
  onFinishElementMove?:(selection:CanvasElementSelection,panelIndex:number|null)=>void;
  onTextHistory?:(direction:'undo'|'redo')=>void;
  onText?:(target:CanvasTextTarget,text:string,edit?:TextSelection)=>void;
  onEndTextEdit?:()=>void;
  painting?: boolean;
  paintTarget?: {panelIndex:number;overlay:boolean};
  dpi?: number;
  outputSize?: {width_mm:number;height_mm:number;bleed_mm?:number;crop_marks?:boolean};
  spreadSide?: 'left'|'right';
  onNotify?: (message: string) => void;
  guideVisible:(key:string,panelIndex:number,overlay?:boolean)=>boolean;
  onToggleGuide:(key:string,panelIndex:number,overlay?:boolean)=>void;
  onGenerateArtwork:(key:string,panelIndex:number,overlay?:boolean)=>void;
  onGenerateComposition?:(scope:'page'|'panel',panelIndex:number)=>void;
  onReplaceArtwork?: (panelIndex: number, figureIndex?: number, overlay?: boolean, bubbleIndex?:number) => void;
  imageAssets?: ImageAsset[];
  onImageGesture?: (phase: 'start' | 'end', source?:'text-size') => void;
  title: string;
  author: string;
  page: MangaPage;
  pageCount: number;
  zoomPercent: number|null;
  onZoomPercentChange: (percent: number|null) => void;
  frameLineWidthMm: number;
  bubbleLineWidthMm: number;
  defaultBubbleFont: string;
  fontFamilies?: readonly PcFontFamily[];
  onRequestFonts?:()=>void;
  activePanel: number;
  selectedPanels: readonly number[];
  selectedElement: CanvasElementSelection | null;
  showGuides: boolean;
  innerFrameSnap: boolean;
  panelGutters: PanelGutterSettings;
  panelGapSnap: boolean;
  panelSync: boolean;
  onSelectPanel: (index: number, additive?: boolean) => void;
  onSelectElement: (selection: CanvasElementSelection | null, panelIndex?: number, revealDetails?: boolean) => void;
  onChangeElementBBox: (selection: CanvasElementSelection, bbox: BBox) => void;
  onChangeBubbleTail: (selection: CanvasElementSelection, tail?: BubbleTailTarget, patch?:{bezier?:BubbleBezier;tailRoot?:BubbleTailRoot;textPosition?:BubbleTextPosition}) => void;
  onMovePanel: (panelIndex: number, deltaX: number, deltaY: number) => void;
  onResizePanel: (panelIndex: number, bounds: BBox) => void;
  onMoveVertex: (panelIndex: number, vertexIndex: number, x: number, y: number, linkPanels?: boolean) => void;
  onMovePanelEdge: (panelIndex: number, edgeIndex: number, deltaX: number, deltaY: number, linkPanels?: boolean, excludedEdge?: PanelEdgeReference) => void;
}

export function bubbleOutlineForDirectEdit(bubble: Bubble): BubbleBezier {
  const current = bubble.bezier ?? materialBubbleBezier(bubble.shape);
  if (isBubbleBezier(current)) return current;
  if (bubble.shape === 'square' || bubble.shape === 'caption') return createBubbleBezier('rounded');
  if (bubble.shape === 'flash' || bubble.shape === 'uniflash' || bubble.shape === 'toge' || bubble.shape === 'toge_natural') return createBubbleBezier('burst');
  if (bubble.shape === 'thought') return createBubbleBezier('cloud');
  return createBubbleBezier('ellipse');
}

export interface Interaction extends InteractionGeometry {
  selection: CanvasElementSelection;
  paperRect: DOMRect;
}

export function panelStyle(panel: Panel, canvas: CanvasSize): Record<string, string | number> {
  if (panel.shape.type === 'rect') {
    return {
      left: `${panel.shape.x / (canvas.w / 100)}%`, top: `${panel.shape.y / (canvas.h / 100)}%`,
      width: `${panel.shape.w / (canvas.w / 100)}%`, height: `${panel.shape.h / (canvas.h / 100)}%`,
    };
  }
  const xs = panel.shape.points.map(([x]) => x);
  const ys = panel.shape.points.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = maxX - minX || 1, height = maxY - minY || 1;
  const points = panel.shape.points.map(([x, y]) => `${((x - minX) / width) * 100}% ${((y - minY) / height) * 100}%`).join(',');
  return {
    left: `${minX / (canvas.w / 100)}%`, top: `${minY / (canvas.h / 100)}%`, width: `${width / (canvas.w / 100)}%`, height: `${height / (canvas.h / 100)}%`,
    clipPath: `polygon(${points})`,
  };
}

// 人物/オブジェクト名。ボックス幅に収まらない場合は --name-fit（縮小率）で自動縮小する。
// フォントのpx下限/上限があるため率は紙面サイズに依存する。fitEpoch（紙面サイズ確定・
// ズームのたびに増える）を依存に入れて毎回再測定する
export function FigureName({ name, boxW, boxH, fitEpoch }: { name: string; boxW: number; boxH: number; fitEpoch: number }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--name-fit', '1');
    for (let i = 0; i < 2; i++) {
      const overflow = el.scrollWidth / Math.max(1, el.clientWidth);
      if (overflow <= 1.02) break;
      const current = parseFloat(el.style.getPropertyValue('--name-fit')) || 1;
      el.style.setProperty('--name-fit', String(Math.max(0.35, current / overflow)));
    }
  }, [name, boxW, boxH, fitEpoch]);
  return <span class="figure-name-layer"><small ref={ref} class="figure-name">{name}</small></span>;
}

export function StoredCropImage({ assetId, persistentAsset, className }: { assetId: string; persistentAsset?: PersistentAnalogAssetRef; className: string }) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let ignored = false;
    let objectUrl: string | null = null;
    setSource(null);
    void loadFigureCropAsset(assetId, persistentAsset)
      .then((blob) => {
        if (!blob || ignored) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      ignored = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, persistentAsset?.workKey, persistentAsset?.kind, persistentAsset?.fileName]);
  return source ? <img class={className} src={source} alt="" draggable={false} /> : null;
}

// フキダシ内テキスト。自動改行や文字縮小をせず、入力された改行をそのまま表示する。
export function BubbleText({ text, font, shape, lengthClass, boxW, boxH, fitEpoch, position={x:.5,y:.5}, style, runs, paperWidth=210, review=false, onEdit, onMoveFrame, moveFrameActive=false }: { text: string; font: string; shape?: string; lengthClass: string; boxW: number; boxH: number; fitEpoch: number; position?:BubbleTextPosition;style?:TextStyle;runs?:TextStyleRange[];paperWidth?:number;review?:boolean;onEdit?:()=>void;onMoveFrame?:(event:PointerEvent)=>void;moveFrameActive?:boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const layout = () => {
      el.style.setProperty('--bubble-fit', '1');
      el.style.setProperty('--bubble-center-x', '0px');
      el.style.setProperty('--bubble-center-y', '0px');
      // Wrapped columns may leave unused inline space. Center their actual text
      // rectangle, not that available-height box; keep every column top-aligned.
      const content = el.querySelector('.bubble-text-content');
      if (!content) return;
      const range = document.createRange();
      // Include the same content block as the noninteractive view, but never
      // include the absolute-positioned text-move frame in the measurement.
      range.selectNode(content);
      const textBox = range.getBoundingClientRect();
      const bubbleBox = el.parentElement?.getBoundingClientRect();
      const elementBox = el.getBoundingClientRect();
      const width = parseFloat(getComputedStyle(el).width);
      const scale = width > 0 ? elementBox.width / width : 0;
      if (!bubbleBox || !textBox.width || !textBox.height || !(scale > 0)) return;
      el.style.setProperty('--bubble-center-x', `${(bubbleBox.x + bubbleBox.width * position.x - textBox.x - textBox.width / 2) / scale}px`);
      el.style.setProperty('--bubble-center-y', `${(bubbleBox.y + bubbleBox.height * position.y - textBox.y - textBox.height / 2) / scale}px`);
    };
    layout();
    document.fonts.addEventListener('loadingdone', layout);
    return () => document.fonts.removeEventListener('loadingdone', layout);
  }, [text, font, shape, lengthClass, boxW, boxH, fitEpoch, position.x, position.y, style, runs]);
  const interactive=Boolean(onEdit);
  return <span ref={ref} class={`vertical-text bubble-text ${lengthClass} has-fixed-text-size ${review?'is-text-review':''} ${interactive?'is-interactive':''} ${onMoveFrame?'has-move-frame':''}`} data-review={review||undefined}  style={{ fontFamily: bubbleCssFontFamily(font),...textStyleCss({...style,fontSize:style?.fontSize??15},paperWidth,font) }}>
    <span class="bubble-text-content"
      onPointerDown={interactive?event=>event.stopPropagation():undefined}
      onClick={interactive?event=>{event.stopPropagation();onEdit?.();}:undefined}
      >
      {textStyleSegments({text,text_style:style,text_runs:runs}).map((part,i)=><span key={i} style={textInlineStyleCss(part)}>{part.text}</span>)}
    </span>
    {onMoveFrame&&<span class={`bubble-text-move-frame ${moveFrameActive?'is-active':''}`} aria-label="本文をドラッグして移動" onPointerDown={event=>{event.stopPropagation();onMoveFrame(event);}}>
      {(['top','right','bottom','left'] as const).map(side=><span class={`bubble-text-move-edge is-${side}`} key={side}/>)}
    </span>}
  </span>;
}

export function bboxStyle(box: BBox, panel: Panel): Record<string, string> {
  const bounds = panelBounds(panel);
  return {
    left: `${((box.x - bounds.x) / bounds.w) * 100}%`,
    top: `${((box.y - bounds.y) / bounds.h) * 100}%`,
    width: `${(box.w / bounds.w) * 100}%`,
    height: `${(box.h / bounds.h) * 100}%`,
  };
}

// 紙面の実寸基準の配置。選択中パネルのエレメントレイヤーで使う
export function pageBoxStyle(box: BBox, canvas: CanvasSize): Record<string, string> {
  return {
    left: `${box.x / (canvas.w / 100)}%`,
    top: `${box.y / (canvas.h / 100)}%`,
    width: `${box.w / (canvas.w / 100)}%`,
    height: `${box.h / (canvas.h / 100)}%`,
  };
}

// エレメントレイヤーをパネル形状でクロップし、パネル内描画と同じ見た目（はみ出しなし）を保つ
export function layerClipStyle(panel: Panel, canvas: CanvasSize): Record<string, string> {
  if (panel.shape.type === 'rect') {
    const { x, y, w, h } = panel.shape;
    return { clipPath: `inset(${y / (canvas.h / 100)}% ${(canvas.w - x - w) / (canvas.w / 100)}% ${(canvas.h - y - h) / (canvas.h / 100)}% ${x / (canvas.w / 100)}%)` };
  }
  const points = panel.shape.points.map(([x, y]) => `${x / (canvas.w / 100)}% ${y / (canvas.h / 100)}%`).join(',');
  return { clipPath: `polygon(${points})` };
}

export function elementPanelClipStyle(panel:Panel,box:BBox):Record<string,string>{
  return {clipPath:`polygon(${panelShapePoints(panel).map(([x,y])=>`${(x-box.x)/box.w*100}% ${(y-box.y)/box.h*100}%`).join(',')})`};
}

export function resolveCanvasProps(props: MangaCanvasProps) {
  const {
    zoomTool=false, textTool=false, textToolStyle={fontSize:12,orientation:'vertical'},
    textSettingsOwner=true, painting=false, dpi = 600, imageAssets = [], fontFamilies=[],
    onSelectElement:onSelectNativeElement,
  } = props;
  return { ...props, zoomTool, textTool, textToolStyle, textSettingsOwner, painting, dpi, imageAssets, fontFamilies,
    onSelectNativeElement };
}

export type CanvasProps = ReturnType<typeof resolveCanvasProps>;
