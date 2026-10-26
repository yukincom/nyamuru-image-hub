import assert from 'node:assert/strict';
import test from 'node:test';
import { bubbleCssFontFamily, classifyPcFontFamilies, mergeBubbleFontFamilies, mergeFontFamilyCatalog, queryPcFontFamilies } from '../src/lib/bubbleFonts.ts';

test('PC内フォントは空白と重複を除き日本語順で共有候補にする', async () => {
  let calls=0;
  const target={queryLocalFonts:async()=>{calls++;return [{family:' Yu Gothic '},{family:'游明朝'},{family:'Yu Gothic'},{family:''}];}};
  const families=await queryPcFontFamilies(target);
  assert.equal(calls,1);
  assert.deepEqual(families,mergeBubbleFontFamilies(['Yu Gothic','游明朝']));
  assert.deepEqual(mergeBubbleFontFamilies(['既定','独自'],['独自','PC']),mergeBubbleFontFamilies(['既定','独自','PC']));
});

test('アンチック体は端末に導入済みのI-OTFアンチックを最優先する',()=>{
  assert.match(bubbleCssFontFamily('アンチック体'),/^"I-OTFアンチックStd B", "I-OTFアンチックStd", "Iwata Antic Std B", "Iwata Antic Std"/);
});

test('未対応ブラウザと拒否は明示エラーにして内蔵候補へフォールバックできる', async () => {
  await assert.rejects(queryPcFontFamilies({}),/対応していません/);
  const denied=Object.assign(new Error('denied'),{name:'NotAllowedError'});
  await assert.rejects(queryPcFontFamilies({queryLocalFonts:async()=>{throw denied;}}),error=>error===denied);
});

test('描画できる日本語と英数字の範囲でフォントを分類する', () => {
  const coverage={日本語:['あ','い','う','日本語','012abcABC'],Latin:['012abcABC'],記号:[]};
  const catalog=classifyPcFontFamilies(['記号','Latin','日本語'],(family,sample)=>coverage[family].includes(sample));
  assert.equal(catalog.find(font=>font.family==='日本語').support,'japanese');
  assert.equal(catalog.find(font=>font.family==='Latin').support,'other');
  assert.equal(catalog.find(font=>font.family==='記号').support,'unreadable');
  const merged=mergeFontFamilyCatalog(catalog,['選択中']);
  assert.equal(merged.find(font=>font.family==='アンチック体').support,'japanese');
  assert.equal(merged.find(font=>font.family==='選択中').support,'other');
  assert.equal(merged.filter(font=>font.family==='日本語').length,1);
});
