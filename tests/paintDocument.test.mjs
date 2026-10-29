import assert from 'node:assert/strict';
import test from 'node:test';
import { paintGenerationOwner, paintOwnerShouldClear, movePaintEntry, paintAddPosition, paintNativeBand, addPaintLayer, insertGeneratedPaintImage, addPaintFolder, applyPaintAnchorIds,paintAnchorIds,paintStackMatches,paintStackTarget,directPaintImages,orderedPaintOwners,applyOwnerPaint, applyPaintOwnerLock, clearOwnerPaint, restoreFigureGuide, expandPaintOwner, expandPaintOwnerToBounds, scalePaintOwner, movePaintFolder, movePaintLayer, paintLayerTree, paintInputPoint, paintReferenceBox, newPaintLayer, paintForFrame, paintScene, removePaintFolder, validatePaintDocument, paintGuideView, figurePaintVisible } from '../src/lib/paintDocument.ts';
import { createFrameArtwork, imageAssetIds, validateImagePlacements } from '../src/lib/imagePlacement.ts';
import { parseMangaYaml, toMangaYaml, toStoredMangaYaml } from '../src/lib/manga.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { newPaintMask } from '../src/lib/paintMask.ts';
import { defaultPaintTone } from '../src/lib/paintTone.ts';
import { imageSha256 } from '../src/lib/imagePlacement.ts';
import { translatePanel } from '../src/lib/canvasGeometry.ts';
import { panelTestDocument } from './fixtures/emptyTestDocument.ts';

const frame={x:10,y:20,w:25.4,h:50.8};
const source={name:'確認用',kind:'person',refId:'person-id',action:'下を見てカップを持つ',bbox:frame,size:'full',analogImport:{schemaVersion:1,sourceRegionId:'region',assetId:'scan',sourceBBox:{x:1,y:2,w:3,h:4},detectionSource:'body',draft:true,persistentAsset:{schemaVersion:1,workKey:'work',kind:'figures',fileName:'source.png'}}};
const panel=()=>({id:1,shape:{type:'rect',x:0,y:0,w:100,h:120},bg:1,action:'話す',background_description:'喫茶店',figures:[structuredClone(source),{name:'カップ',kind:'prop',bbox:{x:70,y:80,w:20,h:10}}],bubbles:[{text:'こんにちは',speaker:'確認用',speakerId:'person-id',shape:'normal',bbox:{x:70,y:0,w:20,h:20},tail:{x:.2,y:.5}}]});
const asset=(id,w=100,h=200)=>({id,storageId:`original-${id}`,sha256:'a'.repeat(64),mediaType:'image/png',originalName:`${id}.png`,widthPx:w,heightPx:h,byteLength:1});
const stroke={tool:'pen',color:'#000000',size:3,points:[{x:4,y:5,pressure:.3,time:0},{x:10,y:20,pressure:.9,time:8}]};

test('後ろの描き文字と原字は対応人物の直前へ集まり、元の配列と人物順は保持する',()=>{
  const p=panel(),originalAsset=asset('lettering-original');
  p.bubbles.push({text:'かぁぁ',shape:'handwritten',speakerId:'person-id',speaker:'確認用',lettering_depth:'behind',bbox:frame,analogTextImport:{originalImageId:'original'}});
  p.bubbles.push({...structuredClone(p.bubbles[1]),text:'ふわっ',analogTextImport:undefined});
  p.images=[{...createFrameArtwork(originalAsset,frame),id:'original',bubbleOriginal:{name:'原字',sourceRegionId:'lettering'}}];
  p.layer={artOrder:['figure-1','background','figure-0']};
  const before=structuredClone(p);
  for(const scope of [undefined,'panel','page']){
    const keys=paintScene(p,100,[originalAsset],'color',scope).owners.map(owner=>owner.key);
    assert.deepEqual(keys.slice(keys.indexOf('bubble-2'),keys.indexOf('figure-0')+1),['bubble-2','bubble-1','original-original','figure-0']);
    assert.ok(keys.indexOf('figure-1')<keys.indexOf('figure-0'));
    assert.ok(keys.indexOf('bubble-0')>keys.indexOf('figure-0'));
    assert.equal(new Set(keys).size,keys.length);
  }
  assert.deepEqual(p,before);
  p.bubbles[1].lettering_depth='front';p.bubbles[2].lettering_depth='front';
  const frontKeys=paintScene(p,100,[originalAsset]).owners.map(owner=>owner.key);
  assert.deepEqual(frontKeys.slice(frontKeys.indexOf('figure-0'),frontKeys.indexOf('bubble-0')),['figure-0','bubble-2','bubble-1','original-original']);
  p.figures=[];
  assert.ok(paintScene(p,100,[originalAsset]).owners.find(owner=>owner.key==='bubble-1'));
});

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
  assert.equal(scene.owners.find(o=>o.kind==='bubble').label,'テキスト1');
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
  assert.equal(original.name,'テキスト原画');assert.equal(original.kind,'raster');assert.equal(original.visible,false);
  original.visible=true;original.locked=true;
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
  const doc=panelTestDocument();
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
  const doc=panelTestDocument();
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
  const doc=panelTestDocument();
  const p=panel(),owner=expandPaintOwner(paintScene(p,100,[]).owners[1],{left:20,right:0,top:10,bottom:0});
  const flat=asset('expanded',owner.paint.width,owner.paint.height);applyOwnerPaint(p,owner,{...createFrameArtwork(flat,owner.frame),paint:owner.paint});
  doc.manga.pages[0].panels=[p];doc.manga.image_assets=[flat];
  const restored=parseMangaYaml(toStoredMangaYaml(doc));assert.deepEqual(restored.manga.pages[0].panels[0].figures[0].artwork.paint.referenceFrame,owner.paint.referenceFrame);
  const before=structuredClone(owner);
  for(const padding of [{left:-1,right:0,top:0,bottom:0},{left:1.5,right:0,top:0,bottom:0},{left:16384,right:0,top:0,bottom:0}])assert.throws(()=>expandPaintOwner(owner,padding));
  assert.deepEqual(owner,before);
  for(const referenceFrame of [{x:NaN,y:0,w:1,h:1},{x:0,y:0,w:0,h:1},null])assert.throws(()=>validatePaintDocument({...owner.paint,referenceFrame},[]));
});


test('raster growth and saved-document validation share exact side and area limits without allocating pixels',()=>{
  const owner=paintScene(panel(),100,[]).owners[1],before=structuredClone(owner);
  for(const [w,h] of [[16384,owner.paint.height],[owner.paint.width,16384],[10000,10000]]){
    const grown=expandPaintOwnerToBounds(owner,{x:0,y:0,w,h});
    assert.deepEqual([grown.paint.width,grown.paint.height],[w,h]);
    assert.doesNotThrow(()=>validatePaintDocument(grown.paint,[]));
    assert.equal(grown.paint.layers,owner.paint.layers);
  }
  for(const [w,h] of [[16385,owner.paint.height],[owner.paint.width,16385],[10001,10000]]){
    assert.throws(()=>expandPaintOwnerToBounds(owner,{x:0,y:0,w,h}),/各辺16384px・合計1億px/);
    assert.throws(()=>validatePaintDocument({...owner.paint,width:w,height:h},[]));
    assert.deepEqual(owner,before);
  }
});

test('restoring a guide and exporting OMNY recover its reference bounds without changing local painted placement',()=>{
  const doc=panelTestDocument();
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


test('generated image is inserted at the folder top without replacing source ink or locks',()=>{
 const guide={...newPaintLayer('あたり'),guide:true,locked:true,visible:false,folderId:'f',image:{assetId:'source',crop:{x:0,y:0,w:30,h:60},bbox:{x:2,y:3,w:30,h:60}}};
 const ink={...newPaintLayer('線'),strokes:[{tool:'pen',color:'#123456',size:4,points:[{x:12,y:18,pressure:1,time:0}]}]};
 const owner={key:'figure-0',kind:'figure',index:0,label:'人物',locked:true,frame:{x:10,y:20,w:50,h:100},paint:{version:1,width:100,height:200,dpi:100,guideInitialized:true,layers:[guide,ink],folders:[{id:'f',name:'あたり',position:0,locked:true,visible:true}]}};
 const before=structuredClone(owner),asset={id:'generated',widthPx:100,heightPx:200};
 const result=insertGeneratedPaintImage(owner,asset,'生成画像');
 assert.deepEqual(owner,before);assert.deepEqual(result.owner.paint.layers.filter(layer=>layer.id!==result.layer.id),before.paint.layers);
 assert.deepEqual(result.owner.paint.layers.map(layer=>layer.id),[guide.id,ink.id,result.layer.id]);
 assert.equal(result.layer.folderId,undefined);assert.equal(result.layer.locked,false);assert.equal(result.owner.locked,true);
 assert.deepEqual(result.owner.paint.folders,before.paint.folders);
 const world=(o,point)=>[o.frame.x+point.x/o.paint.width*o.frame.w,o.frame.y+point.y/o.paint.height*o.frame.h];
 const expanded=insertGeneratedPaintImage(owner,asset,'広い生成画像',{x:0,y:0,w:100,h:150}).owner;
 assert.deepEqual(world(expanded,expanded.paint.layers.find(layer=>layer.id===ink.id).strokes[0].points[0]),world(owner,ink.strokes[0].points[0]));
 assert.deepEqual(paintReferenceBox(expanded.paint,expanded.frame),owner.frame);
 assert.equal(expanded.paint.layers[0].image.assetId,'source');assert.deepEqual(expanded.paint.layers[0].image.crop,guide.image.crop);
 assert.throws(()=>insertGeneratedPaintImage({...owner,paint:{...owner.paint,layers:Array.from({length:64},()=>newPaintLayer('保持'))}},asset,'上限'),/64レイヤー/);
});


test('moving layers preserves empty sibling folder order and same-folder drops go to its top',()=>{
 const layer=id=>({...newPaintLayer(id),id}),source={version:1,width:100,height:100,dpi:100,layers:[layer('a'),layer('b')],folders:[{id:'f1',name:'F1',position:2},{id:'f2',name:'F2',position:2}]};
 const order=paint=>paintLayerTree(paint).filter(e=>e.kind==='folder').map(e=>e.folder.id);
 const first=movePaintLayer(source,'a',{kind:'folder',id:'f2',placement:'inside'});assert.deepEqual(order(first),['f1','f2']);
 const second=movePaintLayer(first,'b',{kind:'folder',id:'f2',placement:'inside'});assert.deepEqual(order(second),['f1','f2']);assert.deepEqual(second.layers.map(l=>l.id),['a','b']);
 const inside=movePaintLayer(second,'a',{kind:'folder',id:'f2',placement:'inside'});assert.deepEqual(order(inside),['f1','f2']);assert.deepEqual(inside.layers.map(l=>l.id),['b','a']);
 assert.equal(movePaintLayer(inside,'a',{kind:'folder',id:'f2',placement:'inside'}),inside,'a repeated top drop is a no-op');
 const across=movePaintLayer(inside,'a',{kind:'folder',id:'f1',placement:'inside'});assert.deepEqual(order(across),['f1','f2']);assert.deepEqual(across.layers.map(l=>[l.id,l.folderId]),[['a','f1'],['b','f2']]);
 const moved=movePaintFolder(across,'f2',{kind:'folder',id:'f1',placement:'below'});assert.deepEqual(order(moved),['f2','f1']);assert.deepEqual(moved.layers.map(l=>l.id),['b','a']);
 assert.equal(movePaintFolder(moved,'f1',{kind:'folder',id:'f1',placement:'above'}),moved);
 assert.equal(movePaintFolder(moved,'f1',{kind:'folder',id:'f2',placement:'inside'}),moved,'folders do not nest');
 validatePaintDocument(moved,[]);
});


test('work-layer names share the page sequence across kinds and owners, independent of names and gaps',()=>{
 let scene={...paintScene(panel(),100,[],'color','panel'),layerSequence:0};
 const before=structuredClone(scene),first=addPaintLayer(scene,'panel','vector');
 assert.equal(first.layer.name,'レイヤー 1');assert.equal(first.layer.kind,'vector');scene=first.scene;
 const second=addPaintLayer(scene,'background','raster');assert.equal(second.layer.name,'レイヤー 2');scene=second.scene;
 scene={...scene,owners:scene.owners.map(owner=>({...owner,paint:{...owner.paint,layers:owner.paint.layers.map(layer=>layer.id===second.layer.id?{...layer,name:'前景の人物'}:layer).filter(layer=>layer.id!==first.layer.id)}}))};
 const third=addPaintLayer(scene,'figure-0','vector');assert.equal(third.layer.name,'レイヤー 3');assert.equal(third.scene.layerSequence,3);
 assert.equal(before.layerSequence,0);assert.equal(before.owners.find(owner=>owner.key==='panel').paint.layers.length,0);
 assert.equal(first.scene.layerSequence,1);assert.equal(second.scene.layerSequence,2);
 const otherPanel={...paintScene(panel(),100,[],'color','panel'),layerSequence:third.scene.layerSequence};
 assert.equal(addPaintLayer(otherPanel,'panel','raster').layer.name,'レイヤー 4');
 const otherPage=paintScene(panel(),100,[],'color','page');assert.equal(addPaintLayer(otherPage,'page','vector').layer.name,'レイヤー 1');
 const locked={...scene,owners:scene.owners.map(owner=>({...owner,locked:true}))};assert.equal(addPaintLayer(locked,'panel','raster'),undefined);assert.equal(locked.layerSequence,2);
});

test('direct work layers follow native text and linked originals while unlinked originals stay above them',()=>{
 const p=panel(),a=asset('original');
 p.images=[{...createFrameArtwork(a,frame),id:'unlinked',bubbleOriginal:{name:'unlinked',sourceRegionId:'unlinked'}}];
 for(const scope of ['panel','page']){
  const scene=paintScene(p,100,[a],'color',scope),keys=scene.owners.map(owner=>owner.key);
  assert.ok(keys.indexOf(scope)>keys.indexOf('bubble-0'));
  assert.ok(keys.indexOf(scope)<keys.indexOf('original-unlinked'));
  assert.ok(keys.indexOf(scope)>keys.indexOf('figure-0'));
 }
});


test('layer insertion follows a selected sibling or the open/unlocked folder, without touching the selected layer',()=>{
  let scene=paintScene(panel(),100,[],'color','panel');
  let first=addPaintLayer(scene,'panel','raster');scene=first.scene;
  const second=addPaintLayer(scene,'panel','vector',paintAddPosition(scene.owners.find(o=>o.key==='panel'),first.layer.id,()=>false));scene=second.scene;
  let owner=scene.owners.find(o=>o.key==='panel');
  assert.deepEqual(owner.paint.layers.map(l=>l.name),['レイヤー 2','レイヤー 1']);
  const folder=addPaintFolder(owner.paint);owner={...owner,paint:folder.paint};
  scene={...scene,owners:scene.owners.map(o=>o.key==='panel'?owner:o)};
  const inside=addPaintLayer(scene,'panel','raster',paintAddPosition(owner,folder.folder.id,()=>false));scene=inside.scene;
  assert.equal(inside.layer.folderId,folder.folder.id);
  owner=scene.owners.find(o=>o.key==='panel');
  const below=addPaintLayer(scene,'panel','vector',paintAddPosition(owner,folder.folder.id,()=>true));
  assert.equal(below.layer.folderId,undefined);
  assert.deepEqual(paintLayerTree(below.scene.owners.find(o=>o.key==='panel').paint).slice(-2).map(e=>e.kind),['layer','folder']);
  owner={...owner,paint:{...owner.paint,folders:owner.paint.folders.map(f=>({...f,locked:true}))}};
  assert.deepEqual(paintAddPosition(owner,inside.layer.id,()=>false).target,{kind:'folder',id:folder.folder.id,placement:'below'});
});

test('direct sibling positions persist independently without overwriting another direct owner',()=>{
  const p=panel(),a=asset('stack');
  let scene=paintScene(p,100,[],'color','panel');
  const root=addPaintLayer(scene,'panel','raster');scene=root.scene;
  const sibling=addPaintLayer(scene,'panel','vector',{stack:{below:'bubble-0'}});scene=sibling.scene;
  assert.ok(scene.owners.findIndex(o=>o.key===sibling.key)<scene.owners.findIndex(o=>o.key==='bubble-0'));
  for(const key of ['panel',sibling.key]){
    const owner=scene.owners.find(o=>o.key===key);
    applyOwnerPaint(p,owner,{...createFrameArtwork(a,owner.frame),id:key,paint:owner.paint});
  }
  assert.equal(p.images.length,2);
  applyPaintAnchorIds({panels:[p]},0,false,scene.anchorIds);
  const reopened=paintScene(p,100,[a],'color','panel');
  assert.equal(paintStackTarget(reopened.owners.find(o=>o.key===sibling.key).stack,reopened.anchorIds),'bubble-0');
  p.bubbles.unshift({...p.bubbles[0],layerId:undefined});
  assert.equal(paintStackTarget(p.images[1].paintStack,paintAnchorIds(p)),'bubble-1');
  p.bubbles.pop();
  assert.equal(paintStackMatches(p.images[1].paintStack,undefined,paintAnchorIds(p)),true);
  assert.deepEqual(reopened.owners.find(o=>o.key==='panel').paint.layers.map(l=>l.name),['レイヤー 1']);
  clearOwnerPaint(p,reopened.owners.find(o=>o.key===sibling.key));
  assert.equal(p.images.length,1);assert.equal(p.images[0].paintStack,undefined);
});

test('native text bands retain folder membership and separate only the intended paint',()=>{
  const below=newPaintLayer('文字の下'),above={...newPaintLayer('文字の上'),aboveNative:true};
  const child={...newPaintLayer('フォルダー内'),folderId:'front'};
  const paint={version:1,width:100,height:100,dpi:100,layers:[below,above,child],folders:[{id:'front',name:'前',position:2,aboveNative:true}]};
  assert.deepEqual(paintNativeBand(paint,true).layers.map(l=>l.name),['文字の上','フォルダー内']);
  assert.deepEqual(paintNativeBand(paint,false).layers.map(l=>l.name),['文字の下']);
  assert.equal(paintNativeBand(paint,true).folders[0].id,'front');
});


test('orphan roots, panel-bar positions and original siblings have one display and picking order',()=>{
 const p=panel(),ids=paintAnchorIds(p,[{...p,layerId:'one'},{...p,id:2,layerId:'two'}]);
 const own=(key,stack,kind='page',extra={})=>({key,kind,stack,paint:{layers:[]},...extra});
 const base=[own('figure-0',undefined,'figure',{figure:p.figures[0],index:0}),own('bubble-0',undefined,'bubble',{bubble:p.bubbles[0],index:0}),own('original-id',undefined,'original',{parentKey:'bubble-0'}),own('page')];
 ids['original-id']='id';
 const scene=orderedPaintOwners([...base,own('second',{beforePanel:'layer:two'}),own('first',{beforePanel:'layer:one'}),own('orphan',{below:'layer:gone'}),own('original-sibling',{below:'layer:id'})],ids);
 assert.deepEqual(scene.map(o=>o.key),['first','second','figure-0','bubble-0','original-sibling','original-id','orphan','page']);
 assert.equal(scene.find(o=>o.key==='original-sibling').parentKey,'bubble-0');
 const images=[{id:'root',paintScope:'page'},{id:'orphan',paintScope:'page',paintStack:{below:'layer:gone'}},{id:'anchored',paintScope:'page',paintStack:{beforePanel:'layer:one'}}];
 assert.deepEqual(directPaintImages(images,'page',undefined,ids).map(i=>i.id),['orphan','root']);
});


test('layer moves between owners retain world positions, assets, paths and both masks',()=>{
 const ink={...newPaintLayer('移動用'),id:'moving',image:{assetId:'ink',crop:{x:1,y:2,w:20,h:30},bbox:{x:5,y:6,w:20,h:30}},strokes:[structuredClone(stroke)],
  mask:{enabled:true,strokes:[structuredClone(stroke)]},
  paths:[{id:'path',nodes:[{x:8,y:9,handleOut:{x:2,y:3}}],style:{width:2,dash:[],dashOffset:0}}],tone:{...defaultPaintTone(),origin:{x:7,y:8}}};
 const owner=(key,frame,width,height,layers)=>({key,kind:key,frame,paint:{version:1,width,height,dpi:100,guideInitialized:true,layers},index:0,label:key});
 const source=owner('page',{x:0,y:0,w:100,h:100},200,200,[ink]),target=owner('figure',{x:40,y:50,w:25,h:25},100,100,[]);
 const before=structuredClone([source,target]);
 const moved=movePaintEntry(source,target,'layer','moving',{kind:'root',edge:'top'}),layer=moved.destination.paint.layers[0];
 const world=(owner,p)=>({x:owner.frame.x+p.x*owner.frame.w/owner.paint.width,y:owner.frame.y+p.y*owner.frame.h/owner.paint.height});
 assert.equal(moved.source.paint.layers.length,0);assert.equal(layer.id,'moving');assert.equal(layer.name,'移動用');assert.deepEqual(layer.image.crop,ink.image.crop);assert.equal(layer.image.assetId,'ink');
 for(const [a,b] of [[ink.strokes[0].points[0],layer.strokes[0].points[0]],[ink.mask.strokes[0].points[0],layer.mask.strokes[0].points[0]],[ink.paths[0].nodes[0],layer.paths[0].nodes[0]],[ink.image.bbox,layer.image.bbox],[ink.tone.origin,layer.tone.origin]])assert.deepEqual(world(source,a),world(moved.destination,b));
 assert.equal(layer.tone.lpi,ink.tone.lpi/2);assert.equal(layer.paths[0].nodes[0].handleOut.x,4);assert.equal(layer.strokes[0].size,stroke.size*2);assert.deepEqual([source,target],before);
 const returned=movePaintEntry(moved.destination,moved.source,'layer','moving',{kind:'root',edge:'top'});
 assert.deepEqual(world(returned.destination,returned.destination.paint.layers[0].strokes[0].points[0]),world(source,ink.strokes[0].points[0]));
});

test('folder membership and native text bands use the same move across all owner kinds',()=>{
 const owner=(key,layers,folders=[])=>({key,kind:key,index:0,label:key,frame:{x:0,y:0,w:100,h:100},paint:{version:1,width:100,height:100,dpi:100,guideInitialized:true,layers,folders}});
 for(const key of ['page','panel','figure','bubble','background','original']){
  const ink={...newPaintLayer('移動'),id:'layer',folderId:'from'},source=owner('page',[ink],[{id:'from',name:'移動元',position:0}]);
  const target=owner(key,[],[{id:'to',name:'移動先',position:0,aboveNative:true}]);
  const moved=movePaintEntry(source,target,'layer','layer',{kind:'folder',id:'to',placement:'inside'});
  assert.equal(moved.destination.paint.layers[0].folderId,'to');assert.equal(moved.destination.paint.layers[0].aboveNative,true);assert.equal(moved.source.paint.folders[0].id,'from');
  const out=movePaintEntry(moved.destination,moved.destination,'layer','layer',{kind:'root',edge:'bottom',aboveNative:false});
  assert.equal(out.destination.paint.layers[0].folderId,undefined);assert.equal(out.destination.paint.layers[0].aboveNative,undefined);
  const grouped=movePaintEntry(moved.destination,moved.source,'folder','to',{kind:'root',edge:'top',aboveNative:false});
  assert.equal(grouped.destination.paint.folders.at(-1).id,'to');assert.equal(grouped.destination.paint.layers.at(-1).id,'layer');
 }
});

test('moves reject locked destinations, invalid targets and no-ops without changing owners',()=>{
 const owner=(key,layers)=>({key,kind:'panel',index:0,label:key,frame:{x:0,y:0,w:10,h:10},paint:{version:1,width:100,height:100,dpi:100,guideInitialized:true,layers}});
 const source=owner('source',[{...newPaintLayer(),id:'layer'}]),target=owner('target',[]),drop={kind:'root',edge:'top'};
 assert.equal(movePaintEntry(source,source,'layer','layer',drop),undefined);
 for(const locked of [{locked:true},{inheritedLocked:true}])assert.equal(movePaintEntry(source,{...target,...locked},'layer','layer',drop),undefined);
 assert.equal(movePaintEntry(source,{...target,paint:{...target.paint,folders:[{id:'folder',name:'固定',position:0,locked:true}]}},'layer','layer',{kind:'folder',id:'folder',placement:'inside'}),undefined);
 assert.equal(movePaintEntry(source,target,'layer','layer',{kind:'layer',id:'missing',after:true}),undefined);
 assert.equal(movePaintEntry(source,{...target,paint:{...target.paint,layers:Array.from({length:64},()=>newPaintLayer())}},'layer','layer',drop),undefined);
});

test('whole-canvas fills keep their original area and an emptied initialized owner does not recreate its guide',()=>{
 const source={key:'figure-0',kind:'figure',index:0,label:'人物',frame:{x:10,y:20,w:10,h:10},paint:{version:1,width:100,height:100,dpi:100,guideInitialized:true,layers:[{...newPaintLayer('全面'),id:'ink',tone:{...defaultPaintTone(),fill:true},strokes:[{...stroke,tool:'fill'}]}]}};
 const target={...source,key:'page',kind:'page',frame:{x:0,y:0,w:100,h:100},paint:{...source.paint,width:1000,height:1000,layers:[]}};
 const moved=movePaintEntry(source,target,'layer','ink',{kind:'root',edge:'top'});assert.deepEqual(moved.destination.paint.layers[0].clip,{x:100,y:200,w:100,h:100});
 assert.doesNotThrow(()=>validatePaintDocument(moved.source.paint,[]));
 const p=panel(),a=asset('empty',100,100);p.figures=[{name:'空になった人物',bbox:source.frame,artwork:{...createFrameArtwork(a,source.frame),paint:moved.source.paint}}];
 const reopened=paintScene(p,100,[a],'color','panel').owners.find(owner=>owner.kind==='figure');assert.equal(reopened.paint.layers.length,0);
 assert.throws(()=>validatePaintDocument({...moved.source.paint,guideInitialized:false},[]));
});


test('empty initialized artwork remains persisted after later visibility or lock edits',()=>{
 const paint={version:1,width:100,height:100,dpi:100,guideInitialized:true,layers:[]};
 for(const kind of ['figure','background','bubble']){
  const owner={key:kind,kind,index:0,label:kind,frame:{x:0,y:0,w:25.4,h:25.4},paint};
  assert.equal(paintOwnerShouldClear(owner),false);
  assert.equal(paintOwnerShouldClear({...owner,paint:{...paint},locked:false}),false);
  assert.equal(paintOwnerShouldClear({...owner,paint:{...paint,layers:paint.layers.map(layer=>({...layer,visible:false}))}}),false);
  assert.equal(paintOwnerShouldClear({...owner,paint:{...paint,guideInitialized:undefined}}),true);
 }
 for(const kind of ['page','panel','original'])assert.equal(paintOwnerShouldClear({kind,paint}),true);
 assert.equal(paintOwnerShouldClear({kind:'figure',paint:{...paint,folders:[{id:'kept',name:'空フォルダー',position:0}]}}),false);
});


// 見込み: boolean markerだけを許せば、画像レイヤーに古いmask objectが残ったデータを正規形式と誤認しない。合格: 通常マスクは有効、object等は拒否。範囲: 型/参照検証で、実データ修復は別に確認。
test('generation masks are ordinary leaf layers with shared visibility, bands and validation',()=>{
 const mask={...newPaintLayer('生成マスク'),generationMask:true,visible:false,antialias:0,aboveNative:true,strokes:[structuredClone(stroke)]};
 const paint={version:1,width:100,height:100,dpi:100,layers:[mask]};
 validatePaintDocument(paint,[]);
 const owner={kind:'bubble',key:'bubble-0',paint},original={kind:'original',key:'original-0',parentKey:'bubble-0',paint:{...paint,layers:[]}};
 assert.equal(paintOwnerShouldClear(owner),false);assert.equal(paintGenerationOwner({owners:[owner,original]},original.key),owner);
 assert.equal(paintGenerationOwner({owners:[owner,original]},owner.key),owner);
 assert.equal(paintGenerationOwner({owners:[{kind:'panel',key:'panel'}]},'panel'),undefined);
 for(const change of [layer=>layer.generationMask=1,layer=>layer.generationMask={enabled:true,strokes:[]},layer=>layer.antialias=5,layer=>layer.strokes[0].points[0].x=NaN,layer=>layer.kind='vector',layer=>layer.mask={enabled:true,reveal:false,strokes:[]}]){
  const broken=structuredClone(paint);change(broken.layers[0]);assert.throws(()=>validatePaintDocument(broken,[]));
 }
 assert.deepEqual(paintNativeBand(paint,true).layers,[mask]);assert.deepEqual(paintNativeBand(paint,false).layers,[]);
});

test('a generation mask moves alone outside a hidden locked native text while retaining its world coordinates',()=>{
 const mask={...newPaintLayer('生成マスク'),id:'marker',generationMask:true,aboveNative:true,strokes:[structuredClone(stroke)]};
 const sibling=newPaintLayer('生成画像'),paint={version:1,width:100,height:100,dpi:100,layers:[mask,sibling]};
 const source={kind:'bubble',key:'bubble-0',index:0,label:'文字',frame:{x:20,y:30,w:25,h:25},bubble:{hidden:true,nativeLocked:true},paint};
 const target={kind:'page',key:'page',index:0,label:'紙面',frame:{x:0,y:0,w:100,h:100},paint:{version:1,width:200,height:200,dpi:100,layers:[]}};
 const before=structuredClone(source),moved=movePaintEntry(source,target,'layer',mask.id,{kind:'root',edge:'top'});
 assert.ok(moved);assert.deepEqual(moved.source.paint.layers,[sibling]);assert.equal(moved.destination.paint.layers[0].generationMask,true);
 const point=moved.destination.paint.layers[0].strokes[0].points[0],original=mask.strokes[0].points[0];
 assert.equal(point.x/200*100,20+original.x/100*25);assert.equal(point.y/200*100,30+original.y/100*25);
 assert.deepEqual(source,before);
 const added=insertGeneratedPaintImage(source,{id:'image',widthPx:100,heightPx:100},'AI画像');
 assert.equal(added.owner.paint.layers.at(-1),added.layer);assert.equal(added.layer.aboveNative,true);assert.deepEqual(added.owner.bubble,source.bubble);
});
