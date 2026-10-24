import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgentSession} from '../src/lib/agentSession.ts';

test('collapse discards history and invalidates pending replies; restart starts empty',()=>{
  const session=createAgentSession(),ticket=session.ticket();
  session.append({role:'user',content:'2ページに移動して'});
  session.append({role:'assistant',content:'2ページを表示しました'});
  assert.equal(session.snapshot().length,2);
  session.reset();
  assert.equal(session.isCurrent(ticket),false);
  assert.deepEqual(session.snapshot(),[]);
  assert.deepEqual(createAgentSession().snapshot(),[]);
});
test('conversation snapshots are independent and bounded',()=>{
  const session=createAgentSession();
  for(let i=0;i<30;i++)session.append({role:i%2?'assistant':'user',content:String(i)});
  const snapshot=session.snapshot();assert.equal(snapshot.length,24);assert.equal(snapshot[0].content,'6');
  snapshot[0].content='mutated';assert.equal(session.snapshot()[0].content,'6');
});
