import {createPortal} from 'preact/compat';
import {useLayoutEffect,useRef} from 'preact/hooks';
import type {RefObject} from 'preact';
import type {PaintOwner} from '../lib/paintDocument';
import type {PaintWorkspaceState} from '../lib/paintWorkspace';

/** A DOM overlay avoids the shadow that macOS adds to native cursors. */
export default function PaintCursor({surface,owner,overscan,cursor}:{surface:RefObject<HTMLDivElement>;owner:PaintOwner;overscan:number;cursor:NonNullable<PaintWorkspaceState['cursor']>}) {
  const overlay=useRef<SVGSVGElement>(null);
  const point=useRef<{x:number;y:number;eraser:boolean}|null>(null);
  useLayoutEffect(()=>{
    const input=surface.current,svg=overlay.current;if(!input||!svg)return;
    const hide=()=>{point.current=null;svg.style.display='none';};
    const draw=()=>{
      const p=point.current;if(!p){svg.style.display='none';return;}
      const rect=input.getBoundingClientRect();
      if(p.x<rect.left||p.x>rect.right||p.y<rect.top||p.y>rect.bottom||!rect.width||!rect.height){hide();return;}
      // Match paintInputPoint, including the paint document's padded frame.
      const size=p.eraser?cursor.eraserSize:cursor.size;
      const w=cursor.mode==='circle'?size*rect.width*owner.frame.w/(owner.frame.w+2*overscan)/owner.paint.width:18;
      const h=cursor.mode==='circle'?size*rect.height*owner.frame.h/(owner.frame.h+2*overscan)/owner.paint.height:18;
      const width=w+4,height=h+4,cx=width/2,cy=height/2;
      const path=cursor.mode==='circle'?`M2 ${cy}a${w/2} ${h/2} 0 1 0 ${w} 0a${w/2} ${h/2} 0 1 0 ${-w} 0`:`M${cx} 2V${height-2}M2 ${cy}H${width-2}`;
      svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));
      svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
      for(const pathElement of svg.querySelectorAll('path'))pathElement.setAttribute('d',path);
      svg.style.left=`${p.x}px`;svg.style.top=`${p.y}px`;svg.style.display='block';
    };
    const move=(event:PointerEvent)=>{
      if(event.pointerType==='touch'||!event.isPrimary){hide();return;}
      const target=event.target;
      if(!(target instanceof Node)||!input.contains(target)){hide();return;}
      point.current={x:event.clientX,y:event.clientY,eraser:event.button===5||Boolean(event.buttons&32)};draw();
    };
    const leave=(event:PointerEvent)=>{if(!input.hasPointerCapture(event.pointerId))hide();};
    const observer=new ResizeObserver(draw);observer.observe(input);
    window.addEventListener('pointermove',move,true);input.addEventListener('pointerenter',move);
    window.addEventListener('pointerdown',move,true);window.addEventListener('pointerup',move,true);
    input.addEventListener('pointerleave',leave);window.addEventListener('pointercancel',hide,true);
    window.addEventListener('blur',hide);window.addEventListener('scroll',draw,true);
    draw();
    return()=>{observer.disconnect();window.removeEventListener('pointermove',move,true);input.removeEventListener('pointerenter',move);window.removeEventListener('pointerdown',move,true);window.removeEventListener('pointerup',move,true);input.removeEventListener('pointerleave',leave);window.removeEventListener('pointercancel',hide,true);window.removeEventListener('blur',hide);window.removeEventListener('scroll',draw,true);};
  },[surface,owner.frame.w,owner.frame.h,owner.paint.width,owner.paint.height,overscan,cursor.mode,cursor.size,cursor.eraserSize]);
  return createPortal(<svg ref={overlay} class="paint-cursor" data-cursor-mode={cursor.mode} aria-hidden="true" style={{display:'none'}}><path fill="none" stroke="white" stroke-width="3"/><path fill="none" stroke="black" stroke-width="1"/></svg>,document.body);
}
