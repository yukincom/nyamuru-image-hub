import {render} from 'preact';
import {newToneLayer} from '../src/lib/paintTone';
import {newPaintLayer} from '../src/lib/paintDocument';
import {readPaintPixels,readPaintMaskPixels,readGenerationMaskPixels,renderPaintPng,decodePaintImage,paintPreviewRenderer} from '../src/lib/paintRenderer';
import type {PaintDocument,PaintStroke} from '../src/types';
if(location.port!=='4325')throw Error('Dedicated test origin required.');
const width=252,height=252,images=new Map<string,HTMLImageElement>();
const checks:string[]=[],samples:{label:string;canvas:HTMLCanvasElement;gray:number}[]=[];
const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
const partial=(data:Uint8ClampedArray)=>data.reduce((n,v,i)=>n+(i%4===3&&v>0&&v<255?1:0),0);
const canvas=()=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c;};
const stroke=(tool:'pen'|'eraser'):PaintStroke=>({tool,color:'#000000',size:111,points:[{x:74.3,y:58.7,pressure:.6,time:0},{x:126.8,y:117.4,pressure:1,time:20},{x:118.4,y:201.2,pressure:.8,time:40}]});
async function run(){
 let originalFailure:string|undefined;
 for(const dpi of [350,600])for(const density of [10,80])for(const tool of ['pen','eraser'] as const){
  const empty=newToneLayer();empty.antialias=0;empty.tone!.density=density;empty.mask!.reveal=tool==='eraser';
  const mark=stroke(tool),layer={...empty,mask:{...empty.mask!,strokes:[mark]}},paint:PaintDocument={version:1,width,height,dpi,layers:[layer]};
  const pixels=readPaintPixels(paint,layer,images),mask=readPaintMaskPixels(paint,layer);
  const blob=await renderPaintPng(paint,images),header=new Uint8Array(await blob.arrayBuffer());
  check(header[24]===8&&header[25]===6,'PNGは8bit RGBA形式');
  const png=await decodePaintImage(blob),out=canvas(),ctx=out.getContext('2d')!;ctx.drawImage(png,0,0);png.src='';
  const exported=ctx.getImageData(0,0,width,height).data,gray=partial(exported);
  if(dpi===600){const display=canvas();display.getContext('2d')!.drawImage(out,0,0);samples.push({label:`${density}%・${tool==='pen'?'ペンで塗る':'消しゴムで消す'}`,canvas:display,gray});}
  // Collect visible evidence even before the fix, instead of aborting at the first edge.
  if(gray||partial(mask.data))originalFailure??=`${dpi}dpi ${density}% ${tool}: PNGの半透明画素 ${gray} / マスク ${partial(mask.data)}`;
  check(exported.every((v,i)=>v===pixels.data[i]),'原寸の描画とPNGが一致');
  const renderer=paintPreviewRenderer(),preview=canvas();renderer.draw(preview,paint,images);
  check(preview.getContext('2d')!.getImageData(0,0,width,height).data.every((v,i)=>v===exported[i]),'原寸プレビューとPNGが一致');
  renderer.draw(preview,{...paint,layers:[empty]},images,{layerId:layer.id,target:'mask',stroke:mark});
  const liveData=preview.getContext('2d')!.getImageData(0,0,width,height).data,firstDiff=liveData.findIndex((v,i)=>v!==exported[i]);
  check(firstDiff<0,`描画中と確定後の境界が一致 (${dpi}dpi ${density}% ${tool}; diff=${firstDiff}, live=${liveData[firstDiff]}, PNG=${exported[firstDiff]})`);
  // White-paper compositing must contain only opaque black and white after the fix.
  ctx.globalCompositeOperation='destination-over';ctx.fillStyle='white';ctx.fillRect(0,0,width,height);
  const flat=ctx.getImageData(0,0,width,height).data;
  if(!flat.every((v,i)=>i%4===3?v===255:v===0||v===255))originalFailure??='白紙合成後の境界にグレーが残る';
  preview.width=preview.height=63;renderer.draw(preview,paint,images);
  check(partial(preview.getContext('2d')!.getImageData(0,0,63,63).data)>0,'縮小表示は平均濃度を保持する');renderer.dispose();
 }
 if(originalFailure)throw Error(originalFailure);
 const soft=newToneLayer();soft.antialias=3;soft.mask!.strokes=[stroke('pen')];
 const paint:PaintDocument={version:1,width,height,dpi:600,layers:[soft]};
 check(partial(readPaintMaskPixels(paint,soft).data)>0,'アンチエイリアス強のマスクは設定を保持する');
 const hint={...paint,generationMask:{enabled:true,antialias:0 as const,strokes:[{...stroke('pen'),color:'#ff0000'}]}};
 check(partial(readGenerationMaskPixels(hint).data)===0,'生成マーカーもAAなしの境界を使う');
 const imageCanvas=canvas(),ic=imageCanvas.getContext('2d')!;ic.fillStyle='rgba(20,40,80,.4)';ic.fillRect(0,0,width,height);
 const source=await new Promise<Blob>(resolve=>imageCanvas.toBlob(blob=>resolve(blob!)));images.set('source',await decodePaintImage(source));
 const imported={...newPaintLayer(),antialias:0 as const,image:{assetId:'source',crop:{x:0,y:0,w:width,h:height},bbox:{x:0,y:0,w:width,h:height}}};
 const sourcePixels=readPaintPixels(paint,imported,images);
 check(sourcePixels.data[3]===102&&sourcePixels.data[2]>sourcePixels.data[0],'読み込んだカラー画像の半透明を保持する');
 const translucent={...soft,antialias:0 as const,opacity:.5},dimmed=canvas(),renderer=paintPreviewRenderer();renderer.draw(dimmed,{...paint,layers:[translucent]},images);
 check(partial(dimmed.getContext('2d')!.getImageData(0,0,width,height).data)>0,'意図したレイヤー濃度は保持する');renderer.dispose();
}
run().then(()=>show()).catch(error=>show(String(error)));
function show(error?:string){
 render(<main style={{fontFamily:'sans-serif',padding:'20px',background:'#edf1ee',minHeight:'100vh',color:'#14251b'}}><h1 style={{fontSize:'22px'}}>トーン境界の白黒検証 — {error?'FAIL':'PASS'}</h1><p>アンチエイリアス：なし ／ 600dpi・60線・45度 ／ PNGを画素単位で拡大</p><p>{error??`塗る・消すとも半透明の境界は0画素。350dpiと600dpi、描画中・確定後・PNGを確認（${checks.length}項目）。`}</p><div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:'16px',maxWidth:'1800px'}}>{samples.map(({label,gray},i)=><section><h2 style={{fontSize:'18px'}}>{label}</h2><p>半透明の画素：{gray}</p><div id={`edge-${i}`} style={{width:'100%',aspectRatio:'1',overflow:'hidden',background:'white'}}/></section>)}</div><details><summary>検証の詳細</summary><ul>{checks.map(item=><li>{item}</li>)}</ul></details></main>,document.getElementById('app')!);
 samples.forEach(({canvas:source},i)=>{const cropped=document.createElement('canvas');cropped.width=cropped.height=84;cropped.getContext('2d')!.drawImage(source,75,45,84,84,0,0,84,84);cropped.style.cssText='width:100%;height:100%;image-rendering:pixelated';document.getElementById(`edge-${i}`)!.append(cropped);});
}
