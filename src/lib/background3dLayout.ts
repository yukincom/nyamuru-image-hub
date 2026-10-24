import {paintOwnerPlacementLocked} from './paintLock.ts';
import type { PaintScene } from './paintDocument.ts';

/** Translate the whole foreground group, retaining its paint grid and bleed. */
export function moveBackgroundLayoutOwner(scene:PaintScene,key:string,dx:number,dy:number):PaintScene {
  const owner=scene.owners.find(item=>item.key===key);
  if(!owner||owner.kind==='background'||!Number.isFinite(dx)||!Number.isFinite(dy)||(!dx&&!dy)
    ||paintOwnerPlacementLocked(owner)||owner.bubble?.hidden)return scene;
  return {...scene,owners:scene.owners.map(item=>item===owner?{...item,frame:{...item.frame,x:item.frame.x+dx,y:item.frame.y+dy},...(item.figure?.analogImport?{figure:{...item.figure,analogImport:{...item.figure.analogImport,userEdited:true}}}:{})}:item)};
}
