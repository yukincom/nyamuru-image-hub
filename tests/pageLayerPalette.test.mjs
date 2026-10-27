import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'preact/jsx-runtime';

const paintLayerSource=readFileSync(new URL('../src/components/PaintLayerPalette.tsx',import.meta.url),'utf8');
const globalCss=readFileSync(new URL('../src/styles/global.css',import.meta.url),'utf8');
const pageLayerSource=readFileSync(new URL('../src/components/PageLayerPalette.tsx',import.meta.url),'utf8');
const appSource=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
const paintEditorSource=readFileSync(new URL('../src/components/PaintEditor.tsx',import.meta.url),'utf8');
const paintRendererSource=readFileSync(new URL('../src/lib/paintRenderer.ts',import.meta.url),'utf8');
const mangaCanvasSource=readFileSync(new URL('../src/components/MangaCanvas.tsx',import.meta.url),'utf8');
const selectionSource=readFileSync(new URL('../src/components/CanvasContentSelection.tsx',import.meta.url),'utf8');
const lockIconSource=readFileSync(new URL('../src/components/LayerLockIcon.tsx',import.meta.url),'utf8');
const headerSource=readFileSync(new URL('../src/components/Header.tsx',import.meta.url),'utf8');

test('palette displays original crops above the frame, then bubbles and lower art in reverse scene order',()=>{
 assert.match(paintLayerSource,/\[\.\.\.p\.scene\.owners\][\s\S]*?\.reverse\(\)\.map/);
 assert.match(paintLayerSource,/const frame=o\.kind!=='original'&&\(ownerIndex===0\|\|owners\[ownerIndex-1\]\.kind==='original'\)\?p\.frameLayer:null/);
 assert.match(paintLayerSource,/return <>\{frame\}<div class="layer-group"/);
 assert.match(pageLayerSource,/cloneElement\(paint\.layers[\s\S]*?\{frameLayer\}/);
 assert.match(pageLayerSource,/<InactiveLayers panel=\{panel\}[^>]*frameLayer=\{frameLayer\}/);
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
 assert.match(pageLayerSource,/paint\?\(controls\?\?<SelectionControls disabled\/>\):textControls\?\?bubbleControls\?\?panelControls/);
 assert.match(pageLayerSource,/function SelectionControls/);
 const fixedTools=['フォルダー追加','ラスターレイヤー追加','ベクターレイヤー追加','トーンレイヤー作成','生成マスク化','複製'];
 const controlsSource=pageLayerSource.slice(pageLayerSource.indexOf('function SelectionControls'),pageLayerSource.indexOf('const emptyLayer'));
 for(let index=1;index<fixedTools.length;index++)assert.ok(controlsSource.indexOf(fixedTools[index-1])<controlsSource.indexOf(fixedTools[index]));
 assert.match(pageLayerSource,/label="トーンレイヤー作成"[^>]*disabled/);
 assert.match(globalCss,/\.paint-dock \.paint-help-button\[aria-disabled=true\] \{ opacity:\.35; filter:grayscale\(1\); cursor:not-allowed; \}/);
 assert.match(pageLayerSource,/onDeleteBubble:\(panel:number,bubble:number,overlay\?:boolean\)=>void/);
 assert.match(pageLayerSource,/removeLabel=\{`吹き出し \$\{bubbleTarget\.index\+1\}を削除`\}/);
 assert.match(pageLayerSource,/\?`\$\{title\}全体の固定を解除`:`\$\{title\}全体を固定`/);
 assert.match(pageLayerSource,/\?`\$\{title\}の枠だけの固定を解除`:`\$\{title\}の枠だけを固定`/);
 assert.match(pageLayerSource,/removeLabel=\{selected\?`\$\{panelDisplayLabel\(selected\.id\)\}を削除`:'削除'\}/);
 assert.match(pageLayerSource,/p\.onAdd\(p\.activePanel,'raster'\)/);
 assert.match(pageLayerSource,/p\.onAdd\(p\.activePanel,'vector'\)/);
 assert.match(pageLayerSource,/>コマ外</);
 assert.match(pageLayerSource,/addFolder=\{panelEditable\?\(\)=>p\.onAddFolder\(p\.activePanel\):undefined\}/);
 assert.match(pageLayerSource,/aria-label="コマ外へフォルダーを追加"/);
 assert.match(pageLayerSource,/p\.onAdd\(p\.activePanel,'raster',true\)/);
 assert.match(pageLayerSource,/p\.onAdd\(p\.activePanel,'vector',true\)/);
 assert.match(pageLayerSource,/paintScene\(panel,p\.dpi,p\.assets,p\.colorMode,overlay\?'page':'panel'\)/);
 assert.match(appSource,/onAdd=\{\(index,kind,overlay=false\)=>\{try\{const scene=makePaintScene\(documentRef\.current,index,activePage,overlay\);actOnLayer\(index,\{type:'add',key:overlay\?'page':'panel',kind\},scene,overlay\);/);
 assert.match(appSource,/paintScene\(source,setup\.dpi,current\.manga\.image_assets\?\?\[\],paintColorMode\(setup\.format\),overlay\?'page':'panel'\)/);
 assert.match(paintEditorSource,/if\(action\.type==='add'\)\{/);
 assert.match(paintEditorSource,/disabled=\{!requested\|\|busy\|\|suspended\}/);
 assert.equal((pageLayerSource.match(/class="palette-icon"/g)??[]).length>=4,true);
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
 assert.match(pageLayerSource,/loadPaintImagesBestEffort\(result\.scene\.owners\.map\(o=>o\.paint\),p\.assets\)/);
 assert.match(paintRendererSource,/export async function loadPaintImagesBestEffort/);
 assert.match(paintEditorSource,/if\(layer\.guide&&layer\.image\)[\s\S]*?loadPaintImages\(\[\{\.\.\.owner\.paint,layers:\[layer\]\}\],assets,pending\)[\s\S]*?catch\{repair=true;repairedImage=true;\}/);
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
 assert.match(paintEditorSource,/const remaining=owner\.paint\.layers\.filter\(l=>l\.id!==layer\.id\);changeLayers\(remaining\)/);
 assert.doesNotMatch(paintEditorSource,/owner\.paint\.layers\.length===1\?\[newPaintLayer/);
 assert.match(paintEditorSource,/if\(!owner\.paint\.layers\.length&&!owner\.paint\.folders\?\.length\)\{result\.owners\.push\(\{owner,blob:new Blob\(\),remove:true\}\);continue;\}/);
 assert.match(paintLayerSource,/レイヤーはありません。必要なときだけラスターレイヤーかベクターレイヤーを追加してください。/);
 assert.match(appSource,/if\(remove\)\{clearOwnerPaint\(target,owner\);continue;\}/);
});

function fixture(){
 let cursor=0;const slots=[],effects=[],requests=[],exports={};
 const hooks={useMemo:(make,deps)=>{const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i].deps[j]))slots[i]={deps,value:make()};return slots[i].value},
  useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=value]},
  useEffect:(run,deps)=>{const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i].deps[j])){const before=slots[i];slots[i]={deps};effects.push(()=>{before?.cleanup?.();slots[i].cleanup=run()})}}};
 const modules={'preact':{cloneElement:(element,props)=>({...element,props:{...element.props,...props}})},'preact/hooks':hooks,'preact/jsx-runtime':jsxRuntime,'lucide-preact':{},'../lib/canvasGeometry':{},'../lib/paintDocument':{paintScene:(panel,_dpi,_assets,_color,scope)=>({owners:[{key:scope??'figure-0',kind:scope??'figure',paint:{layers:[{id:panel.id}]}}]})},
  '../lib/paintRenderer':{loadPaintImagesBestEffort:()=>new Promise(resolve=>requests.push(resolve))},'../lib/panelLayers':{panelVisible:()=>true,panelLocked:()=>false,panelFrameLocked:()=>false,panelFrameVisible:()=>true},'../lib/paintWorkspace':{},'../lib/pageCanvas':{},'../lib/displayLabels':{},
  '../lib/paintLock':{artworkLocked:()=>false},
  './PaintLayerPalette':{__esModule:true,default:'Palette'},'./LayerVisibilityButton':{__esModule:true,default:'Visibility'},'./LayerLockIcon':{__esModule:true,default:'Lock'},'./PaintToolHelp':{PaintToolButton:'Tool'}};
 const source=readFileSync(new URL('../src/components/PageLayerPalette.tsx',import.meta.url),'utf8').replace('function InactiveLayers(','export function InactiveLayers(');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'preact'}}).outputText,{exports,require:name=>{assert.ok(name in modules,name);return modules[name]}});
 return {requests,render(panel,assets){cursor=0;const tree=exports.InactiveLayers({panel,index:0,p:{dpi:100,assets}});return tree.props.images},
  flush(){while(effects.length)effects.shift()()},dispose(){for(const slot of slots)slot?.cleanup?.()}};
}
test('empty direct groups stay out of the tree until the user adds artwork',()=>{
 const direct=pageLayerSource.indexOf('page-direct-layer-group'),panels=pageLayerSource.indexOf('p.page.panels.map');
 assert.ok(direct>0&&direct<panels);
 assert.match(pageLayerSource,/images:p\.page\.images\?\.filter\(image=>image\.paintScope==='page'\|\|image\.bubbleOriginal\)/);
 assert.match(pageLayerSource,/const hasPageDirect=Boolean\(p\.page\.page_overlay\?\.bubbles\?\.length\|\|p\.page\.page_overlay\?\.screen_text\?\.length\|\|p\.page\.images\?\.some\(image=>image\.paintScope==='page'\|\|image\.bubbleOriginal\)\|\|activePageOwner\?\.paint\.layers\.length\|\|activePageOwner\?\.paint\.folders\?\.length\)/);
 assert.match(pageLayerSource,/\{hasPageDirect&&<div class="panel-layer-group page-direct-layer-group">/);
 assert.match(pageLayerSource,/const pageDirectAdd=!hasPageDirect&&<div class="page-direct-create-actions"/);
 assert.match(paintLayerSource,/filter\(o=>\(o\.kind!=='panel'&&o\.kind!=='page'\)\|\|o\.paint\.layers\.length>0\|\|o\.paint\.folders\?\.length\)/);
 assert.match(pageLayerSource,/const scene=result\.scene,owner=scene\.owners\.find\(item=>item\.kind===\(overlay\?'page':'panel'\)\)\?\?scene\.owners\[0\]/);
});

test('layer folders are explicit and drag targets distinguish inside from outside placement',()=>{
 assert.match(paintLayerSource,/icon\('フォルダー追加',p\.addFolder,FolderPlus/);
 assert.match(paintLayerSource,/data-layer-drop="folder"/);
 assert.match(paintLayerSource,/placement=ratio<\.25\?'above':ratio>\.75\?'below':'inside'/);
 assert.match(paintLayerSource,/p\.moveLayer\(d\.key,d\.id,d\.drop\)/);
 assert.match(paintLayerSource,/if\(o\.kind==='panel'\|\|o\.kind==='page'\|\|o\.kind==='original'\)return/);
 assert.match(paintLayerSource,/data-original-raster=/);
 assert.match(paintEditorSource,/requested&&key==='f'/);
 assert.match(appSource,/key==='f'[\s\S]{0,180}?addDirectFolder/);
 assert.match(globalCss,/\.layer-user-folder\.drop-inside>/);
});

test('representative locks live at row right and inherited locks disable descendant toggles',()=>{
 assert.match(paintLayerSource,/class=\{`palette-icon layer-row-lock/);
 assert.match(paintLayerSource,/inherited=\{o\.inheritedLocked===true\}/);
 assert.match(paintLayerSource,/inherited=\{paintOwnerLocked\(o\)\}/);
 assert.match(paintLayerSource,/lockOwner:\(key:string,locked:boolean\)=>void/);
 assert.match(pageLayerSource,/disabled=\{p\.disabled\|\|panelLocked\(panel\)\}/);
 assert.match(globalCss,/\.paint-dock \.layer-row-lock\.is-inherited \{[^}]*opacity:\.28;[^}]*filter:grayscale\(1\);/);
 assert.match(globalCss,/\.paint-dock \.layer-row-lock\.is-unlocked \{ opacity:0; \}/);
 assert.match(lockIconSource,/data-layer-lock-icon="open"[\s\S]*stroke="#000"[\s\S]*stroke-width="1\.25"[\s\S]*x="3\.625" y="10\.625" width="16\.75" height="11\.75"[\s\S]*fill="#fff"/);
 assert.match(appSource,/if\(panelLocked\(panel\)\)unlockPanelDescendants\(panel\);else panel\.layer\.locked=true/);
 assert.match(appSource,/selectedPanels\.some\(index=>page\?\.panels\[index\]&&panelGeometryLocked\(page\.panels\[index\]\)\)/);
 assert.match(appSource,/if\(panelGeometryLocked\(panel\)\)\{setToast\('固定中のコマは分割できません'\)/);
});
test('vector kind icon shares the name line so layer rows stay compact',()=>{
 assert.match(paintLayerSource,/class="layer-name-line">\{l\.kind==='vector'&&<PenTool size=\{12\}\/?>\}<span>\{l\.name\}<\/span>/);
 assert.match(globalCss,/\.layer-row \{[^}]*min-height:46px;/);
 assert.match(globalCss,/\.layer-row \.layer-thumbnail \{ height:36px; \}/);
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
