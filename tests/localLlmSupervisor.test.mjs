// 見込み: 接続状態と所有状態を分ければ、別サービスを触らず画像生成へ移れる。
// 合格: 各ケースの呼出順・停止/起動件数が一致。範囲: controller本体、通信・プロセス・待機は模擬。実LLMは未検証。
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  checkLlmState,
  llmOwnershipMode,
  llmTarget,
  selectModelAlias,
  LocalLlmController,
  runnerHasParent,
  hasImageGenerationSession,
} from '../scripts/local-llm-supervisor.mjs';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

// 見込み: 復旧helperが無いことと利用記録が無いことを区別すれば、競合起動を防げる。
// 合格: 記録なしはfalse、記録あり/不在PythonはrejectしてLLM準備へ進ませない。範囲: 実一時記録とhelper起動失敗、モデルなし。
test('missing recovery executable never silently clears an existing image-session barrier',async t=>{
 const root=await mkdtemp(join(tmpdir(),'nyamuru-image-barrier-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const env={NYAMURU_BRIDGE_PYTHON:join(root,'missing-python')};
 assert.equal(await hasImageGenerationSession(root,env),false);
 await writeFile(join(root,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'),'{}');
 await assert.rejects(()=>hasImageGenerationSession(root,env),{code:'ENOENT'});
});

test('runner初期化前にsupervisorを失った場合、PID 1を新しい親としてMLXを起動しない', () => {
  assert.equal(runnerHasParent(1234, 1234), true);
  assert.equal(runnerHasParent(1234, 1), false);
  assert.equal(runnerHasParent(1, 1), false);
  assert.equal(runnerHasParent(NaN, 1), false);
});

test('既存launcherの先頭モデルを既定とし、明示された登録モデルだけ切り替える', () => {
  const config = '# main\n  Current-8bit = org/main \n# test\nOther-4bit=org/test\nCurrent-8bit=org/shadowed\n';
  assert.equal(selectModelAlias(config), 'Current-8bit');
  assert.equal(selectModelAlias(config, 'Other-4bit'), 'Other-4bit');
  assert.throws(() => selectModelAlias(config, 'unknown'), /models.conf/);
  assert.throws(() => selectModelAlias('# empty'), /models.conf/);
  assert.throws(() => selectModelAlias('list=org/model'), /models.conf/);
});

test('起動対象は固定APIのloopbackだけでポートを勝手に変えない', () => {
  assert.deepEqual(llmTarget({}), { modelsUrl: 'http://127.0.0.1:8080/v1/models', host: '127.0.0.1', port: '8080' });
  assert.equal(llmTarget({ NYAMURU_PANEL_ACTION_LLM_URL: 'http://localhost:8090/v1/chat/completions' }).port, '8090');
  for (const url of ['https://example.com/v1/chat/completions', 'http://user:pass@localhost/v1/chat/completions', 'http://localhost/other', 'http://localhost/v1/chat/completions?model=test']) {
    assert.throws(() => llmTarget({ NYAMURU_PANEL_ACTION_LLM_URL: url }), /localhost/);
  }
});

test('LLMは自動共用を既定にし、明示した単体・共有モードも受け付ける', () => {
  assert.equal(llmOwnershipMode({}), 'auto');
  assert.equal(llmOwnershipMode({ NYAMURU_PANEL_ACTION_LLM_MODE: 'managed' }), 'managed');
  assert.equal(llmOwnershipMode({ NYAMURU_PANEL_ACTION_LLM_MODE: 'external-shared' }), 'external-shared');
  assert.throws(() => llmOwnershipMode({ NYAMURU_PANEL_ACTION_LLM_MODE: 'other' }), /auto・managed・external-shared/);
});

test('models catalogはOpenAI互換応答だけを確認し、ロード中モデルの証明には使わない', async () => {
  assert.equal(await checkLlmState('unused', async () => Response.json({ object: 'list', data: [{ object: 'model', id: 'cached' }] })), 'ready');
  assert.equal(await checkLlmState('unused', async () => Response.json({ object: 'list', data: [{ object: 'model', id: 'org/current' }] }), 'org/other'), 'ready');
  assert.equal(await checkLlmState('unused', async () => Response.json({ ok: true })), 'foreign');
  assert.equal(await checkLlmState('unused', async () => new Response('', { status: 401 })), 'foreign');
  assert.equal(await checkLlmState('unused', async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }), 'missing');
  assert.equal(await checkLlmState('unused', async () => { throw new DOMException('timeout', 'TimeoutError'); }), 'unavailable');
});

function fakeController(overrides = {}) {
  const events = [];
  let state = 'missing';
  const controller = new LocalLlmController({
    imageSession: async () => false,
    env: { NYAMURU_PANEL_ACTION_LLM_MODE: 'managed' },
    check: async () => state,
    launcher: async () => { events.push('config'); return { alias: 'existing' }; },
    launch: () => { events.push('launch'); state = 'ready'; return { running: true }; },
    running: (child) => child.running,
    stop: async (child) => { events.push('stop'); child.running = false; state = 'missing'; },
    ...overrides,
  });
  return { controller, events, setState: (value) => { state = value; } };
}

test('自動共用は保存aliasの設定ファイルがなくても8080を借り、通常処理後は停止しない', async () => {
  const { controller, events, setState } = fakeController({ env: {} });
  setState('ready');
  assert.deepEqual(await controller.ensure('unregistered-model'), {
    started: false, managed: false, modelAlias: 'default_model', ownershipMode: 'external-shared',
  });
  assert.equal(await controller.unload(), false);
  await controller.close();
  assert.deepEqual(events, []);
});

test('自動共用で未起動なら指定aliasを起動し、画像生成後に復帰対象にしない', async () => {
  const restoredFlags = [];
  const recovery = { resume: async () => false };
  const { controller, events } = fakeController({ env: {},
    suspendShared: async restore => { restoredFlags.push(restore); return recovery; },
  });
  assert.equal((await controller.ensure('existing')).managed, true);
  assert.equal(await controller.suspendForImages(), recovery);
  assert.deepEqual(restoredFlags, [false]);
  assert.deepEqual(events, ['config', 'launch', 'stop']);
});

test('画像生成の一時停止だけが元から動いていたLLMの復帰を要求する', async () => {
  const flags = [];
  const { controller, setState } = fakeController({ env: {}, suspendShared: async restore => { flags.push(restore); return {}; } });
  setState('ready');
  await controller.ensure('anything');
  await controller.suspendForImages();
  assert.deepEqual(flags, [true]);
});

// 見込み: 不明な接続先を一度で通知し、所有子プロセスがあっても誤停止を防ぐ。
// 合格: 接続確認1回、停止・起動・再試行・生成セッション作成0回。範囲: 実controller、通信とプロセスは模擬。
test('画像生成は別サービス・応答不能を1回の確認で返し、所有childがあっても停止しない', async () => {
  for (const state of ['foreign', 'unavailable']) {
    for (const owned of [false, true]) {
      const { controller, events } = fakeController({
        env: {},
        check: async () => { events.push('check'); return state; },
        suspendShared: async () => { events.push('suspend'); return {}; },
        sleep: async () => { events.push('retry'); },
      });
      if (owned) controller.child = { running: true };
      await assert.rejects(controller.suspendForImages('image-token'), /接続先が応答しないか、別のサービス.*停止・置換していません/);
      assert.deepEqual(events, ['check']);
      assert.equal(Boolean(controller.child?.running), owned);
    }
  }
});

// 見込み: 終了済みなら新しい画像生成を受け付けず、後続処理を増やさない。
// 合格: 終了エラーを返し、既存セッション照合・接続・停止・起動0回。範囲: 実controllerと模擬依存。
test('終了済みcontrollerは画像生成の一時停止を開始しない', async () => {
  const { controller, events } = fakeController({
    imageSession: async () => { events.push('image-session'); return false; },
    check: async () => { events.push('check'); return 'ready'; },
    suspendShared: async () => { events.push('suspend'); return {}; },
  });
  await controller.close();
  await assert.rejects(controller.suspendForImages('image-token'), /ローカル起動管理は終了/);
  assert.deepEqual(events, []);
});

// 見込み: 確認中に終了しても、遅い応答から停止処理を開始しない。
// 合格: 終了エラーを返し、次の確認・停止・セッション作成へ進まない。範囲: 実controller、照合と接続の待機を模擬。
test('画像生成の事前確認中に終了したcontrollerは遅れて停止sessionを作らない', async () => {
  for (const pendingStep of ['image-session', 'check']) {
    const gate = deferred();
    const { controller, events } = fakeController({
      imageSession: async () => { events.push('image-session'); if (pendingStep === 'image-session') await gate.promise; return false; },
      check: async () => { events.push('check'); if (pendingStep === 'check') await gate.promise; return 'ready'; },
      suspendShared: async () => { events.push('suspend'); return {}; },
    });
    const pending = controller.suspendForImages('image-token');
    const rejected = assert.rejects(pending, /ローカル起動管理は終了/);
    await new Promise(done => setImmediate(done));
    await controller.close();
    gate.resolve();
    await rejected;
    assert.deepEqual(events, pendingStep === 'check' ? ['image-session', 'check'] : ['image-session']);
  }
});

// 見込み: 画面終了を準備中とguardianへ渡せば、遅い停止後の復帰を防げる。
// 合格: 確認中abortは停止0回、同じsignalをguardianへ渡す。範囲: 実controller、接続・guardianは模擬。
test('image shutdown aborts preparation and is forwarded to the guardian', async () => {
  const aborted = new AbortController();
  const { controller, events } = fakeController({
    check: async () => { aborted.abort(); return 'ready'; },
    suspendShared: async () => assert.fail('must not suspend'),
  });
  await assert.rejects(controller.suspendForImages('token', { signal: aborted.signal }), /終了/);
  assert.deepEqual(events, []);
  const live = new AbortController();
  const ready = fakeController({ check: async () => 'ready', suspendShared: async (restore, token, signal) => {
    assert.equal(restore, true); assert.equal(token, 'token'); assert.equal(signal, live.signal); return {};
  } }).controller;
  await ready.suspendForImages('token', { signal: live.signal });
});

test('同時要求は一度だけ起動し、明示タスク後に解放して次回は再起動する', async () => {
  const { controller, events } = fakeController();
  const [first, second] = await Promise.all([controller.ensure(), controller.ensure()]);
  assert.deepEqual(first, { started: true, managed: true, modelAlias: 'existing', ownershipMode: 'managed' });
  assert.deepEqual(second, first);
  assert.equal(await controller.unload(), true);
  assert.deepEqual(await controller.ensure(), { started: true, managed: true, modelAlias: 'existing', ownershipMode: 'managed' });
  assert.deepEqual(events, ['config', 'launch', 'stop', 'config', 'launch']);
  await controller.close();
  assert.deepEqual(events, ['config', 'launch', 'stop', 'config', 'launch', 'stop']);
  await assert.rejects(() => controller.ensure(), /終了/);
});

test('手動起動の外部LLMは設定ファイルを読まず、終了時も停止しない', async () => {
  const { controller, events, setState } = fakeController();
  setState('ready');
  assert.deepEqual(await controller.ensure(), { started: false, managed: false, modelAlias: '', ownershipMode: 'managed' });
  await controller.close();
  assert.deepEqual(events, []);
});

test('単体管理の明示aliasでは管理対象外LLMを利用・停止・切替しない', async () => {
  const { controller, events, setState } = fakeController({
    launcher: async alias => { events.push(`config:${alias}`); return { alias, model: `org/${alias}` }; },
  });
  setState('ready');
  await assert.rejects(() => controller.ensure('small-model'), /管理対象外/);
  assert.deepEqual(events, ['config:small-model']);
  await controller.close();
  assert.deepEqual(events, ['config:small-model']);
});

test('単体管理は明示aliasで自分のchildを起動し、互換応答だけを確認する', async () => {
  const checked = [];
  const launched = [];
  const { controller } = fakeController({
    launcher: async alias => ({ alias, model: `org/${alias}` }),
    check: async config => { checked.push(config); return checked.length === 1 ? 'missing' : 'ready'; },
    launch: config => { launched.push(config); return { running: true }; },
  });
  assert.deepEqual(await controller.ensure('small-model'), {
    started: true, managed: true, modelAlias: 'small-model', ownershipMode: 'managed',
  });
  assert.deepEqual(checked, [
    { alias: 'small-model', model: 'org/small-model' },
    { alias: 'small-model', model: 'org/small-model' },
  ]);
  assert.deepEqual(launched, [{ alias: 'small-model', model: 'org/small-model' }]);
});

test('共有モードは保存aliasを切替要求にせずdefault_modelで既存サービスだけを借りる', async () => {
  const gate = deferred();
  const events = [];
  const controller = new LocalLlmController({
    imageSession: async () => false,
    env: { NYAMURU_PANEL_ACTION_LLM_MODE: 'external-shared' },
    check: async () => { events.push('check'); await gate.promise; return 'ready'; },
    launcher: async () => { events.push('config'); throw new Error('起動してはいけません'); },
    launch: () => { events.push('launch'); throw new Error('起動してはいけません'); },
    stop: async () => { events.push('stop'); },
  });
  const first = controller.ensure('model-a');
  const second = controller.ensure('model-b');
  gate.resolve();
  assert.deepEqual(await first, {
    started: false, managed: false, modelAlias: 'default_model', ownershipMode: 'external-shared',
  });
  assert.deepEqual(await second, await first);
  assert.equal(await controller.unload(), false);
  await controller.close();
  assert.deepEqual(events, ['check']);
});

test('共有モードは接続失敗時も単体起動へfallbackせず既存プロセスを触らない', async () => {
  for (const state of ['missing', 'foreign', 'unavailable']) {
    const events = [];
    const controller = new LocalLlmController({
    imageSession: async () => false,
      env: { NYAMURU_PANEL_ACTION_LLM_MODE: 'external-shared' },
      check: async () => state,
      launcher: async () => { events.push('config'); throw new Error('起動してはいけません'); },
      launch: () => { events.push('launch'); throw new Error('起動してはいけません'); },
      stop: async () => { events.push('stop'); },
    });
    await assert.rejects(() => controller.ensure('saved-model'), /共有LLM/);
    await controller.close();
    assert.deepEqual(events, []);
  }
});

test('停止失敗時は所有childを見失わず、次の終了処理で再試行できる', async () => {
  let stopAttempts = 0;
  const { controller } = fakeController({
    stop: async child => {
      stopAttempts += 1;
      if (stopAttempts === 1) throw new Error('stop failed');
      child.running = false;
    },
  });
  await controller.ensure();
  await assert.rejects(() => controller.unload(), /stop failed/);
  assert.equal(controller.child?.running, true);
  assert.equal(await controller.unload(), true);
  assert.equal(controller.child, null);
  assert.equal(stopAttempts, 2);
});

test('停止処理が返ってもchildが生きていれば終了済みと報告しない', async () => {
  const { controller } = fakeController({ stop: async () => {} });
  await controller.ensure();
  assert.equal(await controller.unload(), false);
  assert.equal(controller.child?.running, true);
});

test('稼働中の所有childを一時的な接続拒否で別aliasへ読み替えない', async () => {
  const { controller, setState } = fakeController({
    launcher: async alias => ({ alias: alias || 'model-a', model: `org/${alias || 'model-a'}` }),
  });
  await controller.ensure('model-a');
  setState('missing');
  await assert.rejects(() => controller.ensure('model-b'), /app所有LLM/);
  assert.equal(controller.childAlias, 'model-a');
});

test('既存の不明なサービスを置換しない', async () => {
  for (const state of ['foreign', 'unavailable']) {
    const { controller, events, setState } = fakeController();
    setState(state);
    await assert.rejects(() => controller.ensure(), /停止・置換していません/);
    await controller.close();
    assert.deepEqual(events, []);
  }
});

test('環境不足では何も起動せず、次の明示操作で再試行できる', async () => {
  const { controller, events } = fakeController({ launcher: async () => { throw new Error('モデル未配置'); } });
  await assert.rejects(() => controller.ensure(), /モデル未配置/);
  await assert.rejects(() => controller.ensure(), /モデル未配置/);
  assert.deepEqual(events, []);
});

test('起動timeoutで自分のchildだけ回収する', async () => {
  let time = 0;
  const { controller, events } = fakeController({ check: async () => 'missing', now: () => time, sleep: async () => { time += 60_000; } });
  await assert.rejects(() => controller.ensure(), /2分以内/);
  assert.deepEqual(events, ['config', 'launch', 'stop']);
});

test('起動途中の異常終了を画面へ伝え、再起動可能な状態に戻す', async () => {
  const { controller, events } = fakeController({ running: () => false });
  await assert.rejects(() => controller.ensure(), /起動前に終了/);
  assert.deepEqual(events, ['config', 'launch', 'stop']);
});

test('準備中の終了では遅れてchildを起動しない', async () => {
  const gate = deferred();
  const { controller, events } = fakeController({ launcher: async () => gate.promise });
  const pending = controller.ensure();
  const rejected = assert.rejects(pending, /終了/);
  await new Promise((done) => setImmediate(done));
  const closing = controller.close();
  gate.resolve({ alias: 'current' });
  await Promise.all([closing, rejected]);
  assert.deepEqual(events, []);
});

test('起動待ち中の終了は所有childを一回停止し、外部LLMを触らない', async () => {
  const gate = deferred();
  const { controller, events } = fakeController({ check: async () => 'missing', sleep: async () => gate.promise });
  const pending = controller.ensure();
  const rejected = assert.rejects(pending, /終了/);
  await new Promise((done) => setImmediate(done));
  const closing = controller.close();
  gate.resolve();
  await Promise.all([closing, rejected]);
  assert.deepEqual(events, ['config', 'launch', 'stop']);
});

test('restarted supervisor cannot prepare or suspend an LLM during surviving ComfyUI or restoration', async () => {
  let occupied = true;
  const { controller, events } = fakeController({ env: {}, imageSession: async () => occupied });
  await assert.rejects(() => controller.ensure('existing'), /ComfyUI/);
  await assert.rejects(() => controller.suspendForImages('new-session'), /ComfyUI/);
  assert.deepEqual(events, []);
  occupied = false;
  await controller.ensure('existing');
  assert.deepEqual(events, ['config', 'launch']);
  await controller.close();
});

// 見込み: 導入先に固有の仮想環境を使わなくても、復旧中の記録を検出して競合起動を防げる。
// 合格: 空の保存先はfalse、inactive記録があるとtrue。実Pythonの復旧helperと一時JSON、モデル起動なし。
test('session discovery retains protection through inactive restoration records', async t => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { hasImageGenerationSession } = await import('../scripts/local-llm-supervisor.mjs');
  const env = { ...process.env, NYAMURU_BRIDGE_PYTHON: 'python3' };
  const root = await mkdtemp(join(tmpdir(), 'comfy-session-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await hasImageGenerationSession(root, env), false);
  await writeFile(join(root, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'), '{"active":false}');
  assert.equal(await hasImageGenerationSession(root, env), true);
});
