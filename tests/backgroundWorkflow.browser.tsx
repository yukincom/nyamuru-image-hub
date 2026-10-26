import {render} from 'preact';
import {Background3dRenderer} from '../src/lib/background3dRenderer';
import type {BackgroundCapture} from '../src/types';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {STORAGE_KEY,toStoredMangaYaml,parseMangaYaml} from '../src/lib/manga';
import {paintAssetLease} from '../src/lib/paintAssetLease';
import {loadFigureCropAsset,pruneFigureCropAssets} from '../src/lib/figureCropStore';
import {saveHistorySteps} from '../src/lib/historyPreferences';
import '../src/styles/global.css';
if(location.port!=='4325')throw Error('Dedicated test origin required');
const doc=createEmptyWorkspaceDocument();doc.manga.meta.title='撮影と共通履歴の検証';doc.manga.meta.episode_id='background-workflow-qa';
doc.manga.finish_settings={width_mm:120,height_mm:160,dpi:100,bleed_mm:0};doc.manga.pages[0].canvas={w:120,h:160,unit:'mm'};
doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:8,y:8,w:104,h:64},bg:1,action:null,figures:[],bubbles:[]},{id:2,shape:{type:'rect',x:8,y:88,w:104,h:64},bg:2,action:null,figures:[],bubbles:[]}];
saveHistorySteps(localStorage,50);localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));render(<App/>,document.getElementById('app')!);

const tick=()=>new Promise(resolve=>setTimeout(resolve,60));
const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(el=>el.getAttribute('aria-label')===name||el.textContent?.trim()===name)!;
const wait=async(predicate:()=>boolean,label:string)=>{for(let i=0;i<350;i++){if(predicate())return;await tick();}throw Error(`Timed out: ${label}`);};
const click=async(name:string)=>{const el=button(name);if(!el||el.disabled)throw Error(`Button unavailable: ${name}`);el.click();await tick();};
const stage=()=>document.querySelector<HTMLSelectElement>('[aria-label="3Dの舞台"]');
const stored=()=>parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
const savedPaint=(index=0)=>stored().manga.pages[0].panels[index].background_images?.[0]?.paint;
const savedShot=(index=0)=>savedPaint(index)?.background3d;
const paintReady=()=>{const select=document.querySelector<HTMLSelectElement>('[aria-label="レイヤーの合成"]');return !!select&&!select.disabled;};
const open3d=async()=>{await click('背景あたりの3Dモデルを配置・調整');await wait(()=>!!stage()&&!button('3D背景を撮影')?.disabled,'3D ready');};
let liveCamera:BackgroundCapture['camera'];
const originalConfigure=Background3dRenderer.prototype.configure;
Background3dRenderer.prototype.configure=function(config){liveCamera=structuredClone(config.camera);return originalConfigure.call(this,config);};
async function pan(dx:number,dy:number){
 const canvas=document.querySelector<HTMLCanvasElement>('.background3d-canvas')!,box=canvas.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;
 for(const name of ['setPointerCapture','releasePointerCapture','hasPointerCapture'])Object.defineProperty(canvas,name,{value:()=>false,configurable:true});
 try{pointer(canvas,'pointerdown',x,y);pointer(window,'pointermove',x+dx*box.width,y+dy*box.height);pointer(window,'pointerup',x+dx*box.width,y+dy*box.height);await tick();}
 finally{for(const name of ['setPointerCapture','releasePointerCapture','hasPointerCapture'])delete (canvas as unknown as Record<string,unknown>)[name];}
}
const cameraIs=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const capture=async()=>{await click('3D背景を撮影');await wait(()=>!stage()&&paintReady(),'capture materialized');await new Promise(resolve=>setTimeout(resolve,450));};
const flush=async()=>{await click('環境設定');await wait(()=>!document.querySelector('.paint-input'),'paint closed');await new Promise(resolve=>setTimeout(resolve,450));await click('ネーム');};
const pointer=(target:EventTarget,type:string,x:number,y:number)=>target.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:31,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true}));
async function stroke(offset=0){await click('ペン');await wait(paintReady,'paint images');const surface=document.querySelector<HTMLElement>('.paint-input')!;
 for(const name of ['setPointerCapture','releasePointerCapture','hasPointerCapture'])Object.defineProperty(surface,name,{value:()=>false,configurable:true});
 try {const r=surface.getBoundingClientRect(),x=r.x+r.width*.45,y=r.y+r.height*.45+offset;pointer(surface,'pointerdown',x,y);pointer(window,'pointermove',x+14,y+8);pointer(window,'pointerup',x+14,y+8);await tick();}
 finally{for(const name of ['setPointerCapture','releasePointerCapture','hasPointerCapture'])delete (surface as unknown as Record<string,unknown>)[name];}
}
async function undo(){await click('元に戻す');await wait(()=>!document.querySelector('.paint-input')||paintReady(),'undo images');}
async function redo(){await click('やり直す');await wait(()=>!document.querySelector('.paint-input')||paintReady(),'redo images');}
async function run(assetsOnly=false){
 const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);summary.textContent=`撮影と履歴 検証中（${checks.length}）${label}`;};
 render(null,document.getElementById('app')!);await tick();
 const leaseA=paintAssetLease(),leaseB=paintAssetLease();await Promise.all([leaseA.ready,leaseB.ready]);
 const assetA=leaseA.storageId(),assetB=leaseB.storageId();
 try{
  await leaseA.save([{id:assetA,blob:new Blob(['A'])}]);await leaseB.save([{id:assetB,blob:new Blob(['B'])}]);
  await leaseA.prune(()=>[]);await leaseB.prune(()=>[assetB]);check(!!await loadFigureCropAsset(assetA),'別タブに相当する稼働中sessionの作画原本は回収しない');
  await pruneFigureCropAssets([]);check(!!await loadFigureCropAsset(assetA),'一般的な画像整理でも稼働中の撮影を消さない');
  leaseA.dispose();await tick();
  check(await leaseB.prune(()=>null)===0&&!!await loadFigureCropAsset(assetA),'保存中の作品が不明な場合は終了sessionの原本も回収しない');
  await leaseB.prune(()=>[assetB]);check(!await loadFigureCropAsset(assetA)&&!!await loadFigureCropAsset(assetB),'終了したsessionの未参照撮影だけ回収できる');
 }finally{leaseA.dispose();leaseB.dispose();}
 if(assetsOnly)return checks;
 render(<App/>,document.getElementById('app')!);
 await wait(()=>!!button('ネーム'),'app ready');await click('ネーム');
 await open3d();check(button('3D背景を撮影')?.textContent?.includes('撮影')===true&&!button('背景あたりの3Dモデルを配置・調整'),'背景フォルダの3D編集が撮影ボタンへ切り替わる');
 await pan(.1,.02);await tick();await click('3D背景を閉じる');await flush();
 check(!savedShot()&&button('元に戻す').disabled,'未撮影で閉じたカメラ調整は原稿にも履歴にも残さない');
 await open3d();await pan(.04,-.015);await tick();await capture();
 const cameraA=structuredClone(savedShot()!.camera),shotA=JSON.stringify(savedShot()),pathsA=JSON.stringify(savedPaint()!.layers.find(l=>l.name==='3D 線画')!.paths),initialLayerCount=savedPaint()!.layers.length;
 check(Math.abs((cameraA.shift?.[0]??0)-.04)<1e-6&&savedShot()?.layerIds.length===3,'撮影Aを原稿へ即反映し3レイヤーで編集を続けられる');
 check(savedPaint()!.layers.find(l=>l.name==='3D 線画')?.kind==='vector'&&!!savedPaint()!.layers.find(l=>l.name==='3D トーン')?.tone,'線はベクター、トーンは濃度と領域を編集可能');
 const capturedNames=()=>Array.from(document.querySelectorAll('[data-owner="background"][data-layer] .layer-select')).map(el=>el.getAttribute('data-tool-label')).filter(name=>name?.startsWith('3D '));
 check(JSON.stringify(capturedNames())===JSON.stringify(['3D トーン','3D ベタ','3D 線画']),'撮影したレイヤーは上からトーン・ベタ・線画の順に表示');
 check(document.querySelector('[data-owner="background"][aria-selected="true"] .layer-select')?.getAttribute('data-tool-label')==='3D 線画','並び順を変えても撮影後は線画を選択し編集できる');
 const pupils=Array.from(document.querySelectorAll('.layer-visibility[aria-pressed="true"] .lucide-eye circle'));
 check(pupils.length>0&&pupils.every(pupil=>getComputedStyle(pupil).fill===getComputedStyle(pupil).color),'可視の目の中心は黒目として塗りつぶす');
 await open3d();await pan(.12,.04);await tick();await click('3D背景を閉じる');await flush();
 check(JSON.stringify(savedShot())===shotA,'保存せずに閉じると前の撮影Aの構図・レイヤーに戻る');
 await open3d();await pan(.12,.04);await tick();await click('環境設定');await wait(()=>!stage(),'cancel on navigation');await new Promise(resolve=>setTimeout(resolve,450));await click('ネーム');
 check(JSON.stringify(savedShot())===shotA,'画面移動でも未撮影のカメラを保存しない');
 await open3d();await pan(-.025,.02);await tick();await capture();const cameraB=structuredClone(savedShot()!.camera),shotB=JSON.stringify(savedShot());
 check(savedPaint()!.layers.length===initialLayerCount&&shotA!==shotB,'再撮影Bは撮影レイヤーだけを置換し非表示の旧レイヤーを増やさない');
 check(JSON.stringify(capturedNames())===JSON.stringify(['3D トーン','3D ベタ','3D 線画']),'再撮影でもトーン・ベタ・線画の順を保持');
 await undo();await flush();check(JSON.stringify(savedShot())===shotA&&JSON.stringify(savedPaint()!.layers.find(l=>l.name==='3D 線画')!.paths)===pathsA,'1回のundoで撮影Aと編集可能な線を復元');
 await redo();await flush();check(JSON.stringify(savedShot())===shotB,'1回のredoで撮影Bへ比較表示を戻す');
 await click('背景');await wait(paintReady,'background paint ready');await stroke();await stroke(14);
 await open3d();await pan(.03,-.02);await tick();const draftCamera=structuredClone(liveCamera),fetchOriginal=window.fetch;
 try{window.fetch=async()=>{throw Error('検証用：保存先選択を中断');};await click('保存');await wait(()=>!!stage()&&!button('3D背景を撮影')?.disabled,'project save attempted');}
 finally{window.fetch=fetchOriginal;}
 check(!!stage()&&cameraIs(liveCamera,draftCamera),'ペン保存を伴う作品保存でも未撮影のカメラ調整を維持');
 await click('3D背景を閉じる');await flush();
 const strokes=()=>savedPaint()!.layers.reduce((n,l)=>n+l.strokes.length,0);
 check(strokes()===2,'撮影後のペン2操作を原稿へ保存');
 await click('コマ 02を選択');await open3d();await pan(.02,-.01);await tick();await capture();await flush();
 const cameraOther=structuredClone(savedShot(1)!.camera);check(Math.abs((cameraOther.shift?.[0]??0)-.02)<1e-6,'別のコマでも撮影を確定');
 const action=document.querySelector<HTMLTextAreaElement>('[aria-label="ト書き"]')!;action.value='最後の配置側編集';action.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,450));
 check(stored().manga.pages[0].panels[1].action==='最後の配置側編集','通常の原稿編集を履歴の最後へ追加');
 await undo();await flush();check(!stored().manga.pages[0].panels[1].action&&!!savedShot(1),'undoは通常編集だけを戻す');
 await undo();await flush();check(!savedShot(1)&&cameraIs(savedShot()?.camera,cameraB)&&strokes()===2,'次のundoで別コマの撮影を戻す');
 await undo();await flush();check(strokes()===1,'次のundoで先のコマのペン2操作目を戻す');
 await undo();await flush();check(strokes()===0,'次のundoで先のコマのペン1操作目を戻す');
 await undo();await flush();check(JSON.stringify(savedShot())===shotA,'続いて元の撮影Aまで戻れる');
 for(let i=0;i<5;i++){await redo();await flush();}
 check(cameraIs(savedShot()?.camera,cameraB)&&cameraIs(savedShot(1)?.camera,cameraOther)&&strokes()===2&&stored().manga.pages[0].panels[1].action==='最後の配置側編集','redoも撮影・ペン・別コマ・通常編集を同じ順番で復元');
 const beforeFocus=structuredClone(savedShot()!.camera);await click('コマ 01を選択');await open3d();await click('注目する物を選ぶ');const canvas=document.querySelector<HTMLCanvasElement>('.background3d-canvas')!,box=canvas.getBoundingClientRect();pointer(canvas,'pointerdown',box.x+box.width/2,box.y+box.height/2);pointer(window,'pointerup',box.x+box.width/2,box.y+box.height/2);await tick();
 check(!!button('部分に注目'),'物の選択後に部分フォーカスが選べる');
 await click('部分に注目');pointer(canvas,'pointerdown',box.x+box.width*.55,box.y+box.height*.47);pointer(window,'pointerup',box.x+box.width*.55,box.y+box.height*.47);await tick();await capture();
 const point=savedShot()!.focusPoint;check(!!point&&point.some(n=>Math.abs(n)>.01)&&JSON.stringify(savedShot()!.camera)===JSON.stringify(beforeFocus),'選択した表面の一点を構図を変えずに回転の中心として保存');
 await open3d();check(!!document.querySelector('.background3d-viewport-tools .background3d-selected-name')&&JSON.stringify(savedShot()!.focusPoint)===JSON.stringify(point),'再編集でも部分フォーカスを復元');await click('近づく');await capture();
 check(JSON.stringify(savedShot()!.focusPoint)===JSON.stringify(point),'近づいても部分フォーカスの中心を保つ');
 await flush();await click('環境設定');await click('作画方法');const limit=document.querySelector<HTMLInputElement>('[aria-label="履歴の保持ステップ数"]')!;check(limit.value==='50','共通履歴の既定は50段階');limit.value='2';limit.dispatchEvent(new Event('input',{bubbles:true}));limit.dispatchEvent(new Event('change',{bubbles:true}));await tick();await click('ネーム');
 await click('コマ 01を選択');await click('背景');await wait(paintReady,'paint for retention');await stroke();await stroke(12);await stroke(24);
 await undo();await undo();check(button('元に戻す').disabled,'保持数2ではペン操作を含め2段階まで戻れる');
 await stroke(30);check(button('やり直す').disabled,'undo後の新しい描画でredo側を破棄');
 await flush();const preserved=structuredClone(savedShot()!.camera);render(null,document.getElementById('app')!);render(<App/>,document.getElementById('app')!);await wait(()=>!!button('ネーム'),'reopen');
 check(button('元に戻す').disabled&&button('やり直す').disabled&&cameraIs(savedShot()?.camera,preserved),'作品を開き直すと履歴だけ消え撮影済み背景は残る');
 return checks;
}
const report=document.createElement('details');report.open=true;report.style.cssText='position:fixed;bottom:8px;left:150px;z-index:10001;max-width:650px;max-height:55vh;overflow:auto;padding:10px;background:white;border:1px solid #abc;font-size:12px;color:#123';
const summary=document.createElement('summary');summary.textContent='撮影と共通履歴の検証';report.append(summary);const runButton=document.createElement('button');runButton.textContent='撮影と共通履歴の検証を実行';report.append(runButton);document.body.append(report);
const assetsButton=document.createElement('button');assetsButton.textContent='原本保持だけを検証';report.append(assetsButton);
const start=(assetsOnly=false)=>{report.open=false;runButton.disabled=assetsButton.disabled=true;void run(assetsOnly).then(checks=>{summary.textContent=`${assetsOnly?'原本保持':'撮影と履歴'} PASS（${checks.length}項目）`;report.open=true;for(const label of checks){const item=document.createElement('p');item.textContent=label;report.append(item);}}).catch(error=>{summary.textContent=`撮影と履歴 FAIL: ${String(error)}`;report.open=true;}).finally(()=>{runButton.disabled=assetsButton.disabled=false;});};
runButton.onclick=()=>start();assetsButton.onclick=()=>start(true);
