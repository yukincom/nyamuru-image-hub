// Use a dedicated localhost origin: this fixture seeds only its own browser storage.
import { render } from 'preact';
import {renderPaintPng,decodePaintImage,paintPreviewRenderer} from '../src/lib/paintRenderer';
import {newPaintLayer,withPaintBleed,type PaintOwner} from '../src/lib/paintDocument';
import {newToneLayer} from '../src/lib/paintTone';
import {defaultVectorStyle,vectorShape} from '../src/lib/vectorGeometry';
import type {PaintDocument} from '../src/types';
import {createFrameArtwork,prepareImageAsset,imageSha256,validateImagePlacements} from '../src/lib/imagePlacement';
import {deleteFigureCropAssets,loadFigureCropAsset,saveFigureCropAssets} from '../src/lib/figureCropStore';
import {prepareDetectedTextCrops} from '../src/lib/analogTextCrops';
import {attachRecognizedTextToPage,type RecognizedTextLine} from '../src/lib/localBridge';
import {separateBubbleOriginals} from '../src/lib/bubbleOriginals';
import {captureQwenCompositionCanvas} from '../src/lib/qwenComposition';
import {createProjectSnapshot,restoreProjectSnapshot} from '../src/lib/projectPersistence';
import App from '../src/components/App';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { parseMangaYaml, STORAGE_KEY, toStoredMangaYaml } from '../src/lib/manga';
import '../src/styles/global.css';
if(!['127.0.0.1','selection.localhost'].includes(location.hostname)||!['4325','4335'].includes(location.port))throw new Error('Dedicated local test origin required.');
const selectionChecks=new URLSearchParams(location.search).has('selection-check');
if(selectionChecks){
 if(location.port!=='4335')throw Error('Selection tests require isolated port 4335');
 const stored=localStorage.getItem(STORAGE_KEY);
 if(stored&&parseMangaYaml(stored).manga.meta.episode_id!=='layer-selection-qa'){
  document.getElementById('app')!.textContent='別の検証原稿が保存されているため、選択検証の初期化を中止しました。';
  throw Error('Do not overwrite another artwork');
 }
 if(!stored){
  const doc=createEmptyWorkspaceDocument(),canvas=document.createElement('canvas');canvas.width=canvas.height=32;
  const context=canvas.getContext('2d')!;context.fillStyle='#1996b8';context.fillRect(0,0,32,32);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
  const asset=await prepareImageAsset(new File([blob],'選択検証.png',{type:'image/png'}));
  await saveFigureCropAssets([{id:asset.storageId,blob}]);doc.manga.image_assets=[asset];
  doc.manga.meta.title='キャンバス・レイヤー選択検証';doc.manga.meta.episode_id='layer-selection-qa';
  doc.manga.finish_settings={width_mm:182,height_mm:257,dpi:100,bleed_mm:0};
  const association=(id:string)=>({schemaVersion:1 as const,sourceRegionId:id,assetId:asset.storageId,sourceBBox:{x:0,y:0,w:1,h:1},detectionSource:'baberu',recognitionEngine:'Baberu OCR' as const,needsReview:false,levelAdjusted:true as const,rasterLayerInitialized:true,rasterLayerSeparated:true,originalImageId:id});
  const original=(id:string,x:number,y:number)=>({...createFrameArtwork(asset,{x,y,w:30,h:12}),id,bubbleOriginal:{sourceRegionId:id,name:`原本 ${id}`}});
  doc.manga.pages=[{page:1,canvas:{w:182,h:257,unit:'mm'},panels:[
   {id:1,shape:{type:'rect',x:16,y:18.5,w:150,h:105},bg:0,action:null,
    figures:[{name:'一人目',bbox:{x:25,y:70,w:35,h:35}}],
    bubbles:[{text:'一つ目',shape:'square',tail:false,bbox:{x:105,y:30,w:45,h:40},analogTextImport:association('panel-crop')}],
    screen_text:[{text:'通常文字',bbox:{x:25,y:35,w:55,h:15}}],
    images:[createFrameArtwork(asset,{x:25,y:110,w:20,h:10}),original('panel-crop',105,90)]},
   {id:2,shape:{type:'rect',x:16,y:135,w:150,h:100},bg:0,action:null,
    figures:[{name:'二人目',bbox:{x:25,y:178,w:35,h:35}}],bubbles:[{text:'二つ目',shape:'square',tail:false,bbox:{x:105,y:150,w:45,h:40}}]},
  ],images:[original('page-crop',125,240)],page_overlay:{frame:false,layer:'above_panel_frames',
   figures:[{name:'前景人物',bbox:{x:30,y:123,w:20,h:12}}],
   bubbles:[{text:'前景',shape:'square',tail:false,bbox:{x:85,y:123,w:25,h:12},analogTextImport:association('page-crop')}],
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
 const base={...newPaintLayer(),strokes:[fill('#ffffff')],clip:{x:0,y:0,w:50,h:100}};
 const paint:PaintDocument={version:1,width:100,height:100,dpi:100,layers:[base],generationMask:{enabled:true,strokes:[fill('#ff0000')]}};
 const read=async(blob:Blob)=>{const image=await decodePaintImage(blob),canvas=document.createElement('canvas');canvas.width=canvas.height=100;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);image.src='';return ctx.getImageData(0,0,100,100).data;};
 const pixel=(d:Uint8ClampedArray,x:number)=>Array.from(d.slice((50*100+x)*4,(50*100+x)*4+4)).join(',');
 const normal=await read(await renderPaintPng(paint,new Map())),generation=await read(await renderPaintPng(paint,new Map(),true));
 check(pixel(normal,25)==='255,255,255,255','通常PNGは元の白画像を保持');check(pixel(generation,25)==='255,0,0,255','生成入力は赤領域を合成');check(pixel(generation,75)==='255,0,0,255','フォルダーの生成領域は個別レイヤーのclipから独立');
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
 const imported=await decodePaintImage(await renderPaintPng({...paint,layers:[source]},new Map())),images=new Map([['thumbnail-original',imported]]);
 const cases:[string,PaintDocument][]=[['生成マスク',paint],['トーンと範囲',toneDocument],['ベクター',{...paint,layers:[vector]}],...(['color','grayscale','monochrome'] as const).map(mode=>[`${mode}原本画像`,{...paint,layers:[{...newPaintLayer(),colorMode:mode,image:{assetId:'thumbnail-original',crop:{x:0,y:0,w:100,h:100},bbox:{x:0,y:0,w:100,h:100}}}]}] as [string,PaintDocument])];
 for(const [name,document] of cases){
  testCanvas.width=testCanvas.height=40;screen.draw(testCanvas,document,images);
  const before=testCanvas.getContext('2d')!.getImageData(0,0,40,40).data;
  const owner={key:'panel',kind:'panel',index:0,frame:{x:0,y:0,w:100,h:100},paint:document} as PaintOwner;
  const expanded=withPaintBleed(owner,256).paint;
  screen.draw(testCanvas,expanded,images,undefined,undefined,true,expanded.referenceFrame);
  const after=testCanvas.getContext('2d')!.getImageData(0,0,40,40).data;
  const differences=Array.from(before).flatMap((v,i)=>v===after[i]?[]:[`${i}:${v}/${after[i]}`]);
  check(!differences.length,`${name}のサムネイルは作業用余白を追加しても画素一致${differences.length?` (${differences.length}: ${differences.slice(0,12).join(' ')})`:''}`);
 }
 imported.src='';
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
    <button id="check-figures" onClick={()=>void verifyFigurePresentation()}>人物の確定表示を検証</button>
    <button id="check-rows" onClick={()=>void verifySelectionRows()}>選択行と所属を検証</button>
    <button id="check-stability" onClick={()=>void verifyPaletteStability()}>表示切替と追加を検証</button>
    <button id="check-geometry" onClick={()=>void verifyPaletteGeometry()}>選択中の位置と縮尺を検証</button>
    <button id="check-originals" onClick={()=>void verifyOriginalVisibility()}>OCR原本の初期表示を検証</button>
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
 const owner=(key:string)=>selected().length===1&&(selected()[0].dataset.ownerGroup??selected()[0].dataset.owner)===key&&selected()[0].getAttribute('aria-selected')==='true';
 const visible=()=>{const row=selected()[0]?.getBoundingClientRect(),viewport=palette().closest('.dock-content')!.getBoundingClientRect();return !!row&&row.top>=viewport.top-1&&row.bottom<=viewport.bottom+1;};
 const selectedPanel=()=>selected()[0]?.closest('.panel-layer-group')?.getAttribute('aria-label');
 button.disabled=true;report.textContent='検証中';
 try{
  await settle();click('.page-switcher [aria-label="前のページ"]');await settle();
  const before=localStorage.getItem(STORAGE_KEY),undo=document.querySelector<HTMLButtonElement>('.app-header [aria-label^="元に戻す"]')?.disabled;
  for(const button of document.querySelectorAll<HTMLButtonElement>('.page-layer-palette button[aria-expanded="false"]'))button.click();await settle();
  // Native click handlers run without taking focus from an existing text field.
  const focus=document.getElementById('selection-focus') as HTMLInputElement;focus.focus();
  click(canvas('figure'));await settle();
  check(owner('figure-0')&&selectedPanel()==='コマ 01','キャンバス人物を同じコマの1行だけに表示');
  check(visible(),'選択した人物行をdock内へスクロール');
  check(document.activeElement===focus,'パレットのスクロールが入力focusを奪わない');
  click('.page-layer-palette [data-canvas-selected="true"] [aria-expanded="true"]');await settle();
  click('.page-layer-palette [aria-label="コマ 01を折りたたむ"]');await settle();
  click(canvas('figure'));await settle();
  check(owner('figure-0')&&!!selected()[0].querySelector('[aria-expanded="false"]')&&!!document.querySelector('.page-layer-palette [aria-label="コマ 01を展開"]'),'同じ人物の再選択でもコマと人物フォルダーを開かない');
  click('.page-layer-palette [aria-label="コマ 01を展開"]');click('.page-layer-palette [data-owner-group="figure-0"] [aria-expanded="false"]');await settle();
  click(canvas('bubble'));await settle();check(owner('bubble-0')&&selectedPanel()==='コマ 01'&&visible(),'展開済み吹き出しの選択と表示位置が一致');
  check(palette().querySelectorAll('[aria-selected="true"]').length===1,'owner選択を描画子layer選択にしない');
  click(canvas('image',0,1));await settle();check(owner('original-panel-crop')&&visible(),'切出し原本は実際の画像レイヤー行を選択');
  click(canvas('screen_text'));await settle();check(selected().length===1&&selected()[0].classList.contains('native-text-layer')&&visible(),'通常文字は背景ownerへ変換せず文字行を選択');
  click(canvas('image'));await settle();check(selected().length===0&&!palette().querySelector('[data-owner-group="background"].is-selected'),'通常画像を背景ownerと誤認しない');
  click(canvas('figure',0));click(canvas('figure',1));await settle();
  check(owner('figure-0')&&selectedPanel()==='コマ 02'&&visible(),'A→Bの高速選択は最後のコマと人物だけを表示');
  click('.paint-layers-dock [aria-label="レイヤーを閉じる"]');await settle();click(canvas('figure',0));await settle();
  click('.paint-layers-dock [aria-label="レイヤーを開く"]');await settle();
  check(owner('figure-0')&&selectedPanel()==='コマ 01'&&visible(),'閉じたdock内で選んだ行も再表示時にスクロール');
  click('.manga-paper .page-overlay-figure-layer .figure-guide');await settle();
  check(owner('figure-0')&&!!selected()[0].closest('.page-panel-outside-layers:not([data-before-panel])')&&visible(),'前景人物はコマ外のowner行を選択');
  click('.manga-paper [data-content-overlay][data-content-kind="bubble"]');await settle();
  check(owner('bubble-0')&&!!selected()[0].closest('.page-panel-outside-layers:not([data-before-panel])'),'前景吹き出しを通常コマと混同しない');
  click('.manga-paper [data-content-overlay][data-content-kind="screen_text"]');await settle();
  check(selected().length===1&&selected()[0].classList.contains('native-text-layer')&&!!selected()[0].closest('.page-panel-outside-layers:not([data-before-panel])'),'前景の通常文字も同じ選択経路へ表示');
  click('.manga-paper .bubble-original-child [data-content-kind="image"]:not([data-content-panel])');await settle();
  check(owner('original-page-crop')&&!!selected()[0].closest('.page-panel-outside-layers:not([data-before-panel])'),'ページ原本はコマ外の画像レイヤー行を選択');
  click(canvas('figure',0));click('.page-switcher [aria-label="次のページ"]');await settle();
  check(selected().length===0,'ページ移動で前ページの選択・scroll予約を破棄');
  click('.manga-paper .page-overlay-figure-layer .figure-guide');await settle();
  check(owner('figure-0')&&!!selected()[0].closest('.page-panel-outside-layers:not([data-before-panel])')&&visible(),'人物だけのページ前景もレイヤー欄へ表示');
  click('.page-switcher [aria-label="前のページ"]');await settle();click(canvas('figure'));await settle();
  check(!document.querySelector('.app-shell.is-painting'),'キャンバス選択だけではペンを起動しない');
  check(undo===true&&document.querySelector<HTMLButtonElement>('.app-header [aria-label^="元に戻す"]')?.disabled===true,'選択往復でUndoを追加しない');
  check(localStorage.getItem(STORAGE_KEY)===before,'選択・展開・scroll・ページ移動で保存原稿不変');
  const panelGroup='.page-layer-palette .panel-layer-group[aria-label="コマ 01"]',pageGroup='.page-layer-palette .page-panel-outside-layers:not([data-before-panel])';
  const heading=(key:string,overlay=false)=>`${overlay?pageGroup:panelGroup} [data-owner-group="${key}"] .layer-group-select`;
  const painting=()=>!!document.querySelector('.app-shell.is-painting');
  const until=async(test:()=>boolean)=>{for(let i=0;i<240&&!test();i++)await tick();if(!test())throw Error('描画状態の切替が完了しません');};
  for(const [key,overlay] of [['figure-0',false],['bubble-0',false],['figure-0',true],['bubble-0',true]] as const){
   click(heading(key,overlay));await settle();
   check(!painting()&&owner(key)&&Boolean(selected()[0].closest('.page-panel-outside-layers:not([data-before-panel])'))===overlay,`${overlay?'前景':'コマ'}の${key}見出しは描画せず対象を選択`);
  }
  for(const key of ['figure-0','original-panel-crop']){
   click(key==='original-panel-crop'?canvas('image',0,1):heading(key));await settle();
   click(`${panelGroup} [data-owner-root="${key}"] .layer-row .layer-select`);
   await until(()=>painting()&&!!document.querySelector(`${panelGroup} [data-owner="${key}"] .layer-select:not(:disabled)`));await settle();
   check(painting()&&!!document.querySelector(`${panelGroup} [data-owner="${key}"][aria-selected="true"]`),`${key}の子layerは従来の描画入口で選択`);
   const exitKey=key==='original-panel-crop'?'bubble-0':key;
   click(heading(exitKey));await until(()=>!painting());await settle();
   check(owner(exitKey)&&!painting(),`${key}描画中からフォルダー選択で配置へ戻る`);
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

async function verifyFigurePresentation(){
 const report=document.getElementById('selection-report')!,buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('#check-selection,#check-figures,#check-originals'));
 const original=localStorage.getItem(STORAGE_KEY),host=document.getElementById('app')!,checks:string[]=[];
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
 const wait=async(test:()=>boolean,label:string)=>{for(let i=0;i<240&&!test();i++)await tick();if(!test())throw Error(label);};
 const settle=async()=>{for(let i=0;i<12;i++)await tick();};
 const active=<T extends Element>(selector:string)=>Array.from(document.querySelectorAll<T>(selector)).find(item=>!item.closest('.is-spread-partner'))!;
 const figure=(index:number)=>active<HTMLElement>(`.manga-paper [data-content-kind="figure"][data-content-panel="0"][data-content-index="${index}"]`);
 const stored=()=>parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
 let mounted=false;
 buttons.forEach(button=>button.disabled=true);report.textContent='人物表示の検証中';
 try{
  if(!original||stored().manga.meta.episode_id!=='layer-selection-qa')throw Error('Dedicated selection manuscript required');
  if(document.querySelector('.app-shell.is-painting'))throw Error('先に描画を閉じてください');
  const doc=stored(),asset=doc.manga.image_assets![0],bbox={x:25,y:55,w:25,h:35};
  doc.manga.characters.push({localId:'person-r5',name:'確定人物',role:'',scope:'episode'});
  const analog={schemaVersion:1 as const,sourceRegionId:'figure-state-qa',assetId:asset.storageId,sourceBBox:{x:0,y:0,w:1,h:1},detectionSource:'body' as const,draft:true as const};
  const assigned={name:'確定人物',kind:'person' as const,refId:'person-r5',bbox,analogImport:{...analog}};
  doc.manga.pages[0].panels[0].figures=[
   {...assigned,name:'人物あたり',refId:undefined},
   {...assigned,bbox:{...bbox,x:55}},
   {...assigned,bbox:{...bbox,x:85},artwork:createFrameArtwork(asset,{...bbox,x:85})},
   {...assigned,bbox:{...bbox,x:115},artwork:createFrameArtwork(asset,{...bbox,x:115}),analogImport:{...analog,analysisReview:'low-confidence',analysisReviewMessage:'確認が必要です'}},
   {name:'小道具',kind:'prop',bbox:{...bbox,x:55,y:95,h:15}},
  ];
  doc.manga.pages[0].page_overlay!.figures=[
   {...assigned,bbox:{x:25,y:125,w:20,h:12}},
   {...assigned,bbox:{x:55,y:125,w:20,h:12},analogImport:{...analog,analysisReview:'error'}},
   {...assigned,bbox:{x:125,y:125,w:20,h:12},artwork:createFrameArtwork(asset,{x:125,y:125,w:20,h:12}),analogImport:{...analog,analysisReview:'low-confidence'}},
  ];
  render(null,host);localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));render(<App/>,host);mounted=true;
  await wait(()=>!!figure(1),'人物画面が表示されません');await settle();
  check(figure(1).classList.contains('is-confirmed-person')&&getComputedStyle(figure(1)).borderTopWidth==='0px'&&getComputedStyle(figure(1)).backgroundColor==='rgba(0, 0, 0, 0)','確定済み・未描画の人物に常設色枠と色地を残さない');
  check(figure(2).classList.contains('is-confirmed-person')&&figure(2).classList.contains('placed-image'),'画像化済み人物も同じ確定状態を使い、画像表示を保持');
  check(figure(0).classList.contains('is-unassigned')&&!figure(0).classList.contains('is-confirmed-person'),'未割当人物は注意表示を保持');
  check(figure(3).classList.contains('is-analysis-review')&&figure(3).classList.contains('placed-image')&&getComputedStyle(figure(3),'::after').content!=='none','名前付き低信頼人物は画像を落とさず注意枠を表示');
  check(figure(4).classList.contains('is-object')&&!figure(4).classList.contains('is-unassigned'),'小道具は人物未割当と扱わない');
  await wait(()=>!!figure(1).querySelector<HTMLImageElement>('.figure-crop-image')?.naturalWidth,'原画参照が表示されません');
  check(!!figure(1).querySelector('.figure-crop-image'),'通常表示になっても原画参照を保持');
  const foreground=Array.from(active<HTMLElement>('.page-overlay-figure-layer').querySelectorAll<HTMLElement>('[data-content-target]'));
  check(foreground.length===3&&foreground[0].classList.contains('is-confirmed-person')&&foreground.slice(1).every(item=>item.classList.contains('is-analysis-review')),'ページ前景も通常・要確認と画像有無を同じ規則で表示');
  figure(1).click();await wait(()=>!!figure(1).querySelector('.canvas-content-outline'),'通常の選択枠がありません');
  check(figure(1).querySelectorAll('.resize-handle').length===4&&getComputedStyle(figure(1)).borderTopWidth==='0px','確定人物の選択は既存の輪郭と4handleだけを使用');
  figure(0).click();await settle();
  const dropdown=Array.from(document.querySelectorAll<HTMLSelectElement>('.panel-inspector .selectable-card.is-selected select')).find(select=>Array.from(select.options).some(option=>option.value==='person-r5'));
  if(!dropdown)throw Error('人物確定の選択欄がありません');
  dropdown.value='person-r5';dropdown.dispatchEvent(new Event('change',{bubbles:true}));
  await wait(()=>stored().manga.pages[0].panels[0].figures![0].refId==='person-r5','名前確定が保存されません');await settle();
  check(figure(0).classList.contains('is-confirmed-person')&&stored().manga.pages[0].panels[0].figures![0].analogImport?.draft===true,'draftが残る人物も名前確定で通常表示へ切替');
  const historyButton=(name:string)=>document.querySelector<HTMLButtonElement>(`.app-header [aria-label^="${name}"]`)!;
  historyButton('元に戻す').click();await wait(()=>figure(0).classList.contains('is-unassigned')&&!stored().manga.pages[0].panels[0].figures![0].refId,'Undoで注意表示が戻りません');
  check(!stored().manga.pages[0].panels[0].figures![0].refId,'名前確定のUndoは既存documentと表示を同時に戻す');
  historyButton('やり直す').click();await wait(()=>figure(0).classList.contains('is-confirmed-person')&&stored().manga.pages[0].panels[0].figures![0].refId==='person-r5','Redoで通常表示が戻りません');
  check(stored().manga.pages[0].panels[0].figures![0].refId==='person-r5','Redoで通常表示を復元');
  render(null,host);render(<App/>,host);await wait(()=>!!figure(0),'再読込が完了しません');await settle();
  check(figure(0).classList.contains('is-confirmed-person')&&getComputedStyle(figure(0)).borderTopWidth==='0px','保存済みdocumentからの再読込でも通常表示を維持');
  const ownerRoot='.page-layer-palette .panel-layer-group[aria-label="コマ 01"]',heading=`${ownerRoot} [data-owner-group="figure-0"] .layer-group-select`;
  document.querySelector<HTMLButtonElement>(`${ownerRoot} [data-owner-root="figure-0"] .layer-row .layer-select`)!.click();
  await wait(()=>!!document.querySelector('.app-shell.is-painting')&&!!document.querySelector(`${heading}:not(:disabled)`),'人物の描画が開きません');await settle();
  document.querySelector<HTMLButtonElement>(heading)!.click();await wait(()=>!document.querySelector('.app-shell.is-painting'),'人物選択へ戻れません');await settle();
  check(figure(0).classList.contains('is-confirmed-person')&&getComputedStyle(figure(0)).borderTopWidth==='0px','ペイントの無操作開閉でも確定人物の枠を変更しない');
  const after=stored();
  check(!after.manga.pages[0].panels[0].figures![0].artwork&&!after.manga.pages[0].panels[0].figures![1].artwork&&JSON.stringify(after.manga.image_assets)===JSON.stringify(doc.manga.image_assets),'名前確定・Undo・再読込でPNGとassetを追加しない');
  report.textContent=`人物表示 PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){report.textContent=`人物表示 FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;throw error;}
 finally{
  if(mounted){render(null,host);localStorage.setItem(STORAGE_KEY,original!);render(<App/>,host);}
  buttons.forEach(button=>button.disabled=false);
 }
}

async function verifyOriginalVisibility(){
 const report=document.getElementById('selection-report')!,buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('#check-selection,#check-figures,#check-originals'));
 const original=localStorage.getItem(STORAGE_KEY),host=document.getElementById('app')!,checks:string[]=[],temporaryIds=new Set<string>();
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const stored=()=>parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
 const wait=async(test:()=>boolean,label:string)=>{for(let i=0;i<240&&!test();i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));if(!test())throw Error(label);};
 const first=<T extends Element>(selector:string)=>Array.from(document.querySelectorAll<T>(selector)).find(item=>!item.closest('.is-spread-partner'))!;
 const sourceCanvases=()=>Array.from(document.querySelectorAll<HTMLCanvasElement>('.bubble-original-child .placed-image-viewport canvas'));
 const opaque=(canvas:HTMLCanvasElement)=>canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0);
 let mounted=false,baselineIds=new Set<string>();
 buttons.forEach(button=>button.disabled=true);report.textContent='OCR原本の検証中';
 try{
  if(!original||stored().manga.meta.episode_id!=='layer-selection-qa')throw Error('Dedicated selection manuscript required');
  if(document.querySelector('.app-shell.is-painting'))throw Error('先に描画を閉じてください');
  const doc=stored(),asset=doc.manga.image_assets![0],source=await loadFigureCropAsset(asset.storageId);
  if(!source)throw Error('検証原本がありません');baselineIds=new Set(doc.manga.image_assets!.map(item=>item.storageId));
  const lines:RecognizedTextLine[]=[{id:'panel',text:'認識した本文',bbox:{x:.2,y:.2,w:.25,h:.12},confidence:.95,needsReview:false,source:'baberu',vertical:false},
   {id:'page',text:'前景の本文',bbox:{x:.2,y:.6,w:.25,h:.12},confidence:.95,needsReview:false,source:'baberu',vertical:false,pageOverlay:true}];
  const prepared=await prepareDetectedTextCrops(new File([source],'原本表示検証.png',{type:'image/png'}),0,crypto.randomUUID(),lines);
  prepared.forEach(crop=>temporaryIds.add(crop.asset.id));await saveFigureCropAssets(prepared.map(crop=>crop.asset));
  check(prepared.length===2&&prepared.every(crop=>crop.metadata.referenceHidden===true),'実canvasの新規cropは原本を保持して初期非表示');
  doc.manga.pages=[doc.manga.pages[0]];const page=doc.manga.pages[0];page.images=[];page.page_overlay=undefined;
  page.panels=[{id:1,shape:{type:'rect',x:16,y:18.5,w:150,h:217},bg:0,action:null,bubbles:[]}];
  attachRecognizedTextToPage(page,lines,new Map(prepared.map(crop=>[crop.lineId,crop.metadata])));
  const ready=await separateBubbleOriginals(doc),image=ready.manga.pages[0].panels[0].images![0],key=`original-${image.id}`;
  const drawOrder=structuredClone(ready.manga),orderPanel=drawOrder.pages[0].panels[0];
  orderPanel.bubbles[0].text='';orderPanel.bubbles[0].shape='square';orderPanel.bubbles[0].tail=false;
  orderPanel.bubbles[0].bbox={x:40,y:50,w:40,h:40};orderPanel.images![0].bbox={x:40,y:50,w:40,h:40};orderPanel.images![0].paint!.layers[0].visible=true;
  orderPanel.bubbles.push({text:'',shape:'square',tail:false,bbox:{x:60,y:60,w:40,h:40}});
  const output=await captureQwenCompositionCanvas(drawOrder,0,0,'page'),read=(x:number,y:number)=>{
   const context=output.getContext('2d')!,w=drawOrder.pages[0].canvas.w,h=drawOrder.pages[0].canvas.h;
   return Array.from(context.getImageData(Math.floor(x/w*output.width),Math.floor(y/h*output.height),1,1).data).join(',');
  };
  check(read(70,70)==='255,255,255,255'&&read(50,60)!=='255,255,255,255','PNG出力でも前の原本より後ろの吹き出しを上に描く');
  output.width=output.height=1;
  const root=`.page-layer-palette [data-owner-root="${key}"]`,heading='.panel-layer-group [data-owner-group="bubble-0"] .layer-group-select';
  const eye=()=>first<HTMLButtonElement>(`${root} .layer-visibility`);
  render(null,host);localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(ready));mounted=true;render(<App/>,host);
  const expand=async()=>{
   for(const button of document.querySelectorAll<HTMLButtonElement>('.page-layer-palette .panel-layer-heading button[aria-expanded="false"]'))button.click();
   await wait(()=>!!first<HTMLElement>('.page-layer-palette [data-owner-group="bubble-0"]'),'吹き出しgroupがありません');
   for(const button of document.querySelectorAll<HTMLButtonElement>('.page-layer-palette [data-owner-group="bubble-0"] [aria-expanded="false"]'))button.click();
   await wait(()=>!!eye(),'原本レイヤーがありません');
  };
  await expand();await wait(()=>sourceCanvases().length===2,'原本canvasが表示されません');
  check(!!first<HTMLElement>(root).closest('.layer-group')?.querySelector('.bubble-native-row'),'原本と文字・輪郭を同じ吹き出しフォルダーの別の子として表示');
  check(!document.querySelector('.original-owner-row,.layer-owner-info-row')&&first<HTMLElement>(root).querySelectorAll('[role="treeitem"]').length===1,'原本は画像レイヤー1行だけで、見出し・コマ情報行を表示しない');
  const unchanged=localStorage.getItem(STORAGE_KEY);
  const fold=first<HTMLButtonElement>('.panel-layer-group [data-owner-group="bubble-0"] [aria-expanded]');fold.click();await expand();
  check(localStorage.getItem(STORAGE_KEY)===unchanged,'フォルダー開閉は目・原文・履歴を変更しない');
  check(eye().getAttribute('aria-pressed')==='false'&&sourceCanvases().every(canvas=>!opaque(canvas)),'通常コマとページ前景の原本は透明で本文を覆わない');
  check(!document.querySelector('.bubble-original-child .canvas-content-hit'),'非表示の原本は遅延計測中も選択用の透明パスを持たない');
  check(first<HTMLElement>('[data-content-kind="bubble"][data-content-panel="0"]').textContent!.includes('認識した本文'),'認識したネイティブ本文は初期状態から表示');
  const group='.panel-layer-group [data-owner-group="bubble-0"]';
  const folderLock=()=>first<HTMLButtonElement>(`${group}>.layer-row-lock`);
  const childLocks=()=>Array.from(first<HTMLElement>(group).parentElement!.querySelectorAll<HTMLButtonElement>(':scope > [role="group"] .layer-row-lock'));
  folderLock().click();
  await wait(()=>folderLock().getAttribute('aria-pressed')==='true'&&childLocks().every(button=>button.disabled),'親の固定が子へ継承されません');
  check(childLocks().length===2&&childLocks().every(button=>button.getAttribute('aria-pressed')==='true'),'フォルダー固定中は文字・輪郭と原本レイヤーが固定され、子の解除ボタンは無効');
  first<HTMLButtonElement>(`${group} .layer-group-select`).click();
  await wait(()=>!document.querySelector('.app-shell.is-painting')&&stored().manga.pages[0].panels[0].bubbles[0].locked===true,'親固定を保存できません');
  render(null,host);render(<App/>,host);await expand();
  check(childLocks().every(button=>button.disabled),'再読込後も親固定中の子解除を禁止');
  const lockedOriginal=first<HTMLElement>('.bubble-original-child [data-content-kind="image"]');
  check(lockedOriginal.hasAttribute('data-artwork-locked')&&!lockedOriginal.querySelector('.canvas-content-hit'),'親固定中の原本は配置移動のhit対象にならない');
  folderLock().click();await wait(()=>folderLock().getAttribute('aria-pressed')==='false'&&!childLocks().some(button=>button.disabled),'親の固定を解除できません');
  first<HTMLButtonElement>(`${group} .layer-group-select`).click();
  await wait(()=>!document.querySelector('.app-shell.is-painting')&&stored().manga.pages[0].panels[0].bubbles[0].locked!==true,'固定解除を保存できません');
  check(childLocks().every(button=>button.getAttribute('aria-pressed')==='false'),'親の解除は既存の規則どおり子も解除');
  for(const visible of [true,false]){
   eye().click();await wait(()=>!!document.querySelector('.app-shell.is-painting')&&eye()?.getAttribute('aria-pressed')===String(visible)&&!first<HTMLButtonElement>(heading)?.disabled,'原本の目が切り替わりません');
   first<HTMLButtonElement>(heading).click();
   await wait(()=>!document.querySelector('.app-shell.is-painting')&&stored().manga.pages[0].panels[0].images?.[0].paint?.layers[0].visible===visible,'目の状態が保存されません');
   for(const item of stored().manga.image_assets??[])if(!baselineIds.has(item.storageId))temporaryIds.add(item.storageId);
   await wait(()=>sourceCanvases().length===2&&sourceCanvases().some(opaque)===visible,'原本の描画状態が目に追従しません');
   check(true,visible?'既存の目で原本を再表示できる':'既存の目で原本を再非表示にできる');
   render(null,host);render(<App/>,host);await expand();await wait(()=>sourceCanvases().length===2,'保存済み原本の再読込に失敗');
   check(eye().getAttribute('aria-pressed')===String(visible)&&sourceCanvases().some(opaque)===visible,`再読込は保存済みlayerの目=${visible}を保持`);
   check(stored().manga.pages[0].panels[0].bubbles[0].text==='認識した本文','目の変更と再読込は本文を変更しない');
  }
  const before=stored(),parent=before.manga.pages[0].panels[0],sourceHash=await imageSha256((await loadFigureCropAsset(parent.bubbles[0].analogTextImport!.assetId))!);
  // Duplicate the page using the normal sidebar, then remove only the copied original.
  Array.from(document.querySelectorAll<HTMLButtonElement>('.page-sidebar button')).find(button=>button.textContent?.trim()==='複製')!.click();
  await wait(()=>stored().manga.pages.length===2,'ページを複製できません');await expand();
  first<HTMLButtonElement>(`${root} .layer-select`).click();
  await wait(()=>!!document.querySelector('.app-shell.is-painting')&&!first<HTMLButtonElement>('.layer-controls [aria-label="削除"]')?.disabled,'複製原本を選択できません');
  first<HTMLButtonElement>('.layer-controls [aria-label="削除"]').click();
  await wait(()=>!document.querySelector(`${root} .layer-row`),'原本を削除できません');
  first<HTMLButtonElement>('.panel-layer-group [data-owner-group="bubble-0"] .layer-group-select').click();
  await wait(()=>!document.querySelector('.app-shell.is-painting')&&stored().manga.pages[1].panels[0].images?.length===0,'削除を保存できません');
  check(stored().manga.pages[0].panels[0].images?.length===1&&stored().manga.pages[1].panels[0].bubbles[0].analogTextImport?.originalImageId===null,'ページ複製後の原本削除は複製側だけへ作用');
  const history=(name:string)=>first<HTMLButtonElement>(`.app-header [aria-label^="${name}"]`);
  history('元に戻す').click();await wait(()=>stored().manga.pages[1].panels[0].images?.length===1,'原本削除のUndoに失敗');
  check(stored().manga.pages[1].panels[0].bubbles[0].analogTextImport?.originalImageId===image.id,'1Undoで原本と関連IDを同時復元');
  history('やり直す').click();await wait(()=>stored().manga.pages[1].panels[0].images?.length===0,'原本削除のRedoに失敗');
  check(stored().manga.pages[1].panels[0].bubbles[0].text==='認識した本文','Redo後も文字・輪郭を保持');
  const snapshot=await createProjectSnapshot(stored());
  const restored=await restoreProjectSnapshot(snapshot,async items=>{items.forEach(item=>temporaryIds.add(item.id));await saveFigureCropAssets(items);});
  validateImagePlacements(restored);const loaded=await separateBubbleOriginals(restored);
  check(loaded===restored&&loaded.manga.pages[1].panels[0].images?.length===0,'既存snapshot保存往復で原本削除を復活させない');
  check(await imageSha256((await loadFigureCropAsset(parent.bubbles[0].analogTextImport!.assetId))!)===sourceHash,'複製・削除・保存往復で元の原本byteを保持');
  check((await Promise.all(prepared.map(crop=>loadFigureCropAsset(crop.asset.id)))).every(blob=>!!blob),'非表示後も切出し原本のbyteを保持');
  report.textContent=`OCR原本 PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){report.textContent=`OCR原本 FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;throw error;}
 finally{
  if(mounted){for(const item of stored().manga.image_assets??[])if(!baselineIds.has(item.storageId))temporaryIds.add(item.storageId);render(null,host);localStorage.setItem(STORAGE_KEY,original!);render(<App/>,host);}
  await deleteFigureCropAssets([...temporaryIds]);buttons.forEach(button=>button.disabled=false);
 }
}


async function verifyPaletteStability(){
 const report=document.getElementById('selection-report')!,button=document.getElementById('check-stability') as HTMLButtonElement,checks:string[]=[];
 const first=<T extends HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
 const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
 const wait=async(test:()=>boolean,label:string)=>{for(let i=0;i<300&&!test();i++)await tick();if(!test())throw Error(label);};
 const settle=async()=>{for(let i=0;i<8;i++)await tick();};
 const click=(selector:string)=>{const item=first<HTMLElement>(selector);if(!item)throw Error(`対象なし: ${selector}`);item.click();};
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const panel='.page-layer-palette .panel-layer-group[aria-label="コマ 01"]';
 const host=document.getElementById('app')!,before=localStorage.getItem(STORAGE_KEY);button.disabled=true;
 try{
  click('.page-switcher [aria-label="前のページ"]');await settle();
  const stored=()=>parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
  if(stored().manga.meta.episode_id!=='layer-selection-qa')throw Error('Dedicated manuscript required');
  first<HTMLButtonElement>(`${panel} .panel-layer-heading button[aria-expanded="false"]`)?.click();await settle();
  const tree=first<HTMLElement>(`${panel} .paint-layer-palette`),paper=first<HTMLElement>('.manga-paper');
  const figureFold=()=>first<HTMLButtonElement>(`${panel} [data-owner-group="figure-0"] [aria-expanded]`);
  if(figureFold().getAttribute('aria-expanded')==='true')figureFold().click();await settle();
  click('.manga-paper [data-content-kind="figure"][data-content-panel="0"][data-content-index="0"]');await settle();
  check(figureFold().getAttribute('aria-expanded')==='false','編集画面で人物を選択しても閉じたフォルダーを開かない');
  const text='.manga-paper [data-content-kind="screen_text"][data-content-panel="0"]';
  click(`${panel} [aria-label="テキスト3を隠す"]`);await wait(()=>!document.querySelector(text),'文字を隠せません');
  await wait(()=>stored().manga.pages[0].panels[0].screen_text![0].hidden===true,'文字の非表示を保存できません');
  check(first<HTMLElement>(`${panel} .paint-layer-palette`)===tree&&first<HTMLElement>('.manga-paper')===paper,'文字の目を切り替えてもパレットと紙面のDOMを保持');
  click(`${panel} [aria-label="テキスト3を表示"]`);await wait(()=>!!document.querySelector(text),'文字を再表示できません');
  check(true,'文字の目で非表示・再表示し、保存にも反映');
  click(`${panel} [aria-label="コマ 01の枠を選択"]`);await settle();
  click('.selection-layer-controls [aria-label="ベクターレイヤー追加"]');
  await wait(()=>!!document.querySelector('.app-shell.is-painting')&&!!document.querySelector(`${panel} .layer-name-line svg`),'ベクターレイヤーを追加できません');await settle();
  check(first<HTMLElement>(`${panel} .paint-layer-palette`)===tree&&first<HTMLElement>('.manga-paper')===paper,'ベクターレイヤー追加と描画モード移行でもパレットと紙面のDOMを保持');
  check(figureFold().getAttribute('aria-expanded')==='false','レイヤー追加でも閉じた人物フォルダーを保持');
  const vector=first<HTMLElement>(`${panel} .layer-row.is-selected`),eye=vector.querySelector<HTMLButtonElement>('.layer-visibility')!;
  eye.click();await settle();eye.click();await settle();
  check(first<HTMLElement>(`${panel} .paint-layer-palette`)===tree&&figureFold().getAttribute('aria-expanded')==='false','描画レイヤーの目を往復してもパレットと開閉状態を保持');
  click(`${panel} [data-owner-group="figure-0"] .layer-group-select`);await wait(()=>!document.querySelector('.app-shell.is-painting'),'描画を確定できません');await settle();
  check(first<HTMLElement>(`${panel} .paint-layer-palette`)===tree&&figureFold().getAttribute('aria-expanded')==='false','描画モード終了後も同じパレットと開閉状態を保持');
  report.textContent=`表示切替 PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){report.textContent=`表示切替 FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;throw error;}
 finally{render(null,host);if(before)localStorage.setItem(STORAGE_KEY,before);render(<App/>,host);button.disabled=false;}
}


async function verifySelectionRows(){
 const report=document.getElementById('selection-report')!,button=document.getElementById('check-rows') as HTMLButtonElement,checks:string[]=[];
 const root=()=>document.querySelector<HTMLElement>('.page-layer-palette')!;
 const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
 const settle=async()=>{for(let i=0;i<8;i++)await tick();};
 const wait=async(test:()=>boolean,label:string)=>{for(let i=0;i<300&&!test();i++)await tick();if(!test())throw Error(label);await settle();};
 const click=(selector:string)=>{const item=document.querySelector<HTMLElement>(selector);if(!item)throw Error(`対象なし: ${selector}`);item.click();};
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const selected=(...selectors:string[])=>{const rows=[...root().querySelectorAll('.is-selected')];return rows.length===selectors.length&&selectors.every(selector=>rows.some(row=>row.matches(selector)));};
 const panel='.panel-layer-group[aria-label="コマ 01"]',other='.panel-layer-group[aria-label="コマ 02"]',page='.page-panel-outside-layers:not([data-before-panel])';
 const host=document.getElementById('app')!,before=localStorage.getItem(STORAGE_KEY);button.disabled=true;
 try{
  if(parseMangaYaml(before!).manga.meta.episode_id!=='layer-selection-qa')throw Error('Dedicated manuscript required');
  click('.page-switcher [aria-label="前のページ"]');await settle();
  document.querySelector<HTMLButtonElement>(`${panel} .panel-layer-heading button[aria-expanded="false"]`)?.click();
  click(`${page} [data-owner-group="figure-0"] .layer-group-select`);await settle();
  check(selected(`${page} [data-owner-group="figure-0"]`),'前景人物だけを強調');
  check(!document.querySelector('.manga-panel.is-selected,.manga-panel.is-group-selected,.panel-selection-overlay'),'コマ外の選択で無関係なコマを強調しない');
  const guide=`${page} [data-owner-root="figure-0"] .layer-row`;
  document.querySelector<HTMLButtonElement>(`${page} [data-owner-group="figure-0"] [aria-expanded="false"]`)?.click();
  click(`${guide} .layer-select`);await wait(()=>!!document.querySelector('.app-shell.is-painting'),'描画layerを選べません');
  check(selected(guide,`${page} [data-owner-group="figure-0"]`),'前景あたりと人物フォルダーだけを強調');
  check(!!document.querySelector('.page-overlay-inspector'),'前景の描画中も詳細欄の所属をページ前景に保つ');
  check(getComputedStyle(document.querySelector(`${guide} .layer-select`)!).backgroundColor==='rgba(0, 0, 0, 0)','選択ボタンは行全体の背景色を使用');
  click(`${page} .native-text-layer .layer-select`);await wait(()=>!document.querySelector('.app-shell.is-painting'),'文字選択で描画を終了できません');
  check(selected(`${page} .native-text-layer`),'前景文字だけを強調し人物フォルダーを強調しない');
  const textX=document.querySelector(`${page} .native-text-layer .layer-kind-icon`)!.getBoundingClientRect().left;
  const guideX=document.querySelector(`${guide} .layer-thumbnail`)!.getBoundingClientRect().left;
  check(guideX>textX+10,'人物内のあたりをコマ外直下の文字より一段深く字下げ');
  click(`${panel} [aria-label="コマ 01の枠を選択"]`);await settle();
  check(selected(`${panel} .panel-frame-layer`,`${panel}>.panel-layer-heading`),'コマ枠の行と所属コマを選択');
  check(!!document.querySelector('.panel-selection-overlay')&&!document.querySelector('.native-text-input'),'コマ枠を選ぶと文字編集を終了し枠の操作点を表示');
  document.querySelector<HTMLButtonElement>(`${other} .panel-layer-heading button[aria-expanded="false"]`)?.click();
  click(`${other} [aria-label="コマ 02の枠を選択"]`);await settle();
  check(selected(`${other} .panel-frame-layer`,`${other}>.panel-layer-heading`),'別コマへ移っても枠と所属コマの選択を保持');
  click(`${panel} .panel-layer-select`);await settle();
  check(selected(`${panel} .panel-layer-heading`),'コマ全体の選択とコマ枠の選択を分離');
  click(`${panel} .native-text-layer .layer-select`);await settle();
  check(selected(`${panel} .native-text-layer`,`${panel}>.panel-layer-heading`),'コマ内の文字と所属コマを強調');
  click(`${panel} .panel-layer-select`);await settle();
  check(localStorage.getItem(STORAGE_KEY)===before,'選択の往復で保存原稿を変更しない');
  click(`${panel} [aria-label="コマ 01の枠を選択"]`);await settle();
  click('.selection-layer-controls [aria-label="フォルダー追加"]');await wait(()=>!!document.querySelector(`${panel} .layer-user-folder-row`),'通常folderを追加できません');
  check(selected(`${panel} .layer-user-folder-row`,`${panel}>.panel-layer-heading`),'通常フォルダーの選択でも所属コマを強調');
  click('.layer-controls [aria-label="ラスターレイヤー追加"]');await wait(()=>!!document.querySelector(`${panel} .layer-direct-root [data-owner="panel"].is-selected`),'通常layerを追加できません');
  check(selected(`${panel} .layer-direct-root [data-owner="panel"]`,`${panel}>.panel-layer-heading`),'通常レイヤーにも選択行と所属コマの共通ルールを適用');
  const folderColor=getComputedStyle(document.querySelector(`${panel} .layer-row.is-selected`)!).backgroundColor;
  click(`${panel} .layer-folder-select`);await settle();
  check(getComputedStyle(document.querySelector(`${panel} .layer-user-folder-row.is-selected`)!).backgroundColor===folderColor,'通常folderとlayerで選択色を共通化');
  report.textContent=`選択行 PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){report.textContent=`選択行 FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;throw error;}
 finally{render(null,host);if(before)localStorage.setItem(STORAGE_KEY,before);render(<App/>,host);button.disabled=false;}
}

async function verifyPaletteGeometry(){
 const report=document.getElementById('selection-report')!,button=document.getElementById('check-geometry') as HTMLButtonElement,checks:string[]=[];
 const host=document.getElementById('app')!,before=localStorage.getItem(STORAGE_KEY);
 const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
 const settle=async()=>{for(let i=0;i<12;i++)await tick();};
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const first=<T extends Element>(selector:string)=>document.querySelector<T>(selector)!;
 const click=(selector:string)=>first<HTMLElement>(selector).click();
 const page='.page-panel-outside-layers:not([data-before-panel])',group=`${page} [data-owner-group="bubble-0"]`,imageRow=`${page} [data-original-raster="page-crop"] .layer-row`;
 const pixels=()=>{const canvas=first<HTMLCanvasElement>(`${imageRow} canvas`);return {width:canvas.width,height:canvas.height,data:Array.from(canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data)};};
 button.disabled=true;
 try{
  if(parseMangaYaml(before!).manga.meta.episode_id!=='layer-selection-qa')throw Error('Dedicated manuscript required');
  render(null,host);render(<App/>,host);await settle();
  document.querySelector<HTMLButtonElement>(`${group} [aria-expanded="false"]`)?.click();await settle();
  first<HTMLElement>(group).scrollIntoView({block:'center'});await settle();
  const original=pixels();check(original.data.some((v,i)=>i%4===3&&v>0),'選択前に原本画像の画素を確認');
  for(let cycle=0;cycle<2;cycle++){
   for(const [name,selector,painting] of [['画像',`${imageRow} .layer-select`,true],['文字・輪郭',`${page} .bubble-native-row .layer-select`,false]] as const){
    const scroller=first<HTMLElement>('.paint-layers-dock .dock-content');
    const measure=()=>({y:first<HTMLElement>(imageRow).getBoundingClientRect().top,scroll:scroller.scrollTop,header:first<HTMLElement>('.page-layer-palette>.layer-controls').getBoundingClientRect().height});
    const initial=measure(),samples=[initial];click(selector);
    for(let i=0;i<70;i++){await tick();samples.push(measure());}
    check(Boolean(document.querySelector('.app-shell.is-painting'))===painting,`${cycle+1}回目・${name}の選択が完了`);
    check(samples.every(v=>Math.abs(v.y-initial.y)<.5&&Math.abs(v.scroll-initial.scroll)<.5&&Math.abs(v.header-initial.header)<.5),`${cycle+1}回目・${name}選択中の全71フレームで行位置とスクロールを保持`);
    const current=pixels();check(current.width===original.width&&current.height===original.height&&current.data.every((v,i)=>v===original.data[i]),`${cycle+1}回目・${name}選択後の原本サムネイルが画素一致`);
   }
  }
  const rows=Array.from(document.querySelectorAll<HTMLElement>('.page-layer-tree .layer-row,.page-layer-tree .layer-group-row,.page-layer-tree .layer-user-folder-row,.page-layer-tree .panel-layer-heading')).filter(row=>row.getClientRects().length);
  check(rows.every((row,i)=>i===0||Math.abs(row.getBoundingClientRect().top-rows[i-1].getBoundingClientRect().bottom)<.5),'一覧の各行の間に余分な空白を作らない');
  const separators=rows.map(row=>getComputedStyle(row));
  check(separators.every(style=>style.borderBottomWidth==='1px'&&style.borderBottomColor===separators[0].borderBottomColor),'行の区切り線は全種類で同じ1pxと色');
  check(localStorage.getItem(STORAGE_KEY)===before,'選択の往復で保存原稿を変更しない');
  report.textContent=`位置・縮尺 PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){report.textContent=`位置・縮尺 FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;throw error;}
 finally{render(null,host);if(before)localStorage.setItem(STORAGE_KEY,before);render(<App/>,host);button.disabled=false;}
}
