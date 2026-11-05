import {mangaCanvasSource} from './editorModuleSources.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {alphaContentGeometry,contentBox,frameFromContentEdit} from '../src/lib/canvasContentGeometry.ts';

test('visible bounds exclude bleed and preserve opaque white plus low alpha ink',()=>{
 const pixels={width:20,height:16,data:new Uint8ClampedArray(20*16*4)};
 for(let y=4;y<12;y++)for(let x=6;x<14;x++)pixels.data.set([255,255,255,255],(y*20+x)*4);
 pixels.data[(2*20+17)*4+3]=1;
 const geometry=alphaContentGeometry(pixels);
 assert.deepEqual(geometry.bounds,{x:6,y:2,w:12,h:10});
 assert.deepEqual(contentBox({x:10,y:30,w:40,h:32},geometry),{x:22,y:34,w:24,h:20});
});
test('alpha geometry merges filled rows without filling erased holes',()=>{
 const pixels={width:8,height:8,data:new Uint8ClampedArray(8*8*4)};
 for(let y=1;y<7;y++)for(let x=1;x<7;x++)if(x<3||x>=5||y<3||y>=5)pixels.data[(y*8+x)*4+3]=255;
 const result=alphaContentGeometry(pixels);
 assert.deepEqual(result.bounds,{x:1,y:1,w:6,h:6});
 assert.equal(result.path,'M1 1h6v2h-6zM1 3h2v2h-2zM5 3h2v2h-2zM1 5h6v2h-6z');
 assert.deepEqual(alphaContentGeometry({width:8,height:8,data:new Uint8ClampedArray(256)}),{width:8,height:8,bounds:null,path:''});
});

test('overflow alpha keeps negative reference coordinates for selection outside the old box',()=>{
 const pixels={width:30,height:20,data:new Uint8ClampedArray(30*20*4)};
 for(let y=2;y<10;y++)for(let x=1;x<25;x++)pixels.data[(y*30+x)*4+3]=255;
 const result=alphaContentGeometry(pixels,{x:-10,y:-5,width:10,height:10});
 assert.deepEqual(result.bounds,{x:-9,y:-3,w:24,h:8});
 assert.deepEqual(contentBox({x:100,y:100,w:10,h:10},result),{x:91,y:97,w:24,h:8});
 assert.match(result.path,/^M-9 -3/);
});

test('selection measurement does not upscale small artwork or rerasterize on every zoom frame',()=>{
 const source=readFileSync(new URL('../src/components/CanvasContentSelection.tsx',import.meta.url),'utf8');
 assert.match(source,/scale=Math\.min\(1,768\/side\)/);
 assert.doesNotMatch(source,/256\/side/);
 assert.match(source,/const schedule=\(\)=>\{version\+\+;cancelAnimationFrame\(raf\);clearTimeout\(timer\);timer=window\.setTimeout\(measure,120\);\}/);
 const canvas=mangaCanvasSource();
 assert.match(canvas,/const panelBubblePresentations = useMemo\(/);
 assert.match(canvas,/const overlayBubblePresentation = useMemo\(/);
 for(const match of canvas.matchAll(/const (?:panelBubblePresentations|overlayBubblePresentation) = useMemo\([\s\S]+?\),\[([^\]]+)\]\);/g))assert.doesNotMatch(match[1],/zoom|fitEpoch/);
});
test('visible handles move/resize the entire frame while retaining asymmetric bleed',()=>{
 const frame={x:0,y:10,w:100,h:80},visible={x:20,y:20,w:40,h:50};
 assert.deepEqual(frameFromContentEdit(frame,visible,{...visible,x:27,y:16}),{x:7,y:6,w:100,h:80});
 for(const [x,y] of [[20,20],[-20,20],[20,-30],[-20,-30]]){
  const resized={x,y,w:80,h:100},next=frameFromContentEdit(frame,visible,resized);
  assert.equal((visible.x-frame.x)/frame.w,(resized.x-next.x)/next.w);
  assert.equal((visible.y-frame.y)/frame.h,(resized.y-next.y)/next.h);
  assert.equal(next.w,200);assert.equal(next.h,160);
 }
 assert.deepEqual(frame,{x:0,y:10,w:100,h:80});
});
