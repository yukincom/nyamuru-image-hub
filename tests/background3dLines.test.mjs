import assert from 'node:assert/strict';
import test from 'node:test';
import {BackgroundLineComputer} from '../src/lib/background3dLines.ts';

const view=(x=0)=>({viewProjection:[x],cameraPosition:[x,0,5],options:{width:100,height:100,creaseAngle:35,detail:1,outlineWidth:2,detailWidth:1}});
const result={segments:[],stats:{triangles:12,candidates:12}};
class Port{
 messages=[];stopped=false;onmessage=null;onerror=null;onmessageerror=null;
 postMessage(message){this.messages.push(message);}
 terminate(){this.stopped=true;}
 finish(id,value=result){this.onmessage?.({data:{id,result:value}});}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('same camera shares its calculation and reuses exact results without sending geometry again',async()=>{
 const port=new Port(),computer=new BackgroundLineComputer([],async()=>port);
 const first=computer.request(view());assert.equal(computer.request(view()),first);await tick();
 assert.equal(port.messages.length,2);assert.deepEqual(port.messages[0],{meshes:[]});port.finish(port.messages[1].id);
 assert.deepEqual(await first,result);assert.deepEqual(await computer.request(view()),result);assert.equal(port.messages.length,2);
 const next=computer.request(view(1));await tick();assert.equal(port.messages.length,3);port.finish(port.messages[2].id);await next;
 computer.dispose();assert.equal(port.stopped,true);
});
test('camera changes stop obsolete work and stale replies cannot replace the current result',async()=>{
 const ports=[],computer=new BackgroundLineComputer([],async()=>{const port=new Port();ports.push(port);return port;});
 const old=computer.request(view()),rejected=assert.rejects(old,{name:'AbortError'});await tick();const oldId=ports[0].messages[1].id;
 const current=computer.request(view(1));await rejected;await tick();assert.equal(ports[0].stopped,true);
 ports[0].finish(oldId,{...result,stats:{triangles:999,candidates:999}});assert.equal(computer.result(view()),null);
 ports[1].finish(ports[1].messages[1].id);assert.deepEqual(await current,result);assert.equal(computer.result(view()),null);computer.dispose();
});
test('closing before worker creation completes terminates it without posting a stale model',async()=>{
 let ready;const port=new Port(),computer=new BackgroundLineComputer([],()=>new Promise(resolve=>{ready=resolve;}));
 const pending=computer.request(view()),rejected=assert.rejects(pending,{name:'AbortError'});computer.dispose();await rejected;ready(port);await tick();
 assert.equal(port.stopped,true);assert.equal(port.messages.length,0);await assert.rejects(computer.request(view()),{name:'AbortError'});
});
test('worker failure rejects capture and a subsequent request can retry',async()=>{
 const ports=[],computer=new BackgroundLineComputer([],async()=>{const port=new Port();ports.push(port);return port;});
 const pending=computer.request(view()),rejected=assert.rejects(pending,/停止/);await tick();ports[0].onerror();await rejected;assert.equal(ports[0].stopped,true);
 const retry=computer.request(view());await tick();ports[1].finish(ports[1].messages[1].id);assert.deepEqual(await retry,result);computer.dispose();
});

test('returning to a cached camera cancels newer work instead of letting it replace that cache',async()=>{
 const port=new Port(),computer=new BackgroundLineComputer([],async()=>port);
 const first=computer.request(view());await tick();port.finish(port.messages[1].id);await first;
 const obsolete=computer.request(view(1)),rejected=assert.rejects(obsolete,{name:'AbortError'});await tick();const obsoleteId=port.messages[2].id;
 assert.deepEqual(await computer.request(view()),result);await rejected;assert.equal(port.stopped,true);
 port.finish(obsoleteId,{...result,stats:{triangles:999,candidates:999}});
 assert.deepEqual(computer.result(view()),result);assert.equal(computer.result(view(1)),null);computer.dispose();
});
