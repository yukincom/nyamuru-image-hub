import {applyBackgroundCameraShift,focusBackgroundCamera} from '../src/lib/background3dCamera';
import {Box3,PerspectiveCamera,Vector3} from 'three';
import {Background3dRenderer,loadStageShape,fitStageCamera} from '../src/lib/background3dRenderer';
import {defaultBackgroundCapture,prepareBackgroundStage} from '../src/lib/background3d';
import type {BackgroundCapture} from '../src/types';
import '../src/styles/global.css';
if(location.port!=='4325')throw Error('Dedicated test origin required');
const status=document.createElement('p'),host=document.createElement('div');host.style.cssText='position:relative;width:600px;height:400px;margin:60px;background:white';document.body.append(status,host);
const tick=()=>new Promise(resolve=>setTimeout(resolve,100));
const wait=async(fn:()=>boolean)=>{for(let i=0;i<100;i++){if(fn())return;await tick();}throw Error('Timed out');};
const plane=(x:number,y:number,z:number,w:number,h:number)=>({positions:[x,y,z,x+w,y,z,x+w,y+h,z,x,y+h,z],indices:[0,1,2,0,2,3]});
let config:BackgroundCapture={...defaultBackgroundCapture({x:0,y:0,w:900,h:600},150),camera:{position:[0,0,8],target:[0,0,0],fov:40},blackAmount:0,toneEnabled:false};
let report='',hitMesh:number|undefined;
const engine=new Background3dRenderer(host,config,150,camera=>{config={...config,camera};},message=>{report=message;},hit=>{
 if(hit){hitMesh=hit.mesh;config={...config,focusMesh:hit.mesh,focusPoint:hit.point};engine.configure(config);engine.setPicking(false);}
},point=>{config={...config,focusPoint:point};engine.configure(config);});
const testShape={meshes:[plane(-2,-1,0,3,2),plane(1.2,-.4,.2,.5,.8),plane(-.4,-.3,.5,.8,.6),plane(-4,-3,-1,8,6)],bounds:new Box3(new Vector3(-4,-3,-1),new Vector3(4,3,.5)),groups:[[0,1]],groupNames:['キーボード'],meshNames:['本体','キー','手前の物','背景']};engine.setShape(testShape);
const screen=(point:number[])=>{const camera=new PerspectiveCamera(config.camera.fov,1.5,.001,100);applyBackgroundCameraShift(camera,config.camera);camera.position.fromArray(config.camera.position);camera.lookAt(new Vector3(...config.camera.target));camera.updateMatrixWorld(true);const p=new Vector3(...point).project(camera),box=engine.canvas.getBoundingClientRect();return {x:box.x+(p.x+1)*box.width/2,y:box.y+(1-p.y)*box.height/2};};
const pointer=(target:EventTarget,type:string,p:{x:number;y:number},buttons=type==='pointerup'?0:1,extra:PointerEventInit={})=>target.dispatchEvent(new PointerEvent(type,{clientX:p.x,clientY:p.y,pointerId:52,pointerType:'mouse',isPrimary:true,button:0,buttons,bubbles:true,cancelable:true,...extra}));
const greenNear=(point:number[],radius=5)=>{const p=screen(point),box=engine.canvas.getBoundingClientRect(),x=Math.round((p.x-box.x)*engine.canvas.width/box.width),y=Math.round((p.y-box.y)*engine.canvas.height/box.height),data=engine.canvas.getContext('2d')!.getImageData(x-radius,y-radius,radius*2+1,radius*2+1).data;return data.some((n,i)=>i%4===0&&n<80&&data[i+1]>100&&data[i+2]<100);};
const patchCapture=(element:Element)=>{for(const name of ['setPointerCapture','releasePointerCapture','hasPointerCapture'])Object.defineProperty(element,name,{value:()=>false,configurable:true});return ()=>{for(const name of ['setPointerCapture','releasePointerCapture','hasPointerCapture'])delete (element as unknown as Record<string,unknown>)[name];};};
const checks:string[]=[];const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);status.textContent=`検証中 ${checks.length}: ${label}`;};
async function run(){
 await wait(()=>report.includes('可視線'));engine.setPicking(true);pointer(engine.canvas,'pointermove',screen([-1,0,0]),0);await tick();
 check(greenNear([-2,0,0])&&greenNear([1.7,0,.2]),'ホバーで本体と独立したキーの輪郭をまとめて緑表示');
 check(!greenNear([0,0,.5],2),'手前の別の物の中を緑で塗らない');
 const before=JSON.stringify(config.camera);pointer(engine.canvas,'pointerdown',screen([-1,0,0]));pointer(window,'pointerup',screen([-1,0,0]));await tick();
 check(hitMesh===0&&JSON.stringify(config.camera)===before,'ひとまとまりを選択しても構図を動かさない');
 const scope=document.querySelector<HTMLButtonElement>('.background3d-scope')!;check(!scope.hidden,'選択後に緑のスコープを表示');
 const restore=patchCapture(scope),move=screen([-.8,.6,0]);pointer(scope,'pointerdown',screen(config.focusPoint!));pointer(window,'pointermove',move);await tick();
 check(Math.abs(config.focusPoint![0]+.8)<1e-5&&Math.abs(config.focusPoint![1]-.6)<1e-5&&JSON.stringify(config.camera)===before,'スコープだけを可視面へドラッグし構図を保持');
 const visiblePoint=JSON.stringify(config.focusPoint);pointer(window,'pointermove',screen([0,0,.5]));await tick();check(JSON.stringify(config.focusPoint)===visiblePoint,'他の物に隠れた面は拾わない');
 pointer(window,'pointermove',screen([3,0,-1]));await tick();check(JSON.stringify(config.focusPoint)===visiblePoint,'選択対象以外の面にはスコープを移さない');
 host.dataset.panelOutline='0,0 1,0 0,1';pointer(window,'pointermove',screen([-.2,-.4,0]));await tick();check(JSON.stringify(config.focusPoint)===visiblePoint,'斜めコマの外に隠れた面へはスコープを移さない');
 const keep=config;engine.configure({...config,focusPoint:[-.2,-.4,0]});await tick();check(Boolean(scope.hidden),'斜めコマの外にある注目点は表示しない');engine.configure(keep);delete host.dataset.panelOutline;
 pointer(window,'pointerup',move);restore();check(engine.controls.enabled,'スコープのドラッグ終了後に背景操作を戻す');
 const pivot=[...config.focusPoint!],start=screen(pivot),restoreCanvas=patchCapture(engine.canvas),at=screen([-.8,-.6,0]);
 pointer(engine.canvas,'pointerdown',at);pointer(engine.canvas,'pointermove',{x:at.x+35,y:at.y+18});pointer(engine.canvas,'pointerup',{x:at.x+35,y:at.y+18});restoreCanvas();await tick();const end=screen(pivot);
 const original=JSON.parse(before);
 check(Math.hypot(end.x-start.x-35,end.y-start.y-18)<.01&&config.camera.position.every((n,i)=>Math.abs(n-original.position[i])<1e-8)&&config.camera.target.every((n,i)=>Math.abs(n-original.target[i])<1e-8),'通常ドラッグは遠近感と向きを変えず絵全体を指の距離だけ平行移動');
 check(!scope.hidden&&config.focusPoint?.every((n,i)=>n===pivot[i])===true,'絵を移動しても緑の注目点と選択を保持');
 for(const point of [[-1,.5,0],[3,0,-1]]){const p=screen(point),hit=engine.pickFocus(p.x,p.y);check(!!hit&&hit.point.every((n,i)=>Math.abs(n-point[i])<1e-5),'カット位置を移動した後も異なる奥行きの可視面を正しく選択');}
 const capture=await engine.capture();check(capture.config.focusPoint?.every((n,i)=>n===pivot[i])===true,'撮影に表面の注目点を保存');
 for(const item of capture.imports){const bitmap=await createImageBitmap(item.blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0);const data=context.getImageData(0,0,canvas.width,canvas.height).data;check(!data.some((n,i)=>i%4===0&&data[i+1]>n+20),'撮影画像へ緑の輪郭とスコープを焼き込まない');bitmap.close();}
 const regular=structuredClone(config);engine.setShape({meshes:[plane(-.003,-.002,0,.006,.004)],bounds:new Box3(new Vector3(-.003,-.002,0),new Vector3(.003,.002,0))});config={...config,focusMesh:undefined,focusPoint:undefined,camera:{position:[0,0,.01],target:[0,0,0],fov:40}};engine.configure(config);await tick();
 const closeStart=screen([0,0,0]),restoreClose=patchCapture(engine.canvas);
 pointer(engine.canvas,'pointerdown',closeStart,1,{ctrlKey:true,shiftKey:true});pointer(window,'pointermove',{x:closeStart.x+10,y:closeStart.y},1,{ctrlKey:true,shiftKey:true});pointer(window,'pointerup',{x:closeStart.x+10,y:closeStart.y},0);await tick();
 check(Math.abs((config.camera.shift?.[0]??0)-10/engine.canvas.getBoundingClientRect().width)<1e-8&&config.camera.position[2]===.01&&config.camera.target.every(n=>n===0),'近接ズーム中の10pxドラッグも修飾キーに左右されず保存');
 const closeEnd=screen([0,0,0]),closeCapture=await engine.capture();engine.configure(closeCapture.config);await tick();
 const reopened=screen([0,0,0]);check(Math.abs(closeEnd.x-closeStart.x-10)<.01&&Math.abs(reopened.x-closeEnd.x)<.01&&JSON.stringify(closeCapture.config.camera)===JSON.stringify(config.camera),'近接時の撮影と再編集でもカット位置が一致');
 pointer(engine.canvas,'pointerdown',closeEnd);pointer(window,'pointercancel',closeEnd,0);const cancelled=JSON.stringify(config.camera);pointer(window,'pointermove',{x:closeEnd.x+20,y:closeEnd.y});check(JSON.stringify(config.camera)===cancelled,'ドラッグ中断後のポインター移動は構図を変えない');
 const errors:string[]=[],onError=(event:ErrorEvent)=>{errors.push(event.message);};window.addEventListener('error',onError);
 try{
  const touch=(id:number,type:string,x:number,y:number)=>pointer(engine.canvas,type,{x,y},type==='pointerup'?0:1,{pointerType:'touch',pointerId:id});
  touch(81,'pointerdown',closeEnd.x-30,closeEnd.y);touch(82,'pointerdown',closeEnd.x+30,closeEnd.y);touch(82,'pointermove',closeEnd.x+45,closeEnd.y);touch(82,'pointerup',closeEnd.x+45,closeEnd.y);
  const oneBefore=structuredClone(config.camera);touch(81,'pointermove',closeEnd.x-20,closeEnd.y);const oneAfter=structuredClone(config.camera);
  touch(83,'pointerdown',closeEnd.x+40,closeEnd.y);touch(83,'pointermove',closeEnd.x+55,closeEnd.y);touch(83,'pointerup',closeEnd.x+55,closeEnd.y);touch(81,'pointerup',closeEnd.x-20,closeEnd.y);await tick();
  check(!errors.length&&JSON.stringify(oneBefore.position)===JSON.stringify(oneAfter.position)&&Math.abs((oneAfter.shift![0]-oneBefore.shift![0])*engine.canvas.getBoundingClientRect().width-10)<1e-5&&config.camera.position[2]<oneAfter.position[2],'2本指ズームから1本指移動へ切り替え、再びズームできる');
 }finally{window.removeEventListener('error',onError);}
 restoreClose();engine.setShape(testShape);config=regular;engine.configure(config);await tick();
 const restoreScope=patchCapture(scope);pointer(scope,'pointerdown',screen(pivot));engine.setEnabled(false);check(scope.disabled&&!engine.controls.enabled&&!scope.classList.contains('is-dragging'),'操作無効化時にスコープのドラッグも終了');restoreScope();engine.setEnabled(true);
 engine.dispose();check(!document.querySelector('.background3d-scope'),'閉じるとスコープも消える');
 status.textContent=`選択・スコープ PASS（${checks.length}項目）`;const list=document.createElement('ul');for(const label of checks){const item=document.createElement('li');item.textContent=label;list.append(item);}document.body.append(list);
}
void run().catch(error=>{status.textContent=`選択・スコープ FAIL: ${String(error)}`;});

const officeButton=document.createElement('button');officeButton.textContent='実際のキーボードの輪郭を確認';document.body.append(officeButton);
officeButton.onclick=()=>{officeButton.disabled=true;void(async()=>{
 const response=await fetch('/qa-office.glb');if(!response.ok)throw Error('Optional QA office model missing');
 const item=await prepareBackgroundStage(new File([await response.blob()],'書斎.glb')),shape=await loadStageShape(item.stage,item.blob);
 const index=shape.meshNames!.findIndex(name=>name.includes('Keyboard')&&!name.includes('Keycap'));if(index<0)throw Error('Keyboard not found');
 let view:BackgroundCapture={...defaultBackgroundCapture({x:0,y:0,w:900,h:600},150),sourceId:item.stage.id,camera:fitStageCamera(shape),cutaway:{enabled:true,depth:.45}};
 const office=new Background3dRenderer(host,view,150,(camera)=>{view={...view,camera};},message=>{status.textContent=`キーボードの全${office.focusTarget(index)?.indices.length??0}部品をひとまとめに選択 · ${message}`;},()=>{},point=>{view={...view,focusPoint:point};office.configure(view);});
 office.setShape(shape);const focus=office.focusTarget(index)!;view={...view,focusMesh:focus.mesh,camera:focusBackgroundCamera(view.camera,focus.bounds,1.5)};office.configure(view);
 })().catch(error=>{status.textContent=String(error);officeButton.disabled=false;});};
