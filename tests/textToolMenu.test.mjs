import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {availableFontWeights,matchingFontWeight} from '../src/lib/bubbleFonts.ts';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

// 見込み: 説明popupの削除後もTとふきだしタブは残る。合格: タブ・既存設定経路が存在しhelp属性はない。範囲: ソース契約、実操作はbrowser fixtureで確認。
test('T primary click and shortcut open a compact tabbed persistent settings window',()=>{
  const tools=read('src/components/PaintTextTools.tsx'),toolbar=read('src/components/CanvasTextToolbar.tsx'),app=read('src/components/App.tsx'),editor=read('src/components/PaintEditor.tsx'),canvasText=read('src/lib/canvasText.ts');
  assert.doesNotMatch(tools,/写植文字を追加|text-settings-icon-action/);
  assert.doesNotMatch(app,/function addText\(|add=\{addText\}/);
  assert.match(app,/addCanvasTextAt\(next,pageIndex,panelIndex,point,textToolStyle\)/);
  assert.doesNotMatch(tools,/add\('bubble'\)|吹き出しを追加/);
  assert.match(tools,/openRequest:TextPaletteRequest/);
  assert.match(app,/openRequest=\{textPaletteRequest\}/);
  assert.ok((app.match(/setTextPaletteRequest\(value=>\(\{id:value\.id\+1,tab:'(?:text|bubble)'\}\)\)/g)??[]).length>=3);
  assert.doesNotMatch(tools,/document\.addEventListener\('pointerdown',dismiss/);
  assert.match(tools,/class="text-settings-window-grab"[\s\S]*?onPointerDown=\{beginDrag\}/);
  assert.match(tools,/id="paint-text-settings-slot"/);
  assert.match(tools,/role="tablist"[\s\S]*?label="文字"[\s\S]*?label="ふきだし"/);
  assert.match(tools,/id="paint-bubble-materials-slot"/);
  assert.match(tools,/label="ふきだし"/);
  assert.doesNotMatch(tools,/\bhelp=|data-tool-help=/);
  assert.doesNotMatch(toolbar,/>吹き出し素材<|onMaterials/);
  assert.doesNotMatch(tools,/FontFamilyPicker|作品の基本書体|PC内フォントを再読込/);
  assert.match(toolbar,/<FontFamilyPicker[^>]+label="文字の書体"[^>]+onChange=\{font=>changeStyle\(\{font\}\)\}/);
  assert.doesNotMatch(app,/changeDefaultFont|requestPcFonts\(true\)/);
  assert.match(app,/useEffect\(\(\)=>\{void requestPcFonts\(\);\},\[\]\)/);
  assert.match(app,/rememberPcFontCatalog\(families\)/);
  assert.doesNotMatch(tools,/<datalist/);
  assert.doesNotMatch(editor,/<h3 class="paint-panel-title">描画ツール<\/h3>/);
  assert.ok((canvasText.match(/orientation:style\?\.orientation\?\?'vertical'/g)??[]).length>=3);
});

test('吹き出し素材を適用した後は選択ツールへ戻す',()=>{
  const app=read('src/components/App.tsx');
  for(const name of ['applyBubbleMaterial','wrapScreenText','finishElementMove']){
    const start=app.indexOf(`function ${name}`),end=app.indexOf('\n  function ',start+10),body=app.slice(start,end<0?undefined:end);
    assert.ok(start>=0,`${name} must exist`);
    assert.match(body,/setTextTool\(false\);setZoomTool\(false\);setBubblePathTool\(false\)/);
  }
});

test('ordinary point text grows from its start and never shows an area frame or size badge',()=>{
  const canvas=read('src/components/MangaCanvas.tsx'),toolbar=read('src/components/CanvasTextToolbar.tsx'),canvasText=read('src/lib/canvasText.ts'),css=read('src/styles/global.css');
  assert.match(canvasText,/vertical columns grow left, horizontal lines grow down/);
  assert.match(canvasText,/fitCanvasScreenTextToText\(document,t,start,origin\)/);
  assert.match(toolbar,/aria-label="文字サイズ pt"[\s\S]*?onInput=/);
  assert.doesNotMatch(canvas,/\{isSelected\s*&&\s*renderHandles\(panelIndex, selection, box\)\}/);
  assert.doesNotMatch(canvas,/\{isSelected&&renderHandles\(null,selection,box\)\}/);
  assert.doesNotMatch(css,/\.show-guides \.screen-text-guide[^\{]*\{[^}]*border/);
  assert.doesNotMatch(css,/\.show-guides \.screen-text-guide[^\{]*\{[^}]*background/);
  assert.match(css,/\.screen-text-guide \{[^}]*overflow:visible;[^}]*border:0;[^}]*background:transparent;[^}]*padding:0;/);
  assert.match(css,/\.screen-text-guide \.screen-text-body \{[^}]*width:max-content;[^}]*height:max-content;[^}]*overflow:visible;[^}]*white-space:pre;/);
  assert.match(css,/\.bubble-inline-editor\.is-screen-text \.native-text-input \{[^}]*width:max-content;[^}]*height:max-content;[^}]*border:0;[^}]*outline:0;[^}]*background:transparent;/);
});

test('font picker has categories, full names and four-column live previews',()=>{
  const picker=read('src/components/FontFamilyPicker.tsx'),css=read('src/styles/global.css');
  assert.match(picker,/日本語対応（\{counts\.japanese\}）/);
  assert.match(picker,/すべて（\{counts\.all\}）/);
  assert.match(picker,/読めないフォント（\{counts\.unreadable\}）/);
  assert.match(picker,/class="font-name-icon">n<\/span>/);
  assert.match(picker,/class="font-sample-icon">ABC<\/span>/);
  assert.match(picker,/FONT_MENU_SAMPLE/);
  assert.match(picker,/fontFamily:bubbleCssFontFamily\(font\.family\)/);
  assert.match(picker,/onChange\(font\.family\)/);
  assert.match(picker,/font\.displayName\?\?font\.family/);
  assert.match(picker,/<span>\{selectedName\}<\/span>/);
  assert.match(css,/\.font-family-grid \{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\);[^}]*overflow-y:scroll;[^}]*scrollbar-gutter:stable;/);
  assert.match(css,/\.font-family-grid>button \{[^}]*min-height:30px;[^}]*padding:2px 5px;/);
  assert.match(css,/\.font-family-grid>button>span \{[^}]*overflow-wrap:anywhere;[^}]*white-space:normal;/);
  assert.doesNotMatch(picker,/フォントを読み込み|fonts loaded/i);
});

test('PCフォントの構成が同じでも日本語名をキャッシュへ反映し、作品履歴には触れない',async()=>{
  const source=read('src/components/App.tsx'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let handler;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='requestPcFonts')handler=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(handler);
  const old=[{family:'Example',support:'japanese'}],names=[{family:'Example',displayName:'例文'}];let updates=0,writes=0,queries=0;
  const context={localFontCatalog:{current:old},localFontQuery:{current:null},localFontSynced:{current:false},queryPcFontFamilies:async()=>{queries++;return names;},classifyPcFontFamilies:rows=>rows.map(font=>({...font,support:'japanese'})),setLocalFontFamilies:rows=>{updates++;assert.equal(rows[0].family,'Example');assert.equal(rows[0].displayName,'例文');},rememberPcFontCatalog:()=>writes++};
  const request=runInNewContext(ts.transpileModule(`(${handler})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const first=request();assert.equal(request(),first);await first;
  assert.equal(updates,1);assert.equal(writes,1);assert.equal(context.localFontCatalog.current[0].displayName,'例文');
  await request();assert.equal(queries,1);
  context.localFontSynced.current=false;await request();assert.equal(updates,1);assert.equal(writes,1);
  names[0].weights=[{value:250,label:'W2'},{value:900,label:'W9'}];context.localFontSynced.current=false;await request();assert.equal(updates,2);assert.equal(writes,2);
});

test('文字の太さは実在ウェイトのみを表示し、単一・未取得・ロックでは変更しない',()=>{
  const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),exports={};
  const source=ts.transpileModule(read('src/components/CanvasTextToolbar.tsx'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h'}}).outputText;
  runInNewContext(source,{exports,h,require:name=>name==='preact/hooks'?{useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect:()=>{}}:name==='../lib/bubbleFonts'?{availableFontWeights,matchingFontWeight}: {default:'FontFamilyPicker'}});
  const fontFamilies=[{family:'Example',weights:[{value:250,label:'W2'},{value:800,label:'W8'},{value:900,label:'W9'}]},{family:'Single',weights:[{value:400,label:'B'}]},{family:'Heavy',weights:[{value:800,label:'W8'},{value:900,label:'W9'}]}];
  let updates=[];
  const find=(node,predicate)=>!node||typeof node!=='object'?undefined:predicate(node)?node:node.children?.map(child=>find(child,predicate)).find(Boolean);
  const renderTree=(font,props={})=>exports.default({style:{font,fontWeight:800},defaultFont:'Example',fontFamilies,disabled:false,onChange:patch=>updates.push({...patch}),...props});
  const render=(font,props={})=>find(renderTree(font,props),node=>node.props['aria-label']==='文字の太さ');
  const menu=render('Example');assert.equal(menu.props.disabled,false);assert.equal(menu.props.value,800);
  assert.deepEqual(menu.children.filter(child=>child?.type==='option').map(node=>node.children[0]),['W2','W8','W9']);
  menu.props.onChange({currentTarget:{value:'250'}});assert.deepEqual(updates,[{fontWeight:250}]);
  menu.props.onChange({currentTarget:{value:'700'}});assert.equal(updates.length,1);
  for(const [font,props] of [['Single',{}],['Unknown',{}],['Example',{disabled:true}]]){
    const inactive=render(font,props);assert.equal(inactive.props.disabled,true);inactive.props.onChange({currentTarget:{value:'900'}});assert.equal(updates.length,1);
  }
  const mixed=render('Example',{selection:{start:0,end:2},selectionWeight:null});assert.equal(mixed.props.value,'');assert.equal(mixed.children.find(child=>child?.type==='option').children[0],'混在');
  const bold=(props={})=>find(renderTree('Heavy',props),node=>node.props['aria-label']==='ボールド');
  assert.equal(bold().props['aria-pressed'],false);bold().props.onClick();assert.deepEqual(updates.at(-1),{fontWeight:900});
  const activeBold=bold({typingStyle:{fontWeight:900}});assert.equal(activeBold.props['aria-pressed'],true);activeBold.props.onClick();assert.deepEqual(updates.at(-1),{fontWeight:800});
  let prevented=false;activeBold.props.onPointerDown({preventDefault:()=>{prevented=true;}});assert.equal(prevented,true);
});

// 見込み: popupを消しても線幅の入力と単位は残る。合格: 数値とmmの隣接、説明属性なし。範囲: ソースとCSSの構造。
test('吹き出し線幅は数値とmmを隣接させる',()=>{
  const tools=read('src/components/PaintTextTools.tsx'),css=read('src/styles/global.css');
  assert.doesNotMatch(tools,/<strong>吹き出し設定<\/strong>/);
  assert.doesNotMatch(tools,/data-tool-help=/);
  assert.doesNotMatch(tools,/作品内の全吹き出しに適用/);
  assert.match(tools,/<span>線幅<\/span><input aria-label="吹き出し線幅 mm"[\s\S]*?<span>mm<\/span>/);
  assert.match(css,/\.paint-text-work-settings>label \{[^}]*grid-template-columns:max-content 54px max-content;/);
});

test('行揃えはスタイルの下に3アイコンを置き、領域全体へ一意に指定する',()=>{
  const h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),exports={};
  const source=ts.transpileModule(read('src/components/CanvasTextToolbar.tsx'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h'}}).outputText;
  runInNewContext(source,{exports,h,require:name=>name==='preact/hooks'?{useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect:()=>{}}:name==='../lib/bubbleFonts'?{availableFontWeights,matchingFontWeight}: {default:'FontFamilyPicker'}});
  const all=node=>!node||typeof node!=='object'?[]:[node,...node.children.flatMap(all)],updates=[];
  const render=(style={},disabled=false)=>exports.default({style,defaultFont:'test',selection:{start:1,end:2},disabled,onChange:(patch,scope)=>updates.push([{...patch},scope])});
  const tree=render(),nodes=all(tree),buttons=nodes.filter(node=>['左寄せ','中央寄せ','右寄せ'].includes(node.props['aria-label']));
  assert.equal(buttons.length,3);assert.deepEqual(buttons.map(node=>node.props['aria-pressed']),[true,false,false]);
  assert.ok(tree.children.findIndex(node=>node?.props?.class==='canvas-text-style')<tree.children.findIndex(node=>node?.props?.class?.includes('canvas-text-alignment')));
  for(const node of buttons){assert.equal(all(node).filter(child=>child.type==='svg').length,1);node.props.onClick();}
  assert.deepEqual(updates,[[{textAlign:'left'},undefined],[{textAlign:'center'},undefined],[{textAlign:'right'},undefined]]);
  const selected=all(render({textAlign:'right'})).find(node=>node.props['aria-label']==='右寄せ');selected.props.onClick();assert.deepEqual(updates.at(-1),[{textAlign:'right'},undefined]);
  const disabled=all(render({},true)).find(node=>node.props['aria-label']==='中央寄せ');assert.equal(disabled.props.disabled,true);disabled.props.onClick();assert.equal(updates.length,4);
});

test('pen size rows and bubble text movement target are compact and forgiving',()=>{
  const css=read('src/styles/global.css');
  assert.match(css,/\.paint-size-palette \{ --paint-size-row:34px;/);
  assert.match(css,/\.bubble-text-move-frame \{[^}]*inset:-12px;/);
});

test('all-material view reserves a scrollbar and includes the cloud category',()=>{
  const picker=read('src/components/BubbleMaterialPicker.tsx'),css=read('src/styles/global.css');
  assert.match(picker,/layer==='thought'\?'雲形'/);
  assert.match(picker,/すべて（\{BUBBLE_PRESETS\.length\}）/);
  assert.match(css,/\.bubble-material-window-grid \{[^}]*overflow-y:scroll;[^}]*overscroll-behavior:contain;[^}]*scrollbar-gutter:stable;/);
  assert.match(css,/\.bubble-material-window-grid::-webkit-scrollbar \{ width:12px; \}/);
  assert.match(picker,/getElementById\('paint-bubble-materials-slot'\)/);
  assert.match(picker,/return createPortal\(/);
  assert.doesNotMatch(picker,/<p>|<small>/);
  assert.match(css,/\.bubble-material-window-grid \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.bubble-material-tile \{[^}]*border:1px solid #8b9095;[^}]*background:#686d72;/);
  assert.match(picker,/class="bubble-material-preview"[^>]*--bubble-material-url/);
  assert.match(css,/\.bubble-material-preview \{[^}]*background:#fff;[^}]*mask:var\(--bubble-material-url\) center\/contain no-repeat;[^}]*filter:drop-shadow\(1px 0 0 #000\)/);
  assert.match(css,/\.bubble-material-tile span \{[^}]*color:#fff;[^}]*font-weight:700;/);
});

test('V uses the one layout selection route and A direct selection edits the selected bubble path',()=>{
  const editor=read('src/components/PaintEditor.tsx'),canvas=read('src/components/MangaCanvas.tsx'),bezier=read('src/components/BubbleBezierEditor.tsx'),css=read('src/styles/bubbleBezier.css'),globalCss=read('src/styles/global.css');
  assert.match(editor,/event\.stopPropagation\(\);selectTool\(nextTool\)/);
  assert.match(editor,/onClick=\{\(\)=>selectTool\(value\)\}/);
  assert.match(editor,/const layoutSelect=value==='vector-select'/);
  assert.doesNotMatch(editor,/label="選択・移動"/);
  assert.match(canvas,/BubblePathToolContext/);
  assert.match(canvas,/if\(bubblePathTool==='node'&&mode==='move'\)return/);
  assert.match(canvas,/renderSelectedBubblePathOverlay/);
  assert.match(canvas,/<BubbleBezierHandles outline=/);
  assert.doesNotMatch(canvas,/bubblePathTool==='path'/);
  assert.match(canvas,/agentWorking\(selectedElement,panelIndex\)\?<BubbleBezierSelection[^>]*label="エージェントの作業対象"/);
  assert.match(bezier,/export function BubbleBezierHandles/);
  assert.match(bezier,/class="bubble-bezier-outline-hit"[^>]*onPointerDown=\{startOutline\}/);
  assert.match(bezier,/start\(event,at,undefined,\{x:anchor\.x-point\.x,y:anchor\.y-point\.y\}\)/);
  assert.match(bezier,/preserveAspectRatio=\{overlay\?'none':'xMidYMid meet'\}/);
  assert.match(css,/\.bubble-bezier-outline-hit \{[^}]*stroke-width:10;[^}]*pointer-events:stroke;/);
  assert.match(bezier,/class="bubble-bezier-node-hit"[^>]+width=\{14\*unit\.x\} height=\{14\*unit\.y\}/);
  assert.match(bezier,/class="bubble-bezier-handle-hit"[^>]+rx=\{7\*unit\.x\} ry=\{7\*unit\.y\}[^>]+onPointerDown=/);
  assert.match(bezier,/class=\{`bubble-bezier-node[^`]+`\}[^>]+width=\{7\*unit\.x\} height=\{7\*unit\.y\}/);
  assert.match(css,/\.bubble-bezier-node \{[^}]*pointer-events:none;/);
  assert.match(css,/\.bubble-bezier-node-hit,\.bubble-bezier-handle-hit \{[^}]*pointer-events:all;[^}]*cursor:default;/);
  assert.match(canvas,/!painting&&!textTool&&!zoomTool&&!bubblePathTool\?'is-selection-tool':bubblePathTool==='node'\?'is-direct-selection-tool'/);
  assert.match(globalCss,/\.canvas-viewport\.is-selection-tool \{ --selection-tool-cursor:default; \}/);
  assert.match(canvas,/class="panel-edge-midpoint"[^>]+r=\{2\.5\*screenUnit\}/);
  assert.match(canvas,/class="panel-edge-midpoint-hit"[^>]+onPointerDown=\{\(event\)=>startPanelEdgeDrag\(event,edgeIndex\)\}/);
  assert.match(globalCss,/\.panel-edge-midpoint-hit \{[^}]+pointer-events: all;[^}]+cursor: default;/);
  assert.match(globalCss,/\.canvas-viewport\.is-direct-selection-tool \{ --direct-selection-tool-cursor:url\(/);
  assert.match(globalCss,/\.canvas-viewport\.is-direct-selection-tool \.bubble-bezier-node-hit,[\s\S]*?cursor:var\(--direct-selection-tool-cursor\)/);
  assert.match(globalCss,/--direct-selection: #236bc4;/);
  assert.match(globalCss,/\.panel-edge-handle\.is-active \.panel-edge-guide \{ stroke: var\(--direct-selection\);/);
  assert.match(globalCss,/\.panel-edge-handle:hover \.panel-edge-midpoint, \.panel-edge-handle\.is-active \.panel-edge-midpoint \{ fill: var\(--direct-selection\);/);
  assert.match(globalCss,/\.vector-edit-overlay path,[^\n]+\{ stroke:var\(--direct-selection\)/);
  assert.match(globalCss,/\.vector-edit-overlay rect\.is-selected-anchor \{ fill:var\(--direct-selection\); stroke:var\(--direct-selection\); \}/);
  assert.match(css,/\.bubble-bezier-node \{[^}]*stroke: var\(--direct-selection,#236bc4\)/);
  assert.match(css,/\.bubble-bezier-handle \{[^}]*stroke: var\(--direct-selection,#236bc4\)/);
  assert.doesNotMatch(css,/#[fF](?:[fF])?[78][0-9a-fA-F]{2}|orange|darkorange/);
  assert.match(bezier,/const padding=8,minX=Math\.min\(0,\.\.\.points\.map\(point=>point\.x\)\)-padding/);
  assert.match(bezier,/viewBox=\{overlay\?`\$\{overlayBounds\.minX\} \$\{overlayBounds\.minY\} \$\{overlayBounds\.width\} \$\{overlayBounds\.height\}`/);
  assert.match(css,/\.bubble-bezier-canvas\.is-paper-overlay \.bubble-bezier-outline \{[^}]*stroke: var\(--direct-selection,#236bc4\)/);
  assert.match(css,/\.bubble-bezier-handle \{[^}]*pointer-events:none;/);
  assert.match(canvas,/class="bubble-tail-root-dot"[^>]+width=\{7\*screenUnit\} height=\{7\*screenUnit\}/);
  assert.match(canvas,/class="bubble-tail-target-dot"[^>]+r=\{3\.5\*screenUnit\}/);
  assert.match(globalCss,/\.bubble-tail-target-dot \{[^}]*stroke:none;/);
  assert.match(globalCss,/\.bubble-tail-root-dot \{[^}]*stroke:none;/);
  assert.match(globalCss,/\.is-bubble-tail-dragging[^}]*cursor: move !important;/);
  assert.match(globalCss,/\.canvas-element \{[^}]*cursor: default;/);
  assert.match(globalCss,/\.placed-image \{[^}]*cursor: default;/);
  assert.match(globalCss,/\.handle-nw[^}]*cursor: nwse-resize;/);
  assert.match(globalCss,/\.handle-ne[^}]*cursor: nesw-resize;/);
  assert.match(globalCss,/\.is-canvas-moving[^}]*cursor: move !important;/);
  assert.match(canvas,/const cursorClass=mode==='move'\?'is-canvas-moving':`is-canvas-resizing-\$\{mode\}`/);
  assert.match(canvas,/!owner \|\| !bubble \|\| !bubbleVisible\(bubble\) \|\| elementLocked\(selectedElement\) \|\| bubbleTailDisabled\(bubble\)/);
  assert.doesNotMatch(canvas,/artworkInteractionBounds/);
  assert.match(canvas,/unbounded:true/);
  assert.match(canvas,/nudgeElement\(event,paperBounds,selection,box\)/);
  assert.doesNotMatch(canvas,/revision=\{bubble\}[^>]+outlineFrame/);
});

test('panel corners use screen-fixed seven-pixel visuals and fourteen-pixel hit targets',()=>{
  const canvas=read('src/components/MangaCanvas.tsx');
  assert.match(canvas,/class="panel-resize-handle"[^>]+width=\{7\*screenUnit\} height=\{7\*screenUnit\}/);
  assert.match(canvas,/class="panel-resize-hit"[^>]+width=\{14\*screenUnit\} height=\{14\*screenUnit\}/);
});

test('a selected artwork outline cannot cover a visually higher bubble hit target',()=>{
  const canvas=read('src/components/MangaCanvas.tsx');
  assert.match(canvas,/class="artwork-selection-layer"[^>]+pointerEvents:'none'/);
  assert.match(canvas,/CanvasContentSelection[^>]+selected interactive=\{false\}/);
});

test('capture range trigger stays one row and collapses to the illustration in a narrow field',()=>{
  const css=read('src/components/FigureSizePicker.css');
  assert.match(css,/\.figure-size-trigger \{[^}]*height: 36px;[^}]*max-height: 36px;/);
  assert.match(css,/@container \(max-width: 132px\)[\s\S]*?\.figure-size-trigger > span, \.figure-size-trigger > svg:last-child \{ display: none; \}/);
});

// 見込み: ×は有効なTだけ終了させ、別の道具は維持する。合格: 閉時通知はT中だけ1回ずつ。範囲: 実componentと模擬hooks、App復帰はbrowser試験。
test('文字パレットはレイヤーと道具の変更で開閉せず、×で有効な文字ツールだけ終了する',()=>{
 const slots=[],effects=[];let cursor=0,changed=false,tree;
 const state=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(next!==slots[i]){slots[i]=next;changed=true;}}];};
 const effect=(run,deps)=>{const i=cursor++,before=slots[i];if(!before||deps.some((value,index)=>value!==before[index])){slots[i]=deps;effects.push(run);}};
 const hooks={useState:state,useRef:initial=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect:effect,useLayoutEffect:effect};
 const exports={},h=(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)});
 const source=ts.transpileModule(read('src/components/PaintTextTools.tsx'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h'}}).outputText;
 runInNewContext(source,{exports,h,document:{body:{}},window:{addEventListener(){},removeEventListener(){}},innerWidth:1200,innerHeight:900,require:name=>name==='preact/hooks'?hooks:name==='preact/compat'?{createPortal:child=>child}:name==='./useInspectorSelectionScroll'?{scrollInspectorSelection:()=>{}}:name==='lucide-preact'?{Type:'Type',ChevronDown:'ChevronDown',MessageCircleMore:'MessageCircleMore',Info:'Info',X:'X'}:{PaintToolButton:'PaintToolButton'}});
 let selectedTools=0,closedTools=0;
 let props={active:false,openRequest:{id:0,tab:'text'},disabled:false,select(){selectedTools++;},onClose(){closedTools++;},onMaterials(){},bubbleLineWidthMm:.3,onChangeBubbleLineWidth(){}};
 const render=patch=>{props={...props,...patch};for(let i=0;i<10;i++){changed=false;cursor=0;tree=exports.default(props);while(effects.length)effects.shift()();if(!changed)return;}throw Error('Render did not settle');};
 const find=(predicate,node=tree)=>{if(!node||typeof node!=='object')return;return predicate(node)?node:node.children?.map(child=>find(predicate,child)).find(Boolean);};
 const dialog=()=>find(node=>node.props['aria-label']==='文字ツールの設定');
 const button=label=>find(node=>node.props.label===label||node.props['aria-label']===label);
 const click=label=>{button(label).props.onClick();render();};
 render();assert.equal(dialog().props.hidden,true);
 render({active:true});assert.equal(dialog().props.hidden,true,'tool state alone does not open the palette');
 click('写植文字');assert.equal(dialog().props.hidden,false);
 click('ふきだし');assert.equal(button('ふきだし').props['aria-selected'],true);
 click('情報');assert.equal(button('情報').props['aria-selected'],true);
 assert.equal(selectedTools,1,'information tab does not activate the text tool');
 const position=dialog().props.style;
 for(const active of [false,true,false])for(const disabled of [true,false]){
  render({active,disabled});assert.equal(dialog().props.hidden,false);assert.equal(button('情報').props['aria-selected'],true);assert.equal(dialog().props.style,position);
 }
 render({openRequest:{id:1,tab:'text'}});assert.equal(button('情報').props['aria-selected'],true,'an open window keeps its information tab');
 click('文字のツール一覧');assert.equal(dialog().props.hidden,false,'the arrow only opens');
 tree.props.onContextMenu({preventDefault(){}});render();assert.equal(dialog().props.hidden,false,'right click only opens');
 click('文字ツールの設定を閉じる');assert.equal(dialog().props.hidden,true);assert.equal(closedTools,0,'他の道具で閉じても終了通知を出さない');
 render({active:true,disabled:true,openRequest:{id:1,tab:'text'}});assert.equal(dialog().props.hidden,true,'an unchanged request does not reopen after close');
 render({active:false,disabled:false});assert.equal(dialog().props.hidden,true);
 render({openRequest:{id:2,tab:'text'}});assert.equal(dialog().props.hidden,false,'a new explicit T request reopens');assert.equal(button('文字').props['aria-selected'],true);
 render({openRequest:{id:3,tab:'info'}});assert.equal(button('情報').props['aria-selected'],true,'explicit scenario navigation opens information even when the palette was open');
 render({active:true});click('文字ツールの設定を閉じる');assert.equal(dialog().props.hidden,true);assert.equal(closedTools,1,'T中の×はAppへ終了を通知する');
 const canvas=read('src/components/MangaCanvas.tsx');
 assert.match(canvas,/textSettingsOwner&&textToolbarHost&&createPortal\(/,'text controls stay mounted when changing tools');
 assert.doesNotMatch(canvas,/<CanvasTextToolbar key=/,'selection changes do not replace the settings component');
 assert.doesNotMatch(read('src/components/App.tsx'),/<PaintTextTools[^>]+selectionVisible=/,'layer selection does not own window visibility');
});
