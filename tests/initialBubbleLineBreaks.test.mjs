import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { initialBubbleLineBreaks as wrap, initializeImportedBubbleLineBreaks } from '../src/lib/initialBubbleLineBreaks.ts';
import { parseMangaYaml, toStoredMangaYaml, newPage } from '../src/lib/manga.ts';
import { applyScenarioToNewDocument } from '../src/lib/scenario.ts';
import { emptyTestDocument } from './fixtures/emptyTestDocument.ts';

const box = { w: 30, h: 40 };
const phrase = '今日は図書館で新しい本を探します。';
function draft() {
  const doc = emptyTestDocument();
  doc.manga.pages = [newPage(1)];
  doc.manga.pages[0].panels[0].bubbles = [{ text: phrase, bbox: { x: 0, y: 0, ...box } }];
  return doc;
}

test('word-aware initial layout inserts only newlines at readable boundaries', () => {
  const result = wrap(phrase, box);
  assert.equal(result, '今日は\n図書館で\n新しい本を\n探します。');
  assert.equal(result.replaceAll('\n', ''), phrase);
  assert.equal(wrap(result, box), result);
});

test('existing author breaks, spacing conventions, short text and long prose remain unchanged', () => {
  for (const value of ['', 'え？', 'こんにちは', '明日は\n晴れるかな？', 'あ\r\nいうえお', 'あ\rいうえお', '前半　後半の文章', '前半\u00a0後半の文章', '前半\u2028後半の文章', '前半\t後半の文章', phrase.repeat(40)]) {
    assert.equal(wrap(value, box), value);
  }
});

test('particle boundaries take priority over equally sized but disconnected phrases', () => {
  assert.equal(wrap('私は友達と新しい映画を見ました。', { w: 30, h: 30 }),
    '私は\n友達と\n新しい映画を\n見ました。');
  assert.equal(wrap('花子は明日の予定を話した。', { w: 30, h: 90 }, ['花子']),
    '花子は明日の予定を\n話した。');
});

test('a narrow bubble may use fewer columns instead of forcing a very uneven split', () => {
  const text = 'これはオリエンテーションの資料です。';
  assert.equal(wrap(text, { w: 30, h: 90 }), text);
  const wider = wrap(text, { w: 60, h: 30 });
  assert.ok(wider.includes('\n'));
  assert.ok(wider.includes('オリエンテーション'));
  assert.equal(wider.replaceAll('\n', ''), text);
});

test('author scenario breaks survive matching against joined OCR and initial layout', () => {
  const doc = draft();
  const bubble = doc.manga.pages[0].panels[0].bubbles[0];
  const ocr = '明日は図書館で新しい本を探します。';
  bubble.text = ocr;
  const source = { version: 1, fileName: 'synthetic.md',
    text: '# シナリオ\n## page1\n### コマ1\n人物「明日は\n図書館で\n**新しい本**を探します。」' };
  assert.equal(applyScenarioToNewDocument(doc, source).matched, 1);
  initializeImportedBubbleLineBreaks(doc);
  assert.equal(bubble.text, '明日は\n図書館で\n新しい本を探します。');
  assert.equal(bubble.emphasis, '新しい本');
  assert.equal(bubble.scenarioMatch.ocrText, ocr);
  assert.deepEqual(doc.manga.scenario, source);
});

test('unmatched joined OCR gets editable breaks without changing review or lookup text', () => {
  const doc = draft();
  const bubble = doc.manga.pages[0].panels[0].bubbles[0];
  applyScenarioToNewDocument(doc, { version: 1, fileName: 'synthetic.md',
    text: '# シナリオ\n## page1\n### コマ1\n人物「ええっ？」' });
  const match = structuredClone(bubble.scenarioMatch);
  initializeImportedBubbleLineBreaks(doc);
  assert.ok(bubble.text.includes('\n'));
  assert.equal(bubble.text.replaceAll('\n', ''), phrase);
  assert.equal(bubble.scenarioMatch.status, 'review');
  assert.deepEqual(bubble.scenarioMatch, match);
});

test('URL, ASCII identifier, registered names, punctuation runs and graphemes are never split', () => {
  const protectedPieces = ['https://example.com/a/b', 'OpenAI', '田中花子', '……', '！？', '👨‍👩‍👧‍👦', 'か\u3099'];
  for (const piece of protectedPieces) {
    const value = `これは${piece}の話をしています。`;
    const result = wrap(value, box, ['田中花子']);
    assert.ok(result.includes(piece), result);
    assert.equal(result.replaceAll('\n', ''), value);
  }
  assert.equal(wrap('http://example.com/a/b', box), 'http://example.com/a/b');
});

test('kinsoku avoids isolated punctuation, closing brackets, small kana and opening brackets at the end', () => {
  for (const value of ['彼は「明日は晴れるかな？」と聞いた。', 'ちょっと待って！まだ話があるんだよ。', '長いお話……続きを聞かせて！？', '大きな（新しい図書館）の話です。']) {
    const lines = wrap(value, { w: 80, h: 30 }).split('\n');
    for (const line of lines.slice(1)) assert.doesNotMatch(line, /^[、。！？!?）」』）っゃゅょー]/u);
    for (const line of lines.slice(0, -1)) assert.doesNotMatch(line, /[「『（(]$/u);
    assert.equal(lines.join(''), value);
  }
});

test('vertical aspect ratio influences column count; invalid geometry uses a stable fallback', () => {
  assert.ok(wrap(phrase, { w: 60, h: 30 }).split('\n').length > wrap(phrase, { w: 10, h: 60 }).split('\n').length);
  for (const invalid of [{ w: 0, h: 10 }, { w: -1, h: 10 }, { w: NaN, h: 10 }, { w: 10, h: Infinity }]) assert.equal(wrap(phrase, invalid), wrap(phrase));
});

test('ICU kana fragments and unknown katakana names do not force unnatural line breaks', () => {
  for (const box of [{ w: 30, h: 40 }, { w: 80, h: 30 }]) {
    assert.ok(wrap('それはしなければならないことです。', box).includes('しなければならない'));
    assert.ok(wrap('田中さんに聞いてみてください。', box).includes('ください'));
    assert.ok(wrap('ナイアーラトテップの話をしています。', box).includes('ナイアーラトテップ'));
  }
});

test('unavailable native segmenter leaves text intact without requiring downloads', () => {
  const original = Intl.Segmenter;
  try { Intl.Segmenter = undefined; assert.equal(wrap(phrase, box), phrase); }
  finally { Intl.Segmenter = original; }
});

test('new import formats panel and overlay bubbles, not source, provenance, actions or screen text', () => {
  const doc = draft();
  const panel = doc.manga.pages[0].panels[0];
  panel.bubbles[0].analogTextImport = { ocrText: phrase, assetId: 'synthetic' };
  applyScenarioToNewDocument(doc, { version: 1, fileName: 'synthetic.md', text: `# シナリオ\n## page1\n### コマ1\n人物「**${phrase}**」` });
  doc.manga.pages[0].page_overlay = { frame: false, layer: 'above_panel_frames', bubbles: [{ text: phrase }] };
  const before = structuredClone(doc);
  initializeImportedBubbleLineBreaks(doc);
  assert.ok(panel.bubbles[0].text.includes('\n'));
  assert.ok(doc.manga.pages[0].page_overlay.bubbles[0].text.includes('\n'));
  const withoutTextChanges = structuredClone(doc);
  withoutTextChanges.manga.pages[0].panels[0].bubbles[0].text = before.manga.pages[0].panels[0].bubbles[0].text;
  withoutTextChanges.manga.pages[0].page_overlay.bubbles[0].text = phrase;
  assert.deepEqual(withoutTextChanges, before);
});

test('manual line edits survive stored-work reopening and horizontal drafts are untouched', () => {
  const doc = draft();
  initializeImportedBubbleLineBreaks(doc);
  doc.manga.pages[0].panels[0].bubbles[0].text = '明日は図書館へ\n行こうかな？';
  const reopened = parseMangaYaml(toStoredMangaYaml(doc));
  assert.equal(reopened.manga.pages[0].panels[0].bubbles[0].text, '明日は図書館へ\n行こうかな？');
  doc.manga.meta.text_orientation = 'horizontal';
  const before = structuredClone(doc);
  initializeImportedBubbleLineBreaks(doc);
  assert.deepEqual(doc, before);
});

test('production invocation exists only in createNewDocument, after scenario matching', () => {
  const src = new URL('../src/', import.meta.url);
  const users = readdirSync(src, { recursive: true }).filter(path => /\.(tsx?|astro)$/.test(path))
    .filter(path => path !== 'lib/initialBubbleLineBreaks.ts' && readFileSync(new URL(path, src), 'utf8').includes('initializeImportedBubbleLineBreaks('));
  assert.deepEqual(users, ['components/workspace/newProjectCreation.ts']);
  const app = readFileSync(new URL('components/workspace/newProjectCreation.ts', src), 'utf8');
  assert.equal(app.match(/initializeImportedBubbleLineBreaks\(/g).length, 1);
  const creation = app.slice(app.indexOf('const createNewDocument = async'));
  assert.ok(creation.indexOf('applyScenarioToNewDocument(') < creation.indexOf('initializeImportedBubbleLineBreaks('));
  assert.ok(creation.indexOf('initializeImportedBubbleLineBreaks(') < creation.indexOf('await commitNewCharacterDraft()'));
});
