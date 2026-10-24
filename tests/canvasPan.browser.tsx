// Disposable artwork and storage on the dedicated QA origin only.
import './toneZoom.browser';
const tick=()=>new Promise(resolve=>setTimeout(resolve,100));
const find=(selector:string)=>document.querySelector<HTMLElement>(selector)!;
const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(el=>el.getAttribute('aria-label')===name||el.textContent?.trim()===name)!;
const mouseClick=async(el:HTMLButtonElement)=>{
 if(!el||el.disabled||el.getAttribute('aria-disabled')==='true')throw Error(`Button unavailable: ${el?.getAttribute('aria-label')??el?.textContent??'missing'}`);
 // Native pointer clicks focus a button before dispatching a click with detail=1.
 el.focus();el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));await tick();
};
const key=(type:string,target:EventTarget=document.activeElement??document.body)=>{const event=new KeyboardEvent(type,{key:' ',code:'Space',bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
const pointer=(target:EventTarget,type:string,x:number,y:number,pointerType='mouse')=>target.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:71,pointerType,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true}));
async function run(){
 const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const zoom=()=>find('.zoom-reset').textContent;
 const scroll=find('.canvas-scroll'),paper=find('.manga-paper');
 const pan=async(label:string,pointerType='mouse')=>{
  scroll.scrollLeft=400;scroll.scrollTop=400;const left=scroll.scrollLeft,top=scroll.scrollTop,beforeZoom=zoom();
  const box=scroll.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
  const down=key('keydown');check(down.defaultPrevented&&document.body.classList.contains('is-canvas-space-pan-ready'),`${label}：Spaceを移動に使う`);
  pointer(paper,'pointerdown',x,y,pointerType);pointer(window,'pointermove',x+50,y+35,pointerType);
  check(Math.abs(scroll.scrollLeft-(left-50))<1&&Math.abs(scroll.scrollTop-(top-35))<1,`${label}：ドラッグで縦横に移動する`);
  check(zoom()===beforeZoom,`${label}：移動中に拡大しない`);
  pointer(window,'pointerup',x+50,y+35,pointerType);key('keyup');await tick();
  check(!document.body.classList.contains('is-canvas-space-pan-ready')&&!document.body.classList.contains('is-canvas-space-panning'),`${label}：Spaceを離すと解除される`);
 };
 await mouseClick(button('100%表示'));await mouseClick(button('拡大'));
 check(document.activeElement!==button('拡大'),'拡大ボタンのクリック後にフォーカスが残らない');
 await pan('下部の拡大ボタン後');
 await mouseClick(button('拡大ツール'));check(document.activeElement!==button('拡大ツール'),'拡大ツールのクリック後にフォーカスが残らない');
 await pan('拡大ツール中','pen');
 const z=zoom(),box=scroll.getBoundingClientRect();pointer(paper,'pointerdown',box.left+200,box.top+200);pointer(window,'pointerup',box.left+200,box.top+200);await tick();
 check(zoom()!==z,'Spaceを離すと拡大ツールへ戻る');
 const plus=button('拡大');plus.focus();plus.click();await tick();check(document.activeElement===plus,'キーボードによるボタン実行はフォーカスを保持');
 check(!key('keydown').defaultPrevented,'キーボードで選んだボタンはSpaceで実行できる');key('keyup');
 await mouseClick(button('選択・移動'));
 const row=Array.from(document.querySelectorAll<HTMLButtonElement>('.layer-select')).find(el=>el.textContent?.endsWith('トーン'))!;await mouseClick(row);
 for(let i=0;i<60&&(!document.querySelector('.paint-input')||button('ペン')?.getAttribute('aria-disabled')==='true');i++)await tick();
 await mouseClick(button('ペン'));
 await pan('描画ツール中');
 const field=document.querySelector<HTMLInputElement>('.paint-size input')!;field.focus();check(!key('keydown').defaultPrevented,'数値入力中のSpaceを奪わない');key('keyup');
 const select=document.querySelector<HTMLSelectElement>('[aria-label="レイヤーの合成"]')!;select.focus();check(!key('keydown').defaultPrevented,'プルダウン操作中のSpaceを奪わない');key('keyup');
 const tone=button('トーンレイヤー作成'),robot=button('生成マスク化');
 check(tone.nextElementSibling===robot&&Boolean(robot.querySelector('.lucide-bot')),'生成マスク化はトーン作成の隣のロボット');
 await mouseClick(robot);check(Boolean(document.querySelector('.layer-mask-row.is-selected')),'ロボットから生成マスクを作成して編集できる');
 check(document.querySelectorAll('.paint-colors .paint-color').length===6,'生成マスクの領域色を表示');
 return checks;
}
const report=document.createElement('details');report.style.cssText='position:fixed;bottom:10px;left:175px;z-index:10001;max-width:700px;padding:8px 12px;background:white;border:1px solid #abc;font-size:12px;color:#123';
const summary=document.createElement('summary');summary.textContent='移動操作の検証';report.append(summary);
const runButton=document.createElement('button');runButton.textContent='移動操作検証を実行';report.append(runButton);document.body.append(report);
runButton.onclick=()=>{report.open=false;runButton.disabled=true;void run().then(checks=>{summary.textContent=`移動操作検証 PASS（${checks.length}項目）`;const list=document.createElement('ul');checks.forEach(label=>{const li=document.createElement('li');li.textContent=label;list.append(li);});report.append(list);}).catch(error=>{summary.textContent=`移動操作検証 FAIL: ${String(error)}`;report.open=true;}).finally(()=>{runButton.disabled=false;});};
