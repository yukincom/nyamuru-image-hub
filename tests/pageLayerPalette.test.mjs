import {readGlobalStyles} from './helpers/globalStyles.mjs';
import {paintEditorSource as readPaintEditorSource} from './editorModuleSources.mjs';
import {mangaCanvasSource as readMangaCanvasSource} from './editorModuleSources.mjs';
import { workspaceSources } from './helpers/workspaceSources.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'preact/jsx-runtime';
import { canvasPaintOwnerKey } from '../src/lib/paintDocument.ts';
import * as paintDocument from '../src/lib/paintDocument.ts';
import {resolvePaintLayerDrop} from '../src/lib/paintLayerDrop.ts';
import {canvasTextEditable,canvasTextAt,editCanvasText} from '../src/lib/canvasText.ts';

test('canvas selections resolve only their existing paint owner and never default to background',()=>{
 const panel={figures:[{}],bubbles:[{}],images:[{id:'normal'},{id:'crop-a-b',bubbleOriginal:{}},{id:'direct',paintScope:'panel'}]};
 const page={panels:[panel,{figures:[{},{}],bubbles:[]}],images:[{id:'page-crop',bubbleOriginal:{}},{id:'page-image'}],page_overlay:{figures:[{}],bubbles:[{}]}};
 const before=structuredClone(page),key=(selection,index=0)=>canvasPaintOwnerKey(page,index,selection);
 assert.equal(key({type:'figure',index:0}),'figure-0');
 assert.equal(key({type:'figure',index:1,scope:'panel'},1),'figure-1');
 assert.equal(key({type:'bubble',index:0,scope:'panel'}),'bubble-0');
 assert.equal(key({type:'figure',index:0,scope:'page_overlay'},99),'figure-0');
 assert.equal(key({type:'bubble',index:0,scope:'page_overlay'}),'bubble-0');
 assert.equal(key({type:'image',index:1}),'original-crop-a-b');
 assert.equal(key({type:'image',index:0,scope:'page'},99),'original-page-crop');
 for(const selection of [null,{type:'screen_text',index:0},{type:'image',index:0},{type:'image',index:2},{type:'image',index:1,scope:'page'},{type:'image',index:0,scope:'page_overlay'},{type:'figure',index:0,scope:'page'},{type:'figure',index:-1},{type:'bubble',index:9}])assert.equal(key(selection),undefined);
 assert.equal(key({type:'figure',index:0},99),undefined);
 assert.deepEqual(page,before);
});

const paintLayerSource=readFileSync(new URL('../src/components/PaintLayerPalette.tsx',import.meta.url),'utf8');
const globalCss=readGlobalStyles();
const pageLayerSource=readFileSync(new URL('../src/components/PageLayerPalette.tsx',import.meta.url),'utf8');
const appSource=workspaceSources('workspacePaintGuard', 'workspacePanelSelection', 'workspaceLifecycle', 'workspacePaintSession', 'pageEditActions', 'workspacePaintResults', 'workspaceTextActions', 'layerPaletteActions', 'workspaceVoiceActions');
const paintEditorSource=readPaintEditorSource();
const paintRendererSource=readFileSync(new URL('../src/lib/paintRenderer.ts',import.meta.url),'utf8');
const mangaCanvasSource=readMangaCanvasSource();
const selectionSource=readFileSync(new URL('../src/components/CanvasContentSelection.tsx',import.meta.url),'utf8');
const lockIconSource=readFileSync(new URL('../src/components/LayerLockIcon.tsx',import.meta.url),'utf8');
const headerSource=readFileSync(new URL('../src/components/Header.tsx',import.meta.url),'utf8');

test('voice edits keep manual locks while accepting shape and text commands',async()=>{
 const source=appSource.slice(appSource.indexOf('  async function applyVoiceCommand('),appSource.indexOf('  return { applyVoiceCommand,', appSource.indexOf('  async function applyVoiceCommand(')));
 for(const overlay of [false,true])for(const lock of ['folder','native','panel']){
  if(overlay&&lock==='panel')continue;
  const bubble={text:'原文',shape:'normal',bbox:{x:5,y:5,w:30,h:30}},panel={shape:{type:'rect',x:0,y:0,w:100,h:100},bubbles:[bubble]},page={canvas:{w:100,h:100},panels:[panel],...(overlay?{page_overlay:{bubbles:[bubble]}}:{})};
  if(lock==='folder')bubble.locked=true;
  if(lock==='native')bubble.nativeLocked=true;
  if(lock==='panel')panel.layer={locked:true};
  const document={manga:{pages:[page]}},before=structuredClone(document);let mutations=0;
  const apply=runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022})+';applyVoiceCommand',{
   hasDocument:true,showNewDialog:false,projectOperation:{current:false},layerSwitch:{current:false},imageImportBusy:false,qwenGeneration:null,
   paintController:{current:null},paintSessionRef:{current:null},selectedElement:{type:'bubble',index:0,scope:overlay?'page_overlay':'panel'},
   activePage:0,activePanel:0,documentRef:{current:document},canvasTextEditable,canvasTextAt,editCanvasText,
   mutate:action=>{mutations++;action(document);},
  });
  assert.equal(canvasTextEditable(document,{pageIndex:0,panelIndex:0,index:0,overlay,kind:'bubble'}),false);
  for(const command of [{op:'bubble_shape',shape:'caption'},{op:'bubble_text',text:'書き換え'}])assert.match(await apply(command),/変更しました/);
  assert.equal(mutations,2);assert.equal(bubble.text,'書き換え');assert.equal(bubble.shape,'caption');
  const previous=(overlay?before.manga.pages[0].page_overlay:before.manga.pages[0].panels[0]).bubbles[0];
  assert.equal(bubble.locked,previous.locked);assert.equal(bubble.nativeLocked,previous.nativeLocked);assert.deepEqual(panel.layer,before.manga.pages[0].panels[0].layer);
  assert.equal(editCanvasText(document,{pageIndex:0,panelIndex:0,index:0,overlay,kind:'bubble'},'手動の誤操作'),false);assert.equal(bubble.text,'書き換え');
 }
});

test('owner headings route to layout selection while child layers retain the existing paint entrance',async()=>{
 const selected=[],painted=[],page={panels:[{figures:[{}],bubbles:[{}],images:[{id:'crop-a-b',bubbleOriginal:{}}]}],images:[{id:'page-crop',bubbleOriginal:{}}],page_overlay:{figures:[{}],bubbles:[{}]}};
 let pending=Promise.resolve();
 const source=appSource.slice(appSource.indexOf('  function actOnLayer('),appSource.indexOf('  function addDirectFolder('));
 const act=runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022})+';actOnLayer',{
  activePage:0,documentRef:{current:{manga:{pages:[page]}}},paintSessionRef:{current:null},pendingLayerAction:{current:null},
  paintOwnerCanvasSelection:paintDocument.paintOwnerCanvasSelection,
  selectLayerOwner:(key,index,pageIndex,overlay)=>selected.push({key,index,pageIndex,overlay}),
  layerTransition:action=>(pending=action()),setActivePanel:()=>{},setSelectedPanels:()=>{},setSelectedElement:()=>{},
  openPaint:key=>{painted.push(key);return true;},
 });
 for(const [key,overlay] of [['figure-0',false],['bubble-0',false],['original-crop-a-b',false],['figure-0',true],['bubble-0',true],['original-page-crop',true]]){
  act(0,{type:'select',key},{},overlay);await pending;
  assert.equal(painted.length,0,`${key}: heading must not start painting`);
 }
 assert.equal(selected.length,6);
 act(0,{type:'select',key:'figure-0',id:'child'},{});await pending;
 act(0,{type:'select',key:'background'},{});await pending;
 assert.deepEqual(painted,['figure-0','background']);
});

test('owner keys invert the shared canvas mapping without manufacturing missing selections',()=>{
 const page={panels:[{figures:[{}],bubbles:[{}],images:[{id:'ordinary'},{id:'crop-a-b',bubbleOriginal:{}}]}],images:[{id:'page-crop',bubbleOriginal:{}},{id:'ordinary'}],page_overlay:{figures:[{}],bubbles:[{}]}};
 const selection=(key,overlay=false)=>paintDocument.paintOwnerCanvasSelection(page,0,key,overlay);
 for(const [key,expected] of [['figure-0',{type:'figure',index:0}],['bubble-0',{type:'bubble',index:0}],['original-crop-a-b',{type:'image',index:1}]]){
  assert.deepEqual(selection(key),expected);assert.equal(canvasPaintOwnerKey(page,0,selection(key)),key);
 }
 assert.deepEqual(selection('figure-0',true),{type:'figure',index:0,scope:'page_overlay'});
 assert.deepEqual(selection('bubble-0',true),{type:'bubble',index:0,scope:'page_overlay'});
 assert.deepEqual(selection('original-page-crop',true),{type:'image',index:0,scope:'page'});
 for(const key of ['background','page','panel','figure-1','figure-0-extra','bubble--1','original-ordinary','original-page-crop'])assert.equal(selection(key),undefined,key);
 assert.equal(paintDocument.paintOwnerCanvasSelection(undefined,0,'figure-0'),undefined);
});

// 見込み: 通常ペンで⌘を押していない時、親見出しは配置へ渡し、子を選ぶと仕上げの複数選択を解除する。
// 合格: 子はowner/idとペン種を更新し、陰影を選んだ場合だけトーンを開く。抽出handlerを検証し、実DOMは別試験。
test('active paint headings leave through the same layout callback without changing the paint layer',()=>{
 const child={id:'child',kind:'raster',visible:true,locked:false};
 const calls=[],scene={owners:[{key:'figure-0',kind:'figure',index:0,paint:{layers:[child,{...child,id:'shade',tone:{enabled:true}}]}}]};
 const previousSelection={keys:['child','shade']};
 let finishSelection=previousSelection,effectsTab='color';
 const source=paintEditorSource.slice(paintEditorSource.indexOf('  function selectOwner('),paintEditorSource.indexOf('  function updateOwnerLayer('));
 const select=runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022})+';selectOwner',{
  tool:'pen',commandHeld:false,operation:{current:false},suspended:false,inputActive:{current:false},pendingContents:{current:null},scene,owner:scene.owners[0],
  onSelectOwner:key=>calls.push(['layout',key]),onSelectFigure:index=>calls.push(['figure',index]),
  clearVectorSelection:()=>{},setMaskTarget:()=>{},setOwnerKey:key=>calls.push(['paint',key]),setLayerId:id=>calls.push(['layer',id]),setSelection:()=>{},
  matchLayerPen:kind=>calls.push(['pen',kind]),
  setFinishSelection:value=>{finishSelection=value;},setEffectsTab:tab=>{effectsTab=tab;},
 });
 select('figure-0');assert.deepEqual(calls,[['layout','figure-0']]);calls.length=0;
 assert.equal(finishSelection,previousSelection);assert.equal(effectsTab,'color');
 select('figure-0','child');assert.deepEqual(calls,[['paint','figure-0'],['layer','child'],['pen','raster']]);
 assert.equal(finishSelection,null);assert.equal(effectsTab,'color');calls.length=0;
 select('figure-0','shade');assert.deepEqual(calls,[['paint','figure-0'],['layer','shade'],['pen','raster']]);
 assert.equal(effectsTab,'tone');
});

test('owner selection waits for paint close and retains the current mode on save failure',async()=>{
 const source=appSource.slice(appSource.indexOf('  function selectLayerOwner('),appSource.indexOf('  function toggleTextLayer('));
 for(const fail of [false,true]){
  const calls=[],resume={current:{ownerKey:'background'}},page={panels:[{figures:[{}]}]};let pending=Promise.resolve();
  const select=runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022})+';selectLayerOwner',{
   activePage:0,documentRef:{current:{manga:{pages:[page]}}},paintSessionRef:{current:{}},autoPaintResume:resume,
   paintController:{current:{close:async()=>{calls.push('close');if(fail)throw Error('save failure');}}},
   paintOwnerCanvasSelection:paintDocument.paintOwnerCanvasSelection,
   layerTransition:action=>(pending=action().catch(error=>calls.push(error.message))),
   endTextEdit:()=>calls.push('end'),setTextTool:()=>{},setZoomTool:()=>{},setBubblePathTool:()=>{},
   selectCanvasElement:(selection,panel,page)=>calls.push([selection.type,selection.index,panel,page]),
  });
  select('figure-0',0);await pending;
  assert.deepEqual(calls,fail?['close','save failure']:['close','end',['figure',0,0,0]]);
  assert.equal(resume.current===null,!fail);
 }
});

// 見込み: 一覧がsceneの順序だけを反転表示すれば、初期順と並べ替え後の文字順を保持できる。合格: 2通りのID順を厳密比較し入力不変。範囲: 一覧構築、実DOM操作はbrowser fixture。
test('palette preserves initial and edited scene order without sorting text numbers again',()=>{
 const owner=(kind,index,extra={})=>({key:`${kind}-${index}`,kind,index,paint:{layers:[]},...extra});
 const source=paintLayerSource.slice(paintLayerSource.indexOf('  const textDirectOwners='),paintLayerSource.indexOf('  const relations='));
 for(const textOrder of [[9,2,1,0],[1,0,9,2]]){
  const owners=[owner('background',0),owner('figure',0),owner('figure',1),owner('panel',0),
   ...textOrder.flatMap(index=>[owner('bubble',index),...(index===0?[owner('original',0,{parentKey:'bubble-0'})]:[])]),owner('original',1)];
  const before=structuredClone(owners);
  const result=runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022})+';displayOwners',{p:{scene:{owners}},paintStackTarget:paintDocument.paintStackTarget});
  assert.deepEqual(Array.from(result,o=>o.key),['original-1',...textOrder.toReversed().map(index=>`bubble-${index}`),'figure-1','figure-0','background-0']);
  assert.deepEqual(owners,before);
 }
 assert.match(paintLayerSource,/displayOwners\.map\(\(o,ownerIndex\)=>/);
 assert.ok(paintLayerSource.indexOf('{p.frameLayer}')<paintLayerSource.indexOf('{displayOwners.map'));
 assert.match(paintLayerSource,/return <>\{frame\}<div class="layer-group"/);
 assert.match(pageLayerSource,/cloneElement\(activeLayers,\{\.\.\.moves\(activeLayers\.props\.scene\),frameLayer,paletteScope,directPanel,nativeTextLayers,images:/);
 assert.match(pageLayerSource,/<PanelPaintLayers panel=\{panel\}.*?frameLayer=\{frameLayer\}/);
});

test('page image import and export stay in the header immediately before New',()=>{
 assert.doesNotMatch(paintLayerSource,/layer-image-actions|画像の入出力|画像書き出し形式/);
 assert.doesNotMatch(globalCss,/\.layer-image-actions/);
 assert.match(headerSource,/>画像読込<\/button>/);
 assert.match(headerSource,/>画像書出<\/button>/);
 assert.ok(headerSource.indexOf('画像読込')<headerSource.indexOf('画像書出'));
 assert.ok(headerSource.indexOf('画像書出')<headerSource.indexOf('>新規</button>'));
 assert.match(appSource,/onImportImage=\{\(\)=>\{void layerTransition/);
 assert.match(appSource,/choosePlacedImage\('page'\)/);
});

test('panel, page and bubble selections expose their own actions and direct drawing routes',()=>{
 assert.match(pageLayerSource,/paint&&!closedPanel\?palette\.controls:textControls\?\?ownerControls\?\?panelControls/);
 assert.match(pageLayerSource,/function SelectionControls/);
 const fixedTools=['フォルダー追加','ラスターレイヤー追加','ベクターレイヤー追加','トーンレイヤー作成','生成マスク化','複製'];
 const controlsSource=pageLayerSource.slice(pageLayerSource.indexOf('function SelectionControls'),pageLayerSource.indexOf('const emptyLayer'));
 for(let index=1;index<fixedTools.length;index++)assert.ok(controlsSource.indexOf(fixedTools[index-1])<controlsSource.indexOf(fixedTools[index]));
 assert.match(pageLayerSource,/label="トーンレイヤー作成"[^>]*disabled/);
 assert.match(globalCss,/\.paint-dock \.paint-help-button\[aria-disabled=true\] \{ opacity:\.35; filter:grayscale\(1\); cursor:not-allowed; \}/);
 assert.match(pageLayerSource,/onDeleteBubble:\(panel:number,bubble:number,overlay\?:boolean\)=>void/);
 assert.match(pageLayerSource,/removeLabel=\{bubbleTarget\?`\$\{textDisplayLabel\(bubbleTarget\.index\)\}を削除`:'削除'\}/);
 assert.match(pageLayerSource,/\?`\$\{title\}全体の固定を解除`:`\$\{title\}全体を固定`/);
 assert.match(pageLayerSource,/\?`\$\{title\}の枠だけの固定を解除`:`\$\{title\}の枠だけを固定`/);
 assert.match(pageLayerSource,/removeLabel=\{selected\?`\$\{panelDisplayLabel\(selected\.id\)\}を削除`:'削除'\}/);
 assert.match(pageLayerSource,/p\.onAdd\(p\.activePanel,'raster',addOutside,outsidePosition\)/);
 assert.match(pageLayerSource,/p\.onAdd\(p\.activePanel,'vector',addOutside,outsidePosition\)/);
 assert.doesNotMatch(pageLayerSource,/>コマ外<|page-direct-layer-group|page-direct-layer-actions/);
 assert.match(pageLayerSource,/addFolder=\{panelEditable\?\(\)=>p\.onAddFolder\(p\.activePanel,addOutside,outsidePosition\):undefined\}/);
 assert.match(pageLayerSource,/paintScene\(panel,p\.dpi,p\.assets,p\.colorMode,overlay\?'page':'panel',overlay\?p\.page\.panels:undefined\)/);
 assert.match(appSource,/onAdd=\{\(index,kind,overlay=false,position\)=>\{try\{const scene=makePaintScene\(documentRef\.current,index,activePage,overlay\);actOnLayer\(index,\{type:'add',key:overlay\?'page':'panel',kind,position:position\?\?\{\}\},scene,overlay\);/);
 assert.match(appSource,/paintScene\(source,setup\.dpi,current\.manga\.image_assets\?\?\[\],paintColorMode\(setup\.format\),overlay\?'page':'panel',overlay\?targetPage\.panels:undefined\)/);
 assert.match(paintEditorSource,/if\(action\.type==='add'\)\{/);
 assert.match(paintEditorSource,/disabled=\{!requested\|\|busy\|\|suspended\}/);
 assert.doesNotMatch(pageLayerSource,/コマ枠を固定すると、紙面上で動かなくなります/);
});

test('stored-image decode failures identify the source in Japanese without freezing image-independent layer controls',()=>{
 assert.match(paintRendererSource,/元画像「\$\{label\}」を画像としてデコードできません/);
 assert.match(paintRendererSource,/asset&&blob\.size!==asset\.byteLength/);
 assert.doesNotMatch(pageLayerSource,/setError\(String\(e\)\)/);
 assert.match(paintEditorSource,/\(images\|\|error\)&&loadedInitial\.current===initial/);
 assert.match(paintEditorSource,/const layerHeader=<PaintLayerControls \{\.\.\.layerProps\} disabled=\{!requested\|\|busy\|\|suspended\}/);
  assert.match(paintEditorSource,/images,disabled:busy\|\|suspended,/);
  assert.doesNotMatch(paintEditorSource,/function chooseImage\(replace=false,key=owner\.key\)\{[\s\S]{0,240}?if\(!images\|\|/);
  assert.match(paintEditorSource,/failedImageSignature\.current===recoveryImageSignature/);
  assert.match(paintEditorSource,/loadPaintImages\(scene\.owners\.map\(owner=>owner\.paint\),allAssets,pending\)/);
 assert.match(paintRendererSource,/const png=\[137,80,78,71,13,10,26,10\]/);
 assert.match(paintRendererSource,/image\.onload=\(\)=>resolve\(\)/);
 assert.doesNotMatch(paintRendererSource,/image\.decode\(\)/);
 assert.match(pageLayerSource,/loadPaintImagesBestEffort\(result\.scene\.owners\.map\(o=>o\.paint\),p\.assets,new Map\(\),reusable\)/);
 assert.match(paintRendererSource,/export async function loadPaintImagesBestEffort/);
 assert.match(paintEditorSource,/if\(layer\.guide&&layer\.image&&!resumeImages\?\.has\(layer\.image\.assetId\)\)[\s\S]*?loadPaintImages\(\[\{\.\.\.owner\.paint,layers:\[layer\]\}\],assets,pending\)[\s\S]*?catch\{repair=true;repairedImage=true;\}/);
 assert.match(paintEditorSource,/if\(prepared!==owner&&!repairedImage\)preparedGuides\.push/);
 assert.match(paintEditorSource,/prepareGuideLayer\(owner,\{\.\.\.layer,image:undefined\}\)/);
});

test('Delete routes the selected bubble or panel to the matching canonical delete action',()=>{
 assert.match(appSource,/selectedElement\?\.type==='bubble'[\s\S]{0,260}?deleteBubbleAt\(activePanel,selectedElement\.index,selectedElement\.scope==='page_overlay'\)/);
 assert.match(appSource,/else if\(!selectedElement&&document\.manga\.pages\[activePage\]\?\.panels\[activePanel\]\)[\s\S]{0,140}?deletePanelAt\(activePanel\)/);
 assert.match(appSource,/if\(!removeCanvasText\(next,target\)\)return/);
 assert.match(appSource,/onDeleteBubble=\{deleteBubbleAt\}/);
});

test('inspector interaction temporarily closes paint and canvas return restores the same owner',()=>{
 assert.match(appSource,/event\.target\.closest\('\[data-paint-canvas\]'\)/);
 assert.match(appSource,/autoPaintResume\.current=\{pageIndex:session\.pageIndex,panelIndex:session\.panelIndex,overlay:session\.overlay,ownerKey\}/);
 assert.match(appSource,/controller\.close\(\)[\s\S]{0,320}?setLayerSwitchBusy\(false\)/);
 assert.match(appSource,/openPaint\(pending\.ownerKey,pending\.panelIndex,pending\.pageIndex,pending\.overlay\)/);
 assert.match(mangaCanvasSource,/data-paint-canvas/);
});

test('the selected-art overlay keeps handles but cannot steal hits from visibly higher content',()=>{
 assert.match(mangaCanvasSource,/class="placed-image-selection" style=\{\{\.\.\.paperBoxStyle\(image\.bbox\),pointerEvents:'none'\}\}/);
 assert.match(mangaCanvasSource,/selected interactive=\{false\} handles=/);
 assert.match(selectionSource,/interactive=true/);
 assert.match(selectionSource,/\{interactive&&geometry\?\.path&&<svg class="canvas-content-hit"/);
});

test('the final paint layer can be removed completely and recreated only on demand',()=>{
 assert.match(paintEditorSource,/removePaintLayer\(owner\.paint,layer\.id\)/);
 assert.doesNotMatch(paintEditorSource,/owner\.paint\.layers\.length===1\?\[newPaintLayer/);
 assert.match(paintEditorSource,/if\(paintOwnerShouldClear\(owner\)\)\{result\.owners\.push\(\{owner,blob:new Blob\(\),remove:true\}\);continue;\}/);
 assert.match(appSource,/if\(remove\)\{clearOwnerPaint\(target,owner\);continue;\}/);
});

function fixture(){
 let cursor=0;const slots=[],effects=[],requests=[],exports={};
 const hooks={useRef:initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i]},useMemo:(make,deps)=>{const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i].deps[j]))slots[i]={deps,value:make()};return slots[i].value},
  useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=value]},
  useEffect:(run,deps)=>{const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i].deps[j])){const before=slots[i];slots[i]={deps};effects.push(()=>{before?.cleanup?.();slots[i].cleanup=run()})}}};
 hooks.useContext=context=>context;hooks.useLayoutEffect=hooks.useEffect;
 const modules={'preact':{createContext:value=>value,cloneElement:(element,props)=>({...element,props:{...element.props,...props}})},'preact/hooks':hooks,'preact/jsx-runtime':jsxRuntime,'lucide-preact':{},'../lib/canvasGeometry':{},'../lib/paintDocument':{paintAssetIds:paintDocument.paintAssetIds,paintScene:(panel,_dpi,_assets,_color,scope)=>({owners:[{key:scope??'figure-0',kind:scope??'figure',paint:{layers:[{id:panel.id,image:{assetId:String(panel.id)}}]}}]})},
  '../lib/paintRenderer':{loadPaintImagesBestEffort:()=>new Promise(resolve=>requests.push(resolve))},'../lib/panelLayers':{panelVisible:()=>true,panelLocked:()=>false,panelFrameLocked:()=>false,panelFrameVisible:()=>true},'../lib/paintWorkspace':{paintPaletteScope:()=> 'test'},'../lib/pageCanvas':{},'../lib/displayLabels':{},
  '../lib/paintLock':{artworkLocked:()=>false},
  './PaintLayerPalette':{__esModule:true,default:'Palette'},'./LayerVisibilityButton':{__esModule:true,default:'Visibility'},'./LayerLockIcon':{__esModule:true,default:'Lock'},'./PaintToolHelp':{PaintToolButton:'Tool'}};
 const source=readFileSync(new URL('../src/components/PageLayerPalette.tsx',import.meta.url),'utf8').replace('function PanelPaintLayers(','export function PanelPaintLayers(');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'preact'}}).outputText,{exports,require:name=>{assert.ok(name in modules,name);return modules[name]}});
 return {requests,render(panel,assets){cursor=0;const tree=exports.PanelPaintLayers({panel,index:0,p:{dpi:100,assets,page:{page:1,panels:[panel]}}});return tree.props.images},
  flush(){while(effects.length)effects.shift()()},dispose(){for(const slot of slots)slot?.cleanup?.()}};
}
test('empty direct groups stay out of the tree until the user adds artwork',()=>{
 const direct=pageLayerSource.indexOf('{renderPageLayers()}'),panels=pageLayerSource.indexOf('{p.page.panels.map');
 assert.ok(direct>0&&direct<panels);
 assert.match(pageLayerSource,/images:p\.page\.images\?\.filter\(image=>image\.paintScope==='page'\|\|image\.bubbleOriginal\)/);
 assert.match(pageLayerSource,/if\(!native&&!saved&&!live\)return null/);
 assert.match(pageLayerSource,/paintStackTarget\(stack,pageAnchors\)\?\.startsWith\('panel-'\)/);
 assert.match(pageLayerSource,/\{renderPageLayers\(panel\.id\)\}/);
 assert.doesNotMatch(pageLayerSource,/pageDirectAdd|page-direct-create-actions|>コマ外へ追加</);
 assert.match(paintLayerSource,/filter\(o=>\(o\.kind!=='panel'&&o\.kind!=='page'\)\|\|o\.paint\.layers\.length>0\|\|o\.paint\.folders\?\.length\)/);
 assert.match(pageLayerSource,/const scene=result\.scene,owner=scene\.owners\.find\(item=>item\.kind===\(overlay\?'page':'panel'\)\)\?\?scene\.owners\[0\]/);
});

test('layer folders are explicit and drag targets distinguish inside from outside placement',()=>{
 assert.match(paintLayerSource,/icon\('フォルダー追加',p\.addFolder,FolderPlus/);
 assert.match(paintLayerSource,/data-layer-drop="folder"/);
 assert.match(paintLayerSource,/p\.moveLayer\(d\.key,d\.id,target,destination\)/);
 assert.match(paintLayerSource,/if\(o\.kind==='panel'\|\|o\.kind==='page'\)return/);
 assert.match(paintLayerSource,/if\(o\.kind==='original'\)return/);
 assert.match(paintLayerSource,/data-original-raster=/);
 assert.match(paintEditorSource,/requested&&key==='f'/);
 assert.match(appSource,/key==='f'[\s\S]{0,180}?addDirectFolder/);
 assert.doesNotMatch(paintLayerSource,/layer-root-drop/);
 assert.match(globalCss,/--layer-drop-color:#df861f/);
});

// 見込み・合格: フォルダー行の25～75%は中、両端は外。ロック時は中だけを拒否し、移動先と挿入線は一致する。
// 範囲: 行の判定を直接検査する。実際のドラッグ・描画状態・保存はブラウザーの移動状態保持試験で確認する。
test('folder drop boundaries and locks agree with the insertion line',()=>{
 const location = {panelIndex: 1, overlay: false};
 const input = {
   source: {kind: 'layer', key: 'panel', id: 'source'}, sourceLocation: location,
   rowLocation: location, nestedLayer: false, scene: {owners: []},
 };
 for (const locked of [false, true]) {
   const row = {layerDrop: 'folder', folder: 'folder-id', owner: 'panel', layerDepth: '2', dropLocked: String(locked)};
   for (const [ratio, placement] of [[0.24,'above'],[0.25,'inside'],[0.26,'inside'],[0.74,'inside'],[0.75,'inside'],[0.76,'below']]) {
     const actual = resolvePaintLayerDrop({...input, row, ratio});
     const inside = placement === 'inside';
     const expected = inside && locked ? undefined : {
       target: {kind: 'folder', id: 'folder-id', placement},
       destination: {...location, key: 'panel'}, placement, outside: !inside, indent: inside ? 48 : 0,
     };
     assert.deepEqual(actual, expected, `ratio=${ratio}, locked=${locked}`);
   }
 }
});

test('representative locks live at row right and inherited locks disable descendant toggles',()=>{
 assert.match(paintLayerSource,/class=\{`palette-icon layer-row-lock/);
 assert.match(paintLayerSource,/inherited=\{o\.inheritedLocked===true\}/);
 assert.match(paintLayerSource,/inherited=\{inherited\}/);
 assert.match(paintLayerSource,/lockOwner:\(key:string,locked:boolean,group\?:boolean\)=>void/);
 assert.match(pageLayerSource,/disabled=\{p\.disabled\|\|panelLocked\(panel\)\}/);
 assert.match(globalCss,/\.paint-dock \.layer-row-lock\.is-inherited \{[^}]*opacity:\.28;[^}]*filter:grayscale\(1\);/);
 assert.match(globalCss,/\.paint-dock \.layer-row-lock\.is-unlocked \{ opacity:0; \}/);
 assert.match(lockIconSource,/data-layer-lock-icon="open"[\s\S]*stroke="#000"[\s\S]*stroke-width="1\.25"[\s\S]*x="3\.625" y="10\.625" width="16\.75" height="11\.75"[\s\S]*fill="#fff"/);
 assert.match(appSource,/if\(panelLocked\(panel\)\)unlockPanelDescendants\(panel\);else panel\.layer\.locked=true/);
 assert.match(appSource,/selectedPanels\.some\(index=>page\?\.panels\[index\]&&panelGeometryLocked\(page\.panels\[index\]\)\)/);
 assert.match(appSource,/if\(panelGeometryLocked\(panel\)\)\{setToast\('固定中のコマは分割できません'\)/);
});
test('vector and text icons use the same column as folders and raster previews',()=>{
 assert.match(paintLayerSource,/l\.kind==='vector'\?<span class="layer-kind-icon"><PenTool size=\{18\}\/?>/);
 assert.match(paintLayerSource,/class="layer-kind-icon"><Type size=\{18\}\/?>/);
 assert.match(globalCss,/\.layer-row \{[^}]*min-height:46px;/);
 assert.match(globalCss,/\.paint-dock \.layer-select>\.layer-thumbnail \{[^}]*width:32px; height:32px;/);
 assert.match(globalCss,/\.layer-kind-icon \{[^}]*flex:0 0 32px; width:32px;/);
});
test('new artwork and Undo cannot expose an older decoded map before effects load the current scene',async()=>{
 const f=fixture(),assets=[],original={id:1};assert.equal(f.render(original,assets),null);f.flush();
 const originalImages=new Map();f.requests.shift()(originalImages);await Promise.resolve();assert.equal(f.render(original,assets),originalImages);
 const inserted={id:2};assert.equal(f.render(inserted,assets),null,'old map must disappear before effects');f.flush();
 const insertedImages=new Map([['generated',{src:'blob:generated'}]]);f.requests.shift()(insertedImages);await Promise.resolve();assert.equal(f.render(inserted,assets),insertedImages);
 assert.equal(f.render(original,assets),null,'Undo must not reuse the generated map');f.flush();assert.equal(insertedImages.get('generated').src,'');f.dispose();
});
test('late image loading for an abandoned scene is disposed and cannot replace the current images',async()=>{
 const f=fixture(),assets=[],old={id:1},current={id:2};f.render(old,assets);f.flush();f.render(current,assets);f.flush();
 const stale=new Map([['stale',{src:'blob:stale'}]]);f.requests.shift()(stale);await Promise.resolve();assert.equal(stale.get('stale').src,'');assert.equal(f.render(current,assets),null);
 const fresh=new Map();f.requests.shift()(fresh);await Promise.resolve();assert.equal(f.render(current,assets),fresh);f.dispose();
});

test('visibility changes and fresh document wrappers reuse decoded image sources',async()=>{
 const f=fixture(),assets=[{id:'1',storageId:'first'}],panel={id:1};f.render(panel,assets);f.flush();
 const decoded=new Map([['1',{src:'blob:first'}]]);f.requests.shift()(decoded);await Promise.resolve();
 assert.equal(f.render({...panel,layer:{hidden:true}},structuredClone(assets)),decoded);f.flush();assert.equal(f.requests.length,0);assert.equal(decoded.get('1').src,'blob:first');
 assert.equal(f.render(panel,[{...assets[0],storageId:'repaired'}]),null);f.flush();assert.equal(f.requests.length,1);f.dispose();
});


test('native artwork remains visible until the matching painting session has decoded images',()=>{
 const source=mangaCanvasSource.slice(mangaCanvasSource.indexOf('  const paintReady='),mangaCanvasSource.indexOf('  const inner =',mangaCanvasSource.indexOf('  const paintReady=')));
 const evaluate=(images,overlay=false,pageNumber=1)=>runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022})+';[editingPanel(0),editingOverlay]',{paintWorkspace:{images,page:pageNumber,panelIndex:0,overlay},page:{page:1},paintTarget:{panelIndex:0,overlay}});
 assert.deepEqual([...evaluate(null)],[false,false]);assert.deepEqual([...evaluate(new Map())],[true,false]);
 assert.deepEqual([...evaluate(null,true)],[false,false]);assert.deepEqual([...evaluate(new Map(),true)],[false,true]);assert.deepEqual([...evaluate(new Map(),false,2)],[false,false]);
});


test('successful image recovery keeps its published map alive when the effect reruns',async()=>{
 const start=paintEditorSource.indexOf('  const recoveryImageSignature='),end=paintEditorSource.indexOf('  useEffect(()=>{\n    if(!dirty)',start),source=paintEditorSource.slice(start,end);
 for(const cancelled of [false,true]){
  const initial={},image={src:'blob:recovered'},map=new Map([['asset',image]]),imagesRef={current:null};let cleanup,resolve,published;
  runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022}),{scene:{owners:[]},initial,requested:true,images:null,assets:[],imports:[],loadedInitial:{current:initial},failedImageSignature:{current:'failed'},paintImageSignature:()=> 'recovered',useEffect:effect=>cleanup=effect(),loadPaintImages:()=>new Promise(done=>resolve=done),imagesRef,setImages:value=>published=value,setError:()=>{}});
  if(cancelled)cleanup();resolve(map);await Promise.resolve();
  if(cancelled){assert.equal(published,undefined);assert.equal(image.src,'');}
  else{assert.equal(published,map);cleanup();assert.equal(imagesRef.current,map);assert.equal(image.src,'blob:recovered');}
 }
});


test('frame row selection uses the existing selection state after paint successfully closes',async()=>{
 const source=appSource.slice(appSource.indexOf('  function selectLayerPanel('),appSource.indexOf('  function togglePanelLayer('));
 for(const frame of [false,true])for(const fail of [false,true]){
  const calls=[];let pending;
  const select=runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022})+';selectLayerPanel',{
   paintSessionRef:{current:{}},paintController:{current:{close:async()=>{calls.push('close');if(fail)throw Error('save failure');}}},
   autoPaintResume:{current:{}},endTextEdit:()=>calls.push('end'),setTextTool:()=>{},setZoomTool:()=>{},setBubblePathTool:()=>{},
   setSelectedPanels:value=>calls.push(['panels',...value]),selectCanvasElement:(value,index)=>calls.push([value?.type??null,index]),
   layerTransition:action=>(pending=action().catch(error=>calls.push(error.message))),
  });
  select(1,frame);await pending;
  assert.deepEqual(calls,fail?['close','save failure']:['close','end',['panels',1],[frame?'panel_frame':null,1]]);
 }
});
