import assert from 'node:assert/strict';
import test from 'node:test';
import { paintHelpItems } from '../src/lib/paintHelp.ts';

test('paint help separates features into concise list items',()=>{
 assert.deepEqual(paintHelpItems('線を選択します。Shiftで追加します。'),['線を選択します。','Shiftで追加します。']);
 assert.deepEqual(paintHelpItems('クリックで角\nドラッグで曲線\nEscで終了'),['クリックで角','ドラッグで曲線','Escで終了']);
 assert.deepEqual(paintHelpItems('単独の説明'),['単独の説明']);
});
