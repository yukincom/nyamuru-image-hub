import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,BoxGeometry,Vector3} from 'three';
import {backgroundLightSettings,backgroundLightWindow,backgroundPresetLight,backgroundRoomBounds} from '../src/lib/background3dLightingModel.ts';
import {defaultBackgroundCapture,validateBackgroundCapture} from '../src/lib/background3d.ts';
import {BackgroundLightProbe} from '../src/lib/background3dLightProbe.ts';
import {LightProbeGenerator} from 'three/addons/lights/LightProbeGenerator.js';
import {FloatType,WebGLCoordinateSystem} from 'three';
function box(p,s,rotation=0){const g=new BoxGeometry(...s);g.rotateY(rotation);g.translate(...p);const mesh={positions:Array.from(g.attributes.position.array),indices:Array.from(g.index.array)};g.dispose();return mesh;}
function shape(){return {meshes:[box([0,-.05,0],[4,.1,6]),box([-2,1.5,-.5],[.01,1,1]),box([-2,1.5,.5],[.01,1,1]),box([8,1,0],[1,2,1]),box([-2,.9,0],[.1,.1,2])],meshNames:['Main_Floor','Window_glass_L','Window_glass_R','Annex','Window_sill'],windowMeshes:[1,2],groups:[[1,2,4]],bounds:new Box3(new Vector3(-2,-.1,-3),new Vector3(8.5,3,3))};}
const capture=()=>defaultBackgroundCapture({x:0,y:0,w:600,h:400});
test('main floor bounds avoid annex lighting volume and glass panes form an inward opening',()=>{
 const s=shape(),room=backgroundRoomBounds(s);assert.ok(Math.abs(room.min.y)<1e-8);assert.equal(room.max.x,2);
 const window=backgroundLightWindow(s,capture().light);assert.deepEqual(window.indices,[1,2]);assert.ok(window.normal.x>.99);assert.ok(Math.abs(window.width-2)<1e-6);assert.equal(window.height,1);
 const selected=backgroundLightWindow(s,{...capture().light,windowMesh:4});assert.deepEqual(selected.indices,[1,2]);assert.ok(selected.normal.x>.99);assert.deepEqual(selected.centre.toArray(),window.centre.toArray());
 const preset=backgroundPresetLight(capture().light,'evening',s);assert.equal(preset.azimuth,-90);assert.equal(preset.elevation,18);
});
test('manual unlabelled and rotated windows retain their actual orientation',()=>{
 const s={meshes:[box([-2,1.5,0],[.01,1,2],Math.PI/4)],bounds:new Box3(new Vector3(-3,0,-3),new Vector3(3,3,3))};
 assert.equal(backgroundLightWindow(s,capture().light),undefined);
 const window=backgroundLightWindow(s,{...capture().light,windowMesh:0});assert.ok(Math.abs(window.width-2)<1e-6);assert.ok(window.normal.x>.7&&window.normal.z<-.7);
 assert.equal(backgroundLightWindow(s,{...capture().light,windowMesh:9}),undefined);
});
test('probe atlas agrees with Three SH integration and keeps its resources isolated',async()=>{
 const fill=(data,face)=>{for(let i=0;i<data.length;i+=4){data[i]=(face+1)/6;data[i+1]=(i%68)/68;data[i+2]=.2+face*.03;data[i+3]=1;}};
 const renderer={isWebGLRenderer:true,coordinateSystem:WebGLCoordinateSystem,readRenderTargetPixels:(_t,_x,_y,_w,_h,data,face)=>fill(data,face),readRenderTargetPixelsAsync:async(_t,_x,_y,_w,_h,data,face)=>fill(data,face)};
 const expected=await LightProbeGenerator.fromCubeRenderTarget(renderer,{width:16,texture:{type:FloatType,colorSpace:''}}),coefficients=expected.sh.coefficients.flatMap(value=>value.toArray());coefficients.push(0);
 const first=new BackgroundLightProbe(4,3,6,new Vector3(),.01,100),second=new BackgroundLightProbe(8,6,12,new Vector3(),.02,200);
 first.camera.update=()=>{};second.camera.update=()=>{};
 try{
  assert.notEqual(first.target,second.target);assert.notEqual(first.grid.texture,second.grid.texture);
  for(let i=0;i<48;i++)first.bake(renderer,{},i);
  const data=first.grid.texture.image.data;
  for(let volume=0;volume<7;volume++)for(let cell=0;cell<72;cell++)for(let channel=0;channel<4;channel++)assert.ok(Math.abs(data[(volume*72+cell)*4+channel]-coefficients[volume*4+channel])<1e-6);
  assert.ok(second.grid.texture.image.data.every(value=>value===0));
  first.dispose();second.bake(renderer,{},0);assert.ok(second.grid.texture.image.data.some(value=>value!==0));
 }finally{first.dispose();second.dispose();}
});
test('optional light and tone boundary fields accept old captures and reject invalid saved values',()=>{
 const old={...capture(),light:{azimuth:45,elevation:50}};delete old.toneThreshold;validateBackgroundCapture(old);assert.equal(backgroundLightSettings(old.light).bounce,1);
 for(const patch of [{preset:'evening',intensity:.1,bounce:0,windowMesh:0,ceiling:false},{preset:'indoor',intensity:4,bounce:2,ceiling:true}])validateBackgroundCapture({...capture(),light:{...capture().light,...patch}});
 for(const patch of [{preset:'night'},{intensity:0},{intensity:4.1},{intensity:NaN},{bounce:-1},{bounce:2.1},{windowMesh:-1},{windowMesh:.5},{windowMesh:Infinity},{ceiling:0}])assert.throws(()=>validateBackgroundCapture({...capture(),light:{...capture().light,...patch}}),/設定/);
 for(const toneThreshold of [0,30,100])validateBackgroundCapture({...capture(),toneThreshold});
 for(const toneThreshold of [-1,101,NaN,null,true])assert.throws(()=>validateBackgroundCapture({...capture(),toneThreshold}),/設定/);
});
