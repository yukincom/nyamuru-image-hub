import assert from 'node:assert/strict';
import test from 'node:test';
import {backgroundSelectionOutline} from '../src/lib/background3dSelection.ts';
test('visible silhouette has a green boundary and transparent interior, background and occluder',()=>{
 const w=11,h=11,mask=new Uint8Array(w*h*4);
 for(let y=1;y<10;y++)for(let x=1;x<10;x++)mask[(y*w+x)*4]=255;
 for(let y=4;y<7;y++)for(let x=4;x<7;x++)mask[(y*w+x)*4]=0;
 const out=backgroundSelectionOutline(mask,w,h,1),pixel=(x,y)=>Array.from(out.slice((y*w+x)*4,(y*w+x)*4+4));
 assert.deepEqual(pixel(1,1),[32,176,74,255]);assert.deepEqual(pixel(3,5),[32,176,74,255]);
 for(const point of [[0,0],[2,2],[5,5]])assert.deepEqual(pixel(...point),[0,0,0,0]);
 assert.equal(out.length,mask.length);assert.equal(mask[(1*w+1)*4],255);
});
