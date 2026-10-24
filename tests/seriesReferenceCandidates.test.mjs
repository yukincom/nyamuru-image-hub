import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceSeriesReferenceCandidate, seriesReferenceConfirmationState } from '../src/lib/seriesReferenceCandidates.ts';

test('high-confidence相当の単一recommended候補も明示確認を要求する', () => {
  assert.deepEqual(seriesReferenceConfirmationState([{
    relativePath: 'text/series_setting.md',
    recommended: true,
  }]), {
    requiresConfirmation: true,
    selectedPaths: ['text/series_setting.md'],
  });
});

test('候補がなければ確認UIを要求しない', () => {
  assert.deepEqual(seriesReferenceConfirmationState([]), {
    requiresConfirmation: false,
    selectedPaths: [],
  });
});

const references = [
  { seriesDirectory: '/series', relativePath: 'setting.md', text: 'setting' },
  { seriesDirectory: '/series', relativePath: 'character.md', text: 'characters' },
  { seriesDirectory: '/series', relativePath: 'notes.md', text: 'unchecked notes' },
];

test('一行を変更しても他の資料とチェック状態を保持し、入力を変更しない', () => {
  const original = structuredClone(references);
  const replacement = { seriesDirectory: '/series', relativePath: 'new-setting.md', text: 'new setting' };
  assert.deepEqual(replaceSeriesReferenceCandidate(references, ['setting.md', 'character.md'], replacement, 'setting.md'), {
    candidates: [replacement, references[1], references[2]],
    selectedPaths: ['new-setting.md', 'character.md'],
  });
  assert.deepEqual(references, original);
});

test('同じファイルへの変更は本文を更新し、追加済みパスを二重に並べない', () => {
  const replacement = { ...references[1], text: 'updated characters' };
  const result = replaceSeriesReferenceCandidate(references, ['setting.md'], replacement, 'character.md');
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates[1].text, 'updated characters');
  assert.deepEqual(result.selectedPaths, ['setting.md', 'character.md']);
  const duplicate = replaceSeriesReferenceCandidate(references, ['setting.md', 'character.md'], replacement, 'setting.md');
  assert.deepEqual(duplicate.candidates.map(row => row.relativePath), ['character.md', 'notes.md']);
  assert.deepEqual(duplicate.selectedPaths, ['character.md']);
});

test('資料の追加は既存資料を保持し、新しい資料だけを選択する', () => {
  const added = { seriesDirectory: '/series', relativePath: 'extra.md', text: 'extra' };
  const result = replaceSeriesReferenceCandidate(references, ['character.md'], added);
  assert.deepEqual(result.candidates, [...references, added]);
  assert.deepEqual(result.selectedPaths, ['character.md', 'extra.md']);
  assert.deepEqual(replaceSeriesReferenceCandidate([], [], added), { candidates: [added], selectedPaths: ['extra.md'] });
});

test('別シリーズのファイルは混ぜず、現在の資料を保持する', () => {
  const original = structuredClone(references);
  assert.throws(() => replaceSeriesReferenceCandidate(references, ['character.md'], {
    seriesDirectory: '/different-series', relativePath: 'new.md', text: 'other series',
  }, 'setting.md'), /同じシリーズフォルダ/);
  assert.deepEqual(references, original);
});
