// Dedicated, disposable UI artwork. Never reads or writes a user's manuscript.
import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {parseMangaYaml,STORAGE_KEY,toStoredMangaYaml,validateManga} from '../src/lib/manga';
import {createBubbleBezier} from '../src/lib/bubbleBezier';
import {captureQwenComposition,captureQwenCompositionCanvas} from '../src/lib/qwenComposition';
import {blobImageData,flattenedPsd} from '../src/lib/pageExport';
import '../src/styles/global.css';
const expandedChecks=new URLSearchParams(location.search).has('expanded-text-check');
if(location.hostname!=='127.0.0.1'||location.port!==(expandedChecks?'4335':'4325'))throw new Error('Dedicated local test origin required.');
if(expandedChecks){
  const current=localStorage.getItem(STORAGE_KEY);
  if(current&&parseMangaYaml(current).manga.meta.episode_id!=='layer-selection-qa')throw Error('Do not overwrite another artwork');
  const fetchOriginal=window.fetch.bind(window);
  window.fetch=(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href);
    return url.protocol==='http:'&&(url.origin!==location.origin||url.pathname.startsWith('/__nyamuru/'))
      ?Promise.resolve(Response.json({error:'UI fixture: service calls disabled'},{status:503})):fetchOriginal(input,init);
  };
}
function textFixture(){
  const doc=createEmptyWorkspaceDocument();
  doc.manga.meta.title='T単クリック・文字サイズ確認';
  doc.manga.meta.episode_id='text-tool-disposable';
  doc.manga.finish_settings={width_mm:182,height_mm:257,dpi:600,bleed_mm:0};
  doc.manga.pages=[{page:1,canvas:{w:182,h:257,unit:'mm'},panels:[
    {id:1,shape:{type:'rect',x:16,y:18.5,w:150,h:105},bg:0,action:null,
      figures:[{name:'あたり上のクリック',bbox:{x:25,y:75,w:35,h:35}}],
      bubbles:[{text:'吹き出し本文',shape:'square',tail:false,bbox:{x:100,y:30,w:50,h:45},text_style:{fontSize:15,orientation:'horizontal'}}],
      screen_text:[{text:'既存の文字',orientation:'horizontal',bbox:{x:25,y:35,w:55,h:12},text_style:{fontSize:18}}]},
    {id:2,shape:{type:'rect',x:16,y:128.5,w:150,h:110},bg:0,action:null,bubbles:[]},
  ],page_overlay:{frame:false,layer:'above_panel_frames',bubbles:[{text:'ページの文字',shape:'square',tail:false,bbox:{x:25,y:240,w:130,h:13},text_style:{fontSize:12,orientation:'horizontal'}}]}}];
  return doc;
}
if(!expandedChecks&&!new URLSearchParams(location.search).has('resume'))localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(textFixture()));
// Visible test-only counter: observe the real App autosave path on this isolated origin.
const saves=document.createElement('output');
saves.setAttribute('aria-label','検証用の本文保存回数');
saves.style.cssText='position:fixed;bottom:4px;left:4px;z-index:99999;background:white;color:black;font:12px monospace;pointer-events:none';
let saveCount=0,pngCount=0;
const updateSaveCount=()=>{saves.textContent=`本文保存: ${saveCount}回 / PNG化: ${pngCount}回`;};
const toBlob=HTMLCanvasElement.prototype.toBlob;
HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){if(type==='image/png'){pngCount++;updateSaveCount();}toBlob.call(this,callback,type,quality);};
const setItem=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){setItem.call(this,key,value);if(this===localStorage&&key===STORAGE_KEY){saveCount++;updateSaveCount();}};
updateSaveCount();document.body.append(saves);
render(<App/>,document.getElementById('app')!);
if(expandedChecks){
  const controls=document.createElement('aside');controls.style.cssText='position:fixed;bottom:30px;left:4px;z-index:99999;background:#fff4d5;max-width:480px;padding:6px';document.body.append(controls);
  render(<><button id="check-expanded-text" onClick={()=>void verifyExpandedText()}>拡張輪郭内の本文移動を検証</button><pre id="expanded-report" aria-live="polite" style={{maxHeight:'180px',overflow:'auto',whiteSpace:'pre-wrap'}}>未実行</pre></>,controls);
}

async function verifyExpandedText(){
  const host=document.getElementById('app')!,button=document.getElementById('check-expanded-text') as HTMLButtonElement,report=document.getElementById('expanded-report')!;
  const original=localStorage.getItem(STORAGE_KEY),checks:string[]=[],canvases:HTMLCanvasElement[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
  const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  const wait=async(test:()=>boolean,label:string)=>{for(let i=0;i<240&&!test();i++)await tick();if(!test())throw Error(label);};
  const settle=async()=>{for(let i=0;i<12;i++)await tick();};
  const stored=()=>parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
  const active=<T extends Element>(selector:string)=>Array.from(document.querySelectorAll<T>(selector)).find(item=>!item.closest('.is-spread-partner'))!;
  const bubble=(overlay:boolean)=>overlay?stored().manga.pages[0].page_overlay!.bubbles![0]:stored().manga.pages[0].panels[0].bubbles[0];
  const element=(overlay:boolean)=>active<HTMLElement>(`[data-content-kind="bubble"][data-content-index="0"]${overlay?'[data-content-overlay]':'[data-content-panel="0"]'}`);
  const tool=(label:string)=>document.querySelector<HTMLButtonElement>(`.paint-tools-dock [aria-label="${label}"]`)!.click();
  const historyButton=(name:string)=>document.querySelector<HTMLButtonElement>(`.app-header [aria-label^="${name}"]`)!;
  const textCenter=(overlay:boolean)=>{const range=document.createRange();range.selectNode(element(overlay).querySelector('.bubble-text-content')!);const b=range.getBoundingClientRect(),p=active<HTMLElement>('.manga-paper').getBoundingClientRect();return {x:(b.x+b.width/2-p.x)*182/p.width,y:(b.y+b.height/2-p.y)*257/p.height};};
  const close=(a:number,b:number,tolerance=.15)=>Math.abs(a-b)<tolerance;
  const captured=async(manga:ReturnType<typeof stored>['manga'])=>{const canvas=await captureQwenCompositionCanvas(manga,0,0,'page',{'0:background':false,'1:background':false});canvases.push(canvas);return canvas;};
  let mounted=false;
  button.disabled=true;report.textContent='拡張本文を検証中';
  try{
    if(original&&stored().manga.meta.episode_id!=='layer-selection-qa')throw Error('Dedicated selection manuscript required');
    if(document.querySelector('.app-shell.is-painting'))throw Error('先に描画を閉じてください');
    const doc=textFixture();doc.manga.finish_settings!.dpi=100;
    const outline=createBubbleBezier('ellipse');outline.nodes=outline.nodes.map(node=>({...node,x:(node.x-50)*3+50,y:(node.y-50)*3+50,
      ...(node.handleIn?{handleIn:{x:node.handleIn.x*3,y:node.handleIn.y*3}}:{}),...(node.handleOut?{handleOut:{x:node.handleOut.x*3,y:node.handleOut.y*3}}:{})}));
    const first=doc.manga.pages[0].panels[0];first.figures=[];first.screen_text=[];
    first.bubbles=[{text:'AB',shape:'normal',tail:false,bbox:{x:65,y:55,w:30,h:20},bezier:outline,text_style:{fontSize:15,orientation:'horizontal'}}];
    doc.manga.pages[0].page_overlay!.bubbles=[{text:'CD',shape:'normal',tail:false,bbox:{x:65,y:180,w:30,h:20},bezier:structuredClone(outline),text_style:{fontSize:15,orientation:'vertical'}}];
    render(null,host);localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));mounted=true;render(<App/>,host);
    await wait(()=>!!element(false),'本文が表示されません');await document.fonts.ready;await settle();
    const beforeCanvas=await captured(stored().manga),plain=structuredClone(stored().manga);
    plain.pages[0].panels[0].bubbles[0].text='';plain.pages[0].page_overlay!.bubbles![0].text='';const blankCanvas=await captured(plain);
    check(historyButton('元に戻す').disabled,'初期表示だけでUndoを追加しない');
    const centers=[textCenter(false),textCenter(true)];
    for(const overlay of [false,true]){
      tool('選択');await settle();element(overlay).click();await settle();tool('写植文字');await settle();
      const before=structuredClone(bubble(overlay)),frame=element(overlay).querySelector<HTMLElement>('.bubble-text-move-frame.is-active');
      if(!frame)throw Error('T本文移動用の枠がありません');
      const selectedCenter=textCenter(overlay);
      check(close(selectedCenter.x,centers[Number(overlay)].x)&&close(selectedCenter.y,centers[Number(overlay)].y),'Tの移動枠を表示しても本文位置が変わらない');
      const paper=active<HTMLElement>('.manga-paper').getBoundingClientRect(),box=frame.getBoundingClientRect(),x=box.x+1,y=box.y+1;
      const dx=(overlay?-30:30)/182*paper.width,dy=(overlay?15:-15)/257*paper.height;
      frame.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:71,clientX:x,clientY:y}));
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:71,clientX:x+dx/3,clientY:y+dy/3}));
      await new Promise(resolve=>setTimeout(resolve,850));
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:71,clientX:x+dx,clientY:y+dy}));
      window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:71,clientX:x+dx,clientY:y+dy}));
      const expected={x:overlay?-.5:1.5,y:overlay?1.25:-.25};
      await wait(()=>close(bubble(overlay).text_position?.x??0,expected.x,.001)&&close(bubble(overlay).text_position?.y??0,expected.y,.001),'元bboxの端を越えて移動できません');await settle();
      const center=textCenter(overlay),frameBox=before.bbox!;
      check(close(center.x,frameBox.x+frameBox.w*expected.x)&&close(center.y,frameBox.y+frameBox.h*expected.y),`${overlay?'前景・縦':'コマ・横'}本文のDOM中心が枠外の保存座標に一致`);
      check(JSON.stringify(bubble(overlay).bezier)===JSON.stringify(before.bezier)&&JSON.stringify(bubble(overlay).bbox)===JSON.stringify(before.bbox),'本文移動は輪郭・bbox・原文を変えない');
      historyButton('元に戻す').click();await wait(()=>!bubble(overlay).text_position,'長いdragを1回のUndoで戻せません');
      check(overlay||historyButton('元に戻す').disabled,'800msを超えるdragも1Undoだけ');
      historyButton('やり直す').click();await wait(()=>close(bubble(overlay).text_position?.x??0,expected.x,.001),'Redoで位置が戻りません');
      check(bubble(overlay).text===before.text,'Redoでも原文を保持');
    }
    tool('選択');await settle();element(true).click();await settle();tool('ダイレクト選択');await wait(()=>!!document.querySelector('.bubble-bezier-canvas.is-paper-overlay'),'Aの輪郭がありません');
    const path=document.querySelector('.bubble-bezier-canvas.is-paper-overlay')!;
    check(!path.querySelector('.bubble-bezier-box')&&path.querySelectorAll('.bubble-bezier-node-hit').length===outline.nodes.length&&!!path.querySelector('.bubble-bezier-handle-hit'),'Aは参照破線なしで輪郭・アンカー・handleを保持');
    check(validateManga(stored()).every(issue=>!issue.path.endsWith('.text_position')),'枠外本文の保存値はvalidatorを通る');
    const changed=stored(),afterCanvas=await captured(changed.manga),blank=blankCanvas.getContext('2d')!.getImageData(0,0,blankCanvas.width,blankCanvas.height);
    const inkCenter=(canvas:HTMLCanvasElement,overlay:boolean)=>{
      const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
      for(let y=overlay?Math.floor(canvas.height*.55):0;y<(overlay?canvas.height:Math.floor(canvas.height*.5));y++)for(let x=0;x<canvas.width;x++){
        const n=(y*canvas.width+x)*4;if(Math.abs(pixels[n]-blank.data[n])+Math.abs(pixels[n+1]-blank.data[n+1])+Math.abs(pixels[n+2]-blank.data[n+2])<24)continue;
        minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
      }
      if(maxX<0)throw Error('合成画像に本文がありません');return {x:(minX+maxX+1)/2*182/canvas.width,y:(minY+maxY+1)/2*257/canvas.height};
    };
    for(const overlay of [false,true]){const before=inkCenter(beforeCanvas,overlay),after=inkCenter(afterCanvas,overlay),dom=textCenter(overlay),start=centers[Number(overlay)];
      check(close(after.x-before.x,dom.x-start.x,.4)&&close(after.y-before.y,dom.y-start.y,.4),`${overlay?'縦':'横'}本文の合成PNG上の移動量が実画面と一致`);}
    const pixels=afterCanvas.getContext('2d')!.getImageData(0,0,afterCanvas.width,afterCanvas.height);
    const generation=await blobImageData(await(await fetch(await captureQwenComposition(changed.manga,0,0,'page',{'0:background':false,'1:background':false}))).blob());
    check(generation.width===pixels.width&&generation.height===pixels.height&&generation.data.every((value,index)=>value===pixels.data[index]),'生成入力PNGも同じ枠外本文の全画素を保持（モデルなし）');
    const psd=new Uint8Array(await flattenedPsd(pixels,100,'color').arrayBuffer()),view=new DataView(psd.buffer);let offset=26;
    for(let i=0;i<3;i++)offset+=4+view.getUint32(offset);offset+=2;const count=pixels.width*pixels.height;
    check(pixels.data.every((value,index)=>index%4===3||value===psd[offset+(index%4)*count+Math.floor(index/4)]),'PSDの全RGB画素も同じ本文位置');
    render(null,host);render(<App/>,host);await wait(()=>!!element(false),'再読込が完了しません');await settle();
    check([false,true].every(overlay=>{const position=bubble(overlay).text_position!,box=bubble(overlay).bbox!,center=textCenter(overlay);return close(center.x,box.x+box.w*position.x)&&close(center.y,box.y+box.h*position.y); }),'再読込後もコマ・前景の枠外本文位置を保持');
    tool('写植文字');await settle();element(false).querySelector<HTMLElement>('.bubble-text-content')!.click();await wait(()=>!!document.querySelector('.native-text-input'),'Tの本文編集を開けません');
    check(document.querySelector('.native-text-input')!.textContent==='AB','枠外へ移動した本文をTで再編集できる');
    report.textContent=`拡張本文 PASS ${checks.length}\n${checks.join('\n')}`;
  }catch(error){report.textContent=`拡張本文 FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;throw error;}
  finally{if(mounted){render(null,host);if(original)localStorage.setItem(STORAGE_KEY,original);else localStorage.removeItem(STORAGE_KEY);render(<App/>,host);}canvases.forEach(canvas=>{canvas.width=canvas.height=1;});button.disabled=false;}
}
