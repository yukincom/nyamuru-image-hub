// 見込み: 既存EditorAppの文字更新でコマ/前景の履歴と保存も一致する。
// 合格: T+描き文字だけの表示、13/7項目、変更/解除/同値/Undo/Redo/再読込。範囲: 隔離文書の実UI。モデル・実作品・外部サービスは使わない。
import {render} from 'preact';
import App from '../src/components/App';
import {createPortableProject} from '../src/lib/portableProject';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import type {MangaDocument} from '../src/types';
import '../src/styles/global.css';
if(location.origin!=='http://127.0.0.1:4341')throw Error('Dedicated lettering QA origin required');
const source=createEmptyWorkspaceDocument();source.manga.meta.title='描き文字設定確認';source.manga.meta.episode_id='lettering-style-qa';
source.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:15,y:20,w:160,h:110},bg:0,action:null,bubbles:[
 {text:'ドン！',shape:'handwritten',bbox:{x:35,y:40,w:45,h:25}},
 {text:'台詞',shape:'normal',bbox:{x:100,y:40,w:40,h:25}},
 {text:'写植',shape:'typeset',bbox:{x:35,y:85,w:40,h:20}}]}];
source.manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',bubbles:[{text:'ふわっ',shape:'handwritten',bbox:{x:40,y:170,w:50,h:30}}]};
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href);return /^https?:$/.test(url.protocol)&&(url.origin!==location.origin||url.pathname.startsWith('/__nyamuru/'))?Promise.resolve(Response.json({error:'Lettering QA: services disabled'},{status:503})):originalFetch(input,init);};
const folder=await (await navigator.storage.getDirectory()).getDirectoryHandle(`lettering-style-${Date.now()}`,{create:true});
const project=await folder.getFileHandle('project.json',{create:true}),writer=await project.createWritable();
await writer.write(JSON.stringify(await createPortableProject(source)));await writer.close();
Object.assign(window,{showDirectoryPicker:async()=>folder});
const host=document.getElementById('app')!;
const mount=()=>render(<App/>,host);
mount();
let stored: MangaDocument=source;
const tick=(ms=80)=>new Promise(resolve=>setTimeout(resolve,ms));
const visible=(e:Element|null|undefined)=>!!e&&e.getClientRects().length>0;
const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(e=>visible(e)&&(e.getAttribute('aria-label')===name||e.textContent?.trim()===name))!;
const click=async(name:string)=>{const e=button(name);if(!e||e.disabled)throw Error(`Button unavailable: ${name}`);e.click();await tick();};
const wait=async(test:()=>boolean,label:string)=>{for(let i=0;i<100;i++){if(test())return;await tick();}throw Error(`Timeout: ${label}`);};
const saved=()=>stored;
const savedWait=async(test:()=>boolean,label:string)=>{
 const control=document.querySelector<HTMLButtonElement>('[data-project-save]')!;control.click();await tick();
 await wait(()=>!control.disabled&&!control.textContent?.includes('処理中'),'保存完了');
 stored=JSON.parse(await(await project.getFile()).text()).snapshot.document;
 if(!test())throw Error(label);
};
const open=async()=>{await click('作品フォルダを開く');await wait(()=>!!document.querySelector('[data-content-kind="bubble"]'),'作品を開く');};
const bubble=(overlay=false)=>overlay?saved().manga.pages[0].page_overlay!.bubbles![0]:saved().manga.pages[0].panels[0].bubbles[0];
const pen=()=>document.querySelector<HTMLSelectElement>('[aria-label="描き文字のペン"]');
const expression=(label:string)=>Array.from(document.querySelectorAll<HTMLLabelElement>('.handwritten-expression-options label')).find(e=>e.textContent===label)!.querySelector<HTMLInputElement>('input')!;
const select=async(overlay=false,index=0)=>{
 await click('選択');
 const selector=`[data-content-kind="bubble"][data-content-index="${index}"]${overlay?'[data-content-overlay]':'[data-content-panel="0"]'}`;
 const item=Array.from(document.querySelectorAll<HTMLElement>(selector)).find(e=>!e.closest('.is-spread-partner'));
 if(!item)throw Error(`Text unavailable ${selector}`);item.click();await tick();await click('写植文字');await click('情報');
};
const setPen=async(value:string)=>{const e=pen()!;e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));await tick();};
const history=(name:string)=>document.querySelector<HTMLButtonElement>(`.app-header [aria-label^="${name}"]`)!;
const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
async function run(){
 await open();
 if(button('ペンツールを開く'))await click('ペンツールを開く');
 await wait(()=>!!button('選択'),'道具');
 await select();await wait(()=>visible(pen()),'描き文字ペン');
 check(pen()!.options.length===14,'ペン13種と未指定');
 check(document.querySelectorAll('.handwritten-expression-options input').length===7,'表現7種');
 const fields=document.querySelector('.handwritten-style-fields')!;
 check(fields.previousElementSibling?.textContent?.startsWith('対応キャラクター')===true,'対応キャラクターの直下');
 check(history('元に戻す').disabled,'選択だけでは履歴を作らない');
 await setPen('g-pen-firm');await savedWait(()=>bubble().lettering_pen==='g-pen-firm','ペン保存');
 history('元に戻す').click();await savedWait(()=>!bubble().lettering_pen,'ペンUndo');
 history('やり直す').click();await savedWait(()=>bubble().lettering_pen==='g-pen-firm','ペンRedo');
 await setPen('g-pen-firm');history('元に戻す').click();await savedWait(()=>!bubble().lettering_pen,'同値は履歴を増やさない');
 check(history('元に戻す').disabled,'同じペンの再指定は編集しない');history('やり直す').click();await savedWait(()=>bubble().lettering_pen==='g-pen-firm','Redo');
 expression('かすれ').click();await savedWait(()=>bubble().lettering_expressions?.includes('scratchy')===true,'表現保存');
 expression('いきおい').click();await savedWait(()=>bubble().lettering_expressions?.length===2,'複数表現');
 history('元に戻す').click();await savedWait(()=>bubble().lettering_expressions?.length===1,'表現Undo');
 history('やり直す').click();await savedWait(()=>bubble().lettering_expressions?.length===2,'表現Redo');check(true,'ペンと複数表現を各1回でUndo/Redo');
 await select(true);check(pen()!.value==='','前景のペンは独立');await setPen('pencil-hb');await savedWait(()=>bubble(true).lettering_pen==='pencil-hb','前景保存');
 expression('かわいい').click();await savedWait(()=>bubble(true).lettering_expressions?.includes('cute')===true,'前景表現保存');
 check(bubble().lettering_pen==='g-pen-firm'&&bubble().lettering_expressions?.length===2,'前景編集でコマの指定を変えない');
 history('元に戻す').click();await savedWait(()=>!bubble(true).lettering_expressions,'前景Undo');history('やり直す').click();await savedWait(()=>bubble(true).lettering_expressions?.includes('cute')===true,'前景Redo');check(true,'前景もUndo/Redo');
 await click('選択');check(!visible(pen()),'文字ツール以外では非表示');
 await select(false,1);check(!pen(),'フキダシでは非表示');await select(false,2);check(!pen(),'写植では非表示');
 render(null,host);mount();await tick();await open();if(button('ペンツールを開く'))await click('ペンツールを開く');await select();await wait(()=>pen()?.value==='g-pen-firm','再読込');
 check(expression('かすれ').checked&&expression('いきおい').checked,'再読込後も複数選択を保持');
 await select(true);check(pen()?.value==='pencil-hb'&&expression('かわいい').checked,'再読込後も前景の指定を保持');
 await setPen('');expression('かわいい').click();await savedWait(()=>!bubble(true).lettering_pen&&!bubble(true).lettering_expressions,'全解除');
 check(true,'未指定・全解除で保存値を削除');
}
const report=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ol');report.style.cssText='position:fixed;bottom:8px;left:170px;z-index:20000;background:white;color:black;max-height:55vh;overflow:auto;padding:8px;border:1px solid';summary.textContent='描き文字設定を検証中';report.append(summary,list);document.body.append(report);
void run().then(()=>{summary.textContent=`描き文字設定 PASS ${checks.length}`;}).catch(error=>{summary.textContent=`描き文字設定 FAIL: ${String(error)}`;report.open=true;}).finally(()=>{for(const text of checks){const li=document.createElement('li');li.textContent=text;list.append(li);}});
