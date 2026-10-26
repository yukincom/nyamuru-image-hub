import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { separateBubbleOriginals, needsBubbleOriginalSeparation } from '../src/lib/bubbleOriginals.ts';
import { attachRecognizedTextToPage, recognizedTextOwnerKey } from '../src/lib/localBridge.ts';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { paintScene, applyOwnerPaint, clearOwnerPaint, paintReferenceBox } from '../src/lib/paintDocument.ts';
import { imageAssetIds, imageSha256, validateImagePlacements } from '../src/lib/imagePlacement.ts';
import { paintOwnerLocked, paintOwnerPlacementLocked } from '../src/lib/paintLock.ts';
import { pickPaintLayer } from '../src/lib/paintLayerPicking.ts';
import { parseMangaYaml, toStoredMangaYaml, toSeparatedMangaYaml } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { resizePageCanvas } from '../src/lib/pageCanvas.ts';
import { qwenPanelImageLayers } from '../src/lib/qwenComposition.ts';

const blob=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,30,0,0,0,40,8,6,0,0,0])],{type:'image/png'});
const sha=await imageSha256(blob);
const asset={id:`image-${sha}`,storageId:'unused',sha256:sha,mediaType:'image/png',originalName:'source.png',widthPx:30,heightPx:40,byteLength:blob.size};
const deps={load:async()=>blob,prepare:async()=>structuredClone(asset)};
function imported(){
  const doc=createEmptyWorkspaceDocument(),page=doc.manga.pages[0];
  page.panels=[{id:1,shape:{type:'rect',x:0,y:0,w:210,h:297},bg:0,action:null,bubbles:[]}];
  const lines=[false,true].map((pageOverlay,index)=>({id:`l${index}`,text:`本文${index}`,bbox:{x:.2,y:.2,w:.1,h:.2},confidence:.5,needsReview:true,source:'baberu',vertical:true,pageOverlay}));
  const refs=new Map(lines.map(line=>[recognizedTextOwnerKey(line),{schemaVersion:1,sourceRegionId:line.id,assetId:'scan',sourceBBox:line.bbox,detectionSource:'baberu',recognitionEngine:'Baberu OCR',needsReview:true,referenceHidden:false,levelAdjusted:true}]));
  attachRecognizedTextToPage(page,lines,refs);
  resizePageCanvas(page,{w:297,h:210},'inner-frame');
  return doc;
}
test('new OCR import becomes independent topmost raster placements before any paint session',async()=>{
  const input=imported(),before=structuredClone(input),doc=await separateBubbleOriginals(input,deps),page=doc.manga.pages[0],panel=page.panels[0];
  assert.deepEqual(input,before);assert.equal(needsBubbleOriginalSeparation(doc),false);
  for(const [owner,images] of [[panel,panel.images],[page.page_overlay,page.images]]){
    assert.equal(images.length,1);assert.equal(images[0].paint.layers.length,1);assert.equal(images[0].paint.layers[0].kind,'raster');
    assert.equal(images[0].paint.layers[0].guide,undefined);assert.equal(images[0].paint.layers[0].visible,true);
    assert.equal(owner.bubbles[0].paint_overlay,undefined);assert.equal(owner.bubbles[0].analogTextImport.rasterLayerSeparated,true);
    assert.deepEqual(images[0].bbox,owner.bubbles[0].bbox);
  }
  const scene=paintScene(panel,100,doc.manga.image_assets,'color','panel');
  assert.equal(scene.owners.at(-1).kind,'original');assert.equal(scene.owners.find(o=>o.kind==='bubble').paint.layers.length,0);
  assert.equal(qwenPanelImageLayers(panel.images).ordinary.length,0);
  assert.equal(doc.manga.image_assets.length,1);validateImagePlacements(doc);
  assert.doesNotMatch(toSeparatedMangaYaml(doc),/bubbleOriginal|analogTextImport|image_assets/);
});
test('duplicated legacy bubbles sharing one source region each retain their own original',async()=>{
  const input=imported(),panel=input.manga.pages[0].panels[0];
  const duplicate=structuredClone(panel.bubbles[0]);duplicate.bbox.x+=20;panel.bubbles.push(duplicate);
  const result=await separateBubbleOriginals(input,deps),next=result.manga.pages[0].panels[0];
  assert.equal(next.images.length,2);assert.notEqual(next.images[0].id,next.images[1].id);
  assert.deepEqual(next.images.map(image=>image.bbox),next.bubbles.map(bubble=>bubble.bbox));
  assert.equal(await separateBubbleOriginals(result,{load:async()=>assert.fail('already separated')}),result);
});
test('native visibility, lock, movement and deletion do not change the independent original',async()=>{
  const doc=await separateBubbleOriginals(imported(),deps),panel=doc.manga.pages[0].panels[0],original=structuredClone(panel.images[0]);
  panel.bubbles[0].hidden=true;panel.bubbles[0].locked=true;panel.bubbles[0].bbox.x+=10;
  let scene=paintScene(panel,100,doc.manga.image_assets,'color','panel'),owner=scene.owners.at(-1);
  assert.equal(paintOwnerLocked(owner),false);assert.equal(owner.paint.layers.length,1);
  assert.equal(pickPaintLayer(scene,{x:owner.frame.x+owner.frame.w/2,y:owner.frame.y+owner.frame.h/2},0,()=>true)?.owner.kind,'original');
  panel.bubbles=[];assert.deepEqual(panel.images[0],original);
  scene=paintScene(panel,100,doc.manga.image_assets,'color','panel');assert.equal(scene.owners.at(-1).kind,'original');
});
test('locking or moving only the original never locks or reframes native vectors',async()=>{
  const doc=await separateBubbleOriginals(imported(),deps),panel=doc.manga.pages[0].panels[0],native=structuredClone(panel.bubbles[0]);
  panel.images[0].paint.layers[0].locked=true;panel.images[0].bbox.x+=7;
  const scene=paintScene(panel,100,doc.manga.image_assets,'color','panel');
  assert.equal(paintOwnerPlacementLocked(scene.owners.find(o=>o.kind==='bubble')),false);
  assert.equal(paintOwnerPlacementLocked(scene.owners.at(-1)),true);assert.deepEqual(panel.bubbles[0],native);
  panel.layer={locked:true};assert.ok(paintScene(panel,100,doc.manga.image_assets,'color','panel').owners.every(o=>o.inheritedLocked));
});
test('saved source edits and native reference frame survive legacy migration without flattening',async()=>{
  const old=imported(),panel=old.manga.pages[0].panels[0],bubble=panel.bubbles[0];
  old.manga.image_assets=[{...asset,storageId:'scan'}];
  bubble.paint_overlay={assetId:asset.id,crop:{x:0,y:0,w:30,h:40},opacity:.6,hidden:false,locked:false,
    paint:{version:1,width:30,height:40,dpi:100,guideInitialized:true,referenceFrame:{x:3,y:4,w:24,h:32},layers:[{id:'raw',name:'描き込んだ原画',kind:'raster',visible:false,locked:true,opacity:.7,blend:'multiply',image:{assetId:asset.id,crop:{x:0,y:0,w:30,h:40},bbox:{x:0,y:0,w:30,h:40}},strokes:[{tool:'pen',color:'#000000',size:2,points:[{x:2,y:3,pressure:1,time:0}]}]}]}};
  const saved=structuredClone(bubble.paint_overlay),frame=structuredClone(bubble.bbox),reference=paintReferenceBox(saved.paint,frame,saved.crop);
  const doc=await separateBubbleOriginals(old,deps),next=doc.manga.pages[0].panels[0];
  assert.deepEqual(next.images[0].paint,saved.paint);assert.equal(next.images[0].opacity,.6);
  assert.deepEqual(next.images[0].bbox,frame);assert.deepEqual(next.bubbles[0].bbox,reference);assert.equal(next.bubbles[0].paint_overlay,undefined);
});
test('independent original saves through the normal paint route and deletion is persistent',async()=>{
  const doc=await separateBubbleOriginals(imported(),deps),panel=doc.manga.pages[0].panels[0];
  const owner=paintScene(panel,100,doc.manga.image_assets,'color','panel').owners.at(-1),before=structuredClone(panel.bubbles);
  applyOwnerPaint(panel,owner,{...panel.images[0],bbox:{...owner.frame,x:owner.frame.x+5},paint:owner.paint});
  assert.deepEqual(panel.bubbles,before);assert.equal(panel.images[0].bbox.x,owner.frame.x+5);
  clearOwnerPaint(panel,owner);assert.equal(panel.images.length,0);
  const reload=parseMangaYaml(toStoredMangaYaml(doc));
  assert.equal(await separateBubbleOriginals(reload,{load:async()=>assert.fail('must not reload a deleted source')}),reload);
  assert.equal(reload.manga.pages[0].panels[0].images.length,0);assert.equal(reload.manga.pages[0].panels[0].bubbles[0].text,before[0].text);
});
test('originals survive project snapshot restore with asset remapping and no duplication',async()=>{
  const doc=await separateBubbleOriginals(imported(),deps),snapshot=await createProjectSnapshot(doc,async()=>blob),writes=[];
  const restored=await restoreProjectSnapshot(snapshot,async assets=>writes.push(...assets));
  assert.equal(writes.length,1);assert.equal(imageAssetIds(restored).size,1);
  assert.equal(restored.manga.pages[0].panels[0].images.length,1);assert.equal(restored.manga.pages[0].images.length,1);
  assert.equal(await separateBubbleOriginals(restored,deps),restored);validateImagePlacements(restored);
});
test('missing original fails atomically and never mutates source document',async()=>{
  const doc=imported(),before=structuredClone(doc);
  await assert.rejects(separateBubbleOriginals(doc,{load:async()=>null}),/画像が見つかりません/);assert.deepEqual(doc,before);
});
test('legacy deletion marker is respected without loading source pixels',async()=>{
  const doc=imported();for(const owner of [doc.manga.pages[0].panels[0],doc.manga.pages[0].page_overlay])owner.bubbles[0].analogTextImport.rasterLayerInitialized=true;
  const result=await separateBubbleOriginals(doc,{load:async()=>assert.fail('deleted source')});
  assert.equal(result.manga.pages[0].panels[0].images.length,0);assert.equal(needsBubbleOriginalSeparation(result),false);
});
test('an available crop repairs a same-hash asset whose previous cache is missing',async()=>{
  const input=imported();input.manga.image_assets=[{...asset,storageId:'missing-cache'}];
  const calls=[],result=await separateBubbleOriginals(input,{...deps,load:async id=>{calls.push(id);return id==='scan'?blob:null;}});
  assert.equal(result.manga.image_assets.length,1);assert.equal(result.manga.image_assets[0].storageId,'scan');
  assert.ok(calls.includes('missing-cache'));assert.equal(input.manga.image_assets[0].storageId,'missing-cache');
});
test('a legacy flat original retains crop and receives an independently unlockable raster layer',async()=>{
  const input=imported(),bubble=input.manga.pages[0].panels[0].bubbles[0];input.manga.image_assets=[{...asset,storageId:'scan'}];
  bubble.paint_overlay={assetId:asset.id,crop:{x:2,y:3,w:22,h:28},opacity:.6,hidden:true,locked:true};
  const result=await separateBubbleOriginals(input,deps),panel=result.manga.pages[0].panels[0],image=panel.images[0];
  assert.deepEqual(image.crop,bubble.paint_overlay.crop);assert.equal(image.opacity,.6);assert.equal(image.locked,false);assert.equal(image.hidden,false);
  assert.equal(image.paint.layers[0].locked,true);assert.equal(image.paint.layers[0].visible,false);
  const owner=paintScene(panel,100,result.manga.image_assets,'color','panel').owners.at(-1);
  assert.equal(paintOwnerLocked(owner),false);assert.equal(owner.paint.layers[0].locked,true);
});
test('hidden original uses only the raster eye, not a second image-level eye',async()=>{
  const input=imported();input.manga.pages[0].panels[0].bubbles[0].analogTextImport.referenceHidden=true;
  const result=await separateBubbleOriginals(input,deps),image=result.manga.pages[0].panels[0].images[0];
  assert.equal(image.hidden,false);assert.equal(image.paint.layers[0].visible,false);
  const list=readFileSync(new URL('../src/components/PlacedImageList.tsx',import.meta.url),'utf8');
  assert.match(list,/if\(image.paintScope\|\|image.bubbleOriginal\)return null/);
  const view=readFileSync(new URL('../src/components/PlacedImageView.tsx',import.meta.url),'utf8');
  assert.match(view,/!\(image.bubbleOriginal&&paint\) && source && asset/);
});
test('selecting a page original then drawing opens the page scene with the original owner',()=>{
  const source=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let declaration;const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='openPaint')declaration=node;ts.forEachChild(node,visit);};visit(ast);
  let session;const original={key:'original-raw',kind:'original',paint:{layers:[]}};
  const context={activePanel:0,activePage:0,selectedElement:{scope:'page',type:'image',index:0},imageImportBusy:false,paintSessionRef:{current:null},qwenPreparing:{current:false},
    documentRef:{current:{manga:{pages:[{panels:[]}]}}},endTextEdit(){},setTextTool(){},setZoomTool(){},setBubblePathTool(){},
    makePaintScene(_doc,_panel,_page,overlay){assert.equal(overlay,true);return {owners:[original]};},withPaintBleed:o=>o,paintBleedPx:0,
    setMobileStoryboardPane(){},setPaintToolsCollapsed(){},setPaintLayersCollapsed(){},selectedPaintOwner:()=>original.key,
    autoPaintResume:{current:null},setPaintSession:value=>{session=value;},setToast:error=>assert.fail(error),};
  const run=runInNewContext(ts.transpileModule(`(${declaration.initializer.getText(ast)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  assert.equal(run(),true);assert.equal(session.overlay,true);assert.equal(session.initialOwner,original.key);
});
test('every UI opening boundary runs separation before exposing the editor',()=>{
  const source=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
  assert.match(source,/separateBubbleOriginals\(await restorePortableProject\(selected.value\)\)/);
  assert.match(source,/separateBubbleOriginals\(await restoreProjectSnapshot\(loaded.snapshot\)\)/);
  assert.match(source,/separateBubbleOriginals\(startupWorkspace.document\)[\s\S]*?if\(!ready\)return/);
  assert.match(source,/setReady\(\{document:createEmptyWorkspaceDocument\(\),hasDocument:false\}\)/);
  assert.match(source,/if \(!hasDocument\) \{\s*return;\s*\}[\s\S]*?storeWorkspaceDocument\(localStorage/);
  assert.ok(source.indexOf('seriesMerge.document=await separateBubbleOriginals')<source.indexOf('replaceDocument(seriesMerge.document)'));
  const view=readFileSync(new URL('../src/components/PaintSceneView.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(view.slice(view.indexOf('if(owner.bubble)'),view.indexOf('const level=')),/SourceImage/);
});
