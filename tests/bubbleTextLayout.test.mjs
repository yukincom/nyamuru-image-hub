import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as bubbleBezier from '../src/lib/bubbleBezier.ts';

const source = readFileSync(new URL('../src/components/MangaCanvas.tsx', import.meta.url), 'utf8');
const shapeSource = readFileSync(new URL('../src/components/BubbleShapeSvg.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('MangaCanvas.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'BubbleText');
const javascript = ts.transpileModule(component.getText(ast).replace(/^export /, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' },
}).outputText;

test('text content alone is centered at each zoom; move chrome, top alignment and text are untouched', () => {
  for (const scale of [0.5, 1, 3.05]) {
    const properties = new Map();
    let effect, deps, cleanup, fontListener;
    const content={};
    const el = { style: { setProperty: (k,v) => properties.set(k,v), getPropertyValue: k => properties.get(k) },
      querySelector:selector=>{assert.equal(selector,'.bubble-text-content');return content;},
      scrollWidth: 40, clientWidth: 40, scrollHeight: 50, clientHeight: 50,
      getBoundingClientRect: () => ({ width: 40 * scale }),
      parentElement: { getBoundingClientRect: () => ({ x: 0, y: 0, width: 100 * scale, height: 100 * scale }) } };
    const context = { useRef: () => ({ current: el }), useLayoutEffect: (fn, values) => { effect = fn; deps = values; },
      getComputedStyle: () => ({ width: '40px' }), bubbleCssFontFamily: font => font, textStyleCss:()=>({fontSize:'1cqw'}),
      document: { createRange: () => ({ selectNode: node => assert.equal(node, content), getBoundingClientRect: () => ({ x: 35 * scale, y: 20 * scale, width: 40 * scale, height: 50 * scale }) }),
        fonts: { addEventListener: (event, fn) => { assert.equal(event, 'loadingdone'); fontListener = fn; }, removeEventListener: (event, fn) => { assert.equal(event, 'loadingdone'); assert.equal(fn, fontListener); } } },
      h: (type, props, ...children) => ({ type, props, children }) };
    const vnode = runInNewContext(`${javascript}\nBubbleText({text:'長い列\\n短い',font:'test',shape:'thought',lengthClass:'',boxW:100,boxH:100,fitEpoch:1})`, context);
    cleanup = effect();
    assert.equal(properties.get('--bubble-center-x'), '-5px');
    assert.equal(properties.get('--bubble-center-y'), '5px');
    assert.equal(vnode.children[0].props.class, 'bubble-text-content');
    assert.equal(vnode.children[0].children[0], '長い列\n短い');
    assert.deepEqual(Array.from(deps), ['長い列\n短い', 'test', 'thought', '', 100, 100, 1, .5, .5, undefined, undefined]);
    fontListener();
    assert.equal(properties.get('--bubble-center-x'), '-5px', 'font refit resets offsets, not accumulates');
    cleanup();
  }
});

test('both panel and page overlay text share the centering component; CSS centers the block not each column', () => {
  assert.equal(source.match(/<BubbleText text=\{bubble.text\}/g).length, 2);
  assert.equal(source.match(/shape=\{bubble.shape\} lengthClass/g).length, 2);
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  const rule = css.match(/\.bubble-guide \.bubble-text \{[^}]+\}/)[0];
  assert.match(rule, /top: 50%/);
  assert.match(rule, /z-index: 36/);
  assert.match(rule, /height: max-content/);
  assert.match(rule, /text-align: start/);
  assert.match(css, /writing-mode: vertical-rl; white-space: pre-wrap/);
  assert.match(css, /--bubble-center-x/);
  assert.match(rule, /max-width:none; max-height:none;/);
  assert.match(rule, /overflow:visible; white-space:pre;/);
  assert.doesNotMatch(component.getText(ast), /scrollWidth|scrollHeight/);
});

test('panel-owned bubbles clip as a whole while overlays stay unclipped and the text frame moves independently',()=>{
  assert.match(source,/class="panel-bubble-clip" style=\{\{\.\.\.layerClipStyle\(panel,canvas\),'--bubble-line-width':canvasLengthCss\(bubbleStrokeWidthMm\(bubble,bubbleLineWidthMm\),canvas\.w\)\}\}/);
  assert.match(shapeSource,/const activeMaskId = maskId && seamMasks\.length \? maskId : undefined/);
  assert.match(shapeSource,/<g mask=\{activeMaskId \? `url\(#\$\{activeMaskId\}\)` : undefined\}>/);
  assert.match(component.getText(ast),/class=\{`bubble-text-move-frame \$\{moveFrameActive\?'is-active':''\}`\}/);
  assert.equal(source.match(/onMoveFrame=\{textTool&&/g)?.length,2);
  assert.doesNotMatch(source,/onMoveFrame=\{textTool&&isSelected/);
  assert.equal(source.match(/moveFrameActive=\{isSelected\}/g)?.length,2);
  assert.match(source,/textBubble&&!textTarget\.overlay\?elementPanelClipStyle\(textPanel!,textBox\):\{\}/);
});

test('the actual text drag preserves finite positions beyond the original bbox in both directions',()=>{
  for(const end of ['pointerup','pointercancel','unmount','next-drag']){
  let declaration;const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='startBubbleTextDrag')declaration=node;ts.forEachChild(node,visit);};visit(ast);
  const listeners=new Map(),changes=[],phases=[],selection={type:'bubble',index:0};
  const context={paintWorkspace:null,paperRef:{current:{getBoundingClientRect:()=>({width:182,height:257})}},elementLocked:()=>false,
    onSelectElement:value=>assert.equal(value,selection),canvas:{w:182,h:257},setInteractionMode(){},document:{body:{classList:{add(){},remove(){}}}},
    window:{addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)},cleanupRef:{current:null},bubbleTextDragged:{current:false},
    clamp:(value,min,max)=>Math.max(min,Math.min(max,value)),onChangeBubbleTail:(_selection,_tail,patch)=>changes.push(patch.textPosition),onImageGesture:phase=>phases.push(phase)};
  const drag=runInNewContext(ts.transpile(`(${declaration.initializer.getText(ast)})`,{target:ts.ScriptTarget.ES2022}),context);
  drag({clientX:100,clientY:100,preventDefault(){},stopPropagation(){}},selection,{x:20,y:30,w:30,h:20},{x:.5,y:.5});
  listeners.get('pointermove')({clientX:136,clientY:82,preventDefault(){}});
  assert.deepEqual(JSON.parse(JSON.stringify(changes.at(-1))),{x:1.7,y:-.4});
  if(end==='unmount')context.cleanupRef.current();
  else if(end==='next-drag'){
    drag({clientX:136,clientY:82,preventDefault(){},stopPropagation(){}},selection,{x:20,y:30,w:30,h:20},{x:1.7,y:-.4});
    assert.deepEqual(phases,['start','end','start']);listeners.get('pointerup')();
  }else listeners.get(end)();
  assert.equal(listeners.size,0);assert.deepEqual(phases,end==='next-drag'?['start','end','start','end']:['start','end']);
  }
});

test('paper direct selection omits the reference rectangle but retains anchors and the small editor',()=>{
  const editor=readFileSync(new URL('../src/components/BubbleBezierEditor.tsx',import.meta.url),'utf8'),exports={};
  const createTestNode=(type,props,...children)=>({type,props,children});
  runInNewContext(ts.transpileModule(editor,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'createTestNode'}}).outputText,
    {exports,createTestNode,require:name=>name==='preact/hooks'?{useRef:()=>({current:null}),useState:value=>[value,()=>{}],useLayoutEffect(){}}:name.includes('bubbleBezier.ts')?bubbleBezier:{}});
  const nodes=tree=>!tree||typeof tree!=='object'?[]:[tree,...(tree.children??[]).flat(Infinity).flatMap(nodes)];
  const outline=bubbleBezier.createBubbleBezier('ellipse');
  const paper=nodes(exports.BubbleBezierHandles({outline,onChange(){},overlay:true}));
  assert.equal(paper.filter(node=>node.props?.class==='bubble-bezier-box').length,0);
  assert.equal(paper.filter(node=>node.props?.class==='bubble-bezier-node-hit').length,outline.nodes.length);
  assert.equal(nodes(exports.BubbleBezierHandles({outline,onChange(){}})).filter(node=>node.props?.class==='bubble-bezier-box').length,1);
  assert.equal(nodes(exports.BubbleBezierSelection({outline})).filter(node=>node.props?.class==='bubble-bezier-box').length,1);
  const css=readFileSync(new URL('../src/styles/global.css',import.meta.url),'utf8');
  assert.match(css,/\.paint-reference \.paint-bubble-original \{ overflow:visible; \}/);
});

test('paper anchor editing commits once, while cancellation only discards its draft',()=>{
  const editor=readFileSync(new URL('../src/components/BubbleBezierEditor.tsx',import.meta.url),'utf8');
  for(const end of ['up','cancel','lost-capture','escape']){
    const exports={},changes=[],selection=[],captured=new Set();
    const createTestNode=(type,props,...children)=>({type,props,children});
    const context={exports,createTestNode,DOMPoint:class{constructor(x,y){this.x=x;this.y=y;}matrixTransform(){return {x:this.x,y:this.y};}},
      require:name=>name==='preact/hooks'?{useRef:()=>({current:null}),useState:value=>[value,()=>{}],useLayoutEffect(){}}:name.includes('bubbleBezier.ts')?bubbleBezier:{}};
    runInNewContext(ts.transpileModule(editor,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'createTestNode'}}).outputText,context);
    const outline=bubbleBezier.createBubbleBezier('ellipse'),before=JSON.stringify(outline);
    const paper=exports.BubbleBezierHandles({outline,overlay:true,onChange:value=>changes.push(value),onSelect:value=>selection.push(value)});
    paper.props.ref.current={getScreenCTM:()=>({inverse:()=>({})}),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
    const nodes=tree=>!tree||typeof tree!=='object'?[]:[tree,...(tree.children??[]).flat(Infinity).flatMap(nodes)];
    const anchor=nodes(paper).find(node=>node.props?.class==='bubble-bezier-node-hit');
    const event={pointerId:7,button:0,clientX:-40,clientY:140,preventDefault(){},stopPropagation(){}};
    anchor.props.onPointerDown(event);paper.props.onPointerMove(event);assert.deepEqual(selection,[0]);
    if(end==='up')paper.props.onPointerUp(event);
    else if(end==='cancel')paper.props.onPointerCancel(event);
    else if(end==='lost-capture')paper.props.onLostPointerCapture(event);
    else{paper.props.onKeyDown({...event,key:'Escape'});paper.props.onPointerUp(event);}
    assert.equal(changes.length,end==='up'?1:0);assert.equal(JSON.stringify(outline),before);
    if(changes.length)assert.deepEqual([changes[0].nodes[0].x,changes[0].nodes[0].y],[-40,140]);
  }
});

test('only text requiring review is red and the ambiguous page badge is absent',()=>{
  const css=readFileSync(new URL('../src/styles/global.css',import.meta.url),'utf8');
  const sidebar=readFileSync(new URL('../src/components/PageSidebar.tsx',import.meta.url),'utf8');
  const text=component.getText(ast);
  assert.match(text,/review\?'is-text-review'/);
  assert.equal(source.match(/review=\{scenarioBubbleNeedsReview\(bubble\)\}/g)?.length,2);
  assert.match(css,/\.bubble-native-text \{ z-index:36; \}/);
  assert.match(css,/\.bubble-guide \.bubble-text\.is-text-review \{ color: var\(--danger\); \}/);
  assert.doesNotMatch(sidebar,/確認 \{pageIssues\.length\}|issue-dot/);
});

test('entering text edit keeps authored line breaks and leaves the rest of the bubble clickable',()=>{
  const css=readFileSync(new URL('../src/styles/global.css',import.meta.url),'utf8');
  const app=readFileSync(new URL('../src/components/App.tsx',import.meta.url),'utf8');
  const bubbleTextSource=component.getText(ast);
  assert.match(bubbleTextSource,/onPointerDown=\{interactive\?event=>event\.stopPropagation\(\):undefined\}/);
  assert.match(bubbleTextSource,/onClick=\{interactive\?event=>\{event\.stopPropagation\(\);onEdit\?\.\(\);\}:undefined\}/);
  assert.match(bubbleTextSource,/class="bubble-text-content"/);
  assert.match(bubbleTextSource,/class=\{`bubble-text-move-frame \$\{moveFrameActive\?'is-active':''\}`\}[^>]+onPointerDown=\{event=>\{event\.stopPropagation\(\);onMoveFrame\(event\);\}\}/);
  assert.match(bubbleTextSource,/class=\{`bubble-text-move-edge is-\$\{side\}`\}/);
  assert.doesNotMatch(source,/editOnClick/);
  assert.match(source,/data-content-target data-content-panel=\{panelIndex\} data-content-kind="bubble"[\s\S]*?onClick=\{\(event\) => \{ event\.stopPropagation\(\);[^\n]*onSelectElement\(selection, panelIndex\);[^\n]*textTool[^\n]*onEditBubble/);
  assert.match(source,/data-content-overlay data-content-kind="bubble"[\s\S]*?onClick=\{\(event\) => \{ event\.stopPropagation\(\);[^\n]*onSelectElement\(selection\);[^\n]*textTool[^\n]*onEditBubble/);
  assert.match(css,/\.bubble-guide \.bubble-text\.is-interactive \.bubble-text-content \{[^}]*pointer-events:auto;[^}]*cursor:text;/);
  assert.match(css,/\.bubble-guide \.bubble-text-content \{[^}]*position:relative;[^}]*z-index:3;/);
  assert.match(css,/\.bubble-text-move-frame \{[^}]*border:1px solid transparent;[^}]*pointer-events:auto;[^}]*cursor:default;/);
  assert.match(css,/\.is-bubble-text-dragging[^}]*cursor: move !important;/);
  assert.match(css,/\.bubble-text-move-frame\.is-active \{[^}]*border-color:#2f8cff;/);
  assert.match(css,/\.bubble-text-move-edge \{[^}]*pointer-events:none;/);
  assert.match(css,/\.bubble-shape-svg, \.bubble-shape-svg \* \{ pointer-events: none; \}/);
  assert.match(css,/\.bubble-inline-editor \{[^}]*pointer-events:none;/);
  assert.match(css,/\.bubble-inline-editor \.native-text-input \{[^}]*white-space:pre;[^}]*overflow:visible;[^}]*pointer-events:auto;/);
  assert.match(css,/\.bubble-inline-editor\.is-bubble \.native-text-input \{[^}]*width:max-content;[^}]*height:max-content;[^}]*max-width:none;[^}]*max-height:none;/);
  assert.doesNotMatch(css,/\.bubble-inline-editor\.is-bubble \.native-text-input \{[^}]*max-width:76%/);
  assert.doesNotMatch(app,/function startTextEdit[\s\S]{0,1600}fitCanvasBubbleToText/);
});

test('paper preview omits the subtitle, page counter, bubble size label, and every figure size label', () => {
  assert.doesNotMatch(source, /<div class="paper-header">/);
  assert.equal(source.match(/renderHandles\([^\n]+visible,false\)/g)?.length, 2);
  assert.match(source, /showSize&&selection\.type!=='figure'&&<span class="element-size-label">/);
});

test('bubble inspectors do not expose optional coordinate placement fields', () => {
  const panelInspector = readFileSync(new URL('../src/components/PanelInspector.tsx', import.meta.url), 'utf8');
  const pageOverlayInspector = readFileSync(new URL('../src/components/PageOverlayInspector.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(panelInspector, /配置情報（任意）/);
  assert.doesNotMatch(pageOverlayInspector, /配置情報（任意）/);
  assert.match(panelInspector, /<Field label="話者">/);
  assert.match(pageOverlayInspector, /<Field label="話者">/);
});

test('choosing a bubble join target applies the join without a separate checkbox', () => {
  const panelInspector = readFileSync(new URL('../src/components/PanelInspector.tsx', import.meta.url), 'utf8');
  const pageOverlayInspector = readFileSync(new URL('../src/components/PageOverlayInspector.tsx', import.meta.url), 'utf8');
  for (const inspector of [panelInspector, pageOverlayInspector]) {
    assert.doesNotMatch(inspector, /コマ結合/);
    assert.doesNotMatch(inspector, /select disabled=\{bubble\.join_to === undefined\}/);
    assert.match(inspector, /<option value="">結合しない<\/option>/);
    assert.match(inspector, /value \? draft\.bubbles!?\[index\]\.join_to=Number\(value\) : delete draft\.bubbles!?\[index\]\.join_to/);
  }
});

test('inspector keeps authored data while hiding internal and duplicate controls', () => {
  const panelInspector = readFileSync(new URL('../src/components/PanelInspector.tsx', import.meta.url), 'utf8');
  const pageOverlayInspector = readFileSync(new URL('../src/components/PageOverlayInspector.tsx', import.meta.url), 'utf8');
  const poseEditor = readFileSync(new URL('../src/components/FigureHumanPoseEditor.tsx', import.meta.url), 'utf8');
  const layerEffects = readFileSync(new URL('../src/components/PaintLayerEffects.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  for (const inspector of [panelInspector, pageOverlayInspector]) {
    assert.doesNotMatch(inspector, /文字を編集|素材から入れ替え|bubble-direct-actions/);
  }
  assert.doesNotMatch(panelInspector, /<Field label="組み方向"|>BBOX\s*</);
  assert.doesNotMatch(panelInspector, /コマ詳細設定|panel-detail-settings/);
  assert.match(panelInspector, /<details class="bg-selector background-detail-settings">\s*<summary>背景詳細度<\/summary>/);
  assert.doesNotMatch(panelInspector, /<details class="bg-selector background-detail-settings" open/);
  assert.match(panelInspector, /class="secondary-button background-detail-3d-edit" disabled=\{locked\} onClick=\{onOpenBackground3d\}/);
  assert.match(panelInspector, /<SectionTitle title="背景資料"/);
  assert.match(app, /actOnLayer\(index,\{type:'background3d',key:'background'\},makePaintScene\(documentRef\.current,index,activePage,false\)\)/);
  assert.match(poseEditor, />3D編集<\/button>/);
  assert.doesNotMatch(poseEditor, /ポーズ・アングル|3Dでポーズ/);
  assert.doesNotMatch(layerEffects, /<h3 class="paint-panel-title">トーン設定<\/h3>/);
  assert.match(css, /\.inspector-category-section > \.section-title \{[^}]*background: #dfede3;[^}]*color: #334b3e;/);
  assert.match(css, /\.bg-option--1 span \{[^}]*color: #161616;[^}]*-webkit-text-fill-color: #161616;/);
});

test('vector bubble outlines and tails are not clipped by the editable bubble box', () => {
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  const hiddenOverflowSelectors = [...css.matchAll(/([^{}]+)\{[^{}]*overflow:\s*hidden;[^{}]*\}/g)]
    .map(match => match[1]);
  assert.ok(hiddenOverflowSelectors.every(selector => !selector.split(',').map(part => part.trim()).includes('.bubble-guide')));
  assert.match(css, /\.bubble-guide\s*\{[^}]*overflow:\s*visible;/);
});

test('character names use the whole figure box and stay at its lower-right corner', () => {
  assert.equal(source.match(/<FigureName name=\{figureDisplayLabel\(figure,figureIndex\)\} boxW=\{box\.w\} boxH=\{box\.h\}/g)?.length, 2);
  assert.match(component.parent.getText(ast), /<span class="figure-name-layer"><small ref=\{ref\} class="figure-name">/);
  assert.doesNotMatch(source, /<FigureName name=\{figure\.name\} boxW=\{referenceBox\.w\}/);
  const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  assert.match(css, /\.figure-name-layer \{[^}]*position:absolute;[^}]*inset:0;[^}]*display:flex;[^}]*align-items:flex-end;[^}]*justify-content:flex-end;[^}]*overflow:hidden;/);
  assert.match(css, /\.figure-guide \.figure-name \{[^}]*position:static;[^}]*width:max-content;[^}]*max-width:100%;[^}]*overflow:hidden;[^}]*text-align:right;/);
  assert.doesNotMatch(css, /\.figure-guide \.figure-name \{[^}]*text-align:center;/);
  assert.doesNotMatch(css, /\.figure-guide:not\(\.is-object\) \.figure-name/);
});

test('an explicit point size is not shrunk even when the text overflows',()=>{
  const properties=new Map();let effect;
  const el={style:{setProperty:(k,v)=>properties.set(k,v),getPropertyValue:k=>properties.get(k)},
    scrollWidth:200,clientWidth:20,scrollHeight:200,clientHeight:20,getBoundingClientRect:()=>({width:20}),
    querySelector:()=>({}),parentElement:{getBoundingClientRect:()=>({x:0,y:0,width:20,height:20})}};
  const context={useRef:()=>({current:el}),useLayoutEffect:fn=>{effect=fn},getComputedStyle:()=>({width:'20px'}),
    bubbleCssFontFamily:font=>font,textStyleCss:()=>({fontSize:'2cqw'}),h:(type,props,...children)=>({type,props,children}),
    document:{createRange:()=>({selectNode:()=>{},getBoundingClientRect:()=>({x:0,y:0,width:200,height:200})}),fonts:{addEventListener:()=>{},removeEventListener:()=>{}}}};
  runInNewContext(`${javascript}\nBubbleText({text:'長い文字列'.repeat(20),font:'test',lengthClass:'is-very-long',boxW:20,boxH:20,fitEpoch:1,style:{fontSize:12}})`,context);
  effect();assert.equal(properties.get('--bubble-fit'),'1');
});
