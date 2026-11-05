import type { CanvasElementSelection, BBox, BubbleTextPosition } from '../../types';
import { type ResizeHandle, resizedBox, roundMm, resolveOverlapClick, pointInPanel } from '../../lib/canvasGeometry';
import { elementContentBox, elementContentHit } from '../CanvasContentSelection';
import type { Interaction, CanvasProps } from './CanvasElements';
import { resizeImageBox } from '../../lib/imagePlacement';
import { frameFromContentEdit } from '../../lib/canvasContentGeometry';
import { normalizedBubbleTailTarget, normalizedBubbleTailRoot } from '../../lib/bubbleTail.ts';
import { useRef } from 'preact/hooks';
import { panelVisible, panelLocked } from '../../lib/panelLayers';
import type { CanvasSurface } from './useCanvasSurface';

export function useElementGestures(options: CanvasProps, state: CanvasSurface) {
  const {
    activePanel, paintTarget, textTool, page, onChangeElementBBox, onImageGesture,
    onFinishElementMove, onChangeBubbleTail, onSelectPanel, painting, zoomTool, onCreateScreenTextAt,
    onEditBubble, onEditScreenText,
  } = options;
  const {
    elementLocked, backgroundEdit, paperRef, cleanupRef, canvas, bubblePathTool, overlay,
    onSelectElement, setInteractionMode, paintWorkspace, spacePressedRef, openGenerationMenu,
  } = state;
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

  // A paint selection can leave its current scene through the same native hit geometry.
  const selectFromPaint = (event:PointerEvent,behindOwnerKey?:string,aboveNative=false):boolean => {
    const paper=paperRef.current,select=paintWorkspace?.selectLayout;
    if(!paper||!select)return false;
    const rect=paper.getBoundingClientRect();
    const point={x:(event.clientX-rect.left)*canvas.w/rect.width,y:(event.clientY-rect.top)*canvas.h/rect.height};
    if(point.x<0||point.y<0||point.x>canvas.w||point.y>canvas.h)return false;
    const preview=behindOwnerKey?paper.querySelector<HTMLElement>(`[data-paint-owner="${CSS.escape(behindOwnerKey)}"]${aboveNative?'[data-native-band="above"]':''}`):null;
    const hit=Array.from(paper.querySelectorAll<HTMLElement>('[data-content-target][data-content-kind][data-content-index]')).reverse().find(element=>{
      if(preview&&(element.contains(preview)?aboveNative:!(preview.compareDocumentPosition(element)&Node.DOCUMENT_POSITION_FOLLOWING)))return false;
      const overlay=element.hasAttribute('data-content-overlay')||element.dataset.contentScope==='page_overlay'||element.dataset.contentScope==='page',panelIndex=Number(element.dataset.contentPanel);
      if(element.hasAttribute('data-artwork-locked')||!overlay&&Number.isFinite(panelIndex)&&(!panelVisible(page.panels[panelIndex])||!pointInPanel(page.panels[panelIndex],point.x,point.y)))return false;
      if(element.dataset.contentKind==='bubble'||element.dataset.contentKind==='screen_text'){
        // The group's alpha also contains paint. Native selection must hit its own text/outline.
        const text=element.querySelector<HTMLElement>('.bubble-text-content,.screen-text-body'),box=text?.getBoundingClientRect();
        if(box&&getComputedStyle(text!).visibility!=='hidden'&&box.width&&box.height&&event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom)return true;
        return Array.from(element.querySelectorAll<SVGGeometryElement>('.bubble-native-reference .bubble-svg-surface,.bubble-native-reference .bubble-svg-outline-surface,.bubble-native-reference .bubble-svg-detail')).some(path=>{
          const matrix=path.getScreenCTM();if(!matrix)return false;
          const local=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()),style=getComputedStyle(path);
          return style.visibility!=='hidden'&&Number(style.opacity)>0&&(style.fill!=='none'&&Number(style.fillOpacity)>0&&path.isPointInFill(local)||style.stroke!=='none'&&Number(style.strokeOpacity)>0&&path.isPointInStroke(local));
        });
      }
      return elementContentHit(element,event.clientX,event.clientY);
    });
    const panelIndex=hit?.dataset.contentPanel!==undefined?Number(hit.dataset.contentPanel):page.panels.findLastIndex(panel=>panelVisible(panel)&&pointInPanel(panel,point.x,point.y));
    if(hit){
      const overlay=hit.hasAttribute('data-content-overlay')||hit.dataset.contentScope==='page_overlay';
      const selection:CanvasElementSelection={type:hit.dataset.contentKind as CanvasElementSelection['type'],index:Number(hit.dataset.contentIndex),...(overlay?{scope:'page_overlay' as const}:hit.dataset.contentScope==='page'?{scope:'page' as const}:{})};
      select({selection,panelIndex:Number.isFinite(panelIndex)&&panelIndex>=0?panelIndex:undefined,direct:paintWorkspace?.directSelection});return true;
    }
    if(behindOwnerKey||panelIndex<0)return false;
    select({selection:null,panelIndex:resolveOverlapClick(page.panels,panelIndex,activePanel,point.x,point.y),additive:event.shiftKey,direct:paintWorkspace?.directSelection});return true;
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

  return {
    startInteraction, startBubbleTailDrag, startBubbleTailRootDrag, bubbleTextDragged,
    startBubbleTextDrag, nudgeElement, renderHandles, selectPanelAt, selectFromPaint, createTextAt,
    openPanelArtworkMenu,
  };
}

export type ElementGestures = ReturnType<typeof useElementGestures>;
