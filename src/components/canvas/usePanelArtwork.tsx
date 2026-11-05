import type { CanvasElementSelection, PlacedImage, BBox, Bubble, Panel, Figure } from '../../types';
import { paintLayerHasContent } from '../../lib/paintLock';
import { figureCanvasClass } from '../../lib/figurePresentation.ts';
import PlacedImageView from '../PlacedImageView';
import CanvasContentSelection from '../CanvasContentSelection';
import {
  paintStackKey, paintAnchorIds, paintStackMatches, directPaintImages, paintReferenceBox,
} from '../../lib/paintDocument';
import { PaintOwnerPreview } from '../PaintSceneView';
import { fallbackBox, panelBounds } from '../../lib/canvasGeometry';
import { figureDisplayLabel, textDisplayLabel } from '../../lib/displayLabels.ts';
import { StoredCropImage, FigureName, layerClipStyle, BubbleText, type CanvasProps } from './CanvasElements';
import FigureSizeSvg from '../FigureSizeSvg';
import { isPropPlacement } from '../../lib/catalogModel.ts';
import { Box, UserRound } from 'lucide-preact';
import { BUBBLE_MATERIAL_DRAG_TYPE } from '../../lib/bubblePresetData';
import {
  textToolCursor, textStyleOf, textStyleCss, textStyleSegments, textInlineStyleCss, canvasLengthCss,
} from '../../lib/textStyle';
import {
  bubbleTailDisabled, bubbleTailTargetPoint, monologueTailEllipses, bubbleTailComposite,
  type BubbleSeamMask, type BubbleTailComposite, bubbleJoinGeometry,
} from '../../lib/bubbleTail.ts';
import { resolveBubbleSpeakerFigureIndex, letteringFigureIndex } from '../../lib/bubbleRelations';
import { bubbleUsesMonologueTail, bubbleStrokeWidthMm } from '../../lib/bubblePresentation.ts';
import type { VNode } from 'preact';
import { bubbleVisible, panelVisible, bubbleArtIndices } from '../../lib/panelLayers';
import { compatibleBubbleClips, bubbleTextFrame, bubbleTextPosition } from '../../lib/bubbleClip.ts';
import { useMemo } from 'preact/hooks';
import BubbleShapeSvg from '../BubbleShapeSvg';
import { letteringGuideVisible } from '../../lib/bubblePresentation';
import { scenarioBubbleNeedsReview } from '../../lib/scenario';
import type { CanvasSurface } from './useCanvasSurface';
import type { ElementGestures } from './useElementGestures';

export function usePanelArtwork(options: CanvasProps, state: CanvasSurface, elements: ElementGestures) {
  const {
    activePanel, agentWorkTarget, selectedElement, page, imageAssets, guideVisible, onWrapScreenText,
    pageIndex, textTool, onEditScreenText, defaultBubbleFont, paintTarget, bubbleLineWidthMm,
    painting, onBubbleMaterial, onEditBubble,
  } = options;
  const {
    backgroundEdit, elementLocked, canvas, onSelectElement, openGenerationMenu, editingOverlay,
    editingPanel, paintWorkspace, paperBoxStyle, nativeStyle, fitEpoch, nativeBox, paintGeometry,
    paperBounds, previewOwner, bubblePathTool,
  } = state;
  const { startInteraction, nudgeElement, renderHandles, startBubbleTextDrag } = elements;
  // 非選択パネルはパネル内（パネル基準%・クリップあり）、選択中パネルは最前面のエレメント
  // レイヤー（紙面基準%）に描くため、配置スタイルを引数で差し替える
  const agentWorking=(selection:CanvasElementSelection,panelIndex=activePanel)=>Boolean(agentWorkTarget&&agentWorkTarget.selection.type===selection.type&&agentWorkTarget.selection.index===selection.index&&(agentWorkTarget.selection.scope??'panel')===(selection.scope??'panel')&&(selection.scope==='page_overlay'||selection.scope==='page'||agentWorkTarget.panelIndex===panelIndex));
  const isSelectedElement = (selection: CanvasElementSelection) => backgroundEdit?backgroundEdit.selectedKey===`${selection.type}-${selection.index}`:selectedElement?.type === selection.type
    && selectedElement.index === selection.index
    && (selectedElement.scope ?? 'panel') === (selection.scope ?? 'panel');
  const contentSource=(selection:CanvasElementSelection,panelIndex:number|null)=>`${page.page}-${panelIndex??'page'}-${selection.scope??'panel'}-${selection.type}-${selection.index}`;
  const renderArtwork = (image: PlacedImage, selection: CanvasElementSelection, panelIndex: number | null, boxStyle: (box: BBox) => Record<string, string>, label?: string) => {
    if (image.hidden) return null;
    const hiddenOriginal=image.bubbleOriginal&&image.paint&&!image.paint.layers.some(layer=>layer.visible&&layer.opacity>0&&paintLayerHasContent(layer));
    const isLocked=elementLocked(selection,panelIndex??activePanel);
    const asset = imageAssets.find(item => item.id === image.assetId);
    const selected = (panelIndex === null || activePanel === panelIndex) && isSelectedElement(selection)&&!agentWorking(selection,panelIndex??activePanel);
    const figure=selection.type==='figure'?(selection.scope==='page_overlay'?page.page_overlay:page.panels[panelIndex??-1])?.figures?.[selection.index]:undefined;
    const figureClass=figure?figureCanvasClass(figure):'';
    const bounds = {x:0,y:0,w:canvas.w,h:canvas.h};
    return <button type="button" data-content-target data-agent-working={agentWorking(selection,panelIndex??activePanel)||undefined} data-content-panel={panelIndex??undefined} data-content-scope={selection.scope} data-content-kind={selection.type} data-content-index={selection.index} data-content-source={contentSource(selection,panelIndex)} class={`placed-image ${figureClass} ${selected && panelIndex === null && selection.scope !== 'page' ? 'is-element-selected' : ''}`} key={`${selection.type}-${selection.index}`}
      style={{...boxStyle(image.bbox),pointerEvents:isLocked||hiddenOriginal?'none':'auto'}} data-artwork-locked={isLocked||undefined} aria-label={`${label ?? '配置画像'} ${asset?.originalName ?? ''}`}
      tabIndex={!isLocked&&!hiddenOriginal&&(panelIndex === null || activePanel === panelIndex) ? 0 : -1}
      onClick={event => { event.stopPropagation(); onSelectElement(selection, panelIndex ?? undefined); }}
      onPointerDown={event => { if (!isLocked) startInteraction(event, panelIndex, selection, image.bbox, 'move'); }}
      onContextMenu={event => { if(image.generationScope)openGenerationMenu(event,image.generationScope==='page'?-1:panelIndex??0);else if (selection.type === 'figure') openGenerationMenu(event, panelIndex ?? 0, selection.index, selection.scope === 'page_overlay'); }}
      onKeyDown={event => {
        if (selection.type === 'figure' && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) openGenerationMenu(event, panelIndex ?? 0, selection.index, selection.scope === 'page_overlay');
        else if (!isLocked) nudgeElement(event, bounds, selection, image.bbox);
      }}>
      <PlacedImageView assets={imageAssets} asset={asset} image={image} />
      <CanvasContentSelection frame={image.bbox} revision={image} interactive={!isLocked&&!hiddenOriginal} selected={selected&&panelIndex===null&&selection.scope!=='page'&&!isLocked&&!hiddenOriginal} handles={visible=>renderHandles(panelIndex,selection,image.bbox,visible)}/>
    </button>;
  };
  const originalGuideVisible=(key:string,panelIndex:number,overlay=false)=>{
    const target=overlay?page.page_overlay:page.panels[panelIndex];
    const paint=key==='background'?page.panels[panelIndex]?.background_images?.[0]?.paint:key.startsWith('figure-')?target?.figures?.[Number(key.split('-')[1])]?.artwork?.paint:undefined;
    return !paint?.guideInitialized&&guideVisible(key,panelIndex,overlay);
  };
  const renderDirectPaint=(panelIndex:number|null,stack?:import('../../types').PaintStackPosition)=>{
    const scope=panelIndex===null?'page':'panel',key=paintStackKey(stack),editing=panelIndex===null?editingOverlay:editingPanel(panelIndex);
    const images=panelIndex===null?page.images:page.panels[panelIndex].images;
    const anchors=editing?paintWorkspace?.scene.anchorIds:paintAnchorIds(panelIndex===null?{...page.page_overlay,bubbles:page.page_overlay?.bubbles??[],images:page.images}:page.panels[panelIndex],panelIndex===null?page.panels:undefined);
    return <div class="direct-paint-stack" data-direct-stack={`${scope}:${key}`}>
      {editing?paintWorkspace?.scene.owners.filter(owner=>owner.kind===scope&&paintStackMatches(owner.stack,stack,anchors)).map(owner=><PaintOwnerPreview key={owner.key} ownerKey={owner.key} container={{x:0,y:0,...canvas}}/>)
        :directPaintImages(images,scope,stack,anchors).filter(image=>!image.hidden).map(image=><span class="direct-paint-artwork" key={image.id} style={paperBoxStyle(image.bbox)}><PlacedImageView assets={imageAssets} asset={imageAssets.find(asset=>asset.id===image.assetId)} image={image}/></span>)}
    </div>;
  };
  const renderBubblePaint=(bubble:Bubble,index:number,box:BBox,panelIndex:number|null,nativeBand:'above'|'below')=>{
    const editing=panelIndex===null?editingOverlay:editingPanel(panelIndex);
    return <span class={nativeBand==='above'?'bubble-paint-front':'bubble-paint-back'} style={paperBoxStyle(box)}>{editing?<PaintOwnerPreview ownerKey={`bubble-${index}`} container={box} inkOnly nativeBand={nativeBand}/>
      :bubble.paint_overlay&&!bubble.paint_overlay.hidden&&<PlacedImageView nativeBand={nativeBand} assets={imageAssets} asset={imageAssets.find(asset=>asset.id===bubble.paint_overlay!.assetId)} image={{...bubble.paint_overlay,id:'bubble-front',bbox:box}}/>}</span>;
  };
  const renderPanelBaseElements = (panel: Panel, panelIndex: number, boxStyle: (box: BBox) => Record<string, string>, only?:number|'screen') => <>
    {(panel.figures ?? []).map((figure, figureIndex) => {
      if(only!==undefined&&only!==figureIndex)return null;
      const selection: CanvasElementSelection = { type: 'figure', index: figureIndex };
      const box = figure.bbox ?? fallbackBox(panel, 'figure', figureIndex);
      const referenceBox=paintReferenceBox(figure.artwork?.paint,box,figure.artwork?.crop);
      if(editingPanel(panelIndex))return null;
      const isSelected = activePanel === panelIndex && isSelectedElement(selection)&&!agentWorking(selection,panelIndex);
      const isLocked=elementLocked(selection,panelIndex);
      const cropAssetId = figure.analogImport?.assetId;
      const figureClass = figureCanvasClass(figure);
      return <button
        data-content-target data-agent-working={agentWorking(selection,panelIndex)||undefined} data-content-panel={panelIndex} data-content-kind="figure" data-content-index={figureIndex} class={`canvas-element figure-guide ${figureClass} ${cropAssetId ? 'has-source-crop' : ''} ${isSelected ? 'is-element-selected' : ''}`}
        style={{...boxStyle(box),pointerEvents:isLocked?'none':'auto'}} data-artwork-locked={isLocked||undefined}
        onPointerDown={(event) => startInteraction(event, panelIndex, selection, box, 'move')}
        onClick={(event) => { event.stopPropagation(); onSelectElement(selection, panelIndex); }}
        onContextMenu={(event) => openGenerationMenu(event, panelIndex, figureIndex)}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openGenerationMenu(event, panelIndex, figureIndex);
          else nudgeElement(event, {x:0,y:0,w:canvas.w,h:canvas.h}, selection, box);
        }}
        key={figure.analogImport?.sourceRegionId ?? `figure-${figureIndex}`}
        aria-label={figureDisplayLabel(figure,figureIndex)}
        tabIndex={!isLocked&&activePanel === panelIndex ? 0 : -1}
      >
        <span class="figure-native-reference" style={nativeStyle(box,referenceBox)}>{cropAssetId && <StoredCropImage assetId={cropAssetId} persistentAsset={figure.analogImport?.persistentAsset} className="figure-crop-image" />}
        {!cropAssetId && (figure.size ? <FigureSizeSvg size={figure.size} /> : isPropPlacement(figure) ? <Box size={12} /> : <UserRound size={12} />)}</span>
        <FigureName name={figureDisplayLabel(figure,figureIndex)} boxW={box.w} boxH={box.h} fitEpoch={fitEpoch} />
        <CanvasContentSelection frame={box} revision={figure} selected={isSelected&&!isLocked} handles={visible=>renderHandles(panelIndex,selection,box,visible)}/>
      </button>;
    })}
    {(typeof only==='number'?[]:panel.screen_text ?? []).map((screenText, screenTextIndex) => {
      if(screenText.hidden===true)return renderDirectPaint(panelIndex,{below:`screen-text-${screenTextIndex}`});
      const selection: CanvasElementSelection = { type: 'screen_text', index: screenTextIndex };
      const box = screenText.bbox ?? fallbackBox(panel, 'screen_text', screenTextIndex);
      const isLocked=elementLocked(selection,panelIndex);
      const isSelected = !isLocked&&activePanel === panelIndex && isSelectedElement(selection);
      return <div class="native-text-stack-item" key={`screen-text-${screenTextIndex}`}>{renderDirectPaint(panelIndex,{below:`screen-text-${screenTextIndex}`})}<button
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
        aria-label={textDisplayLabel(panel.bubbles.length+screenTextIndex)}
        tabIndex={!isLocked&&activePanel === panelIndex ? 0 : -1}
      >
        <span class={`screen-text-body ${screenText.orientation === 'vertical' ? 'vertical-text' : ''}`} style={textStyleCss(textStyleOf(screenText,'screen_text'),canvas.w,defaultBubbleFont)}>{textStyleSegments(screenText).map((part,i)=><span key={i} style={textInlineStyleCss(part)}>{part.text}</span>)}</span>
      </button></div>;
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

  const renderBubbleOriginal=(bubble:Bubble,panelIndex:number|null)=>{
    const images=panelIndex===null?page.images:page.panels[panelIndex].images;
    const index=images?.findIndex(image=>image.id===bubble.analogTextImport?.originalImageId)??-1;
    if(index<0)return null;
    const image=images![index],key=`original-${image.id}`;
    return <div class="bubble-original-child" data-bubble-original={image.id}>{renderDirectPaint(panelIndex,{below:key})}
      {(panelIndex===null?editingOverlay:editingPanel(panelIndex))?<PaintOwnerPreview ownerKey={key} container={paperBounds}/>
        :renderArtwork(image,{type:'image',scope:panelIndex===null?'page':'panel',index},panelIndex,paperBoxStyle,image.bubbleOriginal?.name)}
    </div>;
  };
  // 紙面座標で描き、コマ所属のフキダシは所有コマで常に切り取る。
  const renderPanelBubbles = (panel: Panel, panelIndex: number, relatedFigure:number|null=null, depth:'front'|'behind'='front') => !panelVisible(panel)?[]:bubbleArtIndices(panel).map(bubbleIndex => {
    const bubble=panel.bubbles[bubbleIndex];
    if(letteringFigureIndex(panel,bubble)!==relatedFigure||relatedFigure!==null&&(bubble.lettering_depth??'front')!==depth)return null;
    const selection: CanvasElementSelection = { type: 'bubble', index: bubbleIndex };
    const box = previewOwner(`bubble-${bubbleIndex}`,panelIndex)?.frame??bubble.bbox ?? fallbackBox(panel, 'bubble', bubbleIndex);
    const referenceBox=nativeBox(bubble,box,`bubble-${bubbleIndex}`,panelIndex);
    const referenceStyle={left:`${(referenceBox.x-box.x)/box.w*100}%`,top:`${(referenceBox.y-box.y)/box.h*100}%`,width:`${referenceBox.w/box.w*100}%`,height:`${referenceBox.h/box.h*100}%`};
    const textFrame=bubbleTextFrame(referenceBox,panel,bubble);
    const textFrameStyle={left:`${(textFrame.x-referenceBox.x)/referenceBox.w*100}%`,top:`${(textFrame.y-referenceBox.y)/referenceBox.h*100}%`,width:`${textFrame.w/referenceBox.w*100}%`,height:`${textFrame.h/referenceBox.h*100}%`};
    const isSelected = activePanel === panelIndex && isSelectedElement(selection)&&!agentWorking(selection,panelIndex);
    const textLengthClass = bubble.text.length > 24 ? 'is-very-long' : bubble.text.length > 14 ? 'is-long' : '';
    const presentation=panelBubblePresentations[panelIndex];
    return <div class="panel-bubble-clip" style={{...layerClipStyle(panel,canvas),'--bubble-line-width':canvasLengthCss(bubbleStrokeWidthMm(bubble,bubbleLineWidthMm),canvas.w)}} key={`panel-${panelIndex}-bubble-${bubbleIndex}`}>
      {renderDirectPaint(panelIndex,{below:`bubble-${bubbleIndex}`})}
      {bubbleVisible(bubble)&&<>{presentation?.elementsByBubble[bubbleIndex]?.length?<svg class="bubble-tail-layer" viewBox={`0 0 ${canvas.w} ${canvas.h}`} aria-hidden="true">{presentation.elementsByBubble[bubbleIndex]}</svg>:null}
      <button
      onDragEnter={event=>{if(!painting&&!elementLocked(selection,panelIndex)&&event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
      onDragOver={event=>{if(!painting&&!elementLocked(selection,panelIndex)&&event.dataTransfer?.types.includes(BUBBLE_MATERIAL_DRAG_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='copy';event.currentTarget.classList.add('is-material-drop-target');}}}
      onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))event.currentTarget.classList.remove('is-material-drop-target');}}
      onDrop={event=>{event.currentTarget.classList.remove('is-material-drop-target');if(painting||elementLocked(selection,panelIndex))return;const id=event.dataTransfer?.getData(BUBBLE_MATERIAL_DRAG_TYPE);if(id){event.preventDefault();event.stopPropagation();onBubbleMaterial?.({pageIndex:pageIndex??page.page-1,panelIndex,index:bubbleIndex,overlay:false,kind:'bubble'},id);}}}
      data-content-target data-content-panel={panelIndex} data-content-kind="bubble" data-content-index={bubbleIndex} data-agent-working={agentWorking(selection,panelIndex)||undefined} class={`canvas-element bubble-guide bubble-${bubble.shape ?? 'normal'} ${isSelected ? 'is-element-selected' : ''} ${backgroundEdit&&editingPanel(panelIndex)?`background3d-layout-item ${isSelected?'background3d-layout-selected':''}`:''}`}
      data-background3d-owner={backgroundEdit&&editingPanel(panelIndex)?`bubble-${bubbleIndex}`:undefined}
      style={{...paperBoxStyle(box),pointerEvents:elementLocked(selection,panelIndex)?'none':'auto','--text-tool-cursor':textToolCursor(textStyleOf(bubble,'bubble'))}} data-artwork-locked={elementLocked(selection,panelIndex)||undefined}
      onPointerDown={(event) => startInteraction(event, panelIndex, selection, box, 'move')}
      onClick={(event) => { event.stopPropagation(); onSelectElement(selection, panelIndex);if(textTool&&!backgroundEdit)onEditBubble?.({panelIndex,bubbleIndex,overlay:false}); }}
      onContextMenu={event=>openGenerationMenu(event,panelIndex,undefined,false,bubbleIndex)}
      onKeyDown={event=>{if(elementLocked(selection,panelIndex))return;if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))openGenerationMenu(event,panelIndex,undefined,false,bubbleIndex);else nudgeElement(event,paperBounds,selection,box);}}
      aria-label={textDisplayLabel(bubbleIndex)}
      tabIndex={!elementLocked(selection,panelIndex)&&activePanel === panelIndex ? 0 : -1}
    >
      <span class="bubble-native-reference" style={referenceStyle}><BubbleShapeSvg
        shape={bubble.shape} bezier={bubble.bezier}
        composite={presentation?.composites[bubbleIndex]??undefined}
        seamMasks={presentation?.seamMasks[bubbleIndex]}
        maskId={`bubble-outline-mask-page-${page.page}-panel-${panelIndex}-${bubbleIndex}`}
      />
      </span>
      {editingPanel(panelIndex)?<PaintOwnerPreview ownerKey={`bubble-${bubbleIndex}`} container={box} inkOnly nativeBand="below"/>:(bubble.paint_overlay && !bubble.paint_overlay.hidden && <span class="bubble-paint-overlay"><PlacedImageView nativeBand="below" assets={imageAssets} asset={imageAssets.find(asset=>asset.id===bubble.paint_overlay!.assetId)} image={{...bubble.paint_overlay,id:'bubble-paint',bbox:box}}/></span>)}
      <span class="bubble-native-reference bubble-native-text" style={referenceStyle}>
      {letteringGuideVisible(bubble)&&textFrame.w>0&&textFrame.h>0&&<span class="bubble-text-frame" style={textFrameStyle}><BubbleText text={bubble.text} font={defaultBubbleFont} shape={bubble.shape} lengthClass={textLengthClass} boxW={textFrame.w} boxH={textFrame.h} fitEpoch={fitEpoch} position={bubbleTextPosition(bubble)} style={bubble.text_style} runs={bubble.text_runs} paperWidth={canvas.w}
          review={scenarioBubbleNeedsReview(bubble)}
          onEdit={textTool&&!backgroundEdit&&!elementLocked(selection,panelIndex)?()=>onEditBubble?.({panelIndex,bubbleIndex,overlay:false}):undefined}
          onMoveFrame={textTool&&!backgroundEdit&&!elementLocked(selection,panelIndex)?event=>startBubbleTextDrag(event,selection,referenceBox,bubbleTextPosition(bubble)):undefined} moveFrameActive={isSelected}/></span>}
      </span>
      <CanvasContentSelection frame={box} revision={bubble} selected={isSelected&&!elementLocked(selection,panelIndex)} handles={visible=>!backgroundEdit&&!bubblePathTool&&renderHandles(panelIndex,selection,box,visible,false)}/>
    </button></>}{!bubbleVisible(bubble)&&renderBubblePaint(bubble,bubbleIndex,box,panelIndex,'below')}{renderBubbleOriginal(bubble,panelIndex)}{renderBubblePaint(bubble,bubbleIndex,box,panelIndex,'above')}</div>;
  });

  return {
    agentWorking, isSelectedElement, contentSource, renderArtwork, originalGuideVisible,
    renderDirectPaint, renderBubblePaint, renderPanelBaseElements, buildBubbleConnections,
    renderBubbleOriginal, renderPanelBubbles,
  };
}

export type PanelArtwork = ReturnType<typeof usePanelArtwork>;
