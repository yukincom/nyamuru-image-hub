// 見込み: 2枚の現在の画素を既存の仕上げツールから処理すると、原稿に各1個の結果を追加できる。
// 範囲: 合成原稿を実Appで開き、実LAN gatewayとMangaScreenを呼ぶ。印刷品質・3枚参照モデルは別確認。
import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {createPortableProject} from '../src/lib/portableProject';
import {prepareImageAsset,createFrameArtwork,imageCrop} from '../src/lib/imagePlacement';
import {saveFigureCropAssets} from '../src/lib/figureCropStore';
import {newPaintLayer} from '../src/lib/paintDocument';
import {renderPaintPng,decodePaintImage} from '../src/lib/paintRenderer';
import type {MangaDocument,PaintDocument} from '../src/types';
import '../src/styles/global.css';

const report=document.querySelector<HTMLOutputElement>('#result')!;
const host=document.querySelector<HTMLElement>('#app')!;
const wait=async<T,>(probe:()=>T|undefined|null|false|Promise<T|undefined|null|false>,label:string):Promise<T>=>{
  for(let i=0;i<600;i++){const found=await probe();if(found)return found;await new Promise(resolve=>setTimeout(resolve,100));}
  throw Error(label+' / '+(document.querySelector('dialog [role=alert],.paint-error')?.textContent??''));
};
const button=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>!b.disabled&&(b.getAttribute('aria-label')===label||b.textContent?.trim()===label));
const click=async(label:string)=>(await wait(()=>button(label),label)).click();
const row=(id:string)=>host.querySelector<HTMLElement>('[data-layer="'+id+'"]');
const groups=()=>[...host.querySelectorAll('.layer-user-folder-row')].filter(el=>el.textContent?.includes('仕上げ✨'));
function check(ok:unknown,label:string){if(!ok)throw Error(label);}

// 単独選択では1枚だけが表示され、再選択なしで実処理できる。Shift選択では2枚を処理し、適用時に陰影のトーン設定が出る。
// 実Appの合成原稿で、取消し・Undo/Redo・再読込後の原画像と親順も確認する。
async function run(){
  if(location.hostname!=='127.0.0.1'||location.port!=='4346')throw Error('専用の tests/lanEditing.vite.mjs を使ってください');
  const folder=await (await navigator.storage.getDirectory()).getDirectoryHandle('manga-finish-qa',{create:true});
  Object.assign(window,{showDirectoryPicker:async()=>folder});
  const file=await folder.getFileHandle('project.json',{create:true});
  const canvas=document.createElement('canvas');canvas.width=80;canvas.height=64;
  const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#fff';ctx.fillRect(2,2,75,58);ctx.fillStyle='#888';ctx.fillRect(15,12,40,28);ctx.strokeStyle='#111';ctx.lineWidth=2;ctx.strokeRect(15,12,40,28);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!)));
  const asset=await prepareImageAsset(new File([blob],'ネーム.png',{type:'image/png'}));
  const original={...newPaintLayer('読み込み'),id:'imported',image:{assetId:asset.id,crop:imageCrop(asset),bbox:{x:3,y:2,w:80,h:64}}};
  const name={...original,id:'name',name:'ネーム原画',guide:true,locked:true,strokes:[{tool:'line' as const,color:'#101010',size:2,points:[{x:12,y:4,pressure:1,time:0},{x:70,y:34,pressure:1,time:5}]}]};
  const paint:PaintDocument={version:1,width:96,height:80,dpi:100,guideInitialized:true,layers:[original,{...newPaintLayer('間の絵'),id:'between'},name]};
  const img=await decodePaintImage(blob);
  const composite=await renderPaintPng(paint,new Map([[asset.id,img]]));img.src='';
  const compositeAsset=await prepareImageAsset(new File([composite],'コマ.png',{type:'image/png'}));
  await saveFigureCropAssets([{id:asset.storageId,blob},{id:compositeAsset.storageId,blob:composite}]);
  const doc=createEmptyWorkspaceDocument(),frame={x:12,y:15,w:24.384,h:20.32};
  doc.manga.meta.title='漫画仕上げ試験';doc.manga.meta.episode_id='manga-finish-qa';
  doc.manga.finish_settings={width_mm:120,height_mm:120,dpi:100,bleed_mm:0};
  doc.manga.pages[0].canvas={w:120,h:120,unit:'mm'};
  doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',...frame},action:null,bg:0,bubbles:[],images:[{...createFrameArtwork(compositeAsset,frame),paint,paintScope:'panel'}]}];
  doc.manga.image_assets=[asset,compositeAsset];
  const writer=await file.createWritable();await writer.write(JSON.stringify(await createPortableProject(doc)));await writer.close();
  const open=async()=>{
    render(null,host);render(<App/>,host);await click('作品フォルダを開く');
    await wait(()=>host.querySelector('.toast')?.textContent?.includes('読み込みました'),'作品を開く');
    host.querySelector<HTMLButtonElement>('.panel-layer-heading button[aria-expanded="false"]')?.click();
    await wait(()=>row('imported'),'読み込みレイヤー');
  };
  await open();row('imported')!.querySelector<HTMLButtonElement>('.layer-select')!.click();
  await wait(()=>row('imported')?.classList.contains('is-selected'),'描画セッション');
  await click('漫画仕上げ');
  const dialog=await wait(()=>document.querySelector('dialog[open]'),'単独選択の仕上げ');
  check(!dialog.querySelector('input[type=checkbox]') && !dialog.textContent?.includes('ネーム原画') && dialog.textContent?.includes('読み込み'),'選択していない原画が候補に出た');
  await click('仕上げを試す');await wait(()=>button('原稿に適用'),'単独の比較');
  check(!dialog.querySelector('[aria-label="比較するレイヤー"]'),'単独選択で複数の結果が作られた');
  await click('キャンセル');await wait(()=>!document.querySelector('dialog[open]'),'単独の取消し');
  row('name')!.querySelector('button.layer-select')!.dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));
  await wait(()=>row('name')?.classList.contains('is-selected'),'Shift複数選択');
  await click('漫画仕上げ');
  await wait(()=>document.querySelector('.manga-finish-target')?.textContent?.includes('読み込み') &&
    document.querySelector('.manga-finish-target')?.textContent?.includes('ネーム原画'),'同一コマのShift選択を継承');
  await click('仕上げを試す');await wait(()=>button('原稿に適用'),'実MangaScreenの比較');
  check(groups().length===0,'比較中に原稿を変更した');
  await click('キャンセル');await wait(()=>!document.querySelector('dialog[open]'),'取消しで閉じる');check(groups().length===0,'取消しで原稿を変更した');
  await click('漫画仕上げ');await click('仕上げを試す');await click('原稿に適用');
  await wait(()=>groups().length===2,'2フォルダー');
  await wait(()=>host.querySelector('.layer-row.is-selected [data-tool-label="陰影"]') &&
    host.querySelector('select[aria-label="トーンの線数"]:enabled') &&
    host.querySelector('select[aria-label="トーンの濃度方式"]:enabled'),'陰影を選択して線数と濃度を表示');
  host.querySelector<HTMLButtonElement>('.app-header [aria-label^="元に戻す"]')!.click();
  await wait(()=>groups().length===0,'一括Undo');
  host.querySelector<HTMLButtonElement>('.app-header [aria-label^="やり直す"]')!.click();
  await wait(()=>groups().length===2,'一括Redo');
  host.querySelector<HTMLButtonElement>('[data-project-save]')!.click();
  const saved=await wait(async()=>{ // Check the actual browser-managed project file after save.
    const value=JSON.parse(await(await file.getFile()).text()).snapshot.document as MangaDocument;
    return value.manga.pages[0].panels[0].images?.find(item=>item.paint?.folders?.length===2)?.paint;
  },'仕上げ済み作品ファイル');
  const sources=saved.layers.filter(l=>['imported','name','between'].includes(l.id));
  check(sources.map(l=>l.id).join(',')==='imported,between,name','入力の順序');
  check(sources[0].visible===false&&sources[2].visible===false&&sources[2].locked&&sources[2].strokes.length===1,'原画像と手描きの保持');
  check(sources[0].image?.assetId===asset.id&&sources[2].image?.assetId===asset.id,'元のPNG参照を保持');
  await open();check(groups().length===2,'保存したフォルダーを再表示');
}
void run().then(()=>{report.textContent='PASS';}).catch(e=>{report.textContent='FAIL '+String(e?.stack??e);});
