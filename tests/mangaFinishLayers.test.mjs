// 選んだ画像の仕上げだけを通常のレイヤーとして一緒に確定する。
// 合格は元画像の保持、階層・配置・移動・トーン位相と失敗時の無変更。モデル応答は画像資産で代用する。
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMangaFinishLayers, canFinishPaintLayer } from '../src/lib/mangaFinishLayers.ts';
import { movePaintFolder, newPaintLayer, paintLayerTree, validatePaintDocument } from '../src/lib/paintDocument.ts';
import { applyPaintTone } from '../src/lib/paintTone.ts';

const bbox={x:4,y:6,w:20,h:18};
const asset=(id)=>({id,widthPx:32,heightPx:28});
const input=(id,extra={})=>({...newPaintLayer(id),id,...extra,image:{assetId:id,crop:{x:0,y:0,w:32,h:28},bbox}});
const owner=(key,layers,folders=[],x=0)=>({key,kind:'figure',index:0,label:key,
  frame:{x,y:0,w:25.4,h:25.4},paint:{version:1,width:120,height:120,dpi:120,layers,folders}});
const finish=(owner,layer,roles)=>({owner,layer,bbox,assets:{white:asset('paper'),...roles}});

// 見込み: 生成元、ロック中の読み込み、ネームと手描きは同じラスター。
// 合格: 用途やロックに左右されず対象になり、空・ベクター・生成マスクは対象外。モデルは実行しない。
test('仕上げの選択対象は画像の出所に依存しない',()=>{
  for(const layer of [input('生成',{generation:{jobId:'job',candidateIndex:1}}),input('取込',{locked:true}),input('ネーム',{guide:true}),{...newPaintLayer(),strokes:[{}]}])
    assert.equal(canFinishPaintLayer(layer),true);
  for(const layer of [newPaintLayer(),newPaintLayer('path','vector'),{...newPaintLayer(),generationMask:true,strokes:[{}]}])
    assert.equal(canFinishPaintLayer(layer),false);
});

// 見込み: 2枚の結果はそれぞれの原本の上に追加でき、片方を移動しても残りの順序を保てる。
// 合格: 元の画素参照・編集・手動ロック・親が残り、間の絵、空フォルダー、移動先の座標が一致。文書処理のみを確認。
test('離れた2つの原本を保持し、仕上げの枝を通常どおり移動できる',()=>{
  const parent={id:'案',name:'案',position:0,aboveNative:true};
  const empty={id:'空',name:'空',parentFolderId:parent.id,position:1,aboveNative:true};
  const original=input('原画',{locked:true,folderId:parent.id,aboveNative:true});
  const middle=input('効果線',{folderId:parent.id,aboveNative:true});
  const guide=input('ネーム',{guide:true,folderId:parent.id,aboveNative:true});
  const person=owner('person',[original,middle,guide],[parent,empty]);
  const scene={frame:person.frame,owners:[person]},before=structuredClone(scene);
  const next=applyMangaFinishLayers(scene,[finish(person,guide,{line:asset('inkB')}),finish(person,original,{shade:asset('gray'),line:asset('ink'),black:asset('black')})]);
  const paint=next.owners[0].paint,children=paintLayerTree(paint)[0].children;
  assert.deepEqual(scene,before);
  assert.deepEqual(children.map(entry=>entry.kind==='layer'?entry.layer.id:entry.folder.name),['原画','仕上げ✨','空','効果線','ネーム','仕上げ✨']);
  assert.deepEqual(children[0].layer,{...original,visible:false});
  assert.deepEqual(children[4].layer,{...guide,visible:false});
  assert.equal(children[3].layer,middle);
  assert.deepEqual(children[1].children.map(entry=>entry.layer.name),['白下地','陰影','ベタ','線']);
  assert.deepEqual(children[5].children.map(entry=>entry.layer.name),['白下地','線']);
  for(const branch of [children[1],children[5]]){
    assert.equal(branch.folder.parentFolderId,parent.id);
    assert.ok(branch.children.every(entry=>entry.layer.folderId===branch.folder.id&&entry.layer.aboveNative));
    assert.ok(branch.children.every(entry=>!entry.layer.locked));
    for(const {layer} of branch.children){
      assert.deepEqual(layer.image.bbox,bbox);
      assert.deepEqual(layer.image.crop,{x:0,y:0,w:32,h:28});
    }
  }
  const ids=['原画','効果線','ネーム','paper','inkB','gray','ink','black'].map(asset);
  validatePaintDocument(paint,ids);
  const moved=movePaintFolder(paint,children[1].folder.id,{kind:'folder',id:empty.id,placement:'inside'});
  assert.deepEqual(paintLayerTree(moved)[0].children.map(entry=>entry.kind==='layer'?entry.layer.id:entry.folder.id),['原画','空','効果線','ネーム',children[5].folder.id]);
  assert.deepEqual(paintLayerTree(moved)[0].children[1].children[0].children,children[1].children);
  validatePaintDocument(moved,ids);
});

// 見込み: 2つの描画領域は同じ紙面の網点原点を使う。
// 合格: 原点が7用紙pxずれる領域で、重なる同じ紙面上の32×16画素が完全一致。固定濃度画像と本物のトーン描画を使う。
test('別の親にあるグレーの陰影が紙面座標で揃う',()=>{
  const a=input('A'),b=input('B');
  const first=owner('first',[a]),second=owner('second',[b],[],25.4*7/120);
  const scene=applyMangaFinishLayers({frame:first.frame,owners:[first,second]},[finish(first,a,{shade:asset('gray1')}),finish(second,b,{shade:asset('gray2')})]);
  const pixels=scene.owners.map(item=>{
    const tone=item.paint.layers.find(layer=>layer.name==='陰影').tone;
    assert.equal(tone.mode,'image');
    const rgba={width:40,height:16,data:new Uint8ClampedArray(40*16*4).fill(175)};
    applyPaintTone(rgba,tone,item.paint.dpi,rgba.width,rgba.height);
    return rgba.data;
  });
  const alphas=new Set();
  for(let y=0;y<16;y++)for(let x=0;x<32;x++){
    const value=pixels[1][(y*40+x)*4+3];
    alphas.add(value);
    assert.equal(pixels[0][(y*40+x+7)*4+3],value);
  }
  assert.deepEqual(alphas,new Set([0,175]));
});

// 見込み: 処理中の対象変更や保存できない枚数は選択分を一部だけ確定しない。
// 合格: 別対象・超過時に例外が返り元シーンが不変。実UIの履歴・保存は別検証。
test('対象変更とレイヤー上限で一括仕上げが中断する',()=>{
  const first=input('A'),second=input('B');
  const a=owner('a',[first]),b=owner('b',[second,...Array.from({length:62},()=>newPaintLayer())]);
  const scene={frame:a.frame,owners:[a,b]},before=structuredClone(scene);
  const firstResult=finish(a,first,{});
  assert.throws(()=>applyMangaFinishLayers(scene,[firstResult,finish({...b},second,{})]),/変更/);
  assert.throws(()=>applyMangaFinishLayers(scene,[firstResult,finish(b,second,{line:asset('ink')})]),/上限/);
  assert.deepEqual(scene,before);
});
