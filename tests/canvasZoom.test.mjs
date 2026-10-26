import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {pixelZoomWidth,canvasZoomPercent,clampCanvasZoom,canvasZoomShortcut} from '../src/lib/canvasZoom.ts';
import {paintPreviewSize} from '../src/lib/paintPreviewSize.ts';

const canvasSource=readFileSync(new URL('../src/components/MangaCanvas.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/styles/global.css',import.meta.url),'utf8');

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
