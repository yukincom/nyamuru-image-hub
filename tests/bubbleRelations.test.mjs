import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBubbleSpeakerFigureIndex, letteringFigureIndex, letteringLayerMove } from '../src/lib/bubbleRelations.ts';

const panel = (figures) => ({
  id: 1,
  shape: { type: 'rect', x: 10, y: 10, w: 190, h: 120 },
  bg: 0,
  figures,
  bubbles: [],
  action: null,
});

test('描き文字の前後指定は同じ所有範囲の一意な対応キャラクターへ解決する',()=>{
  const owner=panel([{name:'変更後の葵',refId:'a'},{name:'蓮',refId:'b'},{name:'葵',kind:'prop',refId:'a'}]);
  const text={text:'かぁぁ',shape:'handwritten',speakerId:'a',speaker:'葵',lettering_depth:'behind'};
  assert.equal(letteringFigureIndex(owner,text),0);
  for(const depth of ['front','behind',undefined])assert.equal(letteringFigureIndex(owner,{...text,lettering_depth:depth}),0);
  for(const patch of [{shape:'normal'},{shape:'typeset'},{speakerId:'missing',speaker:'蓮'},{speakerId:undefined,speaker:undefined}])
    assert.equal(letteringFigureIndex(owner,{...text,...patch}),null);
  assert.equal(letteringFigureIndex(panel([{name:'葵'},{name:'蓮'}]),text),0);
  assert.equal(letteringFigureIndex(panel([{name:'葵',refId:'a'},{name:'葵',refId:'a'}]),text),null);
  assert.equal(letteringFigureIndex(panel([{name:'別人',refId:'b'}]),text),null);
});

test('一意に配置された話者だけをフキダシの接続先にする', () => {
  const target = panel([
    { name: '葵', bbox: { x: 20, y: 30, w: 40, h: 70 } },
    { name: '蓮', bbox: { x: 120, y: 30, w: 40, h: 70 } },
  ]);
  assert.equal(resolveBubbleSpeakerFigureIndex(target, { text: 'こんにちは', speaker: '蓮' }), 1);
  assert.equal(resolveBubbleSpeakerFigureIndex(target, { text: 'こんにちは' }), null);
});

test('人物あたりと同名人物が複数いる曖昧な配置には接続しない', () => {
  assert.equal(resolveBubbleSpeakerFigureIndex(panel([
    { name: '人物あたり', bbox: { x: 20, y: 30, w: 40, h: 70 } },
    { name: '人物あたり', bbox: { x: 120, y: 30, w: 40, h: 70 } },
  ]), { text: '仮セリフ', speaker: '人物あたり' }), null);

  assert.equal(resolveBubbleSpeakerFigureIndex(panel([
    { name: '葵', bbox: { x: 20, y: 30, w: 40, h: 70 } },
    { name: '葵', bbox: { x: 120, y: 30, w: 40, h: 70 } },
  ]), { text: 'どちら？', speaker: '葵' }), null);
});

test('紐付いた描き文字と人物の上下ドラッグだけを前後指定へ変換する',()=>{
 const owner={figures:[{name:'A',refId:'a'},{name:'B',refId:'b'}],bubbles:[{text:'ドン',shape:'handwritten',speakerId:'a'},{text:'セリフ',shape:'normal',speakerId:'a'}]};
 for(const below of [false,true]){
  assert.deepEqual(letteringLayerMove(owner,'bubble-0','figure-0',below),{index:0,depth:below?'behind':'front'});
  assert.deepEqual(letteringLayerMove(owner,'figure-0','bubble-0',below),{index:0,depth:below?'front':'behind'});
 }
 for(const [source,target] of [['bubble-0','figure-1'],['bubble-1','figure-0'],['bubble-0','bubble-1'],['figure-0','figure-1'],['bubble-99','figure-0'],['bubble-x','figure-0']])assert.equal(letteringLayerMove(owner,source,target,true),null);
});
