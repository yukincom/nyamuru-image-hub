import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { toStoredMangaYaml, toSeparatedMangaYaml, parseMangaYaml, validateManga } from '../src/lib/manga.ts';
import {bubbleStrokeWidthMm} from '../src/lib/bubblePresentation.ts';
import {availableFontWeights,matchingFontWeight} from '../src/lib/bubbleFonts.ts';
import {updateTextStyle,textStyleOf,typingTextStyle} from '../src/lib/textStyle.ts';
import {workspaceHistory} from '../src/lib/workspaceHistory.ts';
import {createFrameArtwork} from '../src/lib/imagePlacement.ts';
import {newPaintLayer} from '../src/lib/paintDocument.ts';
import { ensureCanvasTextOwner, changeCanvasTextCategory, canvasTextCategory, changeCanvasDefaultBubbleLineWidth, canvasBubbleLineWidthEditable, editCanvasBubbleLineWidth, toggleCanvasTextVisibility, addCanvasText, addCanvasTextAt, bubbleTextMinimumSize, canvasTextAt, canvasTextEditable, convertScreenTextToBubble, editCanvasText, editCanvasTextStyle, fitCanvasBubbleToText, fitCanvasScreenTextToText, removeCanvasText, screenTextCoveredByBubble } from '../src/lib/canvasText.ts';
function fixture(){const d=createEmptyWorkspaceDocument();d.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:10,y:20,w:90,h:120},bg:0,bubbles:[{text:'生成済み',shape:'normal',speaker:'A',analogTextImport:{assetId:'original',sourceRegionId:'ocr'}}]}];return d;}
test('OCR text reclassification retains the owner, original image, paint, text and exact position through every category and storage',()=>{
 for(const overlay of [false,true]){
  const d=fixture(),page=d.manga.pages[0];
  if(overlay)page.page_overlay={frame:false,layer:'above_panel_frames',bubbles:structuredClone(page.panels[0].bubbles)};
  const owner=overlay?page.page_overlay:page.panels[0],bubble=owner.bubbles[0];
  const asset={id:'ink',storageId:'ink',sha256:'1'.repeat(64),mediaType:'image/png',originalName:'test.png',widthPx:30,heightPx:40,byteLength:128};d.manga.image_assets=[asset];
  const paint={version:1,width:30,height:40,dpi:100,layers:[{...newPaintLayer('保持する描画'),id:'painted',visible:false,locked:true}]};
  Object.assign(bubble,{text:'ゴ  ゴ\nゴ',bbox:{x:21,y:33,w:48,h:67},text_position:{x:.3,y:1.2},text_style:{fontSize:19,orientation:'horizontal',fontWeight:500},text_runs:[{start:0,end:1,italic:true}],
   analogTextImport:{assetId:'original',sourceRegionId:'ocr',originalImageId:'original-image',rasterLayerSeparated:true,rasterLayerInitialized:true},
   paint_overlay:{...createFrameArtwork(asset,{x:21,y:33,w:48,h:67}),paint}});
  const source=structuredClone(bubble),original={...createFrameArtwork(asset,{x:5,y:7,w:8,h:9}),id:'original-image',bubbleOriginal:{sourceRegionId:'ocr',name:'原字'},paint:{...paint,layers:[{...newPaintLayer('原字'),id:'original-layer',visible:false}]}};
  (overlay?page:owner).images=[original];owner.bubbles.push({text:'後続',join_to:1});
  const target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay};
  for(const category of ['handwritten','typeset','bubble']){
   assert.deepEqual(changeCanvasTextCategory(d,target,category),target);assert.equal(owner.bubbles[0],bubble);assert.equal(canvasTextCategory(bubble,'bubble'),category);
   for(const key of ['text','bbox','text_position','text_style','text_runs','analogTextImport','paint_overlay'])assert.deepEqual(bubble[key],source[key],key);
   assert.equal((overlay?page:owner).images[0],original);assert.equal(owner.bubbles[1].join_to,undefined);assert.equal(bubble.tail,false);
   // Stored YAML retains editing metadata without making a second original or paint owner.
   const restored=parseMangaYaml(toStoredMangaYaml(d)),roundtrip=canvasTextAt(restored,target);
   for(const key of ['text','bbox','text_position','text_style','text_runs','analogTextImport','paint_overlay'])assert.deepEqual(roundtrip[key],source[key],key);
   assert.equal(roundtrip.shape,category==='bubble'?'normal':category);
  }
 }
});
test('T-created text enters the same category switch without fitting, moving or duplicating text',()=>{
 for(const overlay of [false,true]){
  const d=fixture(),target=addCanvasTextAt(d,0,overlay?null:0,{x:60,y:75},{orientation:'horizontal',fontSize:20,fontWeight:450});
  editCanvasText(d,target,'看 板\n二行');const screen=structuredClone(canvasTextAt(d,target));
  const converted=changeCanvasTextCategory(d,target,'handwritten');assert.ok(converted);assert.equal(converted.overlay,overlay);
  const bubble=canvasTextAt(d,converted);assert.equal(bubble.text,screen.text);assert.deepEqual(bubble.bbox,screen.bbox);assert.deepEqual(bubble.text_style,{...screen.text_style,lineHeight:1.15});
  assert.equal((overlay?d.manga.pages[0].page_overlay:d.manga.pages[0].panels[0]).screen_text,undefined);
  changeCanvasTextCategory(d,converted,'typeset');assert.equal(canvasTextAt(d,converted),bubble);assert.deepEqual(bubble.bbox,screen.bbox);
 }
});
test('category no-ops, missing targets and manual locks leave the document untouched',()=>{
 const target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false};
 for(const lock of ['same','missing','locked','nativeLocked','panel']){
  const d=fixture();if(lock==='missing')target.index=12;else target.index=0;
  if(lock==='locked'||lock==='nativeLocked')d.manga.pages[0].panels[0].bubbles[0][lock]=true;
  if(lock==='panel')d.manga.pages[0].panels[0].layer={locked:true};
  const before=structuredClone(d);assert.equal(changeCanvasTextCategory(d,target,lock==='same'?'bubble':'typeset'),null);assert.deepEqual(d,before);
 }
});
test('new panel and page text inherit the chosen style instead of returning to 12pt',()=>{
 const d=fixture(),style={fontSize:29,orientation:'horizontal',font:'BIZ UDP明朝',fontWeight:700,textAlign:'right'};
 const targets=[addCanvasTextAt(d,0,0,{x:40,y:70},style),addCanvasTextAt(d,0,null,{x:10,y:10},style),addCanvasText(d,0,0,'screen_text',style)];
 targets.forEach((target,index)=>{assert.ok(target);const item=canvasTextAt(d,target);assert.equal(item.text_style.fontSize,29);assert.equal(item.orientation,'horizontal');assert.equal(item.text_style.font,style.font);assert.equal(item.text_style.fontWeight,700);assert.equal(item.text_style.textAlign,'right');editCanvasText(d,target,`文字${index}`);});
 const restored=parseMangaYaml(toStoredMangaYaml(d));
 targets.forEach(target=>{assert.equal(canvasTextAt(restored,target).text_style.fontSize,29);assert.equal(canvasTextAt(restored,target).text_style.textAlign,'right');});
});

const appSource=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
const fileActions=['workspaceProjectFiles','workspaceImageExport'].map(name=>readFileSync(new URL(`../src/components/workspace/${name}.ts`,import.meta.url),'utf8')).join('\n');
const appAst=ts.createSourceFile('App.tsx',appSource+'\n'+fileActions,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function appHandler(name,context){
 let body;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(appAst)===name)body=node.initializer?.getText(appAst);if(ts.isFunctionDeclaration(node)&&node.name?.text===name)body=node.getText(appAst);ts.forEachChild(node,visit);}visit(appAst);assert.ok(body,name);
 return runInNewContext(ts.transpileModule(`(${body})`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,context);
}
test('actual size controls end gestures on release, cancel, blur, Enter, key-up and unmount without committing IME drafts',()=>{
 const source=readFileSync(new URL('../src/components/CanvasTextToolbar.tsx',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('export default function')).replace('export default ','');
 const changes=[],phases=[],history=[],listeners=new Map(),cleanups=[];
 const component=runInNewContext(ts.transpileModule(`(${body})`,{fileName:'toolbar.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h'}}).outputText,{
  h:(type,props,...children)=>({type,props,children}),FontFamilyPicker:()=>{},availableFontWeights,matchingFontWeight,useRef:value=>({current:value}),useState:value=>[value,()=>{}],useEffect:run=>{const cleanup=run();if(cleanup)cleanups.push(cleanup);},
  window:{addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type)=>listeners.delete(type)}});
 const root=component({style:{fontSize:18},defaultFont:'游明朝',disabled:false,onChange:patch=>changes.push({...patch}),onSizeGesture:phase=>phases.push(phase),onHistory:direction=>history.push(direction)});
 const nodes=[];function walk(node){if(!node||typeof node!=='object')return;nodes.push(node);node.children?.flat(Infinity).forEach(walk);}walk(root);
 const input=nodes.find(n=>n.props?.['aria-label']==='文字サイズ pt').props,slider=nodes.find(n=>n.props?.['aria-label']==='文字サイズ スライダー').props;
 const event=(value,key='',isComposing=false)=>({currentTarget:{value},key,isComposing,preventDefault(){},stopPropagation(){}});
 input.onCompositionStart();input.onInput(event('24'));input.onKeyDown(event('24','Enter',true));assert.equal(changes.length,0);
 input.onCompositionEnd(event('24'));assert.deepEqual(changes,[{fontSize:24}]);input.onKeyDown(event('24','Enter'));assert.equal(phases.at(-1),'end');
 for(const terminal of [()=>listeners.get('pointerup')(),()=>listeners.get('pointercancel')(),()=>listeners.get('blur')(),()=>slider.onKeyUp(event('28','ArrowRight')),()=>slider.onBlur()]){
  slider.onInput(event('26'));slider.onInput(event('28'));const before=phases.filter(p=>p==='end').length;terminal();assert.equal(phases.filter(p=>p==='end').length,before+1);
 }
 input.onInput(event('0'));input.onInput(event('10.'));assert.equal(changes.at(-1).fontSize,28);
 input.onInput(event('32'));root.props.onKeyDown({...event('32','z'),ctrlKey:true});assert.deepEqual(history,['undo']);assert.equal(phases.at(-1),'end');
 input.onInput(event('34'));cleanups.forEach(cleanup=>cleanup());assert.equal(phases.at(-1),'end');assert.equal(listeners.size,0);
});
test('実Appの書体選択が新規文字と選択文字を単一の実ウェイトへ揃える',()=>{
 const localFontCatalog={current:[{family:'Single',weights:[{value:400,label:'B'}]}]},documentRef={current:fixture()};let style={font:'Previous',fontWeight:900};
 const target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false};canvasTextAt(documentRef.current,target).text_style={...style};
 const context={localFontCatalog,availableFontWeights,updateTextStyle,textStyleOf,setTextToolStyle:fn=>{style=fn(style);},documentRef,paintSessionRef:{current:null},projectOperation:{current:false},qwenGeneration:null,editCanvasTextStyle,canvasTextAt,imageGesture:{current:{}},lastHistoryPush:{current:0},setDocument:next=>{documentRef.current=next;},setToast:message=>assert.fail(message)};
 context.changeTextToolStyle=appHandler('changeTextToolStyle',context);
 context.changeTextToolStyle({font:'Single'});assert.equal(style.fontWeight,400);
 appHandler('changeCanvasTextStyle',context)(target,{font:'Single'});assert.equal(canvasTextAt(documentRef.current,target).text_style.fontWeight,400);
});
test('actual style and normalized panel controls leave history, redo and save state untouched on no-ops',()=>{
 const documentRef={current:fixture()},target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false};
 canvasTextAt(documentRef.current,target).text_style={fontSize:18};
 const imageGesture={current:{active:true,pushed:true}},lastHistoryPush={current:123};let updates=0,preferences=0,clones=0;
 const context={changeCanvasDefaultBubbleLineWidth,documentRef,paintSessionRef:{current:null},projectOperation:{current:false},qwenGeneration:null,editCanvasTextStyle,canvasTextAt,textStyleOf:item=>item.text_style,
  changeTextToolStyle:()=>preferences++,imageGesture,lastHistoryPush,setDocument:next=>{updates++;documentRef.current=next;},setToast:message=>assert.fail(message),
  cloneDocument:doc=>{clones++;return structuredClone(doc);},clamp:(v,min,max)=>Math.max(min,Math.min(max,v))};
 const change=appHandler('changeCanvasTextStyle',context);
 change(target,{fontSize:18});assert.equal(updates,0);assert.equal(preferences,0);assert.deepEqual(imageGesture.current,{active:true,pushed:true});assert.equal(lastHistoryPush.current,123);
 change(target,{fontSize:19});assert.equal(updates,1);assert.equal(preferences,1);
 change(target,{fontSize:19});assert.equal(updates,1);
 const panel=appHandler('changePanelStyleNumber',context);
 for(const key of ['bubble_line_width_mm','panel_frame_width_mm','panel_gutter_row_mm','panel_gutter_column_mm']){
  documentRef.current.manga.meta[key]=.5;panel(key,.51);assert.equal(clones,0);assert.equal(updates,1);
 }
 panel('panel_frame_width_mm',.6);assert.equal(clones,1);assert.equal(updates,2);
});
test('bubble width from T waits for paint and applies to the newly materialized document',async()=>{
 const documentRef={current:fixture()},paintSessionRef={current:{document:documentRef.current}},tasks=[];let closes=0,updates=0;
 const context={changeCanvasDefaultBubbleLineWidth,documentRef,paintSessionRef,clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),cloneDocument:structuredClone,
  layerTransition:fn=>{const task=fn();tasks.push(task);return task;},paintController:{current:{close:async()=>{closes++;documentRef.current=structuredClone(documentRef.current);documentRef.current.manga.meta.title='retained ink';paintSessionRef.current=null;}}},setDocument:next=>{updates++;documentRef.current=next;}};
 const change=appHandler('changePanelStyleNumber',context);
 const before=documentRef.current.manga.meta.bubble_line_width_mm;change('bubble_line_width_mm',before);assert.equal(closes,0);
 change('bubble_line_width_mm',before===.7?.8:.7);assert.equal(updates,0);await Promise.all(tasks);
 assert.equal(closes,1);assert.equal(updates,1);assert.equal(documentRef.current.manga.meta.title,'retained ink');
});
test('bubble default changes retain every existing body and tail, while new bubbles inherit the new value',()=>{
 const d=fixture(),page=d.manga.pages[0],panel=page.panels[0];
 panel.bubbles.push({text:'個別',line_width_mm:1.4},{text:'非表示',hidden:true},{text:'固定',locked:true});
 page.page_overlay={frame:false,layer:'above_panel_frames',bubbles:[{text:'前景'}],figures:[]};
 const previous=d.manga.meta.bubble_line_width_mm,before=structuredClone(d);
 assert.equal(changeCanvasDefaultBubbleLineWidth(d,previous),false);assert.deepEqual(d,before);
 assert.equal(changeCanvasDefaultBubbleLineWidth(d,.9),true);
 assert.deepEqual(panel.bubbles.map(b=>b.line_width_mm),[previous,1.4,previous,previous]);
 assert.equal(page.page_overlay.bubbles[0].line_width_mm,previous);
 const added=addCanvasText(d,0,0,'bubble');assert.ok(added);
 assert.equal(bubbleStrokeWidthMm(canvasTextAt(d,added),d.manga.meta.bubble_line_width_mm),.9);
 assert.equal(changeCanvasDefaultBubbleLineWidth(d,1.2),true);assert.equal(canvasTextAt(d,added).line_width_mm,.9);
 const saved=structuredClone(d);assert.equal(changeCanvasDefaultBubbleLineWidth(d,1.2),false);assert.deepEqual(d,saved);
 for(const write of [toStoredMangaYaml,toSeparatedMangaYaml]){
  const restored=parseMangaYaml(write(d));
  assert.deepEqual(restored.manga.pages[0].panels[0].bubbles.map(b=>b.line_width_mm),[previous,1.4,previous,previous,.9]);
  assert.equal(restored.manga.pages[0].page_overlay.bubbles[0].line_width_mm,previous);
 }
});

test('individual bubble widths retain pen precision, geometry, siblings and defaults across saves',()=>{
 for(const overlay of [false,true]){
  const d=fixture(),page=d.manga.pages[0];
  page.page_overlay={frame:false,layer:'above_panel_frames',bubbles:[{text:'前景',bbox:{x:10,y:10,w:30,h:40}}],figures:[]};
  page.panels[0].bubbles.push({text:'別の吹き出し',line_width_mm:1});
  const target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay},original=structuredClone(d),bubble=canvasTextAt(d,target);
  assert.equal(editCanvasBubbleLineWidth(d,target,d.manga.meta.bubble_line_width_mm),d);
  for(const width of [.07*25.4/600,100*25.4/300]){
   const next=editCanvasBubbleLineWidth(d,target,width);assert.notEqual(next,d);
   const expected=structuredClone(original);canvasTextAt(expected,target).line_width_mm=width;
   assert.deepEqual(next,expected);assert.deepEqual(d,original);
   const restored=parseMangaYaml(toStoredMangaYaml(next));assert.equal(canvasTextAt(restored,target).line_width_mm,width);
   assert.equal(validateManga(restored).filter(issue=>issue.path.endsWith('.line_width_mm')).length,0);
  }
  for(const value of [0,-1,Infinity,NaN])assert.equal(editCanvasBubbleLineWidth(d,target,value),d);
  for(const patch of [{hidden:true},{locked:true},{nativeLocked:true},{paint_overlay:{locked:true}}]){
   Object.assign(bubble,patch);assert.equal(canvasBubbleLineWidthEditable(d,target),false);assert.equal(editCanvasBubbleLineWidth(d,target,1.2),d);
   Object.keys(patch).forEach(key=>delete bubble[key]);
  }
  if(!overlay){page.panels[0].layer={locked:true};assert.equal(editCanvasBubbleLineWidth(d,target,1.2),d);delete page.panels[0].layer;}
  assert.equal(editCanvasBubbleLineWidth(d,{...target,index:99},1.2),d);
  assert.equal(editCanvasBubbleLineWidth(d,{...target,kind:'screen_text'},1.2),d);
  for(const width of [0,-1,Infinity,NaN]){
   bubble.line_width_mm=width;assert.ok(validateManga(d).some(issue=>issue.path.endsWith('.line_width_mm')));
  }
 }
});

test('the actual pen-palette handler edits one selected bubble with independent undo and redo',()=>{
 for(const overlay of [false,true])for(const bubblePathTool of [false,'node']){
  const documentRef={current:fixture()},d=documentRef.current;
  d.manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',figures:[],bubbles:[{text:'前景'}]};
  const selectionContext={paintSession:null,textTool:false,zoomTool:false,selectedElement:{type:'bubble',index:0,scope:overlay?'page_overlay':undefined},activePage:0,activePanel:0,bubblePathTool};
  const selectedBubbleTarget=appHandler('selectedBubbleTarget',selectionContext),timeline={current:workspaceHistory()},imageGesture={current:{active:false,pushed:false}},lastHistoryPush={current:0};
  assert.equal(selectedBubbleTarget.overlay,overlay);
  for(const block of ['paintSession','textTool','zoomTool'])assert.equal(appHandler('selectedBubbleTarget',{...selectionContext,[block]:true}),undefined);
  let updates=0;
  const context={selectedBubbleTarget,bubblePathTool,documentRef,editCanvasBubbleLineWidth,paintSessionRef:{current:null},projectOperation:{current:false},layerSwitch:{current:false},qwenGeneration:null,textTool:false,zoomTool:false,
   getPrintSetup:()=>({dpi:600}),imageGestureBoundary:()=>{imageGesture.current={active:false,pushed:false};},imageGesture,lastHistoryPush,timeline,changedHistory:()=>{},workspaceSnapshot:()=>documentRef.current,
   synchronizeCatalogReferences:()=>{},reconcileSplitOverlapFlags:()=>{},setDocumentState:()=>updates++,setHasDocument:()=>{},setDocument:()=>{}};
  context.setDocument=appHandler('setDocument',context);
  const change=appHandler('changeSelectedBubbleLineWidth',context);
  const initial=documentRef.current;change(12);const first=documentRef.current;assert.equal(updates,1);
  assert.equal(canvasTextAt(first,selectedBubbleTarget).line_width_mm,12*25.4/600);assert.equal(first.manga.meta.bubble_line_width_mm,initial.manga.meta.bubble_line_width_mm);
  change(12);assert.equal(updates,1);assert.equal(timeline.current.past.length,1);
  change(20);assert.equal(timeline.current.past.length,2);
  const second=documentRef.current;documentRef.current=timeline.current.undo(second);assert.equal(documentRef.current,first);
  change(12);assert.equal(timeline.current.future.length,1);
  documentRef.current=timeline.current.redo(documentRef.current);assert.equal(documentRef.current,second);
  for(const block of ['textTool','zoomTool','qwenGeneration']){context[block]=true;change(30);assert.equal(documentRef.current,second);context[block]=false;}
  context.paintSessionRef.current={};change(30);assert.equal(documentRef.current,second);
 }
});

test('size notifications share the existing gesture history until commit, but not after undo or another edit',()=>{
 const documentRef={current:fixture()},target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false};
 canvasTextAt(documentRef.current,target).text_style={fontSize:18};
 const initial=documentRef.current,timeline={current:workspaceHistory()},imageGesture={current:{active:false,pushed:false}},lastHistoryPush={current:0};
 const context={documentRef,timeline,imageGesture,lastHistoryPush,editCanvasTextStyle,canvasTextAt,textStyleOf:item=>item.text_style,changeTextToolStyle:()=>{},setToast:message=>assert.fail(message),paintSessionRef:{current:null},projectOperation:{current:false},qwenGeneration:null,
  synchronizeCatalogReferences:()=>{},reconcileSplitOverlapFlags:()=>{},workspaceSnapshot:()=>documentRef.current,changedHistory:()=>{},setDocument:()=>{},setDocumentState:()=>{},setHasDocument:()=>{}};
 context.setDocument=appHandler('setDocument',context);
 const boundary=appHandler('imageGestureBoundary',context),change=appHandler('changeCanvasTextStyle',context);
 for(const size of [19,20,24,24]){boundary('start','text-size');change(target,{fontSize:size});}
 assert.equal(timeline.current.past.length,1);assert.equal(timeline.current.past[0],initial);assert.equal(canvasTextAt(documentRef.current,target).text_style.fontSize,24);
 boundary('end','text-size');boundary('start','text-size');change(target,{fontSize:28});boundary('end','text-size');assert.equal(timeline.current.past.length,2);
 const last=documentRef.current;documentRef.current=timeline.current.undo(last);boundary('end');assert.equal(canvasTextAt(documentRef.current,target).text_style.fontSize,24);
 change(target,{fontSize:24});assert.equal(timeline.current.future.length,1);
 documentRef.current=timeline.current.redo(documentRef.current);boundary('end');assert.equal(documentRef.current,last);
 boundary('start','text-size');change(target,{fontSize:30});documentRef.current=timeline.current.undo(documentRef.current);boundary('end');
 // The numeric input may still have focus after Undo. Its next input starts a fresh group.
 boundary('start','text-size');change(target,{fontSize:32});boundary('start','text-size');change(target,{fontSize:34});boundary('end','text-size');
 assert.equal(canvasTextAt(timeline.current.undo(documentRef.current),target).text_style.fontSize,28);
 boundary('start');boundary('end','text-size');assert.equal(imageGesture.current.active,true,'stale palette cleanup must not terminate a new non-size gesture');
});
test('the actual canvas route edits on a normal double click or T single click, never creates on a blank double click',()=>{
 const source=readFileSync(new URL('../src/components/MangaCanvas.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('MangaCanvas.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let body;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='createTextAt')body=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(body);
 class Element {closest(){return null;}}
 for(const kind of ['bubble','screen_text'])for(const overlay of [false,true]){
  const calls=[],target=new Element(),box={left:20,top:20,right:60,bottom:60,width:40,height:40};
  const textBox={left:30,top:10,right:90,bottom:30,width:60,height:20};
  const item={dataset:{contentPanel:'0',contentIndex:'2',contentKind:kind},hasAttribute:()=>overlay,getBoundingClientRect:()=>box,querySelectorAll:()=>[{getBoundingClientRect:()=>textBox}]};
  const paper={contains:()=>true,getBoundingClientRect:()=>({left:0,top:0,width:200,height:300}),querySelectorAll:()=>[item]};
  const context={Element,textTool:false,painting:false,backgroundEdit:false,zoomTool:false,bubbleTextDragged:{current:false},spacePressedRef:{current:false},paperRef:{current:paper},canvas:{w:200,h:300},page:{panels:[{}]},panelVisible:()=>true,pointInPanel:()=>true,panelLocked:()=>false,elementLocked:()=>false,
   onEditBubble:value=>calls.push(['bubble',structuredClone(value)]),onEditScreenText:(...args)=>calls.push(['screen_text',...args]),onCreateScreenTextAt:(...args)=>calls.push(['new',...structuredClone(args)])};
  const click=runInNewContext(ts.transpileModule(`(${body})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const event=(x,y,detail=1)=>({target,clientX:x,clientY:y,button:0,detail,preventDefault(){},stopPropagation(){}});
  assert.equal(click(event(40,25),null),false);assert.equal(calls.length,0,'ordinary single click remains selection');
  assert.equal(click(event(40,25,2),null,true),true);assert.equal(calls[0][0],kind);
  assert.equal(click(event(80,20,2),null,true),true);assert.equal(calls.length,2,'overflowing point text remains editable');
  assert.equal(click(event(25,50,2),null,true),false);assert.equal(calls.length,2,'double click on blank frame space does not create text');
  context.textTool=true;
  assert.equal(click(event(25,50),null),true);assert.equal(calls.length,3,'T accepts the whole text frame');
  assert.equal(click(event(120,100),null),true);assert.equal(calls.at(-1)[0],'new');
  for(const flag of ['painting','backgroundEdit','zoomTool']){context[flag]=true;assert.equal(click(event(40,25),null),false);context[flag]=false;}
  const count=calls.length;context.elementLocked=()=>true;assert.equal(click(event(40,25),null),true);assert.equal(calls.length,count,'locked text is not edited or replaced by a new text');
  target.closest=()=>({});assert.equal(click(event(40,25),null),false,'native contenteditable keeps its own caret and word selection');
 }
});
test('ending text editing removes only a newly created empty native layer',()=>{
 for(const content of ['', '入力済み']){
  const documentRef={current:fixture()},createdText={current:addCanvasTextAt(documentRef.current,0,0,{x:40,y:70})};
  const target=createdText.current;editCanvasText(documentRef.current,target,content);let editing=target;
  appHandler('endTextEdit',{createdText,documentRef,canvasTextAt,removeCanvasText,cloneDocument:structuredClone,selectedElement:{type:'screen_text',index:target.index},setSelectedElement:()=>{},setDocument:next=>documentRef.current=next,setEditingText:value=>editing=value,imageGestureBoundary:()=>{}})();
  assert.equal(editing,null);assert.equal(createdText.current,null);assert.equal(canvasTextAt(documentRef.current,target)?.text,content||undefined);assert.equal(documentRef.current.manga.pages[0].panels[0].bubbles[0].text,'生成済み');
 }
});
test('replacing a document drops old text indices without cleaning up the incoming document',()=>{
 const incoming=fixture();addCanvasTextAt(incoming,0,0,{x:40,y:70});const before=JSON.stringify(incoming),documentRef={current:fixture()},createdText={current:{pageIndex:0,panelIndex:0,index:0,kind:'screen_text'}};let editing=true;
 appHandler('replaceDocument',{createdText,pendingCanvasElementSelection:{current:null},documentRef,setEditingText:value=>editing=value,imageGestureBoundary:()=>{},synchronizeCatalogReferences:()=>{},reconcileSplitOverlapFlags:()=>{},timeline:{current:{clear:()=>{}}},changedHistory:()=>{},paintController:{current:null},paintSessionRef:{current:null},setPaintSession:()=>{},lastHistoryPush:{current:0},setDocumentState:()=>{},setHasDocument:()=>{}})(incoming);
 assert.equal(createdText.current,null);assert.equal(editing,null);assert.equal(documentRef.current,incoming);assert.equal(JSON.stringify(incoming),before);
});
// 見込み: 描画sessionのない状態では、別コマの新規文字も共通の選択経路へ進む。
// 合格: 編集先と選択先が作成コマを指し文字書式を保持する。実handler＋模擬state、実DOMは対象外。
test('click-created text uses the canonical selection transition when moving to another panel',()=>{
 const documentRef={current:fixture()};documentRef.current.manga.pages[0].panels.push({id:2,shape:{type:'rect',x:10,y:150,w:90,h:100},bg:0,bubbles:[]});
 const createdText={current:null},pendingCanvasElementSelection={current:null};let selection,editing;
 const select=appHandler('selectCanvasElement',{paintSessionRef:{current:null},activePage:0,activePanel:0,pendingCanvasElementSelection,setCanvasSelectionScrollRequest:()=>{},setActivePage:()=>{},setActivePanel:()=>{},setSelectedPanels:()=>{},setSelectedElement:value=>selection=value});
 appHandler('createScreenTextAt',{layerTransition:action=>action(),paintSessionRef:{current:null},projectOperation:{current:false},qwenGeneration:null,endTextEdit:()=>{},documentRef,cloneDocument:structuredClone,addCanvasTextAt,textToolStyle:{fontSize:31,orientation:'horizontal'},imageGestureBoundary:()=>{},lastHistoryPush:{current:0},setDocument:next=>documentRef.current=next,createdText,setTextTool:()=>{},setZoomTool:()=>{},setBubblePathTool:()=>{},setPaintToolsCollapsed:()=>{},setSelectedPanels:()=>{},selectCanvasElement:select,setEditingText:value=>editing=value})(0,1,{x:40,y:180});
 assert.equal(editing.panelIndex,1);assert.equal(selection.type,'screen_text');assert.deepEqual(pendingCanvasElementSelection.current,selection);assert.equal(canvasTextAt(documentRef.current,editing).text_style.fontSize,31);
});
test('panel splitting settles new empty text before cloning and reassigning its owner',()=>{
 const documentRef={current:fixture()},panel=documentRef.current.manga.pages[0].panels[0];let splitSawEmpty=true;
 addCanvasTextAt(documentRef.current,0,0,{x:40,y:70});
 appHandler('splitActivePanel',{page:documentRef.current.manga.pages[0],panel,panelGeometryLocked:()=>false,endTextEdit:()=>{delete panel.screen_text;},documentRef,cloneDocument:structuredClone,activePage:0,activePanel:0,panelSplitDirection:'vertical',panelGutters:{},splitPanel:page=>{splitSawEmpty=Boolean(page.panels[0].screen_text?.length);return [0,1];},setDocument:next=>documentRef.current=next,setActivePanel:()=>{},setSelectedPanels:()=>{},setSelectedElement:()=>{},setToast:()=>{}})();
 assert.equal(splitSawEmpty,false);
});
test('export settles the current text before taking its snapshot, while style controls do not end editing',()=>{
 const calls=[],documentRef={current:{manga:{meta:{title:'test'}}}};
 appHandler('exportOmny',{hasDocument:true,showNewDialog:false,projectOperation:{current:false},endTextEdit:()=>calls.push('end'),documentRef,toSeparatedMangaYaml:()=>{calls.push('snapshot');return 'yaml';},Blob,downloadBrowserBlob:()=>{},omnyFileName:()=>'',setToast:()=>{}})();
 assert.deepEqual(calls,['end','snapshot']);
 for(const name of ['saveProject','saveBrowserProject','openProject','openBrowserProject','exportPageRange']){
  let body;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(appAst)===name)body=node.initializer.getText(appAst);ts.forEachChild(node,visit);}visit(appAst);assert.ok(body.includes('endTextEdit();'),name);assert.ok(body.indexOf('endTextEdit();')<body.indexOf('documentRef.current'),name);
 }
 const canvas=readFileSync(new URL('../src/components/MangaCanvas.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(canvas,/item\.text_style\?\.fontSize===undefined\)onTextStyle/,'opening implicit-size legacy text must not reset the next-text style');
 const editor=readFileSync(new URL('../src/components/NativeTextEditor.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(editor,/onBlur=\{[^\n]*onEnd/,'palette focus must not end the current selection');
});
test('T additions remain native editable objects through save and reopen',()=>{
 const d=fixture(),bubble=addCanvasText(d,0,0,'bubble'),screen=addCanvasText(d,0,0,'screen_text');
 editCanvasText(d,bubble,'追加\n二行目');editCanvasText(d,screen,'看板');
 const r=parseMangaYaml(toStoredMangaYaml(d));
 assert.equal(canvasTextAt(r,bubble).text,'追加\n二行目');assert.equal(canvasTextAt(r,bubble).shape,'normal');
 assert.equal(canvasTextAt(r,screen).orientation,'vertical');assert.equal(canvasTextAt(r,screen).text_style.fontSize,12);assert.equal(canvasTextAt(r,screen).text,'看板');
 assert.equal(canvasTextAt(r,bubble).paint_overlay,undefined);assert.ok(canvasTextAt(r,bubble).bbox);
 assert.equal(r.manga.pages[0].panels[0].bubbles[0].text,'生成済み');
 editCanvasText(r,bubble,'再編集');assert.equal(canvasTextAt(r,bubble).text,'再編集');
});
test('existing generated bubble uses the same text edit and retains speaker and original reference',()=>{
 const d=fixture(),target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false};
 editCanvasText(d,target,'修正');const b=canvasTextAt(d,target);
 assert.equal(b.text,'修正');assert.equal(b.speaker,'A');assert.equal(b.analogTextImport.assetId,'original');assert.equal(b.analogTextImport.referenceHidden,undefined);
});
test('missing, hidden and unsupported owners cannot receive text changes',()=>{
 const d=fixture();assert.equal(addCanvasText(d,0,9,'bubble'),null);
 const t=addCanvasText(d,0,0,'screen_text');assert.equal(editCanvasText(d,{...t,overlay:true},'bad'),false);
 d.manga.pages[0].panels[0].layer={hidden:true};assert.equal(addCanvasText(d,0,0,'bubble'),null);assert.equal(editCanvasText(d,t,'bad'),false);assert.equal(canvasTextAt(d,t).text,'');
});
test('whole-panel and bubble-folder locks reject native text edits without hiding text',()=>{
 const d=fixture(),target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false},panel=d.manga.pages[0].panels[0];
 panel.bubbles[0].locked=true;assert.equal(canvasTextEditable(d,target),false);assert.equal(editCanvasText(d,target,'変更しない'),false);assert.equal(panel.bubbles[0].text,'生成済み');
 delete panel.bubbles[0].locked;panel.layer={locked:true};assert.equal(canvasTextEditable(d,target),false);assert.equal(addCanvasText(d,0,0,'screen_text'),null);assert.equal(addCanvasTextAt(d,0,0,{x:20,y:20}),null);
 panel.screen_text=[{text:'固定中',bbox:{x:20,y:20,w:15,h:10}}];const screen={pageIndex:0,panelIndex:0,index:0,kind:'screen_text',overlay:false};
 assert.equal(removeCanvasText(d,screen),false);assert.equal(fitCanvasScreenTextToText(d,screen),false);assert.equal(convertScreenTextToBubble(d,{screenText:screen,materialId:'white-ellipse'}),null);assert.equal(panel.screen_text[0].text,'固定中');
});

test('removing one native bubble repairs joins and cleans an empty page overlay',()=>{
 const d=fixture(),panel=d.manga.pages[0].panels[0];
 panel.bubbles=[{text:'親'},{text:'削除',join_to:1},{text:'子',join_to:2},{text:'別',join_to:1}];
 assert.equal(removeCanvasText(d,{pageIndex:0,panelIndex:0,index:1,kind:'bubble',overlay:false}),true);
 assert.deepEqual(panel.bubbles,[{text:'親'},{text:'子'},{text:'別',join_to:1}]);
 d.manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',bubbles:[{text:'前景'}]};
 assert.equal(removeCanvasText(d,{pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:true}),true);
 assert.equal(d.manga.pages[0].page_overlay,undefined);
});

test('T click makes the point the start of ordinary text and keeps page text through save',()=>{
 let d=fixture();
 const panel=addCanvasTextAt(d,0,0,{x:40,y:70}),overlay=addCanvasTextAt(d,0,null,{x:205,y:292});
 assert.ok(panel&&overlay);
 assert.equal(panel.overlay,false);assert.equal(overlay.overlay,true);
 let panelItem=canvasTextAt(d,panel);const initial=structuredClone(panelItem.bbox);
 assert.ok(Math.abs(panelItem.bbox.x+panelItem.bbox.w-40)<1e-9);assert.equal(panelItem.bbox.y,70);
 editCanvasText(d,panel,'右\n左');
 assert.ok(Math.abs(panelItem.bbox.x+panelItem.bbox.w-40)<1e-9);assert.equal(panelItem.bbox.y,70);assert.ok(panelItem.bbox.w>initial.w);
 const verticalStart={x:panelItem.bbox.x+panelItem.bbox.w,y:panelItem.bbox.y};
 d=editCanvasTextStyle(d,panel,{orientation:'horizontal'});panelItem=canvasTextAt(d,panel);
 assert.equal(panelItem.bbox.x,verticalStart.x);assert.equal(panelItem.bbox.y,verticalStart.y);
 editCanvasText(d,panel,'上');const oneLineHeight=panelItem.bbox.h;editCanvasText(d,panel,'上\n下');
 assert.equal(panelItem.bbox.x,verticalStart.x);assert.equal(panelItem.bbox.y,verticalStart.y);assert.ok(panelItem.bbox.h>oneLineHeight);
 const beforeSize=structuredClone(panelItem.bbox);d=editCanvasTextStyle(d,panel,{fontSize:24});panelItem=canvasTextAt(d,panel);
 assert.ok(panelItem.bbox.w>beforeSize.w);assert.ok(panelItem.bbox.h>beforeSize.h);
 const overlayItem=canvasTextAt(d,overlay);assert.equal(overlayItem.text_style.fontSize,12);assert.equal(overlayItem.orientation,'vertical');
 assert.ok(Math.abs(overlayItem.bbox.x+overlayItem.bbox.w-205)<1e-9);assert.equal(overlayItem.bbox.y,292);
 assert.ok(overlayItem.bbox.x>=0&&overlayItem.bbox.y>=0);
 assert.ok(overlayItem.bbox.x+overlayItem.bbox.w<=d.manga.pages[0].canvas.w);
 assert.ok(overlayItem.bbox.y+overlayItem.bbox.h<=d.manga.pages[0].canvas.h);
 assert.equal(editCanvasText(d,overlay,'ページ文字'),true);
 const reopened=parseMangaYaml(toStoredMangaYaml(d));
 assert.equal(canvasTextAt(reopened,overlay).text,'ページ文字');
});

test('dropping a native white bubble transfers style and keeps expanding around authored text',()=>{
 const d=fixture(),screen=addCanvasTextAt(d,0,0,{x:55,y:80});
 editCanvasText(d,screen,'中央\n文字');
 const item=canvasTextAt(d,screen);item.text_style={font:'BIZ UDP明朝',fontSize:15,fontWeight:700};item.text_runs=[{start:0,end:2,fontWeight:900}];
 const center={x:item.bbox.x+item.bbox.w/2,y:item.bbox.y+item.bbox.h/2};
 const bubble=convertScreenTextToBubble(d,{screenText:screen,materialId:'nomal_01'});
 assert.ok(bubble);assert.equal(d.manga.pages[0].panels[0].screen_text,undefined);
 const converted=canvasTextAt(d,bubble);assert.equal(converted.text,'中央\n文字');
 assert.deepEqual(converted.text_style,{font:'BIZ UDP明朝',fontSize:15,fontWeight:700,orientation:'vertical'});
 assert.deepEqual(converted.text_runs,[{start:0,end:2,fontWeight:900}]);
 assert.ok(Math.abs(converted.bbox.x+converted.bbox.w/2-center.x)<1e-9);
 assert.ok(Math.abs(converted.bbox.y+converted.bbox.h/2-center.y)<1e-9);
 assert.deepEqual({w:converted.bbox.w,h:converted.bbox.h},bubbleTextMinimumSize(converted));
 const fitted=structuredClone(converted.bbox);editCanvasText(d,bubble,'あとから長くしても自動で広げる');
 assert.equal(converted.bbox.w,fitted.w);assert.ok(converted.bbox.h>fitted.h);
 assert.equal(converted.text,'あとから長くしても自動で広げる');
});

test('native text fitting does not depend on the OCR image visibility metadata',()=>{
 const d=fixture(),panel=d.manga.pages[0].panels[0];
 panel.bubbles[0].analogTextImport.referenceHidden=true;panel.bubbles[0].bbox={x:40,y:50,w:7,h:7};panel.bubbles[0].text_style={fontSize:18};
 panel.bubbles.push({text:'短い',shape:'normal',bbox:{x:20,y:30,w:45,h:60}});
 panel.bubbles.push({text:'原字参照',shape:'normal',bbox:{x:12,y:24,w:7,h:7},analogTextImport:{assetId:'visible-original',sourceRegionId:'ocr-visible'}});
 const target={pageIndex:0,panelIndex:0,index:0,overlay:false,kind:'bubble'};
 assert.equal(fitCanvasBubbleToText(d,target),true);
 const [expanded,kept,sourceArt]=panel.bubbles;
 assert.ok(expanded.bbox.w>7&&expanded.bbox.h>7);
 assert.equal(fitCanvasBubbleToText(d,{...target,index:1}),false);
 assert.deepEqual(kept.bbox,{x:20,y:30,w:45,h:60});
 assert.equal(fitCanvasBubbleToText(d,{...target,index:2}),true);
 assert.ok(sourceArt.bbox.w>7&&sourceArt.bbox.h>7);
 assert.equal(sourceArt.analogTextImport.assetId,'visible-original');
 assert.equal(expanded.speaker,'A');assert.equal(expanded.shape,'normal');
});

test('font, size and weight changes never move or resize a bubble through any selection path',()=>{
 let d=fixture();const target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false},bubble=canvasTextAt(d,target);
 bubble.bbox={x:31,y:42,w:27,h:38};bubble.text_position={x:.72,y:.28};bubble.text_runs=[{start:0,end:2,fontWeight:700}];
 const geometry=structuredClone({bbox:bubble.bbox,text_position:bubble.text_position});
 for(const [patch,selection] of [[{font:'BIZ UDP明朝'}],[{fontWeight:900},{start:1,end:3}],[{fontSize:38}]]){
  const next=editCanvasTextStyle(d,target,patch,selection);assert.notEqual(next,d);d=next;const item=canvasTextAt(d,target);assert.deepEqual({bbox:item.bbox,text_position:item.text_position},geometry);
 }
});

test('moving an empty native bubble over ordinary text detects one eligible source and rejects painted bubbles',()=>{
 const d=fixture(),screen=addCanvasTextAt(d,0,0,{x:55,y:80}),bubble=addCanvasText(d,0,0,'bubble');
 editCanvasText(d,screen,'取り込む');
 canvasTextAt(d,bubble).bbox={x:35,y:60,w:40,h:40};
 assert.deepEqual(screenTextCoveredByBubble(d,bubble),screen);
 assert.deepEqual(convertScreenTextToBubble(d,{screenText:screen,bubble}),bubble);
 assert.equal(canvasTextAt(d,bubble).text,'取り込む');
 const screen2=addCanvasTextAt(d,0,0,{x:55,y:80}),painted=addCanvasText(d,0,0,'bubble');
 canvasTextAt(d,painted).bbox={x:35,y:60,w:40,h:40};canvasTextAt(d,painted).paint_overlay={assetId:'x',bbox:{x:35,y:60,w:40,h:40}};
 assert.equal(screenTextCoveredByBubble(d,painted),null);
 assert.equal(convertScreenTextToBubble(d,{screenText:screen2,bubble:painted}),null);
});

test('T uses one click for existing text or point text and keeps a settings toolbar without a selection',()=>{
 const app=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
 const canvas=readFileSync(new URL('../src/components/MangaCanvas.tsx',import.meta.url),'utf8');
 const editor=readFileSync(new URL('../src/components/PaintEditor.tsx',import.meta.url),'utf8');
 const toolbar=readFileSync(new URL('../src/components/CanvasTextToolbar.tsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../src/styles/global.css',import.meta.url),'utf8');
 assert.match(app,/function chooseTextTool\(\)\{void requestPcFonts\(\);void layerTransition\(async\(\)=>\{/);
 assert.doesNotMatch(app,/function chooseTextTool\(\)[\s\S]{0,500}addText\('screen_text'\)/);
 assert.match(app,/function createScreenTextAt\([\s\S]*?createdText\.current=target/);
 assert.doesNotMatch(app,/置きたい場所をクリック/);
 assert.doesNotMatch(canvas,/if\(editingText\|\|selectedElement\)/);
 assert.match(canvas,/onClickCapture=\{event=>\{createTextAt\(event,null\);\}\}/);
 assert.match(canvas,/onCreateScreenTextAt\?\.\(panelIndex,point\)/);
 assert.match(canvas,/pointInPanel\(panel,point.x,point.y\)/);
 assert.match(canvas,/\.background3d-window,\.bubble-text-move-frame\.is-active/,'active bubble text positioning drag remains available');
 assert.match(canvas,/if\(bubbleTextDragged\.current\)\{bubbleTextDragged\.current=false;event\.preventDefault\(\);event\.stopPropagation\(\);return true;\}/,'a positioning drag must not create text on release');
 assert.match(canvas,/onDblClickCapture=\{event=>\{if\(!textTool\)createTextAt\(event,null,true\);\}\}/);
 assert.doesNotMatch(canvas,/screenText\.text\s*\|\|\s*['"]文字['"]/);
 assert.match(toolbar,/class="canvas-text-font"/);
 assert.match(toolbar,/<FontFamilyPicker value=\{style\.font\?\?defaultFont\}/);
 assert.doesNotMatch(toolbar,/<datalist|fontListId/);
 assert.match(toolbar,/class="canvas-text-font-settings"/);
 assert.match(toolbar,/aria-label="文字サイズ pt" type="text" inputMode="decimal"/);
 assert.match(toolbar,/aria-label="文字サイズ スライダー" type="range" min="4" max="144" step="1"/);
 assert.doesNotMatch(toolbar,/type="number"|fontSize\.toFixed/);
 assert.match(canvas,/textSettingsOwner&&textToolbarHost/);
 assert.match(app,/addCanvasTextAt\(next,pageIndex,panelIndex,point,textToolStyle\)/);
 assert.match(canvas,/const toolbarTarget:CanvasTextTarget\|null=textTool\?/);
 assert.match(canvas,/'--text-tool-cursor':textToolCursor\(textToolStyle\)/);
 for(const kind of ['screen_text','bubble'])assert.equal(canvas.split(`textToolCursor(textStyleOf(${kind==='bubble'?'bubble':'screenText'},'${kind}'))`).length-1,2,'panel and page text have their own cursor');
 assert.match(app,/<MangaCanvas textSettingsOwner=\{false\} textToolStyle=\{textToolStyle\}/);
 assert.match(css,/cursor:var\(--text-tool-cursor,vertical-text\) !important/);
 assert.match(canvas,/createPortal\([\s\S]*CanvasTextToolbar[\s\S]*textToolbarHost/);
 assert.doesNotMatch(editor,/id="paint-text-settings-slot"/);
 const textTools=readFileSync(new URL('../src/components/PaintTextTools.tsx',import.meta.url),'utf8');
 assert.match(textTools,/<div id="paint-text-settings-slot" class="paint-text-settings-slot"\/>/);
 assert.match(app,/openRequest=\{textPaletteRequest\}/);
 assert.match(css,/\.paint-text-settings-slot:empty \{ display:none; \}/);
 assert.match(css,/\.canvas-text-toolbar \{[^}]*display:grid;[^}]*width:100%/);
 assert.match(css,/\.canvas-text-toolbar \.canvas-text-font \.font-family-trigger \{[^}]*width:100%;[^}]*max-width:none;[^}]*min-width:0/);
});

test('paint cursor lives in drawing settings and the fill tool uses a recognisable upright bucket',()=>{
 const editor=readFileSync(new URL('../src/components/PaintEditor.tsx',import.meta.url),'utf8');
 const settings=readFileSync(new URL('../src/components/EnvironmentSettings.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(editor,/paint-cursor-choice|ラスターのカーソル/);
 assert.match(settings,/Field label="ペンカーソル"/);
 assert.match(settings,/aria-label="ペンカーソル"/);
 assert.match(editor,/function UprightPaintBucketIcon/);
 assert.match(editor,/<UprightPaintBucketIcon\/>/);
});


test('text visibility survives saved YAML and leaves hidden text out of editing and coverage',()=>{
 for(const overlay of [false,true]){
  const doc=fixture(),target=overlay?addCanvasTextAt(doc,0,null,{x:5,y:5},{}):addCanvasTextAt(doc,0,0,{x:20,y:30},{});
  editCanvasText(doc,target,'表示を切り替える文字');const before=structuredClone(canvasTextAt(doc,target));
  assert.equal(toggleCanvasTextVisibility(doc,target),true);assert.equal(canvasTextEditable(doc,target),false);assert.equal(canvasTextEditable(doc,target,'agent'),false);
  assert.equal(editCanvasText(doc,target,'書き換え'),false);
  const saved=parseMangaYaml(toStoredMangaYaml(doc));assert.equal(canvasTextAt(saved,target).hidden,true);assert.equal(canvasTextAt(saved,target).text,before.text);
  assert.equal(toggleCanvasTextVisibility(saved,target),true);assert.equal(canvasTextEditable(saved,target),true);assert.equal(canvasTextAt(saved,target).text,before.text);
  toggleCanvasTextVisibility(doc,target);assert.equal(canvasTextAt(doc,target).hidden,false);
 }
});

test('実Appの入力待ちスタイルは部分書式・別の文字設定を経ても保持し、入力だけに反映する',()=>{
 const documentRef={current:fixture()},target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false};
 const item=canvasTextAt(documentRef.current,target);item.text='ABC';item.text_style={fontWeight:400};
 let style={fontSize:12,orientation:'vertical'},updates=0;
 const context={localFontCatalog:{current:[]},availableFontWeights,updateTextStyle,textStyleOf,typingTextStyle,setTextToolStyle:fn=>{style=fn(style);context.textToolStyle=style;},documentRef,textToolStyle:style,paintSessionRef:{current:null},projectOperation:{current:false},qwenGeneration:null,editCanvasTextStyle,canvasTextAt,cloneDocument:structuredClone,editCanvasText,imageGesture:{current:{}},lastHistoryPush:{current:0},setDocument:next=>{updates++;documentRef.current=next;},setToast:message=>assert.fail(message)};
 context.changeTextToolStyle=appHandler('changeTextToolStyle',context);
 const patch=appHandler('changeCanvasTextStyle',context),type=appHandler('changeCanvasText',context);
 const before=JSON.stringify(documentRef.current);
 context.changeTextToolStyle({italic:true,underline:true});assert.equal(updates,0);assert.equal(JSON.stringify(documentRef.current),before);
 patch(target,{strikethrough:true},{start:0,end:1});
 patch(target,{fontSize:22});
 assert.equal(style.italic,true);assert.equal(style.underline,true);assert.equal(style.strikethrough,true);assert.equal(style.fontSize,22);
 type(target,'ABC新',{start:3,end:3});
 const next=canvasTextAt(documentRef.current,target);
 assert.equal(next.text,'ABC新');assert.deepEqual(next.text_runs,[{start:0,end:1,strikethrough:true},{start:3,end:4,italic:true,underline:true,strikethrough:true}]);
 context.changeTextToolStyle({italic:false,underline:false,strikethrough:false});
 type(target,'ABC新平',{start:4,end:4});
 assert.deepEqual(canvasTextAt(documentRef.current,target).text_runs.at(-1),{start:4,end:5,italic:false,underline:false,strikethrough:false});
});

test('実キャンバスは選択のないスタイル操作を本文編集・履歴へ送らない',()=>{
 const source=readFileSync(new URL('../src/components/MangaCanvas.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('MangaCanvas.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let body;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='changeStyle')body=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(body);
 const calls=[],context={toolbarTarget:{kind:'bubble'},toolbarItem:{text:'ABC'},textTarget:{kind:'bubble'},textSelection:{start:1,end:1},onTextToolStyle:patch=>calls.push(['typing',{...patch}]),onTextStyle:(target,patch,selection)=>calls.push(['document',{...patch},{...selection}])};
 const change=runInNewContext(ts.transpileModule(`(${body})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 change({italic:true},'selection-or-typing');assert.deepEqual(calls,[['typing',{italic:true}]]);
 context.textSelection={start:1,end:2};change({italic:true},'selection-or-typing');assert.deepEqual(calls.at(-1),['document',{italic:true},{start:1,end:2}]);
 context.textTarget=null;change({underline:true},'selection-or-typing');assert.deepEqual(calls.at(-1),['typing',{underline:true}]);
 context.textTarget={kind:'bubble'};change({textAlign:'right'});assert.deepEqual(calls.at(-1),['document',{textAlign:'right'},{...context.textSelection}]);
 context.toolbarTarget=null;context.toolbarItem=null;change({textAlign:'center'});assert.deepEqual(calls.at(-1),['typing',{textAlign:'center'}]);
});

// 見込み: 既存の点文字変換を再利用すれば生成の取消しで本文を変えず、追加時だけ同じ書式/中心の文字folderへまとめられる。
// 合格: previewは原本不変、移した本文/runs/style/bbox/layerId/lock/中心を保持し、再呼出しは同値。範囲: 変換本体、追加とUndoは実Appで検証。
test('point-text materialization preserves the native text and stable anchor identity',()=>{
 for(const overlay of [false,true]){
  const doc=fixture(),page=doc.manga.pages[0];if(overlay)page.page_overlay={frame:false,layer:'above_panel_frames',bubbles:[]};
  const owner=overlay?page.page_overlay:page.panels[0],screen={text:'写植\n二行',layerId:'stable-text',orientation:'horizontal',bbox:{x:20,y:30,w:40,h:25},locked:true,hidden:true,text_style:{font:'Test Serif',fontSize:16,fontWeight:700,lineHeight:1.2,orientation:'horizontal'},text_runs:[{start:0,end:2,fontWeight:800}]};
  owner.screen_text=[screen];const before=structuredClone(doc),preview=structuredClone(doc),target={pageIndex:0,panelIndex:0,index:0,overlay,kind:'screen_text'},position={x:.2,y:.3};
  const converted=ensureCanvasTextOwner(preview,target,position),text=canvasTextAt(preview,converted);
  assert.deepEqual(doc,before);for(const key of ['text','layerId','bbox','locked','hidden','text_runs','text_style'])assert.deepEqual(text[key],screen[key],key);
  assert.equal(text.shape,'typeset');assert.deepEqual(text.text_position,position);assert.equal(canvasTextAt(preview,target),undefined);
  assert.deepEqual(ensureCanvasTextOwner(preview,converted),converted);
 }
});
