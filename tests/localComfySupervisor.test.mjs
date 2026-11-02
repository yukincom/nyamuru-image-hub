// 見込み: 生成画面が借りたプロセスを区別すれば、必要時だけ起動し閉じるまで保持できる。
// 合格: 最後の画面closeで所有プロセスだけ終了、外部サーバーや実行中ジョブは保持。範囲: 実controller、通信・プロセスは模擬。
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalComfyController, comfyTarget, checkComfyState, existingComfyLauncher } from '../scripts/local-comfy-supervisor.mjs';

const endpoint = 'http://127.0.0.1:8188';
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function fixture(options={}) {
  const child={running:true},events=[];let state='missing';
  const controller=new LocalComfyController({check:async()=>state,launcher:async()=>({root:'existing'}),
    launch:config=>{events.push(['launch',config]);state='ready';return child;},isRunning:item=>item.running,
    stop:async item=>{events.push(['stop',item]);item.running=false;},idle:async()=>true,...options});
  return {controller,child,events,setState:value=>{state=value;}};
}

// 見込み: 同じruntimeへ画面ごとの利用を登録すれば、生成完了や一方のcloseだけで停止しない。
// 合格: 起動1回、最後のreleaseだけstop1回。範囲: 実controllerと模擬プロセス、実推論なし。
test('two dialogs share one owned runtime and only the last close stops it',async()=>{
  const f=fixture();
  assert.deepEqual(await f.controller.acquire(a,endpoint),{started:true,managed:true});
  assert.deepEqual(await f.controller.acquire(a,endpoint),{started:false,managed:true});
  await f.controller.acquire(b,endpoint);
  assert.deepEqual(await f.controller.release(a),{released:true,stopped:false,managed:true});
  assert.equal(f.events.length,1);
  assert.deepEqual(await f.controller.release(b),{released:true,stopped:true,managed:false});
  assert.equal(f.events[1][1],f.child);
  await f.controller.release(b);await f.controller.close();assert.equal(f.events.length,2);
});

// 見込み: 起動済みのComfyUIを借りるだけなら、画面closeやサーバー終了で停止しない。
// 合格: acquire/release/closeを通してlaunch/stop0回。範囲: API状態は固定、実Desktopは対象外。
test('an already running ComfyUI remains externally owned',async()=>{
  const f=fixture();f.setState('ready');
  assert.deepEqual(await f.controller.acquire(a,endpoint),{started:false,managed:false});
  await f.controller.release(a);await f.controller.close();assert.deepEqual(f.events,[]);
});

// 見込み: 起動待ちにもcloseを並べれば、遅く起動した子を取り残さない。
// 合格: 開始を拒否しその子だけstop、lease0。範囲: 待機は制御したPromise、実プロセスなし。
test('close arriving during startup releases the late owned process',async()=>{
  let finish;const gate=new Promise(done=>{finish=done;});let checks=0;
  const f=fixture({check:async()=>++checks===1?'missing':(await gate,'ready')});
  const starting=f.controller.acquire(a,endpoint);await new Promise(done=>setImmediate(done));
  const closing=f.controller.release(a);finish();await assert.rejects(starting,/生成画面を終了/);await closing;
  assert.equal(f.controller.leases.size,0);assert.equal(f.events[1][0],'stop');await f.controller.close();
});

// 見込み: 接続拒否だけを起動条件にすれば、応答しない既存サービスを重複起動・置換しない。
// 合格: foreign/unavailableはlaunch0、起動失敗は自分の子を1回回収。範囲: 状態と子の生存は模擬。
test('foreign services are preserved and failed startup cleans up its exact child',async()=>{
  for(const state of ['foreign','unavailable']){
    const f=fixture();f.setState(state);await assert.rejects(()=>f.controller.acquire(a,endpoint),/別のサービス/);assert.deepEqual(f.events,[]);await f.controller.close();
  }
  const f=fixture({check:async()=> 'missing',isRunning:()=>false});
  await assert.rejects(()=>f.controller.acquire(a,endpoint),/起動できません/);
  assert.equal(f.events[1][0],'stop');assert.equal(f.controller.child,null);await f.controller.close();
});

// 見込み: 自身の生成処理や他のキュー処理が終わるまで待てば、closeで途中の出力を失わない。
// 合格: busy/非idleではstop0、両方が解放された後だけstop1。範囲: 排他とキュー観測は模擬。
test('closing defers shutdown until submission and the queue are idle',async()=>{
  let busy=true,idle=false;const f=fixture({busy:()=>busy,idle:async()=>idle});
  await f.controller.acquire(a,endpoint);await f.controller.release(a);assert.equal(f.events.length,1);
  busy=false;await f.controller.release(a);assert.equal(f.events.length,1);
  idle=true;await f.controller.release(a);assert.equal(f.events.length,2);await f.controller.close();
});

// 見込み: client IDとprompt IDを限定すれば他の生成工程を混ぜずに表示できる。
// 合格: 対象executingだけnodeを更新し、割合や別promptを無視。releaseでsocketを閉じる。範囲: 実observer、WSは模擬。
test('progress observes only its client and prompt, and closes its socket with the dialog',async()=>{
  const sockets=[];
  class Socket extends EventTarget {
    readyState=1;
    close(){this.readyState=3;}
    send(type,data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type,data})}));}
  }
  const f=fixture({socket:url=>{const socket=new Socket();sockets.push({url,socket});return socket;}});
  await f.controller.acquire(a,endpoint);
  assert.deepEqual(f.controller.progress(a,{client_id:b,prompt_id:'own'}),{node:null,connected:true});
  assert.equal(new URL(sockets[0].url).searchParams.get('clientId'),b);
  const {socket}=sockets[0];
  socket.send('executing',{node:'wrong',prompt_id:'other'});
  socket.send('progress',{value:1,max:100,prompt_id:'own'});
  assert.equal(f.controller.progress(a,{client_id:b,prompt_id:'own'}).node,null);
  socket.send('executing',{node:'sampler',prompt_id:'own'});
  assert.equal(f.controller.progress(a,{client_id:b,prompt_id:'own'}).node,'sampler');
  await f.controller.release(a);assert.equal(socket.readyState,3);
  assert.throws(()=>f.controller.progress(a,{client_id:b}),/照合情報/);
  await f.controller.close();
});

// 見込み: Desktopの登録済み環境と共有設定を読めば、新たな環境やモデルを作らず同じmainを使える。
// 合格: .venv/main・共有paths・入力出力・指定port、shell化なし。範囲: 一時レジストリーと空の実ファイル、起動は別確認。
test('the launcher reuses the Desktop installation and its model/input/output paths',async t=>{
  const root=await mkdtemp(join(tmpdir(),'nyamuru-comfy-launch-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const config=join(root,'config'),install=join(root,'install'),comfy=join(install,'ComfyUI');
  await mkdir(join(config,'instance-model-paths'),{recursive:true});await mkdir(join(comfy,'.venv/bin'),{recursive:true});
  await writeFile(join(comfy,'main.py'),'');await writeFile(join(comfy,'.venv/bin/python3'),'');
  await writeFile(join(config,'installations.json'),JSON.stringify([{id:'local',sourceId:'standalone',status:'installed',installPath:install,launchArgs:'--enable-manager --port 9000 --listen 0.0.0.0'}]));
  await writeFile(join(config,'settings.json'),JSON.stringify({inputDir:join(root,'input'),outputDir:join(root,'output')}));
  await writeFile(join(config,'instance-model-paths/local.yaml'),'shared models');
  const value=await existingComfyLauncher(endpoint,{env:{NYAMURU_COMFY_DESKTOP_CONFIG:config}});
  assert.equal(value.root,comfy);assert.equal(value.python,join(comfy,'.venv/bin/python3'));
  assert.deepEqual(value.args,['-s',join(comfy,'main.py'),'--enable-manager','--extra-model-paths-config',join(config,'instance-model-paths/local.yaml'),'--input-directory',join(root,'input'),'--output-directory',join(root,'output'),'--listen','127.0.0.1','--port','8188','--disable-auto-launch']);
});

// 見込み: APIの識別と接続拒否を区別すれば、別のHTTPを起動完了と誤認しない。
// 合格: 正規statsだけready、拒否missing、timeout/別JSONは不採用。範囲: 実parser、HTTPは固定応答。
test('readiness is a ComfyUI response and only refused connections allow startup',async()=>{
  assert.equal(await checkComfyState(endpoint,async()=>Response.json({system:{comfyui_version:'fixture'},devices:[]})),'ready');
  assert.equal(await checkComfyState(endpoint,async()=>Response.json({status:'ok'})),'foreign');
  assert.equal(await checkComfyState(endpoint,async()=>{throw Object.assign(Error('refused'),{cause:{code:'ECONNREFUSED'}});}),'missing');
  assert.equal(await checkComfyState(endpoint,async()=>{throw Error('timeout');}),'unavailable');
  assert.throws(()=>comfyTarget('http://example.com:8188'),/localhost/);assert.throws(()=>comfyTarget(endpoint+'/prompt'),/localhost/);
});
