import assert from 'node:assert/strict';
import test from 'node:test';
import { commitPaintStroke, appendPaintSamples, constrainPaintPoint } from '../src/lib/paintGesture.ts';
import { paintScene, newPaintLayer } from '../src/lib/paintDocument.ts';
import { PaintSmoother } from '../src/lib/paintStroke.ts';

const initial=()=>paintScene({id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:-1,action:null,bubbles:[],figures:[{name:'人物',bbox:{x:10,y:20,w:30,h:50}}]},100,[]);
const stroke=(x=1)=>({tool:'pen',color:'#000000',size:8,points:[{x,y:5,pressure:.8,time:0},{x:x+10,y:15,pressure:.7,time:4}]});
test('rapid completions append to current owner layers without replacing earlier strokes or another owner',()=>{
  let scene=initial();const source=structuredClone(scene);
  const commands=Array.from({length:10},(_,i)=>{const owner=scene.owners[i%2];return{ownerKey:owner.key,layerId:owner.paint.layers[0].id,stroke:stroke(i*10)};});
  for(const command of commands)scene=commitPaintStroke(scene,command);
  assert.deepEqual(scene.owners.map(o=>o.paint.layers[0].strokes.length),[5,5]);
  assert.deepEqual(scene.owners[1].paint.layers[0].strokes.map(s=>s.points[0].x),[10,30,50,70,90]);
  assert.deepEqual(source.owners.map(o=>o.paint.layers[0].strokes),[[],[]]);
  commands[1].stroke.points[0].x=999;assert.equal(scene.owners[1].paint.layers[0].strokes[0].points[0].x,10);
});
test('first rapid stroke on clipped art creates its unrestricted layer atomically',()=>{
  const scene=initial(),owner=scene.owners[1];owner.paint.layers[0].clip={x:0,y:0,w:10,h:10};
  const before=structuredClone(scene),layer=newPaintLayer(),pending={ownerKey:owner.key,layerId:layer.id,addedLayer:layer,stroke:stroke(20)};
  const result=commitPaintStroke(scene,pending),layers=result.owners[1].paint.layers;
  assert.equal(layers.length,owner.paint.layers.length+1);assert.equal(layers.at(-1).strokes.length,1);assert.equal(layers.at(-1).clip,undefined);
  assert.deepEqual(layers.slice(0,-1),before.owners[1].paint.layers);assert.deepEqual(scene,before);
  assert.equal(commitPaintStroke(result,{...pending,stroke:stroke(30)}).owners[1].paint.layers.length,layers.length);
});
test('a completed stroke remains on the owner and layer selected when the pen went down',()=>{
  const scene=initial(),owner=scene.owners[1],pending={ownerKey:owner.key,layerId:owner.paint.layers[0].id,stroke:stroke()};
  const reordered={...scene,owners:[...scene.owners].reverse()};
  const result=commitPaintStroke(reordered,pending);
  assert.equal(result.owners[0].paint.layers[0].strokes.length,1);assert.equal(result.owners[1].paint.layers[0].strokes.length,0);
  assert.equal(commitPaintStroke({...scene,owners:[scene.owners[0]]},pending).owners[0].paint.layers[0].strokes.length,0);
});
const event=(type,x,pressure=.8,timeStamp=x)=>({type,pointerType:'pen',pressure,clientX:x,clientY:x,timeStamp});
const point=e=>({x:e.clientX,y:e.clientY,pressure:e.pressure,time:e.timeStamp});
test('quick pen down/up and shape gestures retain release coordinates with the last contact pressure',()=>{
  for(const tool of ['pen','eraser','line','rectangle','ellipse']){
    const smoother=new PaintSmoother(0),mark={...stroke(),tool,points:[smoother.push(point(event('pointerdown',10)))]};
    appendPaintSamples(mark,smoother,event('pointerup',80,0),point);
    assert.equal(mark.points.length,2);assert.equal(mark.points[1].x,80);assert.equal(mark.points[1].pressure,.8);
  }
});
test('coalesced moves retain all samples plus a newer dispatched endpoint',()=>{
  const smoother=new PaintSmoother(0),mark={...stroke(),points:[smoother.push(point(event('pointerdown',10)))]};
  appendPaintSamples(mark,smoother,{...event('pointermove',40),getCoalescedEvents:()=>[event('pointermove',20),event('pointermove',30)]},point);
  assert.deepEqual(mark.points.map(p=>p.x),[10,20,30,40]);
});


test('Shift constrains lines and equal-sided shapes in every drag direction',()=>{
  const start={x:50,y:50,pressure:.8,time:0};
  for(const [dx,dy] of [[30,10],[-30,10],[10,-30],[-10,-30],[0,30],[30,0]]){
    const end={...start,x:start.x+dx,y:start.y+dy,time:1};
    const line=constrainPaintPoint('line',start,end,true);
    assert.ok(line.x===start.x||line.y===start.y);
    for(const tool of ['ellipse','rectangle']){
      const point=constrainPaintPoint(tool,start,end,true);
      assert.equal(Math.abs(point.x-start.x),Math.abs(point.y-start.y));
      assert.equal(point.pressure,end.pressure);
      assert.equal(constrainPaintPoint(tool,start,end,false),end);
    }
    assert.equal(constrainPaintPoint('pen',start,end,true),end);
  }
});
test('Shift release position reaches both shape preview and committed geometry',()=>{
  const stroke={tool:'rectangle',color:'#000',size:3,points:[{x:10,y:10,pressure:1,time:0}]};
  const event={type:'pointerup',pointerType:'pen',pressure:0,shiftKey:true,clientX:45,clientY:20,timeStamp:1};
  appendPaintSamples(stroke,new PaintSmoother(0),event,e=>({x:e.clientX,y:e.clientY,pressure:e.pressure,time:e.timeStamp}));
  assert.deepEqual(stroke.points[1],{x:45,y:45,pressure:1,time:0});
  const scene=initial(),owner=scene.owners[0];
  const result=commitPaintStroke(scene,{ownerKey:owner.key,layerId:owner.paint.layers[0].id,stroke});
  assert.deepEqual(result.owners[0].paint.layers[0].strokes[0].points,stroke.points);
});

test('mask gestures retain source strokes and vector paths and stay on their original layer',()=>{
  const scene=initial(),owner=scene.owners[0],layer=owner.paint.layers[0];
  layer.strokes=[stroke()];layer.kind='vector';layer.paths=[{id:'untouched-path'}];layer.mask={enabled:true,reveal:true,strokes:[]};
  const before=structuredClone(scene),pending={ownerKey:owner.key,layerId:layer.id,target:'mask',stroke:{...stroke(),tool:'eraser'}};
  const result=commitPaintStroke(scene,pending),updated=result.owners[0].paint.layers[0];
  assert.deepEqual(updated.strokes,layer.strokes);assert.deepEqual(updated.paths,layer.paths);assert.equal(updated.mask.strokes.length,1);assert.deepEqual(scene,before);
  pending.stroke.points[0].x=999;assert.equal(updated.mask.strokes[0].points[0].x,1);
  for(const patch of [{mask:undefined},{mask:{...layer.mask,enabled:false}},{locked:true},{visible:false}]){
    const blocked=structuredClone(scene);Object.assign(blocked.owners[0].paint.layers[0],patch);assert.equal(commitPaintStroke(blocked,pending),blocked);
  }
});

test('generation mask strokes attach to their image without modifying source ink or tone mask',()=>{
  const scene=initial(),owner=scene.owners[0],layer=owner.paint.layers[0];layer.generationMask={enabled:true,strokes:[]};
  const next=commitPaintStroke(scene,{ownerKey:owner.key,layerId:layer.id,target:'generationMask',stroke:{...stroke(),color:'#ff0000'}});
  assert.equal(next.owners[0].paint.layers[0].generationMask.strokes[0].color,'#ff0000');assert.deepEqual(layer.generationMask.strokes,[]);assert.deepEqual(next.owners[0].paint.layers[0].strokes,[]);
  layer.generationMask.enabled=false;assert.equal(commitPaintStroke(scene,{ownerKey:owner.key,layerId:layer.id,target:'generationMask',stroke:stroke()}),scene);
});
