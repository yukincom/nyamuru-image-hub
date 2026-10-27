import assert from 'node:assert/strict';
import test from 'node:test';
import {readJapaneseFontFamily} from '../src/lib/fontNames.ts';
import { bubbleCssFontFamily, classifyPcFontFamilies, mergeBubbleFontFamilies, mergeFontFamilyCatalog, queryPcFontFamilies } from '../src/lib/bubbleFonts.ts';

test('PC内フォントは空白と重複を除き日本語順で共有候補にする', async () => {
  let calls=0;
  const target={queryLocalFonts:async()=>{calls++;return [{family:' Yu Gothic '},{family:'游明朝'},{family:'Yu Gothic'},{family:''}];}};
  const families=await queryPcFontFamilies(target);
  assert.equal(calls,1);
  assert.deepEqual(families,mergeBubbleFontFamilies(['Yu Gothic','游明朝']).map(family=>({family,displayName:family})));
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
  const catalog=classifyPcFontFamilies(['記号','Latin','日本語'].map(family=>({family})),(family,sample)=>coverage[family].includes(sample));
  assert.equal(catalog.find(font=>font.family==='日本語').support,'japanese');
  assert.equal(catalog.find(font=>font.family==='Latin').support,'other');
  assert.equal(catalog.find(font=>font.family==='記号').support,'unreadable');
  const merged=mergeFontFamilyCatalog(catalog,['選択中']);
  assert.equal(merged.find(font=>font.family==='アンチック体').support,'japanese');
  assert.equal(merged.find(font=>font.family==='選択中').support,'other');
  assert.equal(merged.filter(font=>font.family==='日本語').length,1);
});

function fontBlob(records,{tags=[],collection=false}={}){
  const encoded=records.map(record=>record.bytes??Buffer.from(record.text,'utf16le').swap16());
  const tagBytes=tags.map(tag=>Buffer.from(tag,'utf16le').swap16());
  const storage=6+records.length*12+(tags.length?2+tags.length*4:0),table=Buffer.alloc(storage+encoded.reduce((n,b)=>n+b.length,0)+tagBytes.reduce((n,b)=>n+b.length,0));
  table.writeUInt16BE(tags.length?1:0,0);table.writeUInt16BE(records.length,2);table.writeUInt16BE(storage,4);
  let stringOffset=0;
  records.forEach((record,i)=>{
    const values=[record.platform??3,record.encoding??1,record.language??0x409,record.id,encoded[i].length,stringOffset];
    values.forEach((value,j)=>table.writeUInt16BE(value,6+i*12+j*2));encoded[i].copy(table,storage+stringOffset);stringOffset+=encoded[i].length;
  });
  if(tags.length){const start=6+records.length*12;table.writeUInt16BE(tags.length,start);tagBytes.forEach((bytes,i)=>{table.writeUInt16BE(bytes.length,start+2+i*4);table.writeUInt16BE(stringOffset,start+4+i*4);bytes.copy(table,storage+stringOffset);stringOffset+=bytes.length;});}
  const offset=collection?16:0,font=Buffer.alloc(offset+28+table.length+8192);
  if(collection){font.write('ttcf');font.writeUInt32BE(0x00010000,4);font.writeUInt32BE(1,8);font.writeUInt32BE(offset,12);}
  font.writeUInt32BE(0x00010000,offset);font.writeUInt16BE(1,offset+4);font.write('name',offset+12);font.writeUInt32BE(offset+28,offset+20);font.writeUInt32BE(table.length,offset+24);table.copy(font,offset+28);
  return new Blob([font]);
}

test('日本語ファミリー名を読み、拡張ファミリーと太さ別ファミリーを混ぜない',async()=>{
  const blob=fontBlob([{id:1,text:'Example Heavy'},{id:1,language:0x411,text:'例文 特太'},{id:16,text:'Example'},{id:16,language:0x411,text:'例文'},{id:4,language:0x411,text:'例文 特太斜体'}]);
  assert.equal(await readJapaneseFontFamily(blob,'Example Heavy'),'例文 特太');
  assert.equal(await readJapaneseFontFamily(blob,'Example'),'例文');
});

test('Mac日本語とBCP47の日本語名称を読み、別言語は日本語名として使わない',async()=>{
  const mac=fontBlob([{id:1,text:'Example'},{id:1,platform:1,encoding:1,language:11,bytes:Buffer.from([0x83,0x53,0x83,0x56,0x83,0x62,0x83,0x4e])}]);
  assert.equal(await readJapaneseFontFamily(mac,'Example'),'ゴシック');
  const tagged=fontBlob([{id:1,text:'Example'},{id:1,platform:0,encoding:4,language:0x8000,text:'別言語'},{id:1,platform:0,encoding:4,language:0x8001,text:'日本語の名前'}],{tags:['zh-Hant','ja-JP']});
  assert.equal(await readJapaneseFontFamily(tagged,'Example'),'日本語の名前');
  assert.equal(await readJapaneseFontFamily(fontBlob([{id:1,language:0x404,text:'例文'}]),'Example'),undefined);
});

test('コレクションは対象faceだけを使い、字形データの全体展開をしない',async()=>{
  const blob=fontBlob([{id:1,text:'Example'},{id:1,language:0x411,text:'例文'},{id:6,text:'Example-Regular'}],{collection:true});
  let bytesRead=0;
  const sliced={size:blob.size,slice:(start,end)=>{bytesRead+=end-start;return blob.slice(start,end);}};
  assert.equal(await readJapaneseFontFamily(sliced,'Example','Example-Regular'),'例文');
  assert.ok(bytesRead<=blob.size-8192);
  assert.equal(await readJapaneseFontFamily(blob,'Example','Other-Regular'),undefined);
  assert.equal(await readJapaneseFontFamily(new Blob([new Uint8Array(4)]),'Example'),undefined);
});

test('日本語表示名を同じfamilyへ一度だけ取得し、取得失敗した書体も残す',async()=>{
  const blob=fontBlob([{id:1,text:'Example'},{id:1,language:0x411,text:'例文'}]);let calls=0;
  const catalog=await queryPcFontFamilies({queryLocalFonts:async()=>[
    {family:'Example',blob:async()=>{calls++;return blob;}},
    {family:'Example',blob:async()=>{throw new Error('Duplicate face should not be read');}},
    {family:'Latin',blob:async()=>{throw new Error('Unavailable');}},
  ]});
  assert.equal(calls,1);
  assert.deepEqual(catalog,[{family:'Example',displayName:'例文'},{family:'Latin',displayName:'Latin'}]);
  const classified=classifyPcFontFamilies(catalog,()=>true),merged=mergeFontFamilyCatalog(classified);
  assert.equal(merged.find(font=>font.family==='Example').displayName,'例文');
  const ordered=merged.map(font=>font.displayName??font.family);
  assert.deepEqual(ordered,[...ordered].sort((a,b)=>a.localeCompare(b,'ja')));
  assert.equal(bubbleCssFontFamily(classified[0].family),'"Example", "Yu Mincho", serif');
});
