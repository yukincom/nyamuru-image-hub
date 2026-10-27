import test from 'node:test';
import assert from 'node:assert/strict';
import {alphaSelection,boxesMask,maskBoxes,combineSelection,lassoSelection,floodSelection,selectionPath} from '../src/lib/rasterSelection.ts';
const pixels=(rows)=>({width:rows[0].length,height:rows.length,data:new Uint8ClampedArray(rows.flatMap(r=>[...r].flatMap(v=>v==='.'?[222,99,33,0]:v==='w'?[255,255,255,255]:[0,0,0,255])))});
const count=(boxes,w=7,h=7)=>boxesMask(boxes,w,h).reduce((a,b)=>a+b,0);
test('flood fill respects connected regions, alpha, bounds and selection limit',()=>{
  const p=pixels(['.......','.#####.','.#www#.','.#www#.','.#####.','.......']);
  assert.equal(count(floodSelection(p,3,2)),6);assert.equal(count(floodSelection(p,0,0)),22);
  assert.equal(count(floodSelection(p,3,2,24,[{x:2,y:2,w:1,h:2}])),0);
  assert.equal(count(floodSelection(p,2,2,24,[{x:2,y:2,w:1,h:2}])),2);
  assert.deepEqual(floodSelection(p,-1,0),[]);
  assert.equal(count(alphaSelection(p)),20);
});
test('lasso closes a polygon and add/subtract use actual pixels rather than its bounding box',()=>{
  const tri=lassoSelection([{x:1,y:1},{x:5,y:1},{x:1,y:5}]);assert.equal(count(tri),6);
  const b=[{x:1,y:1,w:4,h:4}],a=combineSelection(b,tri,'subtract');assert.equal(count(a),10);
  assert.equal(count(combineSelection(a,tri,'add')),16);
  assert.deepEqual(lassoSelection([{x:1,y:1}]),[]);
});
test('mask compression and perimeter remove internal seams',()=>{
  const boxes=[{x:1,y:1,w:3,h:2}];assert.deepEqual(maskBoxes(boxesMask(boxes,5,5),5,5),boxes);
  const d=selectionPath([{x:1,y:1,w:3,h:1},{x:1,y:2,w:3,h:1}]);assert.equal(d.includes('M1,2H4'),false);
  assert.deepEqual([...boxesMask([],2,2)],[0,0,0,0]);
});
test('lasso keeps all four outside edges, disconnected islands and even-odd holes',()=>{
  const outer=[{x:-3,y:-2},{x:10,y:-2},{x:10,y:12},{x:-3,y:12}];
  assert.deepEqual(lassoSelection(outer),[{x:-3,y:-2,w:13,h:14}]);
  const cut=lassoSelection([{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}]);
  const hole=combineSelection(lassoSelection(outer),cut,'subtract');
  assert.equal(hole.reduce((sum,b)=>sum+b.w*b.h,0),13*14-16);
  assert.deepEqual(combineSelection(hole,cut,'add'),lassoSelection(outer));
  const island=[{x:1e9,y:-1e9,w:2,h:3}];
  const all=combineSelection(hole,island,'add');assert.equal(all.reduce((sum,b)=>sum+b.w*b.h,0),13*14-16+6);
  assert.deepEqual(combineSelection(all,island,'subtract'),hole);
  // A doubled bridge connects the two loops without selecting its interior.
  const inner=[{x:0,y:0},{x:0,y:4},{x:4,y:4},{x:4,y:0}];
  assert.deepEqual(lassoSelection([...outer,outer[0],...inner,inner[0],outer[0]]),hole);
});
test('run booleans retain the pixel-center convention for fractional overlapping boxes',()=>{
  const shift=boxes=>boxes.map(b=>({...b,x:b.x+10,y:b.y+10}));
  for(let i=0;i<50;i++){
    const old=[{x:-4+i%5/3,y:-3.6,w:5.2,h:4.1},{x:0,y:-2,w:4,h:6}];
    const next=[{x:-2.1,y:-4+i%7/3,w:6.8,h:3.3},{x:3,y:1,w:3,h:3}];
    const a=boxesMask(shift(old),24,24),b=boxesMask(shift(next),24,24);
    for(const mode of ['add','subtract'])assert.deepEqual(boxesMask(shift(combineSelection(old,next,mode)),24,24),a.map((v,j)=>mode==='add'?v|b[j]:v&&!b[j]?1:0));
  }
  assert.deepEqual(lassoSelection([{x:-1.4,y:-2.4},{x:2.7,y:-2.4},{x:2.7,y:3.7},{x:-1.4,y:3.7}]),[{x:-1,y:-2,w:4,h:6}]);
  assert.throws(()=>lassoSelection([{x:0,y:0},{x:NaN,y:2},{x:3,y:4}]),/有限/);
  assert.throws(()=>lassoSelection([{x:0,y:0},{x:2,y:20000},{x:3,y:4}]),/大きすぎ/);
});
test('sparse selection width is independent of raster capacity; scanline work has explicit bounds',()=>{
  const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
  for(const [w,h] of [[20000,4],[10001,10000],[4,16384]]){
    const boxes=lassoSelection(rectangle(w,h));
    assert.deepEqual(JSON.parse(JSON.stringify(boxes)),[{x:0,y:0,w,h}]);
    assert.deepEqual(JSON.parse(JSON.stringify(combineSelection([],boxes,'add'))),[{x:0,y:0,w,h}]);
  }
  assert.throws(()=>lassoSelection(rectangle(4,16385)),/大きすぎ/);
  const atBudget=[...Array.from({length:4093},()=>({x:0,y:0})),...rectangle(4,4096).slice(1)];
  assert.deepEqual(JSON.parse(JSON.stringify(lassoSelection(atBudget))),[{x:0,y:0,w:4,h:4096}]);
  assert.throws(()=>lassoSelection([...atBudget,atBudget[0]]),/大きすぎ/);
});
