import { Box3, Matrix4, PerspectiveCamera, Quaternion, Spherical, Vector3 } from 'three';
import type { BackgroundCapture } from '../types.ts';

type Camera=BackgroundCapture['camera'];
type Point=[number,number,number];
/** Slide the picture inside its frame without moving the camera or orbit pivot. */
export function shiftBackgroundCamera(camera:Camera,dx:number,dy:number):Camera {
  return {...camera,shift:[(camera.shift?.[0]??0)+dx,(camera.shift?.[1]??0)+dy]};
}
/** Off-axis projection gives every depth the same 2D translation. */
export function applyBackgroundCameraShift(lens:PerspectiveCamera,camera:Camera):void {
  const [x,y]=camera.shift??[0,0];
  if(x||y)lens.setViewOffset(lens.aspect,1,-x*lens.aspect,-y,lens.aspect,1);
  else lens.clearViewOffset();
}
/** Apply the control's rotation/zoom about a surface point, retaining its screen
 * position instead of recentering the view when the orbit pivot changes. */
export function pivotBackgroundCamera(before:Camera,after:Camera,pivot:Point):Camera {
  const position=new Vector3(...before.position),target=new Vector3(...before.target),point=new Vector3(...pivot);
  const orientation=(view:Camera)=>new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(...view.position),new Vector3(...view.target),new Vector3(0,1,0)));
  const rotation=orientation(after).multiply(orientation(before).invert());
  const scale=new Vector3(...after.position).distanceTo(new Vector3(...after.target))/Math.max(1e-12,position.distanceTo(target));
  const move=(value:Vector3)=>value.sub(point).applyQuaternion(rotation).multiplyScalar(scale).add(point).toArray();
  return {...after,position:move(position),target:move(target)};
}
/** Move to the selected bounds while preserving the viewing direction and lens. */
export function focusBackgroundCamera(camera:Camera,bounds:Box3,aspect:number):Camera {
  if(bounds.isEmpty())return camera;
  const target=bounds.getCenter(new Vector3()),radius=Math.max(1e-6,bounds.getSize(new Vector3()).length()/2);
  const vertical=camera.fov*Math.PI/360,horizontal=Math.atan(Math.tan(vertical)*Math.max(.001,aspect));
  const distance=radius/Math.sin(Math.min(vertical,horizontal))*1.08;
  const direction=new Vector3(...camera.position).sub(new Vector3(...camera.target));
  if(direction.lengthSq()<1e-16)direction.set(4,3,5);
  return {...camera,shift:undefined,target:target.toArray(),position:target.clone().add(direction.normalize().multiplyScalar(distance)).toArray()};
}

/** Centre a picked surface point without changing lens, distance or orientation. */
export function focusBackgroundPointCamera(camera:Camera,point:[number,number,number]):Camera {
  const offset=new Vector3(...point).sub(new Vector3(...camera.target));
  return {...camera,shift:undefined,target:[...point],position:new Vector3(...camera.position).add(offset).toArray()};
}

/** Dolly changes distance, retaining the point of interest and field of view. */
export function dollyBackgroundCamera(camera:Camera,factor:number,min=1e-6,max=1e12,pivot?:Point):Camera {
  if(!Number.isFinite(factor)||factor<=0)return camera;
  const target=new Vector3(...camera.target),offset=new Vector3(...camera.position).sub(target);
  const next={...camera,position:offset.setLength(Math.max(min,Math.min(max,offset.length()*factor))).add(target).toArray(),target:[...camera.target] as Point};
  return pivot?pivotBackgroundCamera(camera,next,pivot):next;
}
export const backgroundViewAxes=[
  {id:'x',label:'X',color:'#d84256',direction:[1,0,0]},
  {id:'y',label:'Y',color:'#329b4b',direction:[0,1,0]},
  {id:'z',label:'Z',color:'#327bd7',direction:[0,0,1]},
] as const;

/** Orbit about the existing point of interest without changing framing distance. */
export function orbitBackgroundCamera(camera:Camera,dx:number,dy:number,pivot?:Point):Camera {
  const target=new Vector3(...camera.target),offset=new Vector3(...camera.position).sub(target);
  const spherical=new Spherical().setFromVector3(offset);
  spherical.theta-=dx*Math.PI/150;spherical.phi-=dy*Math.PI/150;spherical.makeSafe();
  const next={...camera,position:new Vector3().setFromSpherical(spherical).add(target).toArray(),target:[...camera.target] as Point};
  return pivot?pivotBackgroundCamera(camera,next,pivot):next;
}

export function backgroundCameraAtAxis(camera:Camera,axis:string,pivot?:Point):Camera {
  const view=backgroundViewAxes.find(item=>item.id===axis.replace('-',''));
  if(!view)return camera;
  const target=new Vector3(...camera.target),distance=Math.max(.001,new Vector3(...camera.position).distanceTo(target));
  const direction=new Vector3(...view.direction).multiplyScalar(axis.startsWith('-')?-1:1);
  // OrbitControls uses Y-up. Avoid an undefined azimuth at the exact poles.
  if(view.id==='y')direction.z=1e-6;
  const next={...camera,position:direction.normalize().multiplyScalar(distance).add(target).toArray(),target:[...camera.target] as Point};
  return pivot?pivotBackgroundCamera(camera,next,pivot):next;
}

export function backgroundAxisProjection(camera:Camera){
  const inverse=new Matrix4().lookAt(new Vector3(...camera.position),new Vector3(...camera.target),new Vector3(0,1,0)).invert();
  return backgroundViewAxes.flatMap(axis=>[1,-1].map(sign=>{
    const point=new Vector3(...axis.direction).multiplyScalar(sign).transformDirection(inverse);
    return {...axis,id:`${sign<0?'-':''}${axis.id}`,positive:sign>0,x:point.x,y:point.y,z:point.z};
  })).sort((a,b)=>a.z-b.z);
}
