// 見込み: Hermesも共通controllerへ任せれば確認を重ねず、失敗と復帰待ちを呼出元へ伝えられる。
// 合格: 各ケースの接続/実行/復帰件数と順序が一致。範囲: 実wrapper/controller、通信・プロセス・生成は模擬。
import assert from 'node:assert/strict';
import test from 'node:test';
import { generate, withImageSession } from '../scripts/hermes_qwen.mjs';
import { LocalLlmController } from '../scripts/local-llm-supervisor.mjs';

// 見込み: 生成失敗時も共通停止処理を経て復帰を待ち、途中で終了しない。
// 合格: 停止→生成失敗→復帰の順を保ち、生成エラーを呼出元へ返す。範囲: 実Hermes wrapper、controllerは模擬。
test('failure in image generation still waits for LLM restoration', async () => {
  const events = [];
  const controller = { async suspendForImages() {
    events.push('paused');
    return { async resume() { await Promise.resolve(); events.push('restored'); } };
  } };
  await assert.rejects(withImageSession(async () => { events.push('failed'); throw new Error('image failed'); },
    { controller, token: 'test-token' }), /image failed/);
  assert.deepEqual(events, ['paused', 'failed', 'restored']);
});

// 見込み: 共通停止処理の復帰失敗を伝え、画像取得だけで成功としない。
// 合格: 生成結果があっても成功を返さず、復帰エラーで終了する。範囲: 実Hermes wrapper、生成とセッションは模擬。
test('restoration failure cannot be reported as generation success', async () => {
  const controller = { async suspendForImages() { return { async resume() { throw new Error('restore failed'); } }; } };
  await assert.rejects(withImageSession(async () => ({ image_path: 'output.png' }), { controller }), /restore failed/);
});

// 見込み: 共通controllerへ任せるとHermesの確認重複を除ける。
// 合格: 別サービス・応答不能は確認1回でエラー、停止・起動・再試行・生成0回。範囲: 実wrapper/controller、通信は模擬。
test('an unresponsive or foreign listener is never suspended', async () => {
  for (const state of ['foreign', 'unavailable']) {
    const events = [];
    const controller = new LocalLlmController({
      env: {}, imageSession: async () => false,
      check: async () => { events.push('check'); return state; },
      launcher: async () => assert.fail('must not load launcher'),
      launch: () => assert.fail('must not launch'), stop: async () => assert.fail('must not stop'),
      sleep: async () => assert.fail('must not retry'), suspendShared: async () => assert.fail('must not suspend'),
    });
    await assert.rejects(withImageSession(() => assert.fail('must not generate'), { controller }), /接続先が応答しないか、別のサービス.*停止・置換していません/);
    assert.deepEqual(events, ['check']);
  }
});

// 見込み: 正常・未起動でも確認を重ねず、元の稼働状態から復帰要否を決める。
// 合格: 確認→停止セッション→同tokenの生成→復帰が各1回。範囲: 実wrapper/controller、通信と生成は模擬。
test('Hermes checks once for ready or missing and retains token and restoration order', async () => {
  for (const state of ['ready', 'missing']) {
    const events = [];
    const controller = new LocalLlmController({
      env: {}, imageSession: async () => false,
      check: async () => { events.push('check'); return state; },
      launcher: async () => assert.fail('must not load launcher'),
      launch: () => assert.fail('must not launch'), stop: async () => assert.fail('must not stop'),
      sleep: async () => assert.fail('must not retry'),
      suspendShared: async (restore, token) => {
        events.push(['suspend', restore, token]);
        return { async resume() { events.push('resume'); } };
      },
    });
    assert.equal(await withImageSession(async token => { events.push(['run', token]); return 'output'; },
      { controller, token: 'image-token' }), 'output');
    assert.deepEqual(events, ['check', ['suspend', state === 'ready', 'image-token'], ['run', 'image-token'], 'resume']);
  }
});

test('invalid preparation and uncertain existing jobs never suspend or resubmit', async () => {
  const session = () => assert.fail('must not pause');
  await assert.rejects(generate([], { run: async () => { throw new Error('invalid input'); }, session }), /invalid input/);
  for (const status of ['failed', 'queued', 'running', 'outcome_unknown']) {
    let calls = 0;
    await assert.rejects(generate([], { run: async () => { calls++; return { status }; }, session }), /do not resubmit/);
    assert.equal(calls, 1);
  }
  assert.equal((await generate([], { run: async () => ({ status: 'succeeded' }), session })).status, 'succeeded');
});

test('input preparation finishes before the local conversation model is paused', async () => {
  const events = [];
  const run = async args => {
    events.push(args[0]);
    if (args[0] === 'prepare') return { status: 'prepared', job_id: 'job-id' };
    assert.deepEqual(args, ['run', '--job', 'job-id', '--image-session-token', 'lease-token']);
    return { status: 'succeeded' };
  };
  const session = async callback => {
    events.push('pause');
    const output = await callback('lease-token');
    events.push('restore');
    return output;
  };
  assert.equal((await generate(['--request', 'request.json'], { run, session })).status, 'succeeded');
  assert.deepEqual(events, ['prepare', 'pause', 'run', 'restore']);
});
