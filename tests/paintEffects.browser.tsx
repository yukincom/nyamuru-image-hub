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
  const controller=useRef<PaintController|null>(null),[saved,setSaved]=useState('未出力');
  return <><style>{`body{padding:14px;background:#f6f5f3}h1{font-size:20px}.test-workspace{display:flex;gap:20px;align-items:flex-start}.test-tools{width:86px;flex:none}.test-layers{width:270px;flex:none}.test-paper{position:relative;width:800px;height:600px;background:white;border:1px solid #ccc;flex:none}.test-history{margin:8px 0}.test-history output{display:block;max-width:1100px;overflow-wrap:anywhere;font-size:10px}.test-tools .paint-tools{display:block}.test-tools .paint-tool-icons{display:grid;grid-template-columns:1fr 1fr}.test-tools .paint-size{display:flex}.test-tools .paint-aa{display:none}`}</style><h1>マスク・トーン検証（合成したテスト画像）</h1>
    <p role="status">{checks.some(s=>s.startsWith('FAIL'))?'FAIL':'PASS'}: {checks.join(' / ')}</p>
    <PaintEditor initial={initial} assets={[]} title="検証" page={0} panelIndex={0} overlay={false} controller={controller} onApply={async result=>setSaved(result.owners[0]?.remove?'作画削除を保存（PNGなし）':`PNG出力済み: ${result.owners.length}件、${result.owners[0]?.blob.size} bytes`)} onClose={()=>{}}>
      <Controls/><button onClick={()=>{
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
