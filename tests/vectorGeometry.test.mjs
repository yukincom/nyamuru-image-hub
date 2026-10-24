import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultVectorStyle, vectorShape, vectorBounds, transformVector, alignVectors, distributeVectors, eraseVectors, insertVectorAnchor, paperPath, convertVectorNodes } from '../src/lib/vectorGeometry.ts';
import { paintScene, expandPaintOwner, validatePaintDocument } from '../src/lib/paintDocument.ts';
const style=()=>({...defaultVectorStyle(),width:1});
const line=(x1,y1,x2,y2)=>vectorShape('line',{x:x1,y:y1},{x:x2,y:y2},style());
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.01,`${actual} != ${expected}`);
test('ellipses keep cubic handles through scale and canvas padding',()=>{
  const path=vectorShape('ellipse',{x:10,y:20},{x:70,y:100},style());assert.equal(path.nodes.length,4);assert.ok(path.nodes.some(n=>n.handleOut));
  const shifted=transformVector(path,5,8,2);const b=vectorBounds(shifted);assert.deepEqual(b,{x:25,y:48,w:120,h:160});
  const owner=paintScene({id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:0,bubbles:[]},100,[]).owners[0];owner.paint.layers[0]={...owner.paint.layers[0],kind:'vector',paths:[path]};
  const expanded=expandPaintOwner(owner,{left:20,right:20,top:30,bottom:30});assert.deepEqual(vectorBounds(expanded.paint.layers[0].paths[0]),{x:30,y:50,w:60,h:80});validatePaintDocument(expanded.paint,[]);
});
test('align keeps key object fixed and spacing respects unequal bounds',()=>{
  const paths=[[0,10],[30,20],[90,30]].map(([x,w])=>vectorShape('rectangle',{x,y:0},{x:x+w,y:10},style())),ids=paths.map(p=>p.id),canvas={x:0,y:0,w:200,h:100};
  const aligned=alignVectors(paths,ids,'left','key',canvas,ids[1]);assert.deepEqual(aligned.map(p=>vectorBounds(p).x),[30,30,30]);
  const spaced=distributeVectors(paths,ids,'x','gap','key',canvas,ids[1],5);assert.deepEqual(spaced.map(p=>vectorBounds(p).x),[15,30,55]);
  const automatic=distributeVectors(paths,ids,'x','gap','selection',canvas);assert.deepEqual(automatic.map(p=>vectorBounds(p).x),[0,40,90]);
  const centered=distributeVectors(paths,ids,'x','center','canvas',canvas);assert.deepEqual(centered.map(p=>vectorBounds(p).x+0),[0,85,170]);
});
test('intersection eraser removes only the touched interval, retaining crossing paths',()=>{
  const paths=[line(0,50,100,50),line(30,0,30,100),line(70,0,70,100)];
  const erased=eraseVectors(paths,[{x:50,y:50}],2,'intersection');
  assert.equal(erased.length,4);assert.equal(erased.filter(p=>paths.slice(1).includes(p)).length,2);
  const fragments=erased.filter(p=>!paths.includes(p)).map(vectorBounds);assert.equal(fragments.length,2);near(fragments[0].x,0);near(fragments[0].w,30);near(fragments[1].x,70);near(fragments[1].w,30);
});
test('touch eraser splits a Bezier without flattening its retained curves; whole eraser removes path',()=>{
  const p={...line(0,0,100,0),nodes:[{x:0,y:0,handleOut:{x:25,y:60}},{x:100,y:0,handleIn:{x:-25,y:60}}]};
  const touched=eraseVectors([p],[{x:50,y:45}],5,'touch');assert.equal(touched.length,2);assert.ok(touched.every(p=>p.nodes.some(n=>n.handleOut||n.handleIn)));assert.equal(eraseVectors([p],[{x:50,y:45}],5,'whole').length,0);
  assert.deepEqual(eraseVectors([p],[{x:500,y:500}],5,'whole'),[p]);
});
test('closed paths survive partial erasure as open vector fragments',()=>{
  const p=vectorShape('rectangle',{x:0,y:0},{x:100,y:100},style());const parts=eraseVectors([p],[{x:50,y:0}],5,'touch');assert.ok(parts.length);assert.ok(parts.every(p=>!p.closed));const lengths=parts.map(p=>{const curve=paperPath(p),length=curve.length;curve.remove();return length;});near(lengths.reduce((a,b)=>a+b,0),389);
});
test('inserting an anchor preserves the exact curve and malformed vectors are rejected',()=>{
  const path=vectorShape('ellipse',{x:0,y:0},{x:100,y:100},style()),next=insertVectorAnchor(path,{x:85,y:15});assert.equal(next.nodes.length,5);assert.deepEqual(vectorBounds(next),vectorBounds(path));
  const owner=paintScene({id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:0,bubbles:[]},100,[]).owners[0];owner.paint.layers[0]={...owner.paint.layers[0],kind:'vector',paths:[path]};validatePaintDocument(owner.paint,[]);
  for(const mutate of [p=>p.nodes[0].x=Infinity,p=>p.style.dash=[-1],p=>p.style.width=0,p=>p.style.fill='#nothex']){const doc=structuredClone(owner.paint);mutate(doc.layers[0].paths[0]);assert.throws(()=>validatePaintDocument(doc,[]));}
});

test('single-anchor dots remain selectable and erasable',async()=>{
 const {hitVector}=await import('../src/lib/vectorGeometry.ts');const p={id:'dot',nodes:[{x:20,y:30}],closed:false,style:style()};
 assert.equal(hitVector([p],{x:20,y:30},3),'dot');assert.equal(eraseVectors([p],[{x:20,y:30}],3,'touch').length,0);
});

test('corner and smooth conversion changes only the chosen anchor',()=>{
  const path=vectorShape('ellipse',{x:0,y:0},{x:100,y:100},style());
  const corner=convertVectorNodes(path,false,1);
  assert.equal(corner.nodes[1].handleIn,undefined);assert.equal(corner.nodes[1].handleOut,undefined);
  for(const i of [0,2,3])assert.deepEqual(corner.nodes[i],path.nodes[i]);
  const smooth=convertVectorNodes(corner,true,1);assert.ok(smooth.nodes[1].handleOut);
  for(const i of [0,2,3])assert.deepEqual(smooth.nodes[i],corner.nodes[i]);
});
