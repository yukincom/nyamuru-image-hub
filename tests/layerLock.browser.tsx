/** Dedicated origin only. Uses the real App and synthetic documents/assets. */
import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {STORAGE_KEY,toStoredMangaYaml,parseMangaYaml} from '../src/lib/manga';
import {newPaintLayer} from '../src/lib/paintDocument';
import {defaultVectorStyle,vectorShape} from '../src/lib/vectorGeometry';
import {paintLayerCoverage,pickPaintLayer} from '../src/lib/paintLayerPicking';
import {savePaintBleed} from '../src/lib/paintPreferences';
import {renderPaintPng} from '../src/lib/paintRenderer';
import {saveFigureCropAssets} from '../src/lib/figureCropStore';
import type {PaintDocument,PaintLayer,ImageAsset} from '../src/types';
import '../src/styles/global.css';
if(location.port!=='4325')throw Error('Dedicated test origin on port 4325 required');
const tick=()=>new Promise(resolve=>setTimeout(resolve,70));
const wait=async(f:()=>boolean,label:string)=>{for(let i=0;i<160;i++){if(f())return;await tick();}throw Error(`Timed out: ${label}`);};
const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(el=>el.getAttribute('aria-label')===name||el.textContent?.trim()===name);
const click=async(name:string)=>{const el=button(name);if(!el||el.disabled)throw Error(`Button unavailable: ${name}`);el.click();await tick();};
const layerRow=(id:string)=>document.querySelector<HTMLElement>(`.layer-row[data-layer="${id}"]`);
const selectLayer=async(id:string)=>{const row=layerRow(id);if(!row)throw Error(`No layer row: ${id}`);row.querySelector<HTMLButtonElement>('.layer-select')!.click();await wait(()=>!!document.querySelector('.paint-input')&&!document.querySelector<HTMLButtonElement>('.layer-lock-control')?.disabled,'paint ready');await tick();};
const selected=(id:string)=>layerRow(id)?.getAttribute('aria-selected')==='true';
const vector=(id:string,color:string,y=200):PaintLayer=>({...newPaintLayer(id,'vector'),id,paths:[{...vectorShape('line',{x:100,y},{x:700,y},{...defaultVectorStyle(),width:14,stroke:color}),id:`path-${id}`}]});
const paint=(layers:PaintLayer[],width=1000,height=1000):PaintDocument=>({version:1,width,height,dpi:254,guideInitialized:true,layers});
const bg=paint([vector('奥の線','#0000ff'),vector('手前の線','#ff0000'),{...newPaintLayer('透明な上層'),id:'透明な上層',strokes:[{tool:'fill',color:'#00a000',size:1,points:[{x:0,y:0,pressure:1,time:0}],selection:[{x:100,y:500,w:200,h:100}]}]}]);
const front=paint([{...vector('別グループの固定線','#ff00ff',100),locked:true,paths:[{...vectorShape('line',{x:0,y:100},{x:600,y:100},{...defaultVectorStyle(),width:14,stroke:'#ff00ff'}),id:'foreign'}]}],600,400);
const doc=createEmptyWorkspaceDocument();doc.manga.meta.title='レイヤーロック検証';doc.manga.meta.episode_id='layer-lock-qa';doc.manga.finish_settings={width_mm:120,height_mm:160,dpi:254,bleed_mm:0};doc.manga.pages[0].canvas={w:120,h:160,unit:'mm'};
async function artwork(id:string,p:PaintDocument){
 const blob=await renderPaintPng(p,new Map()),asset:ImageAsset={id,storageId:`lock-test-${id}`,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join(''),mediaType:'image/png',originalName:`${id}.png`,widthPx:p.width,heightPx:p.height,byteLength:blob.size};
 await saveFigureCropAssets([{id:asset.storageId,blob}]);(doc.manga.image_assets??=[]).push(asset);
 return {assetId:id,crop:{x:0,y:0,w:p.width,h:p.height},opacity:1,hidden:false,locked:false,paint:p};
}
const bgArt=await artwork('bg',bg),frontArt=await artwork('front',front);
const plain={...bgArt,paint:undefined,crop:{x:0,y:0,w:1000,h:1000}};
doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:10,y:10,w:100,h:100},bg:1,action:null,bubbles:[],background_images:[{...bgArt,id:'background',bbox:{x:10,y:10,w:100,h:100}}],figures:[{name:'前面グループ',bbox:{x:20,y:20,w:60,h:40},artwork:frontArt}]}];
doc.manga.pages[0].images=[{...plain,id:'native-back',bbox:{x:80,y:125,w:25,h:25}},{...plain,id:'native-locked',locked:true,bbox:{x:80,y:125,w:25,h:25}}];
doc.manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',bubbles:[],figures:[{name:'前景の奥',bbox:{x:15,y:125,w:25,h:25},artwork:plain},{name:'前景の固定',bbox:{x:15,y:125,w:25,h:25},artwork:{...plain,locked:true}}]};
savePaintBleed(localStorage,0);localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));render(<App/>,document.getElementById('app')!);
const stored=()=>parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
const savedBackground=()=>stored().manga.pages[0].panels[0].background_images![0].paint!;
const flush=async()=>{await click('環境設定');await wait(()=>!document.querySelector('.paint-input'),'paint closed');await new Promise(resolve=>setTimeout(resolve,450));await click('ネーム');};
const pointer=(target:EventTarget,type:string,x:number,y:number)=>target.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:91,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true}));
async function gesture(x:number,y:number,dx=0,dy=0){
 const surface=document.querySelector<HTMLDivElement>('.paint-input')!;if(!surface)throw Error('No paint input');
 const paper=document.querySelector<HTMLElement>('.manga-paper')??surface.parentElement!,r=paper.getBoundingClientRect();
 // Selection surface spans the paper; draw surfaces retain the selected owner's frame.
 const canvas=surface.dataset.selectionSurface?surface.getBoundingClientRect():r;
 const px=canvas.x+x/120*canvas.width,py=canvas.y+y/160*canvas.height;
 for(const key of ['setPointerCapture','releasePointerCapture','hasPointerCapture'])Object.defineProperty(surface,key,{value:()=>false,configurable:true});
 try{pointer(surface,'pointerdown',px,py);pointer(window,'pointermove',px+dx/120*canvas.width,py+dy/160*canvas.height);pointer(window,'pointerup',px+dx/120*canvas.width,py+dy/160*canvas.height);await tick();}
 finally{for(const key of ['setPointerCapture','releasePointerCapture','hasPointerCapture'])delete (surface as unknown as Record<string,unknown>)[key];}
}
async function nativeDrag(target:HTMLElement,dx=10){const r=target.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;pointer(target,'pointerdown',x,y);pointer(window,'pointermove',x+dx,y);pointer(window,'pointerup',x+dx,y);await new Promise(resolve=>setTimeout(resolve,450));}
async function run(){
 const checks:string[]=[],check=(value:unknown,label:string)=>{if(!value)throw Error(label);checks.push(label);summary.textContent=`レイヤーロック 検証中（${checks.length}）${label}`;};
 render(null,document.getElementById('app')!);await tick();savePaintBleed(localStorage,0);localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));render(<App/>,document.getElementById('app')!);
 await wait(()=>!!button('ネーム'),'App ready');await click('ネーム');await selectLayer('手前の線');
 const actions=document.querySelector('.layer-icon-actions')!,labels=Array.from(actions.querySelectorAll('button')).map(el=>el.getAttribute('aria-label'));
 check(labels.indexOf('レイヤーを固定')===labels.indexOf('生成マスク化')+1&&labels.indexOf('複製')===labels.indexOf('レイヤーを固定')+1,'固定ボタンは生成マスクと複製の間');
 check(document.querySelector('.layer-lock-control svg')?.getAttribute('fill')==='#000'&&!layerRow('手前の線')?.querySelector('[data-layer-lock-icon]'),'固定前もtoolbarは黒い閉じ錠、未固定の行は錠なし');
 await click('パス選択');await gesture(50,30);check(selected('手前の線')&&document.querySelector('.vector-selection-path'),'別ownerの固定線と上層の透明部を飛ばして手前の線を選択');
 await click('レイヤーを固定');check(layerRow('手前の線')?.querySelector('[data-layer-lock-icon]')&&!document.querySelector('.vector-selection-path'),'固定すると行に錠を表示し選択中のパスを解除');
 const density=document.querySelector<HTMLInputElement>('[aria-label="レイヤーの濃度"]')!,blend=document.querySelector<HTMLSelectElement>('[aria-label="レイヤーの合成"]')!;
 check(density.disabled&&blend.disabled&&button('削除')?.disabled&&document.querySelector<HTMLFieldSetElement>('.paint-layer-effects fieldset')?.disabled,'固定中は濃度・合成・効果・削除を無効化');
 density.value='0.2';density.dispatchEvent(new Event('input',{bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));await tick();
 await click('ペン');await gesture(50,30,0,2);await click('パス選択');
 await gesture(50,30,0,5);check(selected('奥の線'),'固定した選択層を飛ばし奥の線を同じドラッグで選択・移動');
 await flush();const saved=savedBackground(),back=saved.layers.find(l=>l.id==='奥の線')!,locked=saved.layers.find(l=>l.id==='手前の線')!;
 check(back.paths![0].nodes[0].y>200&&locked.paths![0].nodes[0].y===200&&locked.opacity===1&&locked.locked&&locked.strokes.length===0,'保存後も固定線は不変、奥の線だけ移動');
 await selectLayer('手前の線');check(button('レイヤーの固定を解除')&&!button('レイヤーの固定を解除')!.disabled,'固定行を選択してtoolbarから解除可能');await click('レイヤーの固定を解除');check(!layerRow('手前の線')?.querySelector('[data-layer-lock-icon]')&&!document.querySelector<HTMLInputElement>('[aria-label="レイヤーの濃度"]')!.disabled,'同じボタンで解除し編集を再開');
 await click('パス選択');await gesture(50,30,0,3);check(selected('手前の線'),'解除した線を再び掴める');
 await selectLayer('透明な上層');await click('パス選択');await gesture(25,65,5,0);check(selected('透明な上層'),'描かれた画素ではラスター層を選択・単独移動');await click('ペン');await gesture(50,75,0,2);await flush();
 check(savedBackground().layers.find(l=>l.id==='透明な上層')!.strokes[0].selection![0].x>100,'ラスターの移動を原稿へ保存');check(savedBackground().layers.find(l=>l.id==='透明な上層')!.strokes.length===2,'通常のペンは選択した現在レイヤーへ描画');
 // Locked native elements must be absent from browser hit testing, including selected proxies.
 const lockedNative=document.querySelector<HTMLElement>('.placed-image-layer [data-artwork-locked]')!,r=lockedNative.getBoundingClientRect();
 const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2) as HTMLElement;
 check(lockedNative.style.pointerEvents==='none'&&!lockedNative.contains(hit),'配置画像の固定対象はブラウザーのヒットテストを通過');
 const nativeBack=document.querySelector<HTMLElement>('.placed-image-layer .placed-image:not([data-artwork-locked])')!,before=stored().manga.pages[0].images!.map(i=>i.bbox.x);await nativeDrag(nativeBack);
 await wait(()=>stored().manga.pages[0].images![0].bbox.x!==before[0],'native move persisted');
 check(stored().manga.pages[0].images![0].bbox.x!==before[0]&&stored().manga.pages[0].images![1].bbox.x===before[1],'配置画像も固定前面を残して奥だけドラッグ');
 const overlayLocked=document.querySelector<HTMLElement>('.page-overlay-figure-layer [data-artwork-locked]')!,or=overlayLocked.getBoundingClientRect(),overlayHit=document.elementFromPoint(or.x+or.width/2,or.y+or.height/2) as HTMLElement;
 check(overlayLocked.style.pointerEvents==='none'&&!overlayLocked.contains(overlayHit),'ページ前景の固定対象もヒットテストを通過');
 const overlayBack=document.querySelector<HTMLElement>('.page-overlay-figure-layer .placed-image:not([data-artwork-locked])')!,old=stored().manga.pages[0].page_overlay!.figures!.map(f=>f.bbox!.x);await nativeDrag(overlayBack);
 await wait(()=>stored().manga.pages[0].page_overlay!.figures![0].bbox!.x!==old[0],'overlay move persisted');
 check(stored().manga.pages[0].page_overlay!.figures![0].bbox!.x!==old[0]&&stored().manga.pages[0].page_overlay!.figures![1].bbox!.x===old[1],'ページ前景でも奥だけ移動');
 // Actual renderer alpha: masked hole and erased raster pixels are transparent to selection.
 const backLayer=vector('alpha-back','#000000',500),raster:PaintLayer={...newPaintLayer('alpha-front'),strokes:[{tool:'fill',color:'#000000',size:1,points:[{x:0,y:0,pressure:1,time:0}],selection:[{x:0,y:0,w:1000,h:1000}]},{tool:'clear',color:'#000000',size:1,points:[{x:0,y:0,pressure:1,time:0}],selection:[{x:300,y:300,w:400,h:400}]}]};
 const owner={key:'background',kind:'background' as const,index:0,label:'',frame:{x:0,y:0,w:100,h:100},paint:paint([backLayer,raster])},scene={frame:owner.frame,owners:[owner]},coverage=paintLayerCoverage(new Map());
 check(pickPaintLayer(scene,{x:50,y:50},0,coverage)?.layer===backLayer&&pickPaintLayer(scene,{x:15,y:15},0,coverage)?.layer===raster,'実描画の消し跡は透過し、不透明画素では手前を選択');
 return checks;
}
const report=document.createElement('details');report.open=true;report.style.cssText='position:fixed;bottom:8px;left:150px;z-index:10001;max-width:680px;max-height:55vh;overflow:auto;padding:10px;background:white;border:1px solid #abc;font-size:12px;color:#123';const summary=document.createElement('summary');summary.textContent='レイヤーロック検証';report.append(summary);const runButton=document.createElement('button');runButton.textContent='レイヤーロック検証を実行';report.append(runButton);document.body.append(report);
runButton.onclick=()=>{report.open=false;runButton.disabled=true;void run().then(checks=>{summary.textContent=`レイヤーロック PASS（${checks.length}項目）`;for(const label of checks){const p=document.createElement('p');p.textContent=label;report.append(p);}}).catch(error=>{summary.textContent=`レイヤーロック FAIL: ${String(error)}`;report.open=true;}).finally(()=>{runButton.disabled=false;});};
