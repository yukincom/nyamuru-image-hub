// Disposable artwork and storage on the dedicated QA origin only.
import {startToneZoomFixture} from './toneZoom.browser';
import {parseMangaYaml,STORAGE_KEY} from '../src/lib/manga';
const tick=()=>new Promise(resolve=>setTimeout(resolve,100));
const find=(selector:string)=>(document.querySelector('.spread-pane:not(.is-spread-partner)')?.querySelector<HTMLElement>(selector)??document.querySelector<HTMLElement>(selector))!;
const button=(name:string)=>{const matches=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(el=>el.getAttribute('aria-label')===name||el.textContent?.trim()===name);return matches.find(el=>el.getClientRects().length>0)??matches[0]!;};
const mouseClick=async(el:HTMLButtonElement)=>{
 if(!el||el.disabled||el.getAttribute('aria-disabled')==='true')throw Error(`Button unavailable: ${el?.getAttribute('aria-label')??el?.textContent??'missing'}`);
 // Native pointer clicks focus a button before dispatching a click with detail=1.
 el.focus();el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));await tick();
};
const key=(type:string,value=' ',target:EventTarget=document.activeElement??document.body)=>{const event=new KeyboardEvent(type,{key:value,code:value===' '?'Space':`Key${value.toUpperCase()}`,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
const pointer=(target:EventTarget,type:string,x:number,y:number,pointerType='mouse')=>target.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:71,pointerType,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true}));
async function run(){
 const restore=new URLSearchParams(location.search).has('pan-check')?await startToneZoomFixture():undefined;
 try{
 // Let App's initial 350ms autosave normalize the fixture before the baseline.
 await document.fonts.ready;for(let i=0;i<6;i++)await tick();
 const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const zoom=()=>find('.zoom-reset').textContent;
 let stage=find('.canvas-stage'),toolbar=find('.canvas-toolbar'),scroll=find('.canvas-scroll'),paper=find('.manga-paper');
 const outer=document.querySelector<HTMLElement>('.canvas-spread-scroll')??scroll;
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
 const storedBeforePan=localStorage.getItem(STORAGE_KEY),isSpread=new URLSearchParams(location.search).has('spread');
 const visiblePapers=()=>Array.from(document.querySelectorAll<HTMLElement>('.manga-paper')).filter(item=>item.getClientRects().length);
 const pair=()=>{const bounds=visiblePapers().map(item=>item.getBoundingClientRect());return {left:Math.min(...bounds.map(b=>b.left)),top:Math.min(...bounds.map(b=>b.top)),right:Math.max(...bounds.map(b=>b.right)),bottom:Math.max(...bounds.map(b=>b.bottom))};};
 await mouseClick(button('全体'));
 check(outer.scrollWidth-outer.clientWidth>=outer.clientWidth&&outer.scrollHeight-outer.clientHeight>=outer.clientHeight,'全体表示でも四方向にviewport規模の移動余白がある');
 const initialPair=pair(),initialViewport=outer.getBoundingClientRect();
 check(Math.abs((initialPair.left+initialPair.right)/2-(initialViewport.left+outer.clientWidth/2))<1&&Math.abs((initialPair.top+initialPair.bottom)/2-(initialViewport.top+outer.clientHeight/2))<1,'初期fitは単ページ／見開きの全体を中央へ表示');
 check(initialPair.right-initialPair.left>80&&initialPair.right-initialPair.left<=outer.clientWidth-20&&initialPair.bottom-initialPair.top<=outer.clientHeight-20,'移動余白を引かずに有効なfit倍率を計算');
 check(document.querySelectorAll('.page-print-guides').length===1&&document.querySelector('.page-print-guides')!.getAttribute('aria-label')!.startsWith(isSpread?'見開き':'単ページ'),'単ページの印刷guideを二ページ幅にしない');
 const fitLeft=outer.scrollLeft,fitTop=outer.scrollTop;
 const fitDown=key('keydown');check(fitDown.defaultPrevented,'fitでもSpaceをパンに使える');
 const x=initialViewport.left+outer.clientWidth/2,y=initialViewport.top+outer.clientHeight/2;
 pointer(outer,'pointerdown',x,y);pointer(window,'pointermove',x+outer.clientWidth*.65,y+outer.clientHeight*.65);pointer(window,'pointerup',x,y);key('keyup');await tick();
 check(pair().top>initialViewport.top+outer.clientHeight*.6&&pair().left>initialViewport.left+outer.clientWidth*.6,'紙面左上を灰色余白から画面右下まで運べる');
 const panPosition={left:outer.scrollLeft,top:outer.scrollTop};window.dispatchEvent(new Event('resize'));await tick();
 check(Math.abs(outer.scrollLeft-panPosition.left)<1&&Math.abs(outer.scrollTop-panPosition.top)<1,'通常resize通知でpan位置を初期化しない');
 const anchor=()=>{const content=pair(),viewport=outer.getBoundingClientRect();return {x:(viewport.left+outer.clientWidth/2-content.left)/(content.right-content.left),y:(viewport.top+outer.clientHeight/2-content.top)/(content.bottom-content.top)};};
 const oldAnchor=anchor(),oldWidth=outer.style.width;
 outer.style.width='calc(100% - 60px)';await tick();await tick();
 check(Math.abs(anchor().x-oldAnchor.x)<.006&&Math.abs(anchor().y-oldAnchor.y)<.006,'viewport実寸の縮小でも灰色領域の中心点を保持');
 outer.style.width=oldWidth;await tick();await tick();
 check(Math.abs(anchor().x-oldAnchor.x)<.006&&Math.abs(anchor().y-oldAnchor.y)<.006,'viewport実寸を戻してもpan位置が往復する');
 outer.scrollLeft=fitLeft;outer.scrollTop=fitTop;
 key('keydown');pointer(outer,'pointerdown',x,y);pointer(window,'pointermove',x-outer.clientWidth*.65,y-outer.clientHeight*.65);pointer(window,'pointercancel',x,y);key('keyup');await tick();
 check(pair().right<initialViewport.right-outer.clientWidth*.6&&pair().bottom<initialViewport.bottom-outer.clientHeight*.6,'紙面右下を反対側まで運べ、cancelで移動を終える');
 const cancelled={left:outer.scrollLeft,top:outer.scrollTop};pointer(window,'pointermove',x+20,y+20);check(outer.scrollLeft===cancelled.left&&outer.scrollTop===cancelled.top&&!document.body.classList.contains('is-canvas-space-panning'),'cancel後のpointermoveで紙面が動かない');
 await mouseClick(button('全体'));check(Math.abs(outer.scrollLeft-fitLeft)<1&&Math.abs(outer.scrollTop-fitTop)<1,'明示fitは同倍率でも中央へ戻す');
 check(localStorage.getItem(STORAGE_KEY)===storedBeforePan,`fit／pan／cancelだけでは文書・保存を変更しない: ${storedBeforePan?.length}→${localStorage.getItem(STORAGE_KEY)?.length}`);
 check(button('元に戻す').disabled,'fit／pan／cancelだけではUndoを追加しない');
 if(isSpread){
  // The left instance starts as the partner and is reused as the single page.
  // Both fit and keyboard/pointer ownership must follow the current role.
  for(const count of [1,2]){
   await mouseClick(button('環境設定'));
   await mouseClick(document.querySelector<HTMLButtonElement>('#environment-tab-display')!);
   const row=Array.from(document.querySelectorAll('.environment-setting-row')).find(item=>item.querySelector('strong')?.textContent==='見開き表示')!;
   row.querySelector<HTMLInputElement>('input')!.click();await tick();key('keydown','Escape');key('keyup','Escape');await tick();await tick();
   stage=find('.canvas-stage');toolbar=find('.canvas-toolbar');scroll=find('.canvas-scroll');paper=find('.manga-paper');
   check(visiblePapers().length===count&&document.querySelectorAll('.page-print-guides').length===1&&document.querySelector('.page-print-guides')!.getAttribute('aria-label')!.startsWith(count===1?'単ページ':'見開き'),`${count}ページ表示への切替で正しい印刷guideを残す`);
   const size=pair(),view=outer.getBoundingClientRect();
   check(Math.abs((size.left+size.right)/2-(view.left+outer.clientWidth/2))<1&&size.right-size.left<=outer.clientWidth-20&&size.bottom-size.top<=outer.clientHeight-20,`${count}ページ表示への切替だけでfitを再計算し中央表示`);
   const beforeLeft=outer.scrollLeft,beforeTop=outer.scrollTop;
   // Escape returns focus to the preferences button; resume canvas input first.
   if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
   key('keydown');pointer(outer,'pointerdown',x,y);pointer(window,'pointermove',x+30,y+25);pointer(window,'pointerup',x+30,y+25);key('keyup');await tick();
   check(Math.abs(outer.scrollLeft-(beforeLeft-30))<1&&Math.abs(outer.scrollTop-(beforeTop-25))<1,`${count}ページ表示への切替後もSpaceパンが一度だけ動く`);
  }
  const partner=document.querySelector<HTMLElement>('.is-spread-partner')!,oldHeight=outer.style.height,oldDisplay=partner.style.display;
  outer.style.height='120px';await mouseClick(button('全体'));await tick();await tick();
  const heightLimitedWidth=paper.getBoundingClientRect().width;
  for(const hidden of [true,false]){
   // Model the media query's visibility change without changing logical mode.
   partner.style.display=hidden?'none':oldDisplay;window.dispatchEvent(new Event('resize'));await tick();await tick();
   const guides=Array.from(document.querySelectorAll('.page-print-guides')).filter(item=>item.getClientRects().length>0);
   check(Math.abs(paper.getBoundingClientRect().width-heightLimitedWidth)<.1,'高さ制限下では表示ページ数が変わっても紙面幅は同じ');
   check(guides.length===1&&guides[0].getAttribute('aria-label')!.startsWith(hidden?'単ページ':'見開き'),`紙面幅不変の${hidden?'片側非表示':'見開き復帰'}でも印刷guideを更新`);
  }
  outer.style.height=oldHeight;await tick();await tick();
  if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
  key('keydown');await mouseClick(button('次のページ'));key('keyup');await tick();
  check(!document.body.classList.contains('is-canvas-space-pan-ready'),'Space保持中に編集ページを切り替えてもkeyupで旧担当を解除');
  await mouseClick(button('前のページ'));
  stage=find('.canvas-stage');toolbar=find('.canvas-toolbar');scroll=find('.canvas-scroll');paper=find('.manga-paper');
  const released={left:outer.scrollLeft,top:outer.scrollTop};
  pointer(outer,'pointerdown',x,y);pointer(window,'pointermove',x+30,y+25);pointer(window,'pointerup',x+30,y+25);await tick();
  check(outer.scrollLeft===released.left&&outer.scrollTop===released.top,'編集ページを戻してもSpaceなしではpanしない');
  check(localStorage.getItem(STORAGE_KEY)===storedBeforePan&&button('元に戻す').disabled,'表示切替とパンで文書・Undo・保存を変更しない');
 }
 await mouseClick(button('100%表示'));
 // In a spread the editable page can be on the right; expose that page.
 outer.scrollLeft+=paper.getBoundingClientRect().left-outer.getBoundingClientRect().left+100;
 outer.scrollTop+=paper.getBoundingClientRect().top-outer.getBoundingClientRect().top+100;await tick();
 const viewportRect=outer.getBoundingClientRect(),before=paper.getBoundingClientRect();
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
 check(Math.abs(screenLayoutAfter.fontSize/screenLayoutBefore.fontSize-paperRatio)<.015,'写植文字ptを変更せず表示幅に応じたCSS pxへ換算する');
 check(Math.abs(bubbleVisualAfter.width/Math.max(1,bubbleVisualBefore.width)-paperRatio)<.015,'吹き出し文字は紙面全体と一緒に表示だけ拡大する');
 check(Math.abs(screenVisualAfter.width/Math.max(1,screenVisualBefore.width)-paperRatio)<.015,'写植文字は紙面全体と一緒に表示だけ拡大する');
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
 await mouseClick(button('全体'));await mouseClick(button('拡大'));await mouseClick(button('拡大'));
 outer.scrollLeft+=28;outer.scrollTop+=19;await tick();
 const stored=()=>parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
 const settle=async()=>{for(let i=0;i<6;i++)await tick();};
 const originalBubble=structuredClone(stored().manga.pages[0].panels[0].bubbles[0]);
 await mouseClick(button('選択'));await mouseClick(find('.bubble-guide') as HTMLButtonElement);await mouseClick(button('写植文字'));
 const textFrame=find('.bubble-text-move-frame.is-active'),textBox=textFrame.getBoundingClientRect(),paperBox=paper.getBoundingClientRect();
 const dx=originalBubble.bbox!.w*.25/stored().manga.pages[0].canvas.w*paperBox.width,dy=originalBubble.bbox!.h*.25/stored().manga.pages[0].canvas.h*paperBox.height;
 pointer(textFrame,'pointerdown',textBox.left+1,textBox.top+1);pointer(window,'pointermove',textBox.left+1+dx,textBox.top+1+dy);pointer(window,'pointerup',textBox.left+1+dx,textBox.top+1+dy);await settle();
 const movedText=stored().manga.pages[0].panels[0].bubbles[0].text_position;
 check(!!movedText&&Math.abs(movedText.x-.75)<.001&&Math.abs(movedText.y-.75)<.001,'pan・zoom後のT本文ドラッグが保存座標と一致');
 await mouseClick(button('元に戻す'));await settle();check(JSON.stringify(stored().manga.pages[0].panels[0].bubbles[0])===JSON.stringify(originalBubble),'本文移動を1Undoで原状へ戻せる');
 await mouseClick(button('選択'));await mouseClick(find('.bubble-guide') as HTMLButtonElement);await mouseClick(button('ダイレクト選択'));
 const outline=find('.bubble-bezier-canvas.is-paper-overlay') as unknown as SVGSVGElement,node=outline.querySelector<SVGGraphicsElement>('.bubble-bezier-node')!,hit=outline.querySelector('.bubble-bezier-node-hit')!;
 const matrix=outline.getScreenCTM()!,nodeBox=node.getBBox(),nodeX=nodeBox.x+nodeBox.width/2,nodeY=nodeBox.y+nodeBox.height/2;
 const from=new DOMPoint(nodeX,nodeY).matrixTransform(matrix),to=new DOMPoint(nodeX+7,nodeY+9).matrixTransform(matrix);
 // Synthetic fixture pointers have no OS capture; keep real SVG CTM and handlers.
 const capture=outline.setPointerCapture;outline.setPointerCapture=()=>{};
 try{pointer(hit,'pointerdown',from.x,from.y);pointer(outline,'pointermove',to.x,to.y);pointer(outline,'pointerup',to.x,to.y);}finally{outline.setPointerCapture=capture;}
 await settle();const savedNode=stored().manga.pages[0].panels[0].bubbles[0].bezier!.nodes[0];
 check(Math.abs(savedNode.x-nodeX-7)<.001&&Math.abs(savedNode.y-nodeY-9)<.001,'pan・zoom後のAベジェ点がSVGと保存座標で一致');
 await mouseClick(button('元に戻す'));await settle();check(JSON.stringify(stored().manga.pages[0].panels[0].bubbles[0])===JSON.stringify(originalBubble),'輪郭移動を1Undoで原状へ戻せる');
 await mouseClick(button('選択'));
 const row=Array.from(document.querySelectorAll<HTMLButtonElement>('.layer-select')).find(el=>el.textContent?.endsWith('トーン'))!;await mouseClick(row);
 for(let i=0;i<60&&(!document.querySelector('.paint-input')||button('ペン')?.getAttribute('aria-disabled')==='true');i++)await tick();
 await mouseClick(button('ペン'));
 await pan('描画ツール中');
 await mouseClick(button('全体'));await mouseClick(button('拡大'));await mouseClick(button('拡大'));
 outer.scrollLeft+=35;outer.scrollTop+=21;await tick();
 const input=find('.paint-input'),ownerFrame=find('.paint-frame').getBoundingClientRect();
 const selectionStart={x:ownerFrame.left+ownerFrame.width*.15,y:ownerFrame.top+ownerFrame.height*.2},selectionEnd={x:ownerFrame.left+ownerFrame.width*.7,y:ownerFrame.top+ownerFrame.height*.65};
 await mouseClick(button('投げ縄'));
 pointer(input,'pointerdown',selectionStart.x,selectionStart.y);pointer(window,'pointermove',selectionEnd.x,selectionStart.y);pointer(window,'pointermove',selectionEnd.x,selectionEnd.y);pointer(window,'pointerup',selectionStart.x,selectionEnd.y);await tick();
 const selectionSvg=find('.raster-selection-overlay') as unknown as SVGSVGElement,selectionBounds=selectionSvg.querySelector<SVGGraphicsElement>('path')!.getBBox(),selectionMatrix=selectionSvg.getScreenCTM()!;
 const selectedTopLeft=new DOMPoint(selectionBounds.x,selectionBounds.y).matrixTransform(selectionMatrix),selectedBottomRight=new DOMPoint(selectionBounds.x+selectionBounds.width,selectionBounds.y+selectionBounds.height).matrixTransform(selectionMatrix);
 check(Math.abs(selectedTopLeft.x-selectionStart.x)<1&&Math.abs(selectedTopLeft.y-selectionStart.y)<1&&Math.abs(selectedBottomRight.x-selectionEnd.x)<1&&Math.abs(selectedBottomRight.y-selectionEnd.y)<1,'pan・zoom後の投げ縄輪郭がpointer指定位置と一致');
 key('keydown','Escape');key('keyup','Escape');await tick();
 check(!input.querySelector('.raster-selection-overlay'),'Escapeで投げ縄選択だけを解除');
 await mouseClick(button('ペン'));
 const preview=find('[data-paint-owner="figure-0"] .paint-preview-canvas') as HTMLCanvasElement;
 const pixels=()=>preview.getContext('2d')!.getImageData(0,0,preview.width,preview.height).data;
 const beforeInk=pixels(),inkPoint={x:ownerFrame.left+ownerFrame.width*.08,y:ownerFrame.top+ownerFrame.height*.08};
 pointer(input,'pointerdown',inkPoint.x,inkPoint.y);pointer(window,'pointermove',inkPoint.x+ownerFrame.width*.025,inkPoint.y);await tick();await tick();
 const duringInk=pixels();let minX=preview.width,minY=preview.height,maxX=-1,maxY=-1;
 for(let i=0;i<duringInk.length;i+=4)if(duringInk[i]!==beforeInk[i]||duringInk[i+1]!==beforeInk[i+1]||duringInk[i+2]!==beforeInk[i+2]||duringInk[i+3]!==beforeInk[i+3]){const n=i/4,px=n%preview.width,py=Math.floor(n/preview.width);minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);}
 const inkCenter={x:(minX+maxX)/2/preview.width,y:(minY+maxY)/2/preview.height};
 check(maxX>=0&&Math.abs(inkCenter.x-.0925)<.025&&Math.abs(inkCenter.y-.08)<.025,`pan・zoom後の実ペン描画画素がpointer指定位置と一致（${inkCenter.x.toFixed(3)},${inkCenter.y.toFixed(3)}）`);
 pointer(window,'pointercancel',inkPoint.x,inkPoint.y);await tick();await tick();
 check(pixels().every((value,index)=>value===beforeInk[index]),'ペンcancelでpan後の仮描画画素を元に戻す');
 const select=document.querySelector<HTMLSelectElement>('[aria-label="レイヤーの合成"]')!;select.focus();check(!key('keydown').defaultPrevented,'プルダウン操作中のSpaceを奪わない');key('keyup');
 const tone=button('トーンレイヤー作成'),robot=button('生成マスク化');
 check(tone.nextElementSibling===robot&&Boolean(robot.querySelector('.lucide-bot')),'生成マスク化はトーン作成の隣のロボット');
 return checks;
 }finally{await restore?.();}
}
const report=document.createElement('details');report.style.cssText='position:fixed;bottom:10px;left:175px;z-index:10001;max-width:700px;padding:8px 12px;background:white;border:1px solid #abc;font-size:12px;color:#123';
const summary=document.createElement('summary');summary.textContent='移動操作の検証';report.append(summary);
const runButton=document.createElement('button');runButton.textContent='移動操作検証を実行';report.append(runButton);document.body.append(report);
runButton.onclick=()=>{report.open=false;runButton.disabled=true;void run().then(checks=>{summary.textContent=`移動操作検証 PASS（${checks.length}項目）`;const list=document.createElement('ul');checks.forEach(label=>{const li=document.createElement('li');li.textContent=label;list.append(li);});report.append(list);}).catch(error=>{summary.textContent=`移動操作検証 FAIL: ${String(error)}`;report.open=true;}).finally(()=>{runButton.disabled=false;});};
