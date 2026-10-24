import {paintOwnerLocked} from '../src/lib/paintLock.ts';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { artworkInteractionBounds, figureArtwork, setFigureArtwork, imageContents, changeImageCrop, createFrameArtwork, createImagePlacement, fitImageBox, imageSha256, resizeImageBox, validateImagePlacements } from '../src/lib/imagePlacement.ts';
import { parseMangaYaml, toMangaYaml, toStoredMangaYaml } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { collectFigureCropAssetIds } from '../src/lib/figureCropStore.ts';
import { resizePanelToBounds, translatePanel, panelFigureAt, panelHasElementAt } from '../src/lib/canvasGeometry.ts';
import { applyPanelTemplate, mergeSelectedPanels, splitPanel } from '../src/lib/panelTemplates.ts';
import { resizePageCanvas } from '../src/lib/pageCanvas.ts';
import { newPaintLayer, paintScene, withPaintBleed } from '../src/lib/paintDocument.ts';
import { imageCrop } from '../src/lib/imagePlacement.ts';

const sample = () => parseMangaYaml(readFileSync(new URL('../src/content/sample.omny.yaml', import.meta.url), 'utf8'));
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

test('corner resize preserves ratio, opposite corner and dynamic paper bounds', () => {
  const base = { startBox: { x: 10, y: 20, w: 40, h: 20 }, bounds: { x: 0, y: 0, w: 100, h: 80 }, paperRect: { width: 100, height: 80 }, canvas: { w: 100, h: 80 }, startClientX: 0, startClientY: 0 };
  for (const mode of ['nw', 'ne', 'sw', 'se']) {
    const box = resizeImageBox({ ...base, mode }, mode.includes('w') ? -500 : 500, mode.includes('n') ? -500 : 500);
    assert.equal(box.w / box.h, 2);
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 100 && box.y + box.h <= 80);
    assert.equal(mode.includes('w') ? box.x + box.w : box.x, mode.includes('w') ? 50 : 10);
    assert.equal(mode.includes('n') ? box.y + box.h : box.y, mode.includes('n') ? 40 : 20);
  }
  assert.deepEqual(resizeImageBox({ ...base, mode: 'move' }, 1000, -1000), { x: 60, y: 0, w: 40, h: 20 });
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
  return runInNewContext(ts.transpileModule(`(${initializer.getText(ast)})`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, {setShowOriginalArtwork() {}, ...context});
}

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
    const interaction = { mode: 'move', startBox: box, bounds: artworkInteractionBounds(box, canvas), canvas, paperRect: { width: 210, height: 297 }, startClientX: 0, startClientY: 0 };
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
  return runInNewContext(ts.transpileModule(`(${expression})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
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
  for(const scope of ['panel','page_overlay']){
    const doc=await documentWithImage(),page=doc.manga.pages[0];
    const bubble={text:'確認用',shape:'normal',speaker:'人物',bbox:{x:20,y:30,w:40,h:60}};
    page.panels[0].bubbles=[structuredClone(bubble)];page.page_overlay={frame:false,layer:'above_panel_frames',bubbles:[structuredClone(bubble)]};
    const context={placedImageInput:{current:{value:''}},imageImportTarget:{current:{document:doc,pageIndex:0,panelIndex:0,scope,bubbleIndex:0,box:bubble.bbox}},documentRef:{current:doc},activePageRef:{current:0},activePanelRef:{current:0},lastHistoryPush:{current:0},setImageImportBusy(){},prepareImageAsset:async()=>doc.manga.image_assets[0],loadFigureCropAsset:async()=>original,saveFigureCropAssets:async()=>{},deleteFigureCropAssets:async()=>{},cloneDocument:structuredClone,createFrameArtwork,createImagePlacement,setFigureArtwork,setDocument:next=>{context.documentRef.current=next;},setSelectedElement(){},setToast(){},Error};
    await importHandler(context)(new File([original],'原本.png',{type:original.type}));
    const resultPage=context.documentRef.current.manga.pages[0];
    const result=(scope==='panel'?resultPage.panels[0]:resultPage.page_overlay).bubbles[0];
    assert.ok(result.paint_overlay);assert.equal(result.text,bubble.text);assert.equal(result.speaker,bubble.speaker);assert.deepEqual(result.bbox,bubble.bbox);
  }
});

test('painting import replaces the latched owner, retaining guides, other ink, and an undo snapshot',async()=>{
  const scene=paintScene({id:1,shape:{type:'rect',x:0,y:0,w:30,h:40},bg:0,action:null,bubbles:[],figures:[{name:'確認用',action:'座る',refId:'person',bbox:{x:2,y:3,w:10,h:20}}]},100,[]);
  scene.owners=scene.owners.map(owner=>withPaintBleed(owner,200));
  for(const owner of scene.owners)owner.paint.layers[0].strokes.push({tool:'pen',color:'#000000',size:3,points:[{x:220,y:230,pressure:1,time:1}]});
  const before=structuredClone(scene),target=scene.owners[1],history=[];
  const asset=(await documentWithImage()).manga.image_assets[0];
  const context={paintOwnerLocked,images:new Map(),operation:{current:false},inputActive:{current:false},backgroundOwner:null,suspended:false,locked:false,owner:target,finishGesture(){},imageTarget:{current:null},input:{current:{value:'',click(){}}},historyRef:{current:{present:scene}},assets:[],imports:[],setBusy(){},setError:message=>{assert.equal(message,'');},prepareImageAsset:async()=>asset,decodePaintImage:async()=>({}),Map,imagesRef:{current:null},setImages(){},setImports(){},newPaintLayer,imageCrop,fitImageBox,commit:next=>{history.push(context.historyRef.current.present);context.historyRef.current.present=next;},setOwnerKey(){},setLayerId(){}};
  componentHandler('PaintEditor','chooseImage',context)(true);
  context.owner=scene.owners[0]; // Selection can change while the picker is open.
  await componentHandler('PaintEditor','importImage',context)(new File([original],'原本.png',{type:original.type}));
  const result=context.historyRef.current.present;
  assert.equal(result.owners[0],scene.owners[0]);assert.equal(result.owners[1].paint.layers.length,1);assert.equal(result.owners[1].paint.layers[0].image.assetId,asset.id);
  assert.deepEqual(structuredClone(result.owners[1].paint.referenceFrame),before.owners[1].paint.referenceFrame);
  assert.deepEqual(result.owners[1].frame,target.frame);assert.equal(result.owners[1].figure,target.figure);
  assert.equal(history[0],scene);assert.deepEqual(scene,before);
});

test('guide display belongs to one object, independently of its neighbors',()=>{
 const context={guideVisibility:{},guideKey:(key,panel,page,overlay)=>`${page}:${overlay?'overlay':panel}:${key}`,activePanel:0,activePage:0,document:{manga:{pages:[{panels:[{background_images:[{}],figures:[{artwork:{}},{artwork:{}}],bubbles:[]}]}]}}};
 const visible=componentHandler('App','artworkGuideVisible',context);
 assert.equal(visible('background'),false);assert.equal(visible('figure-0'),false);
 context.guideVisibility['0:0:figure-0']=true;
 assert.equal(visible('figure-0'),true);assert.equal(visible('figure-1'),false);assert.equal(visible('background'),false);
});
