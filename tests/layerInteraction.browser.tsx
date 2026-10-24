// Use a dedicated localhost origin: this fixture seeds only its own browser storage.
import { render } from 'preact';
import {renderPaintPng,decodePaintImage,paintPreviewRenderer} from '../src/lib/paintRenderer';
import {newPaintLayer} from '../src/lib/paintDocument';
import {newToneLayer} from '../src/lib/paintTone';
import type {PaintDocument} from '../src/types';
import App from '../src/components/App';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { STORAGE_KEY, toStoredMangaYaml } from '../src/lib/manga';
import '../src/styles/global.css';
if(location.port!=='4325')throw new Error('This fixture requires the dedicated test origin on port 4325.');
if(!localStorage.getItem(STORAGE_KEY)){
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
 screen.dispose();
 return checks;
}
if(new URLSearchParams(location.search).has('render-check')){
 rendererChecks().then(checks=>render(<main><h1>描画検証 PASS</h1><ul>{checks.map(item=><li>{item}</li>)}</ul></main>,document.getElementById('app')!)).catch(error=>render(<main><h1>描画検証 FAIL</h1><pre>{String(error)}</pre></main>,document.getElementById('app')!));
}else render(<App/>,document.getElementById('app')!);
