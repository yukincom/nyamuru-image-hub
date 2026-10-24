import assert from 'node:assert/strict';
import test from 'node:test';
import {loadHistorySteps,saveHistorySteps} from '../src/lib/historyPreferences.ts';
test('history limit defaults to 50 and persists a validated user choice',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 assert.equal(loadHistorySteps(storage),50);assert.equal(saveHistorySteps(storage,120),120);assert.equal(loadHistorySteps(storage),120);
 for(const value of [0,-1,1001,1.5,NaN,'50'])assert.throws(()=>saveHistorySteps(storage,value));assert.equal(loadHistorySteps(storage),120);
 storage.getItem=()=>'{';assert.equal(loadHistorySteps(storage),50);
});
