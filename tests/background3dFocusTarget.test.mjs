import assert from 'node:assert/strict';
import test from 'node:test';
import {backgroundFocusTargets,keepBackgroundFocusVisible} from '../src/lib/background3dFocusTarget.ts';
import {prepareBackgroundCutaway} from '../src/lib/background3dCutaway.ts';

const mesh=(x,y,z,w,h,d)=>({positions:[x,y,z,x+w,y,z,x+w,y+h,z+d,x,y+h,z+d],indices:[0,1,2,0,2,3]});
test('focus uses the full furniture assembly and its authored name, excluding room wrappers',()=>{
 const meshes=[mesh(0,0,0,10,.1,10),mesh(1,1,2,2,.2,1),mesh(1,0,2,.2,1,.2),mesh(2.8,0,2.8,.2,1,.2),mesh(8,0,8,1,2,1)];
 const groups=[[0,1,2,3,4],[1,2,3],[1,2,3]],metadata={groups,groupNames:['Room','Desktop','Desk'],meshNames:['Floor','Top','Leg 1','Leg 2','Chair']};
 const original=structuredClone({meshes,metadata}),model=prepareBackgroundCutaway(meshes,groups),targets=backgroundFocusTargets(meshes,model.units,metadata);
 const desk=targets.find(item=>item.indices.includes(2));assert.deepEqual(desk.indices,[1,2,3]);assert.equal(desk.name,'Desk');
 assert.deepEqual(desk.bounds.min.toArray(),[1,0,2]);assert.deepEqual(desk.bounds.max.toArray(),[3,1.2,3]);
 assert.equal(targets.find(item=>item.indices.includes(4)).name,'Chair');assert.equal(targets.length,3);
 assert.deepEqual({meshes,metadata},original);
});
test('unnamed and ungrouped models still provide independent focus targets',()=>{
 const meshes=[mesh(0,0,0,1,1,1),mesh(4,0,0,1,1,1)];
 const targets=backgroundFocusTargets(meshes,[{indices:[0]},{indices:[1]}]);
 assert.equal(targets[0].name,'オブジェクト 1');assert.equal(targets[1].mesh,1);
 assert.deepEqual(targets[1].bounds.getCenter(targets[1].bounds.min.clone()).toArray(),[4.5,.5,.5]);
});
test('cutaway retains the entire selected assembly while other nearby obstructions stay hidden',()=>{
 const targets=backgroundFocusTargets([mesh(0,0,0,1,1,1),mesh(2,0,0,1,1,1),mesh(4,0,0,1,1,1),mesh(6,0,0,1,1,1),mesh(6,1,0,1,1,1)],[{indices:[0]},{indices:[1]},{indices:[2]},{indices:[3,4]}]);
 const visible=[0,2],focus=targets[3];
 assert.deepEqual(keepBackgroundFocusVisible(visible,focus),[0,2,3,4]);
 assert.deepEqual(visible,[0,2]);
 assert.equal(keepBackgroundFocusVisible(visible,undefined),visible);
 assert.equal(keepBackgroundFocusVisible(undefined,focus),undefined);
 assert.deepEqual(keepBackgroundFocusVisible([],focus),[3,4]);
});

test('keyboard keys and case remain one authored assembly without combining unrelated peripherals',()=>{
 const meshes=[mesh(0,0,0,3,.1,1),...Array.from({length:62},(_,i)=>mesh((i%15)*.19,.1,Math.floor(i/15)*.18,.16,.1,.15)),mesh(4,0,0,.5,.2,.7),mesh(-4,-1,-4,10,.01,10)];
 const groups=[meshes.map((_,i)=>i),Array.from({length:63},(_,i)=>i)],metadata={groups,groupNames:['Office','Keyboard'],meshNames:meshes.map((_,i)=>i===63?'Mouse':`Key ${i}`)};
 const model=prepareBackgroundCutaway(meshes,groups),targets=backgroundFocusTargets(meshes,model.units,metadata);
 const keyboard=targets.find(t=>t.indices.includes(10));assert.equal(keyboard.name,'Keyboard');assert.deepEqual(keyboard.indices,groups[1]);assert.equal(targets.length,3);assert.equal(targets.find(t=>t.indices.includes(63)).name,'Mouse');
});
