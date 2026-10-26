import { mergeSelectedPanels, splitPanel } from '../src/lib/panelTemplates.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { toMangaYaml, toStoredMangaYaml, parseMangaYaml } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { bubbleAt, bubbleVisible, toggleBubbleVisibility, editBubbleText, normalizePanelLayer, ownerItemLocked, panelGeometryLocked, panelLocked, panelVisible, panelFrameLocked, panelFrameVisible, panelFrameSegmentsOnInnerFrame, panelArtKeys, preservesLockedItems, reorderPanelArt, unlockPanelDescendants } from '../src/lib/panelLayers.ts';
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
 p.layer={frameHidden:true,locked:true};assert.ok(panelVisible(p));assert.equal(panelFrameVisible(p),false);assert.ok(panelLocked(p));
 p.layer.hidden=true;assert.equal(panelVisible(p),false);
 const restored=await restoreProjectSnapshot(await createProjectSnapshot(doc)),r=restored.manga.pages[0].panels[0];
 assert.deepEqual(r.layer,{hidden:true,frameHidden:true,locked:true});assert.ok(panelLocked(r));assert.deepEqual(r.shape,before.shape);assert.deepEqual(r.figures,before.figures);assert.deepEqual(r.bubbles,before.bubbles);assert.equal(r.action,before.action);
 r.layer.hidden=false;assert.ok(panelVisible(r));assert.equal(panelFrameVisible(r),false);
});
test('whole-panel and frame-only locks normalize and remain independent',()=>{
 const doc=fixture(),panel=doc.manga.pages[0].panels[0];
 panel.layer=normalizePanelLayer({locked:false,frameLocked:true,backgroundLocked:true,directLocked:true,unknown:true});
 assert.equal(panelLocked(panel),false);assert.equal(panelFrameLocked(panel),true);assert.equal(panelGeometryLocked(panel),true);
 assert.deepEqual(panel.layer,{frameLocked:true,backgroundLocked:true,directLocked:true});
 panel.layer={locked:true,frameLocked:false};assert.equal(panelLocked(panel),true);assert.equal(panelFrameLocked(panel),false);assert.equal(panelGeometryLocked(panel),true);
 panel.figures[0].locked=true;panel.bubbles[0].locked=true;doc.manga.pages[0].layer={directLocked:true};
 const restored=parseMangaYaml(toStoredMangaYaml(doc));
 assert.equal(restored.manga.pages[0].panels[0].figures[0].locked,true);assert.equal(restored.manga.pages[0].panels[0].bubbles[0].locked,true);assert.equal(restored.manga.pages[0].layer.directLocked,true);
 const exported=toStoredMangaYaml(doc),publicYaml=toMangaYaml(doc);
 assert.match(exported,/frameLocked: false/);assert.match(exported,/directLocked: true/);assert.match(exported,/locked: true/);assert.doesNotMatch(publicYaml,/frameLocked|directLocked|locked:/);
});
test('unlocking a panel folder clears every descendant lock without child-to-parent propagation',()=>{
 const panel=fixture().manga.pages[0].panels[0],layer={id:'locked',name:'固定層',visible:true,locked:true,opacity:1,blend:'normal',strokes:[]};
 const content=id=>({assetId:id,crop:{x:0,y:0,w:1,h:1},opacity:1,hidden:false,locked:true,paint:{version:1,width:1,height:1,dpi:1,guideInitialized:true,layers:[structuredClone(layer)]}});
 panel.layer={locked:true,frameLocked:true,backgroundLocked:true,directLocked:true};
 panel.background_images=[{...content('background'),id:'background',bbox:{x:0,y:0,w:1,h:1}}];
 panel.images=[{...content('direct'),id:'direct',bbox:{x:0,y:0,w:1,h:1}}];
 panel.figures[0].locked=true;panel.figures[0].artwork=content('figure');
 panel.bubbles[0].locked=true;panel.bubbles[0].paint_overlay=content('bubble');
 unlockPanelDescendants(panel);
 assert.equal(panelLocked(panel),false);assert.equal(panel.layer.frameLocked,undefined);assert.equal(panel.layer.backgroundLocked,undefined);assert.equal(panel.layer.directLocked,undefined);
 for(const image of [...panel.background_images,...panel.images]){assert.equal(image.locked,false);assert.equal(image.paint.layers[0].locked,false);}
 assert.equal(panel.figures[0].locked,undefined);assert.equal(panel.figures[0].artwork.locked,false);assert.equal(panel.figures[0].artwork.paint.layers[0].locked,false);
 assert.equal(panel.bubbles[0].locked,undefined);assert.equal(panel.bubbles[0].paint_overlay.locked,false);assert.equal(panel.bubbles[0].paint_overlay.paint.layers[0].locked,false);
 panel.figures[0].locked=true;assert.equal(panelLocked(panel),false);
});
test('inspector drafts retain individually locked figures and bubbles while unlocked siblings may move',()=>{
 const locked={name:'固定',locked:true,bbox:{x:1,y:2,w:3,h:4}},free={name:'編集可',bbox:{x:5,y:6,w:7,h:8}};
 assert.ok(preservesLockedItems([locked,free],[free,{...locked}]));
 assert.ok(preservesLockedItems([locked,free],[{...free,name:'更新'},locked]));
 assert.equal(preservesLockedItems([locked,free],[free]),false);
 assert.equal(preservesLockedItems([locked,free],[free,{...locked,name:'変更'}]),false);
 const legacyFigure={name:'旧人物',artwork:{locked:true}},legacyBubble={text:'旧フキダシ',shape:'normal',paint_overlay:{locked:true}};
 assert.equal(ownerItemLocked(legacyFigure),false);assert.ok(ownerItemLocked(legacyBubble));
 assert.equal(preservesLockedItems([legacyFigure],[{...legacyFigure,name:'変更'}]),true);
 assert.equal(preservesLockedItems([legacyBubble],[{...legacyBubble,text:'変更'}]),false);
});
test('inner-frame overlay repeats only coincident visible frame portions above the dashed guide',()=>{
 const inner={x:10,y:10,w:162,h:237};
 const rect={id:1,shape:{type:'rect',x:10,y:10,w:80,h:70},bg:0,bubbles:[]};
 assert.deepEqual(panelFrameSegmentsOnInnerFrame(rect,inner),[
  {x1:10,y1:10,x2:90,y2:10},
  {x1:10,y1:10,x2:10,y2:80},
 ]);
 rect.bleed=['top'];
 assert.deepEqual(panelFrameSegmentsOnInnerFrame(rect,inner),[{x1:10,y1:10,x2:10,y2:80}]);
 const polygon={id:2,shape:{type:'polygon',points:[[0,10],[172,10],[172,247],[30,247],[30,100],[0,100]]},bg:0,bubbles:[]};
 assert.deepEqual(panelFrameSegmentsOnInnerFrame(polygon,inner),[
  {x1:10,y1:10,x2:172,y2:10},
  {x1:172,y1:10,x2:172,y2:247},
  {x1:30,y1:247,x2:172,y2:247},
 ]);
 const offset={...rect,shape:{type:'rect',x:10.03,y:10.03,w:80,h:70},bleed:[]};
 assert.deepEqual(panelFrameSegmentsOnInnerFrame(offset,inner),[]);
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
 assert.equal(b.speaker,'A');assert.equal(b.analogTextImport.assetId,'source');assert.equal(b.analogTextImport.referenceHidden,undefined);assert.equal(b.analogTextImport.needsReview,false);
 assert.ok(editBubbleText(doc,{...target,overlay:true},'前景を編集'));assert.equal(doc.manga.pages[0].page_overlay.bubbles[0].text,'前景を編集');
 const restored=parseMangaYaml(toStoredMangaYaml(doc));assert.equal(bubbleAt(restored,target).text,'こんにちは\n次の行');
 assert.equal(editBubbleText(doc,{...target,panelIndex:99},'誤更新'),false);
 doc.manga.pages[0].panels[1].layer={hidden:true};assert.equal(editBubbleText(doc,target,'誤更新'),false);
});
test('manually editing scenario text retains provenance without changing original pixels',()=>{
 const doc=fixture(),target={pageIndex:0,panelIndex:0,bubbleIndex:0,overlay:false},b=bubbleAt(doc,target);
 doc.manga.scenario={};b.scenarioMatch={status:'confirmed',sourceIds:['script-1'],ocrText:'元の文字',score:1};
 editBubbleText(doc,target,'修正');assert.equal(b.scenarioMatch.status,'manual');assert.deepEqual(b.scenarioMatch.sourceIds,[]);assert.deepEqual(b.scenarioMatch.resolvedSourceIds,['script-1']);assert.equal(b.scenarioMatch.ocrText,'元の文字');
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
