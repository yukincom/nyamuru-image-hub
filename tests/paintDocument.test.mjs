import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { addPaintFolder, applyOwnerPaint, applyPaintOwnerLock, clearOwnerPaint, restoreFigureGuide, expandPaintOwner, scalePaintOwner, movePaintLayer, paintLayerTree, paintInputPoint, paintReferenceBox, newPaintLayer, paintForFrame, paintScene, removePaintFolder, validatePaintDocument, paintGuideView, figurePaintVisible } from '../src/lib/paintDocument.ts';
import { createFrameArtwork, imageAssetIds, validateImagePlacements } from '../src/lib/imagePlacement.ts';
import { parseMangaYaml, toMangaYaml, toStoredMangaYaml } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { newPaintMask } from '../src/lib/paintMask.ts';
import { defaultPaintTone } from '../src/lib/paintTone.ts';
import { imageSha256 } from '../src/lib/imagePlacement.ts';
import { translatePanel } from '../src/lib/canvasGeometry.ts';

const frame={x:10,y:20,w:25.4,h:50.8};
const source={name:'確認用',kind:'person',refId:'person-id',action:'下を見てカップを持つ',bbox:frame,size:'full',analogImport:{schemaVersion:1,sourceRegionId:'region',assetId:'scan',sourceBBox:{x:1,y:2,w:3,h:4},detectionSource:'body',draft:true,persistentAsset:{schemaVersion:1,workKey:'work',kind:'figures',fileName:'source.png'}}};
const panel=()=>({id:1,shape:{type:'rect',x:0,y:0,w:100,h:120},bg:1,action:'話す',background_description:'喫茶店',figures:[structuredClone(source),{name:'カップ',kind:'prop',bbox:{x:70,y:80,w:20,h:10}}],bubbles:[{text:'こんにちは',speaker:'確認用',speakerId:'person-id',shape:'normal',bbox:{x:70,y:0,w:20,h:20},tail:{x:.2,y:.5}}]});
const asset=(id,w=100,h=200)=>({id,storageId:`original-${id}`,sha256:'a'.repeat(64),mediaType:'image/png',originalName:`${id}.png`,widthPx:w,heightPx:h,byteLength:1});
const stroke={tool:'pen',color:'#000000',size:3,points:[{x:4,y:5,pressure:.3,time:0},{x:10,y:20,pressure:.9,time:8}]};

test('right/bottom growth never traverses or copies retained ink',()=>{
  const layer={...newPaintLayer(),get strokes(){throw Error('old strokes traversed');}};
  const owner={key:'free',kind:'figure',index:0,label:'free',frame:{x:10,y:20,w:100,h:100},paint:{version:1,width:100,height:100,dpi:25.4,layers:[layer]}};
  const expanded=expandPaintOwner(owner,{left:0,top:0,right:20,bottom:30});
  assert.equal(expanded.paint.layers,owner.paint.layers);
  assert.deepEqual(expanded.frame,{x:10,y:20,w:120,h:130});
  assert.deepEqual(expanded.paint.referenceFrame,{x:0,y:0,w:100,h:100});
});

test('user folders preserve render order while layers move into, within and back outside the folder',()=>{
 const layers=['bottom','middle','top'].map(id=>({...newPaintLayer(id),id})),source={version:1,width:100,height:100,dpi:100,layers},before=structuredClone(source);
 const created=addPaintFolder(source),folder=created.folder;
 assert.equal(created.paint.layers,source.layers);assert.equal(folder.position,3);
 const one=movePaintLayer(created.paint,'middle',{kind:'folder',id:folder.id,placement:'inside'});
 assert.deepEqual(one.layers.map(layer=>[layer.id,layer.folderId??null]),[['bottom',null],['top',null],['middle',folder.id]]);
 const two=movePaintLayer(one,'top',{kind:'folder',id:folder.id,placement:'inside'});
 assert.deepEqual(two.layers.map(layer=>layer.id),['bottom','middle','top']);
 assert.deepEqual(paintLayerTree(two).map(entry=>entry.kind==='layer'?entry.layer.id:[entry.folder.id,...entry.layers.map(layer=>layer.id)]),['bottom',[folder.id,'middle','top']]);
 const outside=movePaintLayer(two,'top',{kind:'folder',id:folder.id,placement:'below'});
 assert.equal(outside.layers.find(layer=>layer.id==='top').folderId,undefined);assert.deepEqual(outside.layers.map(layer=>layer.id),['bottom','top','middle']);
 const ungrouped=removePaintFolder(outside,folder.id);assert.equal(ungrouped.folders.length,0);assert.ok(ungrouped.layers.every(layer=>!layer.folderId));
 assert.deepEqual(source,before,'folder operations must not mutate the input document');
});

test('folder-only paint documents validate and invalid folder references are rejected',()=>{
 const created=addPaintFolder({version:1,width:10,height:10,dpi:100,layers:[]});validatePaintDocument(created.paint,[]);
 assert.throws(()=>validatePaintDocument({...created.paint,layers:[{...newPaintLayer(),folderId:'missing'}]},[]),/不正/);
});

test('reframing artwork preserves user folders and remaps their layer references',()=>{
 const flat=asset('folder-flat',100,100),folder={id:'folder-old',name:'線画',position:0};
 const paint={version:1,width:100,height:100,dpi:100,folders:[folder],layers:[{...newPaintLayer('ink'),id:'layer-old',folderId:folder.id,strokes:[stroke]}]};
 const image={...createFrameArtwork(flat,{x:0,y:0,w:25.4,h:25.4}),paint,crop:{x:10,y:0,w:80,h:100},bbox:{x:5,y:0,w:20.32,h:25.4}};
 const reopened=paintForFrame({x:0,y:0,w:50.8,h:50.8},100,[image],[flat]);
 assert.equal(reopened.folders.length,1);assert.notEqual(reopened.folders[0].id,folder.id);
 assert.equal(reopened.layers.find(layer=>layer.name==='ink').folderId,reopened.folders[0].id);
 assert.deepEqual(paintLayerTree(reopened).filter(entry=>entry.kind==='folder').map(entry=>[entry.folder.name,...entry.layers.map(layer=>layer.name)]),[['線画','ink']]);
 validatePaintDocument(reopened,[flat]);
});

test('composition preserves initialized guide plus ink but can select a legacy guide alone',()=>{
 const owner=paintScene(panel(),100,[]).owners.find(owner=>owner.kind==='figure');
 owner.paint.layers.push({...newPaintLayer('ink'),strokes:[stroke]});
 const before=structuredClone(owner.paint);
 owner.figure.artwork={paint:{...owner.paint,guideInitialized:true}};
 assert.deepEqual(paintGuideView(owner,true).layers,before.layers);
 delete owner.figure.artwork;
 assert.equal(paintGuideView(owner,true).layers.length,1);
 assert.equal(paintGuideView(owner,true).layers[0].guide,true);
 assert.ok(paintGuideView(owner,false).layers.some(layer=>layer.strokes.length));
 assert.ok(paintGuideView(owner,false).layers.every(layer=>!layer.guide));
 assert.deepEqual(owner.paint,before);
});

test('hidden paint folders and zero-opacity content do not reappear as 3D people',()=>{
 const figure={name:'person',artwork:{hidden:false,opacity:1,paint:{guideInitialized:true,layers:[{...newPaintLayer('guide'),guide:true,visible:false},{...newPaintLayer('ink'),strokes:[stroke],visible:false}]}}};
 assert.equal(figurePaintVisible(figure,false),false);
 figure.artwork.paint.layers[1].visible=true;assert.equal(figurePaintVisible(figure),true);
 figure.artwork.paint.layers[1].opacity=0;assert.equal(figurePaintVisible(figure),false);
 figure.artwork.paint.layers[0].visible=true;assert.equal(figurePaintVisible(figure,true),true);
 figure.artwork.hidden=true;assert.equal(figurePaintVisible(figure,true),false);
 delete figure.artwork.paint;assert.equal(figurePaintVisible(figure,true),true);
 assert.equal(figurePaintVisible({name:'no-art'}),true);assert.equal(figurePaintVisible({name:'no-art'},false),false);
});

test('automatic groups separate background, each person/prop and each bubble, preserving source references',()=>{
  const p=panel(),before=structuredClone(p),scene=paintScene(p,100,[]);
  assert.deepEqual(scene.owners.map(o=>o.key),['background','figure-0','figure-1','bubble-0']);
  assert.equal(new Set(scene.owners.flatMap(o=>o.paint.layers.map(layer=>layer.id))).size,3);
  assert.equal(scene.owners.find(o=>o.kind==='bubble').paint.layers.length,0);
  assert.equal(scene.owners[1].paint.width,100);assert.equal(scene.owners[1].paint.height,200);
  scene.owners[1].paint.layers[0].strokes.push(stroke);
  assert.equal(scene.owners[0].paint.layers[0].strokes.length,0);
  assert.deepEqual(p,before);
  const art=asset('flat');
  applyOwnerPaint(p,scene.owners[1],{...createFrameArtwork(art,frame),paint:scene.owners[1].paint});
  const {artwork,...retained}=p.figures[0];
  assert.deepEqual(retained,source);assert.equal(artwork.paint.layers[0].strokes[0],stroke);
  assert.equal(p.figures[1].artwork,undefined);assert.equal(p.background_images,undefined);
  const bubble=structuredClone(p.bubbles[0]),bubbleOwner=scene.owners[3];
  bubbleOwner.paint.layers.push({...newPaintLayer(),strokes:[stroke]});
  applyOwnerPaint(p,bubbleOwner,{...createFrameArtwork(asset('bubble',79,79),bubbleOwner.frame),paint:bubbleOwner.paint});
  const {paint_overlay,...native}=p.bubbles[0];assert.deepEqual(native,bubble);assert.ok(paint_overlay.paint);
});

test('new scene construction creates no empty work layers, but keeps guides and explicit saved blank layers',()=>{
  const p=panel(),before=structuredClone(p);
  for(let visit=0;visit<3;visit++){
    const scene=paintScene(p,100,[],'monochrome','panel');
    assert.ok(scene.owners.flatMap(owner=>owner.paint.layers).every(layer=>layer.guide||layer.image||layer.strokes.length||layer.paths?.length||layer.tone?.fill));
    assert.equal(scene.owners.find(owner=>owner.kind==='background').paint.layers.length,1);
    assert.equal(scene.owners.find(owner=>owner.kind==='bubble').paint.layers.length,0);
    assert.equal(scene.owners.find(owner=>owner.kind==='panel').paint.layers.length,0);
    assert.deepEqual(p,before,'opening a layer list must not mutate the document');
  }
  const flat=asset('explicit-blank'),paint=paintForFrame(frame,100,[],[]);
  p.background_images=[{...createFrameArtwork(flat,frame),paint}];
  const existing=paintScene(p,100,[flat]).owners.find(owner=>owner.kind==='background');
  assert.ok(existing.paint.layers.some(layer=>layer.id===paint.layers[0].id),'manual blank layers remain intact');
  const empty=paintForFrame(frame,100,[],[],'color',false);
  assert.equal(empty.layers.length,0);assert.throws(()=>validatePaintDocument(empty,[]),'empty ephemeral owners are not saved as artwork');
});
test('a legacy OCR source does not prepend a sixty-fifth guide over preserved artwork',()=>{
  const p=panel(),flat=asset('full-bubble'),bubble=p.bubbles[0],box=bubble.bbox??frame;
  const paint=paintForFrame(box,100,[],[]);paint.layers=Array.from({length:64},()=>newPaintLayer('保存済み'));
  bubble.analogTextImport={assetId:'ocr-original',sourceRegionId:'r1'};
  bubble.paint_overlay={...createFrameArtwork(flat,box),crop:{x:0,y:0,w:paint.width,h:paint.height},paint};
  const original=structuredClone(p),owner=paintScene(p,100,[flat]).owners.find(owner=>owner.kind==='bubble');
  assert.equal(owner.paint.layers.length,64);assert.deepEqual(owner.paint.layers,paint.layers);assert.deepEqual(p,original);
});
test('character references are a single raster layer and legacy image locks migrate to that layer',()=>{
  const p=panel(),empty=paintScene(p,100,[]).owners.find(owner=>owner.key==='figure-0');
  assert.equal(empty.paint.guideInitialized,true);assert.equal(empty.paint.layers.length,1);
  assert.equal(empty.paint.layers[0].name,'キャラクターあたり');assert.equal(empty.paint.layers[0].kind,'raster');assert.equal(empty.paint.layers[0].locked,false);
  const original=asset('character-original',100,200),content=(({id,bbox,...rest})=>rest)(createFrameArtwork(original,frame));
  p.figures[0].artwork={...content,locked:true};
  const reopened=paintScene(p,100,[original]).owners.find(owner=>owner.key==='figure-0');
  assert.equal(reopened.locked,false);assert.equal(reopened.paint.layers.length,1);
  assert.equal(reopened.paint.layers[0].name,'キャラクターあたり');assert.equal(reopened.paint.layers[0].guide,undefined);
  assert.equal(reopened.paint.layers[0].image.assetId,original.id);assert.equal(reopened.paint.layers[0].locked,true);
});

test('OCR original is one independent raster; saved eyes and locks survive and deletion never recreates it',()=>{
  const p=panel();p.bubbles[0].analogTextImport={assetId:'bubble-scan',sourceRegionId:'bubble-region',referenceHidden:false,needsReview:true};
  const owner=paintScene(p,100,[]).owners.find(owner=>owner.key==='bubble-0'),original=owner.paint.layers.find(layer=>layer.guide);
  assert.equal(owner.paint.layers.length,1);
  assert.equal(original.name,'吹き出し原画');assert.equal(original.kind,'raster');assert.equal(original.visible,false);
  original.visible=true;original.locked=true;original.generationMask={enabled:true,strokes:[]};
  const flat=asset('bubble-flat',owner.paint.width,owner.paint.height);
  original.image={assetId:flat.id,crop:{x:0,y:0,w:flat.widthPx,h:flat.heightPx},bbox:{x:0,y:0,w:owner.paint.width,h:owner.paint.height}};
  applyOwnerPaint(p,owner,{...createFrameArtwork(flat,owner.frame),paint:owner.paint});
  const reopened=paintScene(p,100,[flat]).owners.find(owner=>owner.key==='bubble-0');
  assert.equal(reopened.paint.layers.length,1);assert.equal(reopened.paint.layers[0].guide,undefined);
  assert.equal(reopened.paint.layers[0].visible,true);assert.equal(reopened.paint.layers[0].locked,true);
  assert.deepEqual(paintGuideView(reopened,true),paintGuideView(reopened,false));
  assert.equal(p.bubbles[0].analogTextImport.rasterLayerInitialized,true);
  clearOwnerPaint(p,reopened);
  assert.equal(p.bubbles[0].paint_overlay,undefined);
  assert.equal(paintScene(p,100,[flat]).owners.find(owner=>owner.key==='bubble-0').paint.layers.length,0);
  const doc=parseMangaYaml(readFileSync(new URL('../src/content/sample.omny.yaml',import.meta.url),'utf8'));
  doc.manga.pages[0].panels=[p];
  const restored=parseMangaYaml(toStoredMangaYaml(doc)).manga.pages[0].panels[0];
  assert.equal(restored.bubbles[0].text,'こんにちは');
  assert.equal(paintScene(restored,100,[]).owners.find(owner=>owner.key==='bubble-0').paint.layers.length,0);
});
test('panel, owner and page-direct folder locks persist separately without changing paint or child locks',()=>{
 const p=panel();p.layer={locked:true,frameLocked:true,backgroundLocked:true,directLocked:true};p.figures[0].locked=true;p.bubbles[0].locked=true;
 const scene=paintScene(p,100,[],'color','panel');
 for(const owner of scene.owners)assert.equal(owner.inheritedLocked,true);
 assert.equal(scene.owners.find(owner=>owner.kind==='background').locked,true);
 assert.equal(scene.owners.find(owner=>owner.kind==='figure').locked,true);
 assert.equal(scene.owners.find(owner=>owner.kind==='bubble').locked,true);
 const figure=scene.owners.find(owner=>owner.kind==='figure');figure.locked=false;applyPaintOwnerLock(p,figure);
 assert.equal(p.figures[0].locked,undefined);assert.equal(p.layer.locked,true);assert.equal(p.layer.frameLocked,true);
 const page={page:1,canvas:{w:100,h:120,unit:'mm'},panels:[p],layer:{directLocked:true}};
 const pageOwner={...scene.owners.find(owner=>owner.kind==='panel'),kind:'page',key:'page',locked:false};
 applyPaintOwnerLock(page,pageOwner);assert.equal(page.layer,undefined);assert.equal(p.layer.directLocked,true);
});

test('direct panel and page layers are opt-in owners that preserve unrelated placements',()=>{
  const p=panel(),regular={...createFrameArtwork(asset('regular',40,60),{x:2,y:3,w:8,h:12})};
  p.images=[regular];
  assert.deepEqual(paintScene(p,100,[]).owners.map(owner=>owner.key),['background','figure-0','figure-1','bubble-0']);

  const panelScene=paintScene(p,100,[],'color','panel'),panelOwner=panelScene.owners.find(owner=>owner.kind==='panel');
  assert.ok(panelOwner);assert.equal(panelOwner.paint.layers.length,0);assert.equal(panelOwner.paint.guideInitialized,true);
  panelOwner.paint.layers.push({...newPaintLayer('コマの線'),strokes:[stroke]});
  const panelFlat=asset('panel-flat',panelOwner.paint.width,panelOwner.paint.height);
  applyOwnerPaint(p,panelOwner,{...createFrameArtwork(panelFlat,panelOwner.frame),paint:panelOwner.paint});
  assert.equal(p.images.length,2);assert.equal(p.images[0],regular);assert.equal(p.images[1].paintScope,'panel');
  const reopenedPanel=paintScene(p,350,[panelFlat],'color','panel').owners.find(owner=>owner.kind==='panel');
  assert.deepEqual(reopenedPanel.paint,panelOwner.paint);assert.deepEqual(reopenedPanel.frame,panelOwner.frame);

  const pageTarget={...panel(),images:[...p.images]},pageOwner=paintScene(pageTarget,100,[panelFlat],'color','page').owners.find(owner=>owner.kind==='page');
  assert.ok(pageOwner);assert.equal(pageOwner.paint.layers.length,0);
  pageOwner.paint.layers.push({...newPaintLayer('ページの線'),strokes:[stroke]});
  const pageFlat=asset('page-flat',pageOwner.paint.width,pageOwner.paint.height);
  applyOwnerPaint(pageTarget,pageOwner,{...createFrameArtwork(pageFlat,pageOwner.frame),paint:pageOwner.paint});
  assert.deepEqual(pageTarget.images.map(image=>image.paintScope??'regular'),['regular','panel','page']);
  clearOwnerPaint(pageTarget,pageOwner);
  assert.deepEqual(pageTarget.images.map(image=>image.paintScope??'regular'),['regular','panel']);
  clearOwnerPaint(pageTarget,panelOwner);
  assert.deepEqual(pageTarget.images,[regular]);
});

test('removing the final layer clears saved artwork instead of creating a replacement blank layer',()=>{
  const p=panel(),scene=paintScene(p,100,[]),background=scene.owners[0],figure=scene.owners[1],bubble=scene.owners[3];
  const flat=asset('flat');
  applyOwnerPaint(p,background,{...createFrameArtwork(flat,background.frame),paint:background.paint});
  applyOwnerPaint(p,figure,{...createFrameArtwork(flat,figure.frame),paint:figure.paint});
  applyOwnerPaint(p,bubble,{...createFrameArtwork(flat,bubble.frame),paint:bubble.paint});
  assert.ok(p.background_images?.length);assert.ok(p.figures[0].artwork);assert.ok(p.bubbles[0].paint_overlay);
  clearOwnerPaint(p,background);clearOwnerPaint(p,figure);clearOwnerPaint(p,bubble);
  assert.deepEqual(p.background_images,[]);assert.equal(p.figures[0].artwork,undefined);assert.equal(p.bubbles[0].paint_overlay,undefined);
  assert.deepEqual(p.figures[0].bbox,source.bbox);
});

test('original pixels are separate locked layers and editable documents reopen at their saved resolution',()=>{
  const a=asset('original',200,100),image=createFrameArtwork(a,frame);
  const paint=paintForFrame(frame,100,[image],[a]);
  assert.equal(paint.layers.length,2);assert.equal(paint.layers[0].locked,true);
  assert.deepEqual(paint.layers[0].image.bbox,{x:0,y:75,w:100,h:50});
  paint.layers[1].strokes.push(stroke);
  const flat=asset('flat',100,200),saved={...createFrameArtwork(flat,frame),paint};
  const reopened=paintForFrame(frame,350,[saved],[a,flat]);
  assert.deepEqual(reopened,paint);assert.notEqual(reopened,paint);
  reopened.layers[1].strokes[0].points[0].x=999;assert.equal(paint.layers[1].strokes[0].points[0].x,4);
});

test('clipped or merged painting retains editable strokes, crop clipping and original image references',()=>{
  const a=asset('original',100,200),flat=asset('flat',100,200);
  const paint=paintForFrame(frame,100,[createFrameArtwork(a,frame)],[a]);paint.layers[1].strokes.push(stroke);
  const image={...createFrameArtwork(flat,frame),paint,crop:{x:50,y:0,w:50,h:200},bbox:{x:22.7,y:20,w:12.7,h:50.8}};
  const merged=paintForFrame({x:0,y:0,w:101.6,h:101.6},100,[image],[a,flat]);
  assert.equal(merged.layers[0].image.assetId,'original');
  assert.equal(merged.layers[1].strokes.length,1);
  assert.ok(merged.layers[1].clip.w>0);assert.ok(Math.abs(merged.layers[1].strokes[0].points[0].x-(10/25.4*100+4))<1e-8);
  validatePaintDocument(merged,[a,flat]);
});

test('paint validation rejects missing layer originals and malformed stroke data',()=>{
  const a=asset('original'),paint=paintForFrame(frame,100,[createFrameArtwork(a,frame)],[a]);
  assert.throws(()=>validatePaintDocument(paint,[]),/ペイント/);
  for(const mutate of [p=>p.width=0,p=>p.layers[0].image.crop.w=999,p=>p.layers.push({...p.layers[0]}),p=>p.layers[1].strokes.push({...stroke,points:[{x:NaN,y:0,pressure:.5,time:0}]}),p=>p.layers[1].strokes.push({...stroke,color:'rgba(0,0,0,1)'})]){
    const broken=structuredClone(paint);mutate(broken);assert.throws(()=>validatePaintDocument(broken,[a]),/ペイント/);
  }
});

test('project save/reopen retains layer-only originals, native source metadata and bubble drawings; OMNY excludes paint',async()=>{
  const doc=parseMangaYaml(readFileSync(new URL('../src/content/sample.omny.yaml',import.meta.url),'utf8'));
  const blob=new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64')],{type:'image/png'});
  const base={...asset('flat',1,1),byteLength:blob.size,sha256:await imageSha256(blob)};
  const original={...base,id:'layer-only',storageId:'original-layer-only'};
  doc.manga.image_assets=[base,original];
  const p=doc.manga.pages[0].panels[0];
  const paint={version:1,width:1,height:1,dpi:100,layers:[{...newPaintLayer('参照'),image:{assetId:original.id,crop:{x:0,y:0,w:1,h:1},bbox:{x:0,y:0,w:1,h:1}}},{...newPaintLayer('線'),strokes:[{...stroke,color:'#00ff00',fill:'#ffff00'}],mask:newPaintMask([{x:0,y:0,w:1,h:1}]),tone:{...defaultPaintTone(),mode:'fixed',density:25}}]};
  paint.layers[1].colorMode='monochrome';
  const image={...createFrameArtwork(base,frame),paint};
  p.figures=[{name:'未指定',kind:'person',size:'full',role:'main',action:'右を見る',bbox:frame,artwork:(({id,bbox,...rest})=>rest)(image)}];
  p.bubbles=[{text:'変えない',shape:'square',bbox:frame,paint_overlay:structuredClone(p.figures[0].artwork)}];
  p.background_images=[image];
  assert.deepEqual([...imageAssetIds(doc)].sort(),['flat','layer-only']);
  validateImagePlacements(doc);
  const normalized=parseMangaYaml(toStoredMangaYaml(doc));
  const before=structuredClone(normalized.manga.pages[0].panels[0]);
  assert.deepEqual(before.bubbles[0].paint_overlay.paint,paint);
  const snapshot=await createProjectSnapshot(normalized,async()=>blob);
  assert.equal(snapshot.assets.length,2);assert.equal(snapshot.document.manga.image_assets.length,2);
  let stored;const restored=await restoreProjectSnapshot(snapshot,async values=>{stored=values;});
  assert.equal(stored.length,2);assert.deepEqual(restored.manga.pages[0].panels[0],before);
  const moved=structuredClone(before);translatePanel(moved,3,4);assert.deepEqual(moved.figures[0].artwork.paint,paint);
  const omny=toMangaYaml(normalized);assert.doesNotMatch(omny,/paint_overlay|layer-only|original-flat|strokes:/);
  const broken=structuredClone(restored);broken.manga.image_assets=broken.manga.image_assets.filter(a=>a.id!=='layer-only');
  await assert.rejects(createProjectSnapshot(broken,async()=>blob),/ペイント/);
});


test('nonuniform frame resize reopens with contain geometry matching the page preview',()=>{
  const flat=asset('flat'),paint=paintForFrame(frame,100,[],[]);paint.layers[0].strokes=[stroke];
  const square={...frame,w:50.8},image={...createFrameArtwork(flat,square),paint};
  const reopened=paintForFrame(square,100,[image],[flat]);
  assert.equal(reopened.width,200);assert.equal(reopened.height,200);
  assert.deepEqual(reopened.layers[0].clip,{x:50,y:0,w:100,h:200});
  assert.equal(reopened.layers[0].strokes[0].points[0].x,54);
  // A rounded native size remains exact and does not accumulate empty layers.
  const oddFrame={...frame,w:25.5,h:50.7},odd=paintForFrame(oddFrame,350,[],[]);
  const oddAsset=asset('odd',odd.width,odd.height);
  assert.deepEqual(paintForFrame(oddFrame,350,[{...createFrameArtwork(oddAsset,oddFrame),paint:odd}],[oddAsset]),odd);
});

test('a clipped 64-layer document can reopen without adding a 65th blank layer',()=>{
  const flat=asset('flat'),paint={...paintForFrame(frame,100,[],[]),layers:Array.from({length:64},()=>newPaintLayer())};
  const clipped={...createFrameArtwork(flat,frame),paint,crop:{x:50,y:0,w:50,h:200}};
  const reopened=paintForFrame(frame,100,[clipped],[flat]);
  assert.equal(reopened.layers.length,64);validatePaintDocument(reopened,[flat]);
});


const worldPoint=(owner,p)=>({x:owner.frame.x+p.x*owner.frame.w/owner.paint.width,y:owner.frame.y+p.y*owner.frame.h/owner.paint.height});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
test('canvas expansion after placement scaling preserves ink, raster pixels and historical clips in page coordinates',()=>{
  const a=asset('original'),p=panel();p.figures[0].artwork=(({id,bbox,...content})=>content)(createFrameArtwork(a,frame));
  const owner=scalePaintOwner(paintScene(p,100,[a]).owners[1],1.7);
  const ink=newPaintLayer('ink');ink.strokes=[structuredClone(stroke)];ink.clip={x:0,y:1,w:90,h:180};owner.paint.layers.push(ink);
  const before=structuredClone(owner),expanded=expandPaintOwner(owner,{left:30,right:70,top:25,bottom:5});
  assert.deepEqual(owner,before);assert.equal(expanded.paint.width,200);assert.equal(expanded.paint.height,230);
  const first=owner.paint.layers[1].strokes[0],next=expanded.paint.layers[1].strokes[0];
  for(let i=0;i<first.points.length;i++){const a=worldPoint(owner,first.points[i]),b=worldPoint(expanded,next.points[i]);close(a.x,b.x);close(a.y,b.y);assert.equal(next.points[i].pressure,first.points[i].pressure);assert.equal(next.points[i].time,first.points[i].time);}
  assert.equal(next.size,first.size);close(next.size*expanded.frame.w/expanded.paint.width,first.size*owner.frame.w/owner.paint.width);
  assert.deepEqual(expanded.paint.layers[1].clip,{x:30,y:26,w:90,h:180});
  const raster=expanded.paint.layers[0].image;assert.deepEqual(raster.crop,owner.paint.layers[0].image.crop);
  assert.equal(raster.bbox.w,owner.paint.layers[0].image.bbox.w);assert.equal(raster.bbox.h,owner.paint.layers[0].image.bbox.h);
  const reference=paintReferenceBox(expanded.paint,expanded.frame);for(const key of ['x','y','w','h'])close(reference[key],owner.frame[key]);
  const flat=asset('flat-expanded',200,230);applyOwnerPaint(p,expanded,{...createFrameArtwork(flat,expanded.frame),paint:expanded.paint});
  const reopened=paintScene(p,350,[a,flat]).owners[1];assert.deepEqual(reopened.paint,expanded.paint);assert.deepEqual(reopened.frame,expanded.frame);
  assert.equal(p.figures[0].action,source.action);assert.deepEqual(p.figures[0].analogImport,source.analogImport);
  const scaled=scalePaintOwner(expanded,2);assert.equal(scaled.paint,expanded.paint);close(scaled.frame.w,expanded.frame.w*2);
});

test('background canvas expansion persists without changing its panel or any person',()=>{
  const p=panel(),before=structuredClone(p),owner=paintScene(p,100,[]).owners[0];
  const expanded=expandPaintOwner(owner,{left:100,right:0,top:40,bottom:20});
  expanded.paint.layers[0].strokes=[structuredClone(stroke)];
  const flat=asset('background',expanded.paint.width,expanded.paint.height);
  applyOwnerPaint(p,expanded,{...createFrameArtwork(flat,expanded.frame),paint:expanded.paint});
  assert.deepEqual(p.shape,before.shape);assert.deepEqual(p.figures,before.figures);
  const reopened=paintScene(p,350,[flat]).owners[0];assert.deepEqual(reopened.frame,expanded.frame);assert.deepEqual(reopened.paint,expanded.paint);
});

test('overscan maps outside starts and crossings into intrinsic pixels without clamping',()=>{
  const owner=paintScene(panel(),100,[]).owners[1],margin=5;
  const outside=paintInputPoint(owner,margin,0,0);assert.ok(outside.x<0&&outside.y<0);
  const edge=paintInputPoint(owner,margin,margin/(owner.frame.w+2*margin),margin/(owner.frame.h+2*margin));close(edge.x,0);close(edge.y,0);
  const middle=paintInputPoint(owner,margin,.5,.5);close(middle.x,50);close(middle.y,100);
  const end=paintInputPoint(owner,margin,1,1);assert.ok(end.x>100&&end.y>200);
  owner.paint.layers[0].strokes=[{...stroke,points:[{...stroke.points[0],...outside},{...stroke.points[1],...end}]}];
  validatePaintDocument(owner.paint,[]);
});

test('original reference mapping matches contain fit and crop before and after reframing',()=>{
  const paint={version:1,width:100,height:200,dpi:100,referenceFrame:{x:10,y:10,w:80,h:180},layers:[newPaintLayer()]};
  const box={x:0,y:0,w:200,h:200};
  assert.deepEqual(paintReferenceBox(paint,box),{x:60,y:10,w:80,h:180});
  const flat=asset('flat',100,200),image={...createFrameArtwork(flat,box),paint,crop:{x:25,y:10,w:50,h:180}};
  const expected=paintReferenceBox(paint,box,image.crop),reframed=paintForFrame(box,100,[image],[flat]);
  const actual=paintReferenceBox(reframed,box);for(const key of ['x','y','w','h'])close(actual[key],expected[key]);
});

test('reference bounds survive stored project normalization and invalid padding leaves source untouched',()=>{
  const doc=parseMangaYaml(readFileSync(new URL('../src/content/sample.omny.yaml',import.meta.url),'utf8'));
  const p=panel(),owner=expandPaintOwner(paintScene(p,100,[]).owners[1],{left:20,right:0,top:10,bottom:0});
  const flat=asset('expanded',owner.paint.width,owner.paint.height);applyOwnerPaint(p,owner,{...createFrameArtwork(flat,owner.frame),paint:owner.paint});
  doc.manga.pages[0].panels=[p];doc.manga.image_assets=[flat];
  const restored=parseMangaYaml(toStoredMangaYaml(doc));assert.deepEqual(restored.manga.pages[0].panels[0].figures[0].artwork.paint.referenceFrame,owner.paint.referenceFrame);
  const before=structuredClone(owner);
  for(const padding of [{left:-1,right:0,top:0,bottom:0},{left:1.5,right:0,top:0,bottom:0},{left:16384,right:0,top:0,bottom:0}])assert.throws(()=>expandPaintOwner(owner,padding));
  assert.deepEqual(owner,before);
  for(const referenceFrame of [{x:NaN,y:0,w:1,h:1},{x:0,y:0,w:0,h:1},null])assert.throws(()=>validatePaintDocument({...owner.paint,referenceFrame},[]));
});


test('restoring a guide and exporting OMNY recover its reference bounds without changing local painted placement',()=>{
  const doc=parseMangaYaml(readFileSync(new URL('../src/content/sample.omny.yaml',import.meta.url),'utf8'));
  const p=panel(),scene=paintScene(p,100,[]),figure=expandPaintOwner(scene.owners[1],{left:30,right:50,top:20,bottom:40}),bubble=expandPaintOwner(scene.owners[3],{left:10,right:20,top:5,bottom:10});
  const assets=[asset('figure',figure.paint.width,figure.paint.height),asset('bubble',bubble.paint.width,bubble.paint.height)];
  applyOwnerPaint(p,figure,{...createFrameArtwork(assets[0],figure.frame),paint:figure.paint});
  applyOwnerPaint(p,bubble,{...createFrameArtwork(assets[1],bubble.frame),paint:bubble.paint});
  doc.manga.pages[0].panels=[p];doc.manga.image_assets=assets;
  const before=structuredClone(p),restored=restoreFigureGuide(p.figures[0]);
  for(const key of ['x','y','w','h'])close(restored.bbox[key],frame[key]);
  assert.equal(restored.artwork,undefined);assert.equal(restored.action,source.action);assert.deepEqual(restored.analogImport,source.analogImport);
  const exported=parseMangaYaml(toMangaYaml(doc)).manga.pages[0].panels[0];
  for(const key of ['x','y','w','h']){close(exported.figures[0].bbox[key],frame[key]);close(exported.bubbles[0].bbox[key],scene.owners[3].frame[key]);}
  assert.deepEqual(p,before);
});

test('nuritashi adds only missing canvas pixels, retaining page positions, widths, and source guide',async()=>{
  const {withPaintBleed}=await import('../src/lib/paintDocument.ts');
  const scene=paintScene(panel(),100,[]),figure=scene.owners[1],original=scene.owners[0];original.paint.layers[0].strokes.push(structuredClone(stroke));
  assert.equal(withPaintBleed(figure,200),figure,'人物画像には専用のぬりたしを適用しない');
  const expanded=withPaintBleed(original,200);
  assert.deepEqual([expanded.paint.width,expanded.paint.height],[original.paint.width+400,original.paint.height+400]);
  const expandedReference=paintReferenceBox(expanded.paint,expanded.frame);for(const key of ['x','y','w','h'])close(expandedReference[key],paintReferenceBox(original.paint,original.frame)[key]);
  const pagePoint=o=>{const p=o.paint.layers[0].strokes[0].points[0];return{x:o.frame.x+p.x*o.frame.w/o.paint.width,y:o.frame.y+p.y*o.frame.h/o.paint.height};};
  assert.ok(Math.abs(pagePoint(expanded).x-pagePoint(original).x)<1e-9);
  assert.ok(Math.abs(pagePoint(expanded).y-pagePoint(original).y)<1e-9);
  assert.equal(expanded.paint.layers[0].strokes[0].size,stroke.size);
  assert.equal(withPaintBleed(expanded,200),expanded);assert.equal(withPaintBleed(expanded,100),expanded);
  const art=asset('with-margin',expanded.paint.width,expanded.paint.height),saved={...createFrameArtwork(art,expanded.frame),paint:expanded.paint};
  const reopened={...expanded,paint:paintForFrame(expanded.frame,100,[saved],[art])};
  assert.equal(withPaintBleed(reopened,200),reopened);
  const reopenedReference=paintReferenceBox(withPaintBleed(reopened,250).paint,withPaintBleed(reopened,250).frame);for(const key of ['x','y','w','h'])close(reopenedReference[key],paintReferenceBox(original.paint,original.frame)[key]);
});

test('selection masks survive canvas expansion, reframing and validation',()=>{
  const owner=paintScene(panel(),100,[]).owners[1],mask=[{x:5,y:8,w:12,h:9}];
  owner.paint.layers[0].strokes=[{...stroke,tool:'fill',selection:mask}];
  const expanded=expandPaintOwner(owner,{left:20,top:30,right:0,bottom:0});
  assert.deepEqual(expanded.paint.layers[0].strokes[0].selection,[{x:25,y:38,w:12,h:9}]);
  assert.doesNotThrow(()=>validatePaintDocument(expanded.paint,[]));
  const image={...createFrameArtwork(asset('masked',owner.paint.width,owner.paint.height),owner.frame),paint:owner.paint};
  const reframed=paintForFrame({...owner.frame,w:owner.frame.w*2},100,[image],[asset('masked',owner.paint.width,owner.paint.height)]);
  assert.deepEqual(reframed.layers[0].strokes[0].selection,mask);
  const bad=structuredClone(expanded.paint);bad.layers[0].strokes[0].selection[0].w=-1;assert.throws(()=>validatePaintDocument(bad,[]));
});

test('character guides start as one raster layer and deletion survives reopen without touching the source',()=>{
  const p=panel(),scene=paintScene(p,100,[]),owner=scene.owners[1];
  assert.equal(owner.paint.guideInitialized,true);assert.equal(owner.paint.layers[0].guide,true);
  assert.equal(owner.paint.layers[0].locked,false);assert.equal(owner.paint.layers[0].kind,'raster');assert.equal(owner.paint.layers.length,1);
  owner.paint.layers=[newPaintLayer()];const flat=asset('flat',owner.paint.width,owner.paint.height);
  applyOwnerPaint(p,owner,{...createFrameArtwork(flat,owner.frame),paint:owner.paint});
  const reopened=paintScene(p,100,[flat]).owners[1];assert.equal(reopened.paint.layers.some(l=>l.guide),false);
  assert.deepEqual(p.figures[0].analogImport,source.analogImport);
});
