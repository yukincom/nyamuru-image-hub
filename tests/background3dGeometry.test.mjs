import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleBackgroundEdges } from '../src/lib/background3dGeometry.ts';

const options={width:600,height:600,creaseAngle:30,detail:1,outlineWidth:3,detailWidth:1};
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>a.map(v=>v/Math.hypot(...a));
const multiply=(a,b)=>Array.from({length:16},(_,i)=>Array.from({length:4},(_,k)=>a[k*4+i%4]*b[Math.floor(i/4)*4+k]).reduce((sum,v)=>sum+v,0));
function camera(eye=[5,4,6],{perspective=false,near=.1,far=100,extent=3,target=[0,0,0]}={}){
  const z=unit(sub(eye,target)),x=unit(cross([0,1,0],z)),y=cross(z,x);
  const view=[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];
  const f=1/Math.tan(55*Math.PI/360);
  const projection=perspective?[f,0,0,0,0,f,0,0,0,0,-(far+near)/(far-near),-1,0,0,-2*near*far/(far-near),0]:[1/extent,0,0,0,0,1/extent,0,0,0,0,-2/(far-near),0,0,0,-(far+near)/(far-near),1];
  return multiply(projection,view);
}
function cube({scale=[1,1,1],offset=[0,0,0],unindexed=false}={}){
  const positions=[-1,-1,-1,1,-1,-1,1,1,-1,-1,1,-1,-1,-1,1,1,-1,1,1,1,1,-1,1,1].map((v,i)=>v*scale[i%3]+offset[i%3]);
  const indices=[0,2,1,0,3,2,4,5,6,4,6,7,0,4,7,0,7,3,1,2,6,1,6,5,0,1,5,0,5,4,3,7,6,3,6,2];
  return unindexed?{positions:indices.flatMap(i=>positions.slice(i*3,i*3+3)),indices:[]}:{positions,indices};
}
const rectangle=(x0,y0,x1,y1,z)=>({positions:[x0,y0,z,x1,y0,z,x1,y1,z,x0,y1,z],indices:[0,1,2,0,2,3]});
const extract=(meshes,eye=[5,4,6],config={},settings={})=>visibleBackgroundEdges(meshes,camera(eye,config),eye,{...options,...settings});
const near=(a,b,epsilon=1e-5)=>assert.ok(Math.abs(a-b)<epsilon,`${a} differs from ${b}`);
function finiteWithinFrame(result){
  for(const line of result.segments){
    for(const p of [line.a,line.b]){assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));assert.ok(p.x>=-1e-5&&p.x<=600+1e-5&&p.y>=-1e-5&&p.y<=600+1e-5);}
    assert.ok(Math.hypot(line.a.x-line.b.x,line.a.y-line.b.y)>1e-5);
  }
}
const geometryKey=line=>[line.a,line.b].map(p=>[p.x,p.y].map(v=>v.toFixed(5)).join(',')).sort().join('|');
const keys=result=>result.segments.map(geometryKey).sort();

test('three-quarter cube has nine visible edges and no face diagonals',()=>{
  for(const perspective of [false,true]){
    const result=extract([cube()],[5,4,6],{perspective});
    assert.equal(result.segments.length,9);assert.equal(result.segments.filter(s=>s.kind==='outline').length,6);
    assert.equal(result.segments.filter(s=>s.kind==='detail').length,3);assert.equal(result.stats.triangles,12);
    assert.equal(result.stats.candidates,12);finiteWithinFrame(result);
  }
});
test('face-on cube has four unique perimeter lines',()=>{
  for(const perspective of [false,true]){
    const result=extract([cube()],[0,0,5],{perspective});
    assert.equal(result.segments.length,4);assert.ok(result.segments.every(line=>line.kind==='outline'));
    assert.equal(new Set(keys(result)).size,4);finiteWithinFrame(result);
  }
});
test('occluding rectangle splits a rear edge into exact visible intervals',()=>{
  const result=extract([rectangle(-2,0,2,1,0),rectangle(-.5,-.5,.5,.5,1)],[0,0,5]);
  const bottom=result.segments.filter(line=>Math.abs(line.a.y-300)<1e-5&&Math.abs(line.b.y-300)<1e-5).sort((a,b)=>a.a.x-b.a.x);
  assert.equal(bottom.length,2);
  near(bottom[0].a.x,100);near(bottom[0].b.x,250);near(bottom[1].a.x,350);near(bottom[1].b.x,500);
  finiteWithinFrame(result);
});
test('homogeneous clipping handles a near-plane crossing and geometry behind the eye',()=>{
  const eye=[0,0,0],config={perspective:true,near:1,target:[0,0,-1]};
  const crossing={positions:[-.8,-.2,-.5,.8,-.2,-2,0,.8,-2],indices:[0,1,2]};
  const result=extract([crossing],eye,config);
  assert.equal(result.segments.length,3);finiteWithinFrame(result);
  const behind={positions:[-.5,-.5,1,.5,-.5,1,0,.5,1],indices:[0,1,2]};
  assert.equal(extract([behind],eye,config).segments.length,0);
});
test('far and side clipping emit finite in-frame segments',()=>{
  const eye=[0,0,0],config={perspective:true,near:.1,far:3,target:[0,0,-1]};
  const result=extract([{positions:[-10,0,-2,10,0,-2,0,.2,-4],indices:[0,1,2]}],eye,config);
  assert.ok(result.segments.length>0);finiteWithinFrame(result);
});
test('welded unindexed and mirrored world geometry preserve cube edges',()=>{
  const regular=extract([cube()]);
  assert.deepEqual(keys(extract([cube({unindexed:true})])),keys(regular));
  assert.deepEqual(keys(extract([cube({scale:[-1,1,1]})])),keys(regular));
  const stretched=extract([cube({scale:[-1.3,.7,1.2]})]);
  assert.equal(stretched.segments.length,9);finiteWithinFrame(stretched);
});
test('geometry retains structural edges for the surface abstraction stage instead of random thinning',()=>{
  const mesh=cube(),full=extract([mesh]);
  for(const detail of [0,.5,1])assert.deepEqual(extract([mesh],[5,4,6],{}, {detail}),full);
  assert.equal(extract([mesh],[5,4,6],{}, {creaseAngle:100}).segments.length,6);
});
test('visible perspective intervals retain their source view depth after clipping and merging',()=>{
  const eye=[0,0,5],rear=rectangle(-2,0,2,1,0),front=rectangle(-.5,-.5,.5,.5,1);
  const result=extract([rear,front],eye,{perspective:true});
  for(const edge of result.segments){assert.ok(edge.depth);for(const z of edge.depth)assert.ok(Math.abs(z-4)<1e-6||Math.abs(z-5)<1e-6);}
  const sloping={positions:[-2,0,-1,2,0,1,0,1,0],indices:[0,1,2]};
  const lines=extract([sloping],eye,{perspective:true}).segments;
  const bottom=lines.find(line=>Math.abs(line.a.y-300)<1e-5&&Math.abs(line.b.y-300)<1e-5);
  assert.ok(bottom);near(Math.min(...bottom.depth),4);near(Math.max(...bottom.depth),6);
});
test('coincident meshes do not duplicate output strokes',()=>{
  const one=extract([cube()]),two=extract([cube(),cube()]);
  assert.deepEqual(keys(one),keys(two));assert.equal(two.stats.triangles,24);
});
test('opaque surface depth handles partially hidden perspective edges',()=>{
  const eye=[0,0,5],config={perspective:true};
  const rear=rectangle(-2,0,2,1,0),front=rectangle(-.5,-.5,.5,.5,1);
  const result=extract([rear,front],eye,config);
  const bottom=result.segments.filter(line=>Math.abs(line.a.y-300)<1e-5&&Math.abs(line.b.y-300)<1e-5).sort((a,b)=>a.a.x-b.a.x);
  assert.equal(bottom.length,2);
  const f=1/Math.tan(55*Math.PI/360);
  near(bottom[0].b.x,300-.5*f/4*300);near(bottom[1].a.x,300+.5*f/4*300);finiteWithinFrame(result);
});
test('an edge crossing an occluding plane is split at its true depth intersection',()=>{
  const sloping={positions:[-2,0,-1,2,0,1,0,1,0],indices:[0,1,2]};
  const result=extract([sloping,rectangle(-1,-.5,1,.5,0)],[0,0,5]);
  const bottom=result.segments.filter(line=>Math.abs(line.a.y-300)<1e-5&&Math.abs(line.b.y-300)<1e-5).sort((a,b)=>a.a.x-b.a.x);
  assert.equal(bottom.length,2);
  near(bottom[0].a.x,100);near(bottom[0].b.x,200);near(bottom[1].a.x,300);near(bottom[1].b.x,500);
});
test('malformed and nonfinite geometry fail before returning invalid lines',()=>{
  for(const mesh of [{positions:[0,0,Infinity],indices:[]},{positions:[0,0,0,1,1,1,2,2,2],indices:[0,1,3]},{positions:[0,0],indices:[]}])assert.throws(()=>extract([mesh]));
  assert.throws(()=>visibleBackgroundEdges([cube()],[1,2],[0,0,5],options));
  assert.throws(()=>extract([cube()],[0,0,5],{}, {width:NaN}));
  assert.equal(extract([{positions:[0,0,0,1,1,1,2,2,2],indices:[]}]).segments.length,0);
});

test('many overlapping occluders keep a narrow true gap and fully hide covered edges',()=>{
  const rear=rectangle(-2,0,2,1,0),front=[];
  for(let i=0;i<64;i++)if(i!==31)front.push(rectangle(-2.5+i*5/64,-.1,-2.5+(i+1)*5/64,.1,1));
  const result=extract([rear,...front],[0,0,5]);
  const bottom=result.segments.filter(line=>Math.abs(line.a.y-300)<1e-5&&Math.abs(line.b.y-300)<1e-5);
  assert.equal(bottom.length,1);near(bottom[0].a.x,300-500/64);near(bottom[0].b.x,300);
  const closed=extract([rear,...front,rectangle(-2.5+31*5/64,-.1,0,.1,1)],[0,0,5]);
  assert.equal(closed.segments.filter(line=>Math.abs(line.a.y-300)<1e-5&&Math.abs(line.b.y-300)<1e-5).length,0);
});
