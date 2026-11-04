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

// 見込み: 線端の振幅を広げると長短が目に見えて混ざる。合格: 100pxの束は11本、最長と最短の差20px超、上下端も各12px超の差、bounds内。範囲: 固定seedの幾何、見た目は別。
test('a click makes a bounded bundle of varied narrow vertical scratches',()=>{
  const lines=outlines(stroke),bounds=paintStrokeBounds(stroke);assert.equal(lines.length,11);
  const heights=lines.map(line=>Math.max(...line.map(p=>p.y))-Math.min(...line.map(p=>p.y)));
  assert.ok(Math.min(...heights)>50&&Math.max(...heights)<100);assert.ok(Math.max(...heights)-Math.min(...heights)>20);
  for(const edge of [Math.min,Math.max]){const ends=lines.map(line=>edge(...line.map(p=>p.y)));assert.ok(Math.max(...ends)-Math.min(...ends)>12);}
  for(const line of lines){
    assert.ok(Math.max(...line.map(p=>p.x))-Math.min(...line.map(p=>p.x))<12);
    assert.ok(line.every(p=>p.x>=bounds.x&&p.y>=bounds.y&&p.x<=bounds.x+bounds.w&&p.y<=bounds.y+bounds.h));
  }
  const light=outlines({...stroke,points:[point(100,100,.2)]});
  assert.ok(Math.max(...light.flat().map(p=>Math.abs(p.y-100)))<Math.min(...heights)/2);
});

// 見込み: 線の芯が途中で曲がり、ほぼ直線の線も混ざる。合格: 100pxの11本中8本以上が端点間の直線から1px超外れ、最大6px未満・左右両方向。範囲: 固定seedの中心線、描き味は画面で確認。
test('the bundle mixes visible bends in both directions with straighter scratches',()=>{
  const departures=outlines(stroke).map(outline=>{
    const count=outline.length/2,centers=outline.slice(0,count).map((p,i)=>({x:(p.x+outline.at(-i-1).x)/2,y:p.y}));
    const first=centers[0],last=centers.at(-1);
    return centers.map(p=>p.x-first.x-(last.x-first.x)*(p.y-first.y)/(last.y-first.y));
  });
  assert.ok(departures.filter(values=>Math.max(...values.map(Math.abs))>1).length>=8);
  assert.ok(departures.every(values=>Math.max(...values.map(Math.abs))<6));
  assert.ok(departures.some(values=>Math.max(...values)>1));
  assert.ok(departures.some(values=>Math.min(...values)<-1));
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
