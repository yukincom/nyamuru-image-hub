import { mergeSelectedPanels, splitPanel } from '../src/lib/panelTemplates.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { toStoredMangaYaml, parseMangaYaml } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { bubbleAt, bubbleVisible, toggleBubbleVisibility, editBubbleText, panelVisible, panelFrameVisible, panelArtKeys, reorderPanelArt } from '../src/lib/panelLayers.ts';
import { panelHasElementAt } from '../src/lib/canvasGeometry.ts';
import { paintScene } from '../src/lib/paintDocument.ts';

function fixture(){
 const doc=createEmptyWorkspaceDocument();
 const panel=id=>({id,shape:{type:'rect',x:10,y:10+id*50,w:80,h:40},bg:0,action:'保持するアクション',figures:[{name:'A',bbox:{x:15,y:65,w:20,h:30}},{name:'B',bbox:{x:25,y:65,w:20,h:30}}],bubbles:[{text:`コマ${id}`,speaker:'A',join_to:undefined}]});
 doc.manga.pages[0].panels=[panel(1),panel(2)];
 doc.manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',bubbles:[{text:'前景'}]};return parseMangaYaml(toStoredMangaYaml(doc));
}
test('panel and frame visibility are independent and preserve clipping geometry/content across saved project roundtrip',async()=>{
 const doc=fixture(),p=doc.manga.pages[0].panels[0],before=structuredClone(p);
 assert.ok(panelVisible(p));assert.ok(panelFrameVisible(p));
 p.layer={frameHidden:true};assert.ok(panelVisible(p));assert.equal(panelFrameVisible(p),false);
 p.layer.hidden=true;assert.equal(panelVisible(p),false);
 const restored=await restoreProjectSnapshot(await createProjectSnapshot(doc)),r=restored.manga.pages[0].panels[0];
 assert.deepEqual(r.layer,{hidden:true,frameHidden:true});assert.deepEqual(r.shape,before.shape);assert.deepEqual(r.figures,before.figures);assert.deepEqual(r.bubbles,before.bubbles);assert.equal(r.action,before.action);
 r.layer.hidden=false;assert.ok(panelVisible(r));assert.equal(panelFrameVisible(r),false);
});
test('drag order changes artwork stacking without changing reading order or source ownership, including deletion and new people',()=>{
 const doc=fixture(),p=doc.manga.pages[0].panels[0],before=p.figures.map(f=>f.name);
 assert.ok(reorderPanelArt(p,'figure-0','figure-1',false));
 assert.deepEqual(panelArtKeys(p),['background','figure-1','figure-0']);assert.deepEqual(p.figures.map(f=>f.name),before);
 assert.deepEqual(paintScene(p,100,[]).owners.map(o=>o.key),['background','figure-1','figure-0','bubble-0']);
 const r=parseMangaYaml(toStoredMangaYaml(doc)).manga.pages[0].panels[0];
 assert.deepEqual(panelArtKeys(r),panelArtKeys(p));assert.deepEqual(r.figures.map(f=>f.name),before);
 r.figures.splice(1,1);r.figures.push({name:'C'});
 assert.deepEqual(panelArtKeys(r),['background','figure-0','figure-1']);
 assert.equal(reorderPanelArt(r,'bubble-0','background',false),false);
 assert.ok(reorderPanelArt(r,'background','figure-0',false));assert.equal(panelArtKeys(r).indexOf('background'),1);
});
test('inline text uses explicit page/panel/overlay address and preserves source metadata through YAML save',()=>{
 const doc=fixture(),target={pageIndex:0,panelIndex:1,bubbleIndex:0,overlay:false};
 const b=bubbleAt(doc,target);b.analogTextImport={assetId:'source',sourceRegionId:'region',needsReview:true};
 assert.ok(editBubbleText(doc,target,'こんにちは\n次の行'));assert.equal(doc.manga.pages[0].panels[0].bubbles[0].text,'コマ1');
 assert.equal(b.speaker,'A');assert.equal(b.analogTextImport.assetId,'source');assert.equal(b.analogTextImport.referenceHidden,true);
 assert.ok(editBubbleText(doc,{...target,overlay:true},'前景を編集'));assert.equal(doc.manga.pages[0].page_overlay.bubbles[0].text,'前景を編集');
 const restored=parseMangaYaml(toStoredMangaYaml(doc));assert.equal(bubbleAt(restored,target).text,'こんにちは\n次の行');
 assert.equal(editBubbleText(doc,{...target,panelIndex:99},'誤更新'),false);
 doc.manga.pages[0].panels[1].layer={hidden:true};assert.equal(editBubbleText(doc,target,'誤更新'),false);
});
test('manually editing scenario text retains provenance while disabling the source image',()=>{
 const doc=fixture(),target={pageIndex:0,panelIndex:0,bubbleIndex:0,overlay:false},b=bubbleAt(doc,target);
 doc.manga.scenario={};b.scenarioMatch={status:'confirmed',sourceIds:['script-1'],ocrText:'元の文字',score:1};
 editBubbleText(doc,target,'修正');assert.equal(b.scenarioMatch.status,'manual');assert.deepEqual(b.scenarioMatch.sourceIds,['script-1']);assert.equal(b.scenarioMatch.ocrText,'元の文字');
});

test('merge and split retain artwork order independently of reading order and avoid duplicate layer IDs',()=>{
 const doc=fixture(),page=doc.manga.pages[0];
 page.panels[1].figures[0].name='C';page.panels[1].figures[1].name='D';
 reorderPanelArt(page.panels[1],'figure-0','figure-1',false);
 mergeSelectedPanels(page,[0,1]);const p=page.panels[0];
 assert.deepEqual(p.figures.map(f=>f.name),['A','B','C','D']);
 assert.deepEqual(panelArtKeys(p),['background','figure-0','figure-1','figure-3','figure-2']);
 assert.equal(new Set(p.figures.map(f=>f.layerId)).size,4);
 splitPanel(page,0,'vertical',{rowGapMm:0,columnGapMm:0});
 for(const child of page.panels){const names=panelArtKeys(child).filter(k=>k!=='background').map(k=>child.figures[Number(k.slice(7))].name);assert.ok(names.indexOf('D')<names.indexOf('C')||!names.includes('C')||!names.includes('D'));}
});

test('bubble visibility keeps text, shape and joins together without renumbering through project restore',async()=>{
 const doc=fixture(),target={pageIndex:0,panelIndex:0,bubbleIndex:0,overlay:false},p=doc.manga.pages[0].panels[0];
 p.bubbles[0].bbox={x:70,y:70,w:15,h:20};p.bubbles.push({text:'連結先',join_to:1,bbox:{x:70,y:93,w:15,h:7}});
 const before=structuredClone(p.bubbles[0]);assert.equal(panelHasElementAt(p,75,75),true);
 assert.ok(toggleBubbleVisibility(doc,target));assert.equal(bubbleVisible(p.bubbles[0]),false);assert.equal(panelHasElementAt(p,75,75),false);
 assert.equal(editBubbleText(doc,target,'隠れた文字を変更'),false);
 assert.ok(toggleBubbleVisibility(doc,{...target,overlay:true}));
 const restored=await restoreProjectSnapshot(await createProjectSnapshot(doc)),r=restored.manga.pages[0].panels[0];
 assert.equal(r.bubbles.length,2);assert.equal(r.bubbles[1].join_to,1);assert.equal(r.bubbles[0].hidden,true);
 assert.equal(restored.manga.pages[0].page_overlay.bubbles[0].hidden,true);
 assert.ok(toggleBubbleVisibility(restored,target));delete r.bubbles[0].hidden;assert.deepEqual(r.bubbles[0],before);
 assert.equal(toggleBubbleVisibility(doc,{...target,bubbleIndex:99}),false);
});
test('invalid hidden values never hide native bubbles during normalization',()=>{
 const doc=fixture();doc.manga.pages[0].panels[0].bubbles[0].hidden='false';
 doc.manga.pages[0].page_overlay.bubbles[0].hidden=1;
 const restored=parseMangaYaml(toStoredMangaYaml(doc));
 assert.ok(bubbleVisible(restored.manga.pages[0].panels[0].bubbles[0]));assert.ok(bubbleVisible(restored.manga.pages[0].page_overlay.bubbles[0]));
});
