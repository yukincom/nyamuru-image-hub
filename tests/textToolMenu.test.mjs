import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('T primary click and shortcut open a compact tabbed persistent settings window',()=>{
  const tools=read('src/components/PaintTextTools.tsx'),toolbar=read('src/components/CanvasTextToolbar.tsx'),app=read('src/components/App.tsx'),editor=read('src/components/PaintEditor.tsx'),canvasText=read('src/lib/canvasText.ts');
  assert.match(tools,/label="通常文字"[\s\S]*?onClick=\{\(\)=>\{setOpen\(true\);select\(\);\}\}/);
  assert.match(tools,/label="通常文字を追加"[\s\S]*?onClick=\{\(\)=>add\('screen_text'\)\}/);
  assert.doesNotMatch(tools,/add\('bubble'\)|吹き出しを追加/);
  assert.match(tools,/openRequest:TextPaletteRequest/);
  assert.match(tools,/if\(active\|\|selectionVisible\)\{setOpen\(true\);setTab\(active\?openRequest\.tab:'bubble'\);\}else setOpen\(false\);\},\[active,selectionVisible,openRequest\]/);
  assert.match(app,/openRequest=\{textPaletteRequest\}/);
  assert.ok((app.match(/setTextPaletteRequest\(value=>\(\{id:value\.id\+1,tab:'(?:text|bubble)'\}\)\)/g)??[]).length>=3);
  assert.doesNotMatch(tools,/document\.addEventListener\('pointerdown',dismiss/);
  assert.match(tools,/class="text-settings-window-grab"[\s\S]*?onPointerDown=\{beginDrag\}/);
  assert.match(tools,/id="paint-text-settings-slot"/);
  assert.match(tools,/role="tablist"[\s\S]*?label="文字"[\s\S]*?label="ふきだし"/);
  assert.match(tools,/id="paint-bubble-materials-slot"/);
  assert.match(tools,/label="ふきだし" help="素材を吹き出しへ重ねると輪郭だけを入れ替えます。/);
  assert.doesNotMatch(toolbar,/>吹き出し素材<|onMaterials/);
  assert.doesNotMatch(tools,/FontFamilyPicker|作品の基本書体|PC内フォントを再読込/);
  assert.match(toolbar,/<FontFamilyPicker[^>]+label="文字の書体"[^>]+onChange=\{font=>onChange\(\{font\}\)\}/);
  assert.doesNotMatch(app,/changeDefaultFont|requestPcFonts\(true\)/);
  assert.match(app,/useEffect\(\(\)=>\{void requestPcFonts\(\);\},\[\]\)/);
  assert.match(app,/names\.length!==localFontNames\.current\.length\|\|names\.some\(\(name,index\)=>name!==localFontNames\.current\[index\]\)/);
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
  assert.match(canvasText,/fitCanvasScreenTextToText\(document,t,origin\)/);
  assert.match(toolbar,/aria-label="文字サイズ pt"[\s\S]*?onInput=/);
  assert.doesNotMatch(canvas,/\{isSelected\s*&&\s*renderHandles\(panelIndex, selection, box\)\}/);
  assert.doesNotMatch(canvas,/\{isSelected&&renderHandles\(null,selection,box\)\}/);
  assert.doesNotMatch(css,/\.show-guides \.screen-text-guide[^\{]*\{[^}]*border/);
  assert.doesNotMatch(css,/\.show-guides \.screen-text-guide[^\{]*\{[^}]*background/);
  assert.match(css,/\.screen-text-guide \{[^}]*overflow:visible;[^}]*border:0;[^}]*background:transparent;[^}]*padding:0;/);
  assert.match(css,/\.screen-text-guide \.screen-text-body \{[^}]*width:max-content;[^}]*height:max-content;[^}]*overflow:visible;[^}]*white-space:pre;/);
  assert.match(css,/\.bubble-inline-editor\.is-screen-text \.native-text-input \{[^}]*width:max-content;[^}]*height:max-content;[^}]*border:0;[^}]*outline:0;[^}]*background:transparent;/);
});

test('font picker has categories, full names and narrow five-column live previews',()=>{
  const picker=read('src/components/FontFamilyPicker.tsx'),css=read('src/styles/global.css');
  assert.match(picker,/日本語対応（\{counts\.japanese\}）/);
  assert.match(picker,/すべて（\{counts\.all\}）/);
  assert.match(picker,/読めないフォント（\{counts\.unreadable\}）/);
  assert.match(picker,/class="font-name-icon">n<\/span>/);
  assert.match(picker,/class="font-sample-icon">ABC<\/span>/);
  assert.match(picker,/FONT_MENU_SAMPLE/);
  assert.match(picker,/fontFamily:bubbleCssFontFamily\(font\.family\)/);
  assert.match(css,/\.font-family-grid \{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\);[^}]*overflow-y:scroll;[^}]*scrollbar-gutter:stable;/);
  assert.match(css,/\.font-family-grid>button \{[^}]*min-height:30px;[^}]*padding:2px 5px;/);
  assert.match(css,/\.font-family-grid>button>span \{[^}]*overflow-wrap:anywhere;[^}]*white-space:normal;/);
  assert.doesNotMatch(picker,/フォントを読み込み|fonts loaded/i);
});

test('吹き出し線幅は数値とmmを隣接させる',()=>{
  const tools=read('src/components/PaintTextTools.tsx'),css=read('src/styles/global.css');
  assert.doesNotMatch(tools,/<strong>吹き出し設定<\/strong>/);
  assert.match(tools,/<span>線幅<\/span><input aria-label="吹き出し線幅 mm"[\s\S]*?<span>mm<\/span>/);
  assert.match(css,/\.paint-text-work-settings>label \{[^}]*grid-template-columns:max-content 54px max-content;/);
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
  assert.match(editor,/!requested&&nextTool==='vector-select'\)onSelectLayout\?\.\(\)/);
  assert.match(editor,/!requested&&nextTool==='vector-node'&&onSelectBubblePath\)onSelectBubblePath\('node'\)/);
  assert.match(editor,/const layoutSelect=value==='vector-select'/);
  assert.match(editor,/!requested&&layoutSelect\)onSelectLayout\?\.\(\)/);
  assert.doesNotMatch(editor,/label="選択・移動"/);
  assert.match(editor,/requested&&<PaintToolButton[^>]+label="配置へ戻る"/);
  assert.match(canvas,/BubblePathToolContext/);
  assert.match(canvas,/if\(bubblePathTool==='node'&&mode==='move'\)return/);
  assert.match(canvas,/renderSelectedBubblePathOverlay/);
  assert.match(canvas,/<BubbleBezierHandles outline=/);
  assert.doesNotMatch(canvas,/BubbleBezierSelection|bubblePathTool==='path'/);
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
