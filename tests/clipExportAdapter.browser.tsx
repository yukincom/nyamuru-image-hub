// 見込み: 異なる種類の層を個別に変換すれば、表示と編集原本を作品変更なしで保持できる。
// 範囲: 合成原稿と実Canvas/DOM/asset読出。CLIPバイナリ化・CSP画面・実作品は親側で別確認。
import { buildClipExportPage, type ClipExportLayer, type ClipExportRaster } from '../src/lib/clipExport';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { newPaintLayer } from '../src/lib/paintDocument';
import { defaultVectorStyle } from '../src/lib/vectorGeometry';
import { saveFigureCropAssets, loadFigureCropAsset, deleteFigureCropAssets } from '../src/lib/figureCropStore';
import { imageSha256, validateImagePlacements } from '../src/lib/imagePlacement';
import type { PaintDocument, PlacedImage } from '../src/types';

const report=document.querySelector<HTMLOutputElement>('#report')!,details=document.querySelector('#details')!;
let count=0;const checks:string[]=[];
function check(value:unknown,message:string){if(!value)throw Error(message);count++;checks.push(message);}
function flatten(layers:ClipExportLayer[]):ClipExportLayer[]{return layers.flatMap(layer=>[layer,...(layer.kind==='folder'?flatten(layer.children):[])]);}
async function pixels(png:string){const image=new Image();image.src=png;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const result=ctx.getImageData(0,0,canvas.width,canvas.height);image.src='';canvas.width=canvas.height=1;return result;}
function freeze(value:object){Object.values(value).forEach(item=>{if(item&&typeof item==='object')freeze(item);});Object.freeze(value);}

async function run(){
  count=0;checks.length=0;
  const source=createEmptyWorkspaceDocument(),manga=source.manga;
  manga.meta.title='CLIP保持確認';manga.finish_settings={width_mm:50.8,height_mm:50.8,dpi:100,bleed_mm:0};
  const surface=document.createElement('canvas');surface.width=surface.height=8;const ctx=surface.getContext('2d')!;
  const data=new ImageData(8,8);for(let i=0;i<data.data.length;i+=4)data.data.set([200,30,20,128],i);ctx.putImageData(data,0,0);
  const blob=await new Promise<Blob>(resolve=>surface.toBlob(value=>resolve(value!),'image/png'));surface.width=surface.height=1;
  const storageId=`clip-adapter-qa-${Date.now()}`;await saveFigureCropAssets([{id:storageId,blob}]);
  const originalBytes=[...new Uint8Array(await blob.arrayBuffer())];
  manga.image_assets=[{id:'alpha-source',storageId,originalName:'透過原画.png',mediaType:'image/png',widthPx:8,heightPx:8,byteLength:blob.size,sha256:await imageSha256(blob)}];
  surface.width=surface.height=32;
  const previewBlob=await new Promise<Blob>(resolve=>surface.toBlob(value=>resolve(value!),'image/png'));
  await saveFigureCropAssets([{id:`${storageId}-preview`,blob:previewBlob}]);surface.width=surface.height=1;
  manga.image_assets.push({id:'paint-preview',storageId:`${storageId}-preview`,originalName:'描画プレビュー.png',mediaType:'image/png',widthPx:32,heightPx:32,byteLength:previewBlob.size,sha256:await imageSha256(previewBlob)});
  const emptyBlob=await new Promise<Blob>(resolve=>surface.toBlob(value=>resolve(value!),'image/png'));
  await saveFigureCropAssets([{id:`${storageId}-empty`,blob:emptyBlob}]);
  manga.image_assets.push({id:'no-preview',storageId:`${storageId}-empty`,originalName:'空の描画.png',mediaType:'image/png',widthPx:1,heightPx:1,byteLength:emptyBlob.size,sha256:await imageSha256(emptyBlob)});
  const raster={...newPaintLayer('半透明の原画'),id:'raster',opacity:.4,blend:'multiply' as const,folderId:'group',image:{assetId:'alpha-source',crop:{x:0,y:0,w:8,h:8},bbox:{x:0,y:0,w:16,h:16}},mask:{enabled:true,reveal:true,strokes:[{tool:'eraser' as const,color:null,size:8,points:[{x:0,y:0,pressure:1,time:0},{x:8,y:8,pressure:1,time:1}]}]},clip:{x:0,y:0,w:24,h:24}};
  const vector={...newPaintLayer('編集できる線','vector'),id:'vector',folderId:'group',paths:[{id:'curve',closed:false,style:{...defaultVectorStyle(),stroke:'#2244cc',width:2},nodes:[{x:2,y:20,handleOut:{x:5,y:12}},{x:28,y:20,handleIn:{x:-5,y:12}}]}]};
  const mixed={...newPaintLayer('塗りつき線','vector'),id:'mixed',paths:[{id:'fill',closed:true,style:{...defaultVectorStyle(),fill:'#ffeedd',width:1},nodes:[{x:20,y:2},{x:28,y:2},{x:28,y:10}]}]};
  const marker={...newPaintLayer('生成範囲'),id:'marker',generationMask:true,strokes:[{tool:'rectangle' as const,color:'#00ff00',fill:'#00ff00',size:1,points:[{x:0,y:0,pressure:1,time:0},{x:32,y:32,pressure:1,time:1}]}]};
  const paint:PaintDocument={version:1,width:32,height:32,dpi:72,guideInitialized:true,referenceFrame:{x:0,y:0,w:32,h:32},layers:[raster,vector,mixed,marker],folders:[{id:'group',name:'作画グループ',position:0,visible:false,locked:true},{id:'empty',name:'空のフォルダー',position:4}]};
  const placement:PlacedImage={id:'art',assetId:'paint-preview',crop:{x:0,y:0,w:32,h:32},bbox:{x:5.08,y:5.08,w:16.256,h:16.256},opacity:.8,hidden:false,locked:true,paintScope:'panel',paint};
  const empty=(id:string):PlacedImage=>({id,assetId:'no-preview',crop:{x:0,y:0,w:1,h:1},bbox:{x:0,y:0,w:50.8,h:50.8},opacity:1,hidden:false,locked:false,paint:{version:1,width:1,height:1,dpi:100,guideInitialized:true,layers:[]}});
  manga.pages=[{page:1,canvas:{w:50.8,h:50.8,unit:'mm'},panels:[
    {id:1,shape:{type:'rect',x:0,y:0,w:50.8,h:50.8},bg:0,action:null,background_images:[empty('bg')],images:[placement],
      bubbles:[{text:'確認\nA😀',shape:'normal',bbox:{x:27,y:5,w:17,h:20},nativeLocked:true,text_style:{fontSize:9,orientation:'vertical',fontWeight:600}}],
      screen_text:[{text:'部分書式',bbox:{x:27,y:30,w:20,h:10},text_style:{fontSize:8,orientation:'horizontal'},text_runs:[{start:0,end:2,underline:true}]}]},
    {id:2,shape:{type:'rect',x:35,y:35,w:12,h:12},bg:0,action:null,background_images:[empty('empty-bg')],bubbles:[],layer:{hidden:true,locked:true}},
  ]}];
  validateImagePlacements(source);
  const before=JSON.stringify(source);freeze(source);
  try{
    const result=await buildClipExportPage(manga,0),all=flatten(result.layers),find=(id:string)=>{const layer=all.find(layer=>layer.id===id);if(!layer)throw Error(`missing ${id}`);return layer;};
    // 見込み: 終始読み出しだけなら元原稿とassetが不変。合格: deep freeze下で成功し、全文と元byteが一致。
    check(JSON.stringify(source)===before,'原稿全体を変更しない');check(await loadFigureCropAsset(storageId)===blob,'元assetの参照を置き換えない');
    check(result.width===200&&result.height===200&&result.dpi===100,'用紙寸法とdpiを保持');
    check(new Set(all.map(layer=>layer.id)).size===all.length,'レイヤーIDが重複しない');
    check(all.every(layer=>typeof layer.visible==='boolean'&&typeof layer.locked==='boolean'),'表示とロックを明示する');
    const group=find('panel-0/direct-art/folder-group');check(group.kind==='folder'&&group.visible===false&&group.locked,'非表示フォルダーとロックを保持');
    check(find('panel-0/direct-art/folder-empty').kind==='folder','空フォルダーを残す');
    check(find('panel-1/作画').visible===false&&find('panel-1/作画').locked,'非表示コマを層として保持');
    check(result.layers.findIndex(layer=>layer.id==='panel-0/frame')>result.layers.findIndex(layer=>layer.id==='panel-1/作画'),'全作画の上にコマ枠を保つ');
    // 見込み: 画像とmask・opacityを分離すれば半透明画素に二重適用しない。合格: 原画alpha128・層.4・mask透明部分が独立。
    const raw=find('panel-0/direct-art/raster');check(raw.kind==='raster'&&raw.opacity===.4&&raw.blend==='multiply','画像の層opacityと乗算を保持');
    const rawPixels=await pixels((raw as ClipExportRaster).png),alphas=rawPixels.data.filter((_,i)=>i%4===3);
    check(Math.max(...alphas)===128,'半透明画素をopacityで焼かない');check(raw.mask,'レイヤーマスクを別面にする');
    const coverage=await pixels(raw.mask!.png);check(coverage.data.some((a,i)=>i%4===3&&a===0)&&coverage.data.some((a,i)=>i%4===3&&a===255),'maskの透明部と不透明部を保持');
    const originals=all.flatMap(layer=>layer.sources??[]).filter(source=>source.kind==='original-image');check(originals.length===1,'同じ元画像を一度だけ同梱');
    check(JSON.stringify([...new Uint8Array(await (await fetch(originals[0].data)).arrayBuffer())])===JSON.stringify(originalBytes),'元画像の全byteを保持');
    const paintSource=all.flatMap(layer=>layer.sources??[]).find(source=>source.name.endsWith('-document.json')&&JSON.parse(source.data).paint?.width===32);
    check(paintSource&&JSON.stringify(JSON.parse(paintSource.data).paint)===JSON.stringify(paint),'元paint全文と曲線handleを保存');
    // 見込み: 基本文字/線はnativeで、特殊表現は表示画像と非表示編集層へ分ける。合格: 各kind、可視状態、本文と書式を保持。
    const line=find('panel-0/direct-art/vector');check(line.kind==='vector'&&line.lines.length===1&&line.lines[0].points.length>2,'単純曲線を編集線にする');
    check(line.kind==='vector'&&JSON.stringify(line.lines[0].color)==='[34,68,204]','編集線の色を保持');
    const filled=find('panel-0/direct-art/mixed');check(filled.kind==='folder'&&filled.children.some(layer=>layer.kind==='raster'&&layer.visible)&&filled.children.some(layer=>layer.kind==='vector'&&!layer.visible),'塗り線は表示と編集線を両方保持');
    check(find('panel-0/direct-art/marker').visible===false,'生成範囲を原稿表示へ重ねない');
    const text=find('panel-0/bubble-0/text');check(text.kind==='text'&&text.visible&&text.locked,'基本文字を表示して編集可能にする');
    check(text.kind==='text'&&text.text==='確認\nA😀'&&text.vertical&&text.fontSizePt===9,'本文と縦書きとptを保持');
    check(text.kind==='text'&&text.frame.every(Number.isInteger)&&text.frame[2]>text.frame[0]&&text.frame[3]>text.frame[1],'文字位置を有効な整数pixelへ変換');
    const rich=find('panel-0/screen-0');check(rich.kind==='folder'&&rich.children.some(layer=>layer.kind==='raster'&&layer.visible)&&rich.children.some(layer=>layer.kind==='text'&&!layer.visible),'部分書式は表示画像と編集文字を保持');
    check(find('panel-0/bubble-0/shape').sources?.some(source=>source.kind==='svg'),'フキダシ形のSVGを保存');
    check(['部分書式','ベクター','生成範囲'].every(text=>result.warnings.some(warning=>warning.includes(text))),'特殊表現と作業層の変換を説明する');
    check(text.kind==='text'&&text.font?.name!==manga.meta.font&&Boolean(text.font?.postscript),'semantic書体を実際に描画できるファミリー名へ解決');
    const preview=await pixels(result.preview!);check(preview.width===200&&preview.height===200,'小型合成previewを作る');
    check(preview.data.some((value,i)=>i%4!==3&&value<240),'previewに文字と描画がある');
    const image=new Image();image.src=result.preview!;document.querySelector('#preview')!.replaceChildren(image);
    const download=document.querySelector<HTMLAnchorElement>('#download')!;download.href=URL.createObjectURL(new Blob([JSON.stringify(result)],{type:'application/json'}));download.download='clip-adapter-fixture.json';download.hidden=false;
    details.textContent=checks.join('\n');report.textContent=`PASS ${count}項目`;report.dataset.stage='done';
  }finally{await deleteFigureCropAssets([storageId,`${storageId}-preview`,`${storageId}-empty`]);}
}
document.querySelector<HTMLButtonElement>('#run')!.onclick=()=>{report.textContent='実行中';report.dataset.stage='running';void run().catch(error=>{report.textContent=`FAIL ${String(error)}`;details.textContent=error.stack??String(error);report.dataset.stage='done';console.error(error);});};
