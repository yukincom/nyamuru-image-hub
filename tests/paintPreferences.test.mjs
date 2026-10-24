import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPaintBleed, savePaintBleed, loadPaintSmoothing, savePaintSmoothing, loadPaintCursor, savePaintCursor } from '../src/lib/paintPreferences.ts';

test('paint margin survives preference reload and zero is distinct from absence',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 assert.equal(loadPaintBleed(storage),200);
 for(const value of [0,380]){savePaintBleed(storage,value);assert.equal(loadPaintBleed(storage),value);}
 for(const value of [NaN,-1,1.2,4001])assert.throws(()=>savePaintBleed(storage,value));
 assert.equal(loadPaintBleed(storage),380);
 assert.equal(loadPaintBleed({getItem:()=>'{broken'}),200);
});

test('smoothing persists independently of bleed and rejects invalid settings',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 assert.equal(loadPaintSmoothing(storage),0);savePaintBleed(storage,300);savePaintSmoothing(storage,7);
 assert.equal(loadPaintSmoothing(storage),7);assert.equal(loadPaintBleed(storage),300);
 for(const value of [-1,16,1.5,NaN])assert.throws(()=>savePaintSmoothing(storage,value));
 assert.equal(loadPaintSmoothing({getItem:()=>'{broken'}),0);
});

test('cursor choice survives reload independently of smoothing and tolerates unavailable storage',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 savePaintSmoothing(storage,7);savePaintCursor(storage,'crosshair');assert.equal(loadPaintCursor(storage),'crosshair');
 savePaintCursor(storage,'circle');assert.equal(loadPaintCursor(storage),'circle');assert.equal(loadPaintSmoothing(storage),7);
 assert.equal(loadPaintCursor({getItem:()=>{throw Error('Unavailable');}}),'circle');
 assert.equal(loadPaintCursor({getItem:()=>'{broken'}),'circle');
});
