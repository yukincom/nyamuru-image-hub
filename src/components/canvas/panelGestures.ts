import { panelGeometryLocked } from '../../lib/panelLayers';
import {
  snapPanelDeltaToInnerFrame, clampedPanelDelta, type ResizeHandle, type InteractionGeometry, resizedBox,
  snapPanelResizeToInnerFrame, panelShapePoints, createShiftAxisSession, resolveShiftAxisSession,
  type DragAxis, snapEdgeDeltaToInnerFrame, type PanelEdgeReference, snapPanelEdgeDeltaToGutter,
  snapPanelEdgeDeltaToNeighbor, roundMm, clamp, resolveVertexDragStartZone, snapPointToInnerFrame,
  snapPanelVertexPointToGutter,
} from '../../lib/canvasGeometry';
import type { CanvasProps } from './CanvasElements';
import type { CanvasSurface } from './useCanvasSurface';

export function createPanelGestures(options: CanvasProps, state: CanvasSurface) {
  const {
    innerFrameSnap, onMovePanel, activePanel, onResizePanel, panelGapSnap, page, panelGutters,
    panelSync, onMovePanelEdge, onMoveVertex,
  } = options;
  const {
    selectedPanel, selectedBounds, paperRef, onSelectElement, setInteractionMode, canvas, bleedMm,
    cleanupRef, panelMinSize, setActiveEdgeIndex,
  } = state;
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

  return {
    startPanelMove, startPanelResize, startPanelEdgeDrag, startVertexDrag,
  };
}

export type PanelGestures = ReturnType<typeof createPanelGestures>;
