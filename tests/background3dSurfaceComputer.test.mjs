import assert from 'node:assert/strict';
import test from 'node:test';
import {BackgroundSurfaceComputer} from '../src/lib/background3dSurfaceComputer.ts';
const request=(rawKey='view')=>({rawKey,input:{width:1,height:1,frameWidth:1,frameHeight:1,fov:45,pixels:new Float32Array([.2,5,0,0])},edges:[],amount:.5,lineGap:0,creaseAngle:35});
const result={surface:{width:1,height:1,texture:new Float32Array([.2,5,1,0]),radius:1,footprint:.1},edges:[]};
class Port{
 messages=[];stopped=false;onmessage=null;onerror=null;onmessageerror=null;
 postMessage(message){this.messages.push(message);}
 terminate(){this.stopped=true;}
 finish(id,value=result){this.onmessage?.({data:{id,result:value}});}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('preview and capture share work; changing only omission strength does not resend the surface buffer',async()=>{
 const port=new Port(),computer=new BackgroundSurfaceComputer(async()=>port),first=computer.request('a',request());
 assert.equal(computer.request('a',request()),first);await tick();assert.ok(port.messages[0].input);
 port.finish(port.messages[0].id);assert.deepEqual(await first,result);assert.deepEqual(await computer.request('a',request()),result);assert.equal(port.messages.length,1);
 const second=computer.request('b',{...request(),amount:1});await tick();assert.equal(port.messages[1].input,undefined);assert.equal(port.messages[1].edges,undefined);port.finish(port.messages[1].id);await second;
 const camera=computer.request('c',request('next-view'));await tick();assert.ok(port.messages[2].input);port.finish(port.messages[2].id);await camera;computer.dispose();
});
test('new settings terminate obsolete work and stale results cannot replace a capture',async()=>{
 const ports=[],computer=new BackgroundSurfaceComputer(async()=>{const port=new Port();ports.push(port);return port;});
 const old=computer.request('a',request()),rejected=assert.rejects(old,{name:'AbortError'});await tick();const oldId=ports[0].messages[0].id;
 const current=computer.request('b',request());await rejected;await tick();assert.ok(ports[0].stopped);assert.ok(ports[1].messages[0].input);
 ports[0].finish(oldId);assert.equal(computer.result('a'),null);ports[1].finish(ports[1].messages[0].id);assert.deepEqual(await current,result);assert.equal(computer.result('a'),null);computer.dispose();
});
test('closing during worker startup sends no buffers and settles the pending capture',async()=>{
 let ready;const port=new Port(),computer=new BackgroundSurfaceComputer(()=>new Promise(resolve=>{ready=resolve;}));
 const pending=computer.request('a',request()),rejected=assert.rejects(pending,{name:'AbortError'});computer.dispose();await rejected;ready(port);await tick();
 assert.ok(port.stopped);assert.equal(port.messages.length,0);await assert.rejects(computer.request('a',request()),{name:'AbortError'});
});
test('worker errors reject capture and retry resends the required buffers',async()=>{
 const ports=[],computer=new BackgroundSurfaceComputer(async()=>{const port=new Port();ports.push(port);return port;});
 const pending=computer.request('a',request()),rejected=assert.rejects(pending,/停止/);await tick();ports[0].onerror();await rejected;
 const retry=computer.request('a',request());await tick();assert.ok(ports[1].messages[0].input);ports[1].finish(ports[1].messages[0].id);await retry;computer.dispose();
});
