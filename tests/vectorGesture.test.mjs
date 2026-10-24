import assert from 'node:assert/strict';
import test from 'node:test';
import { beginVectorDrag, updateVectorDrag } from '../src/lib/vectorGesture.ts';
import { defaultVectorStyle, vectorShape, vectorBounds } from '../src/lib/vectorGeometry.ts';
const style=defaultVectorStyle(),point=(x,y,extra={})=>({x,y,...extra});
test('click makes a corner, drag makes symmetric handles, and click first anchor closes path',()=>{
  let d=beginVectorDrag({paths:[],selected:[]},'vector-pen',point(0,0),style,3);
  assert.equal(d.state.paths[0].nodes[0].handleOut,undefined);
  d=beginVectorDrag(d.state,'vector-pen',point(40,40),style,3);updateVectorDrag(d,point(60,40));
  assert.deepEqual(d.state.paths[0].nodes[1].handleOut,{x:20,y:0});assert.deepEqual(d.state.paths[0].nodes[1].handleIn,{x:-20,y:0});
  const closed=beginVectorDrag(d.state,'vector-pen',point(0,0),style,3);assert.equal(closed.state.paths[0].closed,true);assert.equal(closed.state.activePath,undefined);
});
test('Option moves one handle independently; endpoint can resume an open curve',()=>{
 let d=beginVectorDrag({paths:[],selected:[]},'vector-pen',point(0,0),style,2);updateVectorDrag(d,point(10,0));const state=d.state;
 d=beginVectorDrag({...state,activePath:undefined},'vector-node',point(10,0),style,2);updateVectorDrag(d,point(20,20,{alt:true}));assert.deepEqual(d.state.paths[0].nodes[0].handleIn,{x:-10,y:0});
 const resumed=beginVectorDrag({...state,activePath:undefined},'vector-pen',point(0,0),style,2);assert.equal(resumed.state.activePath,state.paths[0].id);
});
test('pen drags already placed anchors without duplicating points or interrupting the open path',()=>{
 let d=beginVectorDrag({paths:[],selected:[]},'vector-pen',point(0,0),style,2);
 d=beginVectorDrag(d.state,'vector-pen',point(50,50),style,2);
 // A separate press on the current endpoint must also pull out handles.
 d=beginVectorDrag(d.state,'vector-pen',point(50,50),style,2);updateVectorDrag(d,point(65,70));
 assert.equal(d.state.paths[0].nodes.length,2);assert.deepEqual(d.state.paths[0].nodes[1].handleOut,{x:15,y:20});
 d=beginVectorDrag(d.state,'vector-pen',point(100,0),style,2);
 const before=d.state,saved=structuredClone(before),id=before.activePath;
 d=beginVectorDrag(before,'vector-pen',point(50,50),style,2);updateVectorDrag(d,point(75,40));
 assert.equal(d.state.paths[0].nodes.length,3);assert.equal(d.state.activePath,id);
 assert.deepEqual(d.state.paths[0].nodes[1],{x:50,y:50,handleOut:{x:25,y:-10},handleIn:{x:-25,y:10}});
 assert.deepEqual(before,saved);
 d=beginVectorDrag(d.state,'vector-pen',point(150,50),style,2);
 assert.equal(d.state.paths.length,1);assert.equal(d.state.paths[0].nodes.length,4);assert.equal(d.state.paths[0].id,id);
});
test('pen can pull handles while closing at the first anchor; a click alone preserves its curve',()=>{
 let d=beginVectorDrag({paths:[],selected:[]},'vector-pen',point(0,0),style,2);updateVectorDrag(d,point(15,10));
 d=beginVectorDrag(d.state,'vector-pen',point(60,60),style,2);
 d=beginVectorDrag(d.state,'vector-pen',point(100,0),style,2);
 const before=d.state,saved=structuredClone(before);
 const click=beginVectorDrag(before,'vector-pen',point(0,0),style,2);
 assert.deepEqual(click.state.paths[0].nodes[0],before.paths[0].nodes[0]);
 updateVectorDrag(click,point(20,-30));
 assert.equal(click.state.paths[0].closed,true);assert.equal(click.state.activePath,undefined);assert.equal(click.state.paths[0].nodes.length,3);
 assert.deepEqual(click.state.paths[0].nodes[0],{x:0,y:0,handleOut:{x:20,y:-30},handleIn:{x:-20,y:30}});
 assert.deepEqual(before,saved);
 const corner=beginVectorDrag(before,'vector-pen',point(0,0,{alt:true}),style,2);
 assert.equal(corner.state.paths[0].closed,false);assert.equal(corner.state.activePath,before.activePath);
 assert.deepEqual(corner.state.paths[0].nodes[0],{x:0,y:0});
});
test('pen drags a visible handle without adding an anchor; Option preserves the opposite handle',()=>{
 let d=beginVectorDrag({paths:[],selected:[]},'vector-pen',point(0,0),style,2);
 d=beginVectorDrag(d.state,'vector-pen',point(50,50),style,2);updateVectorDrag(d,point(65,50));
 const before=d.state;
 d=beginVectorDrag(before,'vector-pen',point(65,50,{alt:true}),style,2);updateVectorDrag(d,point(80,70,{alt:true}));
 assert.equal(d.state.paths[0].nodes.length,2);assert.equal(d.state.activePath,before.activePath);
 assert.deepEqual(d.state.paths[0].nodes[1].handleOut,{x:30,y:20});assert.deepEqual(d.state.paths[0].nodes[1].handleIn,{x:-15,y:0});
});
test('pen prefers the anchor over a short handle at the same hit position',()=>{
 let d=beginVectorDrag({paths:[],selected:[]},'vector-pen',point(0,0),style,3);
 d=beginVectorDrag(d.state,'vector-pen',point(50,50),style,3);updateVectorDrag(d,point(51,50));
 d=beginVectorDrag(d.state,'vector-pen',point(50,50),style,3);updateVectorDrag(d,point(60,70));
 assert.equal(d.state.paths[0].nodes.length,2);assert.deepEqual(d.state.paths[0].nodes[1].handleOut,{x:10,y:20});
 assert.deepEqual(d.state.paths[0].nodes[1].handleIn,{x:-10,y:-20});
});
test('temporary Option conversion continues, while dedicated anchor tools finish the path',()=>{
 let d=beginVectorDrag({paths:[],selected:[]},'vector-pen',point(0,0),style,2);
 d=beginVectorDrag(d.state,'vector-pen',point(50,50),style,2);updateVectorDrag(d,point(65,60));
 const before=d.state,id=before.activePath,saved=structuredClone(before);
 const converted=beginVectorDrag(before,'vector-pen',point(50,50,{alt:true}),style,2).state;
 assert.deepEqual(converted.paths[0].nodes[1],{x:50,y:50});assert.equal(converted.activePath,id);
 const next=beginVectorDrag(converted,'vector-pen',point(100,0),style,2).state;
 assert.equal(next.paths.length,1);assert.equal(next.paths[0].id,id);assert.equal(next.paths[0].nodes.length,3);
 const temporaryDrag=beginVectorDrag(converted,'vector-pen',point(50,50,{alt:true}),style,2);
 updateVectorDrag(temporaryDrag,point(70,60,{alt:true}));
 assert.deepEqual(temporaryDrag.state.paths[0].nodes[1].handleOut,{x:20,y:10});
 assert.deepEqual(temporaryDrag.state.paths[0].nodes[1].handleIn,{x:-20,y:-10});
 assert.equal(temporaryDrag.state.activePath,id);
 const separate=beginVectorDrag(before,'vector-anchor',point(50,50),style,2).state;
 assert.equal(separate.activePath,undefined);assert.deepEqual(separate.paths[0].nodes[1],{x:50,y:50});
 const newPath=beginVectorDrag(separate,'vector-pen',point(150,150),style,2).state;
 assert.equal(newPath.paths.length,2);assert.equal(newPath.paths[0].nodes.length,2);
 assert.notEqual(newPath.activePath,id);assert.deepEqual(before,saved);
 const resumed=beginVectorDrag(separate,'vector-pen',point(50,50),style,2).state;
 assert.equal(resumed.activePath,id);assert.equal(resumed.paths.length,1);
 const line=vectorShape('line',point(0,0),point(100,0),style);
 const added=beginVectorDrag({paths:[line],selected:[line.id],activePath:line.id},'vector-add',point(50,0),style,2).state;
 assert.equal(added.activePath,undefined);assert.equal(added.paths[0].nodes.length,3);assert.deepEqual(added.selectedNode,{pathId:line.id,node:1});
 const deleted=beginVectorDrag(before,'vector-delete',point(50,50),style,2).state;
 assert.equal(deleted.activePath,undefined);assert.equal(deleted.paths[0].nodes.length,1);
});
test('Command on empty canvas finishes without drawing; the next pen click starts a separate path',()=>{
 let d=beginVectorDrag({paths:[],selected:[]},'vector-pen',point(0,0),style,2);
 d=beginVectorDrag(d.state,'vector-pen',point(50,50),style,2);updateVectorDrag(d,point(65,60));
 const before=d.state,saved=structuredClone(before);
 const finished=beginVectorDrag(before,'vector-pen',point(200,200,{meta:true}),style,2).state;
 assert.equal(finished.activePath,undefined);assert.deepEqual(finished.selected,[]);assert.deepEqual(finished.paths,before.paths);
 const next=beginVectorDrag(finished,'vector-pen',point(150,150),style,2).state;
 assert.equal(next.paths.length,2);assert.notEqual(next.activePath,before.activePath);
 assert.deepEqual(next.paths[0],before.paths[0]);assert.deepEqual(before,saved);
 const resumed=beginVectorDrag(finished,'vector-pen',point(50,50),style,2).state;
 assert.equal(resumed.activePath,before.activePath);assert.deepEqual(resumed.paths,before.paths);
 const miss=beginVectorDrag(before,'vector-pen',point(200,200,{alt:true}),style,2).state;
 assert.strictEqual(miss,before);
});
test('clicking the active endpoint retracts only the outgoing handle and keeps the existing curve',()=>{
 let d=beginVectorDrag({paths:[],selected:[]},'vector-pen',point(0,0),style,2);
 d=beginVectorDrag(d.state,'vector-pen',point(50,50),style,2);updateVectorDrag(d,point(65,60));
 const before=d.state,saved=structuredClone(before);
 const corner=beginVectorDrag(before,'vector-pen',point(50,50),style,2).state;
 assert.equal(corner.paths[0].nodes[1].handleOut,undefined);
 assert.deepEqual(corner.paths[0].nodes[1].handleIn,{x:-15,y:-10});assert.equal(corner.activePath,before.activePath);
 const next=beginVectorDrag(corner,'vector-pen',point(100,50),style,2).state;
 assert.equal(next.paths.length,1);assert.equal(next.paths[0].nodes.length,3);assert.deepEqual(before,saved);
 // The same endpoint can still be dragged to pull a new pair of handles.
 const pulled=beginVectorDrag(corner,'vector-pen',point(50,50),style,2);updateVectorDrag(pulled,point(70,50));
 assert.deepEqual(pulled.state.paths[0].nodes[1].handleOut,{x:20,y:0});
 assert.deepEqual(pulled.state.paths[0].nodes[1].handleIn,{x:-20,y:0});
});
test('shape Shift constraint creates editable equal dimensions and dragging selection preserves handles',()=>{
 let d=beginVectorDrag({paths:[],selected:[]},'ellipse',point(10,20),style,2);updateVectorDrag(d,point(80,50,{shift:true}));assert.deepEqual(vectorBounds(d.state.paths[0]),{x:10,y:20,w:70,h:70});
 const before=d.state;d=beginVectorDrag(before,'vector-select',point(45,20),style,2);updateVectorDrag(d,point(60,30));assert.deepEqual(vectorBounds(d.state.paths[0]),{x:25,y:30,w:70,h:70});assert.deepEqual(d.state.paths[0].nodes[0].handleIn,before.paths[0].nodes[0].handleIn);
});
test('Shift selection and marquee let distribution target multiple objects',()=>{
 const a=vectorShape('rectangle',point(0,0),point(10,10),style),b=vectorShape('rectangle',point(30,0),point(40,10),style);
 let d=beginVectorDrag({paths:[a,b],selected:[a.id]},'vector-select',point(30,5,{shift:true}),style,1);assert.deepEqual(d.state.selected,[a.id,b.id]);
 d=beginVectorDrag({paths:[a,b],selected:[]},'vector-select',point(-10,-10),style,1);updateVectorDrag(d,point(50,20));assert.deepEqual(d.state.selected,[a.id,b.id]);
});
test('dedicated add and delete tools edit only existing geometry, and keep the input state immutable',()=>{
 const path=vectorShape('line',point(0,0),point(100,0),style),before={paths:[path],selected:[]},saved=structuredClone(before);
 const added=beginVectorDrag(before,'vector-add',point(50,0),style,2).state;
 assert.equal(added.paths.length,1);assert.equal(added.paths[0].nodes.length,3);assert.equal(added.paths[0].nodes[1].x,50);assert.deepEqual(vectorBounds(added.paths[0]),vectorBounds(path));assert.deepEqual(before,saved);
 const removed=beginVectorDrag(added,'vector-delete',point(50,0),style,2).state;assert.equal(removed.paths[0].nodes.length,2);assert.deepEqual(vectorBounds(removed.paths[0]),vectorBounds(path));
 for(const tool of ['vector-add','vector-delete','vector-anchor'])assert.strictEqual(beginVectorDrag(before,tool,point(300,300),style,2).state,before);
 assert.strictEqual(beginVectorDrag(before,'vector-add',point(0,0),style,2).state,before);
 const filled=vectorShape('rectangle',point(0,0),point(100,100),{...style,fill:'#000000'}),state={paths:[filled],selected:[]};
 assert.strictEqual(beginVectorDrag(state,'vector-add',point(50,50),style,2).state,state);
});
test('anchor point tool converts corners and curves without moving the anchor and independently adjusts handles',()=>{
 const path=vectorShape('line',point(0,0),point(100,0),style),before={paths:[path],selected:[path.id]};
 let d=beginVectorDrag(before,'vector-anchor',point(0,0),style,2);updateVectorDrag(d,point(15,20));
 const node=d.state.paths[0].nodes[0];assert.equal(node.x,0);assert.equal(node.y,0);assert.deepEqual(node.handleOut,{x:15,y:20});assert.deepEqual(node.handleIn,{x:-15,y:-20});
 const adjusted=beginVectorDrag(d.state,'vector-anchor',point(15,20),style,2);updateVectorDrag(adjusted,point(25,30));assert.deepEqual(adjusted.state.paths[0].nodes[0].handleIn,node.handleIn);
 const corner=beginVectorDrag(adjusted.state,'vector-anchor',point(0,0),style,2);assert.deepEqual(corner.state.paths[0].nodes[0],{x:0,y:0});assert.equal(corner.state.selectedNode.node,0);
 const last={...path,nodes:[path.nodes[0]]};assert.deepEqual(beginVectorDrag({paths:[last],selected:[last.id]},'vector-delete',point(0,0),style,2).state,{paths:[],selected:[]});
});

test('direct selection Shift toggles objects and anchors; dragging retains selected anchors',()=>{
  const a=vectorShape('rectangle',{x:0,y:0},{x:100,y:100},defaultVectorStyle()),b=vectorShape('rectangle',{x:200,y:0},{x:300,y:100},defaultVectorStyle());
  let state={paths:[a,b],selected:[]};
  state=beginVectorDrag(state,'vector-node',{x:50,y:0},defaultVectorStyle(),3).state;
  state=beginVectorDrag(state,'vector-node',{x:250,y:0,shift:true},defaultVectorStyle(),3).state;assert.equal(state.selected.length,2);
  state=beginVectorDrag(state,'vector-node',{x:250,y:0,shift:true},defaultVectorStyle(),3).state;assert.deepEqual(state.selected,[a.id]);
  state=beginVectorDrag({paths:[a,b],selected:[]},'vector-node',{...a.nodes[0]},defaultVectorStyle(),3).state;assert.equal(state.selectedNodes.length,1);
  state=beginVectorDrag(state,'vector-node',{...b.nodes[0],shift:true},defaultVectorStyle(),3).state;assert.equal(state.selectedNodes.length,2);
  const drag=beginVectorDrag(state,'vector-node',a.nodes[0],defaultVectorStyle(),3);updateVectorDrag(drag,{x:a.nodes[0].x+5,y:a.nodes[0].y+7});
  for(const [i,p] of [a,b].entries()){assert.equal(drag.state.paths[i].nodes[0].x,p.nodes[0].x+5);assert.deepEqual(drag.state.paths[i].nodes[1],p.nodes[1]);}
  state=beginVectorDrag(state,'vector-node',{...b.nodes[0],shift:true},defaultVectorStyle(),3).state;assert.equal(state.selectedNodes.length,1);
});
test('direct marquee selects only enclosed anchors and captures Shift at pointerdown',async()=>{
  const {deleteSelectedVectorNodes}=await import('../src/lib/vectorGesture.ts');
  const a=vectorShape('line',{x:0,y:0},{x:100,y:100},defaultVectorStyle()),b=vectorShape('line',{x:200,y:0},{x:300,y:100},defaultVectorStyle());
  const before={paths:[a,b],selected:[b.id],selectedNodes:[{pathId:b.id,node:0}]};
  const d=beginVectorDrag(before,'vector-node',{x:-10,y:-10,shift:true},defaultVectorStyle(),2);updateVectorDrag(d,{x:10,y:10,shift:false});
  assert.deepEqual(d.state.selectedNodes,[{pathId:b.id,node:0},{pathId:a.id,node:0}]);
  assert.deepEqual(deleteSelectedVectorNodes(before.paths,d.state.selectedNodes).map(p=>p.nodes),[[a.nodes[1]],[b.nodes[1]]]);
  assert.equal(deleteSelectedVectorNodes([a],[{pathId:a.id,node:0},{pathId:a.id,node:1}]).length,0);
});

test('Shift object addition preserves other partial anchors and anchor tools replace stale node selection',()=>{
  const a=vectorShape('rectangle',{x:0,y:0},{x:100,y:100},style),b=vectorShape('rectangle',{x:200,y:0},{x:300,y:100},style);
  const before={paths:[a,b],selected:[a.id],selectedNodes:[{pathId:a.id,node:0}]};
  const added=beginVectorDrag(before,'vector-node',point(250,0,{shift:true}),style,2).state;
  assert.deepEqual(added.selectedNodes.filter(n=>n.pathId===a.id),[{pathId:a.id,node:0}]);
  const converted=beginVectorDrag(before,'vector-anchor',a.nodes[1],style,2).state;
  assert.equal(converted.selectedNodes,undefined);assert.deepEqual(converted.selectedNode,{pathId:a.id,node:1});
});

test('pen feedback identifies only actionable endpoints and respects modifiers',async()=>{
  const {vectorPenEndpoint}=await import('../src/lib/vectorGesture.ts');
  let state=beginVectorDrag({paths:[],selected:[]},'vector-pen',point(0,0),style,3).state;
  assert.deepEqual(state.selectedNode,{pathId:state.activePath,node:0});
  assert.equal(vectorPenEndpoint(state,point(0,0),3),undefined);
  state=beginVectorDrag(state,'vector-pen',point(50,50),style,3).state;
  assert.deepEqual(state.selectedNode,{pathId:state.activePath,node:1});
  const tail=vectorShape('line',point(100,0),point(150,50),style);
  state={...state,paths:[...state.paths,tail]};
  assert.equal(vectorPenEndpoint(state,point(0,0),3).action,'close');
  assert.equal(vectorPenEndpoint(state,point(100,0),3).action,'join');
  for(const modifier of [{alt:true},{meta:true}])assert.equal(vectorPenEndpoint(state,point(100,0,modifier),3),undefined);
  assert.equal(vectorPenEndpoint(state,point(50,50),3),undefined);
  assert.equal(vectorPenEndpoint(state,point(105,0),3),undefined);
  assert.equal(vectorPenEndpoint({...state,activePath:undefined},point(150,50),3).action,'resume');
  assert.equal(vectorPenEndpoint({...state,paths:[{...tail,closed:true}]},point(100,0),3),undefined);
});
test('pen joins either endpoint, preserves curves and style, and continues from the far end',async()=>{
  const {reverseVector}=await import('../src/lib/vectorGeometry.ts');
  const head={...vectorShape('line',point(0,0),point(50,30),style),nodes:[{x:0,y:0,handleOut:{x:10,y:0}},{x:50,y:30,handleIn:{x:-10,y:0}}]};
  const tail={...vectorShape('line',point(100,50),point(150,0),{...style,width:20}),nodes:[{x:100,y:50,handleOut:{x:20,y:5}},{x:150,y:0,handleIn:{x:-15,y:0}}]};
  for(const reverse of [false,true]){
    const target=reverse?reverseVector(tail):tail;
    const before={paths:[head,target],selected:[head.id],activePath:head.id},saved=structuredClone(before);
    const drag=beginVectorDrag(before,'vector-pen',point(100,50),style,3);
    assert.equal(drag.state.paths.length,1);assert.equal(drag.state.activePath,head.id);
    assert.deepEqual(JSON.parse(JSON.stringify(drag.state.paths[0].nodes)),[...head.nodes,...tail.nodes]);
    assert.deepEqual(drag.state.paths[0].style,head.style);
    assert.deepEqual(drag.state.selectedNode,{pathId:head.id,node:2});
    const continued=beginVectorDrag(drag.state,'vector-pen',point(200,60),style,3).state;
    assert.equal(continued.paths.length,1);assert.equal(continued.paths[0].nodes.length,5);assert.deepEqual(continued.paths[0].nodes[4],{x:200,y:60});
    updateVectorDrag(drag,point(115,70));
    assert.deepEqual(drag.state.paths[0].nodes[2].handleOut,{x:15,y:20});
    assert.deepEqual(before,saved);
  }
});
test('joining coincident endpoints keeps one anchor and both existing curve tangents',()=>{
  const head={...vectorShape('line',point(0,0),point(50,30),style),nodes:[{x:0,y:0},{x:50,y:30,handleIn:{x:-10,y:-5}}]};
  const tail={...vectorShape('line',point(50,30),point(100,0),style),nodes:[{x:50,y:30,handleOut:{x:12,y:8}},{x:100,y:0}]};
  const state=beginVectorDrag({paths:[head,tail],selected:[head.id],activePath:head.id},'vector-pen',point(50,30),style,3).state;
  assert.equal(state.paths.length,1);assert.equal(state.paths[0].nodes.length,3);
  assert.deepEqual(state.paths[0].nodes[1],{x:50,y:30,handleIn:{x:-10,y:-5},handleOut:{x:12,y:8}});
});
