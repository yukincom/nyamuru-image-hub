import {useLayoutEffect,useState} from 'preact/hooks';
import type {RefObject} from 'preact';
import {paintRulerScreen,RULER_BAND_HALF_WIDTH,RULER_CENTER_RADIUS,RULER_RADIAL_RADIUS,RULER_TOGGLE_RADIUS,type PaintRuler} from '../lib/paintRuler';

export default function PaintRulerOverlay({surface,canvas,ruler}:{surface:RefObject<HTMLDivElement>;canvas:{w:number;h:number};ruler:PaintRuler}){
  const [size,setSize]=useState({w:0,h:0});
  useLayoutEffect(()=>{
    const element=surface.current;if(!element)return;
    const measure=()=>{const box=element.getBoundingClientRect();setSize(previous=>previous.w===box.width&&previous.h===box.height?previous:{w:box.width,h:box.height});};
    const observer=new ResizeObserver(measure);observer.observe(element);measure();
    return()=>observer.disconnect();
  },[surface,canvas.w,canvas.h]);
  if(!size.w||!size.h)return null;
  const {origin,direction,toggle}=paintRulerScreen(ruler,{x:size.w/canvas.w,y:size.h/canvas.h});
  const length=Math.hypot(size.w,size.h)+Math.hypot(origin.x,origin.y);
  const normal={x:-direction.y,y:direction.x};
  return <svg class="paint-ruler-overlay" data-ruler-mode={ruler.mode} data-ruler-enabled={ruler.enabled} data-ruler-angle={ruler.angle} viewBox={`0 0 ${size.w} ${size.h}`} style={{position:'absolute',inset:0,width:'100%',height:'100%',overflow:'hidden',pointerEvents:'none',color:ruler.enabled?'#9955d6':'#4c946e'}} aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="1">
      {ruler.mode==='parallel'?[-RULER_BAND_HALF_WIDTH,0,RULER_BAND_HALF_WIDTH].map(offset=><line x1={origin.x-direction.x*length+normal.x*offset} y1={origin.y-direction.y*length+normal.y*offset} x2={origin.x+direction.x*length+normal.x*offset} y2={origin.y+direction.y*length+normal.y*offset} opacity={offset===0?.8:.45}/>)
        :Array.from({length:16},(_,i)=>{const angle=i*Math.PI/8,dx=Math.cos(angle),dy=Math.sin(angle);return <line x1={origin.x+dx*11} y1={origin.y+dy*11} x2={origin.x+dx*RULER_RADIAL_RADIUS} y2={origin.y+dy*RULER_RADIAL_RADIUS} opacity=".7"/>;})}
      <path data-ruler-origin="" d={`M${origin.x} ${origin.y-RULER_CENTER_RADIUS}l${RULER_CENTER_RADIUS} ${RULER_CENTER_RADIUS}l${-RULER_CENTER_RADIUS} ${RULER_CENTER_RADIUS}l${-RULER_CENTER_RADIUS} ${-RULER_CENTER_RADIUS}Z`} fill="white" fill-opacity=".65"/>
      <path d={`M${origin.x-3} ${origin.y}h6M${origin.x} ${origin.y-3}v6`}/>
      <circle data-ruler-toggle="" cx={toggle.x} cy={toggle.y} r={RULER_TOGGLE_RADIUS-.5} fill="white"/>
      {!ruler.enabled&&<path d={`M${toggle.x-3} ${toggle.y+3}l6 -6`}/>}
    </g>
  </svg>;
}
