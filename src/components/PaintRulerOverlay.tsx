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
        :<g data-ruler-origin="">{Array.from({length:8},(_,i)=>{const angle=i*Math.PI/4,radius=RULER_RADIAL_RADIUS*(i%2?2/3:1);return <line x1={origin.x} y1={origin.y} x2={origin.x+Math.cos(angle)*radius} y2={origin.y+Math.sin(angle)*radius} opacity=".7"/>;})}</g>}
      {ruler.mode==='parallel'&&<path data-ruler-origin="" d={`M${origin.x-RULER_CENTER_RADIUS} ${origin.y}h${RULER_CENTER_RADIUS*2}M${origin.x} ${origin.y-RULER_CENTER_RADIUS}v${RULER_CENTER_RADIUS*2}`}/>}
      <circle data-ruler-toggle="" cx={toggle.x} cy={toggle.y} r={RULER_TOGGLE_RADIUS-.5} fill="white"/>
      {!ruler.enabled&&<path d={`M${toggle.x-3} ${toggle.y+3}l6 -6`}/>}
    </g>
  </svg>;
}
