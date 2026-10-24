import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceUrl } from '../src/lib/clientRuntime.ts';

test('LAN service calls stay on the editor origin while local mode keeps its existing resolver', () => {
  assert.equal(serviceUrl('bridge', '/api/agent/chat', true), '/__nyamuru/bridge/api/agent/chat');
  assert.equal(serviceUrl('supervisor', '/api/new-creation/start', true), '/__nyamuru/supervisor/api/new-creation/start');
  assert.equal(serviceUrl('bridge', '/api/health', false), null);
  for (const path of ['//evil.test/api/health', '/api/../secret', '/api/health?url=x', '/api/%2e%2e/a']) assert.throws(() => serviceUrl('bridge', path, true));
});
