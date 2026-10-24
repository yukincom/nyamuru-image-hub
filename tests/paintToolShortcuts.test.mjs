import assert from 'node:assert/strict';
import test from 'node:test';
import { paintToolShortcut, paintInkShortcut, paintSizeShortcut, stepPaintSize } from '../src/lib/paintToolShortcuts.ts';
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
  assert.equal(stepPaintSize(8,1),9);assert.equal(stepPaintSize(9,-1),8);
  assert.equal(stepPaintSize(8.3,1),9);assert.equal(stepPaintSize(8.3,-1),8);
  assert.equal(stepPaintSize(.5,-1),.5);assert.equal(stepPaintSize(500,1),500);
  assert.equal(stepPaintSize(.1,-1,true),.1);assert.equal(stepPaintSize(500,1,true),600);
  assert.equal(stepPaintSize(1000,1,true),1000);
});
