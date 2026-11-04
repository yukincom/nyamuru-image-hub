import { type InteractionGeometry, MIN_SIZE_MM, DEFAULT_CANVAS, roundMm, clamp, type CanvasSize, PANEL_SNAP_THRESHOLD_MM, innerFrameBounds, type ResizeHandle } from './canvasBounds.ts';
import type { BBox } from '../../types';

export function resizedBox(interaction: InteractionGeometry, clientX: number, clientY: number, minSize = MIN_SIZE_MM): BBox {
  const { startBox, bounds, paperRect, mode, canvas = DEFAULT_CANVAS } = interaction;
  const dx = (clientX - interaction.startClientX) * (canvas.w / paperRect.width);
  const dy = (clientY - interaction.startClientY) * (canvas.h / paperRect.height);
  if (dx === 0 && dy === 0) return { ...startBox };
  minSize = Math.min(minSize, bounds.w, bounds.h, canvas.w / 4, canvas.h / 4);
  const minWidth = Math.min(minSize, startBox.w), minHeight = Math.min(minSize, startBox.h);
  const right = startBox.x + startBox.w;
  const bottom = startBox.y + startBox.h;
  let x = startBox.x, y = startBox.y, w = startBox.w, h = startBox.h;

  if(interaction.unbounded){
    if(mode==='move'){x+=dx;y+=dy;}
    else{
      if(mode.includes('w')){x=Math.min(x+dx,right-minWidth);w=right-x;}
      if(mode.includes('e'))w=Math.max(minWidth,w+dx);
      if(mode.includes('n')){y=Math.min(y+dy,bottom-minHeight);h=bottom-y;}
      if(mode.includes('s'))h=Math.max(minHeight,h+dy);
    }
    return {x:roundMm(x),y:roundMm(y),w:roundMm(w),h:roundMm(h)};
  }

  if (mode === 'move') {
    x = clamp(startBox.x + dx, bounds.x, bounds.x + bounds.w - startBox.w);
    y = clamp(startBox.y + dy, bounds.y, bounds.y + bounds.h - startBox.h);
  } else {
    if (mode.includes('w')) { x = clamp(startBox.x + dx, bounds.x, right - minWidth); w = right - x; }
    if (mode.includes('e')) { w = clamp(startBox.w + dx, minWidth, bounds.x + bounds.w - startBox.x); }
    if (mode.includes('n')) { y = clamp(startBox.y + dy, bounds.y, bottom - minHeight); h = bottom - y; }
    if (mode.includes('s')) { h = clamp(startBox.h + dy, minHeight, bounds.y + bounds.h - startBox.y); }
  }
  return { x: roundMm(x), y: roundMm(y), w: roundMm(w), h: roundMm(h) };
}

export function clampedPanelDelta(bounds: BBox, deltaX: number, deltaY: number, canvas: CanvasSize = DEFAULT_CANVAS, outerMargin = 0): { x: number; y: number } {
  const margin = Math.max(0, outerMargin);
  return {
    x: roundMm(clamp(deltaX, -margin - bounds.x, canvas.w + margin - (bounds.x + bounds.w))),
    y: roundMm(clamp(deltaY, -margin - bounds.y, canvas.h + margin - (bounds.y + bounds.h))),
  };
}

function snapCoordinate(value: number, targets: number[], threshold = PANEL_SNAP_THRESHOLD_MM): number {
  const nearest = targets.reduce((best, target) => (
    Math.abs(target - value) < Math.abs(best - value) ? target : best
  ), targets[0]);
  return Math.abs(nearest - value) <= threshold ? nearest : value;
}

/** コマ移動量を紙面内へ収め、外接矩形の四辺を内枠へ吸着させる。 */
export function snapPanelDeltaToInnerFrame(
  bounds: BBox,
  deltaX: number,
  deltaY: number,
  threshold = PANEL_SNAP_THRESHOLD_MM,
  canvas: CanvasSize = DEFAULT_CANVAS,
  outerMargin = 0,
): { x: number; y: number } {
  const inner = innerFrameBounds(canvas);
  const clamped = clampedPanelDelta(bounds, deltaX, deltaY, canvas, outerMargin);
  let nextX = bounds.x + clamped.x;
  let nextY = bounds.y + clamped.y;
  const innerRight = inner.x + inner.w;
  const innerBottom = inner.y + inner.h;

  const leftSnap = inner.x - nextX;
  const rightSnap = innerRight - (nextX + bounds.w);
  if (Math.min(Math.abs(leftSnap), Math.abs(rightSnap)) <= threshold) {
    nextX += Math.abs(leftSnap) <= Math.abs(rightSnap) ? leftSnap : rightSnap;
  }

  const topSnap = inner.y - nextY;
  const bottomSnap = innerBottom - (nextY + bounds.h);
  if (Math.min(Math.abs(topSnap), Math.abs(bottomSnap)) <= threshold) {
    nextY += Math.abs(topSnap) <= Math.abs(bottomSnap) ? topSnap : bottomSnap;
  }

  return clampedPanelDelta(bounds, nextX - bounds.x, nextY - bounds.y, canvas, outerMargin);
}

/** リサイズ中に動かしている辺だけを内枠へ吸着させる。 */
export function snapPanelResizeToInnerFrame(
  bounds: BBox,
  handle: Exclude<ResizeHandle, 'move'>,
  minSize = 20,
  threshold = PANEL_SNAP_THRESHOLD_MM,
  canvas: CanvasSize = DEFAULT_CANVAS,
): BBox {
  const inner = innerFrameBounds(canvas);
  let { x, y, w, h } = bounds;
  const right = x + w;
  const bottom = y + h;
  const innerRight = inner.x + inner.w;
  const innerBottom = inner.y + inner.h;

  if (handle.includes('w')) {
    const snappedX = snapCoordinate(x, [inner.x], threshold);
    if (right - snappedX >= minSize) { x = snappedX; w = right - snappedX; }
  }
  if (handle.includes('e')) {
    const snappedRight = snapCoordinate(right, [innerRight], threshold);
    if (snappedRight - x >= minSize) w = snappedRight - x;
  }
  if (handle.includes('n')) {
    const snappedY = snapCoordinate(y, [inner.y], threshold);
    if (bottom - snappedY >= minSize) { y = snappedY; h = bottom - snappedY; }
  }
  if (handle.includes('s')) {
    const snappedBottom = snapCoordinate(bottom, [innerBottom], threshold);
    if (snappedBottom - y >= minSize) h = snappedBottom - y;
  }
  return { x: roundMm(x), y: roundMm(y), w: roundMm(w), h: roundMm(h) };
}

/** 多角形コマの頂点を、近い場合だけ内枠の縦横線へ吸着させる。 */
export function snapPointToInnerFrame(
  x: number,
  y: number,
  threshold = PANEL_SNAP_THRESHOLD_MM,
  canvas: CanvasSize = DEFAULT_CANVAS,
): { x: number; y: number } {
  const inner = innerFrameBounds(canvas);
  return {
    x: roundMm(snapCoordinate(x, [inner.x, inner.x + inner.w], threshold)),
    y: roundMm(snapCoordinate(y, [inner.y, inner.y + inner.h], threshold)),
  };
}

/**
 * ドラッグ開始直後は既存のコマ間隔スナップを抑え、元位置へ戻った時は厳密に復元する。
 * これにより、開始点のすぐ横にある別の吸着候補へ逆向きに飛ばない。
 * コマスナップOFFでは0.1mm単位の微調整を許し、丸め後の完全な開始位置だけ復元する。
 */
export function resolveVertexDragStartZone(
  x: number,
  y: number,
  startX: number,
  startY: number,
  enabled = true,
  restoreThreshold = 0.5,
  suppressSnapThreshold = PANEL_SNAP_THRESHOLD_MM,
): { x: number; y: number; suppressOtherSnaps: boolean; restored: boolean } {
  const distance = Math.hypot(x - startX, y - startY);
  const effectiveRestoreThreshold = enabled ? restoreThreshold : 0.05;
  if (distance <= effectiveRestoreThreshold) {
    return { x: startX, y: startY, suppressOtherSnaps: true, restored: true };
  }
  if (!enabled) return { x, y, suppressOtherSnaps: false, restored: false };
  return {
    x,
    y,
    suppressOtherSnaps: distance <= suppressSnapThreshold,
    restored: false,
  };
}

/** 辺の2端点へ同じ移動量を適用したまま、最も近い内枠線へ吸着させる。 */
export function snapEdgeDeltaToInnerFrame(
  start: [number, number],
  end: [number, number],
  deltaX: number,
  deltaY: number,
  threshold = PANEL_SNAP_THRESHOLD_MM,
  canvas: CanvasSize = DEFAULT_CANVAS,
): { x: number; y: number } {
  const inner = innerFrameBounds(canvas);
  const innerRight = inner.x + inner.w;
  const innerBottom = inner.y + inner.h;
  const movedX = [start[0] + deltaX, end[0] + deltaX];
  const movedY = [start[1] + deltaY, end[1] + deltaY];
  const xCorrections = movedX.flatMap((value) => [inner.x - value, innerRight - value]);
  const yCorrections = movedY.flatMap((value) => [inner.y - value, innerBottom - value]);
  const closestX = xCorrections.reduce((best, value) => Math.abs(value) < Math.abs(best) ? value : best);
  const closestY = yCorrections.reduce((best, value) => Math.abs(value) < Math.abs(best) ? value : best);
  return {
    x: roundMm(deltaX + (Math.abs(closestX) <= threshold ? closestX : 0)),
    y: roundMm(deltaY + (Math.abs(closestY) <= threshold ? closestY : 0)),
  };
}
