import test from 'node:test';
import assert from 'node:assert/strict';
import {drawPaintStroke} from '../src/lib/paintRenderer.ts';
import {drawVectorPath} from '../src/lib/vectorRenderer.ts';
import {defaultVectorStyle,vectorShape,hitVector,eraseVectors} from '../src/lib/vectorGeometry.ts';
const context=()=>{const ops=[];return {ops,save(){},restore(){},setLineDash(){},beginPath(){},moveTo(){},bezierCurveTo(){},closePath(){},arc(){},rect(...a){ops.push(['rect',...a]);},clip(){ops.push(['clip']);},fillRect(...a){ops.push(['fillRect',this.globalCompositeOperation,...a]);},fill(){ops.push(['fill']);},stroke(){ops.push(['stroke']);}};};
test('none vector stroke never draws dots, outlines or arrowheads; its fill remains',()=>{
  for(const shape of ['line','rectangle']){const c=context(),p=vectorShape(shape,{x:0,y:0},{x:20,y:20},{...defaultVectorStyle(),stroke:null,fill:'#000000',arrowEnd:'triangle'});drawVectorPath(c,p);assert.deepEqual(c.ops,[['fill']]);
    c.ops.length=0;drawVectorPath(c,{...p,style:{...p.style,fill:null}});assert.deepEqual(c.ops,[]);}
});
test('a brush clips to its captured selection and clear/fill replay their region',()=>{
  const c=context(),selection=[{x:3,y:5,w:10,h:8}],stroke={tool:'pen',color:'#000000',size:3,points:[{x:0,y:0,pressure:1,time:0}],selection};
  drawPaintStroke(c,stroke);assert.deepEqual(c.ops.slice(0,2),[['rect',3,5,10,8],['clip']]);
  for(const [tool,op] of [['fill','source-over'],['clear','destination-out']]){
    c.ops.length=0;drawPaintStroke(c,{...stroke,tool});
    assert.deepEqual(c.ops,[['rect',3,5,10,8],['fill']]);assert.equal(c.globalCompositeOperation,op);
  }
});

test('fill-only open paths stay selectable and invisible strokes are not erased',()=>{
  const p={id:'open',closed:false,nodes:[{x:0,y:0},{x:100,y:0},{x:50,y:100}],style:{...defaultVectorStyle(),stroke:null,fill:'#000000'}};
  assert.equal(hitVector([p],{x:50,y:40},2),p.id);
  assert.deepEqual(eraseVectors([p],[{x:50,y:0}],10,'whole'),[p]);
});
