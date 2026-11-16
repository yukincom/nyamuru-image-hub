import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PaintDocument } from '../types';
import type { PendingPaintStroke } from '../lib/paintGesture';
import { paintPreviewRenderer, type PaintImages } from '../lib/paintRenderer';
import { movePaintLayer } from '../lib/paintDocument';
import { paintPreviewSize } from '../lib/paintPreviewSize';

export default function PaintPreviewCanvas({paint,images,live,maskPreviewId,includeGeneration=true,retainCache=false,style}:{
  paint:PaintDocument;images:PaintImages;live?:PendingPaintStroke;maskPreviewId?:string;includeGeneration?:boolean;retainCache?:boolean;
  style?:{width:string;height:string;left:string;top:string};
}){
  const ref=useRef<HTMLCanvasElement>(null),renderer=useRef<ReturnType<typeof paintPreviewRenderer>|null>(null);
  const hasVisible=Boolean(live||maskPreviewId||paint.layers.some(layer=>layer.visible&&layer.opacity!==0&&(layer.image||layer.strokes.length||layer.paths?.length||layer.tone?.fill||(includeGeneration&&layer.generationMask))));
  const [size,setSize]=useState({width:1,height:1});
  useLayoutEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    if(!hasVisible){setSize(previous=>previous.width===1&&previous.height===1?previous:{width:1,height:1});return;}
    let frame=0;
    const dpr=retainCache?window.devicePixelRatio:Math.min(1,window.devicePixelRatio||1);
    const resize=()=>{const box=canvas.getBoundingClientRect(),next=paintPreviewSize(paint.width,paint.height,box.width,box.height,dpr);
      setSize(previous=>previous.width===next.width&&previous.height===next.height?previous:next);};
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(resize);};
    const observer=new ResizeObserver(schedule);observer.observe(canvas);window.addEventListener('resize',schedule);resize();
    return()=>{observer.disconnect();window.removeEventListener('resize',schedule);cancelAnimationFrame(frame);};
  },[paint.width,paint.height,retainCache,hasVisible]);
  useLayoutEffect(()=>{
    if(!ref.current)return;
    if(!hasVisible){
      renderer.current?.dispose();renderer.current=null;
      ref.current.getContext('2d')?.clearRect(0,0,ref.current.width,ref.current.height);
      ref.current.dispatchEvent(new Event('paint-preview-rendered',{bubbles:true}));
      return;
    }
    renderer.current??=paintPreviewRenderer();
    let preview=live?.addedLayer?{...paint,layers:[...paint.layers,live.addedLayer]}:paint;
    if(live?.addedLayer&&live.addedBelow)preview=movePaintLayer(preview,live.addedLayer.id,{kind:'layer',id:live.addedBelow,after:true});
    renderer.current.draw(ref.current,preview,images,live,maskPreviewId,includeGeneration,undefined,retainCache);
    ref.current.dispatchEvent(new Event('paint-preview-rendered',{bubbles:true}));
  },[paint,images,live,maskPreviewId,includeGeneration,retainCache,size,hasVisible]);
  useEffect(()=>()=>{renderer.current?.dispose();if(ref.current)ref.current.width=ref.current.height=1;},[]);
  return <canvas ref={ref} class="paint-preview-canvas" width={size.width} height={size.height} style={style}/>;
}
