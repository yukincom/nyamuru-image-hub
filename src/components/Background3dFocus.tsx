import { createPortal } from 'preact/compat';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import { backgroundFocusRegion } from '../lib/background3dFocusGeometry';

/** Dim the surrounding manuscript without copying or redrawing its artwork. */
export default function Background3dFocus({host,children}:{host:HTMLDivElement|null;children?:ComponentChildren}){
  const [focus,setFocus]=useState<{outline:string;left:number;top:number;right:number;bottom:number;vw:number;vh:number}|null>(null);
  useLayoutEffect(()=>{
    if(!host)return;
    let frame=0;
    const workspace=host.closest('.canvas-spread')??host.closest('.canvas-viewport')??host.parentElement!;
    const update=()=>{
      const {polygon,left,top,right,bottom}=backgroundFocusRegion(host);
      const outline=polygon.length>=3?`M${polygon.map(point=>`${point.x} ${point.y}`).join('L')}Z`:'';
      setFocus({outline,left,top,right,bottom,vw:window.innerWidth,vh:window.innerHeight});
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;update();});};
    const resize=new ResizeObserver(schedule);resize.observe(host);resize.observe(workspace);
    window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);update();
    return()=>{resize.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);cancelAnimationFrame(frame);};
  },[host]);
  if(!focus||focus.right<=focus.left||focus.bottom<=focus.top)return null;
  const {outline,left,top,right,bottom,vw,vh}=focus;
  return createPortal(<><svg class="background3d-focus" viewBox={`0 0 ${vw} ${vh}`} aria-label="3D背景編集中・対象コマ以外を暗く表示">
    <path class="background3d-focus-shade" d={`M${left} ${top}H${right}V${bottom}H${left}Z ${outline}`} fill-rule="evenodd" onPointerDown={event=>{event.preventDefault();event.stopPropagation();}}/>
    <path d={outline} class="background3d-focus-border"/>
  </svg><div class="background3d-viewport-tools" aria-label="原稿上の3Dカメラ操作" style={{left:Math.max(left+8,right-152),top:top+8}}>{children}</div></>,document.body);
}
