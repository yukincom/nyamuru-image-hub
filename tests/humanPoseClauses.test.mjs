import assert from 'node:assert/strict';
import test from 'node:test';
import { compareHumanPoseClauses, splitHumanPoseClauses } from '../src/lib/humanPoseClauses.ts';

// 混在する区切り、空節、空白、UTF-16位置を元の文字列へ照合する。
test('読点とASCIIカンマで分割し、空節を無視して元の位置を保持する', () => {
  const text = ' 、 左腕を上げる ,\t、 😀 両足を開く\n,右を向く 、';
  const clauses = splitHumanPoseClauses(text);
  assert.deepEqual(clauses.map(({ index, chunk_index, text }) => ({ index, chunk_index, text })), [
    { index: 0, chunk_index: 1, text: '左腕を上げる' },
    { index: 1, chunk_index: 3, text: '😀 両足を開く' },
    { index: 2, chunk_index: 4, text: '右を向く' },
  ]);
  for (const clause of clauses) assert.equal(text.slice(clause.start, clause.end), clause.text);
  assert.equal(clauses[0].start, text.indexOf('左腕'));
  assert.equal(clauses[1].end - clauses[1].start, 8);
  assert.deepEqual(splitHumanPoseClauses(' ,、\t,\n、'), []);
  assert.deepEqual(splitHumanPoseClauses(''), []);
});

test('境界空白だけを除去し、内部空白と他の句読点を保持する', () => {
  const text = '\t腕  を上げる\n両足を開く。顔は右；視線は上，膝を曲げる\n';
  assert.equal(splitHumanPoseClauses(text).length, 1);
  assert.equal(splitHumanPoseClauses(text)[0].text, text.trim());
  const diff = compareHumanPoseClauses('腕  を上げる、Ａ、が', '腕 を上げる、A、が');
  assert.deepEqual(diff.units.map(unit => unit.status), ['modified', 'modified', 'modified']);
});

test('区切りと境界空白だけの変更は節の変更として扱わない', () => {
  const diff = compareHumanPoseClauses(' 左腕を上げる、両足を開く ', '左腕を上げる , , 両足を開く、');
  assert.deepEqual(diff.units, [
    { status: 'unchanged', source_index: 0, edited_index: 0, original: '左腕を上げる', text: '左腕を上げる' },
    { status: 'unchanged', source_index: 1, edited_index: 1, original: '両足を開く', text: '両足を開く' },
  ]);
  assert.deepEqual(diff.changed_units, []);
  assert.deepEqual(diff.deleted_units, []);
});

// 一部分の編集で他の節を再翻訳しないため、照合を全文一致から切り離す。
test('一節の修正だけを変更として返し、他の節をそのまま残す', () => {
  const diff = compareHumanPoseClauses('左腕を上げる、両足を開く、視線は正面', '右腕を上げる、両足を開く、視線は正面');
  assert.deepEqual(diff.units.map(unit => unit.status), ['modified', 'unchanged', 'unchanged']);
  assert.deepEqual(diff.changed_units, [{
    status: 'modified', source_index: 0, edited_index: 0, original: '左腕を上げる', text: '右腕を上げる',
  }]);
  assert.deepEqual(diff.deleted_units, []);
});

test('先頭と途中への追加で既存の節の一致を失わない', () => {
  const diff = compareHumanPoseClauses('腕を上げる、足を開く', '直立、腕を上げる、背筋を伸ばす、足を開く');
  assert.deepEqual(diff.units.map(unit => [unit.status, unit.source_index, unit.edited_index]), [
    ['added', null, 0], ['unchanged', 0, 1], ['added', null, 2], ['unchanged', 1, 3],
  ]);
  assert.deepEqual(diff.changed_units.map(unit => unit.text), ['直立', '背筋を伸ばす']);
  assert.ok(diff.changed_units.every(unit => unit.original === null));
  assert.deepEqual(diff.deleted_units, []);
});

test('途中の削除を独立して返し、残りの節を変更に含めない', () => {
  const diff = compareHumanPoseClauses('腕を上げる、膝を曲げる、足を開く', '腕を上げる、足を開く');
  assert.deepEqual(diff.units.map(unit => [unit.status, unit.source_index]), [['unchanged', 0], ['unchanged', 2]]);
  assert.deepEqual(diff.changed_units, []);
  assert.deepEqual(diff.deleted_units, [{
    status: 'deleted', source_index: 1, edited_index: null, original: '膝を曲げる', text: null,
  }]);
});

test('節の並べ替えは内容を変更せず元の出現位置を保持する', () => {
  const diff = compareHumanPoseClauses('直立、腕を上げる、足を開く', '足を開く、直立、腕を上げる');
  assert.deepEqual(diff.units.map(unit => [unit.source_index, unit.edited_index]), [[2, 0], [0, 1], [1, 2]]);
  assert.ok(diff.units.every(unit => unit.status === 'unchanged' && unit.original === unit.text));
  assert.deepEqual(diff.changed_units, []);
  assert.deepEqual(diff.deleted_units, []);
});

test('重複節の元の出現を一度だけ利用し、余分な同文節は追加になる', () => {
  const diff = compareHumanPoseClauses('直立、腕を上げる、直立、直立', '直立、直立、腕を上げる、直立、直立');
  assert.deepEqual(diff.units.map(unit => unit.source_index), [0, 2, 1, 3, null]);
  assert.equal(diff.changed_units.length, 1);
  assert.equal(diff.changed_units[0].status, 'added');
  assert.equal(diff.changed_units[0].edited_index, 4);
  const removed = compareHumanPoseClauses('直立、直立、直立', '直立');
  assert.equal(removed.units[0].source_index, 0);
  assert.deepEqual(removed.deleted_units.map(unit => unit.source_index), [1, 2]);
});

test('一致する節を先に確保してから、残った順で変更を対応づける', () => {
  const diff = compareHumanPoseClauses('直立、腕を上げる、足を開く', '座る、足を開く、腕を上げる、片膝を立てる');
  assert.deepEqual(diff.units.map(unit => [unit.status, unit.source_index]), [
    ['modified', 0], ['unchanged', 2], ['unchanged', 1], ['added', null],
  ]);
  assert.deepEqual(diff.changed_units.map(unit => unit.text), ['座る', '片膝を立てる']);
  assert.deepEqual(diff.deleted_units, []);
});

test('一致しない節は意味を推測せず位置で対応し、余りを削除する', () => {
  const diff = compareHumanPoseClauses('直立、腕を上げる、足を開く', '両足を広げる、立つ');
  assert.deepEqual(diff.changed_units.map(unit => [unit.original, unit.text]), [
    ['直立', '両足を広げる'], ['腕を上げる', '立つ'],
  ]);
  assert.deepEqual(diff.deleted_units.map(unit => unit.original), ['足を開く']);
});

test('空の入力からの追加、全削除、両方空を区別する', () => {
  assert.deepEqual(compareHumanPoseClauses('', '直立、腕を上げる').units.map(unit => unit.status), ['added', 'added']);
  const deleted = compareHumanPoseClauses('直立、腕を上げる', ' , 、 ');
  assert.deepEqual(deleted.units, []);
  assert.deepEqual(deleted.changed_units, []);
  assert.deepEqual(deleted.deleted_units.map(unit => unit.source_index), [0, 1]);
  assert.deepEqual(compareHumanPoseClauses('', '、'), {
    source_clauses: [], edited_clauses: [], units: [], changed_units: [], deleted_units: [],
  });
});

// 重複・移動の組み合わせでも、元と編集後の全出現が一対一に処理されることを確かめる。
test('短い全組み合わせで最大限の完全一致と出現の保存を検証する', () => {
  const sequences = [[]];
  let level = [[]];
  for (let length = 1; length <= 3; length++) {
    level = level.flatMap(prefix => ['A', 'B', 'C'].map(text => [...prefix, text]));
    sequences.push(...level);
  }
  for (const source of sequences) {
    for (const edited of sequences) {
      const baselineText = source.join('、');
      const editedText = edited.join(',');
      const diff = compareHumanPoseClauses(baselineText, editedText);
      assert.deepEqual(diff.units.map(unit => unit.text), edited);
      assert.deepEqual(diff.units.map(unit => unit.edited_index), edited.map((_, index) => index));
      const consumed = [
        ...diff.units.filter(unit => unit.source_index !== null).map(unit => unit.source_index),
        ...diff.deleted_units.map(unit => unit.source_index),
      ].sort((a, b) => a - b);
      assert.deepEqual(consumed, source.map((_, index) => index));
      const expectedMatches = ['A', 'B', 'C'].reduce((count, text) => count + Math.min(
        source.filter(item => item === text).length, edited.filter(item => item === text).length,
      ), 0);
      assert.equal(diff.units.filter(unit => unit.status === 'unchanged').length, expectedMatches);
      for (const unit of diff.units) {
        if (unit.source_index !== null) assert.equal(unit.original, source[unit.source_index]);
        assert.equal(unit.status === 'unchanged', unit.original === unit.text);
      }
      assert.deepEqual(diff.changed_units, diff.units.filter(unit => unit.status !== 'unchanged'));
      assert.deepEqual(compareHumanPoseClauses(baselineText, editedText), diff);
    }
  }
});
