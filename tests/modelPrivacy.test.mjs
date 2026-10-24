import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLOUD_MODEL_PREFERENCES_KEY,
  cloudModelAccess,
  loadCloudModelPreferences,
  saveCloudModelPreferences,
} from '../src/lib/modelPrivacy.ts';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('クラウドモデルは端末ごとに既定OFFで保存する', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadCloudModelPreferences(storage), { enabled: false, adultTermsConfirmed: false });
  saveCloudModelPreferences(storage, { enabled: true, adultTermsConfirmed: true });
  assert.deepEqual(loadCloudModelPreferences(storage), { enabled: true, adultTermsConfirmed: true });
  assert.equal(storage.getItem(CLOUD_MODEL_PREFERENCES_KEY), '{"enabled":true,"adultTermsConfirmed":true}');
});

test('成人指定作品はクラウド有効でも規約確認前はローカルに留める', () => {
  assert.deepEqual(cloudModelAccess({ enabled: false, adultTermsConfirmed: true }, false), {
    allowed: false, reason: 'disabled',
  });
  assert.deepEqual(cloudModelAccess({ enabled: true, adultTermsConfirmed: false }, true), {
    allowed: false, reason: 'adult-terms-required',
  });
  assert.deepEqual(cloudModelAccess({ enabled: true, adultTermsConfirmed: true }, true), {
    allowed: true, reason: 'allowed',
  });
  assert.deepEqual(cloudModelAccess({ enabled: true, adultTermsConfirmed: false }, false), {
    allowed: true, reason: 'allowed',
  });
});
