/// <reference types="vite/client" />
// 見込み: 実Appの作品・履歴が画像を保持し、参照消滅で回収する。合格: 下記条件と画像表示が一致。
// 範囲: 実ブラウザーの画面・取込・履歴・Blobストア。起動文書/資料は合成、外部APIは遮断。OSのGC量は測らない。
import {render} from 'preact';
import App from '../src/components/App';
import {panelTestDocument} from './fixtures/emptyTestDocument';
import {beginFigureCropImport,loadFigureCropAsset} from '../src/lib/figureCropStore';
// @ts-expect-error Export exists only in the dedicated Vite observer.
import {retentionStoreSnapshot} from '../src/lib/figureCropStore';
import {rememberBrowserCatalog,listBrowserCatalogs,characterImageCacheId,browserCatalogImageIds} from '../src/lib/browserCatalog';
import {saveCharacterReferenceImage} from '../src/lib/localBridge';
import {saveHistorySteps} from '../src/lib/historyPreferences';
import type {MangaDocument} from '../src/types';
import '../src/styles/global.css';

if(location.origin!=='http://127.0.0.1:4347')throw Error('Dedicated retention test origin required');
type Workspace={document:MangaDocument;past:{document:MangaDocument}[];future:{document:MangaDocument}[]};
type Fixture={document:MangaDocument;workspace?:()=>Workspace;prune?:()=>void;afterStore:(items:{id:string}[])=>Promise<void>};
declare global{interface Window{__retentionFixture:Fixture}}
const doc=panelTestDocument();doc.manga.meta.title='画像保持の実画面検証';doc.manga.meta.episode_id='retention-ui';
doc.manga.pages[0].panels[0].bubbles=[];
let pauseNext=false,resume:(()=>void)|undefined,pausedIds:string[]=[];
window.__retentionFixture={document:doc,afterStore:async items=>{
  if(!pauseNext)return;pauseNext=false;pausedIds=items.map(item=>item.id);
  await new Promise<void>(resolve=>{resume=resolve;});resume=undefined;pausedIds=[];
}};
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.origin);
  if(url.origin===location.origin&&!url.pathname.startsWith('/__nyamuru/'))return originalFetch(input,init);
  return Response.json({error:'画像保持検証：外部サービスを呼びません'},{status:403});
};
saveHistorySteps(localStorage,3);
const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
const context=canvas.getContext('2d')!;context.fillStyle='#e8ad37';context.fillRect(0,0,64,64);context.fillStyle='#344f75';context.fillRect(16,16,32,32);
const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
const catalog=panelTestDocument();catalog.manga.meta.series='保持確認の資料';catalog.manga.meta.series_id='retention-series';
catalog.manga.characters=[{localId:'retention-person',catalog_id:'retention-person',name:'資料の人物',role:'',scope:'series'}];
const finish=beginFigureCropImport();
let referenceId='';
try{
  const saved=await saveCharacterReferenceImage(blob,'資料確認.png','retention-series','retention-person');
  referenceId=characterImageCacheId('retention-series','retention-person',saved.sourceImage.asset_id);
  catalog.manga.materials=[{key:'資料確認',type:'character',scope:'series',keywords:[],characterId:'retention-person',character_catalog_id:'retention-person',catalog_id:'retention-material',source_image:saved.sourceImage}];
  await rememberBrowserCatalog(catalog);
}finally{finish();}
render(<App/>,document.getElementById('app')!);
const panel=document.createElement('details');panel.open=true;
panel.style.cssText='position:fixed;bottom:10px;left:12px;z-index:20000;width:480px;max-height:46vh;overflow:auto;padding:8px;background:#fffefa;border:2px solid #436d7b;color:#142a32;font:12px/1.45 monospace;box-shadow:0 2px 8px #0004';
const title=document.createElement('summary');title.textContent='画像保持の観測（専用検証画面）';panel.append(title);
const addButton=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.onclick=action;b.style.margin='4px';panel.append(b);};
addButton('次の画像保存を一時停止',()=>{pauseNext=true;});
addButton('保存を再開',()=>resume?.());
addButton('現在の参照で回収を要求',()=>window.__retentionFixture.prune?.());
const output=document.createElement('pre');output.id='retention-observation';output.style.whiteSpace='pre-wrap';panel.append(output);
const preview=document.createElement('img');preview.alt='資料一覧だけが保持する画像';preview.width=preview.height=48;panel.append(preview);
const expectation=document.createElement('p');expectation.textContent='合格条件: 削除後もUndo/Redoで保持。Redo破棄/履歴上限後は不要画像0。取込停止中は回収0。資料一覧の1枚は保持。';panel.append(expectation);
document.body.append(panel);
const names=new Map<string,string>();let oldPreview: string|undefined;
setInterval(async()=>{
  const w=window.__retentionFixture.workspace?.();if(!w)return;
  for(const d of [w.document,...w.past.map(s=>s.document),...w.future.map(s=>s.document)])for(const a of d.manga.image_assets??[])names.set(a.storageId,a.originalName);
  const snapshot=retentionStoreSnapshot() as {importing:number;assets:{id:string;bytes:number}[]};
  const catalogs=await listBrowserCatalogs(),refs=browserCatalogImageIds(),stored=await loadFigureCropAsset(referenceId);
  if(stored&&!oldPreview){oldPreview=URL.createObjectURL(stored);preview.src=oldPreview;}
  if(!stored&&oldPreview){URL.revokeObjectURL(oldPreview);oldPreview=undefined;preview.removeAttribute('src');}
  output.textContent=JSON.stringify({currentImages:w.document.manga.pages.reduce((sum,p)=>sum+(p.images?.length??0),0),undo:w.past.length,redo:w.future.length,importing:snapshot.importing,pauseArmed:pauseNext,paused:pausedIds.length,stored:snapshot.assets.length,bytes:snapshot.assets.reduce((sum,a)=>sum+a.bytes,0),images:snapshot.assets.map(a=>({name:a.id===referenceId?'資料確認.png':names.get(a.id)??'取込途中',bytes:a.bytes})),catalogs:catalogs.map(c=>c.seriesName),catalogRefs:refs.length,catalogImage:!!stored},null,1);
},150);
