/** Real App/editor integration on an isolated origin, using only a disposable browser folder. */
import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {createPortableProject} from '../src/lib/portableProject';
import {textStyleSegments} from '../src/lib/textStyle';
import {captureQwenCompositionCanvas} from '../src/lib/qwenComposition';
import {prepareImageAsset,createFrameArtwork} from '../src/lib/imagePlacement';
import {saveFigureCropAssets} from '../src/lib/figureCropStore';
import {paintForFrame} from '../src/lib/paintDocument';
import {isLanClient} from '../src/lib/clientRuntime';
import type {MangaDocument} from '../src/types';
import '../src/styles/global.css';
if(location.origin!=='http://127.0.0.1:4339'||!isLanClient)throw Error('Dedicated LAN fixture at 127.0.0.1:4339 required');
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href);
  return url.origin!==location.origin||url.pathname.startsWith('/__nyamuru/')
    ?Promise.resolve(Response.json({error:'Test fixture: resident services are disabled'},{status:503})):originalFetch(input,init);
};
const source=createEmptyWorkspaceDocument();
source.manga.meta.title='文字スタイルの検証';source.manga.meta.episode_id='inline-styles-disposable';source.manga.meta.font='Hiragino Sans';
source.manga.finish_settings={width_mm:182,height_mm:257,dpi:100,bleed_mm:0};
source.manga.pages=[{page:1,canvas:{w:182,h:257,unit:'mm'},panels:[{id:1,shape:{type:'rect',x:15,y:15,w:150,h:200},bg:0,action:null,figures:[],
  bubbles:[{text:'ABCDEF',shape:'square',tail:false,bbox:{x:60,y:30,w:85,h:35},text_style:{font:'Hiragino Sans',fontSize:24,fontWeight:400,orientation:'horizontal'}}],
  screen_text:[{text:'あいうえお',orientation:'vertical',bbox:{x:25,y:90,w:20,h:70},text_style:{font:'Hiragino Sans',fontSize:24,fontWeight:400}}],
}],page_overlay:{frame:false,layer:'above_panel_frames',bubbles:[{text:'前景の文字',shape:'square',tail:false,bbox:{x:65,y:155,w:90,h:35},text_style:{fontSize:18,fontWeight:400,orientation:'horizontal'}}]}}];
const folder=await (await navigator.storage.getDirectory()).getDirectoryHandle(`inline-styles-${Date.now()}`,{create:true});
const project=await folder.getFileHandle('project.json',{create:true});
const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(source)));await writer.close();
Object.assign(window,{showDirectoryPicker:async()=>folder});
const host=document.getElementById('app')!;
render(<App/>,host);
const controls=document.createElement('aside');controls.style.cssText='position:fixed;z-index:99999;bottom:8px;left:8px;max-width:540px;background:#fff5ce;padding:8px;border:1px solid #d6bc68;font:12px sans-serif';document.body.append(controls);
render(<><button id="inline-run" onClick={()=>void verify()}>スタイルを一括検証</button><button id="alignment-run" onClick={()=>void verifyAlignment()}>行揃えを一括検証</button><button id="bubble-info-run" onClick={()=>void verifyBubbleInfo()}>情報タブを一括検証</button><button id="handwritten-run" onClick={()=>void verifyHandwritten()}>描き文字の編集を検証</button><button id="depth-run" onClick={()=>void verifyLetteringDepth()}>描き文字の重なりを検証</button><button id="text-order-run" onClick={()=>void verifyTextOrder()}>文字の初期順と保存を検証</button><button id="inline-inspect" onClick={()=>void inspect()}>保存データを表示</button><pre id="inline-report" style={{maxHeight:'180px',overflow:'auto',whiteSpace:'pre-wrap'}}>検証用の作品フォルダを用意しました。</pre><div id="inline-captures"/></>,controls);
const report=document.getElementById('inline-report')!;
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const settle=async()=>{for(let i=0;i<4;i++)await frame();};
const wait=async(test:()=>boolean,label:string)=>{for(let i=0;i<300&&!test();i++)await frame();if(!test())throw Error(label);};
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.getAttribute('aria-label')===label||node.textContent?.trim()===label)!;
const history=(label:string)=>document.querySelector<HTMLButtonElement>(`.app-header [aria-label="${label}"]`)!;
const editor=()=>document.querySelector<HTMLElement>('.native-text-input')!;
const nativeBubble=()=>document.querySelector<HTMLElement>('[data-content-panel="0"][data-content-kind="bubble"][data-content-index="0"] .bubble-text-content')!;
const stored=async():Promise<MangaDocument>=>JSON.parse(await(await project.getFile()).text()).snapshot.document;
async function inspect(){report.textContent=JSON.stringify((await stored()).manga.pages[0],null,2);}
async function choose(start:number,end=start){
  const root=editor();root.focus();const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),range=document.createRange();let at=0,started=false;
  while(walker.nextNode()){const node=walker.currentNode,length=node.textContent!.length;if(!started&&start<=at+length){range.setStart(node,start-at);started=true;}if(started&&end<=at+length){range.setEnd(node,end-at);break;}at+=length;}
  const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));await settle();
}
async function input(value:string,composition=false){
  const root=editor();
  if(composition)root.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
  root.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:composition?'insertCompositionText':'insertText',data:value,isComposing:composition}));
  const range=getSelection()!.getRangeAt(0);range.deleteContents();const node=document.createTextNode(value);range.insertNode(node);range.setStartAfter(node);range.collapse(true);getSelection()!.removeAllRanges();getSelection()!.addRange(range);
  root.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:composition?'insertCompositionText':'insertText',data:value,isComposing:composition}));
  if(composition)root.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:value}));
  await settle();
}
async function toggle(label:string,on:boolean){if(button(label).getAttribute('aria-pressed')!==String(on)){button(label).click();await settle();}}
const glyphStyle=(root:HTMLElement,index:number)=>{
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let at=0;
  while(walker.nextNode()){const node=walker.currentNode,length=node.textContent!.length;if(index<at+length)return getComputedStyle(node.parentElement!);at+=length;}
  throw Error(`Missing glyph ${index}`);
};
async function save(){const control=document.querySelector<HTMLButtonElement>('[data-project-save]')!;control.click();await settle();await wait(()=>!control.disabled&&!control.textContent?.includes('処理中'),'保存完了待ち');await settle();}
async function open(){button('作品フォルダを開く').click();await wait(()=>!!nativeBubble(),'作品が開けません');await settle();}
async function verifyBubbleInfo(){
  const run=document.getElementById('bubble-info-run') as HTMLButtonElement,checks:string[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
  const info=()=>document.querySelector<HTMLElement>('.bubble-info-content')!;
  const category=()=>info().querySelector<HTMLSelectElement>('[aria-label="文字の種類"]')!;
  const body=()=>info().querySelector<HTMLTextAreaElement>('[aria-label="選択中の文字の本文"]')!;
  const node=(index:number,overlay=false,kind='bubble')=>document.querySelector<HTMLElement>(`.spread-pane:not(.is-spread-partner) [data-content-kind="${kind}"][data-content-index="${index}"]${overlay?'[data-content-overlay]':'[data-content-panel="0"]:not([data-content-overlay])'}`)!;
  const choose=async(index:number,overlay=false,kind='bubble')=>{node(index,overlay,kind).click();await settle();};
  const change=async(value:string)=>{category().value=value;category().dispatchEvent(new Event('change',{bubbles:true}));await settle();};
  const field=(label:string)=>[...info().querySelectorAll<HTMLLabelElement>('label.field')].find(n=>n.querySelector('.field-label')?.textContent===label)!.querySelector<HTMLSelectElement>('select')!;
  const updateField=async(label:string,value:string)=>{const select=field(label);select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));await settle();};
  const reload=async()=>{render(null,host);render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'再起動画面待ち');await open();};
  run.disabled=true;report.textContent='文字の種類と情報タブを検証中';
  try{
    render(null,host);const doc=structuredClone(source),panel=doc.manga.pages[0].panels[0];
    const raster=document.createElement('canvas');raster.width=96;raster.height=64;const ctx=raster.getContext('2d')!;
    ctx.fillStyle='#497ea9';ctx.fillRect(8,8,80,48);const blob=await new Promise<Blob>(resolve=>raster.toBlob(blob=>resolve(blob!),'image/png'));
    const asset=await prepareImageAsset(new File([blob],'原字の検証.png',{type:'image/png'}));await saveFigureCropAssets([{id:asset.storageId,blob}]);
    doc.manga.image_assets=[asset];
    panel.screen_text![0].text='あいう\nえお';
    panel.bubbles[0].text='ゴ  ゴ\nゴ';panel.bubbles[0].text_position={x:.4,y:.6};panel.bubbles[0].text_runs=[{start:0,end:1,italic:true}];
    panel.bubbles[0].analogTextImport={schemaVersion:1,sourceBBox:{x:0,y:0,w:96,h:64},detectionSource:'baberu',recognitionEngine:'Baberu OCR',needsReview:false,levelAdjusted:true,assetId:asset.storageId,sourceRegionId:'category-ocr',originalImageId:'category-original',rasterLayerInitialized:true,rasterLayerSeparated:true};
    panel.images=[{...createFrameArtwork(asset,{x:20,y:180,w:30,h:20}),id:'category-original',bubbleOriginal:{sourceRegionId:'category-ocr',name:'原字'}}];
    panel.bubbles[0].paint_overlay={...createFrameArtwork(asset,panel.bubbles[0].bbox!),hidden:true};
    panel.bubbles.push({text:'別の文字',shape:'normal',bbox:{x:40,y:75,w:70,h:30}},{text:'固定した文字',shape:'normal',locked:true,bbox:{x:40,y:120,w:70,h:30}});
    doc.manga.characters=[{localId:'speaker-a',name:'アキ',role:'主人公',scope:'episode'}];
    panel.figures=[{refId:'speaker-a',name:'アキ',kind:'person',bbox:{x:20,y:55,w:30,h:40}}];
    doc.manga.pages[0].panels.push({id:2,shape:{type:'rect',x:15,y:220,w:150,h:25},bg:0,action:null,bubbles:[{text:'別コマの文字',shape:'normal',bbox:{x:25,y:222,w:100,h:20}}]});
    doc.manga.pages.push({...structuredClone(source.manga.pages[0]),page:2});
    const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(doc)));await writer.close();
    render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'起動画面待ち');await open();
    button('文字のツール一覧').click();await settle();button('情報').click();await settle();
    check(!info()&&history('元に戻す').disabled,'未選択では案内だけを表示し、履歴を変えない');
    await choose(0);check(category().value==='bubble'&&body().value==='ゴ  ゴ\nゴ'&&info().querySelectorAll('.bubble-card').length===1,'選択したOCR文字だけと種類を表示');
    check(category().options.length===3&&[...category().options].map(o=>o.textContent).join(',')==='フキダシ,描き文字,写植文字','種類は3つのプルダウン');
    check(info().querySelector('.selected-text-info h3')?.textContent==='テキスト1','情報見出しにテキスト番号を表示');
    check(!info().querySelector('.nested-card-head')&&!info().querySelector('.inline-add')&&info().querySelectorAll('h3').length===1,'本文下の追加・番号・選択中・削除見出しを撤去');
    check(document.querySelector('.page-layer-palette [data-owner-group="bubble-0"] .layer-caption')?.textContent==='テキスト1','レイヤーと情報の名前が一致');
    check(document.querySelectorAll('.text-settings-tabs [role="tab"]').length===3,'文字ツールのタブ数は3つを維持');
    await save();const baseline=(await stored()).manga.pages[0],beforeText=node(0).querySelector('.bubble-text-content')!.getBoundingClientRect();
    await change('handwritten');check(category().value==='handwritten'&&!info().querySelector('.bubble-join-control')&&!node(0).querySelector('.bubble-shape-svg'),'描き文字へ切替え、輪郭とフキダシ専用欄を非表示');
    await save();const handwritten=(await stored()).manga.pages[0];
    for(const key of ['text','bbox','text_position','text_style','text_runs','analogTextImport','paint_overlay'] as const)check(JSON.stringify(handwritten.panels[0].bubbles[0][key])===JSON.stringify(baseline.panels[0].bubbles[0][key]),`${key}を維持`);
    check(JSON.stringify(handwritten.panels[0].images)===JSON.stringify(baseline.panels[0].images),'原字画像のID・位置・内容・表示を維持');
    const afterText=node(0).querySelector('.bubble-text-content')!.getBoundingClientRect();
    check(Math.abs(afterText.x-beforeText.x)<.5&&Math.abs(afterText.y-beforeText.y)<.5,'実画面の本文位置も維持');
    history('元に戻す').click();await settle();check(category().value==='bubble'&&!!node(0).querySelector('.bubble-shape-svg'),'切替を1回のUndoで復元');
    history('やり直す').click();await settle();check(category().value==='handwritten','Redoで描き文字へ戻る');
    document.querySelector<HTMLElement>('[data-content-kind="bubble"][data-content-panel="1"][data-content-index="0"]')!.click();await settle();
    check(body().value==='別コマの文字','別コマの文字を選択');
    history('元に戻す').click();await settle();check(category().value==='bubble'&&body().value==='ゴ  ゴ\nゴ','別コマからUndoしても種類と文字選択を復元');
    history('やり直す').click();await settle();check(body().value==='別コマの文字','Redoで元いたコマの文字選択を復元');
    await choose(0);
    button('次のページ').click();await settle();await choose(0);
    check(body().value==='ABCDEF','別ページの文字を選択');
    history('元に戻す').click();await settle();check(category().value==='bubble'&&body().value==='ゴ  ゴ\nゴ','別ページからUndoしても種類と文字選択を復元');
    history('やり直す').click();await settle();check(body().value==='ABCDEF','Redoで元いたページの文字選択を復元');
    button('前のページ').click();await settle();await choose(0);
    await change('typeset');check(category().value==='typeset'&&!node(0).querySelector('.bubble-shape-svg'),'写植文字へ切替');
    check(info().querySelector('.selected-text-info h3')?.textContent==='テキスト1','種類変更後も同じテキスト名を維持');
    await save();await reload();button('文字のツール一覧').click();await settle();button('情報').click();await settle();await choose(0);
    check(category().value==='typeset'&&body().value==='ゴ  ゴ\nゴ','再読込で種類と本文を復元');
    await save();check(JSON.stringify((await stored()).manga.pages[0].panels[0].images)===JSON.stringify(baseline.panels[0].images),'再読込後も原字画像を保持');
    await change('bubble');await updateField('対応キャラクター','speaker-a');await updateField('しっぽ','normal');await save();
    check((await stored()).manga.pages[0].panels[0].bubbles[0].speaker==='アキ','フキダシへ戻した後の既存話者・しっぽ操作');
    await change('handwritten');
    check(field('対応キャラクター').value==='speaker-a'&&!info().querySelector('.bubble-card'),'描き文字は対応キャラクターだけを共有し、しっぽ・結合欄を出さない');
    await updateField('対応キャラクター','');await save();
    check(!(await stored()).manga.pages[0].panels[0].bubbles[0].speaker&&!(await stored()).manga.pages[0].panels[0].bubbles[0].speakerId,'なしで対応名と参照IDを両方解除');
    history('元に戻す').click();await settle();check(field('対応キャラクター').value==='speaker-a'&&category().value==='handwritten','対応解除を1回のUndoで戻し、種類は維持');
    history('やり直す').click();await settle();check(field('対応キャラクター').value==='','Redoで対応なしへ戻る');
    await updateField('対応キャラクター','speaker-a');await save();const associated=(await stored()).manga.pages[0].panels[0].bubbles[0];
    check(associated.speakerId==='speaker-a'&&associated.speaker==='アキ'&&associated.text===baseline.panels[0].bubbles[0].text&&JSON.stringify(associated.bbox)===JSON.stringify(baseline.panels[0].bubbles[0].bbox),'対応付けは本文・位置を維持して名前とIDを保存');
    await reload();button('文字のツール一覧').click();await settle();button('情報').click();await settle();await choose(0);
    check(category().value==='handwritten'&&field('対応キャラクター').value==='speaker-a','描き文字の対応キャラクターを保存再読込で復元');
    await change('bubble');
    await choose(1);check(body().value==='別の文字'&&info().querySelectorAll('.bubble-card').length===1,'別の文字を選ぶと情報が追従');
    check(info().querySelector('.selected-text-info h3')?.textContent==='テキスト2'&&[...field('結合先').options].some(option=>option.textContent==='テキスト1'),'見出しと結合先もテキスト番号へ統一');
    await updateField('結合先','1');await save();check((await stored()).manga.pages[0].panels[0].bubbles[1].join_to===1,'既存の結合操作を保持');
    await choose(0);await change('typeset');await save();check((await stored()).manga.pages[0].panels[0].bubbles[1].join_to===undefined,'写植文字への結合線を解除');
    // A layer selection may inspect a locked native object; controls must still reject manual editing.
    const lockedLayer=[...document.querySelectorAll<HTMLButtonElement>('.page-layer-palette button')].find(b=>b.textContent?.includes('テキスト3'));
    if(lockedLayer){lockedLayer.click();await settle();check(category().disabled&&field('対応キャラクター').disabled,'固定した文字は種類と対応キャラクターを変更できない');}
    await choose(0,true);check(body().value==='前景の文字'&&info().getAttribute('aria-label')==='ページ前景の文字情報','前景の選択も同じ情報タブへ追従');
    await change('handwritten');await save();const page=(await stored()).manga.pages[0];
    check(page.page_overlay!.bubbles![0].shape==='handwritten'&&page.panels[0].bubbles[0].shape==='typeset','前景の切替はコマ内の同番号に影響しない');
    check(field('対応キャラクター').value==='','前景の描き文字も対応なしを選べる');
    await updateField('対応キャラクター','speaker-a');await save();
    check((await stored()).manga.pages[0].page_overlay!.bubbles![0].speakerId==='speaker-a','前景の対応キャラクターを既存保存へ反映');
    await updateField('対応キャラクター','');await save();
    check(!(await stored()).manga.pages[0].page_overlay!.bubbles![0].speakerId&&(await stored()).manga.pages[0].panels[0].bubbles[0].speakerId==='speaker-a','前景の対応解除はコマ内の同番号に影響しない');
    await choose(0,false,'screen_text');check(category().value==='typeset'&&body().value==='あいう\nえお','Tで作る既存写植形式も同じ情報欄に表示');
    check(info().querySelector('.selected-text-info h3')?.textContent==='テキスト4','Tの写植文字にも同じコマ内で重複しない番号を表示');
    await save();const screenBefore=(await stored()).manga.pages[0].panels[0].screen_text![0],screenRect=node(0,false,'screen_text').querySelector('.screen-text-body')!.getBoundingClientRect();
    await change('bubble');await save();const converted=(await stored()).manga.pages[0].panels[0];
    check(!converted.screen_text&&converted.bubbles.at(-1)!.text===screenBefore.text&&JSON.stringify(converted.bubbles.at(-1)!.bbox)===JSON.stringify(screenBefore.bbox),'写植からフキダシへ変えても本文・位置・寸法を維持し二重登録しない');
    const convertedRect=node(converted.bubbles.length-1).querySelector('.bubble-text-content')!.getBoundingClientRect();
    check(Math.abs(screenRect.width-convertedRect.width)<.5&&Math.abs(screenRect.height-convertedRect.height)<.5&&Math.abs(screenRect.x+screenRect.width/2-convertedRect.x-convertedRect.width/2)<.5&&Math.abs(screenRect.y+screenRect.height/2-convertedRect.y-convertedRect.height/2)<.5,'余白のある写植枠でも複数行の寸法・行間・中心位置を保持');
    history('元に戻す').click();await settle();check(category().value==='typeset'&&body().value===screenBefore.text,'Undoで写植形式と選択先を復元');
    history('やり直す').click();await settle();check(category().value==='bubble'&&body().value===screenBefore.text,'Redoでフキダシ形式と選択先を復元');
    button('写植文字').click();await settle();const paper=document.querySelector<HTMLElement>('.spread-pane:not(.is-spread-partner) .manga-paper')!,paperBox=paper.getBoundingClientRect();
    paper.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1,clientX:paperBox.left+paperBox.width*140/182,clientY:paperBox.top+paperBox.height*205/257}));
    await wait(()=>!!editor(),'Tクリックの文字入力待ち');await settle();await input('追加した文字');button('情報').click();await settle();
    check(category().value==='typeset'&&body().value==='追加した文字','Tの空き位置クリックで文字を追加できる');
    await change('handwritten');await save();check((await stored()).manga.pages[0].panels[0].bubbles.at(-1)?.text==='追加した文字','Tで新規追加した文字も同じ種類切替に合流');
    button('選択').click();await settle();await choose(0);await change('typeset');await save();
    const saved=await stored(),out=await captureQwenCompositionCanvas(saved.manga,0,0,'page',{}, {width:364,height:514});
    check(out.width===364&&out.height===514,'原字・描画レイヤーを持つ写植文字を実Canvasへ書き出し');
    const asBalloon=structuredClone(saved);asBalloon.manga.pages[0].panels[0].bubbles[0].shape='normal';
    const withOutline=await captureQwenCompositionCanvas(asBalloon.manga,0,0,'page',{}, {width:364,height:514});
    const pixels=out.getContext('2d')!.getImageData(0,0,out.width,out.height).data,outlined=withOutline.getContext('2d')!.getImageData(0,0,withOutline.width,withOutline.height).data;
    check(pixels.some((value,index)=>value!==outlined[index]),'書き出しでも写植文字は吹き出しの輪郭を描かない');
    out.width=out.height=withOutline.width=withOutline.height=1;
    report.textContent=`文字の種類 PASS ${checks.length}\n${checks.join('\n')}`;
  }catch(error){report.textContent=`文字の種類 FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
  finally{run.disabled=false;}
}
async function verifyLetteringDepth(){
  const run=document.getElementById('depth-run') as HTMLButtonElement,checks:string[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
  const info=()=>document.querySelector<HTMLElement>('.bubble-info-content')!;
  const field=(label:string)=>[...info().querySelectorAll<HTMLLabelElement>('label.field')].find(node=>node.querySelector('.field-label')?.textContent===label)?.querySelector<HTMLSelectElement>('select');
  const change=async(label:string,value:string)=>{const select=field(label)!;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));await settle();};
  const node=(overlay:boolean)=>document.querySelector<HTMLElement>(`.spread-pane:not(.is-spread-partner) [data-content-kind="bubble"][data-content-index="0"]${overlay?'[data-content-overlay]':'[data-content-panel="0"]:not([data-content-overlay])'}`)!;
  const choose=async(overlay:boolean)=>{node(overlay).click();await settle();};
  const owner=(doc:MangaDocument,overlay:boolean)=>overlay?doc.manga.pages[0].page_overlay!:doc.manga.pages[0].panels[0];
  const layerRoot=(overlay:boolean)=>document.querySelector<HTMLElement>(`.page-layer-palette ${overlay?'.page-direct-layer-group':'.panel-layer-group:not(.page-direct-layer-group)'}`)!;
  const layerRow=(overlay:boolean,key:string)=>layerRoot(overlay).querySelector<HTMLElement>(`[data-owner-group="${key}"]`)!;
  const dragGroup=async(overlay:boolean,key:string,target:string,below:boolean)=>{
    const dest=layerRow(overlay,target);dest.scrollIntoView({block:'center'});await settle();
    const source=layerRow(overlay,key).querySelector<HTMLElement>('.layer-group-select')!,from=source.getBoundingClientRect(),to=dest.getBoundingClientRect();
    const x=from.x+from.width/2,y=from.y+from.height/2,tx=to.x+to.width*.5,ty=to.y+to.height*(below?.8:.2);
    const pointer=(type:string,cx:number,cy:number)=>source.dispatchEvent(new PointerEvent(type,{pointerId:41,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:cx,clientY:cy,bubbles:true,cancelable:true}));
    pointer('pointerdown',x,y);pointer('pointermove',tx,ty);await settle();
    check(dest.classList.contains(below?'drop-below':'drop-above'),`${overlay?'前景':'コマ'}：${key}を${target}の${below?'下':'上'}へドロップ表示`);
    pointer('pointerup',tx,ty);await settle();
  };
  const makeAsset=async(name:string,color:string)=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=100;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,100,100);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png'));
    const asset=await prepareImageAsset(new File([blob],name,{type:'image/png'}));await saveFigureCropAssets([{id:asset.storageId,blob}]);return asset;
  };
  run.disabled=true;controls.style.pointerEvents='none';report.textContent='描き文字の重なりを検証中';
  try{
    const red=await makeAsset('人物の検証.png','#dd2222'),blue=await makeAsset('描き文字の検証.png','#2244dd'),green=await makeAsset('原字の検証.png','#22dd44');
    const captures=document.getElementById('inline-captures')!;captures.replaceChildren();captures.style.cssText='display:flex;flex-wrap:wrap';
    for(const overlay of [false,true]){
      render(null,host);const doc=structuredClone(source),page=doc.manga.pages[0];doc.manga.pages=[page];
      page.canvas={w:100,h:100,unit:'mm'};doc.manga.finish_settings={width_mm:100,height_mm:100,dpi:100,bleed_mm:0};
      doc.manga.characters=[{localId:'depth-character',name:'アキ',role:'主人公',scope:'episode'}];doc.manga.image_assets=[red,blue,green];
      page.panels=[{id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:0,action:null,bubbles:[],figures:[]}];delete page.page_overlay;
      if(overlay)page.page_overlay={frame:false,layer:'above_panel_frames',bubbles:[],figures:[]};
      const target=owner(doc,overlay);
      target.figures=[{name:'アキ',refId:'depth-character',kind:'person',bbox:{x:20,y:20,w:60,h:60},artwork:createFrameArtwork(red,{x:20,y:20,w:60,h:60})}];
      target.bubbles=[{text:'ドン',shape:'handwritten',speakerId:'depth-character',speaker:'アキ',bbox:{x:35,y:35,w:30,h:30},lettering_guide_hidden:true,paint_overlay:createFrameArtwork(blue,{x:35,y:35,w:30,h:30}),analogTextImport:{schemaVersion:1,sourceBBox:{x:0,y:0,w:100,h:100},detectionSource:'baberu',recognitionEngine:'Baberu OCR',needsReview:false,levelAdjusted:true,assetId:green.storageId,sourceRegionId:'depth-original',originalImageId:'depth-original',rasterLayerInitialized:true,rasterLayerSeparated:true}}];
      const ink=target.bubbles[0].paint_overlay!,inkBox=target.bubbles[0].bbox!;
      ink.paint=paintForFrame(inkBox,blue.widthPx*25.4/inkBox.w,[{...ink,id:'depth-ink',bbox:inkBox}],doc.manga.image_assets,'color',false);
      ink.paint.layers.forEach(layer=>{layer.locked=false;});
      target.bubbles.push({text:'別の文字',shape:'normal',bbox:{x:1,y:1,w:10,h:10}});
      const original={...createFrameArtwork(green,{x:50,y:50,w:10,h:10}),id:'depth-original',bubbleOriginal:{name:'原字',sourceRegionId:'depth-original'}};
      if(overlay)page.images=[original];else page.panels[0].images=[original];
      const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(doc)));await writer.close();
      render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'再起動画面待ち');button('作品フォルダを開く').click();await wait(()=>!!node(overlay),'作品読込待ち');await settle();
      button('文字のツール一覧').click();await settle();button('情報').click();await settle();await choose(overlay);
      const label=overlay?'前景':'コマ';
      check(field('重なり')?.value==='front',`${label}：既定は手前`);
      await save();const before=structuredClone(owner(await stored(),overlay).bubbles![0]);
      for(const depth of ['front','behind','front']){
        if(field('重なり')!.value!==depth)await change('重なり',depth);
        await save();const current=await stored(),text=owner(current,overlay).bubbles![0];
        check((text.lettering_depth??'front')===depth,`${label}：${depth}を保存`);
        for(const key of ['text','bbox','speakerId','speaker','paint_overlay','analogTextImport'] as const)check(JSON.stringify(text[key])===JSON.stringify(before[key]),`${label}：${depth}で${key}を維持`);
        const expected=overlay?'.page-overlay-figure-layer':'.panel-art-stack';
        check(!!node(overlay).closest(expected),`${label}：${depth}の実DOM描画階層`);
        const order=[...layerRoot(overlay).querySelectorAll<HTMLElement>('[data-owner-group]')].map(row=>row.dataset.ownerGroup);
        check(order.indexOf('bubble-0')===order.indexOf('figure-0')+(depth==='behind'?1:-1),`${label}：${depth}と人物直上/直下のレイヤー順が同期`);
        check(order.indexOf('bubble-1')<order.indexOf('figure-0'),`${label}：別の文字を番号順へ入れ替えない`);
        const nativeStack=node(overlay).closest(overlay?'.page-overlay-bubble-stack-item':'.panel-bubble-clip')!,figureStack=overlay?nativeStack.parentElement!.querySelector('.page-overlay-figure-artwork')!:nativeStack.parentElement!.querySelector('[data-art-owner="figure-0"]')!;
        check(Boolean(nativeStack.compareDocumentPosition(figureStack)&Node.DOCUMENT_POSITION_FOLLOWING)===(depth==='behind'),`${label}：DOMも人物の直前/直後に同期`);
        const canvas=await captureQwenCompositionCanvas(current.manga,0,0,overlay?'page':'panel',{}, {width:200,height:200}),ctx=canvas.getContext('2d')!;
        const pixel=(x:number,y:number)=>[...ctx.getImageData(x*2,y*2,1,1).data].slice(0,3).join(',');
        check(pixel(42,42)===(depth==='behind'?'221,34,34':'34,68,221'),`${label}：${depth}で人物と描き文字の画素が一致`);
        check(pixel(55,55)===(depth==='behind'?'221,34,34':'34,221,68'),`${label}：${depth}で原字も同じ重なり`);
        const image=document.createElement('img');image.src=canvas.toDataURL();image.alt=`${label} ${depth}`;image.width=100;captures.append(image);canvas.width=canvas.height=1;
      }
      history('元に戻す').click();await settle();check(field('重なり')?.value==='behind',`${label}：Undoで後ろへ戻る`);
      history('やり直す').click();await settle();check(field('重なり')?.value==='front',`${label}：Redoで手前へ戻る`);
      await dragGroup(overlay,'bubble-0','figure-0',true);
      check(field('重なり')?.value==='behind',`${label}：文字を人物の下へドラッグすると後ろ`);
      history('元に戻す').click();await settle();check(field('重なり')?.value==='front',`${label}：レイヤードラッグを1回でUndo`);
      history('やり直す').click();await settle();check(field('重なり')?.value==='behind',`${label}：レイヤードラッグをRedo`);
      await dragGroup(overlay,'figure-0','bubble-0',true);
      check(field('重なり')?.value==='front',`${label}：人物を文字の下へドラッグすると手前`);
      await dragGroup(overlay,'bubble-0','figure-0',true);await save();

      render(null,host);render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'再読込待ち');button('作品フォルダを開く').click();await wait(()=>!!node(overlay),'作品読込待ち');await settle();button('文字のツール一覧').click();await settle();button('情報').click();await settle();await choose(overlay);
      check(field('重なり')?.value==='behind',`${label}：保存再読込で後ろを維持`);
      await change('対応キャラクター','');await save();
      check(!field('重なり')&&!owner(await stored(),overlay).bubbles![0].lettering_depth,`${label}：対応なしで重なりを解除`);
      history('元に戻す').click();await settle();check(field('重なり')?.value==='behind'&&field('対応キャラクター')?.value==='depth-character',`${label}：対応解除のUndoで人物と重なりを一緒に復元`);
    }
    report.textContent=`描き文字の重なり PASS ${checks.length}\n${checks.join('\n')}`;
  }catch(error){report.textContent=`描き文字の重なり FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
  finally{run.disabled=false;controls.style.pointerEvents='';}
}

async function verifyTextOrder(){
  const run=document.getElementById('text-order-run') as HTMLButtonElement,checks:string[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
  const root=(overlay:boolean)=>document.querySelector<HTMLElement>(`.page-layer-palette ${overlay?'.page-direct-layer-group':'.panel-layer-group:not(.page-direct-layer-group)'}`)!;
  const rows=(overlay:boolean)=>[...root(overlay).querySelectorAll<HTMLElement>('[data-owner-group]')].filter(row=>row.dataset.ownerGroup?.startsWith('bubble-'));
  const palette=(overlay:boolean)=>rows(overlay).map(row=>row.dataset.ownerGroup).join(',');
  const node=(overlay:boolean)=>document.querySelector<HTMLElement>(`.spread-pane:not(.is-spread-partner) [data-content-kind="bubble"][data-content-index="0"]${overlay?'[data-content-overlay]':'[data-content-panel="0"]:not([data-content-overlay])'}`)!;
  const reopen=async(overlay:boolean)=>{render(null,host);render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'再起動画面待ち');button('作品フォルダを開く').click();await wait(()=>!!node(overlay),'作品読込待ち');await settle();button('文字のツール一覧').click();await settle();};
  run.disabled=true;controls.style.pointerEvents='none';
  try{
    const assets=[];
    for(const [index,color] of ['#dd2222','#2244dd','#22dd44'].entries()){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=80;const context=canvas.getContext('2d')!;context.fillStyle=color;context.fillRect(0,0,80,80);
      const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png'));
      const asset=await prepareImageAsset(new File([blob],`順序${index+1}.png`,{type:'image/png'}));await saveFigureCropAssets([{id:asset.storageId,blob}]);assets.push(asset);
    }
    for(const overlay of [false,true]){
      render(null,host);const doc=structuredClone(source),page=doc.manga.pages[0],label=overlay?'前景':'コマ';doc.manga.pages=[page];
      page.canvas={w:100,h:100,unit:'mm'};doc.manga.finish_settings={width_mm:100,height_mm:100,dpi:100,bleed_mm:0};doc.manga.image_assets=assets;
      page.panels=[{id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:0,action:null,bubbles:[]}];delete page.page_overlay;
      if(overlay)page.page_overlay={frame:false,layer:'above_panel_frames',bubbles:[]};
      const owner=overlay?page.page_overlay!:page.panels[0],box={x:25,y:25,w:50,h:50};
      owner.bubbles=assets.map((asset,index)=>({text:String(index+1),shape:'handwritten',lettering_guide_hidden:true,bbox:{...box},paint_overlay:createFrameArtwork(asset,box)}));
      for(const [index,bubble] of owner.bubbles.entries()){const ink=bubble.paint_overlay!;ink.paint=paintForFrame(box,assets[index].widthPx*25.4/box.w,[{...ink,id:`order-ink-${index}`,bbox:box}],assets,'color',false);ink.paint.layers.forEach(layer=>{layer.locked=false;});}
      const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(doc)));await writer.close();await reopen(overlay);
      const verifyOrder=async(order:string,pixel:string,stage:string)=>{
        check(palette(overlay)===order,`${label}：${stage}の一覧順`);
        const dom=[...document.querySelectorAll<HTMLElement>(`.spread-pane:not(.is-spread-partner) [data-content-kind="bubble"]${overlay?'[data-content-overlay]':'[data-content-panel="0"]:not([data-content-overlay])'}`)].map(item=>`bubble-${item.dataset.contentIndex}`).reverse().join(',');
        check(dom===order,`${label}：${stage}のDOM描画順`);
        await save();const saved=await stored(),storedOwner=overlay?saved.manga.pages[0].page_overlay!:saved.manga.pages[0].panels[0];
        check(storedOwner.bubbles!.map(item=>item.text).join(',')==='1,2,3',`${label}：${stage}でも本文番号を維持`);
        const canvas=await captureQwenCompositionCanvas(saved.manga,0,0,overlay?'page':'panel',{}, {width:200,height:200});
        check([...canvas.getContext('2d')!.getImageData(100,100,1,1).data].slice(0,3).join(',')===pixel,`${label}：${stage}の書出画素`);canvas.width=canvas.height=1;
      };
      await verifyOrder('bubble-0,bubble-1,bubble-2','221,34,34','初期1・2・3');
      const dest=rows(overlay)[0],sourceEl=rows(overlay)[2].querySelector<HTMLElement>('.layer-group-select')!;
      dest.scrollIntoView({block:'center'});await settle();const from=sourceEl.getBoundingClientRect(),to=dest.getBoundingClientRect();
      const pointer=(type:string,x:number,y:number)=>sourceEl.dispatchEvent(new PointerEvent(type,{pointerId:43,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
      pointer('pointerdown',from.x+from.width/2,from.y+from.height/2);pointer('pointermove',to.x+to.width/2,to.y+to.height*.2);await settle();
      check(dest.classList.contains('drop-above'),`${label}：3を1の上へドラッグ可能`);pointer('pointerup',to.x+to.width/2,to.y+to.height*.2);await settle();
      await verifyOrder('bubble-2,bubble-0,bubble-1','34,221,68','変更3・1・2');
      history('元に戻す').click();await settle();check(palette(overlay)==='bubble-0,bubble-1,bubble-2',`${label}：1回のUndoで初期順へ戻る`);
      history('やり直す').click();await settle();check(palette(overlay)==='bubble-2,bubble-0,bubble-1',`${label}：Redoで変更順へ戻る`);
      await save();await reopen(overlay);await verifyOrder('bubble-2,bubble-0,bubble-1','34,221,68','再読込3・1・2');
    }
    report.textContent=`文字順 PASS ${checks.length}\n${checks.join('\n')}`;
  }catch(error){report.textContent=`文字順 FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
  finally{run.disabled=false;controls.style.pointerEvents='';}
}

async function verify(){
  const run=document.getElementById('inline-run') as HTMLButtonElement,checks:string[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
  run.disabled=true;report.textContent='検証中';
  try{
    if(!nativeBubble())await open();
    button('写植文字').click();await wait(()=>!!button('ボールド'),'文字パレットがありません');await settle();
    const labels=['ボールド','イタリック','下線','取り消し線'];
    for(const label of labels)await toggle(label,true);
    check(nativeBubble().textContent==='ABCDEF'&&history('元に戻す').disabled,'無選択のスタイル操作は既存本文・Undoを変えない');
    button('選択').click();await settle();button('写植文字').click();await settle();
    check(labels.every(label=>button(label).getAttribute('aria-pressed')==='true'),'ツールを持ち替えても4つの状態を保持');
    nativeBubble().click();await wait(()=>!!editor(),'本文編集が開けません');await settle();
    await choose(6);await input('新',true);
    let styled=glyphStyle(editor(),6),plain=glyphStyle(editor(),0);
    check(editor().textContent==='ABCDEF新'&&Number(styled.fontWeight)>=700&&styled.fontStyle==='italic'&&styled.textDecorationLine.includes('underline')&&styled.textDecorationLine.includes('line-through')&&plain.fontWeight==='400'&&plain.textDecorationLine==='none','IMEイベントの確定文字だけへB/I/U/Sを反映');
    for(const label of labels)await toggle(label,false);
    check(glyphStyle(editor(),6).fontStyle==='italic','無選択の解除は入力済みの文字を変更しない');
    await input('平');
    plain=glyphStyle(editor(),7);check(plain.fontWeight==='400'&&plain.fontStyle==='normal'&&plain.textDecorationLine==='none','解除後の次の文字だけが通常スタイル');
    history('元に戻す').click();await settle();check(nativeBubble().textContent==='ABCDEF新','次の入力を1回でUndo');
    history('やり直す').click();await settle();check(nativeBubble().textContent==='ABCDEF新平','Redoが入力とスタイルを復元');
    if(!editor()){nativeBubble().click();await wait(()=>!!editor(),'再編集できません');}
    await choose(1,3);
    for(const label of labels)await toggle(label,true);
    styled=glyphStyle(editor(),1);plain=glyphStyle(editor(),0);
    check(getSelection()?.toString()==='BC'&&styled.fontStyle==='italic'&&styled.textDecorationLine==='underline line-through'&&Number(styled.fontWeight)>=700&&plain.fontWeight==='400'&&plain.textDecorationLine==='none','選択したBCだけへ4種を重ね掛けし選択を保持');
    button('イタリック').click();await settle();
    check(glyphStyle(editor(),1).fontStyle==='normal'&&glyphStyle(editor(),1).textDecorationLine==='underline line-through','もう一度押すとそのスタイルだけ解除');
    await choose(0,3);check(button('下線').getAttribute('aria-pressed')==='mixed','混在した選択範囲を表示');
    button('下線').click();await settle();check([0,1,2].every(i=>glyphStyle(editor(),i).textDecorationLine.includes('underline')),'混在範囲への1クリックは全選択文字をON');
    await save();const saved=await stored(),bubble=saved.manga.pages[0].panels[0].bubbles[0];
    check(bubble.text==='ABCDEF新平'&&textStyleSegments(bubble).some(part=>part.strikethrough&&part.fontWeight!>=700),'実フォルダー保存が本文と範囲書式を保持');
    render(null,host);render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'起動画面待ち');await open();
    check(nativeBubble().textContent==='ABCDEF新平'&&glyphStyle(nativeBubble(),1).textDecorationLine==='underline line-through','保存済み作品を開き直しても表示が一致');
    button('写植文字').click();await settle();
    document.querySelector<HTMLElement>('[data-content-kind="screen_text"][data-content-panel="0"]')!.click();await wait(()=>editor()?.getAttribute('aria-label')==='テキスト2の本文','縦書き編集が開けません');
    await choose(1,3);await toggle('下線',true);await toggle('取り消し線',true);await toggle('イタリック',true);
    check(glyphStyle(editor(),1).writingMode==='vertical-rl'&&glyphStyle(editor(),1).textDecorationLine==='underline line-through','縦書き写植文字も選択した範囲へ適用');
    await save();
    const snapshots=await stored();
    for(const orientation of ['horizontal','vertical'] as const){
    const hashes=new Set<number>();
    for(const decoration of ['plain','italic','underline','strikethrough','fontWeight']){
      const doc=structuredClone(snapshots);doc.manga.pages[0].panels[0].screen_text=[];delete doc.manga.pages[0].page_overlay;
      doc.manga.pages[0].panels[0].bubbles=[{text:'文字AB',shape:'normal',bbox:{x:50,y:35,w:90,h:50},text_style:{font:'Hiragino Sans',fontWeight:decoration==='fontWeight'?700:400,fontSize:24,orientation,...(decoration==='italic'?{italic:true}:{}),...(decoration==='underline'?{underline:true}:{}),...(decoration==='strikethrough'?{strikethrough:true}:{})}}];
      const canvas=await captureQwenCompositionCanvas(doc.manga,0,0,'page',{}, {width:364,height:514});let hash=2166136261;
      for(const byte of canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data){hash^=byte;hash=Math.imul(hash,16777619);}hashes.add(hash>>>0);canvas.width=canvas.height=1;
    }
    check(hashes.size===5,`${orientation==='horizontal'?'横':'縦'}書きの実Canvas画素でも4種がそれぞれ装飾なしの文字と異なる`);
    }
    report.textContent=`PASS ${checks.length}\n${checks.join('\n')}`;
  }catch(error){report.textContent=`FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
  finally{run.disabled=false;}
}

/** The same real editor, folder and export path used by the inline-style check. */
async function verifyAlignment(){
  const control=document.getElementById('alignment-run') as HTMLButtonElement,checks:string[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
  const near=(a:number,b:number)=>Math.abs(a-b)<1;
  const textRect=(root:HTMLElement,start:number,end:number)=>{
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),range=document.createRange();let at=0,started=false;
    while(walker.nextNode()){const node=walker.currentNode,length=node.textContent!.length;if(!started&&start<=at+length){range.setStart(node,start-at);started=true;}if(started&&end<=at+length){range.setEnd(node,end-at);return range.getBoundingClientRect();}at+=length;}
    throw Error('行の文字範囲がありません');
  };
  control.disabled=true;report.textContent='行揃え検証中';
  try{
    const fresh=structuredClone(source),panel=fresh.manga.pages[0].panels[0];
    panel.bubbles[0].text='あいうえお\nかき';panel.bubbles[0].text_runs=[{start:1,end:3,underline:true,italic:true}];
    panel.screen_text![0].text='あいうえお\nかき';
    render(null,host);const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(fresh)));await writer.close();render(<App/>,host);
    await wait(()=>!!button('作品フォルダを開く'),'起動画面待ち');await open();button('写植文字').click();await settle();
    check(button('左寄せ').getAttribute('aria-pressed')==='true','行揃えの初期値は左寄せ');
    button('中央寄せ').click();await settle();
    check(history('元に戻す').disabled&&getComputedStyle(nativeBubble()).textAlign==='start','未選択の行揃えは既存文字とUndoを変えない');
    button('選択').click();await settle();button('写植文字').click();await settle();
    check(button('中央寄せ').getAttribute('aria-pressed')==='true','道具を持ち替えても新規文字の中央寄せを保持');
    const paper=document.querySelector<HTMLElement>('.manga-paper')!,box=paper.getBoundingClientRect();
    paper.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0,detail:1,clientX:box.x+110/182*box.width,clientY:box.y+100/257*box.height}));
    await wait(()=>editor()?.getAttribute('aria-label')==='テキスト3の本文','クリックした場所に写植文字が作成されません');await input('新しい文字\n短');await save();
    check((await stored()).manga.pages[0].panels[0].screen_text!.at(-1)!.text_style?.textAlign==='center','次にクリックして作成した文字領域へ中央寄せを保存');
    button('選択').click();await settle();button('写植文字').click();await settle();nativeBubble().click();await wait(()=>editor()?.getAttribute('aria-label')==='テキスト1の本文','吹き出しを編集できません');await choose(1,3);
    button('中央寄せ').click();await settle();
    check(getSelection()?.toString()==='いう'&&getComputedStyle(editor()).textAlign==='center','部分選択中でも文字群全体を揃えて文字選択を保持');
    history('元に戻す').click();await settle();check(getComputedStyle(nativeBubble()).textAlign==='start','行揃えを1回のUndoで戻す');
    history('やり直す').click();await settle();check(getComputedStyle(nativeBubble()).textAlign==='center','Redoで行揃えを復元');
    for(const vertical of [false,true]){
      button('選択').click();await settle();button('写植文字').click();await settle();
      const target=vertical?document.querySelector<HTMLElement>('[data-content-kind="screen_text"][data-content-panel="0"][data-content-index="0"]')!:nativeBubble();target.click();
      await wait(()=>editor()?.getAttribute('aria-label')===(vertical?'テキスト2の本文':'テキスト1の本文'),'文字群を編集できません');await choose(1,3);
      let originalRect:DOMRect|undefined;
      for(const [label,factor] of [['左寄せ',0],['中央寄せ',.5],['右寄せ',1]] as const){
        button(label).click();await settle();const long=textRect(editor(),0,5),short=textRect(editor(),6,8),group=editor().getBoundingClientRect();
        const gap=vertical?short.top-long.top:short.left-long.left,space=vertical?long.height-short.height:long.width-short.width;
        check(near(gap,space*factor),`${vertical?'縦':'横'}書きの${label}で短い行の実位置が一致`);
        if(originalRect)check(near(group.x,originalRect.x)&&near(group.y,originalRect.y)&&near(group.width,originalRect.width)&&near(group.height,originalRect.height),`${vertical?'縦':'横'}書きの文字群の位置と大きさを保持`);else originalRect=group;
      }
    }
    await save();const saved=await stored(),bubble=saved.manga.pages[0].panels[0].bubbles[0],screen=saved.manga.pages[0].panels[0].screen_text![0];
    check(bubble.text_style?.textAlign==='right'&&screen.text_style?.textAlign==='right'&&JSON.stringify(bubble.text_runs)===JSON.stringify(panel.bubbles[0].text_runs)&&JSON.stringify(bubble.bbox)===JSON.stringify(panel.bubbles[0].bbox)&&JSON.stringify(screen.bbox)===JSON.stringify(panel.screen_text![0].bbox),'保存でも全体の行揃え・部分スタイル・枠を保持');
    render(null,host);render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'再起動待ち');await open();
    check(getComputedStyle(nativeBubble()).textAlign==='end','作品を開き直しても右寄せを保持');
    for(const orientation of ['horizontal','vertical'] as const){
      const hashes=new Set<number>();
      for(const textAlign of ['left','center','right'] as const){
        const doc=structuredClone(saved);doc.manga.pages[0].panels[0].screen_text=[];delete doc.manga.pages[0].page_overlay;
        const text=doc.manga.pages[0].panels[0].bubbles[0];text.text_style={...text.text_style,orientation,textAlign};
        const canvas=await captureQwenCompositionCanvas(doc.manga,0,0,'page',{}, {width:364,height:514});let hash=2166136261;
        for(const byte of canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data){hash^=byte;hash=Math.imul(hash,16777619);}hashes.add(hash>>>0);canvas.width=canvas.height=1;
      }
      check(hashes.size===3,`${orientation==='horizontal'?'横':'縦'}書きの実Canvasでも3種の行揃えを描き分ける`);
    }
    report.textContent=`行揃え PASS ${checks.length}\n${checks.join('\n')}`;
  }catch(error){report.textContent=`行揃え FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
  finally{control.disabled=false;}
}


/** No generation request: verify editing, selection, locks and persistence only. */
async function verifyHandwritten(){
  const run=document.getElementById('handwritten-run') as HTMLButtonElement,checks:string[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
  const section=()=>document.querySelector<HTMLElement>('.handwritten-text-section')!;
  const cards=()=>[...section().querySelectorAll<HTMLElement>('.selectable-card')];
  const field=(index:number,label:string)=>[...cards()[index].querySelectorAll<HTMLLabelElement>('label.field')].find(node=>node.querySelector('.field-label')?.textContent===label)!.querySelector<HTMLTextAreaElement>('textarea')!;
  const change=async(index:number,label:string,value:string)=>{const area=field(index,label);area.focus();area.value=value;area.dispatchEvent(new Event('input',{bubbles:true}));await settle();area.blur();};
  const node=(index:number,overlay=false)=>document.querySelector<HTMLElement>(`[data-content-kind="bubble"][data-content-index="${index}"]${overlay?'[data-content-overlay]':'[data-content-panel="0"]:not([data-content-overlay])'}`)!;
  const guide=(index:number)=>cards()[index].querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const generate=(index:number)=>[...cards()[index].querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.includes('描き文字を生成'))!;
  const choose=async(index:number,overlay=false)=>{node(index,overlay).click();await settle();};
  const reload=async()=>{render(null,host);render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'再起動待ち');await open();};
  run.disabled=true;report.textContent='描き文字の編集を検証中';
  try{
    render(null,host);const doc=structuredClone(source),panel=doc.manga.pages[0].panels[0];
    panel.bubbles.push({text:'ドン',shape:'handwritten',lettering_description:'太い線',bbox:{x:60,y:90,w:60,h:35}},
      {text:'ふわっ',shape:'handwritten',locked:true,bbox:{x:70,y:130,w:60,h:30}});
    doc.manga.pages[0].page_overlay!.bubbles!.push({text:'前景描き文字',shape:'handwritten',bbox:{x:80,y:210,w:70,h:30}});
    const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(doc)));await writer.close();render(<App/>,host);
    await wait(()=>!!button('作品フォルダを開く'),'起動待ち');await open();button('選択').click();await settle();await choose(1);
    check(cards().length===2&&field(0,'文字').value==='ドン','コマ情報には描き文字だけを表示');
    check(field(1,'文字').disabled&&field(1,'描き方').disabled&&!generate(1).disabled&&getComputedStyle(generate(1)).pointerEvents!=='none','手動ロック中は入力不可、生成操作は可能');
    button('写植文字').click();await settle();button('情報').click();await settle();
    check(document.querySelector<HTMLSelectElement>('.bubble-info-content [aria-label="文字の種類"]')?.value==='handwritten','文字パレットの情報タブに選択中の描き文字を表示');
    button('選択').click();await settle();await choose(1);
    await change(0,'文字','ド  ン！\nドン');await save();
    check((await stored()).manga.pages[0].panels[0].bubbles[1].text==='ド  ン！\nドン','本文の連続空白と改行を保存');
    await change(0,'描き方','太く角張る');history('元に戻す').click();await settle();
    check(field(0,'描き方').value==='太い線','描き方をUndoできる');history('やり直す').click();await settle();
    check(field(0,'描き方').value==='太く角張る','描き方をRedoできる');
    guide(0).click();await settle();check(!node(1).querySelector('.bubble-text-content'),'文字あたりだけを非表示にする');
    check(node(0).querySelector('.bubble-text-content')?.textContent==='ABCDEF','通常吹き出しの文字は維持');
    history('元に戻す').click();await settle();check(!!node(1).querySelector('.bubble-text-content'),'表示切替をUndoできる');
    history('やり直す').click();await settle();await save();
    const baseline=(await stored()).manga.pages[0].panels[0];
    check(baseline.bubbles[1].lettering_guide_hidden===true&&baseline.bubbles[1].text==='ド  ン！\nドン','非表示でも本文と描き方を保持して保存');
    await choose(1,true);check(cards().length===1&&field(0,'文字').value==='前景描き文字','前景選択で描き文字一覧を切替');
    await change(0,'描き方','細い線');guide(0).click();await settle();await save();
    check(!node(1,true).querySelector('.bubble-text-content'),'前景の文字あたりも非表示にする');
    check(JSON.stringify((await stored()).manga.pages[0].panels[0])===JSON.stringify(baseline),'前景の編集はコマ内の同番号を変更しない');
    await reload();button('選択').click();await settle();await choose(1);
    check(field(0,'描き方').value==='太く角張る'&&!guide(0).checked&&!node(1).querySelector('.bubble-text-content'),'再読込でコマの本文・描き方・非表示を復元');
    section().querySelector<HTMLButtonElement>('.inline-add')!.click();await settle();
    check(cards().length===3&&field(2,'文字').value===''&&generate(2).disabled,'新規描き文字を追加し空本文の生成を拒否');
    await change(2,'文字','ザッ');check(!generate(2).disabled,'本文入力で生成操作を有効にする');
    cards()[2].querySelector<HTMLButtonElement>('.nested-card-head button')!.click();await settle();check(cards().length===2,'描き文字を既存削除経路で削除');
    history('元に戻す').click();await settle();check(cards().length===3&&field(2,'文字').value==='ザッ','削除をUndoできる');
    await choose(1,true);check(field(0,'描き方').value==='細い線'&&!guide(0).checked,'再読込で前景の描き方と非表示を復元');
    // Existing canvas menus must expose generation only for handwritten content.
    node(0,true).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:220}));await settle();
    check(![...document.querySelectorAll('[role="menuitem"]')].some(n=>/生成/.test(n.textContent??'')),'通常吹き出しのメニューに単品生成を表示しない');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await settle();
    node(1,true).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:220}));await settle();
    check([...document.querySelectorAll('[role="menuitem"]')].some(n=>n.textContent==='描き文字を生成'),'描き文字のメニューに既存生成入口を表示');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await settle();
    const lockedDoc=await stored();lockedDoc.manga.pages[0].panels[0].layer={...lockedDoc.manga.pages[0].panels[0].layer,locked:true};
    render(null,host);const lockWriter=await project.createWritable();await lockWriter.write(JSON.stringify(await createPortableProject(lockedDoc)));await lockWriter.close();
    render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'ロック作品待ち');await open();
    check(field(0,'文字').disabled&&field(0,'描き方').disabled&&!generate(0).disabled&&!generate(0).closest('[inert],[aria-disabled="true"]')&&getComputedStyle(generate(0)).pointerEvents!=='none','コマ全体のロック中も手動入力だけを禁止し生成操作を保持');
    report.textContent=`PASS ${checks.length}\n${checks.join('\n')}`;
  }catch(error){report.textContent=`FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
  finally{run.disabled=false;}
}
