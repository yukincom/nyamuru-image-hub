import assert from 'node:assert/strict';
import test from 'node:test';
import {applyPaintTone} from '../src/lib/paintTone.ts';
const pixels=(w,h)=>({width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>i%4===3?255:0)});
const tone={enabled:true,mode:'fixed',lpi:60,density:20,angle:45,origin:{x:0,y:0}};
test('reduced 3D tone uses the same mean coverage as manuscript previews',()=>{
 for(const [dpi,physical,mean] of [[350,4096,6/32],[600,7168,20/98]]){
  const preview=pixels(256,256);applyPaintTone(preview,tone,dpi,physical,physical,true);
  const values=preview.data.filter((_,i)=>i%4===3);assert.ok(values.every(n=>Math.abs(n/255-mean)<.5/255));
 }
});
test('cropped views match the manuscript pixel grid at integer and fractional document offsets',()=>{
 for(const scale of [1,.8,.5])for(const [left,top] of [[20,30],[21,31]]){
  const full=pixels(160,160),crop=pixels(80,80);
  applyPaintTone(full,tone,600,160/scale,160/scale,true);
  applyPaintTone(crop,tone,600,80/scale,80/scale,true,{x:left/scale,y:top/scale});
  for(let y=0;y<80;y++)for(let x=0;x<80;x++)assert.equal(crop.data[(y*80+x)*4+3],full.data[((y+top)*160+x+left)*4+3]);
 }
});
test('native 3D tone dots retain identical shapes at every repeated screen cell',()=>{
 const native=pixels(126,126);applyPaintTone(native,tone,600,126,126,true);
 for(let y=0;y<119;y++)for(let x=0;x<112;x++){
  const alpha=native.data[(y*126+x)*4+3];assert.ok(alpha===0||alpha===255);
  assert.equal(alpha,native.data[(y*126+x+14)*4+3]);assert.equal(alpha,native.data[((y+7)*126+x+7)*4+3]);
 }
});
