import {newPaintLayer} from '../src/lib/paintDocument';
import {paintPreviewRenderer,renderPaintPng} from '../src/lib/paintRenderer';
import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {STORAGE_KEY,toStoredMangaYaml,parseMangaYaml} from '../src/lib/manga';
import {createPortableProject} from '../src/lib/portableProject';
import {prepareImageAsset,createFrameArtwork} from '../src/lib/imagePlacement';
import {saveFigureCropAssets} from '../src/lib/figureCropStore';
import type {PaintDocument,MangaDocument} from '../src/types';
import '../src/styles/global.css';

if(!['4325','4335'].includes(location.port))throw new Error('Use a dedicated test origin.');
const fixture=createEmptyWorkspaceDocument();fixture.manga.meta.title='レイヤーフォルダー検証';fixture.manga.meta.episode_id='layer-folder-qa';
fixture.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:20,y:30,w:170,h:220},bg:0,action:null,bubbles:[]}];
const nested=new URLSearchParams(location.search).has('nested');
if(!nested){
 const previous=localStorage.getItem(STORAGE_KEY);if(previous&&parseMangaYaml(previous).manga.meta.episode_id!=='layer-folder-qa')throw Error('Do not replace another manuscript');
 localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(fixture));
 render(<App/>,document.getElementById('app')!);
}

const tick=()=>new Promise(resolve=>setTimeout(resolve,100));
const wait=async<T extends Element>(selector:string,root:ParentNode=document)=>{for(let i=0;i<80;i++){const found=root.querySelector<T>(selector);if(found)return found;await tick();}throw new Error(`Missing ${selector}`);};
const byLabel=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button=>button.getAttribute('aria-label')===label);
const waitButton=async(label:string)=>{for(let i=0;i<80;i++){const target=byLabel(label);if(target&&!target.disabled)return target;await tick();}throw new Error(`Button unavailable: ${label}`);};
const click=async(label:string)=>{const target=await waitButton(label);target.click();await tick();};
const drag=async(source:HTMLElement,target:HTMLElement,ratio=.5)=>{
 target.scrollIntoView({block:'center',inline:'nearest'});await tick();
 const a=source.getBoundingClientRect(),b=target.getBoundingClientRect(),pointerId=93,x=a.left+a.width/2,y=a.top+a.height/2,tx=b.left+b.width/2,ty=b.top+b.height*ratio;
 source.dispatchEvent(new PointerEvent('pointerdown',{pointerId,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
 if(!source.classList.contains('is-dragging'))throw new Error('Pointer down did not start the layer drag');
 target.dispatchEvent(new PointerEvent('pointermove',{pointerId,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:tx,clientY:ty,bubbles:true,cancelable:true}));
 if(!source.dataset.dragTarget)throw new Error('Pointer move did not find a layer drop target');
 const release=document.elementFromPoint(tx,ty) as HTMLElement|null;
 (release??target).dispatchEvent(new PointerEvent('pointerup',{pointerId,pointerType:'mouse',isPrimary:true,button:0,buttons:0,clientX:tx,clientY:ty,bubbles:true,cancelable:true}));await tick();
 if(source.classList.contains('is-dragging'))throw new Error(`Pointer up did not finish the layer drag (${source.dataset.dragTarget})`);
};

async function run(){
 const checks:string[]=[];const check=(condition:boolean,label:string)=>{if(!condition)throw new Error(label);checks.push(label);};
 await wait('.page-layer-palette');
 await click('フォルダー追加');
 const direct=await wait<HTMLElement>('.panel-layer-group .layer-direct-root');
 await wait<HTMLElement>('.panel-layer-group .layer-user-folder-row');
 check(!direct.textContent?.includes('コマ直下')&&!direct.textContent?.includes('コマ内'),'レイヤー追加先に合成フォルダー名を表示しない');
 await click('ラスターレイヤー追加');
 let layer=await wait<HTMLElement>('.panel-layer-group .layer-direct-root .layer-row[data-layer]');
 const folder=await wait<HTMLElement>('.panel-layer-group .layer-user-folder-row'),firstId=folder.dataset.folder!;
 const root='.panel-layer-group .layer-direct-root',folders=()=>Array.from(document.querySelectorAll<HTMLElement>(`${root} .layer-user-folder-row`));
 const row=(id:string)=>document.querySelector<HTMLElement>(`${root} [data-folder="${id}"]`)!;
 const order=()=>folders().map(item=>item.dataset.folder).join(',');
 const child=(id:string)=>document.querySelector<HTMLElement>(`${root} [data-layer="${id}"]`)!;
 const layerId=layer.dataset.layer!;
 const regularColor=getComputedStyle(layer).backgroundColor;
 check(!layer.closest('.layer-user-folder-children'),'追加レイヤーは勝手にフォルダーへ入れない');
 await click('フォルダー追加');const secondId=folders().find(item=>item.dataset.folder!==firstId)!.dataset.folder!;
 const originalOrder=order();
 await drag(child(layerId).querySelector<HTMLElement>('.layer-select')!,row(secondId),.5);
 check(child(layerId).closest('.layer-user-folder')?.querySelector<HTMLElement>('[data-folder]')?.dataset.folder===secondId,'空フォルダー中央へのdropで内部へ移す');
 check(order()===originalOrder,'空フォルダーへ入れても隣のフォルダーと順序を交換しない');
 await click('ラスターレイヤー追加');
 const nextLayer=Array.from(document.querySelectorAll<HTMLElement>(`${root} [data-layer]`)).find(item=>item.dataset.layer!==layerId)!,nextId=nextLayer.dataset.layer!;
 await drag(nextLayer.querySelector<HTMLElement>('.layer-select')!,row(secondId),.5);
 await drag(child(layerId).querySelector<HTMLElement>('.layer-select')!,row(secondId),.5);
 const children=()=>Array.from(row(secondId).parentElement!.querySelectorAll<HTMLElement>('[data-layer]')).map(item=>item.dataset.layer);
 check(children()[0]===layerId&&order()===originalOrder,'同じフォルダーへ入れ直すと内部最上段へ移動し、フォルダー順を保つ');
 await drag(child(nextId).querySelector<HTMLElement>('.layer-select')!,row(firstId),.5);
 check(order()===originalOrder,'別フォルダーへの移動でもフォルダー順を保つ');
 await drag(row(firstId).querySelector<HTMLElement>('.layer-folder-select')!,row(secondId),.1);
 check(order()!==originalOrder,'フォルダー自体をドラッグして順序を変更');
 const undo=document.querySelector<HTMLButtonElement>('.app-header [aria-label^="元に戻す"]')!;undo.click();await tick();check(order()===originalOrder,'フォルダー移動を1回のUndoで戻す');
 document.querySelector<HTMLButtonElement>('.app-header [aria-label^="やり直す"]')!.click();await tick();check(order()!==originalOrder,'Redoでフォルダーと中のレイヤーの順序を復元');
 child(layerId).querySelector<HTMLButtonElement>('.layer-select')!.click();await tick();
 check(child(layerId).classList.contains('is-selected')&&row(secondId).classList.contains('is-selected')&&!row(firstId).classList.contains('is-selected'),'子レイヤーと所属フォルダーだけを強調');
 check(document.querySelector('.panel-layer-heading')!.classList.contains('is-selected'),'通常フォルダー内の子から所属コマまで強調');
 row(secondId).querySelector<HTMLButtonElement>('.layer-folder-select')!.click();await tick();
 check(!child(layerId).classList.contains('is-selected'),'フォルダー選択では子レイヤーを選択しない');
 check(getComputedStyle(row(secondId)).backgroundColor===regularColor,'通常フォルダーの選択色はレイヤー行と同じ');
 check(!row(secondId).querySelector('.lucide-trash-2')&&!!row(secondId).querySelector('.layer-row-lock'),'右端は削除ではなくロック');
 row(secondId).querySelector<HTMLButtonElement>('.layer-row-lock')!.click();await tick();
 check(child(layerId).querySelector<HTMLButtonElement>('.layer-row-lock')!.disabled,'親フォルダー固定中は子の解除を禁止');
 row(secondId).querySelector<HTMLButtonElement>('.layer-visibility')!.click();await tick();
 check(row(secondId).querySelector('.layer-visibility')!.getAttribute('aria-pressed')==='false','通常フォルダーに非表示の目がある');
 check(child(layerId).querySelector('.layer-visibility')!.getAttribute('aria-pressed')==='true','フォルダーを隠しても子の目を保持');
 const rootBox=row(secondId).getBoundingClientRect();check(rootBox.width>0,'選択行を表示');
 // Exit the existing paint session to exercise the normal save path.
 await click('コマ 01を選択');
 for(let i=0;i<80;i++){const saved=parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);if(!document.querySelector('.app-shell.is-painting')&&saved.manga.pages[0].panels[0].images?.some(image=>image.paint?.folders?.some(folder=>folder.id===secondId&&folder.visible===false&&folder.locked)))break;await tick();}
 const saved=parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
 const paint=saved.manga.pages[0].panels[0].images?.find(image=>image.paintScope==='panel')?.paint;
 check(paint?.folders?.find(folder=>folder.id===secondId)?.visible===false&&paint.folders.find(folder=>folder.id===secondId)?.locked===true,'表示とロックを通常の保存へ反映');
 check(paint?.layers.find(layer=>layer.id===layerId)?.visible===true,'保存後も子の表示状態を保つ');
 render(null,document.getElementById('app')!);render(<App/>,document.getElementById('app')!);await wait('.page-layer-palette');
 check(row(secondId).querySelector('.layer-visibility')!.getAttribute('aria-pressed')==='false'&&row(secondId).querySelector('.layer-row-lock')!.getAttribute('aria-pressed')==='true','再読込でもフォルダーの目とロックを保持');
 row(secondId).querySelector<HTMLButtonElement>('.layer-visibility')!.click();await tick();
 row(secondId).querySelector<HTMLButtonElement>('.layer-row-lock')!.click();await tick();
 row(secondId).querySelector<HTMLButtonElement>('.layer-folder-select')!.click();await tick();
 const preview=document.createElement('canvas');preview.width=preview.height=16;
 const ink={...newPaintLayer('表示検証'),folderId:'visible-folder',strokes:[{tool:'fill' as const,color:'#ff0000',size:1,points:[{x:0,y:0,pressure:1,time:0}],selection:[{x:0,y:0,w:16,h:16}]}]};
 const paintDoc={version:1 as const,width:16,height:16,dpi:100,layers:[ink],folders:[{id:'visible-folder',name:'表示検証',position:0,visible:true}]};
 const renderer=paintPreviewRenderer();renderer.draw(preview,paintDoc,new Map());const pixel=()=>preview.getContext('2d')!.getImageData(8,8,1,1).data[3];
 check(pixel()===255,'フォルダー内の実pixelが描画される');paintDoc.folders[0].visible=false;renderer.draw(preview,paintDoc,new Map());check(pixel()===0,'フォルダーを隠すと描画pixelも消える');
 paintDoc.folders[0].visible=true;renderer.draw(preview,paintDoc,new Map());check(pixel()===255,'フォルダーを再表示すると元のpixelが戻る');renderer.dispose();
 return checks;
}

// 見込み: 同名の枝を実パレットで入れ子にして、保存→開くと所属・重なり・描画位置を復元する。
// 合格: Undo/Redo、親ID・空の子・葉順と重なった色を照合。LAN版の実Appとブラウザー内の作品ファイルを使い、選択ダイアログのみ検証用のフォルダーに向ける。
async function runNested(){
 const checks:string[]=[];
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const until=async(test:()=>boolean,label:string)=>{for(let i=0;i<100;i++){if(test())return;await tick();}throw Error(label);};
 const originalFetch=window.fetch.bind(window);
 window.fetch=(input,init)=>{
   const url=new URL(input instanceof Request?input.url:String(input),location.href);
   return url.origin===location.origin&&!url.pathname.startsWith('/__nyamuru/')?originalFetch(input,init):Promise.resolve(Response.json({error:'fixture'},{status:503}));
 };
 const storage=await navigator.storage.getDirectory();
 const folder=await storage.getDirectoryHandle('nested-folders-qa',{create:true});
 const file=await folder.getFileHandle('project.json',{create:true});
 Object.assign(window,{showDirectoryPicker:async()=>folder});
 const fill=(id:string,parent:string,color:string,x:number)=>({...newPaintLayer(id),id,folderId:parent,strokes:[{
   tool:'fill' as const,color,size:1,points:[{x,y:5,pressure:1,time:0}],selection:[{x,y:5,w:20,h:18}]
 }]});
 const paint:PaintDocument={version:1,width:96,height:96,dpi:100,guideInitialized:true,
   layers:[fill('red','one','#ff0000',3),fill('blue','two','#0000ff',14)],
   folders:[{id:'one',name:'同名',position:0},{id:'empty',name:'空',parentFolderId:'one',position:1},{id:'two',name:'同名',position:1}]};
 const blob=await renderPaintPng(paint,new Map());
 const asset=await prepareImageAsset(new File([blob],'位置確認.png',{type:'image/png'}));
 await saveFigureCropAssets([{id:asset.storageId,blob}]);
 const doc=createEmptyWorkspaceDocument(),frame={x:12,y:17,w:60,h:60};
 doc.manga.meta.episode_id='nested-folder-qa';doc.manga.meta.title='入れ子確認';
 doc.manga.finish_settings={width_mm:120,height_mm:120,dpi:100,bleed_mm:0};
 doc.manga.pages[0].canvas={w:120,h:120,unit:'mm'};
 doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',...frame},action:null,bg:0,bubbles:[],
   images:[{...createFrameArtwork(asset,frame),paint,paintScope:'panel'}]}];
 doc.manga.image_assets=[asset];
 const writer=await file.createWritable();await writer.write(JSON.stringify(await createPortableProject(doc)));await writer.close();
 const host=document.getElementById('app')!;
 const open=async()=>{
   render(null,host);render(<App/>,host);
   const openButton=()=>Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()==='作品フォルダを開く'&&!b.disabled);
   await until(()=>!!openButton(),'作品フォルダを開く');openButton()!.click();
   await until(()=>!!host.querySelector('.panel-layer-heading')&&!!host.querySelector('.toast')?.textContent?.includes('読み込みました'),'作品読込完了');
   host.querySelector<HTMLButtonElement>('.panel-layer-heading button[aria-expanded="false"]')?.click();
   await wait('[data-folder="two"]',host);
 };
 const row=(id:string)=>host.querySelector<HTMLElement>('[data-folder="'+id+'"]')!;
 const parent=(id:string)=>row(id)?.parentElement?.parentElement?.closest('.layer-user-folder')?.querySelector<HTMLElement>('[data-folder]')?.dataset.folder;
 const readFile=async()=>JSON.parse(await(await file.getFile()).text()).snapshot.document as MangaDocument;
 const save=async()=>{
   const button=await wait<HTMLButtonElement>('[data-project-save]',host);
   button.click();await tick();await until(()=>!button.disabled,'作品保存完了');
   return readFile();
 };
 function verify(doc:MangaDocument,isNested:boolean){
   const image=doc.manga.pages[0].panels[0].images!.find(item=>item.paint?.layers.some(l=>l.id==='red'))!;
   const actual=image.paint!;
   check(actual.folders?.find(f=>f.id==='one')?.parentFolderId===(isNested?'two':undefined),'保存した直接の親が一致');
   check(actual.folders?.find(f=>f.id==='empty')?.parentFolderId==='one','空フォルダーの所属を保持');
   check(actual.layers.map(l=>l.id).join(',')===(isNested?'blue,red':'red,blue'),'描画順が一致');
   // Compare in paper coordinates: paint owners may gain a working bleed.
   for(const l of actual.layers){
     const original=paint.layers.find(item=>item.id===l.id)!;
     const point=l.strokes[0].points[0],before=original.strokes[0].points[0];
     check(Math.abs(image.bbox.x+point.x*image.bbox.w/actual.width-(frame.x+before.x*frame.w/paint.width))<.01
       &&Math.abs(image.bbox.y+point.y*image.bbox.h/actual.height-(frame.y+before.y*frame.h/paint.height))<.01,'紙面上の描画位置を保持');
   }
   const canvas=document.createElement('canvas');canvas.width=actual.width;canvas.height=actual.height;
   const renderer=paintPreviewRenderer();renderer.draw(canvas,actual,new Map());
   const pixel=(x:number)=>{const px=Math.floor((frame.x+x*frame.w/paint.width-image.bbox.x)*actual.width/image.bbox.w);
     const py=Math.floor((frame.y+10*frame.h/paint.height-image.bbox.y)*actual.height/image.bbox.h);
     return [...canvas.getContext('2d')!.getImageData(px,py,1,1).data].join(',');};
   check(pixel(8)==='255,0,0,255'&&pixel(28)==='0,0,255,255'&&pixel(18)===(isNested?'255,0,0,255':'0,0,255,255'),'重なる部分と左右の描画色が一致');
   renderer.dispose();
 }
 await open();
 verify(await readFile(),false);
 await drag(row('one').querySelector<HTMLElement>('.layer-folder-select')!,row('two'),.5);
 await until(()=>parent('one')==='two','片方の同名フォルダーをもう一方へ入れる');
 const undo=await wait<HTMLButtonElement>('.app-header [aria-label^="元に戻す"]',host);
 undo.click();await until(()=>!parent('one'),'ドラッグを1回のUndoで戻す');
 verify(await save(),false);
 const redo=await wait<HTMLButtonElement>('.app-header [aria-label^="やり直す"]',host);
 redo.click();await until(()=>parent('one')==='two','Redoで枝を復元');
 verify(await save(),true);
 await open();
 check(parent('one')==='two'&&parent('empty')==='one','作品を閉じて実ファイルを開き直し、二段の入れ子を復元');
 check([...row('two').parentElement!.querySelectorAll<HTMLElement>('[data-layer]')].map(el=>el.dataset.layer).join(',')==='red,blue','再読込後のパレットは描画順の逆');
 verify(await save(),true);
 await drag(row('one').querySelector<HTMLElement>('.layer-folder-select')!,row('two'),.9);
 await until(()=>!parent('one'),'親の外へ戻す');
 verify(await save(),false);
 return checks;
}

const report=document.createElement('details');report.open=true;report.style.cssText='position:fixed;bottom:10px;left:170px;z-index:10001;max-width:620px;padding:8px 12px;background:#fff;border:1px solid #acb6b2;font-size:12px;color:#17231d';
const summary=document.createElement('summary'),button=document.createElement('button'),output=document.createElement('ol');summary.textContent='レイヤーフォルダー操作の検証';button.textContent='実行';button.onclick=()=>{button.disabled=true;(nested?runNested():run()).then(checks=>{summary.textContent=`レイヤーフォルダー操作 PASS（${checks.length}項目）`;for(const item of checks){const li=document.createElement('li');li.textContent=item;output.append(li);}}).catch(error=>{summary.textContent='レイヤーフォルダー操作 FAIL';const li=document.createElement('li');li.textContent=String(error?.stack??error);output.append(li);}).finally(()=>button.disabled=false);};report.append(summary,button,output);document.body.append(report);
