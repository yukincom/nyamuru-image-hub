// Seed disposable A4 artwork on the dedicated test origin, never the live app.
import './toneZoom.browser';

const tick=()=>new Promise(resolve=>setTimeout(resolve,80));
const find=(selector:string)=>document.querySelector<HTMLElement>(selector);
const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(el=>el.getAttribute('aria-label')===name||el.textContent?.trim()===name);
const click=async(name:string)=>{const el=button(name);if(!el||el.disabled)throw Error(`Button unavailable: ${name}`);el.click();await tick();};
const key=async(value:string,options:KeyboardEventInit={},target:EventTarget=document.body)=>{target.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...options}));await tick();};
const setSize=async(value:number)=>{const input=document.querySelector<HTMLInputElement>('.paint-size input')!;input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await tick();};
const size=()=>Number(document.querySelector<HTMLInputElement>('.paint-size input')?.value);
const pointer=(type:string,options:PointerEventInit={})=>{
 const input=find('.paint-input')!,rect=input.getBoundingClientRect();
 input.dispatchEvent(new PointerEvent(type,{clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,pointerId:41,pointerType:'mouse',isPrimary:true,bubbles:true,cancelable:true,pressure:1,buttons:0,...options}));
};
const cursor=()=>document.querySelector<SVGSVGElement>('.paint-cursor')!;
async function run(){
 const checks:string[]=[];const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 // The tone fixture is opened through the same layer control as the real app.
 const row=Array.from(document.querySelectorAll<HTMLButtonElement>('.layer-select')).find(el=>el.textContent?.endsWith('トーン'));
 if(!row)throw Error('Tone layer not ready');row.click();for(let i=0;i<50&&!find('.paint-cursor');i++)await tick();await tick();
 await click('円');await setSize(100);pointer('pointermove');await tick();
 const width=()=>Number(cursor().getAttribute('width'))-4;
 const before=width();check(before>0&&cursor().dataset.cursorMode==='circle','トーンでも円カーソルが表示される');
 const paper=find('.manga-paper')!.getBoundingClientRect();
 check(Math.abs(before-100*paper.width/Math.round(210*600/25.4))<.3,'円の直径が原稿の100pxと一致する');
 check(getComputedStyle(cursor()).filter==='none'&&getComputedStyle(cursor()).boxShadow==='none'&&getComputedStyle(find('.paint-input')!).cursor==='none','OSカーソルと影を表示しない');
 await key(']');check(size()===120&&width()>before*1.19,'ブラシ拡大で静止中の円も拡大する');
 await key('[');check(size()===100,'ブラシ縮小が戻る');
 const field=document.querySelector<HTMLInputElement>('.paint-size input')!;await key(']',{},field);check(size()===100,'数値入力中はブラシキーを奪わない');
 await key(']',{isComposing:true});check(size()===100,'IME変換中はブラシキーを奪わない');
 await click('十字');pointer('pointermove');check(cursor().dataset.cursorMode==='crosshair','ラスターを十字に切り替えられる');
 await click('ラスターレイヤー追加');check(size()===100&&cursor().dataset.cursorMode==='crosshair','普通のラスターもトーンと設定を共有する');
 await click('生成マスク化');check(size()===100&&cursor().dataset.cursorMode==='crosshair','生成マーカーも同じサイズとカーソルを使う');
 await click('円');pointer('pointermove');check(cursor().dataset.cursorMode==='circle','生成マーカーを円で表示できる');
 await click('消しゴム');await setSize(40);pointer('pointermove');check(width()<before*.41,'消しゴムには消しゴムの直径を使う');
 await click('ペン');check(size()===100,'ペンのサイズを消しゴムとは別に保持する');
 await click('ベジェペン');pointer('pointermove');check(cursor().dataset.cursorMode==='crosshair','ベクターは円設定でも十字になる');
 await click('ペン');pointer('pointermove');check(cursor().dataset.cursorMode==='circle'&&size()===100,'ラスターへ戻ると円とサイズを復元する');
 const zoom=()=>Number(find('.zoom-reset')!.textContent!.replace('%',''));
 const z=zoom(),paperWidth=find('.manga-paper')!.getBoundingClientRect().width;
 await key('+',{metaKey:true});check(Math.abs(zoom()-z*1.25)<.02,'Command + はブラウザーでなくキャンバスを拡大する');
 pointer('pointermove');check(width()>before*1.24&&find('.manga-paper')!.getBoundingClientRect().width>paperWidth*1.24,'円もキャンバス倍率に追従する');
 await key('-',{metaKey:true});check(Math.abs(zoom()-z)<.02,'Command - はキャンバスを縮小する');
 const z2=zoom();pointer('pointerdown',{button:0,buttons:1});await tick();
 await key(']');await key('+',{metaKey:true});check(size()===100&&zoom()===z2,'ストローク中はサイズと倍率を固定する');
 pointer('pointerup',{button:0});await tick();
 pointer('pointermove',{pointerType:'touch'});check(cursor().style.display==='none','タッチ操作中はペンカーソルを隠す');
 pointer('pointermove');check(cursor().style.display==='block','マウスに戻るとカーソルを表示する');
 pointer('pointercancel');check(cursor().style.display==='none','キャンセルで残像を消す');
 await click('円');await setSize(300);pointer('pointermove');
 return checks;
}
const report=document.createElement('details');report.style.cssText='position:fixed;bottom:10px;left:170px;z-index:10001;max-width:600px;padding:8px 12px;background:#fff;border:1px solid #acb6b2;font-size:12px;color:#17231d';
const summary=document.createElement('summary');summary.textContent='カーソル操作の検証';report.append(summary);
const runButton=document.createElement('button');runButton.textContent='操作検証を実行';report.append(runButton);document.body.append(report);
runButton.onclick=()=>{report.open=false;runButton.disabled=true;void run().then(checks=>{summary.textContent=`カーソル操作検証 PASS（${checks.length}項目）`;const list=document.createElement('ul');for(const check of checks){const item=document.createElement('li');item.textContent=check;list.append(item);}report.append(list);}).catch(error=>{summary.textContent=`カーソル操作検証 FAIL: ${String(error)}`;const detail=document.createElement('pre');detail.textContent=error.stack;report.append(detail);report.open=true;}).finally(()=>{runButton.disabled=false;});};
