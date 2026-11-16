import assert from 'node:assert/strict';
import test from 'node:test';
import { paintHelpItems } from '../src/lib/paintHelp.ts';
import { paintToolShortcut } from '../src/lib/paintToolShortcuts.ts';

test('paint help separates features into concise list items',()=>{
 assert.deepEqual(paintHelpItems('線を選択します。Shiftで追加します。'),['線を選択します。','Shiftで追加します。']);
 assert.deepEqual(paintHelpItems('クリックで角\nドラッグで曲線\nEscで終了'),['クリックで角','ドラッグで曲線','Escで終了']);
 assert.deepEqual(paintHelpItems('単独の説明'),['単独の説明']);
});

test('paint tool shortcuts map b, e, w, m, g to drawing tools',()=>{
 assert.equal(paintToolShortcut({key:'b'}),'pen');
 assert.equal(paintToolShortcut({key:'e'}),'eraser');
 assert.equal(paintToolShortcut({key:'w'}),'wand');
 assert.equal(paintToolShortcut({key:'m'}),'lasso');
 assert.equal(paintToolShortcut({key:'g'}),'fill');
});
