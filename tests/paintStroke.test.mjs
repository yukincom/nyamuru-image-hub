import { applyInkAntialias } from '../src/lib/vectorRenderer.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePaintDocument } from '../src/lib/paintDocument.ts';
import { PaintSmoother, pressureRadius } from '../src/lib/paintStroke.ts';
import { drawPaintStroke, paintPreviewRenderer, renderPaintPng } from '../src/lib/paintRenderer.ts';
import {paintStrokeBounds,previewPaintStroke} from '../src/lib/paintGesture.ts';

const point=(x,time,pressure=.5)=>({x,y:x,pressure,time});
test('stabilisation off preserves irregular position and pressure; invalid timestamp deltas cannot reverse the clock',()=>{
  const smoother=new PaintSmoother(0);
  assert.deepEqual(smoother.push(point(3,10)),point(3,0));
  assert.deepEqual(smoother.push(point(5,10,.8)),point(5,4,.8));
  assert.deepEqual(smoother.push(point(-1,5,.2)),point(-1,8,.2));
  assert.deepEqual(smoother.push(point(20,500)),point(20,258));
  assert.deepEqual(smoother.push(point(25,100000)),point(25,262));
});
test('time-window smoothing favours fresh samples and pressure changes width, not ink opacity',()=>{
  const smoother=new PaintSmoother(2);smoother.push(point(0,0,.1));
  const p=smoother.push(point(10,8,.9));assert.ok(p.x>5&&p.x<10);assert.ok(p.pressure>.5&&p.pressure<.9);
  const fresh=smoother.push(point(100,100,.4));assert.equal(fresh.x,100);
  assert.equal(pressureRadius(10,1),5);assert.ok(pressureRadius(10,.2)<pressureRadius(10,.8));
});

function fakeCanvasWorld() {
  const canvases=[];
  const create=()=>{
    const ops=[],stack=[];
    const ctx={globalAlpha:1,globalCompositeOperation:'source-over',ops,
      save(){stack.push([this.globalAlpha,this.globalCompositeOperation]);},restore(){[this.globalAlpha,this.globalCompositeOperation]=stack.pop();},
      clearRect(){ops.push(['clear']);},setTransform(){},scale(){},translate(){},beginPath(){},moveTo(){},lineTo(){},rect(){},ellipse(){},arc(){},clip(){ops.push(['clip']);},
      fill(){ops.push(['fill',this.globalCompositeOperation,this.globalAlpha]);},stroke(){ops.push(['stroke',this.globalCompositeOperation,this.globalAlpha]);},drawImage(source){ops.push(['image',source,this.globalCompositeOperation,this.globalAlpha]);}};
    const canvas={width:0,height:0,getContext:()=>ctx,toBlob:callback=>callback(new Blob(['png'],{type:'image/png'}))};canvases.push(canvas);return canvas;
  };
  return {canvases,create};
}
const pen={tool:'pen',size:4,color:'#000000',points:[point(1,0),point(6,4)]};
const erase={...pen,tool:'eraser'};
const layer=(id,strokes)=>({id,name:id,visible:true,locked:false,opacity:1,blend:'normal',strokes});

test('500 retained strokes are not replayed over 120 production preview updates',t=>{
  const world=fakeCanvasWorld(),previous=globalThis.document;
  globalThis.document={createElement:world.create};t.after(()=>{if(previous)globalThis.document=previous;else delete globalThis.document;});
  let oldReads=0;
  const old=Array.from({length:500},()=>({...pen,get points(){oldReads++;return pen.points;}}));
  const ink=layer('ink',old),paint={version:1,width:600,height:600,dpi:100,layers:[ink]},frame={x:0,y:0,w:100,h:100};
  const scene={frame,owners:[{key:'ink',kind:'background',index:0,label:'ink',frame,paint}]};
  const canvas=world.create();canvas.width=canvas.height=600;const renderer=paintPreviewRenderer(),images=new Map();
  renderer.draw(canvas,paint,images);assert.ok(oldReads>=500);oldReads=0;
  let previousPreview;
  for(let i=0;i<120;i++){
    const mark={...pen,points:[point(20,0),point(20+i,1)]};
    const preview=previewPaintStroke(scene,{ownerKey:'ink',layerId:'ink',stroke:mark,bounds:paintStrokeBounds(mark)},previousPreview);
    renderer.draw(canvas,preview.owner.paint,images,preview.live);previousPreview=preview;
  }
  assert.equal(oldReads,0,'retained strokes must stay cached across live frames');
  assert.equal(ink.strokes.length,500);renderer.dispose();
});

test('eraser is isolated inside each layer and preview cache is bounded across undo states',t=>{
  const world=fakeCanvasWorld(),previous=globalThis.document;
  globalThis.document={createElement:world.create};t.after(()=>{if(previous)globalThis.document=previous;else delete globalThis.document;});
  const canvas=world.create();canvas.width=100;canvas.height=100;
  const renderer=paintPreviewRenderer(),bottom=layer('bottom',[pen]);
  let top=layer('top',[pen,erase]);
  const paint={version:1,width:100,height:100,dpi:100,layers:[bottom,top]};
  renderer.draw(canvas,paint,new Map());
  const count=world.canvases.length;
  for(let i=0;i<40;i++){top={...top,strokes:[...top.strokes,pen]};renderer.draw(canvas,{...paint,layers:[bottom,top]},new Map());}
  assert.equal(world.canvases.length,count,'history must not retain another preview canvas per stroke');
  renderer.draw(canvas,paint,new Map(),{layerId:'top',stroke:erase});
  assert.equal(canvas.getContext().ops.some(op=>op[0]==='fill'&&op[1]==='destination-out'),false);
  assert.ok(world.canvases.some(c=>c!==canvas&&c.getContext().ops.some(op=>op[0]==='fill'&&op[1]==='destination-out')));
  assert.ok(canvas.getContext().ops.filter(op=>op[0]==='image').every(op=>op[2]==='source-over'));
  renderer.dispose();assert.ok(world.canvases.filter(c=>c!==canvas).every(c=>c.width===1));
});


test('export reuses a bounded set of work canvases and discards them even after export',async t=>{
  const world=fakeCanvasWorld(),previous=globalThis.document;
  globalThis.document={createElement:world.create};t.after(()=>{if(previous)globalThis.document=previous;else delete globalThis.document;});
  const paint={version:1,width:1200,height:1800,dpi:350,layers:[layer('bottom',[pen]),{...layer('top',[erase]),blend:'multiply',opacity:.5}]};
  const png=await renderPaintPng(paint,new Map());assert.equal(png.type,'image/png');assert.equal(world.canvases.length,3);
  assert.ok(world.canvases.every(c=>c.width===1&&c.height===1));
  const composites=world.canvases[0].getContext().ops.filter(op=>op[0]==='image');
  assert.deepEqual(composites.map(op=>[op[2],op[3]]),[['source-over',1],['multiply',.5]]);
});

test('ink antialias controls only edge coverage, preserving RGB and avoiding blur',()=>{
  const values=[0,40,90,127,150,210,255];
  for(const level of [0,1,2,3]){
    const data={data:new Uint8ClampedArray(values.flatMap(a=>[0,0,0,a]))};let written=false;
    applyInkAntialias({getImageData:()=>data,putImageData:()=>{written=true;}},7,1,level);
    assert.equal(written,level!==3);assert.ok(data.data.every((value,i)=>i%4===3||value===0));
    const alpha=values.map((_,i)=>data.data[i*4+3]);if(level===0)assert.deepEqual(alpha,[0,0,0,0,255,255,255]);if(level===3)assert.deepEqual(alpha,values);
  }
});

test('variable-width strokes retain positive, negative and odd-length dash patterns',async()=>{
  const {vectorDashRanges}=await import('../src/lib/vectorRenderer.ts');
  assert.deepEqual(vectorDashRanges(30,[10,5]),[[0,10],[15,25]]);
  assert.deepEqual(vectorDashRanges(30,[10,5],3),[[0,7],[12,22],[27,30]]);
  assert.deepEqual(vectorDashRanges(30,[10,5],-3),[[3,13],[18,28]]);
  assert.deepEqual(vectorDashRanges(30,[5]),[[0,5],[10,15],[20,25]]);
});


test('raster closed shapes fill before their outline, while old outlines and lines stay unfilled',()=>{
  const ops=[];
  const ctx={save(){},restore(){},beginPath(){},rect(){},ellipse(){},moveTo(){},lineTo(){},fill(){ops.push(['fill',this.fillStyle]);},stroke(){ops.push(['stroke',this.strokeStyle,this.lineWidth]);}};
  for(const tool of ['rectangle','ellipse']){
    ops.length=0;drawPaintStroke(ctx,{...pen,tool,fill:'#ffffff'});
    assert.deepEqual(ops,[['fill','#ffffff'],['stroke','#000000',4]]);
    for(const fill of [undefined,null]){ops.length=0;drawPaintStroke(ctx,{...pen,tool,fill});assert.deepEqual(ops,[['stroke','#000000',4]]);}
  }
  ops.length=0;drawPaintStroke(ctx,{...pen,tool:'line',fill:'#ffffff'});
  assert.deepEqual(ops,[['stroke','#000000',4]]);
});
test('raster fill survives the saved paint document and rejects unsupported colors',()=>{
  const shape={...pen,tool:'rectangle',fill:'#ffffff'};
  const paint={version:1,width:100,height:100,dpi:100,layers:[layer('shape',[shape])]};
  const restored=JSON.parse(JSON.stringify(paint));
  assert.doesNotThrow(()=>validatePaintDocument(restored,[]));assert.equal(restored.layers[0].strokes[0].fill,'#ffffff');
  for(const fill of [null,undefined,'#000000','#ff0000','#0000ff','#00ff00','#ffff00']){shape.fill=fill;assert.doesNotThrow(()=>validatePaintDocument(paint,[]));}
  for(const fill of ['#nothex','transparent',3]){shape.fill=fill;assert.throws(()=>validatePaintDocument(paint,[]));}
});

test('native-resolution previews retain a bounded total of layer pixels',t=>{
  const world=fakeCanvasWorld(),previous=globalThis.document;
  globalThis.document={createElement:world.create};t.after(()=>{if(previous)globalThis.document=previous;else delete globalThis.document;});
  const canvas=world.create(),renderer=paintPreviewRenderer();
  for(const [width,height] of [[2048,2048],[4961,7016]]){
    canvas.width=width;canvas.height=height;
    const paint={version:1,width,height,dpi:600,layers:Array.from({length:20},(_,i)=>layer(String(i),[pen]))};
    renderer.draw(canvas,paint,new Map());
    const retained=world.canvases.filter(c=>c!==canvas&&c.width>1&&c.height>1).reduce((sum,c)=>sum+c.width*c.height,0);
    assert.ok(retained<=16*1024*1024,`retained ${retained} layer pixels`);
    assert.equal(canvas.getContext().ops.filter(op=>op[0]==='image').length,20);
    canvas.getContext().ops.length=0;
  }
  renderer.dispose();assert.ok(world.canvases.filter(c=>c!==canvas).every(c=>c.width===1));
});
