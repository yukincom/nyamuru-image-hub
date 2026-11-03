/** Real App/editor integration on an isolated origin, using only a disposable browser folder. */
import {exitPaintWithEscape} from './exitPaintWithEscape';
import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {createPortableProject} from '../src/lib/portableProject';
import {textStyleSegments} from '../src/lib/textStyle';
import {captureQwenCompositionCanvas} from '../src/lib/qwenComposition';
import {prepareImageAsset,createFrameArtwork} from '../src/lib/imagePlacement';
import {saveFigureCropAssets} from '../src/lib/figureCropStore';
import {paintForFrame,newPaintLayer,paintReferenceBox} from '../src/lib/paintDocument';
import {renderPaintPng,paintPreviewRenderer,loadPaintImages} from '../src/lib/paintRenderer';
import {isLanClient} from '../src/lib/clientRuntime';
import {defaultVectorStyle,vectorShape} from '../src/lib/vectorGeometry';
import type {MangaDocument,PlacedImage,ImageAsset,Figure,Bubble,PaintDocument} from '../src/types';
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
render(<><button onClick={()=>{controls.hidden=true;}}>検証パネルを閉じる</button><button id="inline-run" onClick={()=>void verify()}>スタイルを一括検証</button><button id="alignment-run" onClick={()=>void verifyAlignment()}>行揃えを一括検証</button><button id="bubble-info-run" onClick={()=>void verifyBubbleInfo()}>情報タブを一括検証</button><button id="depth-run" onClick={()=>void verifyLetteringDepth()}>描き文字の重なりを検証</button><button id="text-order-run" onClick={()=>void verifyTextOrder()}>文字の初期順と保存を検証</button><button id="layer-add-run" onClick={()=>void verifyLayerAdd()}>レイヤー追加ルールを検証</button><button id="layer-paint-run" onClick={()=>void verifyLayerPaintOrder()}>追加レイヤーの描画順を検証</button><button id="layer-move-run" onClick={()=>void verifyLayerMoves()}>レイヤーの所属移動を検証</button><button id="selection-layer-run" onClick={()=>void verifySelectionLayerTools()}>選択ツールとレイヤーを検証</button><button id="generation-owner-run" onClick={()=>void verifyGenerationOwner()}>生成マスクの独立操作を検証</button><button id="layer-continuity-run" onClick={()=>void verifyLayerMoveContinuity()}>移動中の状態保持を検証</button><button id="palette-stress-run" onClick={()=>void verifyToolPaletteStress()}>ツールパレット往復を検証</button><button id="folder-space-run" onClick={()=>void verifyFolderSpacePan()}>フォルダー選択後のSpaceを検証</button><button id="inline-inspect" onClick={()=>void inspect()}>保存データを表示</button><pre id="inline-report" style={{maxHeight:'180px',overflow:'auto',whiteSpace:'pre-wrap'}}>検証用の作品フォルダを用意しました。</pre><div id="inline-captures"/></>,controls);
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
  const layerRoot=(overlay:boolean)=>document.querySelector<HTMLElement>(`.page-layer-palette ${overlay?'.page-panel-outside-layers:not([data-before-panel])':'.panel-layer-group'}`)!;
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
  const root=(overlay:boolean)=>document.querySelector<HTMLElement>(`.page-layer-palette ${overlay?'.page-panel-outside-layers:not([data-before-panel])':'.panel-layer-group'}`)!;
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



async function verifyLayerAdd(){
  const run=document.getElementById('layer-add-run') as HTMLButtonElement,checks:string[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
  const palette=()=>document.querySelector<HTMLElement>('.page-layer-palette')!;
  const row=(name:string)=>[...(palette()?.querySelectorAll<HTMLElement>('[data-layer]')??[])].find(node=>node.querySelector('.layer-name-line')?.textContent===name)!;
  const current=(name:string)=>Boolean(row(name)?.classList.contains('is-selected'));
  const add=async(name:string,kind='raster')=>{button(kind==='vector'?'ベクターレイヤー追加':'ラスターレイヤー追加').click();await wait(()=>current(name),`${name}の追加待ち`);await settle();};
  const choose=async(label:string)=>{const b=button(label);if(!b)throw Error(`操作なし: ${label}`);b.click();await settle();await wait(()=>{const b=button('ラスターレイヤー追加');return Boolean(b&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');},`${label}の切替待ち`);};
  const rename=async(name:string,value:string,key='Enter')=>{
    row(name).querySelector('button.layer-select')!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await settle();
    const field=palette().querySelector<HTMLInputElement>('[aria-label="レイヤー名"]')!;if(!field)throw Error('名称入力なし');
    field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));await settle();field.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));await settle();
  };
  const tree=(owner:string)=>[...palette().querySelectorAll<HTMLElement>(`[data-owner="${owner}"][data-layer]`)].map(node=>node.querySelector('.layer-name-line')?.textContent);
  const reopen=async()=>{render(null,host);render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'再起動画面待ち');await open();};
  run.disabled=true;report.textContent='レイヤー追加を検証中';
  try{
    render(null,host);const doc=structuredClone(source),page=doc.manga.pages[0];
    page.panels[0].figures=[{name:'人物A',kind:'person',bbox:{x:30,y:80,w:50,h:65}}];
    page.panels.push({id:2,shape:{type:'rect',x:15,y:220,w:150,h:25},bg:0,action:null,bubbles:[]});
    doc.manga.pages.push({...structuredClone(source.manga.pages[0]),page:2});
    page.page_overlay=undefined;doc.manga.pages[1].page_overlay=undefined;
    const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(doc)));await writer.close();
    render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'起動画面待ち');await open();
    await choose('コマ 02を選択');button('ペン').click();await wait(()=>!!host.querySelector('.is-painting'),'描画開始');await settle();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true,cancelable:true}));
    await wait(()=>!!palette().querySelector('[data-before-panel="2"] .layer-user-folder'),'閉鎖コマ外のフォルダー追加');
    check(Boolean(palette().querySelector('[data-before-panel="2"] .layer-user-folder')),'初期状態で閉じたコマもFキーで外側へ追加');
    history('元に戻す').click();await settle();
    await choose('コマ 01の枠を選択');await add('レイヤー 1');
    check(row('レイヤー 1').closest('.panel-layer-group')?.getAttribute('aria-label')==='コマ 01','コマ枠選択でコマ内へ追加');
    const panelTree=row('レイヤー 1').closest('.panel-layer-children')!;
    check(Boolean(panelTree.querySelector('.panel-frame-layer')!.compareDocumentPosition(row('レイヤー 1'))&Node.DOCUMENT_POSITION_FOLLOWING),'固定最上段のコマ枠直下に新規レイヤー');
    await add('レイヤー 2','vector');check(tree('panel').join(',')==='レイヤー 1,レイヤー 2','ラスターとベクターを統一名で選択レイヤー直下に追加');
    await rename('レイヤー 2','');check(current('レイヤー 2'),'空欄のEnter確定で元名を保持');
    await rename('レイヤー 2','別名','Escape');check(current('レイヤー 2'),'Escapeで元名を保持');
    await rename('レイヤー 2','人物線');check(current('人物線'),'名称変更を一度で確定');
    history('元に戻す').click();await settle();check(current('レイヤー 2'),'名称変更を一回でUndo');
    history('やり直す').click();await settle();check(current('人物線'),'名称変更を一回でRedo');
    await add('レイヤー 3');check(tree('panel').join(',')==='レイヤー 1,人物線,レイヤー 3','名前の欠番を埋めず次の番号を追加');
    await choose('コマ 01の枠を選択');button('フォルダー追加').click();await wait(()=>!!button('フォルダー 1を選択'),'フォルダー作成');await settle();
    await add('レイヤー 4');const folder=row('レイヤー 4').closest('.layer-user-folder')!;check(Boolean(folder),'展開中フォルダーの中へ追加');
    await add('レイヤー 5','vector');check([...folder.querySelectorAll('.layer-name-line')].map(n=>n.textContent).join(',')==='レイヤー 4,レイヤー 5','フォルダー内レイヤーの直下へ追加');
    await choose('フォルダー 1を選択');button('フォルダー 1を折りたたむ').click();await settle();await add('レイヤー 6');
    check(!row('レイヤー 6').closest('.layer-user-folder'),'閉じたフォルダーの外へ追加');
    check(Boolean(folder.compareDocumentPosition(row('レイヤー 6'))&Node.DOCUMENT_POSITION_FOLLOWING),'閉じたフォルダー直下へ配置');
    button('フォルダー 1を展開').click();await settle();await choose('フォルダー 1を選択');await add('レイヤー 7');
    check([...row('レイヤー 7').closest('.layer-user-folder')!.querySelectorAll('.layer-name-line')][0].textContent==='レイヤー 7','展開中フォルダーを選ぶと中の最上段');
    await choose('フォルダー 1を選択');button('フォルダー 1を固定').click();await settle();await add('レイヤー 8');
    check(!row('レイヤー 8').closest('.layer-user-folder'),'固定中フォルダーへ編集可能レイヤーを入れない');
    await choose('コマ 01の枠を選択');button('コマ 01を折りたたむ').click();await settle();await add('レイヤー 9');
    check(row('レイヤー 9').closest('[data-before-panel]')?.getAttribute('data-before-panel')==='1','閉じたコマ枠選択からはコマ外のバー上');
    await choose('コマ 02を選択');await add('レイヤー 10','vector');
    check(row('レイヤー 10').closest('[data-before-panel]')?.getAttribute('data-before-panel')==='2','コマ 02バー選択ではそのバー上のコマ外');
    button('コマ 02を展開').click();await settle();await choose('コマ 02の枠を選択');await add('レイヤー 11');
    check(row('レイヤー 11').closest('.panel-layer-group')?.getAttribute('aria-label')==='コマ 02','別コマ内でもページ共通の連番');
    await save();let saved=(await stored()).manga.pages;check(saved[0].paint_layer_sequence===11,'ページの採番を保存');
    check(saved[0].images?.filter(i=>i.paintStack&&'beforePanel' in i.paintStack).length===2,'コマ 01と02の外側を独立して保存');
    button('次のページ').click();await settle();await choose('コマ 01の枠を選択');await add('レイヤー 1');await save();
    saved=(await stored()).manga.pages;check(saved[1].paint_layer_sequence===1&&saved[0].paint_layer_sequence===11,'別ページは1から始まり元ページの番号を保持');
    button('前のページ').click();await settle();await reopen();await choose('コマ 01の枠を選択');await add('レイヤー 12');
    check(current('レイヤー 12'),'保存・再読込後も次番号へ進む');
    // Native folders and their text rows have separate insertion positions.
    await choose('テキスト1の文字を選択').catch(async()=>{button('テキスト1を展開').click();await settle();await choose('テキスト1の文字を選択');});
    await add('レイヤー 13');await save();saved=(await stored()).manga.pages;
    check(!saved[0].panels[0].bubbles[0].paint_overlay?.paint?.layers.find(l=>l.name==='レイヤー 13')?.aboveNative,'文字レイヤーの直下は同じフォルダーの文字より下');
    await choose('コマ 01の枠を選択');const group=palette().querySelector<HTMLElement>('[data-owner-group="bubble-0"]')!;group.querySelector<HTMLButtonElement>('.layer-group-select')!.click();await settle();await add('レイヤー 14');await save();saved=(await stored()).manga.pages;
    check(saved[0].panels[0].bubbles[0].paint_overlay?.paint?.layers.find(l=>l.name==='レイヤー 14')?.aboveNative===true,'展開中テキストフォルダーでは文字の手前へ追加');
    await choose('コマ 01の枠を選択');button('テキスト1を折りたたむ').click();await settle();palette().querySelector<HTMLButtonElement>('[data-owner-group="bubble-0"] .layer-group-select')!.click();await settle();await add('レイヤー 15');await save();saved=(await stored()).manga.pages;
    check(saved[0].panels[0].images?.some(i=>i.paintStack&&'below' in i.paintStack&&i.paintStack.below===`layer:${saved[0].panels[0].bubbles[0].layerId}`&&i.paint?.layers.some(l=>l.name==='レイヤー 15'))===true,'閉じたテキストフォルダーの外側直下を保存');
    report.textContent=`PASS ${checks.length}\n`+checks.join('\n');report.dataset.result='pass';
  }catch(error){report.textContent=`FAIL after ${checks.length}\n${String(error)}\n`+checks.join('\n');report.dataset.result='fail';console.error(error);}
  finally{run.disabled=false;}
}

async function verifyLayerPaintOrder(){
  const run=document.getElementById('layer-paint-run') as HTMLButtonElement,checks:string[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
  run.disabled=true;report.textContent='レイヤー描画順を検証中';
  try{
    const assets:ImageAsset[]=[];
    for(const [name,color] of [['下側','#dd2222'],['手前','#2244dd'],['外側','#22dd44']]){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=80;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,80,80);
      const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png'));
      const asset=await prepareImageAsset(new File([blob],`${name}.png`,{type:'image/png'}));await saveFigureCropAssets([{id:asset.storageId,blob}]);assets.push(asset);
    }
    for(const overlay of [false,true]){
      const doc=structuredClone(source),page=doc.manga.pages[0],label=overlay?'前景':'コマ',box={x:25,y:25,w:50,h:50},whole={x:0,y:0,w:100,h:100};
      doc.manga.pages=[page];page.canvas={w:100,h:100,unit:'mm'};doc.manga.finish_settings={width_mm:100,height_mm:100,dpi:100,bleed_mm:0};doc.manga.image_assets=assets;
      page.panels=[{id:1,shape:{type:'rect',...whole},bg:0,action:null,bubbles:[]}];page.page_overlay=overlay?{frame:false,layer:'above_panel_frames',bubbles:[]}:undefined;
      const native=overlay?page.page_overlay!:page.panels[0];
      const image=(index:number,frame=box)=>({...createFrameArtwork(assets[index],frame),id:`order-${index}`,bbox:frame});
      const ink=paintForFrame(box,80*25.4/50,[image(0),image(1)],assets,'color',false);
      ink.layers.forEach((layer,index)=>{layer.name=index?'手前検証':'下側検証';layer.locked=false;layer.aboveNative=index===1;});
      native.bubbles=[{text:'MMMM',shape:'square',tail:false,layerId:'stable-text',bbox:box,text_style:{font:'Hiragino Sans',fontSize:24,fontWeight:700,orientation:'horizontal'},paint_overlay:{...image(0),paint:ink}}];
      const direct:PlacedImage=image(2,whole);direct.paint=paintForFrame(whole,80*25.4/100,[direct],assets,'color',false);
      const sibling={...direct,paintScope:overlay?'page' as const:'panel' as const,paintStack:{below:'layer:stable-text'}};
      if(overlay)page.images=[sibling];else page.panels[0].images=[sibling];
      for(const band of ['outside','below','above']){
        ink.layers[0].visible=band!=='outside';ink.layers[1].visible=band==='above';
        const canvas=await captureQwenCompositionCanvas(doc.manga,0,0,overlay?'page':'panel',{}, {width:200,height:200});
        const ctx=canvas.getContext('2d')!,pixel=(x:number,y:number)=>[...ctx.getImageData(x*2,y*2,1,1).data].slice(0,3).join(',');
        check(pixel(15,15)==='34,221,68',`${label}：${band}の外側直下は文字の外に表示`);
        check(pixel(30,30)===(band==='outside'?'255,255,255':band==='below'?'221,34,34':'34,68,221'),`${label}：${band}の文字内の画素順`);
        const data=ctx.getImageData(65,65,70,70).data;let dark=0;for(let i=0;i<data.length;i+=4)if(data[i]<70&&data[i+1]<70&&data[i+2]<70)dark++;
        check(band==='above'?dark===0:dark>0,`${label}：${band==='above'?'手前の絵で文字が隠れる':'文字が絵の手前に残る'}`);
        const captures=document.getElementById('inline-captures')!;captures.replaceChildren(canvas);canvas.style.width='160px';canvas.style.height='160px';
      }
      if(overlay){
        for(let id=2;id<=5;id++)page.panels.push({id,layerId:`panel-${id}`,shape:{type:'rect',...whole},bg:0,action:null,bubbles:[]});
        const free=(name:string,stack?:PlacedImage['paintStack']):PlacedImage=>({...direct,id:crypto.randomUUID(),opacity:0,paintScope:'page',paintStack:stack,paint:{...structuredClone(direct.paint!),layers:direct.paint!.layers.map(layer=>({...structuredClone(layer),id:crypto.randomUUID(),name,opacity:0}))}});
        page.images!.push(free('ページ直下検証'),free('コマ05直上検証',{beforePanel:'layer:panel-5'}));
      }
      render(null,host);const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(doc)));await writer.close();
      render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'描画順作品の起動');button('作品フォルダを開く').click();await wait(()=>!!document.querySelector('.manga-paper [data-content-kind="bubble"]'),'描画順作品の読込');await settle();
      if(overlay){
        const palette=document.querySelector<HTMLElement>('.page-layer-palette')!,row=(name:string)=>[...palette.querySelectorAll<HTMLElement>('[data-layer]')].find(node=>node.querySelector('.layer-name-line')?.textContent===name)!;
        const root=row('ページ直下検証'),fifth=row('コマ05直上検証'),section=root.closest<HTMLElement>('.page-panel-outside-layers')!,fifthSection=fifth.closest<HTMLElement>('.page-panel-outside-layers')!;
        check(!palette.querySelector('.page-direct-layer-group,.page-direct-layer-actions')&&!root.closest('.panel-layer-group,.layer-group,.layer-user-folder'),'ページ直下にコマ外フォルダーを作らない');
        check(Boolean(section.compareDocumentPosition(palette.querySelector('.panel-layer-group')!)&Node.DOCUMENT_POSITION_FOLLOWING),'ページ直下の通常レイヤーはコマ01バーより上');
        check(section.className===fifthSection.className&&!fifth.closest('.panel-layer-group,.layer-group,.layer-user-folder'),'ページ直下とコマ05バー上は同じ通常レイヤー表示');
        check(fifthSection.dataset.beforePanel==='5'&&fifthSection.nextElementSibling?.getAttribute('aria-label')==='コマ 05','コマ05バー上のレイヤー位置を保持');
      }
      const pane=document.querySelector<HTMLElement>('.spread-pane:not(.is-spread-partner)')!;
      const selector=`[data-content-kind="bubble"]${overlay?'[data-content-overlay]':':not([data-content-overlay])'}`;
      const nativeNode=pane.querySelector<HTMLElement>(selector)!,group=nativeNode.parentElement!;
      const front=group.querySelector<HTMLElement>('.bubble-paint-front')!,below=group.querySelector<HTMLElement>('.direct-paint-stack')!;
      check(Number(getComputedStyle(front).zIndex)>Number(getComputedStyle(nativeNode).zIndex)&&Boolean(below.compareDocumentPosition(nativeNode)&Node.DOCUMENT_POSITION_FOLLOWING),`${label}：通常DOMも外側・文字・手前の順`);
      button('テキスト1を展開').click();await settle();
      const frontRow=[...document.querySelectorAll<HTMLElement>('.layer-row[data-layer]')].find(row=>row.querySelector('.layer-name-line')?.textContent==='手前検証')!;
      frontRow.querySelector<HTMLButtonElement>('button.layer-select')!.click();await wait(()=>!!document.querySelector('.app-shell.is-painting'),'描画モード待ち');
      button('コマ情報を閉じる')?.click();button('ページ一覧を閉じる')?.click();await settle();
      await wait(()=>{const c=pane.querySelector<HTMLCanvasElement>('.bubble-paint-front canvas');return Boolean(c&&c.width>1&&c.height>1);},'手前preview待ち');await settle();
      const preview=pane.querySelector<HTMLCanvasElement>('.bubble-paint-front canvas')!,rgb=[...preview.getContext('2d')!.getImageData(preview.width/2,preview.height/2,1,1).data].slice(0,3).join(',');
      check(rgb==='34,68,221',`${label}：編集previewでも手前帯の青を維持`);
      await save();const saved=await stored();check((overlay?saved.manga.pages[0].images:saved.manga.pages[0].panels[0].images)?.some(image=>image.paintStack&&'below' in image.paintStack&&image.paintStack.below==='layer:stable-text')===true,`${label}：保存後も安定した所属を保持`);
    }
    report.textContent=`描画順 PASS ${checks.length}\n${checks.join('\n')}`;
  }catch(error){report.textContent=`描画順 FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
  finally{run.disabled=false;}
}


async function verifyLayerMoves(){
 const run=document.getElementById('layer-move-run') as HTMLButtonElement,checks:string[]=[];
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
 const palette=()=>document.querySelector<HTMLElement>('.page-layer-palette')!;
 const row=(id:string)=>[...(palette()?.querySelectorAll<HTMLElement>('[data-layer]')??[])].find(node=>node.dataset.layer===id)!;
 const panel=(index:number)=>palette().querySelector<HTMLElement>(`.panel-layer-group[aria-label="コマ 0${index+1}"]`)!;
 const group=(index:number,key:string)=>panel(index).querySelector<HTMLElement>(`[data-owner-group="${key}"]`)!;
 const location=(id:string)=>{const node=row(id),host=node?.closest<HTMLElement>('[data-paint-panel]');return node?`${host?.dataset.paintOverlay}/${host?.dataset.paintPanel}/${node.dataset.owner}`:'';};
 const drag=async(source:HTMLElement,target:HTMLElement,ratio=.5,cancel=false,probe?:(marker:HTMLElement)=>void|Promise<void>)=>{
   target.scrollIntoView({block:'center'});await settle();const a=source.getBoundingClientRect(),b=target.getBoundingClientRect(),pointerId=94;
   const x=a.left+a.width/2,y=a.top+a.height/2,tx=b.left+b.width/2,ty=b.top+b.height*ratio;
   source.dispatchEvent(new PointerEvent('pointerdown',{pointerId,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
   if(!source.classList.contains('is-dragging'))throw Error('レイヤーのドラッグ開始');
   source.dispatchEvent(new PointerEvent('pointermove',{pointerId,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:tx,clientY:ty,bubbles:true,cancelable:true}));
   if(!source.dataset.dragTarget)throw Error(`移動先が見つかりません: ${target.outerHTML.slice(0,160)} hit=${document.elementFromPoint(tx,ty)?.outerHTML.slice(0,160)}`);
   const markers=[...palette().querySelectorAll<HTMLElement>('[data-layer-drop].drop-above,[data-layer-drop].drop-below,[data-layer-drop].drop-inside')];if(markers.length!==1)throw Error(`同時に表示されたマーカー: ${markers.length}`);await probe?.(markers[0]);
   source.dispatchEvent(new PointerEvent(cancel?'pointercancel':'pointerup',{pointerId,pointerType:'mouse',isPrimary:true,button:0,buttons:0,clientX:tx,clientY:ty,bubbles:true,cancelable:true}));if(!cancel)source.click();await settle();
 };
 const tools=()=>JSON.stringify([...document.querySelectorAll<HTMLElement>('.paint-tool-icons [aria-pressed],.paint-colors [aria-pressed],.paint-size [aria-checked]')].map(node=>[node.getAttribute('aria-label'),node.getAttribute('aria-pressed'),node.getAttribute('aria-checked')]));
 const move=async(id:string,target:HTMLElement,expected:string,ratio=.5)=>{
   if(!row(id).classList.contains('is-selected')){row(id).querySelector<HTMLButtonElement>('.layer-select')!.click();await wait(()=>row(id).classList.contains('is-selected'),'移動対象の選択');await settle();}
   const surface=document.querySelector('.paint-input'),before=tools();
   await drag(row(id).querySelector<HTMLElement>('.layer-select')!,target,ratio);await wait(()=>location(id)===expected&&row(id).classList.contains('is-selected'),`移動待ち: ${expected} / ${location(id)}`);await settle();
   check(document.querySelector('.paint-input')===surface,`${expected}: 描画面を閉じずに移動`);
   check(tools()===before,`${expected}: 道具・色・太さを保持`);
 };
 const locate=(doc:MangaDocument,id:string)=>{
   const page=doc.manga.pages[0];
   for(const [index,container] of [[-1,page],...page.panels.map((p,i)=>[i,p] as const)] as const){
     const images=(container as typeof page).images??[];
     for(const image of images)if(image.paint?.layers.some(layer=>layer.id===id))return {paint:image.paint,frame:image.bbox,index,key:index<0?'page':'panel',image};
     if(index<0)continue;
     const p=page.panels[index];
     for(const [kind,items] of [['figure',p.figures??[]],['bubble',p.bubbles]] as const)for(const [n,item] of items.entries()){
       const art=kind==='figure'?(item as Figure).artwork:(item as Bubble).paint_overlay;
       if(art?.paint?.layers.some(layer=>layer.id===id))return {paint:art.paint,frame:item.bbox!,index,key:`${kind}-${n}`,image:undefined};
     }
   }
   throw Error(`保存先にレイヤーがありません: ${id}`);
 };
 const verifySaved=async(id:string,label:string)=>{
   await save();const doc=await stored(),found=locate(doc,id),layer=found.paint.layers.find(layer=>layer.id===id)!;
   check(layer.name==='移動する青'&&layer.id===id,`${label}: レイヤー名とIDを保持`);
   const images=await loadPaintImages([found.paint],doc.manga.image_assets??[]),renderer=paintPreviewRenderer(),canvas=document.createElement('canvas');
   canvas.width=found.paint.width;canvas.height=found.paint.height;
   renderer.draw(canvas,{...found.paint,folders:undefined,layers:[{...layer,folderId:undefined}]},images);
   const x=Math.round((50-found.frame.x)*found.paint.width/found.frame.w),y=Math.round((50-found.frame.y)*found.paint.height/found.frame.h);
   const rgba=canvas.getContext('2d')!.getImageData(x,y,1,1).data;check(rgba[2]>180&&rgba[0]<80&&rgba[3]===255,`${label}: 紙面50mm地点の青画素を保持`);
   renderer.dispose();images.forEach(image=>{image.src='';});return {doc,found,layer};
 };
 const messages:string[]=[];const observer=new MutationObserver(()=>{const text=document.querySelector('.toast')?.textContent;if(text&&messages.at(-1)!==text)messages.push(text);});observer.observe(host,{subtree:true,childList:true,characterData:true});
 run.disabled=true;report.textContent='所属をまたぐ移動を検証中';
 try{
   render(null,host);const doc=structuredClone(source),page=doc.manga.pages[0];
   doc.manga.finish_settings={width_mm:120,height_mm:120,dpi:100,bleed_mm:0};page.canvas={w:120,h:120,unit:'mm'};page.page_overlay=undefined;page.paint_layer_sequence=12;
   const ink={...newPaintLayer('移動する青'),id:'move-blue',strokes:[{tool:'fill' as const,color:'#2244dd',size:1,points:[{x:100,y:100,pressure:1,time:0}],selection:[{x:90,y:90,w:20,h:20}]}]};
   const paint={version:1 as const,width:240,height:240,dpi:100,guideInitialized:true,layers:[ink]};
   const blob=await renderPaintPng(paint,new Map()),asset=await prepareImageAsset(new File([blob],'移動検証.png',{type:'image/png'}));await saveFigureCropAssets([{id:asset.storageId,blob}]);doc.manga.image_assets=[asset];
   page.images=[{...createFrameArtwork(asset,{x:0,y:0,w:120,h:120}),paint,paintScope:'page'}];
   const empty={...paint,layers:[],folders:[{id:'test-folder',name:'移動先フォルダー',position:0}]};
   page.panels=[{id:1,layerId:'first-panel',shape:{type:'rect',x:10,y:10,w:100,h:100},bg:0,action:null,
     figures:[{name:'移動先人物',bbox:{x:70,y:70,w:20,h:20}},{name:'空になる人物',bbox:{x:15,y:75,w:20,h:20}}],
     bubbles:[{text:'文字',layerId:'test-text',shape:'square',tail:false,bbox:{x:75,y:15,w:25,h:25},analogTextImport:{schemaVersion:1,sourceRegionId:'move-region',assetId:asset.storageId,sourceBBox:{x:0,y:0,w:1,h:1},detectionSource:'baberu',recognitionEngine:'Baberu OCR',needsReview:false,levelAdjusted:true,rasterLayerInitialized:true,rasterLayerSeparated:true,originalImageId:'move-original'}}],
     images:[{...createFrameArtwork(asset,{x:0,y:0,w:120,h:120}),paint:empty,paintScope:'panel'},{...createFrameArtwork(asset,{x:75,y:15,w:25,h:25}),id:'move-original',bubbleOriginal:{sourceRegionId:'move-region',name:'原本・文字'}}]},
     {id:2,layerId:'second-panel',shape:{type:'rect',x:20,y:20,w:80,h:80},bg:0,action:null,bubbles:[]}];
   const w=await project.createWritable();await w.write(JSON.stringify(await createPortableProject(doc)));await w.close();
   render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'作品を開くボタン');button('作品フォルダを開く').click();await wait(()=>!!row('move-blue'),'移動検証作品');await settle();
   button('コマ情報を閉じる')?.click();button('ページ一覧を閉じる')?.click();await settle();
   check(!palette().querySelector('.layer-root-drop'),'グループ上下に透明な追加判定帯を置かない');
   const rootMargin=Number.parseFloat(getComputedStyle(row('move-blue').querySelector('.layer-select')!).marginLeft);
   const guideMargin=Number.parseFloat(getComputedStyle(group(0,'figure-0').parentElement!.querySelector('.layer-select')!).marginLeft);
   check(rootMargin===0&&guideMargin===32,'フォルダー外は目玉へ寄せ、人物フォルダー内は階層分だけ下げる');
   row('move-blue').querySelector<HTMLButtonElement>('.layer-select')!.click();await wait(()=>!!document.querySelector('.paint-input'),'描画セッション開始');await settle();
   button('ペン').click();button('描画色：青').click();button('太さ 3 px').click();await settle();
   const probeFolder=panel(0).querySelector<HTMLElement>('[data-folder="test-folder"]')!,widths:number[]=[];
   for(const ratio of [.5,.9])await drag(row('move-blue').querySelector<HTMLElement>('.layer-select')!,probeFolder,ratio,true,async marker=>{
     const style=getComputedStyle(marker,'::after');widths.push(Number.parseFloat(style.width));
     if(ratio===.9)check(style.left==='0px'&&style.right==='0px'&&Number.parseFloat(style.width)===marker.getBoundingClientRect().width,'外側の線は左右端まで届き、目玉列の下を通る');
     check(style.backgroundColor==='rgb(223, 134, 31)'&&style.height==='4px'&&getComputedStyle(marker).boxShadow==='none',`${ratio===.5?'内部':'外側'}の挿入先はオレンジの4px線を1本だけ表示`);
     if(ratio===.9&&new URLSearchParams(window.location.search).has('marker-preview')){
       report.textContent='外側の挿入線プレビュー（Escで検証続行）';
       await new Promise<void>(resolve=>{const resume=(event:KeyboardEvent)=>{if(event.key==='Escape'){window.removeEventListener('keydown',resume);resolve();}};window.addEventListener('keydown',resume);});
     }
   });
   check(widths[1]-widths[0]===48,'フォルダー外の線は目玉の下まで全幅、内部の線は48px短い');
   await move('move-blue',panel(0).querySelector<HTMLElement>('.panel-frame-layer')!,'false/0/panel');await verifySaved('move-blue','ページからコマ内');
   history('元に戻す').click();await wait(()=>location('move-blue')==='true/0/page','Undoでページへ復帰');check(true,'コマへの移動を1回のUndoで取り消せる');
   history('やり直す').click();await wait(()=>location('move-blue')==='false/0/panel','Redoでコマへ復帰');check(true,'Redoで所属を復元');
   await move('move-blue',group(0,'figure-0'),'false/0/figure-0');const figureMove=await verifySaved('move-blue','人物フォルダー内');
   const figure=figureMove.doc.manga.pages[0].panels[0].figures![0],ref=paintReferenceBox(figure.artwork!.paint,figure.bbox!,figure.artwork!.crop);
   check(Math.abs(ref.x-70)<.01&&Math.abs(ref.y-70)<.01,'人物あたりの元位置を保持');
   await move('move-blue',group(0,'bubble-0'),'false/0/bubble-0');check((await verifySaved('move-blue','テキストフォルダー内')).layer.aboveNative===true,'文字フォルダーへ入れると文字の上に配置');
   await move('move-blue',panel(0).querySelector<HTMLElement>('.bubble-native-row')!,'false/0/bubble-0',.8);
   check(!(await verifySaved('move-blue','文字の下')).layer.aboveNative,'同じ文字フォルダー内で文字の下へ移動');
   const native=panel(0).querySelector<HTMLElement>('.bubble-native-row')!,boundaryLines:number[]=[];
   for(const ratio of [-.08,-.02,.02,.08])await drag(row('move-blue').querySelector<HTMLElement>('.layer-select')!,native,ratio,true,marker=>{
     const line=getComputedStyle(marker,'::after'),box=marker.getBoundingClientRect();boundaryLines.push(Math.round((box.top+Number.parseFloat(line.top))*10));
   });
   check(new Set(boundaryLines).size===1,'原本と文字の境界を横切っても、3段階の判定帯にせず同じ1本の挿入線を示す');
   await drag(row('move-blue').querySelector<HTMLElement>('.layer-select')!,native,.2);
   await wait(()=>row('move-blue')?.dataset.owner?.startsWith('panel:below:')===true,'原本と文字の間への移動');
   const originalRow=panel(0).querySelector<HTMLElement>('[data-original-raster="move-original"] [data-layer]')!;
   check(Boolean(originalRow.compareDocumentPosition(row('move-blue'))&Node.DOCUMENT_POSITION_FOLLOWING)&&Boolean(row('move-blue').compareDocumentPosition(panel(0).querySelector('.bubble-native-row')!)&Node.DOCUMENT_POSITION_FOLLOWING),'原本と文字の境界のマーカーどおり、間へ配置');

   const folderRow=()=>panel(0).querySelector<HTMLElement>('[data-folder="test-folder"]')!;
   await move('move-blue',folderRow(),'false/0/panel');check((await verifySaved('move-blue','通常フォルダー内')).layer.folderId==='test-folder','テキストから通常フォルダーへ入る');
   await move('move-blue',folderRow(),'false/0/panel',.9);check(!(await verifySaved('move-blue','通常フォルダー外')).layer.folderId,'フォルダー下端から外へ出る');
   await move('move-blue',panel(1).querySelector<HTMLElement>('.panel-layer-heading')!,'false/1/panel',.65);await verifySaved('move-blue','別コマ内');
   await move('move-blue',panel(0).querySelector<HTMLElement>('.panel-layer-heading')!,'true/0/page:panel:layer:first-panel',.1);const outside=await verifySaved('move-blue','コマバー上');
   check(!!outside.found.image?.paintStack&&'beforePanel' in outside.found.image.paintStack&&outside.found.image.paintStack.beforePanel==='layer:first-panel','コマバー上の所属を安定IDで保存');
   await move('move-blue',palette().querySelector<HTMLElement>('.page-layer-root-drop')!,'true/0/page');await verifySaved('move-blue','ページ直下へ戻す');
   const beforeCancel=location('move-blue');await drag(row('move-blue').querySelector<HTMLElement>('.layer-select')!,group(0,'bubble-0'),.5,true);await settle();check(location('move-blue')===beforeCancel,'ドラッグ取消しで所属を変えない');
   await drag(folderRow().querySelector<HTMLElement>('.layer-folder-select')!,group(0,'bubble-0'));
   await wait(()=>!!group(0,'bubble-0').parentElement!.querySelector('[data-folder="test-folder"]'),'空フォルダーをテキストへ');check(true,'空フォルダー自体もテキストフォルダー内へ移せる');
   const guideGroup=group(0,'figure-1');guideGroup.querySelector<HTMLButtonElement>('[aria-expanded="false"]')?.click();await settle();
   const guideRow=guideGroup.parentElement!.querySelector<HTMLElement>('[data-layer]')!,guideId=guideRow.dataset.layer!;
   await move(guideId,palette().querySelector<HTMLElement>('.page-layer-root-drop')!,'true/0/page');await save();
   const saved=await stored();check(saved.manga.pages[0].panels[0].figures![1].artwork?.paint?.layers.length===0,'最後のあたりを移した人物は空で保存');
   check(saved.manga.pages[0].paint_layer_sequence===12,'移動はページの追加連番を消費しない');
   group(0,'figure-1').querySelector<HTMLButtonElement>('.layer-group-select')!.click();await settle();
   for(let i=0;i<2;i++){group(0,'figure-1').querySelector<HTMLButtonElement>('.layer-row-lock')!.click();await settle();}
   await save();check((await stored()).manga.pages[0].panels[0].figures![1].artwork?.paint?.layers.length===0,'空の人物のロック解除を保存してもあたりを再生成しない');
   group(0,'figure-1').querySelector<HTMLButtonElement>('.layer-visibility')!.click();await settle();await save();
   check((await stored()).manga.pages[0].panels[0].figures![1].artwork?.paint?.layers.length===0,'空の人物の目を操作しても空paintを保持');

   render(null,host);render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'再起動');button('作品フォルダを開く').click();await wait(()=>!!row('move-blue'),'保存作品の再読込');await settle();
   group(0,'figure-1').querySelector<HTMLButtonElement>('[aria-expanded="false"]')?.click();await settle();
   check(!group(0,'figure-1').parentElement!.querySelector('[data-layer]'),'再読込で移動済みのあたりを再生成しない');
   check(location('move-blue')==='true/0/page'&&location(guideId)==='true/0/page','作成場所の異なる2レイヤーを同じページ直下へ保存');
   report.textContent=`所属移動 PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){report.textContent=`所属移動 FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}\n${messages.join('\n')}`;console.error(error);}
 finally{observer.disconnect();run.disabled=false;}
}


async function verifySelectionLayerTools(){
 const run=document.getElementById('selection-layer-run') as HTMLButtonElement,checks:string[]=[];
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
 const row=(id:string)=>document.querySelector<HTMLElement>(`.page-layer-palette [data-layer="${id}"] .layer-select`)!;
 const painting=()=>Boolean(document.querySelector('.app-shell.is-painting'));
 const guide=async()=>{row('selection-guide').click();await wait(()=>painting()&&!!document.querySelector('.paint-input')&&row('selection-guide')?.closest('.layer-row')?.classList.contains('is-selected')===true,'あたり描画待ち');await settle();};
 const vector=async(id='selection-vector')=>{row(id).dispatchEvent(new MouseEvent('click',{ctrlKey:true,bubbles:true}));await wait(()=>painting()&&!!document.querySelector('[data-vector-resize="se"]')&&row(id)?.closest('.layer-row')?.classList.contains('is-selected')===true,'パス選択待ち');await settle();};
 const key=async(key:string)=>{window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await settle();};
 const drag=async(element:Element,dx:number,dy:number,cancel=false)=>{
  const box=element.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2,pointerId=96;
  const event=(type:string,cx:number,cy:number)=>new PointerEvent(type,{pointerId,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'||type==='pointercancel'?0:1,clientX:cx,clientY:cy,bubbles:true,cancelable:true});
  element.dispatchEvent(event('pointerdown',x,y));window.dispatchEvent(event('pointermove',x+dx,y+dy));window.dispatchEvent(event(cancel?'pointercancel':'pointerup',x+dx,y+dy));await settle();
 };
 const surfaceClick=async(x:number,y:number)=>{
  const paper=document.querySelector('.manga-paper')!.getBoundingClientRect(),px=paper.left+x/182*paper.width,py=paper.top+y/257*paper.height;
  const surface=document.querySelector('.paint-input')!;
  surface.dispatchEvent(new PointerEvent('pointerdown',{pointerId:97,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:px,clientY:py,bubbles:true,cancelable:true}));
  window.dispatchEvent(new PointerEvent('pointerup',{pointerId:97,pointerType:'mouse',isPrimary:true,button:0,buttons:0,clientX:px,clientY:py,bubbles:true,cancelable:true}));await settle();
 };
 const currentFigure=async()=>{await save();return (await stored()).manga.pages[0].panels[0].figures![0];};
 run.disabled=true;report.textContent='選択ツールとレイヤーの連携を検証中';
 try{
  render(null,host);const doc=structuredClone(source),page=doc.manga.pages[0],panel=page.panels[0];delete page.page_overlay;
  panel.shape={type:'rect',x:15,y:15,w:150,h:105};panel.screen_text=[{text:'画面の文字',bbox:{x:80,y:95,w:60,h:15},text_style:{fontSize:18,orientation:'horizontal'}}];
  panel.bubbles=[{text:'輪郭を編集',shape:'normal',tail:false,bbox:{x:105,y:30,w:40,h:35}}];
  const canvas=document.createElement('canvas');canvas.width=canvas.height=80;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#326ecc';ctx.fillRect(8,8,64,64);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png')),asset=await prepareImageAsset(new File([blob],'選択あたり.png',{type:'image/png'}));await saveFigureCropAssets([{id:asset.storageId,blob}]);
  const frame={x:25,y:55,w:45,h:45},paint=paintForFrame(frame,100,[createFrameArtwork(asset,frame)],[asset]);paint.guideInitialized=true;
  paint.layers[0].id='selection-guide';paint.layers[0].name='選択するあたり';paint.layers[0].guide=true;paint.layers[0].locked=false;
  const path=vectorShape('ellipse',{x:25,y:25},{x:130,y:120},{...defaultVectorStyle(),stroke:'#ff0000',width:4}),layer={...newPaintLayer('選択するベクター','vector'),id:'selection-vector',paths:[path]};paint.layers.push(layer);
  const images=await loadPaintImages([paint],[asset]),composite=await renderPaintPng(paint,images),merged=await prepareImageAsset(new File([composite],'選択あたり合成.png',{type:'image/png'}));images.forEach(image=>{image.src='';});await saveFigureCropAssets([{id:merged.storageId,blob:composite}]);
  doc.manga.image_assets=[asset,merged];panel.figures=[{name:'選択人物',bbox:frame,artwork:{...createFrameArtwork(merged,frame),paint}}];
  const below={...newPaintLayer('輪郭より後ろの線','vector'),id:'selection-below',paths:[vectorShape('ellipse',{x:4,y:4},{x:24,y:24},{...defaultVectorStyle(),width:4})]},above={...newPaintLayer('輪郭より手前の線','vector'),id:'selection-above',aboveNative:true,paths:[vectorShape('line',{x:60,y:70},{x:120,y:70},{...defaultVectorStyle(),width:4})]};
  const bubblePaint:PaintDocument={version:1,width:160,height:140,dpi:100,guideInitialized:true,layers:[below,above]},bubbleBlob=await renderPaintPng(bubblePaint,new Map()),bubbleAsset=await prepareImageAsset(new File([bubbleBlob],'輪郭の前後の線.png',{type:'image/png'}));
  await saveFigureCropAssets([{id:bubbleAsset.storageId,blob:bubbleBlob}]);doc.manga.image_assets.push(bubbleAsset);panel.bubbles[0].paint_overlay={...createFrameArtwork(bubbleAsset,panel.bubbles[0].bbox!),paint:bubblePaint};
  page.page_overlay={frame:false,layer:'above_panel_frames',bubbles:[{text:'前景',shape:'square',tail:false,bbox:{x:128,y:44,w:20,h:15}}]};

  page.panels.push({id:2,shape:{type:'rect',x:15,y:140,w:150,h:100},bg:0,action:null,bubbles:[{text:'別コマ',shape:'normal',tail:false,bbox:{x:105,y:150,w:40,h:35}}]});
  const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(doc)));await writer.close();
  render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'起動画面待ち');await open();await save();const baseline=await stored();
  await guide();button('選択').click();await wait(()=>!painting()&&!!document.querySelector('.artwork-selection-layer .handle-se'),'配置の拡縮点待ち');await settle();
  check(!document.querySelector('.paint-input')&&!!document.querySelector('.artwork-selection-layer .handle-se'),'画像レイヤーからVで拡縮点を復帰');
  check(document.querySelector('.page-layer-palette [data-owner-group="figure-0"]')?.classList.contains('is-selected')===true,'選択人物とレイヤーパレットを同期');
  await save();check(JSON.stringify(await stored())===JSON.stringify(baseline),'道具切替だけでは原稿・画像・履歴を変更しない');
  const initialFigure=await currentFigure();await drag(document.querySelector('.artwork-selection-layer .handle-se')!,18,12);
  const scaled=await currentFigure();check(scaled.bbox!.w>initialFigure.bbox!.w&&scaled.bbox!.h>initialFigure.bbox!.h,'Vの拡縮点をドラッグして画像を拡大');
  check(scaled.artwork!.paint!.layers.map(l=>l.id).join()===initialFigure.artwork!.paint!.layers.map(l=>l.id).join(),'拡縮でレイヤーIDと順序を保持');
  history('元に戻す').click();await settle();check(JSON.stringify((await currentFigure()).bbox)===JSON.stringify(initialFigure.bbox),'画像拡縮を1回のUndoで復元');
  history('やり直す').click();await settle();check(JSON.stringify((await currentFigure()).bbox)===JSON.stringify(scaled.bbox),'画像拡縮をRedoで復元');
  await guide();await key('v');await wait(()=>!painting(),'Vショートカットで配置へ');check(!!document.querySelector('.artwork-selection-layer .handle-se'),'Vキーも画像の拡縮を復帰');
  await guide();button('ダイレクト選択').click();await wait(()=>!painting(),'Aの配置復帰');
  document.querySelector<HTMLElement>('[data-content-panel="0"][data-content-kind="bubble"]')!.click();await settle();
  check(!!document.querySelector('.bubble-path-edit-layer .bubble-bezier-node-hit'),'Aで吹き出しのアンカーを表示');
  await vector();button('選択').click();await settle();check(painting()&&!!document.querySelector('[data-vector-resize="nw"]'),'ベクターレイヤーのVはパス編集を保持');
  const vectorBefore=(await currentFigure()).artwork!.paint!.layers.find(l=>l.id==='selection-vector')!;
  await drag(document.querySelector('[data-vector-resize="nw"]')!,12,9,true);await save();check(JSON.stringify((await currentFigure()).artwork!.paint!.layers.find(l=>l.id==='selection-vector'))===JSON.stringify(vectorBefore),'ベクター拡縮の取消しでレイヤーを変更しない');
  await vector();await drag(document.querySelector('[data-vector-resize="nw"]')!,12,9);const vectorAfter=(await currentFigure()).artwork!.paint!.layers.find(l=>l.id==='selection-vector')!;
  check(JSON.stringify(vectorAfter.paths)!==JSON.stringify(vectorBefore.paths),'線の外の選択枠角からベクターを拡縮');
  history('元に戻す').click();await settle();check(JSON.stringify((await currentFigure()).artwork!.paint!.layers.find(l=>l.id==='selection-vector')!.paths)===JSON.stringify(vectorBefore.paths),'ベクター拡縮を1回のUndoで復元');
  history('やり直す').click();await settle();check(JSON.stringify((await currentFigure()).artwork!.paint!.layers.find(l=>l.id==='selection-vector')!.paths)===JSON.stringify(vectorAfter.paths),'ベクター拡縮をRedoで復元');
  await vector();button('ダイレクト選択').click();await settle();check(painting()&&!!document.querySelector('.vector-edit-overlay .is-selected-anchor,.vector-edit-overlay g rect'),'ベクターのAはアンカー編集を保持');
  await surfaceClick(125,165);await wait(()=>!painting()&&!!document.querySelector('.panel-layer-group[aria-label="コマ 02"] [data-owner-group="bubble-0"].is-selected'),'別コマnative切替待ち');
  check(!!document.querySelector('.bubble-path-edit-layer'),'描画中のAから別コマの吹き出しへ直接選択');
  await vector();button('選択').click();await settle();await surfaceClick(100,100);await wait(()=>!painting()&&!!document.querySelector('.panel-layer-group[aria-label="コマ 01"] .native-text-layer.is-selected'),'通常文字の選択待ち');check(document.querySelector('.native-text-layer.is-selected')?.textContent?.includes('画面の文字')===true,'描画中のVから通常文字を選択');
  await vector();button('選択').click();await settle();await surfaceClick(80,210);await wait(()=>!painting(),'別コマの空白選択待ち');
  check(document.querySelector('.panel-layer-group[aria-label="コマ 02"] .panel-layer-heading')?.classList.contains('is-selected')===true,'描画中のVから別コマの空白へ切替');
  const fold=document.querySelector<HTMLButtonElement>('.panel-layer-group[aria-label="コマ 01"] [data-owner-group="bubble-0"] [aria-expanded]')!;if(fold.getAttribute('aria-expanded')==='false'){fold.click();await settle();}
  await vector('selection-below');button('選択').click();row('selection-below').click();await settle();await surfaceClick(108.5,31);check(painting()&&row('selection-below')?.closest('.layer-row')?.classList.contains('is-selected')===true,'nativeの外にある背面描線は描線自身を選択');
  await vector('selection-above');button('選択').click();row('selection-above').click();await settle();await surfaceClick(122,47.5);check(painting()&&row('selection-above')?.closest('.layer-row')?.classList.contains('is-selected')===true,'nativeより手前の描線は同じ文字に選択を奪われない');
  row('selection-above').click();await settle();const handlesBefore=document.querySelectorAll('[data-vector-resize]').length;await surfaceClick(129,47.5);await wait(()=>!painting(),`前景nativeの選択待ち (handles=${handlesBefore})`);check(document.querySelector('[data-content-overlay][data-content-kind="bubble"]')?.classList.contains('is-element-selected')===true,'手前の別nativeはaboveNative描線より優先');
  await guide();await key('a');await wait(()=>!painting(),'Aショートカットで配置へ');check(!!document.querySelector('.canvas-viewport.is-direct-selection-tool'),'Aキーもnativeのダイレクト選択へ切替');
  report.textContent=`選択連携 PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){report.textContent=`選択連携 FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
 finally{run.disabled=false;}
}


// 見込み: 描画・配置を往復してもパレットの道具は同じ位置に残る。
// 合格: 30周の各遷移で十字の挿入0、バケツの位置不変。Esc確定後も描いた線が1本だけ保存される。
// 範囲: 合成作品の実App・実DOMでクリック／pointer／キー入力を発行。端末固有のペン入力は含まない。
async function verifyToolPaletteStress(){
 const run=document.getElementById('palette-stress-run') as HTMLButtonElement;
 const painting=()=>Boolean(host.querySelector('.app-shell.is-painting'));
 const grid=()=>host.querySelector<HTMLElement>('.paint-tool-icons')!;
 const bucketPosition=()=>{
  const base=grid().getBoundingClientRect(),bucket=grid().querySelector<HTMLElement>('[aria-label="バケツ"]')!.getBoundingClientRect();
  if(!bucket.width||!bucket.height)throw Error('バケツが画面に表示されていません');
  return [bucket.x-base.x,bucket.y-base.y];
 };
 const removed='button[aria-label="配置へ戻る"], button[data-tool-label="配置へ戻る"], .paint-tool-icons svg.lucide-move';
 let observer:MutationObserver|undefined,appearances=0,steps=0;
 run.disabled=true;
 try{
  render(null,host);const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(source)));await writer.close();render(<App/>,host);await open();
  button('ペンツールを開く')?.click();button('レイヤーを開く')?.click();await settle();
  host.querySelector<HTMLButtonElement>('[aria-label="コマ 01を展開"]')?.click();await settle();
  const initial=bucketPosition();
  const checkPalette=(label:string)=>{
   const next=bucketPosition();
   if(appearances||host.querySelector(removed))throw Error(label+'：十字が再表示されました');
   if(next.some((x,i)=>Math.abs(x-initial[i])>.5))throw Error(label+'：バケツが別の位置へ移動しました');
   steps++;
  };
  observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){
   if(node instanceof Element&&(node.matches(removed)||node.querySelector(removed)))appearances++;
  }});
  observer.observe(host,{childList:true,subtree:true});
  checkPalette('配置開始時');
  button('コマ 01の枠を選択').click();await settle();button('ラスターレイヤー追加').click();
  await wait(()=>painting()&&Boolean(host.querySelector('.layer-row.is-selected[data-layer]')&&host.querySelector('.paint-input')),'描画レイヤーを追加');
  checkPalette('最初の描画');
  const layerId=host.querySelector<HTMLElement>('.layer-row.is-selected[data-layer]')!.dataset.layer!;
  button('ペン').click();await settle();
  const surface=host.querySelector<HTMLElement>('.paint-input')!,r=surface.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
  const pointer=(target:EventTarget,type:string,dx:number)=>target.dispatchEvent(new PointerEvent(type,{pointerId:119,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:x+dx,clientY:y,bubbles:true,cancelable:true}));
  pointer(surface,'pointerdown',0);pointer(window,'pointermove',12);pointer(window,'pointerup',12);await settle();
  await exitPaintWithEscape();await save();
  const savedLine=async()=>(await stored()).manga.pages[0].panels[0].images?.flatMap(i=>i.paint?.layers??[]).find(l=>l.id===layerId)?.strokes;
  const line=await savedLine();if(line?.length!==1||line[0].tool!=='pen')throw Error('Escで終了したペン線が1本残らない');
  const tools=['ペン','消しゴム','バケツ','投げ縄'];
  for(let i=0;i<30;i++){
   const phase=(label:string)=>checkPalette(`${i+1}周目 ${label}`);
   host.querySelector<HTMLButtonElement>(`[data-layer="${layerId}"] .layer-select`)!.click();
   await wait(()=>painting()&&Boolean(host.querySelector(`.layer-row.is-selected[data-layer="${layerId}"]`)),'子レイヤーの選択');phase('レイヤー');
   const tool=button(tools[i%tools.length]);tool.click();await wait(()=>tool.getAttribute('aria-pressed')==='true','道具の切替');phase('道具');
   const hover=(selector:string)=>host.querySelector(selector)!.dispatchEvent(new PointerEvent('pointerover',{pointerType:'mouse',bubbles:true}));
   hover('.inspector-content');await wait(()=>!painting(),'コマ情報で描画を終了');phase('コマ情報');
   hover('[data-paint-canvas]');await wait(painting,'キャンバスで描画を再開');phase('自動再開');
   if(i%2===0)await exitPaintWithEscape();
   else {button('コマ 01の枠を選択').click();await wait(()=>!painting(),'コマ枠で配置復帰');}
   phase('配置');
  }
  await save();if(JSON.stringify(await savedLine())!==JSON.stringify(line))throw Error('往復でペン線が変化');
  report.textContent=`パレット往復 PASS 30周（${steps}地点、十字の挿入${appearances}件、バケツ位置不変、ペン線1本保持）`;
 }catch(error){report.textContent=`パレット往復 FAIL ${steps}地点: ${String(error)}`;console.error(error);}
 finally{observer?.disconnect();run.disabled=false;}
}

// 見込み: folderボタンにfocusが残っても、canvasへのpointerenterでSpaceの行先をpanへ切り替えられる。
// 合格: 開閉状態を保持したまま実scrollが移動し、keyup・blurで解除。画面外buttonと入力中はSpaceを保持。
// 範囲: 実App/DOMと合成pointer・keyboard。専用OPFS作品のみを使用し、実作品や外部サービスへ触れない。
async function verifyFolderSpacePan(){
 const run=document.getElementById('folder-space-run') as HTMLButtonElement,checks:string[]=[];
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 const key=(type:string,target:EventTarget,isComposing=false)=>{const event=new KeyboardEvent(type,{key:' ',code:'Space',isComposing,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
 run.disabled=true;report.textContent='フォルダー選択後のSpaceを検証中';
 try{
  render(null,host);const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(source)));await writer.close();render(<App/>,host);await open();
  button('100%表示').click();await settle();
  const scroll=(document.querySelector('.spread-pane:not(.is-spread-partner) .canvas-scroll')??document.querySelector('.canvas-scroll')) as HTMLElement;
  const surface=scroll.closest<HTMLElement>('.canvas-spread-scroll')??scroll,folder=document.querySelector<HTMLButtonElement>('.panel-layer-heading button[aria-expanded]')!;
  folder.click();await settle();folder.focus();const folded=folder.getAttribute('aria-expanded');
  check(document.activeElement===folder,'フォルダー開閉ボタンにフォーカスが残る状態を用意');
  surface.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
  check(key('keydown',folder).defaultPrevented&&document.body.classList.contains('is-canvas-space-pan-ready'),'画面上のSpaceをボタン開閉でなく掴むモードへ');
  surface.scrollLeft=400;surface.scrollTop=400;const left=surface.scrollLeft,top=surface.scrollTop,box=surface.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
  const pointer=(target:EventTarget,type:string,dx=0,dy=0)=>target.dispatchEvent(new PointerEvent(type,{pointerId:131,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:x+dx,clientY:y+dy,bubbles:true,cancelable:true}));
  pointer(surface,'pointerdown');pointer(window,'pointermove',30,20);
  check(Math.abs(surface.scrollLeft-left+30)<1&&Math.abs(surface.scrollTop-top+20)<1,'Spaceドラッグで紙面を縦横に移動');
  pointer(window,'pointerup',30,20);check(key('keyup',folder).defaultPrevented&&!document.body.classList.contains('is-canvas-space-pan-ready'),'Spaceを離すとボタンのclickを抑止して掴むモードを解除');
  check(folder.getAttribute('aria-expanded')===folded,'Space操作でフォルダーの開閉状態を保持');
  surface.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));check(!key('keydown',folder).defaultPrevented&&!key('keyup',folder).defaultPrevented,'画面外ではフォルダーボタンのSpaceを保持');
  surface.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
  const textarea=document.querySelector<HTMLTextAreaElement>('textarea')!;check(!!textarea&&!key('keydown',textarea).defaultPrevented&&!key('keyup',textarea).defaultPrevented,'カーソルが画面上でも文字入力のSpaceを保持');
  check(!key('keydown',folder,true).defaultPrevented&&!key('keyup',folder,true).defaultPrevented,'IME変換中のSpaceを奪わない');
  key('keydown',folder);surface.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));check(key('keyup',folder).defaultPrevented&&!document.body.classList.contains('is-canvas-space-pan-ready'),'画面外へカーソルを移してもkeyupで解除');
  surface.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));key('keydown',folder);window.dispatchEvent(new Event('blur'));check(!document.body.classList.contains('is-canvas-space-pan-ready'),'windowのblurでも掴むモードを解除');
  folder.focus();surface.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
  report.textContent=`Spaceパン PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){report.textContent=`Spaceパン FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
 finally{run.disabled=false;}
}

async function verifyGenerationOwner(){
 const run=document.getElementById('generation-owner-run') as HTMLButtonElement,checks:string[]=[];
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
 const maskRow=()=>document.querySelector<HTMLElement>('.page-layer-palette [data-generation-mask="bubble-0"]');
 const painting=()=>Boolean(document.querySelector('.app-shell.is-painting'));
 const reopen=async()=>{render(null,host);render(<App/>,host);button('作品フォルダを開く').click();await wait(()=>!!host.querySelector('[data-owner-group="bubble-0"]'),'再読込の完了');await settle();};
 run.disabled=true;report.textContent='独立レイヤーの生成マスクを検証中';
 try{
  render(null,host);const doc=structuredClone(source),panel=doc.manga.pages[0].panels[0];
  panel.bubbles[0].shape='handwritten';panel.bubbles[0].text='生成範囲';panel.screen_text=[];doc.manga.pages[0].page_overlay=undefined;
  const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(doc)));await writer.close();
  render(<App/>,host);await open();
  nativeBubble().closest<HTMLElement>('[data-content-target]')!.click();await settle();
  document.querySelector<HTMLButtonElement>('.paint-layers-dock [aria-label="レイヤーを開く"]')?.click();await settle();
  check(!button('生成マスク化').disabled,'キャンバスで選んだ空テキストフォルダーから作成できる');
  button('生成マスク化').click();await wait(()=>painting()&&!!maskRow()&&maskRow()!.classList.contains('is-selected'),'マスク作成と描画開始待ち');await settle();
  check(!!document.querySelector('.paint-input')&&!!maskRow()!.querySelector('canvas'),'生成マスクのサムネイルと描画面を表示');
  check(maskRow()!.dataset.layerDrop==='layer'&&!maskRow()!.hasAttribute('aria-expanded')&&!document.querySelector('.generation-mask-children'),'マスクは子を持たない通常レイヤー');
  await save();check((await stored()).manga.pages[0].panels[0].bubbles[0].paint_overlay?.paint?.layers.some(layer=>layer.generationMask)===true,'マスク1レイヤーを既存保存へ接続');
  await exitPaintWithEscape();await settle();
  check(!!maskRow(),'描画を終了してもフォルダーのマスクを表示');
  button('テキスト1の文字を隠す').click();await settle();
  maskRow()!.querySelector<HTMLButtonElement>('.layer-select')!.click();await wait(()=>painting()&&maskRow()!.classList.contains('is-selected'),'保存済みマスクの描画再開待ち');await settle();
  check(!!document.querySelector('.paint-input'),'ネイティブ文字を隠してもマスク行から範囲編集を再開');
  await exitPaintWithEscape();await save();await reopen();
  document.querySelector<HTMLButtonElement>('.paint-layers-dock [aria-label="レイヤーを開く"]')?.click();await settle();
  document.querySelector<HTMLButtonElement>('.page-layer-palette [aria-label="コマ 01を展開"]')?.click();await settle();
  document.querySelector<HTMLButtonElement>('.page-layer-palette [aria-label="テキスト1を展開"]')?.click();await settle();
  check(!!maskRow()&&!!maskRow()!.querySelector('canvas'),'作品再読込でも独立マスクと描画領域を復元');
  maskRow()!.querySelector<HTMLButtonElement>('.layer-select')!.click();await wait(()=>painting()&&maskRow()!.classList.contains('is-selected'),'再読込後のマスク編集待ち');
  check(!!document.querySelector('.paint-input'),'再読込直後のマスク行からも描画できる');
  report.textContent=`App生成マスク PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){report.textContent=`App生成マスク FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
 finally{run.disabled=false;}
}


async function verifyLayerMoveContinuity(){
 const run=document.getElementById('layer-continuity-run') as HTMLButtonElement,checks:string[]=[];
 const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
 const palette=()=>document.querySelector<HTMLElement>('.page-layer-palette')!;
 const scope=(index=0)=>palette().querySelector<HTMLElement>(`.panel-layer-group[aria-label="コマ 0${index+1}"]`)!;
 const row=(id:string)=>palette().querySelector<HTMLElement>(`[data-layer="${id}"]`)!;
 const mask=()=>palette().querySelector<HTMLElement>('[data-layer="continuity-mask"]')!;
 const group=(key:string,index=0)=>scope(index).querySelector<HTMLElement>(`[data-owner-group="${key}"]`)!;
 const tools=()=>JSON.stringify([...document.querySelectorAll<HTMLElement>('.paint-tool-icons [aria-pressed],.paint-colors [aria-pressed],.paint-size [aria-checked]')].map(n=>[n.getAttribute('aria-label'),n.getAttribute('aria-pressed'),n.getAttribute('aria-checked')]));
 const drag=async(source:HTMLElement,target:HTMLElement,ratio=.8,cancel=false)=>{
  target.scrollIntoView({block:'center'});await settle();const a=source.getBoundingClientRect(),b=target.getBoundingClientRect(),pointerId=121;
  const x=a.left+a.width/2,y=a.top+a.height/2,tx=b.left+b.width/2,ty=b.top+b.height*ratio;
  source.dispatchEvent(new PointerEvent('pointerdown',{pointerId,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
  window.dispatchEvent(new PointerEvent('pointermove',{pointerId,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:tx,clientY:ty,bubbles:true,cancelable:true}));
  window.dispatchEvent(new PointerEvent(cancel?'pointercancel':'pointerup',{pointerId,pointerType:'mouse',isPrimary:true,button:0,buttons:0,clientX:tx,clientY:ty,bubbles:true,cancelable:true}));
  if(!cancel)source.click();await settle();
 };
 const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')!,createUrl=URL.createObjectURL.bind(URL),urls=new Map<string,Blob>(),decoded:Blob[]=[];
 URL.createObjectURL=(blob:Blob|MediaSource)=>{const url=createUrl(blob);if(blob instanceof Blob)urls.set(url,blob);return url;};
 Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value:string){if(value&&new Error().stack?.includes('decodePaintImage')){const blob=urls.get(value);if(blob)decoded.push(blob);}descriptor.set!.call(this,value);}});
 run.disabled=true;report.textContent='レイヤー移動の状態保持を検証中';
 try{
  render(null,host);const doc=structuredClone(source),page=doc.manga.pages[0],panel=page.panels[0];page.page_overlay=undefined;panel.screen_text=[];
  const canvas=document.createElement('canvas');canvas.width=canvas.height=48;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#3366cc';ctx.fillRect(0,0,48,48);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png')),asset=await prepareImageAsset(new File([blob],'移動原本.png',{type:'image/png'}));await saveFigureCropAssets([{id:asset.storageId,blob}]);doc.manga.image_assets=[asset];
  const frame={x:60,y:30,w:85,h:35},paint=paintForFrame(frame,100,[],[asset]);paint.guideInitialized=true;
  const base={...newPaintLayer('下の絵'),id:'continuity-bottom',image:{assetId:asset.id,crop:{x:0,y:0,w:48,h:48},bbox:{x:0,y:0,w:paint.width,h:paint.height}}};
  paint.layers=[base,{...newPaintLayer('上の絵'),id:'continuity-top',mask:{enabled:true,reveal:true,strokes:[]}}];
  paint.layers.push({...newPaintLayer('生成マスク'),id:'continuity-mask',generationMask:true,strokes:[{tool:'rectangle',color:'#ff0000',fill:'#ff0000',size:1,points:[{x:4,y:4,pressure:1,time:0},{x:18,y:18,pressure:1,time:1}]}]});
  const composite=await renderPaintPng(paint,new Map([[asset.id,await new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=URL.createObjectURL(blob);})]]));
  const merged=await prepareImageAsset(new File([composite],'移動合成.png',{type:'image/png'}));await saveFigureCropAssets([{id:merged.storageId,blob:composite}]);doc.manga.image_assets.push(merged);
  panel.bubbles[0]={...panel.bubbles[0],text:'マスクと一緒',bbox:frame,shape:'handwritten',paint_overlay:{...createFrameArtwork(merged,frame),paint}};
  panel.bubbles.push({text:'比較先',shape:'handwritten',bbox:{x:45,y:100,w:40,h:20}});
  panel.images=[{...createFrameArtwork(asset,{x:65,y:35,w:25,h:20}),id:'continuity-original',bubbleOriginal:{sourceRegionId:'continuity-region',name:'原本'}}];
  panel.bubbles[0].analogTextImport={schemaVersion:1,sourceRegionId:'continuity-region',assetId:asset.storageId,sourceBBox:{x:0,y:0,w:48,h:48},detectionSource:'baberu',recognitionEngine:'Baberu OCR',needsReview:false,levelAdjusted:true,rasterLayerInitialized:true,rasterLayerSeparated:true,originalImageId:'continuity-original'};
  ctx.fillStyle='#66bb33';ctx.fillRect(0,0,48,48);
  const otherBlob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png')),otherAsset=await prepareImageAsset(new File([otherBlob],'移動先原本.png',{type:'image/png'}));await saveFigureCropAssets([{id:otherAsset.storageId,blob:otherBlob}]);doc.manga.image_assets.push(otherAsset);
  page.panels.push({id:2,shape:{type:'rect',x:15,y:140,w:150,h:100},bg:0,action:null,bubbles:[],figures:[{name:'移動先の絵',bbox:{x:25,y:170,w:40,h:40},artwork:createFrameArtwork(otherAsset,{x:25,y:170,w:40,h:40})}]});
  const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(doc)));await writer.close();
  render(<App/>,host);await open();button('コマ情報を閉じる')?.click();button('ページ一覧を閉じる')?.click();await settle();
  group('bubble-0').querySelector<HTMLButtonElement>('[aria-expanded="false"]')?.click();await settle();mask().querySelector<HTMLButtonElement>('.layer-select')!.click();await wait(()=>!!document.querySelector('.paint-input')&&mask().classList.contains('is-selected'),'マスク選択');await settle();
  button('ペン').click();button('描画色：赤').click();button('太さ 3 px').click();await settle();await save();
  check(getComputedStyle(mask()).borderLeftWidth==='0px'&&getComputedStyle(mask()).marginLeft==='0px','生成マスク行の余分な枠と余白を除去');
  button('ペンツールを閉じる')?.click();await settle();
  let observedDecodes=-1;for(let stable=0,attempt=0;stable<3&&attempt<120;attempt++){await settle();if(decoded.length===observedDecodes)stable++;else{observedDecodes=decoded.length;stable=0;}}
  const localSurface=document.querySelector('.paint-input'),localTools=tools();decoded.length=0;
  await drag(row('continuity-top').querySelector<HTMLElement>('.layer-select')!,row('continuity-bottom'),.8);await wait(()=>Boolean(row('continuity-bottom').compareDocumentPosition(row('continuity-top'))&Node.DOCUMENT_POSITION_FOLLOWING),'同一ownerの順序移動');await settle();
  check(document.querySelector('.paint-input')===localSurface&&tools()===localTools&&mask().classList.contains('is-selected'),'同一フォルダーの並べ替えで描画面・道具・生成マスク選択を保持');
  check(decoded.length===0,'同一フォルダーの並べ替えで原画像を再デコードしない');
  check(!!button('ペンツールを開く'),'同一フォルダーの移動で閉じたツールパレットを開かない');
  await save();
  const original=await stored(),surface=document.querySelector('.paint-input'),signature=tools();decoded.length=0;
  await drag(mask().querySelector<HTMLElement>('.layer-select')!,group('bubble-1'),.5);await wait(()=>mask().dataset.owner==='bubble-1','独立マスクの所属移動');await settle();
  check(document.querySelector('.paint-input')===surface,'生成マスクの移動で描画面を閉じない');check(tools()===signature&&mask().classList.contains('is-selected'),'生成マスクの選択・道具・色・太さを保持');
  check(row('continuity-bottom').dataset.owner==='bubble-0'&&row('continuity-top').dataset.owner==='bubble-0'&&!!group('bubble-0').parentElement!.querySelector('.bubble-native-row'),'マスクだけが移動し画像と文字は残る');
  check(decoded.length===0,'生成マスクの移動で原画像を再デコードしない');check(!!button('ペンツールを開く'),'生成マスクの移動で閉じたツールパレットを開かない');
  await save();const moved=await stored();check(moved.manga.pages[0].panels[0].bubbles[1].paint_overlay?.paint?.layers.some(layer=>layer.id==='continuity-mask')===true,'独立マスクの所属を通常レイヤーとして保存');
  history('元に戻す').click();await settle();check(mask().dataset.owner==='bubble-0','所属移動を1回のUndoで復元');
  history('やり直す').click();await settle();check(mask().dataset.owner==='bubble-1','所属移動をRedoで復元');
  await drag(mask().querySelector<HTMLElement>('.layer-select')!,group('bubble-0'),.5,true);await save();check(mask().dataset.owner==='bubble-1','ドラッグ取消しでマスクの所属を変えない');
  const guideRow=group('background').parentElement!.querySelector<HTMLElement>('[data-layer]')!;guideRow.querySelector<HTMLButtonElement>('.layer-select')!.click();await settle();
  const guideSurface=document.querySelector<HTMLElement>('.paint-input')!,guideBox=guideSurface.getBoundingClientRect(),gx=guideBox.left+guideBox.width*.4,gy=guideBox.top+guideBox.height*.4;
  guideSurface.dispatchEvent(new PointerEvent('pointerdown',{pointerId:122,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:gx,clientY:gy,bubbles:true,cancelable:true}));
  window.dispatchEvent(new PointerEvent('pointerup',{pointerId:122,pointerType:'mouse',isPrimary:true,button:0,buttons:0,clientX:gx,clientY:gy,bubbles:true,cancelable:true}));await settle();await save();
  check((await stored()).manga.pages[0].panels[0].background_images?.some(image=>image.paint?.layers.some(layer=>layer.strokes.length>0))===true,'まとまり移動後も未保存だったあたりへ描画し保存できる');
  button('テキスト1の文字を隠す').click();await settle();button('テキスト1の文字を固定').click();await settle();
  row('continuity-bottom').querySelector<HTMLButtonElement>('.layer-select')!.click();await settle();button('選択').click();await settle();
  check(!!document.querySelector('.paint-input'),'文字を隠して固定しても画像のV選択を開始');
  await save();const beforeMove=await stored(),beforeNative=beforeMove.manga.pages[0].panels[0].bubbles[0];
  const paper=document.querySelector<HTMLElement>('.paint-input')!,r=paper.getBoundingClientRect(),px=r.left+r.width*110/210,py=r.top+r.height*52/297;
  paper.dispatchEvent(new PointerEvent('pointerdown',{pointerId:124,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:px,clientY:py,bubbles:true,cancelable:true}));
  window.dispatchEvent(new PointerEvent('pointermove',{pointerId:124,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:px+12,clientY:py+9,bubbles:true,cancelable:true}));
  window.dispatchEvent(new PointerEvent('pointerup',{pointerId:124,pointerType:'mouse',isPrimary:true,button:0,buttons:0,clientX:px+12,clientY:py+9,bubbles:true,cancelable:true}));await settle();await save();
  const afterNative=(await stored()).manga.pages[0].panels[0].bubbles[0];
  check(JSON.stringify(afterNative.bbox)===JSON.stringify(beforeNative.bbox)&&afterNative.hidden===true&&afterNative.nativeLocked===true,'画像の移動で隠れた文字の座標・目・固定を保持');
  const beforeLayer=beforeNative.paint_overlay!.paint!.layers.find(layer=>layer.id==='continuity-bottom')!,afterLayer=afterNative.paint_overlay!.paint!.layers.find(layer=>layer.id==='continuity-bottom')!;
  check(JSON.stringify(afterLayer.image!.bbox)!==JSON.stringify(beforeLayer.image!.bbox),'画像1枚の紙面座標だけが移動');
  await drag(row('continuity-bottom').querySelector<HTMLElement>('.layer-select')!,scope().querySelector<HTMLElement>('.panel-frame-layer')!,.5);await wait(()=>row('continuity-bottom').dataset.owner?.startsWith('panel')===true,'画像だけを文字フォルダー外へ移動');await settle();
  check(row('continuity-top').dataset.owner==='bubble-0'&&!!group('bubble-0').parentElement!.querySelector('.bubble-native-row'),'画像をフォルダー外へ出しても兄弟と文字を保持');
  button('ペンツールを開く')?.click();await settle();button('ペン').click();await settle();button('ペンツールを閉じる')?.click();await settle();
  row('continuity-top').querySelector<HTMLButtonElement>('.layer-mask-toggle')!.click();await settle();
  const maskTools=tools(),maskSurface=document.querySelector('.paint-input');decoded.length=0;
  await drag(row('continuity-top').querySelector<HTMLElement>('.layer-select')!,group('bubble-1'),.5);await wait(()=>row('continuity-top').dataset.owner==='bubble-1','通常マスク付きレイヤーを移動');await settle();
  check(document.querySelector('.paint-input')===maskSurface&&tools()===maskTools,'通常マスク編集中の所属移動でも道具を保持');check(row('continuity-top').querySelector('.layer-mask-toggle')?.getAttribute('aria-pressed')==='true','通常マスクの編集先が移動に追従');check(decoded.length===0,'同コマの通常レイヤー移動で画像を再デコードしない');
  decoded.length=0;await drag(row('continuity-top').querySelector<HTMLElement>('.layer-select')!,scope(1).querySelector<HTMLElement>('.panel-layer-heading')!,.65);await wait(()=>row('continuity-top').closest<HTMLElement>('[data-paint-panel]')?.dataset.paintPanel==='1','別コマへの移動');await settle();
  check(document.querySelector('.paint-input')===maskSurface&&tools()===maskTools&&row('continuity-top').querySelector('.layer-mask-toggle')?.getAttribute('aria-pressed')==='true','別コマでも描画面・道具・通常マスク選択を保持');
  check(!document.querySelector('.paint-error'),'移動先の他ownerの画像も欠落せず表示');
  check(!!button('ペンツールを開く'),'別コマへの移動で閉じたツールパレットを開かない');
  button('ペンツールを開く')?.click();await settle();
  await exitPaintWithEscape();await settle();
  const layout=tools();await drag(row('continuity-top').querySelector<HTMLElement>('.layer-select')!,scope().querySelector<HTMLElement>('.panel-frame-layer')!,.5);await wait(()=>row('continuity-top').closest<HTMLElement>('[data-paint-panel]')?.dataset.paintPanel==='0','配置中の移動');await settle();
  check(!document.querySelector('.app-shell.is-painting')&&tools()===layout,'配置中の移動はペイントを開かず道具を保持');
  await save();render(null,host);render(<App/>,host);button('作品フォルダを開く').click();await wait(()=>!!host.querySelector('[data-owner-group="bubble-0"]'),'非表示文字を含む作品の再読込');await settle();check((await stored()).manga.pages[0].panels[0].bubbles[1].paint_overlay?.paint?.layers.some(layer=>layer.generationMask&&layer.name==='生成マスク'&&layer.strokes.length===1)===true,'作品を再読込して独立マスクの所属と内容を復元');
  report.textContent=`移動状態保持 PASS ${checks.length}\n${checks.join('\n')}`;
 }catch(error){report.textContent=`移動状態保持 FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
 finally{Object.defineProperty(HTMLImageElement.prototype,'src',descriptor);URL.createObjectURL=createUrl;run.disabled=false;}
}
