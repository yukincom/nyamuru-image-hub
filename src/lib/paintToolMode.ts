import type { PaintLayer, PaintStroke } from '../types.ts';
import type { VectorTool } from './vectorGesture.ts';
export type PaintLineKind = 'raster' | 'vector';
export type DrawingTool = PaintStroke['tool'] | VectorTool | 'lasso' | 'wand';
export type ShapeTool = 'line' | 'rectangle' | 'ellipse';
export const isShapeTool = (tool:string):tool is ShapeTool => ['line','rectangle','ellipse'].includes(tool);
/** Navigation, text and erasing never replace the remembered drawing style. */
export function nextPaintLineKind(previous:PaintLineKind,tool:DrawingTool):PaintLineKind {
  return tool==='pen'?'raster':tool==='vector-pen'?'vector':previous;
}
export function vectorInput(tool:DrawingTool,lineKind:PaintLineKind,layerKind:PaintLayer['kind'],eraserEnd=false):boolean {
  if(eraserEnd||tool==='eraser')return layerKind==='vector';
  return tool.startsWith('vector-')||(isShapeTool(tool)&&lineKind==='vector');
}
