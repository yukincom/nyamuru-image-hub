import type { PanelShape } from '../types';
import type { DetectedFigureRegion } from '../lib/localBridge';

export default function PanelTemplateThumb({ shapes, figures = [], frameLineWidthMm }: { shapes: readonly PanelShape[]; figures?: readonly DetectedFigureRegion[]; frameLineWidthMm?: number }) {
  const frameStyle = frameLineWidthMm === undefined ? undefined : { strokeWidth: Math.max(1, frameLineWidthMm * 4) };
  return <svg viewBox="0 0 210 297" aria-hidden="true">
    {shapes.map((shape, index) => shape.type === 'rect'
      ? <rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} style={frameStyle} />
      : <polygon key={index} points={shape.points.map((point) => point.join(',')).join(' ')} style={frameStyle} />)}
    {figures.map((figure, index) => <rect class="detected-figure-thumb" key={`figure-${index}`} x={figure.bbox.x * 210} y={figure.bbox.y * 297} width={figure.bbox.w * 210} height={figure.bbox.h * 297} rx="2" />)}
  </svg>;
}
