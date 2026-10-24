// Synthetic documents and an optional temporary GLB, on the dedicated QA origin only.
import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {STORAGE_KEY,toStoredMangaYaml,parseMangaYaml} from '../src/lib/manga';
import {applyBackgroundCameraShift} from '../src/lib/background3dCamera';
import {Background3dRenderer} from '../src/lib/background3dRenderer';
import {defaultBackgroundCapture,prepareBackgroundStage} from '../src/lib/background3d';
import {saveFigureCropAssets} from '../src/lib/figureCropStore';
import {loadBackground3dDefaults} from '../src/lib/background3dPreferences';
import {defaultPaintTone} from '../src/lib/paintTone';
import {cubeGlb} from './background3dFixture.mjs';
import {newToneLayer} from '../src/lib/paintTone';
import {decodePaintImage,paintPreviewRenderer,renderPaintPng} from '../src/lib/paintRenderer';
import {Box3,PerspectiveCamera,Vector3} from 'three';
import type {BackgroundCapture,PaintDocument} from '../src/types';
import '../src/styles/global.css';
if(location.port!=='4325')throw Error('Dedicated test origin required');
const tick=()=>new Promise(resolve=>setTimeout(resolve,100));
const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(el=>el.getAttribute('aria-label')===name||el.textContent?.trim()===name)!;
const wait=async(predicate:()=>boolean,label:string)=>{for(let i=0;i<200;i++){if(predicate())return;await tick();}throw Error(`Timed out: ${label}`);};
const click=async(name:string)=>{const el=button(name);if(!el||el.disabled)throw Error(`Button unavailable: ${name}`);el.click();await tick();};
const stage=()=>document.querySelector<HTMLSelectElement>('[aria-label="3Dの舞台"]');
const open3d=async()=>{await click('背景あたりの3Dモデルを配置・調整');await wait(()=>!!stage()&&!button('撮影して線画にする')?.disabled,'3D ready');};
const stored=()=>parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
const savedShot=()=>stored().manga.pages[0].panels[0].background_images?.[0]?.paint?.background3d;
const saveCamera=async()=>{const previous=localStorage.getItem(STORAGE_KEY);await click('3D背景を撮影');await wait(()=>!stage(),'captured camera');await click('環境設定');await wait(()=>localStorage.getItem(STORAGE_KEY)!==previous&&!!savedShot(),'updated draft saved');await click('ネーム');return structuredClone(savedShot()!.camera);};
const key=(type:string,target:EventTarget=document.activeElement??document.body)=>{const event=new KeyboardEvent(type,{key:' ',code:'Space',bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
const pointer=(target:EventTarget,type:string,x:number,y:number)=>target.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:71,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true}));
const delta=(a:number[],b:number[])=>a.map((n,i)=>n-b[i]);
const project=(view:BackgroundCapture['camera'],point:number[])=>{const lens=new PerspectiveCamera(view.fov,1,.001,10000);applyBackgroundCameraShift(lens,view);lens.position.fromArray(view.position);lens.lookAt(new Vector3(...view.target));lens.updateMatrixWorld(true);return new Vector3(...point).project(lens).toArray().slice(0,2);};
const near=(a:number[],b:number[],epsilon=1e-5)=>a.every((n,i)=>Math.abs(n-b[i])<epsilon);
function drag(canvas:Element,dx:number,dy:number){
 // Synthetic pointer events cannot create a native browser pointer capture.
 // Substitute only those three APIs; use the actual app's event handlers.
 for(const name of ['setPointerCapture','releasePointerCapture','hasPointerCapture'])Object.defineProperty(canvas,name,{value:()=>false,configurable:true});
 try{const box=canvas.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
  pointer(canvas,'pointerdown',x,y);pointer(canvas,'pointermove',x+dx,y+dy);pointer(canvas,'pointerup',x+dx,y+dy);
 }finally{for(const name of ['setPointerCapture','releasePointerCapture','hasPointerCapture'])delete (canvas as unknown as Record<string,unknown>)[name];}
}

async function toneChecks(check:(ok:boolean,label:string)=>void){
 const host=document.createElement('div');host.style.cssText='position:fixed;left:-10000px;width:256px;height:192px';document.body.append(host);
 const config={...defaultBackgroundCapture({x:0,y:0,w:1024,h:768},600),camera:{position:[0,0,5] as [number,number,number],target:[0,0,0] as [number,number,number],fov:40},blackAmount:0,light:{azimuth:90,elevation:0},toneDensity:20,toneThreshold:0};
 let status='';const engine=new Background3dRenderer(host,config,600,()=>{},value=>{status=value;});
 engine.setShape({meshes:[{positions:[-4,-4,0,4,-4,0,4,4,0,-4,4,0],indices:[0,1,2,0,2,3]}],bounds:new Box3(new Vector3(-4,-4,0),new Vector3(4,4,0))});
 const normal=newToneLayer();normal.mask=undefined;const paint:PaintDocument={version:1,width:1024,height:768,dpi:600,layers:[normal]};
 const preview=paintPreviewRenderer();
 try{
  await wait(()=>status.includes('可視線')&&!status.includes('計算'),'plane tone ready');
  const a=engine.canvas,reference=document.createElement('canvas');reference.width=a.width;reference.height=a.height;preview.draw(reference,paint,new Map());
  const left=a.getContext('2d')!.getImageData(0,0,a.width,a.height).data,right=reference.getContext('2d')!.getImageData(0,0,a.width,a.height).data;
  let same=true;for(let y=Math.floor(a.height*.3);y<a.height*.7;y++)for(let x=Math.floor(a.width*.3);x<a.width*.7;x++){
   const i=(y*a.width+x)*4;if(Math.abs(left[i]-(255-right[i+3]))>1)same=false;
  }
  check(same,'3D縮小プレビューが通常原稿の網点・濃度と一致');
  engine.configure({...config,focusMesh:0});
  const shot=await engine.capture(),tone=shot.layers.find(layer=>layer.tone)!,images=new Map();
  for(const item of shot.imports)images.set(item.asset.id,await decodePaintImage(item.blob));
  const mask=images.get(tone.image!.assetId)!,raw=document.createElement('canvas');raw.width=1024;raw.height=768;raw.getContext('2d')!.drawImage(mask,0,0);
  const rawPixels=raw.getContext('2d')!.getImageData(400,300,100,100).data;
  check(rawPixels.every((n,i)=>i%4===3?n===255:n===0),'撮影は均一な領域マスクを保存し網点を二重に焼き込まない');
  const png=await decodePaintImage(await renderPaintPng({...paint,layers:[tone]},images)),expected=await decodePaintImage(await renderPaintPng(paint,new Map()));
  const read=(image:HTMLImageElement)=>{raw.getContext('2d')!.clearRect(0,0,1024,768);raw.getContext('2d')!.drawImage(image,0,0);return raw.getContext('2d')!.getImageData(300,250,400,200).data;};
  const actual=read(png),wanted=read(expected);check(actual.every((n,i)=>n===wanted[i]),'注目マークを焼き込まず撮影後の原寸PNGは通常原稿のトーンと画素一致');
 }finally{engine.dispose();preview.dispose();host.remove();}
}

async function run(){
 const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);summary.textContent=`3D編集 検証中（${checks.length}）${label}`;};
 await toneChecks(check);
 await wait(()=>!!button('ネーム'),'app ready');await click('ネーム');await open3d();
 const lightSelect=document.querySelector<HTMLSelectElement>('[aria-label="光の雰囲気"]')!;lightSelect.value='indoor';lightSelect.dispatchEvent(new Event('change',{bubbles:true}));await tick();
 const daylight=document.querySelector<HTMLFieldSetElement>('.background3d-daylight')!;
 check(daylight.disabled&&Array.from(daylight.querySelectorAll('input,button')).every(el=>el.matches(':disabled'))&&Array.from(daylight.querySelectorAll('output')).every(el=>!el.textContent),'室内灯では日差し・窓の操作を無効にし、角度の数値を隠す');
 lightSelect.value='evening';lightSelect.dispatchEvent(new Event('change',{bubbles:true}));await tick();
 check(!daylight.disabled&&!!daylight.querySelector('output')?.textContent,'窓光へ戻すと日差しの操作と数値を復元');
 const brightness=document.querySelector<HTMLInputElement>('[aria-label="照明の明るさ（%）"]')!;brightness.value='35';brightness.dispatchEvent(new Event('input',{bubbles:true}));await tick();
 const boundary=document.querySelector<HTMLInputElement>('[aria-label="トーンの境界"]')!;boundary.value='62';boundary.dispatchEvent(new Event('input',{bubbles:true}));await tick();
 const bounce=document.querySelector<HTMLInputElement>('[aria-label="反射光（%）"]')!;bounce.value='43';bounce.dispatchEvent(new Event('input',{bubbles:true}));await tick();
 check(!document.querySelector('.background3d-controls [aria-label="トーン線数"],.background3d-controls [aria-label="トーン濃度"]'),'3D設定から線数と濃度を除き、レイヤーパレットの標準を使う');
 check(!!button('撮影して線画にする').querySelector('svg'),'撮影ボタンにカメラの絵を表示');
 check(['舞台','線','日差しと窓の光','光源','ベタとスクリーントーン'].every(label=>!!button(`${label}の環境設定`))&&document.querySelectorAll('.background3d-default-trigger').length===5&&!button('デフォルトに戻す'),'各項目に環境設定を一つずつ配置し、復元は開いた項目内だけに表示');
 check(!!button('日差しと窓の光の環境設定').closest('.background3d-daylight')&&!!button('ベタとスクリーントーンの環境設定').closest('.background3d-tone')&&!!document.querySelector('[data-tool-label="光源の設定"]')&&!document.querySelector('[data-tool-label="室内の光"]'),'項目ごとの設定を各欄に配置し、見出しを光源の設定に変更');
 check(!document.querySelector('.background3d-controls input[type=file],.background3d-focus-status')&&!!button('全体を収める').closest('.background3d-viewport-tools'),'右側からモデル読込と重複する注目操作を外し、構図合わせは原稿側へ配置');
 const hover=async(target:Element)=>{await tick();target.dispatchEvent(new PointerEvent('pointerover',{pointerType:'mouse',bubbles:true}));await wait(()=>!!document.querySelector('[role=tooltip]'),'hover guide');};
 const header=document.querySelector('.background3d-controls header strong')!;await hover(header);
 check(document.querySelector('[role=tooltip]')!.textContent!.includes('背景をドラッグすると'),'編集モード名にカーソルを合わせると操作説明を表示');
 header.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick();
 check(!!stage()&&brightness.value==='35'&&!document.querySelector('[role=tooltip]'),'Escで説明だけを閉じ、3D編集と微調整は保持');
 check(!document.querySelector('[role=tooltip]')&&!document.querySelector('.background3d-controls')!.textContent!.includes('背景をドラッグすると'),'説明は必要時だけ表示し、設定欄には常駐しない');
 const detailHelp=document.querySelector('.background3d-controls [data-tool-label="細部の省略"]')!;await hover(detailHelp);
 check(document.querySelector('[role=tooltip]')!.textContent!.includes('密集した形'),'各メニュー名にも対応した説明が出る');
 detailHelp.dispatchEvent(new PointerEvent('pointerout',{pointerType:'mouse',relatedTarget:document.body,bubbles:true}));await tick();
 check(document.querySelector('[data-tool-label="スクリーントーン"]')!.getAttribute('data-tool-help')!.startsWith('プレビューでは'),'トーンの説明にプレビューでの標準値であることを明記');
 await click('舞台の環境設定');
 check(!!document.querySelector('[data-default-group="stage"] [aria-label="大型オブジェクトを自動で隠す"]')&&document.querySelectorAll('[data-default-group="stage"] dd').length===1,'舞台の環境設定には大型オブジェクトの自動非表示だけを表示');
 await click('舞台の環境設定');
 for(const [label,group,count] of [['線','line',5],['日差しと窓の光','daylight',3],['光源','light',3],['ベタとスクリーントーン','tone',3]] as const){
  await click(`${label}の環境設定`);
  check(document.querySelectorAll(`[data-default-group="${group}"] dd`).length===count,`${label}の環境設定には対応する保存値だけを表示`);
  await click(`${label}のデフォルトを保存`);
 }
 const standard=loadBackground3dDefaults(localStorage)!;check(standard.light.intensity===.35&&standard.light.bounce===.43&&standard.toneThreshold===62,'表示中の光と描き方を個人のデフォルトとして保存');
 brightness.value='77';brightness.dispatchEvent(new Event('input',{bubbles:true}));boundary.value='81';boundary.dispatchEvent(new Event('input',{bubbles:true}));await tick();
 check(loadBackground3dDefaults(localStorage)?.light.intensity===.35&&document.querySelector('[data-default-key=intensity]')?.textContent==='35%'&&document.querySelector('[data-default-key=toneThreshold]')?.textContent==='62','微調整しても保存済みのデフォルトと表示値は変わらない');
 const outline=document.querySelector<HTMLInputElement>('[aria-label="輪郭の太さ"]')!;outline.value='3.3';outline.dispatchEvent(new Event('input',{bubbles:true}));await tick();
 await click('線のデフォルトを保存');
 check(loadBackground3dDefaults(localStorage)?.outlineWidth===3.3&&loadBackground3dDefaults(localStorage)?.light.intensity===.35&&loadBackground3dDefaults(localStorage)?.toneThreshold===62,'線の保存で他の欄の未保存の微調整を取り込まない');
 outline.value='7';outline.dispatchEvent(new Event('input',{bubbles:true}));await tick();await click('線をデフォルトに戻す');
 check(outline.value==='3.3'&&brightness.value==='77'&&boundary.value==='81','線の復元は光源やトーンの微調整を変えない');
 const elevation=document.querySelector<HTMLInputElement>('[aria-label="日差しの高さ"]')!;elevation.value='27';elevation.dispatchEvent(new Event('input',{bubbles:true}));await tick();await click('日差しと窓の光をデフォルトに戻す');
 check(elevation.value==='18'&&brightness.value==='77'&&boundary.value==='81','日差しの復元も明るさやトーンを変えない');
 await click('光源をデフォルトに戻す');check(brightness.value==='35'&&bounce.value==='43'&&boundary.value==='81','光源の復元はトーンの微調整を変えない');
 await click('ベタとスクリーントーンをデフォルトに戻す');check(brightness.value==='35'&&bounce.value==='43'&&boundary.value==='62','トーンの復元後も各欄のデフォルトを保持');
 await click('3D背景を閉じる');await open3d();
 check(document.querySelector<HTMLInputElement>('[aria-label="照明の明るさ（%）"]')!.value==='35'&&document.querySelector<HTMLInputElement>('[aria-label="反射光（%）"]')!.value==='43','新しい3D編集を開くと保存したデフォルトから始まる');
 stage()!.value=Array.from(stage()!.options).find(option=>option.value!=='builtin:cube')!.value;stage()!.dispatchEvent(new Event('change',{bubbles:true}));await tick();
 await wait(()=>!!stage()&&!button('撮影して線画にする').disabled&&stage()!.value!=='builtin:cube','registered stage with defaults');
 check(document.querySelector<HTMLInputElement>('[aria-label="照明の明るさ（%）"]')!.value==='35'&&document.querySelector<HTMLInputElement>('[aria-label="反射光（%）"]')!.value==='43'&&document.querySelector<HTMLInputElement>('[aria-label="日差しの高さ"]')!.value==='18','舞台設定の登録モデルに切り替えても保存済みの光の設定を維持');
 stage()!.value='builtin:cube';stage()!.dispatchEvent(new Event('change',{bubbles:true}));await tick();await wait(()=>!!stage()&&!button('撮影して線画にする').disabled&&stage()!.value==='builtin:cube','return to builtin');
 await saveCamera();check(savedShot()?.light.preset==='evening'&&savedShot()?.light.intensity===.35&&savedShot()?.toneThreshold===62&&savedShot()?.toneDensity===20,'35％の明るさと境界を保存し、固定トーン濃度を保持');await open3d();
 check(savedShot()?.toneLpi===defaultPaintTone().lpi&&savedShot()?.toneDensity===defaultPaintTone().density,'撮影したトーンもレイヤーパレットの標準線数・濃度と一致');
 check(document.querySelector<HTMLInputElement>('[aria-label="トーンの境界"]')!.value==='62'&&document.querySelector<HTMLSelectElement>('[aria-label="光の雰囲気"]')!.value==='evening','開き直した照明と境界スライダーを復元');
 const canvas=()=>document.querySelector<HTMLCanvasElement>('.background3d-canvas')!;
 check(!canvas().closest('[inert]'),'3D入力面は操作禁止の原稿層の外にある');
 check(document.querySelectorAll('.background3d-canvas').length===1&&!!document.querySelector('.background3d-focus'),'対象コマだけに3D入力面を作り周囲をグレーアウト');
 const shade=document.querySelector<SVGPathElement>('.background3d-focus-shade')!,page=document.querySelector('.background3d-window')!.closest('[data-panel-outline]')!.getBoundingClientRect();
 const isDimmed=(x:number,y:number)=>shade.isPointInFill(new DOMPoint(page.left+x/120*page.width,page.top+y/160*page.height));
 check(!isDimmed(60,50)&&isDimmed(100,12)&&isDimmed(60,110),'斜めコマの境界に沿い、対象コマ内だけグレー表示を除く');
 const native=document.querySelector('.manga-page-content');check(native?.hasAttribute('inert')===false,'人物と吹き出しの位置操作が有効');
 let before=await saveCamera();check(!document.querySelector('.background3d-focus'),'閉じるとグレーアウトを解除');await open3d();
 check(!document.querySelector('.background3d-controls .background3d-gizmo')&&!!document.querySelector('.background3d-viewport-tools .background3d-gizmo'),'回転の矢印は設定欄ではなく原稿上にある');
 const liveCanvas=canvas(),positions=[];
 for(const key of ['figure-0','bubble-0']){
  const target=document.querySelector<HTMLElement>(`[data-background3d-owner="${key}"]`)!,start=target.getBoundingClientRect();
  check(!!target&&start.width>0&&start.height>0,`${key}が3D背景と同じコマに表示される`);
  drag(target,8,4);await tick();const end=target.getBoundingClientRect();
  check(Math.abs(end.x-start.x-8)<1&&Math.abs(end.y-start.y-4)<1,`${key}をドラッグで移動できる`);
  check(canvas()===liveCanvas&&!!stage(),'配置変更中も3D表示とカメラを作り直さない');positions.push([end.x,end.y]);
 }
 const layoutCamera=await saveCamera();check(near(layoutCamera.position,before.position)&&near(layoutCamera.target,before.target),'人物と吹き出しの配置後もカメラ構図を保持');
 await open3d();for(const [i,key] of ['figure-0','bubble-0'].entries()){
  const box=document.querySelector(`[data-background3d-owner="${key}"]`)!.getBoundingClientRect();
  check(Math.abs(box.x-positions[i][0])<1&&Math.abs(box.y-positions[i][1])<1,`${key}の移動を保存して復元`);
 }

 const figure=document.querySelector<HTMLElement>('[data-background3d-owner="figure-0"]')!,figureBox=figure.getBoundingClientRect(),windowBox=canvas().getBoundingClientRect();
 await click('注目する物を選ぶ');
 pointer(figure,'pointerdown',windowBox.x+windowBox.width/2,windowBox.y+windowBox.height/2);pointer(window,'pointerup',windowBox.x+windowBox.width/2,windowBox.y+windowBox.height/2);await tick();
 check(!!button('物全体へ寄る')&&!document.querySelector('.is-background3d-picking'),'クリックした3Dの物に注目し選択待ちを終了');
 check(Math.abs(figure.getBoundingClientRect().x-figureBox.x)<1,'人物に重なった3Dの選択でも人物位置を変えない');
 before=await saveCamera();let pivot=savedShot()!.focusPoint!;check(savedShot()?.focusMesh===0&&!!pivot&&near(before.position,layoutCamera.position)&&near(before.target,layoutCamera.target),'注目対象と表面の点を保存し選択だけで構図を動かさない');await open3d();
 check(!!button('物全体へ寄る'),'開き直して注目対象を復元');
 await click('部分に注目');drag(document.querySelector('.background3d-scope')!,8,-3);await tick();check(!document.querySelector('.is-background3d-picking'),'部分に注目からスコープをドラッグした後、そのまま回転できる');
 const movedPivot=await saveCamera();check(near(movedPivot.position,before.position)&&near(movedPivot.target,before.target)&&!near(savedShot()!.focusPoint!,pivot),'スコープ移動を保存してもカメラは動かない');pivot=savedShot()!.focusPoint!;await open3d();
 drag(document.querySelector('.background3d-gizmo')!,15,10);await tick();let focused=await saveCamera();
 check(savedShot()?.focusMesh===0&&near(project(focused,pivot),project(before,pivot))&&!near(focused.position,before.position),'矢印をドラッグすると選んだ物を中心に回転');await open3d();
 await click('近づく');before=await saveCamera();
 check(near(project(before,pivot),project(focused,pivot))&&Math.abs(Math.hypot(...delta(before.position,pivot))/Math.hypot(...delta(focused.position,pivot))-.8)<1e-5,'近づくは対象の中心を保って実際にカメラの距離を縮める');await open3d();

 canvas().focus();const scrolls=Array.from(document.querySelectorAll('.canvas-scroll,.canvas-spread')).map(e=>({e,x:e.scrollLeft,y:e.scrollTop}));
 key('keydown',canvas());drag(canvas(),35,22);key('keyup',canvas());
 check(scrolls.every(({e,x,y})=>e.scrollLeft===x&&e.scrollTop===y),'Space移動で原稿全体はスクロールしない');
 let after=await saveCamera();check(near(after.position,before.position)&&near(after.target,before.target)&&!near(after.shift??[0,0],before.shift??[0,0]),'Space＋ドラッグは向きと遠近感を保って絵だけを平行移動');
 check(savedShot()?.focusMesh===0&&near(savedShot()!.focusPoint!,pivot),'絵を移動しても注目する物と緑の点を保持');
 await open3d();before=after;canvas().focus();drag(canvas(),22,12);after=await saveCamera();
 check(near(after.target,before.target)&&near(after.position,before.position)&&!near(after.shift??[0,0],before.shift??[0,0]),'Spaceなしの通常ドラッグもカット位置の移動');
 await open3d();before=after;canvas().focus();key('keydown',canvas());window.dispatchEvent(new Event('blur'));drag(canvas(),-10,-12);after=await saveCamera();
 check(near(after.target,before.target)&&near(after.position,before.position)&&!near(after.shift??[0,0],before.shift??[0,0]),'フォーカスを失った後も画面ドラッグはカット位置の移動');
 await open3d();check(!document.querySelector('[aria-label="3Dの画角"]')&&!document.querySelector('[aria-label="隠す奥行き"]'),'画角と隠す奥行きの設定をメニューから除外');
 await click('注目を解除');
 for(const [axis,index,sign] of [['X',0,1],['Y',1,1],['Z',2,-1]] as const){
  const name=`${axis}軸の${sign>0?'正':'負'}方向から見る`,control=document.querySelector(`[aria-label="${name}"]`)!;
  control.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();
  after=await saveCamera();const direction=delta(after.position,after.target),length=Math.hypot(...direction);
  check(Math.abs(direction[index]/length-sign)<1e-5,`${axis}軸の矢印で向きを選べる`);await open3d();
 }
 before=after;drag(document.querySelector('.background3d-gizmo')!,20,16);await tick();after=await saveCamera();
 check(near(after.target,before.target)&&!near(after.position,before.position),'ギズモのドラッグで任意の向きへ回転');
 await open3d();const input=document.querySelector<HTMLInputElement>('[aria-label="トーンの境界"]')!;input.focus();
 check(!key('keydown',input).defaultPrevented,'設定入力中のSpaceを奪わない');key('keyup',input);
 check((savedShot()!.layerIds??[]).length===3,'再撮影しても現在の撮影レイヤーは3枚だけ');
 await click('環境設定');check(!document.querySelector('.background3d-focus')&&!stage(),'画面移動でも編集モードを終了して直前の撮影を保持');
 await click('ネーム');await open3d();
 // Hold the renderer result and then image decoding separately to cover both
 // sides of the asynchronous capture/foreground-position boundary.
 const originalCapture=Background3dRenderer.prototype.capture,originalDecode=HTMLImageElement.prototype.decode;
 let releaseCapture=()=>{},releaseDecode=()=>{},captureReady=false,decodeReady=false;
 const captureGate=new Promise<void>(resolve=>{releaseCapture=resolve;}),decodeGate=new Promise<void>(resolve=>{releaseDecode=resolve;});
 Background3dRenderer.prototype.capture=async function(){const result=await originalCapture.call(this);captureReady=true;await captureGate;return result;};
 let movedBox:DOMRect;
 try{
  await click('撮影して線画にする');await wait(()=>captureReady,'capture result ready');
  const target=document.querySelector<HTMLElement>('[data-background3d-owner="figure-0"]')!,box=target.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;
  pointer(target,'pointerdown',x,y);pointer(target,'pointermove',x+5,y+3);await tick();movedBox=target.getBoundingClientRect();
  HTMLImageElement.prototype.decode=async function(){await originalDecode.call(this);decodeReady=true;await decodeGate;};
  releaseCapture();await wait(()=>decodeReady,'capture image decoding');
  drag(target,20,10);await tick();const lockedBox=target.getBoundingClientRect();
  check(Math.abs(lockedBox.x-movedBox.x)<1&&Math.abs(lockedBox.y-movedBox.y)<1,'撮影結果の保存中は新たな位置移動を受け付けない');
  releaseDecode();await wait(()=>!stage(),'capture complete');pointer(window,'pointerup',x+5,y+3);
 }finally{Background3dRenderer.prototype.capture=originalCapture;HTMLImageElement.prototype.decode=originalDecode;releaseCapture();releaseDecode();}
 await click('環境設定');await wait(()=>savedShot()?.layerIds.length===3,'captured layers saved');await click('ネーム');
 check(savedShot()?.layerIds.length===3,'明示的な撮影で線画・ベタ・トーンを作る');
 await open3d();const capturedBox=document.querySelector('[data-background3d-owner="figure-0"]')!.getBoundingClientRect();
 check(Math.abs(capturedBox.x-movedBox!.x)<1&&Math.abs(capturedBox.y-movedBox!.y)<1,'撮影完了をまたぐドラッグでも人物位置と撮影レイヤーを両方保持');
 await click('全体を収める');
 const context=()=>{const box=canvas().getBoundingClientRect();canvas().dispatchEvent(new MouseEvent('contextmenu',{button:2,clientX:box.x+box.width/2,clientY:box.y+box.height/2,bubbles:true,cancelable:true}));};
 const objectMenu=()=>document.querySelector('[role="menu"][aria-label="3Dの物の操作"]');
 const hiddenRow=()=>document.querySelector('[data-background-object="0"]');
 context();await tick();check(!objectMenu(),'未選択の右クリックで3Dの物のメニューを出さない');
 const selectCube=async()=>{await click('注目する物を選ぶ');const box=canvas().getBoundingClientRect();pointer(canvas(),'pointerdown',box.x+box.width/2,box.y+box.height/2);pointer(window,'pointerup',box.x+box.width/2,box.y+box.height/2);await tick();};
 await selectCube();context();await tick();check(!!objectMenu(),'対象を選択して右クリックすると隠すメニューを表示');
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick();check(!objectMenu()&&!!stage(),'Escは右クリックメニューだけを閉じる');
 context();await tick();await click('隠す');await wait(()=>!!hiddenRow(),'hidden object row');
 check(!objectMenu()&&!button('物全体へ寄る')&&!!hiddenRow()?.querySelector('svg path'),'選択した物を隠し、レイヤーに名前と目のバツを表示');
 await saveCamera();check(savedShot()?.objectVisibility?.[0]?.mode==='hide','非表示を撮影設定へ保存');await open3d();
 await wait(()=>!!hiddenRow(),'hidden object restored');check(!!hiddenRow(),'開き直しても非表示の物をレイヤー欄に保持');
 (hiddenRow()!.querySelector('button') as HTMLButtonElement).click();await wait(()=>!hiddenRow(),'object shown');
 await saveCamera();check(savedShot()?.objectVisibility?.[0]?.mode==='show','目のバツを押して再表示し角度が変わっても表示を保持');await open3d();
 await selectCube();context();await tick();await click('自動表示に戻す');await saveCamera();check(!savedShot()?.objectVisibility?.length,'右クリックで自動表示に戻せる');await open3d();
 context();await tick();await click('隠す');await wait(()=>!!hiddenRow(),'temporary hide');await click('3D背景を閉じる');await open3d();check(!hiddenRow(),'撮影せず閉じた非表示操作は保存しない');
 await click('環境設定');await click('表示');
 const guide=document.querySelector<HTMLInputElement>('[aria-label="編集ガイド"]')!;guide.checked=false;guide.dispatchEvent(new Event('change',{bubbles:true}));await tick();
 await click('ネーム');await open3d();
 document.querySelector('.background3d-controls header strong')!.dispatchEvent(new PointerEvent('pointerover',{pointerType:'mouse',bubbles:true}));await new Promise(resolve=>setTimeout(resolve,1200));
 check(!document.querySelector('[role=tooltip]'),'共通の編集ガイドをオフにすると3Dの説明も表示しない');
 await click('環境設定');await click('表示');const guideOn=document.querySelector<HTMLInputElement>('[aria-label="編集ガイド"]')!;guideOn.checked=true;guideOn.dispatchEvent(new Event('change',{bubbles:true}));await tick();await click('ネーム');await open3d();
 await hover(document.querySelector('.background3d-controls header strong')!);check(!!document.querySelector('[role=tooltip]'),'編集ガイドをオンに戻すと3D説明も復元');
 document.querySelector('.background3d-controls header strong')!.dispatchEvent(new PointerEvent('pointerout',{pointerType:'mouse',relatedTarget:document.body,bubbles:true}));
 return checks;
}

const doc=createEmptyWorkspaceDocument();doc.manga.meta.title='3D背景のスポット編集';doc.manga.meta.episode_id='background-editor-qa';
doc.manga.finish_settings={width_mm:120,height_mm:160,dpi:150,bleed_mm:0};doc.manga.pages[0].canvas={w:120,h:160,unit:'mm'};
doc.manga.pages[0].panels=[{id:1,shape:{type:'polygon',points:[[8,8],[112,24],[112,80],[8,80]]},bg:1,action:null,figures:[{name:'配置用の人物',size:'full',bbox:{x:20,y:32,w:28,h:40}}],bubbles:[{text:'位置を確認',shape:'normal',bbox:{x:75,y:33,w:22,h:28}}]},{id:2,shape:{type:'rect',x:8,y:88,w:104,h:64},bg:2,action:null,figures:[],bubbles:[]}];
void(async()=>{const registered=await prepareBackgroundStage(cubeGlb());await saveFigureCropAssets([{id:registered.stage.storageId,blob:registered.blob}]);doc.manga.background_stages=[registered.stage];localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));render(<App/>,document.getElementById('app')!);})();
const report=document.createElement('details');report.style.cssText='position:fixed;bottom:8px;left:180px;z-index:10001;max-width:700px;max-height:60vh;overflow:auto;padding:10px;background:white;border:1px solid #abc;font-size:12px;color:#123';
const summary=document.createElement('summary');summary.textContent='3D編集の検証';report.append(summary);const runButton=document.createElement('button');runButton.textContent='3D編集検証を実行';report.append(runButton);document.body.append(report);
runButton.onclick=()=>{report.open=false;runButton.disabled=true;void run().then(checks=>{summary.textContent=`3D編集 PASS（${checks.length}項目）`;const list=document.createElement('ul');checks.forEach(label=>{const item=document.createElement('li');item.textContent=label;list.append(item);});report.append(list);}).catch(error=>{summary.textContent=`3D編集 FAIL: ${String(error)}`;report.open=true;}).finally(()=>{runButton.disabled=false;});};
