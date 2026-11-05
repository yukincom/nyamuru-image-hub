import {readGlobalStyles} from './helpers/globalStyles.mjs';
import {mangaCanvasSource} from './editorModuleSources.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {pixelZoomWidth,canvasZoomPercent,clampCanvasZoom,canvasZoomShortcut} from '../src/lib/canvasZoom.ts';
import {paintPreviewSize} from '../src/lib/paintPreviewSize.ts';

const canvasSource=mangaCanvasSource();
const css=readGlobalStyles();

// Use the actual Space-pan effect with DOM/event doubles; it does not render a browser.
function spacePanFixture(spread=false){
 const ast=ts.createSourceFile('MangaCanvas.tsx',canvasSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect;
 const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('const onPanPointerDown'))effect=node.arguments[0].getText(ast);ts.forEachChild(node,visit);};visit(ast);assert.ok(effect);
 class Element{
  constructor(selectors=[]){this.selectors=selectors;this.events=new Map();this.scrollLeft=200;this.scrollTop=180;this.partner=false;}
  closest(selector){return selector==='.is-spread-partner'?(this.partner?this:null):selector.split(',').some(item=>this.selectors.includes(item.trim()))?this:null;}
  matches(){return false;}
  addEventListener(type,fn){this.events.set(type,fn);}
  removeEventListener(type){this.events.delete(type);}
 }
 const scroll=new Element(),surface=spread?new Element():scroll,window=new Element(),classes=new Set(),pressed={current:false};
 const classList={add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name))};
 const cleanup=runInNewContext(ts.transpileModule(`(${effect})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,
  {Element,window,document:{body:{classList}},scrollRef:{current:scroll},spacePressedRef:pressed,spreadScrollFor:()=>spread?surface:null,cleanupRef:{current:null},paintInputActive:{current:false}})();
 const key=(type,target=new Element(),extra={})=>{const event={code:'Space',target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};window.events.get(type)?.(event);return event;};
 return {Element,scroll,surface,window,classes,pressed,key,cleanup};
}

// 見込み: 画面上のpointerを優先すれば、残ったfolder-buttonのfocusでSpaceを奪われない。
// 合格: 画面内ではbutton/link/summaryのSpaceをpanに使い、画面外と入力/選択/menu/dialog/IMEは保持。
// 範囲: 本体effectのevent分岐。DOMはdoubleで、フォルダー開閉と実移動はbrowser fixtureで確認する。
test('Space over the canvas overrides stale button focus while text and menus retain it',()=>{
 for(const spread of [false,true]){
  const f=spacePanFixture(spread);
  for(const selector of ['button','a','summary']){
   const target=new f.Element([selector]);
   assert.equal(f.key('keydown',target).defaultPrevented,false);
   f.surface.events.get('pointerenter')();assert.equal(f.key('keydown',target).defaultPrevented,true);assert.equal(f.pressed.current,true);
   assert.equal(f.key('keyup',target).defaultPrevented,true);assert.equal(f.pressed.current,false);
   f.surface.events.get('pointerleave')();assert.equal(f.key('keydown',target).defaultPrevented,false);
  }
  f.surface.events.get('pointerenter')();
  for(const selector of ['input','textarea','select','[contenteditable="true"]','[role="dialog"]','[role="menu"]']){
   const target=new f.Element([selector]);assert.equal(f.key('keydown',target).defaultPrevented,false,selector);assert.equal(f.key('keyup',target).defaultPrevented,false,selector);
  }
  assert.equal(f.key('keydown',undefined,{isComposing:true}).defaultPrevented,false);assert.equal(f.key('keyup',undefined,{isComposing:true}).defaultPrevented,false);
  f.scroll.partner=true;assert.equal(f.key('keydown',new f.Element(['button'])).defaultPrevented,false);
  f.cleanup();assert.equal(f.surface.events.size,0);assert.equal(f.window.events.size,0);
 }
});

// 見込み: pointerの所在をkey開始時だけに使えば、画面外へ出ても開始済みpanを確実に解放できる。
// 合格: ドラッグの差分だけscrollし、画面外buttonへのkeyup/blurでreadyとpanを解除。cleanupでlistenerなし。
// 範囲: 本体のwindow/pointer handlerとscroll値。実ブラウザーの配置・ネイティブclickは別検証。
test('Space-pan drag releases after leaving the canvas or losing window focus',()=>{
 for(const spread of [false,true]){
  const f=spacePanFixture(spread),button=new f.Element(['button']);f.surface.events.get('pointerenter')();f.key('keydown',button);
  f.surface.events.get('pointerdown')({target:f.surface,button:0,pointerType:'mouse',clientX:500,clientY:400,preventDefault(){},stopImmediatePropagation(){}});
  f.window.events.get('pointermove')({clientX:540,clientY:425,preventDefault(){}});
  assert.equal(f.surface.scrollLeft,160);assert.equal(f.surface.scrollTop,155);assert.ok(f.classes.has('is-canvas-space-panning'));
  f.surface.events.get('pointerleave')();assert.equal(f.key('keyup',button).defaultPrevented,true);assert.equal(f.classes.size,0);assert.equal(f.pressed.current,false);
  f.surface.events.get('pointerenter')();f.key('keydown',button);f.window.events.get('blur')();assert.equal(f.classes.size,0);assert.equal(f.pressed.current,false);
  f.cleanup();assert.equal(f.surface.events.size,0);assert.equal(f.window.events.size,0);
 }
});

test('100 percent maps A4 output pixels one to one on standard and Retina displays',()=>{
 for(const [dpi,width] of [[350,2894],[600,4961]])for(const dpr of [1,2,3]){
  assert.equal(Math.round(210*dpi/25.4),width);
  const css=pixelZoomWidth(width,dpr);
  assert.equal(css*dpr,width);assert.equal(canvasZoomPercent(css,css),100);
  const fit=537.37;assert.ok(canvasZoomPercent(fit,css)<100);
  assert.equal(canvasZoomPercent(css/4,css),25);
 }
 assert.equal(pixelZoomWidth(4961,NaN),4961);
 assert.equal(clampCanvasZoom(0),1);assert.equal(clampCanvasZoom(800),400);
});
test('preview tracks display device pixels and never downsamples a native-size tone',()=>{
 assert.deepEqual(paintPreviewSize(1212,1449,303,362.25,1),{width:303,height:362});
 assert.deepEqual(paintPreviewSize(1212,1449,303,362.25,2),{width:606,height:725});
 assert.deepEqual(paintPreviewSize(4961,7016,2480.5,3508,2),{width:4961,height:7016});
 assert.deepEqual(paintPreviewSize(4961,7016,4961,7016,2),{width:4961,height:7016});
});

test('tablet zoom chords preserve anchor tools, IME and text input',()=>{
 for(const modifier of ['metaKey','ctrlKey']){
  for(const key of ['+','='])assert.equal(canvasZoomShortcut({key,[modifier]:true}),1.25);
  assert.equal(canvasZoomShortcut({key:'-',[modifier]:true}),.8);
 }
 for(const key of ['+','-','='])assert.equal(canvasZoomShortcut({key}),undefined);
 assert.equal(canvasZoomShortcut({key:'+',metaKey:true},true),undefined);
 assert.equal(canvasZoomShortcut({key:'+',ctrlKey:true,isComposing:true}),undefined);
 assert.equal(canvasZoomShortcut({key:'+',ctrlKey:true,altKey:true}),undefined);
});

test('screen zoom lays out at its visible width without shrinking caret or editing strokes',()=>{
 assert.match(canvasSource,/class="manga-paper-zoom-frame"/);
 assert.match(canvasSource,/targetPaper\.style\.width=`\$\{targetWidth\}px`/);
 assert.match(canvasSource,/targetPaper\.style\.setProperty\('--canvas-layout-width',`\$\{targetWidth\}px`\)/);
 assert.match(canvasSource,/targetPaper\.style\.transform='none'/);
 assert.match(canvasSource,/frame\.style\.width=`\$\{targetWidth\}px`/);
 assert.match(canvasSource,/frame\.style\.height=`\$\{targetPaper\.getBoundingClientRect\(\)\.height\}px`/);
 assert.doesNotMatch(css.match(/\.manga-paper-zoom-frame>\.manga-paper \{[^}]*\}/)?.[0]??'',/will-change|transform/);
 const ast=ts.createSourceFile('MangaCanvas.tsx',canvasSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let body;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='setPaperVisualWidth')body=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(body);
 for(const dpi of [300,600])for(const dpr of [1,2]){
  const frame={style:{}},properties={},paper={style:{setProperty:(name,value)=>properties[name]=value},dataset:{},closest:()=>frame,getBoundingClientRect:()=>({height:parseFloat(paper.style.width)*257/182})};
  const layoutPaperWidth={current:0};let epoch=0;
  const apply=runInNewContext(ts.transpileModule(`(${body})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{paperRef:{current:paper},layoutPaperWidth,setFitEpoch:change=>epoch=change(epoch)});
  const base=pixelZoomWidth(182*dpi/25.4,dpr);
  for(const width of [358,base*.25,base,base*2]){
   const before=epoch;apply(paper,width,base);
   assert.equal(paper.style.width,`${width}px`);assert.equal(paper.style.transform,'none');assert.equal(properties['--canvas-layout-width'],`${width}px`);
   assert.equal(frame.style.height,`${width*257/182}px`);assert.ok(Math.abs(Number(paper.dataset.paperZoomScale)-width/base)<1e-12);
   assert.equal(epoch,before+1);apply(paper,width,base);assert.equal(epoch,before+1,'identical size does not cause a layout loop');
  }
 }
});

test('single and spread zoom anchor to the paper pair while viewport gutters resize once',()=>{
 const ast=ts.createSourceFile('MangaCanvas.tsx',canvasSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let body;const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='applyPaperWidth')body=node.initializer.getText(ast);ts.forEachChild(node,visit);};visit(ast);assert.ok(body);
 for(const count of [1,2]){
  const properties=new Map(),surface={clientWidth:800,clientHeight:600,scrollLeft:0,scrollTop:0,getBoundingClientRect:()=>({left:40,top:80,width:surface.clientWidth,height:surface.clientHeight})};
  const papers=Array.from({length:count},()=>({width:240,visible:true,dataset:{basePaperWidth:'1000'},getClientRects(){return this.visible?[{}]:[];},getBoundingClientRect(){return {width:this.visible?this.width:0};}}));
  const content={getBoundingClientRect:()=>({left:40+(parseFloat(properties.get('--canvas-pan-x'))||30)-surface.scrollLeft,top:80+(parseFloat(properties.get('--canvas-pan-y'))||26)-surface.scrollTop,
   width:papers.filter(p=>p.visible).reduce((sum,p)=>sum+p.width,0),height:Math.max(...papers.filter(p=>p.visible).map(p=>p.width*1.4))})};
  const stage={style:{getPropertyValue:key=>properties.get(key)??'',setProperty:(key,value)=>properties.set(key,value)},querySelector:()=>content,querySelectorAll:()=>papers};
  surface.querySelector=()=>stage;
  const layoutPaperWidth={current:240},apply=runInNewContext(ts.transpileModule(`(${body})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,
   {scrollRef:{current:{}},paperRef:{current:papers[0]},spreadScrollFor:()=>surface,basePaperWidth:{current:1000},layoutPaperWidth,
    setPaperVisualWidth:(paper,width)=>{paper.width=width;if(paper===papers[0])layoutPaperWidth.current=width;}});
  const point=(x,y)=>{const b=content.getBoundingClientRect();return [(x-b.left)/b.width,(y-b.top)/b.height];};
  const same=(actual,expected)=>actual.forEach((value,index)=>assert.ok(Math.abs(value-expected[index])<1e-9,`${actual} != ${expected}`));
  apply(300,undefined,undefined,true);same(point(440,380),[.5,.5]);
  assert.equal(properties.get('--canvas-pan-x'),'800px');assert.equal(properties.get('--canvas-pan-y'),'600px');
  surface.scrollLeft+=110;surface.scrollTop-=80;
  const cursor={x:297,y:341},before=point(cursor.x,cursor.y);apply(480,cursor.x,cursor.y);same(point(cursor.x,cursor.y),before);
  const offset=[surface.scrollLeft,surface.scrollTop];layoutPaperWidth.current=300;apply(480);same([surface.scrollLeft,surface.scrollTop],offset);assert.equal(layoutPaperWidth.current,480,'peer width update refreshes this component without another scroll correction');
  const resizeAnchor=point(440,380);surface.clientWidth=650;surface.clientHeight=450;apply(220);same(point(365,305),resizeAnchor);
  const outside=point(50,90);apply(330,50,90);same(point(50,90),outside);
  apply(330,undefined,undefined,true);same(point(365,305),[.5,.5]);
  if(count===2){papers[1].visible=false;const hiddenWidth=papers[1].width;apply(440);assert.equal(papers[1].width,hiddenWidth,'hidden facing page is not given a zero-height frame');}
 }
 assert.match(canvasSource,/--canvas-fit-inset-x/);assert.match(canvasSource,/--canvas-fit-inset-y/);
 assert.doesNotMatch(body,/stageBefore|stageAfter|clamp\(/);
});
