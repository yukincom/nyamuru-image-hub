import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {STORAGE_KEY,toStoredMangaYaml} from '../src/lib/manga';
import '../src/styles/global.css';

if(location.port!=='4325')throw new Error('This fixture requires the dedicated test origin on port 4325.');
const fixture=createEmptyWorkspaceDocument();fixture.manga.meta.title='レイヤーフォルダー検証';fixture.manga.meta.episode_id='layer-folder-qa';
fixture.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:20,y:30,w:170,h:220},bg:0,action:null,bubbles:[]}];
localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(fixture));
render(<App/>,document.getElementById('app')!);

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
 await click('コマ内へフォルダーを追加');
 const direct=await wait<HTMLElement>('.panel-layer-group .layer-direct-root');
 await wait<HTMLElement>('.panel-layer-group .layer-user-folder-row');
 check(!direct.textContent?.includes('コマ直下')&&!direct.textContent?.includes('コマ内'),'レイヤー追加先に合成フォルダー名を表示しない');
 await click('ラスターレイヤー追加');
 let layer=await wait<HTMLElement>('.panel-layer-group .layer-direct-root .layer-row[data-layer]');
 const folder=await wait<HTMLElement>('.panel-layer-group .layer-user-folder-row');
 check(!layer.closest('.layer-user-folder-children'),'追加レイヤーは勝手にフォルダーへ入れない');
 await drag(layer.querySelector<HTMLElement>('.layer-select')!,folder,.5);
 layer=await wait<HTMLElement>('.panel-layer-group .layer-user-folder-children .layer-row[data-layer]');
 check(Boolean(layer),'フォルダー中央へドロップしたレイヤーを中へ移す');
 const outside=await wait<HTMLElement>('.panel-layer-group .layer-direct-root .layer-root-drop.is-top');
 await drag(layer.querySelector<HTMLElement>('.layer-select')!,outside,.5);
 layer=await wait<HTMLElement>('.panel-layer-group .layer-direct-root>.layer-owner-entries>.layer-entry .layer-row[data-layer]');
 check(!layer.closest('.layer-user-folder-children'),'ルートへドロップしたレイヤーをフォルダー外へ移す');
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true,cancelable:true}));await tick();
 check(document.querySelectorAll('.panel-layer-group .layer-user-folder-row').length===2,'Fキーで現在の範囲へフォルダーを追加する');
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick();await waitButton('フォルダー追加');await wait('.page-direct-create-actions');
 check(document.querySelectorAll('.panel-layer-group .layer-user-folder-row').length===2,'保存後も作成したフォルダーを保持する');
 await click('コマ外へフォルダーを追加');
 await wait('.page-direct-layer-group .layer-user-folder-row');
 await click('ラスターレイヤー追加');
 const pageLayer=await wait('.page-direct-layer-group .layer-direct-root .layer-row[data-layer]');
 check(Boolean(pageLayer),'コマ外にもフォルダーと単独レイヤーを追加する');
 check(!document.querySelector('.page-direct-layer-group .layer-group-row'),'コマ外の直下レイヤーにも合成フォルダーを挟まない');
 return checks;
}

const report=document.createElement('details');report.open=true;report.style.cssText='position:fixed;bottom:10px;left:170px;z-index:10001;max-width:620px;padding:8px 12px;background:#fff;border:1px solid #acb6b2;font-size:12px;color:#17231d';
const summary=document.createElement('summary'),button=document.createElement('button'),output=document.createElement('ol');summary.textContent='レイヤーフォルダー操作の検証';button.textContent='実行';button.onclick=()=>{button.disabled=true;run().then(checks=>{summary.textContent=`レイヤーフォルダー操作 PASS（${checks.length}項目）`;for(const item of checks){const li=document.createElement('li');li.textContent=item;output.append(li);}}).catch(error=>{summary.textContent='レイヤーフォルダー操作 FAIL';const li=document.createElement('li');li.textContent=String(error?.stack??error);output.append(li);}).finally(()=>button.disabled=false);};report.append(summary,button,output);document.body.append(report);
