import {render} from 'preact';
import PaintEditor from '../src/components/PaintEditor';
import PaintInputSurface,{PaintOwnerPreview} from '../src/components/PaintSceneView';
import {usePaintWorkspace,type PaintWorkspaceState} from '../src/lib/paintWorkspace';
import {newPaintLayer,type PaintScene} from '../src/lib/paintDocument';
import {commitPaintStroke,paintStrokeBounds,previewPaintStroke,type PaintStrokePreview} from '../src/lib/paintGesture';
import {paintPreviewRenderer} from '../src/lib/paintRenderer';
import {newToneLayer} from '../src/lib/paintTone';
import type {PaintStroke} from '../src/types';
import '../src/styles/global.css';

if(location.hostname!=='127.0.0.1'||location.port!=='4325')throw Error('Dedicated test origin required');
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
  return <div style={{marginTop:'8px'}}><button id="undo" onClick={()=>workspace?.undo()}>取り消し</button><button id="redo" onClick={()=>workspace?.redo()}>やり直し</button><output id="ink-state">{workspace?.owner.paint.layers[0].strokes.length}本{workspace?.live?'・描画中':''}</output></div>;
}
async function mount(scene:PaintScene){
  ready=false;workspace=null;
  render(<PaintEditor key={crypto.randomUUID()} initial={scene} assets={[]} page={1} panelIndex={0} overlay title="速度検証" onApply={async()=>{}} onClose={()=>{}} onReady={()=>{ready=true;}}>
    <div style={{position:'relative',width:'500px',height:'500px',marginTop:'12px',background:'white',border:'1px solid #889'}}>
      <PaintOwnerPreview ownerKey="page-direct" container={scene.frame}/><PaintInputSurface canvas={{w:100,h:100}}/>
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
run.onclick=()=>{
  run.disabled=true;checks.length=0;
  void(async()=>{
    report.textContent='旧組み立て方式を同条件で測定中…';const baked=await rendererBenchmark(true);
    report.textContent='キャッシュを使う方式を測定中…';const cached=await rendererBenchmark(false);
    check(baked.historical_point_reads>=500*120&&cached.historical_point_reads===0,'旧組み立て方式の過去線再描画を除去');
    report.textContent='実PaintEditorのポインター入力・確定・取り消し・枠外描画を検証中…';const ui=await interaction();
    report.textContent='同じレイヤーへのマスク描画・確定・消去・取消を検証中…';await maskInteraction();
    report.textContent=`PASS ${checks.length}項目\n500本・600×600px・120回、同じcanvas rendererで比較\n旧組み立て方式の再現: ${JSON.stringify(baked)}\n修正後: ${JSON.stringify(cached)}\n実PaintEditor: ${JSON.stringify(ui)}\n${checks.join('\n')}\n注: この合成原稿・端末での測定。マスク/トーン・実原稿全体の速度保証ではありません。`;
  })().catch(error=>{report.textContent=`FAIL ${String(error)}\n${checks.join('\n')}`;}).finally(()=>{run.disabled=false;});
};
