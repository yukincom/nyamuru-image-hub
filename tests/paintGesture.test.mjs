import assert from 'node:assert/strict';
import test from 'node:test';
import { commitPaintStroke, commitVectorPaths, canStartPaintMark, preparePaintMarkLayer, appendPaintSamples, constrainPaintPoint, paintStrokeBounds, previewPaintStroke } from '../src/lib/paintGesture.ts';
import { paintScene, newPaintLayer, expandPaintOwnerToBounds, expandPaintOwnerToContent, validatePaintDocument } from '../src/lib/paintDocument.ts';
import {translatePaintLayer} from '../src/lib/paintLayerPicking.ts';
import {newToneLayer} from '../src/lib/paintTone.ts';
import {lassoSelection,combineSelection} from '../src/lib/rasterSelection.ts';
import { PaintSmoother } from '../src/lib/paintStroke.ts';
import {defaultVectorStyle} from '../src/lib/vectorGeometry.ts';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const editorSource=readFileSync(new URL('../src/components/PaintEditor.tsx',import.meta.url),'utf8');
const editorAst=ts.createSourceFile('PaintEditor.tsx',editorSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function editorHandler(name,context){let source;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)source=node.getText(editorAst);ts.forEachChild(node,visit);}visit(editorAst);assert.ok(source,name);return runInNewContext(ts.transpileModule(`(${source})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);}
test('the actual raster pointercancel handler discards its first pending mark',()=>{
  for(const type of ['pointerup','pointercancel','lostpointercapture']){
    let kept,points=0;
    editorHandler('endPointer',{gesture:{current:{pointerId:7}},addPoints:()=>points++,finishGesture:value=>kept=value})({type,pointerId:7,preventDefault(){},stopPropagation(){}});
    assert.equal(kept,type!=='pointercancel');assert.equal(points,type==='pointerup'?1:0);
  }
});
test('vector draft allocation is committed only by the same path preview/finish route',()=>{
  const begin=editorSource.slice(editorSource.indexOf('  function beginVector('),editorSource.indexOf('  function changePaths('));
  assert.doesNotMatch(begin,/changeLayers\(/,'pointerdown must not checkpoint a blank vector layer');
  assert.match(begin,/addedLayer,target,point,cleanup/);
  assert.match(begin,/finishVector\(e.type!=='pointercancel'\)/);
  const finish=editorSource.slice(editorSource.indexOf('  function showVectorDrag('),editorSource.indexOf('  function inputPoint('));
  assert.equal((finish.match(/commitVectorPaths\(/g)??[]).length,2,'preview and commit share atomic insertion');
});

const initial=()=>paintScene({id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:-1,action:null,bubbles:[],figures:[{name:'人物',bbox:{x:10,y:20,w:30,h:50}}]},100,[]);

test('actual raster finish selects a draft layer only after success, retaining selection on error or cancel',()=>{
  for(const ending of ['success','capacity','cancel']){
    const scene=initial(),owner=scene.owners[0],oldId=owner.paint.layers[0].id,added=newPaintLayer();
    let selected=oldId,commits=0,error='previous error',cleared=0;
    const mark={tool:'pen',color:'#000000',size:2,points:[{x:ending==='capacity'?20000:5,y:5,pressure:1,time:0}]};
    const historyRef={current:{initial:scene,present:scene}},inputActive={current:true},rasterPreviewRef={current:{}};
    const gesture={current:{pointerId:7,live:{ownerKey:owner.key,layerId:added.id,addedLayer:added,stroke:mark},cleanup:()=>cleared++,target:{hasPointerCapture:()=>true,releasePointerCapture:()=>cleared++}}};
    editorHandler('finishGesture',{initial:scene,historyRef,gesture,inputActive,rasterPreviewRef,selectionPointer:{current:null},raf:{current:1},endBackgroundMove(){},finishLayerMove(){},finishVector(){},setLassoPreview(){},cancelAnimationFrame(){},commitPaintStroke,
      commit:next=>{commits++;historyRef.current.present=next;},setLayerId:id=>selected=id,setError:value=>error=value,setLive:value=>assert.equal(value,undefined)})(ending!=='cancel');
    assert.equal(commits,ending==='success'?1:0);assert.equal(selected,ending==='success'?added.id:oldId);
    assert.equal(gesture.current,null);assert.equal(inputActive.current,false);assert.equal(rasterPreviewRef.current,undefined);assert.equal(cleared,2);
    if(ending==='success')assert.equal(error,'');else assert.equal(historyRef.current.present,scene);
    if(ending==='capacity')assert.notEqual(error,'previous error');
  }
});

test('actual lasso handler keeps outside selection without editing and cleans up failures/cancel',()=>{
 for(const ending of ['pointerup','pointercancel','oversize']){
  const scene=initial(),before=structuredClone(scene),owner=scene.owners[0],listeners=new Map();
  let selected={key:owner.key,boxes:[{x:1,y:1,w:2,h:2}]},preview,error,released=0;
  const previous=selected,target={getBoundingClientRect:()=>({}),setPointerCapture(){},releasePointerCapture(){released++;},addEventListener(){},removeEventListener(){}};
  const inputActive={current:false},selectionPointer={current:null};
  const begin=editorHandler('beginSelection',{owner,tool:'lasso',selectionBoxes:selected.boxes,lassoSelection,combineSelection,inputActive,selectionPointer,
   inputPoint:e=>({x:e.clientX,y:e.clientY}),setSelection:v=>selected=v,setLassoPreview:v=>preview=v,setError:v=>error=v,
   window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}});
  const event=(type,x,y)=>({type,currentTarget:target,pointerId:7,clientX:x,clientY:y,buttons:1,preventDefault(){},stopPropagation(){}});
  begin(event('pointerdown',-20,-30));listeners.get('pointermove')(event('pointermove',500,-30));listeners.get('pointermove')(event('pointermove',500,ending==='oversize'?20000:600));
  listeners.get(ending==='pointercancel'?'pointercancel':'pointerup')(event(ending==='pointercancel'?'pointercancel':'pointerup',-20,600));
  if(ending==='pointerup')assert.deepEqual(JSON.parse(JSON.stringify(selected.boxes)),[{x:-20,y:-30,w:520,h:630}]);else assert.equal(selected,previous);
  assert.equal(Boolean(error),ending==='oversize');assert.equal(preview.length,0);assert.equal(released,1);assert.equal(listeners.size,0);assert.equal(selectionPointer.current,null);assert.equal(inputActive.current,false);assert.deepEqual(scene,before);
 }
});
test('tone from outside selection expands atomically; side/area failure preserves selection, scene and tool',()=>{
 for(const [width,height,valid] of [[500,600,true],[20000,600,false],[500,20000,false],[10001,10000,false]]){
  const scene=initial(),before=structuredClone(scene),owner=scene.owners[0],selectionBoxes=[{x:-20,y:-30,w:width,h:height}];
  let saved,error='previous capacity error',cleared=false,commits=0,uiChanges=0;
  editorHandler('addToneMask',{scene,owner,selectionBoxes,images:new Map(),locked:false,busy:false,suspended:false,operation:{current:false},finishGesture(){},newToneLayer,paintStrokeBounds,expandPaintOwnerToBounds,
   commit:next=>{saved=next;commits++;},setError:v=>error=v,clearVectorSelection:()=>uiChanges++,setLayerId:()=>uiChanges++,setMaskTarget:()=>uiChanges++,setSelection:v=>cleared=v===null,setTool:()=>uiChanges++,setLineKind:()=>uiChanges++})();
  assert.equal(commits,valid?1:0);assert.equal(cleared,valid);assert.equal(Boolean(error),!valid);assert.equal(uiChanges,valid?5:0);assert.deepEqual(scene,before);
  if(saved){const grown=saved.owners[0],mask=grown.paint.layers.at(-1).mask.strokes[0].selection[0];
   assert.equal(grown.paint.width,Math.max(owner.paint.width,480)+20);assert.equal(grown.paint.height,Math.max(owner.paint.height,570)+30);assert.deepEqual(mask,{x:0,y:0,w:500,h:600});
   assert.equal(saved.owners[1],scene.owners[1]);assert.deepEqual(JSON.parse(JSON.stringify(saved)),structuredClone(saved));}
 }
});

test('vector styles preserve same and unselected paths so commit cannot clear redo or save',()=>{
 const scene=initial(),owner=scene.owners[0],layer=newPaintLayer('vectors','vector');owner.paint.layers=[layer];
 const path={id:'one',closed:false,nodes:[{x:20,y:20},{x:30,y:30}],style:defaultVectorStyle()};layer.paths=[path];
 let preference={...path.style},result;
 const context={vectorMode:true,brushInk:false,vectorSelected:[],setVectorStyle:update=>preference=update(preference),changePaths:update=>{result=commitVectorPaths(scene,{ownerKey:owner.key,layerId:layer.id,paths:update(layer.paths)});}};
 const change=editorHandler('changeVectorStyle',context);
 change({width:9});assert.equal(result,scene);assert.equal(preference.width,9);
 context.vectorSelected=['one'];
 change({width:path.style.width,stroke:path.style.stroke,fill:path.style.fill});assert.equal(result,scene);
 const same=preference;change({width:preference.width});assert.equal(preference,same);assert.equal(result,scene);
 for(const dash of [[],[10,10]]){
  path.style={...path.style,dash};preference={...preference,dash};const before=preference;
  change({dash:[...dash]});assert.equal(result,scene);assert.equal(preference,before);
 }
 change({dash:[5,5]});assert.notEqual(result,scene);assert.deepEqual(result.owners[0].paint.layers[0].paths[0].style.dash,[5,5]);
 change({width:10});assert.notEqual(result,scene);assert.equal(result.owners[0].paint.layers[0].paths[0].style.width,10);assert.equal(layer.paths[0],path);
 assert.equal(commitVectorPaths(scene,{ownerKey:owner.key,layerId:layer.id,paths:[...layer.paths]}),scene);
 const removed=commitVectorPaths(scene,{ownerKey:owner.key,layerId:layer.id,paths:[]});assert.notEqual(removed,scene);assert.equal(removed.owners[0].paint.layers[0].paths.length,0);
});
const stroke=(x=20)=>({tool:'pen',color:'#000000',size:8,points:[{x,y:20,pressure:.8,time:0},{x:x+10,y:30,pressure:.7,time:4}]});
test('zero-layer and guide-only owners get one work layer atomically with their first mark',()=>{
  for(const kind of ['raster','vector'])for(const guideOnly of [false,true]){
    const scene=initial(),owner=scene.owners[0];if(!guideOnly)owner.paint.layers=[];
    const before=structuredClone(scene),selected=owner.paint.layers[0];
    assert.equal(canStartPaintMark(owner,selected,kind),true);
    const draft=preparePaintMarkLayer(owner,selected,kind,'monochrome');
    assert.equal(draft.kind,kind);assert.equal(draft.colorMode,'monochrome');assert.deepEqual(scene,before,'preparing/cancelling must not append');
    const path={id:'first-path',closed:false,nodes:[{x:1,y:2},{x:3,y:4}],style:defaultVectorStyle()};
    const pending={ownerKey:owner.key,layerId:draft.id,addedLayer:draft};
    const next=kind==='raster'?commitPaintStroke(scene,{...pending,stroke:stroke()}):commitVectorPaths(scene,{...pending,paths:[path]});
    assert.equal(next.owners[0].paint.layers.length,before.owners[0].paint.layers.length+1);
    assert.equal(kind==='raster'?next.owners[0].paint.layers.at(-1).strokes.length:next.owners[0].paint.layers.at(-1).paths.length,1);
    assert.deepEqual(next.owners[0].paint.layers.slice(0,-1),before.owners[0].paint.layers);
    assert.deepEqual(scene,before,'the single undo predecessor contains no automatic work layer');
    assert.equal(commitVectorPaths(scene,{...pending,paths:[]}),scene,'an empty vector gesture creates nothing');
    for(const tool of ['eraser','clear'])assert.equal(commitPaintStroke(scene,{...pending,stroke:{...stroke(),tool}}),scene);
  }
});
test('first-mark allocation respects owner/child locks, source images, visibility and the layer limit',()=>{
  const owner=initial().owners[0];owner.paint.layers=[];
  for(const patch of [{locked:true},{inheritedLocked:true},{bubble:{hidden:true}}])assert.equal(canStartPaintMark({...owner,...patch},undefined,'raster'),false);
  const locked={...newPaintLayer(),locked:true};
  assert.equal(preparePaintMarkLayer(owner,locked,'raster'),undefined);
  const source={...locked,image:{assetId:'source',crop:{x:0,y:0,w:1,h:1},bbox:{x:0,y:0,w:1,h:1}}};
  owner.paint.layers=[source];const draft=preparePaintMarkLayer(owner,source,'raster');assert.ok(draft&&draft!==source);assert.equal(source.locked,true);
  assert.equal(preparePaintMarkLayer(owner,{...source,visible:false},'raster'),undefined);
  owner.paint.layers=Array.from({length:64},()=>newPaintLayer());assert.equal(canStartPaintMark(owner,undefined,'vector'),false);
  assert.equal(preparePaintMarkLayer(owner,owner.paint.layers[0],'raster'),owner.paint.layers[0]);
});
test('rapid completions append to current owner layers without replacing earlier strokes or another owner',()=>{
  let scene=initial();const source=structuredClone(scene);
  const commands=Array.from({length:10},(_,i)=>{const owner=scene.owners[i%2];return{ownerKey:owner.key,layerId:owner.paint.layers[0].id,stroke:stroke(i*10)};});
  for(const command of commands)scene=commitPaintStroke(scene,command);
  assert.deepEqual(scene.owners.map(o=>o.paint.layers[0].strokes.length),[5,5]);
  assert.deepEqual(scene.owners[1].paint.layers[0].strokes.map(s=>s.points[0].x),[10,30,50,70,90]);
  assert.deepEqual(source.owners.map(o=>o.paint.layers[0].strokes),[[],[]]);
  commands[1].stroke.points[0].x=999;assert.equal(scene.owners[1].paint.layers[0].strokes[0].points[0].x,10);
});

test('marks grow only their own canvas in all directions and retain pointerdown world coordinates',()=>{
  for(const x of [-90,300])for(const y of [-70,400]){
    const scene=initial(),owner=scene.owners[0],before=structuredClone(scene),layer=newPaintLayer();owner.paint.layers.push(layer);
    const space={frame:{...owner.frame},width:owner.paint.width,height:owner.paint.height};
    const pending={ownerKey:owner.key,layerId:layer.id,space,stroke:{...stroke(),points:[{x,y,pressure:1,time:0}]}};
    const first=commitPaintStroke(scene,pending),second=commitPaintStroke(first,{...pending,stroke:{...pending.stroke,points:[{x:x+10,y:y+20,pressure:1,time:1}]}});
    const updated=second.owners[0],marks=updated.paint.layers.find(l=>l.id===layer.id).strokes;
    for(const [i,mark] of marks.entries()){
      const point=mark.points[0];
      assert.ok(Math.abs(updated.frame.x+point.x*updated.frame.w/updated.paint.width-(space.frame.x+(x+i*10)*space.frame.w/space.width))<1e-8);
      assert.ok(Math.abs(updated.frame.y+point.y*updated.frame.h/updated.paint.height-(space.frame.y+(y+i*20)*space.frame.h/space.height))<1e-8);
    }
    assert.equal(second.owners[1],scene.owners[1],'siblings are not scanned, transformed or replaced');
    assert.deepEqual(scene.owners[1],before.owners[1]);assert.equal(layer.strokes.length,0,'undo source and input are immutable');
    assert.deepEqual(JSON.parse(JSON.stringify(second)),second,'expanded coordinates survive persistence');
  }
});

test('preview has one mark route, history does not expand twice, and undo drops stale selection',()=>{
  const workspace=editorSource.slice(editorSource.indexOf('  const value:PaintWorkspaceState'),editorSource.indexOf('  const geometry='));
  assert.match(workspace,/live:vectorPreview\?undefined:rasterPreview\?\.live/);
  const preview=editorSource.slice(editorSource.indexOf('  const rasterPreview=useMemo'),editorSource.indexOf('  const scene='));
  assert.match(preview,/previewPaintStroke/);assert.doesNotMatch(preview,/commitPaintStroke/,'preview must not invalidate retained-layer caches');
  assert.match(readFileSync(new URL('../src/components/PaintSceneView.tsx',import.meta.url),'utf8'),/paint=\{owner.paint\} images=\{state.images\} live=\{live\}/);
  assert.doesNotMatch(editorSource,/setLive\([^\n]*points:/,'live samples belong to the gesture, not undo history');
  assert.doesNotMatch(editorSource,/if\(editingMask&&\(start\./,'a mask gesture may start outside and enter the artwork');
  assert.match(editorSource,/const selectionForMark=selectionBoxes;/,'only an explicit selection may clip a mask gesture');
  const commit=editorSource.slice(editorSource.indexOf('  function commit('),editorSource.indexOf('  function changeLayers('));
  assert.doesNotMatch(commit,/expandPaintOwnerToContent/);
  for(const name of ['undo','redo']){
    let cleared=false;
    editorHandler(name,{busy:false,toolSuspended:false,suspended:false,operation:{current:false},inputActive:{current:false},clearVectorSelection(){},setSelection:value=>cleared=value===null,sharedHistory:{undo(){},redo(){}}})();
    assert.equal(cleared,true,name);
  }
});

test('live preview retains ink references and never appends or clones the current mark',()=>{
  const scene=initial(),owner=scene.owners[0],layer=newPaintLayer();owner.paint.layers=[layer];
  layer.strokes=[stroke()];
  const mark=stroke(),pending={ownerKey:owner.key,layerId:layer.id,stroke:mark,bounds:paintStrokeBounds(mark),space:{frame:owner.frame,width:owner.paint.width,height:owner.paint.height}};
  let previous;
  for(let i=0;i<120;i++){
    const preview=previewPaintStroke(scene,pending,previous);
    assert.equal(preview.scene,scene);assert.equal(preview.owner.paint,owner.paint);
    assert.equal(preview.live.stroke,mark);assert.equal(layer.strokes.length,1);
    previous=preview;
  }
  const committed=commitPaintStroke(scene,pending);assert.equal(committed.owners[0].paint.layers[0].strokes.length,2);
  assert.notEqual(committed.owners[0].paint.layers[0].strokes[1],mark,'only commit takes ownership of a copy');
});

test('incremental pen bounds only read appended samples and shape bounds can contract',()=>{
  const mark=stroke();const before=paintStrokeBounds(mark),from=mark.points.length;
  mark.points=mark.points.map(()=>({get x(){throw Error('old sample read');},get y(){throw Error('old sample read');}}));
  mark.points.push({x:90,y:-20,pressure:1,time:1});
  const bounds=paintStrokeBounds(mark,before,from);
  assert.deepEqual(bounds,{x:14,y:-26,w:82,h:62});
  const shape={...stroke(),tool:'rectangle',points:[{x:20,y:20},{x:90,y:90}]};
  const wide=paintStrokeBounds(shape);shape.points[1]={x:30,y:30};assert.ok(paintStrokeBounds(shape).w<wide.w);
  assert.equal(paintStrokeBounds({...mark,tool:'eraser'}),undefined);
});
test('wide sparse selections never allocate their whole box for a small pen or shape mark',()=>{
  for(const tool of ['pen','line','rectangle','ellipse'])for(const selection of [[{x:0,y:0,w:20000,h:10}],[{x:0,y:0,w:11000,h:10000}]]){
    const scene=initial(),owner=scene.owners[0],layer=owner.paint.layers[0];
    const mark={...stroke(),tool,size:2,points:[{x:5,y:5,pressure:1,time:0}],selection};
    const pending={ownerKey:owner.key,layerId:layer.id,stroke:mark,bounds:paintStrokeBounds(mark)};
    assert.deepEqual(pending.bounds,{x:2,y:2,w:6,h:6});
    assert.equal(previewPaintStroke(scene,pending).owner,owner);
    const changed=commitPaintStroke(scene,pending).owners[0];
    assert.equal(changed.frame,owner.frame);assert.equal(changed.paint.width,owner.paint.width);
    assert.deepEqual(changed.paint.layers[0].strokes[0].selection,selection);
    const moved=translatePaintLayer(changed.paint.layers[0],1,1),reopened={...changed,paint:JSON.parse(JSON.stringify(changed.paint))};
    assert.doesNotThrow(()=>validatePaintDocument(reopened.paint,[]));
    assert.equal(expandPaintOwnerToContent(reopened,[moved]),reopened,'moving saved ink never expands to its selection extent');
    assert.throws(()=>commitPaintStroke(scene,{...pending,bounds:undefined,stroke:{...mark,tool:'fill'}}),/各辺16384px・合計1億px/);
  }
});
test('selection clips only allocation bounds, retaining raw incremental samples across the selected region',()=>{
  const scene=initial(),owner=scene.owners[0],layer=owner.paint.layers[0],selection=[{x:20,y:20,w:10,h:10}];
  const mark={...stroke(),size:2,points:[{x:-20000,y:25,pressure:1,time:0}],selection};
  const pending={ownerKey:owner.key,layerId:layer.id,stroke:mark,bounds:paintStrokeBounds(mark)};
  const preview=previewPaintStroke(scene,pending);assert.equal(preview.owner,owner);
  mark.points.push({x:20000,y:25,pressure:1,time:1});
  const first=mark.points[0];Object.defineProperty(mark.points,'0',{get(){throw Error('old samples must not be rescanned');},configurable:true});
  pending.bounds=paintStrokeBounds(mark,pending.bounds,1);
  assert.equal(previewPaintStroke(scene,pending,preview).owner,owner);
  Object.defineProperty(mark.points,'0',{value:first,writable:true,configurable:true});
  const changed=commitPaintStroke(scene,pending).owners[0];
  assert.equal(changed.frame,owner.frame);assert.deepEqual(changed.paint.layers[0].strokes[0],mark);
  assert.deepEqual(pending.bounds,{x:-20003,y:22,w:40006,h:6});
  const gap={...mark,selection:[{x:0,y:0,w:10,h:10},{x:40000,y:0,w:10,h:10}],points:[{x:20000,y:5,pressure:1,time:0}]};
  assert.equal(previewPaintStroke(scene,{...pending,stroke:gap,bounds:paintStrokeBounds(gap)}).owner,owner,'empty space between selected islands needs no backing pixels');
});

test('expanded preview bases are reused and live/committed coordinates agree in every direction',()=>{
  for(const [x,y] of [[-90,20],[20,-80],[500,20],[20,500],[-90,-80]]){
    const scene=initial(),owner=scene.owners[0],layer=newPaintLayer();owner.paint.layers=[layer];layer.strokes=[stroke()];
    const mark={...stroke(),points:[{x,y,pressure:1,time:0}]},pending={ownerKey:owner.key,layerId:layer.id,stroke:mark,bounds:paintStrokeBounds(mark),space:{frame:owner.frame,width:owner.paint.width,height:owner.paint.height}};
    const first=previewPaintStroke(scene,pending),second=previewPaintStroke(scene,pending,first),committed=commitPaintStroke(scene,pending).owners[0];
    assert.equal(second.owner,first.owner);assert.equal(second.scene,first.scene);
    assert.deepEqual(second.owner.frame,committed.frame);
    const saved=committed.paint.layers[0].strokes.at(-1);assert.equal(second.live.stroke.size,saved.size);
    second.live.stroke.points.forEach((point,i)=>{assert.ok(Math.abs(point.x-saved.points[i].x)<1e-8);assert.ok(Math.abs(point.y-saved.points[i].y)<1e-8);});
    assert.equal(second.owner.paint.layers[0].strokes.length,1,'live is not baked into retained ink');
    if(x>=0&&y>=0)assert.equal(second.owner.paint.layers,owner.paint.layers,'right/bottom growth cannot rewrite ink');
    assert.equal(owner.paint.layers[0].strokes.length,1);
  }
});

test('existing source crops survive vector edits; new vector marks use an unclipped sibling',()=>{
  const scene=initial(),owner=scene.owners[0],layer={...newPaintLayer('cropped','vector'),clip:{x:0,y:0,w:20,h:20}};owner.paint.layers=[layer];
  const path={id:'outside',closed:false,nodes:[{x:-30,y:0},{x:50,y:40}],style:defaultVectorStyle()};
  const edited=commitVectorPaths(scene,{ownerKey:owner.key,layerId:layer.id,paths:[path]});
  assert.deepEqual(edited.owners[0].paint.layers[0].clip,layer.clip);
  const draft=preparePaintMarkLayer(owner,layer,'vector');assert.notEqual(draft.id,layer.id);assert.equal(draft.clip,undefined);
  const added=commitVectorPaths(scene,{ownerKey:owner.key,layerId:draft.id,addedLayer:draft,paths:[path]});
  assert.ok(added.owners[0].frame.x<owner.frame.x);assert.equal(added.owners[0].paint.layers.length,2);
});

test('a vector preview neither clones nor scans unchanged path nodes',()=>{
  const scene=initial(),owner=scene.owners[0],layer=newPaintLayer('vectors','vector');
  const unchanged={id:'old',closed:false,style:defaultVectorStyle(),get nodes(){throw Error('unchanged nodes must not be traversed');}};
  layer.paths=[unchanged];owner.paint.layers=[layer];
  const fresh={id:'new',closed:false,style:defaultVectorStyle(),nodes:[{x:20,y:20},{x:30,y:30}]};
  const result=commitVectorPaths(scene,{ownerKey:owner.key,layerId:layer.id,paths:[unchanged,fresh]});
  assert.equal(result.owners[0].paint.layers[0].paths[0],unchanged);
  assert.notEqual(result.owners[0].paint.layers[0].paths[1],fresh);
});
test('first rapid stroke on clipped art creates its unrestricted layer atomically',()=>{
  const scene=initial(),owner=scene.owners[1];owner.paint.layers[0].clip={x:0,y:0,w:10,h:10};
  const before=structuredClone(scene),layer=newPaintLayer(),pending={ownerKey:owner.key,layerId:layer.id,addedLayer:layer,stroke:stroke(20)};
  const result=commitPaintStroke(scene,pending),layers=result.owners[1].paint.layers;
  assert.equal(layers.length,owner.paint.layers.length+1);assert.equal(layers.at(-1).strokes.length,1);assert.equal(layers.at(-1).clip,undefined);
  assert.deepEqual(layers.slice(0,-1),before.owners[1].paint.layers);assert.deepEqual(scene,before);
  assert.equal(commitPaintStroke(result,{...pending,stroke:stroke(30)}).owners[1].paint.layers.length,layers.length);
});
test('a completed stroke remains on the owner and layer selected when the pen went down',()=>{
  const scene=initial(),owner=scene.owners[1],pending={ownerKey:owner.key,layerId:owner.paint.layers[0].id,stroke:stroke()};
  const reordered={...scene,owners:[...scene.owners].reverse()};
  const result=commitPaintStroke(reordered,pending);
  assert.equal(result.owners[0].paint.layers[0].strokes.length,1);assert.equal(result.owners[1].paint.layers[0].strokes.length,0);
  assert.equal(commitPaintStroke({...scene,owners:[scene.owners[0]]},pending).owners[0].paint.layers[0].strokes.length,0);
});
const event=(type,x,pressure=.8,timeStamp=x)=>({type,pointerType:'pen',pressure,clientX:x,clientY:x,timeStamp});
const point=e=>({x:e.clientX,y:e.clientY,pressure:e.pressure,time:e.timeStamp});
test('quick pen down/up and shape gestures retain release coordinates with the last contact pressure',()=>{
  for(const tool of ['pen','eraser','line','rectangle','ellipse']){
    const smoother=new PaintSmoother(0),mark={...stroke(),tool,points:[smoother.push(point(event('pointerdown',10)))]};
    appendPaintSamples(mark,smoother,event('pointerup',80,0),point);
    assert.equal(mark.points.length,2);assert.equal(mark.points[1].x,80);assert.equal(mark.points[1].pressure,.8);
  }
});
test('coalesced moves retain all samples plus a newer dispatched endpoint',()=>{
  const smoother=new PaintSmoother(0),mark={...stroke(),points:[smoother.push(point(event('pointerdown',10)))]};
  appendPaintSamples(mark,smoother,{...event('pointermove',40),getCoalescedEvents:()=>[event('pointermove',20),event('pointermove',30)]},point);
  assert.deepEqual(mark.points.map(p=>p.x),[10,20,30,40]);
});


test('Shift constrains lines and equal-sided shapes in every drag direction',()=>{
  const start={x:50,y:50,pressure:.8,time:0};
  for(const [dx,dy] of [[30,10],[-30,10],[10,-30],[-10,-30],[0,30],[30,0]]){
    const end={...start,x:start.x+dx,y:start.y+dy,time:1};
    const line=constrainPaintPoint('line',start,end,true);
    assert.ok(line.x===start.x||line.y===start.y);
    for(const tool of ['ellipse','rectangle']){
      const point=constrainPaintPoint(tool,start,end,true);
      assert.equal(Math.abs(point.x-start.x),Math.abs(point.y-start.y));
      assert.equal(point.pressure,end.pressure);
      assert.equal(constrainPaintPoint(tool,start,end,false),end);
    }
    assert.equal(constrainPaintPoint('pen',start,end,true),end);
  }
});
test('Shift release position reaches both shape preview and committed geometry',()=>{
  const stroke={tool:'rectangle',color:'#000',size:3,points:[{x:10,y:10,pressure:1,time:0}]};
  const event={type:'pointerup',pointerType:'pen',pressure:0,shiftKey:true,clientX:45,clientY:20,timeStamp:1};
  appendPaintSamples(stroke,new PaintSmoother(0),event,e=>({x:e.clientX,y:e.clientY,pressure:e.pressure,time:e.timeStamp}));
  assert.deepEqual(stroke.points[1],{x:45,y:45,pressure:1,time:0});
  const scene=initial(),owner=scene.owners[0];
  const result=commitPaintStroke(scene,{ownerKey:owner.key,layerId:owner.paint.layers[0].id,stroke});
  assert.deepEqual(result.owners[0].paint.layers[0].strokes[0].points,stroke.points);
});

test('mask gestures retain source strokes and vector paths and stay on their original layer',()=>{
  const scene=initial(),owner=scene.owners[0],layer=owner.paint.layers[0];
  layer.strokes=[stroke()];layer.kind='vector';layer.paths=[{id:'untouched-path'}];layer.mask={enabled:true,reveal:true,strokes:[]};
  const before=structuredClone(scene),pending={ownerKey:owner.key,layerId:layer.id,target:'mask',stroke:{...stroke(),tool:'eraser'}};
  const result=commitPaintStroke(scene,pending),updated=result.owners[0].paint.layers[0];
  assert.deepEqual(updated.strokes,layer.strokes);assert.deepEqual(updated.paths,layer.paths);assert.equal(updated.mask.strokes.length,1);assert.deepEqual(scene,before);
  pending.stroke.points[0].x=999;assert.equal(updated.mask.strokes[0].points[0].x,20);
  for(const patch of [{mask:undefined},{mask:{...layer.mask,enabled:false}},{locked:true},{visible:false}]){
    const blocked=structuredClone(scene);Object.assign(blocked.owners[0].paint.layers[0],patch);assert.equal(commitPaintStroke(blocked,pending),blocked);
  }
});

test('generation mask strokes attach to their image without modifying source ink or tone mask',()=>{
  const scene=initial(),owner=scene.owners[0],layer=owner.paint.layers[0];layer.generationMask={enabled:true,strokes:[]};
  const next=commitPaintStroke(scene,{ownerKey:owner.key,layerId:layer.id,target:'generationMask',stroke:{...stroke(),color:'#ff0000'}});
  assert.equal(next.owners[0].paint.layers[0].generationMask.strokes[0].color,'#ff0000');assert.deepEqual(layer.generationMask.strokes,[]);assert.deepEqual(next.owners[0].paint.layers[0].strokes,[]);
  layer.generationMask.enabled=false;assert.equal(commitPaintStroke(scene,{ownerKey:owner.key,layerId:layer.id,target:'generationMask',stroke:stroke()}),scene);
});

test('masks have no implicit rectangle and use the same growing layer coordinates as ink',()=>{
  for(const target of ['mask','generationMask'])for(const x of [-90,500])for(const y of [-70,500]){
    const scene=initial(),owner=scene.owners[0],layer=owner.paint.layers[0];
    layer[target]={enabled:true,...(target==='mask'?{reveal:false}:{}),strokes:[]};
    const space={frame:{...owner.frame},width:owner.paint.width,height:owner.paint.height};
    const mark={...stroke(),points:[{x,y,pressure:1,time:0}]};
    const pending={ownerKey:owner.key,layerId:layer.id,target,space,stroke:mark,bounds:paintStrokeBounds(mark)};
    const preview=previewPaintStroke(scene,pending),saved=commitPaintStroke(scene,pending).owners[0];
    assert.deepEqual(preview.owner.frame,saved.frame);
    const savedMark=saved.paint.layers[0][target].strokes[0];assert.equal(preview.live.stroke.size,savedMark.size);
    for(const axis of ['x','y'])assert.ok(Math.abs(preview.live.stroke.points[0][axis]-savedMark.points[0][axis])<1e-8);
    assert.equal(preview.live.stroke.selection,undefined);assert.equal(layer[target].strokes.length,0);
    const p=saved.paint.layers[0][target].strokes[0].points[0];
    assert.ok(Math.abs(saved.frame.x+p.x*saved.frame.w/saved.paint.width-(space.frame.x+x*space.frame.w/space.width))<1e-8);
    assert.ok(Math.abs(saved.frame.y+p.y*saved.frame.h/saved.paint.height-(space.frame.y+y*space.frame.h/space.height))<1e-8);
    assert.deepEqual(JSON.parse(JSON.stringify(saved)),saved);
  }
});

test('a mask eraser beyond current ink is retained when later ink grows the layer',()=>{
  const scene=initial(),owner=scene.owners[0],layer=owner.paint.layers[0];layer.mask={enabled:true,reveal:true,strokes:[]};
  const space={frame:{...owner.frame},width:owner.paint.width,height:owner.paint.height};
  const pending={ownerKey:owner.key,layerId:layer.id,space,stroke:{...stroke(-80),tool:'eraser'}};
  const erased=commitPaintStroke(scene,{...pending,target:'mask'});
  const saved=commitPaintStroke(erased,{...pending,stroke:{...pending.stroke,tool:'pen'}}).owners[0];
  const mask=saved.paint.layers[0].mask.strokes[0],ink=saved.paint.layers[0].strokes[0];
  assert.deepEqual(mask.points,ink.points);assert.equal(mask.selection,undefined);
  assert.deepEqual(layer.mask.strokes,[]);
});
