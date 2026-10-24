import {Box3,BoxGeometry,BufferGeometry,Float32BufferAttribute,PerspectiveCamera,Quaternion,Vector3,WebGLRenderer,WebGLRenderTarget} from 'three';
import {Background3dRenderer,loadStageShape,type StageShape} from '../src/lib/background3dRenderer';
import {defaultBackgroundCapture,prepareBackgroundStage} from '../src/lib/background3d';
import type {BackgroundCapture} from '../src/types';
import type {BackgroundSurface,BackgroundSurfaceInput} from '../src/lib/background3dSurface';
import {BackgroundLighting} from '../src/lib/background3dLighting';
import '../src/styles/global.css';
if(location.port!=='4325')throw Error('Dedicated QA origin required');
document.body.style.cssText='margin:16px;max-width:1600px;background:#e9eee9;font:14px system-ui;overflow:auto';
document.body.innerHTML='<h1>細部の省略と、光による線の抜き</h1><div><button id="run">検証を実行</button><button id="fences">斜めから見た柵・鉄格子・金網</button><button id="office">書斎モデルで確認</button><button id="mesh-debug">金網・省略40%で確認</button><label>細部の省略<input id="detail" type="range" min="0" max="100" step="5" value="0"></label><label>線の抜き<input id="gap" type="range" min="0" max=".8" step=".05" value="0"></label><label>光の強さ<input id="intensity" type="range" min=".05" max="2" step=".05" value=".4"></label></div><p id="status"></p><div id="view" class="canvas-viewport" style="position:relative;width:900px;height:600px;background:white"></div><pre id="results">準備中</pre><div id="comparisons" style="display:grid;grid-template-columns:repeat(2,minmax(400px,1fr));gap:16px"></div>';
const host=document.querySelector<HTMLDivElement>('#view')!,status=document.querySelector('#status')!,results=document.querySelector('#results')!;
let engine:Background3dRenderer,config:BackgroundCapture;
const tick=()=>new Promise(resolve=>setTimeout(resolve,80));
async function ready(){for(let i=0;i<750;i++){if(status.textContent?.includes('可視線')&&!status.textContent.includes('計算'))return;await tick();}throw Error(`完了待ち: ${status.textContent}`);}
function scene(){
 const meshes:StageShape['meshes']=[],names:string[]=[];
 const add=(g:BufferGeometry,name:string)=>{meshes.push({positions:Array.from(g.attributes.position.array),indices:g.index?Array.from(g.index.array):Array.from({length:g.attributes.position.count},(_,i)=>i)});names.push(name);g.dispose();};
 const box=(name:string,p:number[],size:number[])=>{const g=new BoxGeometry(...size as [number,number,number]);g.translate(...p as [number,number,number]);add(g,name);};
 box('Floor',[0,-.1,0],[9,.2,4]);
 box('Large corner',[-3.3,.5,-.25],[.8,1,.8]);
 box('Single thin rail',[3.8,1,0],[.025,2,.08]);
 box('Fence post A',[.55,.85,0],[.16,1.7,.18]);box('Fence post B',[3.15,.85,0],[.16,1.7,.18]);
 box('Fence crossbar',[1.85,1.4,.025],[2.65,.09,.13]);box('Fence lower crossbar',[1.85,.3,.025],[2.65,.09,.13]);
 for(let i=0;i<15;i++){const x=.73+i*.16;box(`Fence rail ${i}`,[x,.8,0],[.04,1.55,.025]);}
 // Deterministic disconnected leaves: alternating normals and small shadows
 // test a mass of surfaces, not a synthetic 2D hatch image.
 let seed=42;const random=()=>{seed=Math.imul(seed,1664525)+1013904223;return (seed>>>0)/4294967296;};
 const positions:number[]=[];
 for(let i=0;i<1100;i++){
  const az=random()*Math.PI*2,v=random()*2-1,r=Math.sqrt(1-v*v),radius=.55+.45*random();
  const centre=new Vector3(-1.4+r*Math.cos(az)*radius,1.35+v*radius,.3+r*Math.sin(az)*radius*.65);
  // Deliberate large opening through the foliage.
  if(Math.hypot(centre.x+1.4,centre.y-1.4)<.22)continue;
  const right=new Vector3(random()-.5,random()-.5,random()-.5).normalize().multiplyScalar(.10+random()*.08),up=new Vector3(random()-.5,random()-.5,random()-.5).cross(right).normalize().multiplyScalar(.04+random()*.04);
  const vertices=[centre.clone().sub(right),centre.clone().add(up),centre.clone().add(right),centre.clone().sub(up)];
  for(const k of [0,1,2,0,2,3])positions.push(...vertices[k].toArray());
 }
 const leaves=new BufferGeometry();leaves.setAttribute('position',new Float32BufferAttribute(positions,3));add(leaves,'Leaf cluster');
 box('Trunk',[-1.4,.6,.3],[.15,1.2,.15]);
 const bounds=new Box3();for(const m of meshes)for(let i=0;i<m.positions.length;i+=3)bounds.expandByPoint(new Vector3().fromArray(m.positions,i));
 return {meshes,bounds,meshNames:names};
}
function perspectiveFence(kind:'wood'|'iron'|'mesh'){
 const meshes:StageShape['meshes']=[],meshNames:string[]=[],bounds=new Box3();
 const length=14,height=1.7;
 const add=(name:string,a:Vector3,b:Vector3,width:number,depth=width)=>{
  const g=new BoxGeometry(width,a.distanceTo(b),depth),direction=b.clone().sub(a).normalize();
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction));g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());
  const positions=Array.from(g.attributes.position.array);meshes.push({positions,indices:Array.from(g.index!.array)});meshNames.push(name);
  for(let i=0;i<positions.length;i+=3)bounds.expandByPoint(new Vector3().fromArray(positions,i));g.dispose();
 };
 const point=(s:number,y:number)=>new Vector3(0,y,-s);
 for(let s=0;s<=length;s+=2)add('Post',point(s,0),point(s,height+.1),.07);
 for(const y of [.18,height])add('Horizontal rail',point(0,y),point(length,y),.035);
 if(kind!=='mesh'){
  const spacing=kind==='wood'?.20:.14,width=kind==='wood'?.08:.016;
  // Actual gaps: wood 12 cm, iron 12.4 cm. Perspective alone compresses them.
  for(let s=spacing/2;s<length;s+=spacing)add(kind,point(s,.1),point(s,height),kind==='wood'?.025:width,width);
 }else{
  // Diamond openings 6 cm across, 3 mm wire; clipped straight 3D strands.
  for(const sign of [-1,1])for(let intercept=-length;intercept<length+height;intercept+=.06){
   const lo=Math.max(0,sign===1?-intercept:intercept-height),hi=Math.min(length,sign===1?height-intercept:intercept);
   if(hi>lo)add('Wire',point(lo,sign*lo+intercept),point(hi,sign*hi+intercept),.003);
  }
 }
 return {meshes,bounds,meshNames};
}
function mount(shape:StageShape,next?:BackgroundCapture){
 engine?.dispose();config=next??{...defaultBackgroundCapture({x:0,y:0,w:1200,h:800},300),camera:{position:[5,4.3,12],target:[0,1,0],fov:34},light:{azimuth:-45,elevation:55,preset:'daylight',intensity:.4,bounce:1,ceiling:false},blackAmount:8,toneThreshold:35};
 engine=new Background3dRenderer(host,config,300,camera=>{config={...config,camera};},value=>{status.textContent=value;});engine.setShape(shape);syncInputs();
}
function syncInputs(){for(const [id,value] of [['detail',(1-config.detail)*100],['gap',config.lineGap],['intensity',config.light.intensity??1]] as const)document.querySelector<HTMLInputElement>(`#${id}`)!.value=String(value);}
function change(patch:Partial<BackgroundCapture>){config={...config,...patch};engine.configure(config);syncInputs();}
document.querySelector<HTMLInputElement>('#detail')!.oninput=e=>change({detail:1-Number((e.target as HTMLInputElement).value)/100});
document.querySelector<HTMLInputElement>('#gap')!.oninput=e=>change({lineGap:Number((e.target as HTMLInputElement).value)});
document.querySelector<HTMLInputElement>('#intensity')!.oninput=e=>change({light:{...config.light,intensity:Number((e.target as HTMLInputElement).value)}});
const pathLength=(shot:Awaited<ReturnType<Background3dRenderer['capture']>>)=>shot.layers.find(layer=>layer.kind==='vector')!.paths!.reduce((sum,p)=>sum+Math.hypot(p.nodes[1].x-p.nodes[0].x,p.nodes[1].y-p.nodes[0].y),0);
const projected=(x:number,y:number,z:number)=>{const p=new Vector3(x,y,z).project(Reflect.get(engine,'camera') as PerspectiveCamera);return {x:(p.x+1)*config.frame.w/2,y:(1-p.y)*config.frame.h/2};};
function footLength(shot:Awaited<ReturnType<Background3dRenderer['capture']>>,x:number,z:number,width:number,depth:number){
 let result=0;
 // The two visible outer vertical corners, not the internal creases or rails
 // that happen to overlap an axis-aligned bounding box around the foot.
 for(const sign of [-1,1]){
  const a=projected(x+sign*width,0,z-sign*depth),b=projected(x+sign*width,.18,z-sign*depth),dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),intervals:number[][]=[];
  for(const path of shot.layers.find(layer=>layer.kind==='vector')!.paths!){const [p,q]=path.nodes;
   if(Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)/length>.3||Math.abs((q.x-a.x)*dy-(q.y-a.y)*dx)/length>.3)continue;
   const lo=((p.x-a.x)*dx+(p.y-a.y)*dy)/(length*length),hi=((q.x-a.x)*dx+(q.y-a.y)*dy)/(length*length);
   const low=Math.max(0,Math.min(lo,hi)),high=Math.min(1,Math.max(lo,hi));if(high>low)intervals.push([low,high]);
  }
  intervals.sort((p,q)=>p[0]-q[0]);let end=0;
  for(const [low,high] of intervals){result+=Math.max(0,high-Math.max(low,end))*length;end=Math.max(end,high);}
 }return result;
}

async function compare(label:string){
 const start=performance.now(),shot=await engine.capture();await tick();
 const section=document.createElement('section'),title=document.createElement('h2'),canvas=document.createElement('canvas'),summary=document.createElement('p');
 title.textContent=label;canvas.width=engine.canvas.width;canvas.height=engine.canvas.height;canvas.style.width='100%';canvas.getContext('2d')!.drawImage(engine.canvas,0,0);
 summary.textContent=`${shot.layers.find(layer=>layer.kind==='vector')!.paths!.length}本 / 総延長 ${pathLength(shot).toFixed(0)}px / 撮影 ${(performance.now()-start).toFixed(0)}ms`;
 section.append(title,canvas,summary);document.querySelector('#comparisons')!.append(section);return shot;
}
async function pixels(blob:Blob){const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();return ctx.getImageData(0,0,canvas.width,canvas.height).data;}
function foregroundProxyTest(){
 const meshes:StageShape['meshes']=[],bounds=new Box3();
 for(const [x,z,width] of [[0,-4,10],[0,0,.08]]){const g=new BoxGeometry(width,6,.04);g.translate(x,0,z);const positions=Array.from(g.attributes.position.array);meshes.push({positions,indices:Array.from(g.index!.array)});for(let i=0;i<positions.length;i+=3)bounds.expandByPoint(new Vector3().fromArray(positions,i));g.dispose();}
 const renderer=new WebGLRenderer({alpha:true}),target=new WebGLRenderTarget(512,256,{samples:4}),camera=new PerspectiveCamera(45,2,.1,30),lighting=new BackgroundLighting(renderer,{meshes,bounds},()=>{});
 renderer.setClearColor(0,0);camera.position.set(0,0,8);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 try{
  lighting.configure({...defaultBackgroundCapture({x:0,y:0,w:512,h:256},300),blackAmount:20,light:{azimuth:0,elevation:0,preset:'daylight',intensity:2,bounce:0,ceiling:false}});
  renderer.setRenderTarget(target);renderer.clear();lighting.render(camera,1);const before=new Uint8Array(512*256*4);renderer.readRenderTargetPixels(target,0,0,512,256,before);
  // The rail is less than a pixel at the analysis scale and deliberately absent
  // from this dense background patch. The native depth buffer must protect it.
  const texture=new Float32Array(64*32*4);for(let p=0;p<64*32;p++)texture.set([0,9,1,0],p*4);
  lighting.setSurface({width:64,height:32,texture,radius:80,footprint:.001});renderer.clear();lighting.render(camera,1);const after=new Uint8Array(before.length);renderer.readRenderTargetPixels(target,0,0,512,256,after);
  const centre=(128*512+256)*4+3,background=(128*512+270)*4+3;
  return {before:before[centre],after:after[centre],background:after[background]};
 }finally{lighting.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();}
}
document.querySelector<HTMLButtonElement>('#run')!.onclick=async()=>{
 const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);results.textContent=checks.join('\n');};
 try{
  document.querySelector('#comparisons')!.replaceChildren();mount(scene());await ready();
  const full=await compare('省略なし');change({detail:0});const simple=await compare('細部の省略 100%');
  check(pathLength(simple)<pathLength(full)*.9,`密集部分の線を削減: ${Math.round(pathLength(full))} → ${Math.round(pathLength(simple))}`);
  const cache=Reflect.get(engine,'surfaceCache') as {surface:BackgroundSurface;edges:Array<{a:{x:number;y:number};b:{x:number;y:number}}>};
  const rawField=Reflect.get(engine,'surfaceRaw') as {input:BackgroundSurfaceInput};
  check(rawField.input.pixels.some((v,i)=>i%4===1&&v>0),'実際のGPUから正の面深度を取得');
  check(cache.surface.texture.some((v,i)=>i%4===2&&v>.5),'密集した面を検出');
  const raw=await pixels(full.imports[0].blob),grouped=await pixels(simple.imports[0].blob);let changed=0;
  for(let i=3;i<raw.length;i+=4)if(Math.abs(raw[i]-grouped[i])>32)changed++;
  check(changed>100,`同じ面のまとまりをトーン領域へ反映: ${changed}px`);
  for(const [label,x,z,width,depth] of [['左の柱',.55,0,.08,.09],['右の柱',3.15,0,.08,.09],['木の根元',-1.4,.3,.075,.075]] as const){
   const original=footLength(full,x,z,width,depth),retained=footLength(simple,x,z,width,depth);
   check(original>5&&retained>original*.8,`${label}の接地輪郭を保つ: ${original.toFixed(1)} → ${retained.toFixed(1)}px`);
  }
  let shadowSamples=0,preservedShadows=0;
  const floorNormal=new Vector3(0,1,0).transformDirection((Reflect.get(engine,'camera') as PerspectiveCamera).matrixWorldInverse);
  floorNormal.divideScalar(Math.abs(floorNormal.x)+Math.abs(floorNormal.y)+Math.abs(floorNormal.z));
  const floorOct=floorNormal.z>=0?[floorNormal.x,floorNormal.y]:[(1-Math.abs(floorNormal.y))*Math.sign(floorNormal.x),(1-Math.abs(floorNormal.x))*Math.sign(floorNormal.y)];
  for(let x=.8;x<=3.7;x+=.1)for(let z=-1.3;z<=-.2;z+=.1){
   const p=projected(x,0,z),index=(Math.floor(p.y)*1200+Math.floor(p.x))*4+3,input=rawField.input;
   const q=(Math.floor(p.y*input.height/800)*input.width+Math.floor(p.x*input.width/1200))*4;
   // A projected floor point may be hidden by the fence itself. Check the
   // actual GPU normal before counting it as a receiving-floor shadow sample.
   if(Math.abs(input.pixels[q+2]-floorOct[0])+Math.abs(input.pixels[q+3]-floorOct[1])>1e-4)continue;
   if(raw[index]>240){shadowSamples++;if(Math.abs(raw[index]-grouped[index])<20)preservedShadows++;}
  }
  check(shadowSamples>10&&preservedShadows/shadowSamples>.95,`柵から床へ落ちた影を保つ: ${preservedShadows}/${shadowSamples}点`);
  check(simple.layers.find(layer=>layer.tone)!.tone?.density===full.layers.find(layer=>layer.tone)!.tone?.density,'トーンの濃度を変更しない');
  const before=JSON.stringify(simple.layers.find(layer=>layer.kind==='vector')!.paths!.map(p=>p.nodes));host.style.width='600px';host.style.height='400px';await tick();const resized=await engine.capture();
  check(JSON.stringify(resized.layers.find(layer=>layer.kind==='vector')!.paths!.map(p=>p.nodes))===before,'表示サイズを変えても撮影の省略位置は一致');host.style.width='900px';host.style.height='600px';
  const protectedRail=foregroundProxyTest();check(protectedRail.before<10&&protectedRail.after<10&&protectedRail.background>245,`低解像度の面情報に映らない手前の細い柱を保護: ${JSON.stringify(protectedRail)}`);
  change({detail:.45});const stale=engine.capture().then(()=>false,()=>true);await tick();change({detail:.15});check(await stale,'計算中に設定が変わった撮影結果を破棄');await engine.capture();
  const saved=structuredClone(config);change({detail:1,lineGap:0});const zero=await engine.capture();check(Math.abs(pathLength(zero)-pathLength(full))<.01,'省略0へ戻すと元の線を復元');
  const lightLengths:number[]=[];let lightWorker:unknown;
  for(const gap of [.2,.5,.8]){change({lineGap:gap});await tick();await ready();const value=await compare(`光による線の抜き ${gap}`);lightLengths.push(pathLength(value));const worker=Reflect.get(Reflect.get(engine,'surfaceComputer'),'worker');if(lightWorker)check(worker===lightWorker,`線の抜き${gap}では面の計算を保持`);lightWorker=worker;}
  check(lightLengths[0]>=lightLengths[1]&&lightLengths[1]>lightLengths[2]&&lightLengths[2]>0,`光の強い場所から抜ける範囲が拡大: ${lightLengths.map(Math.round).join(' → ')}`);
  change(saved);await ready();results.textContent=`PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){results.textContent=`FAIL ${error}\n${checks.join('\n')}`;console.error(error);}
};
document.querySelector<HTMLButtonElement>('#fences')!.onclick=async()=>{try{
 document.querySelector('#comparisons')!.replaceChildren();results.textContent='長さ14 m・高さ1.7 mの柵を、同じ斜めのカメラから比較中…';
 for(const [kind,label] of [['wood','木の柵（板幅8 cm・隙間12 cm）'],['iron','鉄格子（棒幅1.6 cm・隙間12.4 cm）'],['mesh','金網（線径3 mm・菱形の幅6 cm）']] as const){
  mount(perspectiveFence(kind),{...defaultBackgroundCapture({x:0,y:0,w:1200,h:800},300),camera:{position:[2,2.2,3.5],target:[0,1,-4],fov:43},light:{azimuth:60,elevation:40,preset:'daylight',intensity:1,bounce:.5,ceiling:false},blackAmount:8,toneThreshold:35});await ready();
  await compare(`${label}／省略なし`);change({detail:0});await compare(`${label}／省略100%`);
 }
 results.textContent='斜めの柵3種の比較を作成しました。実寸の隙間を保ち、遠方では透視投影で線が重なる条件です。';
 }catch(error){results.textContent=`FAIL ${error}`;console.error(error);}};
document.querySelector<HTMLButtonElement>('#office')!.onclick=async()=>{try{
 const response=await fetch('/qa-office.glb');if(!response.ok)throw Error('書斎の確認用コピーがありません');
 const item=await prepareBackgroundStage(new File([await response.blob()],'qa-office.glb')),shape=await loadStageShape(item.stage,item.blob);
 mount(shape,{...defaultBackgroundCapture({x:0,y:0,w:1200,h:900},350),sourceId:item.stage.id,camera:{position:[3.6902253,3.6573054,9.0136806],target:[.9000003,1.04549247,-.1650000066],fov:5},cutaway:{enabled:true,depth:.45},focusMesh:312});await ready();
 document.querySelector('#comparisons')!.replaceChildren();await compare('書斎・省略なし');change({detail:0});await compare('書斎・細部の省略 100%');change({lineGap:.6});await compare('書斎・省略＋光で線を抜く');results.textContent='書斎の比較を作成しました';
 }catch(error){results.textContent=`FAIL ${error}`;console.error(error);}};

document.querySelector<HTMLButtonElement>('#mesh-debug')!.onclick=async()=>{try{
 document.querySelector('#comparisons')!.replaceChildren();
 mount(perspectiveFence('mesh'),{...defaultBackgroundCapture({x:0,y:0,w:1200,h:800},300),camera:{position:[2,2.2,3.5],target:[0,1,-4],fov:43},light:{azimuth:60,elevation:40,preset:'daylight',intensity:.2,bounce:.5,ceiling:false},blackAmount:8,toneThreshold:35,lineGap:.15});await ready();
 await compare('金網・省略なし・光0.2');change({detail:.6});const shot=await compare('金網・省略40%・光0.2');
 const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const ctx=canvas.getContext('2d')!;ctx.lineCap='round';
 for(const path of shot.layers.find(layer=>layer.kind==='vector')!.paths!){ctx.lineWidth=path.style.width;ctx.beginPath();ctx.moveTo(path.nodes[0].x,path.nodes[0].y);ctx.lineTo(path.nodes[1].x,path.nodes[1].y);ctx.stroke();}
 const rgba=ctx.getImageData(0,0,1200,800).data;
 const ink=(start:number,end:number)=>{let total=0,dark=0;for(let distance=start;distance<end;distance+=.04)for(let y=.35;y<1.35;y+=.025){const p=projected(0,y,-distance);total++;if(rgba[(Math.floor(p.y)*1200+Math.floor(p.x))*4+3]>80)dark++;}return dark/total;};
 const near=ink(.2,3.8),far=ink(10.2,13.8);
 if(far>=near||far>.45)throw Error(`奥で網目が復活: 手前${Math.round(near*100)}%・奥${Math.round(far*100)}%`);
 results.textContent=`PASS 中間の省略量でも奥が黒く戻らない（線の占有率：手前${Math.round(near*100)}%・奥${Math.round(far*100)}%）`;
 }catch(error){results.textContent=`FAIL ${error}`;console.error(error);}};
mount(scene());results.textContent='準備ができたら検証を実行できます。';
