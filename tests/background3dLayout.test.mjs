import assert from 'node:assert/strict';
import test from 'node:test';
import {moveBackgroundLayoutOwner} from '../src/lib/background3dLayout.ts';
import {defaultBackgroundCapture} from '../src/lib/background3d.ts';
import {applyOwnerPaint,paintScene,paintReferenceBox,withPaintBleed} from '../src/lib/paintDocument.ts';
import {createFrameArtwork} from '../src/lib/imagePlacement.ts';

const panel=()=>({id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:1,figures:[{name:'人物',size:'full',bbox:{x:10,y:20,w:25.4,h:50.8},analogImport:{schemaVersion:1,sourceRegionId:'scan-region',assetId:'scan',sourceBBox:{x:3,y:4,w:20,h:40},detectionSource:'body',draft:true}}],bubbles:[{text:'そのまま',shape:'normal',bbox:{x:65,y:20,w:20,h:30},tail:{x:.25,y:.6}}]});

test('moving foreground preserves expanded paint coordinates and the background camera',()=>{
 const scene=paintScene(panel(),100,[]);
 scene.owners=scene.owners.map(owner=>owner.kind==='background'?owner:withPaintBleed(owner,24));
 scene.owners[0].paint.background3d=defaultBackgroundCapture({x:0,y:0,w:394,h:394},100);
 const before=structuredClone(scene),moved=moveBackgroundLayoutOwner(scene,'figure-0',3,-2),original=scene.owners[1],next=moved.owners[1];
 assert.deepEqual(scene,before);assert.equal(moved.owners[0],scene.owners[0]);assert.equal(moved.owners[2],scene.owners[2]);
 assert.equal(next.paint,original.paint);assert.deepEqual(next.frame,{...original.frame,x:original.frame.x+3,y:original.frame.y-2});
 const a=paintReferenceBox(original.paint,original.frame),b=paintReferenceBox(next.paint,next.frame);
 assert.deepEqual(b,{...a,x:a.x+3,y:a.y-2});assert.equal(next.figure.analogImport.userEdited,true);
});

test('moved figures and bubbles save and reopen with source metadata and paint grids intact',()=>{
 const p=panel(),scene=paintScene(p,100,[]),assets=[];
 scene.owners=scene.owners.map(owner=>owner.kind==='background'?owner:withPaintBleed(owner,24));
 const moved=moveBackgroundLayoutOwner(moveBackgroundLayoutOwner(scene,'figure-0',7,9),'bubble-0',-6,4);
 for(const owner of moved.owners.slice(1)){
  const asset={id:owner.key,storageId:owner.key,sha256:'a'.repeat(64),mediaType:'image/png',originalName:'paint.png',widthPx:owner.paint.width,heightPx:owner.paint.height,byteLength:1};assets.push(asset);
  applyOwnerPaint(p,owner,{...createFrameArtwork(asset,owner.frame),paint:owner.paint});
 }
 const reopened=paintScene(p,100,assets);
 for(let i=1;i<3;i++){assert.deepEqual(reopened.owners[i].frame,moved.owners[i].frame);assert.deepEqual(reopened.owners[i].paint,moved.owners[i].paint);}
 assert.deepEqual(p.figures[0].analogImport,{...panel().figures[0].analogImport,userEdited:true});
 assert.equal(p.bubbles[0].text,'そのまま');assert.deepEqual(p.bubbles[0].tail,panel().bubbles[0].tail);
});

test('locked, hidden and invalid targets cannot be translated through the 3D workspace',()=>{
 const scene=paintScene(panel(),100,[]);
 for(const [key,dx,dy] of [['missing',1,2],['background',1,2],['figure-0',NaN,2],['bubble-0',1,Infinity],['figure-0',0,0]])assert.equal(moveBackgroundLayoutOwner(scene,key,dx,dy),scene);
 scene.owners[1].figure.artwork={locked:true};assert.equal(moveBackgroundLayoutOwner(scene,'figure-0',1,2),scene);
 scene.owners[2].bubble.paint_overlay={locked:true};assert.equal(moveBackgroundLayoutOwner(scene,'bubble-0',1,2),scene);
 scene.owners[2].bubble.paint_overlay=undefined;scene.owners[2].bubble.hidden=true;assert.equal(moveBackgroundLayoutOwner(scene,'bubble-0',1,2),scene);
});

test('foreground with only locked visible layers is skipped, while a mixed owner remains independently editable',()=>{
 const scene=paintScene(panel(),100,[]),owner=scene.owners[1];
 owner.paint.layers=owner.paint.layers.map(layer=>({...layer,locked:true}));
 assert.equal(moveBackgroundLayoutOwner(scene,owner.key,3,4),scene);
 const line={...owner.paint.layers[0],id:'editable',locked:false,guide:false,strokes:[{tool:'pen',size:2,points:[{x:1,y:1}]}]};
 owner.paint.layers.push(line);assert.notEqual(moveBackgroundLayoutOwner(scene,owner.key,3,4),scene);
});
