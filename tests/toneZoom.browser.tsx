import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {STORAGE_KEY,toStoredMangaYaml} from '../src/lib/manga';
import {newToneLayer} from '../src/lib/paintTone';
import {paintPreviewRenderer,renderPaintPng,decodePaintImage} from '../src/lib/paintRenderer';
import {saveFigureCropAssets} from '../src/lib/figureCropStore';
import type {PaintDocument} from '../src/types';
import '../src/styles/global.css';
if(location.port!=='4325')throw new Error('Dedicated local test origin required.');
async function start(){
 const params=new URLSearchParams(location.search);
 if(params.has('dot-check')){
  const size=126,samples=[];
  for(const density of [10,20,80]){
   const layer=newToneLayer();layer.mask=undefined;layer.tone!.density=density;
   const paint:PaintDocument={version:1,width:size,height:size,dpi:600,layers:[layer]};
   const blob=await renderPaintPng(paint,new Map()),png=await decodePaintImage(blob);
   const canvas=document.createElement('canvas');canvas.width=canvas.height=size;canvas.getContext('2d')!.drawImage(png,0,0);
   const pixels=canvas.getContext('2d')!.getImageData(0,0,size,size).data;
   for(let y=0;y<size-7;y++)for(let x=0;x<size-14;x++){
    const value=pixels[(y*size+x)*4+3];
    if(value!==pixels[(y*size+x+14)*4+3]||value!==pixels[((y+7)*size+x+7)*4+3])throw new Error('Nonuniform exported dots');
   }
   samples.push({density,canvas,coverage:pixels.reduce((sum,value,index)=>sum+(index%4===3?value/255:0),0)/(size*size)});
  }
  render(<main style={{padding:'24px',background:'#eef0ee',minHeight:'100vh',color:'#18231c'}}><h1>トーンの画素形状を検証 — PASS</h1><p>600dpi・60線・45度 ／ 実際のPNGを拡大表示</p><p>各濃度で14画素ごと・斜め7画素ごとに同じ形が繰り返されることを全画素で確認。</p><div style={{display:'flex',gap:'24px'}}>{samples.map(({density,coverage})=><section><h2>濃度 {density}%</h2><p>黒の面積 {(coverage*100).toFixed(2)}%</p><div id={`dots-${density}`} style={{width:'504px',height:'504px',background:'white',border:'1px solid #bbc7bf'}}/></section>)}</div><p>20%：添付資料と同じ5×5の範囲に20画素。濃度には原寸の1画素単位の量子化があります。</p></main>,document.getElementById('app')!);
  for(const {density,canvas} of samples){canvas.style.cssText='width:100%;height:100%;image-rendering:pixelated';document.getElementById(`dots-${density}`)!.append(canvas);}return;
 }
 const dpi=new URLSearchParams(location.search).get('dpi')==='350'?350:600;
 const size=Math.round(60*dpi/25.4),tone=newToneLayer([{x:0,y:0,w:size,h:size}]);
 tone.mask!.strokes=[{tool:'ellipse',color:'#ffffff',fill:'#ffffff',size:1,points:[{x:20,y:20,pressure:1,time:0},{x:size-20,y:size-20,pressure:1,time:1}]}];
 const paint:PaintDocument={version:1,width:size,height:size,dpi,guideInitialized:true,layers:[tone]};
 const blob=await renderPaintPng(paint,new Map());
 if(new URLSearchParams(location.search).has('render-check')){
  const png=await decodePaintImage(blob),reference=document.createElement('canvas');reference.width=reference.height=size;
  reference.getContext('2d')!.drawImage(png,0,0);const ref=reference.getContext('2d')!.getImageData(0,0,size,size).data;
  const native=document.createElement('canvas');native.width=native.height=size;const renderer=paintPreviewRenderer();renderer.draw(native,paint,new Map(),undefined,undefined,false);
  const actual=native.getContext('2d')!.getImageData(0,0,size,size).data;
  if(!actual.every((value,index)=>value===ref[index]))throw new Error('Native preview differs from PNG');
  const small=document.createElement('canvas');small.width=small.height=200;renderer.draw(small,paint,new Map(),undefined,undefined,false);
  const data=small.getContext('2d')!.getImageData(80,80,40,40).data;
  const density=data.reduce((sum,value,index)=>sum+(index%4===3?value/255:0),0)/1600;
  const expected=dpi===600?20/98:6/32;
  if(Math.abs(density-expected)>.005)throw new Error(`Reduced coverage ${density}, expected ${expected}`);
  render(<main style={{padding:'30px',background:'white'}}><h1>描画検証 PASS</h1><p>A4・{dpi}dpi / 60線・20%・45度</p><p>100%の表示画素とPNGが全画素一致。縮小時の中央濃度 {(density*100).toFixed(2)}%。</p><div id="sample" style={{width:`${size/window.devicePixelRatio}px`,height:`${size/window.devicePixelRatio}px`,background:'white'}}/></main>,document.getElementById('app')!);
  native.style.width=native.style.height='100%';document.getElementById('sample')!.append(native);renderer.dispose();return;
 }
 const doc=createEmptyWorkspaceDocument();doc.manga.meta.title=`A4 ${dpi}dpi・60線20%の表示検証`;doc.manga.meta.episode_id='tone-zoom-qa';
 doc.manga.finish_settings={width_mm:210,height_mm:297,dpi,bleed_mm:0};
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
 const id=`image-${sha256}`;await saveFigureCropAssets([{id,blob}]);
 doc.manga.image_assets=[{id,storageId:id,sha256,originalName:'tone.png',mediaType:'image/png',widthPx:size,heightPx:size,byteLength:blob.size}];
 doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:20,y:35,w:170,h:180},bg:1,action:null,figures:[{name:'60線・20%',size:'bust-up',bbox:{x:65,y:65,w:60,h:60},artwork:{assetId:id,crop:{x:0,y:0,w:size,h:size},opacity:1,hidden:false,locked:false,paint}}],bubbles:[]}];
 localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));
 render(<App/>,document.getElementById('app')!);
}
start().catch(error=>render(<main><h1>描画検証 FAIL</h1><pre>{String(error)}</pre></main>,document.getElementById('app')!));
