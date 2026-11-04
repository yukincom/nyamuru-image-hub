// 見込み: 選択ツールを一時的に重ねれば、道具と作品を保ったまま⌘中だけ選択できる。
// 合格: 復帰・実ドラッグ・Undo・保存回数を実PaintEditorで確認。入力と原稿は合成、実タブレット/OSキー配列は対象外。
import {options,render,type ComponentProps} from 'preact';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import PaintEditor,{type PaintResult} from '../src/components/PaintEditor';
import PaintInputSurface,{PaintOwnerPreview} from '../src/components/PaintSceneView';
import {usePaintWorkspace,type PaintWorkspaceState} from '../src/lib/paintWorkspace';
import {newPaintLayer,type PaintScene} from '../src/lib/paintDocument';
import type {PaintController} from '../src/lib/paintSession';
import '../src/styles/global.css';

if(location.hostname!=='127.0.0.1'||location.port!=='4335')throw Error('Dedicated test origin required');
const report=document.getElementById('report')!,run=document.getElementById('run') as HTMLButtonElement;
const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
let workspace:PaintWorkspaceState|null=null,ready=false,writes:PaintResult[]=[];
let controller:{current:PaintController|null}={current:null};
const w=()=>workspace!,scene=()=>controller.current!.snapshot().scene;
const record=()=>JSON.stringify(scene());
const button=(label:string)=>document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const selected=(label:string)=>button(label)?.getAttribute('aria-pressed')==='true';
const click=async(label:string)=>{button(label).click();await tick();};
async function key(type:string,key:string,options:KeyboardEventInit={},target:EventTarget=window){
  const event=new KeyboardEvent(type,{key,bubbles:true,cancelable:true,...options});target.dispatchEvent(event);await tick();return event;
}
const press=()=>key('keydown','Meta',{metaKey:true}),release=()=>key('keyup','Meta');
function pointer(type:string,x:number,y:number,options:PointerEventInit={}){
  const surface=document.querySelector<HTMLElement>('.paint-input')!,box=surface.getBoundingClientRect();
  surface.dispatchEvent(new PointerEvent(type,{pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:box.x+x*box.width/100,clientY:box.y+y*box.height/100,bubbles:true,cancelable:true,...options}));
}
async function drag(x:number,y:number,dx:number,dy:number,options:PointerEventInit={},releaseEarly=false){
  pointer('pointerdown',x,y,options);await tick();pointer('pointermove',x+dx,y+dy,options);await tick();
  if(releaseEarly)await release();
  pointer('pointerup',x+dx,y+dy,releaseEarly?{}:options);await tick();
}
function Probe(){workspace=usePaintWorkspace();return <><aside style={{width:'125px'}}>{w()?.tools}</aside><section style={{position:'relative',width:'500px',height:'500px',background:'white'}}>
  {w()?.scene.owners.map(owner=><PaintOwnerPreview ownerKey={owner.key} container={{x:0,y:0,w:100,h:100}}/>)}<PaintInputSurface canvas={{w:100,h:100}}/>
  </section><aside>{w()?.layers}<input id="typing"/><div id="editable" contentEditable/></aside></>;}
async function mount(){
  ready=false;workspace=null;writes=[];controller={current:null};
  const lower=newPaintLayer('下の線'),upper=newPaintLayer('上の線');
  lower.strokes=[{tool:'pen',color:'#000000',size:6,points:[{x:20,y:25,pressure:1,time:0},{x:75,y:25,pressure:1,time:1}]}];
  upper.strokes=[{tool:'pen',color:'#000000',size:6,points:[{x:20,y:65,pressure:1,time:0},{x:75,y:65,pressure:1,time:1}]}];
  const initial:PaintScene={frame:{x:0,y:0,w:100,h:100},owners:[{key:'page',kind:'page',index:0,label:'一時選択',frame:{x:0,y:0,w:100,h:100},paint:{version:1,width:100,height:100,dpi:100,guideInitialized:true,layers:[lower,upper]}}]};
  render(<PaintEditor key={crypto.randomUUID()} controller={controller} initial={initial} assets={[]} page={1} panelIndex={0} overlay title="⌘一時選択" onApply={async result=>{writes.push(result);}} onClose={()=>{throw Error('Unexpected close');}} onReady={()=>{ready=true;}}><div style={{display:'flex',gap:'18px'}}><Probe/></div></PaintEditor>,document.getElementById('app')!);
  for(let i=0;i<120&&!ready;i++)await tick();if(!ready)throw Error('Editor not ready');await tick();
}
async function verify(){
  await mount();const original=record();
  // 見込み: 押下/解放と連打は表示だけ。合格: ペン/消しゴム/投げ縄/バケツへ復帰し、scene・Undo・保存が不変。実UI。
  for(const label of ['ペン','消しゴム','投げ縄','バケツ','ベジェペン']){
    await click(label);await press();await press();
    check(selected('選択')&&!selected(label)&&w().selectionTool===true,`${label}から⌘押下中だけ選択表示`);
    await release();check(selected(label)&&!w().selectionTool,`⌘解放で${label}へ復帰`);
  }
  await controller.current!.flush();check(record()===original&&!w().canUndo&&writes.length===0,'キーだけでは作品・Undo・保存を変更しない');

  // 見込み: 既存hit/移動へ通せばクリック選択は無編集、ドラッグだけが編集。合格: 下レイヤー選択・移動1回・Undo復元・復帰後の描線。実入力経路。
  await click('ペン');await press();await drag(40,25,0,0,{metaKey:true});
  check(controller.current!.snapshot().layerId===scene().owners[0].paint.layers[0].id&&record()===original&&!w().canUndo,'⌘クリックで下のラスター線を選び、描線を増やさない');
  await drag(40,25,10,8,{metaKey:true},true);
  const moved=scene().owners[0].paint.layers[0].strokes[0];
  check(moved.points[0].x===30&&moved.points[0].y===33&&selected('ペン'),'ドラッグ途中で⌘を離しても移動を完了しペンへ復帰');
  await press();await key('keydown','z',{metaKey:true});await release();
  check(record()===original,'⌘Zが既存Undoを通って移動だけを取り消す');
  await drag(30,45,20,5);check(scene().owners[0].paint.layers[0].strokes.length===2&&selected('ペン'),'復帰後は選択したレイヤーへ通常のペン描画');

  // 見込み: focus喪失でkeyupが届かなくても解除できる。合格: blur後ペンへ戻り、入力欄/IME/別修飾キーでは一時選択しない。DOM入力、OS切替は対象外。
  await press();window.dispatchEvent(new Event('blur'));await tick();check(selected('ペン')&&!w().selectionTool,'ウィンドウblurで元のペンへ復帰');
  for(const id of ['typing','editable']){await key('keydown','Meta',{metaKey:true},document.getElementById(id)!);check(selected('ペン'),`${id}の文字入力中は道具を変えない`);await release();}
  await key('keydown','Meta',{metaKey:true,isComposing:true});check(selected('ペン'),'IME変換中は道具を変えない');await release();
  for(const [name,mod] of [['Control','ctrlKey'],['Alt','altKey']] as const){await key('keydown',name,{[mod]:true});check(selected('ペン'),`${name}単独では通常ペンを一時選択にしない`);await key('keyup',name);}
  await press();const save=await key('keydown','s',{metaKey:true});check(!save.defaultPrevented&&selected('選択'),'⌘Sを消費せずアプリの保存へ渡す');await release();

  // 見込み: 既存レイヤーの⌘内容選択は元ツールを置換しない。合格: 範囲選択を作り、解放後も消しゴム。実パレット経路。
  await click('消しゴム');await press();
  document.querySelector<HTMLButtonElement>('.layer-select')!.dispatchEvent(new MouseEvent('click',{metaKey:true,bubbles:true}));await tick();
  check(!!w().selection&&selected('選択'),'⌘レイヤークリックの不透明部分選択を保持');
  await release();check(selected('消しゴム'),'内容選択後も⌘解放で元の消しゴムへ戻る');

  // 見込み: 定規hitだけが⌘操作を優先。合格: 原点移動は無編集、外側の描線は選択移動でき、解除で設置ツールへ復帰。実定規/選択経路。
  await mount();await click('定規');await click('集中線');await drag(50,50,0,0);
  const beforeRuler=record();await press();await drag(50,50,5,5,{metaKey:true});
  check(w().ruler?.origin.x===55&&w().ruler?.origin.y===55&&record()===beforeRuler,'⌘基準点ドラッグが一時選択より優先され作品は不変');
  await release();check(selected('定規'),'⌘解放で定規設置ツールへ復帰');
  await click('ペン');await press();await drag(40,25,4,3,{metaKey:true});await release();
  check(scene().owners[0].paint.layers[0].strokes[0].points[0].x===24&&selected('ペン'),'定規の外側は⌘でラスター線を選択移動できる');
  return checks;
}
run.onclick=()=>{run.disabled=true;checks.length=0;report.textContent='実行中';void verify().then(result=>{report.textContent=`PASS ${result.length}\n${result.join('\n')}`;}).catch(error=>{report.textContent=`FAIL after ${checks.length}\n${String(error)}\n${error.stack}\n${checks.join('\n')}`;}).finally(()=>{run.disabled=false;});};

// 見込み: native要素/空白選択で描画sessionを閉じても、⌘解放後に元ツールへ戻れる。
// 合格: 外部ブラウザードライバーから選択・解放後のペン表示と続く描線を確認。実App/合成原稿、外部サービス停止。
if(new URLSearchParams(location.search).has('app')){
  run.hidden=true;report.textContent='合成原稿：⌘一時選択';
  const originalFetch=window.fetch.bind(window);
  window.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href);return url.origin!==location.origin&&/^https?:$/.test(url.protocol)||url.pathname.startsWith('/__nyamuru/')?Promise.resolve(Response.json({error:'Selection QA: services disabled'},{status:503})):originalFetch(input,init);};
  // @ts-expect-error QA Vite exports the existing editor without a production test route.
  const {EditorApp}=await import('../src/components/App');
  const previousVNode=options.vnode;
  options.vnode=vnode=>{previousVNode?.(vnode);if(vnode.type===PaintEditor){const props=vnode.props as ComponentProps<typeof PaintEditor>;if(props.controller)controller=props.controller;}};
  for(const event of ['pointerup','keyup'])window.addEventListener(event,()=>setTimeout(()=>{report.dataset.snapshot=JSON.stringify(controller.current?.snapshot());},100),true);
  const fixture=createEmptyWorkspaceDocument();fixture.manga.meta.title='⌘一時選択の検証';fixture.manga.meta.episode_id='temporary-selection-qa';
  fixture.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:20,y:30,w:170,h:100},bg:0,action:null,bubbles:[{text:'テスト',shape:'normal',bbox:{x:40,y:50,w:40,h:30}}]}, {id:2,shape:{type:'rect',x:20,y:150,w:170,h:100},bg:0,action:null,bubbles:[]}];
  render(<EditorApp startupWorkspace={{document:fixture,hasDocument:true}}/>,document.getElementById('app')!);
}
