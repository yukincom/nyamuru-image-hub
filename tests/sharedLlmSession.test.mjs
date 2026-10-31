// 見込み: 生成完了と通常終了を別命令にすれば、終了後の復帰を防げる。
// 合格: 復帰はresumeだけ、shutdown優先。範囲: 実wrapperと模擬workerのpipe、実LLMなし。
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { suspendSharedLlm } from '../scripts/shared-llm-session.mjs';

function fakeWorker() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const events = [];
  child.stdin.on('data', data => events.push(data.toString()));
  const send = payload => child.stdout.write(`${JSON.stringify(payload)}\n`);
  return { child, events, send };
}

test('guardian stays paused until explicit completion and one resume waits for verified restoration', async () => {
  const { child, events, send } = fakeWorker();
  const pending = suspendSharedLlm({ spawnImpl: (_python, args, options) => {
    assert.equal(options.detached, true); assert.equal(args[1], '--session');
    queueMicrotask(() => send({ state: 'paused' })); return child;
  } });
  const recovery = await pending;
  assert.deepEqual(events, []);
  const first = recovery.resume();
  const second = recovery.resume();
  assert.equal(first, second);
  send({ state: 'restored', was_running: true });
  assert.equal(await first, true);
  assert.deepEqual(events, ['resume\n']);
});

// 見込み: 通常終了は生成完了の復帰要求より優先できる。
// 合格: resume待機中もshutdownを1回送り、後からresumeしても復帰しない。範囲: 実wrapperと模擬pipe、実LLMなし。
test('shutdown supersedes a pending resume and cannot be undone by another resume', async () => {
  const { child, events, send } = fakeWorker();
  const recovery = await suspendSharedLlm({ spawnImpl: () => {
    queueMicrotask(() => send({ state: 'paused' })); return child;
  } });
  const resumed = recovery.resume();
  assert.equal(child.stdin.writableEnded, false);
  const stopped = recovery.shutdown();
  assert.equal(recovery.resume(), stopped);
  assert.equal(recovery.shutdown(), stopped);
  send({ state: 'restored', was_running: false });
  assert.equal(await resumed, false);
  assert.equal(await stopped, false);
  assert.deepEqual(events, ['resume\n', 'shutdown\n']);
});

// 見込み: 一時停止の準備中にも終了理由を届ければ、遅い完了後の復帰を防げる。
// 合格: 準備中abortでshutdown1回、resume0回、終了結果false。範囲: 実wrapperと模擬worker、実プロセスなし。
test('shutdown signal reaches the guardian before pause preparation completes', async () => {
  const { child, events, send } = fakeWorker();
  const shutdown = new AbortController();
  const pending = suspendSharedLlm({ signal: shutdown.signal, spawnImpl: () => child });
  shutdown.abort();
  assert.deepEqual(events, ['shutdown\n']);
  send({ state: 'paused' });
  const recovery = await pending;
  const result = recovery.resume();
  send({ state: 'restored', was_running: false });
  assert.equal(await result, false);
  assert.deepEqual(events, ['shutdown\n']);
});

test('missing original selects image cleanup only; failed restoration reaches caller', async () => {
  const { child, send } = fakeWorker();
  const recovery = await suspendSharedLlm({ restore: false, spawnImpl: (_python, args) => {
    assert.equal(args[1], '--images-only'); queueMicrotask(() => send({ state: 'paused' })); return child;
  } });
  const result = recovery.resume();
  send({ state: 'error', message: 'original server failed' });
  await assert.rejects(result, /original server failed/);
});

test('capture failure never reports a completed pause', async () => {
  const { child, send } = fakeWorker();
  await assert.rejects(() => suspendSharedLlm({ spawnImpl: () => {
    queueMicrotask(() => send({ state: 'error', message: 'snapshot failed' })); return child;
  } }), /snapshot failed/);
});

test('guardian exit waits for final stdout data before deciding restoration failed', async () => {
  const { child, send } = fakeWorker();
  const recovery = await suspendSharedLlm({ spawnImpl: () => {
    queueMicrotask(() => send({ state: 'paused' })); return child;
  } });
  const result = recovery.resume();
  child.emit('exit', 0);
  send({ state: 'restored', was_running: true });
  child.emit('close', 0);
  assert.equal(await result, true);
});
