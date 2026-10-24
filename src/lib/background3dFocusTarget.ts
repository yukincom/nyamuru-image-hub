import {Box3,Vector3} from 'three';
import type {GeometryMesh} from './background3dGeometry.ts';

export type BackgroundFocusTarget={mesh:number;indices:number[];bounds:Box3;name:string};

/** Cutaway removes surrounding obstructions, but must retain the selected
 * assembly even when framing a small object moves the camera outside the room. */
export function keepBackgroundFocusVisible(visible:number[]|undefined,focus:BackgroundFocusTarget|undefined):number[]|undefined{
  if(!visible||!focus)return visible;
  return [...new Set([...visible,...focus.indices])].sort((a,b)=>a-b);
}

/** Reuse the loader's complete furniture units rather than selecting one bolt,
 * material primitive or outline shell. Runtime bounds never alter the source. */
export function backgroundFocusTargets(meshes:GeometryMesh[],units:{indices:number[]}[],metadata:{meshNames?:string[];groups?:number[][];groupNames?:string[]}={}):BackgroundFocusTarget[]{
  const groupNames=new Map((metadata.groups??[]).map((indices,i)=>[indices.join(','),metadata.groupNames?.[i]]));
  return units.map(({indices})=>{
    const bounds=new Box3();
    for(const index of indices){const p=meshes[index].positions;for(let i=0;i<p.length;i+=3)bounds.expandByPoint(new Vector3(p[i],p[i+1],p[i+2]));}
    const mesh=indices[0];
    return {mesh,indices,bounds,name:groupNames.get(indices.join(','))?.trim()||metadata.meshNames?.[mesh]?.trim()||`オブジェクト ${mesh+1}`};
  });
}
