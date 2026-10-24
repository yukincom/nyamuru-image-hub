import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPaintTone, defaultPaintTone, newToneLayer } from '../src/lib/paintTone.ts';
import { newPaintMask, maskStroke } from '../src/lib/paintMask.ts';
import { paintInks } from '../src/lib/paintInk.ts';
import { newPaintLayer, paintForFrame, expandPaintOwner, validatePaintDocument } from '../src/lib/paintDocument.ts';
import { defaultVectorStyle } from '../src/lib/vectorGeometry.ts';

const pixels=(w,h,color=[0,0,0,255])=>({width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>color[i%4])});
const density=image=>image.data.reduce((sum,n,i)=>sum+(i%4===3?n/255:0),0)/(image.width*image.height);
const mark={tool:'rectangle',color:'#ff0000',fill:'#0000ff',size:2,points:[{x:10,y:20,pressure:1,time:0},{x:50,y:60,pressure:1,time:1}]};
const paint=()=>({version:1,width:100,height:100,dpi:100,layers:[{...newPaintLayer(),strokes:[structuredClone(mark)],mask:newPaintMask([{x:10,y:20,w:30,h:40}]),tone:defaultPaintTone()}]});

test('screen density is actual black coverage from 0 to 100 percent, with transparent gaps',()=>{
  for(const coverage of [0,10,20,50,80,95,100]){
    const image=pixels(400,400);
    applyPaintTone(image,{...defaultPaintTone(),mode:'fixed',density:coverage},600,400,400);
    assert.ok(Math.abs(density(image)-coverage/100)<.012,`${coverage}: ${density(image)}`);
    assert.ok(image.data.every((n,i)=>i%4===3?n===0||n===255:n===0));
  }
});
test('image density uses luminance; fixed density is independent of guide colors',()=>{
  for(const color of [0,64,128,192,255]){
    const image=pixels(400,400,[color,color,color,255]);applyPaintTone(image,defaultPaintTone(),600,400,400);
    assert.ok(Math.abs(density(image)-(1-color/255))<.012);
  }
  const rendered=paintInks.map(({color})=>{const image=pixels(40,40,[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)).concat(255));applyPaintTone(image,{...defaultPaintTone(),mode:'fixed',density:20},600,40,40);return image;});
  for(const image of rendered)assert.deepEqual(image,rendered[0]);
});
test('physical frequency follows DPI, padding retains dot phase, previews average subpixel dots',()=>{
  const a=pixels(100,100),b=pixels(100,100),tone={...defaultPaintTone(),mode:'fixed',density:30};
  applyPaintTone(a,tone,600,100,100);applyPaintTone(b,{...tone,lpi:30},300,100,100);assert.deepEqual(a,b);
  const shifted=pixels(120,130);applyPaintTone(shifted,{...tone,origin:{x:20,y:30}},600,120,130);
  for(let y=0;y<100;y++)for(let x=0;x<100;x++)assert.equal(a.data[(y*100+x)*4+3],shifted.data[((y+30)*120+x+20)*4+3]);
  const thumbnail=pixels(10,10);applyPaintTone(thumbnail,tone,600,100,100,true);assert.ok(Math.abs(density(thumbnail)-29/98)<=.5/255);
  const lowDpi=pixels(100,100);applyPaintTone(lowDpi,tone,100,100,100);assert.ok(lowDpi.data.every((n,i)=>i%4!==3||n===0||n===255));
});
test('disabled tone and transparent source pixels remain unchanged',()=>{
  const image=pixels(50,50,[255,0,0,70]),before=structuredClone(image);applyPaintTone(image,{...defaultPaintTone(),enabled:false},600,50,50);assert.deepEqual(image,before);
  const transparent=pixels(50,50,[90,20,10,0]);const previous=structuredClone(transparent);applyPaintTone(transparent,defaultPaintTone(),600,50,50);assert.deepEqual(transparent,previous);
});
test('mask selection snapshots and reveal strokes do not modify original colored strokes',()=>{
  const boxes=[{x:10,y:20,w:30,h:40}],mask=newPaintMask(boxes);boxes[0].x=500;assert.equal(mask.strokes[0].selection[0].x,10);
  assert.equal(mask.reveal,false);assert.equal(newPaintMask().reveal,true);assert.equal(newPaintMask([]).reveal,false);
  const normalized=maskStroke(mark);assert.equal(normalized.color,'#ffffff');assert.equal(normalized.fill,'#ffffff');assert.equal(mark.color,'#ff0000');
});
test('mask edits and dot origins follow canvas padding and reframing',()=>{
  const source=paint(),frame={x:0,y:0,w:25.4,h:25.4};
  const expanded=expandPaintOwner({key:'background',kind:'background',index:0,label:'',frame,paint:source},{left:12,right:3,top:5,bottom:10});
  assert.deepEqual(expanded.paint.layers[0].mask.strokes[0].selection,[{x:22,y:25,w:30,h:40}]);
  assert.deepEqual(expanded.paint.layers[0].tone.origin,{x:12,y:5});
  assert.equal(source.layers[0].mask.strokes[0].selection[0].x,10);
  const asset={id:'flat',storageId:'test',widthPx:100,heightPx:100};
  const reframed=paintForFrame({x:0,y:0,w:60.96,h:50.8},100,[{id:'x',assetId:'flat',bbox:{x:0,y:0,w:50.8,h:50.8},crop:{x:0,y:0,w:100,h:100},opacity:1,paint:source}],[asset]);
  assert.deepEqual(reframed.layers[0].mask.strokes[0].selection,[{x:20,y:40,w:60,h:80}]);
  validatePaintDocument(reframed,[asset]);
});
test('all six inks survive raster fill and vector validation; corrupt effects are rejected',()=>{
  for(const {color} of paintInks){
    const doc=paint();doc.layers[0].strokes[0].fill=color;
    doc.layers.push({...newPaintLayer('vector','vector'),paths:[{id:'path',closed:true,nodes:[{x:1,y:1},{x:3,y:3}],style:{...defaultVectorStyle(),stroke:color,fill:color}}]});
    validatePaintDocument(doc,[]);
  }
  for(const mutate of [p=>p.layers[0].tone.lpi=0,p=>p.layers[0].tone.density=101,p=>p.layers[0].tone.mode='bad',p=>p.layers[0].mask.enabled='yes',p=>p.layers[0].mask.strokes[0].points[0].x=NaN]){
    const doc=paint();mutate(doc);assert.throws(()=>validatePaintDocument(doc,[]));
  }
});

test('generation region hints follow padding and reframing and validate independently',()=>{
  const source=paint();source.guideInitialized=true;source.layers[0].guide=true;source.layers[0].generationMask={enabled:true,strokes:[structuredClone(mark)]};
  const expanded=expandPaintOwner({key:'figure-0',kind:'figure',index:0,label:'',frame:{x:0,y:0,w:25.4,h:25.4},paint:source},{left:10,right:0,top:20,bottom:0});
  assert.deepEqual(expanded.paint.layers[0].generationMask.strokes[0].points[0],{x:20,y:40,pressure:1,time:0});
  assert.equal(source.layers[0].generationMask.strokes[0].points[0].x,10);
  const asset={id:'flat',widthPx:100,heightPx:100};
  const reframed=paintForFrame({x:0,y:0,w:60.96,h:50.8},100,[{id:'x',assetId:'flat',bbox:{x:0,y:0,w:50.8,h:50.8},crop:{x:0,y:0,w:100,h:100},opacity:1,paint:source}],[asset]);
  assert.equal(reframed.guideInitialized,true);assert.equal(reframed.layers[0].generationMask.strokes[0].points[0].x,20);validatePaintDocument(reframed,[asset]);
  for(const mutate of [p=>p.guideInitialized='yes',p=>p.layers[0].guide='yes',p=>p.layers[0].generationMask.enabled=1,p=>p.layers[0].generationMask.strokes[0].points[0].x=NaN]){const broken=structuredClone(source);mutate(broken);assert.throws(()=>validatePaintDocument(broken,[]));}
});


test('independent tones start with empty coverage and snapshot an existing selection',()=>{
  const empty=newToneLayer();assert.equal(empty.tone.fill,true);assert.equal(empty.tone.mode,'fixed');
  assert.equal(empty.tone.angle,45);assert.equal(empty.mask.reveal,false);assert.deepEqual(empty.mask.strokes,[]);
  const boxes=[{x:2,y:3,w:20,h:30}],layer=newToneLayer(boxes);boxes[0].x=90;
  assert.equal(layer.mask.strokes[0].selection[0].x,2);assert.deepEqual(layer.strokes,[]);assert.equal(layer.image,undefined);
  const doc={version:1,width:100,height:100,dpi:600,layers:[layer]};validatePaintDocument(doc,[]);
  for(const patch of [{fill:'yes'},{fill:true,mode:'image'},{angle:-1},{angle:361},{angle:NaN}]){
    assert.throws(()=>validatePaintDocument({...doc,layers:[{...layer,tone:{...layer.tone,...patch}}]},[]));
  }
});
test('tone angle changes the dot lattice while retaining density and padding phase',()=>{
  const source=pixels(400,400),rotated=pixels(400,400),tone={...defaultPaintTone(),mode:'fixed',lpi:30,angle:0};
  applyPaintTone(source,tone,600,400,400);applyPaintTone(rotated,{...tone,angle:45},600,400,400);
  assert.notDeepEqual(source,rotated);assert.ok(Math.abs(density(source)-.2)<.02);assert.ok(Math.abs(density(rotated)-.2)<.012);
  const shifted=pixels(430,440);applyPaintTone(shifted,{...tone,angle:27,origin:{x:30,y:40}},600,430,440);
  const original=pixels(400,400);applyPaintTone(original,{...tone,angle:27},600,400,400);
  for(let y=0;y<400;y++)for(let x=0;x<400;x++)assert.equal(original.data[(y*400+x)*4+3],shifted.data[((y+40)*430+x+30)*4+3]);
});

test('native preview matches exported binary dots; reduced previews retain mean coverage through zoom',()=>{
 for(const dpi of [350,600]){
  const tone={...defaultPaintTone(),mode:'fixed',density:20,angle:45};
  const original=pixels(600,600),preview=pixels(600,600);
  applyPaintTone(original,tone,dpi,600,600);applyPaintTone(preview,tone,dpi,600,600,true);
  assert.deepEqual(preview,original);
  for(const scale of [.1,.2,.3,.4,.5,.75]){
   const reduced=pixels(Math.round(600*scale),Math.round(600*scale));
   applyPaintTone(reduced,tone,dpi,600,600,true);
   assert.ok(Math.abs(density(reduced)-density(original))<.012,`${dpi} dpi at ${scale}: ${density(reduced)} vs native ${density(original)}`);
  }
 }
});


// Count complete connected dots independently of the renderer's cell indexing.
function dotShapes(image){
  const {width,height,data}=image,seen=new Set(),shapes=new Map();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const start=y*width+x;if(seen.has(start)||!data[start*4+3])continue;
    const pending=[start],points=[];seen.add(start);let edge=false;
    while(pending.length){
      const i=pending.pop(),px=i%width,py=Math.floor(i/width);points.push([px,py]);
      if(!px||!py||px===width-1||py===height-1)edge=true;
      for(const [nx,ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]){
        const j=ny*width+nx;if(nx<0||ny<0||nx>=width||ny>=height||seen.has(j)||!data[j*4+3])continue;
        seen.add(j);pending.push(j);
      }
    }
    if(edge)continue;
    const minX=Math.min(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1]));
    const shape=points.map(([px,py])=>`${px-minX},${py-minY}`).sort().join(';');shapes.set(shape,(shapes.get(shape)??0)+1);
  }
  return shapes;
}

test('600dpi 60-line 20-percent dots share the reference 20-pixel shape and 14/7-pixel spacing',()=>{
  const image=pixels(280,280);applyPaintTone(image,{...defaultPaintTone(),mode:'fixed',density:20,angle:45},600,280,280);
  const shapes=dotShapes(image),reference=['.###.','#####','#####','#####','.##..'];
  assert.equal(shapes.size,1);const [shape,count]=[...shapes][0];assert.ok(count>700);
  assert.equal(shape,reference.flatMap((row,y)=>[...row].flatMap((pixel,x)=>pixel==='#'?[`${x},${y}`]:[])).sort().join(';'));
  assert.equal(density(image),20/98);
  for(let y=0;y<273;y++)for(let x=0;x<266;x++){
    const alpha=image.data[(y*280+x)*4+3];assert.equal(alpha,image.data[(y*280+x+14)*4+3]);assert.equal(alpha,image.data[((y+7)*280+x+7)*4+3]);
  }
});

test('all densities grow monotonically with uniform cells at preset and non-preset angles',()=>{
  for(const [dpi,lpi,angle,dx,dy] of [[600,60,0,10,0],[600,60,15,10,3],[600,60,45,7,7],[600,30,45,14,14],[350,60,45,4,4],[600,60,137,-7,7],[600,60,225,-7,-7],[600,60,315,7,-7]]){
    let previous=pixels(80,80,[0,0,0,0]);
    for(const coverage of [0,5,10,20,50,80,95,100]){
      const image=pixels(80,80);applyPaintTone(image,{...defaultPaintTone(),mode:'fixed',lpi,angle,density:coverage},dpi,80,80);
      for(let y=14;y<66;y++)for(let x=14;x<66;x++){
        const i=(y*80+x)*4+3;assert.ok(image.data[i]>=previous.data[i]);assert.equal(image.data[i],image.data[((y+dy)*80+x+dx)*4+3],`${dpi}/${lpi}/${angle}/${coverage}`);
      }
      previous=image;
    }
  }
  for(const coverage of [10,20]){
    const image=pixels(200,200);applyPaintTone(image,{...defaultPaintTone(),mode:'fixed',density:coverage},600,200,200);
    assert.equal(dotShapes(image).size,1);
  }
});

test('large cells retain binary shape and integer padding phase without large rank tables',()=>{
  const tone={...defaultPaintTone(),mode:'fixed',lpi:2,density:20,angle:45};
  const image=pixels(700,700),shifted=pixels(710,720);applyPaintTone(image,tone,600,700,700);
  applyPaintTone(shifted,{...tone,origin:{x:10,y:20}},600,710,720);
  assert.equal(dotShapes(image).size,1);assert.ok(Math.abs(density(image)-.2)<.035);
  for(let y=0;y<700;y++)for(let x=0;x<700;x++)assert.equal(image.data[(y*700+x)*4+3],shifted.data[((y+20)*710+x+10)*4+3]);
});


test('fractional origins with equal native phase also match at reduced preview sizes',()=>{
  const tone={...defaultPaintTone(),mode:'fixed',density:20,angle:45};
  for(const size of [280,210]){
    const a=pixels(size,size),b=pixels(size,size);
    applyPaintTone(a,tone,600,280,280,true);
    applyPaintTone(b,{...tone,origin:{x:.25,y:.25}},600,280,280,true);
    assert.deepEqual(a,b);
  }
});
