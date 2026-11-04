// 見込み: 人物状態の表示共有と既存の描画確定を通すページ選択で、色と編集対象を保つ。
// 合格: 実Appで注意色・一筆・一覧・Undo/Redoを確認。原稿/入力/保存失敗は合成、実タブレットは対象外。
import {options,render,type ComponentProps} from 'preact';
// @ts-expect-error The existing QA Vite config exports EditorApp without adding a production entry point.
import {EditorApp} from '../src/components/App';
import PaintEditor from '../src/components/PaintEditor';
import MangaCanvas from '../src/components/MangaCanvas';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {prepareImageAsset} from '../src/lib/imagePlacement';
import {saveFigureCropAssets,loadFigureCropAsset} from '../src/lib/figureCropStore';
import type {MangaPage,PaintLayer} from '../src/types';
import '../src/styles/global.css';

if(location.hostname!=='127.0.0.1'||location.port!=='4335')throw Error('Dedicated test origin required');
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href);
  return url.origin!==location.origin&&/^https?:$/.test(url.protocol)||url.pathname.startsWith('/__nyamuru/')
    ?Promise.resolve(Response.json({error:'Paint selection QA: services disabled'},{status:503})):originalFetch(input,init);
};
const report=document.getElementById('report')!,run=document.getElementById('run') as HTMLButtonElement;
const checks:string[]=[],check=(value:unknown,label:string)=>{if(!value)throw Error(label);checks.push(label);};
const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
async function wait(test:()=>unknown,label:string){const start=performance.now();while(!test()){if(performance.now()-start>10000)throw Error(label);await tick();}await tick();}
const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node=>node.getAttribute('aria-label')===name||node.textContent===name)!;
const activePaper=()=>document.querySelector<HTMLElement>('.spread-pane.is-spread-active .manga-paper')!;
const partnerPaper=()=>document.querySelector<HTMLElement>('.spread-pane.is-spread-partner .manga-paper')!;
const heading=()=>document.querySelector('.page-switcher strong')?.textContent;
let paintProps:ComponentProps<typeof PaintEditor>,failNextApply=false;
const pages=new Map<number,MangaPage>(),previousVNode=options.vnode;
options.vnode=vnode=>{
  previousVNode?.(vnode);
  if(vnode.type===PaintEditor){
    const props=vnode.props as ComponentProps<typeof PaintEditor>,apply=props.onApply;
    props.onApply=async result=>{if(failNextApply){failNextApply=false;throw Error('QA: simulated image save failure');}await apply(result);};
    paintProps=props;
  }
  if(vnode.type===MangaCanvas){const props=vnode.props as unknown as ComponentProps<typeof MangaCanvas>;pages.set(props.page.page,props.page);}
};
const snapshot=()=>paintProps.controller!.current!.snapshot();
const selected=()=>snapshot().scene.owners.flatMap(owner=>owner.paint.layers).find(layer=>layer.id===snapshot().layerId)!;
function currentLayers():PaintLayer[]{const page=pages.get(1)!;return page.panels.flatMap(panel=>(panel.images??[]).flatMap(image=>image.paint?.layers??[]));}
function paperPress(paper:HTMLElement){paper.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:9,isPrimary:true,button:0,buttons:1,pointerType:'mouse'}));}
async function draw(){
  const target=document.querySelector<HTMLElement>('.paint-input')!,rect=target.getBoundingClientRect();
  const event=(type:string,x:number,y:number,buttons:number)=>new PointerEvent(type,{bubbles:true,pointerId:2,isPrimary:true,pointerType:'mouse',button:0,buttons,pressure:buttons?.5:0,clientX:rect.x+rect.width*x/210,clientY:rect.y+rect.height*y/297});
  target.dispatchEvent(event('pointerdown',45,45,1));target.dispatchEvent(event('pointermove',120,110,1));await tick();target.dispatchEvent(event('pointerup',120,110,0));await tick();
}
run.onclick=async()=>{
  run.disabled=true;report.textContent='検証中';
  try{
    const doc=createEmptyWorkspaceDocument(),source=document.createElement('canvas');source.width=source.height=32;
    const ctx=source.getContext('2d')!;ctx.fillStyle='#2496c8';ctx.fillRect(0,0,32,32);
    const blob=await new Promise<Blob>(resolve=>source.toBlob(value=>resolve(value!),'image/png'));
    const asset=await prepareImageAsset(new File([blob],'状態検証.png',{type:'image/png'}));await saveFigureCropAssets([{id:asset.storageId,blob}]);
    doc.manga.image_assets=[asset];doc.manga.meta.title='描画・ページ選択の検証';doc.manga.meta.episode_id='paint-page-selection-qa';doc.manga.meta.page_count=2;
    doc.manga.finish_settings={width_mm:210,height_mm:297,dpi:100,bleed_mm:0};
    doc.manga.characters.push({localId:'assigned',name:'確定人物',role:'',scope:'episode'});
    const analog={schemaVersion:1 as const,sourceRegionId:'qa-review',assetId:asset.storageId,sourceBBox:{x:0,y:0,w:1,h:1},detectionSource:'body' as const,draft:true as const};
    doc.manga.pages=[{page:1,canvas:{w:210,h:297,unit:'mm'},panels:[{id:1,shape:{type:'rect',x:20,y:30,w:170,h:220},bg:0,action:'1ページ目',bubbles:[],figures:[
      {name:'人物あたり',bbox:{x:30,y:60,w:32,h:50},size:'bust-up'},
      {name:'確定人物',refId:'assigned',bbox:{x:70,y:60,w:32,h:50},size:'bust-up'},
      {name:'要確認',refId:'assigned',bbox:{x:110,y:60,w:32,h:50},analogImport:{...analog,analysisReview:'low-confidence'}},
      {name:'小道具',kind:'prop',bbox:{x:150,y:60,w:25,h:40}},
    ]}]},{page:2,canvas:{w:210,h:297,unit:'mm'},panels:[{id:1,shape:{type:'rect',x:20,y:30,w:170,h:220},bg:0,action:'2ページ目',bubbles:[]}]}];
    const figureData=JSON.stringify(doc.manga.pages[0].panels[0].figures);
    localStorage.setItem('manga-name-studio.spread-view.v2','true');
    render(<EditorApp startupWorkspace={{document:doc,hasDocument:true}}/>,document.getElementById('app')!);
    await wait(()=>document.querySelectorAll('.manga-paper').length===2,'見開きが開きません');
    const open=button('ペンツールを開く');if(open)open.click();
    const folder=document.querySelector<HTMLButtonElement>('.panel-layer-heading .layer-folder-toggle[aria-expanded="false"]');folder?.click();await tick();
    button('コマ 01の枠を選択').click();await tick();button('ラスターレイヤー追加').click();
    await wait(()=>document.querySelector('[data-paint-owner="figure-2"] .paint-preview-canvas'),'描画原画の準備が終わりません');
    // 見込み: コマ直下への追加でも同じコマの未確定色を維持。合格: 未割当/要確認のCSS装飾があり、確定/小道具にはない。PNGは青のまま。
    const status=(i:number)=>document.querySelector<HTMLElement>(`[data-paint-owner="figure-${i}"] .paint-figure-status`)!;
    check(status(0)?.classList.contains('is-unassigned')&&getComputedStyle(status(0),'::after').borderTopColor==='rgb(220, 170, 39)','追加後も未割当人物の黄色枠を表示');
    check(status(2)?.classList.contains('is-analysis-review')&&getComputedStyle(status(2),'::after').backgroundColor==='rgba(255, 225, 69, 0.24)','追加後も要確認人物の黄色を表示');
    check(getComputedStyle(status(1),'::after').content==='none'&&getComputedStyle(status(3),'::after').content==='none','確定人物と小道具を黄色にしない');
    const preview=document.querySelector<HTMLCanvasElement>('[data-paint-owner="figure-2"] canvas')!,pixel=preview.getContext('2d')!.getImageData(preview.width/2,preview.height/2,1,1).data;
    check(pixel[0]===36&&pixel[1]===150&&pixel[2]===200,'黄色は表示装飾だけで元画像Canvasへ焼き込まない');
    check(JSON.stringify(snapshot().scene.owners.filter(owner=>owner.figure).map(owner=>owner.figure))===figureData,'表示切替で人物の未確定データを変えない');
    const layerId=selected().id;button('ペン').click();await tick();await draw();
    const stroke=JSON.stringify(selected().strokes);check(selected().strokes.length===1,'ページ移動前に一筆を記録');
    // 見込み: 確定に失敗したページ移動は元の編集対象を保持。合格: header01、session1、同一layer/一筆。保存失敗のみ固定応答。
    failNextApply=true;paperPress(partnerPaper());await wait(()=>!failNextApply,'保存失敗を通りません');
    check(heading()==='01'&&paintProps.page===1&&selected().id===layerId&&JSON.stringify(selected().strokes)===stroke,'確定失敗時はページ・選択レイヤー・一筆を保持');
    // 見込み: 反対ページ余白の選択も既存の確定完了後に移る。合格: header02、session終了、元ページの同一layer/strokeを保存。実App/合成pointer。
    paperPress(partnerPaper());await wait(()=>heading()==='02'&&!paintProps.initial,'確定後のページ移動が完了しません');
    check(!document.querySelector('.paint-input'),'別ページへ移った後に元ページの描画面を残さない');
    check(JSON.stringify(currentLayers().find(layer=>layer.id===layerId)?.strokes)===stroke,'元ページのレイヤーIDと線を保持してページ移動');
    button('前のページ').click();await wait(()=>heading()==='01','元ページへ戻れません');
    check(!!document.querySelector(`.layer-row[data-layer="${layerId}"]`),'元ページへ戻ると描いたレイヤーを一覧に表示');
    const row=document.querySelector<HTMLButtonElement>(`.layer-row[data-layer="${layerId}"] .layer-select`)!;row.click();
    await wait(()=>paintProps.initial&&snapshot().layerId===layerId,'元レイヤーの再編集を開始できません');
    check(JSON.stringify(selected().strokes)===stroke,'戻ったレイヤーで同じ一筆を再編集できる');
    // 見込み: ページ往復は描線のUndo境界を追加しない。合格: 1回Undoで線だけ0、Redoで同一strokeを復元。実historyを使用。
    document.querySelector<HTMLButtonElement>('.app-header [aria-label^="元に戻す"]')!.click();await wait(()=>paintProps.controller?.current&&selected()?.strokes.length===0,'Undoで一筆を戻せません');
    check(snapshot().layerId===layerId,'ページ往復後もUndoはレイヤーを保持');
    document.querySelector<HTMLButtonElement>('.app-header [aria-label^="やり直す"]')!.click();await wait(()=>paintProps.controller?.current&&selected()?.strokes.length===1,'Redoで一筆を復元できません');
    check(JSON.stringify(selected().strokes)===stroke,'Redoで同一の一筆を復元');
    check(JSON.stringify(Array.from(new Uint8Array(await (await loadFigureCropAsset(asset.storageId))!.arrayBuffer())))===JSON.stringify(Array.from(new Uint8Array(await blob.arrayBuffer()))),'原画assetのbytesを保持');
    check(activePaper()!==partnerPaper(),'見開きの左右は別のページとして保持');
    report.textContent=`PASS ${checks.length}\n${checks.join('\n')}`;
  }catch(error){report.textContent=`FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;throw error;}
  finally{run.disabled=false;}
};
