import type { Bubble, BubbleShape } from '../types';
import { bubbleBezierData } from '../lib/bubbleBezier.ts';
import { EXTRACTED_BUBBLE_ASSETS } from '../data/extractedBubbleAssets';
import type { BubbleSeamMask, BubbleTailComposite } from '../lib/bubbleTail.ts';
import { materialBubbleBezier } from '../lib/bubblePresetData.ts';

interface Props {
  shape?: BubbleShape;
  bezier?: Bubble['bezier'];
  seamMasks?: readonly BubbleSeamMask[];
  maskId?: string;
  composite?: BubbleTailComposite;
}

function parseViewBox(viewBox: string): [number, number, number, number] {
  const values = viewBox.trim().split(/\s+/).map(Number);
  return values.length === 4 && values.every(Number.isFinite)
    ? values as [number, number, number, number]
    : [0, 0, 100, 100];
}

export default function BubbleShapeSvg({ shape = 'normal', bezier, seamMasks = [], maskId, composite }: Props) {
  const materialOutline = materialBubbleBezier(shape);
  const sourcePath = bubbleBezierData(bezier ?? materialOutline);
  const customPath = composite?.path ?? sourcePath;
  if (shape === 'handwritten' && !customPath) return null;
  const extracted = !customPath && shape in EXTRACTED_BUBBLE_ASSETS
    ? EXTRACTED_BUBBLE_ASSETS[shape as keyof typeof EXTRACTED_BUBBLE_ASSETS]
    : null;
  const viewBox = extracted?.viewBox ?? '0 0 100 100';
  const [viewX, viewY, viewW, viewH] = parseViewBox(viewBox);
  const activeMaskId = maskId && seamMasks.length ? maskId : undefined;
  const maskBounds = composite?.bounds ?? { x: viewX, y: viewY, w: viewW, h: viewH };
  const renderSurface = (className: string) => {
    if (customPath) return <path class={className} d={customPath} />;
    if (shape === 'normal') return <circle class={className} cx="50" cy="50" r="50" />;
    if (shape === 'square' || shape === 'caption') return <rect class={className} x="0" y="0" width="100" height="100" rx="1" />;
    if (extracted?.type === 'path') return <path
      class={className}
      d={extracted.d}
      strokeLinejoin={extracted.strokeLinejoin}
      strokeMiterlimit={extracted.strokeMiterlimit}
      strokeDasharray={extracted.strokeDasharray || undefined}
    />;
    if (extracted?.type === 'ellipse') return <ellipse
      class={className}
      cx={extracted.cx}
      cy={extracted.cy}
      rx={extracted.rx}
      ry={extracted.ry}
      strokeLinejoin={extracted.strokeLinejoin}
      strokeMiterlimit={extracted.strokeMiterlimit}
      strokeDasharray={extracted.strokeDasharray || undefined}
    />;
    return null;
  };

  return <svg class={`bubble-shape-svg bubble-shape-${shape}`} viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
    {activeMaskId && <defs>
      <mask id={activeMaskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={maskBounds.x - viewW * 0.1} y={maskBounds.y - viewH * 0.1} width={maskBounds.w + viewW * 0.2} height={maskBounds.h + viewH * 0.2}>
        <rect x={maskBounds.x - viewW * 0.1} y={maskBounds.y - viewH * 0.1} width={maskBounds.w + viewW * 0.2} height={maskBounds.h + viewH * 0.2} fill="white" />
        {seamMasks.map((seam, index) => <polygon
          fill="black"
          points={seam.points.map(([x, y]) => `${viewX + x * viewW},${viewY + y * viewH}`).join(' ')}
          key={`seam-${index}`}
        />)}
      </mask>
    </defs>}
    {renderSurface('bubble-svg-surface')}
    <g mask={activeMaskId ? `url(#${activeMaskId})` : undefined}>
      {renderSurface('bubble-svg-outline-surface')}
      {shape === 'caption' && !sourcePath && <path class="bubble-svg-detail" d="M5 6H95M5 94H95" />}
    </g>
  </svg>;
}
