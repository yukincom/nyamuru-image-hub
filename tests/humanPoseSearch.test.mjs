import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { searchHumanPoses } from '../src/lib/humanPoseSearch.ts';

const data = name => JSON.parse(readFileSync(new URL(`../scripts/human_pose/data/${name}.json`, import.meta.url), 'utf8'));
const categories = ['01-standing', '02-leaning-and-supported', '03-holding-a-handle-with-one-arm', '04-holding-a-handle-with-both-arms', '05-sitting', '06-squatting', '07-lying-down'];
const poses = categories.flatMap(category => data(category).map(entry => ({
  ...entry, id: entry.slug, category, label_en: entry.slug.replaceAll('-', ' '), search_aliases: [],
  pose_normalized_text: entry.slug.replaceAll('-', ' '),
})));
const tags = data('tags');
const ids = query => searchHumanPoses(poses, tags, query).map(entry => entry.id).sort();

// 期待する候補を原文から列挙し、検索実装から逆算しない。
test('座位の日英同義語と複数条件で同じ候補へ絞る', () => {
  for (const query of ['座る', '座り', 'sitting', 'ＳＩＴＴＩＮＧ']) assert.equal(ids(query).length, 13);
  assert.deepEqual(ids('座る 足を組む'), ['sitting-cross-legged-on-the-floor', 'sitting-on-a-chair-with-her-legs-crossed']);
  assert.deepEqual(ids('足を組む 椅子'), ['sitting-on-a-chair-with-her-legs-crossed']);
  assert.deepEqual(ids('あぐら'), ['sitting-cross-legged-on-the-floor']);
  assert.deepEqual(ids('足首を組む'), []);
});

test('未認識語と否定語を落とさず、空欄だけで全件を返す', () => {
  assert.equal(ids('').length, 68);
  assert.deepEqual(ids('座る 未知の動作'), []);
  assert.deepEqual(ids('座らない'), []);
  assert.deepEqual(ids('不存在'), []);
  assert.deepEqual(ids('中腰'), ['in-a-half-squat-with-her-hands-on-her-thighs']);
  assert.equal(ids('stool').length, 3);
  assert.equal(ids('取っ手').length, 3);
});
