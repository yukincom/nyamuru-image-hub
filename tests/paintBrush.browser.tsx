// 見込み: ブラシは道具設定、一筆だけが作品編集。合成入力で実PaintEditor・描画・Undo・保存を通す。実ペンタブ、実作品への書込は対象外。
import {render} from 'preact';
import PaintEditor,{type PaintResult} from '../src/components/PaintEditor';
import PaintInputSurface,{PaintOwnerPreview} from '../src/components/PaintSceneView';
import {usePaintWorkspace,type PaintWorkspaceState} from '../src/lib/paintWorkspace';
import {newPaintLayer,validatePaintDocument,type PaintScene} from '../src/lib/paintDocument';
import {drawPaintStroke,readPaintPixels,renderPaintPng} from '../src/lib/paintRenderer';
import type {PaintController} from '../src/lib/paintSession';
import type {PaintStroke} from '../src/types';
import '../src/styles/global.css';

if(location.hostname!=='127.0.0.1'||location.port!=='4335')throw Error('Dedicated test origin required');
const report=document.getElementById('report')!,checks:string[]=[];
const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
let workspace:PaintWorkspaceState|null=null,ready=false,writes:PaintResult[]=[];
const controller:{current:PaintController|null}={current:null};
const w=()=>workspace!,scene=()=>controller.current!.snapshot().scene,layer=()=>scene().owners[0].paint.layers[0];
const record=()=>JSON.stringify(scene());
const pixels=()=>readPaintPixels(scene().owners[0].paint,layer(),new Map()).data;
const same=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const button=(label:string)=>document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const click=async(label:string)=>{const b=button(label);if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')throw Error(`Button unavailable: ${label}`);b.click();await tick();};
const choose=async(label:string)=>{await click('ラスターペンのブラシ一覧');document.querySelector<HTMLButtonElement>(`[role="menuitemradio"][aria-label="${label}"]`)!.click();await tick();};
const pointer=(type:string,x:number,y:number,options:PointerEventInit={})=>{
  const input=document.querySelector<HTMLElement>('.paint-input')!,box=input.getBoundingClientRect();
  input.dispatchEvent(new PointerEvent(type,{pointerId:31,pointerType:'pen',isPrimary:true,button:0,buttons:type==='pointerup'||type==='pointercancel'?0:1,pressure:type==='pointerup'?0:1,clientX:box.left+x/100*box.width,clientY:box.top+y/80*box.height,bubbles:true,cancelable:true,...options}));
};
async function draw(from:{x:number;y:number},to=from,end='pointerup'){
  pointer('pointerdown',from.x,from.y);await tick();
  pointer('pointermove',to.x,to.y);await tick();
  pointer(end,to.x,to.y);await tick();
}
function Probe(){
  workspace=usePaintWorkspace();
  return <><aside class="paint-dock" style={{width:'124px'}}>{w()?.tools}</aside><section style={{position:'relative',width:'600px',height:'480px',background:'white',flexShrink:0}}>
    {w()?.scene.owners.map(owner=><PaintOwnerPreview ownerKey={owner.key} container={{x:0,y:0,w:100,h:80}}/>)}
    <PaintInputSurface canvas={{w:100,h:80}}/>
  </section><aside style={{width:'220px'}}>{w()?.layers}{w()?.status}</aside></>;
}
const initial:PaintScene={frame:{x:0,y:0,w:100,h:80},colorMode:'color',owners:[{key:'page-direct',kind:'page',index:0,label:'ブラシの試験',frame:{x:0,y:0,w:100,h:80},paint:{version:1,width:600,height:480,dpi:152.4,guideInitialized:true,layers:[newPaintLayer('インク')]}}]};

async function verify(){
  render(<PaintEditor controller={controller} initial={initial} assets={[]} page={1} panelIndex={0} overlay title="ブラシ" onApply={async result=>{writes.push(result);}} onClose={()=>{}} onReady={()=>{ready=true;}}>
    <div style={{display:'flex',gap:'18px',alignItems:'flex-start',marginTop:'12px'}}><Probe/></div>
  </PaintEditor>,document.getElementById('app')!);
  for(let i=0;i<120&&!ready;i++)await tick();if(!ready)throw Error('PaintEditor not ready');await tick();

  // 見込み/合格: 選択・開閉は作品/Undo/writerを変えず、通常ペンとサイズを混ぜない。範囲: 実UIと保存callback。
  const before=record();await choose('ラフ・ハッチング');
  check(button('ラフ・ハッチング')?.getAttribute('aria-pressed')==='true','ラスターペンの一覧からラフ・ハッチングを選択');
  check(document.querySelector('.paint-size output')?.textContent==='100 px','ハッチングの初期サイズは100px');
  await click('太さ 80 px');await choose('ペン');
  check(document.querySelector('.paint-size output')?.textContent==='8 px','丸ペンの8pxを保持');
  await choose('ラフ・ハッチング');check(document.querySelector('.paint-size output')?.textContent==='80 px','ハッチングの80pxを保持');
  await controller.current!.flush();check(record()===before&&!w().canUndo&&writes.length===0,'ブラシ選択とサイズ変更では作品・Undo・保存を追加しない');
  await click('ラスターペンのブラシ一覧');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick();
  check(!document.querySelector('[aria-label="ラスターペンのブラシ"]'),'Escapeでブラシ一覧を閉じる');

  // 見込み/合格: クリックは細い線束1個、ドラッグは1筆・1Undoで距離に沿う線束。取消し/Undo/Redo後の画素は一致。範囲: 合成ペン入力、Canvas本体。
  await draw({x:15,y:18});check(layer().strokes.length===1&&layer().strokes[0].brush?.kind==='rough-hatching','クリックでブラシ指定付きstrokeを1件追加');
  const firstPixels=pixels(),firstRecord=record();
  const inkCount=Array.from(firstPixels).filter((v,i)=>i%4===3&&v>0).length;
  check(inkCount>100&&inkCount<2800,'クリックはベタ円ではなく空隙のある細い線束');
  await draw({x:20,y:35},{x:78,y:35});check(layer().strokes.length===2&&scene().owners[0].paint.layers.length===1,'ドラッグ全体を同じレイヤーの一筆へまとめる');
  const twoPixels=pixels(),twoRecord=record();
  w().undo();await tick();check(record()===firstRecord&&same(pixels(),firstPixels),'一回のUndoでドラッグだけ消え、最初の模様と画素を保持');
  w().redo();await tick();check(record()===twoRecord&&same(pixels(),twoPixels),'Redoで同じ模様と画素に復元');
  await draw({x:20,y:50},{x:70,y:50},'pointercancel');check(record()===twoRecord&&same(pixels(),twoPixels),'取消しでは模様・作品を残さない');

  // 見込み/合格: シリアライズ後の描画とPNGが同じ画素、保存は1回。範囲: 実renderer/保存callback、OSファイル保存は対象外。
  const paint=scene().owners[0].paint,restored=JSON.parse(JSON.stringify(paint));validatePaintDocument(restored,[]);
  check(same(readPaintPixels(restored,restored.layers[0],new Map()).data,twoPixels),'保存形式の往復後も同じ模様と画素');
  const png=await renderPaintPng(restored,new Map()),bitmap=await createImageBitmap(png),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();
  check(same(ctx.getImageData(0,0,canvas.width,canvas.height).data,twoPixels),'PNG出力は再読込した描画と画素一致');
  await controller.current!.flush();await tick();check(writes.length===1&&writes[0].owners[0].blob.size>0,'既存保存経路でブラシ描画を一回出力');

  // 見込み/合格: 選択範囲の外に出さず、消しゴムが通常通り効く。範囲: 本体rendererへ固定strokeを渡して画素比較。
  const testCanvas=document.createElement('canvas');testCanvas.width=300;testCanvas.height=200;const tc=testCanvas.getContext('2d')!;
  const mark:PaintStroke={tool:'pen',color:'#000000',size:100,brush:{kind:'rough-hatching',seed:45},points:[{x:150,y:100,pressure:1,time:0}],selection:[{x:130,y:70,w:40,h:60}]};
  drawPaintStroke(tc,mark);const clipped=tc.getImageData(0,0,300,200).data;
  check(clipped.some((v,i)=>i%4===3&&v>0)&&clipped.every((v,i)=>i%4!==3||v===0||i/4%300>=130&&i/4%300<170&&Math.floor(i/4/300)>=70&&Math.floor(i/4/300)<130),'選択範囲の外は透明のまま');
  drawPaintStroke(tc,{tool:'eraser',color:'#000000',size:150,points:mark.points});
  check(tc.getImageData(0,0,300,200).data.every((v,i)=>i%4!==3||v===0),'通常の消しゴムで線束を消せる');

  // 見込み/合格: 長短を増やしても線の芯は2値でつながる。短い線の先端を除いた中央30行すべて11本、alphaは0/255のみ。範囲: 100px・筆圧1、全サイズの保証ではない。
  const monoLayer={...newPaintLayer('2値'),colorMode:'monochrome' as const,strokes:[{...mark,selection:undefined}]};
  const mono=readPaintPixels({version:1,width:300,height:200,dpi:100,layers:[monoLayer]},monoLayer,new Map());
  check(mono.data.every((v,i)=>i%4!==3||v===0||v===255),'2値描画の透明度は0/255のみ');
  let continuous=true;
  for(let y=85;y<115;y++){
    let runs=0,last=false;
    for(let x=80;x<220;x++){const ink=mono.data[(y*300+x)*4+3]>0;if(ink&&!last)runs++;last=ink;}
    if(runs!==11)continuous=false;
  }
  check(continuous,'長短のある2値100pxの中央30行で11本の黒い芯を途切れず保持');
  const enlarged=document.createElement('canvas');enlarged.id='binary-detail';enlarged.width=600;enlarged.height=500;const ec=enlarged.getContext('2d')!;
  const native=document.createElement('canvas');native.width=300;native.height=200;native.getContext('2d')!.putImageData(mono,0,0);
  ec.fillStyle='#fff';ec.fillRect(0,0,600,500);ec.imageSmoothingEnabled=false;ec.drawImage(native,120,75,60,50,0,0,600,500);
  document.getElementById('binary-detail')?.remove();document.getElementById('samples')!.after(enlarged);

  // 見込み/合格: 普通のペンに戻しても既存ハッチングを変更せず、新しいstrokeにブラシ指定を付けない。範囲: 実UI。
  await choose('ペン');await draw({x:20,y:62},{x:78,y:62});
  check(!layer().strokes.at(-1)!.brush&&layer().strokes[0].brush?.kind==='rough-hatching','丸ペンへ戻しても以前のハッチングは保持');
  await choose('ラフ・ハッチング');
}

function samples(){
  const ctx=(document.getElementById('samples') as HTMLCanvasElement).getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,680,440);
  ctx.fillStyle='#333';ctx.font='16px sans-serif';ctx.fillText('クリック：線の長さ・傾き・間隔に揺らぎ',18,28);
  const mark=(x:number,y:number,seed:number,pressure=1):PaintStroke=>({tool:'pen',color:'#000000',size:100,brush:{kind:'rough-hatching',seed},points:[{x,y,pressure,time:0}]});
  for(let i=0;i<6;i++)drawPaintStroke(ctx,mark(65+i*108,96,i*17+1));
  ctx.fillText('ドラッグ：移動距離に合わせて並ぶ',18,180);drawPaintStroke(ctx,{...mark(65,245,73),points:[{x:65,y:245,pressure:1,time:0},{x:610,y:245,pressure:1,time:1}]});
  ctx.fillText('筆圧：弱 → 強',18,325);for(let i=0;i<6;i++)drawPaintStroke(ctx,mark(65+i*108,384,200+i,i/5));
}
samples();
document.getElementById('run')!.addEventListener('click',async()=>{report.textContent='実行中';try{await verify();report.textContent=`PASS ${checks.length}\n${checks.join('\n')}`;}catch(error){report.textContent=`FAIL ${String(error)}\n${checks.join('\n')}`;throw error;}});
