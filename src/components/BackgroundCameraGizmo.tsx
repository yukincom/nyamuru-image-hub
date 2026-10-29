import { useRef } from 'preact/hooks';
import type { BackgroundCapture } from '../types';
import { backgroundAxisProjection, backgroundCameraAtAxis, orbitBackgroundCamera } from '../lib/background3dCamera';

type Camera=BackgroundCapture['camera'];
export default function BackgroundCameraGizmo({camera,pivot,disabled,onChange}:{camera:Camera;pivot?:[number,number,number];disabled:boolean;onChange:(camera:Camera)=>void}){
  const drag=useRef<{pointer:number;x:number;y:number;camera:Camera;pivot?:[number,number,number];axis?:string;moved:boolean}|null>(null);
  return <svg class="background3d-gizmo" viewBox="0 0 144 144" role="group" aria-label="カメラの向き" data-tool-label="カメラの向き"  aria-disabled={disabled}
    onPointerDown={event=>{
      if(disabled||event.button!==0)return;event.preventDefault();event.stopPropagation();
      drag.current={pointer:event.pointerId,x:event.clientX,y:event.clientY,camera,pivot,axis:(event.target as Element).closest('[data-axis]')?.getAttribute('data-axis')??undefined,moved:false};
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event=>{const start=drag.current;if(!start||start.pointer!==event.pointerId||disabled)return;
      const dx=event.clientX-start.x,dy=event.clientY-start.y;if(Math.hypot(dx,dy)>3)start.moved=true;
      if(start.moved)onChange(orbitBackgroundCamera(start.camera,dx,dy,start.pivot));
    }}
    onPointerUp={event=>{const start=drag.current;if(!start||start.pointer!==event.pointerId)return;drag.current=null;
      if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
      if(!disabled&&!start.moved&&start.axis)onChange(backgroundCameraAtAxis(camera,start.axis,pivot));
    }} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}>
    <circle cx="72" cy="72" r="66" class="background3d-gizmo-disc"/>
    {backgroundAxisProjection(camera).map(axis=>{
      const x=72+axis.x*45,y=72-axis.y*45,angle=Math.atan2(-axis.y,axis.x)*180/Math.PI;
      return <g key={axis.id} data-axis={axis.id} role="button" tabIndex={disabled?-1:0} aria-disabled={disabled}
        aria-label={`${axis.label}軸の${axis.positive?'正':'負'}方向から見る`}
        onKeyDown={event=>{if(!disabled&&(event.key==='Enter'||event.code==='Space')){event.preventDefault();event.stopPropagation();onChange(backgroundCameraAtAxis(camera,axis.id,pivot));}}}>
        <line x1="72" y1="72" x2={x} y2={y} stroke={axis.color} stroke-width={axis.positive?3:1.5} opacity={axis.positive?1:.4}/>
        {axis.positive&&<path d="M-9 -5 L0 0 L-9 5 Z" fill={axis.color} transform={`translate(${72+axis.x*29} ${72-axis.y*29}) rotate(${angle})`}/>}
        <circle cx={x} cy={y} r={axis.positive?12:9} fill={axis.positive?axis.color:'#fff'} stroke={axis.color} opacity={axis.z<0?.6:1}/>
        <text x={x} y={y} fill={axis.positive?'#fff':axis.color}>{axis.positive?axis.label:'−'}</text>
      </g>;
    })}
    <circle cx="72" cy="72" r="3" fill="#75817b" pointer-events="none"/>
  </svg>;
}
