import assert from 'node:assert/strict';
import test from 'node:test';
import {applyBackgroundCameraShift,shiftBackgroundCamera,backgroundAxisProjection,backgroundCameraAtAxis,orbitBackgroundCamera,focusBackgroundCamera,focusBackgroundPointCamera,dollyBackgroundCamera} from '../src/lib/background3dCamera.ts';
import {Box3,PerspectiveCamera,Vector3} from 'three';
const camera={position:[9,6,14],target:[2,1,3],fov:57};
const distance=c=>Math.hypot(...c.position.map((p,i)=>p-c.target[i]));
test('axis views retain the point of interest, distance and field of view',()=>{
 for(const [axis,index] of [['x',0],['y',1],['z',2]])for(const sign of [1,-1]){
  const result=backgroundCameraAtAxis(camera,`${sign<0?'-':''}${axis}`);
  assert.deepEqual(result.target,camera.target);assert.equal(result.fov,57);assert.ok(Math.abs(distance(result)-distance(camera))<1e-10);
  assert.ok(Math.abs((result.position[index]-result.target[index])/distance(result)-sign)<1e-10);
  assert.ok(result.position.every(Number.isFinite));
 }
 assert.deepEqual(camera,{position:[9,6,14],target:[2,1,3],fov:57});
});
test('gizmo dragging orbits smoothly and clamps at the poles without crossing the floor axis',()=>{
 for(const dy of [-10000,-20,20,10000]){
  const result=orbitBackgroundCamera(camera,35,dy);assert.ok(result.position.every(Number.isFinite));
  assert.deepEqual(result.target,camera.target);assert.ok(Math.abs(distance(result)-distance(camera))<1e-10);
  assert.ok(Math.hypot(result.position[0]-camera.target[0],result.position[2]-camera.target[2])>0);
 }
 const left=orbitBackgroundCamera({position:[0,0,10],target:[0,0,0],fov:40},30,0);assert.ok(left.position[0]<0);
});
test('projected axes agree with the camera view and preserve depth ordering',()=>{
 const axes=backgroundAxisProjection({position:[0,0,10],target:[0,0,0],fov:40});
 assert.equal(axes.length,6);assert.equal(axes.find(a=>a.id==='x').x,1);assert.equal(axes.find(a=>a.id==='y').y,1);
 assert.equal(axes.find(a=>a.id==='z').z,1);assert.ok(axes.every((a,i)=>i===0||axes[i-1].z<=a.z));
});
test('focusing frames an off-centre object at any panel aspect and retains its orbit centre',()=>{
 const bounds=new Box3(new Vector3(12,1,-5),new Vector3(14,4,-3)),centre=bounds.getCenter(new Vector3());
 for(const aspect of [.25,1,3]){
  const focused=focusBackgroundCamera(camera,bounds,aspect);
  assert.deepEqual(focused.target,centre.toArray());assert.equal(focused.fov,camera.fov);
  const dir=c=>new Vector3(...c.position).sub(new Vector3(...c.target)).normalize();assert.ok(dir(focused).distanceTo(dir(camera))<1e-10);
  const projection=new PerspectiveCamera(focused.fov,aspect,.001,10000);projection.position.fromArray(focused.position);projection.lookAt(centre);projection.updateMatrixWorld(true);
  for(const x of [12,14])for(const y of [1,4])for(const z of [-5,-3]){const p=new Vector3(x,y,z).project(projection);assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&Math.abs(p.z)<1);}
  assert.deepEqual(orbitBackgroundCamera(focused,30,20).target,focused.target);
  assert.deepEqual(backgroundCameraAtAxis(focused,'x').target,focused.target);
 }
});
test('direct camera distance changes magnification without altering field of view or the selected centre',()=>{
 const close=dollyBackgroundCamera(camera,.2);
 assert.ok(Math.abs(distance(close)-distance(camera)*.2)<1e-10);assert.equal(close.fov,camera.fov);assert.deepEqual(close.target,camera.target);
 assert.ok(Math.abs(distance(dollyBackgroundCamera(camera,1e-9,.05,100))-.05)<1e-10);
 assert.ok(Math.abs(distance(dollyBackgroundCamera(camera,1e9,.05,100))-100)<1e-10);
 assert.equal(dollyBackgroundCamera(camera,NaN),camera);
});

test('a furniture corner becomes the centre without jumping the viewing direction or lens',()=>{
 const point=[.98,1.2,-.4],next=focusBackgroundPointCamera(camera,point);
 assert.deepEqual(next.target,point);assert.equal(next.fov,camera.fov);assert.ok(Math.abs(distance(next)-distance(camera))<1e-10);
 next.position.forEach((n,i)=>assert.ok(Math.abs(n-next.target[i]-(camera.position[i]-camera.target[i]))<1e-10));
 assert.deepEqual(dollyBackgroundCamera(orbitBackgroundCamera(next,20,40),.3).target,point);
});

const project=(view,point)=>{const lens=new PerspectiveCamera(view.fov,1.4,.001,10000);applyBackgroundCameraShift(lens,view);lens.position.fromArray(view.position);lens.lookAt(new Vector3(...view.target));lens.updateMatrixWorld(true);return new Vector3(...point).project(lens);};
test('off-centre surface pivots retain screen position through orbit, axis selection and zoom',()=>{
 const point=[3,2,4],before=project(camera,point),radius=new Vector3(...camera.position).distanceTo(new Vector3(...point));
 const moves=[orbitBackgroundCamera(camera,29,15,point),backgroundCameraAtAxis(camera,'x',point),backgroundCameraAtAxis(camera,'y',point),dollyBackgroundCamera(camera,.8,1e-6,1e12,point)];
 for(const [i,next] of moves.entries()){
  const after=project(next,point);assert.ok(Math.abs(after.x-before.x)<1e-9&&Math.abs(after.y-before.y)<1e-9);
  assert.ok(Math.abs(new Vector3(...next.position).distanceTo(new Vector3(...point))-radius*(i===3?.8:1))<1e-8);assert.equal(next.fov,camera.fov);
 }
 assert.deepEqual(camera,{position:[9,6,14],target:[2,1,3],fov:57});
});

test('picture framing translates every depth equally and preserves the selected pivot through later orbit and zoom',()=>{
 const shifted=shiftBackgroundCamera(camera,.13,-.08);
 assert.deepEqual(shifted.position,camera.position);assert.deepEqual(shifted.target,camera.target);assert.equal(shifted.fov,camera.fov);
 for(const point of [[3,2,4],[1,0,-5],[5,4,8]]){
  const before=project(camera,point),after=project(shifted,point);
  assert.ok(Math.abs(after.x-before.x-.26)<1e-10);assert.ok(Math.abs(after.y-before.y-.16)<1e-10);assert.equal(after.z,before.z);
 }
 const point=[3,2,4],before=project(shifted,point);
 for(const next of [orbitBackgroundCamera(shifted,29,15,point),backgroundCameraAtAxis(shifted,'x',point),dollyBackgroundCamera(shifted,.8,1e-6,1e12,point)]){
  const after=project(next,point);assert.ok(Math.abs(after.x-before.x)<1e-9&&Math.abs(after.y-before.y)<1e-9);assert.deepEqual(next.shift,shifted.shift);
 }
 assert.equal(focusBackgroundCamera(shifted,new Box3(new Vector3(-1,-1,-1),new Vector3(1,1,1)),1).shift,undefined);
 const lens=new PerspectiveCamera(40,1.5,.1,100),original=lens.projectionMatrix.toArray();applyBackgroundCameraShift(lens,shifted);applyBackgroundCameraShift(lens,camera);
 assert.deepEqual(lens.projectionMatrix.toArray(),original);
});
