/** Copy tests/paintEffects.browser.html to public/paint-effects-test.html temporarily,
 * then open /paint-effects-test.html on the existing Astro development server.
 * Synthetic artwork only; this fixture never accesses or writes project storage. */
import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import PaintEditor, { PaintTools, PaintLayers, PaintStatus } from '../src/components/PaintEditor';
import PaintInputSurface, { PaintOwnerPreview } from '../src/components/PaintSceneView';
import { usePaintWorkspace } from '../src/lib/paintWorkspace';
import type { PaintController } from '../src/lib/paintSession';
import type { PaintDocument, PaintLayer, PaintStroke } from '../src/types';
import { newPaintLayer, type PaintScene } from '../src/lib/paintDocument';
import { newPaintMask } from '../src/lib/paintMask';
import { readPaintPixels, renderPaintPng, paintPreviewRenderer, decodePaintImage } from '../src/lib/paintRenderer';
import '../src/styles/global.css';

const emptyImages=new Map<string,HTMLImageElement>();
const fill=(color:string,x=0,y=0,w=600,h=400):PaintStroke=>({tool:'fill',color,size:1,points:[{x:0,y:0,pressure:1,time:0}],selection:[{x,y,w,h}]});
const tone=(density:number)=>({enabled:true,lpi:60,mode:'fixed' as const,density});
const frame={x:10,y:10,w:60,h:40};
const region=(name:string,color:string,x:number,density:number):PaintLayer=>({...newPaintLayer(name),strokes:[fill(color,x,40,220,320)],tone:tone(density)});
const initial:PaintScene={frame,owners:[{key:'background',kind:'background',index:0,label:'検証用',frame,paint:{version:1,width:600,height:400,dpi:600,layers:[
  {...newPaintLayer('下の線'),strokes:[{tool:'line',color:'#000000',size:8,points:[{x:20,y:200,pressure:1,time:0},{x:580,y:200,pressure:1,time:1}]}]},
  region('背景 20%（赤）','#ff0000',40,20),region('服 40%（青）','#0000ff',340,40),
]}}]};
const checks:string[]=[];
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
const alpha=(p:ImageData,x:number,y:number)=>p.data[(y*p.width+x)*4+3];
const layer:PaintLayer={...newPaintLayer('canvas mask'),strokes:[fill('#ff0000',0,0,80,80)],mask:newPaintMask([{x:0,y:0,w:40,h:80}])};
const doc:PaintDocument={version:1,width:80,height:80,dpi:600,layers:[layer]};
const erase:PaintStroke={tool:'eraser',color:'#000000',size:16,points:[{x:20,y:30,pressure:1,time:0}]};
try{
  const pixels=readPaintPixels(doc,layer,emptyImages);
  assert(alpha(pixels,20,60)===255&&alpha(pixels,60,60)===0,'Selection mask must crop only the mask');checks.push('選択範囲マスク');
  const hidden={...layer,mask:{...layer.mask!,strokes:[...layer.mask!.strokes,erase]}};
  assert(alpha(readPaintPixels(doc,hidden,emptyImages),20,30)===0,'Mask eraser must hide source');
  const reveal={...erase,tool:'pen' as const};
  const restored={...hidden,mask:{...hidden.mask,strokes:[...hidden.mask.strokes,reveal]}};
  assert(alpha(readPaintPixels(doc,restored,emptyImages),20,30)===255,'Mask brush must reveal original color');
  assert(alpha(readPaintPixels(doc,{...hidden,mask:{...hidden.mask,enabled:false}},emptyImages),60,60)===255,'Disabling mask must restore original');checks.push('消す・戻す・無効化');
  const canvas=document.createElement('canvas');canvas.width=canvas.height=80;const renderer=paintPreviewRenderer();
  renderer.draw(canvas,doc,emptyImages,{layerId:layer.id,target:'mask',stroke:erase});
  assert(alpha(canvas.getContext('2d')!.getImageData(0,0,80,80),20,30)===0,'Live mask must match saved mask');
  renderer.draw(canvas,{...doc,layers:[hidden]},emptyImages,{layerId:layer.id,target:'mask',stroke:reveal});
  assert(alpha(canvas.getContext('2d')!.getImageData(0,0,80,80),20,30)===255,'Live reveal must redraw from original, not masked cache');renderer.dispose();checks.push('描画中と確定後の一致');
  const png=await renderPaintPng({...doc,layers:[hidden]},emptyImages),image=await decodePaintImage(png);
  const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,80,80);ctx.drawImage(image,0,0);image.src='';
  const exported=ctx.getImageData(0,0,80,80);assert(alpha(exported,20,30)===0&&alpha(exported,20,60)===255&&alpha(exported,60,60)===0,'PNG must preserve mask');checks.push('PNG出力');
  const toneLayer={...layer,mask:undefined,tone:tone(20)};
  const tonePixels=readPaintPixels(doc,toneLayer,emptyImages);
  let count=0;for(let i=3;i<tonePixels.data.length;i+=4){const a=tonePixels.data[i];assert(a===0||a===255,'Tone gaps must be transparent');count+=a/255;}
  assert(Math.abs(count/6400-.2)<.03,'Tone must cover 20%');checks.push('透過網点の密度');
}catch(error){checks.push(`FAIL: ${error instanceof Error?error.message:String(error)}`);}

function Controls(){const state=usePaintWorkspace();return <div class="test-history"><button disabled={!state?.canUndo} onClick={()=>state?.undo()}>元に戻す</button><button disabled={!state?.canRedo} onClick={()=>state?.redo()}>やり直す</button><output aria-label="検証状態">{JSON.stringify(state?.scene.owners[0].paint.layers.map(l=>({name:l.name,strokes:l.strokes.length,lastColor:l.strokes.at(-1)?.color,maskStrokes:l.mask?.strokes.length,maskPoints:l.mask?.strokes.at(-1)?.points.length,tone:l.tone})))}</output></div>;}
function Fixture(){
  const controller=useRef<PaintController|null>(null),[saved,setSaved]=useState('未出力'),[toolReport,setToolReport]=useState('未検証');
  // 見込み: 通常の作成・選択入口が同じペン判定を使えば、生成マスクでも投げ縄等を保持できる。
  // 合格: 非ペン7種を作成/選択で保持し、不一致のペンだけ双方向に交換。マスク作成のUndo/Redoも成功。
  // 範囲: 実PaintEditorとツール/レイヤーUI。合成sceneのみで、作品保存・実モデル・ペンタブは対象外。
  async function verifyToolRetention(){
    const results:string[]=[],check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);results.push(label);};
    const settle=async()=>{for(let i=0;i<4;i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));};
    const control=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).findLast(button=>button.getAttribute('aria-label')===label||button.textContent?.trim()===label)!;
    const click=async(label:string)=>{const button=control(label);if(!button||button.disabled)throw Error(`操作不可: ${label}`);button.click();await settle();};
    const active=(label:string)=>control(label)?.getAttribute('aria-pressed')==='true';
    const snapshot=()=>controller.current!.snapshot();
    const selected=()=>snapshot().scene.owners[0].paint.layers.find(layer=>layer.id===snapshot().layerId)!;
    const action=async(value:Parameters<PaintController['layerAction']>[0])=>{controller.current!.layerAction(value);await settle();};
    try{
      setToolReport('検証中');await settle();
      await click('投げ縄');await click('生成マスク化');const mask=selected();
      check(mask.generationMask&&active('投げ縄'),'投げ縄のまま生成マスクを作成');
      await click('元に戻す');check(!snapshot().scene.owners[0].paint.layers.some(layer=>layer.id===mask.id)&&active('投げ縄'),'作成Undoでも投げ縄を保持');
      await click('やり直す');check(snapshot().scene.owners[0].paint.layers.some(layer=>layer.id===mask.id)&&active('投げ縄'),'作成Redoでも投げ縄を保持');
      for(const label of ['投げ縄','自動選択','消しゴム','四角','選択','ダイレクト選択','バケツ']){
        if(label==='自動選択')await click('選択のツール一覧');
        await click(label);await click('ベクターレイヤー追加');const vector=selected();
        check(vector.kind==='vector'&&active(label),`${label}: ベクター追加で保持`);
        await action({type:'select',key:'background',id:mask.id,mask:'generationMask'});
        check(selected().id===mask.id&&active(label),`${label}: 生成マスク選択で保持`);
        await click('ラスターレイヤー追加');check(selected().kind==='raster'&&active(label),`${label}: ラスター追加で保持`);
        const before=snapshot().scene;await action({type:'select',key:'background',id:vector.id});
        check(active(label)&&snapshot().scene===before,`${label}: ベクター選択で道具と原稿を保持`);
      }
      await click('ペン');await click('ベクターレイヤー追加');const vector=selected();
      check(active('ベジェペン'),'ラスターのペンからベクター追加でベジェペンへ');
      await click('ラスターレイヤー追加');const raster=selected();check(active('ペン'),'ベジェペンからラスター追加でペンへ');
      await action({type:'select',key:'background',id:vector.id});check(active('ベジェペン'),'ベクター選択で不一致のペンを交換');
      await action({type:'select',key:'background',id:raster.id});check(active('ペン'),'ラスター選択で不一致のペンを交換');
      await click('ベジェペン');await action({type:'select',key:'background',id:mask.id,mask:'generationMask'});check(active('ペン'),'生成マスクはベジェペンだけをラスターのペンへ交換');
      await action({type:'update',key:'background',id:vector.id,patch:{mask:newPaintMask([])}});
      await click('ベジェペン');await action({type:'select',key:'background',id:vector.id,mask:'mask'});check(active('ペン'),'ベクターに付くクリッピングマスクもラスターのペンへ');
      await action({type:'select',key:'background',id:vector.id,mask:'mask'});check(active('ベジェペン'),'クリッピングマスクの選択解除でベクターのペンへ戻る');
      await click('選択のツール一覧');await click('投げ縄');await click('トーンレイヤー作成');check(selected().tone&&active('投げ縄'),'投げ縄のままトーンレイヤーを作成');
      setToolReport(`ツール保持 PASS ${results.length}\n${results.join('\n')}`);
    }catch(error){setToolReport(`ツール保持 FAIL after ${results.length}: ${String(error)}\n${results.join('\n')}`);console.error(error);}
  }
  return <><style>{`body{padding:14px;background:#f6f5f3}h1{font-size:20px}.test-workspace{display:flex;gap:20px;align-items:flex-start}.test-tools{width:86px;flex:none}.test-layers{width:270px;flex:none}.test-paper{position:relative;width:800px;height:600px;background:white;border:1px solid #ccc;flex:none}.test-history{margin:8px 0}.test-history output{display:block;max-width:1100px;overflow-wrap:anywhere;font-size:10px}.test-tools .paint-tools{display:block}.test-tools .paint-tool-icons{display:grid;grid-template-columns:1fr 1fr}.test-tools .paint-size{display:flex}.test-tools .paint-aa{display:none}`}</style><h1>マスク・トーン検証（合成したテスト画像）</h1>
    <p role="status">{checks.some(s=>s.startsWith('FAIL'))?'FAIL':'PASS'}: {checks.join(' / ')}</p>
    <PaintEditor initial={initial} assets={[]} title="検証" page={0} panelIndex={0} overlay={false} controller={controller} onApply={async result=>setSaved(result.owners[0]?.remove?'作画削除を保存（PNGなし）':`PNG出力済み: ${result.owners.length}件、${result.owners[0]?.blob.size} bytes`)} onClose={()=>{}}>
      <Controls/><button id="tool-retention-run" onClick={()=>void verifyToolRetention()}>レイヤー変更時のツール保持を検証</button><pre id="tool-retention-report">{toolReport}</pre><button onClick={()=>{
        const surface=document.querySelector<HTMLDivElement>('.paint-input')!;
        const rect=surface.getBoundingClientRect();
        const event=(type:string,x:number,y:number,buttons:number)=>new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:777,pointerType:'pen',isPrimary:true,button:0,buttons,pressure:buttons?.8:0,clientX:rect.x+rect.width*x,clientY:rect.y+rect.height*y});
        surface.dispatchEvent(event('pointerdown',.62,.3,1));
        for(let i=1;i<=20;i++)window.dispatchEvent(event('pointermove',.62+i*.01,.3+i*.02,1));
        window.dispatchEvent(event('pointerup',.82,.7,0));
      }}>描画ドラッグを検証</button><div class="test-workspace"><aside class="paint-dock test-tools"><PaintTools/></aside><div class="test-paper"><PaintOwnerPreview ownerKey="background" container={{x:0,y:0,w:80,h:60}} inkOnly/><PaintInputSurface canvas={{w:80,h:60}}/></div><aside class="paint-dock test-layers"><PaintLayers/></aside></div><PaintStatus/>
    </PaintEditor><button onClick={()=>void controller.current?.flush()}>PNG出力を検証</button><output>{saved}</output>
  </>;
}
render(<Fixture/>,document.getElementById('test-root')!);
