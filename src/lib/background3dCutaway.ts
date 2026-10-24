import type { BackgroundCapture } from '../types.ts';
import type { GeometryMesh } from './background3dGeometry.ts';

type Point=[number,number];
type Bounds={minU:number;maxU:number;minV:number;maxV:number;minY:number;maxY:number};
type Footprint={u:Point;v:Point;minU:number;maxU:number;minV:number;maxV:number};
export type BackgroundCutawayModel={footprint:Footprint;floorY:number;height:number;units:Array<Bounds&{indices:number[];ground:boolean;autoHide:boolean}>;meshCount:number};

function hull(points:Point[]):Point[]{
  points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const unique=points.filter((p,i)=>!i||p[0]!==points[i-1][0]||p[1]!==points[i-1][1]);
  if(unique.length<3)return unique;
  const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=(input:Point[])=>{const out:Point[]=[];for(const p of input){while(out.length>1&&cross(out.at(-2)!,out.at(-1)!,p)<=0)out.pop();out.push(p);}out.pop();return out;};
  return [...half(unique),...half([...unique].reverse())];
}
const project=(x:number,z:number,axis:Point)=>x*axis[0]+z*axis[1];
function rectangle(points:Point[]):Footprint {
  const boundary=hull(points);let best:Footprint|undefined,area=Infinity;
  // Complex round floors do not need every edge direction. All vertices still
  // contribute to the bounds; this only limits the orientation search.
  const step=Math.max(1,Math.ceil(boundary.length/128));
  for(let i=0;i<boundary.length;i+=step){
    const a=boundary[i],b=boundary[(i+1)%boundary.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue;
    let u:Point=[(b[0]-a[0])/length,(b[1]-a[1])/length];
    // Stable equivalent axes keep the same footprint after a file is reloaded.
    if(u[0]<-1e-10||Math.abs(u[0])<=1e-10&&u[1]<0)u=[-u[0],-u[1]];
    const v:Point=[-u[1],u[0]],box:Footprint={u,v,minU:Infinity,maxU:-Infinity,minV:Infinity,maxV:-Infinity};
    for(const [x,z] of boundary){const pu=project(x,z,u),pv=project(x,z,v);box.minU=Math.min(box.minU,pu);box.maxU=Math.max(box.maxU,pu);box.minV=Math.min(box.minV,pv);box.maxV=Math.max(box.maxV,pv);}
    const size=(box.maxU-box.minU)*(box.maxV-box.minV);
    if(size<area-Math.max(1,area===Infinity?0:area)*1e-10){best=box;area=size;}
  }
  return best??{u:[1,0],v:[0,1],minU:0,maxU:0,minV:0,maxV:0};
}
function meshBounds(mesh:GeometryMesh,u:Point,v:Point):Bounds {
  const box:Bounds={minU:Infinity,maxU:-Infinity,minV:Infinity,maxV:-Infinity,minY:Infinity,maxY:-Infinity};
  for(let i=0;i<mesh.positions.length;i+=3){const x=mesh.positions[i],y=mesh.positions[i+1],z=mesh.positions[i+2],pu=project(x,z,u),pv=project(x,z,v);box.minU=Math.min(box.minU,pu);box.maxU=Math.max(box.maxU,pu);box.minV=Math.min(box.minV,pv);box.maxV=Math.max(box.maxV,pv);box.minY=Math.min(box.minY,y);box.maxY=Math.max(box.maxY,y);}
  return box;
}
function combined(boxes:Bounds[]):Bounds {
  return {minU:Math.min(...boxes.map(b=>b.minU)),maxU:Math.max(...boxes.map(b=>b.maxU)),minV:Math.min(...boxes.map(b=>b.minV)),maxV:Math.max(...boxes.map(b=>b.maxV)),minY:Math.min(...boxes.map(b=>b.minY)),maxY:Math.max(...boxes.map(b=>b.maxY))};
}

/** Compute once at load time. The largest low horizontal slab is the main floor,
 * rather than a corridor/closet expanding the bounds of the complete model. */
export function prepareBackgroundCutaway(meshes:GeometryMesh[],groups:number[][]=[],metadata:{meshNames?:string[];groupNames?:string[]}={}):BackgroundCutawayModel {
  if(!meshes.length)return {footprint:rectangle([]),floorY:0,height:0,units:[],meshCount:0};
  const world=meshes.map(mesh=>meshBounds(mesh,[1,0],[0,1])),all=combined(world),height=Math.max(1e-8,all.maxY-all.minY);
  let footprint:Footprint|undefined,floorY=all.minY,area=0;
  for(let i=0;i<world.length;i++){
    const box=world[i];if(box.maxY-box.minY>height*.06||box.maxY>all.minY+height*.1)continue;
    const points:Point[]=[];for(let p=0;p<meshes[i].positions.length;p+=3)points.push([meshes[i].positions[p],meshes[i].positions[p+2]]);
    const candidate=rectangle(points),size=(candidate.maxU-candidate.minU)*(candidate.maxV-candidate.minV);
    if(size>area){area=size;footprint=candidate;floorY=box.maxY;}
  }
  const worldArea=(all.maxU-all.minU)*(all.maxV-all.minV);
  if(!footprint||area<worldArea*.1)footprint={u:[1,0],v:[0,1],minU:all.minU,maxU:all.maxU,minV:all.minV,maxV:all.maxV};
  const boxes=meshes.map(mesh=>meshBounds(mesh,footprint.u,footprint.v)),assigned=new Set<number>(),units:BackgroundCutawayModel['units']=[];
  const width=footprint.maxU-footprint.minU,depth=footprint.maxV-footprint.minV;
  const groupNames=new Map(groups.map((indices,i)=>[indices.join(','),metadata.groupNames?.[i]]));
  const autoHide=(indices:number[],box:Bounds)=>{
    const name=groupNames.get(indices.join(','))||metadata.meshNames?.[indices[0]]||'';
    const words=name.replace(/([a-z])([A-Z])/g,'$1_$2');
    // Classify the complete assembly, not an individual shelf or desk leg.
    // Shelves may sit behind/under a desk, so their own name takes precedence.
    if(/(?:^|[_\s.\d-])(?:bookcases?|book_?shel(?:f|ves)|cabinets?)(?:[_\s.\d-]|$)|本棚|書棚|棚/i.test(words))return box.maxY-box.minY>=height*.5;
    if(/(?:^|[_\s.\d-])(?:desks?|tables?|chairs?|stools?|sofas?|couch|beds?|computers?|monitors?|keyboards?|mouse|printers?|scanners?|tablets?|cables?)(?:[_\s.\d-]|$)|机|椅子/i.test(words))return false;
    if(/(?:^|[_\s])(?:wall|partition|door|window|curtains?|skirting|closet)(?:[_\s\d]|$)|壁|窓|扉|ドア|カーテン|巾木|押入/i.test(words))return true;
    // Unnamed low furniture and small props must not disappear on an orbit.
    // Tall obstructions and broad boundary panels remain eligible for cutaway.
    const near=(low:number,high:number,min:number,max:number,span:number)=>high-low<=span*.08&&(Math.abs(low-min)<=span*.015||Math.abs(high-max)<=span*.015);
    return box.maxY-box.minY>=height*.5||box.maxY-box.minY>=height*.15&&(
      near(box.minU,box.maxU,footprint!.minU,footprint!.maxU,width)&&box.maxV-box.minV>=depth*.5
      ||near(box.minV,box.maxV,footprint!.minV,footprint!.maxV,depth)&&box.maxU-box.minU>=width*.5);
  };
  const add=(indices:number[],box:Bounds)=>{indices.forEach(i=>assigned.add(i));units.push({...box,indices,ground:box.maxY-box.minY<=height*.06&&box.maxY<=floorY+height*.03,autoHide:autoHide(indices,box)});};
  // Use the largest contained furniture hierarchy. A room-wide wrapper or a
  // collection containing several walls must not become one indivisible object.
  for(const indices of [...groups].sort((a,b)=>b.length-a.length)){
    if(indices.length<2||indices.some(i=>assigned.has(i)))continue;
    const box=combined(indices.map(i=>boxes[i]));
    if(box.maxU-box.minU>width*.8||box.maxV-box.minV>depth*.8)continue;
    add(indices,box);
  }
  boxes.forEach((box,i)=>{if(!assigned.has(i))add([i],box);});
  return {footprint,floorY,height,units,meshCount:meshes.length};
}

/** Remove complete camera-side parts. No geometry, material or original file is
 * edited, and the returned indices are shared by GPU masks and vector extraction. */
export function visibleCutawayMeshes(model:BackgroundCutawayModel,camera:BackgroundCapture['camera'],setting:BackgroundCapture['cutaway']):number[]|undefined {
  if(!setting?.enabled)return undefined;
  const f=model.footprint,width=f.maxU-f.minU,depth=f.maxV-f.minV;
  if(width<=0||depth<=0)return undefined;
  const u=project(camera.position[0],camera.position[2],f.u),v=project(camera.position[0],camera.position[2],f.v);
  const du=u-(f.minU+f.maxU)/2,dv=v-(f.minV+f.maxV)/2;
  const wallSideU=u<f.minU?-1:u>f.maxU?1:0,wallSideV=v<f.minV?-1:v>f.maxV?1:0;
  let sideU=wallSideU,sideV=wallSideV;
  if(!sideU&&!sideV)return undefined;
  // Oblique views still need both camera-facing walls removed. Other eligible
  // pieces use the dominant direction to avoid cutting into the opposite side.
  if(sideU&&sideV){if(Math.abs(du)<Math.abs(dv)*Math.tan(Math.PI/8))sideU=0;else if(Math.abs(dv)<Math.abs(du)*Math.tan(Math.PI/8))sideV=0;}
  const amount=Math.max(.05,Math.min(.45,setting.depth)),epsilon=Math.max(width,depth)*1e-7,visible=new Set<number>();
  const wallEdge=(low:number,high:number,min:number,max:number,span:number)=>{
    if(high-low>span*.08)return 0;
    if(high<=min+span*.01&&low>=min-span*.1)return -1;
    if(low>=max-span*.01&&high<=max+span*.1)return 1;
    return 0;
  };
  const mostlyWithin=(low:number,high:number,min:number,max:number)=>Math.max(0,Math.min(high,max)-Math.max(low,min))>=.8*(high-low);
  for(const unit of model.units){
    const tall=unit.maxY-unit.minY>=model.height*.25;
    const wallU=tall&&mostlyWithin(unit.minV,unit.maxV,f.minV,f.maxV)?wallEdge(unit.minU,unit.maxU,f.minU,f.maxU,width):0;
    const wallV=tall&&mostlyWithin(unit.minU,unit.maxU,f.minU,f.maxU)?wallEdge(unit.minV,unit.maxV,f.minV,f.maxV,depth):0;
    const facingWall=wallU!==0&&wallU===wallSideU||wallV!==0&&wallV===wallSideV;
    const sideWall=wallU!==0&&wallU!==sideU||wallV!==0&&wallV!==sideV;
    const hidden=unit.autoHide&&!unit.ground&&(facingWall||!sideWall&&(
      sideU>0&&unit.minU>=f.maxU-width*amount-epsilon||sideU<0&&unit.maxU<=f.minU+width*amount+epsilon
      ||sideV>0&&unit.minV>=f.maxV-depth*amount-epsilon||sideV<0&&unit.maxV<=f.minV+depth*amount+epsilon));
    if(!hidden)unit.indices.forEach(i=>visible.add(i));
  }
  return Array.from({length:model.meshCount},(_,i)=>i).filter(i=>visible.has(i));
}

/** Per-shot choices override automatic cutaway and focus protection, including
 * when cutaway is off or the camera is inside the room. Apply whole assemblies. */
export function applyBackgroundVisibility(model:BackgroundCutawayModel,visible:number[]|undefined,rules:BackgroundCapture['objectVisibility']):number[]|undefined {
  if(!rules?.length)return visible;
  const overrides=new Map(rules.map(rule=>[rule.mesh,rule.mode]));
  const result=new Set(visible??Array.from({length:model.meshCount},(_,i)=>i));
  for(const unit of model.units){
    const mode=unit.indices.map(i=>overrides.get(i)).find(Boolean);
    if(mode)for(const i of unit.indices){if(mode==='show')result.add(i);else result.delete(i);}
  }
  return [...result].sort((a,b)=>a-b);
}
