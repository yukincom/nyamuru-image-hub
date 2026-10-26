import assert from 'node:assert/strict';
import test from 'node:test';
import { paintToolShortcut, paintInkShortcut, paintSizeShortcut, stepPaintSize, PAINT_SIZE_PRESETS } from '../src/lib/paintToolShortcuts.ts';
test('Illustrator tool keys accept Japanese and US plus key representations',()=>{
  for(const [key,tool] of [['v','vector-select'],['a','vector-node'],['p','vector-pen'],['m','rectangle'],['l','ellipse'],['-','vector-delete'],['+','vector-add']])assert.equal(paintToolShortcut({key}),tool);
  assert.equal(paintToolShortcut({key:'=',shiftKey:true}),'vector-add');
  assert.equal(paintToolShortcut({key:'+',shiftKey:true}),'vector-add');
  assert.equal(paintToolShortcut({key:'C',shiftKey:true}),'vector-anchor');
});
test('typing, IME and application chords do not switch tools',()=>{
  for(const key of ['a','v','p','m','l','-','+','C']){
    assert.equal(paintToolShortcut({key},true),undefined);
    for(const modifier of ['isComposing','metaKey','ctrlKey','altKey'])assert.equal(paintToolShortcut({key,[modifier]:true}),undefined);
  }
  assert.equal(paintToolShortcut({key:'c'}),undefined);
  assert.equal(paintToolShortcut({key:'M',shiftKey:true}),undefined);
});

test('X toggles ink but typing, IME, cut and modified chords keep their meaning',()=>{
  assert.equal(paintInkShortcut({key:'x'}),true);assert.equal(paintInkShortcut({key:'X'}),true);
  assert.equal(paintInkShortcut({key:'x'},true),false);
  for(const modifier of ['shiftKey','altKey','metaKey','ctrlKey','isComposing'])assert.equal(paintInkShortcut({key:'x',[modifier]:true}),false);
  assert.equal(paintInkShortcut({key:'z'}),false);
});

test('tablet brush keys follow JIS and US characters and leave IME and text alone',()=>{
  assert.equal(paintSizeShortcut({key:'[',code:'BracketRight'}),-1);
  assert.equal(paintSizeShortcut({key:']',code:'Backslash'}),1);
  assert.equal(paintSizeShortcut({key:'@',code:'BracketLeft'}),undefined);
  assert.equal(paintSizeShortcut({key:']'},true),undefined);
  for(const modifier of ['shiftKey','altKey','metaKey','ctrlKey','isComposing'])assert.equal(paintSizeShortcut({key:'[',[modifier]:true}),undefined);
  assert.deepEqual([...PAINT_SIZE_PRESETS],[.07,.1,.15,.2,.25,.3,.4,.5,.6,.7,.8,1,1.2,1.5,1.7,2,2.5,3,4,5,6,7,8,10,12,15,17,20,25,30,40,50,60,70,80,100]);
  assert.equal(stepPaintSize(8,1),10);assert.equal(stepPaintSize(10,-1),8);
  assert.equal(stepPaintSize(8.3,1),10);assert.equal(stepPaintSize(8.3,-1),8);
  assert.equal(stepPaintSize(.07,-1),.07);assert.equal(stepPaintSize(100,1),100);
  assert.equal(stepPaintSize(.1,-1,true),.07);assert.equal(stepPaintSize(80,1,true),100);
});
