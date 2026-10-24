import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { toStoredMangaYaml, parseMangaYaml } from '../src/lib/manga.ts';
import { addCanvasText, canvasTextAt, editCanvasText } from '../src/lib/canvasText.ts';
function fixture(){const d=createEmptyWorkspaceDocument();d.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:10,y:20,w:90,h:120},bg:0,bubbles:[{text:'生成済み',shape:'normal',speaker:'A',analogTextImport:{assetId:'original',sourceRegionId:'ocr'}}]}];return d;}
test('T additions remain native editable objects through save and reopen',()=>{
 const d=fixture(),bubble=addCanvasText(d,0,0,'bubble'),screen=addCanvasText(d,0,0,'screen_text');
 editCanvasText(d,bubble,'追加\n二行目');editCanvasText(d,screen,'看板');
 const r=parseMangaYaml(toStoredMangaYaml(d));
 assert.equal(canvasTextAt(r,bubble).text,'追加\n二行目');assert.equal(canvasTextAt(r,bubble).shape,'normal');
 assert.equal(canvasTextAt(r,screen).orientation,'horizontal');assert.equal(canvasTextAt(r,screen).text,'看板');
 assert.equal(canvasTextAt(r,bubble).paint_overlay,undefined);assert.ok(canvasTextAt(r,bubble).bbox);
 assert.equal(r.manga.pages[0].panels[0].bubbles[0].text,'生成済み');
 editCanvasText(r,bubble,'再編集');assert.equal(canvasTextAt(r,bubble).text,'再編集');
});
test('existing generated bubble uses the same text edit and retains speaker and original reference',()=>{
 const d=fixture(),target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false};
 editCanvasText(d,target,'修正');const b=canvasTextAt(d,target);
 assert.equal(b.text,'修正');assert.equal(b.speaker,'A');assert.equal(b.analogTextImport.assetId,'original');assert.equal(b.analogTextImport.referenceHidden,true);
});
test('missing, hidden and unsupported owners cannot receive text changes',()=>{
 const d=fixture();assert.equal(addCanvasText(d,0,9,'bubble'),null);
 const t=addCanvasText(d,0,0,'screen_text');assert.equal(editCanvasText(d,{...t,overlay:true},'bad'),false);
 d.manga.pages[0].panels[0].layer={hidden:true};assert.equal(addCanvasText(d,0,0,'bubble'),null);assert.equal(editCanvasText(d,t,'bad'),false);assert.equal(canvasTextAt(d,t).text,'');
});
