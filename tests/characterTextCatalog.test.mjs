import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeCharacterTextCatalog,
  parseCharacterText,
  toCharacterTextMarkdown,
} from '../src/lib/characterTextCatalog.ts';
import { emptyTestDocument } from './fixtures/emptyTestDocument.ts';

function emptyStory() {
  const document = emptyTestDocument();
  document.manga.meta.series = '呼応変異';
  document.manga.meta.series_id = 'series-kouou';
  document.manga.characters = [];
  document.manga.materials = [];
  return document;
}

test('基準頭身は12を超えても人物テキストから取り込み往復できる', () => {
  for (const headCount of [6.5, 16, 120.5, 12345.5]) {
    const source = emptyStory();
    source.manga.characters = [{
      localId: 'person-monster', catalog_id: 'character-monster',
      name: '怪人', role: '', scope: 'series', default_proportion: { head_count: headCount },
    }];
    const entries = parseCharacterText(toCharacterTextMarkdown(source));
    assert.equal(entries[0].headCount, headCount);
    const restored = mergeCharacterTextCatalog(emptyStory(), entries).document;
    assert.equal(restored.manga.characters[0].default_proportion.head_count, headCount);
  }
});

test('既存の太字人物名と人物像を抽出する', () => {
  const entries = parseCharacterText(`# 登場人物設定
## メインキャラクター
**ユキ**
好奇心が強く、思いつきを形にするのが好き。

**ジプト**
AI。基本的に陽気でお調子者。`);

  assert.deepEqual(entries.map(({ name, role }) => ({ name, role })), [
    { name: 'ユキ', role: '好奇心が強く、思いつきを形にするのが好き。' },
    { name: 'ジプト', role: 'AI。基本的に陽気でお調子者。' },
  ]);
});

test('人物一覧の後にある制作メモを人物として取り込まない', () => {
  const entries = parseCharacterText(`# 登場人物設定
## メインキャラクター
**ユキ**
好奇心が強い。

## 制作メモ
### 雨の回
傘を持たせる。`);

  assert.deepEqual(entries.map(({ name, role }) => ({ name, role })), [
    { name: 'ユキ', role: '好奇心が強い。' },
  ]);
});

test('標準人物Markdownを出力して往復できる', () => {
  const source = emptyStory();
  source.manga.characters = [{
    localId: 'person-yuki',
    catalog_id: 'character-yuki',
    name: 'ユキ',
    role: '好奇心が強い。',
    visual_prompt: '6.5〜7頭身で細身。\n顔は卵形。\n\n髪は大きな塊で描く。',
    scope: 'series',
    aliases: ['ゆっきー'],
    default_proportion: { head_count: 4 },
    recognition: {
      hair: { observed: ['短い髪'], inferred: [] },
      face: { observed: [], inferred: [] },
      silhouette: { observed: [], inferred: [] },
      outfit: { observed: [], inferred: [] },
      accessories: { observed: ['頭頂部の四角い飾り'], inferred: [] },
      ambiguous_design: { observed: [], inferred: [] },
    },
  }];

  const markdown = toCharacterTextMarkdown(source);
  const [entry] = parseCharacterText(markdown);
  assert.equal(entry.catalogId, 'character-yuki');
  assert.equal(entry.name, 'ユキ');
  assert.equal(entry.role, '好奇心が強い。');
  assert.equal(entry.visualPrompt, source.manga.characters[0].visual_prompt);
  const restored = mergeCharacterTextCatalog(emptyStory(), [entry]).document.manga.characters[0];
  assert.equal(restored.visual_prompt, entry.visualPrompt);
  assert.equal(restored.role, entry.role);
  assert.deepEqual(entry.aliases, ['ゆっきー']);
  assert.equal(entry.headCount, 4);
  assert.deepEqual(entry.recognition.accessories.observed, ['頭頂部の四角い飾り']);
  assert.deepEqual(entry.recognition.hair.observed, ['短い髪']);
  assert.match(markdown, /<!-- \/nyamuru-series-character-catalog -->/u);
});

test('テキストのビジュアル指定は人物像と独立して更新・消去し、欄のない資料では既存値を守る', () => {
  const source = emptyStory();
  source.manga.characters = [{ localId: 'person-yuki', catalog_id: 'character-yuki', name: 'ユキ', role: '慎重な性格', visual_prompt: '黒い短髪', scope: 'series' }];
  const legacy = mergeCharacterTextCatalog(source, parseCharacterText('### ユキ\n#### 人物像\n好奇心が強い'));
  assert.equal(legacy.document.manga.characters[0].role, '好奇心が強い');
  assert.equal(legacy.document.manga.characters[0].visual_prompt, '黒い短髪');
  const changed = mergeCharacterTextCatalog(source, parseCharacterText('### ユキ\n#### 画像生成用ビジュアルプロンプト\n細い線\n\n小さな顎'));
  assert.equal(changed.document.manga.characters[0].role, '慎重な性格');
  assert.equal(changed.document.manga.characters[0].visual_prompt, '細い線\n\n小さな顎');
  changed.document.manga.characters[0].visual_prompt = '';
  const [blank] = parseCharacterText(toCharacterTextMarkdown(changed.document));
  assert.equal(blank.visualPrompt, '');
  const cleared = mergeCharacterTextCatalog(source, [blank]);
  assert.equal(cleared.document.manga.characters[0].visual_prompt, '');
  assert.equal(cleared.document.manga.characters[0].role, '慎重な性格');
});

test('参照テキスト人物をシリーズ人物として追加し、同名は更新する', () => {
  const source = emptyStory();
  source.manga.characters = [{
    localId: 'person-yuki', name: 'ユキ', role: '旧人物像', scope: 'series', catalog_id: 'character-yuki',
  }];
  const entries = parseCharacterText(`### ユキ
#### 人物像
新しい人物像

### ジプト
#### 人物像
陽気なAI`);
  const merged = mergeCharacterTextCatalog(source, entries);

  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  assert.equal(merged.document.manga.characters.find((entry) => entry.name === 'ユキ').role, '新しい人物像');
  const gpt = merged.document.manga.characters.find((entry) => entry.name === 'ジプト');
  assert.equal(gpt.scope, 'series');
  assert.match(gpt.catalog_id, /^character-/u);
});
