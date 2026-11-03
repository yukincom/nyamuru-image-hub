// 見込み: 読取用IDと見本の対応を共通にすれば、表示・コピー用の英語名を二重管理しない。
// 合格: 86項目の順序・カテゴリ・画像領域が一意で、全10枚の実画像内に収まる。静的データとPNGヘッダ、実表示/コピーはブラウザーで確認。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import catalog from '../scripts/expression_catalog.json' with {type:'json'};
import reference from '../src/content/expression-reference.json' with {type:'json'};

// 見込み: 辞書が変わったら表示用領域の不足や別IDへの誤対応を検出できる。合格: 同じ86IDが同順、カテゴリ10個と出典SHAが一致。
test('the popup references the same ordered dictionary used for expression reading',()=>{
  assert.equal(reference.source_sha256,catalog.source_sha256);
  assert.equal(reference.entries.length,86);
  assert.equal(reference.categories.length,10);
  assert.deepEqual(reference.entries.map(e=>e.id),catalog.entries.map(e=>e.id));
  assert.equal(new Set(reference.entries.map(e=>e.id)).size,86);
  assert.deepEqual(new Set(reference.categories.map(c=>c.id)),new Set(catalog.entries.map(e=>e.category)));
});

// 見込み: 元の枠座標と実PNG寸法を照合すれば、星形瞳孔などの修正済み見本を欠落せず表示できる。合格: 全領域が対応画像内、S071はv3見本。
test('every reference region fits its bundled image, including the corrected eye sheet',()=>{
  const categories=new Map(reference.categories.map(c=>[c.id,c]));
  for(const category of categories.values()){
    const png=readFileSync(new URL('../src/assets/expression-dictionary/'+category.image,import.meta.url));
    assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[category.width,category.height]);
  }
  for(const [index,entry] of catalog.entries.entries()){
    const category=categories.get(entry.category),[x,y,right,bottom]=reference.entries[index].box;
    assert.ok(x>=0&&y>=0&&right>x&&bottom>y&&right<=category.width&&bottom<=category.height,entry.id);
  }
  assert.equal(categories.get(catalog.entries.find(e=>e.id==='S071').category).image,'category_08-v3.png');
});
