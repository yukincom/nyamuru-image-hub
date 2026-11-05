import { useContext, useRef, useState, useLayoutEffect, useEffect } from 'preact/hooks';
import {
  BubblePathToolContext, PaintGeometryContext, PaintInputActivityContext, usePaintWorkspace,
} from '../../lib/paintWorkspace';
import type { CanvasElementSelection, Figure, Bubble, BBox } from '../../types';
import { panelLocked, panelGeometryLocked, ownerItemLocked, panelVisible } from '../../lib/panelLayers';
import { artworkLocked, paintOwnerPlacementLocked } from '../../lib/paintLock';
import { paintReferenceBox } from '../../lib/paintDocument';
import { innerFrameBounds, type ResizeHandle, fallbackBox, panelBounds } from '../../lib/canvasGeometry';
import { pageBoxStyle, type CanvasProps } from './CanvasElements';
import { overlayFallbackBox as pageOverlayFallbackBox } from '../../lib/pageCanvas.ts';
import { artworkPixelSize, copyArtworkSize } from '../../lib/artworkClipboard';

export function useCanvasSurface(options: CanvasProps) {
  const {
    paintTarget, page, activePanel, textTool, onSelectNativeElement, spreadSide, outputSize, dpi,
    zoomPercent, painting, onSelectPanel, onNotify, selectedElement,
  } = options;
  const bubblePathTool=useContext(BubblePathToolContext);
  const paintGeometry=useContext(PaintGeometryContext);
  const paintInputActive=useContext(PaintInputActivityContext);
  const paintWorkspace=usePaintWorkspace();
  const backgroundEdit=paintTarget&&!paintTarget.overlay&&paintWorkspace?.page===page.page&&paintWorkspace.panelIndex===paintTarget.panelIndex?paintWorkspace.background3d:undefined;
  const elementLocked=(selection:CanvasElementSelection,panelIndex=activePanel)=>{
    const enclosingPanel=selection.scope==='page_overlay'||selection.scope==='page'?undefined:page.panels[panelIndex];
    if(enclosingPanel&&panelLocked(enclosingPanel))return true;
    if(selection.type==='panel_frame')return !enclosingPanel||panelGeometryLocked(enclosingPanel);
    if(selection.type==='image')return artworkLocked((selection.scope==='page'?page.images:page.panels[panelIndex]?.images)?.[selection.index],(selection.scope==='page'?page.page_overlay:page.panels[panelIndex])?.bubbles);
    const target=selection.scope==='page_overlay'?page.page_overlay:page.panels[panelIndex];
    if(selection.type==='screen_text')return false;
    const preview=paintTarget&&paintTarget.overlay===(selection.scope==='page_overlay')&&(paintTarget.overlay||paintTarget.panelIndex===panelIndex)?paintWorkspace?.scene.owners.find(o=>o.key===`${selection.type}-${selection.index}`):undefined;
    if(preview)return paintOwnerPlacementLocked(preview);
    if(selection.type==='figure'){const figure=target?.figures?.[selection.index];return Boolean(figure?.locked)||artworkLocked(figure?.artwork);}
    const bubble=target?.bubbles?.[selection.index];return Boolean(bubble&&ownerItemLocked(bubble))||(!textTool&&artworkLocked(bubble?.paint_overlay));
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
  // Keep the existing artwork visible until this paint session can draw it.
  const paintReady=Boolean(paintWorkspace?.images&&paintWorkspace.page===page.page&&paintWorkspace.panelIndex===paintTarget?.panelIndex&&paintWorkspace.overlay===paintTarget?.overlay);
  const editingPanel=(index:number)=>Boolean(paintReady&&paintTarget&&!paintTarget.overlay&&paintTarget.panelIndex===index);
  const editingOverlay=Boolean(paintReady&&paintTarget?.overlay);
  const inner = innerFrameBounds(canvas);
  const panelMinSize = Math.min(20, canvas.w / 4, canvas.h / 4);
  const paperBoxStyle = (box: BBox) => pageBoxStyle(box, canvas);
  const paperRef = useRef<HTMLDivElement>(null);
  const paperZoomFrameRef = useRef<HTMLDivElement>(null);
  const [domSpreadSide,setDomSpreadSide]=useState<'left'|'right'|undefined>();
  const refreshSpreadSide=()=>{
    const pane=paperRef.current?.closest('.spread-pane');
    const visiblePanes=Array.from(pane?.closest('.canvas-spread')?.querySelectorAll('.spread-pane')??[]).filter(item=>getComputedStyle(item).display!=='none');
    const next=pane&&visiblePanes.length===2?(pane===visiblePanes[0]?'left':'right'):undefined;
    setDomSpreadSide(current=>current===next?current:next);
  };
  useLayoutEffect(refreshSpreadSide);
  const effectiveSpreadSide=paperRef.current?.closest('.spread-pane')?domSpreadSide:spreadSide;
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

  const paperBounds: BBox = { x: 0, y: 0, w: page.canvas.w, h: page.canvas.h };
  const overlayFallbackBox = (type: 'figure' | 'bubble', index: number): BBox => pageOverlayFallbackBox(canvas, type, index);
  const overlay = page.page_overlay;
  const overlayBubbles = overlay?.bubbles ?? [];

  const panelSelectionVisible=!painting&&(!selectedElement||selectedElement.type==='panel_frame');
  const selectedPanel = page.panels[activePanel]&&panelVisible(page.panels[activePanel])?page.panels[activePanel]:undefined;
  const selectedBounds = selectedPanel ? panelBounds(selectedPanel) : null;
  const selectedItem = selectedPanel && selectedElement && selectedElement.type !== 'image' && selectedElement.type !== 'panel_frame' && selectedElement.scope !== 'page_overlay'
    ? (selectedElement.type === 'figure' ? selectedPanel.figures?.[selectedElement.index]
      : selectedElement.type === 'bubble' ? selectedPanel.bubbles[selectedElement.index]
      : selectedPanel.screen_text?.[selectedElement.index])
    : undefined;
  const selectedAnchor = selectedItem && 'anchor' in selectedItem ? selectedItem.anchor : undefined;

  return {
    bubblePathTool, paintGeometry, paintInputActive, paintWorkspace, backgroundEdit, elementLocked,
    onSelectElement, previewOwner, nativeBox, nativeStyle, canvas, editingPanel, editingOverlay, inner,
    panelMinSize, paperBoxStyle, paperRef, paperZoomFrameRef, refreshSpreadSide, effectiveSpreadSide,
    scrollRef, cleanupRef, interactionMode, setInteractionMode, activeEdgeIndex, setActiveEdgeIndex,
    fitEpoch, setFitEpoch, basePaperWidth, layoutPaperWidth, screenUnit, fitPercent, setFitPercent,
    outputWidth, outputHeight, bleedMm, cropMarks, printMarginMm, printGuideWidthMm, renderPrintGuides,
    printGuideStyle, cropMarkPath, zoomPercentRef, spacePressedRef, generationMenu, setGenerationMenu,
    generationMenuRef, openGenerationMenu, menuPanel, menuFigure, menuBubble, menuKey, menuBox,
    menuScope, menuSize, copyMenuSize, paperBounds, overlayFallbackBox, overlay, overlayBubbles,
    panelSelectionVisible, selectedPanel, selectedBounds, selectedItem, selectedAnchor,
  } as const;
}

export type CanvasSurface = ReturnType<typeof useCanvasSurface>;
