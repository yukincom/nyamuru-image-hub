import { Box3, Vector3 } from 'three';
import type { BackgroundCapture } from '../types.ts';
import type { GeometryMesh } from './background3dGeometry.ts';

export interface BackgroundLightingShape {meshes:GeometryMesh[];bounds:Box3;meshNames?:string[];windowMeshes?:number[];groups?:number[][]}
export interface BackgroundWindow {mesh:number;indices:number[];centre:Vector3;normal:Vector3;right:Vector3;up:Vector3;width:number;height:number}
export const backgroundLightPresets=[{value:'daylight',label:'昼の窓光'},{value:'evening',label:'夕方の窓光'},{value:'indoor',label:'室内灯'}] as const;
export function backgroundLightSettings(light:BackgroundCapture['light']){
  return {...light,preset:light.preset??'daylight',intensity:light.intensity??1,bounce:light.bounce??1};
}
export function backgroundMeshBounds(mesh:GeometryMesh){const box=new Box3();for(let i=0;i<mesh.positions.length;i+=3)box.expandByPoint(new Vector3().fromArray(mesh.positions,i));return box;}
/** A named main floor is a better probe volume than annexes or stray furniture. */
export function backgroundRoomBounds(shape:BackgroundLightingShape):Box3 {
  let floor:Box3|undefined,area=0;
  shape.meshes.forEach((mesh,i)=>{
    if(!/(?:^|[_\s])floor(?:[_\s]|$)|床/i.test(shape.meshNames?.[i]??''))return;
    const box=backgroundMeshBounds(mesh),size=box.getSize(new Vector3()),a=size.x*size.z;
    if(size.y<Math.min(size.x,size.z)*.15&&a>area){floor=box;area=a;}
  });
  const box=shape.bounds.clone();
  if(floor){box.min.x=floor.min.x;box.max.x=floor.max.x;box.min.z=floor.min.z;box.max.z=floor.max.z;box.min.y=floor.max.y;}
  return box;
}
/** Derive a real surface orientation, including rotated windows. */
export function backgroundWindow(shape:BackgroundLightingShape,indices:number[]):BackgroundWindow|undefined {
  const valid=[...new Set(indices)].filter(i=>shape.meshes[i]);if(!valid.length)return;
  let area=0;const normal=new Vector3(),bounds=new Box3();
  for(const index of valid){
    const mesh=shape.meshes[index],a=new Vector3(),b=new Vector3(),c=new Vector3();
    bounds.union(backgroundMeshBounds(mesh));
    for(let i=0;i<mesh.indices.length;i+=3){
      a.fromArray(mesh.positions,mesh.indices[i]*3);b.fromArray(mesh.positions,mesh.indices[i+1]*3);c.fromArray(mesh.positions,mesh.indices[i+2]*3);
      const n=b.sub(a).cross(c.sub(a)),size=n.lengthSq();if(size>area){area=size;normal.copy(n).normalize();}
    }
  }
  if(area<1e-20)return;
  const centre=bounds.getCenter(new Vector3()),room=backgroundRoomBounds(shape).getCenter(new Vector3());
  if(normal.dot(room.sub(centre))<0)normal.negate();
  const right=new Vector3(0,1,0).cross(normal);if(right.lengthSq()<.01)right.set(1,0,0);right.normalize();
  const up=normal.clone().cross(right).normalize();let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const index of valid){const positions=shape.meshes[index].positions;for(let i=0;i<positions.length;i+=3){const p=new Vector3().fromArray(positions,i).sub(centre),x=p.dot(right),y=p.dot(up);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
  if(maxX-minX<1e-8||maxY-minY<1e-8)return;
  centre.addScaledVector(right,(minX+maxX)/2).addScaledVector(up,(minY+maxY)/2);
  return {mesh:valid[0],indices:valid,centre,normal,right,up,width:maxX-minX,height:maxY-minY};
}
export function backgroundLightWindow(shape:BackgroundLightingShape,light:BackgroundCapture['light']){
  if(light.windowMesh!==undefined){
    // Resolve glass within an authored window assembly, including frame indices.
    const glass=new Set(shape.windowMeshes??[]),group=shape.groups?.filter(group=>group.includes(light.windowMesh!)&&group.some(i=>glass.has(i))).sort((a,b)=>a.length-b.length)[0];
    return backgroundWindow(shape,group?group.filter(i=>glass.has(i)):[light.windowMesh]);
  }
  const candidates=(shape.windowMeshes??[]).map(i=>backgroundWindow(shape,[i])).filter((w):w is BackgroundWindow=>!!w);
  candidates.sort((a,b)=>b.width*b.height-a.width*a.height);const first=candidates[0];if(!first)return;
  // Adjacent panes on the same wall form one aperture. Other walls remain separate.
  const nearby=candidates.filter(w=>Math.abs(w.normal.dot(first.normal))>.98&&Math.abs(w.centre.clone().sub(first.centre).dot(first.normal))<Math.max(first.width,first.height)*.15&&w.centre.distanceTo(first.centre)<Math.max(first.width,first.height,w.width,w.height)*1.8);
  return backgroundWindow(shape,nearby.flatMap(w=>w.indices));
}
export function backgroundPresetLight(light:BackgroundCapture['light'],preset:NonNullable<BackgroundCapture['light']['preset']>,shape?:BackgroundLightingShape):BackgroundCapture['light'] {
  const window=shape&&backgroundLightWindow(shape,light),outward=window?.normal.clone().negate();
  return {...light,preset,azimuth:outward?Math.round(Math.atan2(outward.x,outward.z)*180/Math.PI):light.azimuth,elevation:preset==='evening'?18:50,intensity:1,bounce:1};
}
