// 見込み: mm・crop・曲線・文字書式を元の編集座標からCLIP座標へ一度だけ変換する。
// 範囲: 実変換関数の数値・不変性。実画素・ブラウザー字体はclipExportAdapter.browser.tsx、CLIP読込は親側の試験。
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipExportPoint, clipExportVectorLines, clipExportPlacementFrame, clipExportTextStyle, clipExportFont, clipExportLocalFonts } from '../src/lib/clipExport.ts';
import { defaultVectorStyle } from '../src/lib/vectorGeometry.ts';

// 見込み: 元paintの解像度が用紙と異なっても、配置枠を介して位置を保持する。
// 合格: 原点・端点が指定の出力pixelへ一致。範囲: 座標だけで、実CSP表示は含まない。
test('paint pixels map through their placement frame, independently of source dpi',()=>{
  const paint={width:100,height:50},frame={x:10,y:20,w:40,h:30},page={w:100,h:100},output={width:1000,height:2000};
  assert.deepEqual(clipExportPoint({x:0,y:0},paint,frame,page,output),[100,400]);
  assert.deepEqual(clipExportPoint({x:100,y:50},paint,frame,page,output),[500,1000]);
});

// 見込み: contain表示の余白とcrop外の元paint位置を分離する。
// 合格: 指定cropが枠中央に入り、全paintの原点はcrop分だけ左上へ戻る。範囲: 配置計算。
test('cropped placement retains full paint coordinates behind its mask',()=>{
  const image={crop:{x:10,y:20,w:40,h:20}},box={x:5,y:8,w:80,h:60};
  assert.deepEqual(clipExportPlacementFrame(image,box,{width:100,height:100}),{
    crop:{x:5,y:18,w:80,h:40},frame:{x:-15,y:-22,w:200,h:200},
  });
});

// 見込み: 曲線を細分化して編集線を残し、元handleは変更しない。
// 合格: 始終点・頂点近傍・閉路・線幅/色を保持し一点線もwriterへ渡せる。範囲: 数学変換。
test('cubic curves, closed lines, single points and color mode remain editable',()=>{
  const paths=[{id:'curve',closed:false,style:{...defaultVectorStyle(),stroke:'#ff0000',width:2},nodes:[{x:0,y:0,handleOut:{x:0,y:10}},{x:10,y:0,handleIn:{x:0,y:10}}]},
    {id:'point',closed:false,style:defaultVectorStyle(),nodes:[{x:3,y:4}]},
    {id:'closed',closed:true,style:defaultVectorStyle(),nodes:[{x:0,y:0},{x:10,y:0},{x:10,y:10}]}];
  const before=JSON.stringify(paths),lines=clipExportVectorLines(paths,{width:10,height:10},{x:1,y:2,w:10,h:10},{w:20,h:20},{width:200,height:200});
  assert.deepEqual(lines[0].points[0],[10,20,1]);assert.deepEqual(lines[0].points.at(-1),[110,20,1]);
  assert.ok(lines[0].points.length>8);assert.ok(lines[0].points.some(p=>Math.abs(p[1]-95)<.01));
  assert.equal(lines[0].widthPx,20);assert.deepEqual(lines[0].color,[255,0,0]);
  assert.deepEqual(lines[1].points,[[40,60,1],[40,60,1]]);
  assert.equal(lines[2].closed,true);assert.deepEqual(lines[2].points[0],lines[2].points.at(-1));
  assert.equal(JSON.stringify(paths),before);
  const gray=clipExportVectorLines(paths.slice(0,1),{width:10,height:10},{x:0,y:0,w:10,h:10},{w:10,h:10},{width:10,height:10},'grayscale')[0].color;
  assert.equal(gray[0],gray[1]);assert.equal(gray[1],gray[2]);
});

// 見込み: 印刷pt・縦書き・部分書式を別々に渡せば編集文字を保持できる。
// 合格: 明示styleとUTF-16範囲が一致し、返値編集で原稿の範囲が変わらない。範囲: metadata。
test('text uses printed points and detaches inline ranges without changing content',()=>{
  const bubble={text:'A😀B',text_style:{fontSize:18,orientation:'horizontal',font:'明朝体',fontWeight:500,italic:true,textAlign:'right',lineHeight:1.4},text_runs:[{start:1,end:3,fontWeight:800}]};
  const result=clipExportTextStyle(bubble,'bubble','ゴシック体');
  assert.equal(result.fontSizePt,18);assert.equal(result.vertical,false);assert.equal(result.lineSpacing,140);assert.equal(result.fontFamily,'明朝体');
  assert.equal(result.fontWeight,500);assert.equal(result.italic,true);assert.equal(result.textAlign,'right');
  assert.deepEqual(result.styleRuns,bubble.text_runs);result.styleRuns[0].start=0;assert.equal(bubble.text_runs[0].start,1);
});

// 見込み: 明示の許可が既にある場合だけPC書体名を読めば書出時に許可画面を増やさない。
// 合格: prompt/denied/非対応は照会せず、grantedだけ1回読む。範囲: 権限とLocalFontsを模擬。
test('font export never requests a new local-font permission',async()=>{
  let calls=0;const faces=[{family:'書体',fullName:'書体 Regular',postscriptName:'Test-Regular'}];
  const target={queryLocalFonts:async()=>{calls++;return faces;}};
  for(const state of ['prompt','denied'])assert.deepEqual(await clipExportLocalFonts(target,{query:async()=>({state})}),[]);
  assert.equal(calls,0);
  assert.deepEqual(await clipExportLocalFonts(target,{query:async()=>({state:'granted'})}),faces);assert.equal(calls,1);
  assert.deepEqual(await clipExportLocalFonts(target,{query:async()=>{throw Error('unsupported');}}),[]);assert.equal(calls,1);
});

// 見込み: glyphで実使用familyを選び既承認のface名へ対応させれば未導入の先頭候補を誤採用しない。
// 合格: fallbackの正しいbold italic/PS名を選び、未取得はfamilyとwarningを残す。範囲: glyph判定と書体一覧は模擬。
test('font aliases resolve by glyph evidence and retain face/PostScript names',async()=>{
  const probe=(family)=>family==='Yu Mincho',faces=[
    {family:'Yu Mincho',fullName:'YuMincho Regular',postscriptName:'YuMincho-Regular',style:'Regular'},
    {family:'Yu Mincho',fullName:'YuMincho Bold',postscriptName:'YuMincho-Bold',style:'Bold'},
    {family:'Yu Mincho',fullName:'YuMincho Bold Italic',postscriptName:'YuMincho-BoldItalic',style:'Bold Italic'},
  ];
  assert.deepEqual(await clipExportFont('アンチック体','書体',600,true,probe,faces),{font:{name:'YuMincho Bold Italic',postscript:'YuMincho-BoldItalic',syntheticBold:false,syntheticItalic:false}});
  const fallback=await clipExportFont('アンチック体','書体',600,false,probe);
  assert.deepEqual(fallback.font,{name:'Yu Mincho',postscript:'Yu Mincho',syntheticBold:true,syntheticItalic:false});assert.match(fallback.warning,/ファミリー名/);
  const absent=await clipExportFont('未導入書体','字',400,false,()=>false);
  assert.equal(absent.font.name,'未導入書体');assert.match(absent.warning,/置き換わる/);
});

// 見込み: 線分を越える制御点も細分化すれば折り返し形状を保てる。
// 合格: 解析上の極値(-24.125,28.963)から0.2px以内。範囲: native線の座標。
test('collinear control points preserve the curve beyond both end points',()=>{
  const path={id:'fold',closed:false,style:defaultVectorStyle(),nodes:[{x:0,y:0,handleOut:{x:100,y:0}},{x:10,y:0,handleIn:{x:-110,y:0}}]};
  const [line]=clipExportVectorLines([path],{width:100,height:100},{x:0,y:0,w:100,h:100},{w:100,h:100},{width:100,height:100});
  const xs=line.points.map(p=>p[0]);assert.ok(Math.abs(Math.min(...xs)+24.125)<.2);assert.ok(Math.abs(Math.max(...xs)-28.963)<.2);
});
