import assert from 'node:assert/strict';
import test from 'node:test';
import {AGENT_PREFERENCES_KEY,DEFAULT_AGENT_PREFERENCES,loadAgentPreferences,saveAgentPreferences,readAgentAvatar,VOICE_SILENCE_OPTIONS} from '../src/lib/agentPreferences.ts';

test('profile persists independently of manuscripts and conversation history',()=>{
  const entries=new Map(),storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value)};
  assert.deepEqual(loadAgentPreferences(storage),DEFAULT_AGENT_PREFERENCES);
  const profile={name:'ねこ先生',avatar:'',tone:'落ち着いた口調で、短く話す。'};
  saveAgentPreferences(storage,profile);
  assert.deepEqual(loadAgentPreferences(storage),{...profile,voiceInputMode:'quick',voiceSilenceMs:1000});
  assert.deepEqual([...entries.keys()],[AGENT_PREFERENCES_KEY]);
  entries.set(AGENT_PREFERENCES_KEY,'broken');
  assert.deepEqual(loadAgentPreferences(storage),DEFAULT_AGENT_PREFERENCES);
});

test('old profiles gain quick input with one-second silence without losing identity',()=>{
  const legacy={name:'ねこ先生',avatar:'',tone:'短く話す'};
  const storage={getItem:()=>JSON.stringify(legacy)};
  assert.deepEqual(loadAgentPreferences(storage),{...legacy,voiceInputMode:'quick',voiceSilenceMs:1000});
  for(const value of [null,-1,0,Infinity,'1000',999]){
    assert.deepEqual(loadAgentPreferences({getItem:()=>JSON.stringify({...legacy,voiceInputMode:'unknown',voiceSilenceMs:value})}),{...legacy,voiceInputMode:'quick',voiceSilenceMs:1000});
  }
});

test('manual and quick input preserve the selected pause across reload and mode switches',()=>{
  let stored;const storage={getItem:()=>stored,setItem:(_key,value)=>{stored=value}};
  for(const ms of VOICE_SILENCE_OPTIONS){
    const manual=saveAgentPreferences(storage,{...DEFAULT_AGENT_PREFERENCES,voiceInputMode:'manual',voiceSilenceMs:ms});
    assert.equal(loadAgentPreferences(storage).voiceInputMode,'manual');assert.equal(loadAgentPreferences(storage).voiceSilenceMs,ms);
    saveAgentPreferences(storage,{...manual,voiceInputMode:'quick'});
    assert.equal(loadAgentPreferences(storage).voiceInputMode,'quick');assert.equal(loadAgentPreferences(storage).voiceSilenceMs,ms);
  }
});
test('avatar keeps original GIF bytes and rejects remote URLs and unsupported content',async()=>{
  const bytes=Uint8Array.from([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,0,1,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]);
  const avatar=await readAgentAvatar(new Blob([bytes],{type:'image/gif'}));
  assert.equal(avatar,'data:image/gif;base64,'+Buffer.from(bytes).toString('base64'));
  assert.throws(()=>saveAgentPreferences({setItem(){}},{...DEFAULT_AGENT_PREFERENCES,avatar:'https://example.invalid/face.gif'}),/顔画像/);
  await assert.rejects(readAgentAvatar(new Blob(['<svg/>'],{type:'image/svg+xml'})),/PNG/);
  await assert.rejects(readAgentAvatar(new Blob([new Uint8Array(2*1024*1024+1)])),/2 MB/);
});
