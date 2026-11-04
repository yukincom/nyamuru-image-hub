// 見込み: 固定MIT版をコピーし、公開範囲だけ広げれば元encoderの機能を保てる。
// 合格条件: 全同梱fileが出典hashと一致（明示した5宣言を戻した状態）。実CLIP/CSPは別検証。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { clipExportSources, pageExportStem } from '../src/lib/pageExport.ts';

// 見込み/合格/範囲は冒頭のとおり。元コードへの思わぬ機能変更を検知する。
test('vendored MIT source differs only in the five integration visibility declarations', async()=>{
  const base=new URL('../scripts/clip-export/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('UPSTREAM.json',base),'utf8'));
  let count=0;
  for(const [repository,upstream] of Object.entries(manifest)){
    assert.equal(upstream.license,'MIT');
    for(const [path,expected] of Object.entries(upstream.files)){
      let bytes=await readFile(new URL(`vendor/${repository}/${path}`,base));
      if(repository==='name-studio'){
        let value=bytes.toString('utf8');
        if(path==='crates/clip-core/src/write/mod.rs')value=value.replace('pub mod layers;','pub(crate) mod layers;');
        if(path==='crates/clip-core/src/write/layers.rs')value=value.replace('pub fn set_layer_mask(','pub(crate) fn set_layer_mask(');
        if(path==='crates/clip-core/src/write/raster_page.rs')for(const name of ['prepare_for','add_text_layer','add_vector_layer'])value=value.replace(`pub fn ${name}(`,`pub(crate) fn ${name}(`);
        if(path.endsWith('.rs'))bytes=Buffer.from(value);
      }
      assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,`${repository}/${path}`);count++;
    }
  }
  assert.ok(count>150);
});

// 見込み: 題名だけを短縮すればページ番号と拡張子が切れない。
// 合格: 長い日本語題名でも2ページのCLIP/元データ名がすべて別、各path要素は255bytes以内。
// 範囲: 書出名とZIP項目。同名OS保存の挙動はpageExport/browserで別確認。
test('long titles keep distinct page names and original file extensions',()=>{
  const entries=[1,2].flatMap(page=>{
    const stem=pageExportStem('長い作品の名前'.repeat(30),page,{width_mm:210,height_mm:297,dpi:600});
    const payload={profile:'nyamuru-clip-v1',width:1,height:1,dpi:600,title:'題名',page,warnings:[],layers:[{kind:'raster',id:'source',name:'画像',visible:true,locked:false,opacity:1,blend:'normal',png:'',x:0,y:0,sources:[{kind:'svg',name:'長い原画名'.repeat(30)+'.svg',data:'<svg/>',mediaType:'image/svg+xml'}]}]};
    const sources=clipExportSources(payload,stem).entries;assert.ok(sources[0].name.endsWith('.svg'));
    return [stem+'.clip',...sources.map(entry=>entry.name)];
  });
  assert.equal(new Set(entries).size,entries.length);
  assert.ok(entries.every(name=>name.split('/').every(part=>Buffer.byteLength(part)<=255)));
});

// 見込み: native書出と別添元データを分けてもレイヤーとの対応と元bytesが失われない。
// 合格: 名前衝突を避けSVG/画像/本文を保存し、元payloadと非表示層を変えない。範囲: 純粋な包装処理。
test('source package preserves original bytes and layer mapping without mutating the page',()=>{
  const common={visible:true,locked:false,opacity:1,blend:'normal'};
  const page={profile:'nyamuru-clip-v1',width:10,height:20,dpi:300,title:'確認',page:1,warnings:['ブラシを表示用と編集用に分割'],layers:[
    {...common,kind:'folder',id:'folder',name:'親',children:[
      {...common,kind:'raster',id:'image',name:'画像',visible:false,png:'data:image/png;base64,AQIDBA==',x:2,y:3,sources:[{kind:'original-image',name:'../../元.png',data:'data:image/png;base64,AQIDBA==',mediaType:'image/png'}]},
      {...common,kind:'vector',id:'vector',name:'線',lines:[],sources:[{kind:'svg',name:'元.svg',data:'<svg>日本語</svg>',mediaType:'image/svg+xml'}]},
      {...common,kind:'text',id:'text',name:'文字',text:'本文',frame:[0,0,5,10],fontSizePt:12,vertical:true,color:[17,17,17],sources:[{kind:'nyamuru-text',name:'元.svg',data:'{"text":"本文"}',mediaType:'application/json'}]},
    ]},
  ]};
  const before=structuredClone(page),{payload,entries}=clipExportSources(page,'page-001');
  assert.deepEqual(page,before);assert.equal(payload.layers[0].children[0].visible,false);
  assert.equal(payload.layers[0].children[0].sources,undefined);
  assert.deepEqual([...entries[0].bytes],[1,2,3,4]);
  assert.equal(new TextDecoder().decode(entries[1].bytes),'<svg>日本語</svg>');
  assert.equal(new Set(entries.map(e=>e.name)).size,entries.length);
  assert.ok(entries.every(e=>!e.name.includes('/../')));
  const map=JSON.parse(new TextDecoder().decode(entries.find(e=>e.name.endsWith('/layers.json')).bytes));
  assert.equal(map.layers.find(layer=>layer.id==='image').sources[0].file,entries[0].name);
  assert.deepEqual(map.warnings,page.warnings);
});
