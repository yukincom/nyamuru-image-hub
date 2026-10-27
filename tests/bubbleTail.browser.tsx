/** Visual regression fixture: production SVG component and geometry, no user document. */
import { render } from 'preact';
import BubbleShapeSvg from '../src/components/BubbleShapeSvg';
import MangaCanvas from '../src/components/MangaCanvas';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { captureQwenComposition, captureQwenCompositionCanvas } from '../src/lib/qwenComposition';
import { createFrameArtwork, prepareImageAsset } from '../src/lib/imagePlacement';
import { saveFigureCropAssets, deleteFigureCropAssets } from '../src/lib/figureCropStore';
import { blobImageData, flattenedPsd } from '../src/lib/pageExport';
import { innerFrameBounds } from '../src/lib/canvasGeometry';
import { bubbleTailComposite } from '../src/lib/bubbleTail';
import { createBubbleBezier } from '../src/lib/bubbleBezier';
import { BUBBLE_MATERIALS } from '../src/lib/bubblePresetData';
import type { Bubble, CanvasElementSelection, Manga } from '../src/types';
import '../src/styles/global.css';
const cases: Array<{ label: string; shape: Bubble['shape']; bezier?: Bubble['bezier']; w: number; h: number; target: { x: number; y: number } }> = [
  { label: '標準オーバル・斜め', shape: 'normal', bezier: createBubbleBezier('ellipse'), w: 40, h: 55, target: { x: 60, y: 70 } },
  { label: '標準オーバル・下', shape: 'normal', bezier: createBubbleBezier('ellipse'), w: 45, h: 45, target: { x: 22.5, y: 70 } },
  { label: '横長オーバル・左', shape: 'normal', bezier: createBubbleBezier('ellipse'), w: 55, h: 30, target: { x: -10, y: 50 } },
  { label: '四角・角へ接続', shape: 'square', w: 38, h: 45, target: { x: 65, y: 65 } },
  { label: '作者素材・右', shape: BUBBLE_MATERIALS[0].shape, bezier: BUBBLE_MATERIALS[0].bezier, w: 45, h: 40, target: { x: 70, y: 20 } },
  { label: '削除後の本体', shape: 'normal', bezier: createBubbleBezier('ellipse'), w: 40, h: 55, target: { x: 20, y: 27.5 } },
];
render(<main style={{ padding: '24px', background: '#eef0f3', minHeight: '100vh', color: '#242735' }}>
  <h1 style={{fontSize:'22px'}}>コマ枠と吹き出しの重なり</h1>
  <button id="run-layers" onClick={()=>void verifyLayers()}>画面・PNG・PSDの重なりを検証</button>
  <pre id="layer-report" aria-live="polite" style={{whiteSpace:'pre-wrap',maxHeight:'210px',overflow:'auto'}}>未実行</pre>
  <div style={{display:'flex',gap:'16px',flexWrap:'wrap'}}>
    <section><h2 style={{fontSize:'16px'}}>実MangaCanvas</h2><div id="layer-canvas" style={{width:'440px',height:'480px',display:'grid',position:'relative'}}/></section>
    <section><h2 style={{fontSize:'16px'}}>同じ原稿の合成PNG</h2><div id="layer-image"/></section>
  </div>
  <details><summary>本体としっぽの既存比較</summary>
  <h1 style={{fontSize:'22px'}}>本体としっぽの合成</h1><p>本体と先端は別データのまま。描画する外周だけを合体。</p>
  <div style={{display:'grid',gridTemplateColumns:'repeat(3, 280px)',gap:'16px'}}>
    {cases.map((item, i) => <section style={{background:'#fff',padding:'16px',borderRadius:'8px'}} key={item.label}>
      <h2 style={{fontSize:'15px'}}>{item.label}</h2>
      <div style={{position:'relative',height:'280px', marginLeft:'32px',marginTop:'16px','--bubble-line-width':'3px'}}>
        <div style={{position:'absolute',width:`${item.w*3}px`,height:`${item.h*3}px`,top:'12px'}}>
          <BubbleShapeSvg shape={item.shape} bezier={item.bezier} composite={bubbleTailComposite({x:0,y:0,w:item.w,h:item.h},item.target,item.shape,item.bezier) ?? undefined} />
        </div>
      </div>
      <small>{i===5?'しっぽなし':'接続部を拡大して確認'}</small>
    </section>)}
  </div>
  </details>
</main>,document.getElementById('app')!);

async function verifyLayers(){
  if(location.hostname!=='127.0.0.1'||location.port!=='4335')throw Error('Dedicated QA origin 4335 required');
  const report=document.getElementById('layer-report')!,button=document.getElementById('run-layers') as HTMLButtonElement;
  const host=document.getElementById('layer-canvas')!,shots=document.getElementById('layer-image')!;
  const checks:string[]=[],stored:string[]=[],canvases:HTMLCanvasElement[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
  const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  const wait=async(ready:()=>boolean)=>{for(let i=0;i<180;i++){if(ready())return;await tick();}throw Error('画面の準備が完了しません');};
  const noChange=()=>{};
  let selected:CanvasElementSelection|null=null,edited:{overlay?:boolean;index:number}|null=null;
  const selectedIs=(type:CanvasElementSelection['type'],overlay=false)=>selected?.type===type&&(selected.scope==='page_overlay')===overlay;
  const editedIs=(overlay:boolean)=>edited?.overlay===overlay&&edited.index===0;
  const show=async(manga:Manga,guides=false,textTool=false)=>{
    render(<MangaCanvas title="重なり検証" author="" page={manga.pages[0]} pageCount={1} activePanel={-1} selectedPanels={[]} selectedElement={null}
      zoomPercent={null} onZoomPercentChange={noChange} showGuides={guides} innerFrameSnap={false} panelGapSnap={false} panelSync={false}
      frameLineWidthMm={2} bubbleLineWidthMm={.25} defaultBubbleFont={manga.meta.font} imageAssets={manga.image_assets}
      panelGutters={{rowGapMm:5,columnGapMm:3}} guideVisible={()=>false} onToggleGuide={noChange} onGenerateArtwork={noChange}
      textTool={textTool} onEditBubble={target=>{edited={overlay:target.overlay,index:target.bubbleIndex};}}
      onEditScreenText={(_panel,index,overlay)=>{edited={overlay,index};}}
      onSelectPanel={noChange} onSelectElement={value=>{selected=value;}} onChangeElementBBox={noChange} onChangeBubbleTail={noChange}
      onMovePanel={noChange} onResizePanel={noChange} onMoveVertex={noChange} onMovePanelEdge={noChange}/>,host);
    for(let i=0;i<8;i++)await tick();
    await wait(()=>Array.from(host.querySelectorAll<HTMLImageElement>('img')).every(image=>image.complete&&image.naturalWidth>0));
    await wait(()=>!!host.querySelector('.panel-bubble-layer .canvas-content-hit path'));
  };
  const hitAt=(x:number,y:number)=>{
    const b=host.querySelector('.manga-paper')!.getBoundingClientRect();
    const clientX=b.x+x/100*b.width,clientY=b.y+y/100*b.height;
    return {element:document.elementFromPoint(clientX,clientY),clientX,clientY};
  };
  const clickAt=(x:number,y:number)=>{
    const {element,clientX,clientY}=hitAt(x,y);selected=null;edited=null;
    if(!element)throw Error('クリック位置が画面外です');
    element.dispatchEvent(new MouseEvent('click',{button:0,detail:1,clientX,clientY,bubbles:true,cancelable:true}));
  };
  const captured=async(manga:Manga)=>{
    const canvas=await captureQwenCompositionCanvas(manga,0,0,'page',{'0:background':false},{width:400,height:400,includeGenerated:true});canvases.push(canvas);return canvas;
  };
  const pixel=(canvas:HTMLCanvasElement,x:number,y:number)=>Array.from(canvas.getContext('2d')!.getImageData(Math.floor(x/100*canvas.width),Math.floor(y/100*canvas.height),1,1).data);
  const dark=(rgba:number[])=>rgba.slice(0,3).every(value=>value<50)&&rgba[3]===255;
  const white=(rgba:number[])=>rgba.slice(0,3).every(value=>value>245)&&rgba[3]===255;
  const color=async(value:string)=>{
    const c=document.createElement('canvas');canvases.push(c);c.width=c.height=24;
    const ctx=c.getContext('2d')!;ctx.fillStyle=value;ctx.fillRect(0,0,24,24);
    const blob=await new Promise<Blob>(resolve=>c.toBlob(value=>resolve(value!),'image/png'));
    const asset=await prepareImageAsset(new File([blob],'layer-fixture.png',{type:'image/png'}));
    // Separate even an identical color fixture from any previously saved source.
    asset.storageId=crypto.randomUUID();await saveFigureCropAssets([{id:asset.storageId,blob}]);stored.push(asset.storageId);return asset;
  };
  button.disabled=true;report.textContent='検証中';render(null,shots);
  const manga=createEmptyWorkspaceDocument().manga;
  manga.meta.panel_frame_width_mm=2;manga.meta.bubble_line_width_mm=.25;
  manga.pages[0].canvas={w:100,h:100,unit:'mm'};
  manga.pages[0].panels=[{id:1,shape:{type:'rect',x:10,y:10,w:80,h:80},bg:0,action:null,
    bubbles:[{text:'',shape:'square',bbox:{x:7,y:25,w:20,h:30}}]}];
  const baseline=JSON.stringify(manga);
  try{
    const rect=await captured(manga);
    check(dark(pixel(rect,9.25,40))&&dark(pixel(rect,10.75,40)),'接触する通常吹き出しでもコマ枠の外半分・内半分が残る');
    const plain=structuredClone(manga);plain.pages[0].panels[0].bubbles=[];
    const reference=await captured(plain);
    check([8.75,9.25,9.75,10.25,10.75,11.25].every(x=>dark(pixel(reference,x,40))
      ?JSON.stringify(pixel(rect,x,40))===JSON.stringify(pixel(reference,x,40)):!dark(pixel(rect,x,40))),'接触部の線幅・濃度は吹き出しなしと同じ（線外の白地は別）');
    const png=await new Promise<Blob>(resolve=>rect.toBlob(value=>resolve(value!),'image/png')),rgba=rect.getContext('2d')!.getImageData(0,0,400,400);
    const decoded=await blobImageData(png);
    check(decoded.data.every((value,index)=>value===rgba.data[index]),'PNG保存・再decodeで全画素を保持');
    const psd=new Uint8Array(await flattenedPsd(rgba,100,'color').arrayBuffer()),view=new DataView(psd.buffer);let offset=26;
    for(let section=0;section<3;section++)offset+=4+view.getUint32(offset);
    check(view.getUint16(offset)===0&&view.getUint32(14)===400&&view.getUint32(18)===400,'PSDの寸法と非圧縮画像を確認');offset+=2;
    check(rgba.data.every((value,index)=>index%4===3||value===psd[offset+(index%4)*160000+Math.floor(index/4)]),'PSDのRGB各面が同じ合成canvas全画素と一致');
    const input=await (await fetch(await captureQwenComposition(manga,0,0,'page',{'0:background':false}))).blob(),inputPixels=await blobImageData(input);
    const inputSample=(x:number)=>{const n=(Math.floor(.4*inputPixels.height)*inputPixels.width+Math.floor(x/100*inputPixels.width))*4;return Array.from(inputPixels.data.slice(n,n+4));};
    check(dark(inputSample(9.25))&&dark(inputSample(10.75)),'生成入力PNGも同じ枠前面順（モデル実行なし）');
    const bleed=structuredClone(manga);bleed.pages[0].panels[0].bleed=['left'];
    let image=await captured(bleed);check(white(pixel(image,9.25,40))&&white(pixel(image,10.75,40)),'断ち切り辺へ枠を復活させない');
    const hidden=structuredClone(manga);hidden.pages[0].panels[0].layer={frameHidden:true};
    image=await captured(hidden);check(white(pixel(image,9.25,40))&&white(pixel(image,10.75,40)),'枠非表示でも吹き出しclipを維持');
    const polygon=structuredClone(manga);polygon.pages[0].panels[0].shape={type:'polygon',points:[[10,10],[90,25],[90,90],[10,90]]};
    polygon.pages[0].panels[0].bubbles[0].bbox={x:25,y:6,w:40,h:30};image=await captured(polygon);
    check(dark(pixel(image,50,17))&&dark(pixel(image,50,18)),'多角形の斜辺でも枠の全幅を保持');
    for(const guides of [false,true]){
      const shown=structuredClone(manga),inner=innerFrameBounds(shown.pages[0].canvas);
      if(guides)shown.pages[0].panels[0].shape={type:'rect',...inner};
      await show(shown,guides);const z=(selector:string)=>Number(getComputedStyle(host.querySelector(selector)!).zIndex);
      check(z('.panel-bubble-layer')<z('.panel-frame-overlay'),`画面の通常吹き出しは枠の下（ガイド${guides?'あり':'なし'}）`);
      check(host.querySelectorAll('.panel-frame-overlay').length===1&&host.querySelectorAll('.panel-frame-inner-overlay').length===Number(guides),'frame passを増やさず、内枠一致辺だけを既存passで補う');
      if(guides)check(host.querySelectorAll('.panel-frame-inner-overlay line').length===4&&z('.page-direct-paint-layer')>z('.panel-frame-inner-overlay'),'内枠一致の四辺だけを補い、ページ直描きより下に保持');
      clickAt((guides?inner.x:10)+.5,40);check(selectedIs('bubble'),'枠は非対話のまま接触する吹き出しを選択できる');
    }
    const [red,green,blue,magenta]=await Promise.all(['#ff0000','#00ff00','#0000ff','#ff00ff'].map(color));
    const layered=structuredClone(manga),box={x:5,y:30,w:20,h:20};layered.image_assets=[red,green,blue,magenta];
    layered.pages[0].images=[{...createFrameArtwork(red,box),paintScope:'page'}];
    image=await captured(layered);check(JSON.stringify(pixel(image,10,40))==='[255,0,0,255]','ページ直描きはコマ枠と通常吹き出しを覆う');
    layered.pages[0].page_overlay={frame:false,layer:'above_panel_frames',figures:[{name:'前景',bbox:box,artwork:createFrameArtwork(green,box)}]};
    image=await captured(layered);check(JSON.stringify(pixel(image,10,40))==='[0,255,0,255]','前景人物はページ直描き・枠・通常吹き出しより上');
    await show(layered,true);await wait(()=>!!host.querySelector('.page-overlay-figure-layer .canvas-content-hit path'));
    clickAt(15,40);check(selectedIs('figure',true),'実画面で通常吹き出しより前景人物が選ばれる');
    layered.pages[0].page_overlay.bubbles=[{text:'',shape:'square',bbox:{x:5,y:32,w:14,h:15}}];
    image=await captured(layered);check(white(pixel(image,10,40))&&JSON.stringify(pixel(image,22,40))==='[0,255,0,255]','前景吹き出しだけは人物と枠を覆い、外側の人物は残る');
    await show(layered);await wait(()=>!!host.querySelector('.page-overlay-bubble-layer .canvas-content-hit path'));
    clickAt(15,40);check(selectedIs('bubble',true),'実画面で重なった前景吹き出しを選択');
    clickAt(24,40);check(selectedIs('figure',true),'前景吹き出しの外は背面の人物へ通す');
    await show(layered,false,true);clickAt(15,40);check(editedIs(true),'Tの重なり判定も前景吹き出しを優先');
    clickAt(25.5,28);check(editedIs(false),'前景の外はTでコマ内吹き出しを編集');
    layered.pages[0].images.push({...createFrameArtwork(blue,box),generationScope:'page'});
    image=await captured(layered);check(JSON.stringify(pixel(image,10,40))==='[0,0,255,255]','生成絵は前景と枠より上');
    layered.pages[0].images.push({...createFrameArtwork(magenta,box),bubbleOriginal:{sourceRegionId:'r3-fixture',name:'検証原本'}});
    image=await captured(layered);check(JSON.stringify(pixel(image,10,40))==='[255,0,255,255]','切出し原本は生成絵より上');
    check(JSON.stringify(manga)===baseline,'描画・選択・出力は基準原稿を書き換えない');
    await show(manga);render(<img src={rect.toDataURL('image/png')} alt="通常吹き出しに接しても全幅を保つコマ枠" style={{width:'400px',maxWidth:'100%'}}/>,shots);
    report.textContent=`PASS ${checks.length}\n${checks.join('\n')}`;
  }catch(error){report.textContent=`FAIL after ${checks.length}\n${String(error)}\n${checks.join('\n')}`;throw error;}
  finally{await deleteFigureCropAssets(stored);canvases.forEach(canvas=>{canvas.width=canvas.height=1;});button.disabled=false;}
}
