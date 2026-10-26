import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stringify } from 'yaml';
import { CURRENT_NDM_SCHEMA_VERSION, MAX_PANELS_PER_PAGE, NDM_SCHEMA_NAME, newPanel, parseMangaYaml, toMangaYaml, toStoredMangaYaml, validateManga } from '../src/lib/manga.ts';
import { panelDisplayLabel } from '../src/lib/displayLabels.ts';
import { DETECTED_FIGURE_NAME } from '../src/lib/bubbleRelations.ts';
import {
  SYSTEM_MOB_CATALOG_ID,
  SYSTEM_MOB_DEFAULT_DESIGN,
  SYSTEM_MOB_NAME,
  SYSTEM_MOB_ROLE,
} from '../src/lib/systemCharacters.ts';

const sampleSource = readFileSync(new URL('../src/content/sample.omny.yaml', import.meta.url), 'utf8');

test('サンプルがNDMの正式なスキーマ名とバージョンを持つ', () => {
  const document = parseMangaYaml(sampleSource);
  assert.equal(document.manga.schema_name, NDM_SCHEMA_NAME);
  assert.equal(document.manga.schema_version, CURRENT_NDM_SCHEMA_VERSION);
});

test('サンプルはNDM検査でエラーを出さない', () => {
  const issues = validateManga(parseMangaYaml(sampleSource));
  assert.deepEqual(issues.filter((issue) => issue.level === 'error'), []);
});

test('シリーズ設定のない既存OMNYは空欄を補って読み込む', () => {
  const legacy = parseMangaYaml(sampleSource);
  delete legacy.manga.series_setting;
  legacy.manga.schema_version = 10.32;

  const restored = parseMangaYaml(stringify(legacy));

  assert.equal(restored.manga.schema_version, 10.32);
  assert.deepEqual(restored.manga.series_setting, {
    genre: '', target_audience: '', adult_content: false, situation: '', location: '', time: '', weather: '',
  });
  assert.equal(restored.manga.setting.location, 'ツクルの自室（作業机まわり）');
});

test('コマ番号は2桁表示にし、1ページ10コマまでは検査を通す', () => {
  assert.equal(panelDisplayLabel(1), 'コマ 01');
  assert.equal(panelDisplayLabel(10), 'コマ 10');
  const document = parseMangaYaml(sampleSource);
  document.manga.pages[0].panels = Array.from({ length: MAX_PANELS_PER_PAGE }, (_, index) => newPanel(index + 1));
  assert.ok(!validateManga(document).some((issue) => issue.path.endsWith('.panels')));
  document.manga.pages[0].panels.push(newPanel(MAX_PANELS_PER_PAGE + 1));
  assert.ok(validateManga(document).some((issue) => issue.path.endsWith('.panels') && issue.message.includes('最大10コマ')));
});

test('背景情報は自動保存と公開OMNYを往復し、空白と描写なしでは残さない', () => {
  const document = parseMangaYaml(sampleSource);
  const panel = document.manga.pages[0].panels[0];
  panel.bg = 1;
  panel.background_description = '  雨の窓と夕方の逆光  ';
  assert.equal(parseMangaYaml(toStoredMangaYaml(document)).manga.pages[0].panels[0].background_description, '雨の窓と夕方の逆光');
  assert.equal(parseMangaYaml(toMangaYaml(document)).manga.pages[0].panels[0].background_description, '雨の窓と夕方の逆光');
  panel.bg = -1;
  assert.equal(parseMangaYaml(toStoredMangaYaml(document)).manga.pages[0].panels[0].background_description, undefined);
});

test('舞台設定の背景要素と小道具は素材カタログへ集約する', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.setting.background = ['雨の駅前'];
  document.manga.setting.props = ['赤い傘'];

  const restored = parseMangaYaml(toStoredMangaYaml(document));
  assert.equal(restored.manga.setting.background, undefined);
  assert.equal(restored.manga.setting.props, undefined);
  const background = restored.manga.materials.find((material) => material.key === '雨の駅前');
  const prop = restored.manga.materials.find((material) => material.key === '赤い傘');
  assert.match(background.localId, /^material-/);
  assert.match(prop.localId, /^material-/);
  assert.deepEqual({ ...background, localId: undefined }, {
    key: '雨の駅前', type: 'background', scope: 'episode', keywords: ['雨の駅前'], note: '',
    localId: undefined,
  });
  assert.deepEqual({ ...prop, localId: undefined }, {
    key: '赤い傘', type: 'prop', scope: 'episode', keywords: ['赤い傘'], note: '',
    localId: undefined,
  });
});

test('区分のない素材はエピソード限定として読み込む', () => {
  const document = parseMangaYaml(sampleSource);
  delete document.manga.materials[0].scope;
  const restored = parseMangaYaml(toStoredMangaYaml(document));
  assert.equal(restored.manga.materials[0].scope, 'episode');
});

test('人物あたりは既存データでも人物台帳から外し、コマの仮配置だけを残す', () => {
  const source = parseMangaYaml(sampleSource);
  source.manga.characters.unshift({ localId: 'person-system', name: DETECTED_FIGURE_NAME, role: '仮配置', scope: 'episode' });
  source.manga.pages[0].panels[0].figures = [{
    name: DETECTED_FIGURE_NAME,
    refId: 'person-system',
    bbox: { x: 20, y: 20, w: 30, h: 50 },
    size: 'bust-up',
    role: 'main',
  }];
  const restored = parseMangaYaml(toStoredMangaYaml(source));
  assert.equal(restored.manga.characters.some((character) => character.name === DETECTED_FIGURE_NAME), false);
  assert.equal(restored.manga.pages[0].panels[0].figures[0].name, DETECTED_FIGURE_NAME);
  assert.equal(restored.manga.pages[0].panels[0].figures[0].refId, undefined);
  assert.equal(validateManga(restored).some((issue) => issue.message.includes(`人物「${DETECTED_FIGURE_NAME}」が characters にありません`)), false);
});

test('モブキャラは固定情報と既定デザインを持ち、編集可能項目を保ったままシリーズ人物の末尾に置く', () => {
  const document = parseMangaYaml(sampleSource);
  const initial = document.manga.characters.at(-1);
  assert.equal(initial.name, SYSTEM_MOB_NAME);
  assert.equal(initial.role, SYSTEM_MOB_ROLE);
  assert.equal(initial.scope, 'series');
  assert.equal(initial.catalog_id, SYSTEM_MOB_CATALOG_ID);
  assert.equal(initial.default_proportion.head_count, 6);
  assert.deepEqual(initial.recognition.silhouette.observed, [SYSTEM_MOB_DEFAULT_DESIGN]);

  initial.name = '書き換え不可';
  initial.role = '別用途';
  initial.scope = 'episode';
  initial.default_proportion = { head_count: 7 };
  initial.recognition.silhouette.observed = ['輪郭だけの群衆'];
  document.manga.characters.push({ name: '追加人物', role: '', scope: 'episode' });

  const restored = parseMangaYaml(toStoredMangaYaml(document));
  const mob = restored.manga.characters.at(-1);
  assert.equal(mob.name, SYSTEM_MOB_NAME);
  assert.equal(mob.role, SYSTEM_MOB_ROLE);
  assert.equal(mob.scope, 'series');
  assert.equal(mob.catalog_id, SYSTEM_MOB_CATALOG_ID);
  assert.equal(mob.default_proportion.head_count, 7);
  assert.deepEqual(mob.recognition.silhouette.observed, ['輪郭だけの群衆']);
  assert.equal(restored.manga.characters.filter((character) => character.catalog_id === SYSTEM_MOB_CATALOG_ID).length, 1);
});

test('文書種別のないOMNYはstoryとして読み込み、formatを文書種別に使った台帳も移行する', () => {
  const story = parseMangaYaml(sampleSource);
  delete story.manga.meta.document_type;
  const restoredStory = parseMangaYaml(stringify(story));
  assert.equal(restoredStory.manga.meta.document_type, 'story');

  delete story.manga.meta.document_type;
  story.manga.meta.format = 'series-catalog';
  story.manga.pages = [];
  story.manga.meta.page_count = 0;
  const restoredCatalog = parseMangaYaml(stringify(story));
  assert.equal(restoredCatalog.manga.meta.document_type, 'series-catalog');
  assert.equal(restoredCatalog.manga.meta.format, 'カラー漫画');
});

test('不完全または危険な人物画像参照は読み込み時に破棄し、検査を例外終了させない', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.materials[0].source_image = {
    schema_version: 1,
    asset_id: `image-${'a'.repeat(64)}`,
    file_name: 42,
    media_type: 'image/png', byte_size: 10, width_px: 1, height_px: 1, sha256: 'a'.repeat(64),
  };
  const restored = parseMangaYaml(stringify(document));
  assert.equal(restored.manga.materials[0].source_image, undefined);
  assert.doesNotThrow(() => validateManga(restored));
});

test('人物資料画像の保存先は対応するシリーズ人物の安定IDと一致させる', () => {
  const document = parseMangaYaml(sampleSource);
  const character = document.manga.characters[0];
  const material = document.manga.materials[0];
  character.scope = 'series';
  character.catalog_id = 'character-one';
  material.scope = 'series';
  material.character_catalog_id = 'character-one';
  material.source_image = {
    schema_version: 1,
    asset_id: `image-${'a'.repeat(64)}`,
    file_name: `characters/character-other/image-${'a'.repeat(64)}.png`,
    media_type: 'image/png', byte_size: 10, width_px: 1, height_px: 1, sha256: 'a'.repeat(64),
  };

  const issues = validateManga(document);
  assert.ok(issues.some((issue) => issue.path.endsWith('source_image.file_name') && issue.message.includes('安定ID')));
});

test('人物切り抜きへのローカル参照は自動保存だけに保持し、OMNYへ出さない', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.pages[0].panels[0].figures[0].analogImport = {
    schemaVersion: 1,
    sourceRegionId: 'scan:figure-001',
    assetId: 'analog-figure:scan:figure-001',
    sourceBBox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    detectionSource: 'body',
    draft: true,
    analysisReview: 'low-confidence',
    analysisReviewMessage: '人物を確定できませんでした',
    persistentAsset: {
      schemaVersion: 1,
      workKey: 'episode-123',
      kind: 'figures',
      fileName: 'figure-0123456789abcdef01234567.png',
    },
  };

  const stored = toStoredMangaYaml(document);
  const exported = toMangaYaml(document);
  assert.match(stored, /analogImport:/);
  assert.match(stored, /analog-figure:scan:figure-001/);
  assert.match(stored, /persistentAsset:/);
  assert.match(stored, /analysisReview: "low-confidence"/);
  assert.doesNotMatch(exported, /analogImport:/);
  assert.doesNotMatch(exported, /analog-figure:/);
  assert.doesNotMatch(exported, /persistentAsset:/);
  const restoredImport = parseMangaYaml(stored).manga.pages[0].panels[0].figures[0].analogImport;
  assert.equal(restoredImport.draft, true);
  assert.equal(restoredImport.analysisReview, 'low-confidence');
  assert.equal(restoredImport.analysisReviewMessage, '人物を確定できませんでした');
});

test('原字参照はローカル保存だけに保持し、作品基本書体・線幅・しっぽ・本文位置はOMNYへ出す', () => {
  const document = parseMangaYaml(sampleSource);
  const panel = document.manga.pages[0].panels[0];
  document.manga.meta.font = 'BIZ UDP明朝';
  document.manga.meta.bubble_line_width_mm = 0.4;
  panel.bubbles[0].monologue = true;
  panel.bubbles[0].tail = { x: 0.25, y: 0.6 };
  panel.bubbles[0].tail_root = { x: 0.1, y: 0.5 };
  panel.bubbles[0].tail_style = 'thinking';
  panel.bubbles[0].text_position = { x: 0.75, y: 0.4 };
  panel.bubbles[1].offscreen = true;
  panel.bubbles[0].analogTextImport = {
    schemaVersion: 1,
    sourceRegionId: 'scan:text-001',
    assetId: 'analog-text:scan:text-001',
    sourceBBox: { x: 0.2, y: 0.1, w: 0.1, h: 0.2 },
    detectionSource: 'rtdetr-text',
    recognitionEngine: 'Baberu OCR',
    needsReview: true,
    levelAdjusted: true,
  };

  const stored = toStoredMangaYaml(document);
  const exported = toMangaYaml(document);
  assert.match(stored, /analogTextImport:/);
  assert.doesNotMatch(exported, /analogTextImport:/);
  assert.match(exported, /font: "?BIZ UDP明朝"?/);
  assert.match(exported, /bubble_line_width_mm: 0.4/);
  assert.match(exported, /monologue: true/);
  assert.match(exported, /tail:\n\s+x: 0.25\n\s+y: 0.6/);
  assert.match(exported, /tail_root:\n\s+x: 0.1\n\s+y: 0.5/);
  assert.match(exported, /tail_style: "thinking"/);
  assert.match(exported, /text_position:\n\s+x: 0.75\n\s+y: 0.4/);
  assert.match(exported, /offscreen: true/);
});

test('しっぽ種別はnormalまたはthinkingだけを許可する',()=>{
  const document=parseMangaYaml(sampleSource),bubble=document.manga.pages[0].panels[0].bubbles[0];
  for(const style of ['normal','thinking']){bubble.tail_style=style;assert.ok(!validateManga(document).some(issue=>issue.path.endsWith('.tail_style')));}
  bubble.tail_style='beads';assert.ok(validateManga(document).some(issue=>issue.level==='error'&&issue.path.endsWith('.tail_style')));
});

test('しっぽ根元は参照枠外も許可し非有限座標だけを拒否する',()=>{
  const document=parseMangaYaml(sampleSource),bubble=document.manga.pages[0].panels[0].bubbles[0];
  bubble.tail_root={x:0,y:1};assert.ok(!validateManga(document).some(issue=>issue.path.endsWith('.tail_root')));
  for(const root of [{x:-.1,y:.5},{x:1.1,y:.5}]){bubble.tail_root=root;assert.ok(!validateManga(document).some(issue=>issue.path.endsWith('.tail_root')));}
  for(const root of [{x:NaN,y:.5},{x:.5,y:Infinity}]){
    bubble.tail_root=root;assert.ok(validateManga(document).some(issue=>issue.level==='error'&&issue.path.endsWith('.tail_root')));
  }
});

test('フキダシ本文位置は枠内の有限相対座標だけを許可する',()=>{
  const document=parseMangaYaml(sampleSource),bubble=document.manga.pages[0].panels[0].bubbles[0];
  bubble.text_position={x:0,y:1};assert.ok(!validateManga(document).some(issue=>issue.path.endsWith('.text_position')));
  for(const position of [{x:-.1,y:.5},{x:1.1,y:.5},{x:NaN,y:.5},{x:.5,y:Infinity}]){
    bubble.text_position=position;assert.ok(validateManga(document).some(issue=>issue.level==='error'&&issue.path.endsWith('.text_position')));
  }
});

test('コマ分割の重複確認情報は自動保存だけに保持し、OMNYへ出さない', () => {
  const document = parseMangaYaml(sampleSource);
  const panel = document.manga.pages[0].panels[0];
  panel.figures[0].splitOverlap = true;
  panel.figures[0].splitOverlapId = 'split-test-figure';
  panel.bubbles[0].splitOverlap = true;
  panel.bubbles[0].splitOverlapId = 'split-test-bubble';

  const stored = toStoredMangaYaml(document);
  const exported = toMangaYaml(document);
  assert.match(stored, /splitOverlap/);
  assert.doesNotMatch(exported, /splitOverlap/);
});

test('旧コマ別書体を読み込み時に廃止し、作品基本書体だけを使う', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.meta.font = 'Noto Serif JP';
  document.manga.pages[0].panels[0].font = 'BIZ UDPゴシック';

  const restored = parseMangaYaml(toStoredMangaYaml(document));
  assert.equal(restored.manga.meta.font, 'Noto Serif JP');
  assert.equal(restored.manga.pages[0].panels[0].font, undefined);
});

test('コマIDは読み順から自動採番し、重複と飛び番を保持しない', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.pages[0].panels.forEach((panel) => { panel.id = 9; });

  const restored = parseMangaYaml(toStoredMangaYaml(document));
  assert.deepEqual(restored.manga.pages[0].panels.map((panel) => panel.id), [1, 2, 3, 4]);
});

test('ページ前景はOMNYへ保持し、ローカル切り抜き参照だけを除く', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.pages[0].page_overlay = {
    frame: false,
    layer: 'above_panel_frames',
    figures: [{
      name: document.manga.characters[0].name,
      bbox: { x: 45, y: 30, w: 120, h: 220 },
      size: 'full',
      analogImport: {
        schemaVersion: 1,
        sourceRegionId: 'scan:page-overlay-figure',
        assetId: 'analog-figure:page-overlay',
        sourceBBox: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 },
        detectionSource: 'body',
        draft: true,
      },
    }],
    bubbles: [{ text: 'ページをまたぐ声', shape: 'normal', bbox: { x: 160, y: 20, w: 35, h: 60 } }],
  };

  const stored = toStoredMangaYaml(document);
  const exported = toMangaYaml(document);
  assert.match(stored, /page_overlay:/);
  assert.match(stored, /analogImport:/);
  assert.match(exported, /page_overlay:/);
  assert.match(exported, /layer: "?above_panel_frames"?/);
  assert.match(exported, /frame: false/);
  assert.doesNotMatch(exported, /analogImport:/);
  assert.ok(!validateManga(document).some((issue) => issue.level === 'error' && issue.path.includes('page_overlay')));
});

test('新規フキダシは形だけを持ち、話者とアンカーは未指定で作る', () => {
  const bubble = newPanel(1).bubbles[0];
  assert.equal(bubble.shape, 'normal');
  assert.equal(bubble.speaker, undefined);
  assert.equal(bubble.anchor, undefined);
});

test('フキダシのアンカーは編集用保存に残し、生成用OMNYからは除く', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.pages[0].panels[0].bubbles[0].anchor = 'top-right';
  const stored = parseMangaYaml(toStoredMangaYaml(document));
  const exported = parseMangaYaml(toMangaYaml(document));
  assert.equal(stored.manga.pages[0].panels[0].bubbles[0].anchor, 'top-right');
  assert.equal(exported.manga.pages[0].panels[0].bubbles[0].anchor, undefined);
});

test('読み込んだ声の演出は現行データから除く', () => {
  const source = parseMangaYaml(sampleSource);
  source.manga.pages[0].panels[0].bubbles[0].delivery = '緊張';
  const document = parseMangaYaml(stringify(source));
  assert.equal(document.manga.pages[0].panels[0].bubbles[0].delivery, undefined);
});

test('人物の描写範囲と役割が未指定ならバストアップ・メインを補完する', () => {
  const source = parseMangaYaml(sampleSource);
  const figure = source.manga.pages[0].panels[0].figures[0];
  delete figure.size;
  delete figure.role;
  const document = parseMangaYaml(stringify(source));
  assert.equal(document.manga.pages[0].panels[0].figures[0].size, 'bust-up');
  assert.equal(document.manga.pages[0].panels[0].figures[0].role, 'main');
});

test('作品既定の書体はアンチック体以外も指定できる', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.meta.font = 'Noto Serif JP';
  assert.ok(!validateManga(document).some((issue) => issue.path === 'manga.meta.font'));
});

test('bleed辺が紙端座標と一致しない場合はエラーになる', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.pages[0].panels[0].bleed = ['left']; // x:10 のコマなので左端に達していない
  const issues = validateManga(document);
  assert.ok(issues.some((issue) => issue.level === 'error' && issue.path.endsWith('.bleed')));
});

test('上タチキリ（bleed: top）は y: 0 のコマでのみ宣言できる', () => {
  const document = parseMangaYaml(sampleSource);
  const panel = document.manga.pages[0].panels[0];
  panel.bleed = ['top']; // y:10 のコマなので上端に達していない
  assert.ok(validateManga(document).some((issue) => issue.level === 'error' && issue.path.endsWith('.bleed')));
  panel.shape = { ...panel.shape, y: 0, h: 90 };
  assert.ok(!validateManga(document).some((issue) => issue.level === 'error' && issue.path.endsWith('.bleed')));
});

test('無人コマ宣言（no_figures）と figures の併用はエラーになる', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.pages[0].panels[0].no_figures = true; // figures があるコマ
  const issues = validateManga(document);
  assert.ok(issues.some((issue) => issue.level === 'error' && issue.path.endsWith('.no_figures')));
});

test('object: true の figure は物の配置として警告を出さない', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.pages[0].panels[0].figures.push({ name: 'ノートPC', object: true, bbox: { x: 120, y: 60, w: 30, h: 20 } });
  const issues = validateManga(document);
  assert.ok(!issues.some((issue) => issue.path.includes('.figures[1]')));
});

test('materials の物に一致する figure に object が無ければ付け忘れを提案する', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.pages[0].panels[0].figures.push({ name: 'ノートPC', bbox: { x: 120, y: 60, w: 30, h: 20 } });
  const issues = validateManga(document);
  assert.ok(issues.some((issue) => issue.level === 'warning' && issue.path.endsWith('.figures[1].object')));
});

test('無人コマ宣言（no_figures）でも物（object: true）の figure は書ける', () => {
  const document = parseMangaYaml(sampleSource);
  const panel = document.manga.pages[0].panels[0];
  panel.figures = [{ name: 'ノートPC', object: true, bbox: { x: 120, y: 60, w: 30, h: 20 } }];
  panel.no_figures = true;
  const issues = validateManga(document);
  assert.ok(!issues.some((issue) => issue.level === 'error' && issue.path.endsWith('.no_figures')));
});

test('コマ内にいる話者への offscreen は警告になる', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.pages[0].panels[0].bubbles[1].offscreen = true; // 話者ツクルは figures にいる
  const issues = validateManga(document);
  assert.ok(issues.some((issue) => issue.level === 'warning' && issue.path.endsWith('.offscreen')));
});

test('しっぽ先端は人物枠外の有限座標を許可し、不正値だけを拒否する', () => {
  const document = parseMangaYaml(sampleSource);
  document.manga.pages[0].panels[0].bubbles[0].tail = { x: 1.2, y: -0.1 };
  assert.ok(!validateManga(document).some((issue) => issue.level === 'error' && issue.path.endsWith('.tail')));
  for (const tail of [null, 'invalid', { x: '1', y: 0 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }]) {
    document.manga.pages[0].panels[0].bubbles[0].tail = tail;
    assert.ok(validateManga(document).some((issue) => issue.level === 'error' && issue.path.endsWith('.tail')));
  }
});

test('サンプルは作者名を持ち、フッター規則がstyle_notesとlayout_specに揃っている', () => {
  const document = parseMangaYaml(sampleSource);
  assert.match(document.manga.meta.author, /sa-san10/);
  assert.ok(document.manga.meta.style_notes.some((note) => note.includes('meta.author')));
  assert.ok(document.manga.layout_spec.includes('ページヘッダー・フッター'));
});

test('author の無い旧データには空文字を自動補完する', () => {
  const legacySource = sampleSource.replace(/^ {4}author: .*\n/m, '');
  const document = parseMangaYaml(legacySource);
  assert.equal(document.manga.meta.author, '');
});

test('旧データにNDMのスキーマ名を自動補完する', () => {
  const legacySource = sampleSource.replace(`  schema_name: "${NDM_SCHEMA_NAME}"\n`, '');
  const document = parseMangaYaml(legacySource);
  assert.equal(document.manga.schema_name, NDM_SCHEMA_NAME);
});

test('旧OMNYスキーマ名をNDMの正式名へ移行する', () => {
  const source = sampleSource.replace(
    `schema_name: "${NDM_SCHEMA_NAME}"`,
    'schema_name: "Open Manga Name YAML"',
  );
  const document = parseMangaYaml(source);
  assert.equal(document.manga.schema_name, NDM_SCHEMA_NAME);
});

test('異なるスキーマ名をNDM検査で拒否する', () => {
  const source = sampleSource.replace(
    `schema_name: "${NDM_SCHEMA_NAME}"`,
    'schema_name: "Another Manga Format"',
  );
  const issues = validateManga(parseMangaYaml(source));
  assert.ok(issues.some((issue) => issue.level === 'error' && issue.path === 'manga.schema_name'));
});
