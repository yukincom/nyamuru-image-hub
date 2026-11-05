import { createPortal } from 'preact/compat';
import CanvasTextToolbar from './CanvasTextToolbar';
import { typingTextStyle, textStyleOf, canvasLengthCss, textToolCursor, textStyleCss } from '../lib/textStyle';
import {
  panelVisible, panelArtKeys, panelFrameVisible, panelFrameSegmentsOnInnerFrame, panelGeometryLocked,
  bubbleVisible,
} from '../lib/panelLayers';
import {
  panelStyle, layerClipStyle, bboxStyle, elementPanelClipStyle, resolveCanvasProps, type MangaCanvasProps,
} from './canvas/CanvasElements';
import { panelDisplayLabel, figureDisplayLabel, textDisplayLabel } from '../lib/displayLabels.ts';
import { panelShapePoints, panelBounds } from '../lib/canvasGeometry';
import { Fragment } from 'preact';
import PaintInputSurface, { PaintOwnerPreview } from './PaintSceneView';
import PlacedImageView from './PlacedImageView';
import { figureArtwork } from '../lib/imagePlacement';
import CanvasContentSelection from './CanvasContentSelection';
import NativeTextEditor from './NativeTextEditor';
import { ZoomOut, ZoomIn } from 'lucide-preact';
import { isHandwrittenText } from '../lib/bubblePresentation';
import { artworkLocked } from '../lib/paintLock';
import { useCanvasSurface } from './canvas/useCanvasSurface';
import { useCanvasViewport } from './canvas/useCanvasViewport';
import { useElementGestures } from './canvas/useElementGestures';
import { createPanelGestures } from './canvas/panelGestures';
import { usePanelArtwork } from './canvas/usePanelArtwork';
import { usePageOverlayArtwork } from './canvas/usePageOverlayArtwork';
import { useCanvasSelection } from './canvas/useCanvasSelection';

export { BubbleText } from './canvas/CanvasElements';

export default function MangaCanvas(props: MangaCanvasProps) {
  const options = resolveCanvasProps(props);
  const state = useCanvasSurface(options);
  const viewport = useCanvasViewport(options, state);
  const elements = useElementGestures(options, state);
  const panelDrag = createPanelGestures(options, state);
  const panelArt = usePanelArtwork(options, state, elements);
  const overlayArt = usePageOverlayArtwork(options, state, elements, panelArt);
  const selection = useCanvasSelection(options, state, elements, panelArt);
  const {
    textTool, painting, zoomTool, editingText, onEndTextEdit, textSettingsOwner, textToolStyle,
    defaultBubbleFont, fontFamilies, onImageGesture, onTextHistory, onRequestFonts, paintTarget,
    showGuides, bubbleLineWidthMm, author, page, activePanel, selectedPanels, onSelectPanel,
    imageAssets, selectedElement, frameLineWidthMm, onText, zoomPercent, onZoomPercentChange,
    onGenerateComposition, dpi, onReplaceArtwork, guideVisible, onToggleGuide, onGenerateArtwork,
  } = options;
  const {
    backgroundEdit, bubblePathTool, spacePressedRef, paperRef, elementLocked, scrollRef,
    paperZoomFrameRef, outputWidth, outputHeight, printMarginMm, renderPrintGuides, interactionMode,
    canvas, openGenerationMenu, onSelectElement, printGuideStyle, printGuideWidthMm,
    effectiveSpreadSide, bleedMm, cropMarks, cropMarkPath, paperBoxStyle, inner, editingPanel,
    panelSelectionVisible, previewOwner, selectedPanel, overlay, paintWorkspace, paperBounds,
    editingOverlay, selectedBounds, activeEdgeIndex, screenUnit, zoomPercentRef, fitPercent,
    generationMenu, setGenerationMenu, generationMenuRef, menuScope, menuPanel, menuFigure,
    menuBubble, menuSize, menuBox, copyMenuSize, menuKey,
  } = state;
  const { fitPaper, zoomAt, resetZoom } = viewport;
  const {
    createTextAt, bubbleTextDragged, selectPanelAt, openPanelArtworkMenu, startInteraction,
    nudgeElement, renderHandles, selectFromPaint,
  } = elements;
  const { startPanelMove, startPanelEdgeDrag, startVertexDrag, startPanelResize } = panelDrag;
  const {
    originalGuideVisible, renderDirectPaint, renderPanelBubbles, renderArtwork,
    renderPanelBaseElements, agentWorking, contentSource,
  } = panelArt;
  const { renderPageOverlayFigures, renderPageOverlayBubbles, renderPageOverlayText } = overlayArt;
  const {
    textToolbarHost, toolbarItem, toolbarTarget, renderedTextStyle, textTarget, textSelection,
    selectedStyles, changeStyle, renderSelectedBubblePathOverlay, renderBubbleTailEditor,
    renderAnchorIndicator, textValue, textBox, textBubble, screenText, textPanel, textPosition,
    setTextSelection,
  } = selection;
  return (
    <div data-paint-canvas onClickCapture={event=>{createTextAt(event,null);}} onDblClickCapture={event=>{if(!textTool)createTextAt(event,null,true);}} class={`canvas-viewport ${textTool&&!painting?'is-text-tool':''} ${painting?'is-painting':''} ${backgroundEdit?'is-background3d-editing':''} ${zoomTool?'is-zoom-tool':''} ${!painting&&!textTool&&!zoomTool&&!bubblePathTool?'is-selection-tool':bubblePathTool==='node'?'is-direct-selection-tool':''}`} onPointerDownCapture={event=>{bubbleTextDragged.current=false;const target=event.target as Element;if(textTool&&!painting&&!backgroundEdit&&event.button===0&&!spacePressedRef.current&&paperRef.current?.contains(target)&&!target.closest('.bubble-inline-editor,.background3d-window,.bubble-text-move-frame.is-active')){event.preventDefault();event.stopPropagation();return;}if(editingText&&!target.closest('.bubble-inline-editor,.text-settings-window,.canvas-text-toolbar,.font-family-popover'))onEndTextEdit?.();}}>
      {textSettingsOwner&&textToolbarHost&&createPortal(
        <CanvasTextToolbar creating={!toolbarItem} typingStyle={typingTextStyle(textToolStyle)} style={toolbarTarget&&toolbarItem?{...renderedTextStyle(toolbarTarget),...textStyleOf(toolbarItem,toolbarTarget.kind)}:textToolStyle} defaultFont={defaultBubbleFont} fontFamilies={fontFamilies} selection={textTarget?textSelection:undefined} selectionWeight={selectedStyles?.fontWeight} selectionStyles={selectedStyles} disabled={Boolean(toolbarItem?.hidden||toolbarTarget&&elementLocked({type:toolbarTarget.kind,index:toolbarTarget.index,...(toolbarTarget.overlay?{scope:'page_overlay' as const}:{})},toolbarTarget.panelIndex))} onChange={changeStyle} onSizeGesture={toolbarItem?phase=>onImageGesture?.(phase,'text-size'):undefined} onHistory={onTextHistory} onRequestFonts={onRequestFonts}/>,
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
          class={`manga-panel ${editingPanel(panelIndex)||!originalGuideVisible('background',panelIndex) ? 'has-background-artwork' : ''} panel-bg-${panel.bg} ${panelSelectionVisible&&activePanel === panelIndex ? 'is-selected' : ''} ${panelSelectionVisible&&selectedPanels.includes(panelIndex) ? 'is-group-selected' : ''}`}
          style={panelStyle(panel, canvas)}
          onClick={(event) => {if(!createTextAt(event,panelIndex))selectPanelAt(event, panelIndex);}}
          onContextMenu={(event) => openPanelArtworkMenu(event, panelIndex)}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openGenerationMenu(event, panelIndex);
            else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectPanel(panelIndex, event.shiftKey); }
          }}
          key={`${panel.id}-${panelIndex}`}
          role="button"
          aria-pressed={panelSelectionVisible&&selectedPanels.includes(panelIndex)}
          tabIndex={0}
          aria-label={`${panelDisplayLabel(panel.id)} を編集`}

        >

        </div>
      ))}
      {page.panels.map((panel,panelIndex)=>panelVisible(panel)&&<div class={`panel-art-stack ${panelIndex===activePanel?'is-active':''}`} style={layerClipStyle(panel,canvas)} data-panel-outline={panelShapePoints(panel).map(([x,y])=>`${x/canvas.w},${y/canvas.h}`).join(' ')} key={`art-stack-${panelIndex}`}>
        {panelArtKeys(panel).map(key=>{
          if(key==='background')return <Fragment key={key}>{renderDirectPaint(panelIndex,{below:key})}<div class={`panel-art-background manga-panel ${editingPanel(panelIndex)||!originalGuideVisible('background',panelIndex)?'has-background-artwork':''} panel-bg-${panel.bg}`} style={panelStyle(panel,canvas)} key={key}>
            {editingPanel(panelIndex)?<PaintOwnerPreview ownerKey="background" container={panelBounds(panel)}/>:(!originalGuideVisible('background',panelIndex)&&panel.background_images?.map(image=>!image.hidden&&<span class="panel-background-artwork" key={image.id} style={bboxStyle(image.bbox,panel)}><PlacedImageView assets={imageAssets} asset={imageAssets.find(asset=>asset.id===image.assetId)} image={image}/></span>))}
          </div></Fragment>;
          const index=Number(key.slice(7)),figure=panel.figures![index],image=figureArtwork(figure);
          return <Fragment key={key}>{renderPanelBubbles(panel,panelIndex,index,'behind')}{renderDirectPaint(panelIndex,{below:key})}<div class="panel-art-owner" data-art-owner={key}>
            {editingPanel(panelIndex)?backgroundEdit&&previewOwner(key,panelIndex)?<button type="button" data-content-target class={`background3d-layout-item background3d-figure-move ${backgroundEdit.selectedKey===key?'background3d-layout-selected':''}`} data-background3d-owner={key} aria-label={`${figureDisplayLabel(figure,index)}の位置を移動`} style={{...paperBoxStyle(previewOwner(key,panelIndex)!.frame),pointerEvents:elementLocked({type:'figure',index},panelIndex)?'none':'auto'}} data-artwork-locked={elementLocked({type:'figure',index},panelIndex)||undefined} tabIndex={elementLocked({type:'figure',index},panelIndex)?-1:0} onPointerDown={event=>startInteraction(event,panelIndex,{type:'figure',index},previewOwner(key,panelIndex)!.frame,'move')} onClick={event=>{event.stopPropagation();if(!elementLocked({type:'figure',index},panelIndex))backgroundEdit.select(key);}} onKeyDown={event=>nudgeElement(event,panelBounds(panel),{type:'figure',index},previewOwner(key,panelIndex)!.frame)}><PaintOwnerPreview ownerKey={key} container={previewOwner(key,panelIndex)!.frame}/><CanvasContentSelection frame={previewOwner(key,panelIndex)!.frame} revision={previewOwner(key,panelIndex)!.paint} selected={backgroundEdit.selectedKey===key}/></button>:<PaintOwnerPreview ownerKey={key} container={{x:0,y:0,w:canvas.w,h:canvas.h}}/>:image?renderArtwork(image,{type:'figure',scope:'panel',index},panelIndex,paperBoxStyle,`${figureDisplayLabel(figure,index)}の画像`):renderPanelBaseElements(panel,panelIndex,paperBoxStyle,index)}
          </div>{renderPanelBubbles(panel,panelIndex,index,'front')}</Fragment>;
        })}
        {panel.images?.map((image,index)=>!image.generationScope&&!image.paintScope&&!image.bubbleOriginal&&renderArtwork(image,{type:'image',scope:'panel',index},panelIndex,paperBoxStyle))}
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
        if (!image || image.hidden||elementLocked(selectedElement)||agentWorking(selectedElement)) return null;
        const panelIndex = pageImage ? null : activePanel;
        return <div class="artwork-selection-layer" style={{pointerEvents:'none'}}>
          <div data-content-target class="placed-image-selection" style={{...paperBoxStyle(image.bbox),pointerEvents:'none'}}
            onContextMenu={event => { if(image.generationScope)openGenerationMenu(event,image.generationScope==='page'?-1:activePanel);else if (selectedElement.type === 'figure') openGenerationMenu(event, activePanel, selectedElement.index); }}
            onPointerDown={event => { if (!elementLocked(selectedElement)) startInteraction(event, panelIndex, selectedElement, image.bbox, 'move'); }}>
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
      <div class="panel-direct-paint-layer">
        {page.panels.map((panel,panelIndex)=>panelVisible(panel)&&<div key={panel.id} style={{position:'absolute',inset:0,...layerClipStyle(panel,canvas),pointerEvents:'none'}}>
        {renderDirectPaint(panelIndex)}
        </div>)}
      </div>
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
      {showGuides&&<svg class="panel-frame-inner-overlay" viewBox={`0 0 ${canvas.w} ${canvas.h}`} strokeWidth={frameLineWidthMm} aria-hidden="true">
        {page.panels.flatMap((panel,panelIndex)=>panelFrameVisible(panel)?panelFrameSegmentsOnInnerFrame(panel,inner).map((segment,segmentIndex)=><line {...segment} key={`inner-frame-${panelIndex}-${segmentIndex}`}/>):[])}
      </svg>}
      <div class="page-panel-direct-layer">{page.panels.map(panel=><Fragment key={panel.id}>{renderDirectPaint(null,{beforePanel:`panel-${panel.id}`})}</Fragment>)}</div>
      {(overlay?.figures?.length ?? 0) > 0 && <div class="page-overlay-figure-layer">
        {renderPageOverlayFigures().map((figure,index)=><div class="page-overlay-figure-stack-item" data-art-owner={`figure-${index}`} key={index}>{renderPageOverlayBubbles(index,'behind')}{renderDirectPaint(null,{below:`figure-${index}`})}<div class="page-overlay-figure-artwork">{figure}</div>{renderPageOverlayBubbles(index,'front')}</div>)}
      </div>}
      {(overlay?.screen_text?.length??0)>0&&<div class="page-overlay-text-layer">{renderPageOverlayText()}</div>}
      {(overlay?.bubbles?.length ?? 0) > 0 && <div class="page-overlay-bubble-layer">
        {renderPageOverlayBubbles()}
      </div>}
      <div class="page-direct-paint-layer">
        {renderDirectPaint(null)}
      </div>
      {renderSelectedBubblePathOverlay()}
      <div class="generated-composition-layer" style={{position:'absolute',inset:0,zIndex:20,pointerEvents:'none'}}>
        {page.panels.map((panel,panelIndex)=>panelVisible(panel)&&<div style={{position:'absolute',inset:0,...layerClipStyle(panel,canvas),pointerEvents:'none'}}>
          {panel.images?.map((image,index)=>image.generationScope&&!image.paintScope&&renderArtwork(image,{type:'image',scope:'panel',index},panelIndex,paperBoxStyle,`コマ ${panel.id}の生成画像`))}
        </div>)}
        {page.images?.map((image,index)=>image.generationScope&&!image.paintScope&&renderArtwork(image,{type:'image',scope:'page',index},null,paperBoxStyle,'ページの生成画像'))}
      </div>
      <div class="original-raster-layer">
        {page.panels.map((panel,panelIndex)=>panelVisible(panel)&&<div key={panel.id} style={{position:'absolute',inset:0,...layerClipStyle(panel,canvas),pointerEvents:'none'}}>
          {editingPanel(panelIndex)?paintWorkspace?.scene.owners.filter(owner=>owner.kind==='original'&&!owner.parentKey).map(owner=><Fragment key={owner.key}>{renderDirectPaint(panelIndex,{below:owner.key})}<PaintOwnerPreview ownerKey={owner.key} container={paperBounds}/></Fragment>)
            :panel.images?.map((image,index)=>image.bubbleOriginal&&!panel.bubbles.some(bubble=>bubble.analogTextImport?.originalImageId===image.id)&&<Fragment key={image.id}>{renderDirectPaint(panelIndex,{below:`original-${image.id}`})}{renderArtwork(image,{type:'image',scope:'panel',index},panelIndex,paperBoxStyle,image.bubbleOriginal.name)}</Fragment>)}
        </div>)}
        {editingOverlay?paintWorkspace?.scene.owners.filter(owner=>owner.kind==='original'&&!owner.parentKey).map(owner=><Fragment key={owner.key}>{renderDirectPaint(null,{below:owner.key})}<PaintOwnerPreview ownerKey={owner.key} container={paperBounds}/></Fragment>)
          :page.images?.map((image,index)=>image.bubbleOriginal&&!overlay?.bubbles?.some(bubble=>bubble.analogTextImport?.originalImageId===image.id)&&<Fragment key={image.id}>{renderDirectPaint(null,{below:`original-${image.id}`})}{renderArtwork(image,{type:'image',scope:'page',index},null,paperBoxStyle,image.bubbleOriginal.name)}</Fragment>)}
      </div>
      {!painting&&renderBubbleTailEditor()}
      {panelSelectionVisible&&selectedPanels.length > 1 && <svg class="panel-group-selection-overlay" viewBox={`0 0 ${canvas.w} ${canvas.h}`} aria-hidden="true">
        {selectedPanels.filter((panelIndex) => panelIndex !== activePanel).map((panelIndex) => {
          const panel = page.panels[panelIndex];
          if (!panel||!panelVisible(panel)) return null;
          return panel.shape.type === 'rect'
            ? <rect x={panel.shape.x} y={panel.shape.y} width={panel.shape.w} height={panel.shape.h} key={`group-${panelIndex}`} />
            : <polygon points={panel.shape.points.map(([x, y]) => `${x},${y}`).join(' ')} key={`group-${panelIndex}`} />;
        })}
      </svg>}
      {panelSelectionVisible&&selectedPanel && selectedBounds && <svg class={`panel-selection-overlay ${panelGeometryLocked(selectedPanel)?'is-locked':''}`} viewBox={`0 0 ${canvas.w} ${canvas.h}`} aria-hidden="true" onContextMenu={(event) => openGenerationMenu(event, activePanel)}>
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

            </line>
            <circle class="panel-edge-midpoint" cx={midpoint[0]} cy={midpoint[1]} r={2.5*screenUnit} />
            <circle class="panel-edge-midpoint-hit" cx={midpoint[0]} cy={midpoint[1]} r={7*screenUnit} onPointerDown={(event)=>startPanelEdgeDrag(event,edgeIndex)}>

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

            </rect>
          </g>;
        })}
        {!panelGeometryLocked(selectedPanel)&&selectedPanel.shape.type === 'polygon' && selectedPanel.shape.points.map(([x, y], vertexIndex) => <g class="panel-vertex-handle" key={`vertex-${vertexIndex}`}>
          <circle class="panel-vertex-dot" cx={x} cy={y} r={3.5*screenUnit} />
          <rect class="panel-resize-hit" x={x - 7*screenUnit} y={y - 7*screenUnit} width={14*screenUnit} height={14*screenUnit} onPointerDown={(event) => startVertexDrag(event, vertexIndex)}>

          </rect>
        </g>)}
        {renderAnchorIndicator()}
      </svg>}
      </div>
      {painting&&paintTarget&&<PaintInputSurface canvas={canvas} onSelectionMiss={selectFromPaint}/>}
      {textTarget&&textValue!==undefined&&textBox&&(!textBubble||bubbleVisible(textBubble))&&screenText?.hidden!==true&&!painting&&<div class={`bubble-inline-editor is-${textTarget.kind==='screen_text'?'screen-text':'bubble'} ${screenText?(textStyleOf(screenText,'screen_text').orientation==='vertical'?'is-vertical':'is-horizontal'):''}`} style={{...paperBoxStyle(textBox),...(textBubble&&!textTarget.overlay?elementPanelClipStyle(textPanel!,textBox):{}),...(textPosition?{'--bubble-text-x':`${textPosition.x*100}%`,'--bubble-text-y':`${textPosition.y*100}%`}:{})}}>
        <NativeTextEditor key={JSON.stringify(textTarget)} text={textValue} runs={(textBubble??screenText)?.text_runs} inlineStyle={(textBubble??screenText)?.text_style} label={`${textDisplayLabel(textTarget.index+(textTarget.kind==='screen_text'?((textTarget.overlay?overlay:textPanel)?.bubbles?.length??0):0))}の本文`} style={textStyleCss({...renderedTextStyle(textTarget),...textStyleOf((textBubble??screenText)!,textTarget.kind)},canvas.w,defaultBubbleFont)}
          onText={(value,edit)=>onText?.(textTarget,value,edit)} onHistory={onTextHistory} onSelection={value=>setTextSelection(previous=>previous?.start===value.start&&previous?.end===value.end?previous:value)} onEnd={()=>onEndTextEdit?.()}/>

      </div>}
      </div>
      </div>
      </div>
      <div class="canvas-zoom-controls" onClick={event=>{
        // Pointer clicks return shortcuts to the canvas; keyboard activation keeps focus.
        if(event.detail>0&&event.target instanceof Element)event.target.closest<HTMLButtonElement>('button')?.blur();
      }}>
        <button type="button" class="zoom-fit" aria-pressed={zoomPercent===null} onClick={()=>{zoomPercentRef.current=null;onZoomPercentChange(null);fitPaper(true);}} >全体</button>
        <button type="button" onClick={() => zoomAt(1 / 1.25)} aria-label="縮小" ><ZoomOut size={14} /></button>
        <button type="button" class="zoom-reset" onClick={resetZoom} aria-label="100%表示" >{zoomPercent??fitPercent}%</button>
        <button type="button" onClick={() => zoomAt(1.25)} aria-label="拡大" ><ZoomIn size={14} /></button>
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
          <strong>{menuScope==='page'?'ページ全体':`${generationMenu.overlay ? 'ページ前景' : panelDisplayLabel(menuPanel?.id ?? 0)}${menuScope?'':` · ${menuFigure?.name ?? (menuBubble?isHandwrittenText(menuBubble)?'描き文字':'吹き出し':'背景')}`}`}</strong>
          {menuScope&&onGenerateComposition&&<button role="menuitem" onClick={()=>{onGenerateComposition(menuScope,generationMenu.panelIndex);setGenerationMenu(null);}}>{menuScope==='page'?'ページ全体を生成':'このコマを生成'}</button>}
          {menuScope!=='page'&&<>
          {menuSize && <small>{menuSize.width} × {menuSize.height} px（{dpi} dpi換算）</small>}
          <button role="menuitem" disabled={!menuBox} onClick={copyMenuSize}>サイズコピー</button>
          {onReplaceArtwork && <button role="menuitem" disabled={Boolean(menuFigure&&artworkLocked(menuFigure.artwork))} onClick={() => { onReplaceArtwork(generationMenu.panelIndex, generationMenu.figureIndex, generationMenu.overlay,generationMenu.bubbleIndex); setGenerationMenu(null); }}>画像を読み込む</button>}
          {!menuFigure&&!menuBubble&&<button role="menuitemcheckbox" aria-checked={guideVisible(menuKey,generationMenu.panelIndex,generationMenu.overlay)} onClick={()=>{onToggleGuide(menuKey,generationMenu.panelIndex,generationMenu.overlay);setGenerationMenu(null);}}>あたり画像表示</button>}
          {(!menuBubble||isHandwrittenText(menuBubble))&&<button role="menuitem" onClick={()=>{onGenerateArtwork(menuKey,generationMenu.panelIndex,generationMenu.overlay);setGenerationMenu(null);}}>{menuFigure?'人物単品を生成':menuBubble?'描き文字を生成':'背景だけ生成'}</button>}</>}
        </div>
      </>, window.document.body)}
    </div>
  );
}
