// 見込み: 保存したseedと軌跡だけでラフな線束を再現する。幾何・描画分岐・保存validationの試験。画素と実UIはpaintBrush.browserで確認する。
import assert from 'node:assert/strict';
import test from 'node:test';
import {forEachRoughHatch} from '../src/lib/paintBrush.ts';
import {drawPaintStroke} from '../src/lib/paintRenderer.ts';
import {newPaintLayer,validatePaintDocument,mapPaintStroke} from '../src/lib/paintDocument.ts';
import {paintStrokeBounds} from '../src/lib/paintStroke.ts';
const point=(x,y=100,pressure=1)=>({x,y,pressure,time:0});
const stroke={tool:'pen',color:'#000000',size:100,brush:{kind:'rough-hatching',seed:2147},points:[point(100)]};
const outlines=s=>{const result=[];forEachRoughHatch(s,p=>result.push(p));return result;};
const rounded=lines=>lines.map(line=>line.map(p=>({x:Math.round(p.x*1e7),y:Math.round(p.y*1e7)})));

// 見込み: 1クリックは長短と傾きの異なる細線の束。合格: 11本・縦長・線端が既存bounds内で、筆圧低下時は全体が縮小。範囲: 本体の幾何、描き味の視覚判定は別。
test('a click makes a bounded bundle of varied narrow vertical scratches',()=>{
  const lines=outlines(stroke),bounds=paintStrokeBounds(stroke);assert.equal(lines.length,11);
  const heights=lines.map(line=>Math.max(...line.map(p=>p.y))-Math.min(...line.map(p=>p.y)));
  assert.ok(Math.min(...heights)>75&&Math.max(...heights)<100);assert.ok(new Set(heights).size>8);
  for(const line of lines){
    assert.ok(Math.max(...line.map(p=>p.x))-Math.min(...line.map(p=>p.x))<12);
    assert.ok(line.every(p=>p.x>=bounds.x&&p.y>=bounds.y&&p.x<=bounds.x+bounds.w&&p.y<=bounds.y+bounds.h));
  }
  const light=outlines({...stroke,points:[point(100,100,.2)]});
  assert.ok(Math.max(...light.flat().map(p=>Math.abs(p.y-100)))<Math.min(...heights)/2);
});

// 見込み: 再表示・保存再読込・移動で模様が跳ねない。合格: JSON往復完全一致、平行移動後も局所座標一致、異なるseedは異なる模様。範囲: 保存strokeと本体幾何。
test('seed survives serialization and translation without reshuffling the ink',()=>{
  const original=outlines(stroke);assert.deepEqual(outlines(JSON.parse(JSON.stringify(stroke))),original);
  assert.deepEqual(rounded(outlines(mapPaintStroke(stroke,20,30)).map(line=>line.map(p=>({x:p.x-20,y:p.y-30})))),rounded(original));
  assert.notDeepEqual(outlines({...stroke,brush:{...stroke.brush,seed:2148}}),original);
});

// 見込み: 同じ道筋ならイベント数に依らず距離でスタンプし、既存部分を再配置しない。合格: 疎/密入力の幾何一致、延長後の先頭一致、重複座標で追加なし。範囲: 合成軌跡。
test('distance spacing is independent of pointer sample density and keeps a stable prefix',()=>{
  const sparse={...stroke,points:[point(100),point(450)]};
  const dense={...stroke,points:Array.from({length:71},(_,i)=>point(100+i*5))};
  assert.deepEqual(rounded(outlines(sparse)),rounded(outlines(dense)));
  const prefix=outlines({...stroke,points:[point(100),point(300)]});
  assert.deepEqual(outlines(sparse).slice(0,prefix.length),prefix);
  assert.deepEqual(outlines({...stroke,points:[point(100),point(100),point(100)]}),outlines(stroke));
});

// 見込み: 作品内のstrokeにブラシ指定を保持し、壊れた指定は既存readerで拒否。合格: 往復後の指定一致、異種tool/不正seed/不明種類は拒否。範囲: 本体validation、実ファイルwriterではない。
test('document validation retains valid brush metadata and rejects invalid brush strokes',()=>{
  const paint={version:1,width:600,height:400,dpi:100,layers:[{...newPaintLayer(),strokes:[stroke]}]};
  const saved=JSON.parse(JSON.stringify(paint));validatePaintDocument(saved,[]);assert.deepEqual(saved.layers[0].strokes[0].brush,stroke.brush);
  for(const bad of [null,{kind:'other',seed:1},{kind:'rough-hatching',seed:-1},{kind:'rough-hatching',seed:1.5},{kind:'rough-hatching',seed:2**32}]){
    assert.throws(()=>validatePaintDocument({...paint,layers:[{...paint.layers[0],strokes:[{...stroke,brush:bad}]}]},[]));
  }
  assert.throws(()=>validatePaintDocument({...paint,layers:[{...paint.layers[0],strokes:[{...stroke,tool:'eraser'}]}]},[]));
});

// 見込み: 通常ペンは既存の丸描画、ハッチングは同じ選択clip・色のまま線束を描画。合格: 丸penのみarc、ハッチング11輪郭/1fillとclip順。範囲: Canvas呼出しを記録、画素は別。
test('renderer keeps ordinary pen dabs and applies the selected ink and clipping to hatching',()=>{
  const ops=[],ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},closePath(){ops.push('outline');},arc(){ops.push('arc');},rect(){},clip(){ops.push('clip');},fill(){ops.push(['fill',this.fillStyle]);}};
  drawPaintStroke(ctx,{...stroke,brush:undefined});assert.ok(ops.includes('arc'));assert.ok(!ops.includes('outline'));
  ops.length=0;drawPaintStroke(ctx,{...stroke,color:'#ffffff',selection:[{x:95,y:70,w:40,h:80}]});
  assert.equal(ops[0],'clip');assert.equal(ops.filter(v=>v==='outline').length,11);assert.ok(!ops.includes('arc'));assert.deepEqual(ops.at(-1),['fill','#ffffff']);
});
