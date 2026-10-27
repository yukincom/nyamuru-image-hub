import CanvasContentSelection, { elementContentBox, elementContentHit } from './CanvasContentSelection';
import { frameFromContentEdit } from '../lib/canvasContentGeometry';
import {artworkLocked,paintOwnerPlacementLocked} from '../lib/paintLock';
import { pixelZoomWidth, canvasZoomPercent, clampCanvasZoom, canvasZoomShortcut } from '../lib/canvasZoom';
import type { CanvasTextTarget } from '../lib/canvasText';
import {textStyleOf,selectedTextWeight,textStyleCss,textWeightSegments,canvasLengthCss,textToolCursor,type TextStylePatch,type TextSelection} from '../lib/textStyle';
import type {TextStyle,TextWeightRange} from '../types';
import {BUBBLE_MATERIAL_DRAG_TYPE,materialBubbleBezier} from '../lib/bubblePresetData';
import CanvasTextToolbar from './CanvasTextToolbar';
import { scenarioBubbleNeedsReview } from '../lib/scenario';
import NativeTextEditor from './NativeTextEditor';
import { bubbleVisible, panelGeometryLocked, panelLocked, panelVisible, panelFrameVisible, panelFrameSegmentsOnInnerFrame, panelArtKeys, type BubbleTextTarget } from '../lib/panelLayers';
import { BubblePathToolContext, PaintGeometryContext, PaintInputActivityContext, usePaintWorkspace } from '../lib/paintWorkspace';
import PaintInputSurface, { PaintOwnerPreview } from './PaintSceneView';
import { paintReferenceBox } from '../lib/paintDocument';
import { artworkPixelSize, copyArtworkSize } from '../lib/artworkClipboard';
import PlacedImageView from './PlacedImageView';
import { figureArtwork, resizeImageBox } from '../lib/imagePlacement';
import type { ImageAsset, PlacedImage } from '../types';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { VNode } from 'preact';
import { Box, UserRound, ZoomIn, ZoomOut } from 'lucide-preact';
import BubbleShapeSvg from './BubbleShapeSvg';
import { BubbleBezierHandles } from './BubbleBezierEditor';
import FigureSizeSvg from './FigureSizeSvg';
import type { BBox, Bubble, BubbleTailRoot, BubbleTailTarget, BubbleTextPosition, CanvasElementSelection, Figure, MangaPage, Panel, PersistentAnalogAssetRef } from '../types';
import { innerFrameBounds, type CanvasSize, anchorPoint, clamp, clampedPanelDelta, createShiftAxisSession, fallbackBox, panelBounds, pointInPanel, panelShapePoints, resizedBox, resolveOverlapClick, resolveShiftAxisSession, resolveVertexDragStartZone, roundMm, snapEdgeDeltaToInnerFrame, snapPanelDeltaToInnerFrame, snapPanelEdgeDeltaToGutter, snapPanelEdgeDeltaToNeighbor, snapPanelResizeToInnerFrame, snapPanelVertexPointToGutter, snapPointToInnerFrame, type DragAxis, type InteractionGeometry, type PanelEdgeReference, type PanelGutterSettings, type ResizeHandle } from '../lib/canvasGeometry';
import { loadFigureCropAsset } from '../lib/figureCropStore';
import { bubbleCssFontFamily, type PcFontFamily } from '../lib/bubbleFonts';
import { resolveBubbleSpeakerFigureIndex } from '../lib/bubbleRelations';
import { isPropPlacement } from '../lib/catalogModel.ts';
import { DETECTED_FIGURE_NAME } from '../lib/systemCharacters.ts';
import { bubbleJoinGeometry, bubbleTailComposite, bubbleTailDisabled, bubbleTailGeometry, bubbleTailTargetPoint, monologueTailEllipses, normalizedBubbleTailRoot, normalizedBubbleTailTarget, type BubbleSeamMask, type BubbleTailComposite } from '../lib/bubbleTail.ts';
import { bubbleUsesMonologueTail } from '../lib/bubblePresentation.ts';
import { bubbleTextFrame, bubbleTextPosition, compatibleBubbleClips } from '../lib/bubbleClip.ts';
import { overlayFallbackBox as pageOverlayFallbackBox,overlayTextFallbackBox } from '../lib/pageCanvas.ts';
import { figureDisplayLabel, panelDisplayLabel } from '../lib/displayLabels.ts';
import { createBubbleBezier, isBubbleBezier, type BubbleBezier } from '../lib/bubbleBezier.ts';

interface Props {
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

function bubbleOutlineForDirectEdit(bubble: Bubble): BubbleBezier {
  const current = bubble.bezier ?? materialBubbleBezier(bubble.shape);
  if (isBubbleBezier(current)) return current;
  if (bubble.shape === 'square' || bubble.shape === 'caption') return createBubbleBezier('rounded');
  if (bubble.shape === 'flash' || bubble.shape === 'uniflash' || bubble.shape === 'toge' || bubble.shape === 'toge_natural') return createBubbleBezier('burst');
  if (bubble.shape === 'thought') return createBubbleBezier('cloud');
  return createBubbleBezier('ellipse');
}

interface Interaction extends InteractionGeometry {
  selection: CanvasElementSelection;
  paperRect: DOMRect;
}

function panelStyle(panel: Panel, canvas: CanvasSize): Record<string, string | number> {
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
function FigureName({ name, boxW, boxH, fitEpoch }: { name: string; boxW: number; boxH: number; fitEpoch: number }) {
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

function figureCanvasClass(figure: Figure): string {
  if(isPropPlacement(figure))return 'is-object';
  if(figure.analogImport?.analysisReview)return 'is-analysis-review';
  return !figure.refId || figure.name.normalize('NFKC').trim() === DETECTED_FIGURE_NAME
    ?'is-unassigned':'is-confirmed-person';
}

function StoredCropImage({ assetId, persistentAsset, className }: { assetId: string; persistentAsset?: PersistentAnalogAssetRef; className: string }) {
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
export function BubbleText({ text, font, shape, lengthClass, boxW, boxH, fitEpoch, position={x:.5,y:.5}, style, weights, paperWidth=210, review=false, onEdit, onMoveFrame, moveFrameActive=false }: { text: string; font: string; shape?: string; lengthClass: string; boxW: number; boxH: number; fitEpoch: number; position?:BubbleTextPosition;style?:TextStyle;weights?:TextWeightRange[];paperWidth?:number;review?:boolean;onEdit?:()=>void;onMoveFrame?:(event:PointerEvent)=>void;moveFrameActive?:boolean }) {
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
  }, [text, font, shape, lengthClass, boxW, boxH, fitEpoch, position.x, position.y, style, weights]);
  const interactive=Boolean(onEdit);
  return <span ref={ref} class={`vertical-text bubble-text ${lengthClass} has-fixed-text-size ${review?'is-text-review':''} ${interactive?'is-interactive':''} ${onMoveFrame?'has-move-frame':''}`} data-review={review||undefined} title={review?'このセリフ本文は読取結果の確認が必要です。文字を編集すると通常色へ戻ります。':undefined} style={{ fontFamily: bubbleCssFontFamily(font),...textStyleCss({...style,fontSize:style?.fontSize??15},paperWidth,font) }}>
    <span class="bubble-text-content"
      onPointerDown={interactive?event=>event.stopPropagation():undefined}
      onClick={interactive?event=>{event.stopPropagation();onEdit?.();}:undefined}
      >
      {weights?.length?textWeightSegments({text,text_weights:weights}).map((part,i)=><span key={i} style={part.fontWeight?{fontWeight:part.fontWeight}:undefined}>{part.text}</span>):text}
    </span>
    {onMoveFrame&&<span class={`bubble-text-move-frame ${moveFrameActive?'is-active':''}`} aria-label="本文をドラッグして移動" onPointerDown={event=>{event.stopPropagation();onMoveFrame(event);}}>
      {(['top','right','bottom','left'] as const).map(side=><span class={`bubble-text-move-edge is-${side}`} key={side}/>)}
    </span>}
  </span>;
}

function bboxStyle(box: BBox, panel: Panel): Record<string, string> {
  const bounds = panelBounds(panel);
  return {
    left: `${((box.x - bounds.x) / bounds.w) * 100}%`,
    top: `${((box.y - bounds.y) / bounds.h) * 100}%`,
    width: `${(box.w / bounds.w) * 100}%`,
    height: `${(box.h / bounds.h) * 100}%`,
  };
}

// 紙面の実寸基準の配置。選択中パネルのエレメントレイヤーで使う
function pageBoxStyle(box: BBox, canvas: CanvasSize): Record<string, string> {
  return {
    left: `${box.x / (canvas.w / 100)}%`,
    top: `${box.y / (canvas.h / 100)}%`,
    width: `${box.w / (canvas.w / 100)}%`,
    height: `${box.h / (canvas.h / 100)}%`,
  };
}

// エレメントレイヤーをパネル形状でクロップし、パネル内描画と同じ見た目（はみ出しなし）を保つ
function layerClipStyle(panel: Panel, canvas: CanvasSize): Record<string, string> {
  if (panel.shape.type === 'rect') {
    const { x, y, w, h } = panel.shape;
    return { clipPath: `inset(${y / (canvas.h / 100)}% ${(canvas.w - x - w) / (canvas.w / 100)}% ${(canvas.h - y - h) / (canvas.h / 100)}% ${x / (canvas.w / 100)}%)` };
  }
  const points = panel.shape.points.map(([x, y]) => `${x / (canvas.w / 100)}% ${y / (canvas.h / 100)}%`).join(',');
  return { clipPath: `polygon(${points})` };
}

function elementPanelClipStyle(panel:Panel,box:BBox):Record<string,string>{
  return {clipPath:`polygon(${panelShapePoints(panel).map(([x,y])=>`${(x-box.x)/box.w*100}% ${(y-box.y)/box.h*100}%`).join(',')})`};
}

export default function MangaCanvas({ zoomTool=false, textTool=false,textToolStyle={fontSize:12,orientation:'vertical'},onTextToolStyle,textSettingsOwner=true,pageIndex,onTextStyle,onBubbleMaterial,editingText,onEditScreenText,onEditBubble,onCreateScreenTextAt,onWrapScreenText,onFinishElementMove,onText,onTextHistory,onEndTextEdit,painting=false, paintTarget, guideVisible, onToggleGuide, onGenerateArtwork, onGenerateComposition, dpi = 600, outputSize, spreadSide, onNotify, onReplaceArtwork, imageAssets = [], onImageGesture, author, page, zoomPercent, onZoomPercentChange, frameLineWidthMm, bubbleLineWidthMm, defaultBubbleFont,fontFamilies=[],onRequestFonts, activePanel, selectedPanels, selectedElement, showGuides, innerFrameSnap, panelGutters, panelGapSnap, panelSync, onSelectPanel, onSelectElement:onSelectNativeElement, onChangeElementBBox, onChangeBubbleTail, onMovePanel, onResizePanel, onMoveVertex, onMovePanelEdge }: Props) {
  const bubblePathTool=useContext(BubblePathToolContext);
  const paintGeometry=useContext(PaintGeometryContext);
  const paintInputActive=useContext(PaintInputActivityContext);
  const paintWorkspace=usePaintWorkspace();
  const backgroundEdit=paintTarget&&!paintTarget.overlay&&paintWorkspace?.page===page.page&&paintWorkspace.panelIndex===paintTarget.panelIndex?paintWorkspace.background3d:undefined;
  const elementLocked=(selection:CanvasElementSelection,panelIndex=activePanel)=>{
    const enclosingPanel=selection.scope==='page_overlay'||selection.scope==='page'?undefined:page.panels[panelIndex];
    if(enclosingPanel&&panelLocked(enclosingPanel))return true;
    if(selection.type==='image')return artworkLocked((selection.scope==='page'?page.images:page.panels[panelIndex]?.images)?.[selection.index]);
    const target=selection.scope==='page_overlay'?page.page_overlay:page.panels[panelIndex];
    if(selection.type==='screen_text')return false;
    const preview=paintTarget&&paintTarget.overlay===(selection.scope==='page_overlay')&&(paintTarget.overlay||paintTarget.panelIndex===panelIndex)?paintWorkspace?.scene.owners.find(o=>o.key===`${selection.type}-${selection.index}`):undefined;
    if(preview)return paintOwnerPlacementLocked(preview);
    if(selection.type==='figure'){const figure=target?.figures?.[selection.index];return Boolean(figure?.locked)||artworkLocked(figure?.artwork);}
    const bubble=target?.bubbles?.[selection.index];return Boolean(bubble?.locked||bubble?.paint_overlay?.locked)||(!textTool&&artworkLocked(bubble?.paint_overlay));
  };
  const onSelectElement=(selection:CanvasElementSelection|null,panelIndex?:number,revealDetails=true)=>{
    if(selection&&elementLocked(selection,panelIndex))return;
    if(backgroundEdit){
      if(selection&&(panelIndex===undefined||panelIndex===paintTarget?.panelIndex)&&selection.scope!=='page_overlay'&&(selection.type==='figure'||selection.type==='bubble'))backgroundEdit.select(`${selection.type}-${selection.index}`);
      return;
    }
    onSelectNativeElement(selection,panelIndex,revealDetails);
  };
  const previewOwner=(key:string,index:number,overlay=false)=>paintTarget&&paintTarget.overlay===overlay&&(overlay||paintTarget.panelIndex===index)?paintGeometry?.owners.find(o=>o.key===key):undefined;
  const nativeBox=(item:Figure|Bubble,box:BBox,key:string,index:number,overlay=false)=>{
    const preview=previewOwner(key,index,overlay);
    const content='name' in item?item.artwork:item.paint_overlay;
    return paintReferenceBox(preview?.paint??content?.paint,preview?.frame??box,preview?undefined:content?.crop);
  };
  const nativeStyle=(box:BBox,reference:BBox)=>({left:`${(reference.x-box.x)/box.w*100}%`,top:`${(reference.y-box.y)/box.h*100}%`,width:`${reference.w/box.w*100}%`,height:`${reference.h/box.h*100}%`});
  const canvas = page.canvas;
  const editingPanel=(index:number)=>Boolean(paintTarget&&!paintTarget.overlay&&paintTarget.panelIndex===index);
  const editingOverlay=Boolean(paintTarget?.overlay);
  const inner = innerFrameBounds(canvas);
  const panelMinSize = Math.min(20, canvas.w / 4, canvas.h / 4);
  const paperBoxStyle = (box: BBox) => pageBoxStyle(box, canvas);
  const paperRef = useRef<HTMLDivElement>(null);
  const paperZoomFrameRef = useRef<HTMLDivElement>(null);
  const [domSpreadSide,setDomSpreadSide]=useState<'left'|'right'|undefined>();
  useLayoutEffect(()=>{
    const pane=paperRef.current?.closest('.spread-pane');
    const next=pane?(pane.matches(':first-child')?'left':'right'):undefined;
    setDomSpreadSide(current=>current===next?current:next);
  });
  const effectiveSpreadSide=spreadSide??domSpreadSide;
  const scrollRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [interactionMode, setInteractionMode] = useState<ResizeHandle | 'panel' | 'panel-resize' | 'panel-edge' | 'bubble-tail' | 'bubble-text' | null>(null);
  const [activeEdgeIndex, setActiveEdgeIndex] = useState<number | null>(null);
  // Display layout follows zoom; persisted pt/mm and document geometry never change.
  const [fitEpoch, setFitEpoch] = useState(0);
  const basePaperWidth = useRef(0);
  const layoutPaperWidth = useRef(0);
  // SVG editing chrome uses screen pixels, independently of artwork zoom and DPI.
  const screenUnit=canvas.w/Math.max(1,layoutPaperWidth.current||canvas.w);
  const [fitPercent,setFitPercent] = useState(100);
  const outputWidth=Math.round((outputSize?.width_mm??canvas.w)*dpi/25.4);
  const outputHeight=Math.round((outputSize?.height_mm??canvas.h)*dpi/25.4);
  const bleedMm=Math.max(0,Math.min(Number(outputSize?.bleed_mm)||0,Math.min(canvas.w,canvas.h)/2));
  const cropMarks=outputSize?.crop_marks===true;
  const cropMarkMarginMm=cropMarks?Math.max(8,Math.min(canvas.w,canvas.h)*.035):0;
  const printMarginMm=bleedMm+cropMarkMarginMm;
  const printGuideWidthMm=effectiveSpreadSide==='left'?canvas.w*2:canvas.w;
  const renderPrintGuides=!effectiveSpreadSide||effectiveSpreadSide==='left';
  const printGuideStyle=printMarginMm>0?{
    left:`${-printMarginMm/canvas.w*100}%`,top:`${-printMarginMm/canvas.h*100}%`,
    width:`${(printGuideWidthMm+printMarginMm*2)/canvas.w*100}%`,height:`${(canvas.h+printMarginMm*2)/canvas.h*100}%`,
  }:undefined;
  const cropMarkPath=cropMarks?(()=>{
    const b=bleedMm,m=printMarginMm,w=printGuideWidthMm,h=canvas.h,c=Math.max(3,Math.min(6,cropMarkMarginMm*.55));
    const pageCenters=effectiveSpreadSide==='left'?[canvas.w/2,canvas.w*1.5]:[w/2];
    return [
      `M${-m} ${-b}H${-b} M${-m} 0H0 M${-b} ${-m}V${-b} M0 ${-m}V0`,
      `M${w+b} ${-b}H${w+m} M${w} 0H${w+m} M${w+b} ${-m}V${-b} M${w} ${-m}V0`,
      `M${-m} ${h+b}H${-b} M${-m} ${h}H0 M${-b} ${h+b}V${h+m} M0 ${h}V${h+m}`,
      `M${w+b} ${h+b}H${w+m} M${w} ${h}H${w+m} M${w+b} ${h+b}V${h+m} M${w} ${h}V${h+m}`,
      ...pageCenters.flatMap(x=>[
        `M${x} ${-m}V${-b} M${x-c} ${-(m+b)/2}H${x+c}`,
        `M${x} ${h+b}V${h+m} M${x-c} ${h+(m+b)/2}H${x+c}`,
      ]),
      ...(effectiveSpreadSide==='left'?[
        `M${canvas.w-b} ${-m}V${-b} M${canvas.w} ${-m}V0 M${canvas.w+b} ${-m}V${-b}`,
        `M${canvas.w-b} ${h+b}V${h+m} M${canvas.w} ${h}V${h+m} M${canvas.w+b} ${h+b}V${h+m}`,
      ]:[]),
      `M${-m} ${h/2}H${-b} M${-(m+b)/2} ${h/2-c}V${h/2+c}`,
      `M${w+b} ${h/2}H${w+m} M${w+(m+b)/2} ${h/2-c}V${h/2+c}`,
    ].join(' ');
  })():'';
  const zoomPercentRef = useRef(zoomPercent);
  const spacePressedRef = useRef(false);
  const [generationMenu, setGenerationMenu] = useState<{ x: number; y: number; panelIndex: number; figureIndex?: number; bubbleIndex?:number; overlay?: boolean } | null>(null);
  const generationMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setGenerationMenu(null); }, [page]);
  useEffect(() => { generationMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [generationMenu]);
  const openGenerationMenu = (event: MouseEvent | KeyboardEvent, panelIndex: number, figureIndex?: number, isOverlay = false, bubbleIndex?:number) => {
    event.preventDefault(); event.stopPropagation();
    if(backgroundEdit)return;
    const rect = (event.currentTarget as Element).getBoundingClientRect();
    const x = 'clientX' in event && event.clientX ? event.clientX : rect.left;
    const y = 'clientY' in event && event.clientY ? event.clientY : rect.bottom;
    setGenerationMenu({ x, y, panelIndex, figureIndex, bubbleIndex, overlay: isOverlay });
    // The passive facing-page canvas must stay mounted until an action is chosen.
    if (activePanel >= 0&&panelIndex>=0&&!painting) {
      if(bubbleIndex!==undefined)onSelectElement({type:'bubble',index:bubbleIndex,...(isOverlay?{scope:'page_overlay' as const}:{})},isOverlay?undefined:panelIndex);
      else if (figureIndex === undefined) onSelectPanel(panelIndex);
      else onSelectElement({ type: 'figure', index: figureIndex, ...(isOverlay ? { scope: 'page_overlay' as const } : {}) }, isOverlay ? undefined : panelIndex);
    }
  };
  const menuPanel = generationMenu ? page.panels[generationMenu.panelIndex] : undefined;
  const menuFigure = generationMenu?.figureIndex !== undefined
    ? (generationMenu.overlay ? page.page_overlay?.figures : menuPanel?.figures)?.[generationMenu.figureIndex] : undefined;
  const menuBubble=generationMenu?.bubbleIndex!==undefined?(generationMenu.overlay?page.page_overlay?.bubbles:menuPanel?.bubbles)?.[generationMenu.bubbleIndex]:undefined;
  const menuKey=generationMenu?.figureIndex!==undefined?`figure-${generationMenu.figureIndex}`:generationMenu?.bubbleIndex!==undefined?`bubble-${generationMenu.bubbleIndex}`:'background';
  const menuBox=generationMenu?menuFigure?(menuFigure.bbox??(generationMenu.overlay?pageOverlayFallbackBox(canvas,'figure',generationMenu.figureIndex!):fallbackBox(menuPanel!,'figure',generationMenu.figureIndex!))):menuBubble?(menuBubble.bbox??(generationMenu.overlay?pageOverlayFallbackBox(canvas,'bubble',generationMenu.bubbleIndex!):fallbackBox(menuPanel!,'bubble',generationMenu.bubbleIndex!))):menuPanel?panelBounds(menuPanel):undefined:undefined;
  const menuScope=generationMenu?.panelIndex===-1?'page':!menuFigure&&!menuBubble?'panel':undefined;
  const menuSize = menuBox ? artworkPixelSize(menuBox, dpi) : undefined;
  const copyMenuSize = () => {
    if (!menuBox || !menuSize) return;
    void copyArtworkSize(menuBox, dpi).then(() => onNotify?.(`${menuSize.width} × ${menuSize.height} px をサイズコピーしました。ペイントツールの「クリップボードから新規作成」で開けます`))
      .catch(error => onNotify?.(error instanceof Error ? error.message : 'サイズをコピーできませんでした'));
    setGenerationMenu(null);
  };


  useEffect(() => () => cleanupRef.current?.(), []);

  const spreadScrollFor = () => scrollRef.current?.closest<HTMLElement>('.canvas-spread-scroll') ?? null;

  const setPaperVisualWidth = (targetPaper:HTMLElement,targetWidth:number,baseWidth:number) => {
    const frame=targetPaper.closest<HTMLElement>('.manga-paper-zoom-frame');
    if(!frame||!(targetWidth>0)||!(baseWidth>0))return;
    // Layout at screen size: an ancestor scale also shrinks native carets and UI strokes.
    // Output pixels remain the 100% reference, not the DOM's fixed rasterization size.
    targetPaper.style.width=`${targetWidth}px`;
    targetPaper.style.setProperty('--canvas-layout-width',`${targetWidth}px`);
    targetPaper.style.height='auto';
    targetPaper.style.transform='none';
    targetPaper.dataset.paperZoomScale=String(targetWidth/baseWidth);
    frame.style.width=`${targetWidth}px`;
    frame.style.height=`${targetPaper.getBoundingClientRect().height}px`;
    if(targetPaper===paperRef.current&&Math.abs(layoutPaperWidth.current-targetWidth)>.1){
      layoutPaperWidth.current=targetWidth;setFitEpoch(value=>value+1);
    }
  };

  const applyPaperWidth = (targetWidth: number, centerX?: number, centerY?: number) => {
    const scroll = scrollRef.current, paper = paperRef.current;
    if (!scroll || !paper || targetWidth <= 0) return;
    const rect = paper.getBoundingClientRect();
    const spreadScroll = spreadScrollFor();
    const spreadStage = spreadScroll?.querySelector<HTMLElement>('.canvas-spread-stage');
    if (spreadScroll && spreadStage) {
      const sourceBase = basePaperWidth.current || rect.width / Math.max(.01, (zoomPercentRef.current??fitPercent) / 100);
      const targetRatio = targetWidth / Math.max(1, sourceBase);
      const papers = Array.from(spreadStage.querySelectorAll<HTMLElement>('.manga-paper'));
      const targets = papers.map((targetPaper) => {
        const base = Number(targetPaper.dataset.basePaperWidth) || sourceBase;
        return { targetPaper, width: base * targetRatio };
      });
      if (targets.every(({ targetPaper, width }) => Math.abs(targetPaper.getBoundingClientRect().width - width) < .1)) return;
      const scrollRect = spreadScroll.getBoundingClientRect();
      const stageBefore = spreadStage.getBoundingClientRect();
      const midX = centerX ?? scrollRect.left + scrollRect.width / 2;
      const midY = centerY ?? scrollRect.top + scrollRect.height / 2;
      const ratioX = clamp((midX - stageBefore.left) / Math.max(1, stageBefore.width), 0, 1);
      const ratioY = clamp((midY - stageBefore.top) / Math.max(1, stageBefore.height), 0, 1);
      targets.forEach(({ targetPaper, width }) => {
        const base=Number(targetPaper.dataset.basePaperWidth)||sourceBase;
        setPaperVisualWidth(targetPaper,width,base);
      });
      const stageAfter = spreadStage.getBoundingClientRect();
      spreadScroll.scrollLeft += stageAfter.left + stageAfter.width * ratioX - midX;
      spreadScroll.scrollTop += stageAfter.top + stageAfter.height * ratioY - midY;
      return;
    }
    if (Math.abs(rect.width - targetWidth) < 0.1) return;
    const scrollRect = scroll.getBoundingClientRect();
    const midX = centerX ?? scrollRect.left + scrollRect.width / 2;
    const midY = centerY ?? scrollRect.top + scrollRect.height / 2;
    const ratioX=clamp((midX-rect.left)/Math.max(1,rect.width),0,1);
    const ratioY=clamp((midY-rect.top)/Math.max(1,rect.height),0,1);
    const base=basePaperWidth.current||Number(paper.dataset.basePaperWidth)||paper.clientWidth||rect.width;
    setPaperVisualWidth(paper,targetWidth,base);
    const next=paper.getBoundingClientRect();
    scroll.scrollLeft+=next.left+next.width*ratioX-midX;
    scroll.scrollTop+=next.top+next.height*ratioY-midY;
  };

  // Fit is a separate mode; 100% always uses the output pixels and display DPR.
  const fitPaper = () => {
    const scroll = scrollRef.current, paper = paperRef.current;
    if (!scroll || !paper) return;
    const spreadScroll = spreadScrollFor();
    const spreadStage = spreadScroll?.querySelector<HTMLElement>('.canvas-spread-stage');
    const sizingSurface = spreadScroll ?? scroll;
    const styles = getComputedStyle(spreadStage ?? scroll);
    const visiblePageCount = spreadStage
      ? Math.max(1, Array.from(spreadStage.querySelectorAll<HTMLElement>('.spread-pane')).filter((pane) => getComputedStyle(pane).display !== 'none').length)
      : 1;
    const availW = (sizingSurface.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight)) / visiblePageCount;
    const availH = sizingSurface.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
    if (availW <= 0 || availH <= 0) return;
    const width = Math.min(availW, availH * outputWidth / outputHeight, 760 * outputWidth / outputHeight);
    const base=pixelZoomWidth(outputWidth,window.devicePixelRatio);
    basePaperWidth.current = base;
    paper.dataset.basePaperWidth = String(base);
    setFitPercent(canvasZoomPercent(width,base));
    setPaperVisualWidth(paper,zoomPercentRef.current===null?width:base*zoomPercentRef.current/100,base);
  };

  useEffect(() => {
    fitPaper();
    const scroll = scrollRef.current;
    if (!scroll) return;
    const sizingSurface = spreadScrollFor() ?? scroll;
    const observer = new ResizeObserver(() => fitPaper());
    observer.observe(sizingSurface);
    window.addEventListener('resize',fitPaper);
    return () => { observer.disconnect();window.removeEventListener('resize',fitPaper); };
  }, [canvas.w, canvas.h, outputWidth, outputHeight]);

  // 片方のページで変更された共有倍率を、もう片方にも同じタイミングで適用する。
  useLayoutEffect(() => {
    zoomPercentRef.current = zoomPercent;
    if (zoomPercent===null || !basePaperWidth.current) {
      fitPaper();
      return;
    }
    const paper = paperRef.current;
    if (paper) setPaperVisualWidth(paper,basePaperWidth.current * zoomPercent / 100,basePaperWidth.current);
  }, [zoomPercent]);

  const zoomAt = (factor: number, centerX?: number, centerY?: number) => {
    const scroll = scrollRef.current, paper = paperRef.current;
    if (!scroll || !paper) return;
    const rect = paper.getBoundingClientRect();
    const base = basePaperWidth.current || rect.width;
    const nextPercent = clampCanvasZoom(canvasZoomPercent(rect.width * factor,base));
    applyPaperWidth(base * nextPercent / 100, centerX, centerY);
    zoomPercentRef.current = nextPercent;
    onZoomPercentChange(nextPercent);
  };

  const resetZoom = () => {
    zoomPercentRef.current = 100;
    onZoomPercentChange(100);
    if (basePaperWidth.current) applyPaperWidth(basePaperWidth.current);
  };

  useEffect(()=>{
    const keydown=(event:KeyboardEvent)=>{
      const scroll=scrollRef.current;
      if(event.defaultPrevented||!scroll||scroll.closest('.is-spread-partner'))return;
      const editing=event.target instanceof Element&&Boolean(event.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"]'));
      const factor=canvasZoomShortcut(event,editing);if(factor===undefined)return;
      event.preventDefault();event.stopPropagation();
      if(!paintInputActive?.current)zoomAt(factor);
    };
    window.addEventListener('keydown',keydown,true);
    return()=>window.removeEventListener('keydown',keydown,true);
  });

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const zoomSurface = spreadScrollFor() ?? scroll;
    const wheelSurface = scroll.closest<HTMLElement>('.canvas-stage') ?? zoomSurface;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; width: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      if(event.target instanceof Element&&event.target.closest('.background3d-window'))return;
      if (paintInputActive?.current) { pointers.clear(); pinch=null; return; }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size !== 2) return;
      cleanupRef.current?.();
      const paper = paperRef.current;
      if (!paper) return;
      const rect = paper.getBoundingClientRect();
      const [a, b] = [...pointers.values()];
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        width: rect.width,
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (paintInputActive?.current) { pointers.clear(); pinch=null; return; }
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const paper = paperRef.current;
      if (!pinch || pointers.size < 2 || !paper) return;
      const [a, b] = [...pointers.values()];
      const base = basePaperWidth.current || pinch.width;
      const target = base*clampCanvasZoom(canvasZoomPercent(pinch.width * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist),base))/100;
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      applyPaperWidth(target, midX, midY);
    };
    const onPointerEnd = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pinch && pointers.size < 2) {
        pinch = null;
        const paper = paperRef.current;
        if (paper && basePaperWidth.current) {
          const nextPercent = canvasZoomPercent(paper.getBoundingClientRect().width,basePaperWidth.current);
          zoomPercentRef.current = nextPercent;
          onZoomPercentChange(nextPercent);
        }
      }
    };
    // 2本指の間はネイティブのパン/ズームを止めて自前のピンチに専念させる
    const onTouchMove = (event: TouchEvent) => { if (event.touches.length >= 2) event.preventDefault(); };
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || scroll.closest('.is-spread-partner')) return;
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],.background3d-window')) return;
      if (paintInputActive?.current) { event.preventDefault(); return; }
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY);
    };
    scroll.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerup', onPointerEnd, { capture: true });
    window.addEventListener('pointercancel', onPointerEnd, { capture: true });
    scroll.addEventListener('touchmove', onTouchMove, { passive: false });
    wheelSurface.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      scroll.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerEnd, { capture: true });
      window.removeEventListener('pointercancel', onPointerEnd, { capture: true });
      scroll.removeEventListener('touchmove', onTouchMove);
      wheelSurface.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const spreadScroll=spreadScrollFor();
    const spreadPartner=Boolean(scroll.closest('.is-spread-partner'));
    const panSurface=spreadScroll&&!spreadPartner?spreadScroll:scroll;
    let finishPan: (() => void) | null = null;

    const isTextEditing = (target: EventTarget | null) => target instanceof Element
      && Boolean(target.closest('input, textarea, select, button, a, summary, [contenteditable="true"], [role="dialog"], [role="menu"]'));
    const stopPan = () => {
      finishPan?.();
      finishPan = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (spreadPartner||event.code !== 'Space' || isTextEditing(event.target)) return;
      event.preventDefault();
      spacePressedRef.current = true;
      document.body.classList.add('is-canvas-space-pan-ready');
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (spreadPartner||event.code !== 'Space' || (!spacePressedRef.current && isTextEditing(event.target))) return;
      event.preventDefault();
      spacePressedRef.current = false;
      stopPan();
      document.body.classList.remove('is-canvas-space-pan-ready');
    };
    const onBlur = () => {
      spacePressedRef.current = false;
      stopPan();
      document.body.classList.remove('is-canvas-space-pan-ready');
    };
    const onPanPointerDown = (event: PointerEvent) => {
      if(event.target instanceof Element&&event.target.closest('.background3d-window'))return;
      if (paintInputActive?.current) return;
      if (!spacePressedRef.current || event.button !== 0 || event.pointerType === 'touch') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cleanupRef.current?.();

      const targets = [spreadScroll ?? scroll];
      const starts = targets.map((target) => ({ target, left: target.scrollLeft, top: target.scrollTop }));
      const startX = event.clientX;
      const startY = event.clientY;
      document.body.classList.add('is-canvas-space-panning');

      const move = (pointerEvent: PointerEvent) => {
        pointerEvent.preventDefault();
        const deltaX = pointerEvent.clientX - startX;
        const deltaY = pointerEvent.clientY - startY;
        starts.forEach(({ target, left, top }) => {
          target.scrollLeft = left - deltaX;
          target.scrollTop = top - deltaY;
        });
      };
      const finish = () => {
        window.removeEventListener('pointermove', move, { capture: true });
        window.removeEventListener('pointerup', finish, { capture: true });
        window.removeEventListener('pointercancel', finish, { capture: true });
        document.body.classList.remove('is-canvas-space-panning');
        cleanupRef.current = null;
        finishPan = null;
      };
      finishPan = finish;
      cleanupRef.current = finish;
      window.addEventListener('pointermove', move, { capture: true });
      window.addEventListener('pointerup', finish, { capture: true });
      window.addEventListener('pointercancel', finish, { capture: true });
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', onBlur);
    panSurface.addEventListener('pointerdown', onPanPointerDown, { capture: true });
    return () => {
      stopPan();
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', onBlur);
      panSurface.removeEventListener('pointerdown', onPanPointerDown, { capture: true });
      document.body.classList.remove('is-canvas-space-pan-ready', 'is-canvas-space-panning');
    };
  }, []);

  useEffect(()=>{
    const scroll=scrollRef.current;if(!zoomTool||!scroll)return;
    // The existing pinch and Space-pan capture handlers run first.
    const down=(event:PointerEvent)=>{
      if(event.target instanceof Element&&event.target.closest('.background3d-window'))return;
      if(spacePressedRef.current||event.button!==0)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.pointerType!=='touch')zoomAt(event.altKey?1/1.25:1.25,event.clientX,event.clientY);
    };
    const click=(event:MouseEvent)=>{if(event.target instanceof Element&&event.target.closest('.background3d-window'))return;event.preventDefault();event.stopImmediatePropagation();};
    scroll.addEventListener('pointerdown',down,{capture:true,passive:false});scroll.addEventListener('click',click,true);scroll.addEventListener('dblclick',click,true);
    return()=>{scroll.removeEventListener('pointerdown',down,true);scroll.removeEventListener('click',click,true);scroll.removeEventListener('dblclick',click,true);};
  },[zoomTool]);

  const startInteraction = (
    event: PointerEvent,
    panelIndex: number | null,
    selection: CanvasElementSelection,
    box: BBox,
    mode: ResizeHandle,
    visibleBox?: BBox,
  ) => {
    if (event.button !== 0||elementLocked(selection,panelIndex??activePanel)) return;
    if(backgroundEdit){
      event.preventDefault();event.stopPropagation();
      if(mode!=='move'||panelIndex!==paintTarget?.panelIndex||selection.scope==='page_overlay'||!['figure','bubble'].includes(selection.type)||!paperRef.current)return;
      cleanupRef.current?.();
      if(!backgroundEdit.beginMove(`${selection.type}-${selection.index}`))return;
      const cursorClass='is-canvas-moving';
      document.body.classList.add(cursorClass);
      const paper=paperRef.current.getBoundingClientRect(),x=event.clientX,y=event.clientY;
      const move=(next:PointerEvent)=>{next.preventDefault();backgroundEdit.move((next.clientX-x)*canvas.w/paper.width,(next.clientY-y)*canvas.h/paper.height);};
      const finish=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);window.removeEventListener('blur',finish);document.body.classList.remove(cursorClass);backgroundEdit.endMove();cleanupRef.current=null;};
      cleanupRef.current=finish;window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);window.addEventListener('blur',finish);
      return;
    }
    if(textTool)return;
    if(bubblePathTool==='node'&&mode==='move')return;
    const pageOverlay = selection.scope === 'page_overlay' || selection.scope === 'page';
    if ((!pageOverlay && panelIndex !== activePanel) || !paperRef.current) return;
    const figure = selection.type === 'figure' ? (selection.scope === 'page_overlay' ? overlay?.figures : page.panels[panelIndex!]?.figures)?.[selection.index] : undefined;
    const bubble=selection.type==='bubble'?(pageOverlay?overlay?.bubbles:page.panels[panelIndex!]?.bubbles)?.[selection.index]:undefined;
    const isArtwork = selection.type === 'image' || Boolean(figure?.artwork||bubble?.paint_overlay);
    const preserveAspect = isArtwork || selection.type === 'figure';
    const visible=visibleBox??elementContentBox(event.currentTarget as Element,box);
    event.preventDefault();
    event.stopPropagation();
    onSelectElement(selection, panelIndex ?? undefined, false);
    const interaction: Interaction = {
      canvas, selection, mode, unbounded:true, startClientX: event.clientX, startClientY: event.clientY,
      startBox: { ...visible },
      bounds: {x:0,y:0,w:canvas.w,h:canvas.h},
      paperRect: paperRef.current.getBoundingClientRect(),
    };
    cleanupRef.current?.();
    setInteractionMode(mode);
    const cursorClass=mode==='move'?'is-canvas-moving':`is-canvas-resizing-${mode}`;
    document.body.classList.add(cursorClass);

    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const next=preserveAspect ? resizeImageBox(interaction, pointerEvent.clientX, pointerEvent.clientY) : resizedBox(interaction, pointerEvent.clientX, pointerEvent.clientY);
      onChangeElementBBox(selection,frameFromContentEdit(box,visible,next));
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove(cursorClass);
      setInteractionMode(null);
      cleanupRef.current = null;
      if (isArtwork) onImageGesture?.('end');
      if(mode==='move')onFinishElementMove?.(selection,panelIndex);
    };
    if (isArtwork) onImageGesture?.('start');
    cleanupRef.current = finish;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const startBubbleTailDrag = (
    event: PointerEvent,
    selection: CanvasElementSelection,
    speakerBox: BBox,
  ) => {
    if (!paperRef.current||elementLocked(selection)) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectElement(selection);
    const paperRect = paperRef.current.getBoundingClientRect();
    setInteractionMode('bubble-tail');
    document.body.classList.add('is-bubble-tail-dragging');
    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const point = {
        x: (pointerEvent.clientX - paperRect.left) * (canvas.w / paperRect.width),
        y: (pointerEvent.clientY - paperRect.top) * (canvas.h / paperRect.height),
      };
      onChangeBubbleTail(selection, normalizedBubbleTailTarget(speakerBox, point));
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('is-bubble-tail-dragging');
      setInteractionMode(null);
      cleanupRef.current = null;
    };
    cleanupRef.current?.();
    cleanupRef.current = finish;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const startBubbleTailRootDrag = (event:PointerEvent,selection:CanvasElementSelection,bubbleBox:BBox) => {
    if(!paperRef.current||elementLocked(selection))return;
    event.preventDefault();event.stopPropagation();onSelectElement(selection);
    const paperRect=paperRef.current.getBoundingClientRect();setInteractionMode('bubble-tail');document.body.classList.add('is-bubble-tail-dragging');
    const move=(pointerEvent:PointerEvent)=>{
      pointerEvent.preventDefault();
      const point={x:(pointerEvent.clientX-paperRect.left)*canvas.w/paperRect.width,y:(pointerEvent.clientY-paperRect.top)*canvas.h/paperRect.height};
      onChangeBubbleTail(selection,undefined,{tailRoot:normalizedBubbleTailRoot(bubbleBox,point)});
    };
    const finish=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);document.body.classList.remove('is-bubble-tail-dragging');setInteractionMode(null);cleanupRef.current=null;};
    cleanupRef.current?.();cleanupRef.current=finish;window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);
  };

  const bubbleTextDragged=useRef(false);
  const startBubbleTextDrag = (event:PointerEvent,selection:CanvasElementSelection,bubbleBox:BBox,startPosition:BubbleTextPosition) => {
    if(paintWorkspace||!paperRef.current||elementLocked(selection))return;
    cleanupRef.current?.();
    event.preventDefault();event.stopPropagation();onSelectElement(selection);
    onImageGesture?.('start');
    const paperRect=paperRef.current.getBoundingClientRect(),origin={x:event.clientX,y:event.clientY};setInteractionMode('bubble-text');document.body.classList.add('is-bubble-text-dragging');
    const move=(pointerEvent:PointerEvent)=>{
      pointerEvent.preventDefault();
      const dx=(pointerEvent.clientX-origin.x)*canvas.w/paperRect.width,dy=(pointerEvent.clientY-origin.y)*canvas.h/paperRect.height;
      if(Math.hypot(pointerEvent.clientX-origin.x,pointerEvent.clientY-origin.y)>2)bubbleTextDragged.current=true;
      onChangeBubbleTail(selection,undefined,{textPosition:{x:startPosition.x+dx/bubbleBox.w,y:startPosition.y+dy/bubbleBox.h}});
    };
    const finish=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);document.body.classList.remove('is-bubble-text-dragging');setInteractionMode(null);cleanupRef.current=null;onImageGesture?.('end');};
    cleanupRef.current=finish;window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);
  };

  const nudgeElement = (event: KeyboardEvent, _bounds: BBox, selection: CanvasElementSelection, box: BBox) => {
    if (elementLocked(selection)||!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if(backgroundEdit){
      if(selection.scope==='page_overlay'||(event.currentTarget as HTMLElement).dataset.background3dOwner!==`${selection.type}-${selection.index}`||!['figure','bubble'].includes(selection.type)||!backgroundEdit.beginMove(`${selection.type}-${selection.index}`))return;
      const amount=event.shiftKey?5:1;
      backgroundEdit.move(event.key==='ArrowLeft'?-amount:event.key==='ArrowRight'?amount:0,event.key==='ArrowUp'?-amount:event.key==='ArrowDown'?amount:0);backgroundEdit.endMove();return;
    }
    if(paintWorkspace)return;
    onSelectElement(selection);
    const amount = event.shiftKey ? 5 : 1;
    const visible=elementContentBox(event.currentTarget as Element,box);
    let x = visible.x, y = visible.y;
    if (event.key === 'ArrowLeft') x -= amount;
    if (event.key === 'ArrowRight') x += amount;
    if (event.key === 'ArrowUp') y -= amount;
    if (event.key === 'ArrowDown') y += amount;
    onChangeElementBBox(selection,frameFromContentEdit(box,visible,{...visible,x:roundMm(x),y:roundMm(y)}));
    if(selection.type==='bubble')onFinishElementMove?.(selection,selection.scope==='page_overlay'?null:activePanel);
  };

  const startPanelMove = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (!selectedPanel || panelGeometryLocked(selectedPanel) || !selectedBounds || !paperRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectElement(null);
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const paperRect = paperRef.current.getBoundingClientRect();
    setInteractionMode('panel');
    document.body.classList.add('is-panel-dragging');

    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const rawX = (pointerEvent.clientX - startClientX) * (canvas.w / paperRect.width);
      const rawY = (pointerEvent.clientY - startClientY) * (canvas.h / paperRect.height);
      const delta = innerFrameSnap
        ? snapPanelDeltaToInnerFrame(selectedBounds, rawX, rawY, undefined, canvas, bleedMm)
        : clampedPanelDelta(selectedBounds, rawX, rawY, canvas, bleedMm);
      onMovePanel(activePanel, delta.x, delta.y);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('is-panel-dragging');
      setInteractionMode(null);
      cleanupRef.current = null;
    };
    cleanupRef.current?.();
    cleanupRef.current = finish;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const startPanelResize = (event: PointerEvent, handle: Exclude<ResizeHandle, 'move'>) => {
    if (event.button !== 0) return;
    if (!selectedPanel || panelGeometryLocked(selectedPanel) || !selectedBounds || !paperRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectElement(null);
    const paperRect = paperRef.current.getBoundingClientRect();
    const interaction: InteractionGeometry = {
      mode: handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startBox: { ...selectedBounds },
      canvas, bounds: { x: -bleedMm, y: -bleedMm, w: canvas.w + bleedMm * 2, h: canvas.h + bleedMm * 2 },
      paperRect,
    };
    const bodyClass = `is-panel-resizing-${handle}`;
    setInteractionMode('panel-resize');
    document.body.classList.add(bodyClass);

    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const bounds = resizedBox(interaction, pointerEvent.clientX, pointerEvent.clientY, panelMinSize);
      onResizePanel(activePanel, innerFrameSnap ? snapPanelResizeToInnerFrame(bounds, handle, panelMinSize, undefined, canvas) : bounds);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove(bodyClass);
      setInteractionMode(null);
      cleanupRef.current = null;
    };
    cleanupRef.current?.();
    cleanupRef.current = finish;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const startPanelEdgeDrag = (event: PointerEvent, edgeIndex: number) => {
    if (event.button !== 0) return;
    if (!selectedPanel || panelGeometryLocked(selectedPanel) || !paperRef.current) return;
    const points = panelShapePoints(selectedPanel);
    const start = points[edgeIndex], end = points[(edgeIndex + 1) % points.length];
    if (!start || !end) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectElement(null);
    const startClientX = event.clientX, startClientY = event.clientY;
    const paperRect = paperRef.current.getBoundingClientRect();
    setInteractionMode('panel-edge');
    setActiveEdgeIndex(edgeIndex);
    document.body.classList.add('is-panel-edge-dragging');
    let shiftSession = createShiftAxisSession(event.shiftKey);
    let lastRawX = 0;
    let lastRawY = 0;
    let lastAppliedX = 0;
    let lastAppliedY = 0;
    const updateShiftState = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key !== 'Shift') return;
      const shiftActive = keyboardEvent.type === 'keydown';
      if (shiftSession.shiftActive === shiftActive) return;
      shiftSession = resolveShiftAxisSession(
        lastRawX,
        lastRawY,
        shiftActive,
        shiftSession,
        lastAppliedX,
        lastAppliedY,
      ).state;
    };

    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      let rawDeltaX = (pointerEvent.clientX - startClientX) * (canvas.w / paperRect.width);
      let rawDeltaY = (pointerEvent.clientY - startClientY) * (canvas.h / paperRect.height);
      // 矩形は矩形性を維持するため、辺の法線方向だけを使う。
      if (selectedPanel.shape.type === 'rect') {
        if (edgeIndex === 0 || edgeIndex === 2) rawDeltaX = 0;
        if (edgeIndex === 1 || edgeIndex === 3) rawDeltaY = 0;
      }
      lastRawX = rawDeltaX;
      lastRawY = rawDeltaY;
      const constrained = resolveShiftAxisSession(
        rawDeltaX,
        rawDeltaY,
        pointerEvent.shiftKey,
        shiftSession,
        lastAppliedX,
        lastAppliedY,
      );
      shiftSession = constrained.state;
      let deltaX = constrained.x;
      let deltaY = constrained.y;
      const axis: DragAxis | undefined = constrained.axis;
      const shiftPending = constrained.state.shiftActive && !axis;
      const lockedDeltaX = deltaX;
      const lockedDeltaY = deltaY;
      if (innerFrameSnap && !shiftPending) {
        const snapped = snapEdgeDeltaToInnerFrame(start, end, deltaX, deltaY, undefined, canvas);
        deltaX = snapped.x;
        deltaY = snapped.y;
      }
      if (axis === 'x') deltaY = lockedDeltaY;
      if (axis === 'y') deltaX = lockedDeltaX;
      if (selectedPanel.shape.type === 'rect') {
        if (edgeIndex === 0 || edgeIndex === 2) deltaX = 0;
        if (edgeIndex === 1 || edgeIndex === 3) deltaY = 0;
      }
      let snapTarget: PanelEdgeReference | undefined;
      let snappedToGutter = false;
      if (panelGapSnap && !shiftPending) {
        const snapped = snapPanelEdgeDeltaToGutter(
          page.panels,
          activePanel,
          edgeIndex,
          deltaX,
          deltaY,
          panelGutters,
          undefined,
          axis,
        );
        deltaX = snapped.x;
        deltaY = snapped.y;
        snappedToGutter = snapped.snapped;
      }
      if (panelSync && !shiftPending && !snappedToGutter) {
        const snapped = snapPanelEdgeDeltaToNeighbor(page.panels, activePanel, edgeIndex, deltaX, deltaY);
        deltaX = snapped.x;
        deltaY = snapped.y;
        snapTarget = snapped.target;
      }
      if (axis === 'x') deltaY = lockedDeltaY;
      if (axis === 'y') deltaX = lockedDeltaX;
      const appliedX = roundMm(deltaX);
      const appliedY = roundMm(deltaY);
      lastAppliedX = appliedX;
      lastAppliedY = appliedY;
      onMovePanelEdge(activePanel, edgeIndex, appliedX, appliedY, panelSync, snapTarget);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', updateShiftState);
      window.removeEventListener('keyup', updateShiftState);
      document.body.classList.remove('is-panel-edge-dragging');
      setInteractionMode(null);
      setActiveEdgeIndex(null);
      cleanupRef.current = null;
    };
    cleanupRef.current?.();
    cleanupRef.current = finish;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', updateShiftState);
    window.addEventListener('keyup', updateShiftState);
  };

  const startVertexDrag = (event: PointerEvent, vertexIndex: number) => {
    if (event.button !== 0) return;
    if (!selectedPanel || panelGeometryLocked(selectedPanel) || !paperRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectElement(null);
    const paperRect = paperRef.current.getBoundingClientRect();
    const startPoint = panelShapePoints(selectedPanel)[vertexIndex];
    if (!startPoint) return;
    const [startX, startY] = startPoint;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    setInteractionMode('panel-resize');
    document.body.classList.add('is-panel-dragging');
    let shiftSession = createShiftAxisSession(event.shiftKey);
    let lastRawX = 0;
    let lastRawY = 0;
    let lastAppliedX = 0;
    let lastAppliedY = 0;
    const updateShiftState = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key !== 'Shift') return;
      const shiftActive = keyboardEvent.type === 'keydown';
      if (shiftSession.shiftActive === shiftActive) return;
      shiftSession = resolveShiftAxisSession(
        lastRawX,
        lastRawY,
        shiftActive,
        shiftSession,
        lastAppliedX,
        lastAppliedY,
      ).state;
    };

    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const rawDeltaX = (pointerEvent.clientX - startClientX) * (canvas.w / paperRect.width);
      const rawDeltaY = (pointerEvent.clientY - startClientY) * (canvas.h / paperRect.height);
      lastRawX = rawDeltaX;
      lastRawY = rawDeltaY;
      const constrained = resolveShiftAxisSession(
        rawDeltaX,
        rawDeltaY,
        pointerEvent.shiftKey,
        shiftSession,
        lastAppliedX,
        lastAppliedY,
      );
      shiftSession = constrained.state;
      const axis: DragAxis | undefined = constrained.axis;
      const shiftPending = constrained.state.shiftActive && !axis;
      const lockedX = clamp(roundMm(startX + constrained.x), 0, canvas.w);
      const lockedY = clamp(roundMm(startY + constrained.y), 0, canvas.h);
      const startZone = resolveVertexDragStartZone(lockedX, lockedY, startX, startY, panelGapSnap);
      let point: { x: number; y: number };
      if (startZone.restored) {
        point = { x: startZone.x, y: startZone.y };
      } else {
        const snapped = innerFrameSnap && !shiftPending
          ? snapPointToInnerFrame(startZone.x, startZone.y, undefined, canvas)
          : { x: startZone.x, y: startZone.y };
        // Shift固定中は、内枠スナップにも非選択軸を動かさせない。
        point = axis
          ? (axis === 'x' ? { x: snapped.x, y: lockedY } : { x: lockedX, y: snapped.y })
          : snapped;
        if (panelGapSnap && !shiftPending && !startZone.suppressOtherSnaps) {
          point = snapPanelVertexPointToGutter(
            page.panels,
            activePanel,
            vertexIndex,
            point.x,
            point.y,
            panelGutters,
            undefined,
            axis,
          );
        }
      }
      if (axis === 'x') point.y = lockedY;
      if (axis === 'y') point.x = lockedX;
      lastAppliedX = point.x - startX;
      lastAppliedY = point.y - startY;
      // ドラッグ開始時のコールバックへ絶対座標を渡し、各イベントを開始配置から再計算する。
      onMoveVertex(activePanel, vertexIndex, point.x, point.y, panelSync);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', updateShiftState);
      window.removeEventListener('keyup', updateShiftState);
      document.body.classList.remove('is-panel-dragging');
      setInteractionMode(null);
      cleanupRef.current = null;
    };
    cleanupRef.current?.();
    cleanupRef.current = finish;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', updateShiftState);
    window.addEventListener('keyup', updateShiftState);
  };

  const renderHandles = (panelIndex: number | null, selection: CanvasElementSelection, box: BBox, visible: BBox=box, showSize=true) => elementLocked(selection,panelIndex??activePanel)?null:(
    <>
      {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => <span
        class={`resize-handle handle-${handle}`}
        onPointerDown={(event) => startInteraction(event, panelIndex, selection, box, handle,visible)}
        aria-hidden="true"
        key={handle}
      />)}
      {showSize&&selection.type!=='figure'&&<span class="element-size-label">{visible.w.toFixed(1)} × {visible.h.toFixed(1)} mm</span>}
    </>
  );

  // パネル本体のクリック。重なった空白部分は下のパネルへ貫通させる
  const selectPanelAt = (event: MouseEvent, panelIndex: number) => {
    event.stopPropagation();
    if(backgroundEdit)return;
    const rect = paperRef.current?.getBoundingClientRect();
    if (!rect) {
      onSelectPanel(panelIndex);
      return;
    }
    const x = (event.clientX - rect.left) * (canvas.w / rect.width);
    const y = (event.clientY - rect.top) * (canvas.h / rect.height);
    onSelectPanel(resolveOverlapClick(page.panels,panelIndex,activePanel,x,y,(_panel,index)=>
      Array.from(paperRef.current!.querySelectorAll<HTMLElement>(`[data-content-panel="${index}"]`)).some(element=>elementContentHit(element,event.clientX,event.clientY))),event.shiftKey);
  };

  const createTextAt=(event:MouseEvent,panelIndex:number|null,existingOnly=false)=>{
    if((!textTool&&!existingOnly)||painting||backgroundEdit||zoomTool)return false;
    if(bubbleTextDragged.current){bubbleTextDragged.current=false;event.preventDefault();event.stopPropagation();return true;}
    const paper=paperRef.current;
    if(event.button!==0||spacePressedRef.current||!paper||!(event.target instanceof Element)||!paper.contains(event.target)||event.target.closest('.bubble-inline-editor,.canvas-text-toolbar,.background3d-window,.font-family-popover'))return false;
    // Keyboard activation keeps the same element click handler; a physical T click routes here once.
    if(event.detail===0)return false;
    const rect=paper.getBoundingClientRect();
    const point={x:(event.clientX-rect.left)*canvas.w/rect.width,y:(event.clientY-rect.top)*canvas.h/rect.height};
    if(point.x<0||point.y<0||point.x>canvas.w||point.y>canvas.h)return false;
    panelIndex=page.panels.findLastIndex(panel=>panelVisible(panel)&&pointInPanel(panel,point.x,point.y));
    if(panelIndex<0)panelIndex=null;
    const textHit=Array.from(paper.querySelectorAll<HTMLElement>('[data-content-target][data-content-kind="bubble"],[data-content-target][data-content-kind="screen_text"]')).reverse().find(element=>{
      if(!element.hasAttribute('data-content-overlay')&&Number(element.dataset.contentPanel)!==panelIndex)return false;
      // Point text may extend outside its frame. A normal-tool double click only edits text;
      // T also accepts the bubble/frame's blank area and creates text when nothing is hit.
      const boxes=Array.from(element.querySelectorAll<HTMLElement>('.bubble-text-content,.screen-text-body')).map(text=>text.getBoundingClientRect());
      if(!existingOnly)boxes.push(element.getBoundingClientRect());
      return boxes.some(box=>box.width>0&&box.height>0&&event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom);
    });
    if(!textHit&&(existingOnly||!onCreateScreenTextAt))return false;
    event.preventDefault();event.stopPropagation();
    if(textHit){
      const overlay=textHit.hasAttribute('data-content-overlay'),index=Number(textHit.dataset.contentIndex),owner=overlay?0:Number(textHit.dataset.contentPanel);
      const selection:CanvasElementSelection={type:textHit.dataset.contentKind as 'bubble'|'screen_text',index,...(overlay?{scope:'page_overlay' as const}:{})};
      if(!elementLocked(selection,owner)){
        if(selection.type==='bubble')onEditBubble?.({panelIndex:owner,bubbleIndex:index,overlay});
        else onEditScreenText?.(owner,index,overlay);
      }
      return true;
    }
    if(panelIndex!==null&&panelLocked(page.panels[panelIndex]))return true;
    onCreateScreenTextAt?.(panelIndex,point);
    return true;
  };

  const openPanelArtworkMenu = (event: MouseEvent, panelIndex: number) => {
    const hit=Array.from(paperRef.current?.querySelectorAll<HTMLElement>(`[data-content-panel="${panelIndex}"][data-content-kind="figure"]`)??[]).reverse()
      .find(element=>elementContentHit(element,event.clientX,event.clientY));
    const figureIndex=hit?Number(hit.dataset.contentIndex):undefined;
    openGenerationMenu(event, panelIndex, figureIndex);
  };

  // 非選択パネルはパネル内（パネル基準%・クリップあり）、選択中パネルは最前面のエレメント
  // レイヤー（紙面基準%）に描くため、配置スタイルを引数で差し替える
  const isSelectedElement = (selection: CanvasElementSelection) => backgroundEdit?backgroundEdit.selectedKey===`${selection.type}-${selection.index}`:selectedElement?.type === selection.type
    && selectedElement.index === selection.index
    && (selectedElement.scope ?? 'panel') === (selection.scope ?? 'panel');
  const contentSource=(selection:CanvasElementSelection,panelIndex:number|null)=>`${page.page}-${panelIndex??'page'}-${selection.scope??'panel'}-${selection.type}-${selection.index}`;
  const renderArtwork = (image: PlacedImage, selection: CanvasElementSelection, panelIndex: number | null, boxStyle: (box: BBox) => Record<string, string>, label?: string) => {
    if (image.hidden) return null;
    const isLocked=artworkLocked(image);
    const asset = imageAssets.find(item => item.id === image.assetId);
    const selected = (panelIndex === null || activePanel === panelIndex) && isSelectedElement(selection);
    const figure=selection.type==='figure'?(selection.scope==='page_overlay'?page.page_overlay:page.panels[panelIndex??-1])?.figures?.[selection.index]:undefined;
    const figureClass=figure?figureCanvasClass(figure):'';
    const bounds = {x:0,y:0,w:canvas.w,h:canvas.h};
    return <button type="button" data-content-target data-content-panel={panelIndex??undefined} data-content-kind={selection.type} data-content-index={selection.index} data-content-source={contentSource(selection,panelIndex)} class={`placed-image ${figureClass} ${selected && panelIndex === null && selection.scope !== 'page' ? 'is-element-selected' : ''}`} key={`${selection.type}-${selection.index}`}
      style={{...boxStyle(image.bbox),pointerEvents:isLocked?'none':'auto'}} data-artwork-locked={isLocked||undefined} aria-label={`${label ?? '配置画像'} ${asset?.originalName ?? ''}`}
      tabIndex={!isLocked&&(panelIndex === null || activePanel === panelIndex) ? 0 : -1}
      onClick={event => { event.stopPropagation(); onSelectElement(selection, panelIndex ?? undefined); }}
      onPointerDown={event => { if (!artworkLocked(image)) startInteraction(event, panelIndex, selection, image.bbox, 'move'); }}
      onContextMenu={event => { if(image.generationScope)openGenerationMenu(event,image.generationScope==='page'?-1:panelIndex??0);else if (selection.type === 'figure') openGenerationMenu(event, panelIndex ?? 0, selection.index, selection.scope === 'page_overlay'); }}
      onKeyDown={event => {
        if (selection.type === 'figure' && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) openGenerationMenu(event, panelIndex ?? 0, selection.index, selection.scope === 'page_overlay');
        else if (!artworkLocked(image)) nudgeElement(event, bounds, selection, image.bbox);
      }}>
      <PlacedImageView assets={imageAssets} asset={asset} image={image} />
      <CanvasContentSelection frame={image.bbox} revision={image} selected={selected&&panelIndex===null&&selection.scope!=='page'&&!isLocked} handles={visible=>renderHandles(panelIndex,selection,image.bbox,visible)}/>
    </button>;
  };
  const originalGuideVisible=(key:string,panelIndex:number,overlay=false)=>{
    const target=overlay?page.page_overlay:page.panels[panelIndex];
    const paint=key==='background'?page.panels[panelIndex]?.background_images?.[0]?.paint:key.startsWith('figure-')?target?.figures?.[Number(key.split('-')[1])]?.artwork?.paint:undefined;
    return !paint?.guideInitialized&&guideVisible(key,panelIndex,overlay);
  };
  const renderPanelBaseElements = (panel: Panel, panelIndex: number, boxStyle: (box: BBox) => Record<string, string>, only?:number|'screen') => <>
    {(panel.figures ?? []).map((figure, figureIndex) => {
      if(only!==undefined&&only!==figureIndex)return null;
      const selection: CanvasElementSelection = { type: 'figure', index: figureIndex };
      const box = figure.bbox ?? fallbackBox(panel, 'figure', figureIndex);
      const referenceBox=paintReferenceBox(figure.artwork?.paint,box,figure.artwork?.crop);
      if(editingPanel(panelIndex))return null;
      const isSelected = activePanel === panelIndex && isSelectedElement(selection);
      const isLocked=elementLocked(selection,panelIndex);
      const cropAssetId = figure.analogImport?.assetId;
      const figureClass = figureCanvasClass(figure);
      return <button
        data-content-target data-content-panel={panelIndex} data-content-kind="figure" data-content-index={figureIndex} class={`canvas-element figure-guide ${figureClass} ${cropAssetId ? 'has-source-crop' : ''} ${isSelected ? 'is-element-selected' : ''}`}
        style={{...boxStyle(box),pointerEvents:isLocked?'none':'auto'}} data-artwork-locked={isLocked||undefined}
        onPointerDown={(event) => startInteraction(event, panelIndex, selection, box, 'move')}
        onClick={(event) => { event.stopPropagation(); onSelectElement(selection, panelIndex); }}
        onContextMenu={(event) => openGenerationMenu(event, panelIndex, figureIndex)}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openGenerationMenu(event, panelIndex, figureIndex);
          else nudgeElement(event, {x:0,y:0,w:canvas.w,h:canvas.h}, selection, box);
        }}
        key={figure.analogImport?.sourceRegionId ?? `figure-${figureIndex}`}
        title={`${figureDisplayLabel(figure,figureIndex)}${figureClass==='is-unassigned' ? '・未割当' : ''}${figure.analogImport?.analysisReviewMessage ? `・要確認：${figure.analogImport.analysisReviewMessage}` : ''}（ドラッグで移動）`}
        tabIndex={!isLocked&&activePanel === panelIndex ? 0 : -1}
      >
        <span class="figure-native-reference" style={nativeStyle(box,referenceBox)}>{cropAssetId && <StoredCropImage assetId={cropAssetId} persistentAsset={figure.analogImport?.persistentAsset} className="figure-crop-image" />}
        {!cropAssetId && (figure.size ? <FigureSizeSvg size={figure.size} /> : isPropPlacement(figure) ? <Box size={12} /> : <UserRound size={12} />)}</span>
        <FigureName name={figureDisplayLabel(figure,figureIndex)} boxW={box.w} boxH={box.h} fitEpoch={fitEpoch} />
        <CanvasContentSelection frame={box} revision={figure} selected={isSelected&&!isLocked} handles={visible=>renderHandles(panelIndex,selection,box,visible)}/>
      </button>;
    })}
    {(typeof only==='number'?[]:panel.screen_text ?? []).map((screenText, screenTextIndex) => {
      const selection: CanvasElementSelection = { type: 'screen_text', index: screenTextIndex };
      const box = screenText.bbox ?? fallbackBox(panel, 'screen_text', screenTextIndex);
      const isLocked=elementLocked(selection,panelIndex);
      const isSelected = !isLocked&&activePanel === panelIndex && isSelectedElement(selection);
      return <button
        onDragEnter={event=>{if(!isLocked&&event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
        onDragOver={event=>{if(!isLocked&&event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
        onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))event.currentTarget.classList.remove('is-material-drop-target');}}
        onDrop={event=>{event.currentTarget.classList.remove('is-material-drop-target');if(isLocked)return;const id=event.dataTransfer?.getData(BUBBLE_MATERIAL_DRAG_TYPE);if(id){event.preventDefault();event.stopPropagation();onWrapScreenText?.({pageIndex:pageIndex??page.page-1,panelIndex,index:screenTextIndex,overlay:false,kind:'screen_text'},id);}}}
        data-content-target data-content-panel={panelIndex} data-content-kind="screen_text" data-content-index={screenTextIndex} data-artwork-locked={isLocked||undefined} class={`canvas-element screen-text-guide ${screenText.orientation === 'vertical' ? 'is-vertical' : ''} ${isSelected ? 'is-element-selected' : ''}`}
        style={{...boxStyle(box),pointerEvents:isLocked?'none':'auto','--text-tool-cursor':textToolCursor(textStyleOf(screenText,'screen_text'))}}
        onPointerDown={(event) => {if(!isLocked)startInteraction(event, panelIndex, selection, box, 'move');}}
        onClick={(event) => { event.stopPropagation(); if(!isLocked){onSelectElement(selection, panelIndex);if(textTool)onEditScreenText?.(panelIndex,screenTextIndex);} }}
        onKeyDown={event=>{if(isLocked)return;nudgeElement(event,panelBounds(panel),selection,box);}}
        key={`screen-text-${screenTextIndex}`}
        title={`通常文字 ${screenTextIndex + 1}（ドラッグで移動・吹き出し素材を重ねられます）`}
        tabIndex={!isLocked&&activePanel === panelIndex ? 0 : -1}
      >
        <span class={`screen-text-body ${screenText.orientation === 'vertical' ? 'vertical-text' : ''}`} style={textStyleCss(textStyleOf(screenText,'screen_text'),canvas.w,defaultBubbleFont)}>{screenText.text_weights?.length?textWeightSegments(screenText).map((part,i)=><span key={i} style={part.fontWeight?{fontWeight:part.fontWeight}:undefined}>{part.text}</span>):screenText.text}</span>
      </button>;
    })}
  </>;

  const bubbleTailRenderData = (
    owner: { figures?: Figure[] },
    bubble: Bubble,
    bubbleBox: BBox,
    figureBox: (index: number) => BBox,
  ) => {
    if (bubbleTailDisabled(bubble)) return null;
    const speakerFigureIndex = resolveBubbleSpeakerFigureIndex(owner, bubble);
    if (speakerFigureIndex === null) return null;
    const speakerBox = figureBox(speakerFigureIndex);
    const target = bubbleTailTargetPoint(speakerBox, bubble.tail);
    if (bubbleUsesMonologueTail(bubble)) {
      const ellipses = monologueTailEllipses(bubbleBox, target, bubble.bezier,bubble.tail_root);
      return ellipses.length ? { kind: 'beads' as const, ellipses, target, speakerBox, speakerFigureIndex } : null;
    }
    const composite = bubbleTailComposite(bubbleBox, target, bubble.shape ?? 'normal', bubble.bezier,bubble.tail_root);
    return composite ? { kind: 'pointed' as const, composite, target, speakerBox, speakerFigureIndex } : null;
  };

  const buildBubbleConnections = (
    owner: { figures?: Figure[] },
    bubbles: readonly Bubble[],
    bubbleBox: (index: number) => BBox,
    figureBox: (index: number) => BBox,
    keyPrefix: string,
    clipped=false,
  ): { elementsByBubble: VNode[][]; seamMasks: BubbleSeamMask[][]; composites:Array<BubbleTailComposite|null> } => {
    const elementsByBubble = bubbles.map(() => [] as VNode[]);
    const seamMasks = bubbles.map(() => [] as BubbleSeamMask[]);
    const composites=bubbles.map(()=>null as BubbleTailComposite|null);

    bubbles.forEach((bubble, bubbleIndex) => {
      if(!bubbleVisible(bubble))return;
      const data = bubbleTailRenderData(owner, bubble, bubbleBox(bubbleIndex), figureBox);
      if (!data) return;
      const key = `${keyPrefix}-tail-${bubbleIndex}`;
      if (data.kind === 'beads') {
        elementsByBubble[bubbleIndex].push(<g class="bubble-tail-beads" key={key}>{data.ellipses.map((ellipse, index) => <ellipse {...ellipse} key={`${key}-${index}`} />)}</g>);
        return;
      }
      composites[bubbleIndex]=data.composite;
    });

    bubbles.forEach((bubble, bubbleIndex) => {
      if(!bubbleVisible(bubble))return;
      const targetIndex = Number(bubble.join_to) - 1;
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= bubbleIndex) return;
      const targetBubble = bubbles[targetIndex];
      if(!bubbleVisible(targetBubble))return;
      // Different clipping modes cannot share a seam without leaving an opening.
      if(clipped&&!compatibleBubbleClips(bubble,targetBubble))return;
      const geometry = bubbleJoinGeometry(
        bubbleBox(bubbleIndex),
        bubble.shape ?? 'normal',
        bubbleBox(targetIndex),
        targetBubble.shape ?? 'normal',
        bubble.bezier, targetBubble.bezier,
      );
      if (!geometry) return;
      seamMasks[bubbleIndex].push(geometry.firstSeamMask);
      seamMasks[targetIndex].push(geometry.secondSeamMask);
      if (!geometry.fillPath && !geometry.outlinePaths.length) return;
      const key = `${keyPrefix}-join-${bubbleIndex}-${targetIndex}`;
      elementsByBubble[bubbleIndex].push(<g key={key}>
        {geometry.fillPath && <path class="bubble-connector-fill" d={geometry.fillPath} />}
        {geometry.outlinePaths.map((path, index) => <path class="bubble-connector-outline" d={path} key={`${key}-outline-${index}`} />)}
      </g>);
    });

    return { elementsByBubble, seamMasks, composites };
  };

  const panelBubblePresentations = useMemo(()=>page.panels.map((panel, panelIndex) => buildBubbleConnections(
    panel,
    panel.bubbles,
    (bubbleIndex) => nativeBox(panel.bubbles[bubbleIndex],panel.bubbles[bubbleIndex].bbox ?? fallbackBox(panel, 'bubble', bubbleIndex),`bubble-${bubbleIndex}`,panelIndex),
    (figureIndex) => nativeBox(panel.figures![figureIndex],panel.figures?.[figureIndex]?.bbox ?? fallbackBox(panel, 'figure', figureIndex),`figure-${figureIndex}`,panelIndex),
    `page-${page.page}-panel-${panelIndex}`,
    true,
  )),[page.panels,page.page,canvas.w,canvas.h,paintGeometry,paintTarget?.panelIndex,paintTarget?.overlay]);

  // 紙面座標で描き、コマ所属のフキダシは所有コマで常に切り取る。
  const renderPanelBubbles = (panel: Panel, panelIndex: number) => !panelVisible(panel)?[]:panel.bubbles.map((bubble, bubbleIndex) => {
    if(!bubbleVisible(bubble))return null;
    const selection: CanvasElementSelection = { type: 'bubble', index: bubbleIndex };
    const box = previewOwner(`bubble-${bubbleIndex}`,panelIndex)?.frame??bubble.bbox ?? fallbackBox(panel, 'bubble', bubbleIndex);
    const referenceBox=nativeBox(bubble,box,`bubble-${bubbleIndex}`,panelIndex);
    const referenceStyle={left:`${(referenceBox.x-box.x)/box.w*100}%`,top:`${(referenceBox.y-box.y)/box.h*100}%`,width:`${referenceBox.w/box.w*100}%`,height:`${referenceBox.h/box.h*100}%`};
    const textFrame=bubbleTextFrame(referenceBox,panel,bubble);
    const textFrameStyle={left:`${(textFrame.x-referenceBox.x)/referenceBox.w*100}%`,top:`${(textFrame.y-referenceBox.y)/referenceBox.h*100}%`,width:`${textFrame.w/referenceBox.w*100}%`,height:`${textFrame.h/referenceBox.h*100}%`};
    const isSelected = activePanel === panelIndex && isSelectedElement(selection);
    const textLengthClass = bubble.text.length > 24 ? 'is-very-long' : bubble.text.length > 14 ? 'is-long' : '';
    const presentation=panelBubblePresentations[panelIndex];
    return <div class="panel-bubble-clip" style={layerClipStyle(panel,canvas)} key={`panel-${panelIndex}-bubble-${bubbleIndex}`}>
      {presentation?.elementsByBubble[bubbleIndex]?.length?<svg class="bubble-tail-layer" viewBox={`0 0 ${canvas.w} ${canvas.h}`} aria-hidden="true">{presentation.elementsByBubble[bubbleIndex]}</svg>:null}
      <button
      onDragEnter={event=>{if(!painting&&!elementLocked(selection,panelIndex)&&event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
      onDragOver={event=>{if(!painting&&!elementLocked(selection,panelIndex)&&event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
      onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))event.currentTarget.classList.remove('is-material-drop-target');}}
      onDrop={event=>{event.currentTarget.classList.remove('is-material-drop-target');if(painting||elementLocked(selection,panelIndex))return;const id=event.dataTransfer?.getData(BUBBLE_MATERIAL_DRAG_TYPE);if(id){event.preventDefault();event.stopPropagation();onBubbleMaterial?.({pageIndex:pageIndex??page.page-1,panelIndex,index:bubbleIndex,overlay:false,kind:'bubble'},id);}}}
      data-content-target data-content-panel={panelIndex} data-content-kind="bubble" data-content-index={bubbleIndex} class={`canvas-element bubble-guide bubble-${bubble.shape ?? 'normal'} ${isSelected ? 'is-element-selected' : ''} ${backgroundEdit&&editingPanel(panelIndex)?`background3d-layout-item ${isSelected?'background3d-layout-selected':''}`:''}`}
      data-background3d-owner={backgroundEdit&&editingPanel(panelIndex)?`bubble-${bubbleIndex}`:undefined}
      style={{...paperBoxStyle(box),pointerEvents:elementLocked(selection,panelIndex)?'none':'auto','--text-tool-cursor':textToolCursor(textStyleOf(bubble,'bubble'))}} data-artwork-locked={elementLocked(selection,panelIndex)||undefined}
      onPointerDown={(event) => startInteraction(event, panelIndex, selection, box, 'move')}
      onClick={(event) => { event.stopPropagation(); onSelectElement(selection, panelIndex);if(textTool&&!backgroundEdit)onEditBubble?.({panelIndex,bubbleIndex,overlay:false}); }}
      onContextMenu={event=>openGenerationMenu(event,panelIndex,undefined,false,bubbleIndex)}
      onKeyDown={event=>{if(elementLocked(selection,panelIndex))return;if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))openGenerationMenu(event,panelIndex,undefined,false,bubbleIndex);else nudgeElement(event,paperBounds,selection,box);}}
      title={`フキダシ ${bubbleIndex + 1}（ドラッグで移動）`}
      tabIndex={!elementLocked(selection,panelIndex)&&activePanel === panelIndex ? 0 : -1}
    >
      <span class="bubble-native-reference" style={referenceStyle}><BubbleShapeSvg
        shape={bubble.shape} bezier={bubble.bezier}
        composite={presentation?.composites[bubbleIndex]??undefined}
        seamMasks={presentation?.seamMasks[bubbleIndex]}
        maskId={`bubble-outline-mask-page-${page.page}-panel-${panelIndex}-${bubbleIndex}`}
      />
      </span>
      {editingPanel(panelIndex)?<PaintOwnerPreview ownerKey={`bubble-${bubbleIndex}`} container={box} inkOnly/>:(bubble.paint_overlay && !bubble.paint_overlay.hidden && <span class="bubble-paint-overlay"><PlacedImageView assets={imageAssets} asset={imageAssets.find(asset=>asset.id===bubble.paint_overlay!.assetId)} image={{...bubble.paint_overlay,id:'bubble-paint',bbox:box}}/></span>)}
      <span class="bubble-native-reference bubble-native-text" style={referenceStyle}>
      {textFrame.w>0&&textFrame.h>0&&<span class="bubble-text-frame" style={textFrameStyle}><BubbleText text={bubble.text} font={defaultBubbleFont} shape={bubble.shape} lengthClass={textLengthClass} boxW={textFrame.w} boxH={textFrame.h} fitEpoch={fitEpoch} position={bubbleTextPosition(bubble)} style={bubble.text_style} weights={bubble.text_weights} paperWidth={canvas.w}
          review={scenarioBubbleNeedsReview(bubble)}
          onEdit={textTool&&!backgroundEdit&&!elementLocked(selection,panelIndex)?()=>onEditBubble?.({panelIndex,bubbleIndex,overlay:false}):undefined}
          onMoveFrame={textTool&&!backgroundEdit&&!elementLocked(selection,panelIndex)?event=>startBubbleTextDrag(event,selection,referenceBox,bubbleTextPosition(bubble)):undefined} moveFrameActive={isSelected}/></span>}
      </span>
      <CanvasContentSelection frame={box} revision={bubble} selected={isSelected&&!elementLocked(selection,panelIndex)} handles={visible=>!backgroundEdit&&!bubblePathTool&&renderHandles(panelIndex,selection,box,visible,false)}/>
    </button></div>;
  });

  const paperBounds: BBox = { x: 0, y: 0, w: page.canvas.w, h: page.canvas.h };
  const overlayFallbackBox = (type: 'figure' | 'bubble', index: number): BBox => pageOverlayFallbackBox(canvas, type, index);
  const overlay = page.page_overlay;
  const overlayBubbles = overlay?.bubbles ?? [];
  const overlayBubblePresentation = useMemo(()=>buildBubbleConnections(
    overlay ?? {},
    overlayBubbles,
    (bubbleIndex) => nativeBox(overlayBubbles[bubbleIndex],overlayBubbles[bubbleIndex].bbox ?? overlayFallbackBox('bubble', bubbleIndex),`bubble-${bubbleIndex}`,0,true),
    (figureIndex) => nativeBox(overlay!.figures![figureIndex],overlay?.figures?.[figureIndex]?.bbox ?? overlayFallbackBox('figure', figureIndex),`figure-${figureIndex}`,0,true),
    `page-${page.page}-overlay`,
  ),[overlay,page.page,canvas.w,canvas.h,paintGeometry,paintTarget?.panelIndex,paintTarget?.overlay]);
  const renderPageOverlayFigures = () => (overlay?.figures ?? []).map((figure, figureIndex) => {
    const selection: CanvasElementSelection = { scope: 'page_overlay', type: 'figure', index: figureIndex };
    const box = figure.bbox ?? overlayFallbackBox('figure', figureIndex);
    if(editingOverlay)return <PaintOwnerPreview key={`paint-figure-${figureIndex}`} ownerKey={`figure-${figureIndex}`} container={paperBounds}/>;
    const referenceBox=paintReferenceBox(figure.artwork?.paint,box,figure.artwork?.crop);
    const isSelected = isSelectedElement(selection);
    const artwork = figureArtwork(figure);
    if (artwork) return renderArtwork(artwork, selection, null, paperBoxStyle, `${figureDisplayLabel(figure,figureIndex)}の画像`);
    const cropAssetId = figure.analogImport?.assetId;
    const figureClass = figureCanvasClass(figure);
    return <button
      data-content-target class={`canvas-element figure-guide page-overlay-element ${figureClass} ${cropAssetId ? 'has-source-crop' : ''} ${isSelected ? 'is-element-selected' : ''}`}
      style={{...paperBoxStyle(box),pointerEvents:elementLocked(selection)?'none':'auto'}} data-artwork-locked={elementLocked(selection)||undefined}
      onPointerDown={(event) => startInteraction(event, null, selection, box, 'move')}
      onClick={(event) => { event.stopPropagation(); onSelectElement(selection); }}
      onContextMenu={event => openGenerationMenu(event, 0, figureIndex, true)}
      onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openGenerationMenu(event, 0, figureIndex, true); else nudgeElement(event, paperBounds, selection, box); }}
      key={figure.analogImport?.sourceRegionId ?? `page-overlay-figure-${figureIndex}`}
      title={`${figureDisplayLabel(figure,figureIndex)}・ページ前景${figure.analogImport?.analysisReviewMessage ? `・要確認：${figure.analogImport.analysisReviewMessage}` : ''}（ドラッグで移動）`}
      tabIndex={!elementLocked(selection)&&activePanel >= 0 ? 0 : -1}
    >
      <span class="figure-native-reference" style={nativeStyle(box,referenceBox)}>{cropAssetId && <StoredCropImage assetId={cropAssetId} persistentAsset={figure.analogImport?.persistentAsset} className="figure-crop-image" />}
      {!cropAssetId && (figure.size ? <FigureSizeSvg size={figure.size} /> : isPropPlacement(figure) ? <Box size={12} /> : <UserRound size={12} />)}</span>
      <FigureName name={figureDisplayLabel(figure,figureIndex)} boxW={box.w} boxH={box.h} fitEpoch={fitEpoch} />
      <CanvasContentSelection frame={box} revision={figure} selected={isSelected&&!elementLocked(selection)} handles={visible=>renderHandles(null,selection,box,visible)}/>
    </button>;
  });
  const renderPageOverlayText=()=>(overlay?.screen_text??[]).map((screenText,index)=>{
    const selection:CanvasElementSelection={scope:'page_overlay',type:'screen_text',index};
    const box=screenText.bbox??overlayTextFallbackBox(canvas,index),isSelected=isSelectedElement(selection);
    return <button
      onDragEnter={event=>{if(event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
      onDragOver={event=>{if(event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
      onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))event.currentTarget.classList.remove('is-material-drop-target');}}
      onDrop={event=>{event.currentTarget.classList.remove('is-material-drop-target');const id=event.dataTransfer?.getData(BUBBLE_MATERIAL_DRAG_TYPE);if(id){event.preventDefault();event.stopPropagation();onWrapScreenText?.({pageIndex:pageIndex??page.page-1,panelIndex:0,index,overlay:true,kind:'screen_text'},id);}}}
      data-content-target data-content-overlay data-content-kind="screen_text" data-content-index={index}
      class={`canvas-element screen-text-guide page-overlay-element ${screenText.orientation==='vertical'?'is-vertical':''} ${isSelected?'is-element-selected':''}`}
      style={{...paperBoxStyle(box),'--text-tool-cursor':textToolCursor(textStyleOf(screenText,'screen_text'))}} onPointerDown={event=>startInteraction(event,null,selection,box,'move')}
      onClick={event=>{event.stopPropagation();onSelectElement(selection);if(textTool)onEditScreenText?.(0,index,true);}}
      onKeyDown={event=>{nudgeElement(event,paperBounds,selection,box);}}
      title={`通常文字 ${index+1}（ページ前景）`} tabIndex={activePanel>=0?0:-1}>
      <span class={`screen-text-body ${screenText.orientation==='vertical'?'vertical-text':''}`} style={textStyleCss(textStyleOf(screenText,'screen_text'),canvas.w,defaultBubbleFont)}>{screenText.text_weights?.length?textWeightSegments(screenText).map((part,i)=><span key={i} style={part.fontWeight?{fontWeight:part.fontWeight}:undefined}>{part.text}</span>):screenText.text}</span>
    </button>;
  });
  const renderPageOverlayBubbles = () => (overlay?.bubbles ?? []).map((bubble, bubbleIndex) => {
    if(!bubbleVisible(bubble))return null;
    const selection: CanvasElementSelection = { scope: 'page_overlay', type: 'bubble', index: bubbleIndex };
    const box = previewOwner(`bubble-${bubbleIndex}`,0,true)?.frame??bubble.bbox ?? overlayFallbackBox('bubble', bubbleIndex);
    const referenceBox=nativeBox(bubble,box,`bubble-${bubbleIndex}`,0,true);
    const referenceStyle={left:`${(referenceBox.x-box.x)/box.w*100}%`,top:`${(referenceBox.y-box.y)/box.h*100}%`,width:`${referenceBox.w/box.w*100}%`,height:`${referenceBox.h/box.h*100}%`};
    const isSelected = isSelectedElement(selection);
    const textLengthClass = bubble.text.length > 24 ? 'is-very-long' : bubble.text.length > 14 ? 'is-long' : '';
    return <div class="page-overlay-bubble-stack-item" key={bubble.analogTextImport?.sourceRegionId ?? `page-overlay-bubble-${bubbleIndex}`}>
      {overlayBubblePresentation.elementsByBubble[bubbleIndex]?.length?<svg class="bubble-tail-layer" viewBox={`0 0 ${canvas.w} ${canvas.h}`} aria-hidden="true">{overlayBubblePresentation.elementsByBubble[bubbleIndex]}</svg>:null}
      <button
      onDragEnter={event=>{if(!painting&&!elementLocked(selection)&&event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
      onDragOver={event=>{if(!painting&&!elementLocked(selection)&&event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
      onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))event.currentTarget.classList.remove('is-material-drop-target');}}
      onDrop={event=>{event.currentTarget.classList.remove('is-material-drop-target');if(painting||elementLocked(selection))return;const id=event.dataTransfer?.getData(BUBBLE_MATERIAL_DRAG_TYPE);if(id){event.preventDefault();event.stopPropagation();onBubbleMaterial?.({pageIndex:pageIndex??page.page-1,panelIndex:0,index:bubbleIndex,overlay:true,kind:'bubble'},id);}}}
      data-content-overlay data-content-kind="bubble" data-content-index={bubbleIndex}
      data-content-target class={`canvas-element bubble-guide page-overlay-element bubble-${bubble.shape ?? 'normal'} ${isSelected ? 'is-element-selected' : ''}`}
      style={{...paperBoxStyle(box),pointerEvents:elementLocked(selection)?'none':'auto','--text-tool-cursor':textToolCursor(textStyleOf(bubble,'bubble'))}} data-artwork-locked={elementLocked(selection)||undefined}
      onPointerDown={(event) => startInteraction(event, null, selection, box, 'move')}
      onClick={(event) => { event.stopPropagation(); onSelectElement(selection);if(textTool)onEditBubble?.({panelIndex:0,bubbleIndex,overlay:true}); }}
      onContextMenu={event=>openGenerationMenu(event,0,undefined,true,bubbleIndex)}
      onKeyDown={event=>{if(elementLocked(selection))return;if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))openGenerationMenu(event,0,undefined,true,bubbleIndex);else nudgeElement(event,paperBounds,selection,box);}}
      title={`ページ前景フキダシ ${bubbleIndex + 1}（ドラッグで移動）`}
      tabIndex={!elementLocked(selection)&&activePanel >= 0 ? 0 : -1}
    >
      <span class="bubble-native-reference" style={referenceStyle}><BubbleShapeSvg
        shape={bubble.shape} bezier={bubble.bezier}
        composite={overlayBubblePresentation.composites[bubbleIndex]??undefined}
        seamMasks={overlayBubblePresentation.seamMasks[bubbleIndex]}
        maskId={`bubble-outline-mask-page-${page.page}-overlay-${bubbleIndex}`}
      />
      </span>
      {editingOverlay?<PaintOwnerPreview ownerKey={`bubble-${bubbleIndex}`} container={box} inkOnly/>:(bubble.paint_overlay && !bubble.paint_overlay.hidden && <span class="bubble-paint-overlay"><PlacedImageView assets={imageAssets} asset={imageAssets.find(asset=>asset.id===bubble.paint_overlay!.assetId)} image={{...bubble.paint_overlay,id:'bubble-paint',bbox:box}}/></span>)}
      <span class="bubble-native-reference bubble-native-text" style={referenceStyle}>
      {<BubbleText text={bubble.text} font={defaultBubbleFont} shape={bubble.shape} lengthClass={textLengthClass} boxW={referenceBox.w} boxH={referenceBox.h} fitEpoch={fitEpoch} position={bubbleTextPosition(bubble)} style={bubble.text_style} weights={bubble.text_weights} paperWidth={canvas.w}
          review={scenarioBubbleNeedsReview(bubble)}
          onEdit={textTool&&!elementLocked(selection)?()=>onEditBubble?.({panelIndex:0,bubbleIndex,overlay:true}):undefined}
          onMoveFrame={textTool&&!elementLocked(selection)?event=>startBubbleTextDrag(event,selection,referenceBox,bubbleTextPosition(bubble)):undefined} moveFrameActive={isSelected}/>}</span>
      <CanvasContentSelection frame={box} revision={bubble} selected={isSelected&&!elementLocked(selection)} handles={visible=>!bubblePathTool&&renderHandles(null,selection,box,visible,false)}/>
    </button></div>;
  });

  const selectedPanel = page.panels[activePanel]&&panelVisible(page.panels[activePanel])?page.panels[activePanel]:undefined;
  const selectedBounds = selectedPanel ? panelBounds(selectedPanel) : null;
  const selectedItem = selectedPanel && selectedElement && selectedElement.type !== 'image' && selectedElement.scope !== 'page_overlay'
    ? (selectedElement.type === 'figure' ? selectedPanel.figures?.[selectedElement.index]
      : selectedElement.type === 'bubble' ? selectedPanel.bubbles[selectedElement.index]
      : selectedPanel.screen_text?.[selectedElement.index])
    : undefined;
  const selectedAnchor = selectedItem && 'anchor' in selectedItem ? selectedItem.anchor : undefined;

  const renderSelectedBubblePathOverlay=()=>{
    if(!bubblePathTool||!selectedElement||selectedElement.type!=='bubble'||painting||backgroundEdit)return null;
    const pageOverlay=selectedElement.scope==='page_overlay',panelIndex=pageOverlay?0:activePanel;
    const owner=pageOverlay?overlay:page.panels[panelIndex],bubble=owner?.bubbles?.[selectedElement.index];
    if(!owner||!bubble||!bubbleVisible(bubble)||elementLocked(selectedElement,panelIndex))return null;
    const box=previewOwner(`bubble-${selectedElement.index}`,panelIndex,pageOverlay)?.frame??bubble.bbox??(pageOverlay?overlayFallbackBox('bubble',selectedElement.index):fallbackBox(owner as Panel,'bubble',selectedElement.index));
    const referenceBox=nativeBox(bubble,box,`bubble-${selectedElement.index}`,panelIndex,pageOverlay);
    return <span class="bubble-path-edit-layer" style={paperBoxStyle(referenceBox)}>
      <BubbleBezierHandles outline={bubbleOutlineForDirectEdit(bubble)} overlay label={`${pageOverlay?'ページ前景':''}フキダシ ${selectedElement.index+1} の輪郭を編集`} onChange={bezier=>onChangeBubbleTail(selectedElement,undefined,{bezier})}/>
    </span>;
  };

  const renderBubbleTailEditor = () => {
    if (!selectedElement || selectedElement.type !== 'bubble') return null;
    const pageOverlay = selectedElement.scope === 'page_overlay';
    const owner = pageOverlay ? overlay : selectedPanel;
    const bubble = pageOverlay ? overlay?.bubbles?.[selectedElement.index] : selectedPanel?.bubbles[selectedElement.index];
    if (!owner || !bubble || !bubbleVisible(bubble) || elementLocked(selectedElement) || bubbleTailDisabled(bubble)) return null;
    const speakerFigureIndex = resolveBubbleSpeakerFigureIndex(owner, bubble);
    if (speakerFigureIndex === null) return null;
    const speakerFigure = owner.figures?.[speakerFigureIndex];
    if (!speakerFigure || !bubble.speaker) return null;
    const speakerBox = paintReferenceBox(speakerFigure.artwork?.paint,speakerFigure.bbox ?? (pageOverlay
      ? overlayFallbackBox('figure', speakerFigureIndex)
      : fallbackBox(selectedPanel!, 'figure', speakerFigureIndex)),speakerFigure.artwork?.crop);
    const target = bubbleTailTargetPoint(speakerBox, bubble.tail);
    const storedBubbleBox=bubble.bbox??(pageOverlay?overlayFallbackBox('bubble',selectedElement.index):fallbackBox(selectedPanel!,'bubble',selectedElement.index));
    const bubbleBox=nativeBox(bubble,storedBubbleBox,`bubble-${selectedElement.index}`,pageOverlay?0:activePanel,pageOverlay);
    const root=bubbleTailGeometry(bubbleBox,target,bubble.shape??'normal',bubble.bezier,bubble.tail_root)?.rootPoint;
    const labelW = (Array.from(bubble.speaker).length * 7 + 8)*screenUnit;
    const labelH = 17*screenUnit;
    const labelX = clamp(target.x - labelW / 2, 1, canvas.w - 1 - labelW);
    const above = target.y - 9*screenUnit - labelH;
    const labelY = above < 1 ? target.y + 9*screenUnit : above;
    return <svg class="bubble-tail-editor-overlay" viewBox={`0 0 ${canvas.w} ${canvas.h}`}>
      {root&&<><rect class="bubble-tail-root-dot" x={root.x-3.5*screenUnit} y={root.y-3.5*screenUnit} width={7*screenUnit} height={7*screenUnit} rx={screenUnit}/><circle class="bubble-tail-root-hit" cx={root.x} cy={root.y} r={8*screenUnit} onPointerDown={event=>startBubbleTailRootDrag(event,selectedElement,bubbleBox)}><title>ドラッグしてしっぽの根元を吹き出しの輪郭上で移動</title></circle></>}
      <circle class="bubble-tail-target-dot" cx={target.x} cy={target.y} r={3.5*screenUnit} />
      <circle
        class="bubble-tail-target-hit"
        cx={target.x}
        cy={target.y}
        r={8*screenUnit}
        onPointerDown={(event) => startBubbleTailDrag(event, selectedElement, speakerBox)}
      ><title>ドラッグしてしっぽの先端を口元の方向へ、適切な長さに移動</title></circle>
      <rect class="anchor-indicator-label-bg" x={labelX} y={labelY} width={labelW} height={labelH} rx={3*screenUnit} />
      <text class="anchor-indicator-text" style={{fontSize:`${12*screenUnit}px`}} x={labelX + labelW / 2} y={labelY + 12*screenUnit}>{bubble.speaker}</text>
    </svg>;
  };

  const renderAnchorIndicator = () => {
    if (!selectedPanel || !selectedBounds || !selectedElement || !selectedItem || ('artwork' in selectedItem && selectedItem.artwork)) return null;
    const box = selectedItem.bbox ?? fallbackBox(selectedPanel, selectedElement.type, selectedElement.index);
    let point: { x: number; y: number };
    let label: string;
    if (selectedElement.type === 'bubble') {
      const bubble = selectedPanel.bubbles[selectedElement.index];
      if(!bubble||!bubbleVisible(bubble))return null;
      const speakerFigureIndex = bubble ? resolveBubbleSpeakerFigureIndex(selectedPanel, bubble) : null;
      if (speakerFigureIndex !== null) {
        return null;
      } else {
        // 人物あたり・同名人物が複数・コマ内に話者がいない場合は、誤った人物へ線を引かない。
        if (bubble?.speaker || !selectedAnchor) return null;
        point = anchorPoint(selectedBounds, selectedAnchor);
        label = selectedAnchor;
      }
    } else {
      if (!selectedAnchor) return null;
      point = anchorPoint(selectedBounds, selectedAnchor);
      label = selectedAnchor;
    }
    const labelW = (Array.from(label).length * 7 + 8)*screenUnit;
    const labelH = 17*screenUnit;
    const labelX = clamp(point.x - labelW / 2, 1, canvas.w - 1 - labelW);
    const above = point.y - 9*screenUnit - labelH;
    const labelY = above < 1 ? point.y + 9*screenUnit : above;
    return <g class="anchor-indicator" aria-hidden="true">
      <line x1={box.x + box.w / 2} y1={box.y + box.h / 2} x2={point.x} y2={point.y} />
      <circle class="anchor-indicator-dot" cx={point.x} cy={point.y} r={4*screenUnit} />
      <rect class="anchor-indicator-label-bg" x={labelX} y={labelY} width={labelW} height={labelH} rx={3*screenUnit} />
      <text class="anchor-indicator-text" style={{fontSize:`${12*screenUnit}px`}} x={labelX + labelW / 2} y={labelY + 12*screenUnit}>{label}</text>
    </g>;
  };

  const currentPageIndex=pageIndex??page.page-1;
  const [textSelection,setTextSelection]=useState<TextSelection|undefined>();
  const [textToolbarHost,setTextToolbarHost]=useState<HTMLElement|null>(null);
  useEffect(()=>{setTextToolbarHost(document.getElementById('paint-text-settings-slot'));},[]);
  const textTarget=editingText;
  const toolbarTarget:CanvasTextTarget|null=textTool?(textTarget??(selectedElement&&['bubble','screen_text'].includes(selectedElement.type)?{pageIndex:currentPageIndex,panelIndex:Math.max(0,activePanel),index:selectedElement.index,overlay:selectedElement.scope==='page_overlay',kind:selectedElement.type as 'bubble'|'screen_text'}:null)):null;
  const toolbarItem=toolbarTarget?(toolbarTarget.kind==='bubble'?(toolbarTarget.overlay?page.page_overlay?.bubbles:page.panels[toolbarTarget.panelIndex]?.bubbles)?.[toolbarTarget.index]:(toolbarTarget.overlay?page.page_overlay?.screen_text:page.panels[toolbarTarget.panelIndex]?.screen_text)?.[toolbarTarget.index]):undefined;
  const renderedTextStyle=(target:CanvasTextTarget):TextStyle=>{
    const selector=target.overlay?`[data-content-overlay][data-content-kind="${target.kind}"][data-content-index="${target.index}"]`:`[data-content-panel="${target.panelIndex}"][data-content-kind="${target.kind}"][data-content-index="${target.index}"]`;
    const el=paperRef.current?.querySelector<HTMLElement>(`${selector} .bubble-text,${selector} .screen-text-body`),width=paperRef.current?.clientWidth;
    if(!el||!width)return {};
    const style=getComputedStyle(el),pt=parseFloat(style.fontSize)/width*canvas.w*72/25.4;
    return {font:defaultBubbleFont,fontSize:Math.max(4,Math.min(144,Math.round(pt*1000)/1000)),fontWeight:Number(style.fontWeight)||600};
  };
  const changeStyle=(patch:TextStylePatch)=>{if(toolbarTarget&&toolbarItem)onTextStyle?.(toolbarTarget,patch,textTarget?textSelection:undefined);else onTextToolStyle?.(patch);};

  const textPanel=textTarget&&!textTarget.overlay?page.panels[textTarget.panelIndex]:undefined;
  const textBubble=textTarget?.kind==='bubble'?(textTarget.overlay?overlay?.bubbles:textPanel?.bubbles)?.[textTarget.index]:undefined;
  const screenText=textTarget?.kind==='screen_text'?(textTarget.overlay?overlay?.screen_text:textPanel?.screen_text)?.[textTarget.index]:undefined;
  const textValue=textBubble?.text??screenText?.text;
  const textBox=textTarget&&textBubble?paintReferenceBox(textBubble.paint_overlay?.paint,textBubble.bbox??(textTarget.overlay?overlayFallbackBox('bubble',textTarget.index):fallbackBox(textPanel!,'bubble',textTarget.index)),textBubble.paint_overlay?.crop):screenText&&(screenText.bbox??(textTarget!.overlay?overlayTextFallbackBox(canvas,textTarget!.index):fallbackBox(textPanel!,'screen_text',textTarget!.index)));
  const textPosition=textBubble?bubbleTextPosition(textBubble):undefined;
  useLayoutEffect(()=>{
    setTextSelection(undefined);
  },[textTarget]);
  return (
    <div data-paint-canvas onClickCapture={event=>{createTextAt(event,null);}} onDblClickCapture={event=>{if(!textTool)createTextAt(event,null,true);}} class={`canvas-viewport ${textTool&&!painting?'is-text-tool':''} ${painting?'is-painting':''} ${backgroundEdit?'is-background3d-editing':''} ${zoomTool?'is-zoom-tool':''} ${!painting&&!textTool&&!zoomTool&&!bubblePathTool?'is-selection-tool':bubblePathTool==='node'?'is-direct-selection-tool':''}`} onPointerDownCapture={event=>{bubbleTextDragged.current=false;const target=event.target as Element;if(textTool&&!painting&&!backgroundEdit&&event.button===0&&!spacePressedRef.current&&paperRef.current?.contains(target)&&!target.closest('.bubble-inline-editor,.background3d-window,.bubble-text-move-frame.is-active')){event.preventDefault();event.stopPropagation();return;}if(editingText&&!target.closest('.bubble-inline-editor,.text-settings-window,.canvas-text-toolbar,.font-family-popover'))onEndTextEdit?.();}}>
      {textSettingsOwner&&textTool&&!painting&&textToolbarHost&&createPortal(
        <CanvasTextToolbar key={toolbarTarget?`${toolbarTarget.pageIndex}:${toolbarTarget.panelIndex}:${toolbarTarget.overlay}:${toolbarTarget.kind}:${toolbarTarget.index}`:'new'} creating={!toolbarItem} style={toolbarTarget&&toolbarItem?{...renderedTextStyle(toolbarTarget),...textStyleOf(toolbarItem,toolbarTarget.kind)}:textToolStyle} defaultFont={defaultBubbleFont} fontFamilies={fontFamilies} selection={textTarget?textSelection:undefined} selectionWeight={textTarget&&textSelection&&toolbarItem&&toolbarTarget?selectedTextWeight(toolbarItem,textSelection,renderedTextStyle(toolbarTarget).fontWeight):undefined} disabled={Boolean(toolbarTarget&&elementLocked({type:toolbarTarget.kind,index:toolbarTarget.index,...(toolbarTarget.overlay?{scope:'page_overlay' as const}:{})},toolbarTarget.panelIndex))} onChange={changeStyle} onSizeGesture={toolbarItem?phase=>onImageGesture?.(phase,'text-size'):undefined} onHistory={onTextHistory} onRequestFonts={onRequestFonts}/>,
        textToolbarHost,
      )}
      <div ref={scrollRef} class="canvas-scroll">
        <div ref={paperZoomFrameRef} class="manga-paper-zoom-frame" style={{aspectRatio:`${outputWidth} / ${outputHeight}`}}>
        <div ref={paperRef} class={`manga-paper ${paintTarget?'has-paint-surface':''} ${showGuides ? 'show-guides' : ''} ${showGuides&&printMarginMm>0&&renderPrintGuides?'has-print-sheet':''} ${interactionMode ? 'is-interacting' : ''}`} style={{ aspectRatio: `${outputWidth} / ${outputHeight}`, '--bubble-line-width': canvasLengthCss(Math.max(0.1,bubbleLineWidthMm),canvas.w), '--text-tool-cursor':textToolCursor(textToolStyle) }} onContextMenu={event=>openGenerationMenu(event,-1)} onPointerDown={(event) => { if (event.target === event.currentTarget) onSelectElement(null); }}>
      {showGuides&&printMarginMm>0&&renderPrintGuides&&<div class="page-print-sheet" style={printGuideStyle} aria-hidden="true" />}
      {showGuides&&printMarginMm>0&&renderPrintGuides&&<svg class="page-print-guides" style={printGuideStyle} viewBox={`${-printMarginMm} ${-printMarginMm} ${printGuideWidthMm+printMarginMm*2} ${canvas.h+printMarginMm*2}`} preserveAspectRatio="none" aria-label={`${effectiveSpreadSide==='left'?'見開き':'単ページ'}原稿ガイド：塗り足し線${bleedMm}mm、裁ち切り線、内枠線、トンボ${cropMarks?'あり':'なし'}`}>
        <path class="page-print-sheet-fill" d={`M${-printMarginMm} ${-printMarginMm}H${printGuideWidthMm+printMarginMm}V${canvas.h+printMarginMm}H${-printMarginMm}ZM0 0V${canvas.h}H${printGuideWidthMm}V0Z`} fill-rule="evenodd" />
        {bleedMm>0&&<>
          <rect class="page-bleed-guide" x={-bleedMm} y={-bleedMm} width={printGuideWidthMm+bleedMm*2} height={canvas.h+bleedMm*2} />
        </>}
        <rect class="page-trim-guide" x="0" y="0" width={printGuideWidthMm} height={canvas.h} />
        {effectiveSpreadSide==='left'&&<path class="page-spread-seam" d={`M${canvas.w} 0V${canvas.h}`} />}
        {cropMarks&&<path class="page-crop-marks" d={cropMarkPath} />}
      </svg>}
      <div class="manga-page-content" inert={painting&&!backgroundEdit} onClick={event=>{createTextAt(event,null);}}>
      {author.trim() && <div class="paper-footer"><span>{author}</span></div>}
      <div class="safe-area" style={paperBoxStyle(inner)} aria-hidden="true" />
      {page.panels.map((panel, panelIndex) => panelVisible(panel)&&(
        <div
          class={`manga-panel ${editingPanel(panelIndex)||!originalGuideVisible('background',panelIndex) ? 'has-background-artwork' : ''} panel-bg-${panel.bg} ${activePanel === panelIndex ? 'is-selected' : ''} ${selectedPanels.includes(panelIndex) ? 'is-group-selected' : ''}`}
          style={panelStyle(panel, canvas)}
          onClick={(event) => {if(!createTextAt(event,panelIndex))selectPanelAt(event, panelIndex);}}
          onContextMenu={(event) => openPanelArtworkMenu(event, panelIndex)}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openGenerationMenu(event, panelIndex);
            else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectPanel(panelIndex, event.shiftKey); }
          }}
          key={`${panel.id}-${panelIndex}`}
          role="button"
          aria-pressed={selectedPanels.includes(panelIndex)}
          tabIndex={0}
          aria-label={`${panelDisplayLabel(panel.id)} を編集`}
          title={panel.action ? `${panelDisplayLabel(panel.id)}: ${panel.action}` : panelDisplayLabel(panel.id)}
        >

        </div>
      ))}
      {page.panels.map((panel,panelIndex)=>panelVisible(panel)&&<div class={`panel-art-stack ${panelIndex===activePanel?'is-active':''}`} style={layerClipStyle(panel,canvas)} data-panel-outline={panelShapePoints(panel).map(([x,y])=>`${x/canvas.w},${y/canvas.h}`).join(' ')} key={`art-stack-${panelIndex}`}>
        {panelArtKeys(panel).map(key=>{
          if(key==='background')return <div class={`panel-art-background manga-panel ${editingPanel(panelIndex)||!originalGuideVisible('background',panelIndex)?'has-background-artwork':''} panel-bg-${panel.bg}`} style={panelStyle(panel,canvas)} key={key}>
            {editingPanel(panelIndex)?<PaintOwnerPreview ownerKey="background" container={panelBounds(panel)}/>:(!originalGuideVisible('background',panelIndex)&&panel.background_images?.map(image=>!image.hidden&&<span class="panel-background-artwork" key={image.id} style={bboxStyle(image.bbox,panel)}><PlacedImageView assets={imageAssets} asset={imageAssets.find(asset=>asset.id===image.assetId)} image={image}/></span>))}
          </div>;
          const index=Number(key.slice(7)),figure=panel.figures![index],image=figureArtwork(figure);
          return <div class="panel-art-owner" data-art-owner={key} key={key}>
            {editingPanel(panelIndex)?backgroundEdit&&previewOwner(key,panelIndex)?<button type="button" data-content-target class={`background3d-layout-item background3d-figure-move ${backgroundEdit.selectedKey===key?'background3d-layout-selected':''}`} data-background3d-owner={key} aria-label={`${figureDisplayLabel(figure,index)}の位置を移動`} style={{...paperBoxStyle(previewOwner(key,panelIndex)!.frame),pointerEvents:elementLocked({type:'figure',index},panelIndex)?'none':'auto'}} data-artwork-locked={elementLocked({type:'figure',index},panelIndex)||undefined} tabIndex={elementLocked({type:'figure',index},panelIndex)?-1:0} onPointerDown={event=>startInteraction(event,panelIndex,{type:'figure',index},previewOwner(key,panelIndex)!.frame,'move')} onClick={event=>{event.stopPropagation();if(!elementLocked({type:'figure',index},panelIndex))backgroundEdit.select(key);}} onKeyDown={event=>nudgeElement(event,panelBounds(panel),{type:'figure',index},previewOwner(key,panelIndex)!.frame)}><PaintOwnerPreview ownerKey={key} container={previewOwner(key,panelIndex)!.frame}/><CanvasContentSelection frame={previewOwner(key,panelIndex)!.frame} revision={previewOwner(key,panelIndex)!.paint} selected={backgroundEdit.selectedKey===key}/></button>:<PaintOwnerPreview ownerKey={key} container={{x:0,y:0,w:canvas.w,h:canvas.h}}/>:image?renderArtwork(image,{type:'figure',scope:'panel',index},panelIndex,paperBoxStyle,`${figureDisplayLabel(figure,index)}の画像`):renderPanelBaseElements(panel,panelIndex,paperBoxStyle,index)}
          </div>;
        })}
        {panel.images?.map((image,index)=>!image.generationScope&&!image.paintScope&&!image.bubbleOriginal&&renderArtwork(image,{type:'image',scope:'panel',index},panelIndex,paperBoxStyle))}
        {editingPanel(panelIndex)?<PaintOwnerPreview ownerKey="panel" container={paperBounds}/>:panel.images?.filter(image=>image.paintScope==='panel'&&!image.hidden).map(image=><span class="direct-paint-artwork" key={image.id} style={paperBoxStyle(image.bbox)}><PlacedImageView assets={imageAssets} asset={imageAssets.find(asset=>asset.id===image.assetId)} image={image}/></span>)}
        {panelIndex!==activePanel&&renderPanelBaseElements(panel,panelIndex,paperBoxStyle,'screen')}
        {panelIndex!==activePanel&&<div class="panel-number-layer" style={panelStyle(panel,canvas)}><span class="panel-number">{panel.id}</span></div>}
      </div>)}
      <div class="placed-image-layer">
        {page.images?.map((image, index) => !image.generationScope&&!image.paintScope&&!image.bubbleOriginal&&renderArtwork(image, { type: 'image', scope: 'page', index }, null, paperBoxStyle))}
      </div>
      {!painting && selectedElement && selectedElement.scope !== 'page_overlay' && (() => {
        const pageImage = selectedElement.scope === 'page';
        const image = selectedElement.type === 'image'
          ? (pageImage ? page.images : selectedPanel?.images)?.[selectedElement.index]
          : selectedElement.type === 'figure' && selectedPanel?.figures?.[selectedElement.index]
            ? figureArtwork(selectedPanel.figures[selectedElement.index]) : undefined;
        if (!image || image.hidden||artworkLocked(image)) return null;
        const panelIndex = pageImage ? null : activePanel;
        return <div class="artwork-selection-layer" style={{pointerEvents:'none'}}>
          <div data-content-target class="placed-image-selection" style={{...paperBoxStyle(image.bbox),pointerEvents:'none'}}
            onContextMenu={event => { if(image.generationScope)openGenerationMenu(event,image.generationScope==='page'?-1:activePanel);else if (selectedElement.type === 'figure') openGenerationMenu(event, activePanel, selectedElement.index); }}
            onPointerDown={event => { if (!artworkLocked(image)) startInteraction(event, panelIndex, selectedElement, image.bbox, 'move'); }}>
            <CanvasContentSelection frame={image.bbox} source={contentSource(selectedElement,panelIndex)} revision={image} selected interactive={false} handles={visible=>renderHandles(panelIndex,selectedElement,image.bbox,visible)}/>
          </div>
        </div>;
      })()}
      {selectedPanel && <div class="panel-element-layer" style={layerClipStyle(selectedPanel, canvas)}>
        {renderPanelBaseElements(selectedPanel, activePanel, paperBoxStyle,'screen')}
      </div>}
      {page.panels.some((panel) => panel.bubbles.length > 0) && <div class="panel-bubble-layer">
        {page.panels.flatMap((panel, panelIndex) => renderPanelBubbles(panel, panelIndex))}
      </div>}
      <svg class="panel-frame-overlay" viewBox={`0 0 ${canvas.w} ${canvas.h}`} strokeWidth={frameLineWidthMm} aria-hidden="true">
        {page.panels.map((panel, panelIndex) => {
          if(!panelFrameVisible(panel))return null;
          const key = `frame-${panel.id}-${panelIndex}`;
          if (panel.shape.type !== 'rect') return <polygon points={panel.shape.points.map(([x, y]) => `${x},${y}`).join(' ')} key={key} />;
          const bleed = panel.bleed ?? [];
          if (!bleed.length) return <rect x={panel.shape.x} y={panel.shape.y} width={panel.shape.w} height={panel.shape.h} key={key} />;
          // タチキリ（bleed）辺には枠線を描かない——辺ごとの線に分解する
          const { x, y, w, h } = panel.shape;
          return <g key={key}>
            {!bleed.includes('top') && <line x1={x} y1={y} x2={x + w} y2={y} />}
            {!bleed.includes('right') && <line x1={x + w} y1={y} x2={x + w} y2={y + h} />}
            {!bleed.includes('bottom') && <line x1={x} y1={y + h} x2={x + w} y2={y + h} />}
            {!bleed.includes('left') && <line x1={x} y1={y} x2={x} y2={y + h} />}
          </g>;
        })}
      </svg>
      <div class="page-direct-paint-layer">
        {editingOverlay?<PaintOwnerPreview ownerKey="page" container={paperBounds}/>:page.images?.filter(image=>image.paintScope==='page'&&!image.hidden).map(image=><span class="direct-paint-artwork" key={image.id} style={paperBoxStyle(image.bbox)}><PlacedImageView assets={imageAssets} asset={imageAssets.find(asset=>asset.id===image.assetId)} image={image}/></span>)}
      </div>
      {showGuides&&<svg class="panel-frame-inner-overlay" viewBox={`0 0 ${canvas.w} ${canvas.h}`} strokeWidth={frameLineWidthMm} aria-hidden="true">
        {page.panels.flatMap((panel,panelIndex)=>panelFrameVisible(panel)?panelFrameSegmentsOnInnerFrame(panel,inner).map((segment,segmentIndex)=><line {...segment} key={`inner-frame-${panelIndex}-${segmentIndex}`}/>):[])}
      </svg>}
      {(overlay?.figures?.length ?? 0) > 0 && <div class="page-overlay-figure-layer">
        {renderPageOverlayFigures()}
      </div>}
      {(overlay?.screen_text?.length??0)>0&&<div class="page-overlay-text-layer">{renderPageOverlayText()}</div>}
      {(overlay?.bubbles?.length ?? 0) > 0 && <div class="page-overlay-bubble-layer">
        {renderPageOverlayBubbles()}
      </div>}
      {renderSelectedBubblePathOverlay()}
      <div class="generated-composition-layer" style={{position:'absolute',inset:0,zIndex:20,pointerEvents:'none'}}>
        {page.panels.map((panel,panelIndex)=>panelVisible(panel)&&<div style={{position:'absolute',inset:0,...layerClipStyle(panel,canvas),pointerEvents:'none'}}>
          {panel.images?.map((image,index)=>image.generationScope&&!image.paintScope&&renderArtwork(image,{type:'image',scope:'panel',index},panelIndex,paperBoxStyle,`コマ ${panel.id}の生成画像`))}
        </div>)}
        {page.images?.map((image,index)=>image.generationScope&&!image.paintScope&&renderArtwork(image,{type:'image',scope:'page',index},null,paperBoxStyle,'ページの生成画像'))}
      </div>
      <div class="original-raster-layer">
        {page.panels.map((panel,panelIndex)=>panelVisible(panel)&&<div key={panel.id} style={{position:'absolute',inset:0,...layerClipStyle(panel,canvas),pointerEvents:'none'}}>
          {editingPanel(panelIndex)?paintWorkspace?.scene.owners.filter(owner=>owner.kind==='original').map(owner=><PaintOwnerPreview key={owner.key} ownerKey={owner.key} container={paperBounds}/>)
            :panel.images?.map((image,index)=>image.bubbleOriginal&&renderArtwork(image,{type:'image',scope:'panel',index},panelIndex,paperBoxStyle,image.bubbleOriginal.name))}
        </div>)}
        {editingOverlay?paintWorkspace?.scene.owners.filter(owner=>owner.kind==='original').map(owner=><PaintOwnerPreview key={owner.key} ownerKey={owner.key} container={paperBounds}/>)
          :page.images?.map((image,index)=>image.bubbleOriginal&&renderArtwork(image,{type:'image',scope:'page',index},null,paperBoxStyle,image.bubbleOriginal.name))}
      </div>
      {!painting&&renderBubbleTailEditor()}
      {!painting&&selectedPanels.length > 1 && <svg class="panel-group-selection-overlay" viewBox={`0 0 ${canvas.w} ${canvas.h}`} aria-hidden="true">
        {selectedPanels.filter((panelIndex) => panelIndex !== activePanel).map((panelIndex) => {
          const panel = page.panels[panelIndex];
          if (!panel||!panelVisible(panel)) return null;
          return panel.shape.type === 'rect'
            ? <rect x={panel.shape.x} y={panel.shape.y} width={panel.shape.w} height={panel.shape.h} key={`group-${panelIndex}`} />
            : <polygon points={panel.shape.points.map(([x, y]) => `${x},${y}`).join(' ')} key={`group-${panelIndex}`} />;
        })}
      </svg>}
      {!painting&&selectedPanel && selectedBounds && <svg class={`panel-selection-overlay ${panelGeometryLocked(selectedPanel)?'is-locked':''}`} viewBox={`0 0 ${canvas.w} ${canvas.h}`} aria-hidden="true" onContextMenu={(event) => openGenerationMenu(event, activePanel)}>
        {selectedPanel.shape.type === 'rect' ? <>
          <rect class="panel-selection-shape" x={selectedPanel.shape.x} y={selectedPanel.shape.y} width={selectedPanel.shape.w} height={selectedPanel.shape.h} />
          <rect class="panel-selection-hit-area" x={selectedPanel.shape.x} y={selectedPanel.shape.y} width={selectedPanel.shape.w} height={selectedPanel.shape.h} onPointerDown={startPanelMove} />
        </> : <>
          <polygon class="panel-selection-shape" points={selectedPanel.shape.points.map(([x, y]) => `${x},${y}`).join(' ')} />
          <polygon class="panel-selection-hit-area" points={selectedPanel.shape.points.map(([x, y]) => `${x},${y}`).join(' ')} onPointerDown={startPanelMove} />
        </>}
        {!panelGeometryLocked(selectedPanel)&&panelShapePoints(selectedPanel).map((point, edgeIndex, points) => {
          const next = points[(edgeIndex + 1) % points.length];
          const midpoint:[number,number]=[(point[0]+next[0])/2,(point[1]+next[1])/2];
          return <g class={`panel-edge-handle ${activeEdgeIndex === edgeIndex ? 'is-active' : ''}`} key={`edge-${edgeIndex}`}>
            <line class="panel-edge-guide" x1={point[0]} y1={point[1]} x2={next[0]} y2={next[1]} />
            <line class="panel-edge-hit" x1={point[0]} y1={point[1]} x2={next[0]} y2={next[1]} onPointerDown={(event) => startPanelEdgeDrag(event, edgeIndex)}>
              <title>辺 {edgeIndex + 1} を平行移動（Shiftで開始位置基準の水平・垂直に固定）</title>
            </line>
            <circle class="panel-edge-midpoint" cx={midpoint[0]} cy={midpoint[1]} r={2.5*screenUnit} />
            <circle class="panel-edge-midpoint-hit" cx={midpoint[0]} cy={midpoint[1]} r={7*screenUnit} onPointerDown={(event)=>startPanelEdgeDrag(event,edgeIndex)}>
              <title>辺 {edgeIndex + 1} の中央つまみ（辺全体を移動）</title>
            </circle>
          </g>;
        })}
        {!panelGeometryLocked(selectedPanel)&&([{ handle: 'nw', vertexIndex: 0 }, { handle: 'ne', vertexIndex: 1 }, { handle: 'sw', vertexIndex: 3 }, { handle: 'se', vertexIndex: 2 }] as const).map(({ handle, vertexIndex }) => {
          const x = handle.includes('w') ? selectedBounds.x : selectedBounds.x + selectedBounds.w;
          const y = handle.includes('n') ? selectedBounds.y : selectedBounds.y + selectedBounds.h;
          return <g class={`panel-handle-${handle}`} key={handle}>
            <rect class="panel-resize-handle" x={x - 3.5*screenUnit} y={y - 3.5*screenUnit} width={7*screenUnit} height={7*screenUnit} rx={screenUnit} />
            <rect class="panel-resize-hit" x={x - 7*screenUnit} y={y - 7*screenUnit} width={14*screenUnit} height={14*screenUnit} onPointerDown={(event) => {
              if (selectedPanel.shape.type === 'rect' && event.shiftKey) startVertexDrag(event, vertexIndex);
              else startPanelResize(event, handle);
            }}>
              <title>{selectedPanel.shape.type === 'rect' ? 'ドラッグでリサイズ・Shift+ドラッグで頂点を開始位置基準の水平または垂直移動' : 'ドラッグでリサイズ'}</title>
            </rect>
          </g>;
        })}
        {!panelGeometryLocked(selectedPanel)&&selectedPanel.shape.type === 'polygon' && selectedPanel.shape.points.map(([x, y], vertexIndex) => <g class="panel-vertex-handle" key={`vertex-${vertexIndex}`}>
          <circle class="panel-vertex-dot" cx={x} cy={y} r={3.5*screenUnit} />
          <rect class="panel-resize-hit" x={x - 7*screenUnit} y={y - 7*screenUnit} width={14*screenUnit} height={14*screenUnit} onPointerDown={(event) => startVertexDrag(event, vertexIndex)}>
            <title>頂点 {vertexIndex + 1} を移動（Shiftで開始位置基準の水平・垂直に固定）</title>
          </rect>
        </g>)}
        {renderAnchorIndicator()}
      </svg>}
      </div>
      {painting&&paintTarget&&<PaintInputSurface canvas={canvas}/>}
      {textTarget&&textValue!==undefined&&textBox&&(!textBubble||bubbleVisible(textBubble))&&!painting&&<div class={`bubble-inline-editor is-${textTarget.kind==='screen_text'?'screen-text':'bubble'} ${screenText?(textStyleOf(screenText,'screen_text').orientation==='vertical'?'is-vertical':'is-horizontal'):''}`} style={{...paperBoxStyle(textBox),...(textBubble&&!textTarget.overlay?elementPanelClipStyle(textPanel!,textBox):{}),...(textPosition?{'--bubble-text-x':`${textPosition.x*100}%`,'--bubble-text-y':`${textPosition.y*100}%`}:{})}}>
        <NativeTextEditor key={JSON.stringify(textTarget)} text={textValue} weights={(textBubble??screenText)?.text_weights} label={textTarget.kind==='bubble'?'吹き出しの文字':'通常文字'} style={textStyleCss({...renderedTextStyle(textTarget),...textStyleOf((textBubble??screenText)!,textTarget.kind)},canvas.w,defaultBubbleFont)}
          onText={(value,edit)=>onText?.(textTarget,value,edit)} onHistory={onTextHistory} onSelection={value=>setTextSelection(previous=>previous?.start===value.start&&previous?.end===value.end?previous:value)} onEnd={()=>onEndTextEdit?.()}/>

      </div>}
      </div>
      </div>
      </div>
      <div class="canvas-zoom-controls" onClick={event=>{
        // Pointer clicks return shortcuts to the canvas; keyboard activation keeps focus.
        if(event.detail>0&&event.target instanceof Element)event.target.closest<HTMLButtonElement>('button')?.blur();
      }}>
        <button type="button" class="zoom-fit" aria-pressed={zoomPercent===null} onClick={()=>{zoomPercentRef.current=null;onZoomPercentChange(null);fitPaper();}} title="紙面全体を表示">全体</button>
        <button type="button" onClick={() => zoomAt(1 / 1.25)} aria-label="縮小" title="縮小（⌘/Ctrl − / ホイール / 二本指ピンチ）"><ZoomOut size={14} /></button>
        <button type="button" class="zoom-reset" onClick={resetZoom} aria-label="100%表示" title="100%表示（出力画像の1pxを画面の1pxで表示）">{zoomPercent??fitPercent}%</button>
        <button type="button" onClick={() => zoomAt(1.25)} aria-label="拡大" title="拡大（⌘/Ctrl ＋ / ホイール / 二本指ピンチ）"><ZoomIn size={14} /></button>
      </div>
      {generationMenu && typeof window !== 'undefined' && createPortal(<>
        <button class="canvas-generation-menu-dismiss" aria-label="操作メニューを閉じる" onClick={() => setGenerationMenu(null)} />
        <div class="canvas-generation-menu" ref={generationMenuRef} role="menu" aria-label="あたり・画像の操作"
          style={{ left: Math.max(8, Math.min(generationMenu.x, window.innerWidth - 284)), top: Math.max(8, Math.min(generationMenu.y, window.innerHeight - 350)), maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); setGenerationMenu(null); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
              const index = buttons.findIndex(button => button === window.document.activeElement);
              buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
            }
          }}>
          <strong>{menuScope==='page'?'ページ全体':`${generationMenu.overlay ? 'ページ前景' : panelDisplayLabel(menuPanel?.id ?? 0)}${menuScope?'':` · ${menuFigure?.name ?? (menuBubble?'吹き出し':'背景')}`}`}</strong>
          {menuScope&&onGenerateComposition&&<button role="menuitem" onClick={()=>{onGenerateComposition(menuScope,generationMenu.panelIndex);setGenerationMenu(null);}}>{menuScope==='page'?'ページ全体を生成':'このコマを生成'}</button>}
          {menuScope!=='page'&&<>
          {menuSize && <small>{menuSize.width} × {menuSize.height} px（{dpi} dpi換算）</small>}
          <button role="menuitem" disabled={!menuBox} onClick={copyMenuSize}>サイズコピー</button>
          {onReplaceArtwork && <button role="menuitem" disabled={Boolean(menuFigure&&artworkLocked(menuFigure.artwork))} onClick={() => { onReplaceArtwork(generationMenu.panelIndex, generationMenu.figureIndex, generationMenu.overlay,generationMenu.bubbleIndex); setGenerationMenu(null); }}>画像を読み込む</button>}
          {!menuFigure&&!menuBubble&&<button role="menuitemcheckbox" aria-checked={guideVisible(menuKey,generationMenu.panelIndex,generationMenu.overlay)} onClick={()=>{onToggleGuide(menuKey,generationMenu.panelIndex,generationMenu.overlay);setGenerationMenu(null);}}>あたり画像表示</button>}
          <button role="menuitem" onClick={()=>{onGenerateArtwork(menuKey,generationMenu.panelIndex,generationMenu.overlay);setGenerationMenu(null);}}>{menuFigure?'人物単品を生成':menuBubble?'吹き出しを生成':'背景だけ生成'}</button></>}
        </div>
      </>, window.document.body)}
    </div>
  );
}
