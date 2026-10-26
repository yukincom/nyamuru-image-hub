import assert from 'node:assert/strict';
import test from 'node:test';
import {figureDisplayLabel,panelDisplayLabel} from '../src/lib/displayLabels.ts';

test('visible labels keep authored names and fill blank imported figure names deterministically',()=>{
 assert.equal(panelDisplayLabel(3),'コマ 03');
 assert.equal(figureDisplayLabel({name:'  Alice  ',kind:'person'},0),'Alice');
 assert.equal(figureDisplayLabel({name:'　',kind:'person'},1),'人物 2');
 assert.equal(figureDisplayLabel({name:'',kind:'prop'},2),'小道具 3');
 assert.equal(figureDisplayLabel({name:'',object:true},3),'小道具 4');
});
