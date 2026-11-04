import type { PaintStroke, PaintLayer, BBox } from '../../types.ts';
import { transformVector } from '../vectorGeometry.ts';

export function mapPaintStroke(stroke:PaintStroke,dx:number,dy:number,sx=1,sy=sx):PaintStroke {
  return {...stroke,size:stroke.size*Math.sqrt(sx*sy),
    ...(stroke.selection?{selection:stroke.selection.map(b=>({x:dx+b.x*sx,y:dy+b.y*sy,w:b.w*sx,h:b.h*sy}))}:{}),
    points:stroke.points.map(p=>({...p,x:dx+p.x*sx,y:dy+p.y*sy}))};
}

/** Map every editable part together; image crops remain in their original asset coordinates. */
export function mapPaintLayer(layer:PaintLayer,dx:number,dy:number,sx=1,sy=sx):PaintLayer {
  const box=(b:BBox):BBox=>({x:dx+b.x*sx,y:dy+b.y*sy,w:b.w*sx,h:b.h*sy});
  const stroke=(s:PaintStroke)=>mapPaintStroke(s,dx,dy,sx,sy);
  return {...layer,strokes:layer.strokes.map(stroke),
    ...(layer.image?{image:{...layer.image,bbox:box(layer.image.bbox)}}:{}),
    ...(layer.clip?{clip:box(layer.clip)}:{}),
    ...(layer.paths?{paths:layer.paths.map(path=>transformVector(path,dx,dy,sx,sy))}:{}),
    ...(layer.mask?{mask:{...layer.mask,strokes:layer.mask.strokes.map(stroke)}}:{}),
    ...(layer.tone?{tone:{...layer.tone,origin:{x:dx+(layer.tone.origin?.x??0)*sx,y:dy+(layer.tone.origin?.y??0)*sy}}}:{})};
}
