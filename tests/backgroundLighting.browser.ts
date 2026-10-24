import {Box3,BoxGeometry,OrthographicCamera,Vector3,WebGLRenderer,WebGLRenderTarget} from 'three';
import type {DirectionalLight,Mesh,SpotLight} from 'three';
import {Background3dRenderer,fitStageCamera,loadStageShape,type StageShape} from '../src/lib/background3dRenderer';
import {defaultBackgroundCapture,prepareBackgroundStage} from '../src/lib/background3d';
import {backgroundLightWindow,backgroundPresetLight} from '../src/lib/background3dLightingModel';
import type {BackgroundCapture} from '../src/types';
import {BackgroundLightProbe} from '../src/lib/background3dLightProbe';
import {BackgroundLighting} from '../src/lib/background3dLighting';
import '../src/styles/global.css';
if(location.port!=='4325')throw Error('Dedicated QA origin required');
document.body.style.cssText='margin:16px;background:#e9eee9;font:14px system-ui;overflow:auto';
document.body.innerHTML='<h1>室内光 · 固定濃度スクリーントーン</h1><div id="tools"><button id="run">検証を実行</button><button id="office">実際の書斎を確認</button><select id="preset"><option value="daylight">昼の窓光</option><option value="evening">夕方の窓光</option><option value="indoor">室内灯</option></select><label>トーンの境界<input id="threshold" type="range" min="0" max="100" value="45"><output id="value">45</output></label><label>反射光<input id="bounce" type="range" min="0" max="2" step=".1" value="1"></label></div><p id="status"></p><div id="view" class="canvas-viewport" style="position:relative;width:720px;height:540px;background:white"></div><pre id="results">準備中</pre><div id="comparisons" style="display:flex;flex-wrap:wrap;gap:16px"></div>';
const host=document.querySelector<HTMLDivElement>('#view')!,status=document.querySelector('#status')!,results=document.querySelector('#results')!;
const otherModels=document.createElement('button');otherModels.textContent='別モデルを検証';document.querySelector('#tools')!.append(otherModels);
let engine:Background3dRenderer|null=null,shape:StageShape,config:BackgroundCapture,start=0;
const tick=()=>new Promise(resolve=>setTimeout(resolve,80));
let bakeCount=0;const bake=BackgroundLightProbe.prototype.bake;BackgroundLightProbe.prototype.bake=function(...args){bakeCount++;return bake.call(this,...args);};
async function wait(){for(let i=0;i<750;i++){if(status.textContent?.includes('可視線')&&!status.textContent.includes('計算'))return;await tick();}throw Error(`照明の完了待ち: ${status.textContent}`);}
function room(){
 const meshes:StageShape['meshes']=[],names:string[]=[];
 const box=(name:string,p:number[],s:number[])=>{const g=new BoxGeometry(...s as [number,number,number]);g.translate(...p as [number,number,number]);meshes.push({positions:Array.from(g.getAttribute('position').array),indices:Array.from(g.index!.array)});names.push(name);g.dispose();return meshes.length-1;};
 box('Floor',[0,-.05,1],[4,.1,6]);box('Wall_back_left',[-1.4,1.5,-2],[1.2,3,.12]);box('Wall_back_right',[1.4,1.5,-2],[1.2,3,.12]);box('Wall_back_sill',[0,.4,-2],[1.6,.8,.12]);box('Wall_back_head',[0,2.8,-2],[1.6,.4,.12]);
 const glass=box('Window_glass',[0,1.7,-2],[1.6,1.8,.006]);box('Wall_left',[-2,1.5,1],[.12,3,6]);box('Wall_right',[2,1.5,1],[.12,3,6]);
 box('Table',[.5,1.05,0],[1.7,.12,1]);box('Box_on_table',[.6,1.35,0],[.45,.48,.4]);box('Chair',[-.65,.4,1.1],[.55,.8,.55]);
 const bounds=new Box3();for(const m of meshes)for(let i=0;i<m.positions.length;i+=3)bounds.expandByPoint(new Vector3().fromArray(m.positions,i));
 return {meshes,bounds,meshNames:names,windowMeshes:[glass]};
}
function mount(next:StageShape,view?:BackgroundCapture){
 engine?.dispose();status.textContent='舞台の照明を計算中…';shape=next;config=view??{...defaultBackgroundCapture({x:0,y:0,w:960,h:720},300),camera:{position:[0,2.5,7],target:[0,.9,0],fov:45},blackAmount:0};
 config.light=backgroundPresetLight(config.light,config.light.preset??'daylight',shape);start=performance.now();
 engine=new Background3dRenderer(host,config,300,camera=>{config={...config,camera};},value=>{status.textContent=`${value} · ${(performance.now()-start).toFixed(0)} ms`;});engine.setShape(shape);
}
function change(patch:Partial<BackgroundCapture>){config={...config,...patch};engine!.configure(config);if(patch.light)status.textContent='照明を更新中…';}
document.querySelector<HTMLSelectElement>('#preset')!.onchange=e=>{start=performance.now();change({light:backgroundPresetLight(config.light,(e.target as HTMLSelectElement).value as 'daylight'|'evening'|'indoor',shape)});};
document.querySelector<HTMLInputElement>('#threshold')!.oninput=e=>{const value=Number((e.target as HTMLInputElement).value);document.querySelector('#value')!.textContent=String(value);change({toneThreshold:value});};
document.querySelector<HTMLInputElement>('#bounce')!.oninput=e=>change({light:{...config.light,bounce:Number((e.target as HTMLInputElement).value)}});
async function mask(){const shot=await engine!.capture(),item=shot.imports[0],bitmap=await createImageBitmap(item.blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();return {shot,data:ctx.getImageData(0,0,canvas.width,canvas.height),canvas};}
function preview(label:string){const section=document.createElement('section'),title=document.createElement('h2'),canvas=document.createElement('canvas');title.textContent=label;canvas.width=engine!.canvas.width;canvas.height=engine!.canvas.height;canvas.style.width='480px';canvas.getContext('2d')!.drawImage(engine!.canvas,0,0);section.append(title,canvas);document.querySelector('#comparisons')!.append(section);}
function selfShadowDifference(scale=1,rotation=0){
 const meshes:StageShape['meshes']=[];
 for(const [position,size] of [[[0,-.05,0],[4,.1,8]],[[-2,1.5,1],[.006,1.8,1.6]],[[0,1.5,0],[2.5,2,.006]]]){const g=new BoxGeometry(...size as [number,number,number]);g.translate(...position as [number,number,number]);meshes.push({positions:Array.from(g.attributes.position.array),indices:Array.from(g.index!.array)});g.dispose();}
 const bounds=new Box3(),axis=new Vector3(0,1,0);for(const mesh of meshes)for(let i=0;i<mesh.positions.length;i+=3){const point=new Vector3().fromArray(mesh.positions,i).multiplyScalar(scale).applyAxisAngle(axis,rotation);point.toArray(mesh.positions,i);bounds.expandByPoint(point);}
 const stage:StageShape={meshes,meshNames:['Floor','Window_glass','Screen'],windowMeshes:[1],bounds};
 const renderer=new WebGLRenderer(),target=new WebGLRenderTarget(96,72),camera=new OrthographicCamera(-scale,scale,.75*scale,-.75*scale,.1*scale,20*scale),light=new BackgroundLighting(renderer,stage,()=>{});
 const capture={...defaultBackgroundCapture({x:0,y:0,w:96,h:72},300),blackAmount:0,light:{...backgroundPresetLight({azimuth:0,elevation:30},'daylight',stage),ceiling:false,bounce:0}};
 camera.position.set(0,1.5,5).multiplyScalar(scale).applyAxisAngle(axis,rotation);camera.lookAt(0,1.5*scale,0);camera.updateMatrixWorld();
 try{
  light.configure(capture);light.setVisible([2]);renderer.setRenderTarget(target);
  // Every spot-to-screen ray is clear. Removing the receiver's own shadow must
  // not reveal islands that came from depth rounding rather than an occluder.
  const lights=Reflect.get(light,'lights') as Array<DirectionalLight|SpotLight>,opaque=(Reflect.get(light,'meshes') as Mesh[]).filter(mesh=>mesh.castShadow);
  lights.forEach((item,i)=>{item.intensity=i>=1&&i<=4?1.7*scale*scale:0;});
  let differences=0,total=0;const values:Uint8Array[][]=[];
  for(const enabled of [true,false]){
   for(const mesh of opaque)mesh.castShadow=mesh.receiveShadow=enabled;for(const item of lights)item.shadow.needsUpdate=true;renderer.shadowMap.needsUpdate=true;
   const levels:Uint8Array[]=[];
   for(let threshold=5;threshold<=95;threshold+=5){light.configure({...capture,toneThreshold:threshold});light.render(camera,2);const pixels=new Uint8Array(96*72*4);renderer.readRenderTargetPixels(target,0,0,96,72,pixels);levels.push(pixels);}values.push(levels);
  }
  for(let level=0;level<values[0].length;level++)for(let i=3;i<values[0][level].length;i+=4){if(Math.abs(values[0][level][i]-values[1][level][i])>32)differences++;total++;}
  return differences/total;
 }finally{light.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();}
}
document.querySelector<HTMLButtonElement>('#office')!.onclick=async()=>{try{const response=await fetch('/qa-office.glb');if(!response.ok)throw Error('確認用の原本コピーがありません');const item=await prepareBackgroundStage(new File([await response.blob()],'qa-office.glb'));const loaded=await loadStageShape(item.stage,item.blob);mount(loaded,{...defaultBackgroundCapture({x:0,y:0,w:1200,h:900},350),sourceId:item.stage.id,camera:{position:[3.6902253,3.6573054,9.0136806],target:[.9000003,1.04549247,-.1650000066],fov:5},cutaway:{enabled:true,depth:.45},focusMesh:312});results.textContent=`実際の窓: ${loaded.windowMeshes?.join(', ')} / ${backgroundLightWindow(loaded,config.light)?.width.toFixed(3)} m`;await wait();preview('実際の書斎');}catch(error){results.textContent=`FAIL ${error}`;}};
otherModels.onclick=async()=>{try{
 const checks:string[]=[];document.querySelector('#comparisons')!.replaceChildren();
 for(const [name,url] of [['ペンギン','/qa-penguin.glb'],['迷路','/qa-maze.glb']]){
  const response=await fetch(url);if(!response.ok)throw Error(`${name}: 確認用コピーがありません`);
  const item=await prepareBackgroundStage(new File([await response.blob()],url.slice(1))),loaded=await loadStageShape(item.stage,item.blob);
  mount(loaded,{...defaultBackgroundCapture({x:0,y:0,w:960,h:720},300),sourceId:item.stage.id,camera:fitStageCamera(loaded)});await wait();const value=await mask();
  let binary=0;for(let i=3;i<value.data.data.length;i+=4)if(value.data.data[i]===0||value.data.data[i]===255)binary++;
  if(binary/(value.data.width*value.data.height)<.98||!value.shot.layers.find(layer=>layer.kind==='vector')!.paths?.length||value.shot.layers.find(layer=>layer.tone)!.tone?.density!==20)throw Error(`${name}: 線画または2値トーンの検証に失敗`);
  preview(name);checks.push(`${name}: ${loaded.meshes.length}部品、線画と固定濃度2値トーンの撮影成功`);results.textContent=checks.join('\n');
 }
 results.textContent=`PASS ${checks.length}\n${checks.join('\n')}`;
}catch(error){results.textContent=`FAIL ${error}`;}};
document.querySelector<HTMLButtonElement>('#run')!.onclick=async()=>{
 const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);results.textContent=checks.join('\n');};
 try{
  mount(room());await wait();const day=await mask();preview('昼の窓光');
  const initialBakes=bakeCount;
  check(day.shot.layers.find(layer=>layer.tone)!.tone?.mode==='fixed'&&day.shot.layers.find(layer=>layer.tone)!.tone?.density===20,'トーンは固定濃度20%のまま');
  let binary=0,partial=0;for(let i=3;i<day.data.data.length;i+=4){const a=day.data.data[i];if(a===0||a===255)binary++;else partial++;}
  check(binary/(binary+partial)>.98,'照明から2値の領域マスクを作る（内部の濃淡なし）');check(partial>0,'境界の縁にはアンチエイリアスがある');
  const count=(data:ImageData)=>{let n=0;for(let i=3;i<data.data.length;i+=4)n+=data.data[i]/255;return n;},areas:number[]=[];
  for(const threshold of [20,45,75]){change({toneThreshold:threshold});const value=await mask();areas.push(count(value.data));check(value.shot.layers.find(layer=>layer.tone)!.tone?.density===20,`境界${threshold}でもトーン濃度を保持`);}
  check(areas[0]>areas[1]&&areas[1]>areas[2],`境界スライダーで貼る面積だけ変わる: ${areas.map(Math.round).join(' > ')}`);
  change({camera:{...config.camera,position:[.2,2.5,7]},cutaway:{enabled:true,depth:.25}});await mask();
  check(bakeCount===initialBakes,'境界・カメラ・壁を隠す操作では室内照明を焼き直さない');
  change({camera:{...config.camera,position:[0,2.5,7]},cutaway:undefined});
  change({toneThreshold:45,light:backgroundPresetLight(config.light,'evening',shape)});await wait();preview('夕方の窓光');const evening=await mask();check(evening.data.data.some((v,i)=>i%4===3&&v!==day.data.data[i]),'太陽の高さと窓光で影の形が変わる');
  change({light:backgroundPresetLight(config.light,'indoor',shape)});await wait();preview('室内灯');const indoor=await mask();check(indoor.data.data.some((v,i)=>i%4===3&&v!==evening.data.data[i]),'室内灯では距離と遮蔽物に応じた影になる');
  const indoorLights=Reflect.get(Reflect.get(engine!,'lighting'),'lights') as Array<DirectionalLight|SpotLight>;
  check(indoorLights.length===2&&indoorLights.every(light=>light.type==='SpotLight'&&light.target.position.y<light.position.y),'室内灯では天井の照明だけを使い、太陽と窓の光源を作らない');
  const indoorBakes=bakeCount;change({light:{...config.light,azimuth:-120,elevation:-70}});const turnedSun=await mask();
  check(turnedSun.data.data.every((v,i)=>v===indoor.data.data[i])&&bakeCount===indoorBakes,'室内灯では日差しの角度を変えても画像と反射光の計算が変わらない');
  change({light:{...config.light,bounce:0}});const direct=await mask();change({light:{...config.light,bounce:1}});const bounced=await mask();check(count(direct.data)>count(bounced.data),'壁と床の反射光が影の領域を明るくする');
  change({toneThreshold:100});check(count((await mask()).data)===0,'境界100ではトーン領域なし');
  change({light:backgroundPresetLight(config.light,'daylight',shape)});const cancelled=engine!.capture().then(()=>false,()=>true);
  change({light:backgroundPresetLight(config.light,'evening',shape)});check(await cancelled,'照明変更前に始めた撮影を破棄する');await mask();
  const prior=bakeCount;mount(room());await mask();check(bakeCount>=prior+48,'編集を開き直しても反射光と撮影を完了できる');
  for(const [scale,rotation] of [[.01,0],[1,0],[100,0],[1,Math.PI/4]]){const difference=selfShadowDifference(scale,rotation);check(difference<.01,`遮蔽物のない平面に偽の影を作らない（${scale}倍・${Math.round(rotation*180/Math.PI)}°）: ${(difference*100).toFixed(2)}%`);}
  change({toneThreshold:45});await wait();results.textContent=`PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){results.textContent=`FAIL ${error}\n${checks.join('\n')}`;}
};
mount(room());results.textContent='照明の計算後に検証できます。';
