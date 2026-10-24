import assert from 'node:assert/strict';
import test from 'node:test';
import {applyBackgroundVisibility,prepareBackgroundCutaway,visibleCutawayMeshes} from '../src/lib/background3dCutaway.ts';
import {loadStageShape} from '../src/lib/background3dRenderer.ts';
import {prepareBackgroundStage} from '../src/lib/background3d.ts';

function box(min,max){
 const positions=[];for(const [x,y,z] of [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]])positions.push(min[0]+x*(max[0]-min[0]),min[1]+y*(max[1]-min[1]),min[2]+z*(max[2]-min[2]));
 return {positions,indices:[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]};
}
const camera=(x,z,y=2)=>({position:[x,y,z],target:[0,1,0],fov:40});
const setting={enabled:true,depth:.25};
const room=()=>[
 box([-2,-.1,-3],[2,0,3]), // floor
 box([-2,0,3],[2,2.6,3.1]), // front wall
 box([-2,0,-3.1],[2,2.6,-3]), // opposite wall
 box([2,0,-3],[2.1,2.6,3]), // side wall
 box([-1,0,2.2],[1,2,2.8]), // front bookcase
 box([-.5,.1,-.5],[.5,1,.5]), // middle furniture
 box([2,-.1,-2],[3,0,2]), // corridor outside main floor
 box([-1,-.1,3],[1,0,4.2]), // closet floor outside main floor
 box([-1,0,3.1],[1,2,4.2]), // closet outside main room
 box([-2.1,0,2.4],[-2,2.6,3]), // short side-wall section at front corner
];
test('main floor anchors the room despite a corridor and closet; camera-side tall obstructions are excluded',()=>{
 const meshes=room(),before=structuredClone(meshes),model=prepareBackgroundCutaway(meshes);
 const f=model.footprint;assert.ok(Math.abs((f.maxU-f.minU)*(f.maxV-f.minV)-24)<1e-9);
 const visible=visibleCutawayMeshes(model,camera(0,8),setting);
 for(const id of [0,2,3,5,6,7,9])assert.ok(visible.includes(id),`retains ${id}`);
 for(const id of [1,4,8])assert.ok(!visible.includes(id),`hides ${id}`);
 assert.deepEqual(meshes,before);
});
test('the hidden side follows the camera and leaves the floor and unselected side walls intact',()=>{
 const model=prepareBackgroundCutaway(room());
 const opposite=visibleCutawayMeshes(model,camera(0,-8),setting);assert.ok(!opposite.includes(2));assert.ok(opposite.includes(1));assert.ok(opposite.includes(4));
 const diagonal=visibleCutawayMeshes(model,camera(8,8),setting);assert.ok(!diagonal.includes(1));assert.ok(!diagonal.includes(3));assert.ok(diagonal.includes(0));assert.ok(diagonal.includes(2));assert.ok(diagonal.includes(9),'opposite side-wall piece remains even when both camera-facing sides are hidden');
 const almostFront=visibleCutawayMeshes(model,camera(2.2,15),setting);assert.ok(!almostFront.includes(3));assert.ok(!almostFront.includes(1));
 assert.equal(visibleCutawayMeshes(model,camera(0,0,10),setting),undefined);
 assert.equal(visibleCutawayMeshes(model,camera(8,8),{...setting,enabled:false}),undefined);
 assert.equal(visibleCutawayMeshes(model,camera(8,8),undefined),undefined);
});
test('oblique views remove both facing walls while retaining side furniture, floor and opposite walls',()=>{
 const source=[...room(),box([1.2,0,-1],[1.9,1,.8])];
 for(const mirrorX of [-1,1])for(const mirrorZ of [-1,1])for(const angle of [0,.61]){
  const c=Math.cos(angle),s=Math.sin(angle),transform=([x,y,z])=>[c*x*mirrorX-s*z*mirrorZ+17,y+3,s*x*mirrorX+c*z*mirrorZ-9];
  const moved=source.map(mesh=>({...mesh,positions:mesh.positions.flatMap((_,i,a)=>i%3?[]:transform(a.slice(i,i+3)))}));
  const model=prepareBackgroundCutaway(moved),shot=camera(2.2,15),view={...shot,position:transform(shot.position),target:transform(shot.target)};
  for(const depth of [.05,.25,.45]){
   const visible=visibleCutawayMeshes(model,view,{enabled:true,depth});
   for(const id of [1,3])assert.ok(!visible.includes(id),`hides facing wall ${id} at depth ${depth}`);
   for(const id of [0,2,5,6,7,9,10])assert.ok(visible.includes(id),`retains floor, opposite wall or furniture ${id} at depth ${depth}`);
  }
 }
});
test('desk assemblies remain complete even when every part enters the camera-side band',()=>{
 const meshes=[...room(),box([-.7,.7,1.8],[.7,1,2.7]),box([-.7,0,2.5],[-.6,.7,2.6])];
 const model=prepareBackgroundCutaway(meshes,[[...meshes.keys()],[10,11]]);
 const shallow=visibleCutawayMeshes(model,camera(0,8),{enabled:true,depth:.1});assert.ok(shallow.includes(10));assert.ok(shallow.includes(11));
 const deeper=visibleCutawayMeshes(model,camera(0,8),setting);assert.ok(deeper.includes(10));assert.ok(deeper.includes(11));
});
test('floor orientation and translated/rotated cameras preserve the same cutaway',()=>{
 const source=room(),angle=.61,c=Math.cos(angle),s=Math.sin(angle),transform=([x,y,z])=>[c*x-s*z+17,y+3,s*x+c*z-9];
 const rotated=source.map(mesh=>({...mesh,positions:mesh.positions.flatMap((_,i,a)=>i%3?[]:transform(a.slice(i,i+3)))}));
 const shot=camera(0,8),moved={...shot,position:transform(shot.position),target:transform(shot.target)};
 assert.deepEqual(visibleCutawayMeshes(prepareBackgroundCutaway(rotated),moved,setting),visibleCutawayMeshes(prepareBackgroundCutaway(source),shot,setting));
});
test('empty geometry and a single solid model remain usable without a floor',()=>{
 assert.equal(visibleCutawayMeshes(prepareBackgroundCutaway([]),camera(5,5),setting),undefined);
 assert.deepEqual(visibleCutawayMeshes(prepareBackgroundCutaway([box([-1,-1,-1],[1,1,1])]),camera(5,5),setting),[0]);
});

test('GLB loading retains assemblies including mesh parents and outline children',async()=>{
 // A small GLB authored directly avoids browser-only exporter dependencies.
 const base=box([-.5,0,-.5],[.5,1,.5]),positions=new Float32Array(base.positions),indices=new Uint16Array(base.indices),pad=(n)=>(n+3)&~3;
 const bin=new Uint8Array(pad(positions.byteLength)+pad(indices.byteLength));bin.set(new Uint8Array(positions.buffer));bin.set(new Uint8Array(indices.buffer),pad(positions.byteLength));
 const gltf={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{children:[1,3]},{mesh:0,children:[2]},{mesh:0,translation:[0,.05,0]},{mesh:0,translation:[2,0,0]}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength},{buffer:0,byteOffset:pad(positions.byteLength),byteLength:indices.byteLength}],accessors:[{bufferView:0,componentType:5126,count:8,type:'VEC3',min:[-.5,0,-.5],max:[.5,1,.5]},{bufferView:1,componentType:5123,count:36,type:'SCALAR'}]};
 const json=new TextEncoder().encode(JSON.stringify(gltf)),bytes=new Uint8Array(28+pad(json.length)+bin.length),view=new DataView(bytes.buffer);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.length,true);view.setUint32(12,pad(json.length),true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+pad(json.length));bytes.set(json,20);const start=20+pad(json.length);view.setUint32(start,bin.length,true);view.setUint32(start+4,0x004e4942,true);bytes.set(bin,start+8);
 const item=await prepareBackgroundStage(new File([bytes],'assembly.glb')),shape=await loadStageShape(item.stage,item.blob);
 assert.equal(shape.meshes.length,3);assert.ok(shape.groups.some(g=>g.length===2&&g.includes(0)&&g.includes(1)));assert.ok(shape.groups.some(g=>g.length===3));
});


test('camera rotation retains desks, chairs and desk props while tall furniture remains automatic',()=>{
 const meshes=[...room(),box([1.2,0,-1],[1.9,.8,.2]),box([1.2,.8,-.8],[1.5,1.2,-.7]),box([1.2,0,.5],[1.8,1,1.1])];
 const model=prepareBackgroundCutaway(meshes,[],{meshNames:['Floor','Wall','Wall','Wall','Bookcase','Furniture','Floor','Floor','Closet','Wall','Desk','Monitor','Chair']});
 for(let angle=0;angle<360;angle+=5)for(const depth of [.05,.25,.45]){
  const view=camera(8*Math.sin(angle*Math.PI/180),8*Math.cos(angle*Math.PI/180)),visible=visibleCutawayMeshes(model,view,{enabled:true,depth});
  for(const mesh of [10,11,12])assert.ok(visible.includes(mesh),`${angle} degrees keeps ${mesh} at depth ${depth}`);
 }
 assert.ok(!visibleCutawayMeshes(model,camera(0,8),setting).includes(4));
 assert.ok(visibleCutawayMeshes(model,camera(0,-8),setting).includes(4));
});

test('per-shot visibility overrides automatic removal for entire assemblies and hides small props without cutaway',()=>{
 const meshes=[...room(),box([1.2,.8,-.8],[1.5,1.2,-.7]),box([1.1,.75,-.9],[1.6,.8,-.6])],model=prepareBackgroundCutaway(meshes,[[10,11]]);
 const auto=visibleCutawayMeshes(model,camera(0,8),setting),rules=[{mesh:4,mode:'show'},{mesh:10,mode:'hide'}],before=structuredClone(rules);
 const manual=applyBackgroundVisibility(model,auto,rules);
 assert.ok(manual.includes(4));assert.ok(!manual.includes(10));assert.ok(!manual.includes(11));
 for(const visible of [undefined,Array.from({length:meshes.length},(_,i)=>i)]){
  const hidden=applyBackgroundVisibility(model,visible,[{mesh:10,mode:'hide'}]);
  assert.equal(hidden.length,meshes.length-2);assert.ok(!hidden.includes(10));assert.ok(!hidden.includes(11));
 }
 assert.equal(applyBackgroundVisibility(model,auto,[]),auto);
 assert.ok(applyBackgroundVisibility(model,auto,[{mesh:10,mode:'show'}]).includes(11));
 assert.deepEqual(rules,before);assert.ok(auto.includes(10));
});

test('furniture words do not match substrings in architectural names',()=>{
 for(const name of ['Wall_adjustable','Portable_partition','Wall_embedded','Bedroom_Wall']){
  const model=prepareBackgroundCutaway(room(),[],{meshNames:['Floor',name]});
  assert.ok(!visibleCutawayMeshes(model,camera(0,8),setting).includes(1),name);
 }
 const model=prepareBackgroundCutaway(room(),[],{meshNames:['Floor','SideTable']});
 assert.ok(visibleCutawayMeshes(model,camera(0,8),setting).includes(1),'explicitly named tall table remains protected');
});
