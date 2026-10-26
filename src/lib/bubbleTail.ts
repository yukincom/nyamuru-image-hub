import type { BBox, Bubble, BubbleShape, BubbleTailRoot, BubbleTailTarget } from '../types.ts';
import { clamp } from './canvasGeometry.ts';
import { bubbleTailIsEnabled } from './bubblePresentation.ts';
import { bubbleBezierBoundaryDistance, bubbleBezierCenter, bubbleBezierPath, createBubbleBezier, isBubbleBezier } from './bubbleBezier.ts';
import { defaultVectorStyle, paperPath } from './vectorGeometry.ts';
import { materialBubbleBezier } from './bubblePresetData.ts';
import { EXTRACTED_BUBBLE_ASSETS } from '../data/extractedBubbleAssets.ts';

/** Same outline sources as BubbleShapeSvg; all computation is disposable. */
function bodyCurve(shape: BubbleShape, bezier?: Bubble['bezier']) {
  const outline = bezier ?? materialBubbleBezier(shape);
  if (isBubbleBezier(outline)) return paperPath(bubbleBezierPath(outline));
  if (shape === 'handwritten') return null;
  const curve = paperPath(bubbleBezierPath(createBubbleBezier('ellipse')));
  if (shape === 'square' || shape === 'caption') {
    curve.pathData = 'M 1 0 H 99 Q 100 0 100 1 V 99 Q 100 100 99 100 H 1 Q 0 100 0 99 V 1 Q 0 0 1 0 Z';
  } else if (shape in EXTRACTED_BUBBLE_ASSETS) {
    const source = EXTRACTED_BUBBLE_ASSETS[shape as keyof typeof EXTRACTED_BUBBLE_ASSETS];
    if (source.type === 'path') {
      const [x, y, w, h] = source.viewBox.split(/\s+/).map(Number);
      curve.pathData = source.d;
      curve.translate([-x, -y]);
      curve.scale(100 / w, 100 / h, [0, 0]);
    }
    // The extracted ellipse fills its viewBox, like the standard oval.
  }
  return curve;
}

export interface BubbleTailComposite { path: string; bounds: BBox }

/** Union the actual body and tail, then stroke that one outer boundary.
 * Body nodes and the speaker-relative tail target remain separate in OMNY.
 */
export function bubbleTailComposite(
  box: BBox, target: { x: number; y: number }, shape: BubbleShape = 'normal', bezier?: Bubble['bezier'], tailRoot?:BubbleTailRoot,
): BubbleTailComposite | null {
  if (![box.x, box.y, box.w, box.h, target.x, target.y].every(Number.isFinite) || box.w <= 0 || box.h <= 0) return null;
  const body = bodyCurve(shape, bezier);
  if (!body) return null;
  let triangle: ReturnType<typeof paperPath> | undefined;
  let union: ReturnType<typeof body.unite> | undefined;
  try {
    body.scale(box.w / 100, box.h / 100, [0, 0]);
    body.translate([box.x, box.y]);
    const geometry=bubbleTailGeometry(box,target,shape,bezier,tailRoot);
    if(!geometry)return null;
    triangle=paperPath({id:'bubble-tail',closed:true,nodes:[],style:defaultVectorStyle()});
    triangle.pathData=geometry.fillPath;
    union = body.unite(triangle, { insert: false });
    union.translate([-box.x, -box.y]);
    union.scale(100 / box.w, 100 / box.h, [0, 0]);
    const b = union.bounds;
    return { path: union.pathData, bounds: { x: b.x, y: b.y, w: b.width, h: b.height } };
  } finally { body.remove(); triangle?.remove(); union?.remove(); }
}

export function bubbleTailDisabled(bubble: Pick<Bubble, 'tail' | 'offscreen' | 'shape'>): boolean {
  return !bubbleTailIsEnabled(bubble);
}

export function bubbleTailTargetPoint(
  speakerBox: BBox,
  target: BubbleTailTarget | false | undefined,
): { x: number; y: number } {
  const normalized = target === false || target === undefined ? { x: 0.5, y: 0.5 } : target;
  return {
    x: speakerBox.x + speakerBox.w * (Number.isFinite(normalized?.x) ? normalized.x : 0.5),
    y: speakerBox.y + speakerBox.h * (Number.isFinite(normalized?.y) ? normalized.y : 0.5),
  };
}

export function normalizedBubbleTailTarget(
  speakerBox: BBox,
  point: { x: number; y: number },
): BubbleTailTarget {
  const normalizedX = speakerBox.w ? (point.x - speakerBox.x) / speakerBox.w : 0.5;
  const normalizedY = speakerBox.h ? (point.y - speakerBox.y) / speakerBox.h : 0.5;
  return {
    x: Math.round((Number.isFinite(normalizedX) ? normalizedX : 0.5) * 1000) / 1000,
    y: Math.round((Number.isFinite(normalizedY) ? normalizedY : 0.5) * 1000) / 1000,
  };
}

export function bubbleTailRootPoint(bubbleBox:BBox, root:BubbleTailRoot):{x:number;y:number} {
  return {
    x:bubbleBox.x+bubbleBox.w*(Number.isFinite(root.x)?root.x:.5),
    y:bubbleBox.y+bubbleBox.h*(Number.isFinite(root.y)?root.y:.5),
  };
}

export function normalizedBubbleTailRoot(bubbleBox:BBox, point:{x:number;y:number}):BubbleTailRoot {
  const x=bubbleBox.w?(point.x-bubbleBox.x)/bubbleBox.w:.5;
  const y=bubbleBox.h?(point.y-bubbleBox.y)/bubbleBox.h:.5;
  return {
    x:Math.round((Number.isFinite(x)?x:.5)*1000)/1000,
    y:Math.round((Number.isFinite(y)?y:.5)*1000)/1000,
  };
}

function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export interface BubbleSeamMask {
  /** フキダシbboxを0..1とした、輪郭線を隠す範囲。 */
  points: Array<[number, number]>;
}

export interface BubbleTailGeometry {
  /** 本体より背面へ置く、白いしっぽ面。 */
  fillPath: string;
  /** 根元を閉じない、左右の輪郭線。 */
  outlinePath: string;
  /** 本体側の輪郭線だけを消すSVGマスク。 */
  seamMask: BubbleSeamMask;
  /** 根元編集ハンドルを置く、実輪郭上の点。 */
  rootPoint: {x:number;y:number};
}

export interface BubbleJoinGeometry {
  /** 2つのフキダシの間を埋める白い面。重なっている場合は不要。 */
  fillPath: string | null;
  /** 結合部の上下（または左右）にだけ描く輪郭線。 */
  outlinePaths: string[];
  firstSeamMask: BubbleSeamMask;
  secondSeamMask: BubbleSeamMask;
}

interface ConnectionRoot {
  boundaryDistance: number;
  innerLeft: { x: number; y: number };
  innerRight: { x: number; y: number };
  seamMask: BubbleSeamMask;
  rootPoint: {x:number;y:number};
}

function normalizedPoint(box: BBox, point: { x: number; y: number }): [number, number] {
  return [
    box.w ? (point.x - box.x) / box.w : 0.5,
    box.h ? (point.y - box.y) / box.h : 0.5,
  ];
}

function connectionRoot(
  box: BBox,
  target: { x: number; y: number },
  shape: BubbleShape,
  extraHalfWidth = 0,
  bezier?: Bubble['bezier'],
): ConnectionRoot | null {
  const center = bubbleBezierCenter(box, bezier);
  const centerX = center?.x ?? box.x + box.w / 2;
  const centerY = center?.y ?? box.y + box.h / 2;
  const dx = target.x - centerX;
  const dy = target.y - centerY;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.5) return null;

  const radiusX = Math.max(0.5, box.w / 2);
  const radiusY = Math.max(0.5, box.h / 2);
  const rectangular = shape === 'square' || shape === 'caption';
  const boundaryScale = rectangular
    ? 1 / Math.max(Math.abs(dx) / radiusX, Math.abs(dy) / radiusY)
    : 1 / Math.sqrt((dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY));
  if (!Number.isFinite(boundaryScale)) return null;

  const directionX = dx / distance;
  const directionY = dy / distance;
  const perpendicularX = -directionY;
  const perpendicularY = directionX;
  const customDistance = bubbleBezierBoundaryDistance(box, target, bezier);
  if (isBubbleBezier(bezier) && customDistance === undefined) return null;
  const boundaryDistance = customDistance ?? distance * boundaryScale;
  const baseX = centerX + directionX * boundaryDistance;
  const baseY = centerY + directionY * boundaryDistance;
  const minSize = Math.min(box.w, box.h);
  const overlap = clamp(minSize * 0.08, 1.8, 3.6);
  const halfWidth = clamp(minSize * 0.075, 1.1, 3.2) + Math.max(0, extraHalfWidth);
  const innerCenterX = baseX - directionX * overlap;
  const innerCenterY = baseY - directionY * overlap;
  const innerLeft = {
    x: innerCenterX + perpendicularX * halfWidth,
    y: innerCenterY + perpendicularY * halfWidth,
  };
  const innerRight = {
    x: innerCenterX - perpendicularX * halfWidth,
    y: innerCenterY - perpendicularY * halfWidth,
  };

  // 面は残し、輪郭線だけを消す。線幅の変更時にも継ぎ目が再出現しないよう、
  // 接続口より少し広い帯を本体の内外へまたがせる。
  const seamHalfWidth = halfWidth + clamp(minSize * 0.025, 0.55, 1.2);
  const seamInnerDepth = overlap * 1.35;
  const seamOuterDepth = clamp(minSize * 0.055, 1.2, 2.6);
  const seamInnerCenter = {
    x: baseX - directionX * seamInnerDepth,
    y: baseY - directionY * seamInnerDepth,
  };
  const seamOuterCenter = {
    x: baseX + directionX * seamOuterDepth,
    y: baseY + directionY * seamOuterDepth,
  };
  const seamPoints = [
    { x: seamInnerCenter.x + perpendicularX * seamHalfWidth, y: seamInnerCenter.y + perpendicularY * seamHalfWidth },
    { x: seamOuterCenter.x + perpendicularX * seamHalfWidth, y: seamOuterCenter.y + perpendicularY * seamHalfWidth },
    { x: seamOuterCenter.x - perpendicularX * seamHalfWidth, y: seamOuterCenter.y - perpendicularY * seamHalfWidth },
    { x: seamInnerCenter.x - perpendicularX * seamHalfWidth, y: seamInnerCenter.y - perpendicularY * seamHalfWidth },
  ];

  return {
    boundaryDistance,
    innerLeft,
    innerRight,
    rootPoint:{x:baseX,y:baseY},
    seamMask: { points: seamPoints.map((point) => normalizedPoint(box, point)) },
  };
}

/**
 * フキダシ本体と話者側の先端を、閉じ線のない輪郭とSVGマスク用の接続口へ分ける。
 */
export function bubbleTailGeometry(
  bubbleBox: BBox,
  target: { x: number; y: number },
  shape: BubbleShape = 'normal',
  bezier?: Bubble['bezier'],
  tailRoot?: BubbleTailRoot,
): BubbleTailGeometry | null {
  const center = bubbleBezierCenter(bubbleBox, bezier);
  const centerX = center?.x ?? bubbleBox.x + bubbleBox.w / 2;
  const centerY = center?.y ?? bubbleBox.y + bubbleBox.h / 2;
  const distance = Math.hypot(target.x - centerX, target.y - centerY);
  const targetRoot = connectionRoot(bubbleBox, target, shape, 0, bezier);
  // しっぽ先端が本体内にある間は描かない。結合処理とは異なり、外へ出て初めて有効。
  if (!targetRoot || targetRoot.boundaryDistance >= distance) return null;
  const root = tailRoot ? connectionRoot(bubbleBox,bubbleTailRootPoint(bubbleBox,tailRoot),shape,0,bezier) : targetRoot;
  if(!root)return null;
  const left = root.innerLeft;
  const right = root.innerRight;
  return {
    fillPath: `M ${coordinate(left.x)} ${coordinate(left.y)} L ${coordinate(target.x)} ${coordinate(target.y)} L ${coordinate(right.x)} ${coordinate(right.y)} Z`,
    outlinePath: `M ${coordinate(left.x)} ${coordinate(left.y)} L ${coordinate(target.x)} ${coordinate(target.y)} L ${coordinate(right.x)} ${coordinate(right.y)}`,
    seamMask: root.seamMask,
    rootPoint:root.rootPoint,
  };
}

/**
 * フキダシ本体の外周と話者側の先端を結ぶ、仮のベクターしっぽ。
 * 本体との接点は形状に応じた楕円または矩形の外周へ置く。
 */
export function bubbleTailPath(
  bubbleBox: BBox,
  target: { x: number; y: number },
  shape: BubbleShape = 'normal',
): string | null {
  return bubbleTailGeometry(bubbleBox, target, shape)?.fillPath ?? null;
}

/**
 * 2つのフキダシを、編集可能な別要素のまま見た目だけ結合する。
 * 重なっている場合は接続口の輪郭だけを消し、離れている場合は白い橋を追加する。
 */
export function bubbleJoinGeometry(
  firstBox: BBox,
  firstShape: BubbleShape,
  secondBox: BBox,
  secondShape: BubbleShape,
  firstBezier?: Bubble['bezier'],
  secondBezier?: Bubble['bezier'],
): BubbleJoinGeometry | null {
  const firstCenter = bubbleBezierCenter(firstBox, firstBezier) ?? { x: firstBox.x + firstBox.w / 2, y: firstBox.y + firstBox.h / 2 };
  const secondCenter = bubbleBezierCenter(secondBox, secondBezier) ?? { x: secondBox.x + secondBox.w / 2, y: secondBox.y + secondBox.h / 2 };
  const centerDistance = Math.hypot(secondCenter.x - firstCenter.x, secondCenter.y - firstCenter.y);
  if (centerDistance < 0.5) return null;

  const initialFirstRoot = connectionRoot(firstBox, secondCenter, firstShape, 0, firstBezier);
  const initialSecondRoot = connectionRoot(secondBox, firstCenter, secondShape, 0, secondBezier);
  if (!initialFirstRoot || !initialSecondRoot) return null;
  const gap = centerDistance - initialFirstRoot.boundaryDistance - initialSecondRoot.boundaryDistance;
  const overlapExtra = gap < 0 ? clamp(-gap * 0.35, 0, Math.min(firstBox.w, firstBox.h, secondBox.w, secondBox.h) * 0.18) : 0;
  const firstRoot = overlapExtra ? connectionRoot(firstBox, secondCenter, firstShape, overlapExtra, firstBezier) : initialFirstRoot;
  const secondRoot = overlapExtra ? connectionRoot(secondBox, firstCenter, secondShape, overlapExtra, secondBezier) : initialSecondRoot;
  if (!firstRoot || !secondRoot) return null;

  // 互いのleft/rightは向きが反対なので、同じ紙面側の端点同士は first.left→second.right。
  const firstLeft = firstRoot.innerLeft;
  const firstRight = firstRoot.innerRight;
  const secondLeft = secondRoot.innerLeft;
  const secondRight = secondRoot.innerRight;
  const overlapping = gap < 0;
  return {
    fillPath: overlapping ? null : `M ${coordinate(firstLeft.x)} ${coordinate(firstLeft.y)} L ${coordinate(secondRight.x)} ${coordinate(secondRight.y)} L ${coordinate(secondLeft.x)} ${coordinate(secondLeft.y)} L ${coordinate(firstRight.x)} ${coordinate(firstRight.y)} Z`,
    outlinePaths: overlapping ? [] : [
      `M ${coordinate(firstLeft.x)} ${coordinate(firstLeft.y)} L ${coordinate(secondRight.x)} ${coordinate(secondRight.y)}`,
      `M ${coordinate(firstRight.x)} ${coordinate(firstRight.y)} L ${coordinate(secondLeft.x)} ${coordinate(secondLeft.y)}`,
    ],
    firstSeamMask: firstRoot.seamMask,
    secondSeamMask: secondRoot.seamMask,
  };
}

export interface MonologueTailEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** thinking用。人物側ほど小さく、粒の間隔が広がる2〜4個の丸を返す。 */
export function monologueTailEllipses(
  bubbleBox: BBox,
  target: { x: number; y: number },
  bezier?: Bubble['bezier'],
  tailRoot?: BubbleTailRoot,
): MonologueTailEllipse[] {
  const center = bubbleBezierCenter(bubbleBox, bezier);
  const centerX = center?.x ?? bubbleBox.x + bubbleBox.w / 2;
  const centerY = center?.y ?? bubbleBox.y + bubbleBox.h / 2;
  const dx = target.x - centerX;
  const dy = target.y - centerY;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return [];
  const radiusX = Math.max(0.5, bubbleBox.w / 2);
  const radiusY = Math.max(0.5, bubbleBox.h / 2);
  const customDistance = bubbleBezierBoundaryDistance(bubbleBox, target, bezier);
  if (isBubbleBezier(bezier) && customDistance === undefined) return [];
  const boundaryScale = customDistance === undefined ? 1 / Math.sqrt((dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY)) : customDistance / distance;
  if (!Number.isFinite(boundaryScale) || boundaryScale >= 1) return [];
  const automaticStart = {x:centerX+dx*boundaryScale,y:centerY+dy*boundaryScale};
  const root = tailRoot ? connectionRoot(bubbleBox,bubbleTailRootPoint(bubbleBox,tailRoot),'thought',0,bezier) : null;
  const start = root?.rootPoint ?? automaticStart;
  const remaining = Math.hypot(target.x - start.x, target.y - start.y);
  const fractions = remaining >= 34 ? [0.09,0.31,0.62,1] : remaining >= 18 ? [0.12, 0.48, 1] : [0.2, 1];
  const baseSizes = fractions.length === 4
    ? [{rx:3.4,ry:3.4},{rx:2.7,ry:2.7},{rx:2,ry:2},{rx:1.3,ry:1.3}]
    : fractions.length === 3
      ? [{rx:3.15,ry:3.15},{rx:2.3,ry:2.3},{rx:1.4,ry:1.4}]
      : [{rx:2.7,ry:2.7},{rx:1.4,ry:1.4}];
  // 短いしっぽでも、人物側の最後の粒が前の粒へ食い込まない大きさへ縮める。
  const sizeScale = fractions.slice(1).reduce((scale, fraction, index) => {
    const gap = (fraction - fractions[index]) * remaining;
    const verticalRadii = baseSizes[index].ry + baseSizes[index + 1].ry;
    const available = Math.max(0.05, gap - Math.min(0.35, gap * 0.2));
    return Math.min(scale, available / verticalRadii);
  }, 1);
  const sizes = baseSizes.map(({ rx, ry }) => ({ rx: rx * sizeScale, ry: ry * sizeScale }));
  return fractions.map((fraction, index) => ({
    cx: start.x + (target.x - start.x) * fraction,
    cy: start.y + (target.y - start.y) * fraction,
    ...sizes[index],
  }));
}
