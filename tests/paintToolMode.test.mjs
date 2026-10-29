import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPaintLineKind, vectorInput, paintSelectionMode } from '../src/lib/paintToolMode.ts';
import { commitPaintStroke } from '../src/lib/paintGesture.ts';
import { newPaintLayer } from '../src/lib/paintDocument.ts';

test('shapes keep the last drawing kind across selection and erasing',()=>{
  let kind=nextPaintLineKind('vector','pen');
  for(const tool of ['rectangle','ellipse','line','eraser','vector-node'])kind=nextPaintLineKind(kind,tool);
  assert.equal(kind,'raster');
  for(const tool of ['line','rectangle','ellipse'])assert.equal(vectorInput(tool,kind,'vector'),false);
  kind=nextPaintLineKind(kind,'vector-pen');
  for(const tool of ['rectangle','ellipse','line','eraser'])kind=nextPaintLineKind(kind,tool);
  assert.equal(kind,'vector');
  for(const tool of ['line','rectangle','ellipse'])assert.equal(vectorInput(tool,kind,'raster'),true);
  assert.equal(vectorInput('pen',nextPaintLineKind(kind,'pen'),'vector'),false);
});
test('eraser and pen eraser end follow the layer without changing the remembered pen kind',()=>{
  for(const kind of ['raster','vector']){
    assert.equal(vectorInput('eraser',kind,'vector'),true);
    assert.equal(vectorInput('eraser',kind,'raster'),false);
    assert.equal(vectorInput('vector-pen',kind,'raster',true),false);
    assert.equal(vectorInput('rectangle',kind,'vector',true),true);
    assert.equal(nextPaintLineKind(kind,'eraser'),kind);
  }
});
test('raster rectangle on vector artwork inserts an independent layer with its complete shape',()=>{
  const vector=newPaintLayer('ベクター','vector'),added=newPaintLayer();
  const before={frame:{x:0,y:0,w:20,h:20},owners:[{key:'background',kind:'background',index:0,label:'背景',frame:{x:0,y:0,w:20,h:20},paint:{version:1,width:200,height:200,dpi:100,layers:[vector]}}]};
  const stroke={tool:'rectangle',color:'#ffffff',size:3,points:[{x:10,y:10,pressure:1,time:0},{x:90,y:70,pressure:1,time:1}]};
  const after=commitPaintStroke(before,{ownerKey:'background',layerId:added.id,addedLayer:added,stroke});
  assert.equal(before.owners[0].paint.layers.length,1);
  assert.equal(after.owners[0].paint.layers[0],vector);
  assert.equal(after.owners[0].paint.layers[1].kind,'raster');
  assert.deepEqual(after.owners[0].paint.layers[1].strokes,[stroke]);
});

test('V moves selected raster paint while guides and direct selection retain native layout',()=>{
 assert.equal(paintSelectionMode('vector-select',true,'raster',true),'paint');
 assert.equal(paintSelectionMode('vector-select',true,'raster',false),'layout');
 assert.equal(paintSelectionMode('vector-node',true,'raster',true),'layout');
 assert.equal(paintSelectionMode('vector-node',true,'vector',true),'paint');
 assert.equal(paintSelectionMode('vector-select',false,'raster',true),'layout');
});
