import { useMemo } from 'preact/hooks';
import type { BBox, VectorPoint } from '../types';
import { selectionPath } from '../lib/rasterSelection';
export default function RasterSelectionOverlay({boxes,points,width,height}:{boxes?:BBox[];points?:VectorPoint[];width:number;height:number}){
  const path=useMemo(()=>boxes?selectionPath(boxes):'',[boxes]);
  const d=points?.length?`M${points.map(p=>`${p.x},${p.y}`).join('L')}Z`:path;
  return d?<svg class="raster-selection-overlay" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="選択範囲"><path d={d} class="selection-base"/><path d={d} class="selection-dashes"/></svg>:null;
}
