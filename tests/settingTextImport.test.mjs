import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSeriesSettingText, parseSeriesTitleText, parseSettingText, parseStoryReferenceText } from '../src/lib/settingTextImport.ts';

test('シリーズ資料から明示名・作品H1を読み取り、汎用見出しを名前にしない', () => {
  assert.equal(parseSeriesTitleText('# シリーズ設定\n\nシリーズ名：呼応変異\n## ジャンル\n現代SF'), '呼応変異');
  assert.equal(parseSeriesTitleText('# 呼応変異\n## 世界観\n現代の物語。'), '呼応変異');
  assert.equal(parseSeriesTitleText('# シリーズ「呼応変異」'), '呼応変異');
  assert.equal(parseSeriesTitleText('# シリーズ設定\n## シリーズ名\n呼応変異\n## 世界観\n現代の物語。'), '呼応変異');
  assert.equal(parseSeriesTitleText('# 資料の仮見出し\nタイトル：呼応変異'), '呼応変異');
  assert.equal(parseSeriesTitleText('# シリーズ設定\n## ジャンル\n現代SF\n## 世界観\n現代の物語。'), '');
  assert.equal(parseSeriesTitleText('# シリーズ 設定\n## タイトル\n## ジャンル\nSF'), '');
  assert.equal(parseSeriesTitleText('シリーズ名：\nジャンル：SF'), '');
});

test('人物資料の人名見出しやコード例からシリーズ名を作らない', () => {
  assert.equal(parseSeriesTitleText('# 主人公\n## 人物像\n元気。', false), '');
  assert.equal(parseSeriesTitleText('# 主人公\nシリーズ名：呼応変異', false), '呼応変異');
  assert.equal(parseSeriesTitleText('```md\n# 偽の作品名\nシリーズ名：偽名\n```\n# シリーズ設定'), '');
  assert.equal(parseSeriesTitleText('~~~md\nシリーズ名：偽名\n~~~\nシリーズ名：呼応変異'), '呼応変異');
  assert.equal(parseSeriesTitleText('\uFEFF# シリーズ設定\r\n\r\n**シリーズ名**：**「呼応変異」**'), '呼応変異');
});

test('Markdownの見出しから舞台設定とあらすじを抽出する', () => {
  const result = parseSettingText(`# 新しい話

## 場所
海沿いの古い喫茶店

## 時間帯
夏の夕方

## 天候
雨

## あらすじ
閉店間際、主人公が十年前の手紙を見つける。
差出人を探すため店主へ話を聞く。`);
  assert.deepEqual(result, {
    location: '海沿いの古い喫茶店',
    time: '夏の夕方',
    weather: '雨',
    situation: '閉店間際、主人公が十年前の手紙を見つける。\n差出人を探すため店主へ話を聞く。',
  });
});

test('単純テキストの項目名と全角コロンを読み取る', () => {
  const result = parseSettingText('場所：放課後の教室\n時間帯：夕方\n天気：曇り\nあらすじ：二人が秘密を打ち明ける。');
  assert.deepEqual(result, {
    location: '放課後の教室',
    time: '夕方',
    weather: '曇り',
    situation: '二人が秘密を打ち明ける。',
  });
});

test('項目のない本文も最低限あらすじとして保持する', () => {
  const result = parseSettingText('\uFEFF主人公が雨宿り中に旧友と再会する。\r\n二人は失くした鍵を探しに行く。');
  assert.equal(result.location, '');
  assert.equal(result.time, '');
  assert.equal(result.weather, '');
  assert.equal(result.situation, '主人公が雨宿り中に旧友と再会する。\n二人は失くした鍵を探しに行く。');
});

test('あらすじ見出しがなくても読み込んだ内容を空にしない', () => {
  const result = parseSettingText('## 場所\n地下鉄のホーム\n## 天候\n大雨');
  assert.equal(result.location, '地下鉄のホーム');
  assert.equal(result.weather, '大雨');
  assert.ok(result.situation.includes('地下鉄のホーム'));
});

test('標準的なMarkdownから作品名・サブタイトル・話数と舞台設定をまとめて抽出する', () => {
  const result = parseStoryReferenceText(`# 呼応変異

## 基本情報
- サブタイトル：LLMこぼれ話
- 話数：第1.5話
- 場所：個人宅の自室
- 時間帯：夜
- 天候：不明（屋内）

## あらすじ
AIへの関心を深めた主人公が、その出力に振り回される。`);
  assert.deepEqual(result, {
    seriesTitle: '呼応変異',
    subtitle: 'LLMこぼれ話',
    episodeNumber: '第1.5話',
    setting: {
      location: '個人宅の自室',
      time: '夜',
      weather: '不明（屋内）',
      situation: 'AIへの関心を深めた主人公が、その出力に振り回される。',
    },
  });
});

test('旧形式の引用符付き見出しと空白区切りの設定も読み取る', () => {
  const result = parseStoryReferenceText(`# シリーズ「呼応変異」
## サブタイトル「LLMこぼれ話」
## 第1.5話

**場所**　個人宅の自室
**時間帯**　不明
**天候**　不明（屋内）

## あらすじ
主人公が戸惑う。`);
  assert.equal(result.seriesTitle, '呼応変異');
  assert.equal(result.subtitle, 'LLMこぼれ話');
  assert.equal(result.episodeNumber, '第1.5話');
  assert.equal(result.setting.location, '個人宅の自室');
  assert.equal(result.setting.time, '不明');
  assert.equal(result.setting.weather, '不明（屋内）');
  assert.equal(result.setting.situation, '主人公が戸惑う。');
});

test('シリーズ資料から作品分類と世界観を抽出する', () => {
  const result = parseSeriesSettingText(`# 呼応変異

## シリーズ共通
- ジャンル：SF・日常
- 対象読者：青年・一般
- 成人指定：あり
- 基本の場所：共同住宅
- 基本の時間帯：現代
- 基本の天候：晴れ

### 世界観
人と対話AIが同じ生活空間で暮らしている。`);
  assert.deepEqual(result, {
    location: '共同住宅',
    time: '現代',
    weather: '晴れ',
    situation: '人と対話AIが同じ生活空間で暮らしている。',
    genre: 'SF・日常',
    targetAudience: '青年・一般',
    adultContent: true,
  });
});

test('人物設定だけの文章をシリーズ共通舞台として誤読しない', () => {
  const result = parseSeriesSettingText(`# 登場人物設定

### ジプト
#### 人物像
目が体表に現れる不思議な生き物。

#### 装飾・固有マーク
- 焦点が合っている目`);
  assert.deepEqual(result, {
    location: '', time: '', weather: '', situation: '', genre: '', targetAudience: '', adultContent: false,
  });
});
