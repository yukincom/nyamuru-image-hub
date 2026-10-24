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
