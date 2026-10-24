import test from 'node:test';
import assert from 'node:assert/strict';
import {pixelZoomWidth,canvasZoomPercent,clampCanvasZoom,canvasZoomShortcut} from '../src/lib/canvasZoom.ts';
import {paintPreviewSize} from '../src/lib/paintPreviewSize.ts';

test('100 percent maps A4 output pixels one to one on standard and Retina displays',()=>{
 for(const [dpi,width] of [[350,2894],[600,4961]])for(const dpr of [1,2,3]){
  assert.equal(Math.round(210*dpi/25.4),width);
  const css=pixelZoomWidth(width,dpr);
  assert.equal(css*dpr,width);assert.equal(canvasZoomPercent(css,css),100);
  const fit=537.37;assert.ok(canvasZoomPercent(fit,css)<100);
  assert.equal(canvasZoomPercent(css/4,css),25);
 }
 assert.equal(pixelZoomWidth(4961,NaN),4961);
 assert.equal(clampCanvasZoom(0),1);assert.equal(clampCanvasZoom(800),400);
});
test('preview tracks display device pixels and never downsamples a native-size tone',()=>{
 assert.deepEqual(paintPreviewSize(1212,1449,303,362.25,1),{width:303,height:362});
 assert.deepEqual(paintPreviewSize(1212,1449,303,362.25,2),{width:606,height:725});
 assert.deepEqual(paintPreviewSize(4961,7016,2480.5,3508,2),{width:4961,height:7016});
 assert.deepEqual(paintPreviewSize(4961,7016,4961,7016,2),{width:4961,height:7016});
});

test('tablet zoom chords preserve anchor tools, IME and text input',()=>{
 for(const modifier of ['metaKey','ctrlKey']){
  for(const key of ['+','='])assert.equal(canvasZoomShortcut({key,[modifier]:true}),1.25);
  assert.equal(canvasZoomShortcut({key:'-',[modifier]:true}),.8);
 }
 for(const key of ['+','-','='])assert.equal(canvasZoomShortcut({key}),undefined);
 assert.equal(canvasZoomShortcut({key:'+',metaKey:true},true),undefined);
 assert.equal(canvasZoomShortcut({key:'+',ctrlKey:true,isComposing:true}),undefined);
 assert.equal(canvasZoomShortcut({key:'+',ctrlKey:true,altKey:true}),undefined);
});
