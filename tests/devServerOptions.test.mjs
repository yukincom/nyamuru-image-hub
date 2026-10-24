import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDevOptions } from '../scripts/dev-server-options.mjs';

test('開発画面は既定でIPv4 localhostへ接続できる', () => {
  assert.deepEqual(parseDevOptions([], { root: '/repo' }), {
    root: '/repo',
    server: { host: '127.0.0.1' },
  });
});

test('明示されたhostとportは既定値を上書きする', () => {
  assert.deepEqual(parseDevOptions(['--host', '0.0.0.0', '--port=4322'], { root: '/repo' }), {
    root: '/repo',
    server: { host: '0.0.0.0', port: 4322 },
  });
});
