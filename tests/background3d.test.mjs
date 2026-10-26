import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix4,PerspectiveCamera,Vector3 } from 'three';
import { cubeGlb } from './background3dFixture.mjs';
import { CUBE_STAGE_ID,defaultBackgroundCapture,validateBackgroundCapture,prepareBackgroundStage,verifyBackgroundStage,appendBackgroundCapture } from '../src/lib/background3d.ts';
import { loadStageShape,fitStageCamera,backgroundPaths,stageClipPlanes } from '../src/lib/background3dRenderer.ts';
import { visibleBackgroundEdges } from '../src/lib/background3dGeometry.ts';
import { newPaintLayer,validatePaintDocument,expandPaintOwner,paintForFrame } from '../src/lib/paintDocument.ts';
import { eraseVectors,defaultVectorStyle } from '../src/lib/vectorGeometry.ts';
import { createProjectSnapshot,restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { collectFigureCropAssetIds } from '../src/lib/figureCropStore.ts';
import { panelTestDocument } from './fixtures/emptyTestDocument.ts';
const frame={x:0,y:0,w:600,h:400},capture=()=>defaultBackgroundCapture(frame);
const paint=()=>({version:1,width:600,height:400,dpi:600,layers:[newPaintLayer('手直し')]});
const sample=panelTestDocument;
const sha=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
function edges(shape,shot){const c=new PerspectiveCamera(shot.camera.fov,shot.frame.w/shot.frame.h);c.position.fromArray(shot.camera.position);c.lookAt(...shot.camera.target);c.updateMatrixWorld(true);Object.assign(c,stageClipPlanes(shape,c));c.updateProjectionMatrix();return visibleBackgroundEdges(shape.meshes,new Matrix4().multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse).toArray(),c.position.toArray(),{width:600,height:400,creaseAngle:35,detail:1,outlineWidth:4,detailWidth:2}).segments;}

test('builtin and self-contained GLB cubes import into editable, visible vector lines',async()=>{
  const builtin=await loadStageShape(),{stage,blob}=await prepareBackgroundStage(cubeGlb()),imported=await loadStageShape(stage,blob);
  assert.equal(imported.meshes[0].indices.length,36);assert.equal(imported.bounds.getSize(new Vector3()).x,2);
  for(const shape of [builtin,imported]){
    const shot={...capture(),camera:fitStageCamera(shape)},visible=edges(shape,shot),paths=backgroundPaths(visible,shot,600);assert.equal(paths.length,9);
    const line=paths[0],mid={x:(line.nodes[0].x+line.nodes[1].x)/2,y:(line.nodes[0].y+line.nodes[1].y)/2};
    const erased=eraseVectors(paths,[mid],2,'whole');assert.ok(erased.length<paths.length);assert.ok(erased.length>0);
    validatePaintDocument({...paint(),layers:[{...newPaintLayer('3D 線画','vector'),paths}]},[]);
  }
});
test('hidden edges remain hidden at the maximum orbit distance',async()=>{
  const shape=await loadStageShape(),shot=capture(),radius=shape.bounds.getSize(new Vector3()).length()/2;
  for(const distance of [7,100,1000,radius*1000]){
    shot.camera.position=new Vector3(4,3,5).normalize().multiplyScalar(distance).toArray();
    assert.equal(edges(shape,shot).length,9,`distance ${distance}`);
  }
});
test('repeated capture replaces generated layers without mutating the previous editable snapshot',()=>{
  const original=paint(),oldLayer={...newPaintLayer('撮影1','vector'),paths:[{id:'edited',closed:false,nodes:[{x:0,y:0},{x:5,y:9}],style:defaultVectorStyle()}]};
  const first=appendBackgroundCapture(original,capture(),[oldLayer]);const before=structuredClone(first);
  const second=appendBackgroundCapture(first,{...capture(),camera:{...capture().camera,fov:60}},[newPaintLayer('撮影2','vector')]);
  assert.deepEqual(first,before);assert.equal(second.layers[0],original.layers[0]);assert.equal(second.layers.length,2);assert.equal(second.layers[1].name,'撮影2');assert.deepEqual(first.layers[1].paths,oldLayer.paths);assert.equal(second.background3d.camera.fov,60);
});
test('capture frame and generated layer identities survive padding and placement reframing',()=>{
  const doc=appendBackgroundCapture(paint(),capture(),[newPaintLayer('3D','vector')]),owner={key:'background',kind:'background',index:0,label:'背景',frame:{x:0,y:0,w:60,h:40},paint:doc};
  const padded=expandPaintOwner(owner,{left:12,right:0,top:8,bottom:0});assert.deepEqual(padded.paint.background3d.frame,{x:12,y:8,w:600,h:400});
  const asset={id:'preview',widthPx:600,heightPx:400},image={id:'placement',assetId:'preview',crop:frame,bbox:{x:0,y:0,w:60,h:40},opacity:1,hidden:false,locked:false,paint:doc};
  const reframed=paintForFrame({x:-10,y:-10,w:120,h:80},300,[image],[asset]);
  assert.equal(reframed.background3d.sourceId,CUBE_STAGE_ID);assert.ok(reframed.background3d.frame.x>0);assert.notEqual(reframed.background3d.layerIds[0],doc.background3d.layerIds[0]);assert.ok(reframed.layers.some(l=>l.id===reframed.background3d.layerIds[0]));
});
test('portable project saves shared stage once and remaps its blob id on restore',async()=>{
  const original=sample(),{stage,blob}=await prepareBackgroundStage(cubeGlb()),preview=new Blob(['synthetic preview'],{type:'image/png'}),hash=await sha(preview);
  const asset={id:`image-${hash}`,storageId:'preview-store',sha256:hash,mediaType:'image/png',originalName:'cube.png',widthPx:600,heightPx:400,byteLength:preview.size};
  original.manga.background_stages=[stage];original.manga.image_assets=[asset];
  const doc=appendBackgroundCapture(paint(),{...capture(),camera:{...capture().camera,shift:[.13,-.08]},sourceId:stage.id,light:{azimuth:-90,elevation:18,preset:'evening',intensity:.7,bounce:1.3,windowMesh:0,ceiling:false},toneThreshold:62,cutaway:{enabled:true,depth:.32},objectVisibility:[{mesh:0,mode:'show'},{mesh:1,mode:'hide'}],focusMesh:0,focusPoint:[.1,.2,.3]},[newPaintLayer('線画','vector')]);
  original.manga.pages[0].panels[0].background_images=[{id:'cube',assetId:asset.id,crop:frame,bbox:{x:0,y:0,w:60,h:40},opacity:1,hidden:false,locked:false,paint:doc}];
  const snapshot=await createProjectSnapshot(original,async id=>id===stage.storageId?blob:preview);assert.equal(snapshot.assets.length,2);
  let saved;const restored=await restoreProjectSnapshot(snapshot,async assets=>{saved=assets;});assert.equal(saved.length,2);assert.notEqual(restored.manga.background_stages[0].storageId,stage.storageId);
  assert.ok(collectFigureCropAssetIds(restored).includes(restored.manga.background_stages[0].storageId));assert.deepEqual(restored.manga.pages[0].panels[0].background_images[0].paint.background3d,doc.background3d);
  const corrupt=structuredClone(snapshot);corrupt.assets.find(a=>a.id===stage.storageId).data=btoa('corrupt');await assert.rejects(restoreProjectSnapshot(corrupt,async()=>assert.fail('must not write corrupt asset')),/原本/);
});
test('invalid camera and missing stage are rejected before project writes',async()=>{
  const c=capture();c.camera.position=[...c.camera.target];assert.throws(()=>validateBackgroundCapture(c),/カメラ/);
  const {stage,blob}=await prepareBackgroundStage(cubeGlb());await verifyBackgroundStage(stage,blob);await assert.rejects(verifyBackgroundStage(stage,new Blob(['bad'])),/原本/);
  const original=sample();original.manga.background_stages=[{...stage,id:'not-an-id'}];await assert.rejects(createProjectSnapshot(original),/3D舞台/);
});
test('optional picture shift accepts finite frame offsets without changing old captures',()=>{
 validateBackgroundCapture(capture());
 for(const shift of [[0,0],[.13,-.08],[-2,4]])validateBackgroundCapture({...capture(),camera:{...capture().camera,shift}});
 for(const shift of [null,{},[],[0],[0,0,0],[0,NaN],[Infinity,0],['1',0],[true,0]])assert.throws(()=>validateBackgroundCapture({...capture(),camera:{...capture().camera,shift}}),/設定/);
});
test('optional cutaway settings preserve old captures and reject malformed saved values',()=>{
 validateBackgroundCapture(capture());
 for(const cutaway of [{enabled:false,depth:.05},{enabled:true,depth:.45}])validateBackgroundCapture({...capture(),cutaway});
 for(const cutaway of [null,{},[],{enabled:1,depth:.25},{enabled:true,depth:NaN},{enabled:true,depth:0},{enabled:true,depth:.46}])assert.throws(()=>validateBackgroundCapture({...capture(),cutaway}),/設定/);
});
test('optional focused object identity accepts zero and rejects malformed saved indices',()=>{
 for(const focusMesh of [0,18])validateBackgroundCapture({...capture(),focusMesh});
 for(const focusMesh of [null,-1,.5,NaN,Infinity,'0',true,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateBackgroundCapture({...capture(),focusMesh}),/設定/);
});

test('picked surface points require a selected object and finite 3D coordinates',()=>{
 validateBackgroundCapture({...capture(),focusMesh:0,focusPoint:[1,2,3]});
 for(const focusPoint of [null,[1,2],[1,2,NaN],[1,2,Infinity],['1',2,3]])assert.throws(()=>validateBackgroundCapture({...capture(),focusMesh:0,focusPoint}),/設定/);
 assert.throws(()=>validateBackgroundCapture({...capture(),focusPoint:[1,2,3]}),/設定/);
});
test('recapturing at the layer limit reuses the previous capture slots',()=>{
 const source=paint();source.layers=Array.from({length:61},()=>newPaintLayer('手描き'));
 const shot=()=>Array.from({length:3},()=>newPaintLayer('撮影'));
 const first=appendBackgroundCapture(source,capture(),shot()),second=appendBackgroundCapture(first,capture(),shot());
 assert.equal(second.layers.length,64);assert.deepEqual(second.layers.slice(0,61),source.layers);
 assert.throws(()=>appendBackgroundCapture({...source,layers:[...source.layers,newPaintLayer()]},capture(),shot()),/64/);
});

test('per-shot object visibility validates unique stable meshes and explicit modes',()=>{
 for(const objectVisibility of [[],[{mesh:0,mode:'show'}],[{mesh:0,mode:'hide'},{mesh:3,mode:'show'}]])validateBackgroundCapture({...capture(),objectVisibility});
 for(const objectVisibility of [null,{},[null],[{}],[{mesh:-1,mode:'show'}],[{mesh:.5,mode:'hide'}],[{mesh:true,mode:'show'}],[{mesh:0,mode:'auto'}],[{mesh:0,mode:'hide'},{mesh:0,mode:'show'}]])assert.throws(()=>validateBackgroundCapture({...capture(),objectVisibility}),/設定/);
});
