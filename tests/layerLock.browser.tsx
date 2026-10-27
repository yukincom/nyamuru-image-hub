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
const selectLayer=async(id:string)=>{const row=layerRow(id);if(!row)throw Error(`No layer row: ${id}`);const select=row.querySelector<HTMLButtonElement>('.layer-select')!;await wait(()=>!select.disabled,`${id} row ready`);select.click();await wait(()=>!!document.querySelector('.paint-input')&&selected(id),`${id} paint ready`);await wait(()=>!layerRow(id)?.querySelector<HTMLButtonElement>('.layer-row-lock')?.disabled,`${id} controls ready`);};
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
doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:10,y:10,w:100,h:100},bg:1,action:null,
 bubbles:[{text:'直接選択の確認',shape:'normal',speaker:'前面グループ',bbox:{x:65,y:28,w:32,h:24}}],
 screen_text:[{text:'固定確認',orientation:'horizontal',bbox:{x:45,y:84,w:24,h:8}}],
 background_images:[{...bgArt,id:'background',bbox:{x:10,y:10,w:100,h:100}}],figures:[{name:'前面グループ',kind:'person',bbox:{x:20,y:20,w:60,h:40},artwork:frontArt}]}];
doc.manga.pages[0].images=[{...plain,id:'native-back',bbox:{x:80,y:125,w:25,h:25}},{...plain,id:'native-locked',locked:true,bbox:{x:80,y:125,w:25,h:25}}];
doc.manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',bubbles:[],figures:[{name:'前景の奥',bbox:{x:15,y:125,w:25,h:25},artwork:plain},{name:'前景の固定',bbox:{x:15,y:125,w:25,h:25},artwork:{...plain,locked:true}}]};
savePaintBleed(localStorage,0);localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));render(<App/>,document.getElementById('app')!);
const stored=()=>parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
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
 await wait(()=>!!button('ネーム'),'App ready');await click('ネーム');
 const fixedLabels=['フォルダー追加','ラスターレイヤー追加','ベクターレイヤー追加','トーンレイヤー作成','生成マスク化','複製'];
 const headerActions=()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.page-layer-palette>.layer-controls>.layer-icon-actions>button'));
 const panelActions=headerActions(),panelSlots=panelActions.map(el=>el.getBoundingClientRect().left);
 check(panelActions.length===7&&fixedLabels.every((label,index)=>panelActions[index].getAttribute('aria-label')===label),'コマ選択でも上部7操作を固定順で表示');
 check(panelActions.slice(0,3).every(el=>el.getAttribute('aria-disabled')!=='true')&&panelActions.slice(3,6).every(el=>el.getAttribute('aria-disabled')==='true'&&Number(getComputedStyle(el).opacity)<=.35),'コマでは使える追加操作だけを有効にし、他は同じ位置で灰色表示');
 check(!Array.from(document.querySelectorAll('.layer-group-select .layer-caption')).some(el=>el.textContent?.trim()==='コマ内')&&!document.querySelector('.page-direct-layer-group')&&!!document.querySelector('[aria-label="コマ外レイヤーを追加"]'),'空のコマ内・コマ外フォルダーは出さず、追加操作だけを表示');
 await selectLayer('手前の線');
 const actions=document.querySelector('.page-layer-palette>.layer-controls>.layer-icon-actions')!,actionButtons=Array.from(actions.querySelectorAll<HTMLButtonElement>('button')),labels=actionButtons.map(el=>el.getAttribute('aria-label'));
 check(actionButtons.length===7&&fixedLabels.every((label,index)=>labels[index]===label)&&!labels.some(label=>label?.includes('固定'))&&labels.indexOf('複製')===labels.indexOf('生成マスク化')+1,'描画レイヤーでも同じ7操作を固定順で表示');
 check(actionButtons.every((el,index)=>Math.abs(el.getBoundingClientRect().left-panelSlots[index])<1),'選択対象を変えても上部操作の横位置を変えない');
 const unlockedRow=layerRow('手前の線')!,rowLock=unlockedRow.querySelector<HTMLButtonElement>('.layer-row-lock')!;
 const openIcon=rowLock.querySelector<SVGElement>('[data-layer-lock-icon="open"]')!,openBody=openIcon.querySelector<SVGRectElement>('rect')!;
 check(rowLock===unlockedRow.lastElementChild&&rowLock.getAttribute('aria-label')==='手前の線を固定'&&rowLock.getAttribute('aria-pressed')==='false'&&rowLock.classList.contains('is-unlocked')&&getComputedStyle(rowLock).opacity==='0'&&openIcon.getAttribute('stroke')==='#000'&&openIcon.getAttribute('stroke-width')==='1.25'&&openBody.getAttribute('fill')==='#fff','未固定の錠は通常時に隠れ、ホバー時用の黒い細線・白塗りの開錠表示を右端に持つ');
 await click('配置へ戻る');await gesture(50,30);check(selected('手前の線')&&document.querySelector('.vector-selection-path'),'別ownerの固定線と上層の透明部を飛ばして手前の線を選択');
 await click('手前の線を固定');check(layerRow('手前の線')?.querySelector('.layer-row-lock.is-locked')&&!document.querySelector('.vector-selection-path'),'右端の錠で固定し選択中のパスを解除');
 const density=document.querySelector<HTMLInputElement>('[aria-label="レイヤーの濃度"]')!,blend=document.querySelector<HTMLSelectElement>('[aria-label="レイヤーの合成"]')!;
 await wait(()=>{const remove=document.querySelector<HTMLButtonElement>('.layer-icon-actions [aria-label="削除"]'),effects=document.querySelector<HTMLFieldSetElement>('.paint-layer-effects fieldset');return density.disabled&&blend.disabled&&Boolean(remove&&(remove.disabled||remove.getAttribute('aria-disabled')==='true'))&&Boolean(effects?.disabled);},'locked controls disabled');
 check(true,'固定中は濃度・合成・効果・削除を無効化');
 density.value='0.2';density.dispatchEvent(new Event('input',{bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));await tick();
 await click('ペン');await gesture(50,30,0,2);await click('配置へ戻る');
 await gesture(50,30,0,5);check(selected('奥の線'),'固定した選択層を飛ばし奥の線を同じドラッグで選択・移動');
 await selectLayer('手前の線');await wait(()=>Boolean(button('手前の線の固定を解除')&&!button('手前の線の固定を解除')!.disabled),'locked row controls ready');check(true,'固定行自身の右端錠は解除可能');await click('手前の線の固定を解除');check(layerRow('手前の線')?.querySelector('.layer-row-lock.is-unlocked')&&!document.querySelector<HTMLInputElement>('[aria-label="レイヤーの濃度"]')!.disabled,'同じ右端錠で解除し編集を再開');
 await click('配置へ戻る');await gesture(50,30);check(selected('手前の線'),'解除した線を再び掴める');
 await click('手前の線を固定');await click('背景を固定');const inherited=layerRow('手前の線')?.querySelector<HTMLButtonElement>('.layer-row-lock');
 check(button('背景の固定を解除')&&!button('背景の固定を解除')!.disabled&&inherited?.disabled&&inherited.classList.contains('is-inherited')&&inherited.getAttribute('aria-label')==='手前の線は親フォルダーで固定中','背景フォルダー固定は子レイヤーへ灰色の解除不能な継承錠として伝わる');
 await click('背景の固定を解除');const childAfterParentUnlock=layerRow('手前の線')?.querySelector<HTMLButtonElement>('.layer-row-lock');check(!childAfterParentUnlock?.disabled&&childAfterParentUnlock?.getAttribute('aria-pressed')==='false','親フォルダー解除時は子レイヤーもまとめて解除');
 await selectLayer('透明な上層');await click('配置へ戻る');await gesture(25,65,5,0);check(selected('透明な上層'),'描かれた画素ではラスター層を選択・単独移動');await click('ペン');await gesture(50,75,0,2);
 // Native bubble direct selection uses visually small anchors with fixed-screen, forgiving hit areas.
 const bubbleRow=document.querySelector<HTMLElement>('[data-owner-group="bubble-0"] .layer-group-select')!;bubbleRow.click();await tick();await click('ダイレクト選択');
 await wait(()=>!!document.querySelector('.bubble-bezier-canvas.is-paper-overlay'),'bubble direct handles');
 const nodeDot=document.querySelectorAll<SVGGraphicsElement>('.bubble-bezier-canvas.is-paper-overlay .bubble-bezier-node')[1]!,nodeHit=document.querySelectorAll<SVGGraphicsElement>('.bubble-bezier-canvas.is-paper-overlay .bubble-bezier-node-hit')[1]!;
 const nr=nodeDot.getBoundingClientRect(),nodeProbe=document.elementFromPoint(nr.x+nr.width/2+4,nr.y+nr.height/2) as Element|null;
 check(getComputedStyle(nodeHit).strokeWidth==='12px'&&nodeProbe?.closest('.bubble-bezier-node-hit')===nodeHit,'輪郭点は小さく表示しつつ周囲12pxのヒット領域で直接選択できる');
 const editSvg=document.querySelector<SVGSVGElement>('.bubble-bezier-canvas.is-paper-overlay')!,svgRect=editSvg.getBoundingClientRect();
 const visibleMarks=Array.from(editSvg.querySelectorAll<SVGGraphicsElement>('.bubble-bezier-node,.bubble-bezier-handle'));
 check(visibleMarks.every(mark=>{const r=mark.getBoundingClientRect();return r.left>=svgRect.left-1&&r.top>=svgRect.top-1&&r.right<=svgRect.right+1&&r.bottom<=svgRect.bottom+1;})&&getComputedStyle(nodeDot).stroke==='rgb(35, 107, 196)'&&Number(nodeDot.getAttribute('width'))===1.5,'青い小型の輪郭点とハンドルを編集枠外でも欠けずに表示');
 const tailDot=document.querySelector<SVGCircleElement>('.bubble-tail-target-dot')!,tailHit=document.querySelector<SVGCircleElement>('.bubble-tail-target-hit')!;
 check(Number(tailDot.getAttribute('r'))<Number(tailHit.getAttribute('r'))&&Number(tailHit.getAttribute('r'))===7,'しっぽ先端は小さな表示点と広いドラッグ領域を分離');
 await click('吹き出し 1全体を固定');
 const deleteBubbleButton=button('吹き出し 1を削除');
 check(!document.querySelector('.bubble-bezier-canvas.is-paper-overlay')&&!document.querySelector('.bubble-tail-editor-overlay')&&(!deleteBubbleButton||deleteBubbleButton.disabled),'吹き出しフォルダ固定で輪郭・しっぽ・削除を一括停止');
 await click('吹き出し 1全体の固定を解除');
 // Frame-only lock affects panel geometry; whole-panel lock is inherited by every descendant and inspector field.
 await click('コマ 01の枠だけを固定');
 check(button('コマ 01全体を固定')?.getAttribute('aria-pressed')==='false'&&button('背景を固定')?.disabled===false&&!document.querySelector('.panel-resize-hit')&&!document.querySelector('[data-content-kind="screen_text"][data-artwork-locked]'),'コマ枠固定は枠形状だけを停め、中の背景・文字は編集可能');
 await click('コマ 01の枠だけの固定を解除');await click('奥の線を固定');await click('背景を固定');await click('コマ 01全体を固定');
 const frameInherited=button('コマ 01の枠は親フォルダーで固定中'),backgroundInherited=button('背景は親フォルダーで固定中');
 check(frameInherited?.disabled&&backgroundInherited?.disabled&&document.querySelector('.panel-inspector.is-locked .inspector-fields[inert]')&&document.querySelector('[data-content-kind="screen_text"][data-artwork-locked]')&&!document.querySelector('.panel-resize-hit'),'コマフォルダ固定は枠・背景・文字・インスペクターへ灰色の継承固定として伝わる');
 await click('コマ 01全体の固定を解除');
 check(button('コマ 01の枠だけを固定')?.getAttribute('aria-pressed')==='false'&&button('背景を固定')?.getAttribute('aria-pressed')==='false'&&button('奥の線を固定')?.getAttribute('aria-pressed')==='false','コマフォルダー解除時は枠・子フォルダー・子レイヤーもまとめて解除');
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
