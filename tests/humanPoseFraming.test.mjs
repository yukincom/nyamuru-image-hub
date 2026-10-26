import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { humanPoseFraming, applyHumanPoseFraming, humanPosePanelCutFrame, humanPoseCutOutline, humanPosePreviewWindow, humanPoseReferencePixels, MANUAL_HUMAN_POSE_FRAMING } from '../src/lib/humanPoseFraming.ts';
import { paintReferenceBox } from '../src/lib/paintDocument.ts';
import { applyBackgroundCameraShift } from '../src/lib/background3dCamera.ts';
import { validateHumanPoseScene } from '../src/lib/humanPoseScene.ts';

const points = () => new Map(Object.entries({
  headCentre:[0,1.7,0],headTop:[0,1.85,0],head:[0,1.6,0],neck01:[0,1.48,0],
  'upperarm01.L':[.24,1.42,0],'upperarm01.R':[-.24,1.42,0],spine02:[0,1.25,0],spine04:[0,.9,0],
  'upperleg01.L':[.1,.86,0],'upperleg01.R':[-.1,.86,0],
  'lowerleg01.L':[.1,.45,0],'lowerleg01.R':[-.1,.45,0],'heel.L':[.1,0,0],'heel.R':[-.1,0,0],
}).map(([id,p])=>[id,new Vector3(...p)]));
function setup(aspect=1,shift=[0,0]) {
  const lens=new PerspectiveCamera(40,aspect,.01,100);lens.position.set(0,1,5);lens.lookAt(0,1,0);lens.updateMatrixWorld(true);
  const hash='a'.repeat(64);
  const scene={version:1,source:{base_sha256:hash,rig_sha256:hash,pose_sha256:hash,rig_signature:hash,pose_revision:1},
    placement:{position:[0,0,0],yaw_degrees:0},camera:{position:[0,1,5],target:[0,1,0],fov:40,shift},projection:'perspective',up:[0,1,0],frame:{width:Math.round(1024*aspect),height:1024}};
  applyBackgroundCameraShift(lens,scene.camera);return {lens,scene};
}
const screen=(point,lens)=>{const p=point.clone().project(lens);return{x:(p.x+1)/2,y:(1-p.y)/2};};

test('a panel capture preserves paper coordinates at every depth without changing the saved crop',()=>{
  const panel={shape:{type:'polygon',points:[[10,20],[130,30],[110,190],[10,180]]}},frame={x:50,y:60,w:30,h:70};
  const cut=humanPosePanelCutFrame(panel,frame),{lens,scene}=setup(frame.w/frame.h);
  scene.framing={size:'bust-up',crop:{x:.15,y:.1,w:.45,h:.45}};
  const before=structuredClone(scene),samples=[new Vector3(-.2,1.2,-2),new Vector3(.3,.8,0),new Vector3(0,1.5,1)];
  applyHumanPoseFraming(lens,scene);const original=samples.map(p=>screen(p,lens));
  applyHumanPoseFraming(lens,scene,cut.bounds);
  samples.forEach((p,i)=>{const actual=screen(p,lens);assert.ok(Math.abs(10+actual.x*120-(frame.x+original[i].x*frame.w))<1e-10);assert.ok(Math.abs(20+actual.y*170-(frame.y+original[i].y*frame.h))<1e-10);});
  assert.deepEqual(scene,before);
  const window=humanPosePreviewWindow(cut);assert.ok(window.w>cut.bounds.w&&window.h>cut.bounds.h);
  const outline=humanPoseCutOutline(cut);assert.equal((outline.match(/L/g)||[]).length,3);assert.ok(outline.endsWith('Z'));
});
test('adopting a panel-sized image retains the original guide including contain padding',()=>{
  for(const [reference,frame,width,height] of [[{x:50,y:60,w:30,h:70},{x:10,y:20,w:120,h:170},736,1024],[{x:-10,y:40,w:60,h:90},{x:0,y:0,w:200,h:100},1024,600]]){
    const paint={width,height,referenceFrame:humanPoseReferencePixels(reference,frame,width,height)};
    const actual=paintReferenceBox(paint,frame);
    for(const key of ['x','y','w','h'])assert.ok(Math.abs(actual[key]-reference[key])<1e-10);
  }
});

test('projection crop matches image cropping at every depth and retains camera orientation and shift',()=>{
  for(const aspect of [.5,1,2])for(const shift of [[0,0],[.12,-.08]]){
    const {lens,scene}=setup(aspect,shift);scene.framing={size:'bust-up',crop:{x:.2,y:.12,w:.4,h:.4}};
    const before={position:lens.position.clone(),quaternion:lens.quaternion.clone(),fov:lens.fov,scene:structuredClone(scene)};
    const samples=[new Vector3(-.2,1.2,-2),new Vector3(.3,.8,0),new Vector3(0,1.5,1)];
    const original=samples.map(p=>screen(p,lens));applyHumanPoseFraming(lens,scene);
    for(const [i,p] of samples.entries()){
      const actual=screen(p,lens);assert.ok(Math.abs(actual.x-(original[i].x-.2)/.4)<1e-10);assert.ok(Math.abs(actual.y-(original[i].y-.12)/.4)<1e-10);
    }
    assert.deepEqual(lens.position.toArray(),before.position.toArray());assert.deepEqual(lens.quaternion.toArray(),before.quaternion.toArray());assert.equal(lens.fov,before.fov);assert.deepEqual(scene,before.scene);
  }
});
test('bust crop excludes waist and feet even for a narrow frame while full-body retains feet',()=>{
  for(const aspect of [.125,.25,.5,1,2]){
    const {lens,scene}=setup(aspect),body=points();scene.framing=humanPoseFraming(body,lens,'bust-up');
    applyHumanPoseFraming(lens,scene);
    assert.ok(screen(body.get('spine02'),lens).y<1);assert.ok(screen(body.get('headTop'),lens).y>0);
    assert.ok(screen(body.get('spine04'),lens).y>1,`waist visible at ${aspect}`);
    assert.ok(screen(body.get('heel.L'),lens).y>1);
    applyBackgroundCameraShift(lens,scene.camera);scene.framing=humanPoseFraming(body,lens,'full');applyHumanPoseFraming(lens,scene);
    assert.ok(screen(body.get('heel.L'),lens).y<1);assert.ok(screen(body.get('headTop'),lens).y>0);
  }
});
test('face preset contains the entire head in portrait and landscape frames at different camera angles',()=>{
  for(const aspect of [.125,.25,.5,1,2])for(const position of [[0,1,5],[4,2,3],[1,5,2]])for(const shift of [[0,0],[.12,-.08]]){
    const {lens,scene}=setup(aspect,shift),body=points();
    lens.position.fromArray(position);lens.lookAt(0,1.5,0);lens.updateMatrixWorld(true);
    const before={position:lens.position.clone(),quaternion:lens.quaternion.clone(),fov:lens.fov};
    scene.framing=humanPoseFraming(body,lens,'face');applyHumanPoseFraming(lens,scene);
    const centre=body.get('headCentre'),radius=centre.distanceTo(body.get('headTop'));
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
      const p=screen(centre.clone().add(new Vector3(x,y,z).multiplyScalar(radius)),lens);
      assert.ok(p.x>0&&p.x<1&&p.y>0&&p.y<1,`head clipped at aspect ${aspect}: ${JSON.stringify(p)}`);
    }
    assert.deepEqual(lens.position.toArray(),before.position.toArray());assert.deepEqual(lens.quaternion.toArray(),before.quaternion.toArray());assert.equal(lens.fov,before.fov);
  }
});
test('face preset fits inside the offset polygon panel used by the 3D preview',()=>{
  const frame={x:10,y:25,w:40,h:80};
  const cut=humanPosePanelCutFrame({shape:{type:'polygon',points:[[8,12],[95,22],[90,155],[8,148]]}},frame);
  const {lens,scene}=setup(frame.w/frame.h),body=points();
  scene.framing=humanPoseFraming(body,lens,'face');applyHumanPoseFraming(lens,scene,cut.bounds);
  const centre=body.get('headCentre'),radius=centre.distanceTo(body.get('headTop'));
  for(let angle=0;angle<Math.PI*2;angle+=Math.PI/32){
    const p=screen(centre.clone().add(new Vector3(Math.cos(angle)*radius,Math.sin(angle)*radius,0)),lens);
    const paper={x:8+p.x*87,y:12+p.y*143};
    assert.ok(paper.x>8&&paper.x<90&&paper.y>22&&paper.y<148,`head clipped by panel: ${JSON.stringify(paper)}`);
  }
});
test('unknown body parts keep manual framing',()=>{
  const {lens}=setup();
  for(const size of MANUAL_HUMAN_POSE_FRAMING)assert.deepEqual(humanPoseFraming(points(),lens,size),{size,crop:{x:0,y:0,w:1,h:1}});
});
test('posed landmarks, not global height, determine a rotated or bent body crop',()=>{
  const {lens}=setup();const body=points(),before=humanPoseFraming(body,lens,'waist-up');
  for(const point of body.values())point.sub(new Vector3(0,1,0)).applyAxisAngle(new Vector3(0,0,1),Math.PI/3).add(new Vector3(.5,1,0));
  const rotated=humanPoseFraming(body,lens,'waist-up');assert.notDeepEqual(rotated.crop,before.crop);
  for(const value of Object.values(rotated.crop))assert.ok(Number.isFinite(value));
  body.get('headCentre').z=6;body.get('headTop').z=6;assert.throws(()=>humanPoseFraming(body,lens,'full'),/カメラに近すぎ/);
});
test('saved framing rejects invalid sizes, distortions and non-finite crop bounds',()=>{
  const {scene}=setup();scene.framing={size:'bust-up',crop:{x:.2,y:.1,w:.4,h:.4}};validateHumanPoseScene(scene);
  for(const change of [s=>s.framing.size=['full'],s=>s.framing.crop.x=NaN,s=>s.framing.crop.w=0,s=>s.framing.crop.h=.6]){
    const bad=structuredClone(scene);change(bad);assert.throws(()=>validateHumanPoseScene(bad),/切り取り範囲/);
  }
});
