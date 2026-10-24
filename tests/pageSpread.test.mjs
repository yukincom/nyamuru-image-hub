import test from 'node:test';
import assert from 'node:assert/strict';
import { pagePreviewGridPosition, spreadPartnerIndex } from '../src/lib/pageSpread.ts';

test('見開きは選択ページに関係なく1+2、3+4の固定ペアを返す', () => {
  assert.equal(spreadPartnerIndex(0, 4, true), 1);
  assert.equal(spreadPartnerIndex(1, 4, true), 0);
  assert.equal(spreadPartnerIndex(2, 4, true), 3);
  assert.equal(spreadPartnerIndex(3, 4, true), 2);
});

test('見開きOFF、1ページ作品、最後に余ったページでは相方を作らない', () => {
  assert.equal(spreadPartnerIndex(0, 4, false), null);
  assert.equal(spreadPartnerIndex(0, 1, true), null);
  assert.equal(spreadPartnerIndex(4, 5, true), null);
});

test('ページ一覧は右綴じで若いページを右列へ2枚ずつ並べる', () => {
  assert.deepEqual(pagePreviewGridPosition(0), { row: 1, column: 2 });
  assert.deepEqual(pagePreviewGridPosition(1), { row: 1, column: 1 });
  assert.deepEqual(pagePreviewGridPosition(2), { row: 2, column: 2 });
  assert.deepEqual(pagePreviewGridPosition(3), { row: 2, column: 1 });
});
