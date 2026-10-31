import graph from '../examples/comfyui/qwen-turbo-0-refs.api.json';
import binding from '../examples/comfyui/qwen-turbo-0-refs.binding.json';
import {currentGenerationPreferences,saveGenerationPreferences} from '../src/lib/generationPreferences';
const workflow={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'文字生成の模擬登録',version:1,graph,binding};
const preferences=currentGenerationPreferences();preferences.execution='local';preferences.local.workflowId=workflow.id;saveGenerationPreferences(localStorage,preferences);
// 見込み: 既存EditorAppの文字更新でコマ/前景の履歴と保存も一致する。
// 合格: 描き文字の情報欄で道具にかかわらず13/7項目を保持し、変更/解除/同値/Undo/Redo/再読込。範囲: 隔離文書の実UI。モデル・実作品・外部サービスは使わない。
import {render} from 'preact';
import App from '../src/components/App';
import {createPortableProject} from '../src/lib/portableProject';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {createFrameArtwork,prepareImageAsset} from '../src/lib/imagePlacement';
import {saveFigureCropAssets} from '../src/lib/figureCropStore';
import type {MangaDocument} from '../src/types';
import '../src/styles/global.css';
if(location.origin!=='http://127.0.0.1:4341')throw Error('Dedicated lettering QA origin required');
const source=createEmptyWorkspaceDocument();source.manga.meta.title='描き文字設定確認';source.manga.meta.episode_id='lettering-style-qa';
source.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:15,y:20,w:160,h:110},bg:0,action:null,bubbles:[
 {text:'ドン！',shape:'handwritten',lettering_description:'使わない描き方の旧指定',bbox:{x:35,y:40,w:45,h:25}},
 {text:'台詞',shape:'normal',bbox:{x:100,y:40,w:40,h:25}},
 {text:'写植',shape:'typeset',bbox:{x:35,y:85,w:40,h:20}}]}];
source.manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',bubbles:[{text:'ふわっ',shape:'handwritten',bbox:{x:40,y:170,w:50,h:30}},{text:'前景の写植フォルダ',shape:'typeset',bbox:{x:90,y:170,w:40,h:20}}],screen_text:[{text:'前景の独立写植',bbox:{x:40,y:220,w:60,h:20}}]};
source.manga.finish_settings={width_mm:182,height_mm:257,dpi:100,bleed_mm:0};
source.manga.pages[0].panels[0].screen_text=[{text:'独立した写植',bbox:{x:20,y:115,w:60,h:10}}];
// Both originals are generated fixture pixels, linked through the normal OCR ownership fields.
const originalCanvas=document.createElement('canvas');originalCanvas.width=originalCanvas.height=16;
originalCanvas.getContext('2d')!.fillRect(2,2,12,12);
const originalBlob=await new Promise<Blob>(resolve=>originalCanvas.toBlob(blob=>resolve(blob!),'image/png'));
const originalAsset=await prepareImageAsset(new File([originalBlob],'文字原画QA.png',{type:'image/png'}));
await saveFigureCropAssets([{id:originalAsset.storageId,blob:originalBlob}]);source.manga.image_assets=[originalAsset];
for(const overlay of [false,true]){
 const id=overlay?'page-original':'panel-original',page=source.manga.pages[0],target=overlay?page.page_overlay!:page.panels[0],text=target.bubbles![0];
 text.analogTextImport={schemaVersion:1,sourceRegionId:id,assetId:originalAsset.storageId,sourceBBox:{x:0,y:0,w:1,h:1},detectionSource:'baberu',recognitionEngine:'Baberu OCR',needsReview:false,levelAdjusted:true,rasterLayerInitialized:true,rasterLayerSeparated:true,originalImageId:id};
 const image={...createFrameArtwork(originalAsset,{x:120,y:overlay?180:80,w:10,h:10}),id,bubbleOriginal:{sourceRegionId:id,name:'文字の原画'}};
 if(overlay)page.images=[image];else page.panels[0].images=[image];
}
const generatedCanvas=document.createElement('canvas');generatedCanvas.width=generatedCanvas.height=32;
generatedCanvas.getContext('2d')!.fillRect(0,0,32,32);
const generatedBlob=await new Promise<Blob>(resolve=>generatedCanvas.toBlob(blob=>resolve(blob!),'image/png'));
const generatedAsset=await prepareImageAsset(new File([generatedBlob],'生成UI検証.png',{type:'image/png'})),generatedImage=generatedCanvas.toDataURL('image/png');
let generationMock=false,generationJob:Record<string,unknown>={};
const generationRequests:Array<Record<string,unknown>>=[],generationCalls:string[]=[];
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input),location.href),path=url.pathname.replace(/^\/__nyamuru\/(?:bridge|supervisor)/,'');
 if(generationMock){
  generationCalls.push(path);
  const body=init?.body?JSON.parse(String(init.body)): {},supervisor={service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1},bridge={service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3};
  if(path==='/api/comfy-workflows/list')return Promise.resolve(Response.json({...bridge,workflows:[workflow]}));
  if(path==='/api/qwen-generation/select')return Promise.resolve(Response.json({...bridge,...generationJob,status:'succeeded',selected_candidate:body.candidate_index,image:generatedImage,file_name:`qwen_${generationJob.job_id}.png`}));
  if(path==='/api/health')return Promise.resolve(Response.json(bridge));
  if(path==='/api/panel-actions/prepare')throw Error('Text generation must not prepare Gemma');
  if(path==='/api/new-creation/start')return Promise.resolve(Response.json({...supervisor,lease_token:'text-generation-qa'}));
  if(path==='/api/new-creation/stop')return Promise.resolve(Response.json({...supervisor,released:true}));
  if(path==='/api/image-generation/prepare')return Promise.resolve(Response.json({...supervisor,llm_stopped:true}));
  if(path==='/api/qwen-generation/prepare'){
   generationRequests.push(body);generationJob={profile:body.profile,job_id:body.job_id,request_sha256:'a'.repeat(64),label:body.label,width:32,height:32,status:'prepared'};
   return Promise.resolve(Response.json({...bridge,...generationJob}));
  }
  if(path==='/api/image-generation/submit')return Promise.resolve(Response.json({...supervisor,...generationJob,status:'succeeded',candidates:Array.from({length:5},(_,i)=>({index:i+1,seed:260921+i,image:generatedImage})),file_name:`qwen_${generationJob.job_id}.png`}));
 }
 return /^https?:$/.test(url.protocol)&&(url.origin!==location.origin||url.pathname.startsWith('/__nyamuru/'))?Promise.resolve(Response.json({error:'Lettering QA: services disabled'},{status:503})):originalFetch(input,init);
};
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
const click=async(name:string)=>{await wait(()=>{const e=button(name);return !!e&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';},`Button unavailable: ${name}`);button(name).click();await tick();};
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
const checks:string[]=[],check=async(ok:()=>boolean,label:string)=>{await wait(ok,label);checks.push(label);};
async function run(){
 await open();
 if(button('ペンツールを開く'))await click('ペンツールを開く');
 await wait(()=>!!button('選択'),'道具');
 await select();await wait(()=>visible(pen()),'描き文字ペン');
 await check(()=>pen()!.options.length===14,'ペン13種と未指定');
 await check(()=>document.querySelectorAll('.handwritten-expression-options input').length===7,'表現7種');
 const fields=document.querySelector('.handwritten-style-fields')!;
 await check(()=>fields.previousElementSibling?.textContent?.startsWith('対応キャラクター')===true,'対応キャラクターの直下');
 await check(()=>history('元に戻す').disabled,'選択だけでは履歴を作らない');
 await setPen('g-pen-firm');await savedWait(()=>bubble().lettering_pen==='g-pen-firm','ペン保存');
 history('元に戻す').click();await savedWait(()=>!bubble().lettering_pen,'ペンUndo');
 history('やり直す').click();await savedWait(()=>bubble().lettering_pen==='g-pen-firm','ペンRedo');
 await setPen('g-pen-firm');history('元に戻す').click();await savedWait(()=>!bubble().lettering_pen,'同値は履歴を増やさない');
 await check(()=>history('元に戻す').disabled,'同じペンの再指定は編集しない');history('やり直す').click();await savedWait(()=>bubble().lettering_pen==='g-pen-firm','Redo');
 expression('かすれ').click();await savedWait(()=>bubble().lettering_expressions?.includes('scratchy')===true,'表現保存');
 expression('いきおい').click();await savedWait(()=>bubble().lettering_expressions?.length===2,'複数表現');
 history('元に戻す').click();await savedWait(()=>bubble().lettering_expressions?.length===1,'表現Undo');
 history('やり直す').click();await savedWait(()=>bubble().lettering_expressions?.length===2,'表現Redo');await check(()=>true,'ペンと複数表現を各1回でUndo/Redo');
 await select(true);await check(()=>pen()!.value==='','前景のペンは独立');await setPen('pencil-hb');await savedWait(()=>bubble(true).lettering_pen==='pencil-hb','前景保存');
 expression('かわいい').click();await savedWait(()=>bubble(true).lettering_expressions?.includes('cute')===true,'前景表現保存');
 await check(()=>bubble().lettering_pen==='g-pen-firm'&&bubble().lettering_expressions?.length===2,'前景編集でコマの指定を変えない');
 history('元に戻す').click();await savedWait(()=>!bubble(true).lettering_expressions,'前景Undo');history('やり直す').click();await savedWait(()=>bubble(true).lettering_expressions?.includes('cute')===true,'前景Redo');await check(()=>true,'前景もUndo/Redo');
 // 見込み: Vへ戻り描き文字を選んでも、情報ウィンドウの設定を維持する。
 // 合格: 13/7項目・指定値・編集可否を保持し、×→矢印で再表示しても消えない。範囲: 実Appの情報欄と保存、モデルなし。
 await click('選択');
 document.querySelector<HTMLElement>('[data-content-kind="bubble"][data-content-index="0"][data-content-overlay]')!.click();await tick();
 await check(()=>visible(pen())&&!pen()!.disabled&&pen()!.value==='pencil-hb','選択ツールで描き文字を選んでもペン指定を表示・編集できる');
 await check(()=>document.querySelectorAll('.handwritten-expression-options input').length===7&&expression('かわいい').checked,'選択ツールでも表現7種と選択を保持');
 await click('文字ツールの設定を閉じる');await check(()=>!visible(pen()),'×でウィンドウだけを閉じる');
 await click('文字のツール一覧');await check(()=>visible(pen())&&pen()!.options.length===14,'Tを有効にせず再表示してもペン13種がある');
 await setPen('ballpoint');await savedWait(()=>bubble(true).lettering_pen==='ballpoint','選択ツールからペン変更を保存');
 await setPen('pencil-hb');await savedWait(()=>bubble(true).lettering_pen==='pencil-hb','選択ツールから元のペンへ戻す');
 await select(false,1);await check(()=>!pen(),'フキダシでは非表示');await select(false,2);await check(()=>!pen(),'写植では非表示');
 render(null,host);mount();await tick();await open();if(button('ペンツールを開く'))await click('ペンツールを開く');await select();await wait(()=>pen()?.value==='g-pen-firm','再読込');
 await check(()=>expression('かすれ').checked&&expression('いきおい').checked,'再読込後も複数選択を保持');
 await select(true);await check(()=>pen()?.value==='pencil-hb'&&expression('かわいい').checked,'再読込後も前景の指定を保持');
 await setPen('');expression('かわいい').click();await savedWait(()=>!bubble(true).lettering_pen&&!bubble(true).lettering_expressions,'全解除');
 await check(()=>true,'未指定・全解除で保存値を削除');
 if(button('コマ 01を展開'))await click('コマ 01を展開');
 await verifyTextFolderInfo();
 await verifyTextToolRecovery();
 await verifyPointTextRecovery();
 await verifyTextInfoGeneration();
}

const infoBody=()=>document.querySelector<HTMLTextAreaElement>('[aria-label="選択中の文字の本文"]');
const toolActive=(name:string)=>button(name)?.getAttribute('aria-pressed')==='true';
const clickNode=async(node:HTMLButtonElement|null)=>{if(!node||node.disabled||node.getAttribute('aria-disabled')==='true')throw Error('Layer control unavailable: '+(node?.outerHTML??'missing element'));node.click();await tick();};
const palette=(overlay:boolean)=>document.querySelector<HTMLElement>(`.page-layer-palette .paint-layer-palette[data-paint-panel="0"][data-paint-overlay="${overlay}"]`)!;
const textRow=(overlay:boolean)=>palette(overlay).querySelector<HTMLElement>('[data-owner-group="bubble-0"]')!;

// 見込み: 子レイヤー選択でもownerの文字情報を表示し、Tで既存フォームを編集できる。
// 合格: コマ/前景の生成マスク・通常層・サブフォルダ・親見出しで本文一致。本文編集の保存/Undo/Redoも一致。範囲: 実App＋隔離フォルダ、モデルなし。
async function verifyTextFolderInfo(){
 for(const overlay of [false,true]){
  const label=overlay?'前景':'コマ',expected=bubble(overlay).text;
  await select(overlay);await click('文字ツールの設定を閉じる');await click('ペン');await click('生成マスク化');
  await click('写植文字');await click('情報');await wait(()=>infoBody()?.value===expected&&!infoBody()?.disabled,`${label}マスクから文字情報`);
  await check(()=>true,`${label}: 生成マスクから正しい文字情報を編集できる`);
  await click('ペン');
  await wait(()=>document.querySelector('.paint-input')?.getAttribute('aria-label')?.includes('テキスト1')===true,`${label}描き文字の描画面`);
  await check(()=>infoBody()?.value===expected,`${label}: 描画中も所属する文字情報を表示`);
  await click('ラスターレイヤー追加');
  await wait(()=>infoBody()?.value===expected,`${label}通常レイヤーの文字情報`);
  await check(()=>infoBody()?.value===expected,`${label}: 通常レイヤーでも文字情報を表示`);
  const selected=palette(overlay).querySelector('[data-layer][aria-selected="true"]')?.getAttribute('data-layer');
  await check(()=>Boolean(selected),`${label}: 情報表示で選択中の描画レイヤーを変えない`);
  await click('フォルダー追加');await check(()=>infoBody()?.value===expected,`${label}: サブフォルダでも文字情報を表示`);
  await click('写植文字');await wait(()=>!infoBody()?.disabled,`${label}編集可能`);
  const body=infoBody()!;body.value=`${expected}確認`;body.dispatchEvent(new Event('input',{bubbles:true}));await tick();
  await savedWait(()=>bubble(overlay).text===`${expected}確認`,`${label}本文編集を保存`);
  history('元に戻す').click();await savedWait(()=>bubble(overlay).text===expected,`${label}本文Undo`);
  history('やり直す').click();await savedWait(()=>bubble(overlay).text===`${expected}確認`,`${label}本文Redo`);
  await check(()=>true,`${label}: 子レイヤーからの本文変更も保存・Undo/Redo`);
  await click('選択');await clickNode(textRow(overlay).querySelector('.layer-group-select'));
  await click('写植文字');await click('情報');
  await check(()=>infoBody()?.value===`${expected}確認`&&!infoBody()?.disabled,`${label}: フォルダ見出しからも同じ本文を編集`);
  await click('文字ツールの設定を閉じる');await check(()=>!toolActive('写植文字'),`${label}: 閉じるとTを終了`);
  const row=textRow(overlay),toggle=row.querySelector<HTMLButtonElement>('.layer-folder-toggle');
  if(toggle?.getAttribute('aria-expanded')==='false')await clickNode(toggle);
  await clickNode(palette(overlay).querySelector(`[data-original-raster="${overlay?'page':'panel'}-original"] .layer-select`));
  await click('写植文字');await click('情報');
  await check(()=>infoBody()?.value===`${expected}確認`&&!infoBody()?.disabled,`${label}: 原画レイヤーからも親フォルダの文字情報を編集`);
  await click('文字ツールの設定を閉じる');
 }
}

// 見込み: 非文字ownerでTを閉じれば一時停止だけ解除し、生成マスクと直前の道具を保持する。
// 合格: 投げ縄→塗り→Cmd+Z→T→×後の目/固定/選択が有効で追加履歴なし。別道具中の×は道具を変えない。範囲: 実Appに合成pointer入力、実ペンタブなし。
async function verifyTextToolRecovery(){
 await select(false);await click('文字ツールの設定を閉じる');await click('選択');
 await clickNode(palette(false).querySelector('[data-owner-group="background"] .layer-group-select'));
 await click('生成マスク化');
 await clickNode(palette(false).querySelector('[data-generation-mask="background"] .layer-select'));
 await wait(()=>palette(false).querySelector('[data-generation-mask="background"]')?.getAttribute('aria-selected')==='true','生成マスクを描画対象に選択');
 await click('投げ縄');
 const surface=document.querySelector<HTMLElement>('.paint-input')!,box=surface.getBoundingClientRect();
 const point=(x:number,y:number)=>({clientX:box.x+box.width*x,clientY:box.y+box.height*y,pointerId:91,button:0,buttons:1,isPrimary:true,bubbles:true,cancelable:true});
 surface.dispatchEvent(new PointerEvent('pointerdown',point(.2,.15)));
 for(const [x,y] of [[.4,.15],[.4,.3],[.2,.3]])window.dispatchEvent(new PointerEvent('pointermove',point(x,y)));
 window.dispatchEvent(new PointerEvent('pointerup',{...point(.2,.15),buttons:0}));await tick();
 await check(()=>Boolean(document.querySelector('.paint-input [class*="selection"]')), '投げ縄の選択範囲を作成');
 await click('バケツ');surface.dispatchEvent(new PointerEvent('pointerdown',point(.3,.2)));surface.dispatchEvent(new PointerEvent('pointerup',{...point(.3,.2),buttons:0}));await tick();
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true,cancelable:true}));await tick();
 const redoBefore=history('やり直す').disabled;
 await click('写植文字');await click('情報');await check(()=>!infoBody(),'背景では直前の文字情報を残さない');
 await click('文字ツールの設定を閉じる');
 const mask=palette(false).querySelector<HTMLElement>('[data-generation-mask="background"]')!;
 await check(()=>!toolActive('写植文字')&&toolActive('バケツ'),'×でTを終了しバケツへ復帰');
 await check(()=>!!mask&&!mask.querySelector<HTMLButtonElement>('.layer-select')?.disabled&&mask.querySelector('.layer-visibility')?.getAttribute('aria-disabled')!=='true','生成マスクを保持しレイヤー操作へ復帰');
 await check(()=>!mask.querySelector<HTMLButtonElement>('.layer-row-lock')?.disabled&&mask.querySelector('.layer-row-lock')?.getAttribute('aria-pressed')==='false','固定を増やさず操作可能');
 await check(()=>history('やり直す').disabled===redoBefore&&!redoBefore,'T開閉だけではRedoを失わない');
 await click('文字のツール一覧');await click('ペン');await click('文字ツールの設定を閉じる');
 await check(()=>toolActive('ペン'),'別の道具へ変更後の×はその道具を保持');
}

// 見込み: テキストownerを持たない独立写植も持ち替えで選択を失わない。
// 合格: P→Tで同じ本文を編集でき、入力中の×で入力面を終了。範囲: 実Appの合成文書、IME・実機入力は対象外。
async function verifyPointTextRecovery(){
 await click('選択');
 const item=document.querySelector<HTMLElement>('[data-content-kind="screen_text"][data-content-panel="0"]')!;
 item.click();await tick();await click('ペン');await click('写植文字');await click('情報');
 await check(()=>infoBody()?.value==='独立した写植'&&!infoBody()?.disabled,'独立写植のP→Tでも同じ文字情報へ戻る');
 item.querySelector<HTMLElement>('.screen-text-body')!.click();await tick();
 await check(()=>Boolean(document.querySelector('.native-text-input')),'写植の本文入力を開始');
 await click('文字ツールの設定を閉じる');
 await check(()=>!toolActive('写植文字')&&!document.querySelector('.native-text-input'),'入力中の×も本文入力とTを終了');
}
// 見込み: 文字情報の生成入口が描き文字/写植/独立写植を同じ差し込みへ渡す。取消しは無編集、追加だけを一度でUndoできる。
// 合格: コマ/前景の6対象で指示・対象・追加/Undo/Redo/保存が一致、旧欄/描き方なし。範囲: 実App＋隔離保存、HTTP/PNGのみ模擬。英文品質/実モデルは対象外。
async function verifyTextInfoGeneration(){
 generationMock=true;
 await check(()=>!document.querySelector('.handwritten-text-section')&&!document.querySelector('.panel-text-section'),'コマ情報の重複した文字欄を撤去');
 for(const overlay of [false,true])for(const sourceKind of ['handwritten','typeset','screen_text'] as const){
  const name=`${overlay?'前景':'コマ'}・${sourceKind}`,index=sourceKind==='handwritten'?0:sourceKind==='typeset'?(overlay?1:2):0;
  await click('選択');
  const selector=`[data-content-kind="${sourceKind==='screen_text'?'screen_text':'bubble'}"][data-content-index="${index}"]${overlay?'[data-content-overlay]':'[data-content-panel="0"]:not([data-content-overlay])'}`;
  document.querySelector<HTMLElement>(selector)!.click();await tick();await click('写植文字');await click('情報');
  const generateLabel=sourceKind==='handwritten'?'描き文字を生成':'写植文字を生成';
  const generateButton=button(generateLabel);await check(()=>!!generateButton&&!!generateButton.closest('#paint-bubble-info-slot'),`${name}: 文字情報内に生成ボタン`);
  await check(()=>!Array.from(document.querySelectorAll('.bubble-info-content label')).some(label=>['描き方','文字あたりを表示'].includes(label.textContent?.trim()??'')),`${name}: 不要な描き方/あたり欄なし`);
  await savedWait(()=>true,'取消し前の保存');
  const before=structuredClone(saved()),beforeUndo=history('元に戻す').disabled;
  const collection=()=>overlay?saved().manga.pages[0].page_overlay!:saved().manga.pages[0].panels[0];
  const original=(sourceKind==='screen_text'?collection().screen_text!:collection().bubbles!)[index],literal=original.text;
  const originalCenter=(()=>{const text=Array.from(document.querySelectorAll<HTMLElement>(selector)).find(e=>!e.closest('.is-spread-partner'))!,range=document.createRange();range.selectNodeContents(text.querySelector('.screen-text-body')??text.querySelector('.bubble-text-content')??text);const rect=range.getBoundingClientRect(),paper=text.closest('.manga-paper')!.getBoundingClientRect();return {x:(rect.x+rect.width/2-paper.x)*182/paper.width,y:(rect.y+rect.height/2-paper.y)*257/paper.height};})();
  await click(generateLabel);await wait(()=>!!document.querySelector('.qwen-generation-dialog'),'生成確認');
  const confirm=document.querySelector<HTMLTextAreaElement>('.qwen-prompt textarea')!;
  await check(()=>confirm.value.includes(literal)&&!confirm.value.includes('使わない描き方の旧指定')&&!confirm.value.includes('描き方：'),`${name}: 本文のみ正しく確認し旧描き方を送らない`);
  await click('閉じる');
  await savedWait(()=>JSON.stringify(saved())===JSON.stringify(before),'取消しで文書を変えない');
  await check(()=>history('元に戻す').disabled===beforeUndo,`${name}: 取消しで本文/配置/履歴を変えない`);
  await click(generateLabel);await wait(()=>!!document.querySelector('.qwen-generation-dialog'),'再確認');await wait(()=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).some(b=>b.textContent?.trim()==='5枚を生成する'&&!b.disabled),'ワークフロー確認');await click('5枚を生成する');
  await wait(()=>document.querySelectorAll('.qwen-candidate').length===5,'5候補');document.querySelectorAll<HTMLButtonElement>('.qwen-candidate')[2].click();await tick();await click('選んだ1枚を採用する');
  await wait(()=>!!button('新規レイヤーとして追加')&&!button('新規レイヤーとして追加').disabled,'模擬生成完了');
  const request=generationRequests.at(-1)!;await check(()=>request.content_kind===(sourceKind==='handwritten'?'handwritten':'typeset')&&(request.literal_text as string[])?.[0]===literal,`${name}: 正しい種類と本文で送信`);
  await click('新規レイヤーとして追加');await wait(()=>!document.querySelector('.qwen-generation-dialog'),'差し込み完了');
  const destination=sourceKind==='screen_text'?(overlay?before.manga.pages[0].page_overlay!.bubbles!.length:before.manga.pages[0].panels[0].bubbles.length):index;
  await savedWait(()=>collection().bubbles![destination]?.paint_overlay?.paint?.layers.some(layer=>!!layer.image)===true,`${name}画像保存`);
  const result=collection().bubbles![destination];
  await check(()=>result.text===literal&&result.shape===(sourceKind==='handwritten'?'handwritten':'typeset')&&JSON.stringify(result.bbox)===JSON.stringify(original.bbox),`${name}: 同じ本文・種類・配置のフォルダに追加`);
  if(sourceKind==='screen_text'){
   await check(()=>!collection().screen_text?.length,`${name}: 追加時だけ独立写植を既存の文字フォルダへ統合`);
   const target=Array.from(document.querySelectorAll<HTMLElement>(`[data-content-kind="bubble"][data-content-index="${destination}"]${overlay?'[data-content-overlay]':'[data-content-panel="0"]:not([data-content-overlay])'}`)).find(e=>!e.closest('.is-spread-partner'))!,range=document.createRange();range.selectNodeContents(target.querySelector('.bubble-text-content')!);const rect=range.getBoundingClientRect(),paper=target.closest('.manga-paper')!.getBoundingClientRect();
   await check(()=>Math.abs((rect.x+rect.width/2-paper.x)*182/paper.width-originalCenter.x)<.25&&Math.abs((rect.y+rect.height/2-paper.y)*257/paper.height-originalCenter.y)<.25,`${name}: 点文字の本文位置を保持 before=${originalCenter.x.toFixed(3)},${originalCenter.y.toFixed(3)} after=${((rect.x+rect.width/2-paper.x)*182/paper.width).toFixed(3)},${((rect.y+rect.height/2-paper.y)*257/paper.height).toFixed(3)} position=${JSON.stringify(result.text_position)}`);
  }
  history('元に戻す').click();await savedWait(()=>JSON.stringify(saved())===JSON.stringify(before),`${name}差し込みを1回でUndo`);
  history('やり直す').click();await savedWait(()=>collection().bubbles![destination]?.paint_overlay?.paint?.layers.some(layer=>!!layer.image)===true,`${name}Redo`);
  await check(()=>true,`${name}: 保存と1回のUndo/Redo`);
 }
 // 見込み: 手動ロックは入力を止め、AI生成は同じロックを保持したまま使える。
 // 合格: コマ全体＋文字、前景文字の各固定中でも確認を開け、取消しで作品不変。範囲: 実Appの情報portal、模擬HTTPのみ。
 for(const overlay of [false,true]){
  const name=overlay?'前景':'コマ';
  await clickNode(textRow(overlay).querySelector<HTMLButtonElement>('.layer-group-select'));
  await clickNode(textRow(overlay).querySelector<HTMLButtonElement>('.layer-row-lock'));
  const panelLock=()=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node=>node.getAttribute('aria-label')?.startsWith('コマ 01全体'))!;
  if(!overlay)await clickNode(panelLock());
  const generate=button('描き文字を生成');
  await check(()=>infoBody()?.disabled===true&&!generate.disabled&&!generate.closest('[inert],[aria-disabled="true"]'),`${name}: 固定中も手動入力だけを止め生成ボタンを保持`);
  await savedWait(()=>true,'固定状態を保存');const locked=structuredClone(saved());
  await click('描き文字を生成');await wait(()=>!!document.querySelector('.qwen-generation-dialog'),'固定中の生成確認');await click('閉じる');
  await savedWait(()=>JSON.stringify(saved())===JSON.stringify(locked),'固定中の取消しで作品を変えない');
  await check(()=>true,`${name}: 固定を解除せず生成確認を開閉できる`);
  if(!overlay)await clickNode(panelLock());
  const ownerLock=textRow(overlay).querySelector<HTMLButtonElement>('.layer-row-lock');
  if(ownerLock?.getAttribute('aria-pressed')==='true')await clickNode(ownerLock);
 }
 await click('写植文字');await wait(()=>!document.querySelector('.app-shell.is-painting'),'検証後の描画終了');
 await select(false,2);
 await check(()=>!generationCalls.includes('/api/panel-actions/prepare'),'文字生成でGemmaを起動しない');
}
const report=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ol');report.style.cssText='position:fixed;bottom:8px;left:170px;z-index:20000;background:white;color:black;max-height:55vh;overflow:auto;padding:8px;border:1px solid';summary.textContent='描き文字設定を検証中';report.append(summary,list);document.body.append(report);
void run().then(()=>{summary.textContent=`描き文字設定 PASS ${checks.length}`;}).catch(error=>{summary.textContent=`描き文字設定 FAIL: ${error instanceof Error?error.stack:String(error)}`;report.open=true;}).finally(()=>{for(const text of checks){const li=document.createElement('li');li.textContent=text;list.append(li);}});
