import assert from 'node:assert/strict';
import test from 'node:test';
import {readFontFaceMetadata} from '../src/lib/fontNames.ts';
import { availableFontWeights, matchingFontWeight, bubbleCssFontFamily, classifyPcFontFamilies, mergeBubbleFontFamilies, mergeFontFamilyCatalog, queryPcFontFamilies } from '../src/lib/bubbleFonts.ts';
const readJapaneseFontFamily=async(...args)=>(await readFontFaceMetadata(...args)).displayName;

test('PC内フォントは空白と重複を除き日本語順で共有候補にする', async () => {
  let calls=0;
  const target={queryLocalFonts:async()=>{calls++;return [{family:' Yu Gothic '},{family:'游明朝'},{family:'Yu Gothic'},{family:''}];}};
  const families=await queryPcFontFamilies(target);
  assert.equal(calls,1);
  assert.deepEqual(families,mergeBubbleFontFamilies(['Yu Gothic','游明朝']).map(family=>({family,displayName:family,weights:[]})));
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

function fontBlob(records,{tags=[],collection=false,weight,width=5,italic=false,variable}={}){
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
  const tables=[['name',table]];
  if(weight!==undefined){const metrics=Buffer.alloc(64);metrics.writeUInt16BE(weight,4);metrics.writeUInt16BE(width,6);metrics.writeUInt16BE(italic?1:0,62);tables.push(['OS/2',metrics]);}
  if(variable)tables.push(['fvar',variable]);
  const offset=collection?16:0,directoryEnd=offset+12+tables.length*16,font=Buffer.alloc(directoryEnd+tables.reduce((n,[,data])=>n+data.length,0)+8192);
  if(collection){font.write('ttcf');font.writeUInt32BE(0x00010000,4);font.writeUInt32BE(1,8);font.writeUInt32BE(offset,12);}
  font.writeUInt32BE(0x00010000,offset);font.writeUInt16BE(tables.length,offset+4);let dataOffset=directoryEnd;
  tables.forEach(([tag,data],i)=>{const at=offset+12+i*16;font.write(tag,at);font.writeUInt32BE(dataOffset,at+8);font.writeUInt32BE(data.length,at+12);data.copy(font,dataOffset);dataOffset+=data.length;});
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

test('日本語表示名をfamilyへまとめ、faceの取得失敗でも書体を残す',async()=>{
  const blob=fontBlob([{id:1,text:'Example'},{id:1,language:0x411,text:'例文'}]);let calls=0;
  const catalog=await queryPcFontFamilies({queryLocalFonts:async()=>[
    {family:'Example',blob:async()=>{calls++;return blob;}},
    {family:'Example',blob:async()=>{throw new Error('Unavailable face');}},
    {family:'Latin',blob:async()=>{throw new Error('Unavailable');}},
  ]});
  assert.equal(calls,1);
  assert.deepEqual(catalog,[{family:'Example',displayName:'例文',weights:[]},{family:'Latin',displayName:'Latin',weights:[]}]);
  const classified=classifyPcFontFamilies(catalog,()=>true),merged=mergeFontFamilyCatalog(classified);
  assert.equal(merged.find(font=>font.family==='Example').displayName,'例文');
  const ordered=merged.map(font=>font.displayName??font.family);
  assert.deepEqual(ordered,[...ordered].sort((a,b)=>a.localeCompare(b,'ja')));
  assert.equal(bubbleCssFontFamily(classified[0].family),'"Example", "Yu Mincho", serif');
});

test('W表記とOS/2の実値を全faceから取得し、斜体や異なる幅を混ぜない',async()=>{
  const face=(label,weight,options={})=>({family:'Example',blob:async()=>fontBlob([{id:16,text:'Example'},{id:1,text:`Example ${label}`},{id:2,text:'Regular'},{id:17,text:label}],{weight,...options})});
  const [font]=await queryPcFontFamilies({queryLocalFonts:async()=>[face('W9',900),face('W2',250),face('W8',800),face('W8 italic',800,{italic:true}),face('Condensed',700,{width:3})]});
  assert.deepEqual(font.weights,[{value:250,label:'W2'},{value:800,label:'W8'},{value:900,label:'W9'}]);
  const single=await readFontFaceMetadata(fontBlob([{id:1,text:'Single'},{id:2,text:'B'}],{weight:400}),'Single');
  assert.equal(single.weight,400);assert.equal(single.styleName,'B');
});

test('可変フォントは実際の命名インスタンスを取得し、別軸の変更は除く',async()=>{
  const variable=Buffer.alloc(16+40+3*12);variable.writeUInt16BE(1,0);variable.writeUInt16BE(16,4);variable.writeUInt16BE(2,8);variable.writeUInt16BE(20,10);variable.writeUInt16BE(3,12);variable.writeUInt16BE(12,14);
  [['wght',400],['wdth',100]].forEach(([tag,value],i)=>{const at=16+i*20;variable.write(tag,at);variable.writeInt32BE(value*65536,at+8);});
  [[256,250,100],[257,950,100],[258,700,75]].forEach(([id,weight,width],i)=>{const at=56+i*12;variable.writeUInt16BE(id,at);variable.writeInt32BE(weight*65536,at+4);variable.writeInt32BE(width*65536,at+8);});
  const blob=fontBlob([{id:16,text:'Variable'},{id:17,text:'Regular'},{id:256,text:'Light'},{id:257,language:0x411,text:'極太'},{id:258,text:'Condensed Bold'}],{weight:400,variable});
  const [font]=await queryPcFontFamilies({queryLocalFonts:async()=>[{family:'Variable',blob:async()=>blob}]});
  assert.deepEqual(font.weights,[{value:250,label:'Light'},{value:400,label:'Regular'},{value:950,label:'極太'}]);
});

test('太さ候補は書体・日本語表示名・既存プリセットの描画順に一致させる',()=>{
  const weights=[{value:300,label:'W3'},{value:600,label:'W6'}],single=[{value:400,label:'B'}];
  const catalog=[{family:'Iwata Antic Std',displayName:'I-OTFアンチックStd',weights:single},{family:'Hiragino Mincho ProN',displayName:'ヒラギノ明朝 ProN',weights}];
  assert.equal(availableFontWeights('アンチック体',catalog),single);
  assert.equal(availableFontWeights('明朝体',catalog),weights);
  assert.equal(availableFontWeights('ヒラギノ明朝 ProN',catalog),weights);
  assert.deepEqual(availableFontWeights('未取得',catalog),[]);
  assert.equal(matchingFontWeight(400,weights),300);
  assert.equal(matchingFontWeight(500,weights),300);
  assert.equal(matchingFontWeight(550,weights),600);
  assert.equal(matchingFontWeight(800,weights),600);
  assert.equal(matchingFontWeight(100,weights),300);
  assert.equal(matchingFontWeight(600,[]),undefined);
});
