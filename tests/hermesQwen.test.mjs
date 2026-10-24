import assert from 'node:assert/strict';
import test from 'node:test';
import { generate, withImageSession } from '../scripts/hermes_qwen.mjs';

test('failure in image generation still waits for LLM restoration', async () => {
  const events = [];
  const controller = { async check() { return 'ready'; }, async suspendForImages() {
    events.push('paused');
    return { async resume() { await Promise.resolve(); events.push('restored'); } };
  } };
  await assert.rejects(withImageSession(async () => { events.push('failed'); throw new Error('image failed'); },
    { controller, token: 'test-token' }), /image failed/);
  assert.deepEqual(events, ['paused', 'failed', 'restored']);
});

test('restoration failure cannot be reported as generation success', async () => {
  const controller = { async check() { return 'ready'; }, async suspendForImages() { return { async resume() { throw new Error('restore failed'); } }; } };
  await assert.rejects(withImageSession(async () => ({ image_path: 'output.png' }), { controller }), /restore failed/);
});

test('an unresponsive or foreign listener is never suspended', async () => {
  for (const state of ['foreign', 'unavailable']) {
    const controller = { async check() { return state; }, suspendForImages() { assert.fail('must not stop'); } };
    await assert.rejects(withImageSession(() => assert.fail('must not generate'), { controller }), /nothing was stopped/);
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
