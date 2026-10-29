import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {STORAGE_KEY,toStoredMangaYaml} from '../src/lib/manga';
import {newPaintLayer} from '../src/lib/paintDocument';
import {newToneLayer} from '../src/lib/paintTone';
import {readPaintPixels,paintPreviewRenderer,renderPaintPng,decodePaintImage} from '../src/lib/paintRenderer';
import type {PaintColorMode,PaintDocument,PaintStroke} from '../src/types';
import '../src/styles/global.css';
if(location.port!=='4325')throw Error('Dedicated test origin required');
const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
const images=new Map<string,HTMLImageElement>(),size=126;
const mark:PaintStroke={tool:'pen',color:'#ff0000',size:44,points:[{x:28.3,y:20.4,pressure:.6,time:0},{x:73.8,y:104.1,pressure:1,time:1}]};
const canvas=()=>{const c=document.createElement('canvas');c.width=c.height=size;return c;};
const progress=document.createElement('p');progress.textContent='表現色の画素を検証中…';document.getElementById('app')!.append(progress);
async function pixels(){
 for(const mode of ['color','grayscale','monochrome'] as PaintColorMode[]){
  progress.textContent=`表現色の画素を検証中：${mode}`;
  const empty=newPaintLayer(mode,'raster',mode),layer={...empty,strokes:[mark]},paint:PaintDocument={version:1,width:size,height:size,dpi:600,layers:[layer]};
  const data=readPaintPixels(paint,layer,images).data;
  if(mode==='monochrome')check(data.every((v,i)=>i%4===3?v===0||v===255:v===0),'モノクロの赤インクは黒・透明の2値');
  if(mode==='grayscale')check(data.every((v,i)=>i%4!==0||v===data[i+1]&&v===data[i+2])&&data.some((v,i)=>i%4===3&&v>0&&v<255),'グレースケールはRGB同値・滑らかな輪郭');
  if(mode==='color')check(data.some((v,i)=>i%4===0&&v>data[i+1]),'カラーは赤を保持');
  const preview=canvas(),renderer=paintPreviewRenderer();renderer.draw(preview,paint,images);
  check(preview.getContext('2d')!.getImageData(0,0,size,size).data.every((v,i)=>v===data[i]),`${mode} 原寸表示が画素読み取りと一致`);
  renderer.draw(preview,{...paint,layers:[empty]},images,{layerId:layer.id,stroke:mark});
  check(preview.getContext('2d')!.getImageData(0,0,size,size).data.every((v,i)=>v===data[i]),`${mode} 描画中が確定後と一致`);
  const image=await decodePaintImage(await renderPaintPng(paint,images)),out=canvas();out.getContext('2d')!.drawImage(image,0,0);image.src='';
  check(out.getContext('2d')!.getImageData(0,0,size,size).data.every((v,i)=>v===data[i]),`${mode} PNGが原寸と一致`);
  if(mode==='monochrome'){
   renderer.draw(preview,{...paint,layers:[empty],generationMask:{enabled:true,strokes:[mark]}},images);
   const rgba=preview.getContext('2d')!.getImageData(0,0,size,size).data;check(rgba.some((v,i)=>i%4===0&&v>rgba[i+1]),'モノクロでも生成マーカーは赤を保持');
   renderer.draw(preview,{...paint,layers:[{...layer,colorMode:'color'}]},images);
   check(preview.getContext('2d')!.getImageData(0,0,size,size).data.some((v,i,a)=>i%4===0&&v>a[i+1]),'表現色をカラーへ戻すと元の赤が戻る');
   const tone={...newToneLayer(null,'monochrome'),mask:undefined,tone:{enabled:true,lpi:60,mode:'image' as const,density:20},strokes:[{tool:'fill' as const,color:'#808080',size:1,points:mark.points,selection:[{x:0,y:0,w:size,h:size}]}]};
   const toned=readPaintPixels(paint,tone,images).data,coverage=toned.reduce((n,v,i)=>n+(i%4===3?v/255:0),0)/(size*size);
   check(coverage>.45&&coverage<.55,'画像濃度トーンは二値化前の中間調を使う');
   preview.width=preview.height=31;renderer.draw(preview,{...paint,layers:[tone]},images);
   const reduced=preview.getContext('2d')!.getImageData(0,0,31,31).data;
   check(reduced.some((v,i)=>i%4===3&&v>0&&v<255),'モノクロの縮小トーンは平均濃度を保持');
   const fill=(color:string,x:number,w:number):PaintStroke=>({tool:'fill',color,size:1,points:mark.points,selection:[{x,y:0,w,h:size}]});
   const stripes={...empty,strokes:[fill('#ffffff',0,size),{...fill('#ff0000',0,1),selection:Array.from({length:63},(_,x)=>({x:x*2,y:0,w:1,h:size}))}]};
   preview.width=preview.height=21;renderer.draw(preview,{...paint,layers:[stripes]},images);
   const mean=preview.getContext('2d')!.getImageData(10,10,1,1).data;
   check(mean[3]===255&&mean[0]>100&&mean[0]<155&&mean[0]===mean[1],`同一層の白地と1px黒線は縮小時の平均を保持 (${Array.from(mean)})`);
   const source=await decodePaintImage(await renderPaintPng({...paint,layers:[stripes]},images));images.set('stripes',source);
   const imported={...empty,image:{assetId:'stripes',crop:{x:0,y:0,w:size,h:size},bbox:{x:0,y:0,w:size,h:size}}};
   renderer.draw(preview,{...paint,layers:[imported]},images);const imageMean=preview.getContext('2d')!.getImageData(10,10,1,1).data;
   check(imageMean[3]===255&&imageMean[0]>100&&imageMean[0]<155,'白黒の読み込み画像も二値化してから縮小');source.src='';images.delete('stripes');
   const blank=newPaintLayer('color underneath');
   const mixed=await decodePaintImage(await renderPaintPng({...paint,layers:[blank,layer]},images)),mixedCanvas=canvas();mixedCanvas.getContext('2d')!.drawImage(mixed,0,0);mixed.src='';
   check(mixedCanvas.getContext('2d')!.getImageData(0,0,size,size).data.every((v,i)=>v===data[i]),'カラー層と混在したPNGもモノクロ原寸と一致');
  }
  renderer.dispose();
 }
}
const tick=()=>new Promise(r=>setTimeout(r,100));
const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.getAttribute('aria-label')===name||b.textContent?.trim()===name);
const click=async(name:string)=>{const b=button(name);if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')throw Error(`Button unavailable: ${name}`);b.click();await tick();};
const mode=()=>document.querySelector<HTMLSelectElement>('select[aria-label="レイヤーのカラーモード"]');
const ready=async(value:string)=>{for(let i=0;i<100&&(!mode()||mode()!.matches(':disabled')||mode()!.value!==value);i++)await tick();};
async function ui(){
 await click('カラーモード');
 check(mode()?.value===''&&Boolean(mode()?.matches(':disabled'))&&mode()?.selectedOptions[0]?.textContent==='レイヤーを選択','未選択時は仮のカラーを表示せずレイヤー選択を案内');
 const row=Array.from(document.querySelectorAll<HTMLButtonElement>('.layer-select')).find(b=>b.textContent?.includes('あたり · 背景'));if(!row)throw Error('Layer row missing');row.click();
 await ready('color');
 check(mode()?.value==='color','アタリは元画像のカラーを保持');
 const drawing=Array.from(document.querySelectorAll<HTMLButtonElement>('.layer-select')).find(b=>b.textContent?.includes('レイヤー'));drawing?.click();await ready('monochrome');
 check(mode()?.value==='monochrome','アタリの上の描画レイヤーが基本表現色を継承');
 await click('ラスターレイヤー追加');check(mode()?.value==='monochrome','追加ラスターが基本表現色を継承');
 check(document.querySelectorAll('.paint-colors .paint-color').length===2,'モノクロのパレットは白黒');
 check(button('アンチエイリアス：なし')?.getAttribute('aria-pressed')==='true'&&button('アンチエイリアス：強')?.getAttribute('aria-disabled')==='true','モノクロはAAなしで固定');
 const select=mode()!;select.value='grayscale';select.dispatchEvent(new Event('change',{bubbles:true}));await tick();
 check(mode()?.value==='grayscale'&&document.querySelectorAll('.paint-colors .paint-color').length===5,'グレースケールに切り替えると灰色を選べる');
 select.value='color';select.dispatchEvent(new Event('change',{bubbles:true}));await tick();
 check(mode()?.value==='color'&&button('アンチエイリアス：強')?.getAttribute('aria-disabled')!=='true','カラーに戻すとAA設定が復元される');
 document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true,cancelable:true}));await tick();check(mode()?.value==='grayscale','表現色の変更を元に戻せる');
 document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,shiftKey:true,bubbles:true,cancelable:true}));await tick();check(mode()?.value==='color','表現色の変更をやり直せる');
 await click('ベクターレイヤー追加');check(mode()?.value==='monochrome','追加ベクターが基本表現色を継承');
 await click('トーンレイヤー作成');check(mode()?.value==='monochrome','追加トーンが基本表現色を継承');
 await click('ラスターレイヤー追加');await click('生成マスク化');
 check(document.querySelectorAll('.paint-colors .paint-color').length===6,'生成マーカーには識別用カラーが使える');
 check(mode()?.value==='color','生成マーカーのカラーモード表示はカラー');
 await click('配置へ戻る');await tick();
 for(let i=0;i<100&&document.querySelector('.paint-input');i++)await tick();
 check(mode()?.value===''&&Boolean(mode()?.matches(':disabled')),'描画を終了すると未選択表示に戻る');
 const rows=Array.from(document.querySelectorAll<HTMLButtonElement>('.layer-select')),last=rows.find(b=>b.textContent?.includes('レイヤー'));last?.click();
 await ready('monochrome');
 check(mode()?.value==='monochrome','PNG反映後に開き直してもモノクロを保持');
}
async function start(){
 await pixels();progress.remove();
 const doc=createEmptyWorkspaceDocument();doc.manga.meta.title='基本表現色の検証';doc.manga.meta.episode_id='paint-color-qa';doc.manga.meta.format='モノクロ漫画';doc.manga.finish_settings={width_mm:60,height_mm:60,dpi:100,bleed_mm:0};
 doc.manga.pages[0].canvas={w:60,h:60,unit:'mm'};doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:5,y:5,w:50,h:50},bg:0,action:null,figures:[],bubbles:[]}];
 localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));render(<App/>,document.getElementById('app')!);
 const report=document.createElement('details');report.style.cssText='position:fixed;bottom:8px;left:175px;z-index:10001;max-width:750px;padding:10px;background:white;color:#123;border:1px solid #abc;font-size:12px';
 const summary=document.createElement('summary');summary.textContent=`表現色の画素検証 PASS（${checks.length}項目）`;report.append(summary);
 const run=document.createElement('button');run.textContent='表現色の操作検証を実行';report.append(run);document.body.append(report);
 run.onclick=()=>{run.disabled=true;report.open=false;void ui().then(()=>{summary.textContent=`表現色検証 PASS（${checks.length}項目）`;}).catch(error=>{summary.textContent=`表現色検証 FAIL: ${String(error)}`;report.open=true;}).finally(()=>{const list=document.createElement('ul');checks.forEach(label=>{const item=document.createElement('li');item.textContent=label;list.append(item);});report.append(list);});};
}
start().catch(error=>render(<main><h1>表現色検証 FAIL</h1><pre>{String(error)}</pre></main>,document.getElementById('app')!));
