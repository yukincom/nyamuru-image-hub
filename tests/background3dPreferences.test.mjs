import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultBackgroundCapture} from '../src/lib/background3d.ts';
import {defaultPaintTone} from '../src/lib/paintTone.ts';
import {applyBackground3dDefaults,background3dDefaults,background3dDefaultGroups,hasSavedBackground3dDefault,loadBackground3dDefaults,saveBackground3dDefaults,saveBackground3dDefaultGroup} from '../src/lib/background3dPreferences.ts';

const capture=()=>defaultBackgroundCapture({x:5,y:10,w:600,h:400},350);
function storage(){const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
const custom=()=>({...capture(),outlineWidth:5,detailWidth:2.4,creaseAngle:52,detail:.35,lineGap:.3,blackAmount:24,toneThreshold:62,toneEnabled:false,
  light:{azimuth:123,elevation:25,preset:'indoor',intensity:.37,bounce:.46,ceiling:false,windowMesh:99},cutaway:{enabled:true,depth:.33}});

test('personal defaults survive reload and contain only model-independent rendering choices',()=>{
  const store=storage(),shot={...custom(),sourceId:'private-stage',camera:{position:[8,4,3],target:[2,1,0],fov:55,shift:[.1,.2]},focusMesh:7,focusPoint:[1,2,3],objectVisibility:[{mesh:8,mode:'hide'}],layerIds:['previous'],toneLpi:85,toneDensity:50};
  const saved=saveBackground3dDefaults(store,shot);assert.deepEqual(loadBackground3dDefaults(store),saved);
  for(const key of ['sourceId','camera','focusMesh','focusPoint','objectVisibility','layerIds','frame','toneLpi','toneDensity','cutaway'])assert.ok(!(key in saved),key);
  assert.ok(!('windowMesh' in saved.light));
  shot.light.bounce=.01;shot.outlineWidth=9;assert.equal(loadBackground3dDefaults(store).light.bounce,.46);assert.equal(loadBackground3dDefaults(store).outlineWidth,5);
});

test('reset restores personal rendering settings while preserving the current shot and palette tone defaults',()=>{
  const shot={...capture(),sourceId:'another-stage',focusMesh:3,focusPoint:[.2,.3,.4],objectVisibility:[{mesh:4,mode:'show'}],layerIds:['current'],light:{...capture().light,windowMesh:42},cutaway:{enabled:false,depth:.42},toneLpi:30,toneDensity:80};
  const before=structuredClone(shot),saved=background3dDefaults(custom()),restored=applyBackground3dDefaults(shot,saved,350);
  assert.deepEqual(shot,before);assert.deepEqual(background3dDefaults(restored),saved);
  for(const key of ['sourceId','camera','focusMesh','focusPoint','objectVisibility','layerIds','frame'])assert.deepEqual(restored[key],shot[key],key);
  assert.equal(restored.light.windowMesh,42);assert.equal(restored.cutaway.depth,.42);
  assert.equal(restored.toneLpi,defaultPaintTone().lpi);assert.equal(restored.toneDensity,defaultPaintTone().density);
});

test('new frames use personal defaults and unsaved edits never rewrite the stored standard',()=>{
  const store=storage(),saved=saveBackground3dDefaults(store,custom()),next=applyBackground3dDefaults(defaultBackgroundCapture({x:0,y:0,w:100,h:80},150),loadBackground3dDefaults(store),150);
  assert.equal(next.light.intensity,.37);assert.equal(next.outlineWidth,5);assert.equal(next.cutaway.enabled,true);
  next.light.intensity=.79;next.blackAmount=80;assert.deepEqual(loadBackground3dDefaults(store),saved);
});

test('missing or damaged preferences fall back safely, with factory widths appropriate for the document',()=>{
  for(const store of [undefined,{getItem:()=>null},{getItem:()=>'{broken'},{getItem:()=>JSON.stringify({version:2})},{getItem:()=>{throw Error('Blocked');}}])assert.equal(loadBackground3dDefaults(store),undefined);
  for(const dpi of [150,350,600]){
    const restored=applyBackground3dDefaults(custom(),undefined,dpi),factory=defaultBackgroundCapture(restored.frame,dpi);
    assert.deepEqual(background3dDefaults(restored),background3dDefaults(factory));
  }
});

test('invalid or unavailable storage cannot silently replace a previously saved default',()=>{
  const store=storage(),saved=saveBackground3dDefaults(store,custom());
  for(const shot of [{...custom(),blackAmount:NaN},{...custom(),light:{...custom().light,bounce:2}},{...custom(),toneThreshold:-1}])assert.throws(()=>saveBackground3dDefaults(store,shot));
  assert.deepEqual(loadBackground3dDefaults(store),saved);
  assert.throws(()=>saveBackground3dDefaults({setItem:()=>{throw Error('Full');}},custom()),/Full/);
});

test('each section saves only its own choices, leaving other saved defaults intact',()=>{
  for(const group of Object.keys(background3dDefaultGroups)){
    const store=storage(),before=saveBackground3dDefaults(store,capture());
    const saved=saveBackground3dDefaultGroup(store,custom(),group,350);
    const expected=background3dDefaults(applyBackground3dDefaults(capture(),background3dDefaults(custom()),350,group));
    assert.deepEqual(background3dDefaults(applyBackground3dDefaults(capture(),saved,350)),expected,group);
    assert.deepEqual(loadBackground3dDefaults(store),saved);
    assert.ok(Object.keys(background3dDefaultGroups).every(key=>hasSavedBackground3dDefault(saved,key)),'legacy defaults remain saved');
    assert.notDeepEqual(saved,before);
  }
});

test('a first section save leaves unrelated sections unsaved and preserves their per-document factory defaults',()=>{
  const store=storage(),saved=saveBackground3dDefaultGroup(store,custom(),'tone',150);
  assert.deepEqual(saved.savedGroups,['tone']);assert.equal(hasSavedBackground3dDefault(saved,'line'),false);
  for(const dpi of [150,350,600]){
    const next=applyBackground3dDefaults(capture(),loadBackground3dDefaults(store),dpi),factory=defaultBackgroundCapture(next.frame,dpi);
    assert.equal(next.outlineWidth,factory.outlineWidth);assert.deepEqual(next.light,background3dDefaults(factory).light);
    assert.equal(next.blackAmount,24);assert.equal(next.cutaway.enabled,false);
  }
  const both=saveBackground3dDefaultGroup(store,{...custom(),blackAmount:90},'line',350);
  assert.deepEqual(both.savedGroups,['tone','line']);assert.equal(both.blackAmount,24);assert.equal(both.outlineWidth,5);
});

test('section reset preserves all unrelated live choices and model-specific window selection',()=>{
  const shot={...custom(),toneLpi:80,toneDensity:50},before=structuredClone(shot),saved=background3dDefaults(capture());
  for(const group of Object.keys(background3dDefaultGroups)){
    const reset=applyBackground3dDefaults(shot,saved,350,group);
    const changed=new Set(background3dDefaultGroups[group]);
    for(const key of ['outlineWidth','detailWidth','creaseAngle','detail','lineGap','blackAmount','toneEnabled','toneThreshold'])assert.equal(reset[key],changed.has(key)?saved[key]:shot[key],`${group}: ${key}`);
    for(const key of Object.keys(shot.light))assert.equal(reset.light[key],changed.has(key)?saved.light[key]:shot.light[key],`${group}: light.${key}`);
    assert.equal(reset.cutaway.enabled,group==='stage'?saved.cutawayEnabled:shot.cutaway.enabled);assert.equal(reset.cutaway.depth,shot.cutaway.depth);
    for(const key of ['camera','sourceId','frame','layerIds'])assert.deepEqual(reset[key],shot[key]);
    if(group!=='tone'){assert.equal(reset.toneLpi,80);assert.equal(reset.toneDensity,50);}
  }
  assert.deepEqual(shot,before);
});
