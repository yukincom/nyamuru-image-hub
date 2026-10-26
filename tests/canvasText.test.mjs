import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup.ts';
import { toStoredMangaYaml, parseMangaYaml } from '../src/lib/manga.ts';
import { addCanvasText, addCanvasTextAt, bubbleTextMinimumSize, canvasTextAt, canvasTextEditable, convertScreenTextToBubble, editCanvasText, editCanvasTextStyle, fitCanvasBubbleToText, fitCanvasScreenTextToText, removeCanvasText, screenTextCoveredByBubble } from '../src/lib/canvasText.ts';
function fixture(){const d=createEmptyWorkspaceDocument();d.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:10,y:20,w:90,h:120},bg:0,bubbles:[{text:'生成済み',shape:'normal',speaker:'A',analogTextImport:{assetId:'original',sourceRegionId:'ocr'}}]}];return d;}
test('new panel and page text inherit the chosen style instead of returning to 12pt',()=>{
 const d=fixture(),style={fontSize:29,orientation:'horizontal',font:'BIZ UDP明朝',fontWeight:700};
 const targets=[addCanvasTextAt(d,0,0,{x:40,y:70},style),addCanvasTextAt(d,0,null,{x:10,y:10},style),addCanvasText(d,0,0,'screen_text',style)];
 targets.forEach((target,index)=>{assert.ok(target);const item=canvasTextAt(d,target);assert.equal(item.text_style.fontSize,29);assert.equal(item.orientation,'horizontal');assert.equal(item.text_style.font,style.font);assert.equal(item.text_style.fontWeight,700);editCanvasText(d,target,`文字${index}`);});
 const restored=parseMangaYaml(toStoredMangaYaml(d));
 targets.forEach(target=>assert.equal(canvasTextAt(restored,target).text_style.fontSize,29));
});

const appSource=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
const appAst=ts.createSourceFile('App.tsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function appHandler(name,context){
 let body;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(appAst)===name)body=node.initializer?.getText(appAst);if(ts.isFunctionDeclaration(node)&&node.name?.text===name)body=node.getText(appAst);ts.forEachChild(node,visit);}visit(appAst);assert.ok(body,name);
 return runInNewContext(ts.transpileModule(`(${body})`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,context);
}
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
test('click-created text uses the canonical selection transition when moving to another panel',()=>{
 const documentRef={current:fixture()};documentRef.current.manga.pages[0].panels.push({id:2,shape:{type:'rect',x:10,y:150,w:90,h:100},bg:0,bubbles:[]});
 const createdText={current:null},pendingCanvasElementSelection={current:null};let selection,editing;
 const select=appHandler('selectCanvasElement',{activePage:0,activePanel:0,pendingCanvasElementSelection,setCanvasSelectionScrollRequest:()=>{},setActivePage:()=>{},setActivePanel:()=>{},setSelectedPanels:()=>{},setSelectedElement:value=>selection=value});
 appHandler('createScreenTextAt',{paintSessionRef:{current:null},projectOperation:{current:false},qwenGeneration:null,endTextEdit:()=>{},documentRef,cloneDocument:structuredClone,addCanvasTextAt,textToolStyle:{fontSize:31,orientation:'horizontal'},imageGestureBoundary:()=>{},lastHistoryPush:{current:0},setDocument:next=>documentRef.current=next,createdText,setTextTool:()=>{},setZoomTool:()=>{},setBubblePathTool:()=>{},setPaintToolsCollapsed:()=>{},setSelectedPanels:()=>{},selectCanvasElement:select,setEditingText:value=>editing=value})(0,1,{x:40,y:180});
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
 const d=fixture();
 const panel=addCanvasTextAt(d,0,0,{x:40,y:70}),overlay=addCanvasTextAt(d,0,null,{x:205,y:292});
 assert.ok(panel&&overlay);
 assert.equal(panel.overlay,false);assert.equal(overlay.overlay,true);
 const panelItem=canvasTextAt(d,panel),initial=structuredClone(panelItem.bbox);
 assert.ok(Math.abs(panelItem.bbox.x+panelItem.bbox.w-40)<1e-9);assert.equal(panelItem.bbox.y,70);
 editCanvasText(d,panel,'右\n左');
 assert.ok(Math.abs(panelItem.bbox.x+panelItem.bbox.w-40)<1e-9);assert.equal(panelItem.bbox.y,70);assert.ok(panelItem.bbox.w>initial.w);
 const verticalStart={x:panelItem.bbox.x+panelItem.bbox.w,y:panelItem.bbox.y};
 editCanvasTextStyle(d,panel,{orientation:'horizontal'});
 assert.equal(panelItem.bbox.x,verticalStart.x);assert.equal(panelItem.bbox.y,verticalStart.y);
 editCanvasText(d,panel,'上');const oneLineHeight=panelItem.bbox.h;editCanvasText(d,panel,'上\n下');
 assert.equal(panelItem.bbox.x,verticalStart.x);assert.equal(panelItem.bbox.y,verticalStart.y);assert.ok(panelItem.bbox.h>oneLineHeight);
 const beforeSize=structuredClone(panelItem.bbox);editCanvasTextStyle(d,panel,{fontSize:24});
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
 const item=canvasTextAt(d,screen);item.text_style={font:'BIZ UDP明朝',fontSize:15,fontWeight:700};item.text_weights=[{start:0,end:2,fontWeight:900}];
 const center={x:item.bbox.x+item.bbox.w/2,y:item.bbox.y+item.bbox.h/2};
 const bubble=convertScreenTextToBubble(d,{screenText:screen,materialId:'nomal_01'});
 assert.ok(bubble);assert.equal(d.manga.pages[0].panels[0].screen_text,undefined);
 const converted=canvasTextAt(d,bubble);assert.equal(converted.text,'中央\n文字');
 assert.deepEqual(converted.text_style,{font:'BIZ UDP明朝',fontSize:15,fontWeight:700,orientation:'vertical'});
 assert.deepEqual(converted.text_weights,[{start:0,end:2,fontWeight:900}]);
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
 const d=fixture(),target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false},bubble=canvasTextAt(d,target);
 bubble.bbox={x:31,y:42,w:27,h:38};bubble.text_position={x:.72,y:.28};bubble.text_weights=[{start:0,end:2,fontWeight:700}];
 const geometry=structuredClone({bbox:bubble.bbox,text_position:bubble.text_position});
 assert.equal(editCanvasTextStyle(d,target,{font:'BIZ UDP明朝'}),true);assert.deepEqual({bbox:bubble.bbox,text_position:bubble.text_position},geometry);
 assert.equal(editCanvasTextStyle(d,target,{fontWeight:900},{start:1,end:3}),true);assert.deepEqual({bbox:bubble.bbox,text_position:bubble.text_position},geometry);
 assert.equal(editCanvasTextStyle(d,target,{fontSize:38}),true);assert.deepEqual({bbox:bubble.bbox,text_position:bubble.text_position},geometry);
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
 assert.match(app,/if\(kind==='screen_text'\)createdText\.current=target/);
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
 assert.match(canvas,/textSettingsOwner&&textTool&&!painting&&textToolbarHost/);
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
 assert.match(textTools,/if\(active\|\|selectionVisible\)/);
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
