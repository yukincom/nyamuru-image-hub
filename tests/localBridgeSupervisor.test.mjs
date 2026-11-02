// 見込み: 生成完了と画面・サーバー終了を分ければ、後片付け後の不要な復帰を防げる。
// 合格: 通常終了はshutdown、完了はresume。範囲: controllerと一時HTTP、LLMは模擬。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { submitImageGenerationRequest } from '../src/lib/localBridgeLifecycle.ts';
import {
  BridgeLeaseController,
  PanelActionLeaseController,
  checkBridgeState,
  isAllowedLifecycleOrigin,
  selectLocalBridgeTarget,
  startLocalBridgeSupervisor,
} from '../scripts/local-bridge-supervisor.mjs';
import { LocalComfyController } from '../scripts/local-comfy-supervisor.mjs';

// 見込み: UIと同じHTTP受付から所有runtimeを管理すれば、接続とcloseの境界を確認できる。
// 合格: 同一tokenでstart→stopが1回ずつ、未知tokenは他の利用を終了しない。範囲: localhost実HTTP、ComfyUIプロセスは模擬。
test('generation dialog HTTP starts and stops only its leased ComfyUI',async t=>{
 let state='missing',launches=0,stops=0;const child={running:true};
 const comfy=new LocalComfyController({check:async()=>state,launcher:async()=>({}),launch:()=>{launches++;state='ready';return child;},
  isRunning:item=>item.running,idle:async()=>true,stop:async item=>{stops++;item.running=false;}});
 const supervisor=await startLocalBridgeSupervisor({repoRoot:process.cwd(),port:0,comfyController:comfy});
 t.after(()=>supervisor.close());
 const post=async(path,body)=>fetch(supervisor.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const started=await(await post('/api/image-generation/start',{session_token:token,comfyui_url:'http://127.0.0.1:8188'})).json();
 assert.equal(started.comfy_ready,true);assert.equal(started.comfy_started,true);assert.equal(started.comfy_managed,true);
 await post('/api/image-generation/stop',{session_token:'unrelated'});assert.equal(stops,0);
 const ended=await(await post('/api/image-generation/stop',{session_token:token})).json();
 assert.equal(ended.comfy_stopped,true);assert.equal(ended.comfy_released,true);assert.equal(launches,1);assert.equal(stops,1);
});

// 見込み: runtimeと操作leaseを結べば、画面closeが送信待ちにもguardianの終了を届ける。
// 合格: stop直後に対象signalだけabort、送信後shutdown1回、別lease/借用ComfyUIは保持。範囲: 実HTTP、LLMとbridge応答は模擬。
test('dialog close cancels its in-flight image session and rejects late runtime reuse',async t=>{
 const signals=[],events=[];let finishSubmit,enteredSubmit;
 const gate=new Promise(done=>{finishSubmit=done;}),entered=new Promise(done=>{enteredSubmit=done;});
 const bridge=createServer(async(request,response)=>{
   response.setHeader('Content-Type','application/json');
   if(request.url==='/api/health')return response.end(JSON.stringify({service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3,image_generation_lifecycle_version:2,panel_action_llm_mode:'auto',panel_action_llm_url:'http://127.0.0.1:8080/v1/chat/completions'}));
   for await(const _ of request){} enteredSubmit();await gate;response.end(JSON.stringify({ok:true}));
 });
 await new Promise(done=>bridge.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>bridge.close(done)));
 const comfy=new LocalComfyController({check:async()=> 'ready',stop:async()=>assert.fail('borrowed server')});
 const supervisor=await startLocalBridgeSupervisor({repoRoot:process.cwd(),port:0,comfyController:comfy,
  bridgeUrl:`http://127.0.0.1:${bridge.address().port}`,llmController:{ownershipMode:'auto',
   suspendForImages:async(_token,{signal})=>{signals.push(signal);return {resume:async()=>assert.fail('closed session'),shutdown:async()=>{events.push('shutdown');return false;}};},
   unload:async()=>false,close:async()=>{},
  }});t.after(()=>supervisor.close());
 const post=(path,body={})=>fetch(supervisor.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const runtime='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 await post('/api/image-generation/start',{session_token:runtime,comfyui_url:'http://127.0.0.1:8188'});
 const other=await(await post('/api/new-creation/start')).json();
 const {lease_token}=await(await post('/api/new-creation/start',{session_token:runtime})).json();
 await post('/api/image-generation/prepare',{lease_token,requires_llm:false});
 const submitting=post('/api/image-generation/submit',{lease_token,payload:{job_id:'fixture'}});await entered;
 const closing=post('/api/image-generation/stop',{session_token:runtime});
 for(let i=0;i<100&&!signals[0].aborted;i++)await new Promise(done=>setTimeout(done,5));
 assert.equal(signals[0].aborted,true);finishSubmit();await submitting;
 assert.equal((await closing).status,200);assert.deepEqual(events,['shutdown']);
 assert.equal((await post('/api/new-creation/start',{session_token:runtime})).status,503);
 const result=await(await post('/api/new-creation/stop',{lease_token:other.lease_token})).json();assert.equal(result.released,true);
});

function fakeChild() {
  return { running: true };
}

// 見込み: 翻訳不要でもbridge leaseで画像用の排他と復帰を確保する。合格: ensureゼロで送信/復帰、他の文章lease中は拒否。範囲: 実controller＋模擬LLM、実プロセスなし。
test('描き文字は文章LLMを起動せず画像用の排他と復帰を確保する',async()=>{
 const events=[],controller=new PanelActionLeaseController({bridgeLeases:new Set(['image','text']),llmController:{
  ensure:async()=>{events.push('ensure');return {modelAlias:'same'};},
  suspendForImages:async()=>{events.push('suspend');return {resume:async()=>{events.push('resume');return true;}};},unload:async()=>false,close:async()=>{},
 }});
 await controller.suspendForImages('image',{requiresLlm:false});
 await controller.submitImage('image',async()=>events.push('submit'));
 await assert.rejects(()=>controller.prepare('text'),/画像生成/);
 await controller.release('image');assert.deepEqual(events,['suspend','submit','resume']);
 await controller.prepare('text');
 await assert.rejects(()=>controller.suspendForImages('image',{requiresLlm:false}),/別の文章処理/);
 await assert.rejects(()=>controller.suspendForImages('unknown',{requiresLlm:false}),/先に/);
 await controller.release('text');await controller.close();
});

test('画像生成中は文章処理を拒否し、送信完了後にだけ復帰する', async () => {
  const events = [];
  let complete;
  const submission = new Promise(resolve => { complete = resolve; });
  const controller = new PanelActionLeaseController({ bridgeLeases: new Set(['images', 'text']), llmController: {
    ensure: async () => ({ managed: false, modelAlias: 'same' }),
    suspendForImages: async () => ({ resume: async () => { events.push('resume'); return true; } }),
    unload: async () => false, close: async () => {},
  } });
  await controller.prepare('images', 'same');
  await controller.suspendForImages('images');
  await assert.rejects(() => controller.prepare('text', 'same'), /画像生成/);
  const sending = controller.submitImage('images', async () => { events.push('submit'); await submission; events.push('accepted'); });
  await new Promise(resolve => setImmediate(resolve));
  const releasing = controller.release('images');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['submit']);
  complete(); await sending;
  assert.deepEqual(await releasing, { released: true, stopped: true, restored: true });
  assert.deepEqual(events, ['submit', 'accepted', 'resume']);
  await assert.rejects(() => controller.submitImage('images', async () => {}), /一時停止情報/);
  await controller.prepare('text', 'same');
  await controller.close();
});

test('別の文章処理のleaseが残る間はLLMを停止しない', async () => {
  let suspends = 0;
  const controller = new PanelActionLeaseController({ bridgeLeases: new Set(['a', 'b']), llmController: {
    ensure: async () => ({ modelAlias: 'same' }), suspendForImages: async () => { suspends++; },
    unload: async () => false, close: async () => {},
  } });
  await controller.prepare('a', 'same'); await controller.prepare('b', 'same');
  await assert.rejects(() => controller.suspendForImages('a'), /別の文章処理/);
  assert.equal(suspends, 0);
  await controller.close();
});

// 見込み: 通常終了を復帰と分ければ、LANサーバー停止後にLLMを起動しない。
// 合格: shutdown→closeのみでresume0回、後片付け失敗は通知する。範囲: 実controller、LLMと終了処理は模擬。
test('supervisor終了は復帰せず後片付けし、失敗を隠さない', async () => {
  const events = [];
  const controller = new PanelActionLeaseController({ bridgeLeases: new Set(['a']), llmController: {
    ensure: async () => ({ modelAlias: 'same' }),
    suspendForImages: async () => ({ resume: async () => assert.fail('must not resume'),
      shutdown: async () => { events.push('shutdown'); throw new Error('cleanup failed'); } }),
    close: async () => { events.push('close'); },
  } });
  await controller.prepare('a', 'same'); await controller.suspendForImages('a');
  await assert.rejects(() => controller.close(), /cleanup failed/);
  assert.deepEqual(events, ['shutdown', 'close']);
});

// 見込み: 準備待ちにも終了を届ければ、遅く停止したLLMを再起動しない。
// 合格: close直後にabort、準備後はshutdown→closeでresume0回。範囲: 実controller、停止待ちは模擬。
test('supervisor終了は一時停止の準備待ちにも即座に伝わる', async () => {
  const events = []; let finish, signal;
  const gate = new Promise(resolve => { finish = resolve; });
  const controller = new PanelActionLeaseController({ bridgeLeases: new Set(['a']), llmController: {
    suspendForImages: async (_token, options) => { signal = options.signal; await gate; return {
      resume: async () => assert.fail('must not resume'), shutdown: async () => { events.push('shutdown'); return false; },
    }; }, close: async () => events.push('close'),
  } });
  const preparing = controller.suspendForImages('a', { requiresLlm: false });
  await new Promise(resolve => setImmediate(resolve));
  const closing = controller.close();
  assert.equal(signal.aborted, true);
  finish(); await preparing; await closing;
  assert.deepEqual(events, ['shutdown', 'close']);
});

// 見込み: 復帰待ちで直列処理が塞がっても、画面終了とサーバー終了を優先できる。
// 合格: 両終了で即abort、復帰結果false、処理は解放。範囲: 実controller、guardianの待機と復帰は模擬。
test('画面とサーバーの終了は既に待機中の復帰要求にも優先する', async () => {
  for (const kind of ['page', 'server']) {
    let signal, finish;
    const gate = new Promise(resolve => { finish = resolve; });
    const controller = new PanelActionLeaseController({ bridgeLeases: new Set(['a']), llmController: {
      suspendForImages: async (_token, options) => { signal = options.signal; return {
        resume: async () => { await gate; return !signal.aborted; },
        shutdown: async () => { await gate; return false; },
      }; }, close: async () => {},
    } });
    await controller.suspendForImages('a', { requiresLlm: false });
    const completing = controller.release('a');
    await new Promise(resolve => setImmediate(resolve));
    const closing = kind === 'page' ? controller.release('a', { shutdown: true }) : controller.close();
    assert.equal(signal.aborted, true);
    finish();
    assert.equal((await completing).restored, false);
    await closing;
    assert.equal(controller.imageRecovery, null);
  }
});

// 見込み: LANからも同じ終了APIへ理由を渡せば、生成完了と画面終了を区別できる。
// 合格: 通常完了は復帰、shutdown指定は復帰なしで後片付け1回。範囲: localhost実HTTP、bridgeとLLMは模擬。
test('画像生成HTTPは準備済みleaseだけを転送し、終了理由を保持する', async t => {
  const received = [];
  const bridge = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/health') {
      response.end(JSON.stringify({ service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3, image_generation_lifecycle_version: 2,
        panel_action_llm_mode: 'auto', panel_action_llm_url: 'http://127.0.0.1:8080/v1/chat/completions' }));
      return;
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    received.push([request.url, JSON.parse(Buffer.concat(chunks))]);
    // The real bridge adds its identity to every JSON response.
    response.end(JSON.stringify({ ok: true, service: 'nyamuru-image-hub-local-bridge',
      layout_protocol_version: 3, status: 'queued', job_id: 'test-job' }));
  });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => bridge.close(resolve)));
  let resumes = 0, ensures = 0, shutdowns = 0;
  const supervisor = await startLocalBridgeSupervisor({ repoRoot: process.cwd(), port: 0,
    bridgeUrl: `http://127.0.0.1:${bridge.address().port}`, llmController: {
      ownershipMode: 'auto', modelIdentity: () => 'default_model',
      ensure: async () => { ensures++; return { modelAlias: 'default_model', ownershipMode: 'external-shared' }; },
      suspendForImages: async () => ({ resume: async () => { resumes++; return true; },
        shutdown: async () => { shutdowns++; return false; } }),
      unload: async () => false, close: async () => {},
    } });
  t.after(() => supervisor.close());
  const post = async (path, body = {}) => fetch(`${supervisor.url}${path}`, {
    method: 'POST', headers: { Origin: 'http://localhost:4321', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await post('/api/image-generation/prepare', { lease_token: 'missing' })).status, 503);
  const start = await (await post('/api/new-creation/start')).json();
  const lease_token = start.lease_token;
  await post('/api/panel-actions/prepare', { lease_token, llm_model_alias: 'saved-model' });
  assert.equal((await post('/api/image-generation/submit', { lease_token, payload: {} })).status, 503);
  assert.equal((await (await post('/api/image-generation/prepare', { lease_token })).json()).llm_stopped, true);
  const input = { job_id: 'test-job', prompt: 'English' };
  const accepted = await submitImageGenerationRequest(lease_token, input, (url, options) =>
    fetch(`${supervisor.url}${new URL(String(url)).pathname}`, options));
  assert.equal(accepted.service, 'nyamuru-image-hub-bridge-supervisor');
  assert.equal(accepted.protocol_version, 1);
  assert.equal(accepted.status, 'queued');
  assert.equal(accepted.job_id, 'test-job');
  assert.deepEqual(received, [['/api/qwen-generation/submit', { ...input, image_session_token: lease_token }]]);
  const end = await (await post('/api/new-creation/stop', { lease_token })).json();
  assert.equal(end.llm_restored, true); assert.equal(resumes, 1);
  // 見込み/合格: 同じHTTP受付で翻訳なしの生成も通り、LLM ensureを増やさず排他/復帰する。範囲: 実supervisor HTTP＋模擬bridge/LLM。
  const direct = await (await post('/api/new-creation/start')).json();
  assert.equal((await post('/api/image-generation/prepare', {lease_token:direct.lease_token,requires_llm:false})).status, 200);
  const submitted = await (await post('/api/image-generation/submit', {lease_token:direct.lease_token,payload:input})).json();
  assert.equal(submitted.status, 'queued');assert.equal(ensures, 1);
  const released = await (await post('/api/new-creation/stop', {lease_token:direct.lease_token})).json();
  assert.equal(released.llm_restored, true);assert.equal(resumes, 2);

  const exiting = await (await post('/api/new-creation/start')).json();
  await post('/api/image-generation/prepare', { lease_token: exiting.lease_token, requires_llm: false });
  const stopped = await (await post('/api/new-creation/stop', { lease_token: exiting.lease_token, shutdown: true })).json();
  assert.equal(stopped.llm_restored, false);
  assert.equal(shutdowns, 1); assert.equal(resumes, 2);

  const serverExit = await (await post('/api/new-creation/start')).json();
  await post('/api/image-generation/prepare', { lease_token: serverExit.lease_token, requires_llm: false });
  await supervisor.close();
  assert.equal(shutdowns, 2); assert.equal(resumes, 2);
  await assert.rejects(fetch(`${supervisor.url}/api/health`));

});

test('localhostと127.0.0.1の画面だけが起動管理を操作できる', () => {
  assert.equal(isAllowedLifecycleOrigin('http://127.0.0.1:4321'), true);
  assert.equal(isAllowedLifecycleOrigin('http://localhost:4321'), true);
  assert.equal(isAllowedLifecycleOrigin(undefined), true);
  assert.equal(isAllowedLifecycleOrigin('https://example.com'), false);
  assert.equal(isAllowedLifecycleOrigin('null'), false);
});

test('最初の新規作成でbridgeを起動し、最後の終了時だけ停止する', async () => {
  let state = 'missing';
  let launches = 0;
  let stops = 0;
  const controller = new BridgeLeaseController({
    checkBridge: async () => state,
    launchBridge: () => { launches += 1; return fakeChild(); },
    waitForBridge: async () => { state = 'ready'; },
    stopBridge: async (child) => { child.running = false; state = 'missing'; stops += 1; },
    bridgeIsRunning: (child) => child.running,
    createToken: () => `lease-${launches}-${Math.random()}`,
  });

  const first = await controller.acquire();
  const second = await controller.acquire();
  assert.equal(launches, 1);
  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.deepEqual(await controller.release(first.token), { released: true, stopped: false });
  assert.equal(stops, 0);
  assert.deepEqual(await controller.release(second.token), { released: true, stopped: true });
  assert.equal(stops, 1);
});

test('手動で起動済みのbridgeは新規作成終了時に停止しない', async () => {
  let stops = 0;
  const controller = new BridgeLeaseController({
    checkBridge: async () => 'ready',
    launchBridge: () => { throw new Error('起動してはいけません'); },
    waitForBridge: async () => undefined,
    stopBridge: async () => { stops += 1; },
    bridgeIsRunning: () => false,
    createToken: () => 'external-lease',
  });

  const lease = await controller.acquire();
  assert.equal(lease.managed, false);
  assert.deepEqual(await controller.release(lease.token), { released: true, stopped: false });
  assert.equal(stops, 0);
});

test('別サービスが8787を使っている場合は起動しない', async () => {
  const controller = new BridgeLeaseController({
    checkBridge: async () => 'foreign',
    launchBridge: () => { throw new Error('起動してはいけません'); },
    waitForBridge: async () => undefined,
    stopBridge: async () => undefined,
    bridgeIsRunning: () => false,
  });
  await assert.rejects(() => controller.acquire(), /別のローカルサービス/);
});

test('既存のNyamuru bridgeがあれば同じポートを再利用する', async () => {
  let availabilityChecks = 0;
  const selected = await selectLocalBridgeTarget({
    preferredPort: 8787,
    checkState: async () => 'ready',
    canListen: async () => { availabilityChecks += 1; return false; },
  });
  assert.deepEqual(selected, {
    host: '127.0.0.1',
    port: 8787,
    url: 'http://127.0.0.1:8787',
    reused: true,
  });
  assert.equal(availabilityChecks, 0);
});

test('既定ポートを別アプリが使っていれば次の空きポートへ切り替える', async () => {
  const checkedPorts = [];
  const selected = await selectLocalBridgeTarget({
    preferredPort: 8787,
    checkState: async () => 'foreign',
    canListen: async (_host, port) => {
      checkedPorts.push(port);
      return port === 8789;
    },
  });
  assert.deepEqual(checkedPorts, [8787, 8788, 8789]);
  assert.deepEqual(selected, {
    host: '127.0.0.1',
    port: 8789,
    url: 'http://127.0.0.1:8789',
    reused: false,
  });
});

test('明示ポートが使用中なら勝手に別ポートへ移らない', async () => {
  await assert.rejects(() => selectLocalBridgeTarget({
    preferredPort: 9000,
    maxFallbacks: 0,
    checkState: async () => 'foreign',
    canListen: async () => false,
  }), /空きポートが見つかりません/);
});

test('既存bridgeは文章LLMの所有モードまで一致する場合だけ再利用する', async () => {
  const response = (mode, lifecycle = 2) => async () => Response.json({
    service: 'nyamuru-image-hub-local-bridge',
    layout_protocol_version: 3, image_generation_lifecycle_version: lifecycle,
    panel_action_llm_mode: mode,
    panel_action_llm_url: 'http://127.0.0.1:8080/v1/chat/completions',
  });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = response('managed', 0);
    assert.equal(await checkBridgeState('http://127.0.0.1:8787', 700, 'managed'), 'foreign');
    globalThis.fetch = response('managed');
    assert.equal(await checkBridgeState('http://127.0.0.1:8787', 700, 'managed'), 'ready');
    assert.equal(await checkBridgeState('http://127.0.0.1:8787', 700, 'external-shared'), 'foreign');
    assert.equal(await checkBridgeState(
      'http://127.0.0.1:8787', 700, 'managed', 'http://127.0.0.1:8090/v1/chat/completions',
    ), 'foreign');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bridge停止中に再注入が始まっても、停止中のchildを外部serverとして貸さない', async () => {
  let state = 'missing';
  let launches = 0;
  let finishStop;
  let stopping;
  const stopped = new Promise((done) => { finishStop = done; });
  const stopStarted = new Promise((done) => { stopping = done; });
  const controller = new BridgeLeaseController({
    checkBridge: async () => state,
    launchBridge: () => { launches += 1; return fakeChild(); },
    waitForBridge: async () => { state = 'ready'; },
    stopBridge: async (child) => { stopping(); await stopped; child.running = false; state = 'missing'; },
    bridgeIsRunning: (child) => child.running,
  });
  const [first, shared] = await Promise.all([controller.acquire(), controller.acquire()]);
  assert.equal(launches, 1);
  await controller.release(first.token);
  const release = controller.release(shared.token);
  await stopStarted;
  let acquired = false;
  const next = controller.acquire().then((value) => { acquired = true; return value; });
  await new Promise((done) => setImmediate(done));
  assert.equal(acquired, false);
  finishStop();
  await release;
  const resumed = await next;
  assert.equal(resumed.managed, true);
  assert.equal(resumed.started, true);
  assert.equal(launches, 2);
  await controller.close();
});

test('同じLLMを共有中は保持し、最後の明示タスク終了時だけapp所有モデルを解放する', async () => {
  const bridgeLeases = new Set(['a', 'b']);
  const events = [];
  const controller = new PanelActionLeaseController({ bridgeLeases, llmController: {
    ensure: async alias => { events.push(`ensure:${alias}`); return { started: true, managed: true, modelAlias: alias }; },
    unload: async () => { events.push('unload'); return true; },
    close: async () => { events.push('close'); },
  } });
  await controller.prepare('a', 'same-model');
  await controller.prepare('b', 'same-model');
  assert.deepEqual(await controller.release('a'), { released: true, stopped: false });
  assert.deepEqual(await controller.release('b'), { released: true, stopped: true });
  assert.deepEqual(events, ['ensure:same-model', 'ensure:same-model', 'unload']);
  await controller.close();
});

test('別LLMモデルの同時利用は起動前に拒否する', async () => {
  const bridgeLeases = new Set(['a', 'b']);
  let ensures = 0;
  const controller = new PanelActionLeaseController({ bridgeLeases, llmController: {
    ensure: async alias => { ensures += 1; return { started: true, managed: true, modelAlias: alias }; },
    unload: async () => true,
    close: async () => {},
  } });
  await controller.prepare('a', 'model-a');
  await assert.rejects(() => controller.prepare('b', 'model-b'), /別のLLM/);
  assert.equal(ensures, 1);
});

test('共有LLMでは異なる画面aliasも同じdefault_model leaseとして扱い停止しない', async () => {
  const bridgeLeases = new Set(['a', 'b']);
  const events = [];
  const controller = new PanelActionLeaseController({ bridgeLeases, llmController: {
    modelIdentity: () => 'default_model',
    ensure: async alias => {
      events.push(`ensure:${alias}`);
      return { started: false, managed: false, modelAlias: 'default_model', ownershipMode: 'external-shared' };
    },
    unload: async () => { events.push('unload'); return false; },
    close: async () => { events.push('close'); },
  } });
  await controller.prepare('a', 'model-a');
  await controller.prepare('b', 'model-b');
  assert.deepEqual(await controller.release('a'), { released: true, stopped: false });
  assert.deepEqual(await controller.release('b'), { released: true, stopped: false });
  assert.deepEqual(events, ['ensure:model-a', 'ensure:model-b', 'unload']);
});

test('再注入HTTP経路は利用権付きの操作だけLLMを準備し、コマ情報やcommandを起動設定に使わない', async (t) => {
  const bridge = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3, image_generation_lifecycle_version: 2,
      panel_action_llm_mode: 'managed', panel_action_llm_url: 'http://127.0.0.1:8080/v1/chat/completions',
    }));
  });
  await new Promise((done) => bridge.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => bridge.close(done)));
  let prepares = 0;
  let unloads = 0;
  let closes = 0;
  const supervisor = await startLocalBridgeSupervisor({
    repoRoot: process.cwd(), port: 0,
    bridgeUrl: `http://127.0.0.1:${bridge.address().port}`,
    llmController: {
      ownershipMode: 'managed',
      ensure: async (...args) => { assert.deepEqual(args, ['Qwen3.6-35B-A3B-4bit-DWQ']); prepares += 1; return { started: false, managed: false, modelAlias: args[0] }; },
      unload: async () => { unloads += 1; return true; },
      close: async () => { closes += 1; },
    },
  });
  t.after(() => supervisor.close());
  const post = (path, body = {}, origin = 'http://127.0.0.1:4321') => fetch(`${supervisor.url}${path}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await post('/api/panel-actions/prepare')).status, 400);
  assert.equal((await post('/api/panel-actions/prepare', {}, 'https://example.com')).status, 403);
  assert.equal(prepares, 0);
  const start = await (await post('/api/new-creation/start')).json();
  assert.equal(start.bridge_managed, false);
  assert.equal((await post('/api/panel-actions/prepare', { lease_token: start.lease_token })).status, 400);
  const prepared = await (await post('/api/panel-actions/prepare', {
    lease_token: start.lease_token, command: 'ignored', llm_model_alias: 'Qwen3.6-35B-A3B-4bit-DWQ',
  })).json();
  assert.equal(prepared.llm_managed, false);
  assert.equal(prepared.llm_model_alias, 'Qwen3.6-35B-A3B-4bit-DWQ');
  assert.equal(prepared.llm_mode, 'managed');
  assert.equal(prepares, 1);
  const stop = await (await post('/api/new-creation/stop', { lease_token: start.lease_token })).json();
  assert.deepEqual({ released: stop.released, stopped: stop.stopped }, { released: true, stopped: false });
  assert.deepEqual({ llm_released: stop.llm_released, llm_stopped: stop.llm_stopped }, { llm_released: true, llm_stopped: true });
  assert.equal(unloads, 1);
  assert.equal((await post('/api/panel-actions/prepare', { lease_token: start.lease_token })).status, 400);
  await supervisor.close();
  assert.equal(closes, 1);
  assert.equal(bridge.listening, true);
});

test('LLM解放が失敗してもbridge leaseは必ず解放する', async (t) => {
  const bridge = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3, image_generation_lifecycle_version: 2,
      panel_action_llm_mode: 'managed', panel_action_llm_url: 'http://127.0.0.1:8080/v1/chat/completions',
    }));
  });
  await new Promise((done) => bridge.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => bridge.close(done)));
  const supervisor = await startLocalBridgeSupervisor({
    repoRoot: process.cwd(), port: 0,
    bridgeUrl: `http://127.0.0.1:${bridge.address().port}`,
    llmController: {
      ownershipMode: 'managed',
      ensure: async alias => ({ started: false, managed: false, modelAlias: alias }),
      unload: async () => { throw new Error('LLM stop failed'); },
      close: async () => {},
    },
  });
  t.after(() => supervisor.close());
  const post = (path, body = {}) => fetch(`${supervisor.url}${path}`, {
    method: 'POST', headers: { Origin: 'http://127.0.0.1:4321', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const start = await (await post('/api/new-creation/start')).json();
  await post('/api/panel-actions/prepare', { lease_token: start.lease_token, llm_model_alias: 'model-a' });
  assert.equal((await post('/api/new-creation/stop', { lease_token: start.lease_token })).status, 503);
  assert.equal((await post('/api/panel-actions/prepare', { lease_token: start.lease_token, llm_model_alias: 'model-a' })).status, 400);
});
