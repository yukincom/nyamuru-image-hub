import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

for (const file of ['PanelInspector.tsx', 'PageOverlayInspector.tsx']) {
  test(`${file}: 吹き出し原画の専用表示設定をコマ情報に残さない`, () => {
    const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /analog-text-reference-toggle|原画を表示/);
  });
}

test('人物と吹き出しのコマ情報は画像レイヤーと同じフォルダー直下に置く', () => {
  const source = readFileSync(new URL('../src/components/PaintLayerPalette.tsx', import.meta.url), 'utf8');
  assert.match(source, /const renderOwnerInfo=[\s\S]{0,500}コマ情報/);
  assert.match(source, /renderEntries\(o,paintActive\)\}\{\(o\.kind==='figure'\|\|o\.kind==='bubble'\)&&renderOwnerInfo\(o\)/);
  assert.match(source, /LayerVisibilityButton label=\{`\$\{label\(o\)\}・\$\{l\.name\}を/);
});

test('候補欄は要確認だけに表示し、候補横の確定と該当なしで閉じる', () => {
  const source = readFileSync(new URL('../src/components/ScenarioBubbleNotice.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /OCRを仮入力しています|このコマに未使用の候補はありません/);
  assert.match(source, /!scenarioBubbleNeedsReview\(bubble\)\) return null/);
  assert.match(source, /candidates\.length > 0 &&/);
  assert.match(source, /前後コマから推定/);
  assert.match(source, /前後の吹き出しから推定/);
  assert.match(source, /type="checkbox"[\s\S]*?choose\(candidate.dialogues.map/);
  assert.match(source, /<span>確定<\/span>/);
  assert.match(source, /type="checkbox"[\s\S]*?choose\(null\)/);
  assert.match(source, /<span>該当なし<\/span>/);
  assert.doesNotMatch(source, /確定後は候補との連携を切り|該当なしは今の本文を残します/);
  assert.match(source, /class="scenario-inline" onClick=\{event => event\.stopPropagation\(\)\}/, 'card selection must not reset a controlled checkbox before its change event');
  assert.doesNotMatch(source, /<summary>候補を確認<\/summary>|シナリオを見る/);
});

test('候補選択はコマ情報に置き、T設定には追加しない', () => {
  for (const file of ['PanelInspector.tsx', 'PageOverlayInspector.tsx']) {
    const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
    assert.match(source, /<ScenarioBubbleNotice/);
    assert.doesNotMatch(source, /label="所属"|onMoveBubble/, 'ownership is controlled only by the layer palette');
  }
  const canvas = readFileSync(new URL('../src/components/MangaCanvas.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(canvas, /ScenarioBubbleNotice|bubbleOriginalState|referenceHidden|has-source-reference/);
  assert.equal((canvas.match(/review=\{scenarioBubbleNeedsReview\(bubble\)\}/g) ?? []).length, 2);
  const review = readFileSync(new URL('../src/components/ScenarioReview.tsx', import.meta.url), 'utf8');
  assert.match(review, /entries.filter\(entry => scenarioBubbleNeedsReview\(entry.bubble\)\)/);
  assert.doesNotMatch(review, /ScenarioBubbleNotice|confirmScenarioCorrespondence|現在の本文を使う|対応だけ選び直す/);
  assert.match(review, /コマ情報で確認/);
});

test('本文だけの移動は原画ラスターレイヤーの固定と独立し、形状移動は固定を守る', () => {
  const source = readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /const textOnly=!!patch\?\.textPosition&&!tail&&!patch\.bezier&&!patch\.tailRoot/);
  assert.match(source, /const contentLocked=textOnly\?bubble\?\.paint_overlay\?\.locked===true:artworkLocked\(bubble\?\.paint_overlay\)/);
});
