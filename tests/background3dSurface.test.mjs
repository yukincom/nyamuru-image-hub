import assert from 'node:assert/strict';
import test from 'node:test';
import {backgroundSurfaceSize,groupBackgroundSurface,surfaceBackgroundEdges} from '../src/lib/background3dSurface.ts';
const field=(sample,w=512,h=256)=>{
 const pixels=new Float32Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.set(sample(x,y),4*(y*w+x));
 return {width:w,height:h,pixels,frameWidth:w,frameHeight:h,fov:45};
};
const line=(x0,y0,x1,y1,z=10)=>({a:{x:x0,y:y0},b:{x:x1,y:y1},kind:'outline',width:1,depth:[z,z]});
const length=edges=>edges.reduce((sum,e)=>sum+Math.hypot(e.b.x-e.a.x,e.b.y-e.a.y),0);
test('zero settings preserve exact lines and the unmodified irradiance',()=>{
 const edges=[line(10,30,400,30)],input=field(()=>[.3,10,0,0]),s=groupBackgroundSurface(input,edges,0);
 assert.deepEqual(surfaceBackgroundEdges(edges,s,0,35),edges);
 for(let p=0;p<input.width*input.height;p++)assert.equal(s.texture[p*4],input.pixels[p*4]);
});
test('light gaps expand continuously from the bright end while the dark end remains connected',()=>{
 const edges=[line(2,100,510,100)],input=field(x=>[.005+(x/512)**2,10,0,0]);
 const s=groupBackgroundSurface(input,edges,0),ends=[];
 for(const gap of [.2,.4,.8]){const result=surfaceBackgroundEdges(edges,s,gap,35);assert.equal(result.length,1);assert.equal(result[0].a.x,2);ends.push(result[0].b.x);}
 assert.ok(ends[0]>ends[1]&&ends[1]>ends[2]);assert.ok(ends[2]>100);
});
test('uncovered white pixels cannot erase silhouettes or an unresolved thin feature',()=>{
 const edges=[line(100,20,100,200)],input=field(x=>x===99?[.015,10,0,0]:[10,0,0,0]);
 assert.deepEqual(surfaceBackgroundEdges(edges,groupBackgroundSurface(input,edges,0),.8,35),edges);
 const empty=field(()=>[10,0,0,0]);assert.deepEqual(surfaceBackgroundEdges(edges,groupBackgroundSurface(empty,edges,1),.8,35),edges);
});
test('an unrelated dark background does not protect a lit foreground edge',()=>{
 const edges=[line(100,20,100,200)],input=field(x=>x<100?[1,10,0,0]:[.001,100,0,0]);
 assert.equal(surfaceBackgroundEdges(edges,groupBackgroundSurface(input,edges,0),.8,35).length,0);
 const corner=field(x=>x<100?[1,10,0,0]:[.005,10,0,0]);
 assert.deepEqual(surfaceBackgroundEdges(edges,groupBackgroundSurface(corner,edges,0),.8,35),edges);
});
function fence(){
 const edges=[];
 const rail=x=>x>=40&&x<200&&!(x>=108&&x<140)&&x%4<2||x>=430&&x<432;
 for(let x=1;x<512;x++)if(rail(x)!==rail(x-1))edges.push(line(x,30,x,210));
 const input=field((x,y)=>y>=30&&y<=210&&rail(x)?[x%8<4?.005:.35,10,0,0]:[.01,40,0,0]);
 return {input,edges};
}
test('dense fence interiors group while isolated rails and wide openings retain boundaries',()=>{
 const {input,edges}=fence(),s=groupBackgroundSurface(input,edges,1),out=surfaceBackgroundEdges(edges,s,0,35);
 assert.ok(length(out)<length(edges)*.7,`${length(out)} / ${length(edges)}`);
 for(const x of [40,106,140,198,430,432])assert.ok(out.some(e=>e.a.x===x&&e.a.y<=50&&e.b.y>=190),`boundary ${x}`);
 // Adjacent shade samples now share a surface-scale irradiance, instead of
 // retaining alternating dark/light strips in the tone calculation.
 const p=(100*512+80)*4,q=(100*512+84)*4;
 assert.ok(Math.abs(s.texture[p]-s.texture[q])<Math.abs(input.pixels[p]-input.pixels[q])*.4);
 assert.ok(s.texture[p+2]>.45);
});
test('large depth steps survive inside otherwise dense regions',()=>{
 const {input,edges}=fence();
 for(let y=125;y<256;y++)for(let x=40;x<200;x++)input.pixels[(y*512+x)*4+1]+=8;
 const seam=line(40,125,200,125,18);edges.push(seam);
 const out=surfaceBackgroundEdges(edges,groupBackgroundSurface(input,edges,1),0,35);
 assert.ok(length(out.filter(e=>e.a.y===125&&e.b.y===125))>140);
});
test('an oblique repeated surface keeps its real depths and groups its far gaps without crossing a true step',()=>{
 const depth=(x,step=false)=>1/(1/8-(x-40)*(1/8-1/40)/432-(step&&x>=256?.02:0));
 const rail=x=>x>=40&&x<472&&x%4<2;
 const edges=[];for(let x=40;x<472;x++)if(rail(x)!==rail(x-1))edges.push(line(x,30,x,226,depth(x)));
 const input=field((x,y)=>rail(x)&&y>=30&&y<=226?[.2,depth(x+.5),0,0]:[0,0,0,0]);
 const grouped=groupBackgroundSurface(input,edges,1),at=(x,y=100)=>(y*512+x)*4;
 for(const x of [80,200,440])assert.equal(grouped.texture[at(x)+1],input.pixels[at(x)+1],'occupied depth must not be smoothed');
 assert.equal(grouped.texture[at(434)+3],1,'far small gap closes on a continuous receding plane');
 assert.ok(Math.abs(grouped.texture[at(434)+1]-depth(434.5))<1e-4,'bridge uses screen-weighted inverse depth');
 const interior=edges.filter(e=>e.a.x>=412&&e.a.x<458);
 assert.ok(length(surfaceBackgroundEdges(interior,grouped,0,35))<length(interior)*.2);
 const stepped=field((x,y)=>rail(x)&&y>=30&&y<=226?[.2,depth(x+.5,true),0,0]:[0,0,0,0]);
 assert.equal(groupBackgroundSurface(stepped,edges,1).texture[at(254)+3],0,'independent surfaces must not be bridged across a depth step');
});
test('a newly closed foreground gap hides rear lines even when their normal contrast is strong',()=>{
 const {input,edges}=fence();
 for(let y=0;y<input.height;y++)for(let x=0;x<input.width;x++){const p=(y*input.width+x)*4;if(input.pixels[p+1]===40)input.pixels[p+1]=10.6;input.pixels[p+2]=x<83?.8:-.8;}
 const rear=line(83,60,83,180,10.6),s=groupBackgroundSurface(input,edges,1);
 const p=(100*512+83)*4;assert.equal(s.texture[p+3],1);assert.ok(s.texture[p+1]<10.1);
 assert.equal(surfaceBackgroundEdges([rear],s,0,35).length,0);
});
test('maximum omission can reduce a dense compact mass to its perimeter instead of preserving its constituent folds',()=>{
 const edges=[];for(let x=20;x<=492;x+=2)edges.push(line(x,30,x,210));
 // Distinct small leaf faces, with a broad change in their average orientation;
 // two huge perfectly flat faces would instead describe a structural corner.
 const input=field((x,y)=>x>=20&&x<492&&y>=30&&y<=210?[.15,10,(x<256?1:-1)*((Math.floor(x/4)+Math.floor(y/4))%2?.55:.85),0]:[0,0,0,0]);
 const interior=line(256,60,256,180),outer=line(20,60,20,180);
 const moderate=groupBackgroundSurface(input,edges,.5),maximum=groupBackgroundSurface(input,edges,1);
 assert.ok(length(surfaceBackgroundEdges([interior],moderate,0,35))>100);
 assert.equal(surfaceBackgroundEdges([interior],maximum,0,35).length,0);
 assert.deepEqual(surfaceBackgroundEdges([outer],maximum,0,35),[outer]);
});
test('a fence foot remains connected and its receiving floor retains the cast shadow at maximum omission',()=>{
 const edges=[];for(let x=40;x<240;x+=4)edges.push(line(x,30,x,180),line(x+2,30,x+2,180));
 const bottom=line(40,180,240,180);edges.push(bottom);
 const input=field((x,y)=>x>=40&&x<240&&y>=30&&y<180&&(x%4<2||y>=170)?[.35,10,0,0]:[y>=180&&y<215&&x>=40&&x<260?.005:.35,10.1,0,1]);
 const s=groupBackgroundSurface(input,edges,1),out=surfaceBackgroundEdges([bottom],s,0,35);
 assert.ok(length(out)>195,'lower rail/floor boundary stays continuous');
 for(const [x,y] of [[60,182],[120,190],[240,200],[270,190]]){
  const p=(y*512+x)*4;assert.equal(s.texture[p],input.pixels[p],'do not average cast shadows with the surrounding lit floor');assert.equal(s.texture[p+2],0);
 }
 const interior=edges.filter(e=>e.a.x===80&&e.b.y===180);
 assert.ok(length(surfaceBackgroundEdges(interior,s,0,35))<length(interior)*.5,'repeated interiors still simplify over a coherent floor');
 for(let y=30;y<180;y++)for(let x=40;x<60;x++)input.pixels.set([.35,10,0,0],(y*512+x)*4);
 const connected=groupBackgroundSurface(input,edges,1);
 assert.ok(length(surfaceBackgroundEdges(interior,connected,0,35))<length(interior)*.5,'a wide post cannot protect all the thin rails attached to it');
});
test('analysis scale is bounded and grouping is deterministic',()=>{
 assert.deepEqual(backgroundSurfaceSize(4000,3000),{width:1024,height:768});
 assert.deepEqual(backgroundSurfaceSize(600,300),{width:600,height:300});
 const {input,edges}=fence(),a=groupBackgroundSurface(input,edges,.7),b=groupBackgroundSurface(input,edges,.7);
 assert.deepEqual(a.texture,b.texture);assert.deepEqual(surfaceBackgroundEdges(edges,a,.5,35),surfaceBackgroundEdges(edges,b,.5,35));
});
test('grazing structural boundaries remain protected after translating the camera composition',()=>{
 const w=512,h=256,footprint=2*Math.tan(Math.PI/8)/h;
 for(const shift of [0,100]){
  const cx=w/2+shift,edge=line(cx,64,cx,192),input=field(x=>x<cx?[.2,10/(1-10*footprint*(x+.5-cx)),10/11,0]:[.2,10.5,0,0]);
  // A nearly edge-on plane meets a broad receiving surface. Keep the raw
  // plane equation identical while the principal point and image move.
  const s=groupBackgroundSurface(input,[],0);s.radius=40;s.amount=1;s.principalPoint=[cx,h/2];s.planes=new Uint32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;s.texture[p*4+2]=1;s.planes[p]=x>=cx?1:0;}
  assert.deepEqual(surfaceBackgroundEdges([edge],s,0,35),[edge],`camera shift ${shift}`);
 }
});
test('a continuous receding plane does not regain dense lines because pixel centres miss an oblique edge',()=>{
 const depth=(x,y)=>1/(.02+.0009*(x-240)+.0008*(y-120));
 const input=field((x,y)=>depth(x+.5,y+.5)>0?[.2,depth(x+.5,y+.5),0,0]:[0,0,0,0]);
 const s=groupBackgroundSurface(input,[],.4),edge=line(240.25,110,240.25,130);
 edge.depth=[depth(edge.a.x,edge.a.y),depth(edge.b.x,edge.b.y)];
 s.planes.fill(0);for(let p=0;p<input.width*input.height;p++)s.texture[p*4+2]=1;
 assert.ok(length(surfaceBackgroundEdges([edge],s,0,35))<1,'subpixel sampling must not misidentify a perspective slope as a depth step');
});
