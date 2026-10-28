import assert from 'node:assert/strict';
import test from 'node:test';
import {newPaintLayer,paintScene} from '../src/lib/paintDocument.ts';
import {defaultVectorStyle,vectorShape} from '../src/lib/vectorGeometry.ts';
import {pickPaintLayer,paintOwnerPoint,translatePaintLayer} from '../src/lib/paintLayerPicking.ts';
const vector=(name)=>({...newPaintLayer(name,'vector'),paths:[vectorShape('line',{x:10,y:50},{x:90,y:50},{...defaultVectorStyle(),width:4})]});
const owner=(key,layers)=>({key,kind:key==='background'?'background':'figure',frame:{x:10,y:20,w:100,h:100},paint:{width:100,height:100,layers}});
const coverage=()=>true;
test('root direct paint stays above text and figures in each scope',()=>{
 const box={x:10,y:20,w:100,h:100};
 const panel={id:1,shape:{type:'rect',...box},bg:0,action:null,figures:[{name:'front',bbox:box}],bubbles:[{text:'front bubble',bbox:box}]};
 const before=structuredClone(panel);
 for(const scope of ['page','panel']){
  const scene=paintScene(panel,25.4,[],'color',scope);
  assert.deepEqual(scene.owners.map(o=>o.key),['background','figure-0','bubble-0',scope]);
  // Identical real vector layers isolate stack order from coverage at one point.
  scene.owners.forEach(o=>{o.paint={...o.paint,layers:[vector(o.key)]};});
  const at=()=>pickPaintLayer(scene,{x:60,y:70},0,coverage)?.owner;
  assert.equal(at()?.key,scope);
  scene.owners.find(o=>o.key===scope).paint.layers[0].visible=false;
  assert.equal(at()?.key,'bubble-0');
  at().locked=true;
  assert.equal(at()?.key,'figure-0','locked front content lets the next visible owner be picked');
 }
 assert.deepEqual(panel,before);
});
test('front-to-back picking skips a locked selected layer and owner while retaining behind vectors',()=>{
 const back=vector('back'),front={...vector('front'),locked:true},o=owner('background',[back,front]);
 const foreign=owner('figure-0',[vector('foreign')]);foreign.locked=true;
 const hit=pickPaintLayer({owners:[o,foreign]},{x:60,y:70},0,coverage);
 assert.equal(hit.owner,o);assert.equal(hit.layer,back);assert.equal(hit.pathId,back.paths[0].id);
 front.locked=false;assert.equal(pickPaintLayer({owners:[o]},{x:60,y:70},0,coverage).layer,front);
});
test('native owner scale and offsets apply to tolerance and hit coordinates across owners',()=>{
 const o=owner('figure-0',[vector('top')]);o.frame={x:20,y:30,w:50,h:50};
 assert.deepEqual(paintOwnerPoint(o,{x:45,y:55}),{x:50,y:50});
 const hit=pickPaintLayer({owners:[o]},{x:45,y:56},1,coverage);assert.deepEqual(hit.point,{x:50,y:52});
});
test('transparent raster pixels and masked vectors allow picking the next visible layer',()=>{
 const back=vector('back'),masked=vector('masked'),raster={...newPaintLayer('transparent'),image:{assetId:'a'}};
 const o=owner('background',[back,masked,raster]),seen=[];
 const hit=pickPaintLayer({owners:[o]},{x:60,y:70},0,(_o,l)=>{seen.push(l.name);return l===back;});
 assert.deepEqual(seen,['transparent','masked','back']);assert.equal(hit.layer,back);
});
test('hidden, zero opacity, clipped and out-of-frame content cannot be selected',()=>{
 const back=vector('back'),o=owner('background',[back,{...vector('hidden'),visible:false},{...vector('zero'),opacity:0},{...vector('clipped'),clip:{x:0,y:0,w:20,h:20}}]);
 assert.equal(pickPaintLayer({owners:[o]},{x:60,y:70},1,coverage).layer,back);
 assert.equal(pickPaintLayer({owners:[o]},{x:9,y:70},1,coverage),undefined);
 o.bubble={hidden:true};assert.equal(pickPaintLayer({owners:[o]},{x:60,y:70},1,coverage),undefined);
});
test('moving one layer retains sibling/source data and translates images, erasure, masks and tone origin together',()=>{
 const l={...vector('move'),image:{assetId:'a',crop:{x:0,y:0,w:50,h:50},bbox:{x:10,y:20,w:50,h:50}},clip:{x:1,y:2,w:90,h:90},strokes:[{tool:'clear',points:[{x:10,y:20,pressure:1}],selection:[{x:1,y:2,w:3,h:4}]}],mask:{enabled:true,reveal:false,strokes:[{tool:'pen',points:[{x:5,y:6}]}]},generationMask:{enabled:true,strokes:[]},tone:{origin:{x:1,y:2}}};
 const before=structuredClone(l),next=translatePaintLayer(l,7,-4);
 assert.deepEqual(l,before);assert.equal(next.image.assetId,'a');assert.deepEqual(next.image.crop,l.image.crop);assert.equal(next.image.bbox.x,17);assert.equal(next.clip.y,-2);
 assert.deepEqual(next.strokes[0].selection[0],{x:8,y:-2,w:3,h:4});assert.equal(next.mask.strokes[0].points[0].y,2);assert.equal(next.paths[0].nodes[0].x,l.paths[0].nodes[0].x+7);assert.deepEqual(next.tone.origin,{x:8,y:-2});
 const locked={...l,locked:true};assert.equal(translatePaintLayer(locked,2,3),locked);
});


test('native front paint is picked before linked originals and their sibling paint',()=>{
 const below=vector('below'),above={...vector('above'),aboveNative:true},bubble={...owner('bubble-0',[below,above]),kind:'bubble',bubble:{text:'text'}};
 const sibling={...owner('panel:original',[vector('sibling')]),kind:'panel',parentKey:'bubble-0'},original={...owner('original-a',[vector('original')]),kind:'original',parentKey:'bubble-0'};
 const scene={owners:[bubble,sibling,original]},hit=()=>pickPaintLayer(scene,{x:60,y:70},0,coverage)?.layer;
 assert.equal(hit(),above);above.visible=false;assert.equal(hit(),original.paint.layers[0]);original.paint.layers[0].visible=false;
 assert.equal(hit(),sibling.paint.layers[0]);sibling.paint.layers[0].visible=false;assert.equal(hit(),below);
});
