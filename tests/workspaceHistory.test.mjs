import assert from 'node:assert/strict';
import test from 'node:test';
import {workspaceHistory} from '../src/lib/workspaceHistory.ts';
test('capture, strokes, another panel and layout share a single chronological timeline',()=>{
 const timeline=workspaceHistory(50),states=['initial','shot A','stroke 1','stroke 2','panel B','layout'];
 for(const before of states.slice(0,-1))timeline.record(before);
 let current=states.at(-1);for(const target of states.slice(0,-1).reverse()){current=timeline.undo(current);assert.equal(current,target);}
 assert.equal(timeline.undo(current),undefined);
 for(const target of states.slice(1)){current=timeline.redo(current);assert.equal(current,target);}
 assert.equal(timeline.redo(current),undefined);
});
test('retention evicts oldest snapshots, reducing the preference trims both sides, branching drops redo',()=>{
 const h=workspaceHistory(3);for(const n of [0,1,2,3])h.record(n);assert.deepEqual(h.past,[1,2,3]);
 assert.equal(h.undo(4),3);assert.equal(h.undo(3),2);h.resize(2);assert.deepEqual(h.past,[1]);assert.deepEqual(h.future,[3]);
 assert.equal(h.redo(2),3);h.record(3);assert.deepEqual(h.past,[2,3]);assert.deepEqual(h.future,[]);
 h.clear();assert.deepEqual(h.past,[]);assert.deepEqual(h.future,[]);
});
test('pending asset blobs remain attached to their snapshot until it leaves the shared history',()=>{
 const h=workspaceHistory(2),blob=new Blob(['old shot']),old={document:{},paint:{imports:[{blob}]}};
 h.record(old);h.record({document:{},paint:{imports:[]}});assert.equal(h.past[0].paint.imports[0].blob,blob);
 h.record({document:{}});assert.ok(!h.past.includes(old));h.clear();assert.equal(h.past.length,0);
});
