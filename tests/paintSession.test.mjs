import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { paintCheckpoint } from '../src/lib/paintSession.ts';
import { paintScene, paintGenerationOwner, paintOwnerCanvasSelection } from '../src/lib/paintDocument.ts';
import { commitPaintStroke } from '../src/lib/paintGesture.ts';
import { paintOwnerLocked } from '../src/lib/paintLock.ts';
import { paintToolShortcut } from '../src/lib/paintToolShortcuts.ts';
import { canvasTextAt } from '../src/lib/canvasText.ts';
import { paintSelectionMode } from '../src/lib/paintToolMode.ts';

const initial=()=>paintScene({id:1,shape:{type:'rect',x:0,y:0,w:30,h:40},bg:0,action:null,bubbles:[],figures:[{name:'確認用',bbox:{x:2,y:3,w:10,h:20}}]},100,[]);
const add=(scene,index=0)=>{const o=scene.owners[index];return commitPaintStroke(scene,{ownerKey:o.key,layerId:o.paint.layers[0].id,stroke:{tool:'pen',color:'#000000',size:3,points:[{x:4,y:5,pressure:.7,time:1}]}});};

test('restoring only the scene wrapper does not apply an empty document update',async()=>{
 const start=initial(),checkpoint=paintCheckpoint(start),restored={...start,owners:[...start.owners]};
 let writes=0;await checkpoint.flush(restored,async()=>{writes++;});
 assert.equal(writes,0);assert.equal(checkpoint.saved,start);
});

const preparedGuide=owner=>({...owner,paint:{...owner.paint,layers:owner.paint.layers.map(layer=>layer.guide&&!layer.image?{...layer,image:{assetId:`guide-${owner.key}`,crop:{x:0,y:0,w:10,h:10},bbox:{x:0,y:0,w:10,h:10}}}:layer)}});
test('guide preparation stays clean and only a subsequent edited owner is written',async()=>{
 const start=initial(),before=structuredClone(start),checkpoint=paintCheckpoint(start);
 const prepared={...start,owners:start.owners.map(owner=>{const next=preparedGuide(owner);checkpoint.prepareGuide(owner,next);return next;})};
 assert.equal(checkpoint.hasChanges(prepared),false);
 let writes=0;await checkpoint.flush(prepared,async()=>{writes++;});assert.equal(writes,0);
 const drawn=add(prepared,1);assert.equal(checkpoint.hasChanges(drawn),true);
 await checkpoint.flush(drawn,async owners=>{assert.deepEqual(owners.map(owner=>owner.key),['figure-0']);writes++;});
 assert.equal(writes,1);assert.equal(checkpoint.saved,drawn);assert.equal(checkpoint.hasChanges(drawn),false);
 assert.deepEqual(start,before,'display preparation must not mutate a history predecessor');
});

test('preparing dirty resumed owners cannot acknowledge unsaved changes or failed writes',async()=>{
 const saved=initial(),dirty=add(saved,1),checkpoint=paintCheckpoint({...dirty},saved);
 const owners=dirty.owners.map(owner=>{const next=preparedGuide(owner);checkpoint.prepareGuide(owner,next);return next;});
 const resumed={...dirty,owners},baseline=checkpoint.saved;
 assert.equal(baseline.owners[1],saved.owners[1]);assert.equal(checkpoint.hasChanges(resumed),true);
 await assert.rejects(checkpoint.flush(resumed,async()=>{throw Error('asset write failed');}),/asset write failed/);
 assert.equal(checkpoint.saved,baseline);assert.equal(checkpoint.hasChanges(resumed),true);
 await checkpoint.flush(resumed,async changed=>assert.deepEqual(changed.map(owner=>owner.key),['figure-0']));
 assert.equal(checkpoint.saved,resumed);
});

test('prepared snapshot imports survive undo, redo and a shallow scene restore',async()=>{
 const start=initial(),checkpoint=paintCheckpoint(start);
 const prepared={...start,owners:start.owners.map(owner=>{const next=preparedGuide(owner);checkpoint.prepareGuide(owner,next);return next;})};
 const before={scene:prepared,saved:checkpoint.saved,imports:[{asset:{id:'guide-figure-0'},blob:new Blob(['guide'])}]};
 const drawn=add(prepared,1),restored=paintCheckpoint({...before.scene},before.saved);
 assert.equal(restored.hasChanges({...before.scene}),false);
 await restored.flush({...before.scene},async()=>assert.fail('undo before the first write must not materialize guides'));
 const redo=paintCheckpoint({...drawn},before.saved);
 await redo.flush(drawn,async changed=>assert.deepEqual(changed.map(owner=>owner.key),['figure-0']));
 assert.equal(await before.imports[0].blob.text(),'guide');
});

test('successive saves preserve both owners and undo after saving reaches the document',async()=>{
 const start=initial(),checkpoint=paintCheckpoint(start),calls=[];
 const a=add(start),b=add(a,1),c=add(b);
 const write=async owners=>calls.push(owners.map(o=>[o.key,o.paint.layers[0].strokes.length]));
 await checkpoint.flush(a,write);await checkpoint.flush(b,write);await checkpoint.flush(c,write);await checkpoint.flush(c,write);
 await checkpoint.flush(start,write);
 assert.deepEqual(calls,[[['background',1]],[['figure-0',1]],[['background',2]],[['background',0],['figure-0',0]]]);
 assert.equal(checkpoint.saved,start);
});

test('failed PNG/asset writes keep the save point and allow retry without dropping new strokes',async()=>{
 const start=initial(),checkpoint=paintCheckpoint(start),one=add(start),two=add(one,1);
 await assert.rejects(checkpoint.flush(one,async()=>{throw Error('disk failure');}),/disk failure/);
 assert.equal(checkpoint.saved,start);
 let written;await checkpoint.flush(two,async owners=>{written=owners;});
 assert.deepEqual(written.map(o=>o.paint.layers[0].strokes.length),[1,1]);
 assert.equal(checkpoint.saved,two);
});

test('overlapping flush requests serialize writes and deduplicate a shared scene',async()=>{
 const checkpoint=paintCheckpoint(initial()),one=add(checkpoint.saved),two=add(one,1),calls=[];
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const write=async owners=>{calls.push(owners.map(o=>o.key));if(calls.length===1)await gate;};
 const a=checkpoint.flush(one,write),b=checkpoint.flush(two,write),c=checkpoint.flush(two,write);
 await Promise.resolve();assert.equal(calls.length,1);release();await Promise.all([a,b,c]);
 assert.deepEqual(calls,[['background'],['figure-0']]);assert.equal(checkpoint.saved,two);
});

// Exercise the actual app save handler, including cancellation and failure, with no bridge or disk writes.
const source=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let expression;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='saveProject')expression=node.initializer.getText(ast);ts.forEachChild(node,visit);}
visit(ast);
const compiled=ts.transpileModule(`(${expression})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function handler(file,name,context){
 const source=ts.createSourceFile(file,readFileSync(new URL('../src/components/'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let found;
 const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node.getText(source);if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name)found=node.initializer.getText(source);ts.forEachChild(node,visit);};visit(source);
 assert.ok(found);return runInNewContext(ts.transpileModule(`(${found.replace(/^export\s+/,'')})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
}
test('paint pause settles the existing gesture with no PNG; only active 3D needs close',async()=>{
 for(const backgroundOwner of [null,'background']){
  const calls=[],context={Error,operation:{current:false},backgroundOwner,requestClose:async()=>calls.push('close'),finishGesture:()=>calls.push('gesture')};
  const pause=handler('PaintEditor.tsx','pause',context);await pause();
  assert.deepEqual(calls,backgroundOwner?['close']:['gesture']);
  context.operation.current=true;await assert.rejects(pause(),/画像を処理/);assert.equal(calls.length,1);
 }
});
// 見込み: Tは選択レイヤーの所属テキストを開き、非文字とズームは描画を一時停止する。
// 合格: 古いcanvas選択を使わず、原画も親へ解決。範囲: 実handler/owner解決＋模擬controller。画面・保存はbrowser試験。
test('T resolves the live text owner while zoom and non-text selections retain paint',async()=>{
 for(const name of ['chooseTextTool','chooseZoomTool'])for(const key of ['background','bubble-0','original-crop']){
  const panel={id:1,shape:{type:'rect',x:0,y:0,w:30,h:40},bg:0,action:null,bubbles:[{text:'対象',shape:'handwritten',bbox:{x:1,y:2,w:10,h:10}}]};
  const page={page:1,panels:[panel]},scene=paintScene(panel,100,[]);
  scene.owners.push({key:'original-crop',kind:'original',parentKey:'bubble-0'});
  const session={pageIndex:0,panelIndex:0,overlay:false,scene,initialOwner:'background'},calls=[],transitions=[],selections=[];
  const context={paintGenerationOwner,paintOwnerCanvasSelection,documentRef:{current:{manga:{pages:[page]}}},selectedElement:{type:'bubble',index:99},paintSessionRef:{current:session},
   paintController:{current:{snapshot:()=>({scene,ownerKey:key}),pause:async()=>calls.push('pause'),close:async()=>calls.push('close')}},
   requestPcFonts:()=>{},layerTransition:fn=>{const task=fn();transitions.push(task);return task;},setTextPaletteRequest:()=>{},autoPaintResume:{current:null},endTextEdit:()=>{},setSelectedElement:value=>selections.push(value),selectCanvasElement:value=>selections.push(value),setTextTool:()=>{},setZoomTool:()=>{},setBubblePathTool:()=>{},setPaintToolsCollapsed:()=>{}};
  handler('App.tsx',name,context)();await Promise.all(transitions);
  const opensText=name==='chooseTextTool'&&key!=='background';
  assert.deepEqual(calls,[opensText?'close':'pause']);
  if(opensText)assert.deepEqual(JSON.parse(JSON.stringify(selections)),[{type:'bubble',index:0}]);
  else assert.deepEqual(selections,name==='chooseTextTool'?[null]:[]);
 }
});
// 見込み: ownerを持たない写植文字は明示選択を使ってP→Tへ戻る。合格: コマ/前景とも描画close後に同じ文字を選ぶ。範囲: 実handlerとtarget検査、controllerのみ模擬。
test('point text keeps its P to T editing target in panel and page overlay',async()=>{
 for(const overlay of [false,true]){
  const panel={id:1,shape:{type:'rect',x:0,y:0,w:30,h:40},bg:0,action:null,bubbles:[],screen_text:[{text:'写植',bbox:{x:1,y:1,w:5,h:5}}]};
  const page={page:1,panels:[panel],page_overlay:{screen_text:panel.screen_text}},scene=paintScene(panel,100,[]);
  const selected={type:'screen_text',index:0,...(overlay?{scope:'page_overlay'}:{})},calls=[],transitions=[];
  const context={paintGenerationOwner,paintOwnerCanvasSelection,canvasTextAt,documentRef:{current:{manga:{pages:[page]}}},activePage:0,activePanel:0,selectedElement:selected,paintSessionRef:{current:{pageIndex:0,panelIndex:0,overlay,scene}},
   paintController:{current:{snapshot:()=>({scene,ownerKey:'background'}),pause:async()=>calls.push('pause'),close:async()=>calls.push('close')}},
   requestPcFonts(){},layerTransition:fn=>{const task=fn();transitions.push(task);return task;},setTextPaletteRequest(){},autoPaintResume:{current:null},setSelectedElement:value=>calls.push(value),selectCanvasElement:value=>calls.push(value),setTextTool(){},setZoomTool(){},setBubblePathTool(){},setPaintToolsCollapsed(){}};
  handler('App.tsx','chooseTextTool',context)();await Promise.all(transitions);assert.deepEqual(calls,['close',selected]);
 }
});
// 見込み: 通常の道具選択は一時選択を解除してから既存の描画再開へ進む。
// 合格: 一時選択falseと再開/gesture/道具順を確認。実handler＋模擬state、実キー入力はbrowser試験。
test('resuming a paint tool clears the other UI mode through the existing start callback',()=>{
 const calls=[],context={setTemporaryLayoutSelection:value=>calls.push(['temporary',value]),paintSelectionMode,hasLayer:false,busy:false,toolSuspended:false,operation:{current:false},requested:{},textTool:true,zoomTool:false,onStartPaint:()=>{calls.push('resume');return true;},interactionRevision:{current:0},finishGesture:()=>calls.push('gesture'),setMaskTarget:()=>{},setTool:tool=>calls.push(tool),setLineKind:()=>{},setPenMenu:()=>{},setEraserMenu:()=>{},tool:'pen',vectorState:{current:{}}};
 handler('PaintEditor.tsx','selectTool',context)('pen');assert.deepEqual(calls,[['temporary',false],'resume','gesture','pen']);
});
// 見込み: T/zoom中も明示的な道具選択で一時選択を解き、非描画操作の経路を維持する。
// 合格: layout/node/penの既存順と解除を確認。実handler＋模擬state、ブラウザー操作は別試験。
test('T/zoom shortcuts preserve layout dispatch without a session and suppress hidden paint edits',()=>{
 for(const requested of [undefined,{}]){
  const calls=[],context={setTemporaryLayoutSelection:value=>calls.push(['temporary',value]),Element:class{},HTMLElement:class{},paintToolShortcut,paintSelectionMode,hasLayer:false,owner:{key:'figure-0'},requested,textTool:true,zoomTool:false,gesture:{current:null},vectorPointer:{current:null},busy:false,toolSuspended:false,operation:{current:false},interactionRevision:{current:0},
   onSelectLayout:target=>calls.push(target?.direct?'bubble-node':'layout'),onSelectBubblePath:()=>calls.push('bubble-node'),onStartPaint:()=>{calls.push('resume');return true;},finishGesture(){},setTool:value=>calls.push(value),setMaskTarget(){},setLineKind(){},setPenMenu(){},setEraserMenu(){},tool:'pen',vectorState:{current:{}},undo:()=>calls.push('undo'),redo:()=>calls.push('redo')};
  context.selectTool=handler('PaintEditor.tsx','selectTool',context);
  const keydown=handler('PaintEditor.tsx','keydown',context);
  for(const key of ['v','a','p','Delete','f','x',']'])keydown({key,preventDefault(){},stopPropagation(){}});
  assert.deepEqual(calls,[['temporary',false],'layout',['temporary',false],'bubble-node',['temporary',false],'resume','vector-pen']);
  assert.equal(context.interactionRevision.current,3);
 }
});
test('page switches wait for paint and do not discard the current page on close failure',async()=>{
 for(const fail of [false,true]){
  const calls=[],context={Error,activePage:0,paintSessionRef:{current:{}},paintController:{current:{close:async()=>{calls.push('close');if(fail)throw Error('save failed');}}},layerTransition:fn=>fn(),endTextEdit:()=>calls.push('end-text'),autoPaintResume:{current:{}},setActivePage:value=>calls.push(['page',value]),setActivePanel:()=>{},setSelectedPanels:()=>{},setSelectedElement:()=>{},setTab:()=>{},setMobileStoryboardPane:()=>{}};
  const select=handler('App.tsx','selectPage',context);
  await select(0);assert.deepEqual(calls,[]);
  if(fail){await assert.rejects(select(1),/save failed/);assert.deepEqual(calls,['close']);}
  else{await select(1);assert.deepEqual(calls,['close','end-text',['page',1]]);}
 }
});
test('paused live paint does not allow native keyboard nudges to bypass its document boundary',()=>{
 let edits=0;
 const context={paintWorkspace:{},backgroundEdit:undefined,elementLocked:()=>false,onSelectElement:()=>edits++};
 handler('MangaCanvas.tsx','nudgeElement',context)({key:'ArrowRight',preventDefault(){},stopPropagation(){}},{},{type:'bubble',index:0},{x:10,y:10,w:20,h:20});
 handler('MangaCanvas.tsx','startBubbleTextDrag',context)({}, {type:'bubble',index:0},{x:10,y:10,w:20,h:20},{x:.5,y:.5});
 assert.equal(edits,0);
});
test('material drop and text wrapping materialize paint before their existing document edits',async()=>{
 for(const name of ['applyBubbleMaterial','wrapScreenText'])for(const fail of [false,true]){
  const tasks=[],calls=[],target={pageIndex:0,panelIndex:0,index:0,kind:'screen_text'},documentRef={current:{paint:0}};
  const edit=doc=>{assert.equal(doc.paint,1);calls.push('edit');return target;};
  const context={Error,documentRef,paintSessionRef:{current:{}},layerTransition:fn=>{const task=fn();tasks.push(task);return task;},
   paintController:{current:{close:async()=>{calls.push('close');if(fail)throw Error('save failed');documentRef.current={paint:1};}}},cloneDocument:structuredClone,editCanvasBubbleMaterial:edit,convertScreenTextToBubble:edit,
   createdText:{current:null},setEditingText:()=>{},imageGestureBoundary:()=>{},endTextEdit:()=>{},lastHistoryPush:{current:0},setDocument:doc=>{calls.push('document');documentRef.current=doc;},setActivePage:()=>{},setActivePanel:()=>{},setSelectedPanels:()=>{},setSelectedElement:()=>{},setTextTool:()=>{},setZoomTool:()=>{},setBubblePathTool:()=>{},setToast:()=>{}};
  handler('App.tsx',name,context)(target,'material');
  if(fail){await assert.rejects(Promise.all(tasks),/save failed/);assert.deepEqual(calls,['close']);}
  else{await Promise.all(tasks);assert.deepEqual(calls,['close','edit','document']);assert.equal(documentRef.current.paint,1);}
 }
});
function appSave({cancel=false,fail=false}={}){
 const documentRef={current:{manga:{meta:{episode_id:'episode',series:''},paint:0}}};
 const paintSessionRef={current:{document:documentRef.current}},calls=[],notices=[];
 const context={Error,crypto,endTextEdit:()=>{},isLanClient:false,hasDocument:true,showNewDialog:false,projectOperation:{current:false},setProjectBusy:value=>calls.push(['busy',value]),documentRef,paintSessionRef,
  paintController:{current:{flush:async()=>{calls.push(['flush']);if(fail)throw Error('ink failure');documentRef.current={...documentRef.current,manga:{...documentRef.current.manga,paint:7}};paintSessionRef.current={document:documentRef.current};}}},
  boundEpisodeWorkspace:null,cloneDocument:structuredClone,setDocument:next=>{documentRef.current=next;},
  withNewCreationBridgeSession:async callback=>{calls.push(['bridge']);await callback();},
  selectEpisodeWorkspace:async()=>cancel?null:{token:'t',directory:'/fixture',folderName:'fixture'},savedWorkspaceRoot:()=>'',
  createProjectSnapshot:async doc=>{calls.push(['snapshot',doc.manga.paint]);return doc;},
  saveEpisodeProject:async(_token,snapshot)=>{assert.equal(snapshot.manga.paint,7);return 'revision';},rememberProjectBinding:()=>{},localStorage:{},
  applyPreparedSeriesIdentifiers:()=>{},setBoundEpisodeWorkspace:()=>{},setPaintSession:s=>{paintSessionRef.current=s;},setToast:message=>notices.push(message)};
 return {save:runInNewContext(compiled,context),calls,notices,context};
}
test('whole-project save waits for current paint before capturing the snapshot and retains painting',async()=>{
 const {save,calls,context}=appSave();await save();
 assert.deepEqual(calls,[['busy',true],['flush'],['bridge'],['snapshot',7],['busy',false]]);
 assert.equal(context.paintSessionRef.current.document,context.documentRef.current);
});
test('cancelling the folder picker retains ink in the document; paint failure prevents a partial project save',async()=>{
 const cancelled=appSave({cancel:true});await cancelled.save();assert.equal(cancelled.context.documentRef.current.manga.paint,7);assert.ok(!cancelled.calls.some(c=>c[0]==='snapshot'));
 const failed=appSave({fail:true});await failed.save();assert.ok(!failed.calls.some(c=>c[0]==='bridge'));assert.match(failed.notices[0],/ink failure/);assert.equal(failed.context.projectOperation.current,false);
});


test('first project save assigns identity without invalidating the active paint session',async()=>{
 const h=appSave();h.context.documentRef.current.manga.meta.episode_id='';await h.save();
 assert.ok(h.context.documentRef.current.manga.meta.episode_id);
 assert.equal(h.context.paintSessionRef.current.document,h.context.documentRef.current);
});

test('restoring an unwritten history snapshot compares against its materialized save point',async()=>{
 const saved=initial(),drawing=add(saved),restored=paintCheckpoint({...drawing},saved),calls=[];
 await restored.flush(drawing,async owners=>calls.push(owners.map(owner=>owner.key)));
 assert.deepEqual(calls,[['background']]);assert.equal(restored.saved,drawing);
});

function appQwenInsert({paint=false,locked=false,changed=false,wrongSession=false,fail=false}={}){
 let expression;
 function find(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='insertQwenImage')expression=node.initializer.getText(ast);ts.forEachChild(node,find);}
 find(ast);
 const compiled=ts.transpileModule(`(${expression})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const document={manga:{pages:[{}, {panels:Array.from({length:4},()=>({}))}]}},owner=initial().owners[1],calls=[];
 if(locked)owner.paint.layers[0].locked=true;
 const context={Error,qwenGeneration:{document,pageIndex:1,panelIndex:3,overlay:false,owner,plan:{}},documentRef:{current:changed?{}:document},projectOperation:{current:false},imageImportBusy:false,
  paintSessionRef:{current:paint?{pageIndex:1,panelIndex:wrongSession?2:3,overlay:false}:null},paintOwnerLocked,panelLocked:()=>false,
  paintController:{current:{insertImage:async(file,key)=>{if(fail)throw Error('import failed');calls.push(['paint',file,key]);}}},
  importPlacedImage:async(file,target)=>{if(fail)throw Error('import failed');calls.push(['placed',file,target]);},
  setQwenGeneration:value=>calls.push(['dialog',value]),setToast:text=>calls.push(['toast',text])};
 return {insert:runInNewContext(compiled,context),calls,context};
}
test('generated artwork uses the captured destination and existing import path, then closes the dialog',async()=>{
 const file={name:'from-another-panel.png'};
 const placed=appQwenInsert();await placed.insert(file);
 const target=placed.calls[0][2];
 assert.equal(placed.calls[0][0],'placed');assert.equal(placed.calls[0][1],file);
 assert.equal(target.pageIndex,1);assert.equal(target.panelIndex,3);assert.equal(target.figureIndex,0);assert.equal(target.scope,'panel');
 assert.deepEqual({...target.box},placed.context.qwenGeneration.owner.frame);
 assert.deepEqual(placed.calls[1],['dialog',null]);
 const locked=appQwenInsert({locked:true});await locked.insert(file);assert.equal(locked.calls[0][0],'placed');assert.equal(locked.context.qwenGeneration.owner.paint.layers[0].locked,true);
 const painting=appQwenInsert({paint:true});await painting.insert(file);
 assert.deepEqual(painting.calls[0],['paint',file,'figure-0']);assert.deepEqual(painting.calls[1],['dialog',null]);
});
test('generated-image insertion keeps the dialog and document when the destination changed or import fails',async()=>{
 for(const options of [{changed:true},{paint:true,wrongSession:true},{fail:true},{paint:true,fail:true}]){
  const h=appQwenInsert(options);await assert.rejects(h.insert({name:'output.png'}));assert.deepEqual(h.calls,[]);
 }
});

test('composition insertion retains the captured page and panel rather than the active selection',async()=>{
 for(const scope of ['page','panel']){
  const h=appQwenInsert(),frame={x:4,y:7,w:100,h:150};
  h.context.qwenGeneration.plan={scope,outputFrame:frame,label:'対象全体'};
  delete h.context.qwenGeneration.owner;
  const file={name:'composition.png'};await h.insert(file);
  const target=h.calls[0][2];
  assert.equal(target.pageIndex,1);assert.equal(target.panelIndex,3);
  assert.equal(target.scope,scope);assert.equal(target.generationScope,scope);assert.equal(target.box,frame);
  assert.equal(target.figureIndex,undefined);assert.deepEqual(h.calls[1],['dialog',null]);
 }
});

test('single pose output keeps the original guide frame after adopting its panel-sized image',async()=>{
 for(const paint of [false,true]){
  const h=appQwenInsert({paint}),frame={x:0,y:0,w:90,h:120},referenceFrame={x:12,y:18,w:30,h:60};
  h.context.qwenGeneration.plan={outputFrame:frame,referenceFrame};
  if(paint)h.context.paintController.current.insertImage=async(file,key,placement)=>h.calls.push(['paint',file,key,placement]);
  await h.insert({name:'pose.png'});
  const placement=h.calls[0][paint?3:2];
  assert.deepEqual({...placement[paint?'frame':'box']},frame);if(paint)assert.equal(placement.referenceFrame,referenceFrame);else assert.equal(placement.generatedOwner,h.context.qwenGeneration.owner);
 }
});

test('lettering insertion uses the resolved mask frame through both existing import paths',async()=>{
 const file={name:'lettering.png'},frame={x:12,y:24,w:20,h:30},referenceFrame={x:0,y:0,w:80,h:60};
 for(const paint of [false,true]){
  const h=appQwenInsert({paint});
  let placement;
  if(paint)h.context.paintController.current.insertImage=async(file,key,value)=>{placement=value;h.calls.push(['paint',file,key]);};
  await h.insert(file,{outputFrame:frame,referenceFrame});
  if(paint)assert.deepEqual({...placement},{frame,referenceFrame});
  else assert.deepEqual({...h.calls[0][2].box},frame);
  assert.deepEqual(h.calls[1],['dialog',null]);
 }
});


test('owner stack changes retain pending guide imports and the selected generation mask',async()=>{
 const scene=initial(),guide=scene.owners[0].paint.layers[0],asset={id:'pending-guide'};
 scene.owners[0].paint.layers=[{...guide,image:{assetId:asset.id,crop:{x:0,y:0,w:2,h:2},bbox:{x:0,y:0,w:2,h:2}}}];
 const state={scene,saved:scene,imports:[{asset,blob:new Blob(['guide'])}],stageImports:[],ownerKey:scene.owners[0].key,layerId:guide.id,maskTarget:{key:'background',id:'',kind:'generationMask'}};
 const doc={manga:{pages:[{panels:[{id:1}]}]}},session={document:doc,pageIndex:0,panelIndex:0,overlay:false,scene},calls=[],tasks=[];
 const context={Map,cloneDocument:structuredClone,documentRef:{current:doc},activePage:0,paintSessionRef:{current:session},paintController:{current:{pause:async()=>calls.push('pause'),flush:async()=>calls.push('flush'),snapshot:()=>state,images:()=>new Map()}},
  layerTransition:action=>tasks.push(action()),workspaceSnapshot:()=>state,panelVisible:()=>true,panelLocked:()=>false,paintOwnerPlacementLocked:()=>false,reorderPanelArt:()=>true,makePaintScene:()=>scene,
  setDocument:next=>{context.documentRef.current=next;},timeline:{current:{record:()=>calls.push('history')}},lastHistoryPush:{current:0},changedHistory:()=>{},setPaintSession:()=>{}};
 handler('App.tsx','reorderOwnerLayers',context)(0,'background','figure-0',true);await Promise.all(tasks);
 const resumed=context.paintSessionRef.current.resume;
 assert.equal(resumed.imports,state.imports);assert.equal(resumed.stageImports,state.stageImports);assert.equal(resumed.maskTarget,state.maskTarget);
 assert.equal(resumed.scene.owners[0].paint,state.scene.owners[0].paint);assert.deepEqual(calls,['pause','flush','history']);
});

test('image reuse avoids original reads and a failed load releases only newly decoded images',async()=>{
 const retained={naturalWidth:2,naturalHeight:2,src:'retained'},created={naturalWidth:2,naturalHeight:2,src:'created'},reuse=new Map([['old',retained]]),calls=[];
 const read=handler('../lib/paintRenderer.ts','loadPaintImages',{Map,Error,Set,paintAssetIds:paint=>paint.layers.flatMap(layer=>layer.image?[layer.image.assetId]:[]),loadFigureCropAsset:async()=>{calls.push('read');return null;},decodePaintImage:async()=>{calls.push('decode');return created;}});
 const paint=ids=>({layers:ids.map(assetId=>({image:{assetId}}))});
 const images=await read([paint(['old'])],[],new Map(),reuse);assert.equal(images.get('old'),retained);assert.deepEqual(calls,[]);
 await assert.rejects(read([paint(['old','new','missing'])],[],new Map([['new',new Blob(['image'])]]),reuse),/元画像/);
 assert.deepEqual(calls,['decode']);assert.equal(retained.src,'retained');assert.equal(created.src,'');
});
