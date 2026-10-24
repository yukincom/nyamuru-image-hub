import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PaintDocument } from '../types';
import type { PendingPaintStroke } from '../lib/paintGesture';
import { paintPreviewRenderer, type PaintImages } from '../lib/paintRenderer';
import { paintPreviewSize } from '../lib/paintPreviewSize';

export default function PaintPreviewCanvas({paint,images,live,maskPreviewId,includeGeneration=true,style}:{
  paint:PaintDocument;images:PaintImages;live?:PendingPaintStroke;maskPreviewId?:string;includeGeneration?:boolean;
  style?:{width:string;height:string;left:string;top:string};
}){
  const ref=useRef<HTMLCanvasElement>(null),renderer=useRef<ReturnType<typeof paintPreviewRenderer>|null>(null);
  const [size,setSize]=useState({width:1,height:1});
  useLayoutEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    let frame=0;
    const resize=()=>{const box=canvas.getBoundingClientRect(),next=paintPreviewSize(paint.width,paint.height,box.width,box.height,window.devicePixelRatio);
      setSize(previous=>previous.width===next.width&&previous.height===next.height?previous:next);};
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(resize);};
    const observer=new ResizeObserver(schedule);observer.observe(canvas);window.addEventListener('resize',schedule);resize();
    return()=>{observer.disconnect();window.removeEventListener('resize',schedule);cancelAnimationFrame(frame);};
  },[paint.width,paint.height]);
  useLayoutEffect(()=>{
    if(!ref.current)return;renderer.current??=paintPreviewRenderer();
    renderer.current.draw(ref.current,live?.addedLayer?{...paint,layers:[...paint.layers,live.addedLayer]}:paint,images,live,maskPreviewId,includeGeneration);
    ref.current.dispatchEvent(new Event('paint-preview-rendered',{bubbles:true}));
  },[paint,images,live,maskPreviewId,includeGeneration,size]);
  useEffect(()=>()=>{renderer.current?.dispose();},[]);
  return <canvas ref={ref} class="paint-preview-canvas" width={size.width} height={size.height} style={style}/>;
}
