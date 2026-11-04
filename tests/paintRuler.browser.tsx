// 定規は入力だけを拘束する。実UIで線の幾何・筆圧・レイヤー保持・Undo・PNGと再読込を確認する。
// 操作入力と原稿は合成。実タブレットの筆圧感触と利用者の作品は対象外。
import {options,render,type ComponentProps} from 'preact';
import {useContext} from 'preact/hooks';
import PaintEditor,{type PaintResult} from '../src/components/PaintEditor';
import PaintInputSurface,{PaintOwnerPreview} from '../src/components/PaintSceneView';
import {PaintLayerControlsContext,usePaintWorkspace,type PaintWorkspaceState} from '../src/lib/paintWorkspace';
import {newPaintLayer,type PaintScene} from '../src/lib/paintDocument';
import type {PaintController} from '../src/lib/paintSession';
import type {PaintLayer} from '../src/types';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import '../src/styles/global.css';

if(location.hostname!=='127.0.0.1'||location.port!=='4335')throw Error('Dedicated test origin required');
const report=document.getElementById('report')!,runButton=document.getElementById('run') as HTMLButtonElement;
const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
const close=(a:number,b:number)=>Math.abs(a-b)<1e-7;
const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
let workspace:PaintWorkspaceState|null=null,ready=false;
let controller:{current:PaintController|null}={current:null};
let writes:PaintResult[]=[];
let closes=0;
const w=()=>workspace!;
const button=(label:string)=>document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const click=async(label:string)=>{const b=button(label);if(!b||b.disabled||b.getAttribute('aria-disabled')==='true')throw Error(`Button unavailable: ${label}`);b.click();await tick();};
const guide=()=>w().ruler!;
const ink=()=>controller.current!.snapshot().scene;
const layer=()=>ink().owners[0].paint.layers[0];
const record=()=>JSON.stringify(ink());
const surface=()=>document.querySelector<HTMLElement>('.paint-input')!;
const toPaper=(p:{x:number;y:number})=>{const owner=ink().owners[0];return {x:owner.frame.x+p.x*owner.frame.w/owner.paint.width,y:owner.frame.y+p.y*owner.frame.h/owner.paint.height};};
const toggle=()=>{
  const circle=document.querySelector<SVGCircleElement>('[data-ruler-toggle]')!,svg=circle.ownerSVGElement!,view=svg.viewBox.baseVal;
  return {x:circle.cx.baseVal.value/view.width*100,y:circle.cy.baseVal.value/view.height*100};
};
const px=(n:number)=>n/surface().getBoundingClientRect().width*100;
const pointer=(type:string,x:number,y:number,options:PointerEventInit={})=>{
  const input=surface(),box=input.getBoundingClientRect();
  input.dispatchEvent(new PointerEvent(type,{pointerId:31,pointerType:'pen',isPrimary:true,button:0,buttons:type==='pointerup'||type==='pointercancel'?0:1,pressure:type==='pointerup'?0:.7,clientX:box.left+x/100*box.width,clientY:box.top+y/100*box.height,bubbles:true,cancelable:true,...options}));
};
async function drag(from:{x:number;y:number},to:{x:number;y:number},options:PointerEventInit={},end='pointerup'){
  pointer('pointerdown',from.x,from.y,options);await tick();
  pointer('pointermove',to.x,to.y,options);await tick();
  pointer(end,to.x,to.y,options);await tick();
}
async function draw(points:Array<{x:number;y:number;pressure?:number}>){
  pointer('pointerdown',points[0].x,points[0].y,{pressure:points[0].pressure??.2});await tick();
  for(const point of points.slice(1)){pointer('pointermove',point.x,point.y,{pressure:point.pressure??.7});await tick();}
  const last=points.at(-1)!;pointer('pointerup',last.x,last.y);await tick();
}
async function choose(label:string){await click('定規');await click(label);}
function Probe(){
  workspace=usePaintWorkspace();const {controls}=useContext(PaintLayerControlsContext);
  return <><aside style={{width:'124px'}}>{w()?.tools}</aside><section id="stage" style={{position:'relative',width:'500px',height:'500px',background:'white',flexShrink:0}}>
    {w()?.scene.owners.map(owner=><PaintOwnerPreview ownerKey={owner.key} container={{x:0,y:0,w:100,h:100}}/>)}
    <PaintInputSurface canvas={{w:100,h:100}}/>
  </section><aside style={{width:'240px'}}>{controls}{w()?.layers}{w()?.status}<button id="undo" onClick={()=>w().undo()}>取り消し</button><button id="redo" onClick={()=>w().redo()}>やり直し</button></aside></>;
}
const makeScene=(kind:PaintLayer['kind']='raster'):PaintScene=>({frame:{x:0,y:0,w:100,h:100},colorMode:'color',owners:[{
  key:'page-direct',kind:'page',index:0,label:'定規の試験',frame:{x:10,y:15,w:80,h:60},
  paint:{version:1,width:640,height:480,dpi:203.2,guideInitialized:true,layers:[newPaintLayer('選択中のインク',kind)]},
}]});
async function mount(scene=makeScene()){
  ready=false;workspace=null;writes=[];closes=0;controller={current:null};
  render(<PaintEditor key={crypto.randomUUID()} controller={controller} initial={scene} assets={[]} page={1} panelIndex={0} overlay title="定規の検証" onApply={async result=>{writes.push(result);}} onClose={()=>{closes++;}} onReady={()=>{ready=true;}}>
    <div style={{display:'flex',gap:'18px',alignItems:'flex-start',marginTop:'12px'}}><Probe/></div>
  </PaintEditor>,document.getElementById('app')!);
  for(let i=0;i<120&&!ready;i++)await tick();if(!ready)throw Error('PaintEditor did not become ready');
  await tick();
}
async function rotate(degrees:number){
  const g=guide(),distance=px(95),offset=px(4),a=g.angle,target=degrees*Math.PI/180;
  const from={x:g.origin.x+Math.cos(a)*distance-Math.sin(a)*offset,y:g.origin.y+Math.sin(a)*distance+Math.cos(a)*offset};
  const to={x:g.origin.x+Math.cos(target)*distance-Math.sin(target)*offset,y:g.origin.y+Math.sin(target)*distance+Math.cos(target)*offset};
  await drag(from,to,{metaKey:true,shiftKey:true});
}

async function verify(){
  await mount();
  const before=record(),layerId=layer().id,size=document.querySelector('[data-paint-size][aria-pressed="true"]')?.getAttribute('data-paint-size');
  await click('定規');
  check(document.querySelector('[role="menu"][aria-label="定規の種類"]')!==null&&!!button('集中線')&&!!button('平行線'),'三角定規をクリックして集中線と平行線を選ぶ');
  await click('平行線');
  check(record()===before&&!w().canUndo&&layer().id===layerId,'定規選択でレイヤー・作品・Undoを追加しない');
  check(button('ペン')?.getAttribute('aria-pressed')==='true'&&document.querySelector('[data-paint-size][aria-pressed="true"]')?.getAttribute('data-paint-size')===size,'選択中のラスターペンと太さを保持');
  await controller.current!.flush();check(writes.length===0,'定規選択だけでは保存writerを呼ばない');
  await click('定規');document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick();
  check(!document.querySelector('[aria-label="定規の種類"]')&&closes===0,'Escapeは定規メニューだけを閉じ描画を終了しない');

  // 手ぶれを含む一筆を水平に拘束し、筆圧・既存レイヤーを維持する。
  await draw([{x:20,y:25,pressure:.2},{x:45,y:35,pressure:.8},{x:75,y:31,pressure:.4}]);
  check(layer().strokes.length===1&&ink().owners[0].paint.layers.length===1&&layer().id===layerId,'一筆は同じレイヤーの通常strokeへ追加');
  check(layer().strokes[0].points.every(p=>close(toPaper(p).y,25)),'手ぶれを含む全サンプルが平行線方向へ吸着');
  check(layer().strokes[0].points.some(p=>close(p.pressure,.8))&&close(layer().strokes[0].points.at(-1)!.pressure,.4),'途中の筆圧と離した瞬間の筆圧補完を保持');
  const savedInk=record(),center=toggle();
  await drag({x:center.x+px(6.1),y:center.y},{x:center.x+px(6.1),y:center.y},{metaKey:true});
  check(guide().enabled&&record()===savedInk,'○の外側0.1pxはスナップを切り替えず描画もしない');
  await drag({x:center.x+px(5.9),y:center.y},{x:center.x+px(5.9),y:center.y},{metaKey:true});
  check(!guide().enabled&&record()===savedInk,'○の内側で⌘クリックするとスナップOFF、既存線は不変');
  await draw([{x:20,y:60},{x:45,y:74},{x:70,y:62}]);
  check(layer().strokes[1].points.some(p=>toPaper(p).y>70),'スナップOFF中は自由なペン軌跡になる');
  const c=toggle();await drag(c,c,{metaKey:true});check(guide().enabled,'同じ○でスナップをONへ戻せる');

  // 内側の空間を掴む回転と45度刻み。線自体を掴む必要も、描画済みの線への変更もない。
  const beforeRotation=record(),origin={...guide().origin};
  for(const degrees of [45,90,135,180]){
    await rotate(degrees);
    check(close(Math.cos(guide().angle),Math.cos(degrees*Math.PI/180))&&close(Math.sin(guide().angle),Math.sin(degrees*Math.PI/180)),`帯の内側を⌘Shiftドラッグして${degrees}°へ回転`);
  }
  check(record()===beforeRotation&&close(guide().origin.x,origin.x)&&close(guide().origin.y,origin.y),'回転は基準点を固定し、描画済み線を変更しない');
  await rotate(45);
  await draw([{x:25,y:40},{x:50,y:70},{x:70,y:69}]);
  const diagonal=layer().strokes.at(-1)!;
  check(diagonal.points.every(p=>close(toPaper(p).x-toPaper(p).y,-15)),'回転した定規は次の一筆を45°へ拘束');
  await rotate(135);
  w().undo();await tick();check(layer().strokes.length===2,'定規を回してもUndoは直前の一筆を取り消す');
  w().redo();await tick();check(layer().strokes.length===3,'Redoで同じ一筆が戻る');

  // 集中線の間を掴んで基準点移動。次の線だけが新しい焦点へ向かう。
  await choose('集中線');
  const beforeMove=record(),oldOrigin={...guide().origin},grab={x:oldOrigin.x+px(11),y:oldOrigin.y+px(7)};
  await drag(grab,{x:grab.x+10,y:grab.y-10},{metaKey:true});
  check(close(guide().origin.x,oldOrigin.x+10)&&close(guide().origin.y,oldOrigin.y-10),'集中線の方向線の内側を⌘ドラッグして基準点移動');
  check(record()===beforeMove,'基準点移動で描画済み線は追従しない');
  const focus={...guide().origin},start={x:85,y:18};
  await draw([start,{x:72,y:28},{x:64,y:44}]);
  check(layer().strokes.at(-1)!.points.every(p=>{const q=toPaper(p);return close((q.x-focus.x)*(start.y-focus.y),(q.y-focus.y)*(start.x-focus.x));}),'集中線は開始点と基準点を結ぶ直線へ吸着');

  // ポインター取消し・捕捉喪失・ウィンドウ非アクティブ・Escapeは定規移動を取消し、描画を汚さない。
  const beforeCancel=record();
  for(const ending of ['pointercancel','lostpointercapture','blur','Escape']){
    const original={...guide().origin};
    pointer('pointerdown',original.x,original.y,{metaKey:true});await tick();
    pointer('pointermove',original.x+7,original.y+8,{metaKey:true});await tick();
    if(ending==='blur')window.dispatchEvent(new Event('blur'));
    else if(ending==='Escape')window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    else pointer(ending,original.x+7,original.y+8,{metaKey:true});
    await tick();
    check(close(guide().origin.x,original.x)&&close(guide().origin.y,original.y)&&record()===beforeCancel,`${ending}で基準点を戻し線は追加しない`);
  }
  const rasterCount=layer().strokes.length;
  await drag({x:8,y:6},{x:95,y:94},{},'pointercancel');
  check(layer().strokes.length===rasterCount,'定規で描いた筆もキャンセルで破棄');
  const focusBeforeGrow={...guide().origin};
  await draw([{x:2,y:2},{x:15,y:30}]);
  check(close(guide().origin.x,focusBeforeGrow.x)&&close(guide().origin.y,focusBeforeGrow.y),'レイヤーの描画範囲が拡張しても紙面上の基準点は不変');

  // 表示倍率を変えても○は外径12px。見た目の外周直前/直後で判定する。
  const stage=document.getElementById('stage')!;stage.style.width='750px';stage.style.height='750px';await tick();await tick();
  const circle=document.querySelector<SVGCircleElement>('[data-ruler-toggle]')!,svg=circle.ownerSVGElement!;
  check(Math.abs((circle.r.baseVal.value*2+1)*svg.getBoundingClientRect().width/svg.viewBox.baseVal.width-12)<.1,'拡大表示でも○の外径は12px');
  const zoomed=toggle();await drag({x:zoomed.x+px(6.1),y:zoomed.y},{x:zoomed.x+px(6.1),y:zoomed.y},{metaKey:true});
  check(guide().enabled,'拡大時も見た目より外のクリックは切替対象外');
  await drag(zoomed,zoomed,{metaKey:true});check(!guide().enabled,'拡大時も○の内側は切替対象');
  await controller.current!.flush();
  check(writes.length===1&&writes[0].owners.some(o=>o.blob.size>0),'描線は既存のPNG保存経路へ出力');
  const saved=structuredClone(ink()),savedJson=JSON.stringify(saved);
  await mount(saved);check(record()===savedJson&&!w().ruler,'再読込で描画済み線を保持し定規は作品に保存しない');

  // ベクターでも専用ラスターレイヤーを作らず、選択ペンとスタイルを保ったまま一本の直線パスになる。
  await mount(makeScene('vector'));await click('ベジェペン');
  await click('線（枠）の色');await click('線（枠）：黒');await click('太さ 12 px');
  const vectorBefore=record(),vectorId=layer().id;
  await choose('平行線');
  check(record()===vectorBefore&&button('ベジェペン')?.getAttribute('aria-pressed')==='true','ベクターペン選択とレイヤーを定規選択で保持');
  await rotate(45);await draw([{x:25,y:25},{x:60,y:55}]);
  const path=layer().paths?.at(-1);
  check(ink().owners[0].paint.layers.length===1&&layer().id===vectorId&&layer().strokes.length===0&&path?.nodes.length===2,'ベクターは同じレイヤーへ一本の直線パス');
  check(path!.nodes.every(p=>close(toPaper(p).x,toPaper(p).y))&&path!.style.width===12,'ベクターの向きとペン幅を保持');
  const vectorSaved=record();await rotate(90);check(record()===vectorSaved,'定規回転でベクターパスも追従しない');
  await drag({x:30,y:30},{x:35,y:31},{metaKey:true});
  check(layer().paths?.length===1&&record()!==vectorSaved,'定規の外側では⌘によるベクターの一時選択・移動を保持');
  w().undo();await tick();check(record()===vectorSaved,'ベクター移動のUndoも既存経路に従う');
  w().undo();await tick();check(!layer().paths?.length,'ベクターも一筆をUndo');
  w().redo();await tick();check(layer().paths?.length===1,'ベクターのRedo');
  await choose('定規を解除');
  check(!w().ruler&&button('ベジェペン')?.getAttribute('aria-pressed')==='true'&&layer().id===vectorId,'定規解除でも選択ペンとレイヤーを保持');
  return checks;
}
runButton.onclick=()=>{
  runButton.disabled=true;checks.length=0;report.textContent='実行中';
  void verify().then(result=>{report.textContent=`PASS ${result.length}\n${result.join('\n')}`;})
    .catch(error=>{report.textContent=`FAIL after ${checks.length}\n${String(error)}\n${error.stack}\n${checks.join('\n')}`;})
    .finally(()=>{runButton.disabled=false;});
};

// 同じfixtureの?appは、通常のツールパレット入口とマウス操作を実Appで手動/外部ドライバーから検査する。
if(new URLSearchParams(location.search).has('app')){
  runButton.hidden=true;report.textContent='合成原稿：通常の編集画面から定規を操作';
  const originalFetch=window.fetch.bind(window);
  window.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href);return url.origin!==location.origin||url.pathname.startsWith('/__nyamuru/')?Promise.resolve(Response.json({error:'Ruler QA: services disabled'},{status:503})):originalFetch(input,init);};
  // @ts-expect-error QA Vite exports the existing editor; no application-only test route.
  const {EditorApp}=await import('../src/components/App');
  const previousVNode=options.vnode;
  options.vnode=vnode=>{previousVNode?.(vnode);if(vnode.type===PaintEditor){const props=vnode.props as ComponentProps<typeof PaintEditor>;if(props.controller)controller=props.controller;}};
  window.addEventListener('pointerup',()=>requestAnimationFrame(()=>{report.dataset.snapshot=JSON.stringify(controller.current?.snapshot());}),true);
  const fixture=createEmptyWorkspaceDocument();
  fixture.manga.meta.title='集中線・平行線の検証';fixture.manga.meta.episode_id='paint-ruler-qa';
  fixture.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:20,y:30,w:170,h:220},bg:0,action:null,figures:[],bubbles:[]}];
  render(<EditorApp startupWorkspace={{document:fixture,hasDocument:true}}/>,document.getElementById('app')!);
}
