// Use a dedicated localhost origin: this fixture seeds only its own browser storage.
import { render } from 'preact';
import {renderPaintPng,decodePaintImage,paintPreviewRenderer} from '../src/lib/paintRenderer';
import {newPaintLayer} from '../src/lib/paintDocument';
import {newToneLayer} from '../src/lib/paintTone';
import {defaultVectorStyle,vectorShape} from '../src/lib/vectorGeometry';
import type {PaintDocument} from '../src/types';
import {createFrameArtwork,prepareImageAsset} from '../src/lib/imagePlacement';
import {saveFigureCropAssets} from '../src/lib/figureCropStore';
import App from '../src/components/App';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { parseMangaYaml, STORAGE_KEY, toStoredMangaYaml } from '../src/lib/manga';
import '../src/styles/global.css';
if(location.hostname!=='127.0.0.1'||!['4325','4335'].includes(location.port))throw new Error('Dedicated local test origin required.');
const selectionChecks=new URLSearchParams(location.search).has('selection-check');
if(selectionChecks){
 if(location.port!=='4335')throw Error('Selection tests require isolated port 4335');
 const stored=localStorage.getItem(STORAGE_KEY);
 if(stored&&parseMangaYaml(stored).manga.meta.episode_id!=='layer-selection-qa')throw Error('Do not overwrite another artwork');
 if(!stored){
  const doc=createEmptyWorkspaceDocument(),canvas=document.createElement('canvas');canvas.width=canvas.height=32;
  const context=canvas.getContext('2d')!;context.fillStyle='#1996b8';context.fillRect(0,0,32,32);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
  const asset=await prepareImageAsset(new File([blob],'選択検証.png',{type:'image/png'}));
  await saveFigureCropAssets([{id:asset.storageId,blob}]);doc.manga.image_assets=[asset];
  doc.manga.meta.title='キャンバス・レイヤー選択検証';doc.manga.meta.episode_id='layer-selection-qa';
  doc.manga.finish_settings={width_mm:182,height_mm:257,dpi:100,bleed_mm:0};
  const original=(id:string,x:number,y:number)=>({...createFrameArtwork(asset,{x,y,w:30,h:12}),id,bubbleOriginal:{sourceRegionId:id,name:`原本 ${id}`}});
  doc.manga.pages=[{page:1,canvas:{w:182,h:257,unit:'mm'},panels:[
   {id:1,shape:{type:'rect',x:16,y:18.5,w:150,h:105},bg:0,action:null,
    figures:[{name:'一人目',bbox:{x:25,y:70,w:35,h:35}}],
    bubbles:[{text:'一つ目',shape:'square',tail:false,bbox:{x:105,y:30,w:45,h:40}}],
    screen_text:[{text:'通常文字',bbox:{x:25,y:35,w:55,h:15}}],
    images:[createFrameArtwork(asset,{x:25,y:110,w:20,h:10}),original('panel-crop',105,90)]},
   {id:2,shape:{type:'rect',x:16,y:135,w:150,h:100},bg:0,action:null,
    figures:[{name:'二人目',bbox:{x:25,y:178,w:35,h:35}}],bubbles:[{text:'二つ目',shape:'square',tail:false,bbox:{x:105,y:150,w:45,h:40}}]},
  ],images:[original('page-crop',125,240)],page_overlay:{frame:false,layer:'above_panel_frames',
   figures:[{name:'前景人物',bbox:{x:30,y:123,w:20,h:12}}],
   bubbles:[{text:'前景',shape:'square',tail:false,bbox:{x:85,y:123,w:25,h:12}}],
   screen_text:[{text:'前景文字',bbox:{x:25,y:240,w:65,h:12}}]}},
  {page:2,canvas:{w:182,h:257,unit:'mm'},panels:[{id:1,shape:{type:'rect',x:16,y:18.5,w:150,h:217},bg:0,action:null,bubbles:[]}],
   page_overlay:{frame:false,layer:'above_panel_frames',figures:[{name:'人物だけの前景',bbox:{x:40,y:50,w:50,h:100}}]}}];
  localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));
 }
 // Test App navigation and storage, never resident services or models.
 const fetchOriginal=window.fetch.bind(window);
 window.fetch=(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href);
  return url.protocol==='http:'&&(url.origin!==location.origin||url.pathname.startsWith('/__nyamuru/'))
   ?Promise.resolve(Response.json({error:'UI fixture: service calls disabled'},{status:503})):fetchOriginal(input,init);
 };
}else if(!localStorage.getItem(STORAGE_KEY)){
 const doc=createEmptyWorkspaceDocument();doc.manga.meta.title='レイヤー操作テスト';doc.manga.meta.episode_id='layer-flow-qa';
 doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:20,y:35,w:170,h:180},bg:1,action:null,figures:[{name:'テスト人物',size:'bust-up',bbox:{x:40,y:125,w:65,h:70}}],bubbles:[
 {text:'文字と形を一緒に選択',speaker:'テスト人物',shape:'normal',bbox:{x:130,y:55,w:40,h:45}},
 {text:'二つ目の吹き出し',shape:'normal',join_to:1,bbox:{x:128,y:107,w:40,h:40}}]}];
 doc.manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',bubbles:[{text:'前景の吹き出し',shape:'normal',bbox:{x:30,y:230,w:40,h:40}}]};
 localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));
}
async function rendererChecks(){
 const checks:string[]=[];const check=(ok:boolean,label:string)=>{if(!ok)throw new Error(label);checks.push(label);};
 const fill=(color:string)=>({tool:'fill' as const,color,size:1,points:[{x:0,y:0,pressure:1,time:0}],selection:[{x:0,y:0,w:100,h:100}]});
 const base={...newPaintLayer(),strokes:[fill('#ffffff')],clip:{x:0,y:0,w:50,h:100},generationMask:{enabled:true,strokes:[fill('#ff0000')]}};
 const paint:PaintDocument={version:1,width:100,height:100,dpi:100,layers:[base]};
 const read=async(blob:Blob)=>{const image=await decodePaintImage(blob),canvas=document.createElement('canvas');canvas.width=canvas.height=100;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);image.src='';return ctx.getImageData(0,0,100,100).data;};
 const pixel=(d:Uint8ClampedArray,x:number)=>Array.from(d.slice((50*100+x)*4,(50*100+x)*4+4)).join(',');
 const normal=await read(await renderPaintPng(paint,new Map())),generation=await read(await renderPaintPng(paint,new Map(),true));
 check(pixel(normal,25)==='255,255,255,255','通常PNGは元の白画像を保持');check(pixel(generation,25)==='255,0,0,255','生成入力は赤領域を合成');check(pixel(generation,75)==='0,0,0,0','生成領域も画像のclipを保持');
 const canvas=document.createElement('canvas');canvas.width=canvas.height=100;const preview=paintPreviewRenderer();
 preview.draw(canvas,paint,new Map(),{layerId:base.id,target:'generationMask',stroke:{...fill('#000000'),tool:'clear'}});
 check(pixel(canvas.getContext('2d')!.getImageData(0,0,100,100).data,25)==='255,255,255,255','生成マスクの消去は原画像を消さない');preview.dispose();
 const source={...newPaintLayer('元の線画'),strokes:[fill('#ffffff'),{...fill('#000000'),selection:[{x:0,y:49,w:100,h:3}]}]};
 const tone=newToneLayer([{x:20,y:10,w:60,h:80}]);
 tone.mask!.strokes.push({...fill('#ffffff'),tool:'clear',selection:[{x:48,y:35,w:8,h:30}]});
 const toneDocument:PaintDocument={version:1,width:100,height:100,dpi:600,layers:[source,tone]};
 const unchanged=JSON.stringify(source),testCanvas=window.document.createElement('canvas');testCanvas.width=testCanvas.height=100;
 const screen=paintPreviewRenderer(),rgba=(x:number,y:number)=>Array.from(testCanvas.getContext('2d')!.getImageData(x,y,1,1).data);
 screen.draw(testCanvas,toneDocument,new Map(),undefined,tone.id);
 const red=rgba(25,25),hole=rgba(51,40),line=rgba(51,50),coveredLine=rgba(25,50);
 check(red[0]===255&&red[1]>90&&red[1]<120,'赤い半透明表示で塗った範囲を確認');
 check(hole.join(',')==='255,255,255,255','塗り残し・消去した穴は赤くならない');
 check(line.join(',')==='0,0,0,255'&&coveredLine[0]>100&&coveredLine[1]===0,'元の線画は穴でも赤い範囲でも保持');
 screen.draw(testCanvas,toneDocument,new Map(),{layerId:tone.id,target:'mask',stroke:{...fill('#ffffff'),tool:'clear'}},tone.id);
 check(rgba(25,25).join(',')==='255,255,255,255','消しゴムのライブ表示も元画像を消さない');
 screen.draw(testCanvas,toneDocument,new Map(),undefined,tone.id);
 check(rgba(25,25)[1]>90&&rgba(25,25)[1]<120,'描画履歴の復元で赤い範囲も復元');
 const exported=await read(await renderPaintPng(toneDocument,new Map()));
 check(exported.every((value,i)=>i%4!==0||value===exported[i+1]&&value===exported[i+2]),'PNGに赤い確認色を含めない');
 check(pixel(exported,51)==='0,0,0,255'&&JSON.stringify(source)===unchanged,'トーン書き出し後も元の線画とレイヤーを保持');
 const blank=await read(await renderPaintPng({...toneDocument,layers:[newToneLayer()]},new Map()));
 check(blank.every((v,i)=>i%4!==3||v===0),'未塗りの新規トーンは全面透明');
 const vector={...newPaintLayer('黒枠・塗りなし','vector'),paths:[vectorShape('rectangle',{x:20,y:20},{x:80,y:80},{...defaultVectorStyle(),stroke:'#000000',fill:null,width:8})]};
 const vectorPixels=await read(await renderPaintPng({version:1,width:100,height:100,dpi:100,layers:[vector]},new Map()));
 check(pixel(vectorPixels,20)==='0,0,0,255'&&pixel(vectorPixels,50)==='0,0,0,0','確定後の黒枠・塗りなしベクターを白線に変えない');
 screen.dispose();
 return checks;
}
if(new URLSearchParams(location.search).has('render-check')){
 rendererChecks().then(checks=>render(<main><h1>描画検証 PASS</h1><ul>{checks.map(item=><li>{item}</li>)}</ul></main>,document.getElementById('app')!)).catch(error=>render(<main><h1>描画検証 FAIL</h1><pre>{String(error)}</pre></main>,document.getElementById('app')!));
}else{
 render(<App/>,document.getElementById('app')!);
 if(selectionChecks){
  const controls=document.createElement('aside');controls.style.cssText='position:fixed;bottom:0;left:4px;z-index:3000;max-width:460px;background:#fff4d5;padding:6px';document.body.append(controls);
  render(<details><summary>選択同期の検証</summary><input id="selection-focus" aria-label="フォーカス保持の検証"/>
    <button id="check-selection" onClick={()=>void verifySelection()}>キャンバス選択を検証</button>
    <pre id="selection-report" aria-live="polite" style={{maxHeight:'200px',overflow:'auto',whiteSpace:'pre-wrap'}}>未実行</pre></details>,controls);
 }
}

async function verifySelection(){
 const checks:string[]=[],report=document.getElementById('selection-report')!,button=document.getElementById('check-selection') as HTMLButtonElement;
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
 const settle=async()=>{for(let i=0;i<12;i++)await tick();};
 const click=(selector:string)=>{const element=Array.from(document.querySelectorAll<HTMLElement>(selector)).find(item=>!item.closest('.is-spread-partner'));if(!element)throw Error(`対象なし: ${selector}`);element.click();};
 const canvas=(kind:string,panel=0,index=0)=>`.manga-paper [data-content-kind="${kind}"][data-content-panel="${panel}"][data-content-index="${index}"]`;
 const palette=()=>document.querySelector<HTMLElement>('.page-layer-palette')!;
 const selected=()=>Array.from(palette().querySelectorAll<HTMLElement>('[data-canvas-selected="true"]'));
 const owner=(key:string)=>selected().length===1&&selected()[0].dataset.ownerGroup===key&&selected()[0].getAttribute('aria-selected')==='true';
 const visible=()=>{const row=selected()[0]?.getBoundingClientRect(),viewport=palette().closest('.dock-content')!.getBoundingClientRect();return !!row&&row.top>=viewport.top-1&&row.bottom<=viewport.bottom+1;};
 const selectedPanel=()=>selected()[0]?.closest('.panel-layer-group')?.getAttribute('aria-label');
 button.disabled=true;report.textContent='検証中';
 try{
  await settle();click('.page-switcher [aria-label="前のページ"]');await settle();
  const before=localStorage.getItem(STORAGE_KEY),undo=document.querySelector<HTMLButtonElement>('.app-header [aria-label^="元に戻す"]')?.disabled;
  // Native click handlers run without taking focus from an existing text field.
  const focus=document.getElementById('selection-focus') as HTMLInputElement;focus.focus();
  click(canvas('figure'));await settle();
  check(owner('figure-0')&&selectedPanel()==='コマ 01','キャンバス人物を同じコマの1行だけに表示');
  check(visible(),'選択した人物行をdock内へスクロール');
  check(document.activeElement===focus,'自動展開とスクロールが入力focusを奪わない');
  click('.page-layer-palette [data-canvas-selected="true"] [aria-expanded="true"]');await settle();
  click('.page-layer-palette [aria-label="コマ 01を折りたたむ"]');await settle();
  click(canvas('figure'));await settle();
  check(owner('figure-0')&&!!selected()[0].querySelector('[aria-expanded="true"]')&&visible(),'同じ人物の再選択でコマと人物フォルダーを再展開');
  click(canvas('bubble'));await settle();check(owner('bubble-0')&&selectedPanel()==='コマ 01'&&visible(),'吹き出しの選択・展開・表示位置が一致');
  check(palette().querySelectorAll('[aria-selected="true"]').length===1,'owner選択を描画子layer選択にしない');
  click(canvas('image',0,1));await settle();check(owner('original-panel-crop')&&visible(),'切出し原本は独立したowner行を選択');
  click(canvas('screen_text'));await settle();check(selected().length===1&&selected()[0].classList.contains('native-text-layer')&&visible(),'通常文字は背景ownerへ変換せず文字行を選択');
  click(canvas('image'));await settle();check(selected().length===0&&!palette().querySelector('[data-owner-group="background"].is-selected'),'通常画像を背景ownerと誤認しない');
  click(canvas('figure',0));click(canvas('figure',1));await settle();
  check(owner('figure-0')&&selectedPanel()==='コマ 02'&&visible(),'A→Bの高速選択は最後のコマと人物だけを表示');
  click('.paint-layers-dock [aria-label="レイヤーを閉じる"]');await settle();click(canvas('figure',0));await settle();
  click('.paint-layers-dock [aria-label="レイヤーを開く"]');await settle();
  check(owner('figure-0')&&selectedPanel()==='コマ 01'&&visible(),'閉じたdock内で選んだ行も再表示時にスクロール');
  click('.manga-paper .page-overlay-figure-layer .figure-guide');await settle();
  check(owner('figure-0')&&!!selected()[0].closest('.page-direct-layer-group')&&visible(),'前景人物はコマ外のowner行を選択');
  click('.manga-paper [data-content-overlay][data-content-kind="bubble"]');await settle();
  check(owner('bubble-0')&&!!selected()[0].closest('.page-direct-layer-group'),'前景吹き出しを通常コマと混同しない');
  click('.manga-paper [data-content-overlay][data-content-kind="screen_text"]');await settle();
  check(selected().length===1&&selected()[0].classList.contains('native-text-layer')&&!!selected()[0].closest('.page-direct-layer-group'),'前景の通常文字も同じ選択経路へ表示');
  click('.manga-paper .original-raster-layer [data-content-kind="image"]:not([data-content-panel])');await settle();
  check(owner('original-page-crop')&&!!selected()[0].closest('.page-direct-layer-group'),'ページ原本はコマ外の元画像ownerを選択');
  click(canvas('figure',0));click('.page-switcher [aria-label="次のページ"]');await settle();
  check(selected().length===0,'ページ移動で前ページの選択・scroll予約を破棄');
  click('.manga-paper .page-overlay-figure-layer .figure-guide');await settle();
  check(owner('figure-0')&&!!selected()[0].closest('.page-direct-layer-group')&&visible(),'人物だけのページ前景もレイヤー欄へ表示');
  click('.page-switcher [aria-label="前のページ"]');await settle();click(canvas('figure'));await settle();
  check(!document.querySelector('.app-shell.is-painting'),'キャンバス選択だけではペンを起動しない');
  check(undo===true&&document.querySelector<HTMLButtonElement>('.app-header [aria-label^="元に戻す"]')?.disabled===true,'選択往復でUndoを追加しない');
  check(localStorage.getItem(STORAGE_KEY)===before,'選択・展開・scroll・ページ移動で保存原稿不変');
  const panelGroup='.page-layer-palette .panel-layer-group[aria-label="コマ 01"]',pageGroup='.page-layer-palette .page-direct-layer-group';
  const heading=(key:string,overlay=false)=>`${overlay?pageGroup:panelGroup} [data-owner-group="${key}"] .layer-group-select`;
  const painting=()=>!!document.querySelector('.app-shell.is-painting');
  const until=async(test:()=>boolean)=>{for(let i=0;i<240&&!test();i++)await tick();if(!test())throw Error('描画状態の切替が完了しません');};
  for(const [key,overlay] of [['figure-0',false],['bubble-0',false],['original-panel-crop',false],['figure-0',true],['bubble-0',true],['original-page-crop',true]] as const){
   click(heading(key,overlay));await settle();
   check(!painting()&&owner(key)&&Boolean(selected()[0].closest('.page-direct-layer-group'))===overlay,`${overlay?'前景':'コマ'}の${key}見出しは描画せず対象を選択`);
  }
  for(const key of ['figure-0','original-panel-crop']){
   click(heading(key));await settle();
   click(`${panelGroup} [data-owner-root="${key}"] .layer-row .layer-select`);
   await until(()=>painting()&&!!document.querySelector(`${panelGroup} [data-owner-group="${key}"] .layer-group-select:not(:disabled)`));await settle();
   check(painting()&&!!document.querySelector(`${panelGroup} [data-owner="${key}"][aria-selected="true"]`),`${key}の子layerは従来の描画入口で選択`);
   click(heading(key));await until(()=>!painting());await settle();
   check(owner(key)&&!painting(),`${key}描画中の見出しは配置選択へ戻る`);
  }
  click(heading('background'));await until(()=>painting()&&!!document.querySelector(`${panelGroup} [data-owner-group="figure-0"] .layer-group-select:not(:disabled)`));
  check(!!document.querySelector(`${panelGroup} [data-owner-group="background"].is-selected`),'背景見出しの既存描画入口を維持');
  await until(()=>!!document.querySelector(`${panelGroup} [aria-label="背景あたりの3Dモデルを配置・調整"]:not(:disabled)`));
  check(!!document.querySelector(`${panelGroup} [aria-label="背景あたりの3Dモデルを配置・調整"]:not(:disabled)`),'背景3D編集入口も利用可能');
  click(heading('figure-0'));await until(()=>!painting());await settle();
  const paintSurface=document.querySelector<HTMLElement>('[data-paint-canvas]');
  if(!paintSurface)throw Error('描画surfaceがありません');
  paintSurface.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));await settle();
  check(!painting()&&owner('figure-0'),'明示owner選択後のcanvas復帰で前の描画を自動再開しない');
  check(document.querySelector<HTMLButtonElement>('.app-header [aria-label^="元に戻す"]')?.disabled===true,'ownerと未描画子layerの往復でもUndoを追加しない');
  check(localStorage.getItem(STORAGE_KEY)===before,'owner選択・子layer開閉で保存原稿とartwork不変');
  report.textContent=`PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){report.textContent=`FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;throw error;}
 finally{button.disabled=false;}
}
