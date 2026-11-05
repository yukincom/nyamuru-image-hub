import {paintEditorSource as readPaintEditorSource} from './editorModuleSources.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'preact/jsx-runtime';
import { separateBubbleOriginals, needsBubbleOriginalSeparation } from '../src/lib/bubbleOriginals.ts';
import { attachRecognizedTextToPage, recognizedTextOwnerKey } from '../src/lib/localBridge.ts';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { paintScene, applyOwnerPaint, applyPaintOwnerLock, clearOwnerPaint, paintReferenceBox, paintAssetIds } from '../src/lib/paintDocument.ts';
import { imageAssetIds, imageSha256, validateImagePlacements, fitImageBox } from '../src/lib/imagePlacement.ts';
import { artworkLocked, paintOwnerLocked, paintOwnerPlacementLocked, paintLayerPatchAllowed } from '../src/lib/paintLock.ts';
import { pickPaintLayer } from '../src/lib/paintLayerPicking.ts';
import { parseMangaYaml, toStoredMangaYaml, toSeparatedMangaYaml } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { resizePageCanvas } from '../src/lib/pageCanvas.ts';
import { qwenPanelImageLayers } from '../src/lib/qwenComposition.ts';
import { moveBubbleToOwner, splitPanel, mergeSelectedPanels } from '../src/lib/panelTemplates.ts';
import { toggleBubbleVisibility } from '../src/lib/panelLayers.ts';

const blob=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,30,0,0,0,40,8,6,0,0,0])],{type:'image/png'});
const sha=await imageSha256(blob);
const asset={id:`image-${sha}`,storageId:'unused',sha256:sha,mediaType:'image/png',originalName:'source.png',widthPx:30,heightPx:40,byteLength:blob.size};
const deps={load:async()=>blob,prepare:async()=>structuredClone(asset)};

function placedImageFixture(){
  let cursor=0;const slots=[],effects=[],requests=[],exports={};
  const hooks={useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=value]},
    useEffect:(run,deps)=>{const i=cursor++;if(!slots[i]||deps.some((value,j)=>value!==slots[i].deps[j])){const before=slots[i];slots[i]={deps};effects.push(()=>{before?.cleanup?.();slots[i].cleanup=run()})}}};
  const modules={'preact/hooks':hooks,'preact/jsx-runtime':jsxRuntime,'../lib/imagePlacement':{fitImageBox},'../lib/paintDocument':{paintAssetIds},
    '../lib/figureCropStore':{loadFigureCropAsset:async()=>blob},'../lib/paintRenderer':{loadPaintImages:(paints,assets)=>new Promise((resolve,reject)=>requests.push({paints,assets,resolve,reject}))},'./PaintPreviewCanvas':{__esModule:true,default:'PaintPreview'}};
  const source=readFileSync(new URL('../src/components/PlacedImageView.tsx',import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'preact'}}).outputText,
    {exports,URL:{createObjectURL:()=>`blob:composite`,revokeObjectURL(){}},require:name=>{assert.ok(name in modules,name);return modules[name]}});
  const nodes=tree=>!tree||typeof tree!=='object'?[]:[tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  return {requests,render(image,assets=[asset]){cursor=0;const tree=exports.default({asset:assets[0],image,assets}),all=nodes(tree);return {canvas:all.find(node=>node.type==='PaintPreview'),img:all.find(node=>node.type==='img'),missing:all.find(node=>node.props?.class==='placed-image-missing')}} ,
    flush(){while(effects.length)effects.shift()()},dispose(){for(const slot of slots)slot?.cleanup?.()}};
}
const placedOriginal=()=>({id:'original-raster',assetId:asset.id,bbox:{x:0,y:0,w:30,h:40},crop:{x:0,y:0,w:30,h:40},opacity:1,bubbleOriginal:{name:'原画'},
  paint:{version:1,width:30,height:40,dpi:100,layers:[{id:'source',visible:true,strokes:[],image:{assetId:asset.id}}]}});
const decoded=(id='source')=>new Map([[id,{src:`blob:${id}`}]]);

test('placed original retains decoded resources across a whole-document clone and unrelated asset edits',async()=>{
  const f=placedImageFixture(),image=placedOriginal();f.render(image);f.flush();assert.equal(f.requests.length,1);
  const images=decoded();f.requests.shift().resolve(images);await Promise.resolve();assert.equal(f.render(image).canvas.props.images,images);
  const next=structuredClone(image),assets=[{...asset},{...asset,id:'unrelated',storageId:'elsewhere'}];
  assert.equal(f.render(next,assets).canvas?.props.images,images,'cloning a text edit must not remove the original canvas');
  f.flush();assert.equal(f.requests.length,0);assert.equal(images.get('source').src,'blob:source');
  next.paint.layers[0].strokes=[{tool:'pen'}];
  assert.equal(f.render(next,assets).canvas.props.paint,next.paint);f.flush();assert.equal(f.requests.length,0,'paint composition changes reuse source pixels');
  f.dispose();assert.equal(images.get('source').src,'');
});
test('placed original invalidates changed storage metadata and discards abandoned A-B-A loads',async()=>{
  const f=placedImageFixture(),image=placedOriginal();f.render(image);f.flush();
  const first=decoded('first');f.requests.shift().resolve(first);await Promise.resolve();f.render(image);
  const assetsB=[{...asset,storageId:'replacement'}];
  assert.equal(f.render(image,assetsB).canvas,undefined,'old pixels disappear before effects');f.flush();assert.equal(first.get('first').src,'');
  f.render(image);f.flush();assert.equal(f.requests.length,2);
  const stale=decoded('stale');f.requests.shift().resolve(stale);await Promise.resolve();assert.equal(stale.get('stale').src,'');assert.equal(f.render(image).canvas,undefined);
  const current=decoded('current');f.requests.shift().resolve(current);await Promise.resolve();assert.equal(f.render(image).canvas.props.images,current);
  assert.equal(f.render(image,[{...asset,byteLength:asset.byteLength+1}]).canvas,undefined,'changed validation metadata also invalidates pixels');
  f.flush();const late=decoded('late');f.dispose();f.requests.shift().resolve(late);await Promise.resolve();assert.equal(late.get('late').src,'');
});
test('a failed original load never falls back to its stale saved composite and can recover on replacement',async()=>{
  const f=placedImageFixture(),image=placedOriginal();f.render(image);f.flush();f.requests.shift().reject(Error('missing'));
  await Promise.resolve();await Promise.resolve();const failed=f.render(image);assert.equal(failed.canvas,undefined);assert.equal(failed.img,undefined);assert.ok(failed.missing);
  const assets=[{...asset,storageId:'restored'}];f.render(image,assets);f.flush();const images=decoded();f.requests.shift().resolve(images);await Promise.resolve();
  const recovered=f.render(image,assets);assert.equal(recovered.canvas.props.images,images);assert.equal(recovered.missing,undefined);f.dispose();
});
function imported(){
  const doc=createEmptyWorkspaceDocument(),page=doc.manga.pages[0];
  page.panels=[{id:1,shape:{type:'rect',x:0,y:0,w:210,h:297},bg:0,action:null,bubbles:[]}];
  const lines=[false,true].map((pageOverlay,index)=>({id:`l${index}`,text:`本文${index}`,bbox:{x:.2,y:.2,w:.1,h:.2},confidence:.5,needsReview:true,source:'baberu',vertical:true,pageOverlay}));
  const refs=new Map(lines.map(line=>[recognizedTextOwnerKey(line),{schemaVersion:1,sourceRegionId:line.id,assetId:'scan',sourceBBox:line.bbox,detectionSource:'baberu',recognitionEngine:'Baberu OCR',needsReview:true,referenceHidden:false,levelAdjusted:true}]));
  attachRecognizedTextToPage(page,lines,refs);
  resizePageCanvas(page,{w:297,h:210},'inner-frame');
  return doc;
}
test('explicitly visible OCR compatibility data becomes independent raster placements beside their native text before any paint session',async()=>{
  const input=imported(),before=structuredClone(input),doc=await separateBubbleOriginals(input,deps),page=doc.manga.pages[0],panel=page.panels[0];
  assert.deepEqual(input,before);assert.equal(needsBubbleOriginalSeparation(doc),false);
  for(const [owner,images] of [[panel,panel.images],[page.page_overlay,page.images]]){
    assert.equal(images.length,1);assert.equal(images[0].paint.layers.length,1);assert.equal(images[0].paint.layers[0].kind,'raster');
    assert.equal(images[0].paint.layers[0].guide,undefined);assert.equal(images[0].paint.layers[0].visible,true);
    assert.equal(owner.bubbles[0].paint_overlay,undefined);assert.equal(owner.bubbles[0].analogTextImport.rasterLayerSeparated,true);
    assert.deepEqual(images[0].bbox,owner.bubbles[0].bbox);
  }
  const scene=paintScene(panel,100,doc.manga.image_assets,'color','panel');
  assert.equal(scene.owners.find(owner=>owner.kind==='original').kind,'original');assert.equal(scene.owners.find(o=>o.kind==='bubble').paint.layers.length,0);
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
  panel.bubbles[0].hidden=true;panel.bubbles[0].nativeLocked=true;panel.bubbles[0].bbox.x+=10;
  let scene=paintScene(panel,100,doc.manga.image_assets,'color','panel'),owner=scene.owners.find(owner=>owner.kind==='original');
  assert.equal(paintOwnerLocked(owner),false);assert.equal(owner.paint.layers.length,1);
  assert.equal(pickPaintLayer(scene,{x:owner.frame.x+owner.frame.w/2,y:owner.frame.y+owner.frame.h/2},0,()=>true)?.owner.kind,'original');
  panel.bubbles=[];assert.deepEqual(panel.images[0],original);
  scene=paintScene(panel,100,doc.manga.image_assets,'color','panel');assert.equal(scene.owners.find(owner=>owner.kind==='original').kind,'original');
});
test('locking or moving only the original never locks or reframes native vectors',async()=>{
  const doc=await separateBubbleOriginals(imported(),deps),panel=doc.manga.pages[0].panels[0],native=structuredClone(panel.bubbles[0]);
  panel.images[0].paint.layers[0].locked=true;panel.images[0].bbox.x+=7;
  const scene=paintScene(panel,100,doc.manga.image_assets,'color','panel');
  assert.equal(paintOwnerPlacementLocked(scene.owners.find(o=>o.kind==='bubble')),false);
  assert.equal(paintOwnerPlacementLocked(scene.owners.find(owner=>owner.kind==='original')),true);assert.deepEqual(panel.bubbles[0],native);
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
  const owner=paintScene(panel,100,doc.manga.image_assets,'color','panel').owners.find(owner=>owner.kind==='original'),before=structuredClone(panel.bubbles);
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
  const owner=paintScene(panel,100,result.manga.image_assets,'color','panel').owners.find(owner=>owner.kind==='original');
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
test('new hidden originals keep their assets, and the saved layer eye owns visibility after separation',async()=>{
  const input=imported();
  for(const owner of [input.manga.pages[0].panels[0],input.manga.pages[0].page_overlay])owner.bubbles[0].analogTextImport.referenceHidden=true;
  const separated=await separateBubbleOriginals(input,deps),page=separated.manga.pages[0];
  assert.equal(separated.manga.image_assets.length,1);
  for(const image of [page.panels[0].images[0],page.images[0]]){
    assert.equal(image.hidden,false);assert.equal(image.paint.layers[0].visible,false);
    image.paint.layers[0].visible=true;image.paint.layers[0].locked=true;
  }
  for(const visible of [true,false]){
    page.panels[0].images[0].paint.layers[0].visible=visible;
    const snapshot=await createProjectSnapshot(separated,async()=>blob),restored=await restoreProjectSnapshot(snapshot,async()=>{});
    assert.equal(await separateBubbleOriginals(restored,{load:async()=>assert.fail('already separated')}),restored);
    assert.equal(restored.manga.pages[0].panels[0].images[0].paint.layers[0].visible,visible);
    assert.equal(restored.manga.pages[0].panels[0].images[0].paint.layers[0].locked,true);
    assert.equal(restored.manga.pages[0].images[0].paint.layers[0].visible,true);
    assert.equal(restored.manga.pages[0].panels[0].bubbles[0].analogTextImport.referenceHidden,true,'initial metadata is not a second live eye');
  }
});
test('missing initial visibility is not silently forced hidden',async()=>{
  const input=imported();delete input.manga.pages[0].panels[0].bubbles[0].analogTextImport.referenceHidden;
  const result=await separateBubbleOriginals(input,deps);
  assert.equal(result.manga.pages[0].panels[0].images[0].paint.layers[0].visible,true);
});
test('already separated data is not scanned to guess missing associations',async()=>{
  const doc=await separateBubbleOriginals(imported(),deps);
  delete doc.manga.pages[0].panels[0].bubbles[0].analogTextImport.originalImageId;
  assert.equal(needsBubbleOriginalSeparation(doc),false);
  assert.equal(await separateBubbleOriginals(doc,{load:async()=>assert.fail('must not decode')}),doc);
  assert.equal(doc.manga.pages[0].panels[0].bubbles[0].analogTextImport.originalImageId,undefined);
});

test('split, merge and owner transfer keep each linked original distinct, including colliding placement IDs',async()=>{
  const doc=await separateBubbleOriginals(imported(),deps),page=doc.manga.pages[0],panel=page.panels[0];
  panel.shape={type:'rect',x:0,y:0,w:100,h:100};
  panel.bubbles[0].bbox={x:40,y:20,w:20,h:30};panel.images[0].bbox={x:2,y:3,w:20,h:30};
  const sourceId=panel.images[0].id;
  assert.deepEqual(splitPanel(page,0,'vertical',{rowGapMm:2,columnGapMm:2}),[0,1]);
  assert.ok(page.panels.every(p=>p.bubbles[0].analogTextImport.originalImageId===p.images[0].id));
  validateImagePlacements(doc);
  mergeSelectedPanels(page,[0,1]);
  assert.equal(page.panels[0].bubbles.length,2);assert.equal(page.panels[0].images.length,2);
  const ids=page.panels[0].bubbles.map(b=>b.analogTextImport.originalImageId);assert.equal(new Set(ids).size,2);assert.ok(ids.includes(sourceId));
  validateImagePlacements(doc);
  // A pre-existing page original has the same ID but belongs to another bubble.
  page.images[0].id=ids[0];page.page_overlay.bubbles[0].analogTextImport.originalImageId=ids[0];
  const moved=moveBubbleToOwner(page,0,0,'page_overlay');assert.ok(moved);
  assert.notEqual(page.page_overlay.bubbles[moved.index].analogTextImport.originalImageId,ids[0]);
  assert.equal(page.panels[0].images.length,1);assert.equal(page.images.length,2);validateImagePlacements(doc);
  const restored=await restoreProjectSnapshot(await createProjectSnapshot(doc,async()=>blob),async()=>{});
  assert.deepEqual(restored.manga.pages[0].page_overlay.bubbles.map(b=>b.analogTextImport.originalImageId),page.page_overlay.bubbles.map(b=>b.analogTextImport.originalImageId));
  assert.deepEqual(restored.manga.pages[0].images.map(i=>i.id),page.images.map(i=>i.id));validateImagePlacements(restored);
});

test('native and original eyes remain independent, with group toggle applying all children atomically',async()=>{
  const doc=await separateBubbleOriginals(imported(),deps),panel=doc.manga.pages[0].panels[0],target={pageIndex:0,panelIndex:0,bubbleIndex:0,overlay:false};
  const sibling={...structuredClone(panel.images[0]),id:'original-sibling',bubbleOriginal:undefined,paintScope:'panel',paintStack:{below:`layer:${panel.images[0].id}`}};panel.images.push(sibling);
  toggleBubbleVisibility(doc,target);assert.equal(panel.bubbles[0].hidden,true);assert.equal(panel.images[0].paint.layers[0].visible,true);
  toggleBubbleVisibility(doc,target,true);assert.equal(panel.bubbles[0].hidden,true);assert.equal(panel.images[0].paint.layers[0].visible,false);assert.equal(sibling.paint.layers[0].visible,false);
  toggleBubbleVisibility(doc,target,true);assert.equal(panel.bubbles[0].hidden,false);assert.equal(panel.images[0].paint.layers[0].visible,true);assert.equal(sibling.paint.layers[0].visible,true);
  panel.images.pop();
  const owners=paintScene(panel,100,doc.manga.image_assets).owners;
  assert.deepEqual(owners.slice(-2).map(o=>o.key),['bubble-0',`original-${panel.images[0].id}`]);
  assert.equal(owners.at(-1).parentKey,'bubble-0');assert.equal(owners.at(-1).bubble,undefined);
  clearOwnerPaint(panel,owners.at(-1));assert.equal(panel.bubbles[0].analogTextImport.originalImageId,null);validateImagePlacements(doc);
});

test('validator rejects cross-owner, ordinary-image and multiply claimed original IDs',async()=>{
  const original=await separateBubbleOriginals(imported(),deps);
  for(const kind of ['missing','ordinary','duplicate']){
    const doc=structuredClone(original),panel=doc.manga.pages[0].panels[0];
    if(kind==='missing')panel.bubbles[0].analogTextImport.originalImageId=doc.manga.pages[0].images[0].id;
    if(kind==='ordinary')delete panel.images[0].bubbleOriginal;
    if(kind==='duplicate')panel.bubbles.push(structuredClone(panel.bubbles[0]));
    assert.throws(()=>validateImagePlacements(doc),/対応が不正/);
  }
});

test('folder lock is inherited, rejects child unlocks, and native child lock stays independent',async()=>{
  const doc=await separateBubbleOriginals(imported(),deps),panel=doc.manga.pages[0].panels[0];
  const source=readPaintEditorSource();
  const ast=ts.createSourceFile('PaintEditor.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let declaration;const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='layerAction')declaration=node;ts.forEachChild(node,visit);};visit(ast);
  const historyRef={current:{present:paintScene(panel,100,doc.manga.image_assets)}},commits=[];
  const act=runInNewContext(ts.transpileModule(`(${declaration.getText(ast)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,
    {busy:false,suspended:false,operation:{current:false},inputActive:{current:false},historyRef,commit:scene=>{commits.push(scene);historyRef.current.present=scene;}});
  const child=()=>historyRef.current.present.owners.find(o=>o.kind==='original'),native=()=>historyRef.current.present.owners.find(o=>o.kind==='bubble');
  act({type:'owner-lock',key:'bubble-0',locked:true,group:true});assert.equal(commits.length,1);
  assert.equal(child().locked,false);assert.equal(child().inheritedLocked,true);assert.equal(native().locked,true);
  assert.equal(paintLayerPatchAllowed(child(),child().paint.layers[0],{locked:false}),false);
  act({type:'owner-lock',key:child().key,locked:false});act({type:'owner-lock',key:'bubble-0',locked:false});assert.equal(commits.length,1,'no child can unlock its folder');
  for(const owner of historyRef.current.present.owners.filter(o=>o.kind==='bubble'||o.kind==='original'))applyPaintOwnerLock(panel,owner);
  assert.equal(artworkLocked(panel.images[0],panel.bubbles),true,'native canvas follows the parent lock without copying it onto the original');
  assert.equal(paintScene(panel,100,doc.manga.image_assets).owners.find(owner=>owner.kind==='original').inheritedLocked,true);
  act({type:'owner-lock',key:'bubble-0',locked:false,group:true});assert.equal(child().inheritedLocked,false);
  act({type:'owner-lock',key:'bubble-0',locked:true});assert.equal(native().locked,false);assert.equal(native().bubble.nativeLocked,true);assert.equal(paintOwnerLocked(child()),false);
  applyPaintOwnerLock(panel,native());assert.equal(panel.bubbles[0].nativeLocked,true);
  const restored=await restoreProjectSnapshot(await createProjectSnapshot(doc,async()=>blob),async()=>{});
  assert.equal(restored.manga.pages[0].panels[0].bubbles[0].nativeLocked,true);
  assert.doesNotMatch(toSeparatedMangaYaml(restored),/nativeLocked|originalImageId/);
  assert.equal(artworkLocked(restored.manga.pages[0].panels[0].images[0],restored.manga.pages[0].panels[0].bubbles),false);
});
test('selecting a page original then drawing opens the page scene with the original owner',()=>{
  const source=readFileSync(new URL('../src/components/workspace/workspacePaintSession.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let declaration;const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='openPaint')declaration=node;ts.forEachChild(node,visit);};visit(ast);
  let session;const original={key:'original-raw',kind:'original',paint:{layers:[]}};
  const context={activePanel:0,activePage:0,selectedElement:{scope:'page',type:'image',index:0},imageImportBusy:false,paintSessionRef:{current:null},qwenPreparing:{current:false},pendingLayerAction:{current:null},
    documentRef:{current:{manga:{pages:[{panels:[]}]}}},endTextEdit(){},setTextTool(){},setZoomTool(){},setBubblePathTool(){},
    makePaintScene(_doc,_panel,_page,overlay){assert.equal(overlay,true);return {owners:[original]};},withPaintBleed:o=>o,paintBleedPx:0,
    setMobileStoryboardPane(){},setPaintToolsCollapsed(){},setPaintLayersCollapsed(){},selectedPaintOwner:()=>original.key,
    autoPaintResume:{current:null},setPaintSession:value=>{session=value;},setToast:error=>assert.fail(error),};
  const run=runInNewContext(ts.transpileModule(`(${declaration.initializer.getText(ast)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  assert.equal(run(),true);assert.equal(session.overlay,true);assert.equal(session.initialOwner,original.key);
});
test('every UI opening boundary runs separation before exposing the editor',()=>{
  const source=readFileSync(new URL('../src/components/workspace/workspaceProjectFiles.ts',import.meta.url),'utf8');
  assert.match(source,/separateBubbleOriginals\(await restorePortableProject\(selected.value\)\)/);
  assert.match(source,/separateBubbleOriginals\(await restoreProjectSnapshot\(loaded.snapshot\)\)/);
  const creation=readFileSync(new URL('../src/components/workspace/newProjectCreation.ts',import.meta.url),'utf8');
  assert.ok(creation.includes('seriesMerge.document=await separateBubbleOriginals'));
  assert.ok(creation.indexOf('seriesMerge.document=await separateBubbleOriginals')<creation.indexOf('replaceDocument(seriesMerge.document)'));
  const view=readFileSync(new URL('../src/components/PaintSceneView.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(view.slice(view.indexOf('if(owner.bubble)'),view.indexOf('const level=')),/SourceImage/);
});

test('a hidden native text does not hide its own paint and the group eye includes visible paint children',async()=>{
 const doc=await separateBubbleOriginals(imported(),deps),panel=doc.manga.pages[0].panels[0],bubble=panel.bubbles[0],target={pageIndex:0,panelIndex:0,bubbleIndex:0,overlay:false};
 for(const image of panel.images)for(const layer of image.paint?.layers??[])layer.visible=false;
 const paint=structuredClone(panel.images[0].paint);paint.layers=paint.layers.map(layer=>({...layer,visible:true}));
 bubble.hidden=true;bubble.paint_overlay={...structuredClone(panel.images[0]),paint};
 toggleBubbleVisibility(doc,target,true);assert.equal(bubble.hidden,true);assert.equal(bubble.paint_overlay.paint.layers[0].visible,false);
 toggleBubbleVisibility(doc,target,true);assert.equal(bubble.hidden,false);assert.equal(bubble.paint_overlay.paint.layers[0].visible,true);
});
