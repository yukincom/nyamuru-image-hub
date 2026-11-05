import { isBalloonText } from '../../lib/bubblePresentation';
import { bubbleVisible } from '../../lib/panelLayers';
import { fallbackBox, clamp, anchorPoint } from '../../lib/canvasGeometry';
import type { Panel, TextStyle } from '../../types';
import { BubbleBezierSelection, BubbleBezierHandles } from '../BubbleBezierEditor';
import { bubbleOutlineForDirectEdit, type CanvasProps } from './CanvasElements';
import { textDisplayLabel } from '../../lib/displayLabels.ts';
import { bubbleTailDisabled, bubbleTailTargetPoint, bubbleTailGeometry } from '../../lib/bubbleTail.ts';
import { resolveBubbleSpeakerFigureIndex } from '../../lib/bubbleRelations';
import { paintReferenceBox } from '../../lib/paintDocument';
import { useState, useEffect, useLayoutEffect } from 'preact/hooks';
import { type TextSelection, selectedTextInlineStyle, type TextStylePatch, type TextStyleScope } from '../../lib/textStyle';
import type { CanvasTextTarget } from '../../lib/canvasText';
import { overlayTextFallbackBox } from '../../lib/pageCanvas.ts';
import { bubbleTextPosition } from '../../lib/bubbleClip.ts';
import type { CanvasSurface } from './useCanvasSurface';
import type { ElementGestures } from './useElementGestures';
import type { PanelArtwork } from './usePanelArtwork';

export function useCanvasSelection(options: CanvasProps, state: CanvasSurface, elements: ElementGestures, panelArt: PanelArtwork) {
  const {
    selectedElement, painting, activePanel, page, onChangeBubbleTail, pageIndex, editingText,
    textTool, defaultBubbleFont, onTextToolStyle, onTextStyle,
  } = options;
  const {
    bubblePathTool, backgroundEdit, overlay, elementLocked, previewOwner, overlayFallbackBox,
    nativeBox, paperBoxStyle, selectedPanel, screenUnit, canvas, selectedBounds, selectedItem,
    selectedAnchor, paperRef,
  } = state;
  const { startBubbleTailRootDrag, startBubbleTailDrag } = elements;
  const { agentWorking } = panelArt;
  const renderSelectedBubblePathOverlay=()=>{
    if(!bubblePathTool||!selectedElement||selectedElement.type!=='bubble'||painting||backgroundEdit)return null;
    const pageOverlay=selectedElement.scope==='page_overlay',panelIndex=pageOverlay?0:activePanel;
    const owner=pageOverlay?overlay:page.panels[panelIndex],bubble=owner?.bubbles?.[selectedElement.index];
    if(!owner||!bubble||!isBalloonText(bubble)||!bubbleVisible(bubble)||elementLocked(selectedElement,panelIndex))return null;
    const box=previewOwner(`bubble-${selectedElement.index}`,panelIndex,pageOverlay)?.frame??bubble.bbox??(pageOverlay?overlayFallbackBox('bubble',selectedElement.index):fallbackBox(owner as Panel,'bubble',selectedElement.index));
    const referenceBox=nativeBox(bubble,box,`bubble-${selectedElement.index}`,panelIndex,pageOverlay);
    return <span class="bubble-path-edit-layer" data-agent-working={agentWorking(selectedElement,panelIndex)||undefined} style={paperBoxStyle(referenceBox)}>
      {agentWorking(selectedElement,panelIndex)?<BubbleBezierSelection outline={bubbleOutlineForDirectEdit(bubble)} label="エージェントの作業対象"/>:
      <BubbleBezierHandles outline={bubbleOutlineForDirectEdit(bubble)} overlay label={`${pageOverlay?'ページ前景':''}${textDisplayLabel(selectedElement.index)} の輪郭を編集`} onChange={bezier=>onChangeBubbleTail(selectedElement,undefined,{bezier})}/>}
    </span>;
  };

  const renderBubbleTailEditor = () => {
    if (!selectedElement || selectedElement.type !== 'bubble'||agentWorking(selectedElement)) return null;
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
      {root&&<><rect class="bubble-tail-root-dot" x={root.x-3.5*screenUnit} y={root.y-3.5*screenUnit} width={7*screenUnit} height={7*screenUnit} rx={screenUnit}/><circle class="bubble-tail-root-hit" cx={root.x} cy={root.y} r={8*screenUnit} onPointerDown={event=>startBubbleTailRootDrag(event,selectedElement,bubbleBox)}></circle></>}
      <circle class="bubble-tail-target-dot" cx={target.x} cy={target.y} r={3.5*screenUnit} />
      <circle
        class="bubble-tail-target-hit"
        cx={target.x}
        cy={target.y}
        r={8*screenUnit}
        onPointerDown={(event) => startBubbleTailDrag(event, selectedElement, speakerBox)}
      ></circle>
      <rect class="anchor-indicator-label-bg" x={labelX} y={labelY} width={labelW} height={labelH} rx={3*screenUnit} />
      <text class="anchor-indicator-text" style={{fontSize:`${12*screenUnit}px`}} x={labelX + labelW / 2} y={labelY + 12*screenUnit}>{bubble.speaker}</text>
    </svg>;
  };

  const renderAnchorIndicator = () => {
    if (!selectedPanel || !selectedBounds || !selectedElement || selectedElement.type==='panel_frame' || !selectedItem || ('artwork' in selectedItem && selectedItem.artwork)) return null;
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
  const toolbarCandidate=toolbarTarget?(toolbarTarget.kind==='bubble'?(toolbarTarget.overlay?page.page_overlay?.bubbles:page.panels[toolbarTarget.panelIndex]?.bubbles)?.[toolbarTarget.index]:(toolbarTarget.overlay?page.page_overlay?.screen_text:page.panels[toolbarTarget.panelIndex]?.screen_text)?.[toolbarTarget.index]):undefined;
  const toolbarItem=toolbarCandidate;
  const renderedTextStyle=(target:CanvasTextTarget):TextStyle=>{
    const selector=target.overlay?`[data-content-overlay][data-content-kind="${target.kind}"][data-content-index="${target.index}"]`:`[data-content-panel="${target.panelIndex}"][data-content-kind="${target.kind}"][data-content-index="${target.index}"]`;
    const el=paperRef.current?.querySelector<HTMLElement>(`${selector} .bubble-text,${selector} .screen-text-body`),width=paperRef.current?.clientWidth;
    if(!el||!width)return {};
    const style=getComputedStyle(el),pt=parseFloat(style.fontSize)/width*canvas.w*72/25.4;
    return {font:defaultBubbleFont,fontSize:Math.max(4,Math.min(144,Math.round(pt*1000)/1000)),fontWeight:Number(style.fontWeight)||600};
  };
  const selectedStyles=textTarget&&textSelection&&toolbarItem&&toolbarTarget?selectedTextInlineStyle(toolbarItem,textSelection,renderedTextStyle(toolbarTarget).fontWeight):undefined;
  const changeStyle=(patch:TextStylePatch,scope:TextStyleScope='element')=>{
    const selected=Boolean(textTarget&&textSelection&&textSelection.end>textSelection.start);
    if(scope==='selection-or-typing'&&!selected)onTextToolStyle?.(patch);
    else if(toolbarTarget&&toolbarItem)onTextStyle?.(toolbarTarget,patch,textTarget?textSelection:undefined);
    else onTextToolStyle?.(patch);
  };

  const textPanel=textTarget&&!textTarget.overlay?page.panels[textTarget.panelIndex]:undefined;
  const textBubble=textTarget?.kind==='bubble'?(textTarget.overlay?overlay?.bubbles:textPanel?.bubbles)?.[textTarget.index]:undefined;
  const screenText=textTarget?.kind==='screen_text'?(textTarget.overlay?overlay?.screen_text:textPanel?.screen_text)?.[textTarget.index]:undefined;
  const textValue=textBubble?.text??screenText?.text;
  const textBox=textTarget&&textBubble?paintReferenceBox(textBubble.paint_overlay?.paint,textBubble.bbox??(textTarget.overlay?overlayFallbackBox('bubble',textTarget.index):fallbackBox(textPanel!,'bubble',textTarget.index)),textBubble.paint_overlay?.crop):screenText&&(screenText.bbox??(textTarget!.overlay?overlayTextFallbackBox(canvas,textTarget!.index):fallbackBox(textPanel!,'screen_text',textTarget!.index)));
  const textPosition=textBubble?bubbleTextPosition(textBubble):undefined;
  useLayoutEffect(()=>{
    setTextSelection(undefined);
  },[textTarget]);

  return {
    renderSelectedBubblePathOverlay, renderBubbleTailEditor, renderAnchorIndicator, textSelection,
    setTextSelection, textToolbarHost, textTarget, toolbarTarget, toolbarItem, renderedTextStyle,
    selectedStyles, changeStyle, textPanel, textBubble, screenText, textValue, textBox, textPosition,
  };
}

export type CanvasSelection = ReturnType<typeof useCanvasSelection>;
