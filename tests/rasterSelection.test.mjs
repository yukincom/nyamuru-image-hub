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
  const tri=lassoSelection([{x:1,y:1},{x:5,y:1},{x:1,y:5}],7,7);assert.equal(count(tri),6);
  const b=[{x:1,y:1,w:4,h:4}],a=combineSelection(b,tri,'subtract',7,7);assert.equal(count(a),10);
  assert.equal(count(combineSelection(a,tri,'add',7,7)),16);
  assert.deepEqual(lassoSelection([{x:1,y:1}],7,7),[]);
});
test('mask compression and perimeter remove internal seams',()=>{
  const boxes=[{x:1,y:1,w:3,h:2}];assert.deepEqual(maskBoxes(boxesMask(boxes,5,5),5,5),boxes);
  const d=selectionPath([{x:1,y:1,w:3,h:1},{x:1,y:2,w:3,h:1}]);assert.equal(d.includes('M1,2H4'),false);
  assert.deepEqual([...boxesMask([],2,2)],[0,0,0,0]);
});
