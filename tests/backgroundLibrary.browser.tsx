import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {STORAGE_KEY,toStoredMangaYaml,parseMangaYaml} from '../src/lib/manga';
import {mergeSeriesCatalog} from '../src/lib/seriesCatalog';
import {createProjectSnapshot,restoreProjectSnapshot} from '../src/lib/projectPersistence';
import {deleteFigureCropAssets,collectFigureCropAssetIds,pruneFigureCropAssets,loadFigureCropAsset} from '../src/lib/figureCropStore';
import {cubeGlb} from './background3dFixture.mjs';
import '../src/styles/global.css';
if(location.port!=='4325')throw Error('Dedicated test origin required');
// All series requests stay in this synthetic in-memory store, never the user's library.
let catalog='',revision='',saves=0,loads=0;
const models=new Map<string,string>(),realFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(!url.includes('/api/'))return realFetch(input,init);
 const path=new URL(url,location.href).pathname,body=JSON.parse(String(init?.body??'{}'));
 let result:Record<string,unknown>={};
 if(path==='/api/new-creation/start'||path==='/api/new-creation/stop')return new Response(JSON.stringify({service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1,lease_token:'synthetic-lease',released:true,stopped:true}),{status:200,headers:{'Content-Type':'application/json'}});
 if(path==='/api/health')result={ok:true,service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3};
 else if(path==='/api/series/load')result={found:!!catalog,series_id:'background-library-qa',series_name:'3D背景検証シリーズ',omny_yaml:catalog,revision};
 else if(path==='/api/series/save'){
  if(body.expected_revision!==revision)throw Error('Revision mismatch');
  catalog=body.omny_yaml;revision=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(catalog))),n=>n.toString(16).padStart(2,'0')).join('');
  result={ok:true,series_id:'background-library-qa',directory:'/synthetic-series',revision};
 }else if(path==='/api/series/background-models/save'){
  const key=body.series_id+body.stage.id,created=!models.has(key);models.set(key,body.model_data);saves++;result={ok:true,series_id:body.series_id,stage_id:body.stage.id,created};
 }else if(path==='/api/series/background-models/load'){
  const data=models.get(body.series_id+body.stage_id);if(!body.verify_only)loads++;result={found:!!data,series_id:body.series_id,stage_id:body.stage_id,format:body.format,...(data?body.verify_only?{byte_length:atob(data).length}:{model_data:data}:{})};
 }else if(path==='/api/series/character-text/status')result={linked:false};
 return new Response(JSON.stringify({...result,service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3}),{status:200,headers:{'Content-Type':'application/json'}});
};
const tick=()=>new Promise(resolve=>setTimeout(resolve,100));
const wait=async(predicate:()=>boolean,label:string)=>{for(let i=0;i<120;i++){if(predicate())return;await tick();}throw Error(`Timed out: ${label}`);};
const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(el=>el.getAttribute('aria-label')===name||el.textContent?.trim()===name)!;
const click=async(name:string)=>{const el=button(name);if(!el||el.disabled||el.getAttribute('aria-disabled')==='true')throw Error(`Button unavailable: ${name}`);el.click();await tick();};
const stage=()=>document.querySelector<HTMLSelectElement>('[aria-label="3Dの舞台"]');
const stored=()=>parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
const fill=async(el:HTMLInputElement,value:string)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));await tick();};
const choose=async(el:HTMLSelectElement,value:string)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));await tick();};
const card=()=>document.querySelector<HTMLElement>('.scope-series .material-card')!;
const open3d=async()=>{await click('背景あたりの3Dモデルを配置・調整');await wait(()=>!!stage()&&!button('撮影して線画にする')?.disabled,'3D ready');};
const blank=()=>{const doc=createEmptyWorkspaceDocument();doc.manga.meta.title='背景ライブラリ検証';doc.manga.meta.series='3D背景検証シリーズ';doc.manga.meta.series_id='background-library-qa';doc.manga.meta.episode_id=crypto.randomUUID();doc.manga.finish_settings={width_mm:60,height_mm:60,dpi:100,bleed_mm:0};doc.manga.pages[0].canvas={w:60,h:60,unit:'mm'};doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:5,y:5,w:50,h:50},bg:0,action:null,figures:[],bubbles:[]}];return doc;};
async function run(){
 const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 await click('舞台設定');const add=document.querySelector<HTMLButtonElement>('.scope-series .material-catalog-head button')!;add.click();await tick();
 await fill(card().querySelector<HTMLInputElement>('.field-grid input')!,'仕事部屋');
 const input=card().querySelector<HTMLInputElement>('input[type=file]')!,transfer=new DataTransfer();transfer.items.add(cubeGlb());input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>!!card().querySelector<HTMLSelectElement>('[aria-label="背景の3Dモデル"]')?.value&&!button('舞台設定を保存')?.disabled,'model registration');
 const id=card().querySelector<HTMLSelectElement>('[aria-label="背景の3Dモデル"]')!.value;
 check(card().textContent?.includes('test-cube.glb')===true,'背景カードに元ファイル名を表示');
 await wait(()=>stored().manga.background_stages?.some(stage=>stage.id===id)===true,'registration autosaved');
 const originalId=stored().manga.background_stages!.find(stage=>stage.id===id)!.storageId;await pruneFigureCropAssets([]);
 check(!!await loadFigureCropAsset(originalId),'遅れて実行された一時データ整理でも登録原本を消さない');
 await click('舞台設定を保存');await wait(()=>document.querySelector('.toast')?.textContent==='舞台設定を保存しました','series save');
 check(models.size===1&&saves===1,'登録モデル原本をシリーズ共通へ保存');
 check(parseMangaYaml(catalog).manga.materials.some(m=>m.key==='仕事部屋'&&m.source_stage_id===id),'シリーズ台帳に背景名とモデルの関係を保存');
 await click('ネーム');await open3d();check(Array.from(stage()!.options).some(o=>o.value===id&&o.textContent==='仕事部屋'),'3D画面から登録名で選択できる');
 await choose(stage()!,id);await wait(()=>!button('撮影して線画にする').disabled,'registered scene loaded');
 check(!document.querySelector('[role="alert"]'),'登録したモデルを3Dプレビューへ読み込める');
 await click('舞台設定');await wait(()=>!!card(),'return to setting');
 await fill(card().querySelector<HTMLInputElement>('.field-grid input')!,'仕事部屋・昼');await click('舞台設定を保存');await wait(()=>catalog.includes('仕事部屋・昼'),'rename saved');
 check(saves===1,'名称変更だけなら元モデルを再送しない');
 // A fresh episode with an empty browser cache must work from the series library.
 render(null,document.getElementById('app')!);const before=stored();await deleteFigureCropAssets(collectFigureCropAssetIds(before));
 const next=mergeSeriesCatalog(blank(),parseMangaYaml(catalog)).document;localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(next));render(<App/>,document.getElementById('app')!);await tick();
 await click('舞台設定');check(card().querySelector<HTMLSelectElement>('[aria-label="背景の3Dモデル"]')!.value===id,'別エピソードでも登録背景を引き継ぐ');
 await click('ネーム');await open3d();await choose(stage()!,id);await wait(()=>!button('撮影して線画にする').disabled,'library fallback loaded');
 check(loads===1,'一時キャッシュがなくてもシリーズ原本から復元');
 check(stage()!.selectedOptions[0].textContent==='仕事部屋・昼','背景の名称変更が3Dの選択名へ反映');
 await click('舞台設定');await wait(()=>stored().manga.pages[0].panels[0].background_images?.[0]?.paint?.background3d?.sourceId===id,'camera saved');
 const snap=await createProjectSnapshot(stored()),restored=await restoreProjectSnapshot(snap);
 check(restored.manga.materials.some(m=>m.source_stage_id===id)&&restored.manga.background_stages?.length===1,'作品保存にも登録原本とカードの参照を含める');
 check(restored.manga.pages[0].panels[0].background_images?.[0]?.paint?.background3d?.layerIds.length===0,'登録・選択だけでは撮影画像を勝手に追加しない');
 await choose(card().querySelector<HTMLSelectElement>('[aria-label="背景の3Dモデル"]')!,'');await click('舞台設定を保存');await wait(()=>parseMangaYaml(catalog).manga.materials.some(material=>material.source_stage_id===null),'explicit detach saved');
 check(!parseMangaYaml(catalog).manga.background_stages?.length,'明示的な登録解除はシリーズに反映');
 await choose(card().querySelector<HTMLSelectElement>('[aria-label="背景の3Dモデル"]')!,id);await click('舞台設定を保存');await wait(()=>parseMangaYaml(catalog).manga.background_stages?.length===1,'reattach');
 check(saves===1,'再登録でも保存済み原本を再送しない');
 return checks;
}
localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(blank()));render(<App/>,document.getElementById('app')!);
const report=document.createElement('details');report.style.cssText='position:fixed;bottom:8px;left:175px;z-index:10001;max-width:800px;padding:10px;background:white;border:1px solid #abc;font-size:12px;color:#123';const summary=document.createElement('summary');summary.textContent='背景ライブラリの検証';report.append(summary);const runButton=document.createElement('button');runButton.textContent='背景ライブラリ検証を実行';report.append(runButton);document.body.append(report);
runButton.onclick=()=>{report.open=false;runButton.disabled=true;void run().then(checks=>{summary.textContent=`背景ライブラリ PASS（${checks.length}項目）`;const list=document.createElement('ul');checks.forEach(label=>{const item=document.createElement('li');item.textContent=label;list.append(item);});report.append(list);}).catch(error=>{summary.textContent=`背景ライブラリ FAIL: ${String(error)}`;report.open=true;}).finally(()=>{runButton.disabled=false;});};
