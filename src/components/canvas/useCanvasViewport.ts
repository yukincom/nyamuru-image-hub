import { pixelZoomWidth, canvasZoomPercent, clampCanvasZoom, canvasZoomShortcut } from '../../lib/canvasZoom';
import { useEffect, useLayoutEffect } from 'preact/hooks';
import type { CanvasProps } from './CanvasElements';
import type { CanvasSurface } from './useCanvasSurface';

export function useCanvasViewport(options: CanvasProps, state: CanvasSurface) {
  const { spreadSide, zoomPercent, onZoomPercentChange, zoomTool } = options;
  const {
    scrollRef, paperRef, layoutPaperWidth, setFitEpoch, basePaperWidth, refreshSpreadSide,
    outputWidth, outputHeight, setFitPercent, zoomPercentRef, canvas, paintInputActive, cleanupRef,
    spacePressedRef,
  } = state;
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

  const applyPaperWidth = (targetWidth: number, centerX?: number, centerY?: number, center=false) => {
    const scroll = scrollRef.current, paper = paperRef.current;
    if (!scroll || !paper || targetWidth <= 0) return;
    const rect = paper.getBoundingClientRect();
    const spreadScroll = spreadScrollFor();
    const spreadStage = spreadScroll?.querySelector<HTMLElement>('.canvas-spread-stage');
    const surface=spreadScroll??scroll;
    const content=spreadStage?.querySelector<HTMLElement>('.canvas-spread-pair')??paper.closest<HTMLElement>('.manga-paper-zoom-frame')!;
    const before=content.getBoundingClientRect(),viewport=surface.getBoundingClientRect();
    const previousWidth=parseFloat(spreadStage?.style.getPropertyValue('--canvas-pan-x')??'')||surface.clientWidth;
    const previousHeight=parseFloat(spreadStage?.style.getPropertyValue('--canvas-pan-y')??'')||surface.clientHeight;
    const initial=Boolean(spreadStage&&!spreadStage.style.getPropertyValue('--canvas-pan-x'));
    const midX=centerX??viewport.left+surface.clientWidth/2,midY=centerY??viewport.top+surface.clientHeight/2;
    // Anchors belong to the paper/pair, never to its fixed panning gutter.
    // Keep the previous viewport center on resize, including points in the gray area.
    const ratioX=center||initial ? .5:((centerX??viewport.left+previousWidth/2)-before.left)/Math.max(1,before.width);
    const ratioY=center||initial ? .5:((centerY??viewport.top+previousHeight/2)-before.top)/Math.max(1,before.height);
    const sourceBase=basePaperWidth.current||Number(paper.dataset.basePaperWidth)||rect.width;
    const targetRatio=targetWidth/Math.max(1,sourceBase);
    const papers=spreadStage?Array.from(spreadStage.querySelectorAll<HTMLElement>('.manga-paper')).filter(item=>item.getClientRects().length>0):[paper];
    const targets=papers.map(targetPaper=>({targetPaper,base:Number(targetPaper.dataset.basePaperWidth)||sourceBase}));
    const changed=targets.some(({targetPaper,base})=>Math.abs(targetPaper.getBoundingClientRect().width-base*targetRatio)>=.1)
      ||previousWidth!==surface.clientWidth||previousHeight!==surface.clientHeight||initial;
    if(!changed&&!center){
      // The other page may already have resized this DOM node; refresh only
      // this component's derived text/handle layout, without scrolling twice.
      if(papers.includes(paper)&&Math.abs(layoutPaperWidth.current-targetWidth)>=.1)setPaperVisualWidth(paper,targetWidth,sourceBase);
      return;
    }
    if(spreadStage){
      spreadStage.style.setProperty('--canvas-pan-x',`${surface.clientWidth}px`);
      spreadStage.style.setProperty('--canvas-pan-y',`${surface.clientHeight}px`);
    }
    targets.forEach(({targetPaper,base})=>setPaperVisualWidth(targetPaper,base*targetRatio,base));
    const after=content.getBoundingClientRect();
    surface.scrollLeft+=after.left+after.width*ratioX-midX;
    surface.scrollTop+=after.top+after.height*ratioY-midY;
  };

  // Fit is a separate mode; 100% always uses the output pixels and display DPR.
  const fitPaper = (center=false) => {
    const scroll = scrollRef.current, paper = paperRef.current;
    if (!scroll || !paper) return;
    // Responsive page visibility can change without changing the fitted width.
    refreshSpreadSide();
    const spreadScroll = spreadScrollFor();
    const spreadStage = spreadScroll?.querySelector<HTMLElement>('.canvas-spread-stage');
    const sizingSurface = spreadScroll ?? scroll;
    const styles = getComputedStyle(spreadStage ?? scroll);
    const visiblePageCount = spreadStage
      ? Math.max(1, Array.from(spreadStage.querySelectorAll<HTMLElement>('.spread-pane')).filter((pane) => getComputedStyle(pane).display !== 'none').length)
      : 1;
    const insetX=spreadStage?parseFloat(styles.getPropertyValue('--canvas-fit-inset-x')):parseFloat(styles.paddingLeft);
    const insetY=spreadStage?parseFloat(styles.getPropertyValue('--canvas-fit-inset-y')):parseFloat(styles.paddingTop);
    const availW = (sizingSurface.clientWidth - 2*insetX) / visiblePageCount;
    const availH = sizingSurface.clientHeight - 2*insetY;
    if (availW <= 0 || availH <= 0) return;
    const width = Math.min(availW, availH * outputWidth / outputHeight, 760 * outputWidth / outputHeight);
    const base=pixelZoomWidth(outputWidth,window.devicePixelRatio);
    basePaperWidth.current = base;
    paper.dataset.basePaperWidth = String(base);
    setFitPercent(canvasZoomPercent(width,base));
    applyPaperWidth(zoomPercentRef.current===null?width:base*zoomPercentRef.current/100,undefined,undefined,center);
  };

  useEffect(() => {
    fitPaper(zoomPercentRef.current===null);
    const scroll = scrollRef.current;
    if (!scroll) return;
    const sizingSurface = spreadScrollFor() ?? scroll;
    const resize=()=>fitPaper();
    const observer = new ResizeObserver(resize);
    observer.observe(sizingSurface);
    window.addEventListener('resize',resize);
    return () => { observer.disconnect();window.removeEventListener('resize',resize); };
  }, [canvas.w, canvas.h, outputWidth, outputHeight, spreadSide]);

  // 片方のページで変更された共有倍率を、もう片方にも同じタイミングで適用する。
  useLayoutEffect(() => {
    zoomPercentRef.current = zoomPercent;
    if (zoomPercent===null || !basePaperWidth.current) {
      fitPaper();
      return;
    }
    applyPaperWidth(basePaperWidth.current * zoomPercent / 100);
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
    const isSpreadPartner=()=>Boolean(scroll.closest('.is-spread-partner'));
    const panSurface=spreadScroll??scroll;
    let finishPan: (() => void) | null = null;
    let pointerOverPan=panSurface.matches(':hover');
    const onPanEnter=()=>{pointerOverPan=true;};
    const onPanLeave=()=>{pointerOverPan=false;};

    const isTextEditing = (target: EventTarget | null) => target instanceof Element
      && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]'));
    const focusedControl = (target: EventTarget | null) => target instanceof Element
      && Boolean(target.closest('button, a, summary'));
    const stopPan = () => {
      finishPan?.();
      finishPan = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSpreadPartner()||event.code !== 'Space'||event.isComposing||isTextEditing(event.target)||!pointerOverPan&&focusedControl(event.target)) return;
      event.preventDefault();
      spacePressedRef.current = true;
      document.body.classList.add('is-canvas-space-pan-ready');
    };
    const onKeyUp = (event: KeyboardEvent) => {
      // A page can become the partner while Space is held. Its own pressed
      // state must still be released, even when focus moved to a page button.
      if (event.code !== 'Space' || (!spacePressedRef.current && (isSpreadPartner()||event.isComposing||isTextEditing(event.target)||!pointerOverPan&&focusedControl(event.target)))) return;
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
      if(isSpreadPartner())return;
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
    panSurface.addEventListener('pointerenter',onPanEnter);
    panSurface.addEventListener('pointerleave',onPanLeave);
    panSurface.addEventListener('pointerdown', onPanPointerDown, { capture: true });
    return () => {
      stopPan();
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', onBlur);
      panSurface.removeEventListener('pointerenter',onPanEnter);
      panSurface.removeEventListener('pointerleave',onPanLeave);
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

  return { fitPaper, zoomAt, resetZoom };
}

export type CanvasViewport = ReturnType<typeof useCanvasViewport>;
