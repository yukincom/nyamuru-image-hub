import {render} from 'preact';
import {useEffect,useRef,useState} from 'preact/hooks';
import {Vector3} from 'three';
import Background3dEditor,{type Background3dController,type Background3dResult} from '../src/components/Background3dEditor';
import {defaultBackgroundCapture,prepareBackgroundStage} from '../src/lib/background3d';
import {fitStageCamera,loadStageShape,type StageShape} from '../src/lib/background3dRenderer';
import type {BackgroundCapture,BackgroundStage,PaintDocument} from '../src/types';
import '../src/styles/global.css';

if(location.port!=='4325')throw Error('Dedicated test origin required');
function App(){
 const [host,setHost]=useState<HTMLDivElement|null>(null),[item,setItem]=useState<{stage:BackgroundStage;blob:Blob}|null>(null),[shape,setShape]=useState<StageShape|null>(null),[paint,setPaint]=useState<PaintDocument|null>(null),[revision,setRevision]=useState(0),[result,setResult]=useState('部屋を読み込み中…'),[captured,setCaptured]=useState<Background3dResult|null>(null),[reopen,setReopen]=useState(true);
 const controller=useRef<Background3dController|null>(null);
 useEffect(()=>{void(async()=>{
  const response=await fetch('/qa-office.glb');if(!response.ok)throw Error('Local QA model unavailable');
  const next=await prepareBackgroundStage(new File([await response.blob()],'書斎.glb')),loaded=await loadStageShape(next.stage,next.blob);
  setItem(next);setShape(loaded);setPaint({version:1,width:900,height:675,dpi:150,layers:[],referenceFrame:{x:0,y:0,w:900,h:675},background3d:{...defaultBackgroundCapture({x:0,y:0,w:900,h:675},150),sourceId:next.stage.id,camera:fitStageCamera(loaded)}});setResult('作品データへは書き込みません。');
 })().catch(error=>setResult(`FAIL ${String(error)}`));},[]);
 const view=(direction:[number,number,number])=>{
  if(!shape||!paint||!controller.current)return;
  const snapshot=controller.current.snapshot(),radius=shape.bounds.getSize(new Vector3()).length()/2;
  const camera:BackgroundCapture['camera']={...snapshot.config.camera,target:[0,1.1,0],position:new Vector3(...direction).normalize().multiplyScalar(radius*2.8).add(new Vector3(0,1.1,0)).toArray()};
  setPaint({...paint,background3d:{...snapshot.config,camera}});setRevision(n=>n+1);setResult('カメラを移動しました。');
 };
 const close=()=>{if(controller.current&&paint)setPaint({...paint,background3d:controller.current.snapshot().config});setReopen(false);setResult('閉じました。構図と非表示設定はこの検証内で保持しています。');};
 return <main style={{padding:16,fontFamily:'sans-serif',background:'#f3f4f6',minHeight:'100vh'}}>
  <h1 style={{fontSize:22,marginBottom:8}}>室内の3D撮影</h1><p>検証専用。元のGLB・作品フォルダには書き込みません。</p>
  <div style={{display:'flex',gap:8,margin:'12px 0',flexWrap:'wrap'}}>{[['南から',[0,1,8]],['北から',[0,1,-8]],['東から',[8,1,0]],['西から',[-8,1,0]],['斜めから',[5,3,6]]].map(([label,direction])=><button disabled={!paint||!reopen} onClick={()=>view(direction as [number,number,number])}>{label}</button>)}{!reopen&&<button onClick={()=>{setReopen(true);setRevision(n=>n+1);}}>同じ構図を開き直す</button>}</div>
  <p role="status">{result}</p>
  <div style={{display:'flex',alignItems:'flex-start',gap:16,flexWrap:'wrap',marginTop:12}}>
   <div ref={setHost} style={{width:900,maxWidth:'100%',aspectRatio:'4 / 3',background:'white',border:'1px solid #cbd5e1',position:'relative'}}/>
   {item&&paint&&host&&reopen&&<div style={{width:300,position:'relative'}}><Background3dEditor key={revision} host={host} paint={paint} stages={[item.stage]} pendingStages={[item]} controller={controller} onCapture={async result=>{setCaptured(result);setPaint({...paint,background3d:result.config});setRevision(n=>n+1);setResult(`撮影成功：${result.layers.length}レイヤー / 線画${result.layers.find(layer=>layer.kind==='vector')!.paths!.length.toLocaleString()}本 / 自動非表示${result.config.cutaway?.enabled?'ON':'OFF'} / 奥行き${Math.round((result.config.cutaway?.depth??.25)*100)}%`);}} onCancel={close}/></div>}
  </div>
  {captured&&<pre aria-label="撮影した設定">{JSON.stringify({cutaway:captured.config.cutaway,camera:captured.config.camera,layers:captured.layers.map(layer=>({name:layer.name,kind:layer.kind,paths:layer.paths?.length}))},null,2)}</pre>}
  <style>{`.background3d-controls {position:relative!important;inset:auto!important;max-height:none!important;width:300px!important;}.background3d-canvas {width:100%;height:100%;}main>div>button{background:white;border:1px solid #94a3b8;border-radius:6px;padding:7px 12px;}pre{font-size:12px;}`}</style>
 </main>;
}
render(<App/>,document.querySelector('#root')!);
