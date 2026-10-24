import assert from 'node:assert/strict';
import test from 'node:test';
import { renderHumanPoseTemplate } from '../src/lib/humanPoseTemplate.ts';

// 所有格と目的格、単数theyの語形を別々に確かめる。
test('ポーズの人物属性に応じて代名詞と動詞を解決する', () => {
  const text = '{{subject}} {{verb:stand}} beside a wall behind {{object}}, with {{possessive_adjective}} arms crossed';
  assert.equal(renderHumanPoseTemplate(text, 'female'), 'She stands beside a wall behind her, with her arms crossed');
  assert.equal(renderHumanPoseTemplate(text, 'male'), 'He stands beside a wall behind him, with his arms crossed');
  assert.equal(renderHumanPoseTemplate(text), 'They stand beside a wall behind them, with their arms crossed');
  assert.equal(renderHumanPoseTemplate('{{subject}} {{verb:be}} seated', 'neutral'), 'They are seated');
  assert.equal(renderHumanPoseTemplate('{{possessive_pronoun}} / {{reflexive}}', 'male'), 'His / himself');
});

test('未対応token・壊れた括弧・属性を拒否する', () => {
  for (const text of ['{{unknown}}', '{{verb:fly}}', '{{subject}', '', '{{constructor}}']) {
    assert.throws(() => renderHumanPoseTemplate(text));
  }
  assert.throws(() => renderHumanPoseTemplate('{{subject}}', 'constructor'));
});
