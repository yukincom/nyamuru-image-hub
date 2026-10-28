import { mergeSelectedPanels, splitPanel } from '../src/lib/panelTemplates.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { toMangaYaml, toStoredMangaYaml, parseMangaYaml } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { bubbleAt, bubbleVisible, toggleBubbleVisibility, editBubbleText, normalizePanelLayer, ownerItemLocked, panelGeometryLocked, panelLocked, panelVisible, panelFrameLocked, panelFrameVisible, panelFrameSegmentsOnInnerFrame, panelArtKeys, preservesLockedItems, reorderPanelArt, unlockPanelDescendants } from '../src/lib/panelLayers.ts';
import { panelHasElementAt } from '../src/lib/canvasGeometry.ts';
import { paintScene } from '../src/lib/paintDocument.ts';
import { bubbleArtIndices, canReorderBubbleLayers } from '../src/lib/panelLayers.ts';
import { qwenCompositionLayout } from '../src/lib/qwenComposition.ts';

const textStack = owner => bubbleArtIndices(owner).reverse().map(index=>owner.bubbles[index].text);

test('text stack starts in reading order and stores later moves without changing numbering or connections',async()=>{
 const doc=fixture(),p=doc.manga.pages[0].panels[0];
 p.bubbles=[{text:'1',shape:'normal'},{text:'2',shape:'normal',join_to:1},{text:'3',shape:'typeset'}];
 const before=structuredClone(p);
 assert.deepEqual(textStack(p),['1','2','3']);assert.deepEqual(p,before);
 assert.equal(reorderPanelArt(p,'bubble-0','bubble-1',false),false);assert.deepEqual(p,before,'a no-op must not allocate IDs or save order');
 assert.ok(reorderPanelArt(p,'bubble-2','bubble-0',false));
 assert.deepEqual(textStack(p),['3','1','2']);assert.deepEqual(p.bubbles.map(({layerId,...bubble})=>bubble),before.bubbles);
 const stored=parseMangaYaml(toStoredMangaYaml(doc)),snapshot=await restoreProjectSnapshot(await createProjectSnapshot(doc));
 for(const restored of [stored,snapshot]){
  const item=restored.manga.pages[0].panels[0];
  assert.deepEqual(textStack(item),['3','1','2']);
  assert.deepEqual(paintScene(item,100,[]).owners.filter(owner=>owner.kind==='bubble').reverse().map(owner=>owner.bubble.text),['3','1','2']);
  assert.deepEqual(item.bubbles.map(b=>b.text),['1','2','3']);assert.equal(item.bubbles[1].join_to,1);
 }
});

test('figure and text reorders preserve each other, and stable text IDs survive deletion and additions',()=>{
 const p=fixture().manga.pages[0].panels[0];p.bubbles=['1','2','3'].map(text=>({text,shape:'normal'}));
 reorderPanelArt(p,'bubble-2','bubble-0',false);
 const textIds=p.layer.artOrder.filter(id=>id.startsWith('bubble:'));
 reorderPanelArt(p,'figure-0','figure-1',false);
 assert.deepEqual(p.layer.artOrder.filter(id=>id.startsWith('bubble:')),textIds);assert.deepEqual(textStack(p),['3','1','2']);
 const figures=panelArtKeys(p);reorderPanelArt(p,'bubble-1','bubble-2',false);
 assert.deepEqual(panelArtKeys(p),figures);assert.deepEqual(textStack(p),['2','3','1']);
 p.bubbles.splice(0,1);p.bubbles.push({text:'4',shape:'normal'});
 assert.deepEqual(textStack(p),['2','3','4']);
});

test('page foreground text order uses page layer state and survives both persistence and render snapshots',async()=>{
 const doc=fixture(),page=doc.manga.pages[0],owner=page.page_overlay;
 owner.bubbles=['1','2','3'].map(text=>({text,shape:'normal'}));page.layer={directLocked:true};
 assert.ok(reorderPanelArt(owner,'bubble-2','bubble-0',false,page.layer));
 for(const restored of [parseMangaYaml(toStoredMangaYaml(doc)),await restoreProjectSnapshot(await createProjectSnapshot(doc))]){
  const next=restored.manga.pages[0];
  assert.equal(next.layer.directLocked,true);
  assert.deepEqual(textStack({...next.page_overlay,layer:next.layer}),['3','1','2']);
  assert.equal(next.panels[0].layer,undefined);
  assert.deepEqual(textStack(qwenCompositionLayout(restored.manga,0,0,'page').panels.find(entry=>entry.overlay).panel),['3','1','2']);
 }
});

test('text reorders keep character/depth groups and locks intact',()=>{
 const p=fixture().manga.pages[0].panels[0];p.figures[0].refId='a';
 p.bubbles=[{text:'1',shape:'handwritten',speakerId:'a'},{text:'2',shape:'handwritten',speakerId:'a'},{text:'3',shape:'normal'},{text:'4',shape:'handwritten',speakerId:'a',lettering_depth:'behind'}];
 assert.ok(canReorderBubbleLayers(p,'bubble-0','bubble-1'));
 for(const key of ['bubble-2','bubble-3','bubble-99','figure-0']){
  assert.equal(canReorderBubbleLayers(p,'bubble-0',key),false);
  if(key!=='figure-0')assert.equal(reorderPanelArt(p,'bubble-0',key,false),false);
 }
 const before=structuredClone(p);p.bubbles[1].nativeLocked=true;
 assert.equal(reorderPanelArt(p,'bubble-1','bubble-0',false),false);delete p.bubbles[1].nativeLocked;assert.deepEqual(p,before);
 assert.ok(reorderPanelArt(p,'bubble-1','bubble-0',false));
 const keys=paintScene(p,100,[]).owners.map(owner=>owner.key).reverse();
 assert.equal(keys.indexOf('bubble-1'),keys.indexOf('figure-0')-2);assert.equal(keys.indexOf('bubble-0'),keys.indexOf('figure-0')-1);
 assert.ok(reorderPanelArt(p,'bubble-0','figure-0',true));assert.equal(p.bubbles[0].lettering_depth,'behind');
});

test('merging and splitting retain saved text order with unique identities',()=>{
 const doc=fixture(),page=doc.manga.pages[0];
 for(const [index,p] of page.panels.entries()){
  p.bubbles=['1','2','3'].map(text=>({text:`${index}-${text}`,shape:'normal',bbox:{x:20,y:70+index*50,w:10,h:10}}));
  reorderPanelArt(p,'bubble-2','bubble-0',false);
 }
 // A split copy may carry the same IDs in another panel.
 page.panels[1].bubbles.forEach((bubble,index)=>{const previous=bubble.layerId;bubble.layerId=page.panels[0].bubbles[index].layerId;page.panels[1].layer.artOrder=page.panels[1].layer.artOrder.map(id=>id===`bubble:${previous}`?`bubble:${bubble.layerId}`:id);});
 mergeSelectedPanels(page,[0,1]);
 assert.deepEqual(textStack(page.panels[0]),['0-3','0-1','0-2','1-3','1-1','1-2']);
 assert.equal(new Set(page.panels[0].bubbles.map(b=>b.layerId)).size,6);
 splitPanel(page,0,'horizontal',3);
 const expected=['0-3','0-1','0-2','1-3','1-1','1-2'];
 for(const p of page.panels)assert.deepEqual(textStack(p),expected.filter(text=>p.bubbles.some(b=>b.text===text)));
});

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

test('文字と対応人物のレイヤー移動は前後指定だけを更新し、保存後も同じ順序を導出する',()=>{
 const doc=fixture(),panel=doc.manga.pages[0].panels[0];
 panel.figures[0].refId='a';panel.bubbles[0]={text:'ドン',shape:'handwritten',speakerId:'a',speaker:'A'};
 panel.bubbles.push({text:'セリフ',shape:'normal'});
 for(const owner of [panel,doc.manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',figures:structuredClone(panel.figures),bubbles:structuredClone(panel.bubbles)}]){
  const before=structuredClone(owner);
  assert.equal(reorderPanelArt(owner,'bubble-0','figure-0',false),false);
  assert.deepEqual(owner,before);
  assert.equal(reorderPanelArt(owner,'bubble-0','figure-1',true),false);
  assert.ok(reorderPanelArt(owner,'bubble-0','figure-0',true));
  assert.equal(owner.bubbles[0].lettering_depth,'behind');
  assert.deepEqual(owner.figures,before.figures);assert.deepEqual(owner.layer,before.layer);
  const changed=structuredClone(owner.bubbles[0]);delete changed.lettering_depth;assert.deepEqual(changed,before.bubbles[0]);
  assert.equal(reorderPanelArt(owner,'figure-0','bubble-0',false),false);
  assert.ok(reorderPanelArt(owner,'figure-0','bubble-0',true));
  assert.equal(owner.bubbles[0].lettering_depth,undefined);
  for(const patch of [{locked:true},{nativeLocked:true},{paint_overlay:{locked:true}}]){
   Object.assign(owner.bubbles[0],patch);assert.equal(reorderPanelArt(owner,'bubble-0','figure-0',true),false);
   for(const key of Object.keys(patch))delete owner.bubbles[0][key];
  }
  reorderPanelArt(owner,'bubble-0','figure-0',true);
 }
 const restored=parseMangaYaml(toStoredMangaYaml(doc));
 assert.equal(restored.manga.pages[0].page_overlay.bubbles[0].lettering_depth,'behind');
 const p=restored.manga.pages[0].panels[0],keys=paintScene(p,100,[]).owners.map(owner=>owner.key);
 assert.ok(keys.indexOf('bubble-0')<keys.indexOf('figure-0'));assert.ok(keys.indexOf('bubble-1')>keys.indexOf('figure-1'));
});
