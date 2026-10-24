import {Background3dRenderer,loadStageShape,fitStageCamera,type StageShape} from '../src/lib/background3dRenderer';
import {defaultBackgroundCapture,prepareBackgroundStage} from '../src/lib/background3d';
import {visibleBackgroundEdges} from '../src/lib/background3dGeometry';
import {Matrix4,PerspectiveCamera} from 'three';
import {stageClipPlanes} from '../src/lib/background3dRenderer';
if(location.port!=='4325')throw Error('Dedicated test origin required');
const host=document.querySelector<HTMLDivElement>('#preview')!,status=document.querySelector<HTMLElement>('#status')!,report=document.querySelector<HTMLElement>('#report')!,runButton=document.querySelector<HTMLButtonElement>('#run')!;
let shape:StageShape,renderer:Background3dRenderer|null=null,config=defaultBackgroundCapture({x:0,y:0,w:900,h:600},150),pulses=0;
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())),wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
document.querySelector<HTMLButtonElement>('#pulse')!.onclick=e=>{(e.currentTarget as HTMLButtonElement).textContent=`応答確認 ${++pulses}`;};
document.querySelector<HTMLButtonElement>('#close')!.onclick=()=>{renderer?.dispose();renderer=null;status.textContent='プレビューを閉じました';};
function show(){renderer?.dispose();config={...config,camera:fitStageCamera(shape)};renderer=new Background3dRenderer(host,config,150,camera=>{config={...config,camera};},text=>{status.textContent=text;});renderer.setShape(shape);renderer.configure(config);runButton.disabled=false;}
async function load(file:File){const item=await prepareBackgroundStage(file);shape=await loadStageShape(item.stage,item.blob);show();}
// A temporary QA asset may be served by this dedicated local origin. Never read
// browser storage, call the bridge, or save model bytes into a user's project.
const fixtureModel=new URLSearchParams(location.search).get('model');
if(fixtureModel?.startsWith('/qa-'))void fetch(fixtureModel).then(async response=>{if(!response.ok)throw Error('QA model unavailable');await load(new File([await response.blob()],'qa-model.glb'));}).catch(error=>{report.textContent=`FAIL: ${String(error)}`;});
document.querySelector<HTMLButtonElement>('#cube')!.onclick=()=>{void loadStageShape().then(value=>{shape=value;show();});};
document.querySelector<HTMLInputElement>('#model')!.onchange=event=>{
 const file=(event.currentTarget as HTMLInputElement).files?.[0];if(!file)return;
 status.textContent='形状を読み込み中…';runButton.disabled=true;
 void load(file).catch(error=>{report.textContent=`FAIL: ${String(error)}`;});
};
runButton.onclick=()=>{runButton.disabled=true;void(async()=>{
 const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
 show();runButton.disabled=true;await frame();await frame();
 const canvas=host.querySelector('canvas')!,pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
 check(pixels.some((v,i)=>i%4!==3&&v<235),'線画の計算前に不透明な形状を表示');
 let ticks=0,maxGap=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},20);
 try{
  await wait(250);const before=performance.now();
  config={...config,camera:{...config.camera,position:[config.camera.position[0]*.75,config.camera.position[1]*.8,config.camera.position[2]*.75]}};
  renderer!.configure(config);await frame();await frame();
  check(performance.now()-before<1000,'線画の計算途中でも構図変更を描画');
  const captured=await renderer!.capture();
  check(captured.layers.length===3&&captured.layers.find(layer=>layer.kind==='vector')!.paths!.length>0,'撮影は省略しない線画・ベタ・トーンを作成');
  check(JSON.stringify(captured.config.camera)===JSON.stringify(config.camera),'撮影は最後に選んだ構図を使用');
  check(ticks>=1&&maxGap<1000,`計算中も画面が応答（最大待ち${Math.round(maxGap)}ms）`);
  if(shape.meshes.reduce((n,m)=>n+m.indices.length/3,0)<1000){
   const camera=new PerspectiveCamera(config.camera.fov,1.5);camera.position.fromArray(config.camera.position);camera.lookAt(...config.camera.target);camera.updateMatrixWorld(true);Object.assign(camera,stageClipPlanes(shape,camera));camera.updateProjectionMatrix();
   const direct=visibleBackgroundEdges(shape.meshes,new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).toArray(),camera.position.toArray(),{width:900,height:600,creaseAngle:config.creaseAngle,detail:config.detail,outlineWidth:config.outlineWidth,detailWidth:config.detailWidth});
   check(captured.layers.find(layer=>layer.kind==='vector')!.paths!.length===direct.segments.length,'ワーカーの線画本数が直接計算と一致');
  }
  await frame();await frame();
  check(status.textContent!.includes('可視線'),'撮影完了後は計算中の表示と仮表示を解除');
  report.textContent=`PASS (${checks.length})\n${checks.join('\n')}\n撮影線画 ${captured.layers.find(layer=>layer.kind==='vector')!.paths!.length.toLocaleString()}本`;
 }finally{clearInterval(timer);}
})().catch(error=>{report.textContent=`FAIL: ${String(error)}`;}).finally(()=>{runButton.disabled=false;});};
