import {paintLayerEditable,paintOwnerLocked} from '../src/lib/paintLock.ts';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { figureArtwork, setFigureArtwork, imageAssetIds, imageContents, changeImageCrop, createFrameArtwork, createImagePlacement, fitImageBox, imageSha256, resizeImageBox, validateImagePlacements } from '../src/lib/imagePlacement.ts';
import { parseMangaYaml, toMangaYaml, toStoredMangaYaml } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { beginFigureCropImport, collectFigureCropAssetIds, saveFigureCropAssets, loadFigureCropAsset, deleteFigureCropAssets, pruneFigureCropAssets, onFigureCropAssetsChanged } from '../src/lib/figureCropStore.ts';
import { resizePanelToBounds, translatePanel, panelFigureAt, panelHasElementAt } from '../src/lib/canvasGeometry.ts';
import { applyPanelTemplate, mergeSelectedPanels, splitPanel } from '../src/lib/panelTemplates.ts';
import { resizePageCanvas } from '../src/lib/pageCanvas.ts';
import { insertGeneratedPaintImage, generatedPaintName, hasAdoptedPaintImages, newPaintLayer, paintScene, withPaintBleed } from '../src/lib/paintDocument.ts';
import { imageCrop } from '../src/lib/imagePlacement.ts';
import { linkedTestDocument } from './fixtures/emptyTestDocument.ts';

// 見込み: 配置・保存・履歴の参照先を保ち、取り込みの未確定画像だけ一時保護する。
// 合格: 配置値と原本bytes、成功/中止後の実メモリストアを比較する。DOM・画像復号・ファイル選択は模擬。

const sample = linkedTestDocument;
const original = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' });
async function documentWithImage() {
  const doc = sample();
  const asset = { id: 'art', storageId: 'original', sha256: await imageSha256(original), mediaType: 'image/png', originalName: '原本.png', widthPx: 1, heightPx: 1, byteLength: original.size };
  doc.manga.image_assets = [asset];
  doc.manga.pages[0].images = [createImagePlacement(asset, { x: 20, y: 30, w: 40, h: 60 })];
  return doc;
}

test('fit uses the entire canvas without inferring subject bounds', () => {
  assert.deepEqual(fitImageBox({ w: 1000, h: 500 }, { x: 10, y: 20, w: 40, h: 60 }), { x: 10, y: 40, w: 40, h: 20 });
});

test('artwork corner resize preserves ratio and opposite corner without a paper-boundary cap', () => {
  const base = { startBox: { x: 10, y: 20, w: 40, h: 20 }, bounds: { x: 0, y: 0, w: 100, h: 80 }, paperRect: { width: 100, height: 80 }, canvas: { w: 100, h: 80 }, startClientX: 0, startClientY: 0 };
  for (const mode of ['nw', 'ne', 'sw', 'se']) {
    const box = resizeImageBox({ ...base, mode }, mode.includes('w') ? -500 : 500, mode.includes('n') ? -500 : 500);
    assert.equal(box.w / box.h, 2);
    assert.ok(box.w>100&&box.h>80,'original frame and page bounds do not cap expansion');
    assert.equal(mode.includes('w') ? box.x + box.w : box.x, mode.includes('w') ? 50 : 10);
    assert.equal(mode.includes('n') ? box.y + box.h : box.y, mode.includes('n') ? 40 : 20);
  }
  assert.deepEqual(resizeImageBox({ ...base, mode: 'move' }, 1000, -1000), { x: 1010, y: -980, w: 40, h: 20 });
});

test('binary originals deduplicate across placements and restore unchanged with independent crop and placement', async () => {
  const doc = await documentWithImage();
  const image = structuredClone(doc.manga.pages[0].images[0]);
  image.id = 'second'; image.crop = { x: 0.25, y: 0, w: 0.5, h: 1 }; image.bbox = { x: 70, y: 20, w: 10, h: 20 };
  doc.manga.pages[0].images.push(image);
  let loads = 0, saved;
  const snapshot = await createProjectSnapshot(doc, async () => { loads++; return original; });
  assert.equal(loads, 1);
  assert.equal(snapshot.assets.length, 1);
  const restored = await restoreProjectSnapshot(snapshot, async assets => { saved = assets; });
  assert.equal(saved.length, 1);
  assert.deepEqual(await saved[0].blob.arrayBuffer(), await original.arrayBuffer());
  assert.deepEqual(restored.manga.pages[0].images, doc.manga.pages[0].images);
  assert.notEqual(restored.manga.image_assets[0].storageId, 'original');
  assert.equal(restored.manga.image_assets[0].storageId, saved[0].id);
  assert.ok(collectFigureCropAssetIds(restored).includes(saved[0].id));
  assert.deepEqual(parseMangaYaml(toStoredMangaYaml(doc)).manga.image_assets, doc.manga.image_assets);
  assert.equal(parseMangaYaml(toMangaYaml(doc)).manga.image_assets, undefined);
  assert.equal(parseMangaYaml(toMangaYaml(doc)).manga.pages[0].images, undefined);
});

test('missing, altered or malformed originals fail before writing restored assets', async () => {
  const doc = await documentWithImage();
  await assert.rejects(createProjectSnapshot(doc, async () => new Blob(['changed'], { type: 'image/png' })), /原本/);
  const snapshot = await createProjectSnapshot(doc, async () => original);
  snapshot.assets[0].data = btoa('corrupt');
  await assert.rejects(restoreProjectSnapshot(snapshot, async () => assert.fail('must not write')), /原本/);
  doc.manga.pages[0].images[0].crop.x = 2;
  assert.throws(() => validateImagePlacements(doc), /配置情報/);
});

test('direct drawing markers keep their exact owner through validation, save and reopen', async()=>{
  const doc=await documentWithImage(),page=doc.manga.pages[0],asset=doc.manga.image_assets[0];
  const paint={version:1,width:1,height:1,dpi:100,guideInitialized:true,layers:[{...newPaintLayer('ページ直下'),strokes:[{tool:'pen',color:'#000000',size:1,points:[{x:0,y:0,pressure:1,time:0}]}]}]};
  const marker={...createFrameArtwork(asset,{x:4,y:5,w:1,h:1}),paint,paintScope:'page'};
  page.images.push(marker);
  validateImagePlacements(doc);
  assert.ok(imageContents(doc).includes(marker));assert.ok(imageAssetIds(doc).has(asset.id));
  const snapshot=await createProjectSnapshot(doc,async()=>original),restored=await restoreProjectSnapshot(snapshot,async()=>{});
  assert.deepEqual(restored.manga.pages[0].images,doc.manga.pages[0].images);
  assert.equal(restored.manga.pages[0].images.at(-1).paintScope,'page');

  for(const position of [{below:'layer:text-id'},{beforePanel:'layer:panel-id'}]){
    marker.paintStack=position;validateImagePlacements(doc);
    assert.deepEqual(parseMangaYaml(toStoredMangaYaml(doc)).manga.pages[0].images.at(-1).paintStack,position);
  }
  for(const position of [{below:'bubble-0'},{beforePanel:1},{beforePanel:''},{below:'layer:a',beforePanel:'layer:b'}]){
    marker.paintStack=position;assert.throws(()=>validateImagePlacements(doc),/位置/);
  }
  delete marker.paintStack;

  for(const mutate of [
    d=>{const item=d.manga.pages[0].images.pop();item.paintScope='panel';d.manga.pages[0].panels[0].images=[item];item.paintScope='page';},
    d=>{d.manga.pages[0].images.at(-1).paintScope='panel';},
    d=>{delete d.manga.pages[0].images.at(-1).paint;},
    d=>{d.manga.pages[0].images.at(-1).generationScope='page';},
  ]){const invalid=structuredClone(doc);mutate(invalid);assert.throws(()=>validateImagePlacements(invalid),/描画レイヤーの所属/);}
});

test('paper resize changes millimeters only and source pixels remain unchanged', async () => {
  const doc = await documentWithImage(), page = doc.manga.pages[0];
  const before = structuredClone(page.images[0]), asset = structuredClone(doc.manga.image_assets[0]);
  const old = { ...page.canvas }, size = { w: 257, h: 182 }, scale = Math.min(size.w / old.w, size.h / old.h);
  resizePageCanvas(page, size);
  assert.equal(page.images[0].bbox.w, before.bbox.w * scale);
  assert.equal(page.images[0].bbox.h, before.bbox.h * scale);
  assert.deepEqual(page.images[0].crop, before.crop);
  assert.deepEqual(doc.manga.image_assets[0], asset);
});


test('crop edits and reset retain the original pixel-to-mm transform without progressive shrink', () => {
  const image = { bbox: { x: 20, y: 30, w: 100, h: 100 }, crop: { x: 0, y: 0, w: 1000, h: 1000 } };
  const cropped = changeImageCrop(image, { x: 100, y: 200, w: 500, h: 700 });
  assert.deepEqual(cropped.bbox, { x: 30, y: 50, w: 50, h: 70 });
  assert.deepEqual(changeImageCrop(cropped, image.crop), image);
});


test('saving only includes used originals while keeping editor and Undo assets intact', async () => {
  const doc = await documentWithImage();
  doc.manga.pages[0].images = [];
  const snapshot = await createProjectSnapshot(doc, async () => assert.fail('unused originals are not read'));
  assert.deepEqual(snapshot.assets, []);
  assert.deepEqual(snapshot.document.manga.image_assets, []);
  assert.equal(doc.manga.image_assets.length, 1);
});


function importHandler(context) {
  const source = readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'importPlacedImage') initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return runInNewContext(ts.transpileModule(`(${initializer.getText(ast)})`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, {beginFigureCropImport, generatedPaintName, hasAdoptedPaintImages, setShowOriginalArtwork() {}, ...context});
}

// 見込み: 通常Appも全候補の準備後に1回だけ確定すれば、途中失敗で作品や通番を変えない。
// 合格: 成功は同じ親へ生成01/02を1回確定、2枚目の失敗は変更0・未確定資産を回収。範囲: 実App handler/配置、PNG準備・合成・保存は模擬。
test('normal App adopts a candidate batch atomically and cleans up a failed batch',async()=>{
 for(const failSecond of [false,true]){
  const doc=await documentWithImage(),before=structuredClone(doc),owner=paintScene(doc.manga.pages[0].panels[0],100,[]).owners.find(item=>item.kind==='figure');
  owner.paint.folders=[{id:'outer',name:'親',position:0},{id:'inner',name:'候補',parentFolderId:'outer',position:0}];
  const target={document:doc,pageIndex:0,panelIndex:0,scope:'panel',figureIndex:0,box:owner.frame,generatedOwner:owner,generatedFolderId:'inner',generatedAdoption:{jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',indices:[2,4]}};
  const writes=[],removed=[],commits=[],context={
   placedImageInput:{current:null},imageImportTarget:{current:null},documentRef:{current:doc},activePageRef:{current:0},activePanelRef:{current:0},lastHistoryPush:{current:0},
   setImageImportBusy(){},cloneDocument:structuredClone,createFrameArtwork,createImagePlacement,setFigureArtwork,insertGeneratedPaintImage,generatedPaintName,hasAdoptedPaintImages,
   prepareImageAsset:async file=>{
    if(failSecond&&file.name==='two.png')throw Error('second candidate decode failed');
    const key=file.name==='one.png'?'a':file.name==='two.png'?'b':'c';
    return {id:key,storageId:`cache-${key}`,sha256:key.repeat(64),mediaType:'image/png',originalName:file.name,widthPx:1,heightPx:1,byteLength:file.size};
   },
   humanPoseOwnerImage:async()=>original,loadFigureCropAsset:async()=>null,saveFigureCropAssets:async rows=>writes.push(...rows),deleteFigureCropAssets:async ids=>removed.push(...ids),
   setDocument:next=>{commits.push(next);context.documentRef.current=next;},setSelectedElement(){},setToast(){},File,Error,
  };
  const pending=importHandler(context)([new File(['first'],'one.png'),new File(['second'],'two.png')],target);
  if(failSecond){
   await assert.rejects(pending,/second candidate decode failed/);
   assert.equal(commits.length,0);assert.equal(context.documentRef.current,doc);assert.deepEqual(removed,['cache-a']);
  }else{
   await pending;assert.equal(commits.length,1);assert.equal(writes.length,3);assert.deepEqual(removed,[]);
   const next=commits[0],added=next.manga.pages[0].panels[0].figures[0].artwork.paint.layers.filter(layer=>layer.generation);
   assert.deepEqual(added.map(layer=>[layer.name,layer.folderId,layer.generation.candidateIndex]),[['生成 01','inner',2],['生成 02','inner',4]]);
   assert.equal(next.manga.generated_image_sequence,2);
  }
  assert.deepEqual(doc,before);
 }
});

test('real import handler repairs a missing original with a fresh cache ID and respects current page selection', async () => {
  const doc = await documentWithImage();
  const stored = [], selections = [], notices = [];
  const prepared = { ...doc.manga.image_assets[0], storageId: 'original-recovered' };
  const context = {
    placedImageInput: { current: { value: 'file' } },
    imageImportTarget: { current: { document: doc, pageIndex: 0, panelIndex: 0, scope: 'page', box: {x:0,y:0,w:10,h:10} } },
    documentRef: { current: doc }, activePageRef: { current: 1 }, lastHistoryPush: { current: 0 },
    setImageImportBusy: () => {}, prepareImageAsset: async () => prepared,
    loadFigureCropAsset: async () => null, saveFigureCropAssets: async assets => stored.push(...assets),
    deleteFigureCropAssets: async () => {}, cloneDocument: structuredClone, createFrameArtwork, createImagePlacement,
    setDocument: next => { context.documentRef.current = next; }, setSelectedElement: value => selections.push(value),
    setToast: value => notices.push(value), Error,
  };
  await importHandler(context)(new File([original], '原本.png', {type:original.type}));
  assert.equal(stored.length, 1);
  assert.deepEqual(await stored[0].blob.arrayBuffer(), await original.arrayBuffer());
  assert.equal(context.documentRef.current.manga.image_assets.length, 1);
  assert.equal(context.documentRef.current.manga.image_assets[0].storageId, 'original-recovered');
  assert.equal(context.documentRef.current.manga.pages[0].images.length, 2);
  assert.equal(doc.manga.image_assets[0].storageId, 'original');
  assert.equal(selections.length, 0);
  assert.match(notices[0], /読み込みました/);
});

// 見込み: 取込中の回収を止め、成功なら作品へ引き継ぎ、失敗/作品切替なら解放する。
// 合格: 待機中のBlob保持と終了後の有無を実handler・storeで検査する。画像prepareと画面通知だけ模擬。
test('import completion, failure and stale targets release pending protection without losing committed images', async () => {
  for(const outcome of ['commit','failure','stale']){
    const doc=await documentWithImage(),id=`original-inflight-${outcome}`,prepared={...doc.manga.image_assets[0],storageId:id};
    doc.manga.image_assets=[];doc.manga.pages[0].images=[];
    let proceed,started,cleanup;
    const gate=new Promise(resolve=>proceed=resolve),entered=new Promise(resolve=>started=resolve);
    const notices=[],context={
      placedImageInput:{current:{value:''}},imageImportTarget:{current:{document:doc,pageIndex:0,panelIndex:0,scope:'page',box:{x:0,y:0,w:10,h:10}}},
      documentRef:{current:doc},activePageRef:{current:0},activePanelRef:{current:0},lastHistoryPush:{current:0},setImageImportBusy(){},
      prepareImageAsset:async()=>{await saveFigureCropAssets([{id,blob:original}]);started();await gate;if(outcome==='failure')throw Error('synthetic import failure');return prepared;},
      loadFigureCropAsset,saveFigureCropAssets,deleteFigureCropAssets,cloneDocument:structuredClone,createFrameArtwork,createImagePlacement,
      setDocument:next=>{context.documentRef.current=next;},setSelectedElement(){},setToast:value=>notices.push(value),Error,
    };
    const unsubscribe=onFigureCropAssetsChanged(()=>{cleanup=pruneFigureCropAssets(collectFigureCropAssetIds(context.documentRef.current));});
    try{
      const running=importHandler(context)(new File([original],'inflight.png',{type:original.type}));await entered;
      assert.equal(await pruneFigureCropAssets([]),0);assert.equal(await loadFigureCropAsset(id),original);
      if(outcome==='stale')context.documentRef.current=structuredClone(doc);
      proceed();await running;await cleanup;
      assert.equal(Boolean(await loadFigureCropAsset(id)),outcome==='commit',outcome);
      if(outcome==='commit')assert.equal(context.documentRef.current.manga.pages[0].images.at(-1).assetId,prepared.id);
      else assert.match(notices.at(-1),outcome==='failure'?/synthetic import failure/:/作品が変更/);
    }finally{proceed();unsubscribe();await deleteFigureCropAssets([id]);}
  }
});

// 見込み: 不要な復号画像を履歴用に抱え続けない。合格: commit後は未使用Imageのsrcと所有Setを解放し、使用中の画像を保持。範囲: 実PaintEditor関数、Imageは模擬。
test('paint commit releases discarded decoded images from the ownership set', () => {
  const source=readFileSync(new URL('../src/components/PaintEditor.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('PaintEditor.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const editor=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='PaintEditor');
  const code=editor.body.statements.filter(node=>ts.isFunctionDeclaration(node)&&['releaseImages','commit'].includes(node.name?.text)).map(node=>node.getText(ast)).join('\n');
  const keep={src:'keep'},discard={src:'discard'},before={owners:[]},next={owners:[{key:'background',paint:{layers:[{image:{assetId:'keep'}}]}}]};
  const ownedImages={current:new Set([keep,discard])},imagesRef={current:new Map([['keep',keep],['discard',discard]])},historyRef={current:{past:[],present:before}};
  const context={ownedImages,imagesRef,historyRef,initial:before,ownerKey:'background',selection:null,sharedHistory:{checkpoint(){}},
    snapshot:()=>({imports:[],stageImports:[]}),setImports(){},setStageImports(){},paintAssetIds:paint=>paint.layers.map(layer=>layer.image.assetId),
    setHistory:update=>{historyRef.current=update(historyRef.current);},setImages(){},Map,Set,next};
  runInNewContext(ts.transpileModule(code+'\ncommit(next);',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  assert.equal(discard.src,'');assert.equal(keep.src,'keep');assert.deepEqual([...ownedImages.current],[keep]);assert.deepEqual([...imagesRef.current.keys()],['keep']);
});


test('nested artwork saves and restores every owner using one unchanged original', async () => {
  const doc = await documentWithImage(), page = doc.manga.pages[0];
  const [image] = page.images; delete page.images;
  page.panels[0].images = [image];
  page.panels[0].background_images = [structuredClone(image)];
  const figure = page.panels[0].figures[0], identity = { name: figure.name, refId: figure.refId, action: '目線を下げる' };
  figure.action = identity.action;
  setFigureArtwork(figure, { ...image, bbox: { x: 2, y: 3, w: 8, h: 8 } });
  page.page_overlay = { frame: false, layer: 'above_panel_frames', bubbles: [], figures: [structuredClone(figure)] };
  assert.deepEqual({ name: figure.name, refId: figure.refId, action: figure.action }, identity);
  assert.equal(imageContents(doc).length, 4);
  const snapshot = await createProjectSnapshot(doc, async () => original);
  assert.equal(snapshot.document.manga.image_assets.length, 1);
  assert.equal(snapshot.assets.length, 1);
  let written;
  const restored = await restoreProjectSnapshot(snapshot, async rows => { written = rows; });
  assert.deepEqual(await written[0].blob.arrayBuffer(), await original.arrayBuffer());
  assert.deepEqual(restored.manga.pages, doc.manga.pages);
  const exported = parseMangaYaml(toMangaYaml(doc));
  assert.equal(exported.manga.pages[0].panels[0].images, undefined);
  assert.equal(exported.manga.pages[0].panels[0].background_images, undefined);
  assert.equal(exported.manga.pages[0].panels[0].figures[0].artwork, undefined);
  assert.equal(exported.manga.pages[0].page_overlay.figures[0].artwork, undefined);
  assert.equal(exported.manga.pages[0].panels[0].figures[0].action, identity.action);
  for (const bad of [
    d => { d.manga.pages[0].panels[0].images[0].assetId = 'absent'; },
    d => { d.manga.pages[0].panels[0].background_images[0].assetId = 'absent'; },
    d => { delete d.manga.pages[0].panels[0].figures[0].bbox; },
    d => { d.manga.pages[0].page_overlay.figures[0].artwork.crop.w = 500; },
  ]) {
    const broken = structuredClone(doc); bad(broken);
    await assert.rejects(createProjectSnapshot(broken, async () => assert.fail('invalid references must fail before loading')), /配置情報/);
  }
});

function artworkPanel() {
  return { id: 1, shape: { type: 'rect', x: 0, y: 0, w: 100, h: 100 }, bg: -1, action: null, bubbles: [], figures: [], images: [] };
}
function imageAt(id, bbox) {
  return { id, assetId: 'art', bbox, crop: { x: 0, y: 0, w: 400, h: 600 }, opacity: 1, hidden: false, locked: false };
}

test('panel and paper transforms preserve art aspect, source pixels and owner hit targets', () => {
  const panel = artworkPanel();
  panel.images.push(imageAt('one', { x: 20, y: 20, w: 20, h: 30 }));
  const figure = { name: '人物', bbox: { x: 60, y: 60, w: 20, h: 30 } };
  setFigureArtwork(figure, imageAt('figure', figure.bbox)); panel.figures.push(figure);
  translatePanel(panel, 5, 7);
  assert.deepEqual(panel.images[0].bbox, { x: 25, y: 27, w: 20, h: 30 });
  assert.equal(panelHasElementAt(panel, 30, 30), true);
  panel.images[0].hidden = true;
  assert.equal(panelHasElementAt(panel, 30, 30), false);
  resizePanelToBounds(panel, { x: 5, y: 7, w: 200, h: 50 });
  for (const image of [panel.images[0], figureArtwork(figure)]) {
    assert.equal(image.bbox.w / image.bbox.h, 2 / 3);
    assert.deepEqual(image.crop, { x: 0, y: 0, w: 400, h: 600 });
  }
  const page = { page: 1, canvas: { w: 210, h: 297 }, panels: [panel] };
  const before = structuredClone(panel.images[0]);
  resizePageCanvas(page, { w: 257, h: 182 });
  assert.equal(panel.images[0].bbox.w, before.bbox.w * (182 / 297));
  assert.deepEqual(panel.images[0].crop, before.crop);
});

test('split and merge preserve clipped artwork without multiplying or dropping images', () => {
  const panel = artworkPanel(), page = { page: 1, canvas: { w: 210, h: 297 }, panels: [panel] };
  panel.images = [imageAt('cross', { x: 30, y: 20, w: 40, h: 60 }), imageAt('right', { x: 80, y: 20, w: 10, h: 15 })];
  panel.figures = [{ name: '人物', action: '座る' }];
  setFigureArtwork(panel.figures[0], panel.images[0]);
  splitPanel(page, 0, 'vertical', { rowGapMm: 4, columnGapMm: 4 });
  assert.deepEqual(page.panels.map(p => p.images.length), [2, 1]);
  assert.equal(page.panels[0].images[0].bbox.x, 30);
  mergeSelectedPanels(page, [0, 1]);
  assert.equal(page.panels[0].images.length, 2);
  assert.equal(page.panels[0].figures.length, 1);
  const second = structuredClone(page.panels[0]);
  second.figures[0].artwork.opacity = 0.5;
  second.images[0].bbox.x += 1;
  page.panels.push(second);
  mergeSelectedPanels(page, [0, 1]);
  assert.equal(page.panels[0].figures.length, 2, 'different artwork must not coalesce');
  assert.equal(page.panels[0].images.length, 4, 'independent placements must be retained');
  assert.equal(new Set(page.panels[0].images.map(i => i.id)).size, 4);
});

test('collapsing a template retains each panel image and each distinct figure artwork', () => {
  const left = artworkPanel(), right = artworkPanel();
  left.images = [imageAt('one', { x: 5, y: 5, w: 20, h: 30 })];
  right.images = [imageAt('two', { x: 5, y: 5, w: 20, h: 30 })];
  left.figures = [{ name: '同じ人物' }]; right.figures = [{ name: '同じ人物' }];
  setFigureArtwork(left.figures[0], left.images[0]);
  setFigureArtwork(right.figures[0], { ...right.images[0], opacity: 0.5 });
  const page = { page: 1, canvas: { w: 210, h: 297 }, panels: [left, right] };
  applyPanelTemplate(page, { shapes: [{ type: 'rect', x: 10, y: 10, w: 190, h: 277 }] });
  assert.equal(page.panels[0].images.length, 2);
  assert.equal(page.panels[0].figures.length, 2);
});

test('dragging split art keeps the source position and crop overflow does not jump', () => {
  for (const box of [{ x: 30, y: 20, w: 40, h: 60 }, { x: -20, y: -10, w: 250, h: 330 }]) {
    const canvas = { w: 210, h: 297 };
    const interaction = { mode: 'move', startBox: box, bounds: {x:0,y:0,...canvas}, canvas, paperRect: { width: 210, height: 297 }, startClientX: 0, startClientY: 0 };
    assert.deepEqual(resizeImageBox(interaction, 0, 0), box);
    if (box.x > 0) assert.equal(resizeImageBox(interaction, 1, 0).x, 31);
  }
});

test('real import places panel art inside its owner and replaces a figure without an extra image', async () => {
  for (const scope of ['panel', 'page_overlay']) {
    for (const replacement of [false, true]) {
      if (scope === 'page_overlay' && !replacement) continue;
      const doc = await documentWithImage();
      const page = doc.manga.pages[0]; delete page.images;
      const figure = structuredClone(page.panels[0].figures[0]); figure.action = '座る';
      page.page_overlay = { frame: false, layer: 'above_panel_frames', figures: [figure] };
      const selections = [];
      const context = {
        placedImageInput: { current: { value: '' } },
        imageImportTarget: { current: { document: doc, pageIndex: 0, panelIndex: 0, scope, ...(replacement ? {figureIndex: 0} : {}), box: {x:20,y:30,w:40,h:60} } },
        documentRef: { current: doc }, activePageRef: { current: 0 }, activePanelRef: { current: 0 }, lastHistoryPush: { current: 0 },
        setImageImportBusy() {}, prepareImageAsset: async () => doc.manga.image_assets[0],
        loadFigureCropAsset: async () => original, saveFigureCropAssets: async () => {}, deleteFigureCropAssets: async () => {},
        cloneDocument: structuredClone, createFrameArtwork, createImagePlacement, setFigureArtwork,
        setDocument: next => { context.documentRef.current = next; }, setSelectedElement: s => selections.push(s), setToast() {}, Error,
      };
      await importHandler(context)(new File([original], '原本.png', {type:original.type}));
      const updated = context.documentRef.current.manga.pages[0];
      assert.equal(updated.images, undefined);
      const owner = scope === 'panel' ? updated.panels[0] : updated.page_overlay;
      if (replacement) { assert.ok(owner.figures[0].artwork); assert.equal(owner.images, undefined); assert.equal(owner.figures[0].refId, (scope === 'panel' ? page.panels[0] : page.page_overlay).figures[0].refId); }
      else { assert.equal(owner.background_images.length, 1); assert.equal(owner.images, undefined); }
      const actualBox = replacement ? owner.figures[0].bbox : owner.background_images[0].bbox;
      assert.deepEqual(actualBox, context.imageImportTarget.current?.box ?? {x:20,y:30,w:40,h:60});
      assert.deepEqual(structuredClone(selections), [replacement ? {type: 'figure', index: 0, scope} : null]);
    }
  }
});


test('backgrounds keep their source transform through move, resize, split, merge and template collapse', () => {
  const panel = artworkPanel();
  panel.background_images = [imageAt('background', {x:0,y:0,w:100,h:100})];
  const sourceCrop = structuredClone(panel.background_images[0].crop);
  const page = {page:1,canvas:{w:210,h:297},panels:[panel]};
  translatePanel(panel, 4, 5);
  assert.deepEqual(panel.background_images[0].bbox, {x:4,y:5,w:100,h:100});
  resizePanelToBounds(panel, {x:4,y:5,w:80,h:80});
  assert.deepEqual(panel.background_images[0].bbox, {x:4,y:5,w:80,h:80});
  const beforeSplit = structuredClone(panel.background_images[0]);
  splitPanel(page, 0, 'vertical', {rowGapMm:4,columnGapMm:4});
  assert.equal(page.panels.length,2);
  for (const part of page.panels) {
    assert.deepEqual(part.background_images[0].bbox,beforeSplit.bbox);
    assert.deepEqual(part.background_images[0].crop,sourceCrop);
  }
  mergeSelectedPanels(page,[0,1]);
  assert.equal(page.panels[0].background_images.length,1);
  const second = artworkPanel();
  second.background_images = [imageAt('second-background',{x:100,y:0,w:50,h:60})];
  page.panels.push(second);
  applyPanelTemplate(page,{shapes:[{type:'rect',x:0,y:0,w:200,h:200}]});
  assert.equal(page.panels[0].background_images.length,2);
  const beforePaper = structuredClone(page.panels[0].background_images);
  resizePageCanvas(page,{w:105,h:148.5});
  page.panels[0].background_images.forEach((image,index)=>{
    assert.equal(image.bbox.w,beforePaper[index].bbox.w / 2);
    assert.deepEqual(image.crop,sourceCrop);
  });
});


test('context menus hit the top visible person even in a passive panel, with background elsewhere', () => {
  const panel = artworkPanel();
  panel.figures = [{bbox:{x:10,y:10,w:30,h:40}}, {bbox:{x:20,y:20,w:30,h:40}}];
  assert.equal(panelFigureAt(panel,25,25),1);
  assert.equal(panelFigureAt(panel,15,15),0);
  assert.equal(panelFigureAt(panel,90,90),undefined);
  assert.equal(panelFigureAt(panel,25,25,false),undefined);
  setFigureArtwork(panel.figures[1],imageAt('person',panel.figures[1].bbox));
  assert.equal(panelFigureAt(panel,25,25,false),1);
  panel.figures[1].artwork.hidden = true;
  assert.equal(panelFigureAt(panel,25,25),0);
  panel.figures[0].bbox.x = -10;
  assert.equal(panelFigureAt(panel,-5,15),undefined, 'clipped parts must not steal another panel context');
});


function componentHandler(file, name, context) {
  const source=readFileSync(new URL(`../src/components/${file}.tsx`,import.meta.url),'utf8');
  const ast=ts.createSourceFile(`${file}.tsx`,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expression;
  function visit(node){
    if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)expression=node.initializer.getText(ast);
    if(ts.isFunctionDeclaration(node)&&node.name?.text===name)expression=node.getText(ast);
    ts.forEachChild(node,visit);
  }
  visit(ast);assert.ok(expression, name);
  return runInNewContext(ts.transpileModule(`(${expression})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,Object.assign(context,{generatedPaintName,hasAdoptedPaintImages}));
}

test('central image entry follows the selected owner or the active paint controller',()=>{
  const calls=[];
  const context={imageImportBusy:false,projectOperation:{current:false},qwenGeneration:null,paintSessionRef:{current:null},paintController:{current:{chooseImage:key=>calls.push(key)}},selectedPaintOwner:()=>context.selectedElement?.type==='figure'?`figure-${context.selectedElement.index}`:context.selectedElement?.type==='bubble'?`bubble-${context.selectedElement.index}`:'background',selectedElement:null,activePanel:2,activePage:1,choosePlacedImage:(...args)=>calls.push(args)};
  const choose=componentHandler('App','chooseOwnerImage',context);
  choose();context.selectedElement={type:'figure',index:3};choose();
  context.selectedElement={scope:'page_overlay',type:'bubble',index:4};choose();
  context.paintSessionRef.current={pageIndex:1,panelIndex:2,overlay:true};choose();
  assert.deepEqual(calls,[['panel',undefined,2,1,undefined],['panel',3,2,1,undefined],['page_overlay',undefined,2,1,4],'bubble-4']);
  context.projectOperation.current=true;choose();assert.equal(calls.length,4);
});

test('central bubble import keeps its text and source while placing artwork inside its frame',async()=>{
  for(const scope of ['panel','page_overlay'])for(const generated of [false,true]){
    const doc=await documentWithImage(),page=doc.manga.pages[0];
    const bubble={text:'確認用',shape:'normal',speaker:'人物',bbox:{x:20,y:30,w:40,h:60},...(generated?{locked:true,nativeLocked:true,paint_overlay:{locked:true}}:{})};
    page.panels[0].bubbles=[structuredClone(bubble)];page.page_overlay={frame:false,layer:'above_panel_frames',bubbles:[structuredClone(bubble)]};
    const context={placedImageInput:{current:{value:''}},imageImportTarget:{current:{document:doc,pageIndex:0,panelIndex:0,scope,bubbleIndex:0,box:bubble.bbox}},documentRef:{current:doc},activePageRef:{current:0},activePanelRef:{current:0},lastHistoryPush:{current:0},setImageImportBusy(){},prepareImageAsset:async()=>doc.manga.image_assets[0],loadFigureCropAsset:async()=>original,saveFigureCropAssets:async()=>{},deleteFigureCropAssets:async()=>{},cloneDocument:structuredClone,createFrameArtwork,createImagePlacement,setFigureArtwork,setDocument:next=>{context.documentRef.current=next;},setSelectedElement(){},setToast(){},Error};
    if(generated){context.imageImportTarget.current.generatedOwner=paintScene({...page.panels[0],bubbles:[{...bubble,paint_overlay:undefined}]},100,doc.manga.image_assets).owners.find(o=>o.kind==='bubble');context.imageImportTarget.current.generatedOwner.paint.layers.push({...newPaintLayer('元画像'),locked:true,image:{assetId:'art',crop:{x:0,y:0,w:1,h:1},bbox:{x:0,y:0,w:30,h:30}}});Object.assign(context,{insertGeneratedPaintImage,humanPoseOwnerImage:async()=>original,File});}
    await importHandler(context)(new File([original],'原本.png',{type:original.type}),generated?context.imageImportTarget.current:undefined);
    const resultPage=context.documentRef.current.manga.pages[0];
    const result=(scope==='panel'?resultPage.panels[0]:resultPage.page_overlay).bubbles[0];
    assert.ok(result.paint_overlay);assert.equal(result.text,bubble.text);assert.equal(result.speaker,bubble.speaker);assert.deepEqual(result.bbox,bubble.bbox);
    if(generated){assert.equal(result.locked,true);assert.equal(result.nativeLocked,true);assert.equal(result.paint_overlay.locked,true);assert.equal(result.paint_overlay.paint.layers.length,2);}
  }
});

test('manual replacement uses its latched owner and generation adds above the retained locked guide',async()=>{
  const scene=paintScene({id:1,shape:{type:'rect',x:0,y:0,w:30,h:40},bg:0,action:null,bubbles:[],figures:[{name:'確認用',action:'座る',refId:'person',bbox:{x:2,y:3,w:10,h:20}}]},100,[]);
  scene.owners=scene.owners.map(owner=>withPaintBleed(owner,200));
  for(const owner of scene.owners)owner.paint.layers[0].strokes.push({tool:'pen',color:'#000000',size:3,points:[{x:220,y:230,pressure:1,time:1}]});
  const before=structuredClone(scene),target=scene.owners[1],history=[];
  const asset=(await documentWithImage()).manga.image_assets[0];
  const context={insertGeneratedPaintImage,paintLayerEditable,paintOwnerLocked,images:new Map(),operation:{current:false},inputActive:{current:false},backgroundOwner:null,suspended:false,locked:false,owner:target,finishGesture(){},imageTarget:{current:null},input:{current:{value:'',click(){}}},historyRef:{current:{present:scene}},assets:[],imports:[],setBusy(){},setError:message=>{assert.equal(message,'');},prepareImageAsset:async()=>asset,decodePaintImage:async()=>({}),Map,imagesRef:{current:null},setImages(){},setImports(){},newPaintLayer,imageCrop,fitImageBox,commit:next=>{history.push(context.historyRef.current.present);context.historyRef.current.present=next;},setOwnerKey(){},setLayerId(){}};
  componentHandler('PaintEditor','chooseImage',context)(true);
  context.owner=scene.owners[0]; // Selection can change while the picker is open.
  await componentHandler('PaintEditor','importImage',context)(new File([original],'原本.png',{type:original.type}));
  const result=context.historyRef.current.present;
  assert.equal(result.owners[0],scene.owners[0]);assert.equal(result.owners[1].paint.layers.length,1);assert.equal(result.owners[1].paint.layers[0].image.assetId,asset.id);
  assert.deepEqual(structuredClone(result.owners[1].paint.referenceFrame),before.owners[1].paint.referenceFrame);
  assert.deepEqual(result.owners[1].frame,target.frame);assert.equal(result.owners[1].figure,target.figure);
  assert.equal(history[0],scene);assert.deepEqual(scene,before);
  target.locked=true;target.paint.layers[0].locked=true;context.historyRef.current.present=scene;
  componentHandler('PaintEditor','chooseImage',context)(true,target.key);assert.equal(context.imageTarget.current,null,'manual replacement remains blocked');
  await componentHandler('PaintEditor','importImage',context)(new File([original],'生成.png',{type:original.type}),{key:target.key,replace:false},true);
  const generated=context.historyRef.current.present.owners.find(owner=>owner.key===target.key);
  assert.equal(generated.locked,true);assert.equal(generated.paint.layers[0].locked,true);assert.deepEqual(generated.paint.layers[0],target.paint.layers[0]);assert.equal(generated.paint.layers.length,target.paint.layers.length+1);assert.equal(generated.paint.layers[1].image.assetId,asset.id);assert.equal(generated.paint.layers[1].locked,false);
});

test('guide display belongs to one object and OCR rasters never gate bubble text',()=>{
 const panel={background_images:[{}],figures:[{artwork:{paint:{guideInitialized:true,layers:[{guide:true,visible:false}]}}},{artwork:{}}],bubbles:[{analogTextImport:{assetId:'original',referenceHidden:false}}]};
 const context={activePanel:0,activePage:0,figurePaintVisible:figure=>figure.artwork.paint.layers.some(layer=>layer.guide&&layer.visible),document:{manga:{pages:[{panels:[panel]}]}}};
 const visible=componentHandler('App','artworkGuideVisible',context);
 assert.equal(visible('background'),false);assert.equal(visible('figure-0'),false);
 context.document.manga.pages[0].panels[0].figures[0].artwork.paint.layers[0].visible=true;
 assert.equal(visible('figure-0'),true);assert.equal(visible('figure-1'),false);assert.equal(visible('background'),false);
 assert.equal(visible('bubble-0'),false);
});
