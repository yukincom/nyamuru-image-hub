/** Rulers are transient drawing aids in paper coordinates, never artwork. */
export interface RulerPoint {x:number;y:number}
export type PaintRulerMode='radial'|'parallel';
export interface PaintRuler {
  mode:PaintRulerMode;
  origin:RulerPoint;
  angle:number;
  enabled:boolean;
}
export const RULER_TOGGLE_RADIUS=6;
export const RULER_CENTER_RADIUS=9;
export const RULER_RADIAL_RADIUS=25;
export const RULER_BAND_HALF_WIDTH=9;

/** Shared by the overlay and hit testing; all handle sizes are visible CSS pixels. */
export function paintRulerScreen(ruler:PaintRuler,scale:RulerPoint){
  const origin={x:ruler.origin.x*scale.x,y:ruler.origin.y*scale.y};
  const dx=Math.cos(ruler.angle)*scale.x,dy=Math.sin(ruler.angle)*scale.y,length=Math.hypot(dx,dy);
  const direction={x:dx/length,y:dy/length};
  const toggle=ruler.mode==='parallel'
    ?{x:origin.x-direction.x*48,y:origin.y-direction.y*48}
    :{x:origin.x+36,y:origin.y+18};
  return {origin,direction,toggle};
}

export function hitPaintRuler(ruler:PaintRuler,point:RulerPoint,scale:RulerPoint):'toggle'|'move'|'rotate'|undefined {
  const {origin,direction,toggle}=paintRulerScreen(ruler,scale);
  if(Math.hypot(point.x-toggle.x,point.y-toggle.y)<=RULER_TOGGLE_RADIUS)return 'toggle';
  const dx=point.x-origin.x,dy=point.y-origin.y;
  if(ruler.mode==='radial')return Math.hypot(dx,dy)<=RULER_RADIAL_RADIUS?'move':undefined;
  // The center moves the origin; the whole space between the outer lines rotates.
  if(Math.abs(dx)+Math.abs(dy)<=RULER_CENTER_RADIUS)return 'move';
  if(Math.abs(dx*direction.y-dy*direction.x)<=RULER_BAND_HALF_WIDTH)return 'rotate';
}

export function paintRulerAngle(origin:RulerPoint,point:RulerPoint,snap:boolean,previous:number,start?:RulerPoint):number {
  const dx=point.x-origin.x,dy=point.y-origin.y;
  if(Math.hypot(dx,dy)<1e-6)return previous;
  const from=start?{x:start.x-origin.x,y:start.y-origin.y}:undefined;
  const angle=Math.atan2(dy,dx)+(from&&Math.hypot(from.x,from.y)>1e-6?previous-Math.atan2(from.y,from.x):0);
  return snap?Math.round(angle/(Math.PI/4))*(Math.PI/4):angle;
}

/** Capture one axis per gesture. Pressure/time and all other sample fields survive. */
export function paintRulerProjection(ruler:PaintRuler|null|undefined,start:RulerPoint){
  if(!ruler?.enabled)return <T extends RulerPoint>(point:T):T=>point;
  const origin={...start};
  let direction:RulerPoint|undefined;
  if(ruler.mode==='parallel')direction={x:Math.cos(ruler.angle),y:Math.sin(ruler.angle)};
  else {
    const dx=start.x-ruler.origin.x,dy=start.y-ruler.origin.y,length=Math.hypot(dx,dy);
    if(length>1e-6)direction={x:dx/length,y:dy/length};
  }
  return <T extends RulerPoint>(point:T):T=>{
    const dx=point.x-origin.x,dy=point.y-origin.y;
    // Starting exactly at the focus establishes its axis with the first movement.
    if(!direction){const length=Math.hypot(dx,dy);if(length<=1e-6)return point;direction={x:dx/length,y:dy/length};}
    const distance=dx*direction.x+dy*direction.y;
    return {...point,x:origin.x+distance*direction.x,y:origin.y+distance*direction.y};
  };
}
