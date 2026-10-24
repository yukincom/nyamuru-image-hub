import type { BBox, PaintMask, PaintStroke } from '../types.ts';

/** Selection boxes are copied so later selection edits do not change the mask. */
export function newPaintMask(selection:BBox[]|null=null):PaintMask {
  return {enabled:true,reveal:selection===null,strokes:selection?.length?[{
    tool:'fill',color:'#ffffff',size:1,points:[{x:0,y:0,pressure:1,time:0}],selection:selection.map(b=>({...b})),
  }]:[]};
}
export function maskStroke(stroke:PaintStroke):PaintStroke {
  return {...stroke,color:'#ffffff',...(stroke.fill?{fill:'#ffffff'}:{})};
}
