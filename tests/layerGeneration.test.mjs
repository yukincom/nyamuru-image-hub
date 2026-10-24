import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeGenerationCacheSummary, deleteGenerationCache, listGenerationCaches } from '../src/lib/localBridge.ts';

const cacheSummaryResponse = () => ({
  service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3,
  root: '/Library/Application Support/cache', invalid_entry_count: 0,
  profiles: [{ profile_id: 'a'.repeat(64), label: 'Krea2 test', entry_count: 2, byte_size: 1200, owners: [
    { kind: 'series', id: 'series', label: '連載', entry_count: 1, byte_size: 700,
      last_used_at: '2026-09-10T00:00:00+00:00', expires_at: null, expired: false },
    { kind: 'one-shot', id: 'episode', label: '読み切り', entry_count: 1, byte_size: 500,
      last_used_at: '2026-09-09T00:00:00+00:00', expires_at: '2026-10-09T00:00:00+00:00', expired: false },
  ] }],
});

test('generation cache client validates retention metadata and sends only exact delete scopes', async t => {
  const decoded = decodeGenerationCacheSummary(cacheSummaryResponse());
  assert.equal(decoded.profiles[0].owners[0].expiresAt, null);
  assert.equal(decoded.profiles[0].owners[1].kind, 'one-shot');
  assert.throws(() => decodeGenerationCacheSummary({ ...cacheSummaryResponse(), profiles: [{
    ...cacheSummaryResponse().profiles[0], entry_count: 3,
  }] }), /集計/);
  assert.throws(() => decodeGenerationCacheSummary({ ...cacheSummaryResponse(), profiles: [{
    ...cacheSummaryResponse().profiles[0], owners: [{ ...cacheSummaryResponse().profiles[0].owners[0], expires_at: '2026-10-10T00:00:00Z' }],
    entry_count: 1, byte_size: 700,
  }] }), /作品キャッシュ/);

  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.window = { setTimeout, clearTimeout };
  const requests = [];
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  });
  globalThis.fetch = async (url, options) => {
    if (!options?.body) return Response.json({ service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 });
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    const response = cacheSummaryResponse();
    return Response.json(String(url).endsWith('/delete') ? { ...response, ok: true, deleted: true, summary: response } : response);
  };
  assert.equal((await listGenerationCaches()).profiles[0].entryCount, 2);
  assert.equal((await deleteGenerationCache({ scope: 'owner', ownerKind: 'series', ownerId: 'series' })).deleted, true);
  await deleteGenerationCache({ scope: 'profile', profileId: 'a'.repeat(64) });
  assert.deepEqual(requests.map(request => request.body), [
    {},
    { scope: 'owner', owner_kind: 'series', owner_id: 'series' },
    { scope: 'profile', profile_id: 'a'.repeat(64) },
  ]);
});
