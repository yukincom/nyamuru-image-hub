import {render,type ComponentProps} from 'preact';
import {useContext} from 'preact/hooks';
import PaintEditor,{type PaintResult} from '../src/components/PaintEditor';
import PaintInputSurface,{PaintOwnerPreview} from '../src/components/PaintSceneView';
import PlacedImageView from '../src/components/PlacedImageView';
import {PaintLayerControlsContext,usePaintWorkspace,type PaintWorkspaceState} from '../src/lib/paintWorkspace';
import {applyOwnerPaint,newPaintLayer,paintAssetIds,paintScene,type PaintScene} from '../src/lib/paintDocument';
import {commitPaintStroke,paintStrokeBounds,previewPaintStroke,type PaintStrokePreview} from '../src/lib/paintGesture';
import {paintPreviewRenderer} from '../src/lib/paintRenderer';
import {defaultVectorStyle,vectorShape} from '../src/lib/vectorGeometry';
import {newToneLayer} from '../src/lib/paintTone';
import type {PaintController,PaintSessionSnapshot,SharedPaintHistory} from '../src/lib/paintSession';
import {workspaceHistory} from '../src/lib/workspaceHistory';
import {createFrameArtwork,prepareImageAsset} from '../src/lib/imagePlacement';
import {createProjectSnapshot,restoreProjectSnapshot} from '../src/lib/projectPersistence';
import {saveFigureCropAssets,deleteFigureCropAssets} from '../src/lib/figureCropStore';
import {editCanvasTextStyle} from '../src/lib/canvasText';
import {panelTestDocument} from './fixtures/emptyTestDocument';
import type {PaintStroke,Panel} from '../src/types';
import '../src/styles/global.css';

if(location.hostname!=='127.0.0.1'||!['4325','4335'].includes(location.port))throw Error('Dedicated test origin required');
const report=document.getElementById('report')!,run=document.getElementById('run') as HTMLButtonElement;
const raf=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
let oldReads=0,workspace:PaintWorkspaceState|null=null,ready=false;
const point=(x:number,y:number,time=0)=>({x,y,time,pressure:1});
const frame={x:10,y:10,w:80,h:80};
function makeScene(count:number):PaintScene{
  const strokes=Array.from({length:count},(_,i)=>{
    const x=20+(i%20)*26,y=20+Math.floor(i/20)*20;
    const points=[point(x,y),point(x+18,y+8,1)];
    return {tool:'line',color:'#66717a',size:2,get points(){oldReads++;return points;}} as PaintStroke;
  });
  return {frame:{x:0,y:0,w:100,h:100},colorMode:'color',owners:[{key:'page-direct',kind:'page',index:0,label:'検証用描画',frame:{...frame},paint:{version:1,width:600,height:600,dpi:190.5,guideInitialized:true,layers:[{...newPaintLayer('検証インク'),strokes}]}}]};
}
function Probe(){
  workspace=usePaintWorkspace();
  const {controls}=useContext(PaintLayerControlsContext);
  return <div style={{marginTop:'8px'}}><button id="undo" onClick={()=>workspace?.undo()}>取り消し</button><button id="redo" onClick={()=>workspace?.redo()}>やり直し</button><output id="ink-state">{workspace?.owner.paint.layers[0].strokes.length}本{workspace?.live?'・描画中':''}</output><div id="fixture-tools">{workspace?.tools}</div>{controls}{workspace?.status}</div>;
}
type MountOptions=Partial<Pick<ComponentProps<typeof PaintEditor>,'controller'|'resume'|'sharedHistory'|'initialOwner'|'assets'|'onApply'|'onClose'>>;
async function mount(scene:PaintScene,options:MountOptions={}){
  ready=false;workspace=null;
  render(<PaintEditor key={crypto.randomUUID()} initial={scene} assets={[]} page={1} panelIndex={0} overlay title="速度検証" onApply={async()=>{}} onClose={()=>{}} {...options} onReady={()=>{ready=true;}}>
    <div style={{position:'relative',width:'500px',height:'500px',marginTop:'12px',background:'white',border:'1px solid #889'}}>
      {scene.owners.map(owner=><PaintOwnerPreview key={owner.key} ownerKey={owner.key} container={scene.frame}/>)}<PaintInputSurface canvas={{w:100,h:100}}/>
    </div><Probe/>
  </PaintEditor>,document.getElementById('app')!);
  for(let i=0;i<120&&!ready;i++)await raf();if(!ready)throw Error('PaintEditor did not become ready');
  for(let i=0;i<4;i++)await raf();
}
function pointer(type:string,x:number,y:number,button=0){
  const input=document.querySelector<HTMLElement>('.paint-input')!,box=input.getBoundingClientRect();
  input.dispatchEvent(new PointerEvent(type,{pointerId:7,pointerType:'pen',isPrimary:true,button,buttons:type==='pointerup'?0:1,pressure:type==='pointerup'?0:1,clientX:box.x+x/100*box.width,clientY:box.y+y/100*box.height,bubbles:true,cancelable:true}));
}
const samples=()=>{
  const canvas=document.querySelector<HTMLCanvasElement>('.paint-preview-canvas')!;
  return canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
};
const percentile=(values:number[],fraction:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*fraction))];

async function rendererBenchmark(baked:boolean){
  const scene=makeScene(500),owner=scene.owners[0],canvas=document.createElement('canvas');canvas.width=canvas.height=600;
  const renderer=paintPreviewRenderer(),images=new Map(),durations:number[]=[];
  renderer.draw(canvas,owner.paint,images);oldReads=0;let preview:PaintStrokePreview|undefined;
  for(let i=0;i<120;i++){
    const stroke:PaintStroke={tool:'pen',color:'#000000',size:8,points:[point(150,150),point(200+i,200)]};
    const pending={ownerKey:owner.key,layerId:owner.paint.layers[0].id,stroke,bounds:paintStrokeBounds(stroke)};
    const start=performance.now();
    if(baked){const next=commitPaintStroke(scene,pending);renderer.draw(canvas,next.owners[0].paint,images);}
    else {preview=previewPaintStroke(scene,pending,preview)!;renderer.draw(canvas,preview.owner.paint,images,preview.live);}
    durations.push(performance.now()-start);if(i%20===19)await raf();
  }
  const result={p50_ms:+percentile(durations,.5).toFixed(3),p95_ms:+percentile(durations,.95).toFixed(3),historical_point_reads:oldReads};
  renderer.dispose();return result;
}

async function interaction(){
  const scene=makeScene(500);await mount(scene);oldReads=0;
  const delays:number[]=[];let sent=0;
  const painted=()=>{if(sent){delays.push(performance.now()-sent);sent=0;}};
  document.getElementById('app')!.addEventListener('paint-preview-rendered',painted);
  try{
    sent=performance.now();pointer('pointerdown',30,35);await raf();await raf();
    for(let i=0;i<120;i++){sent=performance.now();pointer('pointermove',30+i*.2,35+Math.sin(i/10)*3);await raf();await raf();}
    const previewReads=oldReads;
    check(previewReads===0,`実PaintEditorの120更新で過去500本の点読取0回（実測${previewReads}回）`);
    check(workspace!.owner.paint.layers[0].strokes.length===500&&Boolean(workspace!.live),'描画中は過去の層とlive線を別に保持');
    const before=samples();pointer('pointerup',30+119*.2,35+Math.sin(119/10)*3);await raf();await raf();const after=samples();
    check(before.length===after.length&&before.every((n,i)=>n===after[i]),'ペン確定前後の全画素が一致（二重描画なし）');
    check(workspace!.owner.paint.layers[0].strokes.length===501&&!workspace!.live,'確定時だけ一線を追加');
    document.getElementById('undo')!.click();await raf();await raf();check(workspace!.owner.paint.layers[0].strokes.length===500,'Undoで一線だけ戻る');
    document.getElementById('redo')!.click();await raf();await raf();check(workspace!.owner.paint.layers[0].strokes.length===501,'Redoで一線だけ復元');
    pointer('pointerdown',5,30);await raf();await raf();pointer('pointermove',97,85);await raf();await raf();
    const grown=workspace!.owner;check(grown.frame.x<frame.x&&grown.frame.x+grown.frame.w>frame.x+frame.w,'元枠の左から右外まで描画中にも拡張');
    pointer('pointerup',97,85);await raf();await raf();
    const saved=workspace!.owner,old=saved.paint.layers[0].strokes[0].points[0];
    check(Math.abs(saved.frame.x+old.x*saved.frame.w/saved.paint.width-(frame.x+20*frame.w/600))<1e-8,'拡張しても過去の絵の紙面位置は不変');
    check(saved.paint.layers[0].strokes.length===502&&JSON.parse(JSON.stringify(saved.paint)).layers[0].strokes.length===502,'拡張した線を保存データへ保持');
    return {events:delays.length,input_to_preview_p50_ms:+percentile(delays,.5).toFixed(3),input_to_preview_p95_ms:+percentile(delays,.95).toFixed(3),historical_point_reads:previewReads};
  }finally{document.getElementById('app')!.removeEventListener('paint-preview-rendered',painted);}
}
async function maskInteraction(){
  const scene=makeScene(0),tone=newToneLayer();scene.owners[0].paint.layers=[tone];await mount(scene);
  pointer('pointerdown',95,30);await raf();await raf();pointer('pointermove',96,70);await raf();await raf();
  check(workspace!.live?.target==='mask'&&!workspace!.live.stroke.selection,'実マスク入力に暗黙の矩形選択なし');
  check(workspace!.owner.frame.x+workspace!.owner.frame.w>96,'マスクも筆跡に合わせてレイヤーの描画領域を確保');
  const before=samples();check(before.some((n,i)=>i%4===3&&n>0),'元の描画領域より先のトーンを実画素で確認');
  pointer('pointerup',96,70);await raf();await raf();const after=samples();
  check(before.length===after.length&&before.every((n,i)=>n===after[i]),'マスク確定前後の全画素一致');
  const original=workspace!.owner,mask=original.paint.layers[0].mask!;
  check(mask.strokes.length===1&&mask.strokes[0].selection===undefined&&original.paint.layers.length===1,'同じトーンレイヤーのマスクとして一度だけ確定');
  pointer('pointerdown',95,30,5);await raf();await raf();pointer('pointerup',95,30,5);await raf();await raf();
  check(workspace!.owner.paint.layers[0].mask!.strokes.at(-1)!.tool==='eraser','同じマスクを消しゴムで編集可能');
  document.getElementById('undo')!.click();await raf();await raf();
  check(workspace!.owner.paint.layers[0].mask!.strokes.length===1,'マスク消しゴムだけUndo可能');
  pointer('pointerdown',3,3);await raf();await raf();pointer('pointercancel',3,3);await raf();await raf();
  check(workspace!.owner.frame===original.frame&&workspace!.owner.paint.layers[0].mask!.strokes.length===1&&!workspace!.live,'マスク取消で仮の拡張・筆跡を残さない');
}
async function historyInteraction(){
  const settle=async()=>{await raf();await raf();};
  const select=async(name:string)=>{document.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!.click();await settle();};
  for(const kind of ['raster','vector'] as const){
    const scene=makeScene(0),layer=scene.owners[0].paint.layers[0];
    layer.kind=kind;
    if(kind==='vector')layer.paths=[vectorShape('rectangle',point(150,150),point(450,450),{...defaultVectorStyle(),fill:'#000000'})];
    else layer.strokes=[{tool:'rectangle',color:'#000000',fill:'#000000',size:4,points:[point(150,150),point(450,450)]}];
    await mount(scene);await select('選択');
    const baseline=workspace!.scene;
    pointer('pointerdown',40,40);pointer('pointermove',45,45);pointer('pointerup',45,45);await settle();
    const moved=workspace!.scene;
    check(moved!==baseline&&workspace!.canUndo,`${kind}: 実移動を一度確定`);
    workspace!.undo();await settle();check(workspace!.scene===baseline&&!workspace!.canUndo&&workspace!.canRedo,`${kind}: 1Undoで移動前へ戻る`);
    pointer('pointerdown',40,40);pointer('pointermove',45,45);pointer('pointermove',40,40);pointer('pointerup',40,40);await settle();
    check(workspace!.scene===baseline&&!workspace!.canUndo&&workspace!.canRedo,`${kind}: 往復移動は履歴を増やさずRedoを保持`);
    for(const tool of ['選択',kind==='vector'?'ベジェペン':'ペン']){
      await select(tool);
      for(const ending of ['pointercancel','lostpointercapture','blur','hover','Escape']){
        const drawing=tool!=='選択',x=drawing?65:40,y=drawing?20:40;
        pointer('pointerdown',x,y);pointer('pointermove',x+4,y+4);await settle();
        if(ending==='blur')window.dispatchEvent(new Event('blur'));
        else if(ending==='Escape')window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        else if(ending==='hover'){
          const input=document.querySelector<HTMLElement>('.paint-input')!;
          input.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,buttons:0,bubbles:true,cancelable:true}));
        }else pointer(ending,x+4,y+4);
        await settle();
        check(workspace!.scene===baseline&&!workspace!.canUndo&&workspace!.canRedo&&!workspace!.live,`${kind}/${tool}: ${ending}は未確定操作だけ取消しRedoを保持`);
      }
    }
    workspace!.redo();await settle();check(workspace!.scene===moved&&workspace!.canUndo&&!workspace!.canRedo,`${kind}: 取消を挟んでもRedoで確定移動を復元`);
  }
  await select('選択');
}
async function selectionInteraction(){
  const scene=makeScene(0);await mount(scene);const before=workspace!.scene;
  for(const selector of ['.paint-input','.paint-frame'])check(parseFloat(getComputedStyle(document.querySelector(selector)!).borderTopWidth)===0,`${selector}に作業枠を表示しない`);
  document.querySelector<HTMLButtonElement>('[aria-label="投げ縄"]')!.click();await raf();await raf();
  pointer('pointerdown',5,5);pointer('pointermove',95,5);pointer('pointermove',95,95);pointer('pointerup',5,95);await raf();await raf();
  const selection=workspace!.selection!.boxes;
  check(selection.some(b=>b.x<0&&b.y<0&&b.x+b.w>600&&b.y+b.h>600),'投げ縄確定後も四方向の元画像外を保持');
  check(workspace!.scene===before&&!workspace!.canUndo,'選択のみで作品参照・Undoは不変');
  check(Boolean(document.querySelector('.raster-selection-overlay path')),'利用者が指定した選択輪郭は表示');
  document.querySelector<HTMLButtonElement>('[aria-label="トーンレイヤー作成"]')!.click();await raf();await raf();
  const grown=workspace!.owner,after=samples();
  const pixel=frame.w/600;
  check(grown.paint.layers.length===2&&grown.frame.x<=5+pixel&&grown.frame.y<=5+pixel&&grown.frame.x+grown.frame.w>=95-pixel,'pixel中心で選択したトーンと描画領域の確保を一度に反映');
  const c=document.querySelector<HTMLCanvasElement>('.paint-preview-canvas')!,ctx=c.getContext('2d')!;
  check(ctx.getImageData(1,1,Math.max(1,Math.floor(c.width*.04)),Math.max(1,Math.floor(c.height*.04))).data.some((v,i)=>i%4===3&&v>0),'元画像より左上の選択内にもトーンを実画素で保持');
  document.getElementById('undo')!.click();await raf();await raf();check(workspace!.owner.paint.layers.length===1&&workspace!.owner.frame===before.owners[0].frame,'一度のUndoでトーンと領域拡張を同時に戻す');
  document.getElementById('redo')!.click();await raf();await raf();const restored=samples();
  check(after.length===restored.length&&after.every((v,i)=>v===restored[i]),'トーンと領域拡張のRedoで全画素を復元');
}
async function selectionCapacityInteraction(){
  const controller:{current:PaintController|null}={current:null};await mount(makeScene(0),{controller});
  const before=workspace!.scene,owner=workspace!.owner,layerId=controller.current!.snapshot().layerId,ink=samples();
  const choose=async(label:string)=>{document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();await raf();await raf();};
  const pixelPointer=(type:string,x:number,y:number)=>pointer(type,owner.frame.x+x*owner.frame.w/owner.paint.width,owner.frame.y+y*owner.frame.h/owner.paint.height);
  const rectangle=async(w:number,h:number)=>{await choose('投げ縄');pixelPointer('pointerdown',0,0);pixelPointer('pointermove',w,0);pixelPointer('pointermove',w,h);pixelPointer('pointerup',0,h);await raf();await raf();};
  const unchanged=()=>workspace!.scene===before&&controller.current!.snapshot().layerId===layerId&&!workspace!.canUndo&&!workspace!.canRedo;
  const error=()=>document.querySelector('.paint-error')?.textContent??'';
  await rectangle(100,100);const previous=workspace!.selection?.boxes;
  await rectangle(4,16385);
  check(workspace!.selection?.boxes===previous&&unchanged()&&error().includes('選択範囲が大きすぎ'),'縦16384行を超える投げ縄は前の選択・原稿・Undoを保持して拒否');
  pixelPointer('pointerdown',0,0);
  for(let i=0;i<1100;i++)pixelPointer('pointermove',i%2?20:40,i%2?0:16384);
  pixelPointer('pointerup',0,0);await raf();await raf();
  check(workspace!.selection?.boxes===previous&&unchanged()&&error().includes('選択範囲が大きすぎ'),'輪郭点数×走査行数の上限でも前の選択を保持');
  for(const [w,h,label] of [[20000,8,'横幅'],[10001,10000,'合計画素数']] as const){
    await rectangle(w,h);const selected=workspace!.selection?.boxes;
    check(selected?.length===1&&selected[0].w===w&&selected[0].h===h&&unchanged(),`${label}が画像上限を超えても疎な選択は切り詰めず保持`);
    await choose('トーンレイヤー作成');
    check(workspace!.selection?.boxes===selected&&unchanged()&&error().includes('各辺16384px・合計1億px'),`${label}超過のトーン作成は選択・原稿・層・Undoを保持して拒否`);
    check(document.querySelector('[aria-label="投げ縄"]')?.getAttribute('aria-pressed')==='true','失敗したトーン作成で道具を切り替えない');
  }
  await rectangle(20000,8);const selected=workspace!.selection?.boxes;
  await choose('ペン');pixelPointer('pointerdown',19990,4);pixelPointer('pointermove',19992,4);pixelPointer('pointerup',19992,4);await raf();await raf();
  check(workspace!.selection?.boxes===selected&&unchanged()&&!workspace!.live&&error().includes('各辺16384px・合計1億px'),'実インクが容量外にある一筆は同じ制限で拒否し入力状態を解除');
  const rejected=samples();check(ink.length===rejected.length&&ink.every((v,i)=>v===rejected[i]),'拒否後の全画素が操作前と一致');
  await rectangle(100,100);await choose('トーンレイヤー作成');
  check(workspace!.owner.paint.layers.length===2&&!workspace!.selection&&workspace!.canUndo&&!error(),'選択を小さくして再試行すると一度だけ成功し過去の容量エラーも消える');
  document.getElementById('undo')!.click();await raf();await raf();
  check(workspace!.scene===before&&!workspace!.canUndo&&workspace!.canRedo,'失敗した操作を含めず一度のUndoで再試行前へ戻る');
  document.getElementById('redo')!.click();await raf();await raf();
  check(workspace!.owner.paint.layers.length===2,'再試行のトーンをRedoで復元');
  await mount(makeScene(0));await rectangle(20000,8);const wideSelection=workspace!.selection?.boxes,smallOwner=workspace!.owner;
  await choose('ペン');pixelPointer('pointerdown',20,4);pixelPointer('pointermove',30,4);pixelPointer('pointerup',30,4);await raf();await raf();
  check(workspace!.selection?.boxes===wideSelection&&workspace!.owner.frame===smallOwner.frame&&workspace!.owner.paint.layers[0].strokes.length===1&&!error(),'巨大な選択の近くに小さい一筆を描いても選択全体の画像確保は不要');
  check(samples().some((v,i)=>i%4===3&&v>0),'巨大な選択内の小さい筆跡を実画素で確認');
}
async function draftSelectionCapacityInteraction(){
  const scene=makeScene(0),owner=scene.owners[0],lower=owner.paint.layers[0];
  lower.clip={x:0,y:0,w:600,h:600};owner.paint.layers.push({...newPaintLayer('固定された上段'),locked:true});
  const controller:{current:PaintController|null}={current:null};await mount(scene,{controller});const before=workspace!.scene;
  const choose=async(label:string)=>{document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();await raf();await raf();};
  const send=(type:string,x:number,y:number)=>pointer(type,owner.frame.x+x*owner.frame.w/owner.paint.width,owner.frame.y+y*owner.frame.h/owner.paint.height);
  await choose('投げ縄');send('pointerdown',0,0);send('pointermove',20000,0);send('pointermove',20000,8);send('pointerup',0,8);await raf();await raf();
  const selection=workspace!.selection?.boxes;check(Boolean(selection)&&controller.current!.snapshot().layerId===lower.id,'新規筆跡の前に下段レイヤーと選択を保持');
  await choose('ペン');send('pointerdown',19990,4);
  for(let i=0;i<12;i++)await raf();
  check(workspace!.selection?.boxes===selection&&controller.current!.snapshot().layerId===lower.id,'未確定の新レイヤーIDで固定上段へ選択が飛ばない');
  send('pointerup',19992,4);await raf();await raf();
  check(workspace!.scene===before&&workspace!.selection?.boxes===selection&&controller.current!.snapshot().layerId===lower.id&&!workspace!.canUndo&&!workspace!.live,'新レイヤーの容量失敗でも選択・原稿・Undoをすべて保持');
  send('pointerdown',20,4);send('pointerup',30,4);await raf();await raf();
  check(workspace!.owner.paint.layers.length===3&&controller.current!.snapshot().layerId===workspace!.owner.paint.layers[2].id&&workspace!.owner.paint.layers[2].strokes.length===1,'成功した一筆の確定時だけ追加した作業レイヤーを選択');
  document.getElementById('undo')!.click();await raf();await raf();
  check(workspace!.scene===before&&!workspace!.canUndo,'一回のUndoで初回筆跡と追加レイヤーを同時に戻す');
}
async function guideSessionInteraction(){
  const panel:Panel={id:1,shape:{type:'rect',x:0,y:0,w:100,h:100},bg:0,action:'',bubbles:[],figures:[
    {name:'確認用A',kind:'person',size:'full',bbox:{x:10,y:20,w:30,h:50}},
    {name:'確認用B',kind:'person',size:'full',bbox:{x:55,y:20,w:30,h:50}},
  ]};
  const scene=paintScene(panel,100,[]),source=JSON.stringify(scene),controller:{current:PaintController|null}={current:null};
  const timeline=workspaceHistory<PaintSessionSnapshot>(),applied:PaintResult[]=[];
  let attempts=0,closes=0,fail=false,restoring=Promise.resolve();
  const restore=(state:PaintSessionSnapshot|undefined)=>{if(state)restoring=mount({...state.scene},{...options,resume:state});};
  const sharedHistory:SharedPaintHistory={checkpoint:before=>timeline.record(before),undo:()=>restore(timeline.undo(controller.current!.snapshot())),redo:()=>restore(timeline.redo(controller.current!.snapshot())),get canUndo(){return timeline.past.length>0;},get canRedo(){return timeline.future.length>0;}};
  const options:MountOptions={controller,initialOwner:'figure-0',sharedHistory,onApply:async result=>{attempts++;if(fail)throw Error('fixture save failure');applied.push(result);},onClose:()=>{closes++;}};
  const ink=()=>controller.current!.snapshot().scene.owners.find(owner=>owner.key==='figure-0')!.paint.layers.reduce((n,layer)=>n+layer.strokes.length,0);
  await mount(scene,options);
  const prepared=controller.current!.snapshot();
  check(prepared.imports.length===3&&prepared.scene.owners.every(owner=>owner.paint.layers.some(layer=>layer.guide&&layer.image)),'2人物と背景のguideを実PNGとして準備');
  check(JSON.stringify(scene)===source&&!workspace!.canUndo,'表示準備で元sceneと共有Undoを変更しない');
  await controller.current!.close();
  check(attempts===0&&closes===1,'無描画closeはowner PNGの反映・asset登録0回');
  pointer('pointerdown',20,30);await raf();pointer('pointercancel',20,30);await raf();await raf();
  await controller.current!.close();
  check(attempts===0&&ink()===0&&!workspace!.canUndo,'描画cancel後のcloseも反映・Undo追加なし');
  pointer('pointerdown',20,30);pointer('pointermove',25,35);pointer('pointerup',25,35);await raf();await raf();
  const drawn=controller.current!.snapshot();
  check(ink()===1&&timeline.past.length===1,'初回一筆は実線1本・共有Undo1件だけ');
  document.getElementById('undo')!.click();await restoring;
  await controller.current!.close();
  check(ink()===0&&attempts===0&&timeline.future.length===1,'共有Undoのscene外側複製後もcloseは無保存');
  document.getElementById('redo')!.click();await restoring;
  check(ink()===1&&controller.current!.snapshot().imports.length===3,'共有Redoは一筆と未保存guide Blobを保持');
  fail=true;let rejected=false;
  try{await controller.current!.flush();}catch{rejected=true;}
  check(rejected&&applied.length===0&&ink()===1&&controller.current!.snapshot().saved===drawn.saved,'保存失敗は内容と未保存状態を保持');
  fail=false;await controller.current!.flush();
  check(attempts===2&&applied.length===1&&applied[0].owners.length===1&&applied[0].owners[0].owner.key==='figure-0'&&applied[0].owners[0].blob.size>0,'再試行は描いた人物1個だけを実PNGで反映');
  await controller.current!.close();check(attempts===2,'保存済みcloseは二重反映しない');

  // Exercise the existing image validator and project serializer without writing browser storage.
  const project=panelTestDocument(),target=structuredClone(panel),blobs=new Map<string,Blob>();
  project.manga.pages[0].panels=[target];project.manga.image_assets=[];
  const result=applied[0],needed=new Set(result.owners.flatMap(({owner})=>paintAssetIds(owner.paint)));
  for(const {asset,blob} of result.imports)if(needed.has(asset.id)&&!project.manga.image_assets.some(item=>item.id===asset.id)){project.manga.image_assets.push(asset);blobs.set(asset.storageId,blob);}
  for(const {owner,blob} of result.owners){const asset=await prepareImageAsset(new File([blob],'guide-session.png',{type:'image/png'}));project.manga.image_assets.push(asset);blobs.set(asset.storageId,blob);applyOwnerPaint(target,owner,{...createFrameArtwork(asset,owner.frame),paint:owner.paint});}
  const saved=await createProjectSnapshot(project,async id=>blobs.get(id)??null);
  let stored=0;const restored=await restoreProjectSnapshot(saved,async items=>{stored=items.length;});
  const restoredPanel=restored.manga.pages[0].panels[0];
  check(restoredPanel.figures![0].artwork!.paint!.layers.reduce((n,layer)=>n+layer.strokes.length,0)===1&&!restoredPanel.figures![1].artwork&&!restoredPanel.background_images?.length,'実PNGを検証した保存往復でも未描画人物・背景を画像化しない');
  check(saved.assets.length===2&&stored===2,'保存往復は描いた人物のguideと合成PNGだけを保持');

  await mount({...drawn.scene},{...options,resume:drawn});await controller.current!.flush();
  check(ink()===1&&applied.length===2&&applied[1].owners.map(({owner})=>owner.key).join()==='figure-0','未保存resumeの一筆を準備済み扱いで落とさない');
  const broken=paintScene(panel,100,[]),background=broken.owners.find(owner=>owner.key==='background')!;
  background.paint.layers[0].image={assetId:'missing-guide',crop:{x:0,y:0,w:1,h:1},bbox:{x:0,y:0,w:1,h:1}};
  await mount(broken,options);await controller.current!.flush();
  check(applied.length===3&&applied[2].owners.map(({owner})=>owner.key).join()==='background','既存guide画像の欠損修復は無操作と混同せず背景だけ反映');
  const owner=controller.current!.snapshot().scene.owners.find(item=>item.key==='figure-0')!,guide=owner.paint.layers[0];
  controller.current!.layerAction({type:'update',key:owner.key,id:guide.id,patch:{visible:false}});await raf();await raf();await controller.current!.flush();
  check(applied.length===4&&applied[3].owners.map(({owner})=>owner.key).join()==='figure-0','筆跡0でもguideの目の変更は正当な編集として保存');
}
async function placedImageInteraction(){
  const host=document.getElementById('app')!,seed=document.createElement('canvas');seed.width=seed.height=32;
  const assets:PaintResult['imports']=[];
  for(const color of ['#e02030','#2050e0']){
    seed.getContext('2d')!.fillStyle=color;seed.getContext('2d')!.fillRect(0,0,32,32);
    const blob=await new Promise<Blob>(resolve=>seed.toBlob(blob=>resolve(blob!),'image/png'));
    assets.push({asset:await prepareImageAsset(new File([blob],'source-lifetime-test.png',{type:'image/png'})),blob});
  }
  await saveFigureCropAssets(assets.map(({asset,blob})=>({id:asset.storageId,blob})));
  let project=panelTestDocument();project.manga.image_assets=assets.map(item=>item.asset);
  project.manga.pages[0].images=Array.from({length:21},(_,i)=>({...createFrameArtwork(assets[0].asset,{x:0,y:0,w:32,h:32}),bubbleOriginal:{sourceRegionId:`fixture-${i}`,name:`検証原画${i+1}`},
    paint:{version:1,width:32,height:32,dpi:100,layers:[{...newPaintLayer(),image:{assetId:assets[0].asset.id,crop:{x:0,y:0,w:32,h:32},bbox:{x:0,y:0,w:32,h:32}}}]}}));
  const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')!,decoded=new Set<HTMLImageElement>();let decodes=0;
  Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(this:HTMLImageElement,value:string){if(value.startsWith('blob:')){decodes++;decoded.add(this);}descriptor.set!.call(this,value);}});
  const draw=()=>render(<div><button id="change-font" onClick={()=>{project=editCanvasTextStyle(project,{pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false},{fontSize:40});draw();}}>文字を40ptに変更</button><div id="source-views" style={{display:'flex',flexWrap:'wrap',width:'500px'}}>{project.manga.pages[0].images!.map(image=><div key={image.id} style={{position:'relative',width:'64px',height:'64px'}}><PlacedImageView image={image} asset={project.manga.image_assets!.find(item=>item.id===image.assetId)} assets={project.manga.image_assets}/></div>)}</div></div>,host);
  const canvases=()=>[...host.querySelectorAll<HTMLCanvasElement>('#source-views canvas')];
  const waitFor=async(ok:()=>boolean,label:string)=>{for(let i=0;i<120&&!ok();i++)await raf();if(!ok())throw Error(label);for(let i=0;i<4;i++)await raf();};
  const pixels=()=>canvases()[0].getContext('2d')!.getImageData(0,0,canvases()[0].width,canvases()[0].height).data;
  const samePixels=(expected:Uint8ClampedArray)=>{const actual=pixels();return expected.length===actual.length&&expected.every((value,i)=>value===actual[i]);};
  try{
    draw();await waitFor(()=>canvases().length===21,'原画21枚の初期表示');
    const original=canvases(),before=pixels(),beforeDecodes=decodes,originalProject=project;let removed=0;
    const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.removedNodes)if(node instanceof Element)removed+=Number(node.matches('canvas'))+node.querySelectorAll('canvas').length;});
    observer.observe(host,{childList:true,subtree:true});
    document.getElementById('change-font')!.click();await raf();await raf();await raf();await raf();observer.disconnect();
    check(project!==originalProject&&project.manga.pages[0].panels[0].bubbles[0].text_style?.fontSize===40,'実文字mutatorで40ptへ変更し作品cloneを発生');
    check(removed===0&&canvases().every((canvas,i)=>canvas===original[i])&&decodes===beforeDecodes,'文字変更で原画21枚のcanvas置換・画像decodeが0回');
    check(samePixels(before),'文字変更で非対象原画の全画素が一致');
    project=structuredClone(project);const first=project.manga.pages[0].images![0];
    first.paint!.layers[0].strokes.push({tool:'line',color:'#000000',size:4,points:[point(8,16),point(24,16)]});draw();await raf();await raf();
    const c=canvases()[0],center=c.getContext('2d')!.getImageData(c.width/2,c.height/2,1,1).data;
    check(canvases()[0]===original[0]&&decodes===beforeDecodes&&center[0]<10&&center[1]<10&&center[2]<10,'paint内容の実更新は同じ原本とcanvasへ再合成');
    project=originalProject;draw();await raf();await raf();
    check(samePixels(before)&&decodes===beforeDecodes,'元のsnapshotへ戻しても再decodeなしで画素を復元');
    project=structuredClone(project);const changed=project.manga.pages[0].images![0];changed.assetId=assets[1].asset.id;changed.paint!.layers[0].image!.assetId=assets[1].asset.id;draw();
    await waitFor(()=>canvases().length===21&&pixels()[2]>200,'差替え原画の表示');
    check(decodes===beforeDecodes+1&&pixels()[0]<50&&pixels()[2]>200,'原本差替えは該当する1枚だけ再decode');
    project=structuredClone(project);project.manga.image_assets![1].storageId=`fixture-missing-${crypto.randomUUID()}`;draw();
    await waitFor(()=>Boolean(host.querySelector('.placed-image-missing')),'原本欠損の表示');
    check(canvases().length===20&&host.querySelectorAll('img').length===0,'欠損原画を古い合成画像へ差し戻さず診断を表示');
    render(null,host);await raf();await raf();
    check([...decoded].every(image=>image.getAttribute('src')===''),'unmountで自分のdecode済み原本を解放');
  }finally{
    render(null,host);Object.defineProperty(HTMLImageElement.prototype,'src',descriptor);
    await deleteFigureCropAssets(assets.map(item=>item.asset.storageId));
  }
}
run.onclick=()=>{
  run.disabled=true;checks.length=0;
  void(async()=>{
    if(new URLSearchParams(location.search).has('history-check')){
      await historyInteraction();report.textContent=`PASS ${checks.length}項目\n${checks.join('\n')}`;return;
    }
    report.textContent='旧組み立て方式を同条件で測定中…';const baked=await rendererBenchmark(true);
    report.textContent='キャッシュを使う方式を測定中…';const cached=await rendererBenchmark(false);
    check(baked.historical_point_reads>=500*120&&cached.historical_point_reads===0,'旧組み立て方式の過去線再描画を除去');
    report.textContent='実PaintEditorのポインター入力・確定・取り消し・枠外描画を検証中…';const ui=await interaction();
    report.textContent='取消・往復移動・Redo保持を検証中…';await historyInteraction();
    report.textContent='同じレイヤーへのマスク描画・確定・消去・取消を検証中…';await maskInteraction();
    report.textContent='元画像サイズに切られない投げ縄とトーン・Undo/Redoを検証中…';await selectionInteraction();
    report.textContent='投げ縄の処理量・画像容量の境界と失敗後の再試行を検証中…';await selectionCapacityInteraction();await draftSelectionCapacityInteraction();
    report.textContent='guide準備・共有Undo/Redo・保存失敗と実PNG保存往復を検証中…';await guideSessionInteraction();
    report.textContent='文字変更時の原画21枚の保持・差替え・欠損を検証中…';await placedImageInteraction();
    report.textContent=`PASS ${checks.length}項目\n500本・600×600px・120回、同じcanvas rendererで比較\n旧組み立て方式の再現: ${JSON.stringify(baked)}\n修正後: ${JSON.stringify(cached)}\n実PaintEditor: ${JSON.stringify(ui)}\n${checks.join('\n')}\n注: この合成原稿・端末での測定。マスク/トーン・実原稿全体の速度保証ではありません。`;
  })().catch(error=>{report.textContent=`FAIL ${String(error)}\n${checks.join('\n')}`;}).finally(()=>{run.disabled=false;});
};
