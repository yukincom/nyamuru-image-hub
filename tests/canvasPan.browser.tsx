// Disposable artwork and storage on the dedicated QA origin only.
import './toneZoom.browser';
import {STORAGE_KEY} from '../src/lib/manga';
const tick=()=>new Promise(resolve=>setTimeout(resolve,100));
const find=(selector:string)=>document.querySelector<HTMLElement>(selector)!;
const button=(name:string)=>{const matches=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(el=>el.getAttribute('aria-label')===name||el.textContent?.trim()===name);return matches.find(el=>el.getClientRects().length>0)??matches[0]!;};
const mouseClick=async(el:HTMLButtonElement)=>{
 if(!el||el.disabled||el.getAttribute('aria-disabled')==='true')throw Error(`Button unavailable: ${el?.getAttribute('aria-label')??el?.textContent??'missing'}`);
 // Native pointer clicks focus a button before dispatching a click with detail=1.
 el.focus();el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));await tick();
};
const key=(type:string,value=' ',target:EventTarget=document.activeElement??document.body)=>{const event=new KeyboardEvent(type,{key:value,code:value===' '?'Space':`Key${value.toUpperCase()}`,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
const pointer=(target:EventTarget,type:string,x:number,y:number,pointerType='mouse')=>target.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:71,pointerType,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true}));
async function run(){
 const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const zoom=()=>find('.zoom-reset').textContent;
 const stage=find('.canvas-stage'),toolbar=find('.canvas-toolbar'),scroll=find('.canvas-scroll'),paper=find('.manga-paper'),outer=document.querySelector<HTMLElement>('.canvas-spread-scroll')??scroll;
 const pan=async(label:string,pointerType='mouse',target:EventTarget=paper)=>{
  outer.scrollLeft=400;outer.scrollTop=400;const left=outer.scrollLeft,top=outer.scrollTop,beforeZoom=zoom();
  const box=outer.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
  const down=key('keydown');check(down.defaultPrevented&&document.body.classList.contains('is-canvas-space-pan-ready'),`${label}：Spaceを移動に使う`);
  pointer(target,'pointerdown',x,y,pointerType);pointer(window,'pointermove',x+50,y+35,pointerType);
  check(Math.abs(outer.scrollLeft-(left-50))<1&&Math.abs(outer.scrollTop-(top-35))<1,`${label}：ドラッグで縦横に移動する`);
  check(zoom()===beforeZoom,`${label}：移動中に拡大しない`);
  pointer(window,'pointerup',x+50,y+35,pointerType);key('keyup');await tick();
  check(!document.body.classList.contains('is-canvas-space-pan-ready')&&!document.body.classList.contains('is-canvas-space-panning'),`${label}：Spaceを離すと解除される`);
 };
 const wheel=(target:EventTarget,x:number,y:number,deltaY:number)=>{const event=new WheelEvent('wheel',{deltaY,clientX:x,clientY:y,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
 await mouseClick(button('100%表示'));
 scroll.scrollLeft=400;scroll.scrollTop=400;await tick();
 const viewportRect=scroll.getBoundingClientRect(),before=paper.getBoundingClientRect();
 const left=Math.max(viewportRect.left,before.left),right=Math.min(viewportRect.right,before.right),top=Math.max(viewportRect.top,before.top),bottom=Math.min(viewportRect.bottom,before.bottom);
 check(right>left&&bottom>top,'カーソル中心検証用の紙面が表示される');
 const wheelX=left+(right-left)*.37,wheelY=top+(bottom-top)*.43;
 const bubbleText=find('.bubble-text'),screenText=find('.screen-text-body'),storedBeforeZoom=localStorage.getItem(STORAGE_KEY);
 const bubbleVisualBefore=bubbleText.getBoundingClientRect(),screenVisualBefore=screenText.getBoundingClientRect();
 const bubbleLayoutBefore={fontSize:parseFloat(getComputedStyle(bubbleText).fontSize),width:bubbleText.offsetWidth,height:bubbleText.offsetHeight,scrollWidth:bubbleText.scrollWidth,scrollHeight:bubbleText.scrollHeight};
 const screenLayoutBefore={fontSize:parseFloat(getComputedStyle(screenText).fontSize),width:screenText.offsetWidth,height:screenText.offsetHeight,scrollWidth:screenText.scrollWidth,scrollHeight:screenText.scrollHeight};
 const paperWidthBefore=before.width;
 const beforePointX=(wheelX-before.left)/before.width,beforePointY=(wheelY-before.top)/before.height,beforeZoom=zoom();
 const stageWheel=wheel(stage,wheelX,wheelY,-80);await tick();
 const after=paper.getBoundingClientRect(),afterPointX=(wheelX-after.left)/after.width,afterPointY=(wheelY-after.top)/after.height;
 check(stageWheel.defaultPrevented&&zoom()!==beforeZoom,'編集領域のwheelで拡大する');
 check(Math.abs(afterPointX-beforePointX)<.005&&Math.abs(afterPointY-beforePointY)<.005,'wheelはカーソル位置を中心に拡大する');
 const paperRatio=after.width/paperWidthBefore,bubbleVisualAfter=bubbleText.getBoundingClientRect(),screenVisualAfter=screenText.getBoundingClientRect();
 const bubbleLayoutAfter={fontSize:parseFloat(getComputedStyle(bubbleText).fontSize),width:bubbleText.offsetWidth,height:bubbleText.offsetHeight,scrollWidth:bubbleText.scrollWidth,scrollHeight:bubbleText.scrollHeight};
 const screenLayoutAfter={fontSize:parseFloat(getComputedStyle(screenText).fontSize),width:screenText.offsetWidth,height:screenText.offsetHeight,scrollWidth:screenText.scrollWidth,scrollHeight:screenText.scrollHeight};
 check(getComputedStyle(paper).transform==='none'&&Math.abs(paper.clientWidth-after.width)<1,'画面ズームは表示幅で直接描画し、caretと編集枠を祖先scaleで細くしない');
 check(Math.abs(bubbleLayoutAfter.fontSize/bubbleLayoutBefore.fontSize-paperRatio)<.015,'吹き出し文字ptを変更せず表示幅に応じたCSS pxへ換算する');
 check(Math.abs(screenLayoutAfter.fontSize/screenLayoutBefore.fontSize-paperRatio)<.015,'通常文字ptを変更せず表示幅に応じたCSS pxへ換算する');
 check(Math.abs(bubbleVisualAfter.width/Math.max(1,bubbleVisualBefore.width)-paperRatio)<.015,'吹き出し文字は紙面全体と一緒に表示だけ拡大する');
 check(Math.abs(screenVisualAfter.width/Math.max(1,screenVisualBefore.width)-paperRatio)<.015,'通常文字は紙面全体と一緒に表示だけ拡大する');
 check(localStorage.getItem(STORAGE_KEY)===storedBeforeZoom,'ズームで文字サイズや文書を保存変更しない');
 // Observe the real alpha-measurement path during a burst, not a mocked scheduler.
 const readPixels=CanvasRenderingContext2D.prototype.getImageData;let smallReads=0;
 const targets=document.querySelectorAll('[data-content-target]').length;
 CanvasRenderingContext2D.prototype.getImageData=function(...args:Parameters<typeof readPixels>){if(!this.canvas.isConnected&&this.canvas.width<=768&&this.canvas.height<=768)smallReads++;return readPixels.apply(this,args);};
 try{
  for(let i=0;i<8;i++){wheel(stage,wheelX,wheelY,-2);await new Promise(requestAnimationFrame);}
  await tick();await tick();await tick();
 }finally{CanvasRenderingContext2D.prototype.getImageData=readPixels;}
 check(smallReads<=targets*2+2,`連続8回ズームでも選択面の再計測をまとめる（${smallReads}回／対象${targets}）`);
 const toolbarBox=toolbar.getBoundingClientRect(),toolbarZoom=zoom();
 const toolbarWheel=wheel(toolbar,toolbarBox.left+toolbarBox.width/2,toolbarBox.top+toolbarBox.height/2,-60);await tick();
 check(toolbarWheel.defaultPrevented&&zoom()!==toolbarZoom,'紙面外の上部バーでもwheelで拡大する');
 await mouseClick(button('100%表示'));await mouseClick(button('拡大'));
 check(document.activeElement!==button('拡大'),'拡大ボタンのクリック後にフォーカスが残らない');
 await pan('下部の拡大ボタン後');
 const outside=document.querySelector<HTMLElement>('.canvas-spread-stage')??scroll;
 await pan('編集範囲外の手のひら移動','mouse',outside);
 check(!Array.from(document.querySelectorAll('button')).some(el=>el.getAttribute('aria-label')==='拡大ツール'),'拡大ツールをパレットに表示しない');
 check(!Array.from(document.querySelectorAll('button')).some(el=>el.getAttribute('aria-label')==='選択解除'),'選択解除をパレットに表示しない');
 key('keydown','z');key('keyup','z');await tick();
 await pan('拡大ツール中','pen');
 const z=zoom(),box=scroll.getBoundingClientRect();pointer(paper,'pointerdown',box.left+200,box.top+200);pointer(window,'pointerup',box.left+200,box.top+200);await tick();
 check(zoom()!==z,'Spaceを離すと拡大ツールへ戻る');
 const plus=button('拡大');plus.focus();plus.click();await tick();check(document.activeElement===plus,'キーボードによるボタン実行はフォーカスを保持');
 check(!key('keydown').defaultPrevented,'キーボードで選んだボタンはSpaceで実行できる');key('keyup');
 await mouseClick(button('選択'));
 const viewportElement=find('.canvas-viewport'),artwork=find('.placed-image');
 check(getComputedStyle(artwork).cursor==='default','V選択の配置画像は通常のOS矢印');
 const artworkBox=artwork.getBoundingClientRect();pointer(artwork,'pointerdown',artworkBox.left+artworkBox.width/2,artworkBox.top+artworkBox.height/2);
 check(document.body.classList.contains('is-canvas-moving')&&getComputedStyle(artwork).cursor==='move','配置画像のドラッグ中だけ移動カーソル');
 pointer(window,'pointerup',artworkBox.left+artworkBox.width/2,artworkBox.top+artworkBox.height/2);await tick();
 check(!document.body.classList.contains('is-canvas-moving')&&getComputedStyle(artwork).cursor==='default','移動終了後は通常のOS矢印へ戻る');
 await mouseClick(artwork as HTMLButtonElement);
 check(getComputedStyle(find('.resize-handle.handle-nw')).cursor==='nwse-resize'&&getComputedStyle(find('.resize-handle.handle-ne')).cursor==='nesw-resize','四隅は方向別リサイズカーソル');
 await mouseClick(button('ダイレクト選択'));
 const directCursor=getComputedStyle(viewportElement).getPropertyValue('--direct-selection-tool-cursor');
 check(viewportElement.classList.contains('is-direct-selection-tool')&&directCursor.includes('url(')&&(directCursor.includes('%23fff')||directCursor.includes('#fff')),'Aダイレクト選択は白矢印');
 await mouseClick(button('選択'));
 const row=Array.from(document.querySelectorAll<HTMLButtonElement>('.layer-select')).find(el=>el.textContent?.endsWith('トーン'))!;await mouseClick(row);
 for(let i=0;i<60&&(!document.querySelector('.paint-input')||button('ペン')?.getAttribute('aria-disabled')==='true');i++)await tick();
 await mouseClick(button('ペン'));
 await pan('描画ツール中');
 const select=document.querySelector<HTMLSelectElement>('[aria-label="レイヤーの合成"]')!;select.focus();check(!key('keydown').defaultPrevented,'プルダウン操作中のSpaceを奪わない');key('keyup');
 const tone=button('トーンレイヤー作成'),robot=button('生成マスク化');
 check(tone.nextElementSibling===robot&&Boolean(robot.querySelector('.lucide-bot')),'生成マスク化はトーン作成の隣のロボット');
 return checks;
}
const report=document.createElement('details');report.style.cssText='position:fixed;bottom:10px;left:175px;z-index:10001;max-width:700px;padding:8px 12px;background:white;border:1px solid #abc;font-size:12px;color:#123';
const summary=document.createElement('summary');summary.textContent='移動操作の検証';report.append(summary);
const runButton=document.createElement('button');runButton.textContent='移動操作検証を実行';report.append(runButton);document.body.append(report);
runButton.onclick=()=>{report.open=false;runButton.disabled=true;void run().then(checks=>{summary.textContent=`移動操作検証 PASS（${checks.length}項目）`;const list=document.createElement('ul');checks.forEach(label=>{const li=document.createElement('li');li.textContent=label;list.append(li);});report.append(list);}).catch(error=>{summary.textContent=`移動操作検証 FAIL: ${String(error)}`;report.open=true;}).finally(()=>{runButton.disabled=false;});};
