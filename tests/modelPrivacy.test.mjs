import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudModelAccess } from '../src/lib/modelPrivacy.ts';

test('成人指定作品への同意と実行先の選択は独立した利用条件', () => {
  for (const execution of ['local', 'cloud']) for (const adultTermsConfirmed of [false, true]) for (const adultContent of [false, true]) {
    const reason = execution === 'local' ? 'disabled' : adultContent && !adultTermsConfirmed ? 'adult-terms-required' : 'allowed';
    assert.deepEqual(cloudModelAccess({ execution, cloud: { adultTermsConfirmed } }, adultContent), { allowed: reason === 'allowed', reason });
  }
});
