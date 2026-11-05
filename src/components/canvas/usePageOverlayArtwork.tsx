import { useMemo } from 'preact/hooks';
import type { CanvasElementSelection } from '../../types';
import { PaintOwnerPreview } from '../PaintSceneView';
import { paintReferenceBox } from '../../lib/paintDocument';
import { figureArtwork } from '../../lib/imagePlacement';
import { figureDisplayLabel, textDisplayLabel } from '../../lib/displayLabels.ts';
import { figureCanvasClass } from '../../lib/figurePresentation.ts';
import { StoredCropImage, FigureName, BubbleText, type CanvasProps } from './CanvasElements';
import FigureSizeSvg from '../FigureSizeSvg';
import { isPropPlacement } from '../../lib/catalogModel.ts';
import { Box, UserRound } from 'lucide-preact';
import CanvasContentSelection from '../CanvasContentSelection';
import { overlayTextFallbackBox } from '../../lib/pageCanvas.ts';
import { BUBBLE_MATERIAL_DRAG_TYPE } from '../../lib/bubblePresetData';
import {
  textToolCursor, textStyleOf, textStyleCss, textStyleSegments, textInlineStyleCss, canvasLengthCss,
} from '../../lib/textStyle';
import { bubbleArtIndices, bubbleVisible } from '../../lib/panelLayers';
import { letteringFigureIndex } from '../../lib/bubbleRelations';
import { bubbleStrokeWidthMm } from '../../lib/bubblePresentation.ts';
import BubbleShapeSvg from '../BubbleShapeSvg';
import PlacedImageView from '../PlacedImageView';
import { letteringGuideVisible } from '../../lib/bubblePresentation';
import { bubbleTextPosition } from '../../lib/bubbleClip.ts';
import { scenarioBubbleNeedsReview } from '../../lib/scenario';
import type { CanvasSurface } from './useCanvasSurface';
import type { ElementGestures } from './useElementGestures';
import type { PanelArtwork } from './usePanelArtwork';

export function usePageOverlayArtwork(options: CanvasProps, state: CanvasSurface, elements: ElementGestures, panelArt: PanelArtwork) {
  const {
    page, paintTarget, activePanel, onWrapScreenText, pageIndex, textTool, onEditScreenText,
    defaultBubbleFont, bubbleLineWidthMm, painting, onBubbleMaterial, onEditBubble, imageAssets,
  } = options;
  const {
    overlay, overlayBubbles, nativeBox, overlayFallbackBox, canvas, paintGeometry, editingOverlay,
    paperBounds, paperBoxStyle, elementLocked, onSelectElement, openGenerationMenu, nativeStyle,
    fitEpoch, previewOwner, bubblePathTool,
  } = state;
  const { startInteraction, nudgeElement, renderHandles, startBubbleTextDrag } = elements;
  const {
    buildBubbleConnections, isSelectedElement, agentWorking, renderArtwork, renderDirectPaint,
    renderBubblePaint, renderBubbleOriginal,
  } = panelArt;
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
    const isSelected = isSelectedElement(selection)&&!agentWorking(selection);
    const artwork = figureArtwork(figure);
    if (artwork) return renderArtwork(artwork, selection, null, paperBoxStyle, `${figureDisplayLabel(figure,figureIndex)}の画像`);
    const cropAssetId = figure.analogImport?.assetId;
    const figureClass = figureCanvasClass(figure);
    return <button
      data-content-target data-content-overlay data-content-kind="figure" data-content-index={figureIndex} data-agent-working={agentWorking(selection)||undefined} class={`canvas-element figure-guide page-overlay-element ${figureClass} ${cropAssetId ? 'has-source-crop' : ''} ${isSelected ? 'is-element-selected' : ''}`}
      style={{...paperBoxStyle(box),pointerEvents:elementLocked(selection)?'none':'auto'}} data-artwork-locked={elementLocked(selection)||undefined}
      onPointerDown={(event) => startInteraction(event, null, selection, box, 'move')}
      onClick={(event) => { event.stopPropagation(); onSelectElement(selection); }}
      onContextMenu={event => openGenerationMenu(event, 0, figureIndex, true)}
      onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openGenerationMenu(event, 0, figureIndex, true); else nudgeElement(event, paperBounds, selection, box); }}
      key={figure.analogImport?.sourceRegionId ?? `page-overlay-figure-${figureIndex}`}
      aria-label={figureDisplayLabel(figure,figureIndex)}
      tabIndex={!elementLocked(selection)&&activePanel >= 0 ? 0 : -1}
    >
      <span class="figure-native-reference" style={nativeStyle(box,referenceBox)}>{cropAssetId && <StoredCropImage assetId={cropAssetId} persistentAsset={figure.analogImport?.persistentAsset} className="figure-crop-image" />}
      {!cropAssetId && (figure.size ? <FigureSizeSvg size={figure.size} /> : isPropPlacement(figure) ? <Box size={12} /> : <UserRound size={12} />)}</span>
      <FigureName name={figureDisplayLabel(figure,figureIndex)} boxW={box.w} boxH={box.h} fitEpoch={fitEpoch} />
      <CanvasContentSelection frame={box} revision={figure} selected={isSelected&&!elementLocked(selection)} handles={visible=>renderHandles(null,selection,box,visible)}/>
    </button>;
  });
  const renderPageOverlayText=()=>(overlay?.screen_text??[]).map((screenText,index)=>{
    if(screenText.hidden===true)return renderDirectPaint(null,{below:`screen-text-${index}`});
    const selection:CanvasElementSelection={scope:'page_overlay',type:'screen_text',index};
    const box=screenText.bbox??overlayTextFallbackBox(canvas,index),isSelected=isSelectedElement(selection);
    return <div class="native-text-stack-item" key={index}>{renderDirectPaint(null,{below:`screen-text-${index}`})}<button
      onDragEnter={event=>{if(event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
      onDragOver={event=>{if(event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
      onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))event.currentTarget.classList.remove('is-material-drop-target');}}
      onDrop={event=>{event.currentTarget.classList.remove('is-material-drop-target');const id=event.dataTransfer?.getData(BUBBLE_MATERIAL_DRAG_TYPE);if(id){event.preventDefault();event.stopPropagation();onWrapScreenText?.({pageIndex:pageIndex??page.page-1,panelIndex:0,index,overlay:true,kind:'screen_text'},id);}}}
      data-content-target data-content-overlay data-content-kind="screen_text" data-content-index={index}
      class={`canvas-element screen-text-guide page-overlay-element ${screenText.orientation==='vertical'?'is-vertical':''} ${isSelected?'is-element-selected':''}`}
      style={{...paperBoxStyle(box),'--text-tool-cursor':textToolCursor(textStyleOf(screenText,'screen_text'))}} onPointerDown={event=>startInteraction(event,null,selection,box,'move')}
      onClick={event=>{event.stopPropagation();onSelectElement(selection);if(textTool)onEditScreenText?.(0,index,true);}}
      onKeyDown={event=>{nudgeElement(event,paperBounds,selection,box);}}
      aria-label={textDisplayLabel((overlay?.bubbles?.length??0)+index)} tabIndex={activePanel>=0?0:-1}>
      <span class={`screen-text-body ${screenText.orientation==='vertical'?'vertical-text':''}`} style={textStyleCss(textStyleOf(screenText,'screen_text'),canvas.w,defaultBubbleFont)}>{textStyleSegments(screenText).map((part,i)=><span key={i} style={textInlineStyleCss(part)}>{part.text}</span>)}</span>
    </button></div>;
  });
  const renderPageOverlayBubbles = (relatedFigure:number|null=null, depth:'front'|'behind'='front') => bubbleArtIndices({bubbles:overlayBubbles,layer:page.layer}).map(bubbleIndex => {
    const bubble=overlayBubbles[bubbleIndex];
    if(letteringFigureIndex(overlay??{},bubble)!==relatedFigure||relatedFigure!==null&&(bubble.lettering_depth??'front')!==depth)return null;
    const selection: CanvasElementSelection = { scope: 'page_overlay', type: 'bubble', index: bubbleIndex };
    const box = previewOwner(`bubble-${bubbleIndex}`,0,true)?.frame??bubble.bbox ?? overlayFallbackBox('bubble', bubbleIndex);
    const referenceBox=nativeBox(bubble,box,`bubble-${bubbleIndex}`,0,true);
    const referenceStyle={left:`${(referenceBox.x-box.x)/box.w*100}%`,top:`${(referenceBox.y-box.y)/box.h*100}%`,width:`${referenceBox.w/box.w*100}%`,height:`${referenceBox.h/box.h*100}%`};
    const isSelected = isSelectedElement(selection)&&!agentWorking(selection);
    const textLengthClass = bubble.text.length > 24 ? 'is-very-long' : bubble.text.length > 14 ? 'is-long' : '';
    return <div class="page-overlay-bubble-stack-item" style={{'--bubble-line-width':canvasLengthCss(bubbleStrokeWidthMm(bubble,bubbleLineWidthMm),canvas.w)}} key={`page-overlay-bubble-${bubbleIndex}`}>
      {renderDirectPaint(null,{below:`bubble-${bubbleIndex}`})}
      {bubbleVisible(bubble)&&<>{overlayBubblePresentation.elementsByBubble[bubbleIndex]?.length?<svg class="bubble-tail-layer" viewBox={`0 0 ${canvas.w} ${canvas.h}`} aria-hidden="true">{overlayBubblePresentation.elementsByBubble[bubbleIndex]}</svg>:null}
      <button
      onDragEnter={event=>{if(!painting&&!elementLocked(selection)&&event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
      onDragOver={event=>{if(!painting&&!elementLocked(selection)&&event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
      onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))event.currentTarget.classList.remove('is-material-drop-target');}}
      onDrop={event=>{event.currentTarget.classList.remove('is-material-drop-target');if(painting||elementLocked(selection))return;const id=event.dataTransfer?.getData(BUBBLE_MATERIAL_DRAG_TYPE);if(id){event.preventDefault();event.stopPropagation();onBubbleMaterial?.({pageIndex:pageIndex??page.page-1,panelIndex:0,index:bubbleIndex,overlay:true,kind:'bubble'},id);}}}
      data-content-overlay data-content-kind="bubble" data-content-index={bubbleIndex}
      data-content-target data-agent-working={agentWorking(selection)||undefined} class={`canvas-element bubble-guide page-overlay-element bubble-${bubble.shape ?? 'normal'} ${isSelected ? 'is-element-selected' : ''}`}
      style={{...paperBoxStyle(box),pointerEvents:elementLocked(selection)?'none':'auto','--text-tool-cursor':textToolCursor(textStyleOf(bubble,'bubble'))}} data-artwork-locked={elementLocked(selection)||undefined}
      onPointerDown={(event) => startInteraction(event, null, selection, box, 'move')}
      onClick={(event) => { event.stopPropagation(); onSelectElement(selection);if(textTool)onEditBubble?.({panelIndex:0,bubbleIndex,overlay:true}); }}
      onContextMenu={event=>openGenerationMenu(event,0,undefined,true,bubbleIndex)}
      onKeyDown={event=>{if(elementLocked(selection))return;if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))openGenerationMenu(event,0,undefined,true,bubbleIndex);else nudgeElement(event,paperBounds,selection,box);}}
      aria-label={textDisplayLabel(bubbleIndex)}
      tabIndex={!elementLocked(selection)&&activePanel >= 0 ? 0 : -1}
    >
      <span class="bubble-native-reference" style={referenceStyle}><BubbleShapeSvg
        shape={bubble.shape} bezier={bubble.bezier}
        composite={overlayBubblePresentation.composites[bubbleIndex]??undefined}
        seamMasks={overlayBubblePresentation.seamMasks[bubbleIndex]}
        maskId={`bubble-outline-mask-page-${page.page}-overlay-${bubbleIndex}`}
      />
      </span>
      {editingOverlay?<PaintOwnerPreview ownerKey={`bubble-${bubbleIndex}`} container={box} inkOnly nativeBand="below"/>:(bubble.paint_overlay && !bubble.paint_overlay.hidden && <span class="bubble-paint-overlay"><PlacedImageView nativeBand="below" assets={imageAssets} asset={imageAssets.find(asset=>asset.id===bubble.paint_overlay!.assetId)} image={{...bubble.paint_overlay,id:'bubble-paint',bbox:box}}/></span>)}
      <span class="bubble-native-reference bubble-native-text" style={referenceStyle}>
      {letteringGuideVisible(bubble)&&<BubbleText text={bubble.text} font={defaultBubbleFont} shape={bubble.shape} lengthClass={textLengthClass} boxW={referenceBox.w} boxH={referenceBox.h} fitEpoch={fitEpoch} position={bubbleTextPosition(bubble)} style={bubble.text_style} runs={bubble.text_runs} paperWidth={canvas.w}
          review={scenarioBubbleNeedsReview(bubble)}
          onEdit={textTool&&!elementLocked(selection)?()=>onEditBubble?.({panelIndex:0,bubbleIndex,overlay:true}):undefined}
          onMoveFrame={textTool&&!elementLocked(selection)?event=>startBubbleTextDrag(event,selection,referenceBox,bubbleTextPosition(bubble)):undefined} moveFrameActive={isSelected}/>}</span>
      <CanvasContentSelection frame={box} revision={bubble} selected={isSelected&&!elementLocked(selection)} handles={visible=>!bubblePathTool&&renderHandles(null,selection,box,visible,false)}/>
    </button></>}{!bubbleVisible(bubble)&&renderBubblePaint(bubble,bubbleIndex,box,null,'below')}{renderBubbleOriginal(bubble,null)}{renderBubblePaint(bubble,bubbleIndex,box,null,'above')}</div>;
  });

  return { renderPageOverlayFigures, renderPageOverlayText, renderPageOverlayBubbles };
}

export type PageOverlayArtwork = ReturnType<typeof usePageOverlayArtwork>;
