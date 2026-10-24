import test from 'node:test';
import assert from 'node:assert/strict';
import {nextMonoInk,swapPaintInk} from '../src/lib/paintInk.ts';
test('X cycles ink while the arrow actually swaps fill and stroke including none',()=>{
  assert.deepEqual([nextMonoInk('#000000',true),nextMonoInk('#ffffff',true),nextMonoInk(null,true)],['#ffffff',null,'#000000']);
  assert.equal(nextMonoInk('#ffffff',false),'#000000');
  assert.deepEqual(swapPaintInk({fill:'#ffffff',stroke:'#000000'}),{fill:'#000000',stroke:'#ffffff'});
  assert.deepEqual(swapPaintInk({fill:null,stroke:'#000000'}),{fill:'#000000',stroke:null});
});
